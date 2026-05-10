import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { EditorView } from "@milkdown/prose/view";
import { imageSchema } from "@milkdown/preset-commonmark";
import { $view } from "@milkdown/utils";
import type { Ctx } from "@milkdown/ctx";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";

function resolveImageSrc(src: string): string {
  if (src.startsWith("/")) return convertFileSrc(src);
  const workspacePath = useEditorStore.getState().workspacePath;
  if (workspacePath) {
    return convertFileSrc(`${workspacePath}/${src}`);
  }
  return src;
}

export class ImageView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private node: ProseNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private img: HTMLImageElement;
  private caption: HTMLElement | null = null;
  private brokenLabel: HTMLElement;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const alt = node.attrs.alt as string;
    const title = node.attrs.title as string;

    const figure = document.createElement("figure");
    figure.classList.add("milkdown-image");

    const img = document.createElement("img");
    img.alt = alt || "";
    if (title) img.title = title;
    this.img = img;

    this.brokenLabel = document.createElement("div");
    this.brokenLabel.className = "milkdown-image-broken";

    const actions = document.createElement("div");
    actions.className = "milkdown-image-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "milkdown-image-action";
    editBtn.textContent = "Edit";
    editBtn.title = "Edit image path and alt text";
    editBtn.addEventListener("click", this.handleEdit);
    actions.appendChild(editBtn);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "milkdown-image-action";
    copyBtn.textContent = "Copy path";
    copyBtn.title = "Copy image path";
    copyBtn.addEventListener("click", this.handleCopyPath);
    actions.appendChild(copyBtn);

    figure.appendChild(actions);
    figure.appendChild(img);
    figure.appendChild(this.brokenLabel);

    if (alt) {
      const caption = document.createElement("figcaption");
      caption.className = "milkdown-image-caption";
      figure.appendChild(caption);
      this.caption = caption;
    }

    this.dom = figure;
    this.render();
  }

  stopEvent(event: Event): boolean {
    return (event.target as HTMLElement).closest(".milkdown-image-actions") !== null;
  }

  private render() {
    const src = this.node.attrs.src as string;
    const alt = (this.node.attrs.alt as string) || "";
    const title = this.node.attrs.title as string;
    const finalSrc = src.startsWith("http") ? src : resolveImageSrc(src);

    this.dom.classList.remove("milkdown-image--broken");
    this.img.src = finalSrc;
    this.img.alt = alt;
    this.img.title = title || "";
    this.brokenLabel.textContent = src ? `Image not found: ${src}` : "Image path is empty";

    this.img.onerror = () => {
      this.dom.classList.add("milkdown-image--broken");
    };
    this.img.onload = () => {
      this.dom.classList.remove("milkdown-image--broken");
    };

    if (alt) {
      if (!this.caption) {
        this.caption = document.createElement("figcaption");
        this.caption.className = "milkdown-image-caption";
        this.dom.appendChild(this.caption);
      }
      this.caption.textContent = alt;
    } else if (this.caption) {
      this.caption.remove();
      this.caption = null;
    }
  }

  private handleEdit = (event: MouseEvent) => {
    event.preventDefault();
    const currentSrc = (this.node.attrs.src as string) || "";
    const nextSrc = window.prompt("Image path", currentSrc);
    if (nextSrc === null) return;

    const currentAlt = (this.node.attrs.alt as string) || "";
    const nextAlt = window.prompt("Alt text / caption", currentAlt);
    if (nextAlt === null) return;

    const pos = this.getPos();
    if (pos === undefined) return;

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        src: nextSrc.trim(),
        alt: nextAlt.trim(),
      })
    );
  };

  private handleCopyPath = (event: MouseEvent) => {
    event.preventDefault();
    const src = (this.node.attrs.src as string) || "";
    navigator.clipboard?.writeText(src).catch((err: unknown) => {
      console.error("Failed to copy image path:", err);
    });
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "image") return false;
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

export const imageViewPlugin = $view(imageSchema.node, (_ctx: Ctx) => {
  return ((node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
    return new ImageView(node, view, getPos);
  }) as NodeViewConstructor;
});
