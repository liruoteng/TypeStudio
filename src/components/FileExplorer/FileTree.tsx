import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore, FileEntry } from "../../stores/editorStore";
import { ContextMenu, type ContextMenuItem } from "../Layout/ContextMenu";
import "./FileTree.css";

function FileIcon({ name, isDir }: { name: string; isDir: boolean }) {
  if (isDir) return <span className="file-icon dir-icon">▶</span>;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "typ") return <span className="file-icon typst-icon">T</span>;
  if (ext === "bib") return <span className="file-icon bib-icon">B</span>;
  if (ext === "pdf") return <span className="file-icon pdf-icon">P</span>;
  if (["md", "mdx", "markdown"].includes(ext)) return <span className="file-icon md-icon">M</span>;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "avif"].includes(ext)) return <span className="file-icon img-icon">⬛</span>;
  if (["js", "mjs", "cjs"].includes(ext)) return <span className="file-icon js-icon">JS</span>;
  if (["ts", "mts", "cts"].includes(ext)) return <span className="file-icon ts-icon">TS</span>;
  if (["jsx", "tsx"].includes(ext)) return <span className="file-icon jsx-icon">⚛</span>;
  if (ext === "rs") return <span className="file-icon rs-icon">Rs</span>;
  if (ext === "py") return <span className="file-icon py-icon">Py</span>;
  if (["json", "jsonc"].includes(ext)) return <span className="file-icon json-icon">{"{}"}</span>;
  if (["yaml", "yml"].includes(ext)) return <span className="file-icon yaml-icon">Y</span>;
  if (["toml", "ini"].includes(ext)) return <span className="file-icon toml-icon">⚙</span>;
  if (["html", "htm"].includes(ext)) return <span className="file-icon html-icon">H</span>;
  if (["css", "scss", "less"].includes(ext)) return <span className="file-icon css-icon">#</span>;
  if (["sh", "bash", "zsh"].includes(ext)) return <span className="file-icon sh-icon">$</span>;
  if (ext === "sql") return <span className="file-icon sql-icon">db</span>;
  if (["go"].includes(ext)) return <span className="file-icon go-icon">Go</span>;
  if (ext === "java") return <span className="file-icon java-icon">Jv</span>;
  if (["c", "h"].includes(ext)) return <span className="file-icon c-icon">C</span>;
  if (["cpp", "hpp", "cc"].includes(ext)) return <span className="file-icon cpp-icon">C+</span>;
  if (ext === "lua") return <span className="file-icon lua-icon">Lu</span>;
  if (ext === "rb") return <span className="file-icon rb-icon">Rb</span>;
  if (ext === "swift") return <span className="file-icon swift-icon">Sw</span>;
  if (ext === "kt") return <span className="file-icon kt-icon">Kt</span>;
  if (ext === "php") return <span className="file-icon php-icon">Ph</span>;
  if (ext === "r") return <span className="file-icon r-icon">R</span>;
  if (ext === "cs") return <span className="file-icon cs-icon">C#</span>;
  if (ext === "xml") return <span className="file-icon xml-icon">X</span>;
  if (ext === "txt") return <span className="file-icon txt-icon">≡</span>;
  if (["zip", "tar", "gz", "bz2", "7z", "rar"].includes(ext)) return <span className="file-icon zip-icon">⊞</span>;
  return <span className="file-icon generic-icon">·</span>;
}

