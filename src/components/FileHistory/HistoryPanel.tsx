import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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

export function HistoryPanel({ filePath, onRestore, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

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

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <span>File History</span>
        <button className="history-close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="history-panel-body">
        {loading && <div className="history-empty">Loading…</div>}
        {!loading && snapshots.length === 0 && (
          <div className="history-empty">No snapshots yet.<br />Press Cmd+S to save one.</div>
        )}
        {snapshots.map((s) => (
          <button
            key={s.path}
            className="history-entry"
            disabled={restoring === s.path}
            onClick={() => handleRestore(s)}
          >
            {formatTimestamp(s.timestamp)}
          </button>
        ))}
      </div>
    </div>
  );
}
