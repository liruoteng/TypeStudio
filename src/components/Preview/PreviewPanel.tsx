import "./PreviewPanel.css";

interface PreviewPanelProps {
  svgPages?: string[];   // SVG strings from Tinymist export
  isLoading?: boolean;
  error?: string | null;
}

export function PreviewPanel({ svgPages = [], isLoading, error }: PreviewPanelProps) {
  if (error) {
    return (
      <div className="preview-panel preview-error">
        <div className="preview-error-icon">⚠</div>
        <pre className="preview-error-text">{error}</pre>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="preview-panel preview-loading">
        <div className="preview-spinner" />
        <p>Compiling…</p>
      </div>
    );
  }

  if (svgPages.length === 0) {
    return (
      <div className="preview-panel preview-empty">
        <div className="preview-empty-icon">📄</div>
        <p>Preview will appear here</p>
        <p className="preview-empty-hint">Save a .typ file to see the rendered output</p>
      </div>
    );
  }

  return (
    <div className="preview-panel preview-pages">
      {svgPages.map((svg, i) => (
        <div key={i} className="preview-page">
          <div
            className="preview-page-inner"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ))}
    </div>
  );
}
