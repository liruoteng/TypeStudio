import { useState, useRef, useCallback, memo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabBar } from "./components/Layout/TabBar";
import { StatusBar } from "./components/Layout/StatusBar";
import { Toolbar } from "./components/Layout/Toolbar";
import { FileTree } from "./components/FileExplorer/FileTree";
import { MonacoEditor } from "./components/Editor/MonacoEditor";
import { PreviewPanel } from "./components/Preview/PreviewPanel";
import { SidecarPreviewPanel } from "./components/Preview/SidecarPreviewPanel";
import { TableOfContents } from "./components/Preview/TableOfContents";
import { HistoryPanel } from "./components/FileHistory/HistoryPanel";
import { SettingsDialog } from "./components/Settings/SettingsDialog";
import { AIChatPanel } from "./components/AI/AIChatPanel";
import { useEditorStore } from "./stores/editorStore";
import { usePreview, SaveEvent } from "./hooks/usePreview";
import "./App.css";

const MIN_SIDEBAR = 140;
const SIDEBAR_COLLAPSE = 80;      // px — snap shut below this width
const PREVIEW_SNAP_CLOSE = 80;   // px — snap shut below this width
const PREVIEW_DEFAULT = 380;      // px — restored width when expanding

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [previewWidth, setPreviewWidth] = useState(380);
  const containerRef = useRef<HTMLDivElement>(null);

  const markTabClean = useEditorStore((s) => s.markTabClean);
  const lspStatus = useEditorStore((s) => s.lspStatus);
  const theme = useEditorStore((s) => s.theme);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const writingMode = useEditorStore((s) => s.writingMode);

  // Track save events so usePreview re-compiles on every save of a .typ file
  const [saveEvent, setSaveEvent] = useState<SaveEvent | null>(null);
  usePreview(saveEvent);

  // ── Subscribe to compile actor events ─────────────────────────────────────
  useEffect(() => {
    const unlisten1 = listen<{ total_pages: number; updates: { index: number; svg: string }[] }>("preview-result", (e) => {
      const { applyPreviewUpdate, setLastCompileMs, setPreviewLoading, compileStartedAt } = useEditorStore.getState();
      if (compileStartedAt !== null) setLastCompileMs(performance.now() - compileStartedAt);
      applyPreviewUpdate(e.payload.total_pages, e.payload.updates);
      setPreviewLoading(false);
    });
    const unlisten2 = listen<{ message: string }>("preview-error", (e) => {
      const { setPreviewError } = useEditorStore.getState();
      setPreviewError(e.payload.message);
    });
    const unlisten3 = listen("menu:toggle-sidecar-preview", () => {
      const { useSidecarPreview, setUseSidecarPreview } = useEditorStore.getState();
      setUseSidecarPreview(!useSidecarPreview);
    });
    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlisten3.then((f) => f());
    };
  }, []);

  // ── Native menu event listeners ───────────────────────────────────────────
  // Wired below in a separate effect so closures capture the right callbacks.

  // History panel
  const [showHistory, setShowHistory] = useState(false);
  const [restoreState, setRestoreState] = useState<{ content: string; seq: number } | null>(null);

  // Table of Contents toggle
  const [showToc, setShowToc] = useState(false);

  // AI chat panel toggle
  const [showAiPanel, setShowAiPanel] = useState(false);

  // Settings dialog
  const [showSettings, setShowSettings] = useState(false);

  // LaTeX import result
  const [importResult, setImportResult] = useState<{
    mainTyp: string;
    reportPath: string;
    profile: string | null;
    notes: string[];
  } | null>(null);

  // Hydrate persisted settings once on mount
  useEffect(() => {
    useEditorStore.getState().hydrateSettings();
  }, []);

  // While a splitter is being dragged we render a full-window overlay. This
  // (a) keeps the cursor as col-resize everywhere, and (b) prevents child
  // frames like the sidecar preview <iframe> or the Monaco editor from
  // swallowing mousemove events — without the overlay the drag stalls as
  // soon as the cursor crosses into the iframe.
  const [isResizing, setIsResizing] = useState(false);

  // ── Resizable sidebar ─────────────────────────────────────────────────────
  const startSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startW = sidebarWidth === 0 ? MIN_SIDEBAR : sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        const next = startW + (ev.clientX - startX);
        setSidebarWidth(next < SIDEBAR_COLLAPSE ? 0 : Math.max(next, MIN_SIDEBAR));
      };
      const onUp = () => {
        setIsResizing(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  // ── Resizable / collapsible preview ──────────────────────────────────────
  const startPreviewResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startW = previewWidth === 0 ? PREVIEW_DEFAULT : previewWidth;
      const onMove = (ev: MouseEvent) => {
        const next = startW + (startX - ev.clientX);
        setPreviewWidth(next < PREVIEW_SNAP_CLOSE ? 0 : Math.max(next, PREVIEW_SNAP_CLOSE));
      };
      const onUp = () => {
        setIsResizing(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [previewWidth]
  );

  // ── New File — open a temporary untitled tab immediately ─────────────────
  const handleNewFile = useCallback((kind: "typ" | "md" = "typ") => {
    useEditorStore.getState().openTempTab(kind);
  }, []);

  // ── Cmd+N — new untitled file ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNewFile]);

  // ── Export PDF — pick destination, save, compile, then open ─────────────
  const handleExportPdf = useCallback(async () => {
    const tab = useEditorStore.getState().activeTab();
    if (!tab) return;
    const isTyp = tab.path.endsWith(".typ");
    const isMd  = tab.path.endsWith(".md") || tab.path.endsWith(".markdown");
    if (!isTyp && !isMd) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      // Suggest a default filename derived from the source file
      const defaultName = tab.path.split("/").pop()?.replace(/\.(typ|md|markdown)$/, ".pdf") ?? "output.pdf";
      const destPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!destPath) return; // user cancelled

      await invoke("write_file", { path: tab.path, contents: tab.content });
      markTabClean(tab.path);
      const outputPath = await invoke<string>("export_pdf", { path: tab.path, destPath });
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(outputPath);
    } catch (e) {
      console.error("export PDF error", e);
    }
  }, [markTabClean]);

  // ── Convert .md → .typ (one-way eject) ───────────────────────────────────
  const handleConvertToTypst = useCallback(async () => {
    const tab = useEditorStore.getState().activeTab();
    if (!tab) return;
    const isMd = tab.path.endsWith(".md") || tab.path.endsWith(".markdown");
    if (!isMd) return;
    try {
      // Persist current content so the backend converter reads fresh input.
      if (!tab.path.startsWith("__temp__")) {
        await invoke("write_file", { path: tab.path, contents: tab.content });
        markTabClean(tab.path);
      }
      const { save } = await import("@tauri-apps/plugin-dialog");
      const defaultName = tab.path.split("/").pop()?.replace(/\.(md|markdown)$/, ".typ") ?? "untitled.typ";
      const destPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "Typst", extensions: ["typ"] }],
      });
      if (!destPath) return;

      const typstContent = tab.path.startsWith("__temp__")
        ? // Temp tabs aren't on disk — convert via a transient write or skip backend.
          // Simplest: write temp content to the dest path as a .md copy, convert, overwrite.
          (await (async () => {
            // Since convert_to_typst reads from disk, for a temp .md we write
            // a sibling .md next to the chosen .typ, convert it, then delete.
            const tmpMd = destPath.replace(/\.typ$/, ".__tmp__.md");
            await invoke("write_file", { path: tmpMd, contents: tab.content });
            try {
              return await invoke<string>("convert_to_typst", { path: tmpMd });
            } finally {
              await invoke("delete_path", { path: tmpMd }).catch(() => {});
            }
          })())
        : await invoke<string>("convert_to_typst", { path: tab.path });

      await invoke("create_file", { path: destPath });
      await invoke("write_file", { path: destPath, contents: typstContent });
      const name = destPath.split("/").pop() ?? destPath;
      useEditorStore.getState().openTab(destPath, name, typstContent);
      setSaveEvent((prev) => ({ path: destPath, n: (prev?.n ?? 0) + 1 }));
    } catch (e) {
      console.error("convert to typst error", e);
    }
  }, [markTabClean]);

  // ── Snapshot: called on Cmd+S after the file is written ──────────────────
  const handleSnapshot = useCallback(async (path: string) => {
    const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
    if (tab?.isTemp) return;
    try {
      await invoke("save_snapshot", { path });
    } catch (e) {
      console.error("snapshot error", e);
    }
  }, []);

  // ── Restore: load snapshot content into the editor ───────────────────────
  const handleRestore = useCallback((content: string) => {
    setRestoreState((prev) => ({ content, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // ── Save: write file → mark clean → trigger preview compile ──────────────
  const handleSave = useCallback(async (path: string, content: string, isExplicit: boolean = false) => {
    const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
    // Explicit Cmd+S on a temp file: prompt for a real destination
    if (isExplicit && tab?.isTemp) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const isMdTemp = path.endsWith(".md");
        const destPath = await save({
          defaultPath: isMdTemp ? "untitled.md" : "untitled.typ",
          filters: isMdTemp
            ? [{ name: "Markdown", extensions: ["md", "markdown"] }, { name: "All Files", extensions: ["*"] }]
            : [{ name: "Typst", extensions: ["typ"] }, { name: "All Files", extensions: ["*"] }],
        });
        if (!destPath) return;
        await invoke("write_file", { path: destPath, contents: content });
        const name = destPath.split("/").pop() ?? destPath;
        const store = useEditorStore.getState();
        store.closeTab(path);
        store.openTab(destPath, name, content);
        if (destPath.endsWith(".typ") || destPath.endsWith(".md") || destPath.endsWith(".markdown")) {
          setSaveEvent((prev) => ({ path: destPath, n: (prev?.n ?? 0) + 1 }));
        }
      } catch (e) {
        console.error("save new file error", e);
      }
      return;
    }
    try {
      await invoke("write_file", { path, contents: content });
      markTabClean(path);
      setSaveEvent((prev) => ({ path, n: (prev?.n ?? 0) + 1 }));
    } catch (e) {
      console.error("save error", e);
    }
  }, [markTabClean]);

  // ── Live preview: fire-and-forget to compile actor, results via events ──────
  const handlePreviewTrigger = useCallback((path: string, content: string) => {
    useEditorStore.getState().setPreviewLoading(true);
    invoke("update_preview_source", { path, content }).catch((e) => {
      console.error("update_preview_source failed:", JSON.stringify(e), e);
      useEditorStore.getState().setPreviewError(String(e));
      useEditorStore.getState().setPreviewLoading(false);
    });
  }, []);

  const previewOpen = previewWidth > 0;

  // ── Recompile when switching to a .typ/.md file with preview open ─────────
  const prevActiveTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTabPath && activeTabPath !== prevActiveTabRef.current && previewOpen) {
      const tab = useEditorStore.getState().activeTab();
      if (tab && (tab.path.endsWith(".typ") || tab.path.endsWith(".md") || tab.path.endsWith(".markdown"))) {
        handlePreviewTrigger(tab.path, tab.content);
      }
    }
    prevActiveTabRef.current = activeTabPath;
  }, [activeTabPath, previewOpen, handlePreviewTrigger]);

  // ── Collapse preview when writing mode is active, restore on exit ─────────
  const savedPreviewWidthRef = useRef(0);
  useEffect(() => {
    if (writingMode) {
      if (previewWidth > 0) {
        savedPreviewWidthRef.current = previewWidth;
        setPreviewWidth(0);
      }
    } else {
      if (savedPreviewWidthRef.current > 0) {
        setPreviewWidth(savedPreviewWidthRef.current);
        savedPreviewWidthRef.current = 0;
      }
    }
  // previewWidth intentionally excluded — we only react to writingMode changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingMode]);

  // ── Recompile when preview panel is unfolded ──────────────────────────────
  const prevPreviewWidthRef = useRef(previewWidth);
  useEffect(() => {
    if (previewWidth > 0 && prevPreviewWidthRef.current === 0) {
      const tab = useEditorStore.getState().activeTab();
      if (tab && (tab.path.endsWith(".typ") || tab.path.endsWith(".md") || tab.path.endsWith(".markdown"))) {
        handlePreviewTrigger(tab.path, tab.content);
      }
    }
    prevPreviewWidthRef.current = previewWidth;
  }, [previewWidth, handlePreviewTrigger]);

  // ── Native menu wiring ───────────────────────────────────────────────────
  // Store is authoritative: Monaco mirrors every keystroke into the tab's
  // content, so menu-triggered saves read the latest text from the store.
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(listen("menu:new-file", () => handleNewFile("typ")));
    unlisteners.push(listen("menu:new-file-md", () => handleNewFile("md")));

    unlisteners.push(listen("menu:open-file", async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ multiple: false });
        if (typeof selected !== "string") return;
        const content = await invoke<string>("read_file", { path: selected });
        const name = selected.split("/").pop() ?? selected;
        useEditorStore.getState().openTab(selected, name, content);
      } catch (e) {
        console.error("open file error", e);
      }
    }));

    unlisteners.push(listen("menu:open-folder", async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        if (typeof selected === "string") {
          useEditorStore.getState().setWorkspacePath(selected);
        }
      } catch (e) {
        console.error("open folder error", e);
      }
    }));

    unlisteners.push(listen("menu:save", async () => {
      const tab = useEditorStore.getState().activeTab();
      if (!tab) return;
      await handleSave(tab.path, tab.content);
      handleSnapshot(tab.path);
    }));

    unlisteners.push(listen("menu:save-all", async () => {
      const tabs = useEditorStore.getState().tabs.filter((t) => t.isDirty && !t.isTemp);
      for (const t of tabs) {
        await handleSave(t.path, t.content);
        handleSnapshot(t.path);
      }
    }));

    unlisteners.push(listen("menu:close-tab", () => {
      const path = useEditorStore.getState().activeTabPath;
      if (path) useEditorStore.getState().closeTab(path);
    }));

    unlisteners.push(listen("menu:export-pdf", () => handleExportPdf()));

    unlisteners.push(listen("menu:toggle-sidebar", () => {
      setSidebarWidth((w) => (w === 0 ? MIN_SIDEBAR : 0));
    }));

    unlisteners.push(listen("menu:toggle-preview", () => {
      setPreviewWidth((w) => (w === 0 ? PREVIEW_DEFAULT : 0));
    }));

    unlisteners.push(listen("menu:toggle-outline", () => {
      setShowToc((v) => !v);
    }));

    unlisteners.push(listen("menu:toggle-writing-mode", () => {
      const { writingMode: wm, setWritingMode } = useEditorStore.getState();
      setWritingMode(!wm);
    }));

    unlisteners.push(listen("menu:toggle-history", () => {
      setShowHistory((v) => !v);
    }));

    unlisteners.push(listen("menu:open-settings", () => {
      setShowSettings(true);
    }));

    unlisteners.push(listen("menu:import-latex", async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const zipPath = await open({
          multiple: false,
          filters: [{ name: "Zip Archive", extensions: ["zip"] }],
          title: "Select LaTeX Template Bundle (.zip)",
        });
        if (typeof zipPath !== "string") return;

        // Destination: new sub-folder in workspace if set, else sibling of zip.
        const workspace = useEditorStore.getState().workspacePath;
        let destDir: string;
        if (workspace) {
          const stem = zipPath.split("/").pop()?.replace(/\.zip$/i, "") ?? "latex-import";
          destDir = `${workspace}/${stem}-typst`;
        } else {
          const dir = zipPath.slice(0, zipPath.lastIndexOf("/"));
          const stem = zipPath.split("/").pop()?.replace(/\.zip$/i, "") ?? "latex-import";
          destDir = `${dir}/${stem}-typst`;
        }

        const result = await invoke<{
          profile: string | null;
          dest_dir: string;
          main_typ: string;
          report_path: string;
          notes: string[];
        }>("import_latex_template", { zipPath, destDir });

        // Open the converted main.typ.
        const content = await invoke<string>("read_file", { path: result.main_typ });
        const name = result.main_typ.split("/").pop() ?? "main.typ";
        useEditorStore.getState().openTab(result.main_typ, name, content);
        if (workspace) {
          useEditorStore.getState().setWorkspacePath(workspace); // refresh file tree
        }

        setImportResult({
          mainTyp: result.main_typ,
          reportPath: result.report_path,
          profile: result.profile,
          notes: result.notes,
        });
      } catch (e) {
        console.error("import-latex error", e);
        alert(`LaTeX import failed:\n${e}`);
      }
    }));

    return () => {
      unlisteners.forEach((p) => p.then((f) => f()));
    };
  }, [handleNewFile, handleSave, handleSnapshot, handleExportPdf]);

  return (
    <div className="app" data-theme={theme === "dark" ? undefined : theme}>
      <Toolbar
        onExportPdf={handleExportPdf}
        onConvertToTypst={handleConvertToTypst}
        sidebarOpen={sidebarWidth > 0}
        onToggleSidebar={() => setSidebarWidth((w) => (w === 0 ? MIN_SIDEBAR : 0))}
        sidebarWidth={sidebarWidth}
        previewOpen={previewWidth > 0}
        onTogglePreview={() => setPreviewWidth((w) => (w === 0 ? PREVIEW_DEFAULT : 0))}
        tabBar={<TabBar />}
      />
      {showHistory && activeTabPath && (
        <HistoryPanel
          filePath={activeTabPath}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}
      <div className="app-body" ref={containerRef}>
        {sidebarWidth === 0 ? (
          <div
            className="sidebar-collapsed-strip"
            title="Expand sidebar"
            onClick={() => setSidebarWidth(MIN_SIDEBAR)}
          >
            ›
          </div>
        ) : (
          <>
            <div className="sidebar" style={{ width: sidebarWidth }}>
              <FileTree />
            </div>
            <div className="resize-handle resize-handle-v" onMouseDown={startSidebarResize} />
          </>
        )}

        <div className="editor-column">
          <div className="editor-area">
            <MonacoEditor
              onSave={handleSave}
              onSnapshot={handleSnapshot}
              onNewFile={handleNewFile}
              onPreviewTrigger={handlePreviewTrigger}
              externalContent={restoreState ?? undefined}
            />
          </div>
        </div>

        <div className="resize-handle resize-handle-v" onMouseDown={startPreviewResize} />

        {previewOpen ? (
          <div className="preview-column" style={{ width: previewWidth }}>
            <PreviewHeader
              showToc={showToc}
              onToggleToc={() => { setShowToc((v) => !v); setShowAiPanel(false); }}
              showAiPanel={showAiPanel}
              onToggleAiPanel={() => { setShowAiPanel((v) => !v); setShowToc(false); }}
              onShowPreview={() => { setShowToc(false); setShowAiPanel(false); }}
            />
            <div className="preview-area">
              {showAiPanel ? <AIChatPanel /> : showToc ? <TableOfContents /> : <PreviewBody />}
            </div>
          </div>
        ) : (
          <div
            className="preview-collapsed-strip"
            title="Expand preview"
            onClick={() => setPreviewWidth(PREVIEW_DEFAULT)}
          >
            ‹
          </div>
        )}
      </div>

      <StatusBar lspStatus={lspStatus} onShowHistory={() => setShowHistory((v) => !v)} />
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {importResult && (
        <LatexImportResultDialog
          result={importResult}
          onOpenReport={async () => {
            try {
              const content = await invoke<string>("read_file", { path: importResult.reportPath });
              const name = importResult.reportPath.split("/").pop() ?? "CONVERSION_REPORT.md";
              useEditorStore.getState().openTab(importResult.reportPath, name, content);
            } catch (e) {
              console.error(e);
            }
            setImportResult(null);
          }}
          onClose={() => setImportResult(null)}
        />
      )}
      {isResizing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            cursor: "col-resize",
            // Transparent but hit-testable — swallows mousemove so iframes
            // and the editor don't steal the drag.
            background: "transparent",
          }}
        />
      )}
    </div>
  );
}

