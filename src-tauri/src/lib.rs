mod converter;
mod lsp_bridge;
mod typst_world;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

// ── Managed state ──────────────────────────────────────────────────────────

pub struct AppState {
    pub tinymist_path: Mutex<String>,
    /// Persistent in-process Typst compiler world. Kept alive between compiles
    /// so comemo can reuse memoized intermediate results (incremental compilation).
    pub typst_world: Mutex<Option<typst_world::TypstWorld>>,
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

// ── compile_to_svg ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CompileResult {
    /// SVG strings for each page (index 0 = page 1)
    pub pages: Vec<String>,
    /// Non-fatal warnings from the compiler, if any
    pub warnings: String,
}

/// Compile a .typ file to SVG pages using the in-process typst compiler.
///
/// The world is kept alive in managed state so comemo reuses memoized
/// intermediate results — only changed parts of the document are recompiled.
/// `content` can be passed directly from the editor buffer to avoid a disk read+write
/// round-trip for live preview. When `None`, the file is read from disk.
#[tauri::command]
fn compile_to_svg(
    path: String,
    content: Option<String>,
    state: tauri::State<AppState>,
) -> Result<CompileResult, String> {
    let main_path = Path::new(&path);
    let content = match content {
        Some(c) => c,
        None => fs::read_to_string(main_path).map_err(|e| e.to_string())?,
    };

    let mut guard = state.typst_world.lock().unwrap();

    // (Re)initialize the world when first called or when the workspace root changes.
    let needs_init = match guard.as_ref() {
        None => true,
        Some(w) => w.root() != main_path.parent().unwrap_or_else(|| Path::new("/")),
    };
    if needs_init {
        *guard = Some(typst_world::TypstWorld::new(main_path)?);
    }

    guard.as_mut().unwrap().set_source(main_path, &content)?;

    // Compile — borrow ends before we drop the guard.
    let warned = typst::compile::<typst::layout::PagedDocument>(guard.as_ref().unwrap());
    drop(guard);

    // Evict stale memo-cache entries to prevent unbounded memory growth.
    comemo::evict(30);

    let warnings_str = warned
        .warnings
        .iter()
        .map(|w| w.message.to_string())
        .collect::<Vec<_>>()
        .join("\n");

    match warned.output {
        Ok(document) => {
            let pages = document
                .pages
                .iter()
                .map(|page| typst_svg::svg(page))
                .collect();
            Ok(CompileResult { pages, warnings: warnings_str })
        }
        Err(errors) => {
            let msg = errors
                .iter()
                .map(|e: &typst::diag::SourceDiagnostic| e.message.to_string())
                .collect::<Vec<_>>()
                .join("\n");
            Err(msg)
        }
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            tinymist_path: Mutex::new(String::new()),
            typst_world: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_bytes,
            write_file,
            create_file,
            create_dir,
            list_dir,
            compile_to_svg,
            export_pdf,
            save_snapshot,
            list_snapshots,
            rename_path,
            delete_path,
            reveal_in_finder,
            convert_to_typst,
        ])
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("resource dir")
                .to_string_lossy()
                .to_string();

            let tinymist_path = find_tinymist_path(&resource_dir);
            eprintln!("[setup] Using tinymist at: {tinymist_path}");

            // Store path in managed state for commands to use
            *app.state::<AppState>().tinymist_path.lock().unwrap() = tinymist_path.clone();

            // Spawn LSP bridge
            tauri::async_runtime::spawn(lsp_bridge::run_lsp_bridge(tinymist_path));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
