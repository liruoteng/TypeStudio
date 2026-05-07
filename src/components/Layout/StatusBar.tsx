import { useState, useEffect, useRef } from "react";
import { useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import {
  Circle,
  X,
  AlertTriangle,
  Clock,
  Zap,
  Pencil,
  Minus,
  Plus,
  Type,
} from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import "./StatusBar.css";

interface StatusBarProps {
  lspStatus?: "connecting" | "connected" | "disconnected";
  onShowHistory?: () => void;
}

/**
 * Subscribes to Monaco's marker registry and returns live error/warning
 * counts for the active tab's model, plus a helper that jumps the editor
 * to the first marker of the given severity.
 */
function useActiveMarkers(activeTabPath: string | null) {
  const monaco = useMonaco();
  const [counts, setCounts] = useState({ errors: 0, warnings: 0 });

  useEffect(() => {
    if (!monaco || !activeTabPath) {
      setCounts({ errors: 0, warnings: 0 });
      return;
    }
    const recount = () => {
      const model = monaco.editor.getModels().find((m) => {
        const mp = m.uri.scheme === "file" ? m.uri.fsPath : m.uri.path;
        return mp === activeTabPath;
      });
      if (!model) { setCounts({ errors: 0, warnings: 0 }); return; }
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      let errors = 0, warnings = 0;
      for (const m of markers) {
        if (m.severity === monaco.MarkerSeverity.Error) errors++;
        else if (m.severity === monaco.MarkerSeverity.Warning) warnings++;
      }
      setCounts({ errors, warnings });
    };
    recount();
    const sub = monaco.editor.onDidChangeMarkers(recount);
    return () => sub.dispose();
  }, [monaco, activeTabPath]);

  const jumpToFirst = (sev: "error" | "warning") => {
    if (!monaco || !activeTabPath) return;
    const model = monaco.editor.getModels().find((m) => {
      const mp = m.uri.scheme === "file" ? m.uri.fsPath : m.uri.path;
      return mp === activeTabPath;
    });
    if (!model) return;
    const target = sev === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning;
    const marker = monaco.editor
      .getModelMarkers({ resource: model.uri })
      .filter((m) => m.severity === target)
      .sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)[0];
    if (!marker) return;
    const editor = monaco.editor
      .getEditors()
      .find((e) => (e as Monaco.editor.IStandaloneCodeEditor).getModel() === model);
    if (!editor) return;
    editor.revealLineInCenter(marker.startLineNumber);
    editor.setPosition({ lineNumber: marker.startLineNumber, column: marker.startColumn });
    editor.focus();
  };

  return { ...counts, jumpToFirst };
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
  onShowHistory,
}: StatusBarProps) {
  const activeTab    = useEditorStore((s) => s.activeTab());
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const { errors: errorCount, warnings: warningCount, jumpToFirst } = useActiveMarkers(activeTabPath);
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
          <Circle size={8} fill="currentColor" /> Tinymist: {lspStatus}
        </span>
        {errorCount > 0 && (
          <button
            className="status-errors"
            onClick={() => jumpToFirst("error")}
            title={`${errorCount} error${errorCount === 1 ? "" : "s"} — click to jump (F8 / Shift+F8 to cycle)`}
          >
            <X size={10} /> {errorCount}
          </button>
        )}
        {warningCount > 0 && (
          <button
            className="status-warnings"
            onClick={() => jumpToFirst("warning")}
            title={`${warningCount} warning${warningCount === 1 ? "" : "s"} — click to jump`}
          >
            <AlertTriangle size={10} /> {warningCount}
          </button>
        )}

        {/* History/version button */}
        <button
          className="status-history-btn"
          onClick={onShowHistory}
          disabled={!activeTabPath}
          title="File history"
        >
          <Clock size={11} />
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
            <Type size={11} /> {fontSize}
          </button>
          <button
            className="font-adj-btn"
            title="Decrease font size"
            onClick={() => setFontSize(fontSize - 1)}
            disabled={fontSize <= 8}
          >
            <Minus size={10} />
          </button>
          <button
            className="font-adj-btn"
            title="Increase font size"
            onClick={() => setFontSize(fontSize + 1)}
            disabled={fontSize >= 32}
          >
            <Plus size={10} />
          </button>
        </div>

      </div>

      <div className="status-right">
        {editTimeLabel && (
          <span className="status-edit-time" title="Last edit time">
            <Pencil size={11} /> {editTimeLabel}
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
            <Zap size={11} /> {lastCompileMs < 1000
              ? `${Math.round(lastCompileMs)}ms`
              : `${(lastCompileMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    </div>
  );
}
