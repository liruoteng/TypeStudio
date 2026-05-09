import { useRef, useEffect, useState, useCallback } from "react";
import { Editor, rootCtx, defaultValueCtx, remarkPluginsCtx } from "@milkdown/core";
import type { Plugin } from "unified";
import type { Root } from "@milkdown/transformer";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import {
  remarkMathPlugin,
  katexOptionsCtx,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineInputRule,
  mathBlockInputRule,
} from "@milkdown/plugin-math";
import { useEditor, Milkdown, MilkdownProvider } from "@milkdown/react";
import { mathBlockViewPlugin } from "./mathBlockView";
import { mathInlineViewPlugin } from "./mathInlineView";
import { mathAutoSelectPlugin } from "./mathAutoSelect";
import { editorViewCtx } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import { useEditorStore } from "../../stores/editorStore";
import type { Reference } from "../../stores/editorStore";
import { slashMenuPlugin } from "./slashMenuPlugin";
import type { SlashState } from "./slashMenuPlugin";
import { SlashMenu } from "./SlashMenu";
import type { SlashCommand } from "./SlashMenu";
import { SelectionToolbar } from "./SelectionToolbar";
import { copyImageFilesToAssets } from "../../lib/utils";
import { getActiveDragSource } from "../FileExplorer/FileTree";
import { linkClickPlugin } from "./linkClickPlugin";
import { imageViewPlugin } from "./imageView";
import { typewriterPlugin } from "./typewriterPlugin";
import { codeBlockViewPlugin } from "./codeBlockView";
import { taskItemPlugin } from "./taskItemPlugin";
import { historyPlugin } from "./historyPlugin";
import { prism, prismConfig } from "@milkdown/plugin-prism";
import { refractor } from "refractor";
import { FrontmatterPanel } from "./FrontmatterPanel";
import { extractFrontmatter, restoreFrontmatter } from "./frontmatterUtil";
import { remarkCitationPlugin, citationSchema, citationViewPlugin } from "./citationView";
import "katex/dist/katex.min.css";
import "prismjs/themes/prism-tomorrow.css";
import "./WritingModeEditor.css";

export interface WritingModeEditorProps {
    onSave?: (path: string, content: string, isExplicit?: boolean) => void;
    onSnapshot?: (path: string) => void;
    onPreviewTrigger?: (path: string, content: string) => void;
    externalContent?: { content: string; seq: number };
}

interface InnerProps {
    path: string;
    initialContent: string;
    externalContent?: { content: string; seq: number };
    onSave?: WritingModeEditorProps["onSave"];
    onSnapshot?: WritingModeEditorProps["onSnapshot"];
    onPreviewTrigger?: WritingModeEditorProps["onPreviewTrigger"];
}

// ── Citation autocomplete ────────────────────────────────────────────────────

interface CiteDropdownProps {
    query: string;
    refs: Reference[];
    anchorRect: DOMRect;
    onSelect: (ref: Reference) => void;
    onClose: () => void;
}

function CiteDropdown({ query, refs, anchorRect, onSelect, onClose }: CiteDropdownProps) {
    const [activeIndex, setActiveIndex] = useState(0);

    const matches = refs.filter((r) => {
        if (!r.bibKey) return false;
        const q = query.toLowerCase();
        return (
            r.bibKey.toLowerCase().includes(q) ||
            (r.title?.toLowerCase().includes(q) ?? false) ||
            (r.authors?.some((a) => a.toLowerCase().includes(q)) ?? false)
        );
    }).slice(0, 8);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                (e as KeyboardEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
                setActiveIndex((prev) => Math.min(prev + 1, matches.length - 1));
                return;
            }

            if (e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                (e as KeyboardEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
                setActiveIndex((prev) => Math.max(prev - 1, 0));
                return;
            }

            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                (e as KeyboardEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
                if (matches[activeIndex]) {
                    onSelect(matches[activeIndex]);
                    onClose();
                }
                return;
            }

            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                (e as KeyboardEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
                onClose();
                return;
            }
        };

        window.addEventListener("keydown", handleKey, true);
        return () => window.removeEventListener("keydown", handleKey, true);
    }, [query, matches, activeIndex, onSelect, onClose]);

    if (matches.length === 0) return null;

    const top = anchorRect.bottom + window.scrollY + 4;
    const left = Math.min(anchorRect.left + window.scrollX, window.innerWidth - 320);

    return (
        <div
            className="cite-dropdown"
            style={{ top, left }}
            onMouseDown={(e) => e.preventDefault()}
        >
            {matches.map((ref, idx) => (
                <button
                    key={ref.id}
                    className={`cite-dropdown-item${idx === activeIndex ? " cite-dropdown-item--active" : ""}`}
                    onClick={() => onSelect(ref)}
                    onMouseEnter={() => setActiveIndex(idx)}
                >
                    <span className="cite-dropdown-key">@{ref.bibKey}</span>
                    <span className="cite-dropdown-meta">
                        {ref.title ? ref.title.slice(0, 50) : ref.name}
                        {ref.year ? ` · ${ref.year}` : ""}
                    </span>
                </button>
            ))}
        </div>
    );
}

