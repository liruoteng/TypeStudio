import type { Mark, Node as ProseNode } from "@milkdown/prose/model";
import { EditorState, Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";

const activeMarkdownSyntaxKey = new PluginKey("active-markdown-syntax");

const MARKERS: Record<string, (mark: Mark) => [string, string] | null> = {
  strong: (mark) => {
    const marker = mark.attrs.marker === "_" ? "_" : "*";
    return [marker.repeat(2), marker.repeat(2)];
  },
  emphasis: (mark) => {
    const marker = mark.attrs.marker === "_" ? "_" : "*";
    return [marker, marker];
  },
  strike_through: () => ["~~", "~~"],
  inlineCode: () => ["`", "`"],
  link: (mark) => ["[", `](${mark.attrs.href ?? ""})`],
};

interface MarkRange {
  from: number;
  to: number;
  mark: Mark;
}

function syntaxWidget(text: string, className = "") {
  const span = document.createElement("span");
  span.className = `wme-md-syntax${className ? ` ${className}` : ""}`;
  span.textContent = text;
  span.contentEditable = "false";
  return span;
}

function markerWidget(text: string, range: MarkRange) {
  const span = document.createElement("span");
  span.className = "wme-md-syntax wme-md-syntax-marker";
  span.textContent = text;
  span.contentEditable = "true";
  span.spellcheck = false;
  span.setAttribute("role", "textbox");
  span.setAttribute("aria-label", `${range.mark.type.name} markdown syntax`);
  span.dataset.mark = range.mark.type.name;
  span.dataset.from = String(range.from);
  span.dataset.to = String(range.to);
  span.dataset.original = text;
  if (typeof range.mark.attrs.marker === "string") {
    span.dataset.markerStyle = range.mark.attrs.marker;
  }
  return span;
}

function widgetOptions(key: string, side: number, editable = false) {
  return {
    key,
    side,
    ignoreSelection: !editable,
    relaxedSide: true,
    stopEvent: (event: Event) => editable && ["beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"].includes(event.type),
  };
}

function activeTextblock(state: EditorState) {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      return { node, depth, pos: $from.before(depth) };
    }
  }

  return null;
}

function findListItemDepth(state: EditorState, depth: number) {
  const { $from } = state.selection;
  return Array.from({ length: depth - 1 }, (_, i) => depth - i - 1)
    .find((d) => $from.node(d).type.name === "list_item");
}

function blockPrefix(state: EditorState, depth: number, node: ProseNode) {
  const { $from } = state.selection;
  const parts: string[] = [];

  for (let d = 1; d < depth; d += 1) {
    if ($from.node(d).type.name === "blockquote") parts.push("> ");
  }

  if (node.type.name === "heading") {
    const level = Math.max(1, Math.min(6, Number(node.attrs.level) || 1));
    parts.push(`${"#".repeat(level)} `);
    return parts.join("");
  }

  const listItemDepth = findListItemDepth(state, depth);
  if (!listItemDepth || listItemDepth <= 1) return parts.join("");

  const list = $from.node(listItemDepth - 1);
  if (list.type.name === "bullet_list") {
    parts.push("- ");
  } else if (list.type.name === "ordered_list") {
    const order = Number(list.attrs.order) || 1;
    const index = $from.index(listItemDepth - 1);
    parts.push(`${order + index}. `);
  }

  return parts.join("");
}

function collectMarkRanges(node: ProseNode, blockPos: number) {
  const rangesByKey = new Map<string, MarkRange[]>();

  node.descendants((child, offset) => {
    if (!child.isText) return;

    const from = blockPos + 1 + offset;
    const to = from + child.nodeSize;

    for (const mark of child.marks) {
      if (!MARKERS[mark.type.name]) continue;

      const key = `${mark.type.name}:${JSON.stringify(mark.attrs)}`;
      const ranges = rangesByKey.get(key) ?? [];
      const previous = ranges[ranges.length - 1];

      if (previous && previous.to === from) {
        previous.to = to;
      } else {
        ranges.push({ from, to, mark });
      }

      rangesByKey.set(key, ranges);
    }
  });

  return Array.from(rangesByKey.values()).flat();
}

function containsCursor(range: MarkRange, cursorPos: number) {
  return cursorPos >= range.from && cursorPos <= range.to;
}

