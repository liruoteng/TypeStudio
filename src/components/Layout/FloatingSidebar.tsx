import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore, type FileEntry } from "../../stores/editorStore";
import { FileTree, type FileTreeHandle } from "../FileExplorer/FileTree";
import "./FloatingSidebar.css";

interface FloatingSidebarProps {
  onOpenFolder: () => void;
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <line x1="5.5" y1="1.5" x2="5.5" y2="14.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 13.5c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <line x1="7" y1="1" x2="7" y2="2.5"   stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="7" y1="11.5" x2="7" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="1" y1="7" x2="2.5" y2="7"   stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="11.5" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="2.93" y1="2.93" x2="4"    y2="4"    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="10"   y1="10"   x2="11.07" y2="11.07" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="2.93" y1="11.07" x2="4"    y2="10"   stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="10"   y1="4"     x2="11.07" y2="2.93" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M11.5 9A5.5 5.5 0 0 1 5 2.5a5.5 5.5 0 1 0 6.5 6.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function FloatingSidebar({ onOpenFolder }: FloatingSidebarProps) {
  const sidebarOpen    = useEditorStore((s) => s.sidebarOpen);
  const setSidebarOpen = useEditorStore((s) => s.setSidebarOpen);
  const theme          = useEditorStore((s) => s.theme);
  const setTheme       = useEditorStore((s) => s.setTheme);
  const tabs           = useEditorStore((s) => s.tabs);
  const activeTabPath  = useEditorStore((s) => s.activeTabPath);
  const setActiveTab   = useEditorStore((s) => s.setActiveTab);
  const fileTreeRef = useRef<FileTreeHandle>(null);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const widthRef = useRef(220);

  const toggle = useCallback(() => setSidebarOpen(!sidebarOpen), [sidebarOpen, setSidebarOpen]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(140, Math.min(520, startWidth + ev.clientX - startX));
      widthRef.current = w;
      setSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <aside
      className={`fsb${sidebarOpen ? " fsb--open" : ""}`}
      style={sidebarOpen ? { width: sidebarWidth } : undefined}
      aria-label="Sidebar"
    >
      {/* ── Top bar: sidebar toggle ─────────────────────────── */}
      <div className="fsb-topbar">
        <span className="fsb-brand">type-studio</span>
        <button
          className="fsb-toggle-btn"
          onClick={toggle}
          title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          aria-label="Toggle sidebar"
        >
          <SidebarIcon />
        </button>
      </div>

      {/* ── Section 1: File Explorer (fills remaining height) ── */}
      <div className="fsb-section fsb-section--grow">
        <div className="fsb-section-head">
          <span className="fsb-section-title">Explorer</span>
          <div className="fsb-section-actions" style={{ display: 'flex', gap: '4px' }}>
            <button
              className="fsb-section-action"
              title="New file"
              onClick={() => fileTreeRef.current?.newFile()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              className="fsb-section-action"
              title="New folder"
              onClick={() => fileTreeRef.current?.newFolder()}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M1 3C1 2.44772 1.44772 2 2 2H6L7.5 4H14C14.5523 4 15 4.44772 15 5V13C15 13.5523 14.5523 14 14 14H2C1.44772 14 1 13.5523 1 13V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="fsb-explorer-body">
          <FileTree ref={fileTreeRef} onOpenFolder={onOpenFolder} />
        </div>
      </div>

      {/* ── Section 2: Media Management ── */}
      <MediaSection />

      {/* ── Section 3: References (drop zone + URL paste) ───── */}
      <ReferencesSection />

      {/* ── Bottom: profile + theme ──────────────────────────── */}
      <div className="fsb-bottom">
        <button className="fsb-bottom-btn" title="Profile (coming soon)" aria-label="User profile">
          <UserIcon />
          <span className="fsb-bottom-label">Profile</span>
        </button>
        <button
          className="fsb-bottom-btn"
          onClick={() => setTheme(theme === "dark" ? "claude" : "dark")}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          <span className="fsb-bottom-label">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
      </div>

      {/* ── Resize handle (right edge, only when open) ───────── */}
      {sidebarOpen && (
        <div className="fsb-resize-handle" onMouseDown={handleResizeMouseDown} />
      )}
    </aside>
  );
}

function ReferencesSection() {
  const [urlValue, setUrlValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Accept URL pasted anywhere in the section via a paste listener
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (text.startsWith("http://") || text.startsWith("https://")) {
        e.preventDefault();
        setUrlValue(text);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="fsb-section">
      <div className="fsb-section-head">
        <span className="fsb-section-title">References</span>
      </div>

      <label className="fsb-drop-zone" htmlFor="fsb-file-input">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1v8M4 6l3-3 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M2 10v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        Drop files or paste URL
        <input id="fsb-file-input" type="file" multiple style={{ display: "none" }} />
      </label>

      <div className="fsb-url-row">
        <input
          ref={inputRef}
          className="fsb-url-input"
          type="url"
          placeholder="Paste a URL…"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && urlValue.trim()) {
              window.dispatchEvent(new CustomEvent("references:add-url", { detail: urlValue.trim() }));
              setUrlValue("");
            }
            if (e.key === "Escape") setUrlValue("");
          }}
        />
      </div>
    </div>
  );
}

