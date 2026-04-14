import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore, FileEntry } from "../../stores/editorStore";
import "./FileTree.css";

function FileIcon({ name, isDir }: { name: string; isDir: boolean }) {
  if (isDir) return <span className="file-icon dir-icon">▶</span>;
  if (name.endsWith(".typ")) return <span className="file-icon typst-icon">T</span>;
  if (name.endsWith(".bib")) return <span className="file-icon bib-icon">B</span>;
  if (name.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i))
    return <span className="file-icon img-icon">🖼</span>;
  return <span className="file-icon generic-icon">·</span>;
}

interface DirNodeProps {
  path: string;
  name: string;
  depth: number;
}

function DirNode({ path, name, depth }: DirNodeProps) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await invoke<FileEntry[]>("list_dir", { path });
      setChildren(entries);
    } catch (e) {
      console.error("list_dir error", e);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <div className="dir-node">
      <div
        className="tree-row dir-row"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`dir-arrow ${open ? "open" : ""}`}>▶</span>
        <span className="tree-label">{name}</span>
        {loading && <span className="loading-dot">…</span>}
      </div>
      {open && (
        <div className="dir-children">
          {children.map((entry) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
              />
            ) : (
              <FileNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function FileNode({ path, name, depth }: { path: string; name: string; depth: number }) {
  const openTab = useEditorStore((s) => s.openTab);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);

  const handleClick = async () => {
    try {
      const content = await invoke<string>("read_file", { path });
      openTab(path, name, content);
    } catch (e) {
      console.error("read_file error", e);
    }
  };

  return (
    <div
      className={`tree-row file-row ${activeTabPath === path ? "active" : ""}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={handleClick}
    >
      <FileIcon name={name} isDir={false} />
      <span className="tree-label">{name}</span>
    </div>
  );
}

export function FileTree() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const setWorkspacePath = useEditorStore((s) => s.setWorkspacePath);

  const handleOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setWorkspacePath(selected);
      }
    } catch (e) {
      console.error("open dialog error", e);
    }
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title">EXPLORER</span>
        <button className="open-folder-btn" onClick={handleOpenFolder} title="Open Folder">
          📂
        </button>
      </div>
      <div className="file-tree-body">
        {workspacePath ? (
          <DirNode
            path={workspacePath}
            name={workspacePath.split("/").pop() ?? workspacePath}
            depth={0}
          />
        ) : (
          <div className="file-tree-empty">
            <p>No folder opened</p>
            <button className="open-folder-text-btn" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
