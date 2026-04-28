import { useEditorStore } from "../../stores/editorStore";
import type { AppTheme } from "../../stores/editorStore";
import "./Toolbar.css";

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
  previewOpen: boolean;
  onTogglePreview: () => void;
}

export function Toolbar({ onExportPdf, onConvertToTypst, sidebarOpen, onToggleSidebar, previewOpen, onTogglePreview }: ToolbarProps) {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
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
      <div className="toolbar-left">
        <button
          className={`toolbar-btn-theme${sidebarOpen ? "" : " toolbar-btn-theme--active"}`}
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          <PanelLeftIcon />
        </button>
        <span className="app-logo">✦</span>
        <span className="app-name">Type Studio</span>
      </div>
      <div className="toolbar-right">
        {isDirty && <span className="dirty-badge" title="Unsaved changes">●</span>}
        {isMd && (
          <button
            className="toolbar-btn-theme"
            onClick={onConvertToTypst}
            title="Convert to Typst (one-way; original .md is kept)"
          >
            → .typ
          </button>
        )}
        <button
          className={`toolbar-btn-theme${writingMode ? " toolbar-btn-theme--active" : ""}`}
          onClick={() => setWritingMode(!writingMode)}
          disabled={!activeTabPath}
          title={writingMode ? "Exit writing mode" : "Enter writing mode"}
        >
          ✎
        </button>
        <button
          className="toolbar-btn-theme"
          onClick={() => setTheme(NEXT_THEME[theme])}
          title={THEME_TITLE[theme]}
        >
          {THEME_ICON[theme]}
        </button>
        <button
          className="toolbar-btn-theme"
          onClick={onExportPdf}
          disabled={!isTypst}
          title="Export PDF"
        >
          ⬇
        </button>
        <button
          className={`toolbar-btn-theme${previewOpen ? "" : " toolbar-btn-theme--active"}`}
          onClick={onTogglePreview}
          title={previewOpen ? "Hide preview" : "Show preview"}
        >
          <PanelRightIcon />
        </button>
      </div>
    </div>
  );
}
