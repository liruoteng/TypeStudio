import { useState, useEffect, useRef, useCallback } from "react";
import { editorViewCtx } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import "./SelectionToolbar.css";

interface SelToolbarProps {
  getEditor: () => { action: (fn: (ctx: unknown) => void) => void } | null;
}

interface FormatAction {
  id: string;
  label: string;
  icon: string;
  wrap?: string;
  prefix?: string;
  snippet?: string;
  cursorOffset?: number;
  selectLength?: number;
}

const INLINE_ACTIONS: FormatAction[] = [
  { id: "bold",   label: "Bold",          icon: "B",  wrap: "**" },
  { id: "italic", label: "Italic",        icon: "I",  wrap: "*" },
  { id: "strike", label: "Strikethrough", icon: "S̶", wrap: "~~" },
  { id: "code",   label: "Code",          icon: "<>", wrap: "`" },
  { id: "link",   label: "Link",          icon: "🔗", snippet: "[text](url)", cursorOffset: 1, selectLength: 4 },
];

const BLOCK_ACTIONS: FormatAction[] = [
  { id: "h1",   label: "Heading 1",   icon: "H1", prefix: "# " },
  { id: "h2",   label: "Heading 2",   icon: "H2", prefix: "## " },
  { id: "h3",   label: "Heading 3",   icon: "H3", prefix: "### " },
  { id: "bullet", label: "Bullet List",  icon: "•", prefix: "- " },
  { id: "ordered", label: "Numbered List", icon: "1.", prefix: "1. " },
  { id: "task",  label: "Task List",   icon: "☑", prefix: "- [ ] " },
];

export function SelectionToolbar({ getEditor }: SelToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setVisible(false);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      setVisible(false);
      return;
    }

    setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    setVisible(true);
  }, []);

  useEffect(() => {
    const onMouseUp = () => setTimeout(updatePosition, 0);
    const onKeyUp = () => setTimeout(updatePosition, 0);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [updatePosition]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setVisible(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible]);

  const applyFormat = useCallback((action: FormatAction) => {
    const editor = getEditor();
    if (!editor) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.action((ctx: any) => {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const { from, to, empty } = state.selection;
      if (empty) return;

      if (action.prefix) {
        const selectedText = state.doc.textBetween(from, to);
        const newText = `${action.prefix}${selectedText}`;
        const tr = state.tr.replaceWith(from, to, state.schema.text(newText));
        dispatch(tr);
      } else if (action.wrap) {
        const selectedText = state.doc.textBetween(from, to);
        const newText = `${action.wrap}${selectedText}${action.wrap}`;
        const tr = state.tr.replaceWith(from, to, state.schema.text(newText));
        dispatch(tr);
      } else if (action.snippet && action.id === "link") {
        const selectedText = state.doc.textBetween(from, to);
        const newText = `[${selectedText}](url)`;
        let tr = state.tr.replaceWith(from, to, state.schema.text(newText));
        const insertEnd = from + newText.length;
        const urlStart = from + selectedText.length + 3;
        tr = tr.setSelection(TextSelection.create(tr.doc, urlStart, insertEnd - 1));
        dispatch(tr);
      }
    });

    setVisible(false);
  }, [getEditor]);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {INLINE_ACTIONS.map((action) => (
        <button
          key={action.id}
          className="selection-toolbar-btn"
          onClick={() => applyFormat(action)}
          title={action.label}
        >
          {action.icon}
        </button>
      ))}
      <div className="selection-toolbar-sep" />
      {BLOCK_ACTIONS.map((action) => (
        <button
          key={action.id}
          className="selection-toolbar-btn"
          onClick={() => applyFormat(action)}
          title={action.label}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}
