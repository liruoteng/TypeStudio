import { useState, useEffect, useCallback, useRef } from "react";
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState<null | "file" | "folder">(null);
  const [newItemName, setNewItemName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const startCreating = (type: "file" | "folder") => {
    setCreating(type);
    setNewItemName("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  const handleCreateConfirm = async () => {
    const name = newItemName.trim();
    if (!name || !workspacePath) {
      setCreating(null);
      return;
    }
    const sep = workspacePath.endsWith("/") ? "" : "/";
    const fullPath = `${workspacePath}${sep}${name}`;
    try {
      if (creating === "file") {
        await invoke("create_file", { path: fullPath });
      } else {
        await invoke("create_dir", { path: fullPath });
      }
    } catch (e) {
      console.error("create error", e);
    }
    setCreating(null);
    setNewItemName("");
    setRefreshKey((k) => k + 1);
  };

  const handleCreateCancel = () => {
    setCreating(null);
    setNewItemName("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreateConfirm();
    if (e.key === "Escape") handleCreateCancel();
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title">EXPLORER</span>
        <div className="file-tree-actions">
          {workspacePath && (
            <>
              <button
                className="tree-action-btn"
                onClick={() => startCreating("file")}
                title="New File"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M9.5 1.1l3.4 3.5.1.4v2h-1V5H9V2H3v12h4v1H2.5l-.5-.5v-13l.5-.5h6.7l.3.1zM10 2v2h1.9L10 2zm4 9h-2V9h-1v2H9v1h2v2h1v-2h2v-1z"/>
                </svg>
              </button>
              <button
                className="tree-action-btn"
                onClick={() => startCreating("folder")}
                title="New Folder"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.5 9H2V3.5h4.29l.85.85.36.15H14V12zm-4-4H8V6H7v2H5v1h2v2h1V9h2V8z"/>
                </svg>
              </button>
              <button
                className="tree-action-btn"
                onClick={handleRefresh}
                title="Refresh"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/>
                </svg>
              </button>
            </>
          )}
          <button className="tree-action-btn" onClick={handleOpenFolder} title="Open Folder">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.5 9H2V3.5h4.29l.85.85.36.15H14V12z"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="file-tree-body">
        {creating && workspacePath && (
          <div className="new-item-row">
            <FileIcon name={creating === "folder" ? "/" : newItemName || "file"} isDir={creating === "folder"} />
            <input
              ref={inputRef}
              className="new-item-input"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onBlur={handleCreateCancel}
              placeholder={creating === "file" ? "filename.typ" : "folder name"}
            />
          </div>
        )}
        {workspacePath ? (
          <DirNode
            key={refreshKey}
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
