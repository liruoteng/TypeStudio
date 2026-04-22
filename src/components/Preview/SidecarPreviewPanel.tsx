import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";
import "./PreviewPanel.css";

/**
 * Embeds `tinymist preview` (spawned as a sidecar) in an <iframe>.
 *
 * Tinymist runs its full incremental vector-IR pipeline and ships the
 * built-in web frontend — so we inherit its perf characteristics without
 * re-implementing IncrSvgDocServer + the WASM renderer ourselves.
 *
 * The child process watches the file on disk: the editor's existing save
 * path (Cmd+S) is what triggers a recompile. Unsaved in-memory edits are
 * not reflected until save.
 */
export const SidecarPreviewPanel = memo(function SidecarPreviewPanel() {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const theme = useEditorStore((s) => s.theme);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track the latest request so a late-arriving response for an old path
  // doesn't overwrite the URL of a newer one.
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!activeTabPath || !activeTabPath.endsWith(".typ") || activeTabPath.startsWith("__temp__")) {
      setUrl(null);
      setError(null);
      invoke("stop_sidecar_preview").catch(() => {});
      return;
    }

    const id = ++reqIdRef.current;
    setError(null);
    setUrl(null);

    // Map app theme to tinymist's --invert-colors so the PDF background
    // follows the app rather than the OS. "dark" theme → inverted PDF;
    // "claude" (light) theme → normal white background.
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

  if (!activeTabPath || !activeTabPath.endsWith(".typ")) {
    return (
      <div className="preview-panel preview-empty">
        <div className="preview-empty-icon">📄</div>
        <p>Preview not available</p>
        <p className="preview-empty-hint">Open a .typ file to see a preview</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="preview-panel preview-error">
        <div className="preview-error-icon">⚠</div>
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
