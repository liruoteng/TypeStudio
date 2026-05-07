mod ai;
mod converter;
mod latex_import;
mod lsp_bridge;
mod preview_sidecar;
mod typst_world;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

// ── Managed state ──────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct CompileRequest {
    pub path: String,
    pub content: String,
}

pub struct AppState {
    pub tinymist_path: Mutex<String>,
    /// Sender half of the watch channel for the compile actor.
    /// Sending here immediately makes the latest content available to the actor.
    pub compile_tx: tokio::sync::watch::Sender<Option<CompileRequest>>,
    /// Persistent in-process Typst compiler world — shared with the compile actor.
    pub typst_world: Arc<Mutex<Option<typst_world::TypstWorld>>>,
    /// Sidecar preview server (alternative high-performance preview path).
    pub preview_sidecar: preview_sidecar::SharedSidecar,
}

// ── File system commands ───────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SnapshotEntry {
    pub timestamp: u64,  // Unix seconds — JS formats this
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("Destination already exists: {path}"));
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_temp_file(extension: Option<String>) -> Result<String, String> {
    let ext = extension.unwrap_or_else(|| "typ".to_string());
    let dir = std::env::temp_dir().join("type-studio");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for n in 1..10000 {
        let candidate = dir.join(format!("untitled-{n}.{ext}"));
        if !candidate.exists() {
            fs::write(&candidate, "").map_err(|e| e.to_string())?;
            return Ok(candidate.to_string_lossy().to_string());
        }
    }
    Err("could not allocate temp filename".into())
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let read = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut entries: Vec<FileEntry> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            Some(FileEntry {
                name,
                path: e.path().to_string_lossy().to_string(),
                is_dir: meta.is_dir(),
            })
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub line_content: String,
}

/// Recursively search file contents under root_dir for the given query (case-insensitive).
/// Skips hidden files/dirs, common build dirs, and files > 1 MB.
#[tauri::command]
fn search_in_files(root_dir: String, query: String) -> Result<Vec<SearchMatch>, String> {
    let mut results = Vec::new();
    let root = Path::new(&root_dir);
    if !root.is_dir() {
        return Err("Not a directory".to_string());
    }
    let query_lower = query.to_lowercase();
    search_dir(root, root, &query_lower, &mut results)?;
    Ok(results)
}

