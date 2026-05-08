import { useState, useRef, useCallback, memo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  LayoutGrid,
  Plus,
  Play,
  RefreshCw,
  Download,
  Minus,
  Menu,
  FileText,
  Code,
} from "lucide-react";
import { StatusBar } from "./components/Layout/StatusBar";
import { FloatingSidebar } from "./components/Layout/FloatingSidebar";
import { PanelManager, ALL_PANELS } from "./components/Layout/PanelManager";
import type { PanelId } from "./components/Layout/PanelManager";
import { MonacoEditor } from "./components/Editor/MonacoEditor";
import { WritingModeEditor } from "./components/Editor/WritingModeEditor";
import { PreviewPanel } from "./components/Preview/PreviewPanel";
import { SidecarPreviewPanel } from "./components/Preview/SidecarPreviewPanel";
import { TableOfContents } from "./components/Preview/TableOfContents";
import { HistoryPanel } from "./components/FileHistory/HistoryPanel";
import { SettingsDialog } from "./components/Settings/SettingsDialog";
import { TemplatePickerDialog } from "./components/Templates/TemplatePickerDialog";
import { AIChatPanel } from "./components/AI/AIChatPanel";
import { PDFViewerPanel } from "./components/PdfViewer/PDFViewerPanel";
import { useEditorStore, markPathJustWritten } from "./stores/editorStore";
import { usePreview, SaveEvent } from "./hooks/usePreview";
import "./App.css";

