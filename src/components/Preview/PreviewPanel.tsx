import { memo } from "react";
import { useEditorStore } from "../../stores/editorStore";
import "./PreviewPanel.css";

export const PreviewPanel = memo(function PreviewPanel() {
  const pages = useEditorStore((s) => s.previewPages);
  const loading = useEditorStore((s) => s.previewLoading);
  const error = useEditorStore((s) => s.previewError);

  if (error) {
    return (
      <div className="preview-panel preview-error">
        <div className="preview-error-icon">⚠</div>
        <pre className="preview-error-text">{error}</pre>
      </div>
    );
  }

  if (loading && pages.length === 0) {
    return (
      <div className="preview-panel preview-loading">
        <div className="preview-spinner" />
        <p>Compiling…</p>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="preview-panel preview-empty">
        <div className="preview-empty-icon">📄</div>
        <p>Preview will appear here</p>
        <p className="preview-empty-hint">Save a .typ file to render it</p>
      </div>
    );
  }

  return (
    <div className={`preview-panel preview-pages${loading ? " preview-reloading" : ""}`}>
      {loading && <div className="preview-reload-indicator" />}
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
  );
});
