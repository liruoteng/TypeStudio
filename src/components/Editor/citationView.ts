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

  constructor(node: ProseNode) {
    const key = node.attrs.key as string;
    const refs = useEditorStore.getState().references;
    const ref = refs.find((r) => r.bibKey === key);

    const span = document.createElement("span");
    span.classList.add("citation-tag");
    span.dataset.citationKey = key;
    span.contentEditable = "false";

    // Display: try to show [Author Year], fallback to [@key]
    let display = `[${key}]`;
    if (ref) {
      const author = ref.authors?.[0]?.split(",").pop()?.trim() || ref.authors?.[0] || "";
      const family = author.split(" ").pop() || author;
      if (family && ref.year) {
        display = `[${family} ${ref.year}]`;
      } else if (ref.title) {
        display = `[${ref.title.slice(0, 20)}]`;
      }
    }
    span.textContent = display;

    this.dom = span;
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "citation") return false;
    const key = node.attrs.key as string;
    if (this.dom.dataset.citationKey !== key) {
      this.dom.dataset.citationKey = key;
      const refs = useEditorStore.getState().references;
      const ref = refs.find((r) => r.bibKey === key);
      let display = `[${key}]`;
      if (ref) {
        const author = ref.authors?.[0]?.split(",").pop()?.trim() || ref.authors?.[0] || "";
        const family = author.split(" ").pop() || author;
        if (family && ref.year) {
          display = `[${family} ${ref.year}]`;
        } else if (ref.title) {
          display = `[${ref.title.slice(0, 20)}]`;
        }
      }
      this.dom.textContent = display;
    }
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
  return ((node: ProseNode, _view: EditorView, _getPos: () => number | undefined) => {
    return new CitationView(node);
  }) as NodeViewConstructor;
});