export default function App() {
  const markTabClean = useEditorStore((s) => s.markTabClean);
  const lspStatus = useEditorStore((s) => s.lspStatus);
  const theme = useEditorStore((s) => s.theme);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const writingMode = useEditorStore((s) => s.writingMode);
  const mdSourceMode = useEditorStore((s) => s.mdSourceMode);
  const isMdFile = activeTabPath?.endsWith(".md") || activeTabPath?.endsWith(".markdown");
  const activePanels = useEditorStore((s) => s.activePanels);
  const setActivePanels = useEditorStore((s) => s.setActivePanels);
  const panelLayout = useEditorStore((s) => s.panelLayout);
  const setPanelLayout = useEditorStore((s) => s.setPanelLayout);


  // Panel selector dropdown
  const [selectorOpen, setSelectorOpen] = useState(false);

  const togglePanelId = useCallback((id: PanelId) => {
    const panels = useEditorStore.getState().activePanels;
    if (panels.includes(id)) {
      setActivePanels(panels.filter((p) => p !== id));
    } else {
      if (panels.length >= 5) return;
      setActivePanels([...panels, id]);
    }
  }, [setActivePanels]);


  const lastSnapshotTimeRef = useRef<Map<string, number>>(new Map());

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
    const unlistenWarnings = listen<string[]>("converter-warnings", (e) => {
      useEditorStore.getState().setConverterWarnings(e.payload);
    });
    const unlisten3 = listen("menu:toggle-sidecar-preview", () => {
      const { useSidecarPreview, setUseSidecarPreview } = useEditorStore.getState();
      setUseSidecarPreview(!useSidecarPreview);
    });
    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlistenWarnings.then((f) => f());
      unlisten3.then((f) => f());
    };
  }, []);

  // History panel
  const [showHistory, setShowHistory] = useState(false);
  const [restoreState, setRestoreState] = useState<{ content: string; seq: number } | null>(null);

  // Settings dialog
  const [showSettings, setShowSettings] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

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

  // ── Open Folder ──────────────────────────────────────────────────────────
  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        useEditorStore.getState().setWorkspacePath(selected);
      }
    } catch (e) {
      console.error("open folder error", e);
    }
  }, []);

  // ── New File — create a real temp file then open the tab ─────────────────
  const handleNewFile = useCallback(async (kind: "typ" | "md" = "typ") => {
    try {
      const realPath = await invoke<string>("create_temp_file", { extension: kind });
      useEditorStore.getState().openTempTab(kind, realPath);
    } catch {
      useEditorStore.getState().openTempTab(kind);
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

  // ── ⌘1–⌘5 — toggle panels ───────────────────────────────────────────────
  useEffect(() => {
    const PANEL_KEYS: Record<string, PanelId> = { "1": "ai", "2": "editor", "3": "preview", "4": "diff", "5": "outline" };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const id = PANEL_KEYS[e.key];
      if (!id) return;
      e.preventDefault();
      togglePanelId(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanelId]);

  // ── Export PDF — pick destination, save, compile, then open ─────────────
  const handleExportPdf = useCallback(async () => {
    const tab = useEditorStore.getState().activeTab();
    if (!tab) return;
    const isTyp = tab.path.endsWith(".typ");
    const isMd = tab.path.endsWith(".md") || tab.path.endsWith(".markdown");
    if (!isTyp && !isMd) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const defaultName = tab.path.split("/").pop()?.replace(/\.(typ|md|markdown)$/, ".pdf") ?? "output.pdf";
      const destPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!destPath) return;

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
      lastSnapshotTimeRef.current.set(path, Date.now());
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
        markPathJustWritten(destPath);
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
      markPathJustWritten(path);
      markTabClean(path);
      setSaveEvent((prev) => ({ path, n: (prev?.n ?? 0) + 1 }));

      // Auto-save: snapshot at most once every 5 minutes per file
      if (!isExplicit) {
        const last = lastSnapshotTimeRef.current.get(path) ?? 0;
        if (Date.now() - last > 5 * 60 * 1000) {
          invoke("save_snapshot", { path })
            .then(() => lastSnapshotTimeRef.current.set(path, Date.now()))
            .catch((e) => console.error("auto-snapshot error", e));
        }
      }
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

  const previewOpen = activePanels.includes("preview");

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
  const savedPreviewPanelRef = useRef(false);
  useEffect(() => {
    if (writingMode) {
      const panels = useEditorStore.getState().activePanels;
      if (panels.includes("preview")) {
        savedPreviewPanelRef.current = true;
        useEditorStore.getState().setActivePanels(panels.filter((p) => p !== "preview"));
      }
    } else {
      if (savedPreviewPanelRef.current) {
        savedPreviewPanelRef.current = false;
        const panels = useEditorStore.getState().activePanels;
        if (!panels.includes("preview")) {
          useEditorStore.getState().setActivePanels([...panels, "preview"]);
        }
      }
    }
    // writingMode only — intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingMode]);

  // ── Recompile when preview panel is added ────────────────────────────────
  const prevPreviewOpenRef = useRef(previewOpen);
  useEffect(() => {
    if (previewOpen && !prevPreviewOpenRef.current) {
      const tab = useEditorStore.getState().activeTab();
      if (tab && (tab.path.endsWith(".typ") || tab.path.endsWith(".md") || tab.path.endsWith(".markdown"))) {
        handlePreviewTrigger(tab.path, tab.content);
      }
    }
    prevPreviewOpenRef.current = previewOpen;
  }, [previewOpen, handlePreviewTrigger]);

  // ── Native menu wiring ───────────────────────────────────────────────────
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

    unlisteners.push(listen("menu:open-folder", handleOpenFolder));
    unlisteners.push(listen("menu:new-from-template", () => setShowTemplatePicker(true)));

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
      const { sidebarOpen: open, setSidebarOpen: setOpen } = useEditorStore.getState();
      setOpen(!open);
    }));

    unlisteners.push(listen("menu:toggle-preview", () => {
      const { activePanels: panels, setActivePanels: setPanels } = useEditorStore.getState();
      if (panels.includes("preview")) {
        if (panels.length > 1) setPanels(panels.filter((p) => p !== "preview"));
      } else {
        if (panels.length < 4) setPanels([...panels, "preview"]);
      }
    }));

    unlisteners.push(listen("menu:toggle-outline", () => {
      const { activePanels: panels, setActivePanels: setPanels } = useEditorStore.getState();
      if (panels.includes("outline")) {
        if (panels.length > 1) setPanels(panels.filter((p) => p !== "outline"));
      } else {
        if (panels.length < 4) setPanels([...panels, "outline"]);
      }
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

        const content = await invoke<string>("read_file", { path: result.main_typ });
        const name = result.main_typ.split("/").pop() ?? "main.typ";
        useEditorStore.getState().openTab(result.main_typ, name, content);
        if (workspace) {
          useEditorStore.getState().setWorkspacePath(workspace);
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
  }, [handleNewFile, handleSave, handleSnapshot, handleExportPdf, handleOpenFolder]);

  return (
    <div className={"app " + (theme === "dark" ? "dark" : "")} data-theme={theme === "dark" ? undefined : theme}>
      {showHistory && activeTabPath && (
        <HistoryPanel
          filePath={activeTabPath}
          currentContent={useEditorStore.getState().tabs.find((t) => t.path === activeTabPath)?.content ?? ""}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* ── Main body ──────────────────────────────────────────── */}
      <div className="app-body">
        <FloatingSidebar onOpenFolder={handleOpenFolder} />

        <div className="main-content" onClick={() => selectorOpen && setSelectorOpen(false)}>
          {/* Panel area: full width panel grid */}
          <div className="panel-area">
            {activePanels.length === 0 ? (
              <WelcomeScreen onNewFile={handleNewFile} onOpenFolder={handleOpenFolder} />
            ) : null}
            <PanelManager
              titleSuffixes={{ preview: <PreviewPageCount /> }}
              headerExtras={{
                preview: <PreviewPanelControls onExportPdf={handleExportPdf} />,
                editor: isMdFile ? <MdSourceToggle /> : null,
                ai: <AiHeaderControls />
              }}
              headerExtrasLeft={{
                ai: <AiHeaderControlsLeft />
              }}
              contents={{
                ai: <AIChatPanel />,
                editor: isMdFile && !mdSourceMode ? (
                  <WritingModeEditor
                    onSave={handleSave}
                    onSnapshot={handleSnapshot}
                    onPreviewTrigger={handlePreviewTrigger}
                    externalContent={restoreState ?? undefined}
                  />
                ) : (
                  <MonacoEditor
                    onSave={handleSave}
                    onSnapshot={handleSnapshot}
                    onNewFile={handleNewFile}
                    onPreviewTrigger={handlePreviewTrigger}
                    externalContent={restoreState ?? undefined}
                  />
                ),
                preview: <PreviewBody />,
                diff: (
                  <div className="pm-placeholder">
                    Diff view — coming soon
                  </div>
                ),
                outline: <TableOfContents />,
                pdf: <PDFViewerPanel />,
              }}
            />
          </div>

          {/* ── Layout button — always top-right of main-content ──── */}
          <div className="panel-selector-anchor">
            <button
              className={`pm-selector-btn${selectorOpen ? " pm-selector-btn--open" : ""}`}
              onClick={(e) => { e.stopPropagation(); setSelectorOpen((v) => !v); }}
              title="Layout"
              aria-label="Layout"
            >
              <LayoutIcon />
            </button>
            {selectorOpen && (
              <LayoutDropdown
                activePanels={activePanels}
                onTogglePanel={togglePanelId}
                panelLayout={panelLayout}
                onToggleLayout={() => setPanelLayout(panelLayout === "horizontal" ? "vertical" : "horizontal")}
                onClose={() => setSelectorOpen(false)}
              />
            )}
          </div>
          {selectorOpen && <div className="pm-selector-overlay" onClick={() => setSelectorOpen(false)} />}
        </div>
      </div>

      <StatusBar lspStatus={lspStatus} onShowHistory={() => setShowHistory((v) => !v)} />
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showTemplatePicker && <TemplatePickerDialog onClose={() => setShowTemplatePicker(false)} />}
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
    </div>
  );
}

// ── Layout dropdown — sidebar + panel selection ───────────────────────────────
function LayoutDropdown({
  activePanels,
  onTogglePanel,
  panelLayout,
  onToggleLayout,
  onClose,
}: {
  activePanels: string[];
  onTogglePanel: (id: PanelId) => void;
  panelLayout: "horizontal" | "vertical";
  onToggleLayout: () => void;
  onClose: () => void;
}) {
  return (
    <div className="layout-dropdown" onMouseDown={(e) => e.stopPropagation()}>
      <div className="layout-dd-header">Panels</div>
      {ALL_PANELS.map((p) => {
        const active = activePanels.includes(p.id);
        return (
          <button
            key={p.id}
            className={`layout-dd-item${active ? " layout-dd-item--on" : ""}`}
            onClick={() => { onTogglePanel(p.id); onClose(); }}
          >
            <span className={`layout-dd-check${active ? " layout-dd-check--on" : ""}`}>{active && <Check size={10} />}</span>
            <span className="layout-dd-label">{p.label}</span>
            <span className="layout-dd-desc">{p.shortcut}</span>
          </button>
        );
      })}
      <div className="layout-dd-divider" />
      <div className="layout-dd-header">Arrangement</div>
      <button
        className={`layout-dd-item${panelLayout === "horizontal" ? " layout-dd-item--on" : ""}`}
        onClick={() => { if (panelLayout !== "horizontal") onToggleLayout(); onClose(); }}
      >
        <span className={`layout-dd-check${panelLayout === "horizontal" ? " layout-dd-check--on" : ""}`}>{panelLayout === "horizontal" && <Check size={10} />}</span>
        <span className="layout-dd-label">Side by side</span>
        <span className="layout-dd-desc">Panels arranged in columns</span>
      </button>
      <button
        className={`layout-dd-item${panelLayout === "vertical" ? " layout-dd-item--on" : ""}`}
        onClick={() => { if (panelLayout !== "vertical") onToggleLayout(); onClose(); }}
      >
        <span className={`layout-dd-check${panelLayout === "vertical" ? " layout-dd-check--on" : ""}`}>{panelLayout === "vertical" && <Check size={10} />}</span>
        <span className="layout-dd-label">Stacked</span>
        <span className="layout-dd-desc">Panels arranged in rows</span>
      </button>
    </div>
  );
}

function LayoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="0.7" y="0.7" width="12.6" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="0.7" y="7.9" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="7.9" y="7.9" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}


/** Chooses sidecar iframe vs in-process SVG preview based on store flag. */
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
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">LaTeX Template Imported</h3>
        <p className="dialog-row">
          Profile: <strong>{result.profile ?? "unknown"}</strong>
        </p>
        <p className="dialog-row">
          Opened: <code>{result.mainTyp.split("/").pop()}</code>
        </p>
        {result.notes.length > 0 && (
          <details className="dialog-details">
            <summary>
              {result.notes.length} conversion note{result.notes.length !== 1 ? "s" : ""}
            </summary>
            <ul>
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onOpenReport}>
            Open Report
          </button>
          <button className="dialog-btn dialog-btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

const MdSourceToggle = memo(function MdSourceToggle() {
  const mdSourceMode = useEditorStore((s) => s.mdSourceMode);
  const setMdSourceMode = useEditorStore((s) => s.setMdSourceMode);
  return (
    <div className="md-source-toggle">
      <button
        className={`md-source-toggle-btn${!mdSourceMode ? " active" : ""}`}
        onClick={() => setMdSourceMode(false)}
        title="WYSIWYG mode"
      >
        <FileText size={13} />
      </button>
      <button
        className={`md-source-toggle-btn${mdSourceMode ? " active" : ""}`}
        onClick={() => setMdSourceMode(true)}
        title="Source mode"
      >
        <Code size={13} />
      </button>
    </div>
  );
});

const PreviewPageCount = memo(function PreviewPageCount() {
  const pageCount = useEditorStore((s) => s.previewPages.length);
  if (pageCount === 0) return null;
  return (
    <span className="preview-page-count">
      {pageCount} {pageCount === 1 ? "page" : "pages"}
    </span>
  );
});

const AiHeaderControls = memo(function AiHeaderControls() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("ai:new-session"))}
      title="New chat"
      className="ai-column-action"
    >
      <Plus size={14} />
    </button>
  );
});

const AiHeaderControlsLeft = memo(function AiHeaderControlsLeft() {
  const setShowAiSessions = useEditorStore((s) => s.setShowAiSessions);

  return (
    <button
      onClick={() => setShowAiSessions(true)}
      title="All sessions"
      className="ai-column-action"
    >
      <Menu size={14} />
    </button>
  );
});

/** Preview panel header controls: compile button, download, zoom. */
const PreviewPanelControls = memo(function PreviewPanelControls({
  onExportPdf,
}: {
  onExportPdf: () => void;
}) {
  const loading = useEditorStore((s) => s.previewLoading);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const zoom = useEditorStore((s) => s.previewZoom);
  const setZoom = useEditorStore((s) => s.setPreviewZoom);
  const compileStatus = useEditorStore((s) => s.compileStatus);
  const useSidecar = useEditorStore((s) => s.useSidecarPreview);
  const isMd = activeTabPath?.endsWith(".md") || activeTabPath?.endsWith(".markdown");
  const isTypst = (activeTabPath?.endsWith(".typ") ?? false) || (isMd ?? false);

  const zoomOut = useCallback(() => setZoom(+(zoom - ZOOM_STEP).toFixed(2)), [zoom, setZoom]);
  const zoomIn = useCallback(() => setZoom(+(zoom + ZOOM_STEP).toFixed(2)), [zoom, setZoom]);
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
    <div className="preview-zoom-controls">
      <button
        className={`preview-run-btn preview-run-btn--${runStatus}`}
        onClick={handleRefresh}
        disabled={loading || !isTypst}
        title="Recompile (Cmd+S also triggers this)"
      >
        {loading ? <RefreshCw size={12} className="spin" /> : <Play size={12} />}
      </button>
      <button
        className="preview-icon-btn"
        onClick={onExportPdf}
        disabled={!isTypst}
        title="Export PDF"
      >
        <Download size={12} />
      </button>
      {!useSidecar && (
        <>
          <span className="preview-zoom-sep" />
          <button className="preview-icon-btn" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out"><Minus size={12} /></button>
          <button className="preview-zoom-pct" onClick={zoomReset} title="Reset zoom to 100%">{Math.round(zoom * 100)}%</button>
          <button className="preview-icon-btn" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Zoom in"><Plus size={12} /></button>
        </>
      )}
    </div>
  );
});

