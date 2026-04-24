mod converter;
mod lsp_bridge;
mod typst_world;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
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

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
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
                Ok(converter::markdown_to_typst(&content))
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
            guard.as_mut().unwrap().set_source(main_path, &req.content)?;

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

    run_tinymist_compile(
        &tinymist,
        &path,
        &dest_path,
        "pdf",
        root.as_deref(),
    )?;

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
        .manage(AppState {
            tinymist_path: Mutex::new(String::new()),
            compile_tx,
            typst_world: Arc::clone(&world_arc),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_bytes,
            write_file,
            create_file,
            create_temp_file,
            create_dir,
            list_dir,
            update_preview_source,
            trigger_preview_compile,
            export_pdf,
            save_snapshot,
            list_snapshots,
            rename_path,
            delete_path,
            reveal_in_finder,
            convert_to_typst,
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

            // Spawn compile actor
            tauri::async_runtime::spawn(compile_actor(compile_rx, world_arc, app.handle().clone()));

            // Spawn LSP bridge
            tauri::async_runtime::spawn(lsp_bridge::run_lsp_bridge(tinymist_path));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
