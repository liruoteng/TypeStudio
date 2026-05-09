/**
 * On explicit saves, pushes content to the preview pipeline.
 * - .typ: sidecar watches the file on disk, so nothing extra needed.
 * - .md / .markdown: converts in-memory content to Typst and writes to the
 *   temp .preview.typ file; tinymist's file watcher picks up the change.
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../stores/editorStore";

export interface SaveEvent {
  path: string;
  n: number;
}

export function usePreview(saveEvent: SaveEvent | null) {
  useEffect(() => {
    if (!saveEvent) return;
    const p = saveEvent.path;
    const isMd = p.endsWith(".md") || p.endsWith(".markdown");
    if (!p.endsWith(".typ") && !isMd) return;
    // Sidecar handles .typ files via file watching; .md needs conversion.
    if (!isMd) return;
    const tab = useEditorStore.getState().tabs.find((t) => t.path === p);
    if (!tab) return;
    invoke("write_preview_sidecar_content", { path: p, content: tab.content }).catch((e) => {
      console.error(e);
    });
  }, [saveEvent?.n]); // eslint-disable-line react-hooks/exhaustive-deps
}
