import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { EditorView } from "@milkdown/prose/view";
import { $view, $nodeSchema } from "@milkdown/utils";
import type { Ctx } from "@milkdown/ctx";

export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
  group: "block",
  atom: true,
  attrs: {
    value: { default: "" },
  },
  parseMarkdown: {
    match: (node) => node.type === "yaml",
    runner: (state, node, type) => {
      const value = (node.value as string) || "";
      state.addNode(type, { value });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "frontmatter",
    runner: (state, node) => {
      state.addNode("yaml", undefined, node.attrs.value as string);
    },
  },
}));

export class FrontmatterView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private expanded = false;

  constructor(node: ProseNode) {
    const value = node.textContent || "";

    const container = document.createElement("div");
    container.classList.add("frontmatter-panel");

    const header = document.createElement("div");
    header.classList.add("frontmatter-header");

    const toggle = document.createElement("span");
    toggle.classList.add("frontmatter-toggle");
    toggle.textContent = this.expanded ? "▼" : "▶";

    const label = document.createElement("span");
    label.classList.add("frontmatter-label");
    label.textContent = "Properties";

    header.appendChild(toggle);
    header.appendChild(label);
    container.appendChild(header);

    const body = document.createElement("div");
    body.classList.add("frontmatter-body");
    if (!this.expanded) {
      body.style.display = "none";
    }

    // Parse simple key: value pairs
    const lines = value.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();

      const row = document.createElement("div");
      row.classList.add("frontmatter-row");

      const keyEl = document.createElement("span");
      keyEl.classList.add("frontmatter-key");
      keyEl.textContent = key;

      const valEl = document.createElement("span");
      valEl.classList.add("frontmatter-value");
      valEl.textContent = val;

      row.appendChild(keyEl);
      row.appendChild(valEl);
      body.appendChild(row);
    }

    container.appendChild(body);

    header.addEventListener("click", () => {
      this.expanded = !this.expanded;
      toggle.textContent = this.expanded ? "▼" : "▶";
      body.style.display = this.expanded ? "block" : "none";
    });

    this.dom = container;
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "frontmatter") return false;
    // For simplicity, don't re-render on update; frontmatter rarely changes inline
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.dom.remove();
  }
}

export const frontmatterViewPlugin = $view(frontmatterSchema.node, (_ctx: Ctx) => {
  return ((node: ProseNode, _view: EditorView, _getPos: () => number | undefined) => {
    return new FrontmatterView(node);
  }) as NodeViewConstructor;
});
