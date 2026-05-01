import { useRef, useCallback } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { FileTree, type FileTreeHandle } from "../FileExplorer/FileTree";
import "./FloatingSidebar.css";

interface FloatingSidebarProps {
  onOpenFolder: () => void;
}

export function FloatingSidebar({ onOpenFolder }: FloatingSidebarProps) {
  const sidebarOpen    = useEditorStore((s) => s.sidebarOpen);
  const setSidebarOpen = useEditorStore((s) => s.setSidebarOpen);
  const tabs           = useEditorStore((s) => s.tabs);
  const activeTabPath  = useEditorStore((s) => s.activeTabPath);
  const setActiveTab   = useEditorStore((s) => s.setActiveTab);
  const workspacePath  = useEditorStore((s) => s.workspacePath);

  const fileTreeRef = useRef<FileTreeHandle>(null);

  const close = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);

  return (
    <>
      {/* Dimming backdrop — click to close */}
      <div
        className={`fsb-backdrop${sidebarOpen ? " fsb-backdrop--open" : ""}`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Floating panel */}
      <aside
        className={`fsb${sidebarOpen ? " fsb--open" : ""}`}
        aria-label="Sidebar"
      >
        {/* ── Top bar ─────────────────────────────────────────── */}
        <div className="fsb-topbar">
          <span className="fsb-brand">type-studio</span>
          <button className="fsb-close-btn" onClick={close} title="Close sidebar" aria-label="Close sidebar">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Section 1: Open files + drop zone ───────────────── */}
        <div className="fsb-section">
          <div className="fsb-section-head">
            <span className="fsb-section-title">Files</span>
          </div>

          <label className="fsb-drop-zone" htmlFor="fsb-file-input">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1v8M4 6l3-3 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 10v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Drop files to import
            <input id="fsb-file-input" type="file" multiple style={{ display: "none" }} />
          </label>

          <div className="fsb-file-list">
            {tabs.length === 0 && (
              <span className="fsb-empty-hint">No files open</span>
            )}
            {tabs.map((tab) => {
              const ext = tab.name.split(".").pop()?.toLowerCase() ?? "";
              const color = ext === "typ" ? "var(--accent)" : ext === "bib" ? "#c47a15" : ext === "pdf" ? "#d85a30" : "var(--text-muted)";
              return (
                <button
                  key={tab.path}
                  className={`fsb-file-item${tab.path === activeTabPath ? " fsb-file-item--active" : ""}`}
                  onClick={() => { setActiveTab(tab.path); close(); }}
                  title={tab.path}
                >
                  <span className="fsb-file-dot" style={{ background: color }} />
                  <span className="fsb-file-name">{tab.name}</span>
                  {tab.isDirty && <span className="fsb-file-dirty" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Section 2: Workspace / Projects ─────────────────── */}
        <div className="fsb-section">
          <div className="fsb-section-head">
            <span className="fsb-section-title">Workspace</span>
            <button className="fsb-section-action" onClick={onOpenFolder} title="Open folder">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M1 4h10M1 4v6h10V4M1 4V3a1 1 0 0 1 1-1h2.5l1 1H10a1 1 0 0 1 1 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {workspacePath ? (
            <div className="fsb-workspace-item fsb-workspace-item--active">
              <span className="fsb-workspace-dot" />
              <span className="fsb-workspace-name" title={workspacePath}>
                {workspacePath.split("/").pop() ?? workspacePath}
              </span>
            </div>
          ) : (
            <button className="fsb-open-folder-btn" onClick={onOpenFolder}>
              Open a folder…
            </button>
          )}
        </div>

        {/* ── Section 3: File Explorer (fills remaining height) ── */}
        <div className="fsb-section fsb-section--grow">
          <div className="fsb-section-head">
            <span className="fsb-section-title">Explorer</span>
            <button
              className="fsb-section-action"
              title="New file"
              onClick={() => fileTreeRef.current?.newFile()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="fsb-explorer-body">
            <FileTree ref={fileTreeRef} onOpenFolder={onOpenFolder} />
          </div>
        </div>
      </aside>
    </>
  );
}
