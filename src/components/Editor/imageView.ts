import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { EditorView } from "@milkdown/prose/view";
import { imageSchema } from "@milkdown/preset-commonmark";
import { $view } from "@milkdown/utils";
import type { Ctx } from "@milkdown/ctx";
import { convertFileSrc } from "@tauri-apps/api/core";

export class ImageView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;

  constructor(node: ProseNode) {
    const src = node.attrs.src as string;
    const alt = node.attrs.alt as string;
    const title = node.attrs.title as string;

    const figure = document.createElement("figure");
    figure.classList.add("milkdown-image");
    figure.style.margin = "1.2em 0";
    figure.style.textAlign = "center";

    const img = document.createElement("img");
    const finalSrc = src.startsWith("http") ? src : convertFileSrc(src);
    img.src = finalSrc;
    img.alt = alt || "";
    if (title) img.title = title;
    img.style.maxWidth = "100%";
    img.style.borderRadius = "6px";
    img.style.display = "inline-block";

    figure.appendChild(img);

    if (alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = alt;
      caption.style.fontSize = "0.85em";
      caption.style.color = "var(--text-muted)";
      caption.style.marginTop = "0.5em";
      figure.appendChild(caption);
    }

    this.dom = figure;
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "image") return false;
    const src = node.attrs.src as string;
    const img = this.dom.querySelector("img") as HTMLImageElement;
    if (img) {
      const finalSrc = src.startsWith("http") ? src : convertFileSrc(src);
      if (img.src !== finalSrc) img.src = finalSrc;
      img.alt = (node.attrs.alt as string) || "";
      const title = node.attrs.title as string;
      if (title) img.title = title;
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

export const imageViewPlugin = $view(imageSchema.node, (_ctx: Ctx) => {
  return ((node: ProseNode, _view: EditorView, _getPos: () => number | undefined) => {
    return new ImageView(node);
  }) as NodeViewConstructor;
});
