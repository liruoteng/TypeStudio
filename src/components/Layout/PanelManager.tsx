import { useCallback, type ReactNode } from "react";
import { useEditorStore } from "../../stores/editorStore";
import "./PanelManager.css";

export type PanelId = "editor" | "preview" | "diff" | "outline" | "ai";

interface PanelDef {
  id: PanelId;
  label: string;
  desc: string;
}

export const ALL_PANELS: PanelDef[] = [
  { id: "ai",      label: "AI",      desc: "AI writing assistant"   },
  { id: "editor",  label: "Editor",  desc: "Monaco source editor"   },
  { id: "preview", label: "Preview", desc: "Live compiled output"    },
  { id: "diff",    label: "Diff",    desc: "AI edits vs. original"   },
  { id: "outline", label: "Outline", desc: "Document structure"      },
];

export interface PanelContents {
  ai:      ReactNode;
  editor:  ReactNode;
  preview: ReactNode;
  diff:    ReactNode;
  outline: ReactNode;
}

interface PanelManagerProps {
  contents: PanelContents;
  headerExtras?: Partial<Record<PanelId, ReactNode>>;
  titleSuffixes?: Partial<Record<PanelId, ReactNode>>;
  diffTitle?: string;
  /** Called when the user closes the last remaining panel. */
  onCollapse?: () => void;
}

// ── Grid layout helpers ───────────────────────────────────────────────────────
function isWide(idx: number, total: number, layout: "vertical" | "horizontal") {
  if (layout === "vertical") return false;
  return total === 1 || (total === 3 && idx === 2) || (total === 5 && idx === 4);
}
function gridCols(total: number, layout: "vertical" | "horizontal") {
  if (layout === "vertical" || total <= 1) return "1fr";
  return "1fr 1fr";
}

// ── Drag state ────────────────────────────────────────────────────────────────
let dragFromIdx = -1;
let dragOverIdx = -1;

// ── Individual panel ──────────────────────────────────────────────────────────
interface PanelProps {
  id: PanelId;
  idx: number;
  total: number;
  label: string;
  wide: boolean;
  titleSuffix?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  onClose: (idx: number) => void;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragOver:  (e: React.DragEvent, idx: number) => void;
  onDrop:      (e: React.DragEvent, idx: number) => void;
  onDragEnd:   (e: React.DragEvent) => void;
}

function Panel({ id, idx, total, label, wide, titleSuffix, headerExtra, children,
  onClose, onDragStart, onDragOver, onDrop, onDragEnd }: PanelProps) {
  const panelLayout = useEditorStore((s) => s.panelLayout);
  const diffMode = id === "diff" ? (wide ? "sbs" : "inline") : undefined;
  // Top-right panel shares its corner with the floating selector button.
  const isTopRight = total === 1 || (panelLayout === "horizontal" ? idx === 1 : idx === 0);
  return (
    <div
      className="pm-panel"
      data-id={id}
      data-idx={idx}
      style={wide && total === 3 ? { gridColumn: "1 / -1" } : undefined}
      onDragOver={(e) => onDragOver(e, idx)}
      onDrop={(e) => onDrop(e, idx)}
    >
      <div
        className="pm-panel-header"
        style={isTopRight ? { paddingRight: 36 } : undefined}
        draggable
        onDragStart={(e) => onDragStart(e, idx)}
        onDragEnd={onDragEnd}
      >
        <GripIcon />
        <span className="pm-panel-title">
          {label}
          {diffMode && <span className="pm-panel-subtitle">{diffMode === "sbs" ? " — side by side" : " — inline"}</span>}
          {titleSuffix}
        </span>
        {headerExtra}
        <button className="pm-panel-close" onClick={() => onClose(idx)} title={`Close ${label}`} aria-label={`Close ${label} panel`}>
          ✕
        </button>
      </div>
      <div className="pm-panel-body">{children}</div>
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

// ── Panel selector dropdown ───────────────────────────────────────────────────
export interface PanelSelectorProps {
  activePanels: string[];
  onToggle: (id: PanelId) => void;
  onClose: () => void;
}

export function PanelSelector({ activePanels, onToggle, onClose }: PanelSelectorProps) {
  return (
    <div className="pm-selector" onMouseDown={(e) => e.stopPropagation()}>
      <div className="pm-selector-header">Panels</div>
      {ALL_PANELS.map((p) => {
        const active = activePanels.includes(p.id);
        return (
          <button
            key={p.id}
            className={`pm-selector-item${active ? " pm-selector-item--on" : ""}`}
            onClick={() => { onToggle(p.id); onClose(); }}
          >
            <span className={`pm-selector-check${active ? " pm-selector-check--on" : ""}`}>
              {active && "✓"}
            </span>
            <span className="pm-selector-info">
              <span className="pm-selector-label">{p.label}</span>
              <span className="pm-selector-desc">{p.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── PanelManager ──────────────────────────────────────────────────────────────
export function PanelManager({ contents, headerExtras, titleSuffixes, diffTitle, onCollapse }: PanelManagerProps) {
  const activePanels    = useEditorStore((s) => s.activePanels);
  const setActivePanels = useEditorStore((s) => s.setActivePanels);
  const panelLayout     = useEditorStore((s) => s.panelLayout);
  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragFromIdx = idx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
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

  const handleDragEnd = useCallback((_e: React.DragEvent) => { clearDrag(); }, []);

  const closePanel = useCallback((idx: number) => {
    if (activePanels.length <= 1) { onCollapse?.(); return; }
    setActivePanels(activePanels.filter((_, i) => i !== idx));
  }, [activePanels, setActivePanels, onCollapse]);

  const n = activePanels.length;

  return (
    <div className="pm-root">
      <div className="pm-grid" style={{ gridTemplateColumns: gridCols(n, panelLayout) }}>
        {activePanels.map((id, idx) => {
          const def   = ALL_PANELS.find((p) => p.id === id)!;
          const wide  = isWide(idx, n, panelLayout);
          const label = id === "diff" && diffTitle ? `Diff — ${diffTitle}` : def.label;
          return (
            <Panel
              key={id}
              id={id as PanelId}
              idx={idx}
              total={n}
              label={label}
              wide={wide}
              titleSuffix={titleSuffixes?.[id as PanelId]}
              headerExtra={headerExtras?.[id as PanelId]}
              onClose={closePanel}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              <div className="pm-panel-content-wrap" style={{ display: id === "editor" || id === "preview" ? "flex" : undefined }}>
                {contents[id as PanelId]}
              </div>
            </Panel>
          );
        })}
      </div>
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
