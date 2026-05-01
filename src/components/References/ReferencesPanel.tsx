import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore, type Reference } from "../../stores/editorStore";
import "./ReferencesPanel.css";

// Parse a single .bib file's text into one or more references.
// Best-effort regex parser — handles standard @article{}/@inproceedings{}/etc.
function parseBibtex(text: string): Omit<Reference, "id" | "addedAt">[] {
  const entries: Omit<Reference, "id" | "addedAt">[] = [];
  // Matches "@type{key, ... }" with brace balancing approximated by lazy match.
  const entryRe = /@(\w+)\s*\{\s*([^,\s]+)\s*,([^@]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(text)) !== null) {
    const [, , key, body] = m;
    const fields = parseBibFields(body);
    const authorsRaw = fields.author ?? fields.editor ?? "";
    const authors = authorsRaw
      ? authorsRaw.split(/\s+and\s+/i).map((a) => a.trim()).filter(Boolean)
      : undefined;
    const year = fields.year ? Number(fields.year.replace(/\D/g, "")) || undefined : undefined;
    entries.push({
      kind: "bib",
      name: fields.title || key,
      bibKey: key,
      bibEntry: m[0],
      title: fields.title,
      authors,
      year,
    });
  }
  return entries;
}

function parseBibFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // field = "value" | {value} | bare
  const fieldRe = /(\w+)\s*=\s*(\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|([^,\n]+))\s*,?/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(body)) !== null) {
    const name = m[1].toLowerCase();
    const value = (m[3] ?? m[4] ?? m[5] ?? "").trim();
    out[name] = value.replace(/\s+/g, " ");
  }
  return out;
}

function shortAuthors(authors?: string[]): string {
  if (!authors || authors.length === 0) return "";
  const lastNames = authors.map((a) => {
    // Authors in BibTeX often "Last, First" — take the part before the comma.
    if (a.includes(",")) return a.split(",")[0].trim();
    const parts = a.trim().split(/\s+/);
    return parts[parts.length - 1];
  });
  if (lastNames.length === 1) return lastNames[0];
  if (lastNames.length === 2) return `${lastNames[0]} & ${lastNames[1]}`;
  return `${lastNames[0]} et al.`;
}

function formatBibEntry(ref: Reference): string {
  if (ref.bibEntry) return ref.bibEntry;
  const key = ref.bibKey || `ref${ref.year ?? ""}`;
  const authors = ref.authors?.join(" and ") ?? "";
  const fields = [
    ref.title ? `  title = {${ref.title}}` : null,
    authors ? `  author = {${authors}}` : null,
    ref.year ? `  year = {${ref.year}}` : null,
  ].filter(Boolean).join(",\n");
  return `@misc{${key},\n${fields}\n}`;
}

interface DroppedFile {
  name: string;
  bytes: Uint8Array;
}

async function readDroppedFile(file: File): Promise<DroppedFile> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, bytes: buf };
}

