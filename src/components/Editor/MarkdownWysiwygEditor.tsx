import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap } from "@codemirror/search";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import katex from "katex";
import { refractor } from "refractor/all";
import type { Element as HastElement, Nodes as HastNode, Root as HastRoot, Text as HastText } from "hast";
import { EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import type { Extension, Range as CodeMirrorRange } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  crosshairCursor,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { useEditorStore, type Reference } from "../../stores/editorStore";
import { copyImageFilesToAssets } from "../../lib/utils";
import { getActiveDragSource } from "../FileExplorer/FileTree";
import { SlashMenu, type SlashCommand } from "./SlashMenu";
import { WidthHandle } from "./WidthHandle";
import { normalizeTableDelimiterEscapes } from "./markdownEscapeUtil";
import "katex/dist/katex.min.css";
import "./MarkdownWysiwygEditor.css";

interface MarkdownWysiwygEditorProps {
  onSave?: (path: string, content: string, isExplicit?: boolean) => void;
  onSnapshot?: (path: string) => void;
  onPreviewTrigger?: (path: string, content: string) => void;
  externalContent?: { content: string; seq: number };
}

type DecorationRange = {
  from: number;
  to: number;
  className?: string;
  replace?: boolean;
  widget?: WidgetType;
  block?: boolean;
  line?: boolean;
  point?: boolean;
  side?: number;
};

type InlineRange = {
  from: number;
  to: number;
};

const editTableSourceEffect = StateEffect.define<InlineRange | null>();

const tableSourceEditRangeField = StateField.define<InlineRange | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged) {
      value = {
        from: transaction.changes.mapPos(value.from),
        to: transaction.changes.mapPos(value.to),
      };
    }

    for (const effect of transaction.effects) {
      if (effect.is(editTableSourceEffect)) value = effect.value;
    }

    if (value && transaction.selection) {
      const selection = transaction.state.selection.main;
      if (selection.to < value.from || selection.from > value.to) return null;
    }

    return value;
  },
});

type MarkdownTable = {
  from: number;
  to: number;
  header: string[];
  alignments: Array<"left" | "center" | "right" | null>;
  rows: string[][];
};

type MarkdownCodeBlock = {
  from: number;
  to: number;
  language: string;
  value: string;
  closed: boolean;
};

type MarkdownMathBlock = {
  from: number;
  to: number;
  value: string;
  kind: "dollar" | "bracket" | "environment";
};

type InlineMathMatch = {
  from: number;
  to: number;
  value: string;
};

type MarkdownImage = {
  from: number;
  to: number;
  alt: string;
  src: string;
  title?: string;
};

type MarkdownFrontmatter = {
  from: number;
  to: number;
  value: string;
  rows: Array<{ key: string; value: string }>;
};

type CitationOption = {
  key: string;
  label: string;
  meta: string;
};

type CitationMenuState = {
  x: number;
  y: number;
  from: number;
  to: number;
  options: CitationOption[];
  activeIndex: number;
};

type MarkdownDocSource = EditorState | EditorView;

function markdownDoc(source: MarkdownDocSource) {
  return "doc" in source ? source.doc : source.state.doc;
}

const prismAliases: Record<string, string> = {
  html: "markup",
  xml: "markup",
  svg: "markup",
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  tex: "latex",
  cplusplus: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  "c#": "csharp",
  objectivec: "objectivec",
  "objective-c": "objectivec",
};

const codeBlockLanguages = ["", ...refractor.listLanguages().sort((a, b) => a.localeCompare(b))];
const codeSyntaxHighlightMaxDocLength = 20_000;
const previewUpdateDebounceMs = 500;

function codeBlockLanguageOptions(current: string) {
  return [...new Set([current, ...codeBlockLanguages])];
}

function isMarkdownPath(path: string) {
  return path.endsWith(".md") || path.endsWith(".markdown");
}

function isExternalSrc(src: string) {
  return /^(https?:|data:|blob:|asset:)/i.test(src);
}

function resolveMarkdownAssetSrc(src: string) {
  if (!src || isExternalSrc(src)) return src;
  if (src.startsWith("/")) return convertFileSrc(src);

  const workspacePath = useEditorStore.getState().workspacePath;
  if (!workspacePath) return src;
  return convertFileSrc(`${workspacePath}/${src}`);
}

function snippetOffset(snippet: string, offset: number) {
  return Math.max(0, Math.min(snippet.length, offset));
}

function markerRange(from: number, to: number, active: boolean, className = ""): DecorationRange {
  if (active) {
    return { from, to, className: `cm-md-marker cm-md-marker--active${className ? ` ${className}` : ""}` };
  }

  return { from, to, replace: true };
}

function inlineMarkerActive(markers: InlineRange[], cursorFrom: number, cursorTo: number) {
  return markers.some((marker) => cursorTo >= marker.from && cursorFrom <= marker.to);
}

