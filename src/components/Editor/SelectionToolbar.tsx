import { useState, useEffect, useRef, useCallback } from "react";
import { editorViewCtx } from "@milkdown/core";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { setBlockType, toggleMark } from "@milkdown/prose/commands";
import { TextSelection } from "@milkdown/prose/state";
import { wrapInList } from "@milkdown/prose/schema-list";
import "./SelectionToolbar.css";

interface SelToolbarProps {
  getEditor: () => { action: (fn: (ctx: unknown) => void) => void } | null;
}

interface FormatAction {
  id: string;
  label: string;
  icon: string;
  type: "mark" | "block";
}

const INLINE_ACTIONS: FormatAction[] = [
  { id: "bold",   label: "Bold",          icon: "B",  type: "mark" },
  { id: "italic", label: "Italic",        icon: "I",  type: "mark" },
  { id: "strike", label: "Strikethrough", icon: "S̶", type: "mark" },
  { id: "code",   label: "Code",          icon: "<>", type: "mark" },
  { id: "link",   label: "Link",          icon: "🔗", type: "mark" },
];

const BLOCK_ACTIONS: FormatAction[] = [
  { id: "h1",   label: "Heading 1",   icon: "H1", type: "block" },
  { id: "h2",   label: "Heading 2",   icon: "H2", type: "block" },
  { id: "h3",   label: "Heading 3",   icon: "H3", type: "block" },
  { id: "bullet", label: "Bullet List",  icon: "•", type: "block" },
  { id: "ordered", label: "Numbered List", icon: "1.", type: "block" },
  { id: "task",  label: "Task List",   icon: "☑", type: "block" },
];

const MARK_BY_ACTION: Record<string, string> = {
  bold: "strong",
  italic: "emphasis",
  strike: "strike_through",
  code: "inlineCode",
  link: "link",
};

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
      const { to, empty } = state.selection;
      if (empty) return;

      if (action.type === "mark") {
        const markName = MARK_BY_ACTION[action.id];
        const markType = markName ? state.schema.marks[markName] : null;
        if (!markType) return;

        const attrs = action.id === "link" ? { href: "url" } : null;
        const applied = toggleMark(markType, attrs)(state, dispatch);

        if (applied && action.id === "link") {
          const nextState = view.state;
          const linkEnd = Math.min(to, nextState.doc.content.size);
          view.dispatch(
            nextState.tr.setSelection(TextSelection.create(nextState.doc, linkEnd))
          );
        }
        return;
      }

      if (action.id === "h1" || action.id === "h2" || action.id === "h3") {
        const heading = state.schema.nodes.heading;
        if (!heading) return;
        setBlockType(heading, { level: Number(action.id[1]) })(state, dispatch);
        return;
      }

      if (action.id === "bullet" || action.id === "task") {
        const bulletList = state.schema.nodes.bullet_list;
        if (!bulletList) return;
        wrapInList(bulletList)(state, dispatch);
        if (action.id === "task") {
          const nextState = view.state;
          const { tr } = nextState;
          const from = Math.max(0, nextState.selection.from - 4);
          const to = Math.min(nextState.doc.content.size, nextState.selection.to + 4);
          let changed = false;
          tr.doc.nodesBetween(from, to, (node: ProseNode, pos: number) => {
            if (node.type.name === "list_item" && node.attrs.checked == null) {
              tr.setNodeAttribute(pos, "checked", false);
              changed = true;
            }
          });
          if (changed) dispatch(tr);
        }
        return;
      }

      if (action.id === "ordered") {
        const orderedList = state.schema.nodes.ordered_list;
        if (!orderedList) return;
        wrapInList(orderedList, { order: 1 })(state, dispatch);
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
