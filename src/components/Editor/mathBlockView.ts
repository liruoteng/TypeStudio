import katex from "katex";
import type { KatexOptions } from "katex";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { EditorView } from "@milkdown/prose/view";
import { mathBlockSchema, katexOptionsCtx } from "@milkdown/plugin-math";
import { $view } from "@milkdown/utils";
import type { Ctx } from "@milkdown/ctx";

export class MathBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private node: ProseNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private katexOptions: KatexOptions;
  private editing = false;
  private textarea: HTMLTextAreaElement | null = null;
  private previewEl: HTMLElement | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    katexOptions: KatexOptions
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.katexOptions = katexOptions;

    this.dom = document.createElement("div");
    this.dom.classList.add("math-node", "math-node--block");
    this.dom.dataset.type = "math_block";

    if (!node.attrs.value) {
      this.editing = true;
    }

    this.render();
  }

  stopEvent(_event: Event): boolean {
    // When editing, tell ProseMirror to ignore ALL events on this node view.
    // The browser still processes them (typing, focus, etc.), but ProseMirror
    // won't try to handle them as editor input.
    if (!this.editing) return false;
    return true;
  }

  private render() {
    this.dom.innerHTML = "";
    const code = (this.node.attrs.value as string) || "";

    if (this.editing) {
      this.dom.classList.add("math-node--editing");
      this.renderEditing(code);
    } else {
      this.dom.classList.remove("math-node--editing");
      if (code) {
        try {
          katex.render(code, this.dom, { ...this.katexOptions, displayMode: true, throwOnError: false });
        } catch {
          this.dom.textContent = code;
        }
      } else {
        const ph = document.createElement("div");
        ph.classList.add("math-block-placeholder");
        ph.textContent = "Click to add equation";
        this.dom.appendChild(ph);
      }
      this.textarea = null;
      this.previewEl = null;
    }
  }

  private renderEditing(code: string) {
    const textarea = document.createElement("textarea");
    textarea.classList.add("math-source");
    textarea.value = code;
    textarea.placeholder = "Type LaTeX equation…";
    textarea.spellcheck = false;
    textarea.addEventListener("blur", this.handleBlur);
    textarea.addEventListener("keydown", this.handleKeydown);
    textarea.addEventListener("input", this.handleInput);
    this.textarea = textarea;

    const preview = document.createElement("div");
    preview.classList.add("math-preview");
    this.previewEl = preview;
    this.renderPreview(code);

    this.dom.appendChild(textarea);
    this.dom.appendChild(preview);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(code.length, code.length);
      this.autoResize();
    });
  }

  private renderPreview(code: string) {
    if (!this.previewEl) return;
    this.previewEl.innerHTML = "";
    if (!code) {
      this.previewEl.classList.add("math-preview--empty");
      this.previewEl.textContent = "Preview";
      return;
    }
    this.previewEl.classList.remove("math-preview--empty");
    try {
      katex.render(code, this.previewEl, { ...this.katexOptions, displayMode: true, throwOnError: false });
    } catch {
      this.previewEl.textContent = code;
    }
  }

  private autoResize() {
    if (!this.textarea) return;
    this.textarea.style.height = "auto";
    this.textarea.style.height = this.textarea.scrollHeight + "px";
  }

  private save() {
    const textarea = this.textarea;
    if (!textarea) return;
    const newValue = textarea.value;
    const pos = this.getPos();
    if (pos !== undefined && newValue !== (this.node.attrs.value as string)) {
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, value: newValue })
      );
    }
  }

  private closeEditor() {
    if (!this.editing) return;
    this.clearBlurTimer();
    this.save();
    this.editing = false;
    this.textarea = null;
    this.previewEl = null;
    this.render();
  }

  private clearBlurTimer() {
    if (this.blurTimer !== null) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
  }

  selectNode() {
    if (!this.editing) {
      this.editing = true;
      this.render();
    }
  }

  deselectNode() {
    this.closeEditor();
  }

  handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeEditor();
    }
  };

  handleInput = () => {
    if (this.textarea && this.previewEl) {
      this.renderPreview(this.textarea.value);
    }
    this.autoResize();
  };

  handleBlur = () => {
    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => this.closeEditor(), 250);
  };

  update(node: ProseNode): boolean {
    if (node.type.name !== "math_block") return false;
    this.node = node;
    this.dom.dataset.value = node.attrs.value;
    if (!this.editing) this.render();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.clearBlurTimer();
    this.dom.remove();
  }
}

export const mathBlockViewPlugin = $view(mathBlockSchema.node, (ctx: Ctx) => {
  return ((node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
    return new MathBlockView(node, view, getPos, ctx.get(katexOptionsCtx.key));
  }) as NodeViewConstructor;
});