import { useState, useRef, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabBar } from "./components/Layout/TabBar";
import { StatusBar } from "./components/Layout/StatusBar";
import { Toolbar } from "./components/Layout/Toolbar";
import { FileTree } from "./components/FileExplorer/FileTree";
import { MonacoEditor } from "./components/Editor/MonacoEditor";
import { PreviewPanel } from "./components/Preview/PreviewPanel";
import { useEditorStore } from "./stores/editorStore";
import { usePreview, SaveEvent } from "./hooks/usePreview";
import "./App.css";

const MIN_SIDEBAR = 140;
const PREVIEW_SNAP_CLOSE = 80;   // px — snap shut below this width
const PREVIEW_DEFAULT = 380;      // px — restored width when expanding

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [previewWidth, setPreviewWidth] = useState(380);
  const containerRef = useRef<HTMLDivElement>(null);

  const markTabClean = useEditorStore((s) => s.markTabClean);
  const lspStatus = useEditorStore((s) => s.lspStatus);
  const theme = useEditorStore((s) => s.theme);

  // Track save events so usePreview re-compiles on every save of a .typ file
  const [saveEvent, setSaveEvent] = useState<SaveEvent | null>(null);
  usePreview(saveEvent);

  // ── Resizable sidebar ─────────────────────────────────────────────────────
  const startSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: MouseEvent) =>
        setSidebarWidth(Math.max(MIN_SIDEBAR, startW + (ev.clientX - startX)));
      const onUp = () => {
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
      const startX = e.clientX;
      const startW = previewWidth === 0 ? PREVIEW_DEFAULT : previewWidth;
      const onMove = (ev: MouseEvent) => {
        const next = startW + (startX - ev.clientX);
        setPreviewWidth(next < PREVIEW_SNAP_CLOSE ? 0 : Math.max(next, PREVIEW_SNAP_CLOSE));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [previewWidth]
  );

  // ── Open folder (delegate to same dialog as FileTree) ────────────────────
  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        useEditorStore.getState().setWorkspacePath(selected);
      }
    } catch (e) {
      console.error("open dialog error", e);
    }
  }, []);

  // ── Export PDF ────────────────────────────────────────────────────────────
  const handleExportPdf = useCallback(async () => {
    const tab = useEditorStore.getState().activeTab();
    if (!tab?.path.endsWith(".typ")) return;
    try {
      await invoke("write_file", { path: tab.path, contents: tab.content });
      markTabClean(tab.path);
      await invoke<string>("export_pdf", { path: tab.path });
    } catch (e) {
      console.error("export PDF error", e);
    }
  }, [markTabClean]);

  // ── Save: write file → mark clean → trigger preview compile ──────────────
  const handleSave = useCallback(async (path: string, content: string) => {
    try {
      await invoke("write_file", { path, contents: content });
      markTabClean(path);
      // Increment the event counter so usePreview re-runs even for same path
      setSaveEvent((prev) => ({ path, n: (prev?.n ?? 0) + 1 }));
    } catch (e) {
      console.error("save error", e);
    }
  }, [markTabClean]);

  const previewOpen = previewWidth > 0;

  return (
    <div className="app" data-theme={theme === "dark" ? undefined : theme}>
      <Toolbar onOpenFolder={handleOpenFolder} onExportPdf={handleExportPdf} />
      <div className="app-body" ref={containerRef}>
        <div className="sidebar" style={{ width: sidebarWidth }}>
          <FileTree />
        </div>

        <div className="resize-handle resize-handle-v" onMouseDown={startSidebarResize} />

        <div className="editor-column">
          <TabBar />
          <div className="editor-area">
            <MonacoEditor onSave={handleSave} />
          </div>
        </div>

        <div className="resize-handle resize-handle-v" onMouseDown={startPreviewResize} />

        {previewOpen ? (
          <div className="preview-column" style={{ width: previewWidth }}>
            <PreviewHeader />
            <div className="preview-area">
              <PreviewPanel />
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

      <StatusBar lspStatus={lspStatus} />
    </div>
  );
}

/** Preview column header showing page count and a refresh button. */
const PreviewHeader = memo(function PreviewHeader() {
  // Subscribe only to primitives — never to the full Tab object — so this
  // component does NOT re-render on every keystroke. Content/path are read
  // imperatively from the store snapshot inside handleRefresh.
  const pageCount = useEditorStore((s) => s.previewPages.length);
  const loading = useEditorStore((s) => s.previewLoading);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const isTypst = activeTabPath?.endsWith(".typ") ?? false;

  const handleRefresh = useCallback(async () => {
    const tab = useEditorStore.getState().activeTab();
    if (!tab?.path.endsWith(".typ")) return;
    try {
      await invoke("write_file", { path: tab.path, contents: tab.content });
      useEditorStore.getState().markTabClean(tab.path);
      const { setPreviewLoading, setPreview, setPreviewError } = useEditorStore.getState();
      setPreviewLoading(true);
      invoke<{ pages: string[]; warnings: string }>("compile_to_svg", { path: tab.path })
        .then((r) => setPreview(r.pages))
        .catch((e: unknown) => setPreviewError(String(e)))
        .finally(() => setPreviewLoading(false));
    } catch (e) {
      console.error("refresh error", e);
    }
  }, []);

  return (
    <div className="preview-header">
      <span>PREVIEW</span>
      {pageCount > 0 && (
        <span className="preview-page-count">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </span>
      )}
      <button
        className="preview-refresh-btn"
        onClick={handleRefresh}
        disabled={loading || !isTypst}
        title="Recompile (also triggered on Save)"
      >
        {loading ? "⟳" : "↺"}
      </button>
    </div>
  );
});
