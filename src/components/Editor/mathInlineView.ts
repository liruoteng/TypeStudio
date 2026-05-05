import katex from "katex";
import type { KatexOptions } from "katex";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { EditorView } from "@milkdown/prose/view";
import { mathInlineSchema, katexOptionsCtx } from "@milkdown/plugin-math";
import { $view } from "@milkdown/utils";
import type { Ctx } from "@milkdown/ctx";

export class MathInlineView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private node: ProseNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private katexOptions: KatexOptions;
  private editing = false;
  private input: HTMLInputElement | null = null;
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

    this.dom = document.createElement("span");
    this.dom.classList.add("math-node", "math-node--inline");
    this.dom.dataset.type = "math_inline";
    this.render();
  }

  stopEvent(_event: Event): boolean {
    if (!this.editing) return false;
    return true;
  }

  private render() {
    this.dom.innerHTML = "";
    const code = this.node.textContent || "";

    if (this.editing) {
      this.dom.classList.add("math-node--editing");
      const input = document.createElement("input");
      input.type = "text";
      input.classList.add("math-inline-editor");
      input.value = code;
      input.placeholder = "equation";
      input.spellcheck = false;
      input.addEventListener("blur", this.handleBlur);
      input.addEventListener("keydown", this.handleKeydown);
      this.dom.appendChild(input);
      this.input = input;
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(code.length, code.length);
      });
    } else {
      this.dom.classList.remove("math-node--editing");
      if (code) {
        try {
          katex.render(code, this.dom, { ...this.katexOptions, throwOnError: false });
        } catch {
          this.dom.textContent = code;
        }
      }
      this.input = null;
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

  private save() {
    const input = this.input;
    if (!input) return;
    const newValue = input.value;
    const pos = this.getPos();
    if (pos !== undefined) {
      const currentValue = this.node.textContent;
      if (newValue !== currentValue) {
        const newNode = this.node.type.create(
          this.node.attrs,
          newValue ? this.node.type.schema.text(newValue) : undefined,
          this.node.marks
        );
        this.view.dispatch(
          this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, newNode)
        );
      }
    }
  }

  private closeEditor() {
    if (!this.editing) return;
    this.clearBlurTimer();
    this.save();
    this.editing = false;
    this.input = null;
    this.render();
  }

  private clearBlurTimer() {
    if (this.blurTimer !== null) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
  }

  handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      this.closeEditor();
    }
  };

  handleBlur = () => {
    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => this.closeEditor(), 250);
  };

  update(node: ProseNode): boolean {
    if (node.type.name !== "math_inline") return false;
    this.node = node;
    this.dom.dataset.value = node.textContent;
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

export const mathInlineViewPlugin = $view(mathInlineSchema.node, (ctx: Ctx) => {
  return ((node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
    return new MathInlineView(node, view, getPos, ctx.get(katexOptionsCtx.key));
  }) as NodeViewConstructor;
});