function escaped(text: string, index: number) {
  let slashCount = 0;
  for (let pos = index - 1; pos >= 0 && text[pos] === "\\"; pos -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function inlineMathRanges(lineText: string, lineFrom: number, fromOffset: number): InlineMathMatch[] {
  const matches: InlineMathMatch[] = [];

  for (let index = fromOffset; index < lineText.length - 2; index += 1) {
    if (lineText[index] !== "\\" || lineText[index + 1] !== "(" || escaped(lineText, index)) continue;
    const close = lineText.indexOf("\\)", index + 2);
    if (close === -1) break;
    if (close > index + 2 && !escaped(lineText, close)) {
      matches.push({
        from: lineFrom + index,
        to: lineFrom + close + 2,
        value: lineText.slice(index + 2, close).trim(),
      });
    }
    index = close + 1;
  }

  for (let index = fromOffset; index < lineText.length; index += 1) {
    if (lineText[index] !== "$" || escaped(lineText, index)) continue;
    if (lineText[index + 1] === "$") {
      index += 1;
      continue;
    }
    const before = index === 0 ? "" : lineText[index - 1];
    const after = lineText[index + 1] ?? "";
    if (!after || /\s/.test(after) || /\d/.test(before)) continue;

    for (let close = index + 1; close < lineText.length; close += 1) {
      if (lineText[close] !== "$" || escaped(lineText, close)) continue;
      if (lineText[close + 1] === "$") continue;
      const beforeClose = lineText[close - 1] ?? "";
      const afterClose = lineText[close + 1] ?? "";
      if (/\s/.test(beforeClose) || /\d/.test(afterClose)) continue;
      if (close > index + 1) {
        matches.push({
          from: lineFrom + index,
          to: lineFrom + close + 1,
          value: lineText.slice(index + 1, close).trim(),
        });
      }
      index = close;
      break;
    }
  }

  return matches.sort((a, b) => a.from - b.from || a.to - b.to);
}

function splitTableRow(text: string) {
  const normalized = normalizeTableDelimiterEscapes(text).trim();
  const body = normalized
    .replace(/^\|/, "")
    .replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (char === "\\" && next === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function escapeTableCell(cell: string) {
  return cell.replace(/\|/g, "\\|");
}

function formatTableRow(cells: string[]) {
  return `| ${cells.map(escapeTableCell).join(" | ")} |`;
}

function tableSnippet(snippet: string) {
  return snippet.split("\n").map(normalizeTableDelimiterEscapes).join("\n");
}

function serializeTable(table: Pick<MarkdownTable, "header" | "alignments" | "rows">) {
  const separator = table.alignments.map((align) => {
    if (align === "left") return ":---";
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  });

  return [
    formatTableRow(table.header),
    formatTableRow(separator),
    ...table.rows.map(formatTableRow),
  ].join("\n");
}

function parseTableAlignment(separator: string) {
  const cells = splitTableRow(separator);
  if (cells.length < 2 || cells.some((cell) => !/^:?-+:?$/.test(cell.replace(/\s+/g, "")))) return null;

  return cells.map((cell) => {
    const compact = cell.replace(/\s+/g, "");
    const left = compact.startsWith(":");
    const right = compact.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

function isTableRow(text: string) {
  return normalizeTableDelimiterEscapes(text).includes("|") && splitTableRow(text).length >= 2;
}

function tableAt(source: MarkdownDocSource, lineNumber: number): MarkdownTable | null {
  const doc = markdownDoc(source);
  if (lineNumber >= doc.lines) return null;

  const headerLine = doc.line(lineNumber);
  const separatorLine = doc.line(lineNumber + 1);
  if (!isTableRow(headerLine.text)) return null;

  const alignments = parseTableAlignment(separatorLine.text);
  if (!alignments) return null;

  const header = splitTableRow(headerLine.text);
  if (header.length !== alignments.length) return null;

  const rows: string[][] = [];
  let lastLine = separatorLine;
  let nextLineNumber = lineNumber + 2;
  while (nextLineNumber <= doc.lines) {
    const rowLine = doc.line(nextLineNumber);
    if (!isTableRow(rowLine.text)) break;
    rows.push(splitTableRow(rowLine.text));
    lastLine = rowLine;
    nextLineNumber += 1;
  }

  return {
    from: headerLine.from,
    to: lastLine.to,
    header,
    alignments,
    rows,
  };
}

function frontmatterAtTop(source: MarkdownDocSource): MarkdownFrontmatter | null {
  const doc = markdownDoc(source);
  if (doc.lines < 3) return null;

  const first = doc.line(1);
  if (first.text.trim() !== "---") return null;

  const bodyLines: string[] = [];
  let close = null as null | ReturnType<typeof doc.line>;
  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (line.text.trim() === "---") {
      close = line;
      break;
    }
    bodyLines.push(line.text);
  }

  if (!close) return null;

  const value = bodyLines.join("\n");
  const rows: MarkdownFrontmatter["rows"] = [];
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;
    rows.push({
      key: trimmed.slice(0, colonIndex).trim(),
      value: trimmed.slice(colonIndex + 1).trim(),
    });
  }

  return {
    from: first.from,
    to: close.to,
    value,
    rows,
  };
}

function imageAtLine(lineText: string, lineFrom: number): MarkdownImage | null {
  const match = lineText.match(/^(\s*)!\[([^\]\n]*)\]\((\S+?)(?:\s+"([^"]+)")?\)\s*$/);
  if (!match) return null;

  const from = lineFrom + match[1].length;
  return {
    from,
    to: lineFrom + match[0].trimEnd().length,
    alt: match[2],
    src: match[3],
    title: match[4],
  };
}

function codeBlockAt(source: MarkdownDocSource, lineNumber: number): MarkdownCodeBlock | null {
  const doc = markdownDoc(source);
  const openLine = doc.line(lineNumber);
  const open = openLine.text.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
  if (!open) return null;

  const fence = open[2];
  const fenceChar = fence[0];
  const closeRe = new RegExp(`^\\s*\\${fenceChar}{${fence.length},}\\s*$`);
  const language = normalizePrismLanguage(open[3].trim().split(/\s+/)[0] ?? "");
  let lastLine = openLine;
  const valueLines: string[] = [];

  for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
    const line = doc.line(nextLineNumber);
    lastLine = line;
    if (closeRe.test(line.text)) {
      return {
        from: openLine.from,
        to: line.to,
        language,
        value: valueLines.join("\n"),
        closed: true,
      };
    }
    valueLines.push(line.text);
  }

  return {
    from: openLine.from,
    to: lastLine.to,
    language,
    value: valueLines.join("\n"),
    closed: false,
  };
}

function mathBlockAt(source: MarkdownDocSource, lineNumber: number): MarkdownMathBlock | null {
  const doc = markdownDoc(source);
  const openLine = doc.line(lineNumber);

  const singleLineDollar = openLine.text.match(/^\s*\$\$(.+?)\$\$\s*$/);
  if (singleLineDollar) {
    return {
      from: openLine.from,
      to: openLine.to,
      value: singleLineDollar[1].trim(),
      kind: "dollar",
    };
  }

  const singleLineBracket = openLine.text.match(/^\s*\\\[(.+?)\\\]\s*$/);
  if (singleLineBracket) {
    return {
      from: openLine.from,
      to: openLine.to,
      value: singleLineBracket[1].trim(),
      kind: "bracket",
    };
  }

  const environment = openLine.text.match(/^\s*\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}\s*$/);
  if (environment) {
    const environmentName = environment[1];
    const lines = [openLine.text.trim()];
    let lastLine = openLine;
    const closeRe = new RegExp(`^\\s*\\\\end\\{${environmentName.replace(/\*/g, "\\*")}\\}\\s*$`);
    for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
      const line = doc.line(nextLineNumber);
      lastLine = line;
      lines.push(line.text.trimEnd());
      if (closeRe.test(line.text)) {
        return {
          from: openLine.from,
          to: line.to,
          value: lines.join("\n").trim(),
          kind: "environment",
        };
      }
    }

    return {
      from: openLine.from,
      to: lastLine.to,
      value: lines.join("\n").trim(),
      kind: "environment",
    };
  }

  const dollarOpen = /^\s*\$\$\s*$/.test(openLine.text);
  const bracketOpen = /^\s*\\\[\s*$/.test(openLine.text);
  if (!dollarOpen && !bracketOpen) return null;

  const lines: string[] = [];
  let lastLine = openLine;
  const closeRe = dollarOpen ? /^\s*\$\$\s*$/ : /^\s*\\\]\s*$/;
  for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
    const line = doc.line(nextLineNumber);
    lastLine = line;
    if (closeRe.test(line.text)) {
      return {
        from: openLine.from,
        to: line.to,
        value: lines.join("\n").trim(),
        kind: dollarOpen ? "dollar" : "bracket",
      };
    }
    lines.push(line.text);
  }

  return {
    from: openLine.from,
    to: lastLine.to,
    value: lines.join("\n").trim(),
    kind: dollarOpen ? "dollar" : "bracket",
  };
}

function normalizePrismLanguage(language: string) {
  const normalized = language.trim().toLowerCase().replace(/^language-/, "");
  return prismAliases[normalized] ?? normalized;
}

function shortAuthor(authors?: string[]) {
  const first = authors?.[0]?.trim();
  if (!first) return "";
  if (first.includes(",")) return first.split(",")[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1] ?? first;
}

function citationDisplayForKey(key: string) {
  const ref = useEditorStore.getState().references.find((r) => r.bibKey === key);
  if (!ref) {
    return {
      label: `@${key}`,
      title: `Missing reference: ${key}`,
      missing: true,
    };
  }

  const author = shortAuthor(ref.authors);
  const label = author && ref.year
    ? `${author} ${ref.year}`
    : author || ref.title?.slice(0, 28) || key;

  return {
    label,
    title: ref.title ? `${ref.title} (@${key})` : `@${key}`,
    missing: false,
  };
}

function citationOptions(query: string, refs: Reference[]) {
  const q = query.toLowerCase();
  return refs
    .filter((ref) => {
      if (!ref.bibKey) return false;
      if (!q) return true;
      return (
        ref.bibKey.toLowerCase().includes(q) ||
        (ref.title?.toLowerCase().includes(q) ?? false) ||
        (ref.authors?.some((author) => author.toLowerCase().includes(q)) ?? false)
      );
    })
    .slice(0, 8)
    .map((ref): CitationOption => {
      const key = ref.bibKey!;
      const author = shortAuthor(ref.authors);
      const label = author && ref.year ? `${author} ${ref.year}` : ref.title || key;
      const meta = ref.title && ref.title !== label ? ref.title : ref.name;
      return { key, label, meta };
    });
}

function syntaxTokenClasses(tokens: string[]) {
  return [...new Set(tokens)]
    .map((token) => token.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
    .filter((token) => token && token !== "token")
    .map((token) => `cm-md-token-${token}`);
}

function hastClassNames(node: HastElement) {
  const className = node.properties?.className;
  if (Array.isArray(className)) return className.map(String);
  if (typeof className === "string") return className.split(/\s+/);
  return [];
}

function isHastText(node: HastNode): node is HastText {
  return node.type === "text";
}

function isHastElement(node: HastNode): node is HastElement {
  return node.type === "element";
}

function addSyntaxTokenDecorations(
  ranges: DecorationRange[],
  lineText: string,
  lineFrom: number,
  language: string,
) {
  if (!language || !lineText || !refractor.registered(language)) return;

  const visit = (node: HastRoot | HastNode, offset: number, inherited: string[]): number => {
    if (isHastText(node)) {
      const end = offset + node.value.length;
      const classes = syntaxTokenClasses(inherited);
      if (offset < end && classes.length > 0) {
        ranges.push({
          from: lineFrom + offset,
          to: lineFrom + end,
          className: `cm-md-token ${classes.join(" ")}`,
        });
      }
      return end;
    }

    if (isHastElement(node)) {
      const classes = [...hastClassNames(node), ...inherited];
      return node.children.reduce((current, child) => visit(child, current, classes), offset);
    }

    if ("children" in node) {
      return node.children.reduce((current, child) => visit(child, current, inherited), offset);
    }

    return offset;
  };

  try {
    visit(refractor.highlight(lineText, language), 0, []);
  } catch {
    // Some Prism grammars are permissive enough to throw on partial lines.
    // In that case, keep the code readable without token colors.
  }
}

class MarkdownTableWidget extends WidgetType {
  private cleanup: (() => void) | null = null;

  constructor(private readonly table: MarkdownTable) {
    super();
  }

  eq(other: MarkdownTableWidget) {
    return JSON.stringify(this.table) === JSON.stringify(other.table);
  }

  toDOM(view: EditorView) {
    this.cleanup?.();
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-render";
    wrap.tabIndex = -1;
    const draftHeader = [...this.table.header];
    const draftAlignments = [...this.table.alignments];
    const draftRows = this.table.rows.map((row) => [...row]);
    const tableFrom = this.table.from;
    let tableTo = this.table.to;
    let committedSource = view.state.sliceDoc(tableFrom, tableTo);
    const renderedCells = new Map<string, HTMLTableCellElement>();
    let selectionAnchor: { row: number; col: number } | null = null;
    let lastClickedCell: { row: number; col: number } | null = null;
    let selectedRange: { startRow: number; endRow: number; startCol: number; endCol: number } | null = null;
    let draggingTableSelection = false;
    let removeDragListeners: (() => void) | null = null;
    let originalBodyUserSelect = "";

    const cellKey = (row: number, col: number) => `${row}:${col}`;
    const cellPosition = (cell: HTMLTableCellElement | null) => {
      if (!cell || !wrap.contains(cell)) return null;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
      return { row, col };
    };
    const cellFromTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return cellPosition(element?.closest<HTMLTableCellElement>(".cm-md-table-render th, .cm-md-table-render td") ?? null);
    };
    const cellFromEvent = (event: MouseEvent) => {
      if (typeof document.elementFromPoint !== "function") return null;
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      return cellFromTarget(target);
    };
    const normalizeRange = (from: { row: number; col: number }, to: { row: number; col: number }) => ({
      startRow: Math.min(from.row, to.row),
      endRow: Math.max(from.row, to.row),
      startCol: Math.min(from.col, to.col),
      endCol: Math.max(from.col, to.col),
    });

    const clearBrowserSelection = () => {
      window.getSelection()?.removeAllRanges();
    };

    const beginTableSelectionDrag = () => {
      if (draggingTableSelection) return;
      draggingTableSelection = true;
      wrap.classList.add("is-selecting-cells");
      originalBodyUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      if (wrap.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      for (const cell of renderedCells.values()) {
        cell.contentEditable = "false";
        cell.setAttribute("contenteditable", "false");
      }
      clearBrowserSelection();
      requestAnimationFrame(clearBrowserSelection);
    };

    const finishTableSelectionDrag = () => {
      if (!draggingTableSelection) return;
      document.body.style.userSelect = originalBodyUserSelect;
      for (const cell of renderedCells.values()) {
        cell.contentEditable = "true";
        cell.setAttribute("contenteditable", "true");
      }
      clearBrowserSelection();
    };

    const endDragTracking = () => {
      removeDragListeners?.();
      removeDragListeners = null;
      finishTableSelectionDrag();
      wrap.classList.remove("is-selecting-cells");
      selectionAnchor = null;
      draggingTableSelection = false;
    };

    const tableValueAt = (row: number, col: number) => {
      if (row === 0) return draftHeader[col] ?? "";
      return draftRows[row - 1]?.[col] ?? "";
    };

    const selectedTableText = () => {
      if (!selectedRange) return "";

      const rows: string[] = [];
      for (let row = selectedRange.startRow; row <= selectedRange.endRow; row += 1) {
        const cells: string[] = [];
        for (let col = selectedRange.startCol; col <= selectedRange.endCol; col += 1) {
          cells.push(tableValueAt(row, col));
        }
        rows.push(cells.join("\t"));
      }
      return rows.join("\n");
    };

    const applyTableSelection = (from: { row: number; col: number }, to: { row: number; col: number }) => {
      selectedRange = normalizeRange(from, to);
      for (const cell of renderedCells.values()) {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        const selected =
          row >= selectedRange.startRow &&
          row <= selectedRange.endRow &&
          col >= selectedRange.startCol &&
          col <= selectedRange.endCol;
        cell.classList.toggle("is-selected", selected);
        cell.classList.toggle("is-selection-anchor", selected && row === from.row && col === from.col);
        if (selected) cell.setAttribute("aria-selected", "true");
        else cell.removeAttribute("aria-selected");
      }
    };

    const updateDragSelection = (nextCell: { row: number; col: number } | null, event: MouseEvent) => {
      if (!selectionAnchor || !nextCell) return;
      if (nextCell.row === selectionAnchor.row && nextCell.col === selectionAnchor.col && !draggingTableSelection) return;

      event.preventDefault();
      event.stopPropagation();
      beginTableSelectionDrag();
      clearBrowserSelection();
      applyTableSelection(selectionAnchor, nextCell);
    };

    const trackCellSelectionDrag = () => {
      removeDragListeners?.();

      const onMouseMove = (event: MouseEvent) => {
        updateDragSelection(cellFromEvent(event) ?? cellFromTarget(event.target), event);
      };

      const onMouseOver = (event: MouseEvent) => {
        updateDragSelection(cellFromTarget(event.target), event);
      };

      const onSelectStart = (event: Event) => {
        if (!draggingTableSelection) return;
        event.preventDefault();
      };

      const onMouseUp = (event: MouseEvent) => {
        if (draggingTableSelection) {
          event.preventDefault();
          clearBrowserSelection();
          wrap.focus();
        }
        endDragTracking();
      };

      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("mouseup", onMouseUp, true);
      document.addEventListener("selectstart", onSelectStart, true);
      wrap.addEventListener("mouseover", onMouseOver, true);
      wrap.addEventListener("mousemove", onMouseOver, true);
      removeDragListeners = () => {
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("mouseup", onMouseUp, true);
        document.removeEventListener("selectstart", onSelectStart, true);
        wrap.removeEventListener("mouseover", onMouseOver, true);
        wrap.removeEventListener("mousemove", onMouseOver, true);
      };
    };

    const commitTableEdit = () => {
      const nextSource = serializeTable({
        header: draftHeader,
        alignments: draftAlignments,
        rows: draftRows,
      });
      if (committedSource === nextSource) return;

      view.dispatch({
        changes: { from: tableFrom, to: tableTo, insert: nextSource },
      });
      tableTo = tableFrom + nextSource.length;
      committedSource = nextSource;
    };

    const replaceTableSource = (nextSource: string) => {
      view.dispatch({
        changes: { from: tableFrom, to: tableTo, insert: nextSource },
        selection: EditorSelection.cursor(tableFrom),
        scrollIntoView: true,
      });
      tableTo = tableFrom + nextSource.length;
      committedSource = nextSource;
      view.focus();
    };

    const selectedColumnIndexes = () => {
      if (selectedRange) {
        const indexes: number[] = [];
        for (let col = selectedRange.startCol; col <= selectedRange.endCol; col += 1) indexes.push(col);
        return indexes;
      }
      if (lastClickedCell) return [lastClickedCell.col];
      return draftHeader.length > 0 ? [draftHeader.length - 1] : [];
    };

    const selectedDataRowIndexes = () => {
      if (selectedRange) {
        const indexes: number[] = [];
        for (let row = Math.max(1, selectedRange.startRow); row <= selectedRange.endRow; row += 1) indexes.push(row - 1);
        return indexes;
      }
      if (lastClickedCell && lastClickedCell.row > 0) return [lastClickedCell.row - 1];
      return draftRows.length > 0 ? [draftRows.length - 1] : [];
    };

    const nextTableSource = (header: string[], alignments: MarkdownTable["alignments"], rows: string[][]) => (
      serializeTable({ header, alignments, rows })
    );

    const makeEditableCell = (
      cell: HTMLTableCellElement,
      value: string,
      rowIndex: number,
      colIndex: number,
      onChange: (nextValue: string) => void,
    ) => {
      cell.contentEditable = "true";
      cell.setAttribute("contenteditable", "true");
      cell.spellcheck = true;
      cell.dataset.row = `${rowIndex}`;
      cell.dataset.col = `${colIndex}`;
      cell.textContent = value;
      renderedCells.set(cellKey(rowIndex, colIndex), cell);

      const updateValue = () => {
        onChange((cell.textContent ?? "").replace(/\s*\n+\s*/g, " "));
      };

      cell.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        if (event.button !== 0) return;

        if (event.shiftKey && (selectedRange || lastClickedCell)) {
          event.preventDefault();
          const rangeAnchor = selectedRange
            ? { row: selectedRange.startRow, col: selectedRange.startCol }
            : lastClickedCell;
          if (!rangeAnchor) return;
          selectionAnchor = rangeAnchor;
          applyTableSelection(selectionAnchor, { row: rowIndex, col: colIndex });
          wrap.focus();
          selectionAnchor = null;
          return;
        }

        selectionAnchor = { row: rowIndex, col: colIndex };
        draggingTableSelection = false;
        trackCellSelectionDrag();
      });
      cell.addEventListener("mouseup", (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (!draggingTableSelection) {
          lastClickedCell = { row: rowIndex, col: colIndex };
        }
      });
      cell.addEventListener("input", updateValue);
      cell.addEventListener("blur", () => {
        updateValue();
        commitTableEdit();
      });
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          updateValue();
          commitTableEdit();
          cell.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cell.textContent = value;
          updateValue();
          cell.blur();
        }
      });
      cell.addEventListener("paste", (event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text == null) return;
        event.preventDefault();

        const selection = window.getSelection();
        if (!selection?.rangeCount) return;

        selection.deleteFromDocument();
        selection.getRangeAt(0).insertNode(document.createTextNode(text.replace(/\s*\n+\s*/g, " ")));
        selection.collapseToEnd();
        updateValue();
      });
    };

    const finishTableSelection = () => {
      endDragTracking();
    };
    document.addEventListener("mouseup", finishTableSelection);
    this.cleanup = () => {
      endDragTracking();
      document.removeEventListener("mouseup", finishTableSelection);
    };

    wrap.addEventListener("copy", (event) => {
      if (!selectedRange) return;
      const activeElement = document.activeElement as HTMLElement | null;
      const domSelection = window.getSelection();
      if (activeElement?.closest("[contenteditable='true']") && domSelection && !domSelection.isCollapsed) return;

      event.preventDefault();
      event.clipboardData?.setData("text/plain", selectedTableText());
    });

    wrap.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !selectedRange) return;
      selectedRange = null;
      for (const cell of renderedCells.values()) {
        cell.classList.remove("is-selected", "is-selection-anchor");
        cell.removeAttribute("aria-selected");
      }
    });

    const actions = document.createElement("div");
    actions.className = "cm-md-table-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit source";
    editBtn.addEventListener("mousedown", (event) => event.preventDefault());
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({
        effects: editTableSourceEffect.of({ from: this.table.from, to: this.table.to }),
        selection: EditorSelection.cursor(this.table.from),
        scrollIntoView: true,
      });
      view.focus();
    });
    actions.appendChild(editBtn);

    const rowBtn = document.createElement("button");
    rowBtn.type = "button";
    rowBtn.textContent = "+ Row";
    rowBtn.addEventListener("mousedown", (event) => event.preventDefault());
    rowBtn.addEventListener("click", (event) => {
      event.preventDefault();
      replaceTableSource(nextTableSource(
        draftHeader,
        draftAlignments,
        [...draftRows, draftHeader.map(() => "")],
      ));
    });
    actions.appendChild(rowBtn);

    const colBtn = document.createElement("button");
    colBtn.type = "button";
    colBtn.textContent = "+ Column";
    colBtn.addEventListener("mousedown", (event) => event.preventDefault());
    colBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const nextColumn = `Column ${draftHeader.length + 1}`;
      replaceTableSource(nextTableSource(
        [...draftHeader, nextColumn],
        [...draftAlignments, null],
        draftRows.map((row) => [...row, ""]),
      ));
    });
    actions.appendChild(colBtn);

    const deleteRowBtn = document.createElement("button");
    deleteRowBtn.type = "button";
    deleteRowBtn.textContent = "- Row";
    deleteRowBtn.addEventListener("mousedown", (event) => event.preventDefault());
    deleteRowBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const rowsToDelete = new Set(selectedDataRowIndexes());
      if (rowsToDelete.size === 0) return;
      replaceTableSource(nextTableSource(
        draftHeader,
        draftAlignments,
        draftRows.filter((_, index) => !rowsToDelete.has(index)),
      ));
    });
    actions.appendChild(deleteRowBtn);

    const deleteColBtn = document.createElement("button");
    deleteColBtn.type = "button";
    deleteColBtn.textContent = "- Column";
    deleteColBtn.addEventListener("mousedown", (event) => event.preventDefault());
    deleteColBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const columnsToDelete = new Set(selectedColumnIndexes());
      if (columnsToDelete.size === 0) return;
      if (columnsToDelete.size >= draftHeader.length) {
        replaceTableSource("");
        return;
      }
      replaceTableSource(nextTableSource(
        draftHeader.filter((_, index) => !columnsToDelete.has(index)),
        draftAlignments.filter((_, index) => !columnsToDelete.has(index)),
        draftRows.map((row) => row.filter((_, index) => !columnsToDelete.has(index))),
      ));
    });
    actions.appendChild(deleteColBtn);

    const deleteTableBtn = document.createElement("button");
    deleteTableBtn.type = "button";
    deleteTableBtn.textContent = "Delete table";
    deleteTableBtn.addEventListener("mousedown", (event) => event.preventDefault());
    deleteTableBtn.addEventListener("click", (event) => {
      event.preventDefault();
      replaceTableSource("");
    });
    actions.appendChild(deleteTableBtn);

    wrap.appendChild(actions);

    wrap.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("button, [contenteditable='true']")) return;
      event.preventDefault();
      view.focus();
    });

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const [index, cell] of this.table.header.entries()) {
      const th = document.createElement("th");
      makeEditableCell(th, cell, 0, index, (nextValue) => {
        draftHeader[index] = nextValue;
      });
      if (this.table.alignments[index]) th.style.textAlign = this.table.alignments[index]!;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const [rowIndex, row] of this.table.rows.entries()) {
      const tr = document.createElement("tr");
      for (let index = 0; index < this.table.header.length; index += 1) {
        const td = document.createElement("td");
        makeEditableCell(td, row[index] ?? "", rowIndex + 1, index, (nextValue) => {
          draftRows[rowIndex][index] = nextValue;
        });
        if (this.table.alignments[index]) td.style.textAlign = this.table.alignments[index]!;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    return wrap;
  }

  ignoreEvent(event: Event) {
    const target = event.target as HTMLElement | null;
    return !!target?.closest("button, [contenteditable='true']");
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(private readonly frontmatter: MarkdownFrontmatter) {
    super();
  }

  eq(other: FrontmatterWidget) {
    return this.frontmatter.value === other.frontmatter.value;
  }

  toDOM(view: EditorView) {
    const panel = document.createElement("div");
    panel.className = "cm-md-frontmatter-panel";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "cm-md-frontmatter-header";

    const caret = document.createElement("span");
    caret.className = "cm-md-frontmatter-caret";
    caret.textContent = "▸";
    header.appendChild(caret);

    const label = document.createElement("span");
    label.textContent = "Properties";
    header.appendChild(label);

    const count = document.createElement("span");
    count.className = "cm-md-frontmatter-count";
    count.textContent = `${this.frontmatter.rows.length}`;
    header.appendChild(count);

    const body = document.createElement("div");
    body.className = "cm-md-frontmatter-body";
    body.hidden = true;

    if (this.frontmatter.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cm-md-frontmatter-empty";
      empty.textContent = "No properties";
      body.appendChild(empty);
    } else {
      for (const row of this.frontmatter.rows) {
        const item = document.createElement("div");
        item.className = "cm-md-frontmatter-row";

        const key = document.createElement("span");
        key.className = "cm-md-frontmatter-key";
        key.textContent = row.key;
        item.appendChild(key);

        const value = document.createElement("span");
        value.className = "cm-md-frontmatter-value";
        value.textContent = row.value || "empty";
        item.appendChild(value);

        body.appendChild(item);
      }
    }

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-md-frontmatter-edit";
    edit.textContent = "Edit source";
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.cursor(this.frontmatter.to),
        scrollIntoView: true,
      });
      view.focus();
    });
    body.appendChild(edit);

    header.addEventListener("mousedown", (event) => event.preventDefault());
    header.addEventListener("click", () => {
      body.hidden = !body.hidden;
      caret.textContent = body.hidden ? "▸" : "▾";
      view.requestMeasure();
    });

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
  }
}