// ── Welcome screen (shown when all panels are closed) ─────────────────────────
function WelcomeScreen({ onNewFile, onOpenFolder }: { onNewFile: (kind?: "typ" | "md") => void; onOpenFolder: () => void }) {
  return (
    <div className="welcome-screen">
      <div className="welcome-inner">
        <h1 className="welcome-title">type-studio</h1>
        <p className="welcome-subtitle">A Typst writing environment</p>
        <div className="welcome-actions">
          <button className="welcome-action" onClick={() => onNewFile("typ")}>
            <span className="welcome-action-icon"><Plus size={16} /></span>
            <span className="welcome-action-text">
              <span className="welcome-action-label">New Typst file</span>
              <span className="welcome-action-hint">⌘N</span>
            </span>
          </button>
          <button className="welcome-action" onClick={() => onNewFile("md")}>
            <span className="welcome-action-icon"><Plus size={16} /></span>
            <span className="welcome-action-text">
              <span className="welcome-action-label">New Markdown file</span>
              <span className="welcome-action-hint">⌘⇧N</span>
            </span>
          </button>
          <button className="welcome-action" onClick={onOpenFolder}>
            <span className="welcome-action-icon"><LayoutGrid size={16} /></span>
            <span className="welcome-action-text">
              <span className="welcome-action-label">Open folder</span>
              <span className="welcome-action-hint">⌘⇧O</span>
            </span>
          </button>
        </div>
        <p className="welcome-hint">Use the <span className="welcome-hint-key"><LayoutGrid size={12} /></span> layout button (top-right) to reopen panels.</p>
      </div>
    </div>
  );
}