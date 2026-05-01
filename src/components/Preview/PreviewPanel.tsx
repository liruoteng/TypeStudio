import { memo, useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { ContextMenu } from "../Layout/ContextMenu";
import "./PreviewPanel.css";

const ZOOM_SENSITIVITY = 0.008;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

// Default A4-ish page width used as the "natural" width at zoom = 1.
const NATURAL_PAGE_WIDTH = 700;

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

// ── Thumbnails strip ─────────────────────────────────────────────────────
// A vertical column of mini page previews that scrolls the main preview when
// clicked. Subscribes per-page like VirtualPageView so only changed pages
// re-render. The thumb is just a scaled-down SVG injection.
const PageThumbnail = memo(function PageThumbnail({
  index,
  active,
  onClick,
}: {
  index: number;
  active: boolean;
  onClick: (i: number) => void;
}) {
  const svg = useEditorStore((s) => s.previewPages[index] ?? "");
  const innerRef = useRef<HTMLDivElement>(null);
  const renderedSvgRef = useRef("");

  useEffect(() => {
    if (svg === renderedSvgRef.current) return;
    const inner = innerRef.current;
    if (!inner) return;
    inner.innerHTML = svg;
    renderedSvgRef.current = svg;
  }, [svg]);

  const aspectRatio = useMemo(() => {
    const m = svg.slice(0, 300).match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
    return m ? `${m[1]} / ${m[2]}` : "595.28 / 841.89";
  }, [svg]);

  return (
    <button
      className={`preview-thumb${active ? " preview-thumb--active" : ""}`}
      onClick={() => onClick(index)}
      title={`Jump to page ${index + 1}`}
    >
      <div className="preview-thumb-page" style={{ aspectRatio }}>
        <div ref={innerRef} className="preview-thumb-inner" />
      </div>
      <span className="preview-thumb-num">{index + 1}</span>
    </button>
  );
});

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
      data-page-index={index}
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
  const firstPageSvg    = useEditorStore((s) => s.previewPages[0] ?? "");

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [activePage, setActivePage] = useState(0);

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

  // Click a thumbnail → scroll the corresponding page into view inside the panel.
  const scrollToPage = useCallback((pageIndex: number) => {
    const root = panelRef.current;
    if (!root) return;
    const target = root.querySelector(`[data-page-index="${pageIndex}"]`) as HTMLElement | null;
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  // Track which page is "active" (closest to the top of the viewport) so the
  // thumbnail strip can highlight it. Update on scroll, throttled by rAF.
  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const pages = root.querySelectorAll<HTMLElement>("[data-page-index]");
      if (pages.length === 0) return;
      const rootTop = root.getBoundingClientRect().top;
      let best = 0;
      let bestDist = Infinity;
      pages.forEach((el) => {
        const idx = Number(el.dataset.pageIndex);
        const top = el.getBoundingClientRect().top - rootTop;
        const dist = Math.abs(top);
        if (top <= 80 && dist < bestDist) { best = idx; bestDist = dist; }
      });
      setActivePage(best);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
    };
  }, [pageCount]);

  // ── Fit-to-width / Fit-to-page ─────────────────────────────────────────
  // panelRef points to .preview-pages-scroll, whose clientWidth IS the
  // usable horizontal space (the thumb strip lives outside this element).
  const fitToWidth = useCallback(() => {
    const root = panelRef.current;
    if (!root) return;
    const usable = root.clientWidth - 56; // accounts for pages-content padding + slack
    const next = +(usable / NATURAL_PAGE_WIDTH).toFixed(2);
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  }, [setZoom]);

  const fitToPage = useCallback(() => {
    const root = panelRef.current;
    if (!root) return;
    const usableW = root.clientWidth - 56;
    const usableH = root.clientHeight - 80;
    const m = firstPageSvg.slice(0, 300).match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
    const ratio = m ? Number(m[1]) / Number(m[2]) : 595.28 / 841.89;
    const widthForHeight = usableH * ratio;
    const next = +(Math.min(usableW, widthForHeight) / NATURAL_PAGE_WIDTH).toFixed(2);
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  }, [setZoom, firstPageSvg]);

  if (activeTabPath && !activeTabPath.endsWith(".typ") && !activeTabPath.endsWith(".md") && !activeTabPath.endsWith(".markdown")) {
    return (
      <div ref={panelRef} className="preview-panel preview-empty">
        <div className="preview-empty-icon">📄</div>
        <p>Preview not available</p>
        <p className="preview-empty-hint">Open a .typ or .md file to see a preview</p>
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
        <p className="preview-empty-hint">Save a .typ or .md file to render it</p>
      </div>
    );
  }

  return (
    <>
      <div
        className={`preview-panel${loading ? " preview-reloading" : ""}${error ? " preview-stale" : ""}`}
        onContextMenu={handleContextMenu}
      >
        {loading && <div className="preview-reload-indicator" />}

        {/* Thumbnail strip — own scroll, hidden when only one page exists. */}
        {pageCount > 1 && (
          <div className="preview-thumbs">
            {Array.from({ length: pageCount }, (_, i) => (
              <PageThumbnail
                key={i}
                index={i}
                active={i === activePage}
                onClick={scrollToPage}
              />
            ))}
          </div>
        )}

        {/* Inner scroll area — this is the IntersectionObserver root and the
            zoom/pan target. Splitting it out from .preview-panel lets the
            thumbnail strip live alongside without competing for scroll space. */}
        <div ref={panelRef} className="preview-pages-scroll">
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

          {/* Floating fit/zoom controls — bottom-right, sticky inside scroll area. */}
          <div className="preview-zoom-floating">
            <button
              className="preview-floating-btn"
              onClick={fitToWidth}
              title="Fit page width to panel"
            >
              ↔
            </button>
            <button
              className="preview-floating-btn"
              onClick={fitToPage}
              title="Fit whole page to panel"
            >
              ⤢
            </button>
            <span className="preview-floating-pct" title="Click to reset to 100%" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </span>
          </div>
        </div>
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: "Zoom In",       action: () => setZoom(+(zoom + 0.25).toFixed(2)), disabled: zoom >= 4 },
            { label: "Zoom Out",      action: () => setZoom(+(zoom - 0.25).toFixed(2)), disabled: zoom <= 0.25 },
            { label: "Fit Width",     action: fitToWidth },
            { label: "Fit Whole Page", action: fitToPage },
            { label: "Reset Zoom",    action: () => setZoom(1) },
          ]}
        />
      )}
    </>
  );
});
