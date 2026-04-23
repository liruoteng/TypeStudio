/**
 * Triggers a Tinymist SVG compile on explicit saves only.
 * Compilation is intentionally NOT triggered on every keystroke — the
 * auto-save in MonacoEditor fires 1.5 s after the last keystroke, which
 * provides live-ish preview without blocking the editor on heavy documents.
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../stores/editorStore";

export interface SaveEvent {
  path: string;
  n: number;
}

export function usePreview(saveEvent: SaveEvent | null) {
  const setPreviewLoading = useEditorStore((s) => s.setPreviewLoading);

  useEffect(() => {
    if (!saveEvent) return;
    const p = saveEvent.path;
    if (!p.endsWith(".typ") && !p.endsWith(".md") && !p.endsWith(".markdown")) return;
    setPreviewLoading(true);
    invoke("trigger_preview_compile", { path: saveEvent.path }).catch(console.error);
  }, [saveEvent?.n]); // eslint-disable-line react-hooks/exhaustive-deps
}
