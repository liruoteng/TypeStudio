import { Plugin, PluginKey } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";
import { openUrl } from "@tauri-apps/plugin-opener";

const linkClickKey = new PluginKey("link-click");

export const linkClickPlugin = $prose(() => {
  return new Plugin({
    key: linkClickKey,
    props: {
      handleClickOn(_view, _pos, _node, _nodePos, event, _direct) {
        const target = event.target as HTMLElement;
        const linkEl = target.closest("a[href]") as HTMLAnchorElement | null;
        if (!linkEl) return false;

        const href = linkEl.getAttribute("href");
        if (!href) return false;

        // Only handle Cmd/Ctrl+Click
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          openUrl(href).catch((err: unknown) => {
            console.error("Failed to open link:", err);
          });
          return true;
        }
        return false;
      },
    },
  });
});
