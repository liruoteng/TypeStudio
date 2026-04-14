import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { startLspClient, LspClientHandle } from "../components/Editor/lsp-client";
import { useEditorStore } from "../stores/editorStore";

/**
 * Starts the Tinymist LSP client once Monaco is available.
 * LSP status is written into the global Zustand store.
 */
export function useLspClient(
  monaco: typeof Monaco | null
): LspClientHandle | null {
  const setLspStatus = useEditorStore((s) => s.setLspStatus);
  const handleRef = useRef<LspClientHandle | null>(null);

  useEffect(() => {
    if (!monaco) return;
    if (handleRef.current) return;
    const handle = startLspClient(monaco, setLspStatus);
    handleRef.current = handle;
    return () => {
      handle.stop();
      handleRef.current = null;
    };
  }, [monaco, setLspStatus]);

  return handleRef.current;
}
