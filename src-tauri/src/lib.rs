mod lsp_bridge;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

// ── Managed state ──────────────────────────────────────────────────────────

pub struct AppState {
    pub tinymist_path: Mutex<String>,
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
    /// Non-fatal warnings/info from the compiler, if any
    pub warnings: String,
}

/// Compile a .typ file to SVG pages. Returns one SVG string per page.
#[tauri::command]
fn compile_to_svg(
    path: String,
    state: tauri::State<AppState>,
) -> Result<CompileResult, String> {
    let tinymist = resolve_tinymist(&state);

    // Temp directory unique per compile run (PID + nanosecond timestamp)
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let tmp_dir = std::env::temp_dir()
        .join(format!("type-studio-{}-{}", std::process::id(), nonce));
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

    // Output pattern: page-001.svg, page-002.svg, …
    let output_pattern = tmp_dir.join("page-{0p}.svg");
    let output_str = output_pattern.to_string_lossy().to_string();

    // Use the file's parent as the project root
    let root = Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string());

    // Run the compiler; capture warnings even on success.
    // IMPORTANT: CWD must be set to the file's parent so tinymist resolves
    // relative paths (imports, images, fonts) from the correct location.
    let mut cmd = Command::new(&tinymist);
    cmd.arg("compile")
        .arg("--format")
        .arg("svg")
        .arg(&path)
        .arg(&output_str);
    if let Some(ref r) = root {
        cmd.current_dir(r);
    }

    let out = cmd.output().map_err(|e| format!("Failed to run tinymist: {e}"))?;
    let warnings = String::from_utf8_lossy(&out.stderr).to_string();

    if !out.status.success() {
        // Clean up temp dir before returning error
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!("{warnings}\n{}", String::from_utf8_lossy(&out.stdout)).trim().to_string());
    }

    // Collect page SVGs in order
    let pages = collect_svg_pages(&tmp_dir)?;

    // Clean up
    let _ = fs::remove_dir_all(&tmp_dir);

    Ok(CompileResult { pages, warnings })
}

/// Read all page-NNN.svg files from the temp directory, sorted by page number.
fn collect_svg_pages(dir: &PathBuf) -> Result<Vec<String>, String> {
    let mut entries: Vec<(u32, String)> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Matches "page-001.svg", "page-1.svg", etc.
            if name.starts_with("page-") && name.ends_with(".svg") {
                let num_str = name
                    .strip_prefix("page-")?
                    .strip_suffix(".svg")?
                    .trim_start_matches('0');
                let n: u32 = num_str.parse().ok().unwrap_or(1);
                let content = fs::read_to_string(e.path()).ok()?;
                Some((n, content))
            } else {
                None
            }
        })
        .collect();

    if entries.is_empty() {
        // Single-page fallback: tinymist may write without the {p} suffix when
        // the document only has one page.
        let single = dir.join("page-.svg");
        if single.exists() {
            let content = fs::read_to_string(&single).map_err(|e| e.to_string())?;
            return Ok(vec![content]);
        }
        return Err("Compilation produced no SVG output".to_string());
    }

    entries.sort_by_key(|(n, _)| *n);
    Ok(entries.into_iter().map(|(_, svg)| svg).collect())
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
