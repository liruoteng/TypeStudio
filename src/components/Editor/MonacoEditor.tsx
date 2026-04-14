import { useRef, useCallback, useEffect } from "react";
import Editor, { OnMount, OnChange, useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { registerTypstLanguage } from "./typst-language";
import { useEditorStore } from "../../stores/editorStore";
import { useLspClient } from "../../hooks/useLspClient";
import "./MonacoEditor.css";

interface MonacoEditorProps {
  onSave?: (path: string, content: string) => void;
}

/** Convert a file path to an LSP URI. */
function pathToUri(path: string): string {
  // On macOS/Linux paths start with '/', on Windows they may start with a drive letter.
  return path.startsWith("/") ? `file://${path}` : `file:///${path}`;
}

export function MonacoEditor({ onSave }: MonacoEditorProps) {
  const monacoInstance = useMonaco();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const activeTab = useEditorStore((s) => s.activeTab());
  const updateTabContent = useEditorStore((s) => s.updateTabContent);

  const lspClient = useLspClient(monacoInstance);

  // Notify LSP when the active file changes
  const prevTabPath = useRef<string | null>(null);
  const changeVersions = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!lspClient || !activeTab) return;
    if (activeTab.path === prevTabPath.current) return;
    prevTabPath.current = activeTab.path;
    lspClient.notifyOpen(pathToUri(activeTab.path), activeTab.content);
  }, [lspClient, activeTab?.path]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    registerTypstLanguage(monaco);
    monaco.editor.setTheme("typst-dark");

    // Cmd/Ctrl+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const tab = useEditorStore.getState().activeTab();
      if (tab && onSave) {
        onSave(tab.path, tab.content);
        lspClient?.notifySave(pathToUri(tab.path));
      }
    });
  };

  const handleChange: OnChange = useCallback(
    (value) => {
      if (!activeTab || value === undefined) return;
      updateTabContent(activeTab.path, value);

      // Notify LSP of content change
      if (lspClient) {
        const uri = pathToUri(activeTab.path);
        const version = (changeVersions.current.get(uri) ?? 1) + 1;
        changeVersions.current.set(uri, version);
        lspClient.notifyChange(uri, value, version);
      }
    },
    [activeTab, updateTabContent, lspClient]
  );

  if (!activeTab) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-message">
          <div className="editor-empty-icon">✦</div>
          <p>Open a file to start editing</p>
          <p className="editor-empty-hint">Use the file explorer or click "Open Folder"</p>
        </div>
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      language="typst"
      theme="typst-dark"
      value={activeTab.content}
      path={activeTab.path}
      onChange={handleChange}
      onMount={handleMount}
      options={{
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontLigatures: true,
        lineNumbers: "on",
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        renderWhitespace: "selection",
        smoothScrolling: true,
        cursorBlinking: "smooth",
        bracketPairColorization: { enabled: true },
        padding: { top: 8, bottom: 8 },
        suggest: { showSnippets: true },
        quickSuggestions: { other: true, comments: false, strings: false },
      }}
    />
  );
}
