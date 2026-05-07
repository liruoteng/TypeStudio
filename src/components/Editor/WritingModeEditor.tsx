import { useRef, useEffect, useState, useCallback } from "react";
import { Editor, rootCtx, defaultValueCtx, remarkPluginsCtx } from "@milkdown/core";
import type { Plugin } from "unified";
import type { Root } from "@milkdown/transformer";
import { commonmark } from "@milkdown/preset-commonmark";
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
import { useEditorStore } from "../../stores/editorStore";
import type { Reference } from "../../stores/editorStore";
import { linkClickPlugin } from "./linkClickPlugin";
import { imageViewPlugin } from "./imageView";
import { typewriterPlugin } from "./typewriterPlugin";
import { codeBlockViewPlugin } from "./codeBlockView";
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

function WritingModeEditorInner({ path, initialContent, onSave, onSnapshot, onPreviewTrigger }: InnerProps) {
    const updateTabContent = useEditorStore((s) => s.updateTabContent);
    const fontSize = useEditorStore((s) => s.editorFontSize);
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

            const match = textBefore.match(/\[@([\w]*)$/);
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
            .use(typewriterPlugin({ enabled: false, containerRef: editorContainerRef }))
            .use(codeBlockViewPlugin)
            .use(prism)
            .config((ctx) => {
                ctx.set(prismConfig.key, { configureRefractor: () => refractor });
            })
            .use(citationSchema)
            .use(citationViewPlugin);
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
            const text = state.doc.textBetween(Math.max(0, from - 100), from);
            const matchIdx = text.lastIndexOf("[@");
            if (matchIdx >= 0) {
                const deleteFrom = from - (text.length - matchIdx);
                dispatch(
                    state.tr
                        .delete(deleteFrom, from)
                        .insertText(`[@${ref.bibKey}]`, deleteFrom)
                );
            } else {
                dispatch(state.tr.insertText(`[@${ref.bibKey}]`));
            }
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
        </div>
    );
}

export function WritingModeEditor({ onSave, onSnapshot, onPreviewTrigger, externalContent }: WritingModeEditorProps) {
    const activeTab = useEditorStore((s) => s.activeTab());

    if (!activeTab) {
        return <div className="wme-empty">No file open</div>;
    }

    const content = externalContent?.content ?? activeTab.content;
    const instanceKey = `${activeTab.path}::${externalContent?.seq ?? 0}`;

    return (
        <MilkdownProvider>
            <div className="wme-root">
                <WritingModeEditorInner
                    key={instanceKey}
                    path={activeTab.path}
                    initialContent={content}
                    onSave={onSave}
                    onSnapshot={onSnapshot}
                    onPreviewTrigger={onPreviewTrigger}
                />
            </div>
        </MilkdownProvider>
    );
}
