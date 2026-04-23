import { useEffect, useState } from "react";
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
  const [handle, setHandle] = useState<LspClientHandle | null>(null);

  useEffect(() => {
    if (!monaco) return;
    const h = startLspClient(monaco, setLspStatus);
    setHandle(h);
    return () => {
      h.stop();
      setHandle(null);
    };
  }, [monaco, setLspStatus]);

  return handle;
}
