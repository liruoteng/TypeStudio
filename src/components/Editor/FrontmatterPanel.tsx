import { useState } from "react";
import { parseFrontmatterRows, updateFrontmatterValue } from "./frontmatterUtil";

interface FrontmatterPanelProps {
  raw: string;
  onChange: (raw: string) => void;
}

export function FrontmatterPanel({ raw, onChange }: FrontmatterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const rows = parseFrontmatterRows(raw);
  if (rows.length === 0) return null;

  const updateValue = (key: string, value: string) => {
    onChange(updateFrontmatterValue(raw, key, value));
  };

  const addProperty = () => {
    const key = window.prompt("Property name");
    if (!key?.trim()) return;

    const value = window.prompt("Property value", "");
    if (value === null) return;

    onChange(updateFrontmatterValue(raw, key, value));
  };

  return (
    <div className="frontmatter-panel">
      <div className="frontmatter-header">
        <button
          type="button"
          className="frontmatter-header-button"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="frontmatter-toggle">{expanded ? "▼" : "▶"}</span>
          <span className="frontmatter-label">Properties</span>
        </button>
        {expanded && (
          <button type="button" className="frontmatter-add" onClick={addProperty}>
            Add
          </button>
        )}
      </div>
      {expanded && (
        <div className="frontmatter-body">
          {rows.map((r) => (
            <div key={r.key} className="frontmatter-row">
              <span className="frontmatter-key">{r.key}</span>
              <input
                className="frontmatter-value-input"
                defaultValue={r.value}
                onBlur={(event) => updateValue(r.key, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