class MarkdownImageWidget extends WidgetType {
  constructor(private readonly image: MarkdownImage) {
    super();
  }

  eq(other: MarkdownImageWidget) {
    return JSON.stringify(this.image) === JSON.stringify(other.image);
  }

  toDOM(view: EditorView) {
    const figure = document.createElement("figure");
    figure.className = "cm-md-image-render";

    const actions = document.createElement("div");
    actions.className = "cm-md-image-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit source";
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.range(this.image.from, this.image.to),
        scrollIntoView: true,
      });
      view.focus();
    });
    actions.appendChild(edit);
    figure.appendChild(actions);

    const img = document.createElement("img");
    img.src = resolveMarkdownAssetSrc(this.image.src);
    img.alt = this.image.alt;
    img.title = this.image.title || this.image.alt || this.image.src;
    img.addEventListener("error", () => {
      figure.classList.add("cm-md-image-render--broken");
      view.requestMeasure();
    });
    img.addEventListener("load", () => {
      figure.classList.remove("cm-md-image-render--broken");
      view.requestMeasure();
    });
    figure.appendChild(img);

    const broken = document.createElement("figcaption");
    broken.className = "cm-md-image-broken";
    broken.textContent = this.image.src ? `Image not found: ${this.image.src}` : "Image path is empty";
    figure.appendChild(broken);

    if (this.image.alt) {
      const caption = document.createElement("figcaption");
      caption.className = "cm-md-image-caption";
      caption.textContent = this.image.alt;
      figure.appendChild(caption);
    }

    figure.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.range(this.image.from, this.image.to),
        scrollIntoView: true,
      });
      view.focus();
    });

    return figure;
  }
}