fn search_dir(
    base: &Path,
    dir: &Path,
    query: &str,
    results: &mut Vec<SearchMatch>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if let Some(name) = path.file_name() {
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            // Skip common build / dependency directories
            if path.is_dir()
                && (name.as_ref() == "node_modules"
                    || name.as_ref() == "target"
                    || name.as_ref() == ".history")
            {
                continue;
            }
        }

        if path.is_dir() {
            let _ = search_dir(base, &path, query, results);
        } else if path.is_file() {
            // Skip files larger than 1 MB
            if let Ok(meta) = path.metadata() {
                if meta.len() > 1_048_576 {
                    continue;
                }
            }
            if let Ok(content) = fs::read_to_string(&path) {
                for (i, line) in content.lines().enumerate() {
                    if line.to_lowercase().contains(query) {
                        let line_content = if line.len() > 200 {
                            format!("{}…", &line[..200])
                        } else {
                            line.to_string()
                        };
                        results.push(SearchMatch {
                            path: path.to_string_lossy().to_string(),
                            line: i + 1,
                            line_content,
                        });
                        if results.len() >= 200 {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// Copy the current file into `.history/{stem}/{unix_ts}.{ext}`, keeping ≤ 50 snapshots.
#[tauri::command]
fn save_snapshot(path: String) -> Result<(), String> {
    let src = Path::new(&path);
    if !src.exists() {
        return Ok(());
    }
    let parent = src.parent().unwrap_or(Path::new("."));
    let stem = src.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();

    let history_dir = parent.join(".history").join(&stem);
    fs::create_dir_all(&history_dir).map_err(|e| e.to_string())?;

    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = if ext.is_empty() { format!("{secs}") } else { format!("{secs}.{ext}") };
    fs::copy(src, history_dir.join(&filename)).map_err(|e| e.to_string())?;

    // Prune oldest snapshots beyond 50
    let mut files: Vec<_> = fs::read_dir(&history_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .collect();
    if files.len() > 50 {
        files.sort_by_key(|e| e.file_name());
        for f in &files[..files.len() - 50] {
            let _ = fs::remove_file(f.path());
        }
    }
    Ok(())
}

/// List snapshots for a file, newest first.
#[tauri::command]
fn list_snapshots(path: String) -> Result<Vec<SnapshotEntry>, String> {
    let src = Path::new(&path);
    let parent = src.parent().unwrap_or(Path::new("."));
    let stem = src.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let history_dir = parent.join(".history").join(&stem);

    if !history_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<SnapshotEntry> = fs::read_dir(&history_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let ts: u64 = name.split('.').next()?.parse().ok()?;
            Some(SnapshotEntry { timestamp: ts, path: e.path().to_string_lossy().to_string() })
        })
        .collect();

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Show a native macOS NSAlert (via osascript) for a move conflict.
/// Returns one of: "Replace", "Keep Both", "Stop".
#[tauri::command]
fn show_move_conflict_dialog(src_name: String, dest_dir_name: String) -> String {
    let safe_src  = src_name.replace('\\', "\\\\").replace('"', "\\\"");
    let safe_dest = dest_dir_name.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display dialog \"\\\"{}\\\" already exists in \\\"{}\\\". \
         What would you like to do?\" \
         with title \"File Already Exists\" \
         buttons {{\"Stop\", \"Keep Both\", \"Replace\"}} \
         default button \"Keep Both\" \
         cancel button \"Stop\" \
         with icon caution",
        safe_src, safe_dest
    );
    match std::process::Command::new("osascript").arg("-e").arg(&script).output() {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.trim()
                .strip_prefix("button returned:")
                .unwrap_or("Stop")
                .to_string()
        }
        Err(_) => "Stop".to_string(),
    }
}

#[tauri::command]
fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_child = entry.path();
        let dst_child = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&src_child, &dst_child)?;
        } else {
            fs::copy(&src_child, &dst_child)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_path(src: String, dest: String) -> Result<(), String> {
    let s = Path::new(&src);
    let d = Path::new(&dest);
    if d.exists() {
        return Err(format!("Destination already exists: {dest}"));
    }
    if s.is_dir() {
        copy_dir_recursive(s, d).map_err(|e| e.to_string())
    } else {
        fs::copy(s, d).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── App settings (persisted to config dir) ─────────────────────────────────

fn settings_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<String, String> {
    let p = settings_file_path(&app)?;
    if !p.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_settings(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let p = settings_file_path(&app)?;
    fs::write(&p, contents).map_err(|e| e.to_string())
}

// ── File conversion ────────────────────────────────────────────────────────

/// Convert a Markdown, DOCX, or PDF file to Typst source and return the text.
/// Markdown: built-in converter (no external deps), or pandoc if available.
/// DOCX: pandoc required.
/// PDF: pdftotext (poppler) required.
#[tauri::command]
fn convert_to_typst(path: String) -> Result<String, String> {
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "md" | "markdown" => {
            // Prefer pandoc for richer output; fall back to built-in converter.
            if let Ok(result) = converter::try_pandoc("markdown", &path) {
                Ok(result)
            } else {
                let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                Ok(converter::markdown_to_typst(&content).0)
            }
        }
        "docx" => converter::try_pandoc("docx", &path),
        "pdf" => converter::try_pdf_to_typst(&path),
        other => Err(format!("Unsupported format: .{other}")),
    }
}

// ── Compilation helpers ────────────────────────────────────────────────────

/// Resolve the tinymist binary path from managed state.
fn resolve_tinymist(state: &tauri::State<AppState>) -> String {
    state.tinymist_path.lock().unwrap().clone()
}

/// Run tinymist compile and capture stdout + stderr.
/// Returns Err with the combined error output on non-zero exit.
fn run_tinymist_compile(
    tinymist: &str,
    input: &str,
    output: &str,
    format: &str,
    root: Option<&str>,
) -> Result<(), String> {
    let mut cmd = Command::new(tinymist);
    cmd.arg("compile")
        .arg("--format")
        .arg(format)
        .arg(input)
        .arg(output);
    if let Some(r) = root {
        cmd.current_dir(r);
    }

    let out = cmd.output().map_err(|e| format!("Failed to run tinymist: {e}"))?;

    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        Err(format!("{stderr}\n{stdout}").trim().to_string())
    }
}

// ── Compile actor ──────────────────────────────────────────────────────────
//
// A single background task owns the Typst world and compiles continuously.
// The watch channel ensures that only the *latest* content is compiled —
// any intermediate values sent while the actor is busy are silently dropped.
// Results are pushed to the frontend as "preview-result" events.

#[derive(Clone, Serialize)]
pub struct PageUpdate {
    pub index: usize,
    pub svg: String,
}

/// Incremental result: only pages that changed since the last compile.
#[derive(Clone, Serialize)]
pub struct PreviewResult {
    pub total_pages: usize,
    pub updates: Vec<PageUpdate>,
}

#[derive(Clone, Serialize)]
pub struct PreviewError {
    pub message: String,
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref(),
        Some("md") | Some("markdown")
    )
}

/// Build the Typst source for a Markdown file.
/// Strips YAML front matter, generates a preamble from it, and combines with the body.
/// If a `template.typ` exists next to the file it takes precedence over the built-in preamble.
fn compose_markdown_source(md_path: &Path, md_content: &str) -> (String, Vec<String>) {
    let (body_md, fm_yaml) = converter::strip_front_matter(md_content);
    let fm = fm_yaml.map(converter::parse_front_matter).unwrap_or_default();
    let (body, warnings) = converter::markdown_to_typst(body_md);

    // Explicit template.typ in the same directory wins over built-in preamble.
    let explicit_template = md_path
        .parent()
        .map(|p| p.join("template.typ"))
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(&p).ok());

    let typst = match explicit_template {
        Some(t) => format!("{t}\n\n{body}"),
        None => {
            let preamble = converter::build_preamble(&fm);
            if preamble.is_empty() {
                body
            } else {
                format!("{preamble}\n{body}")
            }
        }
    };
    (typst, warnings)
}

#[tauri::command]
async fn fetch_doi(doi: String) -> Result<serde_json::Value, String> {
    let url = format!("https://api.crossref.org/works/{doi}");
    let client = reqwest::Client::builder()
        .user_agent("TypeStudio/0.1 (mailto:user@typestudio.app)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("DOI not found (status {})", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let msg = &json["message"];

    let title = msg["title"][0].as_str().unwrap_or("").to_string();
    let year = msg["published"]["date-parts"][0][0]
        .as_u64()
        .unwrap_or(0) as u32;
    let doi_str = msg["DOI"].as_str().unwrap_or(&doi).to_string();
    let venue = msg["container-title"][0]
        .as_str()
        .unwrap_or("")
        .to_string();

    let authors: Vec<String> = msg["author"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|a| {
            let given = a["given"].as_str().unwrap_or("");
            let family = a["family"].as_str().unwrap_or("");
            if given.is_empty() {
                family.to_string()
            } else {
                format!("{family}, {given}")
            }
        })
        .collect();

    let first_family = msg["author"][0]["family"]
        .as_str()
        .unwrap_or("unknown");
    let bib_key = format!(
        "{}{}",
        first_family.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>(),
        year
    );

    Ok(serde_json::json!({
        "bibKey": bib_key,
        "title": title,
        "authors": authors,
        "year": year,
        "doi": doi_str,
        "venue": venue,
    }))
}

fn hash_svg(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

async fn compile_actor(
    mut rx: tokio::sync::watch::Receiver<Option<CompileRequest>>,
    world_arc: Arc<Mutex<Option<typst_world::TypstWorld>>>,
    app_handle: tauri::AppHandle,
) {
    // Hashes of the last successfully compiled pages — used for incremental diffs.
    let mut prev_hashes: Vec<u64> = Vec::new();

    loop {
        if rx.changed().await.is_err() { break; }
        let req = rx.borrow_and_update().clone();
        let Some(req) = req else { continue };

        // Run Markdown conversion outside spawn_blocking so we can emit warnings.
        let (source_content, conv_warnings) = if is_markdown_path(Path::new(&req.path)) {
            compose_markdown_source(Path::new(&req.path), &req.content)
        } else {
            (req.content.clone(), vec![])
        };
        let _ = app_handle.emit("converter-warnings", &conv_warnings);

        let world = Arc::clone(&world_arc);
        let result = tauri::async_runtime::spawn_blocking(move || {
            let main_path = Path::new(&req.path);
            let mut guard = world.lock().unwrap();

            let needs_init = match guard.as_ref() {
                None => true,
                Some(w) => w.root() != main_path.parent().unwrap_or_else(|| Path::new("/")),
            };
            if needs_init {
                *guard = Some(typst_world::TypstWorld::new(main_path)?);
            }
            guard.as_mut().unwrap().set_source(main_path, &source_content)?;

            let warned = typst::compile::<typst::layout::PagedDocument>(guard.as_ref().unwrap());
            drop(guard);
            comemo::evict(30);

            match warned.output {
                Ok(doc) => Ok(doc.pages.iter().map(|p| typst_svg::svg(p)).collect::<Vec<_>>()),
                Err(errors) => Err(errors
                    .iter()
                    .map(|e: &typst::diag::SourceDiagnostic| e.message.to_string())
                    .collect::<Vec<_>>()
                    .join("\n")),
            }
        })
        .await;

        match result {
            Ok(Ok(pages)) => {
                let hashes: Vec<u64> = pages.iter().map(|s| hash_svg(s)).collect();
                // Only send pages whose hash changed (or that are new).
                let updates: Vec<PageUpdate> = pages
                    .into_iter()
                    .enumerate()
                    .filter(|(i, _)| hashes.get(*i) != prev_hashes.get(*i))
                    .map(|(index, svg)| PageUpdate { index, svg })
                    .collect();
                prev_hashes = hashes;
                let _ = app_handle.emit("preview-result", PreviewResult {
                    total_pages: prev_hashes.len(),
                    updates,
                });
            }
            Ok(Err(msg)) => { let _ = app_handle.emit("preview-error", PreviewError { message: msg }); }
            Err(e) => { let _ = app_handle.emit("preview-error", PreviewError { message: e.to_string() }); }
        }
    }
}

/// Fire-and-forget: send latest content to the compile actor.
/// Returns immediately; the result arrives via the "preview-result" event.
#[tauri::command]
fn update_preview_source(
    path: String,
    content: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    state.compile_tx.send(Some(CompileRequest { path, content })).map_err(|e| e.to_string())
}

/// Compile from disk (used by save/refresh paths that don't pass content).
#[tauri::command]
fn trigger_preview_compile(path: String, state: tauri::State<AppState>) -> Result<(), String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    state.compile_tx.send(Some(CompileRequest { path, content })).map_err(|e| e.to_string())
}

// ── Sidecar preview ────────────────────────────────────────────────────────
//
// Starts/stops a `tinymist preview` child process. The frontend embeds the
// returned URL in an <iframe>, inheriting tinymist's full incremental
// rendering pipeline (vector-IR deltas + WASM renderer).

#[tauri::command]
async fn start_sidecar_preview(
    path: String,
    invert_colors: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let tinymist = state.tinymist_path.lock().unwrap().clone();
    let sidecar = state.preview_sidecar.clone();
    preview_sidecar::start(&sidecar, &tinymist, &path, &invert_colors).await
}

#[tauri::command]
async fn stop_sidecar_preview(state: tauri::State<'_, AppState>) -> Result<(), String> {
    preview_sidecar::stop(&state.preview_sidecar).await;
    Ok(())
}

// ── export_pdf ─────────────────────────────────────────────────────────────

/// Compile a .typ file to PDF and save to `dest_path`.
/// Returns the output path on success.
#[tauri::command]
fn export_pdf(
    path: String,
    dest_path: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let tinymist = resolve_tinymist(&state);

    let input_path = Path::new(&path);
    let root = input_path
        .parent()
        .map(|p| p.to_string_lossy().to_string());

    // For .md files, convert to Typst and compile from a temporary sibling .typ.
    // The temp file lives next to the source so relative image paths still resolve.
    let (compile_input, temp_to_clean) = if is_markdown_path(input_path) {
        let md_content = fs::read_to_string(input_path).map_err(|e| e.to_string())?;
        let (typst_content, _) = compose_markdown_source(input_path, &md_content);
        let parent = input_path.parent().unwrap_or_else(|| Path::new("."));
        let stem = input_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "untitled".to_string());
        let temp = parent.join(format!(".{stem}.export.typ"));
        fs::write(&temp, typst_content).map_err(|e| e.to_string())?;
        let temp_str = temp.to_string_lossy().to_string();
        (temp_str.clone(), Some(temp_str))
    } else {
        (path.clone(), None)
    };

    let result = run_tinymist_compile(
        &tinymist,
        &compile_input,
        &dest_path,
        "pdf",
        root.as_deref(),
    );

    if let Some(temp) = temp_to_clean {
        let _ = fs::remove_file(&temp);
    }

    result?;
    Ok(dest_path)
}

// ── App setup ──────────────────────────────────────────────────────────────

fn find_tinymist_path(resource_dir: &str) -> String {
    let target_triple = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else {
        "x86_64-unknown-linux-gnu"
    };

    let candidates = vec![
        // Release bundle (Tauri sidecar)
        format!("{resource_dir}/binaries/tinymist-{target_triple}"),
        // Dev fallback: relative to the src-tauri directory
        format!(
            "{}/binaries/tinymist-{target_triple}",
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
        ),
        // System PATH fallback
        "tinymist".to_string(),
    ];

    candidates
        .into_iter()
        .find(|p| Path::new(p).exists())
        .unwrap_or_else(|| "tinymist".to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ── compose_markdown_source ───────────────────────────────────────────────

    #[test]
    fn compose_markdown_source_without_template_returns_body_only() {
        let dir = std::env::temp_dir().join("ts_compose_notmpl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let md = dir.join("doc.md");
        fs::write(&md, "# Hello\n").unwrap();

        let (out, _) = compose_markdown_source(&md, "# Hello\n");
        assert!(out.contains("= Hello"));
        assert!(!out.contains("#set page"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn compose_markdown_source_prepends_template_when_present() {
        let dir = std::env::temp_dir().join("ts_compose_tmpl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let md = dir.join("doc.md");
        fs::write(&md, "# Hello\n").unwrap();
        fs::write(dir.join("template.typ"), "#set page(margin: 3cm)\n").unwrap();

        let (out, _) = compose_markdown_source(&md, "# Hello\n");
        let tmpl_pos = out.find("#set page(margin: 3cm)").expect("template missing");
        let body_pos = out.find("= Hello").expect("body missing");
        assert!(tmpl_pos < body_pos, "template must come before body");

        let _ = fs::remove_dir_all(&dir);
    }

    // ── hash_svg ──────────────────────────────────────────────────────────────

    #[test]
    fn hash_svg_is_deterministic() {
        let s = "<svg><rect width='100'/></svg>";
        let h1 = hash_svg(s);
        let h2 = hash_svg(s);
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_svg_differs_for_different_content() {
        assert_ne!(hash_svg("<svg>a</svg>"), hash_svg("<svg>b</svg>"));
    }

    #[test]
    fn hash_svg_empty_string() {
        let h1 = hash_svg("");
        let h2 = hash_svg("");
        assert_eq!(h1, h2);
    }

    // ── save_snapshot / list_snapshots ────────────────────────────────────────

    #[test]
    fn save_snapshot_creates_history_entry() {
        let dir = std::env::temp_dir().join("ts_snap_basic");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.typ");
        fs::write(&file, "content").unwrap();

        save_snapshot(file.to_string_lossy().to_string()).unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(snaps.len(), 1);
        assert!(snaps[0].timestamp > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_snapshots_empty_when_no_history() {
        let dir = std::env::temp_dir().join("ts_snap_nohistory");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("nosnap.typ");
        fs::write(&file, "").unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert!(snaps.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_snapshots_ordered_newest_first() {
        let dir = std::env::temp_dir().join("ts_snap_order");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("order.typ");
        fs::write(&file, "v1").unwrap();

        let hist = dir.join(".history").join("order");
        fs::create_dir_all(&hist).unwrap();
        fs::write(hist.join("100.typ"), "older").unwrap();
        fs::write(hist.join("200.typ"), "newer").unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(snaps.len(), 2);
        assert!(snaps[0].timestamp > snaps[1].timestamp, "newest should be first");
        assert_eq!(snaps[0].timestamp, 200);
        assert_eq!(snaps[1].timestamp, 100);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_snapshot_prunes_to_50() {
        let dir = std::env::temp_dir().join("ts_snap_prune");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("prune.typ");
        fs::write(&file, "latest").unwrap();

        let hist = dir.join(".history").join("prune");
        fs::create_dir_all(&hist).unwrap();
        for i in 0u64..55 {
            fs::write(hist.join(format!("{i}.typ")), format!("v{i}")).unwrap();
        }

        save_snapshot(file.to_string_lossy().to_string()).unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(snaps.len(), 50);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_snapshot_no_op_for_nonexistent_file() {
        let result = save_snapshot("/nonexistent/path/file.typ".to_string());
        assert!(result.is_ok(), "should silently succeed for missing files");
    }

    // ── list_dir sorting ──────────────────────────────────────────────────────

    #[test]
    fn list_dir_sorts_dirs_before_files_then_alphabetically() {
        let dir = std::env::temp_dir().join("ts_listdir_sort");
        // Clean up any previous run
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("b.typ"), "").unwrap();
        fs::write(dir.join("a.typ"), "").unwrap();
        fs::create_dir_all(dir.join("zdir")).unwrap();
        fs::create_dir_all(dir.join("adir")).unwrap();

        let entries = list_dir(dir.to_string_lossy().to_string()).unwrap();

        assert_eq!(entries.len(), 4);
        // First two are directories
        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        // Last two are files
        assert!(!entries[2].is_dir);
        assert!(!entries[3].is_dir);
        // Directories sorted alphabetically
        assert_eq!(entries[0].name, "adir");
        assert_eq!(entries[1].name, "zdir");
        // Files sorted alphabetically
        assert_eq!(entries[2].name, "a.typ");
        assert_eq!(entries[3].name, "b.typ");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_dir_excludes_hidden_files() {
        let dir = std::env::temp_dir().join("ts_listdir_hidden");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("visible.typ"), "").unwrap();
        fs::write(dir.join(".hidden"), "").unwrap();
        fs::create_dir_all(dir.join(".hiddendir")).unwrap();

        let entries = list_dir(dir.to_string_lossy().to_string()).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "visible.typ");

        let _ = fs::remove_dir_all(&dir);
    }

    // ── find_tinymist_path ────────────────────────────────────────────────────

    #[test]
    fn find_tinymist_path_falls_back_to_tinymist_string() {
        // With a non-existent resource dir, should fall back to "tinymist"
        let path = find_tinymist_path("/nonexistent/resource/dir");
        assert!(path.ends_with("tinymist") || path.contains("tinymist"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let world_arc = Arc::new(Mutex::new(None));
    let (compile_tx, compile_rx) = tokio::sync::watch::channel::<Option<CompileRequest>>(None);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ai::AiCancelFlag::default())
        .manage(AppState {
            tinymist_path: Mutex::new(String::new()),
            compile_tx,
            typst_world: Arc::clone(&world_arc),
            preview_sidecar: Arc::new(tokio::sync::Mutex::new(preview_sidecar::PreviewSidecar::default())),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_bytes,
            write_file,
            write_file_bytes,
            create_file,
            create_temp_file,
            create_dir,
            list_dir,
            search_in_files,
            update_preview_source,
            trigger_preview_compile,
            start_sidecar_preview,
            stop_sidecar_preview,
            export_pdf,
            save_snapshot,
            list_snapshots,
            path_exists,
            show_move_conflict_dialog,
            rename_path,
            copy_path,
            delete_path,
            reveal_in_finder,
            convert_to_typst,
            fetch_doi,
            latex_import::import_latex_template,
            read_settings,
            write_settings,
            ai::check_claude_cli,
            ai::stream_claude_cli,
            ai::stream_ai_chat,
            ai::cancel_ai_stream,
            ai::search_citations,
            ai::list_ollama_models,
        ])
        .setup(move |app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("resource dir")
                .to_string_lossy()
                .to_string();

            let tinymist_path = find_tinymist_path(&resource_dir);
            eprintln!("[setup] Using tinymist at: {tinymist_path}");

            *app.state::<AppState>().tinymist_path.lock().unwrap() = tinymist_path.clone();

            // ── Native menu ──────────────────────────────────────────────
            // Items that mirror in-app actions emit `menu:<id>` events; the
            // frontend listens for them and runs the same handler the button
            // or shortcut would. Accelerators are assigned in the menu (not
            // in the editor/React) so macOS shows them and dispatches them.
            let handle = app.handle();

            let m_new_file      = MenuItemBuilder::new("New Typst Document").id("new-file").accelerator("CmdOrCtrl+N").build(handle)?;
            let m_new_md        = MenuItemBuilder::new("New Markdown Document").id("new-file-md").accelerator("CmdOrCtrl+Shift+N").build(handle)?;
            let m_open_file     = MenuItemBuilder::new("Open File…").id("open-file").accelerator("CmdOrCtrl+O").build(handle)?;
            let m_open_folder   = MenuItemBuilder::new("Open Folder…").id("open-folder").accelerator("CmdOrCtrl+Shift+O").build(handle)?;
            let m_save          = MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+S").build(handle)?;
            let m_save_all      = MenuItemBuilder::new("Save All").id("save-all").accelerator("CmdOrCtrl+Alt+S").build(handle)?;
            let m_close_tab     = MenuItemBuilder::new("Close Tab").id("close-tab").accelerator("CmdOrCtrl+W").build(handle)?;
            let m_export_pdf    = MenuItemBuilder::new("Export PDF…").id("export-pdf").accelerator("CmdOrCtrl+E").build(handle)?;
            let m_import_latex  = MenuItemBuilder::new("Import LaTeX Template…").id("import-latex").build(handle)?;

            let m_toggle_sidebar = MenuItemBuilder::new("Toggle Sidebar").id("toggle-sidebar").accelerator("CmdOrCtrl+B").build(handle)?;
            let m_toggle_preview = MenuItemBuilder::new("Toggle Preview").id("toggle-preview").accelerator("CmdOrCtrl+Shift+V").build(handle)?;
            let m_toggle_outline = MenuItemBuilder::new("Toggle Outline").id("toggle-outline").build(handle)?;
            let m_toggle_writing = MenuItemBuilder::new("Toggle Writing Mode").id("toggle-writing-mode").build(handle)?;
            let m_toggle_sidecar = MenuItemBuilder::new("Toggle Sidecar Preview").id("toggle-sidecar-preview").accelerator("CmdOrCtrl+Shift+P").build(handle)?;
            let m_show_history   = MenuItemBuilder::new("Toggle File History").id("toggle-history").build(handle)?;

            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&m_new_file)
                .item(&m_new_md)
                .item(&m_open_file)
                .item(&m_open_folder)
                .separator()
                .item(&m_save)
                .item(&m_save_all)
                .separator()
                .item(&m_export_pdf)
                .item(&m_import_latex)
                .separator()
                .item(&m_close_tab)
                .build()?;

            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(handle, "View")
                .item(&m_toggle_sidebar)
                .item(&m_toggle_preview)
                .item(&m_toggle_outline)
                .separator()
                .item(&m_toggle_writing)
                .separator()
                .item(&m_show_history)
                .item(&m_toggle_sidecar)
                .build()?;

            let m_settings = MenuItemBuilder::new("Settings…").id("open-settings").accelerator("CmdOrCtrl+,").build(handle)?;

            let app_menu = SubmenuBuilder::new(handle, "Type Studio")
                .about(Some(AboutMetadata::default()))
                .separator()
                .item(&m_settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let window_menu = SubmenuBuilder::new(handle, "Window")
                .minimize()
                .close_window()
                .build()?;
            let menu = MenuBuilder::new(handle)
                .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                // Every app-owned item simply forwards a `menu:<id>` event.
                match id {
                    "new-file" | "new-file-md" | "open-file" | "open-folder" | "save" | "save-all"
                    | "close-tab" | "export-pdf" | "import-latex" | "toggle-sidebar" | "toggle-preview"
                    | "toggle-outline" | "toggle-writing-mode" | "toggle-sidecar-preview"
                    | "toggle-history" | "open-settings" => {
                        let _ = app.emit(&format!("menu:{id}"), ());
                    }
                    _ => {}
                }
            });

            // Start Ollama if the user has configured it as their AI provider
            if let Ok(settings_str) = fs::read_to_string(settings_file_path(app.handle())?) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&settings_str) {
                    if v.get("aiProvider").and_then(|p| p.as_str()) == Some("ollama") {
                        let url = v
                            .get("ollamaUrl")
                            .and_then(|u| u.as_str())
                            .unwrap_or("http://localhost:11434")
                            .to_string();
                        tauri::async_runtime::spawn(ai::ensure_ollama_server(url));
                    }
                }
            }

            // Spawn compile actor
            tauri::async_runtime::spawn(compile_actor(compile_rx, world_arc, app.handle().clone()));

            // Spawn LSP bridge
            tauri::async_runtime::spawn(lsp_bridge::run_lsp_bridge(tinymist_path));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
