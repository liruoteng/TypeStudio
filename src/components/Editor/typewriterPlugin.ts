import { Plugin, PluginKey } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

const typewriterKey = new PluginKey("typewriter-mode");

export interface TypewriterOptions {
  enabled?: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export const typewriterPlugin = (options: TypewriterOptions = {}) => {
  return $prose(() => {
    return new Plugin({
      key: typewriterKey,
      view() {
        let lastCursorPos = -1;
        return {
          update: (view) => {
            if (!options.enabled || !options.containerRef?.current) return;

            const { from } = view.state.selection;
            if (from === lastCursorPos) return;
            lastCursorPos = from;

            const coords = view.coordsAtPos(from);
            const container = options.containerRef.current;
            const containerRect = container.getBoundingClientRect();

            const targetScrollTop =
              container.scrollTop +
              (coords.top - containerRect.top) -
              containerRect.height / 2;

            container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
          },
        };
      },
    });
  });
};
