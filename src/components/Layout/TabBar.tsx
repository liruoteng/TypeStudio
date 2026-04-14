import { useEditorStore } from "../../stores/editorStore";
import "./TabBar.css";

export function TabBar() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`tab ${activeTabPath === tab.path ? "active" : ""}`}
          onClick={() => setActiveTab(tab.path)}
        >
          <span className="tab-name">{tab.name}</span>
          {tab.isDirty && <span className="tab-dirty">●</span>}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.path);
            }}
            title="Close tab"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