// ── Inner editor component ────────────────────────────────────────────────────

function WritingModeEditorInner({ path, initialContent, externalContent, onSave, onSnapshot, onPreviewTrigger }: InnerProps) {
    const updateTabContent = useEditorStore((s) => s.updateTabContent);
    const fontSize = useEditorStore((s) => s.editorFontSize);
    const typewriterMode = useEditorStore((s) => s.typewriterMode);
    const references = useEditorStore((s) => s.references);

    // Split frontmatter from body so Milkdown never sees the YAML block
    const { frontmatter, body } = extractFrontmatter(initialContent);
    const frontmatterRef = useRef(frontmatter);
    const bodyRef = useRef(body);
    const contentRef = useRef(initialContent);
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const onSaveRef = useRef(onSave);
    const onPreviewRef = useRef(onPreviewTrigger);
    const pathRef = useRef(path);
    useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
    useEffect(() => { onPreviewRef.current = onPreviewTrigger; }, [onPreviewTrigger]);
    useEffect(() => { pathRef.current = path; }, [path]);

    // ── Cite autocomplete state ──────────────────────────────────────────────
    const [citeQuery, setCiteQuery] = useState<string | null>(null);
    const [citeAnchor, setCiteAnchor] = useState<DOMRect | null>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const typewriterOptionsRef = useRef({ enabled: typewriterMode, containerRef: editorContainerRef });
    useEffect(() => { typewriterOptionsRef.current.enabled = typewriterMode; }, [typewriterMode]);

    // ── Slash menu state ─────────────────────────────────────────────────────
    const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; filter: string } | null>(null);
    const slashAnchorRef = useRef<number | null>(null);

    const checkCiteTrigger = useCallback(() => {
        const editor = getEditor();
        if (!editor) return;

        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const { selection } = state;
            const { $from } = selection;

            const textBefore = state.doc.textBetween(
                Math.max(0, $from.pos - 100),
                $from.pos
            );

            const match = textBefore.match(/\[@([\w-]*)$/);
            if (match) {
                const coords = view.coordsAtPos($from.pos);
                setCiteQuery(match[1]);
                setCiteAnchor(new DOMRect(
                    coords.left,
                    coords.top,
                    0,
                    coords.bottom - coords.top
                ));
            } else {
                setCiteQuery(null);
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { get: getEditor } = useEditor((root) => {
        return Editor.make()
            .config((ctx) => {
                ctx.set(rootCtx, root);
                ctx.set(defaultValueCtx, body);
                ctx.update(remarkPluginsCtx, (prev) => [
                    ...prev,
                    { plugin: remarkCitationPlugin as unknown as Plugin<[Record<string, unknown>], Root>, options: {} },
                ]);
                ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                    bodyRef.current = markdown;
                    const full = restoreFrontmatter(frontmatterRef.current, markdown);
                    contentRef.current = full;
                    updateTabContent(pathRef.current, full);

                    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
                    autoSaveTimer.current = setTimeout(() => {
                        onSaveRef.current?.(pathRef.current, full, false);
                    }, 1500);

                    if (previewTimer.current) clearTimeout(previewTimer.current);
                    previewTimer.current = setTimeout(() => {
                        onPreviewRef.current?.(pathRef.current, full);
                    }, 800);

                    checkCiteTrigger();
                });
            })
            .use(commonmark)
            .use(gfm)
            .use(listener)
            .use(remarkMathPlugin)
            .use(katexOptionsCtx)
            .config((ctx) => {
                ctx.set(katexOptionsCtx.key, { throwOnError: false });
            })
            .use(mathInlineSchema)
            .use(mathBlockSchema)
            .use(mathInlineInputRule)
            .use(mathBlockInputRule)
            .use(mathBlockViewPlugin)
            .use(mathInlineViewPlugin)
            .use(mathAutoSelectPlugin)
            .use(linkClickPlugin)
            .use(imageViewPlugin)
            .use(typewriterPlugin(typewriterOptionsRef.current))
            .use(codeBlockViewPlugin)
            .use(taskItemPlugin)
            .use(prism)
            .config((ctx) => {
                ctx.set(prismConfig.key, { configureRefractor: () => refractor });
            })
            .use(historyPlugin)
            .use(citationSchema)
            .use(citationViewPlugin)
            .use(slashMenuPlugin((state: SlashState | null) => {
                if (state) {
                    slashAnchorRef.current = state.anchorPos;
                    setSlashMenu({ x: state.x, y: state.y, filter: state.filter });
                } else {
                    slashAnchorRef.current = null;
                    setSlashMenu(null);
                }
            }));
    });

    // ── Insert text at cursor (for editor:insert and citation selection) ─────
    const insertAtCursor = useCallback((text: string) => {
        const editor = getEditor();
        if (!editor) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.action((ctx: any) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            dispatch(state.tr.insertText(text));
        });
    }, [getEditor]);

    const getEditorRef = useRef(getEditor);
    useEffect(() => { getEditorRef.current = getEditor; }, [getEditor]);

    // ── Sync external content (e.g. snapshot restore) in-place ─────────────
    const externalSeqRef = useRef(externalContent?.seq);
    useEffect(() => {
        if (!externalContent || externalContent.seq === externalSeqRef.current) return;
        externalSeqRef.current = externalContent.seq;

        const editor = getEditorRef.current();
        if (!editor) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.action((ctx: any) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const { frontmatter: fm, body } = extractFrontmatter(externalContent.content);
            frontmatterRef.current = fm;
            const doc = state.schema.text(body);
            dispatch(state.tr.replaceWith(0, state.doc.content.size, doc));
        });
    }, [externalContent]);

    // ── Slash command selection ──────────────────────────────────────────────
    // Build content as ProseMirror nodes/marks so formatting renders immediately
    const handleSlashSelect = useCallback((command: SlashCommand) => {
        const editor = getEditor();
        if (!editor) return;
        const anchorPos = slashAnchorRef.current;
        if (anchorPos === null) return;

        // AI chat command — open AI panel instead of inserting text
        if (command.id === "ai-chat") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            editor.action((ctx: any) => {
                const view = ctx.get(editorViewCtx);
                const { state, dispatch } = view;
                const { from } = state.selection;
                const deleteFrom = Math.min(anchorPos, from);
                dispatch(state.tr.delete(deleteFrom, from));
            });
            useEditorStore.getState().setActivePanels(["ai", "editor"]);
            window.dispatchEvent(new CustomEvent("ai:focus-input"));
            setSlashMenu(null);
            slashAnchorRef.current = null;
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.action((ctx: any) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const { from } = state.selection;
            const deleteFrom = Math.min(anchorPos, from);
            const deleteTo = from;
            let tr = state.tr.delete(deleteFrom, deleteTo);

            const s = state.schema;
            let content;
            let cursorPos: number | undefined;
            let selectLen: number | undefined;

            try {
                switch (command.id) {
                    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
                        const level = parseInt(command.id[1]);
                        content = s.nodes.heading.create({ level }, s.text(""));
                        cursorPos = deleteFrom + 1;
                        break;
                    }
                    case "bullet": {
                        const item = s.nodes.list_item.create(null, s.nodes.paragraph.create(null, s.text("")));
                        content = s.nodes.bullet_list.create(null, item);
                        cursorPos = deleteFrom + 3;
                        break;
                    }
                    case "numbered": {
                        const item = s.nodes.list_item.create(null, s.nodes.paragraph.create(null, s.text("")));
                        content = s.nodes.ordered_list.create({ order: 1 }, item);
                        cursorPos = deleteFrom + 3;
                        break;
                    }
                    case "hr": {
                        content = s.nodes.hr.create();
                        cursorPos = deleteFrom + 1;
                        break;
                    }
                    case "bold": {
                        content = s.text("bold", [s.marks.strong.create()]);
                        cursorPos = deleteFrom;
                        selectLen = 4;
                        break;
                    }
                    case "italic": {
                        content = s.text("italic", [s.marks.emphasis.create()]);
                        cursorPos = deleteFrom;
                        selectLen = 6;
                        break;
                    }
                    case "strike": {
                        content = s.text("text", [s.marks.strike_through.create()]);
                        cursorPos = deleteFrom;
                        selectLen = 4;
                        break;
                    }
                    case "code-inline": {
                        content = s.text("code", [s.marks.inlineCode.create()]);
                        cursorPos = deleteFrom;
                        selectLen = 4;
                        break;
                    }
                    case "code-block": {
                        content = s.nodes.code_block.create({ language: "" });
                        cursorPos = deleteFrom + 1;
                        break;
                    }
                    case "math-inline": {
                        // Fall back to text snippet if schema node unavailable
                        const mathInline = s.nodes.math_inline || s.nodes.mathInline;
                        if (mathInline) {
                            content = mathInline.create({ value: "" });
                            cursorPos = deleteFrom + 1;
                        } else {
                            content = s.text("$x$");
                            cursorPos = deleteFrom + 2;
                            selectLen = 1;
                        }
                        break;
                    }
                    case "math-block": {
                        const mathBlock = s.nodes.math_block || s.nodes.mathBlock;
                        if (mathBlock) {
                            content = mathBlock.create({ value: "" });
                            cursorPos = deleteFrom + 1;
                        } else {
                            content = s.text("$$x$$");
                            cursorPos = deleteFrom + 3;
                            selectLen = 1;
                        }
                        break;
                    }
                    case "image": {
                        content = s.nodes.image.create({ src: "", alt: "image" });
                        cursorPos = deleteFrom + 1;
                        break;
                    }
                    case "table": {
                        const tbl = s.nodes.table;
                        const hdrRow = s.nodes.table_header_row;
                        const row = s.nodes.table_row;
                        const cell = s.nodes.table_cell;
                        const hdr = s.nodes.table_header;
                        const para = s.nodes.paragraph;
                        if (tbl && hdrRow && row && cell) {
                            const mkCell = (txt: string, isHdr: boolean) => {
                                const ct = isHdr && hdr ? hdr : cell;
                                const c = para ? para.create(null, s.text(txt)) : s.text(txt);
                                return ct.create(null, c);
                            };
                            content = tbl.create(null, [
                                hdrRow.create(null, [mkCell("a", true), mkCell("b", true)]),
                                row.create(null, [mkCell("", false), mkCell("", false)]),
                            ]);
                            cursorPos = deleteFrom + 1;
                        } else {
                            content = s.text(command.snippet || "");
                            cursorPos = deleteFrom + (command.cursorOffset ?? (command.snippet || "").length);
                        }
                        break;
                    }
                    case "quote": {
                        content = s.nodes.blockquote.create(null, s.nodes.paragraph.create(null, s.text("")));
                        cursorPos = deleteFrom + 2;
                        break;
                    }
                    case "link": {
                        content = s.text("url", [s.marks.link.create({ href: "" })]);
                        cursorPos = deleteFrom;
                        selectLen = 3;
                        break;
                    }
                    default: {
                        content = s.text(command.snippet || "");
                        cursorPos = deleteFrom + (command.cursorOffset ?? (command.snippet || "").length);
                        selectLen = command.selectLength;
                    }
                }

                if (content) {
                    tr = tr.replaceWith(deleteFrom, deleteFrom, content);
                    if (cursorPos !== undefined) {
                        if (selectLen && selectLen > 0) {
                            tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos, cursorPos + selectLen));
                        } else {
                            tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos));
                        }
                    }
                }
            } catch (e) {
                console.warn("slash command fallback to text", command.id, e);
                const fallback = command.snippet || "";
                tr = tr.replaceWith(deleteFrom, deleteFrom, s.text(fallback));
                const cp = deleteFrom + (command.cursorOffset ?? fallback.length);
                if (command.selectLength && command.selectLength > 0) {
                    tr = tr.setSelection(TextSelection.create(tr.doc, cp, cp + command.selectLength));
                } else {
                    tr = tr.setSelection(TextSelection.create(tr.doc, cp));
                }
            }

            dispatch(tr);
        });

        setSlashMenu(null);
        slashAnchorRef.current = null;
    }, [getEditor]);

    // ── Drag & drop images from OS file explorer / in-app file tree ─────────
    useEffect(() => {
        const container = editorContainerRef.current;
        if (!container) return;

        const insertImagesAtCursor = (srcs: string[]) => {
            const editor = getEditorRef.current();
            if (!editor) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            editor.action((ctx: any) => {
                const view = ctx.get(editorViewCtx);
                const { state, dispatch } = view;
                for (const src of srcs) {
                    const node = state.schema.nodes.image.create({
                        src,
                        alt: src.split("/").pop() ?? "image",
                    });
                    dispatch(state.tr.replaceSelectionWith(node));
                }
            });
        };

        const onDragOver = (e: DragEvent) => {
            if (e.dataTransfer?.types.includes("Files") || getActiveDragSource()) {
                e.preventDefault();
            }
        };

        const onDrop = (e: DragEvent) => {
            const workspacePath = useEditorStore.getState().workspacePath;
            if (!workspacePath) return;

            // OS-level file drops
            const files = Array.from(e.dataTransfer?.files ?? []);
            const imageFiles = files.filter((f) => f.type.startsWith("image/"));
            if (imageFiles.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                copyImageFilesToAssets(imageFiles, workspacePath)
                    .then((names) => insertImagesAtCursor(names.map((n) => `assets/${n}`)))
                    .catch((err) => console.error("image drop error", err));
                return;
            }

            // In-app file tree drag
            const dragPath = getActiveDragSource();
            if (dragPath && /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(dragPath)) {
                e.preventDefault();
                e.stopPropagation();
                const relativePath = dragPath.startsWith(workspacePath)
                    ? dragPath.slice(workspacePath.length + 1)
                    : dragPath;
                insertImagesAtCursor([relativePath]);
            }
        };

        container.addEventListener("dragover", onDragOver, { capture: true });
        container.addEventListener("drop", onDrop, { capture: true });
        return () => {
            container.removeEventListener("dragover", onDragOver, { capture: true });
            container.removeEventListener("drop", onDrop, { capture: true });
        };
    }, []);

    // ── Handle editor:insert events (from ReferencesPanel / AI panel) ────────
    useEffect(() => {
        const handler = (e: Event) => {
            insertAtCursor((e as CustomEvent<string>).detail);
        };
        window.addEventListener("editor:insert", handler);
        return () => window.removeEventListener("editor:insert", handler);
    }, [insertAtCursor]);

    // ── Cmd+S ────────────────────────────────────────────────────────────────
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                onSaveRef.current?.(pathRef.current, contentRef.current, true);
                onSnapshot?.(pathRef.current);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onSnapshot]);

    const handleCiteSelect = useCallback((ref: Reference) => {
        const editor = getEditor();
        if (!editor || !ref.bibKey) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.action((ctx: any) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const { from } = state.selection;
            let deleteFrom = from;
            const searchStart = Math.max(0, from - 100);
            for (let pos = from - 1; pos >= searchStart; pos--) {
                if (state.doc.textBetween(pos, pos + 2) === "[@") {
                    deleteFrom = pos;
                    break;
                }
            }
            const citationNode = state.schema.nodes.citation.create({ key: ref.bibKey });
            let tr;
            if (deleteFrom < from) {
                tr = state.tr.delete(deleteFrom, from);
                tr = tr.replaceWith(deleteFrom, deleteFrom, citationNode);
            } else {
                tr = state.tr.replaceWith(from, from, citationNode);
            }
            dispatch(tr);
        });
        setCiteQuery(null);
    }, [getEditor]);

    const editorWidth = useEditorStore((s) => s.editorWidth);
    const editorMdFont = useEditorStore((s) => s.editorMdFont);

    return (
        <div className="wme-scroll" ref={editorContainerRef}>
            <div className="wme-page" style={{ fontSize, maxWidth: editorWidth, fontFamily: editorMdFont }}>
                {frontmatterRef.current && (
                    <FrontmatterPanel raw={frontmatterRef.current} />
                )}
                <Milkdown />
            </div>
            {citeQuery !== null && citeAnchor && (
                <CiteDropdown
                    query={citeQuery}
                    refs={references}
                    anchorRect={citeAnchor}
                    onSelect={handleCiteSelect}
                    onClose={() => setCiteQuery(null)}
                />
            )}
            {slashMenu && (
                <SlashMenu
                    x={slashMenu.x}
                    y={slashMenu.y}
                    filter={slashMenu.filter}
                    onSelect={handleSlashSelect}
                    onClose={() => setSlashMenu(null)}
                />
            )}
            <SelectionToolbar getEditor={getEditor} />
        </div>
    );
}

export function WritingModeEditor({ onSave, onSnapshot, onPreviewTrigger, externalContent }: WritingModeEditorProps) {
    const activeTab = useEditorStore((s) => s.activeTab());

    if (!activeTab) {
        return <div className="wme-empty">No file open</div>;
    }

    const content = externalContent?.content ?? activeTab.content;

    return (
        <MilkdownProvider>
            <div className="wme-root">
                <WritingModeEditorInner
                    key={activeTab.path}
                    path={activeTab.path}
                    initialContent={content}
                    externalContent={externalContent}
                    onSave={onSave}
                    onSnapshot={onSnapshot}
                    onPreviewTrigger={onPreviewTrigger}
                />
            </div>
        </MilkdownProvider>
    );
}
