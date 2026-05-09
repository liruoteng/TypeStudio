import { Plugin, PluginKey } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

const taskItemKey = new PluginKey("task-item");

export const taskItemPlugin = $prose(() => {
  return new Plugin({
    key: taskItemKey,
    props: {
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target as HTMLElement;
          const li = target.closest("li[data-item-type='task']");
          if (!li) return false;

          const rect = li.getBoundingClientRect();
          const clickX = event.clientX - rect.left;
          const checkboxWidth = parseFloat(getComputedStyle(li).fontSize) * 1.8;
          if (clickX > checkboxWidth + 4) return false;

          event.preventDefault();

          const pos = view.posAtDOM(li, 0);
          if (pos === null || pos === undefined) return false;

          const resolvedPos = view.state.doc.resolve(pos);
            for (let d = resolvedPos.depth; d > 0; d--) {
            const node = resolvedPos.node(d);
            if (node.type.name === "list_item" && node.attrs.checked != null) {
              const currentChecked = node.attrs.checked ?? false;
              const nodePos = resolvedPos.before(d);
              const tr = view.state.tr.setNodeAttribute(nodePos, "checked", !currentChecked);
              view.dispatch(tr);
              return true;
            }
          }

          return true;
        },
      },
    },
  });
});
