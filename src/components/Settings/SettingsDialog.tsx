import { useEffect, useState } from "react";
import { useEditorStore } from "../../stores/editorStore";
import "./SettingsDialog.css";

type Section = "general" | "editor" | "preview" | "appearance";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "preview", label: "Preview" },
  { id: "appearance", label: "Appearance" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("general");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div className="settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-sidebar">
          <div className="settings-title">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item${section === s.id ? " active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          <button className="settings-close" onClick={onClose} aria-label="Close">×</button>
          {section === "general" && <GeneralSection />}
          {section === "editor" && <EditorSection />}
          {section === "preview" && <PreviewSection />}
          {section === "appearance" && <AppearanceSection />}
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <div>{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function GeneralSection() {
  const confirmOnClose = useEditorStore((s) => s.confirmOnClose);
  const setConfirmOnClose = useEditorStore((s) => s.setConfirmOnClose);
  return (
    <div>
      <h2>General</h2>
      <Row label="Confirm before closing dirty tabs" hint="Prompt if a tab has unsaved changes">
        <input type="checkbox" checked={confirmOnClose} onChange={(e) => setConfirmOnClose(e.target.checked)} />
      </Row>
    </div>
  );
}

function EditorSection() {
  const fontSize = useEditorStore((s) => s.editorFontSize);
  const setFontSize = useEditorStore((s) => s.setEditorFontSize);
  const tabSize = useEditorStore((s) => s.editorTabSize);
  const setTabSize = useEditorStore((s) => s.setEditorTabSize);
  const wordWrap = useEditorStore((s) => s.editorWordWrap);
  const setWordWrap = useEditorStore((s) => s.setEditorWordWrap);
  const minimap = useEditorStore((s) => s.editorMinimap);
  const setMinimap = useEditorStore((s) => s.setEditorMinimap);
  const lineNumbers = useEditorStore((s) => s.editorLineNumbers);
  const setLineNumbers = useEditorStore((s) => s.setEditorLineNumbers);
  return (
    <div>
      <h2>Editor</h2>
      <Row label="Font size" hint="8–32 px">
        <input
          type="number"
          min={8}
          max={32}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value) || 14)}
        />
      </Row>
      <Row label="Tab size" hint="Spaces per indent">
        <input
          type="number"
          min={1}
          max={8}
          value={tabSize}
          onChange={(e) => setTabSize(Number(e.target.value) || 2)}
        />
      </Row>
      <Row label="Word wrap">
        <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />
      </Row>
      <Row label="Minimap">
        <input type="checkbox" checked={minimap} onChange={(e) => setMinimap(e.target.checked)} />
      </Row>
      <Row label="Line numbers">
        <input type="checkbox" checked={lineNumbers} onChange={(e) => setLineNumbers(e.target.checked)} />
      </Row>
    </div>
  );
}

function PreviewSection() {
  const useSidecar = useEditorStore((s) => s.useSidecarPreview);
  const setUseSidecar = useEditorStore((s) => s.setUseSidecarPreview);
  const defaultZoom = useEditorStore((s) => s.defaultPreviewZoom);
  const setDefaultZoom = useEditorStore((s) => s.setDefaultPreviewZoom);
  return (
    <div>
      <h2>Preview</h2>
      <Row label="Use sidecar preview" hint="Tinymist's incremental renderer (iframe)">
        <input type="checkbox" checked={useSidecar} onChange={(e) => setUseSidecar(e.target.checked)} />
      </Row>
      <Row label="Default zoom" hint="25%–400%">
        <input
          type="number"
          min={25}
          max={400}
          step={5}
          value={Math.round(defaultZoom * 100)}
          onChange={(e) => setDefaultZoom((Number(e.target.value) || 100) / 100)}
        />
      </Row>
    </div>
  );
}

function AppearanceSection() {
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  return (
    <div>
      <h2>Appearance</h2>
      <Row label="Theme">
        <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "claude")}>
          <option value="dark">Dark</option>
          <option value="claude">Claude (light)</option>
        </select>
      </Row>
    </div>
  );
}