class CitationWidget extends WidgetType {
  constructor(
    private readonly key: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: CitationWidget) {
    return this.key === other.key && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const span = document.createElement("span");
    const display = citationDisplayForKey(this.key);
    span.className = `cm-md-citation${display.missing ? " cm-md-citation--missing" : ""}`;
    span.textContent = display.label;
    span.title = display.title;
    span.contentEditable = "false";
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.range(this.from, this.to),
        scrollIntoView: true,
      });
      view.focus();
    });
    return span;
  }
}

class MathWidget extends WidgetType {
  constructor(
    private readonly value: string,
    private readonly displayMode: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return (
      this.value === other.value &&
      this.displayMode === other.displayMode &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView) {
    const span = document.createElement(this.displayMode ? "div" : "span");
    span.className = this.displayMode ? "cm-md-math cm-md-math-block-render" : "cm-md-math cm-md-math-inline-render";
    if (this.value.trim()) {
      try {
        katex.render(this.value, span, {
          displayMode: this.displayMode,
          throwOnError: false,
          strict: "warn",
          trust: false,
          output: "html",
        });
      } catch (error) {
        span.classList.add("cm-md-math-error");
        span.textContent = error instanceof Error ? error.message : "Invalid math";
      }
    } else {
      span.classList.add("cm-md-math-empty");
    }
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.range(this.from, this.to),
        scrollIntoView: true,
      });
      view.focus();
    });
    return span;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: HorizontalRuleWidget) {
    return this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const hr = document.createElement("hr");
    hr.className = "cm-md-horizontal-rule";
    hr.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.cursor(this.to),
        scrollIntoView: true,
      });
      view.focus();
    });
    return hr;
  }

  ignoreEvent() {
    return false;
  }
}

