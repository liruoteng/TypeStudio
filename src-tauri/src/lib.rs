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
#[tauri::command]
fn compile_to_svg(
    path: String,
    state: tauri::State<AppState>,
) -> Result<CompileResult, String> {
    let main_path = Path::new(&path);
    let content = fs::read_to_string(main_path).map_err(|e| e.to_string())?;

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
            write_file,
            create_file,
            create_dir,
            list_dir,
            compile_to_svg,
            export_pdf,
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
