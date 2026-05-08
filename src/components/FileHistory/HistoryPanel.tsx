import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import * as Diff from "diff";
import "./HistoryPanel.css";

const CURRENT_PATH = "__current__";

interface SnapshotEntry {
  timestamp: number;
  path: string;
}

interface HistoryPanelProps {
  filePath: string;
  currentContent: string;
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

function DiffView({ contentA, contentB, labelA, labelB }: {
  contentA: string;
  contentB: string;
  labelA: string;
  labelB: string;
}) {
  const parts = Diff.diffLines(contentA, contentB);
  const hasChanges = parts.some((p) => p.added || p.removed);
  return (
    <div className="history-diff">
      <div className="diff-legend">
        <span className="diff-legend-removed">− {labelA}</span>
        <span className="diff-legend-added">+ {labelB}</span>
      </div>
      {!hasChanges && (
        <div className="diff-no-changes">No differences</div>
      )}
      {parts.map((part, i) => {
        const cls = part.added ? "diff-added" : part.removed ? "diff-removed" : "diff-unchanged";
        const prefix = part.added ? "+" : part.removed ? "-" : " ";
        const lines = part.value.split("\n");
        // trim trailing empty line added by split when value ends with \n
        if (lines[lines.length - 1] === "") lines.pop();
        return (
          <div key={i} className={`diff-block ${cls}`}>
            {lines.map((line, j) => (
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

export function HistoryPanel({ filePath, currentContent, onRestore, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Preview state
  const [previewEntry, setPreviewEntry] = useState<SnapshotEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // "content" | "diff"
  const [previewTab, setPreviewTab] = useState<"content" | "diff">("content");

  // Compare-two-snapshots mode
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [diffResult, setDiffResult] = useState<{ a: string; b: string; labelA: string; labelB: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    invoke<SnapshotEntry[]>("list_snapshots", { path: filePath })
      .then(setSnapshots)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filePath]);

  // ── Resolve a list-path to its content ──────────────────────────────────────
  const resolveContent = useCallback(async (path: string): Promise<string> => {
    if (path === CURRENT_PATH) return currentContent;
    return invoke<string>("read_file", { path });
  }, [currentContent]);

  // ── Select a snapshot to preview ────────────────────────────────────────────
  const handleSelect = useCallback(async (entry: SnapshotEntry) => {
    if (previewEntry?.path === entry.path) {
      setPreviewEntry(null);
      setPreviewContent(null);
      return;
    }
    setPreviewEntry(entry);
    setPreviewContent(null);
    setPreviewTab("content");
    setPreviewLoading(true);
    try {
      const content = await resolveContent(entry.path);
      setPreviewContent(content);
    } catch (e) {
      console.error("preview load error", e);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewEntry, resolveContent]);

  const handleRestore = useCallback(() => {
    if (previewContent === null || previewEntry?.path === CURRENT_PATH) return;
    onRestore(previewContent);
    onClose();
  }, [previewContent, previewEntry, onRestore, onClose]);

  // ── Compare-mode two-snapshot diff ──────────────────────────────────────────
  const toggleSelect = useCallback((path: string) => {
    setSelected((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      if (prev.length >= 2) return [prev[1], path];
      return [...prev, path];
    });
    setDiffResult(null);
  }, []);

  const labelFor = useCallback((path: string, snaps: SnapshotEntry[]): string => {
    if (path === CURRENT_PATH) return "Current";
    const snap = snaps.find((s) => s.path === path);
    return snap ? formatTimestamp(snap.timestamp) : path.split("/").pop() ?? path;
  }, []);

  const handleCompare = useCallback(async () => {
    if (selected.length !== 2) return;
    setDiffLoading(true);
    try {
      const [a, b] = await Promise.all([
        resolveContent(selected[0]),
        resolveContent(selected[1]),
      ]);
      setDiffResult({
        a, b,
        labelA: labelFor(selected[0], snapshots),
        labelB: labelFor(selected[1], snapshots),
      });
    } catch (e) {
      console.error("diff error", e);
    } finally {
      setDiffLoading(false);
    }
  }, [selected, resolveContent, labelFor, snapshots]);

  const exitCompare = useCallback(() => {
    setCompareMode(false);
    setSelected([]);
    setDiffResult(null);
  }, []);

  // ── Current-entry synthetic snapshot ────────────────────────────────────────
  const currentEntry: SnapshotEntry = { timestamp: Date.now() / 1000, path: CURRENT_PATH };

  return (
    <div className="history-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="history-panel">

        {/* Header */}
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
              <button className="history-compare-btn" onClick={() => setCompareMode(true)} disabled={snapshots.length === 0}>
                Compare
              </button>
            )}
            <button className="history-close-btn" onClick={onClose}><X size={12} /></button>
          </div>
        </div>

        {compareMode && !diffResult && (
          <div className="history-compare-hint">
            Select two versions to compare ({selected.length}/2 selected)
          </div>
        )}

        {/* Compare diff result */}
        {diffResult && (
          <div className="history-diff-wrapper">
            <div className="history-diff-header">
              <span>Diff: <strong>{diffResult.labelA}</strong> → <strong>{diffResult.labelB}</strong></span>
              <button className="history-compare-btn" onClick={() => setDiffResult(null)}>Close</button>
            </div>
            <DiffView contentA={diffResult.a} contentB={diffResult.b} labelA={diffResult.labelA} labelB={diffResult.labelB} />
          </div>
        )}

        {/* Two-column body */}
        <div className="history-panel-columns">

          {/* Version list */}
          <div className="history-panel-list">
            {/* Pinned current version */}
            {(() => {
              const isCurSelected = compareMode ? selected.includes(CURRENT_PATH) : previewEntry?.path === CURRENT_PATH;
              return (
                <div className={`history-entry-row history-entry-row--current${isCurSelected ? " history-entry-row--selected" : ""}`}>
                  {compareMode && (
                    <input
                      type="checkbox"
                      className="history-entry-check"
                      checked={isCurSelected}
                      onChange={() => toggleSelect(CURRENT_PATH)}
                    />
                  )}
                  <button
                    className="history-entry"
                    onClick={() => compareMode ? toggleSelect(CURRENT_PATH) : handleSelect(currentEntry)}
                  >
                    Current version
                  </button>
                </div>
              );
            })()}

            <div className="history-list-divider" />

            {loading && <div className="history-empty">Loading…</div>}
            {!loading && snapshots.length === 0 && (
              <div className="history-empty">No snapshots yet.<br />Press Cmd+S to save one.</div>
            )}
            {snapshots.map((s) => {
              const isSelected = compareMode ? selected.includes(s.path) : previewEntry?.path === s.path;
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
                    onClick={() => compareMode ? toggleSelect(s.path) : handleSelect(s)}
                  >
                    {formatTimestamp(s.timestamp)}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Preview pane */}
          <div className="history-preview-pane">
            {previewEntry ? (
              <>
                <div className="history-preview-header">
                  <div className="history-preview-tabs">
                    <button
                      className={`history-preview-tab${previewTab === "content" ? " history-preview-tab--active" : ""}`}
                      onClick={() => setPreviewTab("content")}
                    >
                      Content
                    </button>
                    {previewEntry.path !== CURRENT_PATH && (
                      <button
                        className={`history-preview-tab${previewTab === "diff" ? " history-preview-tab--active" : ""}`}
                        onClick={() => setPreviewTab("diff")}
                      >
                        Diff with current
                      </button>
                    )}
                  </div>
                  {previewEntry.path !== CURRENT_PATH && (
                    <button
                      className="history-compare-btn history-compare-btn--active"
                      onClick={handleRestore}
                      disabled={previewContent === null}
                    >
                      Restore this version
                    </button>
                  )}
                </div>

                <div className="history-preview-body">
                  {previewLoading && <div className="history-empty">Loading…</div>}
                  {!previewLoading && previewContent !== null && previewTab === "content" && (
                    <pre className="history-preview-text">{previewContent}</pre>
                  )}
                  {!previewLoading && previewContent !== null && previewTab === "diff" && (
                    <DiffView
                      contentA={previewContent}
                      contentB={currentContent}
                      labelA={formatTimestamp(previewEntry.timestamp)}
                      labelB="Current"
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="history-preview-empty">
                Select a version from the list to preview it
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
