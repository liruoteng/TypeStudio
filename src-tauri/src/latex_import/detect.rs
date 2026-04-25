//! Detect which template profile a bundle belongs to.
//!
//! Strategy: scan every `.tex` file in the extracted bundle for
//! `\documentclass{...}` and `\usepackage{...}` signatures, then ask each
//! registered profile whether it matches.

use std::fs;
use std::path::Path;

use super::profiles::{all_profiles, Profile};

pub fn detect_profile(root: &Path) -> Option<Box<dyn Profile>> {
    let preamble = collect_preamble(root);
    all_profiles().into_iter().find(|p| p.matches(&preamble))
}

fn collect_preamble(root: &Path) -> String {
    let mut buf = String::new();
    walk(root, &mut |path| {
        if path.extension().and_then(|s| s.to_str()) == Some("tex") {
            if let Ok(text) = fs::read_to_string(path) {
                // Only the preamble matters for detection — stop at \begin{document}.
                let end = text.find("\\begin{document}").unwrap_or(text.len());
                buf.push_str(&text[..end]);
                buf.push('\n');
            }
        }
    });
    buf
}

fn walk(dir: &Path, f: &mut dyn FnMut(&Path)) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, f);
        } else {
            f(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detects_cvpr_from_documentclass() {
        let dir = std::env::temp_dir().join("ts_latex_detect_cvpr");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("main.tex"),
            "\\documentclass[10pt,twocolumn,letterpaper]{cvpr}\n\\usepackage{amsmath}\n\\begin{document}\n",
        )
        .unwrap();

        let p = detect_profile(&dir).expect("should detect");
        assert_eq!(p.name(), "cvpr");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn returns_none_for_unknown() {
        let dir = std::env::temp_dir().join("ts_latex_detect_none");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("main.tex"), "\\documentclass{article}\n").unwrap();

        assert!(detect_profile(&dir).is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}
