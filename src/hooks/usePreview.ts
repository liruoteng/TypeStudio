/**
 * Triggers a Tinymist SVG compile in two ways:
 *
 *  1. Immediately on an explicit save (saveEvent changes).
 *  2. Adaptively-debounced on every content change — writes the current buffer
 *     to disk silently then compiles. The debounce delay is calculated from the
 *     previous compile duration: debounce = lastCompileMs * DEBOUNCE_FACTOR,
 *     capped at DEBOUNCE_MAX_MS. Short documents compile in <50 ms so the delay
 *     is imperceptible (≈instant); long documents self-tune to a comfortable lag.
 *
 * IMPORTANT: the content-watching path uses Zustand's imperative `subscribe`
 * (not a reactive selector hook) so that the host component (App) is never
 * re-rendered on keystrokes. A reactive `useEditorStore((s) => s.activeTab())`
 * inside the hook returns a new object on every keystroke, which previously
 * caused App → PreviewPanel to re-render and string-compare megabyte SVGs on
 * every character typed.
 */
import { useEffect, useRef } from "react";
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

// Adaptive debounce: next delay = lastCompileMs * FACTOR, capped at MAX.
// Examples at factor 0.3:
//   50 ms compile  →  15 ms debounce  (effectively instant)
//  500 ms compile  → 150 ms debounce  (barely perceptible)
//    2 s compile   → 600 ms debounce  (user finishes typing before recompile)
//    5 s compile   →   2 s debounce   (capped)
const DEBOUNCE_FACTOR = 0.3;
const DEBOUNCE_MAX_MS = 2000;

export function usePreview(saveEvent: SaveEvent | null) {
  const setPreview = useEditorStore((s) => s.setPreview);
  const setPreviewLoading = useEditorStore((s) => s.setPreviewLoading);
  const setPreviewError = useEditorStore((s) => s.setPreviewError);

  // Tracks the duration of the last successful compile to drive adaptive debounce.
  const lastCompileMsRef = useRef<number>(0);

  // Stable compile helper via ref — always has the latest store callbacks
  // without needing to be listed as an effect dependency.
  const compileRef = useRef<((path: string) => Promise<void>) | null>(null);
  compileRef.current = async (path: string) => {
    setPreviewLoading(true);
    const t0 = performance.now();
    try {
      const result = await invoke<CompileResult>("compile_to_svg", { path });
      lastCompileMsRef.current = performance.now() - t0;
      setPreview(result.pages);
    } catch (err) {
      setPreviewError(String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── 1. Explicit save: compile immediately ──────────────────────────────────
  useEffect(() => {
    if (!saveEvent || !saveEvent.path.endsWith(".typ")) return;

    let cancelled = false;
    setPreviewLoading(true);

    invoke<CompileResult>("compile_to_svg", { path: saveEvent.path })
      .then((r) => { if (!cancelled) setPreview(r.pages); })
      .catch((e: unknown) => { if (!cancelled) setPreviewError(String(e)); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });

    return () => { cancelled = true; };
  }, [saveEvent?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Content change: debounced write → compile ───────────────────────────
  // Uses Zustand's imperative subscribe so this hook does NOT cause App to
  // re-render on every keystroke. Only fires side-effects when path or content
  // actually changes.
  useEffect(() => {
    const timerRef = { id: undefined as ReturnType<typeof setTimeout> | undefined };
    let lastPath = "";
    let lastContent = "";

    const unsubscribe = useEditorStore.subscribe((state) => {
      const tab = state.activeTab();
      if (!tab || !tab.path.endsWith(".typ")) return;
      // Skip if nothing relevant changed (e.g. loading/error state updates)
      if (tab.path === lastPath && tab.content === lastContent) return;

      lastPath = tab.path;
      lastContent = tab.content;

      // Reset debounce timer using the adaptive delay from the last compile.
      clearTimeout(timerRef.id);
      const { path, content } = tab;
      const delay = Math.min(lastCompileMsRef.current * DEBOUNCE_FACTOR, DEBOUNCE_MAX_MS);
      timerRef.id = setTimeout(async () => {
        try {
          await invoke("write_file", { path, contents: content });
          await compileRef.current?.(path);
        } catch {
          // Silently ignore (read-only FS, etc.)
        }
      }, delay);
    });

    return () => {
      unsubscribe();
      clearTimeout(timerRef.id);
    };
  }, []); // Run once — subscribe lives for the component lifetime
}
