import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore, FileEntry } from "../../stores/editorStore";
import { ContextMenu, type ContextMenuItem } from "../Layout/ContextMenu";
import "./FileTree.css";

export interface FileTreeHandle {
  newFile: () => void;
  newFolder: () => void;
  refresh: () => void;
}

const DRAG_MIME = "application/x-type-studio-path";

// WebKit hides custom MIME types from `dataTransfer.types` during dragover/drop,
// so we track the active in-explorer drag source here instead.
let activeDragSource: string | null = null;

function setCustomDragImage(e: React.DragEvent, label: string, isDir: boolean) {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.innerHTML = `<span class="drag-ghost-icon">${isDir ? "▶" : "·"}</span><span>${label}</span>`;
  document.body.appendChild(ghost);
  if (typeof e.dataTransfer.setDragImage === "function") {
    e.dataTransfer.setDragImage(ghost, 12, 12);
  }
  setTimeout(() => ghost.remove(), 0);
}

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

function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** Prevent moving a folder into itself or any of its descendants. */
function isSelfOrDescendant(source: string, target: string): boolean {
  if (source === target) return true;
  return target.startsWith(source + "/");
}

interface DirNodeProps {
  path: string;
  name: string;
  depth: number;
  onRefreshParent?: () => void;
  onSelectDir?: (path: string) => void;
  onClearDirSelection?: () => void;
  selectedDirPath?: string | null;
  pendingCreate?: PendingCreate | null;
  refreshVersions: Record<string, number>;
  onRequestMove: (src: string, destDir: string) => void;
  onOsDrop: (files: FileList, destDir: string) => void;
  expandPath?: string | null;
  highlightPath?: string | null;
}

