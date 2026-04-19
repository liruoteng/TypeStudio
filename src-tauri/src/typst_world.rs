use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::fs;

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::Library;

/// A minimal `typst::World` that compiles documents in-process.
///
/// Kept alive in Tauri's managed state so comemo can reuse memoized
/// intermediate results across successive compiles of the same document
/// (incremental compilation). Only the changed source file's hash changes,
/// so unchanged layout/typesetting work is served from comemo's cache.
pub struct TypstWorld {
    root: PathBuf,
    main_id: FileId,
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    /// In-memory source overrides — updated before each compile so typst
    /// reads the latest buffer without an extra disk round-trip.
    source_cache: HashMap<FileId, Source>,
}

impl TypstWorld {
    pub fn new(main_path: &Path) -> Result<Self, String> {
        let root = main_path
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .to_path_buf();

        let main_id = file_id(&root, main_path)?;
        let (book, fonts) = load_fonts();

        Ok(Self {
            root,
            main_id,
            library: LazyHash::new(Library::builder().build()),
            book: LazyHash::new(book),
            fonts,
            source_cache: HashMap::new(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Replace the in-memory content of `path` and make it the main file.
    pub fn set_source(&mut self, path: &Path, content: &str) -> Result<(), String> {
        let id = file_id(&self.root, path)?;
        self.main_id = id;
        self.source_cache.insert(id, Source::new(id, content.to_string()));
        Ok(())
    }
}

// ── typst::World impl ──────────────────────────────────────────────────────

impl typst::World for TypstWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if let Some(src) = self.source_cache.get(&id) {
            return Ok(src.clone());
        }
        let path = id_to_path(&self.root, id)?;
        let text = fs::read_to_string(&path).map_err(|e| io_err(e, &path))?;
        Ok(Source::new(id, text))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        let path = id_to_path(&self.root, id)?;
        fs::read(&path)
            .map(|v| Bytes::new(v))
            .map_err(|e| io_err(e, &path))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64
            + offset.unwrap_or(0) * 3600;
        date_from_unix(secs)
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn file_id(root: &Path, path: &Path) -> Result<FileId, String> {
    let rel = path.strip_prefix(root).map_err(|_| {
        format!(
            "{} is outside workspace root {}",
            path.display(),
            root.display()
        )
    })?;
    Ok(FileId::new(None, VirtualPath::new(rel)))
}

fn id_to_path(root: &Path, id: FileId) -> FileResult<PathBuf> {
    if id.package().is_some() {
        return Err(FileError::Other(Some("typst packages not supported".into())));
    }
    id.vpath()
        .resolve(root)
        .ok_or_else(|| FileError::Other(Some("path outside workspace root".into())))
}

fn io_err(err: io::Error, path: &Path) -> FileError {
    match err.kind() {
        io::ErrorKind::NotFound => FileError::NotFound(path.into()),
        io::ErrorKind::PermissionDenied => FileError::AccessDenied,
        _ => FileError::Other(Some(format!("{err}").into())),
    }
}

fn date_from_unix(secs: i64) -> Option<Datetime> {
    let mut days = secs / 86400;
    let mut year = 1970i32;
    loop {
        let n = if is_leap(year) { 366i64 } else { 365i64 };
        if days < n {
            break;
        }
        days -= n;
        year += 1;
    }
    let month_days: [i64; 12] = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u8;
    for &m in &month_days {
        if days < m {
            break;
        }
        days -= m;
        month += 1;
    }
    Datetime::from_ymd(year, month, (days + 1) as u8)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

// ── Font loading ───────────────────────────────────────────────────────────

fn load_fonts() -> (FontBook, Vec<Font>) {
    let mut book = FontBook::new();
    let mut fonts = Vec::new();

    // Embedded fonts bundled with typst (New Computer Modern, etc.)
    for data in typst_assets::fonts() {
        let bytes = Bytes::new(data);
        for font in Font::iter(bytes) {
            book.push(font.info().clone());
            fonts.push(font);
        }
    }

    // System fonts — best effort, failures are silently ignored
    for dir in [
        "/System/Library/Fonts",
        "/System/Library/Fonts/Supplemental",
        "/Library/Fonts",
    ] {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if matches!(
                    p.extension().and_then(|e| e.to_str()),
                    Some("ttf" | "otf" | "ttc" | "otc")
                ) {
                    if let Ok(data) = fs::read(&p) {
                        for font in Font::iter(Bytes::new(data)) {
                            book.push(font.info().clone());
                            fonts.push(font);
                        }
                    }
                }
            }
        }
    }

    (book, fonts)
}
