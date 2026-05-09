import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, AlertTriangle } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import "./PreviewPanel.css";

function isPreviewablePath(path: string | null): boolean {
  if (!path) return false;
  return path.endsWith(".typ") || path.endsWith(".md") || path.endsWith(".markdown");
}

/**
 * Embeds `tinymist preview` (spawned as a sidecar) in an <iframe>.
 *
 * For .typ files: tinymist watches the file on disk; auto-save triggers
 * recompilation.
 * For .md / .markdown files: the content is converted to Typst and written
 * to a sibling `.filename.preview.typ` file before tinymist starts. The
 * frontend pushes in-memory changes via `write_preview_sidecar_content`,
 * which tinymist picks up through its file watcher.
 */
export const SidecarPreviewPanel = memo(function SidecarPreviewPanel() {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const theme = useEditorStore((s) => s.theme);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!activeTabPath || !isPreviewablePath(activeTabPath) || activeTabPath.startsWith("__temp__")) {
      setUrl(null);
      setError(null);
      invoke("stop_sidecar_preview").catch(() => {});
      return;
    }

    const id = ++reqIdRef.current;
    setError(null);
    setUrl(null);

    const invertColors = theme === "dark" ? "always" : "never";

    invoke<string>("start_sidecar_preview", { path: activeTabPath, invertColors })
      .then((serverUrl) => {
        if (reqIdRef.current !== id) return;
        setUrl(serverUrl);
      })
      .catch((e) => {
        if (reqIdRef.current !== id) return;
        setError(typeof e === "string" ? e : String(e));
      });
  }, [activeTabPath, theme]);

  // On unmount, shut down the child. Re-activations will restart it.
  useEffect(() => {
    return () => {
      invoke("stop_sidecar_preview").catch(() => {});
    };
  }, []);

  if (!activeTabPath || !isPreviewablePath(activeTabPath)) {
    return (
      <div className="preview-panel preview-empty">
        <div className="preview-empty-icon"><FileText size={44} /></div>
        <p>Preview not available</p>
        <p className="preview-empty-hint">Open a .typ or .md file to see a preview</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="preview-panel preview-error">
        <div className="preview-error-icon"><AlertTriangle size={44} /></div>
        <pre className="preview-error-text">{error}</pre>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="preview-panel preview-loading">
        <div className="preview-spinner" />
        <p>Starting preview server…</p>
      </div>
    );
  }

  return (
    <iframe
      title="Typst Preview"
      src={url}
      style={{ width: "100%", height: "100%", border: "none", background: "white" }}
    />
  );
});