class CodeBlockActionsWidget extends WidgetType {
  private cleanup: (() => void) | null = null;

  constructor(
    private readonly codeBlock: MarkdownCodeBlock,
    private readonly active: boolean,
  ) {
    super();
  }

  eq(other: CodeBlockActionsWidget) {
    return (
      this.codeBlock.from === other.codeBlock.from &&
      this.codeBlock.value === other.codeBlock.value &&
      this.codeBlock.language === other.codeBlock.language &&
      this.active === other.active
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-code-actions-widget";
    if (this.active) wrap.classList.add("is-active");

    const stopMouse = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const languageButton = document.createElement("button");
    languageButton.type = "button";
    languageButton.className = "cm-md-code-action cm-md-code-language";
    languageButton.textContent = this.codeBlock.language || "text";
    languageButton.setAttribute("aria-label", "Change code block language");
    languageButton.title = "Change language";
    languageButton.addEventListener("mousedown", stopMouse);

    const menu = document.createElement("div");
    menu.className = "cm-md-code-language-menu";
    menu.hidden = true;

    const setMenuOpen = (open: boolean) => {
      menu.hidden = !open;
      wrap.classList.toggle("is-open", open);
    };

    const applyLanguage = (nextLanguage: string) => {
      const openLine = view.state.doc.lineAt(this.codeBlock.from);
      const open = openLine.text.match(/^(\s*)(`{3,}|~{3,})/);
      if (!open) return;

      const nextOpenLine = `${open[1]}${open[2]}${nextLanguage}`;
      view.dispatch({
        changes: { from: openLine.from, to: openLine.to, insert: nextOpenLine },
        selection: EditorSelection.cursor(openLine.from + nextOpenLine.length),
        scrollIntoView: true,
      });
      view.focus();
    };

    for (const language of codeBlockLanguageOptions(this.codeBlock.language)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `cm-md-code-language-option${language === this.codeBlock.language ? " is-selected" : ""}`;
      item.textContent = language || "Plain text";
      item.addEventListener("mousedown", stopMouse);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        applyLanguage(language);
      });
      menu.appendChild(item);
    }

    languageButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(menu.hidden);
    });
    wrap.appendChild(languageButton);
    wrap.appendChild(menu);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "cm-md-code-action cm-md-code-copy";
    copyButton.textContent = "⧉";
    copyButton.setAttribute("aria-label", "Copy code");
    copyButton.title = "Copy code";
    copyButton.addEventListener("mousedown", stopMouse);
    copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigator.clipboard?.writeText(this.codeBlock.value).then(() => {
        copyButton.textContent = "✓";
        window.setTimeout(() => {
          copyButton.textContent = "⧉";
        }, 900);
      }).catch(() => {
        copyButton.textContent = "!";
        window.setTimeout(() => {
          copyButton.textContent = "⧉";
        }, 1100);
      });
    });
    wrap.appendChild(copyButton);

    const syncHover = (event: MouseEvent) => {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      wrap.classList.toggle("is-hovered", pos !== null && pos >= this.codeBlock.from && pos <= this.codeBlock.to);
    };
    const clearHover = () => wrap.classList.remove("is-hovered");
    const closeOnOutside = (event: MouseEvent) => {
      if (!wrap.contains(event.target as Node)) setMenuOpen(false);
    };

    view.scrollDOM.addEventListener("mousemove", syncHover);
    view.scrollDOM.addEventListener("mouseleave", clearHover);
    window.addEventListener("mousedown", closeOnOutside, true);
    this.cleanup = () => {
      view.scrollDOM.removeEventListener("mousemove", syncHover);
      view.scrollDOM.removeEventListener("mouseleave", clearHover);
      window.removeEventListener("mousedown", closeOnOutside, true);
    };

    return wrap;
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }

  ignoreEvent() {
    return false;
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly kind: "bullet" | "ordered",
    private readonly label = "",
  ) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return this.kind === other.kind && this.label === other.label;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-md-list-marker cm-md-list-marker--${this.kind}`;
    span.textContent = this.kind === "ordered" ? this.label : "";
    return span;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly markerFrom: number,
    private readonly markerTo: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return this.checked === other.checked && this.markerFrom === other.markerFrom && this.markerTo === other.markerTo;
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-md-task-checkbox${this.checked ? " is-checked" : ""}`;
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
    button.setAttribute("aria-checked", String(this.checked));
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = this.checked ? " " : "x";
      const selection = view.state.selection;
      view.dispatch({
        changes: { from: this.markerFrom + 3, to: this.markerFrom + 4, insert: next },
        selection,
      });
    });
    return button;
  }

  ignoreEvent() {
    return false;
  }
}

function addInlineDecorations(
  ranges: DecorationRange[],
  lineText: string,
  lineFrom: number,
  fromOffset: number,
  cursorFrom: number,
  cursorTo: number,
) {
  const re = /\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|~~([^~\n]+?)~~|`([^`\n]+?)`|\[([^\]\n]+?)\]\(([^)\n]+?)\)|_([^_\n]+?)_|\*([^*\n]+?)\*/g;
  re.lastIndex = fromOffset;

  let match: RegExpExecArray | null;
  while ((match = re.exec(lineText)) !== null) {
    const start = lineFrom + match.index;
    const end = start + match[0].length;

    if (match[1] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 3, active));
      ranges.push({ from: start + 3, to: end - 3, className: "cm-md-bold cm-md-italic" });
      ranges.push(markerRange(end - 3, end, active));
    } else if (match[2] !== undefined || match[3] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 2, active));
      ranges.push({ from: start + 2, to: end - 2, className: "cm-md-bold" });
      ranges.push(markerRange(end - 2, end, active));
    } else if (match[4] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 2, active));
      ranges.push({ from: start + 2, to: end - 2, className: "cm-md-strike" });
      ranges.push(markerRange(end - 2, end, active));
    } else if (match[5] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 1, active));
      ranges.push({ from: start + 1, to: end - 1, className: "cm-md-code" });
      ranges.push(markerRange(end - 1, end, active));
    } else if (match[6] !== undefined && match[7] !== undefined) {
      const labelEnd = start + 1 + match[6].length;
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 1, active));
      ranges.push({ from: start + 1, to: labelEnd, className: "cm-md-link" });
      ranges.push(markerRange(labelEnd, end, active));
    } else if (match[8] !== undefined || match[9] !== undefined) {
      const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
      ranges.push(markerRange(start, start + 1, active));
      ranges.push({ from: start + 1, to: end - 1, className: "cm-md-italic" });
      ranges.push(markerRange(end - 1, end, active));
    }
  }

  for (const math of inlineMathRanges(lineText, lineFrom, fromOffset)) {
    const overlapsInlineCode = ranges.some((range) => (
      range.className?.includes("cm-md-code") &&
      range.from < math.to &&
      range.to > math.from
    ));
    if (overlapsInlineCode) continue;

    const active = inlineMarkerActive([{ from: math.from, to: math.to }], cursorFrom, cursorTo);
    if (active) {
      ranges.push(markerRange(math.from, math.to, true));
    } else {
      ranges.push({
        from: math.from,
        to: math.to,
        replace: true,
        widget: new MathWidget(math.value, false, math.from, math.to),
      });
    }
  }

  const citeRe = /\[@([^\]\n]+)\]/g;
  citeRe.lastIndex = fromOffset;
  while ((match = citeRe.exec(lineText)) !== null) {
    const start = lineFrom + match.index;
    const end = start + match[0].length;
    const active = inlineMarkerActive([{ from: start, to: end }], cursorFrom, cursorTo);
    if (active) {
      ranges.push({ from: start, to: end, className: "cm-md-citation-source" });
    } else {
      ranges.push({
        from: start,
        to: end,
        replace: true,
        widget: new CitationWidget(match[1].trim(), start, end),
      });
    }
  }

  const emojiRe = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*|\p{Regional_Indicator}{2}/gu;
  emojiRe.lastIndex = fromOffset;
  while ((match = emojiRe.exec(lineText)) !== null) {
    const start = lineFrom + match.index;
    const end = start + match[0].length;
    ranges.push({ from: start, to: end, className: "cm-md-emoji" });
  }
}