/** Chooses sidecar iframe vs in-process SVG preview based on store flag.
 *  .md files always use the in-process path — tinymist's sidecar compiles
 *  from disk and doesn't understand Markdown. */
const PreviewBody = memo(function PreviewBody() {
  const useSidecar = useEditorStore((s) => s.useSidecarPreview);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const isMd = activeTabPath?.endsWith(".md") || activeTabPath?.endsWith(".markdown");
  return useSidecar && !isMd ? <SidecarPreviewPanel /> : <PreviewPanel />;
});

// ── LaTeX Import Result Dialog ────────────────────────────────────────────────

function LatexImportResultDialog({
  result,
  onOpenReport,
  onClose,
}: {
  result: { mainTyp: string; reportPath: string; profile: string | null; notes: string[] };
  onOpenReport: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--color-bg, #1e1e1e)",
          color: "var(--color-fg, #ccc)",
          border: "1px solid var(--color-border, #444)",
          borderRadius: 8,
          padding: "1.5rem",
          maxWidth: 480,
          width: "90%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 0.75rem" }}>LaTeX Template Imported</h3>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", opacity: 0.7 }}>
          Profile: <strong>{result.profile ?? "unknown"}</strong>
        </p>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", opacity: 0.7 }}>
          Opened: <code style={{ fontSize: "0.8rem" }}>{result.mainTyp.split("/").pop()}</code>
        </p>
        {result.notes.length > 0 && (
          <details style={{ margin: "0.5rem 0", fontSize: "0.8rem" }}>
            <summary style={{ cursor: "pointer", opacity: 0.8 }}>
              {result.notes.length} conversion note{result.notes.length !== 1 ? "s" : ""}
            </summary>
            <ul style={{ margin: "0.4rem 0 0 1rem", padding: 0, opacity: 0.7 }}>
              {result.notes.map((n, i) => (
                <li key={i} style={{ marginBottom: "0.2rem" }}>{n}</li>
              ))}
            </ul>
          </details>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
          <button
            style={{ padding: "0.35rem 0.9rem", cursor: "pointer", opacity: 0.8 }}
            onClick={onOpenReport}
          >
            Open Report
          </button>
          <button
            style={{ padding: "0.35rem 0.9rem", cursor: "pointer", fontWeight: "bold" }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 4;

function RobotIcon() {
  // 1 px grid, 14×14 viewBox.
  //
  //   . . . ████ . . .   antenna cap (4 px wide)
  //   . . . . ██ . . .   antenna stem (2 px wide)
  //   . . . . ██ . . .
  //   ██████████████      head top wall (12 px wide)
  //   █  ███  ███  █      eyes (3×2 visor blocks)
  //   █  ███  ███  █
  // ████            ████  ear bolts protruding from sides
  //   █             █
  //   █  ██████  █        mouth (6 px bar)
  //   █             █
  //   ██████████████      head bottom wall
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      {/* Antenna: flat cap + stem */}
      <rect x="5" y="0" width="4" height="1" />
      <rect x="6" y="1" width="2" height="3" />
      {/* Head outline */}
      <rect x="1" y="4"  width="12" height="1" />
      <rect x="1" y="5"  width="1"  height="8" />
      <rect x="12" y="5" width="1"  height="8" />
      <rect x="1" y="13" width="12" height="1" />
      {/* Ear bolts */}
      <rect x="0" y="7"  width="1" height="2" />
      <rect x="13" y="7" width="1" height="2" />
      {/* Eyes — wide visor blocks */}
      <rect x="3" y="6" width="3" height="2" />
      <rect x="8" y="6" width="3" height="2" />
      {/* Mouth — horizontal bar */}
      <rect x="4" y="10" width="6" height="1" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <rect x="1.5" y="0.5" width="8" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 0.5 V3 H9.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <line x1="3.5" y1="5"  x2="7.5" y2="5"  stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="3.5" y1="7"  x2="7.5" y2="7"  stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="3.5" y1="9"  x2="6"   y2="9"  stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/** Preview column header: recompile button, page count, zoom controls, ToC toggle, and AI toggle. */
const PreviewHeader = memo(function PreviewHeader({
  showToc,
  onToggleToc,
  showAiPanel,
  onToggleAiPanel,
  onShowPreview,
}: {
  showToc: boolean;
  onToggleToc: () => void;
  showAiPanel: boolean;
  onToggleAiPanel: () => void;
  onShowPreview: () => void;
}) {
  const pageCount     = useEditorStore((s) => s.previewPages.length);
  const loading       = useEditorStore((s) => s.previewLoading);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const zoom          = useEditorStore((s) => s.previewZoom);
  const setZoom       = useEditorStore((s) => s.setPreviewZoom);
  const compileStatus = useEditorStore((s) => s.compileStatus);
  const useSidecar    = useEditorStore((s) => s.useSidecarPreview);
  const isMd          = activeTabPath?.endsWith(".md") || activeTabPath?.endsWith(".markdown");
  const isTypst       = (activeTabPath?.endsWith(".typ") ?? false) || (isMd ?? false);

  const zoomOut   = useCallback(() => setZoom(+(zoom - ZOOM_STEP).toFixed(2)), [zoom, setZoom]);
  const zoomIn    = useCallback(() => setZoom(+(zoom + ZOOM_STEP).toFixed(2)), [zoom, setZoom]);
  const zoomReset = useCallback(() => setZoom(1), [setZoom]);

  const handleRefresh = useCallback(async () => {
    const tab = useEditorStore.getState().activeTab();
    if (!tab) return;
    const tabIsMd = tab.path.endsWith(".md") || tab.path.endsWith(".markdown");
    if (!tab.path.endsWith(".typ") && !tabIsMd) return;
    try {
      await invoke("write_file", { path: tab.path, contents: tab.content });
      useEditorStore.getState().markTabClean(tab.path);
      const { setPreviewLoading, setPreviewError } = useEditorStore.getState();
      setPreviewLoading(true);
      invoke("trigger_preview_compile", { path: tab.path })
        .catch((e: unknown) => { setPreviewError(String(e)); setPreviewLoading(false); });
    } catch (e) {
      console.error("refresh error", e);
    }
  }, []);

  const runStatus = loading ? "loading" : compileStatus;

  return (
    <div className="preview-header">
      <span className="preview-header-label">{showAiPanel ? "AI ASSISTANT" : showToc ? "OUTLINE" : "PREVIEW"}</span>
      {!showToc && !showAiPanel && pageCount > 0 && (
        <span className="preview-page-count">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </span>
      )}

      <div className="preview-zoom-controls">
        {!showToc && !showAiPanel && (
          <>
            <button
              className={`preview-run-btn preview-run-btn--${runStatus}`}
              onClick={handleRefresh}
              disabled={loading || !isTypst}
              title="Recompile (Cmd+S also triggers this)"
            >
              {loading ? <span className="spin">⟳</span> : "▶"}
            </button>
            {!useSidecar && (
              <>
                <span className="preview-zoom-sep" />
                <button className="preview-icon-btn" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out">−</button>
                <button className="preview-zoom-pct" onClick={zoomReset} title="Reset zoom to 100%">{Math.round(zoom * 100)}%</button>
                <button className="preview-icon-btn" onClick={zoomIn}  disabled={zoom >= ZOOM_MAX} title="Zoom in">+</button>
              </>
            )}
            <span className="preview-zoom-sep" />
          </>
        )}
        <button
          className={`preview-icon-btn${!showToc && !showAiPanel ? " preview-icon-btn--active" : ""}`}
          onClick={onShowPreview}
          title="Show preview"
        >
          <PageIcon />
        </button>
        <button
          className={`preview-icon-btn${showAiPanel ? " preview-icon-btn--active" : ""}`}
          onClick={onToggleAiPanel}
          title={showAiPanel ? "Show preview" : "Open AI assistant"}
        >
          <RobotIcon />
        </button>
        <button
          className={`preview-icon-btn${showToc ? " preview-icon-btn--active" : ""}`}
          onClick={onToggleToc}
          title={showToc ? "Show preview" : "Show table of contents"}
        >
          ☰
        </button>
      </div>
    </div>
  );
});
