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
  private toolbar: HTMLElement;
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

    this.toolbar = document.createElement("div");
    this.toolbar.className = "code-block-toolbar";

    const langLabel = document.createElement("span");
    langLabel.className = "code-block-lang-label";
    langLabel.textContent = "Language:";
    this.toolbar.appendChild(langLabel);

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
    this.toolbar.appendChild(this.select);

    const spacer = document.createElement("span");
    spacer.className = "code-block-spacer";
    this.toolbar.appendChild(spacer);

    this.copyBtn = document.createElement("button");
    this.copyBtn.className = "code-block-copy-btn";
    this.copyBtn.textContent = "Copy";
    this.copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.node.textContent).then(() => {
        this.copyBtn.textContent = "Copied!";
        setTimeout(() => {
          this.copyBtn.textContent = "Copy";
        }, 2000);
      });
    });
    this.toolbar.appendChild(this.copyBtn);

    container.appendChild(this.toolbar);

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
    return this.toolbar.contains(event.target as Node);
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
