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
  { id: "h1",       label: "Heading 1",      description: "Top-level heading",      category: "Structure", icon: "H1",  snippet: "= " },
  { id: "h2",       label: "Heading 2",      description: "Second-level heading",   category: "Structure", icon: "H2",  snippet: "== " },
  { id: "h3",       label: "Heading 3",      description: "Third-level heading",    category: "Structure", icon: "H3",  snippet: "=== " },
  { id: "bullet",   label: "Bullet List",    description: "Unordered list item",    category: "Structure", icon: "•",   snippet: "- " },
  { id: "numbered", label: "Numbered List",  description: "Ordered list item",      category: "Structure", icon: "1.",  snippet: "+ " },
  { id: "hr",       label: "Divider",        description: "Horizontal rule",        category: "Structure", icon: "—",   snippet: "#line(length: 100%)\n" },
  // Text — select the placeholder word so user can type over it immediately
  { id: "bold",      label: "Bold",          description: "Bold text",              category: "Text", icon: "B",   snippet: "*bold*",          cursorOffset: 1, selectLength: 4 },
  { id: "italic",    label: "Italic",        description: "Italic text",            category: "Text", icon: "I",   snippet: "_italic_",        cursorOffset: 1, selectLength: 6 },
  { id: "underline", label: "Underline",     description: "Underlined text",        category: "Text", icon: "U",   snippet: "#underline[text]", cursorOffset: 11, selectLength: 4 },
  { id: "strike",    label: "Strikethrough", description: "Strikethrough text",     category: "Text", icon: "S̶",  snippet: "#strike[text]",   cursorOffset: 8, selectLength: 4 },
  // Code — select the placeholder
  { id: "code-inline", label: "Inline Code", description: "Inline code snippet",   category: "Code", icon: "<>",  snippet: "`code`",          cursorOffset: 1, selectLength: 4 },
  { id: "code-block",  label: "Code Block",  description: "Multi-line code block", category: "Code", icon: "{}",  snippet: "```\ncode\n```",   cursorOffset: 4, selectLength: 4 },
  // Math — select the placeholder expression
  { id: "math-inline", label: "Inline Math",   description: "Inline math expression", category: "Math", icon: "∑", snippet: "$x$",   cursorOffset: 1, selectLength: 1 },
  { id: "math-block",  label: "Display Math",  description: "Block math expression",  category: "Math", icon: "∫", snippet: "$ x $", cursorOffset: 2, selectLength: 1 },
  // Advanced — land on the most likely thing to fill in first
  // #figure(\n  image(""),\n  caption: []\n)  → cursor between the image path quotes (offset 18)
  { id: "figure",    label: "Figure",      description: "Image with caption", category: "Advanced", icon: "⊞", snippet: '#figure(\n  image(""),\n  caption: []\n)', cursorOffset: 18 },
  // #table(\n  columns: 3,\n  [], [], [],\n)  → select "3" so user can set column count (offset 19)
  { id: "table",     label: "Table",       description: "Table layout",       category: "Advanced", icon: "▦", snippet: "#table(\n  columns: 3,\n  [], [], [],\n)", cursorOffset: 19, selectLength: 1 },
  { id: "quote",     label: "Quote",       description: "Block quote",        category: "Advanced", icon: "❝", snippet: "#quote[text]",  cursorOffset: 7, selectLength: 4 },
  { id: "pagebreak", label: "Page Break",  description: "Force a new page",   category: "Advanced", icon: "⊡", snippet: "#pagebreak()" },
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