export function ReferencesPanel() {
  const references = useEditorStore((s) => s.references);
  const addReference = useEditorStore((s) => s.addReference);
  const removeReference = useEditorStore((s) => s.removeReference);
  const workspacePath = useEditorStore((s) => s.workspacePath);

  const [dropHover, setDropHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropHover(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.target === e.currentTarget) setDropHover(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDropHover(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      setBusy(true);
      setErrMsg(null);
      try {
        for (const f of files) {
          const lower = f.name.toLowerCase();
          if (lower.endsWith(".bib")) {
            const dropped = await readDroppedFile(f);
            const text = new TextDecoder().decode(dropped.bytes);
            const entries = parseBibtex(text);
            if (entries.length === 0) {
              setErrMsg(`No BibTeX entries found in ${f.name}`);
              continue;
            }
            for (const entry of entries) addReference(entry);
          } else if (lower.endsWith(".pdf")) {
            const dropped = await readDroppedFile(f);
            let path: string | undefined;
            // Prefer copying into the workspace so the path is stable across sessions.
            if (workspacePath) {
              const refDir = `${workspacePath}/references`;
              try { await invoke("create_dir", { path: refDir }); } catch { /* may already exist */ }
              path = `${refDir}/${f.name}`;
              await invoke("write_file_bytes", { path, bytes: Array.from(dropped.bytes) });
            }
            const stem = f.name.replace(/\.pdf$/i, "");
            const bibKey = stem.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "ref";
            addReference({
              kind: "pdf",
              name: f.name,
              path,
              bibKey,
              title: stem,
            });
          } else {
            setErrMsg(`Unsupported file type: ${f.name} (drop .pdf or .bib)`);
          }
        }
      } catch (err) {
        console.error("references drop error", err);
        setErrMsg(String(err));
      } finally {
        setBusy(false);
      }
    },
    [addReference, workspacePath]
  );

  const insertCite = useCallback((ref: Reference) => {
    const key = ref.bibKey;
    if (!key) return;
    window.dispatchEvent(new CustomEvent("editor:insert", { detail: `@${key}` }));
  }, []);

  const copyBibEntry = useCallback(async (ref: Reference) => {
    await navigator.clipboard.writeText(formatBibEntry(ref));
    setCopiedKey(ref.id);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  const openPdf = useCallback(async (ref: Reference) => {
    if (!ref.path) return;
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(ref.path);
    } catch (e) {
      console.error("openPath failed", e);
    }
  }, []);

  return (
    <div className="references-panel">
      <div className="references-header">
        <span className="references-title">REFERENCES</span>
        <span className="references-count">{references.length}</span>
      </div>

      <div
        className={`references-dropzone${dropHover ? " is-hover" : ""}${busy ? " is-busy" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="references-dropzone-icon" aria-hidden>
          {busy ? "…" : "⇣"}
        </div>
        <div className="references-dropzone-text">
          <strong>Drop reference papers here</strong>
          <span>PDFs are saved to <code>references/</code>; .bib files are parsed</span>
        </div>
      </div>

      {errMsg && (
        <div className="references-error" onClick={() => setErrMsg(null)} title="Click to dismiss">
          {errMsg}
        </div>
      )}

      <div className="references-list">
        {references.length === 0 ? (
          <div className="references-empty">
            <p>No references yet.</p>
            <p className="references-empty-hint">
              Drop PDFs or .bib files above. Click a card's <code>@cite</code> to insert at cursor.
            </p>
          </div>
        ) : (
          references.map((ref) => (
            <div key={ref.id} className="reference-card">
              <div className="reference-card-head">
                <span className={`reference-kind reference-kind--${ref.kind}`}>{ref.kind.toUpperCase()}</span>
                {ref.bibKey && <span className="reference-key">@{ref.bibKey}</span>}
                <button
                  className="reference-card-remove"
                  onClick={() => removeReference(ref.id)}
                  title="Remove from references"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
              <div className="reference-card-title" title={ref.title || ref.name}>
                {ref.title || ref.name}
              </div>
              {(ref.authors?.length || ref.year) && (
                <div className="reference-card-meta">
                  {shortAuthors(ref.authors)}
                  {ref.year ? ` · ${ref.year}` : ""}
                </div>
              )}
              <div className="reference-card-actions">
                <button
                  className="reference-action"
                  onClick={() => insertCite(ref)}
                  disabled={!ref.bibKey}
                  title="Insert citation at cursor"
                >
                  Cite
                </button>
                <button
                  className="reference-action"
                  onClick={() => copyBibEntry(ref)}
                  title="Copy BibTeX entry"
                >
                  {copiedKey === ref.id ? "Copied" : "BibTeX"}
                </button>
                {ref.kind === "pdf" && ref.path && (
                  <button
                    className="reference-action"
                    onClick={() => openPdf(ref)}
                    title="Open PDF in default viewer"
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