// ── Media Management Section ──────────────────────────────────────────────────────
function MediaSection() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const [mediaFiles, setMediaFiles] = useState<FileEntry[]>([]);

  const loadMedia = useCallback(async () => {
    if (!workspacePath) return;
    const mediaDir = `${workspacePath}/assets`;
    try {
      const exists = await invoke<boolean>("path_exists", { path: mediaDir });
      if (!exists) {
        setMediaFiles([]);
        return;
      }
      const entries = await invoke<FileEntry[]>("list_dir", { path: mediaDir });
      setMediaFiles(entries.filter(e => !e.is_dir && /\.(png|jpg|jpeg|gif|svg|webp|mp4|webm|mov)$/i.test(e.name)));
    } catch (e) {
      console.error(e);
    }
  }, [workspacePath]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!workspacePath) return;
    const mediaDir = `${workspacePath}/assets`;
    try {
      const exists = await invoke<boolean>("path_exists", { path: mediaDir });
      if (!exists) {
        await invoke("create_dir", { path: mediaDir });
      }
      const files = Array.from(e.dataTransfer.files);
      for (const f of files) {
        if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) continue;
        const dest = `${mediaDir}/${f.name}`;
        const buf = new Uint8Array(await f.arrayBuffer());
        await invoke("write_file_bytes", { path: dest, bytes: Array.from(buf) });
      }
      loadMedia();
    } catch (err) {
      console.error(err);
    }
  };

  const onClickUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*';
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || !workspacePath) return;
      const mediaDir = `${workspacePath}/assets`;
      try {
        const exists = await invoke<boolean>("path_exists", { path: mediaDir });
        if (!exists) {
          await invoke("create_dir", { path: mediaDir });
        }
        for (const f of Array.from(files)) {
          const dest = `${mediaDir}/${f.name}`;
          const buf = new Uint8Array(await f.arrayBuffer());
          await invoke("write_file_bytes", { path: dest, bytes: Array.from(buf) });
        }
        loadMedia();
      } catch (err) {
        console.error(err);
      }
    };
    input.click();
  };

  return (
    <div className="fsb-section">
      <div className="fsb-section-head">
        <span className="fsb-section-title">Media</span>
        <button className="fsb-section-action" title="Upload Media" onClick={onClickUpload}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <div 
        className="fsb-drop-zone" 
        onDragOver={(e) => e.preventDefault()} 
        onDrop={onDrop}
        style={{ marginTop: 0 }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1v8M4 6l3-3 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M2 10v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        Drop images/videos here
      </div>
      <div className="fsb-file-list">
        {mediaFiles.length === 0 && <span className="fsb-empty-hint">No media in assets/</span>}
        {mediaFiles.map(f => (
          <div key={f.path} className="fsb-file-item" title="Click to copy name" onClick={() => navigator.clipboard.writeText(f.name)}>
            <span className="fsb-file-dot" style={{ background: "var(--accent)" }} />
            <span className="fsb-file-name">{f.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
