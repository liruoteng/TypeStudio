import { useRef, useCallback, useEffect, useState } from "react";
import Editor, { OnMount, OnChange, useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { registerTypstLanguage } from "./typst-language";
import { useEditorStore } from "../../stores/editorStore";
import { useLspClient } from "../../hooks/useLspClient";
import { SlashMenu, type SlashCommand } from "./SlashMenu";
import "./MonacoEditor.css";

interface MonacoEditorProps {
  onSave?: (path: string, content: string) => void;
  onSnapshot?: (path: string) => void;
  /** When seq increments, restore content imperatively into the editor. */
  externalContent?: { content: string; seq: number };
}

function pathToUri(path: string): string {
  return path.startsWith("/") ? `file://${path}` : `file:///${path}`;
}

function getFileLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    typ: "typst",
    js: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", mts: "typescript", cts: "typescript",
    jsx: "javascript", tsx: "typescript",
    json: "json", jsonc: "json",
    html: "html", htm: "html",
    css: "css", scss: "scss", less: "less",
    md: "markdown", mdx: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c", h: "c",
    cpp: "cpp", hpp: "cpp", cc: "cpp",
    sh: "shell", bash: "shell", zsh: "shell",
    yaml: "yaml", yml: "yaml",
    xml: "xml",
    sql: "sql",
    lua: "lua",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    cs: "csharp",
    r: "r",
    toml: "ini",
  };
  return map[ext] ?? "plaintext";
}

/** Walk `snippet` by `offset` chars from `start`, respecting newlines. */
function snippetOffsetToPosition(snippet: string, start: Monaco.IPosition, offset: number): Monaco.IPosition {
  let line = start.lineNumber;
  let col = start.column;
  for (let i = 0; i < offset; i++) {
    if (snippet[i] === "\n") { line++; col = 1; } else { col++; }
  }
  return { lineNumber: line, column: col };
}

