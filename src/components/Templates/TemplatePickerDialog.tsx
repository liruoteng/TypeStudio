import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";
import "./TemplatePickerDialog.css";

interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  main: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Conference": "var(--template-badge-conference)",
  "CV / AI":    "var(--template-badge-cv)",
  "ML / AI":    "var(--template-badge-ml)",
  "General":    "var(--template-badge-general)",
};

function TemplateThumbnail({ template }: { template: TemplateInfo }) {
  const isTwo = template.id === "ieee-conference" || template.id === "cvpr-2025";
  const lines = [90, 70, 80, 60, 75, 65, 70, 55];

  return (
    <div className="template-thumbnail">
      <div className="thumbnail-title-bar" />
      <div className="thumbnail-author-bar" />
      {isTwo ? (
        <div className="thumbnail-two-col">
          <div className="thumbnail-col">
            {lines.slice(0, 4).map((w, i) => (
              <div key={i} className="thumbnail-line" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="thumbnail-col">
            {lines.slice(4).map((w, i) => (
              <div key={i} className="thumbnail-line" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="thumbnail-lines">
          {lines.map((w, i) => (
            <div key={i} className="thumbnail-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplatePickerDialog({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("my-paper");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<TemplateInfo[]>("list_templates")
      .then((list) => {
        setTemplates(list);
        if (list.length > 0) setSelected(list[0].id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCreate = useCallback(async () => {
    if (!selected) return;
    const name = projectName.trim();
    if (!name) {
      setError("Please enter a project name.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const parentFolder = await open({
        directory: true,
        multiple: false,
        title: "Choose where to create the project",
      });
      if (typeof parentFolder !== "string") {
        setCreating(false);
        return;
      }
      const mainPath = await invoke<string>("create_project_from_template", {
        templateId: selected,
        parentPath: parentFolder,
        projectName: name,
      });
      const projectPath = mainPath.slice(0, mainPath.lastIndexOf("/"));
      const content = await invoke<string>("read_file", { path: mainPath });
      const fileName = mainPath.split("/").pop() ?? "main";
      useEditorStore.getState().setWorkspacePath(projectPath);
      useEditorStore.getState().openTab(mainPath, fileName, content);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [selected, projectName, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !creating) handleCreate();
  }, [handleCreate, creating]);

  return (
    <div className="template-backdrop" onMouseDown={onClose}>
      <div className="template-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="template-header">
          <span className="template-title">New Project from Template</span>
        </div>

        <div className="template-body">
          {loading && <div className="template-loading">Loading templates…</div>}
          {!loading && templates.length === 0 && (
            <div className="template-loading">No templates found.</div>
          )}
          {!loading && templates.length > 0 && (
            <div className="template-grid">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className={`template-card${selected === t.id ? " selected" : ""}`}
                  onClick={() => setSelected(t.id)}
                  onDoubleClick={handleCreate}
                >
                  <TemplateThumbnail template={t} />
                  <div className="template-card-info">
                    <div className="template-card-name">{t.name}</div>
                    <div className="template-card-desc">{t.description}</div>
                    <span
                      className="template-badge"
                      style={{ background: CATEGORY_COLORS[t.category] ?? "var(--template-badge-general)" }}
                    >
                      {t.category}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="template-name-row">
          <label className="template-name-label" htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            className="template-name-input"
            type="text"
            value={projectName}
            onChange={(e) => { setProjectName(e.target.value); setError(null); }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {error && <div className="template-error">{error}</div>}

        <div className="template-footer">
          <button className="template-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="template-btn-create"
            onClick={handleCreate}
            disabled={!selected || creating || !projectName.trim()}
          >
            {creating ? "Creating…" : "Choose Location…"}
          </button>
        </div>
      </div>
    </div>
  );
}
