import type { ReactNode } from "react";
import {
  Sun,
  Moon,
  Pencil,
  Download,
  PanelLeft,
  PanelRight,
  Bot,
  FilePlus,
  FolderPlus,
  RefreshCw,
  FolderOpen,
  Circle,
} from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import type { AppTheme, SidebarTab } from "../../stores/editorStore";
import "./Toolbar.css";

const THEME_ICON: Record<AppTheme, ReactNode> = {
  dark: <Sun size={14} />,
  claude: <Moon size={14} />,
};
const THEME_TITLE: Record<AppTheme, string> = {
  dark:   "Switch to light theme",
  claude: "Switch to dark theme",
};
const NEXT_THEME:  Record<AppTheme, AppTheme> = { dark: "claude", claude: "dark" };

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
                <button className="toolbar-btn-icon" onClick={onExplorerNewFile} title="New File"><FilePlus size={14} /></button>
                <button className="toolbar-btn-icon" onClick={onExplorerNewFolder} title="New Folder"><FolderPlus size={14} /></button>
                <button className="toolbar-btn-icon" onClick={onExplorerRefresh} title="Refresh"><RefreshCw size={14} /></button>
              </>
            )}
            <button className="toolbar-btn-icon" onClick={onExplorerOpenFolder} title="Open Folder"><FolderOpen size={14} /></button>
          </div>
        )}
            <button
              className={`toolbar-btn-icon${sidebarOpen ? "" : " toolbar-btn-icon--active"}`}
              style={sidebarOpen ? { marginLeft: "auto" } : undefined}
              onClick={onToggleSidebar}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <PanelLeft size={14} />
            </button>
      </div>

      <div className="toolbar-tabs">
        {tabBar}
      </div>

      <div className="toolbar-right">
        {isDirty && <span className="dirty-badge" title="Unsaved changes"><Circle size={10} fill="currentColor" /></span>}
        {isMd && (
          <button
            className="toolbar-btn-icon toolbar-btn-icon--text"
            onClick={onConvertToTypst}
            title="Convert to Typst (one-way; original .md is kept)"
          >
            .typ
          </button>
        )}
          <button
            className={`toolbar-btn-icon${writingMode ? " toolbar-btn-icon--active" : ""}`}
            onClick={() => setWritingMode(!writingMode)}
            disabled={!activeTabPath}
            title={writingMode ? "Exit writing mode" : "Enter writing mode"}
          >
            <Pencil size={14} />
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
            <Download size={14} />
          </button>
          <button
            className={`toolbar-btn-icon${showAiPanel ? " toolbar-btn-icon--active" : ""}`}
            onClick={onToggleAiPanel}
            title={showAiPanel ? "Close AI assistant" : "Open AI assistant"}
          >
            <Bot size={14} />
          </button>
          <button
            className={`toolbar-btn-icon${previewOpen ? "" : " toolbar-btn-icon--active"}`}
            onClick={onTogglePreview}
            title={previewOpen ? "Hide preview" : "Show preview"}
          >
            <PanelRight size={14} />
          </button>
      </div>
    </div>
  );
}