export function MonacoEditor({ onSave, onSnapshot, externalContent }: MonacoEditorProps) {
  const monacoInstance = useMonaco();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  // Subscribe only to the active path (a string), NOT to the full Tab object.
  // The full Tab includes `content`, which changes on every keystroke via
  // updateTabContent. Subscribing to the full Tab causes MonacoEditor to
  // re-render on each keystroke, which feeds the new `value` prop into
  // @monaco-editor/react, which calls model.pushEditOperations() — very slow.
  const activeTabPath  = useEditorStore((s) => s.activeTabPath);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const appTheme       = useEditorStore((s) => s.theme);
  const monacoTheme    = appTheme === "claude" ? "typst-light" : "typst-dark";
  const editorFontSize = useEditorStore((s) => s.editorFontSize);
  const setLastEditTime = useEditorStore((s) => s.setLastEditTime);
  const scrollToLine   = useEditorStore((s) => s.scrollToLine);
  const setScrollToLine = useEditorStore((s) => s.setScrollToLine);
  const writingMode    = useEditorStore((s) => s.writingMode);

  // The value passed to Monaco: only updated when the path changes (tab switch),
  // never on content edits. Monaco manages its own model content while typing.
  const [editorFile, setEditorFile] = useState<{ path: string; content: string } | null>(() => {
    const tab = useEditorStore.getState().activeTab();
    return tab ? { path: tab.path, content: tab.content } : null;
  });

  const lspClient = useLspClient(monacoInstance);
  const prevTabPath = useRef<string | null>(null);
  const changeVersions = useRef<Map<string, number>>(new Map());
  const lspChangeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);

  // Slash menu state
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; filter: string } | null>(null);
  const slashStartPos = useRef<Monaco.IPosition | null>(null);
  const isInsertingRef = useRef(false);

  // Writing mode decorations collection
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

  // When the active tab path changes (tab switch), load the new file's content
  // from the store snapshot and refresh Monaco's value + notify LSP.
  useEffect(() => {
    const tab = useEditorStore.getState().activeTab();
    setEditorFile(tab ? { path: tab.path, content: tab.content } : null);

    // Close slash menu on tab switch
    setSlashMenu(null);
    slashStartPos.current = null;

    if (lspClient && tab && tab.path !== prevTabPath.current) {
      prevTabPath.current = tab.path;
      lspClient.notifyOpen(pathToUri(tab.path), tab.content);
    }
  }, [activeTabPath, lspClient]);

  // Switch Monaco theme live when the app theme changes
  useEffect(() => {
    if (monacoInstance) {
      monacoInstance.editor.setTheme(monacoTheme);
    }
  }, [monacoTheme, monacoInstance]);

  // Update font size dynamically when store changes
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorFontSize });
  }, [editorFontSize]);

  // Scroll editor to line when preview requests it
  useEffect(() => {
    if (scrollToLine === null || !editorRef.current) return;
    editorRef.current.revealLineInCenter(scrollToLine);
    setScrollToLine(null);
  }, [scrollToLine, setScrollToLine]);

  // Imperatively restore content when a snapshot is loaded
  useEffect(() => {
    if (!externalContent || !editorRef.current) return;
    editorRef.current.setValue(externalContent.content);
    const path = useEditorStore.getState().activeTabPath;
    if (path) useEditorStore.getState().updateTabContent(path, externalContent.content);
  }, [externalContent?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply / remove writing mode options when the flag changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (writingMode) {
      editor.updateOptions({
        fontFamily: '"Georgia", "Times New Roman", serif',
        fontLigatures: false,
        lineNumbers: "off",
        minimap: { enabled: false },
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 0,
        renderLineHighlight: "none",
        wordWrap: "on",
        padding: { top: 24, bottom: 24 },
      });
    } else {
      editor.updateOptions({
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontLigatures: true,
        lineNumbers: "on",
        minimap: { enabled: true },
        glyphMargin: true,
        folding: true,
        lineDecorationsWidth: 10,
        lineNumbersMinChars: 5,
        renderLineHighlight: "line",
        wordWrap: "on",
        padding: { top: 8, bottom: 8 },
      });
      decorationsRef.current?.clear();
    }
  }, [writingMode]);

  // Recompute writing mode decorations when content or mode changes
  useEffect(() => {
    if (!writingMode) return;
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    if (!decorationsRef.current) {
      decorationsRef.current = editor.createDecorationsCollection([]);
    }

    function computeDecorations(): Monaco.editor.IModelDeltaDecoration[] {
      const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
      const lineCount = model!.getLineCount();
      for (let ln = 1; ln <= lineCount; ln++) {
        const text = model!.getLineContent(ln);

        // Headings: lines starting with = signs
        const headingMatch = text.match(/^(={1,6})\s/);
        if (headingMatch) {
          const level = Math.min(headingMatch[1].length, 3);
          decorations.push({
            range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: text.length + 1 },
            options: { inlineClassName: `wm-h${level}` },
          });
          continue;
        }

        // Bold: *text*
        let boldMatch: RegExpExecArray | null;
        const boldRe = /\*([^*\n]+)\*/g;
        while ((boldMatch = boldRe.exec(text)) !== null) {
          decorations.push({
            range: {
              startLineNumber: ln, startColumn: boldMatch.index + 1,
              endLineNumber: ln, endColumn: boldMatch.index + boldMatch[0].length + 1,
            },
            options: { inlineClassName: "wm-bold" },
          });
        }

        // Italic: _text_
        let italicMatch: RegExpExecArray | null;
        const italicRe = /_([^_\n]+)_/g;
        while ((italicMatch = italicRe.exec(text)) !== null) {
          decorations.push({
            range: {
              startLineNumber: ln, startColumn: italicMatch.index + 1,
              endLineNumber: ln, endColumn: italicMatch.index + italicMatch[0].length + 1,
            },
            options: { inlineClassName: "wm-italic" },
          });
        }

        // Inline code: `code`
        let codeMatch: RegExpExecArray | null;
        const codeRe = /`([^`\n]+)`/g;
        while ((codeMatch = codeRe.exec(text)) !== null) {
          decorations.push({
            range: {
              startLineNumber: ln, startColumn: codeMatch.index + 1,
              endLineNumber: ln, endColumn: codeMatch.index + codeMatch[0].length + 1,
            },
            options: { inlineClassName: "wm-code" },
          });
        }
      }
      return decorations;
    }

    decorationsRef.current.set(computeDecorations());

    const disposable = model.onDidChangeContent(() => {
      if (!useEditorStore.getState().writingMode) return;
      decorationsRef.current?.set(computeDecorations());
    });
    return () => disposable.dispose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingMode, editorFile?.path]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    registerTypstLanguage(monaco);
    monaco.editor.setTheme(useEditorStore.getState().theme === "claude" ? "typst-light" : "typst-dark");

    // Read path and content directly from Monaco / store snapshot at save time
    // so this closure doesn't need to close over any reactive state.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useEditorStore.getState().activeTabPath;
      const content = editor.getValue();
      if (path && onSave) {
        onSave(path, content);
        lspClient?.notifySave(pathToUri(path));
        onSnapshotRef.current?.(path);
      }
    });

    // Slash command menu: trigger when '/' is typed at the start of a line
    // (preceded only by optional whitespace), update filter as user continues typing.
    editor.onDidChangeModelContent((e) => {
      if (isInsertingRef.current) return;

      const model = editor.getModel();
      if (!model) return;

      for (const change of e.changes) {
        if (change.text === "/") {
          const lineContent = model.getLineContent(change.range.startLineNumber);
          const beforeSlash = lineContent.substring(0, change.range.startColumn - 1);
          if (beforeSlash.trim() === "") {
            const slashPos: Monaco.IPosition = {
              lineNumber: change.range.startLineNumber,
              column: change.range.startColumn,
            };
            slashStartPos.current = slashPos;
            const pixelPos = editor.getScrolledVisiblePosition(slashPos);
            const editorDom = editor.getDomNode();
            if (pixelPos && editorDom) {
              const rect = editorDom.getBoundingClientRect();
              setSlashMenu({
                x: rect.left + pixelPos.left,
                y: rect.top + pixelPos.top + pixelPos.height + 4,
                filter: "",
              });
            }
            return;
          }
        }
      }

      // Update filter if the slash menu is open
      if (!slashStartPos.current) return;
      const cursor = editor.getPosition();
      const slashStart = slashStartPos.current;
      if (!cursor || cursor.lineNumber !== slashStart.lineNumber || cursor.column <= slashStart.column) {
        setSlashMenu(null);
        slashStartPos.current = null;
        return;
      }
      const lineContent = model.getLineContent(cursor.lineNumber);
      const filter = lineContent.substring(slashStart.column, cursor.column - 1);
      if (filter.includes(" ")) {
        setSlashMenu(null);
        slashStartPos.current = null;
      } else {
        setSlashMenu((prev) => (prev ? { ...prev, filter } : null));
      }
    });
  };

  const handleChange: OnChange = useCallback(
    (value) => {
      if (!activeTabPath || value === undefined) return;

      // Keep the store updated so the preview debounce and dirty indicator work.
      updateTabContent(activeTabPath, value);
      setLastEditTime(Date.now());

      // Auto-save 1.5 s after the last keystroke
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        if (onSave) onSave(activeTabPath, value);
      }, 1500);

      // Notify LSP of content change — debounced to avoid serializing the full
      // document text on every keystroke, which stalls the event loop for large files.
      if (lspClient) {
        const uri = pathToUri(activeTabPath);
        const version = (changeVersions.current.get(uri) ?? 1) + 1;
        changeVersions.current.set(uri, version);
        clearTimeout(lspChangeTimer.current);
        lspChangeTimer.current = setTimeout(() => {
          lspClient.notifyChange(uri, value, version);
        }, 200);
      }
    },
    [activeTabPath, updateTabContent, lspClient, onSave, setLastEditTime]
  );

  const handleSlashSelect = useCallback((command: SlashCommand) => {
    const editor = editorRef.current;
    if (!editor || !slashStartPos.current) return;
    const slashPos = slashStartPos.current;
    const cursor = editor.getPosition();
    if (!cursor) return;

    isInsertingRef.current = true;
    editor.executeEdits("slash-menu", [
      {
        range: {
          startLineNumber: slashPos.lineNumber,
          startColumn: slashPos.column,
          endLineNumber: cursor.lineNumber,
          endColumn: cursor.column,
        },
        text: command.snippet,
      },
    ]);
    isInsertingRef.current = false;

    // Place cursor / selection at the logical edit point within the snippet.
    const offset = command.cursorOffset ?? command.snippet.length;
    const anchorPos = snippetOffsetToPosition(command.snippet, slashPos, offset);
    const selectLen = command.selectLength ?? 0;
    if (selectLen > 0) {
      const activePos = snippetOffsetToPosition(command.snippet, slashPos, offset + selectLen);
      editor.setSelection({
        startLineNumber: anchorPos.lineNumber,
        startColumn: anchorPos.column,
        endLineNumber: activePos.lineNumber,
        endColumn: activePos.column,
      });
    } else {
      editor.setPosition(anchorPos);
    }

    setSlashMenu(null);
    slashStartPos.current = null;
    editor.focus();
  }, []);

  const handleSlashClose = useCallback(() => {
    setSlashMenu(null);
    slashStartPos.current = null;
    editorRef.current?.focus();
  }, []);

  if (!editorFile) {
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

  const editorOptions: Monaco.editor.IStandaloneEditorConstructionOptions = writingMode
    ? {
        fontSize: editorFontSize,
        fontFamily: '"Georgia", "Times New Roman", serif',
        fontLigatures: false,
        lineNumbers: "off" as const,
        minimap: { enabled: false },
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 0,
        renderLineHighlight: "none" as const,
        scrollBeyondLastLine: false,
        wordWrap: "on" as const,
        tabSize: 2,
        renderWhitespace: "none" as const,
        smoothScrolling: true,
        cursorBlinking: "smooth" as const,
        padding: { top: 24, bottom: 24 },
        suggest: { showSnippets: true },
        quickSuggestions: { other: true, comments: false, strings: false },
      }
    : {
        fontSize: editorFontSize,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontLigatures: true,
        lineNumbers: "on" as const,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: "on" as const,
        tabSize: 2,
        renderWhitespace: "selection" as const,
        smoothScrolling: true,
        cursorBlinking: "smooth" as const,
        bracketPairColorization: { enabled: true },
        padding: { top: 8, bottom: 8 },
        suggest: { showSnippets: true },
        quickSuggestions: { other: true, comments: false, strings: false },
      };

  return (
    <div className={writingMode ? "editor-writing-mode" : undefined} style={writingMode ? { height: "100%" } : undefined}>
      <Editor
        height="100%"
        language={getFileLanguage(editorFile.path)}
        theme={monacoTheme}
        value={editorFile.content}
        path={editorFile.path}
        onChange={handleChange}
        onMount={handleMount}
        options={editorOptions}
      />
      {slashMenu && (
        <SlashMenu
          x={slashMenu.x}
          y={slashMenu.y}
          filter={slashMenu.filter}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
        />
      )}
    </div>
  );
}
