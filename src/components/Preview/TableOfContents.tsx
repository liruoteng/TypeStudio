import { useMemo } from "react";
import { useEditorStore } from "../../stores/editorStore";
import "./TableOfContents.css";

interface TocEntry {
  level: number;
  title: string;
  line: number;
}

function parseHeadings(content: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(=+)\s+(.+)/);
    if (m) {
      entries.push({ level: m[1].length, title: m[2].trim(), line: i + 1 });
    }
  }
  return entries;
}

export function TableOfContents() {
  const activeTab     = useEditorStore((s) => s.activeTab());
  const setScrollToLine = useEditorStore((s) => s.setScrollToLine);

  const entries = useMemo(
    () => (activeTab ? parseHeadings(activeTab.content) : []),
    [activeTab?.content] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!activeTab || !activeTab.path.endsWith(".typ")) {
    return (
      <div className="toc-panel toc-empty">
        <p>No .typ file open</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="toc-panel toc-empty">
        <p>No headings found</p>
        <p className="toc-hint">Add headings with <code>= Title</code></p>
      </div>
    );
  }

  return (
    <div className="toc-panel">
      {entries.map((entry, i) => (
        <button
          key={i}
          className="toc-entry"
          style={{ paddingLeft: `${(entry.level - 1) * 14 + 12}px` }}
          onClick={() => setScrollToLine(entry.line)}
          title={`Line ${entry.line}`}
        >
          <span className="toc-level">{"=".repeat(entry.level)}</span>
          <span className="toc-title">{entry.title}</span>
        </button>
      ))}
    </div>
  );
}
