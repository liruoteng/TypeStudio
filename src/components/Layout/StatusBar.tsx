import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../stores/editorStore";
import "./StatusBar.css";

interface StatusBarProps {
  lspStatus?: "connecting" | "connected" | "disconnected";
  errorCount?: number;
  warningCount?: number;
  onShowHistory?: () => void;
}

function getLanguageLabel(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    typ: "Typst", js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
    ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript",
    jsx: "JavaScript", json: "JSON", jsonc: "JSON",
    html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", less: "Less",
    md: "Markdown", mdx: "Markdown", py: "Python", rs: "Rust",
    go: "Go", java: "Java", c: "C", h: "C", cpp: "C++", hpp: "C++",
    sh: "Shell", bash: "Shell", zsh: "Shell",
    yaml: "YAML", yml: "YAML", xml: "XML", sql: "SQL",
    lua: "Lua", rb: "Ruby", php: "PHP", swift: "Swift", kt: "Kotlin",
    cs: "C#", r: "R", toml: "TOML",
  };
  return map[ext] ?? "Plain Text";
}

function formatEditTime(ts: number | null): string | null {
  if (!ts) return null;
  const diff = Date.now() - ts;
  if (diff < 15_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

const FONT_SIZE_PRESETS = [8, 10, 12, 13, 14, 15, 16, 18, 20, 24];

export function StatusBar({
  lspStatus = "disconnected",
  errorCount = 0,
  warningCount = 0,
  onShowHistory,
}: StatusBarProps) {
  const activeTab    = useEditorStore((s) => s.activeTab());
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const fontSize     = useEditorStore((s) => s.editorFontSize);
  const setFontSize  = useEditorStore((s) => s.setEditorFontSize);
  const lastEditTime = useEditorStore((s) => s.lastEditTime);
  const lastCompileMs = useEditorStore((s) => s.lastCompileMs);

  const [showFontMenu, setShowFontMenu] = useState(false);
  const [, setTick] = useState(0);
  const fontBtnRef = useRef<HTMLButtonElement>(null);

  // Tick every 15s to refresh relative time display
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // Close font menu on outside click
  useEffect(() => {
    if (!showFontMenu) return;
    const handle = (e: MouseEvent) => {
      if (!fontBtnRef.current?.closest(".font-size-widget")?.contains(e.target as Node)) {
        setShowFontMenu(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showFontMenu]);

  const editTimeLabel = formatEditTime(lastEditTime);
  const language = activeTab ? getLanguageLabel(activeTab.path) : null;

  return (
    <div className="status-bar">
      <div className="status-left">
        <span
          className={`lsp-indicator lsp-${lspStatus}`}
          title={`Tinymist LSP: ${lspStatus}`}
        >
          ◉ Tinymist: {lspStatus}
        </span>
        {errorCount > 0 && (
          <span className="status-errors">✗ {errorCount}</span>
        )}
        {warningCount > 0 && (
          <span className="status-warnings">⚠ {warningCount}</span>
        )}

        {/* History/version button */}
        <button
          className="status-history-btn"
          onClick={onShowHistory}
          disabled={!activeTabPath}
          title="File history"
        >
          ⏱
        </button>

        {/* Font size widget */}
        <div className="font-size-widget">
          {showFontMenu && (
            <div className="font-size-menu">
              {FONT_SIZE_PRESETS.map((size) => (
                <button
                  key={size}
                  className={`font-size-preset${size === fontSize ? " active" : ""}`}
                  onClick={() => { setFontSize(size); setShowFontMenu(false); }}
                >
                  {size}
                </button>
              ))}
            </div>
          )}
          <button
            ref={fontBtnRef}
            className="font-size-btn"
            title="Adjust font size"
            onClick={() => setShowFontMenu((v) => !v)}
          >
            A {fontSize}
          </button>
          <button
            className="font-adj-btn"
            title="Decrease font size"
            onClick={() => setFontSize(fontSize - 1)}
            disabled={fontSize <= 8}
          >
            −
          </button>
          <button
            className="font-adj-btn"
            title="Increase font size"
            onClick={() => setFontSize(fontSize + 1)}
            disabled={fontSize >= 32}
          >
            +
          </button>
        </div>

      </div>

      <div className="status-right">
        {editTimeLabel && (
          <span className="status-edit-time" title="Last edit time">
            ✎ {editTimeLabel}
          </span>
        )}
        {language && (
          <span className="status-lang">{language}</span>
        )}
        {activeTab && (
          <span className="status-encoding">UTF-8</span>
        )}
        {lastCompileMs !== null && (
          <span className="status-compile-time" title="Last compile duration">
            ⚡ {lastCompileMs < 1000
              ? `${Math.round(lastCompileMs)}ms`
              : `${(lastCompileMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    </div>
  );
}
