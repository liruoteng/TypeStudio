import { useEditorStore } from "../../stores/editorStore";
import type { AppTheme } from "../../stores/editorStore";
import "./Toolbar.css";

const THEME_ICON:  Record<AppTheme, string> = { dark: "☀", claude: "☾" };
const THEME_TITLE: Record<AppTheme, string> = {
  dark:   "Switch to Claude light theme",
  claude: "Switch to dark theme",
};
const NEXT_THEME:  Record<AppTheme, AppTheme> = { dark: "claude", claude: "dark" };

interface ToolbarProps {
  onExportPdf: () => void;
  onShowHistory: () => void;
}

export function Toolbar({ onExportPdf, onShowHistory }: ToolbarProps) {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const isDirty = useEditorStore((s) => {
    const path = s.activeTabPath;
    return path ? (s.tabs.find((t) => t.path === path)?.isDirty ?? false) : false;
  });
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  const writingMode = useEditorStore((s) => s.writingMode);
  const setWritingMode = useEditorStore((s) => s.setWritingMode);

  const isTypst = activeTabPath?.endsWith(".typ") ?? false;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <span className="app-logo">✦</span>
        <span className="app-name">Type Studio</span>
      </div>
      <div className="toolbar-right">
        {isDirty && <span className="dirty-badge" title="Unsaved changes">●</span>}
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
          onClick={onShowHistory}
          disabled={!activeTabPath}
          title="File history"
        >
          ⏱
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
          className="toolbar-btn-theme"
          onClick={() => setTheme(NEXT_THEME[theme])}
          title={THEME_TITLE[theme]}
        >
          {THEME_ICON[theme]}
        </button>
      </div>
    </div>
  );
}
