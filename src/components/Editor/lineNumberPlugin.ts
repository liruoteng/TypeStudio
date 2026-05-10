import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";

const lineNumberKey = new PluginKey("wme-line-numbers");

export interface LineNumberOptions {
  enabled: boolean;
}

export const lineNumberPlugin = (options: LineNumberOptions) => {
  return $prose(() => {
    return new Plugin({
      key: lineNumberKey,
      props: {
        decorations(state) {
          if (!options.enabled) return DecorationSet.empty;

          const decorations: Decoration[] = [];
          let line = 1;

          state.doc.forEach((_node, offset) => {
            const marker = document.createElement("span");
            marker.className = "wme-line-number";
            marker.textContent = String(line);
            decorations.push(Decoration.widget(offset + 1, marker, { side: -1 }));
            line += 1;
          });

          return DecorationSet.create(state.doc, decorations);
        },
      },
    });
  });
};
