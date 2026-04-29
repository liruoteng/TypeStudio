import type { ReactNode } from "react";
import { useEditorStore } from "../../stores/editorStore";
import type { AppTheme } from "../../stores/editorStore";
import "./Toolbar.css";

function NewFileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      {/* Rounded square (the document) */}
      <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.6"/>
      {/* Pen rotated 45° — body + pointed nib */}
      <g transform="rotate(45, 7, 7)">
        <rect x="2.5" y="6.25" width="8.5" height="1.5" rx="0.75" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M2.5,6.25 L1,7 L2.5,7.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5,6 L1.5,4 Q1.5,3 2.5,3 L5.5,3 L7,5.5 L12,5.5 Q12.5,5.5 12.5,6 L12.5,11.5 Q12.5,12.5 11.5,12.5 L2.5,12.5 Q1.5,12.5 1.5,11.5 Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <line x1="5.5" y1="9" x2="8.5" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <line x1="7" y1="7.5" x2="7" y2="10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7,2.5 A4.5,4.5 0 1,1 2.5,7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M1,8.5 L2.5,7 L4,8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function OpenFolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5,6 L1.5,4 Q1.5,3 2.5,3 L5.5,3 L7,5.5 L12,5.5 Q12.5,5.5 12.5,6 L12.5,11.5 Q12.5,12.5 11.5,12.5 L2.5,12.5 Q1.5,12.5 1.5,11.5 Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M5.5,8.5 L7,10 L8.5,8.5 M7,10 L7,7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

const THEME_ICON:  Record<AppTheme, string> = { dark: "☀", claude: "☾" };
const THEME_TITLE: Record<AppTheme, string> = {
  dark:   "Switch to Claude light theme",
  claude: "Switch to dark theme",
};
const NEXT_THEME:  Record<AppTheme, AppTheme> = { dark: "claude", claude: "dark" };

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
  previewOpen: boolean;
  onTogglePreview: () => void;
  tabBar?: ReactNode;
  onExplorerNewFile?: () => void;
  onExplorerNewFolder?: () => void;
  onExplorerRefresh?: () => void;
  onExplorerOpenFolder?: () => void;
}

export function Toolbar({ onExportPdf, onConvertToTypst, sidebarOpen, onToggleSidebar, sidebarWidth, previewOpen, onTogglePreview, tabBar, onExplorerNewFile, onExplorerNewFolder, onExplorerRefresh, onExplorerOpenFolder }: ToolbarProps) {
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
        {sidebarOpen && (
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
