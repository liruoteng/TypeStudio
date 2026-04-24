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

  // Track save events so usePreview re-compiles on every save of a .typ file
  const [saveEvent, setSaveEvent] = useState<SaveEvent | null>(null);
  usePreview(saveEvent);

  // ── Subscribe to compile actor events ─────────────────────────────────────
  useEffect(() => {
    const t0Ref = { current: performance.now() };
    const unlisten1 = listen<{ total_pages: number; updates: { index: number; svg: string }[] }>("preview-result", (e) => {
      const { applyPreviewUpdate, setLastCompileMs, setPreviewLoading } = useEditorStore.getState();
      setLastCompileMs(performance.now() - t0Ref.current);
      applyPreviewUpdate(e.payload.total_pages, e.payload.updates);
      setPreviewLoading(false);
      t0Ref.current = performance.now();
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

  // Settings dialog
  const [showSettings, setShowSettings] = useState(false);

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

  // ── Hidden .typ path for a .md file ──────────────────────────────────────
  const mdHiddenTypPath = useCallback((mdPath: string): string => {
    const lastSlash = mdPath.lastIndexOf("/");
    const dir = mdPath.slice(0, lastSlash + 1);
    const basename = mdPath.slice(lastSlash + 1);
    const noExt = basename.includes(".") ? basename.slice(0, basename.lastIndexOf(".")) : basename;
    return `${dir}.${noExt}.typ`;
  }, []);

  // ── New File — create a real file in the OS temp dir, open as a temp tab ──
  const handleNewFile = useCallback(async () => {
    try {
      const tmpPath = await invoke<string>("create_temp_file", { extension: "typ" });
      const name = tmpPath.split("/").pop() ?? "untitled.typ";
      useEditorStore.getState().openTempTab(tmpPath, name);
    } catch (e) {
      console.error("create_temp_file error", e);
    }
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
    if (!tab?.path.endsWith(".typ")) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      // Suggest a default filename derived from the source file
      const defaultName = tab.path.split("/").pop()?.replace(/\.typ$/, ".pdf") ?? "output.pdf";
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
        const destPath = await save({
          defaultPath: tab.name,
          filters: [
            { name: "Typst", extensions: ["typ"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });
        if (!destPath) return;
        await invoke("write_file", { path: destPath, contents: content });
        const name = destPath.split("/").pop() ?? destPath;
        useEditorStore.getState().promoteTempTab(path, destPath, name);
        // Best-effort cleanup of the original temp file
        invoke("delete_path", { path }).catch(() => {});
        if (destPath.endsWith(".typ")) {
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
      if (path.endsWith(".md") || path.endsWith(".markdown")) {
        // Re-convert and update the hidden .typ, then compile that
        const typstContent = await invoke<string>("convert_to_typst", { path });
        const typPath = mdHiddenTypPath(path);
        await invoke("write_file", { path: typPath, contents: typstContent });
        setSaveEvent((prev) => ({ path: typPath, n: (prev?.n ?? 0) + 1 }));
      } else {
        setSaveEvent((prev) => ({ path, n: (prev?.n ?? 0) + 1 }));
      }
    } catch (e) {
      console.error("save error", e);
    }
  }, [markTabClean, mdHiddenTypPath]);

  // ── Live preview: fire-and-forget to compile actor, results via events ──────
  const handlePreviewTrigger = useCallback((path: string, content: string) => {
    useEditorStore.getState().setPreviewLoading(true);
    invoke("update_preview_source", { path, content }).catch(console.error);
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

    unlisteners.push(listen("menu:new-file", () => handleNewFile()));

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
      // TODO: wire up writing-mode once implemented.
      console.info("writing-mode toggle not implemented yet");
    }));

    unlisteners.push(listen("menu:toggle-history", () => {
      setShowHistory((v) => !v);
    }));

    unlisteners.push(listen("menu:open-settings", () => {
      setShowSettings(true);
    }));

    return () => {
      unlisteners.forEach((p) => p.then((f) => f()));
    };
  }, [handleNewFile, handleSave, handleSnapshot, handleExportPdf]);

  return (
    <div className="app" data-theme={theme === "dark" ? undefined : theme}>
      <div style={{ position: "relative" }}>
        <Toolbar onExportPdf={handleExportPdf} />
        {showHistory && activeTabPath && (
          <HistoryPanel
            filePath={activeTabPath}
            onRestore={handleRestore}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>
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
          <TabBar />
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
            <PreviewHeader showToc={showToc} onToggleToc={() => setShowToc((v) => !v)} />
            <div className="preview-area">
              {showToc ? <TableOfContents /> : <PreviewBody />}
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

/** Chooses sidecar iframe vs in-process SVG preview based on store flag. */
const PreviewBody = memo(function PreviewBody() {
  const useSidecar = useEditorStore((s) => s.useSidecarPreview);
  return useSidecar ? <SidecarPreviewPanel /> : <PreviewPanel />;
});

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 4;

/** Preview column header: recompile button, page count, zoom controls, and ToC toggle. */
const PreviewHeader = memo(function PreviewHeader({
  showToc,
  onToggleToc,
}: {
  showToc: boolean;
  onToggleToc: () => void;
}) {
  // Subscribe only to primitives — never to the full Tab object — so this
  // component does NOT re-render on every keystroke. Content/path are read
  // imperatively from the store snapshot inside handleRefresh.
  const pageCount     = useEditorStore((s) => s.previewPages.length);
  const loading       = useEditorStore((s) => s.previewLoading);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const zoom          = useEditorStore((s) => s.previewZoom);
  const setZoom       = useEditorStore((s) => s.setPreviewZoom);
  const compileStatus = useEditorStore((s) => s.compileStatus);
  const useSidecar    = useEditorStore((s) => s.useSidecarPreview);
  const isMd          = activeTabPath?.endsWith(".md") || activeTabPath?.endsWith(".markdown");
  const isTypst       = (activeTabPath?.endsWith(".typ") ?? false) || (isMd ?? false);

  const zoomOut = useCallback(() => setZoom(+(zoom - ZOOM_STEP).toFixed(2)), [zoom, setZoom]);
  const zoomIn  = useCallback(() => setZoom(+(zoom + ZOOM_STEP).toFixed(2)), [zoom, setZoom]);
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
      let compilePath = tab.path;
      if (tabIsMd) {
        const typstContent = await invoke<string>("convert_to_typst", { path: tab.path });
        const lastSlash = tab.path.lastIndexOf("/");
        const dir = tab.path.slice(0, lastSlash + 1);
        const basename = tab.path.slice(lastSlash + 1);
        const noExt = basename.includes(".") ? basename.slice(0, basename.lastIndexOf(".")) : basename;
        compilePath = `${dir}.${noExt}.typ`;
        await invoke("write_file", { path: compilePath, contents: typstContent });
      }
      invoke("trigger_preview_compile", { path: compilePath })
        .catch((e: unknown) => { setPreviewError(String(e)); setPreviewLoading(false); });
    } catch (e) {
      console.error("refresh error", e);
    }
  }, []);

  const runStatus = loading ? "loading" : compileStatus;

  return (
    <div className="preview-header">
      <span className="preview-header-label">{showToc ? "OUTLINE" : "PREVIEW"}</span>
      {!showToc && pageCount > 0 && (
        <span className="preview-page-count">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </span>
      )}

      {/* Recompile + zoom cluster, outline toggle last */}
      <div className="preview-zoom-controls">
        {!showToc && (
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
                <button
                  className="preview-icon-btn"
                  onClick={zoomOut}
                  disabled={zoom <= ZOOM_MIN}
                  title="Zoom out"
                >
                  −
                </button>
                <button
                  className="preview-zoom-pct"
                  onClick={zoomReset}
                  title="Reset zoom to 100%"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  className="preview-icon-btn"
                  onClick={zoomIn}
                  disabled={zoom >= ZOOM_MAX}
                  title="Zoom in"
                >
                  +
                </button>
              </>
            )}
            <span className="preview-zoom-sep" />
          </>
        )}
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