interface PendingCreate {
  type: "file" | "folder";
  targetDir: string;
  name: string;
  onChangeName: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

interface DirNodeProps {
  path: string;
  name: string;
  depth: number;
  onRefreshParent?: () => void;
  onSelectDir?: (path: string) => void;
  selectedDirPath?: string | null;
  pendingCreate?: PendingCreate | null;
  refreshTarget?: { path: string; n: number } | null;
}

function DirNode({ path, name, depth, onRefreshParent, onSelectDir, selectedDirPath, pendingCreate, refreshTarget }: DirNodeProps) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingTo, setRenamingTo] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
  }, [open, load, refreshKey]);

  useEffect(() => {
    if (pendingCreate?.targetDir === path) setOpen(true);
  }, [pendingCreate, path]);

  useEffect(() => {
    if (refreshTarget?.path === path && open) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTarget?.path, refreshTarget?.n]);

  const startRename = useCallback(() => {
    setRenamingTo(name);
    setTimeout(() => {
      renameInputRef.current?.select();
    }, 0);
  }, [name]);

  const confirmRename = useCallback(async () => {
    const newName = renamingTo?.trim();
    if (!newName || newName === name) { setRenamingTo(null); return; }
    const parent = path.substring(0, path.lastIndexOf("/"));
    const newPath = `${parent}/${newName}`;
    try {
      await invoke("rename_path", { oldPath: path, newPath });
      onRefreshParent?.();
    } catch (e) {
      console.error("rename error", e);
    }
    setRenamingTo(null);
  }, [renamingTo, name, path, onRefreshParent]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete folder "${name}" and all its contents?`)) return;
    try {
      await invoke("delete_path", { path });
      onRefreshParent?.();
    } catch (e) {
      console.error("delete error", e);
    }
  }, [name, path, onRefreshParent]);

  const ctxItems: ContextMenuItem[] = [
    {
      label: "New File",
      action: () => { /* trigger creating file inside this dir — handled by parent */ },
    },
    { separator: true },
    { label: "Rename", action: startRename },
    { label: "Delete Folder", action: handleDelete },
    { separator: true },
    {
      label: "Reveal in Finder",
      action: () => invoke("reveal_in_finder", { path }).catch(console.error),
    },
  ];

  return (
    <div className="dir-node">
      {renamingTo !== null ? (
        <div
          className="tree-row dir-row"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="dir-arrow">▶</span>
          <input
            ref={renameInputRef}
            className="new-item-input"
            value={renamingTo}
            onChange={(e) => setRenamingTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
              if (e.key === "Escape") setRenamingTo(null);
            }}
            onBlur={() => setRenamingTo(null)}
            autoFocus
          />
        </div>
      ) : (
        <div
          className={`tree-row dir-row${selectedDirPath === path ? " active" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => { setOpen((o) => !o); onSelectDir?.(path); }}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        >
          <span className={`dir-arrow ${open ? "open" : ""}`}>▶</span>
          <span className="tree-label">{name}</span>
          {loading && <span className="loading-dot">…</span>}
        </div>
      )}
      {open && (
        <div className="dir-children">
          {children.map((entry) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onRefreshParent={() => setRefreshKey((k) => k + 1)}
                onSelectDir={onSelectDir}
                selectedDirPath={selectedDirPath}
                pendingCreate={pendingCreate}
                refreshTarget={refreshTarget}
              />
            ) : (
              <FileNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onRefreshParent={() => setRefreshKey((k) => k + 1)}
              />
            )
          )}
          {pendingCreate?.targetDir === path && (
            <InlineCreateInput pendingCreate={pendingCreate} depth={depth + 1} />
          )}
        </div>
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

interface FileNodeProps {
  path: string;
  name: string;
  depth: number;
  onRefreshParent?: () => void;
}

function mdHiddenTypPath(mdPath: string): string {
  const lastSlash = mdPath.lastIndexOf("/");
  const dir = mdPath.slice(0, lastSlash + 1);
  const basename = mdPath.slice(lastSlash + 1);
  const noExt = basename.includes(".") ? basename.slice(0, basename.lastIndexOf(".")) : basename;
  return `${dir}.${noExt}.typ`;
}

function FileNode({ path, name, depth, onRefreshParent }: FileNodeProps) {
  const openTab = useEditorStore((s) => s.openTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingTo, setRenamingTo] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const openFile = useCallback(async () => {
    if (path.endsWith(".pdf")) {
      try {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(path);
      } catch (e) {
        console.error("openPath error:", e);
        alert(`Failed to open PDF: ${e}`);
      }
      return;
    }
    try {
      const content = await invoke<string>("read_file", { path });
      if (path.endsWith(".md") || path.endsWith(".markdown")) {
        const typstContent = await invoke<string>("convert_to_typst", { path });
        await invoke("write_file", { path: mdHiddenTypPath(path), contents: typstContent });
      }
      openTab(path, name, content);
    } catch (e) {
      console.error("read_file error", e);
    }
  }, [path, name, openTab]);

  const startRename = useCallback(() => {
    setRenamingTo(name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [name]);

  const confirmRename = useCallback(async () => {
    const newName = renamingTo?.trim();
    if (!newName || newName === name) { setRenamingTo(null); return; }
    const parent = path.substring(0, path.lastIndexOf("/"));
    const newPath = `${parent}/${newName}`;
    try {
      await invoke("rename_path", { oldPath: path, newPath });
      // Close the old tab if it was open; user can reopen the renamed file
      closeTab(path);
      onRefreshParent?.();
    } catch (e) {
      console.error("rename error", e);
    }
    setRenamingTo(null);
  }, [renamingTo, name, path, closeTab, onRefreshParent]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await invoke("delete_path", { path });
      closeTab(path);
      onRefreshParent?.();
    } catch (e) {
      console.error("delete error", e);
    }
  }, [name, path, closeTab, onRefreshParent]);

  const ctxItems: ContextMenuItem[] = [
    { label: "Open", action: openFile },
    { separator: true },
    { label: "Rename", action: startRename },
    { label: "Delete", action: handleDelete },
    { separator: true },
    {
      label: "Reveal in Finder",
      action: () => invoke("reveal_in_finder", { path }).catch(console.error),
    },
    {
      label: "Copy Path",
      action: () => navigator.clipboard.writeText(path),
    },
  ];

  if (renamingTo !== null) {
    return (
      <div
        className={`tree-row file-row ${activeTabPath === path ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <FileIcon name={renamingTo || name} isDir={false} />
        <input
          ref={renameInputRef}
          className="new-item-input"
          value={renamingTo}
          onChange={(e) => setRenamingTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmRename();
            if (e.key === "Escape") setRenamingTo(null);
          }}
          onBlur={() => setRenamingTo(null)}
          autoFocus
        />
      </div>
    );
  }

  return (
    <>
      <div
        className={`tree-row file-row ${activeTabPath === path ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={openFile}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <FileIcon name={name} isDir={false} />
        <span className="tree-label">{name}</span>
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

function InlineCreateInput({ pendingCreate, depth }: { pendingCreate: PendingCreate; depth: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="new-item-row" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
      <FileIcon name={pendingCreate.type === "folder" ? "/" : pendingCreate.name || "file"} isDir={pendingCreate.type === "folder"} />
      <input
        ref={inputRef}
        className="new-item-input"
        value={pendingCreate.name}
        onChange={(e) => pendingCreate.onChangeName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") pendingCreate.onConfirm();
          if (e.key === "Escape") pendingCreate.onCancel();
        }}
        onBlur={pendingCreate.onCancel}
        placeholder={pendingCreate.type === "file" ? "filename.typ" : "folder name"}
      />
    </div>
  );
}

export function FileTree() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const setWorkspacePath = useEditorStore((s) => s.setWorkspacePath);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshTarget, setRefreshTarget] = useState<{ path: string; n: number } | null>(null);
  const [creating, setCreating] = useState<null | { type: "file" | "folder"; name: string }>(null);
  const [selectedDirPath, setSelectedDirPath] = useState<string | null>(null);

  // Auto-sync: watch workspace for external file system changes
  useEffect(() => {
    if (!workspacePath) return;
    let stopFn: (() => void) | null = null;
    import("@tauri-apps/plugin-fs").then(({ watch }) => {
      watch(
        workspacePath,
        () => setRefreshKey((k) => k + 1),
        { recursive: true }
      ).then((stop) => { stopFn = stop; });
    });
    return () => { stopFn?.(); };
  }, [workspacePath]);

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
    setCreating({ type, name: "" });
  };

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  const handleCreateConfirm = async () => {
    const name = creating?.name.trim();
    if (!name || !workspacePath) { setCreating(null); return; }
    const targetDir = selectedDirPath ?? workspacePath;
    const sep = targetDir.endsWith("/") ? "" : "/";
    const fullPath = `${targetDir}${sep}${name}`;
    try {
      if (creating!.type === "file") {
        await invoke("create_file", { path: fullPath });
      } else {
        await invoke("create_dir", { path: fullPath });
      }
    } catch (e) {
      console.error("create error", e);
    }
    setCreating(null);
    setRefreshTarget((prev) => ({ path: targetDir, n: (prev?.n ?? 0) + 1 }));
  };

  const handleCreateCancel = () => setCreating(null);

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
        {workspacePath ? (
          <DirNode
            key={refreshKey}
            path={workspacePath}
            name={workspacePath.split("/").pop() ?? workspacePath}
            depth={0}
            onSelectDir={setSelectedDirPath}
            selectedDirPath={selectedDirPath}
            refreshTarget={refreshTarget}
            pendingCreate={creating ? {
              type: creating.type,
              targetDir: selectedDirPath ?? workspacePath,
              name: creating.name,
              onChangeName: (n) => setCreating((c) => c ? { ...c, name: n } : null),
              onConfirm: handleCreateConfirm,
              onCancel: handleCreateCancel,
            } : null}
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
