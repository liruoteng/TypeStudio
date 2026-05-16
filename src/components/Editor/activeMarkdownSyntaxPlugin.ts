import type { Mark, Node as ProseNode } from "@milkdown/prose/model";
import { EditorState, Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
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

interface RawRange {
  from: number;
  to: number;
}

interface ActiveMarkdownSyntaxState {
  rawRange: RawRange | null;
}

function syntaxWidget(text: string, className = "") {
  const span = document.createElement("span");
  span.className = `wme-md-syntax${className ? ` ${className}` : ""}`;
  span.textContent = text;
  span.contentEditable = "false";
  return span;
}

function markerWidget(text: string, range: MarkRange, edge: "start" | "end") {
  const span = document.createElement("span");
  span.className = "wme-md-syntax wme-md-syntax-marker";
  span.textContent = text;
  span.contentEditable = "true";
  span.spellcheck = false;
  span.tabIndex = 0;
  span.setAttribute("role", "textbox");
  span.setAttribute("aria-label", `${range.mark.type.name} markdown syntax`);
  span.dataset.mark = range.mark.type.name;
  span.dataset.from = String(range.from);
  span.dataset.to = String(range.to);
  span.dataset.edge = edge;
  span.dataset.original = text;
  if (typeof range.mark.attrs.marker === "string") {
    span.dataset.markerStyle = range.mark.attrs.marker;
  }
  return span;
}

function markerBounds(marker: HTMLElement) {
  const edge = marker.dataset.edge;
  const from = Number(marker.dataset.from);
  const to = Number(marker.dataset.to);

  if ((edge !== "start" && edge !== "end") || !Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  return { edge, from, to };
}

function moveSelectionToMarkerBoundary(view: EditorView, marker: HTMLElement, key: string) {
  const bounds = markerBounds(marker);
  if (!bounds || (key !== "ArrowLeft" && key !== "ArrowRight")) return false;

  const pos = bounds.edge === "start" ? bounds.from : bounds.to;
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  return true;
}

function widgetOptions(key: string, side: number, editable = false) {
  return {
    key,
    side,
    ignoreSelection: !editable,
    relaxedSide: true,
    stopEvent: (event: Event) => {
      if (!editable) return false;
      if (event.type === "keydown") {
        const key = (event as KeyboardEvent).key;
        return key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Enter" && key !== "Escape";
      }
      return [
        "beforeinput",
        "compositionstart",
        "compositionupdate",
        "compositionend",
        "mousedown",
        "mouseup",
      ].includes(event.type);
    },
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

function activeTextblockAt(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.isTextblock) {
      return { node, depth, pos: $pos.before(depth) };
    }
  }

  return null;
}

function findMarkRangeAt(state: EditorState, pos: number) {
  const active = activeTextblockAt(state, pos);
  if (!active) return null;

  return collectMarkRanges(active.node, active.pos)
    .find((range) => pos >= range.from && pos <= range.to) ?? null;
}

function markerAttrs(markName: string, rawValue: string, fallback: string) {
  const value = rawValue.trim();
  if (!value) return { action: "remove" as const };
  if (value === fallback) return { action: "keep" as const };

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
  if (markName === "link") {
    if (value === "[") return { action: "keep" as const };

    const hrefMatch = value.match(/^\]\((.*)\)$/);
    if (hrefMatch) return { action: "set" as const, attrs: { href: hrefMatch[1] } };
  }

  return { action: "remove" as const };
}

function applyMarkerEdit(view: EditorView, marker: HTMLElement) {
  const markName = marker.dataset.mark;
  const from = Number(marker.dataset.from);
  const to = Number(marker.dataset.to);
  const markType = markName ? view.state.schema.marks[markName] : null;
  if (!markName || !markType || !Number.isFinite(from) || !Number.isFinite(to)) return false;

  const next = markerAttrs(markName, marker.textContent ?? "", marker.dataset.original ?? "");
  if (next.action === "keep") return true;

  let tr = view.state.tr.removeMark(from, to, markType);
  if (next.action === "set") {
    tr = tr.addMark(from, to, markType.create(next.attrs));
  }

  view.dispatch(tr);
  return true;
}

interface InlineMarkdownMatch {
  markName: string;
  marker: string;
  openStart: number;
  contentStart: number;
  closeStart: number;
  closeEnd: number;
  attrs?: Record<string, unknown>;
}

function markdownBoundaryPrefix() {
  return String.raw`(^|[\s([{])`;
}

function findInlineMarkdownMatch(text: string): InlineMarkdownMatch | null {
  const boundary = markdownBoundaryPrefix();
  const specs = [
    { markName: "strong", pattern: new RegExp(`${boundary}(\\*\\*|__)(\\S(?:.*?\\S)?)\\2$`, "s") },
    { markName: "strike_through", pattern: new RegExp(`${boundary}(~~)(\\S(?:.*?\\S)?)~~$`, "s") },
    { markName: "inlineCode", pattern: new RegExp(`${boundary}(\`)([^\\n\`]+)\`$`) },
    { markName: "emphasis", pattern: new RegExp(`${boundary}(\\*|_)(\\S(?:.*?\\S)?)\\2$`, "s") },
  ];

  for (const spec of specs) {
    const match = text.match(spec.pattern);
    if (!match || match.index === undefined) continue;

    const prefixLength = match[1].length;
    const marker = match[2];
    const openStart = match.index + prefixLength;
    const contentStart = openStart + marker.length;
    const closeStart = text.length - marker.length;

    return {
      markName: spec.markName,
      marker,
      openStart,
      contentStart,
      closeStart,
      closeEnd: text.length,
      attrs: spec.markName === "strong" || spec.markName === "emphasis"
        ? { marker: marker[0] }
        : undefined,
    };
  }

  const linkMatch = text.match(new RegExp(`${boundary}\\[([^\\]\\n]+)\\]\\(([^)\\n]+)\\)$`));
  if (!linkMatch || linkMatch.index === undefined) return null;

  const prefixLength = linkMatch[1].length;
  const openStart = linkMatch.index + prefixLength;
  const label = linkMatch[2];
  const href = linkMatch[3];
  const contentStart = openStart + 1;
  const closeStart = contentStart + label.length;

  return {
    markName: "link",
    marker: "[",
    openStart,
    contentStart,
    closeStart,
    closeEnd: text.length,
    attrs: { href },
  };
}

function textblockStart(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).isTextblock) return $pos.before(depth) + 1;
  }

  return null;
}

