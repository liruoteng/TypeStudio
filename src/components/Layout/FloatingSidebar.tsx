import { useState, useRef, useCallback, useEffect } from "react";
import { useEditorStore } from "../../stores/editorStore";
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
          <button
            className="fsb-section-action"
            title="New file"
            onClick={() => fileTreeRef.current?.newFile()}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="fsb-explorer-body">
          <FileTree ref={fileTreeRef} onOpenFolder={onOpenFolder} />
        </div>
      </div>

      {/* ── Section 2: Open files + drop zone + URL paste ───── */}
      <ReferencesSection
        tabs={tabs}
        activeTabPath={activeTabPath}
        onSetActiveTab={(path) => { setActiveTab(path); toggle(); }}
      />

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

// ── References section (open tabs + file drop + URL paste) ───────────────────
interface ReferencesSectionProps {
  tabs: { path: string; name: string; isDirty: boolean }[];
  activeTabPath: string | null;
  onSetActiveTab: (path: string) => void;
}

function ReferencesSection({ tabs, activeTabPath, onSetActiveTab }: ReferencesSectionProps) {
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

      <div className="fsb-file-list">
        {tabs.length === 0 && (
          <span className="fsb-empty-hint">No files open</span>
        )}
        {tabs.map((tab) => {
          const ext = tab.name.split(".").pop()?.toLowerCase() ?? "";
          const color = ext === "typ" ? "var(--accent)" : ext === "bib" ? "#c47a15" : ext === "pdf" ? "#d85a30" : "var(--text-muted)";
          return (
            <button
              key={tab.path}
              className={`fsb-file-item${tab.path === activeTabPath ? " fsb-file-item--active" : ""}`}
              onClick={() => onSetActiveTab(tab.path)}
              title={tab.path}
            >
              <span className="fsb-file-dot" style={{ background: color }} />
              <span className="fsb-file-name">{tab.name}</span>
              {tab.isDirty && <span className="fsb-file-dirty" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
