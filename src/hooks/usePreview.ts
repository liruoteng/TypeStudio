/**
 * Triggers a Tinymist SVG compile in two ways:
 *
 *  1. Immediately on an explicit save (saveEvent changes).
 *  2. Adaptively-debounced on every content change — writes the current buffer
 *     to disk silently then compiles. The debounce delay is derived from the
 *     previous compile duration so short documents feel instant while long ones
 *     self-tune to avoid queuing up redundant compiles.
 *
 * The content-watching path uses Zustand's imperative `store.subscribe` so it
 * NEVER causes the host component (App) to re-render on keystrokes.
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

// Adaptive debounce: delay = lastCompileMs * FACTOR, clamped to [MIN, MAX].
const DEBOUNCE_FACTOR = 0.3;
const DEBOUNCE_MIN_MS = 150;   // never fire faster than this
const DEBOUNCE_MAX_MS = 2000;  // never wait longer than this

export function usePreview(saveEvent: SaveEvent | null) {
  const setPreview = useEditorStore((s) => s.setPreview);
  const setPreviewLoading = useEditorStore((s) => s.setPreviewLoading);
  const setPreviewError = useEditorStore((s) => s.setPreviewError);

  // Tracks the last compile duration to drive adaptive debounce.
  const lastCompileMsRef = useRef<number>(500); // start with a sensible default

  // Stable compile helper — always captures the latest store callbacks via ref
  // so the subscribe closure never becomes stale.
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

  // ── 1. Explicit save → compile immediately ────────────────────────────────
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

  // ── 2. Content change → debounced write + compile ─────────────────────────
  // Uses store.subscribe (imperative, no React re-renders) so keystrokes are
  // never slowed by this hook. Reads directly from state.tabs /
  // state.activeTabPath — avoids calling state.activeTab() which goes through
  // an internal get() and can behave unexpectedly in subscribe callbacks.
  useEffect(() => {
    const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
    let lastPath = "";
    let lastContent = "";

    const unsubscribe = useEditorStore.subscribe((state) => {
      const { tabs, activeTabPath } = state;
      if (!activeTabPath) return;

      // Find the active tab directly — avoids calling state.activeTab()
      const tab = tabs.find((t) => t.path === activeTabPath);
      if (!tab || !tab.path.endsWith(".typ")) return;

      // Skip if nothing meaningful changed (e.g. previewLoading toggled)
      if (tab.path === lastPath && tab.content === lastContent) return;
      lastPath = tab.path;
      lastContent = tab.content;

      // Reset debounce — adaptive delay based on how long the last compile took
      clearTimeout(timer.id);
      const { path, content } = tab;
      const delay = Math.min(
        Math.max(lastCompileMsRef.current * DEBOUNCE_FACTOR, DEBOUNCE_MIN_MS),
        DEBOUNCE_MAX_MS,
      );
      timer.id = setTimeout(async () => {
        try {
          // Write the buffer to disk so tinymist reads the latest content.
          // We intentionally skip markTabClean — dirty state tracks explicit saves.
          await invoke("write_file", { path, contents: content });
          await compileRef.current?.(path);
        } catch {
          // Silently ignore write failures (read-only FS, etc.)
        }
      }, delay);
    });

    return () => {
      unsubscribe();
      clearTimeout(timer.id);
    };
  }, []); // Run once — the subscribe lives for the component lifetime
}