function findStandaloneInlineMarkdownMatch(text: string): InlineMarkdownMatch | null {
  const specs = [
    { markName: "strong", pattern: /^(\*\*|__)(\S(?:.*?\S)?)\1$/s },
    { markName: "strike_through", pattern: /^(~~)(\S(?:.*?\S)?)~~$/s },
    { markName: "inlineCode", pattern: /^(`)([^\n`]+)`$/ },
    { markName: "emphasis", pattern: /^(\*|_)(\S(?:.*?\S)?)\1$/s },
  ];

  for (const spec of specs) {
    const match = text.match(spec.pattern);
    if (!match) continue;

    const marker = match[1];
    return {
      markName: spec.markName,
      marker,
      openStart: 0,
      contentStart: marker.length,
      closeStart: text.length - marker.length,
      closeEnd: text.length,
      attrs: spec.markName === "strong" || spec.markName === "emphasis"
        ? { marker: marker[0] }
        : undefined,
    };
  }

  const linkMatch = text.match(/^\[([^\]\n]+)\]\(([^\)\n]+)\)$/);
  if (!linkMatch) return null;

  return {
    markName: "link",
    marker: "[",
    openStart: 0,
    contentStart: 1,
    closeStart: 1 + linkMatch[1].length,
    closeEnd: text.length,
    attrs: { href: linkMatch[2] },
  };
}

function applyTypedMarkdown(view: EditorView, from: number, to: number, text: string) {
  if (from !== to || !text) return false;

  const blockStart = textblockStart(view.state, from);
  if (blockStart === null) return false;

  const textBefore = view.state.doc.textBetween(blockStart, from, "\n", "\n") + text;
  const match = findInlineMarkdownMatch(textBefore);
  if (!match) return false;

  const markType = view.state.schema.marks[match.markName];
  if (!markType) return false;

  const openStart = blockStart + match.openStart;
  const openEnd = blockStart + match.contentStart;
  const closeStart = blockStart + match.closeStart;
  const closeEnd = blockStart + match.closeEnd;
  const markTo = closeStart - (openEnd - openStart);

  let tr = view.state.tr
    .insertText(text, from, to)
    .delete(closeStart, closeEnd)
    .delete(openStart, openEnd)
    .addMark(openStart, markTo, markType.create(match.attrs));

  tr = tr.setSelection(TextSelection.create(tr.doc, markTo));

  view.dispatch(tr);
  return true;
}

function materializeMarkSyntax(view: EditorView, range: MarkRange) {
  const marker = MARKERS[range.mark.type.name]?.(range.mark);
  if (!marker) return false;

  const content = view.state.doc.textBetween(range.from, range.to, "\n", "\n");
  const raw = `${marker[0]}${content}${marker[1]}`;
  const rawRange = { from: range.from, to: range.from + raw.length };

  let tr = view.state.tr
    .replaceWith(range.from, range.to, view.state.schema.text(raw))
    .setMeta(activeMarkdownSyntaxKey, { rawRange });

  tr = tr.setSelection(TextSelection.create(tr.doc, range.from + marker[0].length));

  view.dispatch(tr);
  return true;
}

function collapseRawRange(view: EditorView, rawRange: RawRange) {
  const raw = view.state.doc.textBetween(rawRange.from, rawRange.to, "\n", "\n");
  const match = findStandaloneInlineMarkdownMatch(raw);
  if (!match) {
    view.dispatch(view.state.tr.setMeta(activeMarkdownSyntaxKey, { rawRange: null }));
    return true;
  }

  const markType = view.state.schema.marks[match.markName];
  if (!markType) return false;

  const content = raw.slice(match.contentStart, match.closeStart);
  let tr = view.state.tr
    .replaceWith(rawRange.from, rawRange.to, view.state.schema.text(content))
    .addMark(rawRange.from, rawRange.from + content.length, markType.create(match.attrs))
    .setMeta(activeMarkdownSyntaxKey, { rawRange: null });

  tr = tr.setSelection(TextSelection.create(tr.doc, rawRange.from + content.length));
  view.dispatch(tr);
  return true;
}

function rawMarkdownDecorations(state: EditorState, rawRange: RawRange) {
  const raw = state.doc.textBetween(rawRange.from, rawRange.to, "\n", "\n");
  const match = findStandaloneInlineMarkdownMatch(raw);
  if (!match) return [];

  const decorations: Decoration[] = [
    Decoration.inline(rawRange.from + match.openStart, rawRange.from + match.contentStart, { class: "wme-md-syntax-raw-marker" }),
    Decoration.inline(rawRange.from + match.closeStart, rawRange.from + match.closeEnd, { class: "wme-md-syntax-raw-marker" }),
  ];

  const contentClass = `wme-md-raw-content wme-md-raw-content--${match.markName}`;
  decorations.push(Decoration.inline(rawRange.from + match.contentStart, rawRange.from + match.closeStart, { class: contentClass }));

  return decorations;
}

export const activeMarkdownSyntaxPlugin = $prose(() => {
  return new Plugin({
    key: activeMarkdownSyntaxKey,
    state: {
      init(): ActiveMarkdownSyntaxState {
        return { rawRange: null };
      },
      apply(tr, value: ActiveMarkdownSyntaxState): ActiveMarkdownSyntaxState {
        const meta = tr.getMeta(activeMarkdownSyntaxKey) as { rawRange?: RawRange | null } | undefined;
        if (meta && "rawRange" in meta) {
          return { rawRange: meta.rawRange ?? null };
        }

        if (!value.rawRange) return value;

        const from = tr.mapping.map(value.rawRange.from);
        const to = tr.mapping.map(value.rawRange.to);
        return { rawRange: from < to ? { from, to } : null };
      },
    },
    view() {
      return {
        update(nextView) {
          const pluginState = activeMarkdownSyntaxKey.getState(nextView.state) as ActiveMarkdownSyntaxState;
          const rawRange = pluginState.rawRange;
          if (!rawRange) return;

          const { from, to } = nextView.state.selection;
          if (from >= rawRange.from && to <= rawRange.to) return;

          collapseRawRange(nextView, rawRange);
        },
      };
    },
    props: {
      handleTextInput(view, from, to, text) {
        return applyTypedMarkdown(view, from, to, text);
      },
      handleClick(view, pos) {
        const pluginState = activeMarkdownSyntaxKey.getState(view.state) as ActiveMarkdownSyntaxState;
        if (pluginState.rawRange) return false;

        const range = findMarkRangeAt(view.state, pos);
        if (!range) return false;

        return materializeMarkSyntax(view, range);
      },
      decorations(state) {
        const pluginState = activeMarkdownSyntaxKey.getState(state) as ActiveMarkdownSyntaxState;
        if (pluginState.rawRange) {
          return DecorationSet.create(state.doc, rawMarkdownDecorations(state, pluginState.rawRange));
        }

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
            markerWidget(marker[0], range, "start"),
            widgetOptions(`mark-start-${range.from}-${range.to}-${marker[0]}`, -1, true),
          ));
          decorations.push(Decoration.widget(
            range.to,
            markerWidget(marker[1], range, "end"),
            widgetOptions(`mark-end-${range.from}-${range.to}-${marker[1]}`, 1, true),
          ));
        }

        return DecorationSet.create(state.doc, decorations);
      },
      handleDOMEvents: {
        input(view, event) {
          const marker = event.target as HTMLElement;
          if (!marker.matches(".wme-md-syntax-marker[data-mark]")) return false;

          return applyMarkerEdit(view, marker);
        },
        focusout(view, event) {
          const marker = event.target as HTMLElement;
          if (!marker.matches(".wme-md-syntax-marker[data-mark]")) return false;

          return applyMarkerEdit(view, marker);
        },
        keydown(view, event) {
          const marker = event.target as HTMLElement;
          if (!marker.matches(".wme-md-syntax-marker[data-mark]")) return false;

          if (event.key === "Enter") {
            event.preventDefault();
            marker.blur();
            return true;
          }

          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            return moveSelectionToMarkerBoundary(view, marker, event.key);
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