function linkAtPosition(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const linkRe = /!?\[([^\]\n]+?)\]\(([^)\s]+)(?:\s+"[^"]+")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(line.text)) !== null) {
    if (match[0].startsWith("!")) continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) return { from, to, href: match[2] };
  }
  return null;
}

function buildMarkdownDecorations(state: EditorState) {
  const ranges: DecorationRange[] = [];
  const selection = state.selection.main;
  const cursorFrom = selection.from;
  const cursorTo = selection.to;
  const doc = state.doc;
  const enableCodeSyntaxHighlighting = doc.length <= codeSyntaxHighlightMaxDocLength;
  const frontmatter = frontmatterAtTop(state);
  const tableSourceEditRange = state.field(tableSourceEditRangeField, false);

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const text = line.text;

    if (frontmatter && line.from === frontmatter.from) {
      const activeFrontmatter = cursorTo >= frontmatter.from && cursorFrom <= frontmatter.to;
      const lastFrontmatterLineNumber = doc.lineAt(frontmatter.to).number;
      if (activeFrontmatter) {
        for (let fmLineNumber = line.number; fmLineNumber <= lastFrontmatterLineNumber; fmLineNumber += 1) {
          const fmLine = doc.line(fmLineNumber);
          ranges.push({ from: fmLine.from, to: fmLine.to, className: "cm-md-frontmatter-source" });
        }
      } else {
        ranges.push({
          from: frontmatter.from,
          to: frontmatter.to,
          replace: true,
          block: true,
          widget: new FrontmatterWidget(frontmatter),
        });
      }

      lineNumber = lastFrontmatterLineNumber;
      continue;
    }

    const mathBlock = mathBlockAt(state, line.number);
    if (mathBlock) {
      const activeMathBlock = cursorTo >= mathBlock.from && cursorFrom <= mathBlock.to;
      const lastMathLineNumber = doc.lineAt(mathBlock.to).number;
      if (activeMathBlock) {
        for (let mathLineNumber = line.number; mathLineNumber <= lastMathLineNumber; mathLineNumber += 1) {
          const mathLine = doc.line(mathLineNumber);
          ranges.push({ from: mathLine.from, to: mathLine.to, className: "cm-md-math-source" });
        }
      } else {
        ranges.push({
          from: mathBlock.from,
          to: mathBlock.to,
          replace: true,
          block: true,
          widget: new MathWidget(mathBlock.value, true, mathBlock.from, mathBlock.to),
        });
      }

      lineNumber = lastMathLineNumber;
      continue;
    }

    const codeBlock = codeBlockAt(state, line.number);
    if (codeBlock) {
      const activeCodeBlock = cursorTo >= codeBlock.from && cursorFrom <= codeBlock.to;
      const lastCodeLineNumber = doc.lineAt(codeBlock.to).number;

      for (let codeLineNumber = line.number; codeLineNumber <= lastCodeLineNumber; codeLineNumber += 1) {
        const codeLine = doc.line(codeLineNumber);
        const isOpenFenceLine = codeLineNumber === line.number;
        const isCloseFenceLine = codeBlock.closed && codeLineNumber === lastCodeLineNumber;
        const isFenceLine = isOpenFenceLine || isCloseFenceLine;
        const isFirstLine = codeLineNumber === line.number;
        const isLastLine = codeLineNumber === lastCodeLineNumber;

        const lineClasses = [
          "cm-md-code-block-line",
          isFirstLine ? "cm-md-code-block-line--first" : "",
          isLastLine ? "cm-md-code-block-line--last" : "",
        ].filter(Boolean).join(" ");
        ranges.push({ from: codeLine.from, to: codeLine.from, line: true, className: lineClasses });
        if (isFenceLine && !activeCodeBlock) {
          ranges.push({ from: codeLine.from, to: codeLine.to, className: "cm-md-code-fence-hidden" });
        } else {
          ranges.push({ from: codeLine.from, to: codeLine.to, className: "cm-md-code-block-source" });
        }
        if (isOpenFenceLine) {
          ranges.push({
            from: codeLine.from,
            to: codeLine.from,
            point: true,
            side: 1,
            widget: new CodeBlockActionsWidget(codeBlock, activeCodeBlock),
          });
        }
        if (!isFenceLine && enableCodeSyntaxHighlighting) {
          addSyntaxTokenDecorations(ranges, codeLine.text, codeLine.from, codeBlock.language);
        }
      }

      lineNumber = lastCodeLineNumber;
      continue;
    }

    const image = imageAtLine(text, line.from);
    if (image) {
      const activeImage = cursorTo >= image.from && cursorFrom <= image.to;
      if (activeImage) {
        ranges.push({ from: image.from, to: image.to, className: "cm-md-image-source" });
      } else {
        ranges.push({
          from: image.from,
          to: image.to,
          replace: true,
          block: true,
          widget: new MarkdownImageWidget(image),
        });
      }
      continue;
    }

    const table = tableAt(state, line.number);
    if (table) {
      const activeTable = !!tableSourceEditRange && tableSourceEditRange.to >= table.from && tableSourceEditRange.from <= table.to;
      const lastTableLineNumber = doc.lineAt(table.to).number;
      if (activeTable) {
        for (let tableLineNumber = line.number; tableLineNumber <= lastTableLineNumber; tableLineNumber += 1) {
          const tableLine = doc.line(tableLineNumber);
          ranges.push({ from: tableLine.from, to: tableLine.to, className: "cm-md-table-source" });
        }
      } else {
        ranges.push({
          from: table.from,
          to: table.to,
          replace: true,
          block: true,
          widget: new MarkdownTableWidget(table),
        });
      }

      lineNumber = lastTableLineNumber;
      continue;
    }

    const activeLine = cursorTo >= line.from && cursorFrom <= line.to;
    const heading = text.match(/^(#{1,6})\s+/);
    const blockquote = text.match(/^(>+\s?)/);
    const task = text.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+/);
    const unordered = text.match(/^(\s*)([-*+])\s+/);
    const ordered = text.match(/^(\s*)(\d+\.)\s+/);

    if (heading) {
      const level = Math.min(heading[1].length, 6);
      ranges.push({ from: line.from, to: line.from, line: true, className: `cm-md-heading-line cm-md-hl-${level}` });
      ranges.push(markerRange(line.from, line.from + heading[0].length, activeLine, `cm-heading-marker-${level}`));
      ranges.push({ from: line.from + heading[0].length, to: line.to, className: `cm-md-heading cm-md-h${level}` });
      addInlineDecorations(ranges, text, line.from, heading[0].length, cursorFrom, cursorTo);
    } else if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(text)) {
      if (activeLine) {
        ranges.push({ from: line.from, to: line.to, className: "cm-md-rule-source" });
      } else {
        ranges.push({
          from: line.from,
          to: line.to,
          replace: true,
          block: true,
          widget: new HorizontalRuleWidget(line.from, line.to),
        });
      }
    } else if (blockquote) {
      ranges.push({ from: line.from, to: line.from, line: true, className: "cm-md-blockquote-line" });
      ranges.push(markerRange(line.from, line.from + blockquote[1].length, activeLine));
      ranges.push({ from: line.from + blockquote[1].length, to: line.to, className: "cm-md-blockquote" });
      addInlineDecorations(ranges, text, line.from, blockquote[1].length, cursorFrom, cursorTo);
    } else if (task) {
      const markerFrom = line.from + task[1].length;
      const markerTo = line.from + task[0].length;
      const activeTaskMarker = cursorTo >= markerFrom && cursorFrom <= markerTo;
      if (activeTaskMarker) {
        ranges.push(markerRange(markerFrom, markerTo, true));
      } else {
        ranges.push({
          from: markerFrom,
          to: markerTo,
          replace: true,
          widget: new TaskCheckboxWidget(task[3].toLowerCase() === "x", markerFrom, markerTo),
        });
      }
      if (task[3].toLowerCase() === "x") {
        ranges.push({ from: markerTo, to: line.to, className: "cm-md-task-complete" });
      }
      addInlineDecorations(ranges, text, line.from, task[0].length, cursorFrom, cursorTo);
    } else if (unordered) {
      if (activeLine) {
        ranges.push(markerRange(line.from + unordered[1].length, line.from + unordered[0].length, true));
      } else {
        ranges.push({
          from: line.from + unordered[1].length,
          to: line.from + unordered[0].length,
          replace: true,
          widget: new ListMarkerWidget("bullet"),
        });
      }
      addInlineDecorations(ranges, text, line.from, unordered[0].length, cursorFrom, cursorTo);
    } else if (ordered) {
      if (activeLine) {
        ranges.push(markerRange(line.from + ordered[1].length, line.from + ordered[0].length, true));
      } else {
        ranges.push({
          from: line.from + ordered[1].length,
          to: line.from + ordered[0].length,
          replace: true,
          widget: new ListMarkerWidget("ordered", ordered[2]),
        });
      }
      addInlineDecorations(ranges, text, line.from, ordered[0].length, cursorFrom, cursorTo);
    } else {
      addInlineDecorations(ranges, text, line.from, 0, cursorFrom, cursorTo);
    }
  }

  const decorations: CodeMirrorRange<Decoration>[] = [];
  for (const range of ranges) {
    if (range.point && range.widget) {
      decorations.push(
        Decoration.widget({ widget: range.widget, block: range.block, side: range.side })
          .range(range.from),
      );
    } else if (range.line && range.className) {
      decorations.push(Decoration.line({ class: range.className }).range(range.from));
    } else if (range.from < range.to) {
      decorations.push(
        (range.replace
          ? Decoration.replace({ widget: range.widget, block: range.block })
          : Decoration.mark({ class: range.className }))
          .range(range.from, range.to),
      );
    }
  }
  return Decoration.set(decorations, true);
}

