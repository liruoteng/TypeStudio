import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";
import "./Toolbar.css";

interface ToolbarProps {
  onOpenFolder: () => void;
}

export function Toolbar({ onOpenFolder }: ToolbarProps) {
  const activeTab = useEditorStore((s) => s.activeTab());
  const markTabClean = useEditorStore((s) => s.markTabClean);

  const handleSave = async () => {
    if (!activeTab) return;
    try {
      await invoke("write_file", { path: activeTab.path, contents: activeTab.content });
      markTabClean(activeTab.path);
    } catch (e) {
      console.error("save error", e);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <span className="app-logo">✦</span>
        <span className="app-name">Type Studio</span>
      </div>
      <div className="toolbar-center">
        <button className="toolbar-btn" onClick={onOpenFolder} title="Open Folder (Cmd+O)">
          Open Folder
        </button>
        <button
          className="toolbar-btn"
          onClick={handleSave}
          disabled={!activeTab}
          title="Save (Cmd+S)"
        >
          Save
        </button>
        <button
          className="toolbar-btn toolbar-btn-primary"
          disabled={!activeTab}
          title="Export PDF"
        >
          Export PDF
        </button>
      </div>
      <div className="toolbar-right">
        {activeTab?.isDirty && <span className="dirty-badge">●</span>}
      </div>
    </div>
  );
}
