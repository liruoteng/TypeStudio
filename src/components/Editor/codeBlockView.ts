import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { EditorView } from "@milkdown/prose/view";
import { codeBlockSchema } from "@milkdown/preset-commonmark";
import { $view } from "@milkdown/utils";
import type { Ctx } from "@milkdown/ctx";

const LANGUAGES = [
  "", "javascript", "typescript", "python", "rust", "go", "java",
  "c", "cpp", "csharp", "ruby", "php", "swift", "kotlin", "scala",
  "bash", "shell", "sql", "html", "css", "json", "xml", "yaml",
  "toml", "markdown", "plaintext", "diff", "graphql", "latex",
];

export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null;
  private node: ProseNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private actions: HTMLElement;
  private select: HTMLSelectElement;
  private copyBtn: HTMLButtonElement;

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const container = document.createElement("div");
    container.className = "code-block-container";

    this.actions = document.createElement("div");
    this.actions.className = "code-block-actions";

    this.select = document.createElement("select");
    this.select.className = "code-block-lang-select";
    this.populateLanguages();
    this.select.value = node.attrs.language || "";
    this.select.addEventListener("change", () => {
      const pos = this.getPos();
      if (pos !== undefined) {
        this.view.dispatch(
          this.view.state.tr.setNodeAttribute(pos, "language", this.select.value)
        );
      }
    });
    this.actions.appendChild(this.select);

    this.copyBtn = document.createElement("button");
    this.copyBtn.className = "code-block-copy-btn";
    this.copyBtn.title = "Copy code";
    this.copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    this.copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.node.textContent).then(() => {
        this.copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
        setTimeout(() => {
          this.copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
        }, 2000);
      });
    });
    this.actions.appendChild(this.copyBtn);

    container.appendChild(this.actions);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.appendChild(code);
    container.appendChild(pre);
    this.contentDOM = code;

    this.dom = container;
  }

  private populateLanguages() {
    for (const lang of LANGUAGES) {
      const opt = document.createElement("option");
      opt.value = lang;
      opt.textContent = lang || "Plain Text";
      this.select.appendChild(opt);
    }
  }

  stopEvent(event: Event): boolean {
    return this.actions.contains(event.target as Node);
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "code_block") return false;
    this.node = node;
    this.select.value = node.attrs.language || "";
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.dom.remove();
  }
}

export const codeBlockViewPlugin = $view(codeBlockSchema.node, (_ctx: Ctx) => {
  return ((node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
    return new CodeBlockView(node, view, getPos);
  }) as NodeViewConstructor;
});
