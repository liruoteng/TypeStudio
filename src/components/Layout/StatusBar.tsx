import { useEditorStore } from "../../stores/editorStore";
import "./StatusBar.css";

interface StatusBarProps {
  lspStatus?: "connecting" | "connected" | "disconnected";
  errorCount?: number;
  warningCount?: number;
}

export function StatusBar({
  lspStatus = "disconnected",
  errorCount = 0,
  warningCount = 0,
}: StatusBarProps) {
  const activeTab = useEditorStore((s) => s.activeTab());

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
      </div>
      <div className="status-right">
        {activeTab && (
          <>
            <span className="status-lang">Typst</span>
            <span className="status-encoding">UTF-8</span>
          </>
        )}
      </div>
    </div>
  );
}
