import { useCallback, useState, type ReactNode } from "react";
import { useEditorStore } from "../../stores/editorStore";
import "./PanelManager.css";

export type PanelId = "editor" | "preview" | "diff" | "outline";

interface PanelDef {
  id: PanelId;
  label: string;
  desc: string;
}

const ALL_PANELS: PanelDef[] = [
  { id: "editor",  label: "Editor",      desc: "Monaco source editor" },
  { id: "preview", label: "PDF Preview", desc: "Live compiled output"  },
  { id: "diff",    label: "Diff",        desc: "AI edits vs. original" },
  { id: "outline", label: "Outline",     desc: "Document structure"    },
];

export interface PanelContents {
  editor:  ReactNode;
  preview: ReactNode;
  diff:    ReactNode;
  outline: ReactNode;
}

interface PanelManagerProps {
  contents: PanelContents;
  /** Title shown in the diff panel header (e.g. "§2.3 citation fix") */
  diffTitle?: string;
}

// ── Grid layout helper ────────────────────────────────────────────────────────
// Returns whether panel at `idx` spans both columns (only true for the 3rd
// panel in a 3-panel layout).
function isWide(idx: number, total: number) {
  return total === 1 || (total === 3 && idx === 2);
}

function gridCols(total: number) {
  return total <= 1 ? "1fr" : "1fr 1fr";
}

// ── Drag state (module-level to survive re-renders during the drag) ───────────
let dragFromIdx = -1;
let dragOverIdx = -1;

// ── Panel component ───────────────────────────────────────────────────────────
interface PanelProps {
  id: PanelId;
  idx: number;
  total: number;
  label: string;
  wide: boolean;
  children: ReactNode;
  onClose: (idx: number) => void;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragOver:  (e: React.DragEvent, idx: number) => void;
  onDrop:      (e: React.DragEvent, idx: number) => void;
  onDragEnd:   (e: React.DragEvent) => void;
}

function Panel({
  id, idx, total, label, wide, children,
  onClose, onDragStart, onDragOver, onDrop, onDragEnd,
}: PanelProps) {
  // Diff panel: choose inline vs side-by-side based on computed width.
  // We derive "wide enough for side-by-side" from the layout: a panel is wide
  // when it's the only panel or it spans both columns in a 3-panel layout.
  const diffMode = id === "diff" ? (wide ? "sbs" : "inline") : undefined;

  return (
    <div
      className="pm-panel"
      data-id={id}
      data-idx={idx}
      style={wide && total === 3 ? { gridColumn: "1 / -1" } : undefined}
      onDragOver={(e) => onDragOver(e, idx)}
      onDrop={(e) => onDrop(e, idx)}
    >
      {/* ── Header (drag handle) ──────────────────────────────── */}
      <div
        className="pm-panel-header"
        draggable
        onDragStart={(e) => onDragStart(e, idx)}
        onDragEnd={onDragEnd}
      >
        <GripIcon />
        <span className="pm-panel-title">
          {label}
          {diffMode && (
            <span className="pm-panel-subtitle">
              {diffMode === "sbs" ? " — side by side" : " — inline"}
            </span>
          )}
        </span>
        <button
          className="pm-panel-close"
          onClick={() => onClose(idx)}
          title={`Close ${label}`}
          aria-label={`Close ${label} panel`}
        >
          ✕
        </button>
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="pm-panel-body">
        {children}
      </div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg className="pm-grip" width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden>
      <circle cx="3" cy="3"  r="1.2" fill="currentColor" />
      <circle cx="7" cy="3"  r="1.2" fill="currentColor" />
      <circle cx="3" cy="7"  r="1.2" fill="currentColor" />
      <circle cx="7" cy="7"  r="1.2" fill="currentColor" />
      <circle cx="3" cy="11" r="1.2" fill="currentColor" />
      <circle cx="7" cy="11" r="1.2" fill="currentColor" />
    </svg>
  );
}

// ── Panel dropdown ────────────────────────────────────────────────────────────
interface PanelDropdownProps {
  activePanels: string[];
  onToggle: (id: PanelId) => void;
  onClose: () => void;
}