function markerAttrs(markName: string, rawValue: string, fallback: string) {
  const value = rawValue.trim();
  if (!value) return { action: "remove" as const };

  if (markName === "strong") {
    if (value === "__") return { action: "set" as const, attrs: { marker: "_" } };
    if (value === "**") return { action: "set" as const, attrs: { marker: "*" } };
  }

  if (markName === "emphasis") {
    if (value === "_") return { action: "set" as const, attrs: { marker: "_" } };
    if (value === "*") return { action: "set" as const, attrs: { marker: "*" } };
  }

  if (markName === "strike_through" && value === "~~") return { action: "keep" as const };
  if (markName === "inlineCode" && value === "`") return { action: "keep" as const };
  if (value === fallback) return { action: "keep" as const };

  return { action: "revert" as const, value: fallback };
}

export const activeMarkdownSyntaxPlugin = $prose(() => {
  return new Plugin({
    key: activeMarkdownSyntaxKey,
    props: {
      decorations(state) {
        if (!state.selection.empty) return DecorationSet.empty;

        const active = activeTextblock(state);
        if (!active) return DecorationSet.empty;

        const decorations: Decoration[] = [];
        const cursorPos = state.selection.from;
        const contentStart = active.pos + 1;
        const prefix = blockPrefix(state, active.depth, active.node);

        if (prefix) {
          decorations.push(Decoration.widget(
            contentStart,
            syntaxWidget(prefix, "wme-md-syntax--prefix"),
            widgetOptions(`prefix-${contentStart}-${prefix}`, -1),
          ));
        }

        const listItemDepth = findListItemDepth(state, active.depth);
        if (listItemDepth) {
          const listItem = state.selection.$from.node(listItemDepth);
          const listItemPos = state.selection.$from.before(listItemDepth);
          decorations.push(Decoration.node(listItemPos, listItemPos + listItem.nodeSize, { class: "wme-md-active-list-item" }));
        }

        for (const range of collectMarkRanges(active.node, active.pos)) {
          if (!containsCursor(range, cursorPos)) continue;

          const marker = MARKERS[range.mark.type.name]?.(range.mark);
          if (!marker) continue;

          decorations.push(Decoration.widget(
            range.from,
            markerWidget(marker[0], range),
            widgetOptions(`mark-start-${range.from}-${range.to}-${marker[0]}`, -1, true),
          ));
          decorations.push(Decoration.widget(
            range.to,
            markerWidget(marker[1], range),
            widgetOptions(`mark-end-${range.from}-${range.to}-${marker[1]}`, 1, true),
          ));
        }

        return DecorationSet.create(state.doc, decorations);
      },
      handleDOMEvents: {
        focusout(view, event) {
          const marker = event.target as HTMLElement;
          if (!marker.matches(".wme-md-syntax-marker[data-mark]")) return false;

          const markName = marker.dataset.mark;
          const from = Number(marker.dataset.from);
          const to = Number(marker.dataset.to);
          const markType = markName ? view.state.schema.marks[markName] : null;
          if (!markName || !markType || !Number.isFinite(from) || !Number.isFinite(to)) return false;

          const next = markerAttrs(markName, marker.textContent ?? "", marker.dataset.original ?? "");
          if (next.action === "revert") {
            marker.textContent = next.value;
            return true;
          }
          if (next.action === "keep") return true;

          let tr = view.state.tr.removeMark(from, to, markType);
          if (next.action === "set") {
            tr = tr.addMark(from, to, markType.create(next.attrs));
          }
          view.dispatch(tr);
          return true;
        },
        keydown(view, event) {
          const marker = event.target as HTMLElement;
          if (!marker.matches(".wme-md-syntax-marker[data-mark]")) return false;

          if (event.key === "Enter") {
            event.preventDefault();
            marker.blur();
            return true;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            marker.textContent = marker.dataset.original ?? marker.textContent;
            view.focus();
            return true;
          }

          return false;
        },
        click(view, event) {
          const target = event.target as HTMLElement;
          const marker = target.closest(".wme-md-syntax-marker[data-mark]") as HTMLElement | null;
          if (!marker) return false;

          if (!(event as MouseEvent).altKey) return false;

          const markName = marker.dataset.mark;
          const from = Number(marker.dataset.from);
          const to = Number(marker.dataset.to);
          const markType = markName ? view.state.schema.marks[markName] : null;
          if (!markType || !Number.isFinite(from) || !Number.isFinite(to)) return false;

          event.preventDefault();

          if (markName !== "strong" && markName !== "emphasis") return false;

          const currentMarker = marker.dataset.markerStyle === "_" ? "_" : "*";
          const tr = view.state.tr
            .removeMark(from, to, markType)
            .addMark(from, to, markType.create({ marker: currentMarker === "*" ? "_" : "*" }));
          view.dispatch(tr);
          return true;
        },
      },
    },
  });
});
