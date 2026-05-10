import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  findTable,
  setCellAttr,
} from "@milkdown/prose/tables";
import { $prose } from "@milkdown/utils";

const tableControlsKey = new PluginKey("table-controls");

const ACTIONS: ReadonlyArray<{
  id: TableActionId;
  label: string;
  danger?: boolean;
}> = [
  { id: "row-before", label: "+ Row above" },
  { id: "row-after", label: "+ Row below" },
  { id: "col-before", label: "+ Column left" },
  { id: "col-after", label: "+ Column right" },
  { id: "align-left", label: "Left" },
  { id: "align-center", label: "Center" },
  { id: "align-right", label: "Right" },
  { id: "delete-row", label: "Delete row" },
  { id: "delete-col", label: "Delete column" },
  { id: "delete-table", label: "Delete table", danger: true },
] as const;

type TableActionId =
  | "row-before"
  | "row-after"
  | "col-before"
  | "col-after"
  | "align-left"
  | "align-center"
  | "align-right"
  | "delete-row"
  | "delete-col"
  | "delete-table";

function runAction(id: TableActionId, view: EditorView) {
  const { state, dispatch } = view;
  view.focus();

  switch (id) {
    case "row-before":
      return addRowBefore(state, dispatch);
    case "row-after":
      return addRowAfter(state, dispatch);
    case "col-before":
      return addColumnBefore(state, dispatch);
    case "col-after":
      return addColumnAfter(state, dispatch);
    case "align-left":
      return setCellAttr("alignment", "left")(state, dispatch);
    case "align-center":
      return setCellAttr("alignment", "center")(state, dispatch);
    case "align-right":
      return setCellAttr("alignment", "right")(state, dispatch);
    case "delete-row":
      return deleteRow(state, dispatch);
    case "delete-col":
      return deleteColumn(state, dispatch);
    case "delete-table":
      return deleteTable(state, dispatch);
  }
}

function tableToolbar(view: EditorView) {
  const toolbar = document.createElement("div");
  toolbar.className = "wme-table-toolbar";
  toolbar.contentEditable = "false";

  for (const action of ACTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wme-table-toolbar-btn${action.danger ? " wme-table-toolbar-btn--danger" : ""}`;
    button.textContent = action.label;
    button.title = action.label;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      runAction(action.id, view);
    });
    toolbar.appendChild(button);
  }

  return toolbar;
}

export const tableControlsPlugin = $prose(() => {
  return new Plugin({
    key: tableControlsKey,
    props: {
      decorations(state) {
        const table = findTable(state.selection.$from);
        if (!table) return DecorationSet.empty;

        return DecorationSet.create(state.doc, [
          Decoration.widget(table.pos, (view) => tableToolbar(view), {
            key: `table-toolbar-${table.pos}`,
            side: -1,
            ignoreSelection: true,
          }),
          Decoration.node(table.pos, table.pos + table.node.nodeSize, {
            class: "wme-table--active",
          }),
        ]);
      },
    },
  });
});
