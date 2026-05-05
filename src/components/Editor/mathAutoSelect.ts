import { Plugin, PluginKey, NodeSelection } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

const mathAutoSelectKey = new PluginKey("math-auto-select");

export const mathAutoSelectPlugin = $prose(() => {
  return new Plugin({
    key: mathAutoSelectKey,
    state: {
      init() {
        return { lastEmptyBlockPos: null as number | null };
      },
      apply(tr, value) {
        if (!tr.docChanged) return value;
        let emptyPos: number | null = null;
        tr.doc.descendants((node, pos) => {
          if (emptyPos !== null) return false;
          if (node.type.name === "math_block" && !node.attrs.value) {
            emptyPos = pos;
            return false;
          }
        });
        return { lastEmptyBlockPos: emptyPos };
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const pluginState = mathAutoSelectKey.getState(newState) as { lastEmptyBlockPos: number | null } | undefined;
      const mathPos = pluginState?.lastEmptyBlockPos ?? null;
      if (mathPos === null) return null;

      const { selection } = newState;
      if (selection instanceof NodeSelection && selection.from === mathPos) {
        return null;
      }

      return newState.tr.setSelection(NodeSelection.create(newState.doc, mathPos));
    },
  });
});