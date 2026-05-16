import { useState, useEffect, useRef } from "react";
import "./SlashMenu.css";

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  snippet: string;
  // Char offset from snippet start where cursor lands; defaults to snippet.length (end).
  cursorOffset?: number;
  // If > 0, selects this many chars starting at cursorOffset (e.g. to replace a placeholder).
  selectLength?: number;
}

const COMMANDS: SlashCommand[] = [
  // Structure — cursor lands at end (default)
  { id: "h1",       label: "Heading 1",      description: "Top-level heading",      category: "Structure", icon: "H1",  snippet: "# " },
  { id: "h2",       label: "Heading 2",      description: "Second-level heading",   category: "Structure", icon: "H2",  snippet: "## " },
  { id: "h3",       label: "Heading 3",      description: "Third-level heading",    category: "Structure", icon: "H3",  snippet: "### " },
  { id: "h4",       label: "Heading 4",      description: "Fourth-level heading",   category: "Structure", icon: "H4",  snippet: "#### " },
  { id: "h5",       label: "Heading 5",      description: "Fifth-level heading",    category: "Structure", icon: "H5",  snippet: "##### " },
  { id: "h6",       label: "Heading 6",      description: "Sixth-level heading",    category: "Structure", icon: "H6",  snippet: "###### " },
  { id: "bullet",   label: "Bullet List",    description: "Unordered list item",    category: "Structure", icon: "•",   snippet: "- " },
  { id: "numbered", label: "Numbered List",  description: "Ordered list item",      category: "Structure", icon: "1.",  snippet: "1. " },
  { id: "hr",       label: "Divider",        description: "Horizontal rule",        category: "Structure", icon: "—",   snippet: "---\n" },
  // Text — select the placeholder word so user can type over it immediately
  { id: "bold",      label: "Bold",          description: "Bold text",              category: "Text", icon: "B",   snippet: "**bold**",       cursorOffset: 2, selectLength: 4 },
  { id: "italic",    label: "Italic",        description: "Italic text",            category: "Text", icon: "I",   snippet: "*italic*",        cursorOffset: 1, selectLength: 6 },
  { id: "strike",    label: "Strikethrough", description: "Strikethrough text",     category: "Text", icon: "S̶",  snippet: "~~text~~",       cursorOffset: 2, selectLength: 4 },
  // Code — select the placeholder
  { id: "code-inline", label: "Inline Code", description: "Inline code snippet",   category: "Code", icon: "<>",  snippet: "`code`",          cursorOffset: 1, selectLength: 4 },
  { id: "code-block",  label: "Code Block",  description: "Multi-line code block", category: "Code", icon: "{}",  snippet: "```\ncode\n```",   cursorOffset: 4, selectLength: 4 },
  // Math — select the placeholder expression
  { id: "math-inline", label: "Inline Math",   description: "Inline math expression", category: "Math", icon: "∑", snippet: "$x$",   cursorOffset: 1, selectLength: 1 },
  { id: "math-block",  label: "Display Math",  description: "Block math expression",  category: "Math", icon: "∫", snippet: "$$\nx\n$$", cursorOffset: 3, selectLength: 1 },
  // Advanced — Markdown-compatible
  { id: "image",    label: "Image",       description: "Image with alt text",       category: "Advanced", icon: "🖼", snippet: "![alt](url)",    cursorOffset: 7, selectLength: 3 },
  { id: "table",    label: "Table",       description: "Markdown table",            category: "Advanced", icon: "▦", snippet: "| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |", cursorOffset: 2, selectLength: 8 },
  { id: "quote",    label: "Quote",       description: "Block quote",               category: "Advanced", icon: "❝", snippet: "> " },
  { id: "link",     label: "Link",        description: "Hyperlink",                 category: "Advanced", icon: "🔗", snippet: "[text](url)", cursorOffset: 1, selectLength: 4 },
  { id: "ai-chat",  label: "AI Assistant", description: "Open AI assistant chat",    category: "Advanced", icon: "✨", snippet: "" },
];

interface SlashMenuProps {
  x: number;
  y: number;
  filter: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export function SlashMenu({ x, y, filter, onSelect, onClose }: SlashMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = COMMANDS.filter(
    (cmd) =>
      filter === "" ||
      cmd.label.toLowerCase().includes(filter.toLowerCase()) ||
      cmd.category.toLowerCase().includes(filter.toLowerCase())
  );

  // Group by category, preserving declaration order
  const grouped: Record<string, SlashCommand[]> = {};
  for (const cmd of filtered) {
    (grouped[cmd.category] ??= []).push(cmd);
  }

  // Flat ordered list for keyboard navigation
  const flat = Object.values(grouped).flat();

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (flat[selectedIndex]) onSelect(flat[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [flat, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    if (!menuRef.current) return;
    const item = menuRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (flat.length === 0) return null;

  let flatIdx = 0;
  return (
    <div className="slash-menu" ref={menuRef} style={{ left: x, top: y }} onMouseDown={(e) => e.preventDefault()}>
      {Object.entries(grouped).map(([category, cmds]) => (
        <div key={category} className="slash-menu-group">
          <div className="slash-menu-category">{category}</div>
          {cmds.map((cmd) => {
            const idx = flatIdx++;
            return (
              <div
                key={cmd.id}
                data-index={idx}
                className={`slash-menu-item${idx === selectedIndex ? " selected" : ""}`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => onSelect(cmd)}
              >
                <span className="slash-menu-icon">{cmd.icon}</span>
                <div className="slash-menu-text">
                  <span className="slash-menu-label">{cmd.label}</span>
                  <span className="slash-menu-desc">{cmd.description}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
