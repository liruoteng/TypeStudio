import type { ReactNode } from "react";
import { useEditorStore } from "../../stores/editorStore";
import type { AppTheme, SidebarTab } from "../../stores/editorStore";
import "./Toolbar.css";

function NewFileIcon() {
  return (
    <svg className="toolbar-file-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4.25 2.25h5.1l2.4 2.45v9.05h-7.5a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2Z" />
      <path d="M9.25 2.35v2.6h2.45" />
      <path d="M6.85 7.25v4.1" />
      <path d="M4.8 9.3h4.1" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg className="toolbar-file-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.9 5.1V4.15c0-.9.5-1.4 1.4-1.4h3.05l1.35 1.5h5c.9 0 1.4.5 1.4 1.4v1.05" />
      <path d="M1.9 5.75h12.2l-.75 6.1c-.12.9-.6 1.4-1.5 1.4h-7.7c-.9 0-1.38-.5-1.5-1.4l-.75-6.1Z" />
      <path d="M8 7.95v3.1" />
      <path d="M6.45 9.5h3.1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="toolbar-file-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M12.1 5.15A4.7 4.7 0 0 0 3.7 6.2" />
      <path d="M12.25 2.85v2.55H9.7" />
      <path d="M3.9 10.85a4.7 4.7 0 0 0 8.4-1.05" />
      <path d="M3.75 13.15V10.6H6.3" />
    </svg>
  );
}

function OpenFolderIcon() {
  return (
    <svg className="toolbar-file-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.9 5.1V4.15c0-.9.5-1.4 1.4-1.4h3.05l1.35 1.5h5c.9 0 1.4.5 1.4 1.4v1.05" />
      <path d="M1.9 5.75h12.2l-.75 6.1c-.12.9-.6 1.4-1.5 1.4h-7.7c-.9 0-1.38-.5-1.5-1.4l-.75-6.1Z" />
      <path d="M8 10.95v-3.1" />
      <path d="M6.45 9.4 8 7.85l1.55 1.55" />
    </svg>
  );
}

const THEME_ICON:  Record<AppTheme, string> = { dark: "☀", claude: "☾" };
const THEME_TITLE: Record<AppTheme, string> = {
  dark:   "Switch to Claude light theme",
  claude: "Switch to dark theme",
};
const NEXT_THEME:  Record<AppTheme, AppTheme> = { dark: "claude", claude: "dark" };

function RobotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="5" y="0" width="4" height="1" />
      <rect x="6" y="1" width="2" height="3" />
      <rect x="1" y="4"  width="12" height="1" />
      <rect x="1" y="5"  width="1"  height="8" />
      <rect x="12" y="5" width="1"  height="8" />
      <rect x="1" y="13" width="12" height="1" />
      <rect x="0" y="7"  width="1" height="2" />
      <rect x="13" y="7" width="1" height="2" />
      <rect x="3" y="6" width="3" height="2" />
      <rect x="8" y="6" width="3" height="2" />
      <rect x="4" y="10" width="6" height="1" />
    </svg>
  );
}

function PanelLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="0.7" y="0.7" width="12.6" height="12.6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="4.7" y1="0.7" x2="4.7" y2="13.3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function PanelRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="0.7" y="0.7" width="12.6" height="12.6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="9.3" y1="0.7" x2="9.3" y2="13.3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

interface ToolbarProps {
  onExportPdf: () => void;
  onConvertToTypst: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  sidebarWidth: number;
  sidebarTab: SidebarTab;
  previewOpen: boolean;
  onTogglePreview: () => void;
  showAiPanel: boolean;
  onToggleAiPanel: () => void;
  tabBar?: ReactNode;
  onExplorerNewFile?: () => void;
  onExplorerNewFolder?: () => void;
  onExplorerRefresh?: () => void;
  onExplorerOpenFolder?: () => void;
}

export function Toolbar({ onExportPdf, onConvertToTypst, sidebarOpen, onToggleSidebar, sidebarWidth, sidebarTab, previewOpen, onTogglePreview, showAiPanel, onToggleAiPanel, tabBar, onExplorerNewFile, onExplorerNewFolder, onExplorerRefresh, onExplorerOpenFolder }: ToolbarProps) {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const isDirty = useEditorStore((s) => {
    const path = s.activeTabPath;
    return path ? (s.tabs.find((t) => t.path === path)?.isDirty ?? false) : false;
  });
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  const writingMode = useEditorStore((s) => s.writingMode);
  const setWritingMode = useEditorStore((s) => s.setWritingMode);

  const isMd = (activeTabPath?.endsWith(".md") || activeTabPath?.endsWith(".markdown")) ?? false;
  const isTypst = (activeTabPath?.endsWith(".typ") ?? false) || isMd;

  return (
    <div className="toolbar">
      <div
        className="toolbar-left"
        style={sidebarOpen ? { width: sidebarWidth } : undefined}
      >
        {sidebarOpen && sidebarTab === "files" && (
          <div className="toolbar-explorer-actions">
            {workspacePath && (
              <>
                <button className="toolbar-btn-icon" onClick={onExplorerNewFile} title="New File"><NewFileIcon /></button>
                <button className="toolbar-btn-icon" onClick={onExplorerNewFolder} title="New Folder"><NewFolderIcon /></button>
                <button className="toolbar-btn-icon" onClick={onExplorerRefresh} title="Refresh"><RefreshIcon /></button>
              </>
            )}
            <button className="toolbar-btn-icon" onClick={onExplorerOpenFolder} title="Open Folder"><OpenFolderIcon /></button>
          </div>
        )}
        <button
          className={`toolbar-btn-icon${sidebarOpen ? "" : " toolbar-btn-icon--active"}`}
          style={sidebarOpen ? { marginLeft: "auto" } : undefined}
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          <PanelLeftIcon />
        </button>
      </div>

      <div className="toolbar-tabs">
        {tabBar}
      </div>

      <div className="toolbar-right">
        {isDirty && <span className="dirty-badge" title="Unsaved changes">●</span>}
        {isMd && (
          <button
            className="toolbar-btn-icon"
            onClick={onConvertToTypst}
            title="Convert to Typst (one-way; original .md is kept)"
          >
            → .typ
          </button>
        )}
        <button
          className={`toolbar-btn-icon${writingMode ? " toolbar-btn-icon--active" : ""}`}
          onClick={() => setWritingMode(!writingMode)}
          disabled={!activeTabPath}
          title={writingMode ? "Exit writing mode" : "Enter writing mode"}
        >
          ✎
        </button>
        <button
          className="toolbar-btn-icon"
          onClick={() => setTheme(NEXT_THEME[theme])}
          title={THEME_TITLE[theme]}
        >
          {THEME_ICON[theme]}
        </button>
        <button
          className="toolbar-btn-icon"
          onClick={onExportPdf}
          disabled={!isTypst}
          title="Export PDF"
        >
          ⬇
        </button>
        <button
          className={`toolbar-btn-icon${showAiPanel ? " toolbar-btn-icon--active" : ""}`}
          onClick={onToggleAiPanel}
          title={showAiPanel ? "Close AI assistant" : "Open AI assistant"}
        >
          <RobotIcon />
        </button>
        <button
          className={`toolbar-btn-icon${previewOpen ? "" : " toolbar-btn-icon--active"}`}
          onClick={onTogglePreview}
          title={previewOpen ? "Hide preview" : "Show preview"}
        >
          <PanelRightIcon />
        </button>
      </div>
    </div>
  );
}
