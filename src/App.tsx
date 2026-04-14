import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Toolbar } from "./components/Layout/Toolbar";
import { TabBar } from "./components/Layout/TabBar";
import { StatusBar } from "./components/Layout/StatusBar";
import { FileTree } from "./components/FileExplorer/FileTree";
import { MonacoEditor } from "./components/Editor/MonacoEditor";
import { PreviewPanel } from "./components/Preview/PreviewPanel";
import { useEditorStore } from "./stores/editorStore";
import "./App.css";

const MIN_SIDEBAR = 140;
const MIN_PREVIEW = 200;

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [previewWidth, setPreviewWidth] = useState(380);
  const containerRef = useRef<HTMLDivElement>(null);

  const setWorkspacePath = useEditorStore((s) => s.setWorkspacePath);
  const markTabClean = useEditorStore((s) => s.markTabClean);
  const lspStatus = useEditorStore((s) => s.lspStatus);

  // ── Resizable sidebar (left divider) ──────────────────────────────────────
  const startSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(Math.max(MIN_SIDEBAR, startW + (ev.clientX - startX)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  // ── Resizable preview (right divider) ─────────────────────────────────────
  const startPreviewResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = previewWidth;
      const onMove = (ev: MouseEvent) => {
        setPreviewWidth(Math.max(MIN_PREVIEW, startW + (startX - ev.clientX)));
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

  // ── Open folder from toolbar ───────────────────────────────────────────────
  const handleOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setWorkspacePath(selected);
      }
    } catch (e) {
      console.error("open dialog error", e);
    }
  };

  // ── Save active file ───────────────────────────────────────────────────────
  const handleSave = async (path: string, content: string) => {
    try {
      await invoke("write_file", { path, contents: content });
      markTabClean(path);
    } catch (e) {
      console.error("save error", e);
    }
  };

  return (
    <div className="app">
      <Toolbar onOpenFolder={handleOpenFolder} />

      <div className="app-body" ref={containerRef}>
        {/* Sidebar */}
        <div className="sidebar" style={{ width: sidebarWidth }}>
          <FileTree />
        </div>

        {/* Left resize handle */}
        <div className="resize-handle resize-handle-v" onMouseDown={startSidebarResize} />

        {/* Editor column */}
        <div className="editor-column">
          <TabBar />
          <div className="editor-area">
            <MonacoEditor onSave={handleSave} />
          </div>
        </div>

        {/* Right resize handle */}
        <div className="resize-handle resize-handle-v" onMouseDown={startPreviewResize} />

        {/* Preview */}
        <div className="preview-column" style={{ width: previewWidth }}>
          <div className="preview-header">PREVIEW</div>
          <div className="preview-area">
            <PreviewPanel />
          </div>
        </div>
      </div>

      <StatusBar lspStatus={lspStatus} />
    </div>
  );
}
