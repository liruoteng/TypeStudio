import { memo, useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { ContextMenu } from "../Layout/ContextMenu";
import "./PreviewPanel.css";

const ZOOM_SENSITIVITY = 0.008;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

function usePinchZoom(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta =
        e.deltaMode === 0 ? e.deltaY :
        e.deltaMode === 1 ? e.deltaY * 20 :
        e.deltaY * 300;
      const prevZoom = useEditorStore.getState().previewZoom;
      const scaleFactor = 1 - delta * ZOOM_SENSITIVITY;
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prevZoom * scaleFactor));
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const ratio = nextZoom / prevZoom;
      const nextScrollLeft = (el.scrollLeft + cursorX) * ratio - cursorX;
      const nextScrollTop  = (el.scrollTop  + cursorY) * ratio - cursorY;
      useEditorStore.getState().setPreviewZoom(nextZoom);
      requestAnimationFrame(() => {
        el.scrollLeft = nextScrollLeft;
        el.scrollTop  = nextScrollTop;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// Schedule work during browser idle time. Falls back to setTimeout on Safari.
function scheduleIdle(cb: () => void, timeout = 500): () => void {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(cb, { timeout });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
}

// Each page subscribes directly to its own SVG slice in the store.
// This means only the specific page that changed triggers a re-render —
// unchanged pages are completely unaffected regardless of how many pages there are.
const VirtualPageView = memo(function VirtualPageView({
  index,
  onDoubleClick,
  scrollRoot,
}: {
  index: number;
  onDoubleClick: (i: number) => void;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
}) {
  const svg = useEditorStore((s) => s.previewPages[index] ?? "");

  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef   = useRef<HTMLDivElement>(null);
  const [visible, setVisible]   = useState(false);
  const renderedSvgRef = useRef(""); // what's currently in the DOM

  // Parse viewBox for placeholder sizing so scroll position is stable
  // even before the SVG is injected. Only checks first 300 chars (always there).
  const aspectRatio = useMemo(() => {
    const m = svg.slice(0, 300).match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
    return m ? `${m[1]} / ${m[2]}` : "595.28 / 841.89";
  }, [svg]);

  // IntersectionObserver: mark visible when within 1 viewport of the scroll area.
  // rootMargin "100% 0px" pre-renders one viewport above and below — no flash on scroll.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { root: scrollRoot.current, rootMargin: "100% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Idle-scheduled SVG injection:
  // - Only runs when the page is visible (or near-visible via rootMargin).
  // - Uses requestIdleCallback so the browser handles the SVG parse during
  //   idle time — typing is never blocked, even on pages with heavy math/figures.
  // - Skips the update if the SVG hasn't changed since last render.
  useEffect(() => {
    if (!visible) return;
    if (svg === renderedSvgRef.current) return;
    const inner = innerRef.current;
    if (!inner) return;
    return scheduleIdle(() => {
      inner.innerHTML = svg;
      renderedSvgRef.current = svg;
    });
  }, [svg, visible]);

  return (
    <div
      ref={wrapperRef}
      className="preview-page"
      style={{ aspectRatio }}
      onDoubleClick={() => onDoubleClick(index)}
      title="Double-click to jump to this section in editor"
    >
      <div ref={innerRef} className="preview-page-inner" />
      <div className="preview-page-number">{index + 1}</div>
    </div>
  );
});

export const PreviewPanel = memo(function PreviewPanel() {
  const pageCount     = useEditorStore((s) => s.previewPages.length);
  const loading       = useEditorStore((s) => s.previewLoading);
  const error         = useEditorStore((s) => s.previewError);
  const zoom          = useEditorStore((s) => s.previewZoom);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const setScrollToLine = useEditorStore((s) => s.setScrollToLine);
  const setZoom         = useEditorStore((s) => s.setPreviewZoom);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handlePageDoubleClick = useCallback((pageIndex: number) => {
    const state = useEditorStore.getState();
    const lineCount = state.activeTab()?.content.split("\n").length ?? 0;
    if (lineCount === 0) return;
    const total = state.previewPages.length;
    const estimatedLine = Math.max(1, Math.round((pageIndex / Math.max(1, total)) * lineCount) + 1);
    setScrollToLine(estimatedLine);
  }, [setScrollToLine]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const panelRef = useRef<HTMLDivElement>(null);
  usePinchZoom(panelRef);

  if (activeTabPath && !activeTabPath.endsWith(".typ")) {
    return (
      <div ref={panelRef} className="preview-panel preview-empty">
        <div className="preview-empty-icon">📄</div>
        <p>Preview not available</p>
        <p className="preview-empty-hint">Open a .typ file to see a preview</p>
      </div>
    );
  }

  // When there's an error AND we already have a previously-successful render,
  // keep showing those pages (dimmed) with a small banner. Only fall back to
  // the full-screen error view when there's nothing to show.
  if (error && pageCount === 0) {
    return (
      <div ref={panelRef} className="preview-panel preview-error">
        <div className="preview-error-icon">⚠</div>
        <pre className="preview-error-text">{error}</pre>
      </div>
    );
  }

  if (loading && pageCount === 0) {
    return (
      <div ref={panelRef} className="preview-panel preview-loading">
        <div className="preview-spinner" />
        <p>Compiling…</p>
      </div>
    );
  }

  if (pageCount === 0) {
    return (
      <div ref={panelRef} className="preview-panel preview-empty">
        <div className="preview-empty-icon">📄</div>
        <p>Preview will appear here</p>
        <p className="preview-empty-hint">Save a .typ file to render it</p>
      </div>
    );
  }

  return (
    <>
      <div
        ref={panelRef}
        className={`preview-panel${loading ? " preview-reloading" : ""}${error ? " preview-stale" : ""}`}
        onContextMenu={handleContextMenu}
      >
        {loading && <div className="preview-reload-indicator" />}
        {error && (
          <div className="preview-error-banner" title={error}>
            <span className="preview-error-banner-icon">⚠</span>
            <span>Syntax error — showing last successful preview</span>
          </div>
        )}
        <div
          className="preview-pages-content"
          style={{ "--preview-zoom": zoom } as React.CSSProperties}
        >
          {Array.from({ length: pageCount }, (_, i) => (
            <VirtualPageView
              key={i}
              index={i}
              onDoubleClick={handlePageDoubleClick}
              scrollRoot={panelRef}
            />
          ))}
        </div>
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: "Zoom In",    action: () => setZoom(+(zoom + 0.25).toFixed(2)), disabled: zoom >= 4 },
            { label: "Zoom Out",   action: () => setZoom(+(zoom - 0.25).toFixed(2)), disabled: zoom <= 0.25 },
            { label: "Reset Zoom", action: () => setZoom(1) },
          ]}
        />
      )}
    </>
  );
});