function PanelDropdown({ activePanels, onToggle, onClose }: PanelDropdownProps) {
  return (
    <div className="pm-dropdown" onMouseDown={(e) => e.stopPropagation()}>
      <div className="pm-dropdown-header">Add a panel</div>
      {ALL_PANELS.map((p) => {
        const active = activePanels.includes(p.id);
        return (
          <button
            key={p.id}
            className={`pm-dropdown-item${active ? " pm-dropdown-item--on" : ""}`}
            onClick={() => { onToggle(p.id); onClose(); }}
          >
            <span className={`pm-dd-check${active ? " pm-dd-check--on" : ""}`}>
              {active && "✓"}
            </span>
            <span className="pm-dd-info">
              <span className="pm-dd-label">{p.label}</span>
              <span className="pm-dd-desc">{p.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── PanelManager ──────────────────────────────────────────────────────────────
export function PanelManager({ contents, diffTitle }: PanelManagerProps) {
  const activePanels  = useEditorStore((s) => s.activePanels);
  const setActivePanels = useEditorStore((s) => s.setActivePanels);

  const [ddOpen, setDdOpen] = useState(false);

  // Snap-to-grid drop — swap two panels in the active list.
  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragFromIdx = idx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    // Defer adding the class so the ghost image captures the un-dimmed state.
    const el = (e.currentTarget as HTMLElement).closest(".pm-panel") as HTMLElement | null;
    if (el) setTimeout(() => el.classList.add("pm-panel--dragging"), 0);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragFromIdx < 0 || dragFromIdx === idx) return;
    if (dragOverIdx !== idx) {
      document.querySelectorAll<HTMLElement>(".pm-panel--drop-target")
        .forEach((el) => el.classList.remove("pm-panel--drop-target"));
      const panels = document.querySelectorAll<HTMLElement>(".pm-panel");
      if (panels[idx]) panels[idx].classList.add("pm-panel--drop-target");
      dragOverIdx = idx;
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = dragFromIdx;
    if (from >= 0 && from !== idx) {
      const next = [...activePanels];
      [next[from], next[idx]] = [next[idx], next[from]];
      setActivePanels(next);
    }
    clearDrag();
  }, [activePanels, setActivePanels]);

  const handleDragEnd = useCallback((_e: React.DragEvent) => {
    clearDrag();
  }, []);

  const closePanel = useCallback((idx: number) => {
    if (activePanels.length <= 1) return;
    setActivePanels(activePanels.filter((_, i) => i !== idx));
  }, [activePanels, setActivePanels]);

  const togglePanel = useCallback((id: PanelId) => {
    if (activePanels.includes(id)) {
      if (activePanels.length <= 1) return;
      setActivePanels(activePanels.filter((p) => p !== id));
    } else {
      if (activePanels.length >= 4) return;
      setActivePanels([...activePanels, id]);
    }
  }, [activePanels, setActivePanels]);

  const n = activePanels.length;

  return (
    <div className="pm-root">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="pm-toolbar">
        {/* Active panel tags */}
        <div className="pm-tags">
          {activePanels.map((id, idx) => {
            const def = ALL_PANELS.find((p) => p.id === id);
            return (
              <span key={id} className="pm-tag">
                {def?.label ?? id}
                <button
                  className="pm-tag-close"
                  onClick={() => closePanel(idx)}
                  aria-label={`Remove ${def?.label ?? id} panel`}
                >✕</button>
              </span>
            );
          })}
        </div>

        {/* Add-panel button */}
        <div className="pm-add-wrap">
          <button
            className={`pm-add-btn${ddOpen ? " pm-add-btn--open" : ""}`}
            onClick={() => setDdOpen((v) => !v)}
          >
            + Panel ▾
          </button>
          {ddOpen && (
            <PanelDropdown
              activePanels={activePanels}
              onToggle={togglePanel}
              onClose={() => setDdOpen(false)}
            />
          )}
        </div>
      </div>

      {/* ── Panel grid ──────────────────────────────────────── */}
      <div
        className="pm-grid"
        style={{ gridTemplateColumns: gridCols(n) }}
        onClick={() => ddOpen && setDdOpen(false)}
      >
        {activePanels.map((id, idx) => {
          const def  = ALL_PANELS.find((p) => p.id === id)!;
          const wide = isWide(idx, n);
          const label = id === "diff" && diffTitle
            ? `Diff — ${diffTitle}`
            : def.label;

          return (
            <Panel
              key={id}
              id={id as PanelId}
              idx={idx}
              total={n}
              label={label}
              wide={wide}
              onClose={closePanel}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              {/* Mount all panel types but hide inactive ones so Monaco doesn't
                  remount (it keeps editor state). Only diff/outline are cheap to
                  unmount since they're pure display. */}
              <div className="pm-panel-content-wrap" style={{ display: id === "editor" || id === "preview" ? "flex" : undefined }}>
                {contents[id as PanelId]}
              </div>
            </Panel>
          );
        })}
      </div>

      {/* Close dropdown on outside click */}
      {ddOpen && (
        <div className="pm-dd-overlay" onClick={() => setDdOpen(false)} />
      )}
    </div>
  );
}

function clearDrag() {
  document.querySelectorAll<HTMLElement>(".pm-panel--dragging")
    .forEach((el) => el.classList.remove("pm-panel--dragging"));
  document.querySelectorAll<HTMLElement>(".pm-panel--drop-target")
    .forEach((el) => el.classList.remove("pm-panel--drop-target"));
  dragFromIdx = -1;
  dragOverIdx = -1;
}
