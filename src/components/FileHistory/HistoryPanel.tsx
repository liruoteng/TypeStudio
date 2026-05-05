import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as Diff from "diff";
import "./HistoryPanel.css";

interface SnapshotEntry {
  timestamp: number;
  path: string;
}

interface HistoryPanelProps {
  filePath: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

function formatTimestamp(secs: number): string {
  return new Date(secs * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Diff view ─────────────────────────────────────────────────────────────────

function DiffView({ contentA, contentB }: { contentA: string; contentB: string }) {
  const parts = Diff.diffLines(contentA, contentB);
  return (
    <div className="history-diff">
      {parts.map((part, i) => {
        const cls = part.added ? "diff-added" : part.removed ? "diff-removed" : "diff-unchanged";
        const prefix = part.added ? "+" : part.removed ? "-" : " ";
        return (
          <div key={i} className={`diff-block ${cls}`}>
            {part.value.split("\n").filter((_, j, arr) => j < arr.length - 1 || part.value.endsWith("\n") || j === 0).map((line, j) => (
              <div key={j} className="diff-line">
                <span className="diff-prefix">{prefix}</span>
                <span className="diff-text">{line}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function HistoryPanel({ filePath, onRestore, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [diffContents, setDiffContents] = useState<[string, string] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    invoke<SnapshotEntry[]>("list_snapshots", { path: filePath })
      .then(setSnapshots)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filePath]);

  const handleRestore = useCallback(async (entry: SnapshotEntry) => {
    setRestoring(entry.path);
    try {
      const content = await invoke<string>("read_file", { path: entry.path });
      onRestore(content);
      onClose();
    } catch (e) {
      console.error("restore error", e);
    } finally {
      setRestoring(null);
    }
  }, [onRestore, onClose]);

  const toggleSelect = useCallback((path: string) => {
    setSelected((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      if (prev.length >= 2) return [prev[1], path];
      return [...prev, path];
    });
    setDiffContents(null);
  }, []);

  const handleCompare = useCallback(async () => {
    if (selected.length !== 2) return;
    setDiffLoading(true);
    try {
      const [a, b] = await Promise.all([
        invoke<string>("read_file", { path: selected[0] }),
        invoke<string>("read_file", { path: selected[1] }),
      ]);
      setDiffContents([a, b]);
    } catch (e) {
      console.error("diff error", e);
    } finally {
      setDiffLoading(false);
    }
  }, [selected]);

  const exitCompare = useCallback(() => {
    setCompareMode(false);
    setSelected([]);
    setDiffContents(null);
  }, []);

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <span>File History</span>
        <div className="history-header-actions">
          {compareMode ? (
            <>
              {selected.length === 2 && (
                <button
                  className="history-compare-btn history-compare-btn--active"
                  onClick={handleCompare}
                  disabled={diffLoading}
                >
                  {diffLoading ? "…" : "Diff"}
                </button>
              )}
              <button className="history-compare-btn" onClick={exitCompare}>Cancel</button>
            </>
          ) : (
            <button className="history-compare-btn" onClick={() => setCompareMode(true)} disabled={snapshots.length < 2}>
              Compare
            </button>
          )}
          <button className="history-close-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      {compareMode && !diffContents && (
        <div className="history-compare-hint">
          Select two versions to compare ({selected.length}/2 selected)
        </div>
      )}

      {diffContents && (
        <div className="history-diff-wrapper">
          <div className="history-diff-header">
            <span>Diff: older → newer</span>
            <button className="history-compare-btn" onClick={() => setDiffContents(null)}>Close diff</button>
          </div>
          <DiffView contentA={diffContents[0]} contentB={diffContents[1]} />
        </div>
      )}

      <div className="history-panel-body">
        {loading && <div className="history-empty">Loading…</div>}
        {!loading && snapshots.length === 0 && (
          <div className="history-empty">No snapshots yet.<br />Press Cmd+S to save one.</div>
        )}
        {snapshots.map((s) => {
          const isSelected = selected.includes(s.path);
          return (
            <div key={s.path} className={`history-entry-row${isSelected ? " history-entry-row--selected" : ""}`}>
              {compareMode && (
                <input
                  type="checkbox"
                  className="history-entry-check"
                  checked={isSelected}
                  onChange={() => toggleSelect(s.path)}
                />
              )}
              <button
                className="history-entry"
                disabled={!compareMode && restoring === s.path}
                onClick={() => compareMode ? toggleSelect(s.path) : handleRestore(s)}
              >
                {formatTimestamp(s.timestamp)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
