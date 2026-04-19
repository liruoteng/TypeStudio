/**
 * Triggers a Tinymist SVG compile on explicit saves only.
 * Compilation is intentionally NOT triggered on every keystroke — the
 * auto-save in MonacoEditor fires 1.5 s after the last keystroke, which
 * provides live-ish preview without blocking the editor on heavy documents.
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../stores/editorStore";

interface CompileResult {
  pages: string[];
  warnings: string;
}

export interface SaveEvent {
  path: string;
  n: number; // increments on every save so the same path re-triggers
}

export function usePreview(saveEvent: SaveEvent | null) {
  const setPreview = useEditorStore((s) => s.setPreview);
  const setPreviewLoading = useEditorStore((s) => s.setPreviewLoading);
  const setPreviewError = useEditorStore((s) => s.setPreviewError);
  const setLastCompileMs = useEditorStore((s) => s.setLastCompileMs);

  // ── Explicit save → compile immediately ───────────────────────────────────
  useEffect(() => {
    if (!saveEvent || !saveEvent.path.endsWith(".typ")) return;

    let cancelled = false;
    setPreviewLoading(true);
    const t0 = performance.now();

    invoke<CompileResult>("compile_to_svg", { path: saveEvent.path })
      .then((r) => {
        if (!cancelled) {
          setLastCompileMs(performance.now() - t0);
          setPreview(r.pages);
        }
      })
      .catch((e: unknown) => { if (!cancelled) setPreviewError(String(e)); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });

    return () => { cancelled = true; };
  }, [saveEvent?.n]); // eslint-disable-line react-hooks/exhaustive-deps
}
