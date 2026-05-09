import { Plugin, PluginKey } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

export interface SlashState {
  filter: string;
  x: number;
  y: number;
  anchorPos: number;
}

export type SlashChangeHandler = (state: SlashState | null) => void;

const slashKey = new PluginKey("slash-menu");

export const slashMenuPlugin = (onChange: SlashChangeHandler) => {
  return $prose(() => {
    let lastFilter: string | null = null;

    return new Plugin({
      key: slashKey,
      view: () => ({
        update: (view) => {
          const { selection } = view.state;
          const { $from } = selection;
          const pos = $from.pos;

          const textBefore = view.state.doc.textBetween(Math.max(0, pos - 100), pos);
          const match = textBefore.match(/\/([\w-]*)$/);

          if (match) {
            const filter = match[1];
            if (filter !== lastFilter) {
              lastFilter = filter;
              const anchorPos = pos - match[0].length;
              const coords = view.coordsAtPos(anchorPos);
              onChange({
                filter,
                x: coords.left,
                y: coords.bottom + 4,
                anchorPos,
              });
            }
          } else if (lastFilter !== null) {
            lastFilter = null;
            onChange(null);
          }
        },
      }),
    });
  });
};
