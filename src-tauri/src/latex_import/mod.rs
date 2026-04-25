//! LaTeX template import: convert a zipped LaTeX template bundle into a
//! Typst workspace. See design doc in chat / TODOS.md.
//!
//! Entry point: `import_latex_template(zip_path, dest_dir)`.

pub mod convert;
pub mod detect;
pub mod profiles;
pub mod report;
pub mod tokenizer;
pub mod unzip;

use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
pub struct ImportReport {
    /// Profile used (e.g. "cvpr"). None if no profile matched.
    pub profile: Option<String>,
    /// Root of the new Typst workspace created on disk.
    pub dest_dir: String,
    /// Path to main.typ the user should open.
    pub main_typ: String,
    /// Path to CONVERSION_REPORT.md.
    pub report_path: String,
    /// Human-readable notes (unmapped commands, skipped files, warnings).
    pub notes: Vec<String>,
}

/// Tauri command: extract a LaTeX template zip, detect its profile, and write
/// a new Typst workspace into `dest_dir`.
///
/// v1: CVPR profile only. Unknown bundles fall through with a diagnostic
/// message and no output.
#[tauri::command]
pub fn import_latex_template(
    zip_path: String,
    dest_dir: String,
) -> Result<ImportReport, String> {
    let zip = PathBuf::from(&zip_path);
    let dest = PathBuf::from(&dest_dir);

    let extracted = unzip::extract_to_temp(&zip)?;
    let profile = detect::detect_profile(&extracted)
        .ok_or_else(|| "No supported LaTeX template profile detected in bundle.".to_string())?;

    convert::run(&extracted, &dest, profile.as_ref())
}
