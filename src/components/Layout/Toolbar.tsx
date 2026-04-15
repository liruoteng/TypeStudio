import { invoke } from "@tauri-apps/api/core";
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
  onOpenFolder: () => void;
  onExportPdf: () => void;
}

export function Toolbar({ onOpenFolder, onExportPdf }: ToolbarProps) {
  // Subscribe only to primitive/stable values so this component never re-renders
  // on content edits (every keystroke). Content is read imperatively at save time.
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const isDirty = useEditorStore((s) => {
    const path = s.activeTabPath;
    return path ? (s.tabs.find((t) => t.path === path)?.isDirty ?? false) : false;
  });
  const markTabClean = useEditorStore((s) => s.markTabClean);
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);

  const handleSave = async () => {
    const tab = useEditorStore.getState().activeTab();
    if (!tab) return;
    try {
      await invoke("write_file", { path: tab.path, contents: tab.content });
      markTabClean(tab.path);
    } catch (e) {
      console.error("save error", e);
    }
  };

  const isTypst = activeTabPath?.endsWith(".typ") ?? false;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <span className="app-logo">✦</span>
        <span className="app-name">Type Studio</span>
      </div>
      <div className="toolbar-center">
        <button className="toolbar-btn" onClick={onOpenFolder} title="Open Folder">
          Open Folder
        </button>
        <button
          className="toolbar-btn"
          onClick={handleSave}
          disabled={!activeTabPath}
          title="Save (Cmd+S)"
        >
          Save
        </button>
        <button
          className="toolbar-btn toolbar-btn-primary"
          onClick={onExportPdf}
          disabled={!isTypst}
          title="Export to PDF (saves first)"
        >
          Export PDF
        </button>
      </div>
      <div className="toolbar-right">
        {isDirty && <span className="dirty-badge" title="Unsaved changes">●</span>}
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