function DirNode({ path, name, depth, onRefreshParent, onSelectDir, onClearDirSelection, selectedDirPath, pendingCreate, refreshVersions, onRequestMove, onOsDrop, expandPath, highlightPath }: DirNodeProps) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingTo, setRenamingTo] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
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
    if (expandPath === path) setOpen(true);
  }, [expandPath, path]);

  const myVersion = refreshVersions[path] ?? 0;
  useEffect(() => {
    if (myVersion > 0 && open) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myVersion]);

  const startRename = useCallback(() => {
    setRenamingTo(name);
    setTimeout(() => {
      renameInputRef.current?.select();
    }, 0);
  }, [name]);

  const confirmRename = useCallback(async () => {
    const newName = renamingTo?.trim();
    if (!newName || newName === name) { setRenamingTo(null); return; }
    const newPath = joinPath(parentOf(path), newName);
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
    { label: "Rename", action: startRename },
    { label: "Delete Folder", action: handleDelete },
    { separator: true },
    {
      label: "Reveal in Finder",
      action: () => invoke("reveal_in_finder", { path }).catch(console.error),
    },
  ];

  const onDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData(DRAG_MIME, path);
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = "move";
    setCustomDragImage(e, name, true);
    activeDragSource = path;
  };

  const onDragEnd = () => { activeDragSource = null; };

  const onDragOver = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes("Files");
    if (!activeDragSource && !hasFiles) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = activeDragSource ? "move" : "copy";
    if (!dropHover) setDropHover(true);
  };

  const onDragLeave = () => setDropHover(false);

  const onDrop = (e: React.DragEvent) => {
    setDropHover(false);
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onOsDrop(e.dataTransfer.files, path);
      return;
    }
    const src = activeDragSource ?? e.dataTransfer.getData(DRAG_MIME);
    if (!src) return;
    activeDragSource = null;
    onRequestMove(src, path);
  };

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
          className={`tree-row dir-row${selectedDirPath === path ? " active" : ""}${dropHover ? " drop-target" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          data-dir-path={path}
          draggable={depth > 0}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); onSelectDir?.(path); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        >
          <span className={`dir-arrow ${open ? "open" : ""}`}>▶</span>
          <span className="tree-label">{name}</span>
          {loading && <span className="loading-dot">…</span>}
        </div>
      )}
      {open && (
        <div
          className="dir-children"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
            {pendingCreate?.targetDir === path && (
            <InlineCreateInput pendingCreate={pendingCreate} depth={depth + 1} />
          )}
          {children.map((entry) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onRefreshParent={() => setRefreshKey((k) => k + 1)}
                onSelectDir={onSelectDir}
                onClearDirSelection={onClearDirSelection}
                selectedDirPath={selectedDirPath}
                pendingCreate={pendingCreate}
                refreshVersions={refreshVersions}
                onRequestMove={onRequestMove}
                onOsDrop={onOsDrop}
                expandPath={expandPath}
                highlightPath={highlightPath}
              />
            ) : (
              <FileNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onRefreshParent={() => setRefreshKey((k) => k + 1)}
                highlighted={highlightPath === entry.path}
                onClearDirSelection={onClearDirSelection}
              />
            )
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
  highlighted?: boolean;
  onClearDirSelection?: () => void;
}

function FileNode({ path, name, depth, onRefreshParent, highlighted, onClearDirSelection }: FileNodeProps) {
  const openTab = useEditorStore((s) => s.openTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingTo, setRenamingTo] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const openFile = useCallback(async () => {
    if (path.endsWith(".pdf")) {
      const store = useEditorStore.getState();
      store.setActivePdfPath(path);
      if (!store.activePanels.includes("pdf")) {
        store.setActivePanels([...store.activePanels, "pdf"]);
      }
      return;
    }
    try {
      const content = await invoke<string>("read_file", { path });
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
    const newPath = joinPath(parentOf(path), newName);
    try {
      await invoke("rename_path", { oldPath: path, newPath });
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

  const onDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData(DRAG_MIME, path);
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = "move";
    setCustomDragImage(e, name, false);
    activeDragSource = path;
  };

  const onDragEnd = () => { activeDragSource = null; };

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
        className={`tree-row file-row${activeTabPath === path ? " active" : ""}${highlighted ? " drop-flash" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(e) => { e.stopPropagation(); onClearDirSelection?.(); if (!path.endsWith(".pdf")) openFile(); }}
        onDoubleClick={(e) => { e.stopPropagation(); if (path.endsWith(".pdf")) openFile(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
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

type ConflictChoice = "replace" | "stop" | "duplicate";

export const FileTree = forwardRef<FileTreeHandle, { onOpenFolder: () => void }>(
function FileTree({ onOpenFolder }, ref) {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const [refreshVersions, setRefreshVersions] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState<null | { type: "file" | "folder"; name: string }>(null);
  const [selectedDirPath, setSelectedDirPath] = useState<string | null>(null);
  const [bodyCtxMenu, setBodyCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [bodyDropHover, setBodyDropHover] = useState(false);
  const [expandPath, setExpandPath] = useState<string | null>(null);
  const [highlightPath, setHighlightPath] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const askConflict = useCallback(async (srcName: string, destDirName: string): Promise<ConflictChoice> => {
    const btn = await invoke<string>("show_move_conflict_dialog", { srcName, destDirName });
    return btn === "Replace" ? "replace" : btn === "Keep Both" ? "duplicate" : "stop";
  }, []);

  const flashTarget = useCallback((dir: string, filePath: string) => {
    setExpandPath(dir);
    setHighlightPath(filePath);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightPath(null);
      highlightTimer.current = null;
    }, 1600);
  }, []);

  // Auto-sync: watch workspace for external file system changes
  useEffect(() => {
    if (!workspacePath) return;
    let stopFn: (() => void) | null = null;
    import("@tauri-apps/plugin-fs").then(({ watch }) => {
      watch(
        workspacePath,
        () => bumpRefresh(workspacePath),
        { recursive: true }
      ).then((stop) => { stopFn = stop; });
    });
    return () => { stopFn?.(); };
  }, [workspacePath]);

  const bumpRefresh = useCallback((dir: string) => {
    setRefreshVersions((r) => ({ ...r, [dir]: (r[dir] ?? 0) + 1 }));
  }, []);

  const moveNode = useCallback(async (src: string, destDir: string) => {
    if (!workspacePath) return;
    if (isSelfOrDescendant(src, destDir)) return;
    const srcParent = parentOf(src);
    if (srcParent === destDir) return;

    const name = basename(src);
    let destPath = joinPath(destDir, name);

    const exists = await invoke<boolean>("path_exists", { path: destPath });
    if (exists) {
      const choice = await askConflict(name, basename(destDir) || destDir);

      if (choice === "stop") return;

      if (choice === "replace") {
        try {
          await invoke("delete_path", { path: destPath });
        } catch (e) {
          console.error("delete before replace error", e);
          alert(`Failed to replace: ${e}`);
          return;
        }
      } else {
        // "duplicate" — find a free name
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext  = dot > 0 ? name.slice(dot) : "";
        let i = 2;
        while (true) {
          const candidate = joinPath(destDir, `${stem} (${i})${ext}`);
          const taken = await invoke<boolean>("path_exists", { path: candidate });
          if (!taken) { destPath = candidate; break; }
          i++;
        }
      }
    }

    try {
      await invoke("rename_path", { oldPath: src, newPath: destPath });
      bumpRefresh(srcParent);
      bumpRefresh(destDir);
      flashTarget(destDir, destPath);
    } catch (e) {
      console.error("move error", e);
      alert(`Failed to move: ${e}`);
    }
  }, [workspacePath, bumpRefresh, flashTarget, askConflict]);

  const copyOsFilesInto = useCallback(async (files: FileList, targetDir: string) => {
    let lastDest: string | null = null;
    for (const f of Array.from(files)) {
      const dest = joinPath(targetDir, f.name);
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        await invoke("write_file_bytes", { path: dest, bytes: Array.from(buf) });
        lastDest = dest;
      } catch (e) {
        console.error("write_file_bytes error", f.name, e);
        alert(`Failed to copy ${f.name}: ${e}`);
      }
    }
    bumpRefresh(targetDir);
    if (lastDest) flashTarget(targetDir, lastDest);
  }, [bumpRefresh, flashTarget]);

  const startCreating = useCallback((type: "file" | "folder") => {
    setCreating({ type, name: "" });
  }, []);

  const handleRefresh = useCallback(() => { if (workspacePath) bumpRefresh(workspacePath); }, [workspacePath, bumpRefresh]);

  useImperativeHandle(ref, () => ({
    newFile: () => startCreating("file"),
    newFolder: () => startCreating("folder"),
    refresh: handleRefresh,
  }), [startCreating, handleRefresh]);

  const handleCreateConfirm = async () => {
    const name = creating?.name.trim();
    if (!name || !workspacePath) { setCreating(null); return; }
    const targetDir = selectedDirPath ?? workspacePath;
    const fullPath = joinPath(targetDir, name);
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
    bumpRefresh(targetDir);
  };

  const handleCreateCancel = () => setCreating(null);

  // Empty-body interactions ──────────────────────────────
  const onBodyClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedDirPath(null);
    }
  };

  const onBodyContextMenu = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    setSelectedDirPath(null);
    setBodyCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const onBodyDragOver = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes("Files");
    if (!activeDragSource && !hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = activeDragSource ? "move" : "copy";
    if (!bodyDropHover) setBodyDropHover(true);
  };

  const onBodyDragLeave = (e: React.DragEvent) => {
    if (e.target === e.currentTarget) setBodyDropHover(false);
  };

  const onBodyDrop = (e: React.DragEvent) => {
    setBodyDropHover(false);
    if (!workspacePath) return;
    // Only handle drops that landed on the body itself — child rows handle their own.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const dest = selectedDirPath ?? workspacePath;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      copyOsFilesInto(e.dataTransfer.files, dest);
      return;
    }
    const src = activeDragSource ?? e.dataTransfer.getData(DRAG_MIME);
    if (!src) return;
    activeDragSource = null;
    moveNode(src, workspacePath);
  };

  const bodyCtxItems: ContextMenuItem[] = [
    { label: "New File", action: () => startCreating("file") },
    { label: "New Folder", action: () => startCreating("folder") },
    { separator: true },
    {
      label: "Reveal in Finder",
      action: () => workspacePath && invoke("reveal_in_finder", { path: workspacePath }).catch(console.error),
      disabled: !workspacePath,
    },
  ];

  return (
    <div className="file-tree">
      <div
        className={`file-tree-body${bodyDropHover ? " drop-target" : ""}`}
        ref={bodyRef}
        onClick={onBodyClick}
        onContextMenu={onBodyContextMenu}
        onDragOver={onBodyDragOver}
        onDragLeave={onBodyDragLeave}
        onDrop={onBodyDrop}
      >
        {workspacePath ? (
          <DirNode
            key={workspacePath}
            path={workspacePath}
            name={workspacePath.split("/").pop() ?? workspacePath}
            depth={0}
            onSelectDir={setSelectedDirPath}
            onClearDirSelection={() => setSelectedDirPath(null)}
            selectedDirPath={selectedDirPath}
            refreshVersions={refreshVersions}
            onRequestMove={moveNode}
            onOsDrop={copyOsFilesInto}
            expandPath={expandPath}
            highlightPath={highlightPath}
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
            <button className="open-folder-text-btn" onClick={onOpenFolder}>
              Open Folder
            </button>
          </div>
        )}
      </div>
      {bodyCtxMenu && (
        <ContextMenu
          x={bodyCtxMenu.x}
          y={bodyCtxMenu.y}
          items={bodyCtxItems}
          onClose={() => setBodyCtxMenu(null)}
        />
      )}
    </div>
  );
});
