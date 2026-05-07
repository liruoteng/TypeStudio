import { useState } from "react";
import { parseFrontmatterRows } from "./frontmatterUtil";

interface FrontmatterPanelProps {
  raw: string;
}

export function FrontmatterPanel({ raw }: FrontmatterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const rows = parseFrontmatterRows(raw);
  if (rows.length === 0) return null;

  return (
    <div className="frontmatter-panel">
      <div className="frontmatter-header" onClick={() => setExpanded((v) => !v)}>
        <span className="frontmatter-toggle">{expanded ? "▼" : "▶"}</span>
        <span className="frontmatter-label">Properties</span>
      </div>
      {expanded && (
        <div className="frontmatter-body">
          {rows.map((r) => (
            <div key={r.key} className="frontmatter-row">
              <span className="frontmatter-key">{r.key}</span>
              <span className="frontmatter-value">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