const markdownWysiwygDecorationField = StateField.define<DecorationSet>({
  create: buildMarkdownDecorations,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildMarkdownDecorations(transaction.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function markdownWysiwygDecorations(): Extension {
  return markdownWysiwygDecorationField;
}

function CitationMenu({
  state,
  onSelect,
  onHover,
  onClose,
}: {
  state: CitationMenuState;
  onSelect: (option: CitationOption) => void;
  onHover: (index: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        onHover(Math.min(state.activeIndex + 1, state.options.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        onHover(Math.max(state.activeIndex - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const option = state.options[state.activeIndex];
        if (option) onSelect(option);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, onHover, onSelect, state]);

  if (state.options.length === 0) return null;

  return (
    <div
      className="cm-md-citation-menu"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {state.options.map((option, index) => (
        <button
          key={option.key}
          type="button"
          className={`cm-md-citation-menu-item${index === state.activeIndex ? " is-active" : ""}`}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(option)}
        >
          <span className="cm-md-citation-menu-label">{option.label}</span>
          <span className="cm-md-citation-menu-key">@{option.key}</span>
          <span className="cm-md-citation-menu-meta">{option.meta}</span>
        </button>
      ))}
    </div>
  );
}

export function MarkdownWysiwygEditor({ onSave, onSnapshot, onPreviewTrigger, externalContent }: MarkdownWysiwygEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const onSnapshotRef = useRef(onSnapshot);
  const onPreviewRef = useRef(onPreviewTrigger);
  const pathRef = useRef<string | null>(null);
  const setLastEditTime = useEditorStore((s) => s.setLastEditTime);
  const editorFontSize = useEditorStore((s) => s.editorFontSize);
  const editorWidth = useEditorStore((s) => s.editorWidth);
  const editorMdFont = useEditorStore((s) => s.editorMdFont);
  const appTheme = useEditorStore((s) => s.theme);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const [editorFile, setEditorFile] = useState<{ path: string; content: string } | null>(() => {
    const tab = useEditorStore.getState().activeTab();
    return tab && isMarkdownPath(tab.path) ? { path: tab.path, content: tab.content } : null;
  });
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; filter: string } | null>(null);
  const slashStartRef = useRef<number | null>(null);
  const [citationMenu, setCitationMenu] = useState<CitationMenuState | null>(null);

  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => { onPreviewRef.current = onPreviewTrigger; }, [onPreviewTrigger]);

  useEffect(() => {
    const tab = useEditorStore.getState().activeTab();
    setEditorFile(tab && isMarkdownPath(tab.path) ? { path: tab.path, content: tab.content } : null);
    pathRef.current = tab?.path ?? null;
    setSlashMenu(null);
    slashStartRef.current = null;
    setCitationMenu(null);
    useEditorStore.getState().setSelectedText(null);
  }, [activeTabPath]);

  const handleChange = useCallback((view: EditorView) => {
    const path = pathRef.current;
    if (!path) return;

    const value = view.state.doc.toString();
    updateTabContent(path, value);
    setLastEditTime(Date.now());

    if (previewUpdateTimer.current) clearTimeout(previewUpdateTimer.current);
    previewUpdateTimer.current = setTimeout(() => {
      onPreviewRef.current?.(path, value);
    }, previewUpdateDebounceMs);

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      onSaveRef.current?.(path, value, false);
    }, 1500);
  }, [setLastEditTime, updateTabContent]);

  const updateCitationMenu = useCallback((view: EditorView) => {
    const selection = view.state.selection.main;
    if (!selection.empty) {
      setCitationMenu(null);
      return;
    }

    const cursor = selection.head;
    const line = view.state.doc.lineAt(cursor);
    const before = view.state.sliceDoc(Math.max(line.from, cursor - 96), cursor);
    const match = before.match(/\[@([\w.:/-]*)$/);
    if (!match) {
      setCitationMenu(null);
      return;
    }

    const options = citationOptions(match[1], useEditorStore.getState().references);
    if (options.length === 0) {
      setCitationMenu(null);
      return;
    }

    const coords = view.coordsAtPos(cursor);
    if (!coords) return;

    setCitationMenu((prev) => ({
      x: coords.left,
      y: coords.bottom + 6,
      from: cursor - match[0].length,
      to: cursor,
      options,
      activeIndex: Math.min(prev?.activeIndex ?? 0, options.length - 1),
    }));
  }, []);

  const centerCursorIfNeeded = useCallback((view: EditorView) => {
    if (!useEditorStore.getState().typewriterMode) return;
    const cursor = view.state.selection.main.head;
    requestAnimationFrame(() => {
      const coords = view.coordsAtPos(cursor);
      if (!coords) return;
      const scroller = view.scrollDOM;
      const scrollerRect = scroller.getBoundingClientRect();
      const targetTop = scroller.scrollTop + (coords.top - scrollerRect.top) - scrollerRect.height / 2;
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
  }, []);

  const insertImageMarkdown = useCallback((view: EditorView, srcs: string[], at?: number) => {
    if (srcs.length === 0) return;
    const selection = view.state.selection.main;
    const insertAt = at ?? selection.from;
    const snippets = srcs.map((src) => `![${src.split("/").pop() ?? "image"}](${src})`).join("\n");
    view.dispatch({
      changes: { from: insertAt, to: at === undefined ? selection.to : insertAt, insert: snippets },
      selection: EditorSelection.cursor(insertAt + snippets.length),
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  const extensions = useMemo<Extension[]>(() => [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    bracketMatching(),
    markdown(),
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.meta, color: "#404740" },
      { tag: tags.heading, fontWeight: "bold" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.strong, fontWeight: "bold" },
      { tag: tags.strikethrough, textDecoration: "line-through" },
      { tag: tags.keyword, color: "#708" },
      { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: "#219" },
      { tag: [tags.literal, tags.inserted], color: "#164" },
      { tag: [tags.string, tags.deleted], color: "#a11" },
      { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: "#e40" },
      { tag: tags.definition(tags.variableName), color: "#00f" },
      { tag: tags.local(tags.variableName), color: "#30a" },
      { tag: [tags.typeName, tags.namespace], color: "#085" },
      { tag: tags.className, color: "#167" },
      { tag: [tags.special(tags.variableName), tags.macroName], color: "#256" },
      { tag: tags.definition(tags.propertyName), color: "#00c" },
      { tag: tags.comment, color: "#940" },
      { tag: tags.invalid, color: "#f00" },
    ])),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    tableSourceEditRangeField,
    markdownWysiwygDecorations(),
    EditorView.lineWrapping,
    keymap.of([
      {
        key: "Mod-s",
        run(view) {
          const path = pathRef.current;
          if (!path) return false;
          const value = view.state.doc.toString();
          onSaveRef.current?.(path, value, true);
          onSnapshotRef.current?.(path);
          return true;
        },
      },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handleChange(update.view);

      if (update.selectionSet || update.docChanged) {
        const selection = update.state.selection.main;
        if (selection.empty) {
          useEditorStore.getState().setSelectedText(null);
        } else {
          useEditorStore.getState().setSelectedText(update.state.sliceDoc(selection.from, selection.to) || null);
        }

        const anchor = slashStartRef.current;
        if (anchor !== null) {
          const cursor = selection.head;
          const filter = update.state.sliceDoc(anchor + 1, cursor);
          if (cursor <= anchor || /\s/.test(filter)) {
            setSlashMenu(null);
            slashStartRef.current = null;
          } else {
            setSlashMenu((prev) => (prev ? { ...prev, filter } : null));
          }
        }

        updateCitationMenu(update.view);
        centerCursorIfNeeded(update.view);
      }
    }),
    EditorView.domEventHandlers({
      click(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const link = linkAtPosition(view, pos);
        if (!link) return false;
        event.preventDefault();
        view.dispatch({ selection: EditorSelection.range(link.from, link.to) });
        openUrl(link.href).catch((err: unknown) => console.error("open link failed", err));
        return true;
      },
      dragover(event) {
        if (event.dataTransfer?.types.includes("Files") || getActiveDragSource()) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      drop(event, view) {
        const workspacePath = useEditorStore.getState().workspacePath;
        if (!workspacePath) return false;

        const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
        const files = Array.from(event.dataTransfer?.files ?? []);
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          copyImageFilesToAssets(imageFiles, workspacePath)
            .then((names) => insertImageMarkdown(view, names.map((name) => `assets/${name}`), dropPos))
            .catch((err: unknown) => console.error("image drop error", err));
          return true;
        }

        const dragPath = getActiveDragSource();
        if (dragPath && /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(dragPath)) {
          event.preventDefault();
          event.stopPropagation();
          const relativePath = dragPath.startsWith(workspacePath)
            ? dragPath.slice(workspacePath.length + 1)
            : dragPath;
          insertImageMarkdown(view, [relativePath], dropPos);
          return true;
        }

        return false;
      },
      keyup(event, view) {
        if (event.key !== "/") return false;
        const cursor = view.state.selection.main.head;
        const line = view.state.doc.lineAt(cursor);
        const beforeSlash = view.state.sliceDoc(line.from, cursor - 1);
        if (beforeSlash.trim() !== "") return false;

        slashStartRef.current = cursor - 1;
        const coords = view.coordsAtPos(cursor);
        if (coords) {
          setSlashMenu({ x: coords.left, y: coords.bottom + 4, filter: "" });
        }
        return false;
      },
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        fontSize: `${editorFontSize}px`,
        fontFamily: editorMdFont,
      },
    }),
  ], [centerCursorIfNeeded, editorFontSize, editorMdFont, handleChange, insertImageMarkdown, updateCitationMenu]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editorFile) return;

    const state = EditorState.create({
      doc: editorFile.content,
      extensions,
    });
    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    pathRef.current = editorFile.path;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editorFile?.path, extensions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!externalContent || !viewRef.current) return;
    const view = viewRef.current;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: externalContent.content },
      selection: EditorSelection.cursor(0),
    });
    const path = pathRef.current;
    if (path) updateTabContent(path, externalContent.content);
  }, [externalContent?.seq, updateTabContent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (event: Event) => {
      const view = viewRef.current;
      if (!view) return;
      const text = (event as CustomEvent<string>).detail;
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: EditorSelection.cursor(selection.from + text.length),
        scrollIntoView: true,
      });
      view.focus();
    };
    window.addEventListener("editor:insert", handler);
    return () => window.removeEventListener("editor:insert", handler);
  }, []);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (previewUpdateTimer.current) clearTimeout(previewUpdateTimer.current);
    };
  }, []);

  const handleSlashSelect = useCallback((command: SlashCommand) => {
    const view = viewRef.current;
    const slashStart = slashStartRef.current;
    if (!view || slashStart === null) return;

    const cursor = view.state.selection.main.head;

    if (command.id === "ai-chat") {
      view.dispatch({
        changes: { from: slashStart, to: cursor, insert: "" },
        selection: EditorSelection.cursor(slashStart),
      });
      const store = useEditorStore.getState();
      const panels = store.activePanels.filter((panel) => panel !== "ai" && panel !== "editor");
      store.setActivePanels(["ai", "editor", ...panels].slice(0, 5));
      window.dispatchEvent(new CustomEvent("ai:focus-input"));
      setSlashMenu(null);
      slashStartRef.current = null;
      return;
    }

    const snippet = command.id === "table" ? tableSnippet(command.snippet) : command.snippet;
    const offset = snippetOffset(snippet, command.cursorOffset ?? snippet.length);
    const selectLength = command.selectLength ?? 0;
    const anchor = slashStart + offset;
    const head = anchor + selectLength;

    view.dispatch({
      changes: { from: slashStart, to: cursor, insert: snippet },
      selection: selectLength > 0
        ? EditorSelection.range(anchor, head)
        : EditorSelection.cursor(anchor),
      scrollIntoView: true,
    });
    setSlashMenu(null);
    slashStartRef.current = null;
    view.focus();
  }, []);

  const handleCitationSelect = useCallback((option: CitationOption) => {
    const view = viewRef.current;
    const menu = citationMenu;
    if (!view || !menu) return;

    const text = `[@${option.key}]`;
    view.dispatch({
      changes: { from: menu.from, to: menu.to, insert: text },
      selection: EditorSelection.cursor(menu.from + text.length),
      scrollIntoView: true,
    });
    setCitationMenu(null);
    view.focus();
  }, [citationMenu]);

  const handleCitationHover = useCallback((index: number) => {
    setCitationMenu((prev) => prev ? {
      ...prev,
      activeIndex: Math.max(0, Math.min(index, prev.options.length - 1)),
    } : prev);
  }, []);

  if (!editorFile) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-message">
          <div className="editor-empty-icon">+</div>
          <p>Open a Markdown file to start writing</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`markdown-wysiwyg markdown-wysiwyg--${appTheme}`}
      style={{
        "--markdown-wysiwyg-width": `${editorWidth}px`,
      } as React.CSSProperties}
    >
      <div className="markdown-wysiwyg-editor" ref={containerRef} />
      {slashMenu && (
        <SlashMenu
          x={slashMenu.x}
          y={slashMenu.y}
          filter={slashMenu.filter}
          onSelect={handleSlashSelect}
          onClose={() => {
            setSlashMenu(null);
            slashStartRef.current = null;
            viewRef.current?.focus();
          }}
        />
      )}
      {citationMenu && (
        <CitationMenu
          state={citationMenu}
          onSelect={handleCitationSelect}
          onHover={handleCitationHover}
          onClose={() => {
            setCitationMenu(null);
            viewRef.current?.focus();
          }}
        />
      )}
      <WidthHandle />
    </div>
  );
}
