//! Extract a LaTeX template bundle (.zip) into a fresh temp directory.
//!
//! Safety: rejects absolute paths and `..` components (zip-slip). Skips
//! symlinks.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub fn extract_to_temp(zip_path: &Path) -> Result<PathBuf, String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("read zip: {e}"))?;

    let stem = zip_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("latex-template");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let out = std::env::temp_dir().join(format!("type-studio-latex-{stem}-{ts}"));
    fs::create_dir_all(&out).map_err(|e| format!("mkdir temp: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let Some(rel) = sanitize(entry.mangled_name().as_path()) else { continue };
        let dest = out.join(&rel);

        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| format!("mkdir {dest:?}: {e}"))?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
        }
        let mut out_file = fs::File::create(&dest).map_err(|e| format!("create {dest:?}: {e}"))?;
        io::copy(&mut entry, &mut out_file).map_err(|e| format!("write {dest:?}: {e}"))?;
    }

    Ok(out)
}

fn sanitize(p: &Path) -> Option<PathBuf> {
    let mut clean = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::Normal(x) => clean.push(x),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if clean.as_os_str().is_empty() { None } else { Some(clean) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_rejects_parent_traversal() {
        assert!(sanitize(Path::new("../evil.tex")).is_none());
        assert!(sanitize(Path::new("a/../b")).is_none());
    }

    #[test]
    fn sanitize_rejects_absolute() {
        assert!(sanitize(Path::new("/etc/passwd")).is_none());
    }

    #[test]
    fn sanitize_accepts_normal() {
        assert_eq!(
            sanitize(Path::new("sub/file.tex")).unwrap(),
            PathBuf::from("sub/file.tex")
        );
    }
}
