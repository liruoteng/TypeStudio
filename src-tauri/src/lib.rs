mod lsp_bridge;

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Read a file's contents as a UTF-8 string.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write a string to a file, creating it if it doesn't exist.
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// List the immediate children of a directory.
/// Directories are sorted first, then files, both alphabetically.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, list_dir])
        .setup(|app| {
            // Resolve the bundled Tinymist sidecar binary path
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("resource dir")
                .to_string_lossy()
                .to_string();

            // In dev mode the binary lives next to the executable; in release
            // it is bundled as a sidecar. We probe both locations.
            let candidates = vec![
                // Tauri sidecar convention: <resource_dir>/binaries/tinymist-<target>
                format!(
                    "{}/binaries/tinymist-{}",
                    resource_dir,
                    std::env::consts::ARCH.to_string()
                        + "-"
                        + std::env::consts::OS,
                ),
                // Dev fallback: project-relative path
                format!(
                    "{}/binaries/tinymist-{}",
                    std::env::current_dir()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    if cfg!(target_os = "macos") {
                        "aarch64-apple-darwin"
                    } else if cfg!(target_os = "windows") {
                        "x86_64-pc-windows-msvc"
                    } else {
                        "x86_64-unknown-linux-gnu"
                    }
                ),
                // Absolute fallback using TAURI_RESOURCE_DIR or system PATH
                "tinymist".to_string(),
            ];

            let tinymist_path = candidates
                .into_iter()
                .find(|p| std::path::Path::new(p).exists())
                .unwrap_or_else(|| "tinymist".to_string());

            eprintln!("[setup] Using tinymist at: {tinymist_path}");

            // Spawn the LSP bridge in a background tokio task
            tauri::async_runtime::spawn(lsp_bridge::run_lsp_bridge(tinymist_path));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
