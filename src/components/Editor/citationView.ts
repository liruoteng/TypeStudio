import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { EditorView } from "@milkdown/prose/view";
import { $view, $nodeSchema } from "@milkdown/utils";
import type { Ctx } from "@milkdown/ctx";
import { useEditorStore } from "../../stores/editorStore";

// ── mdast citation node type ─────────────────────────────────────────────────

export interface CitationMdastNode {
  type: "citation";
  key: string;
}

// ── Remark plugin: transform [@key] → citation nodes ─────────────────────────

const CITATION_REGEX = /\[@([^\]]+)\]/g;

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  key?: string;
}

function walkTree(node: MdastNode) {
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.type === "text" && child.value) {
        const value = child.value;
        const matches = Array.from(value.matchAll(CITATION_REGEX));
        if (matches.length > 0) {
          const newChildren: MdastNode[] = [];
          let lastIndex = 0;

          for (const match of matches) {
            const start = match.index!;
            if (start > lastIndex) {
              newChildren.push({
                type: "text",
                value: value.slice(lastIndex, start),
              });
            }
            // Split multi-cite: [@a; @b] → two citation nodes
            const keys = match[1].split(";").map((k) => k.trim().replace(/^@/, "")).filter(Boolean);
            for (const key of keys) {
              newChildren.push({ type: "citation", key });
            }
            lastIndex = start + match[0].length;
          }

          if (lastIndex < value.length) {
            newChildren.push({
              type: "text",
              value: value.slice(lastIndex),
            });
          }

          node.children.splice(i, 1, ...newChildren);
          i += newChildren.length - 1;
        }
      } else {
        walkTree(child);
      }
    }
  }
}

export function remarkCitationPlugin() {
  return (tree: MdastNode) => {
    walkTree(tree);
  };
}

// ── Milkdown schema ──────────────────────────────────────────────────────────

export const citationSchema = $nodeSchema("citation", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: {
    key: { default: "" },
  },
  parseDOM: [
    {
      tag: "span[data-citation-key]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return false;
        return { key: dom.dataset.citationKey || "" };
      },
    },
  ],
  toDOM: (node) => {
    return [
      "span",
      {
        class: "citation-tag",
        "data-citation-key": node.attrs.key as string,
      },
      `[${node.attrs.key as string}]`,
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === "citation",
    runner: (state, node, type) => {
      const key = (node as unknown as CitationMdastNode).key;
      state.addNode(type, { key });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "citation",
    runner: (state, node) => {
      const key = node.attrs.key as string;
      state.addNode("text", undefined, `[@${key}]`);
    },
  },
}));

// ── NodeView: blue tag with reference lookup ─────────────────────────────────

export class CitationView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private node: ProseNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private label: HTMLElement;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const span = document.createElement("span");
    span.classList.add("citation-tag");
    span.contentEditable = "false";

    this.label = document.createElement("span");
    this.label.className = "citation-tag-label";
    span.appendChild(this.label);

    const actions = document.createElement("span");
    actions.className = "citation-tag-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "citation-tag-action";
    editBtn.textContent = "Edit";
    editBtn.title = "Edit citation key";
    editBtn.addEventListener("click", this.handleEdit);
    actions.appendChild(editBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "citation-tag-action citation-tag-action--danger";
    removeBtn.textContent = "Remove";
    removeBtn.title = "Remove citation";
    removeBtn.addEventListener("click", this.handleRemove);
    actions.appendChild(removeBtn);

    span.appendChild(actions);

    this.dom = span;
    this.render();
  }

  stopEvent(event: Event): boolean {
    return (event.target as HTMLElement).closest(".citation-tag-action") !== null;
  }

  private displayForKey(key: string) {
    const refs = useEditorStore.getState().references;
    const ref = refs.find((r) => r.bibKey === key);
    if (!ref) return { display: `[@${key}]`, missing: true };

    const author = ref.authors?.[0]?.split(",").pop()?.trim() || ref.authors?.[0] || "";
    const family = author.split(" ").pop() || author;
    if (family && ref.year) return { display: `[${family} ${ref.year}]`, missing: false };
    if (ref.title) return { display: `[${ref.title.slice(0, 20)}]`, missing: false };
    return { display: `[${key}]`, missing: false };
  }

  private render() {
    const key = this.node.attrs.key as string;
    const { display, missing } = this.displayForKey(key);
    this.dom.dataset.citationKey = key;
    this.dom.classList.toggle("citation-tag--missing", missing);
    this.dom.title = missing ? `Missing reference: ${key}` : `Citation: ${key}`;
    this.label.textContent = display;
  }

  private handleEdit = (event: MouseEvent) => {
    event.preventDefault();
    const currentKey = (this.node.attrs.key as string) || "";
    const nextKey = window.prompt("Citation key", currentKey);
    if (nextKey === null) return;

    const cleanKey = nextKey.trim().replace(/^@/, "");
    if (!cleanKey) return;

    const pos = this.getPos();
    if (pos === undefined) return;

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        key: cleanKey,
      })
    );
  };

  private handleRemove = (event: MouseEvent) => {
    event.preventDefault();
    const pos = this.getPos();
    if (pos === undefined) return;

    this.view.dispatch(
      this.view.state.tr.delete(pos, pos + this.node.nodeSize)
    );
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "citation") return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.dom.remove();
  }
}

export const citationViewPlugin = $view(citationSchema.node, (_ctx: Ctx) => {
  return ((node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
    return new CitationView(node, view, getPos);
  }) as NodeViewConstructor;
});
