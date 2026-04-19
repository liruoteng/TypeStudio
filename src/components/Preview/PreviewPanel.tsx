import { memo, useRef, useEffect } from "react";
import { useEditorStore } from "../../stores/editorStore";
import "./PreviewPanel.css";

// ── Pinch-to-zoom constants ───────────────────────────────────────────────────
// macOS trackpad sends wheel events with ctrlKey=true for pinch gestures.
// deltaY values are typically small floats (±1–10 px in pixel deltaMode).
// A sensitivity of 0.008 gives a comfortable 0.8–1.2× scale per event.
const ZOOM_SENSITIVITY = 0.008;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

// usePinchZoom — attaches a wheel listener to `ref` and drives zoom via the
// store. Runs once (empty deps) — reads current zoom imperatively to avoid
// stale-closure issues during rapid pinch events.
function usePinchZoom(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // ctrlKey = true is how browsers report trackpad pinch on macOS.
      // Also catches Ctrl+scroll on all platforms.
      if (!e.ctrlKey) return;
      e.preventDefault();

      // Normalise to pixels (deltaMode 1 = lines, 2 = pages)
      const delta =
        e.deltaMode === 0 ? e.deltaY :
        e.deltaMode === 1 ? e.deltaY * 20 :
        e.deltaY * 300;

      const prevZoom = useEditorStore.getState().previewZoom;
      const scaleFactor = 1 - delta * ZOOM_SENSITIVITY;
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prevZoom * scaleFactor));

      // Zoom toward the cursor: keep the content point under the cursor
      // at the same screen position after the zoom.
      //
      //   contentY = scrollTop + cursorY          (before zoom)
      //   newScrollTop = contentY × (nextZoom / prevZoom) - cursorY
      //
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const ratio = nextZoom / prevZoom;
      const nextScrollLeft = (el.scrollLeft + cursorX) * ratio - cursorX;
      const nextScrollTop  = (el.scrollTop  + cursorY) * ratio - cursorY;

      useEditorStore.getState().setPreviewZoom(nextZoom);

      // Apply scroll after React re-renders the new zoom (next paint).
      requestAnimationFrame(() => {
        el.scrollLeft = nextScrollLeft;
        el.scrollTop  = nextScrollTop;
      });
    };

    // passive: false is required to call preventDefault() inside the handler.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── PreviewPanel ──────────────────────────────────────────────────────────────

export const PreviewPanel = memo(function PreviewPanel() {
  const pages          = useEditorStore((s) => s.previewPages);
  const loading        = useEditorStore((s) => s.previewLoading);
  const error          = useEditorStore((s) => s.previewError);
  const zoom           = useEditorStore((s) => s.previewZoom);
  const activeTabPath  = useEditorStore((s) => s.activeTabPath);

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

  if (error) {
    return (
      <div ref={panelRef} className="preview-panel preview-error">
        <div className="preview-error-icon">⚠</div>
        <pre className="preview-error-text">{error}</pre>
      </div>
    );
  }

  if (loading && pages.length === 0) {
    return (
      <div ref={panelRef} className="preview-panel preview-loading">
        <div className="preview-spinner" />
        <p>Compiling…</p>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div ref={panelRef} className="preview-panel preview-empty">
        <div className="preview-empty-icon">📄</div>
        <p>Preview will appear here</p>
        <p className="preview-empty-hint">Save a .typ file to render it</p>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`preview-panel${loading ? " preview-reloading" : ""}`}
    >
      {loading && <div className="preview-reload-indicator" />}
      <div
        className="preview-pages-content"
        style={{ "--preview-zoom": zoom } as React.CSSProperties}
      >
        {pages.map((svg, i) => (
          <div key={i} className="preview-page">
            {/*
              dangerouslySetInnerHTML is safe here — SVG content comes from
              tinymist, which compiles user-authored Typst files locally.
              No remote content or user-controlled HTML is injected.
            */}
            <div
              className="preview-page-inner"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <div className="preview-page-number">{i + 1}</div>
          </div>
        ))}
      </div>
    </div>
  );
});
