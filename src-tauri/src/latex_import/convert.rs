//! Core LaTeX → Typst transform engine.
//!
//! Two-pass: (1) parse, (2) emit.  Metadata (\title, \author, \abstract) is
//! extracted and placed into the document preamble call; the body is rendered
//! inline.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::profiles::Profile;
use super::report;
use super::tokenizer::{tokenize, Token};
use super::ImportReport;

/// LaTeX command name → Typst replacement. `{0}`, `{1}` … are arg slots.
#[derive(Default, Clone)]
pub struct CommandMap(pub HashMap<String, String>);

/// LaTeX env name → (begin snippet, end snippet).
#[derive(Default, Clone)]
pub struct EnvMap(pub HashMap<String, (String, String)>);

// ── Public entry point ────────────────────────────────────────────────────

pub fn run(
    extracted: &Path,
    dest: &Path,
    profile: &dyn Profile,
) -> Result<ImportReport, String> {
    if dest.exists() {
        return Err(format!("Destination already exists: {}", dest.display()));
    }
    fs::create_dir_all(dest).map_err(|e| format!("mkdir dest: {e}"))?;

    // Copy figures / assets (anything that isn't .tex/.sty/.cls/.bib/.bst).
    let mut bib_file: Option<String> = None;
    copy_assets(extracted, dest, &mut bib_file)
        .map_err(|e| format!("copy assets: {e}"))?;

    // Find the main .tex file.
    let main_tex = find_main_tex(extracted)
        .ok_or_else(|| "No .tex file found in bundle.".to_string())?;

    let src = fs::read_to_string(&main_tex)
        .map_err(|e| format!("read {}: {e}", main_tex.display()))?;

    let tex_root = main_tex.parent().unwrap_or(Path::new("."));

    // Expand \input in the full source for metadata extraction, then extract body.
    let expanded_src = expand_inputs(&src, tex_root, 0);
    let body_src = body_of(&expanded_src);
    let tokens = tokenize(&body_src);

    // Build command + env maps (core ∪ profile overrides).
    let cmd_map = merged_command_map(profile);
    let env_map = merged_env_map(profile);

    let mut notes: Vec<String> = Vec::new();

    // Pre-pass: collect user-defined no-arg macros from the preamble.
    let user_macros = collect_user_macros(&expanded_src);
    let cmd_map = extend_with_user_macros(cmd_map, user_macros);

    let meta = extract_metadata(&expanded_src, &cmd_map);

    let body = emit_body(&tokens, &cmd_map, &env_map, &mut notes);

    // Write template.typ.
    let template_path = dest.join("template.typ");
    fs::write(&template_path, profile.typst_template())
        .map_err(|e| format!("write template.typ: {e}"))?;

    // Build main.typ.
    let mut main_src = String::new();
    main_src.push_str(profile.main_preamble());
    main_src.push_str("\n#show: doc => template(\n");
    main_src.push_str(&format!("  title: [{}],\n", meta.title));
    main_src.push_str(&format!("  authors: ({}),\n", format_authors_typst(&meta.authors)));
    if !meta.abstract_text.is_empty() {
        main_src.push_str(&format!("  abstract: [\n{}\n  ],\n", meta.abstract_text));
    }
    if let Some(ref b) = bib_file {
        main_src.push_str(&format!("  bibliography: bibliography(\"{b}\"),\n"));
    }
    main_src.push_str("  doc,\n)\n\n");
    main_src.push_str(&body);

    let main_path = dest.join("main.typ");
    fs::write(&main_path, &main_src).map_err(|e| format!("write main.typ: {e}"))?;

    let report_path = dest.join("CONVERSION_REPORT.md");
    fs::write(&report_path, report::build(profile.name(), &notes))
        .map_err(|e| format!("write report: {e}"))?;

    Ok(ImportReport {
        profile: Some(profile.name().to_string()),
        dest_dir: dest.to_string_lossy().to_string(),
        main_typ: main_path.to_string_lossy().to_string(),
        report_path: report_path.to_string_lossy().to_string(),
        notes,
    })
}

// ── Metadata extraction ───────────────────────────────────────────────────

/// Per-author data for the Typst template call.
pub struct AuthorEntry {
    pub name: String,
    pub affiliation: String,
    pub email: String,
}

struct DocMeta {
    title: String,
    authors: Vec<AuthorEntry>,
    abstract_text: String,
}

fn extract_metadata(src: &str, cmd_map: &CommandMap) -> DocMeta {
    let tokens = tokenize(src);
    let mut title = String::new();
    let mut authors: Vec<AuthorEntry> = Vec::new();
    let mut abstract_text = String::new();
    let mut in_abstract = false;

    for tok in &tokens {
        match tok {
            Token::Command { name, args, .. } if name == "title" => {
                if let Some(a) = args.first() {
                    title = emit_arg_with_map(a, cmd_map);
                }
            }
            Token::Command { name, args, .. } if name == "author" => {
                if let Some(a) = args.first() {
                    authors = parse_authors(a, cmd_map);
                }
            }
            Token::BeginEnv { name, .. } if name == "abstract" => {
                in_abstract = true;
            }
            Token::EndEnv(name) if name == "abstract" => {
                in_abstract = false;
            }
            tok if in_abstract => {
                abstract_text.push_str(&token_plain_text(tok));
            }
            _ => {}
        }
    }

    // Process abstract through emit_arg for proper formatting.
    let abstract_text = emit_arg_with_map(&abstract_text, cmd_map);

    DocMeta { title, authors, abstract_text }
}

/// Parse \author{...} block into individual AuthorEntry records.
/// CVPR format: name \\ affiliation \\ email, separated by \and.
fn parse_authors(raw: &str, cmd_map: &CommandMap) -> Vec<AuthorEntry> {
    raw.split("\\and")
        .map(|block| {
            // Split on \\ to get lines within each author block.
            let lines: Vec<String> = block
                .split("\\\\")
                .map(|l| emit_arg_with_map(l.trim(), cmd_map))
                .filter(|l| !l.trim().is_empty())
                .collect();
            let name = lines.first().cloned().unwrap_or_default();
            // Heuristic: last line that looks like an email is the email.
            let email = lines.iter().rev()
                .find(|l| l.contains('@'))
                .cloned()
                .unwrap_or_default();
            // Lines between name and email are affiliation.
            let affiliation = lines[1..]
                .iter()
                .filter(|l| !l.contains('@'))
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            AuthorEntry { name, affiliation, email }
        })
        .filter(|a| !a.name.is_empty())
        .collect()
}

fn token_plain_text(tok: &Token) -> String {
    match tok {
        Token::Text(s) => s.clone(),
        Token::Command { name, args, .. } => {
            // Unwrap simple formatting commands for plain-text extraction.
            match name.as_str() {
                "textbf" | "textit" | "emph" | "texttt" | "textrm" | "textsc" | "textup"
                | "text" => args.first().cloned().unwrap_or_default(),
                _ => args.first().cloned().unwrap_or_default(),
            }
        }
        _ => String::new(),
    }
}

// ── Body extraction from full source ─────────────────────────────────────

/// Extract everything between \begin{document} and \end{document}.
/// Call after expand_inputs so \input references are already inlined.
fn body_of(src: &str) -> String {
    let begin = "\\begin{document}";
    let end = "\\end{document}";
    if let Some(s) = src.find(begin) {
        let after = &src[s + begin.len()..];
        if let Some(e) = after.find(end) {
            return after[..e].replace("\\maketitle", "").trim().to_string();
        }
    }
    src.to_string()
}

/// Recursively expand \input{file} and \include{file} in `src`.
/// `depth` guards against infinite recursion.
fn expand_inputs(src: &str, root: &Path, depth: usize) -> String {
    if depth > 10 {
        return src.to_string();
    }
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while !rest.is_empty() {
        // Find next \input or \include.
        let input_pos = rest.find("\\input{").or_else(|| rest.find("\\include{"))
            .map(|p| (p, if rest[p..].starts_with("\\input{") { 7 } else { 9 }));

        let Some((pos, cmd_len)) = input_pos else {
            out.push_str(rest);
            break;
        };

        // Check it's not on a comment line.
        let line_start = rest[..pos].rfind('\n').map(|p| p + 1).unwrap_or(0);
        let line_prefix = rest[line_start..pos].trim_start();
        if line_prefix.starts_with('%') {
            // Skip to end of this line and continue.
            let end_of_line = rest[pos..].find('\n').map(|p| pos + p + 1).unwrap_or(rest.len());
            out.push_str(&rest[..end_of_line]);
            rest = &rest[end_of_line..];
            continue;
        }

        out.push_str(&rest[..pos]);
        rest = &rest[pos + cmd_len..];

        // Read the filename until '}'.
        let close = rest.find('}').unwrap_or(rest.len());
        let filename = rest[..close].trim().to_string();
        rest = if close < rest.len() { &rest[close + 1..] } else { "" };

        // Try to find and read the referenced file.
        let expanded = try_read_input(root, &filename)
            .map(|content| expand_inputs(&content, root, depth + 1))
            .unwrap_or_else(|| format!("/* TODO(latex): \\input{{{filename}}} — file not found */\n"));
        out.push_str(&expanded);
    }
    out
}

fn try_read_input(root: &Path, name: &str) -> Option<String> {
    // Try with and without .tex extension, relative to the .tex file's directory.
    let candidates = [
        root.join(name),
        root.join(format!("{name}.tex")),
        root.join(name).with_extension("tex"),
    ];
    for p in &candidates {
        if let Ok(txt) = fs::read_to_string(p) {
            return Some(txt);
        }
    }
    None
}

// ── Find primary .tex file ────────────────────────────────────────────────

fn find_main_tex(root: &Path) -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    collect_tex_files(root, &mut candidates);

    // Prefer files named "main.tex" or "paper.tex" that have a real \begin{document}.
    let priority_names = ["main.tex", "paper.tex", "manuscript.tex", "article.tex"];
    for name in priority_names {
        if let Some(p) = candidates.iter().find(|p| {
            p.file_name().and_then(|n| n.to_str()) == Some(name) && has_real_document(p)
        }) {
            return Some(p.clone());
        }
    }

    // Any file with a real \begin{document}.
    if let Some(p) = candidates.iter().find(|p| has_real_document(p)) {
        return Some(p.clone());
    }

    candidates.into_iter().next()
}

/// True if the file has `\begin{document}` on a non-comment line.
fn has_real_document(path: &Path) -> bool {
    let Ok(txt) = fs::read_to_string(path) else { return false };
    txt.lines().any(|line| {
        let trimmed = line.trim_start();
        !trimmed.starts_with('%') && trimmed.contains("\\begin{document}")
    })
}

fn collect_tex_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            dirs.push(p);
        } else if p.extension().and_then(|e| e.to_str()) == Some("tex") {
            files.push(p);
        }
    }
    files.sort();
    out.extend(files);
    dirs.sort();
    for d in dirs {
        collect_tex_files(&d, out);
    }
}

// ── Asset copy ────────────────────────────────────────────────────────────

static SKIP_EXTS: &[&str] = &["tex", "sty", "cls", "bst", "log", "aux", "toc", "out", "fls", "fdb_latexmk"];

fn copy_assets(
    src_root: &Path,
    dest_root: &Path,
    bib_file: &mut Option<String>,
) -> std::io::Result<()> {
    for entry in walkdir(src_root) {
        let rel = entry.strip_prefix(src_root).unwrap_or(&entry);
        let ext = entry.extension().and_then(|e| e.to_str()).unwrap_or("");
        if entry.is_dir() {
            fs::create_dir_all(dest_root.join(rel))?;
        } else if !SKIP_EXTS.contains(&ext) {
            if ext == "bib" {
                *bib_file = Some(rel.to_string_lossy().to_string());
            }
            let dest = dest_root.join(rel);
            if let Some(p) = dest.parent() {
                fs::create_dir_all(p)?;
            }
            fs::copy(&entry, &dest)?;
        }
    }
    Ok(())
}

fn walkdir(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                out.push(p.clone());
                out.extend(walkdir(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}

// ── Map assembly ──────────────────────────────────────────────────────────

fn core_command_map() -> CommandMap {
    let mut m = HashMap::new();

    // Inline formatting.
    m.insert("textbf".into(), "#strong[{0}]".into());
    m.insert("textit".into(), "#emph[{0}]".into());
    m.insert("emph".into(), "#emph[{0}]".into());
    m.insert("texttt".into(), "#raw(\"{0}\")".into());
    m.insert("textsc".into(), "#smallcaps[{0}]".into());
    m.insert("underline".into(), "#underline[{0}]".into());
    m.insert("textsuperscript".into(), "#super[{0}]".into());
    m.insert("textsubscript".into(), "#sub[{0}]".into());

    // Sectioning.
    m.insert("section".into(), "= {0}".into());
    m.insert("section*".into(), "= {0}".into());
    m.insert("subsection".into(), "== {0}".into());
    m.insert("subsection*".into(), "== {0}".into());
    m.insert("subsubsection".into(), "=== {0}".into());
    m.insert("subsubsection*".into(), "=== {0}".into());
    m.insert("paragraph".into(), "==== {0}".into());

    // Cross-references.
    m.insert("label".into(), "<{0}>".into());
    m.insert("ref".into(), "@{0}".into());
    m.insert("eqref".into(), "@{0}".into());
    m.insert("cref".into(), "@{0}".into());
    m.insert("Cref".into(), "@{0}".into());
    m.insert("cite".into(), "@{0}".into());
    m.insert("citep".into(), "@{0}".into());
    m.insert("citet".into(), "@{0}".into());
    m.insert("citealp".into(), "@{0}".into());

    // Misc.
    m.insert("footnote".into(), "#footnote[{0}]".into());
    m.insert("url".into(), "#link(\"{0}\")".into());
    m.insert("href".into(), "#link(\"{0}\")[{1}]".into());
    m.insert("noindent".into(), String::new());
    m.insert("newline".into(), "\\\n".into());
    m.insert("linebreak".into(), "\\\n".into());
    m.insert("newpage".into(), "#pagebreak()".into());
    m.insert("clearpage".into(), "#pagebreak()".into());
    m.insert("hspace".into(), "#h({0})".into());
    m.insert("vspace".into(), "#v({0})".into());
    m.insert("\\".into(), "\\\n".into()); // \\ newline
    m.insert("%".into(), "%".into());
    m.insert("&".into(), "&".into());
    m.insert("$".into(), "\\$".into());
    m.insert("#".into(), "\\#".into());
    m.insert("_".into(), "\\_".into());
    m.insert("{".into(), "\\{".into());
    m.insert("}".into(), "\\}".into());
    m.insert("~".into(), "#sym.tilde".into());

    // Spacing commands.
    m.insert(" ".into(), " ".into());   // \  (backslash-space)
    m.insert(",".into(), "#h(0.16em)".into());
    m.insert(";".into(), "#h(0.28em)".into());
    m.insert(":".into(), "#h(0.22em)".into());
    m.insert("!".into(), "#h(-0.16em)".into());

    // Legacy LaTeX2e font/style declarations (used as switches inside {}).
    // Map to empty — they appear inside {} groups as toggles; without full
    // group-scope tracking the safest output is to drop them silently.
    for sw in &["bf","it","em","rm","tt","sc","sl","sf","up","cal","mit",
                "tiny","scriptsize","footnotesize","small","normalsize",
                "large","Large","LARGE","huge","Huge"] {
        m.insert(sw.to_string(), String::new());
    }

    // Typography.
    m.insert("LaTeX".into(), "LaTeX".into());
    m.insert("TeX".into(), "TeX".into());
    m.insert("ie".into(), "i.e.,".into());
    m.insert("eg".into(), "e.g.,".into());
    m.insert("etc".into(), "etc.".into());
    m.insert("etal".into(), "et al.".into());
    m.insert("vs".into(), "vs.".into());

    // Booktabs table rules — strip them; Typst uses stroke rules instead.
    for rule in &["toprule","midrule","bottomrule","hline","cline"] {
        m.insert(rule.to_string(), String::new());
    }

    CommandMap(m)
}

fn core_env_map() -> EnvMap {
    let mut m = HashMap::new();
    m.insert("itemize".into(),    ("#list(\n".into(), ")".into()));
    m.insert("enumerate".into(),  ("#enum(\n".into(), ")".into()));
    m.insert("description".into(),("#terms(\n".into(), ")".into()));
    m.insert("quote".into(),      ("#quote[".into(), "]".into()));
    m.insert("quotation".into(),  ("#quote[".into(), "]".into()));
    m.insert("verbatim".into(),   ("```\n".into(), "\n```".into()));
    // Alignment envs: just pass body through (alignment handled by page settings).
    m.insert("center".into(),     ("#align(center)[\n".into(), "]\n".into()));
    m.insert("flushleft".into(),  ("#align(left)[\n".into(),   "]\n".into()));
    m.insert("flushright".into(), ("#align(right)[\n".into(),  "]\n".into()));
    EnvMap(m)
}

fn merged_command_map(profile: &dyn Profile) -> CommandMap {
    let mut m = core_command_map();
    for (k, v) in profile.command_overrides().0 {
        m.0.insert(k, v);
    }
    m
}

fn merged_env_map(profile: &dyn Profile) -> EnvMap {
    let mut m = core_env_map();
    for (k, v) in profile.env_overrides().0 {
        m.0.insert(k, v);
    }
    m
}

// ── Body emission ─────────────────────────────────────────────────────────

struct EmitState {
    in_figure: bool,
    in_table: bool,
    in_list: bool,
    list_stack: Vec<String>,
}

impl Default for EmitState {
    fn default() -> Self {
        Self {
            in_figure: false,
            in_table: false,
            in_list: false,
            list_stack: Vec::new(),
        }
    }
}

fn emit_body(
    tokens: &[Token],
    cmd_map: &CommandMap,
    env_map: &EnvMap,
    notes: &mut Vec<String>,
) -> String {
    let mut out = String::new();
    let mut state = EmitState::default();
    let mut i = 0;

    while i < tokens.len() {
        let tok = &tokens[i];
        match tok {
            Token::Text(s) => {
                out.push_str(&convert_text(s, &state));
            }
            Token::Comment(_) => {
                // Skip comments in body output.
            }
            Token::Math { display, body } => {
                let converted = convert_math(body);
                if *display {
                    out.push_str("\n$ ");
                    out.push_str(&converted);
                    out.push_str(" $\n");
                } else {
                    out.push('$');
                    out.push_str(&converted);
                    out.push('$');
                }
            }
            Token::BeginEnv { name, opt, args } => {
                let consumed = emit_env(
                    name, opt, args, tokens, i, cmd_map, env_map, notes, &mut state, &mut out,
                );
                i = consumed;
                continue;
            }
            Token::EndEnv(_) => {
                // Orphaned \end — already handled by emit_env; skip.
            }
            Token::Command { name, opt, args } => {
                emit_command(name, opt, args, cmd_map, notes, &mut out);
            }
        }
        i += 1;
    }

    out
}

fn emit_command(
    name: &str,
    opt: &[String],
    args: &[String],
    cmd_map: &CommandMap,
    notes: &mut Vec<String>,
    out: &mut String,
) {
    // Commands that we handle structurally elsewhere or that are preamble-only.
    if matches!(
        name,
        "title" | "author" | "date" | "maketitle" | "bibliographystyle"
            | "usepackage" | "documentclass" | "bibliography" | "thanks"
            | "newtheorem" | "theoremstyle" | "setcounter" | "pagenumbering"
            | "pagestyle" | "thispagestyle" | "setlength" | "addtolength"
            | "geometry" | "definecolor" | "colorlet" | "hypersetup"
            | "def" | "let" | "renewcommand" | "providecommand"
            | "input" | "include" | "includeonly"
            | "small" | "large" | "Large" | "LARGE" | "huge" | "Huge"
            | "normalsize" | "normalfont" | "selectfont"
            | "centering" | "raggedright" | "raggedleft"
            | "hfill" | "vfill" | "medskip" | "bigskip" | "smallskip"
            | "appendix" | "tableofcontents" | "listoffigures"
    ) {
        return;
    }

    // \newcommand: convert no-arg macros to Typst #let; skip parametric ones.
    if name == "newcommand" || name == "newcommand*" {
        if let (Some(macro_name), body) = (args.first(), args.get(1)) {
            let clean_name = macro_name.trim_start_matches('\\').trim();
            if opt.is_empty() {
                // No parameters → simple alias: #let name = [body]
                if let Some(b) = body {
                    out.push_str(&format!("// #let {} = [{}]\n", clean_name, b));
                }
            }
            // Parametric \newcommand[n]{...} → skip silently (too complex for v1)
        }
        return;
    }

    // Multi-key cite/ref commands: \cite{a,b,c} → @a @b @c
    if matches!(name, "cite" | "citep" | "citet" | "citealp" | "citealt"
                     | "cref" | "Cref" | "ref" | "eqref" | "autoref") {
        if let Some(keys) = args.first() {
            let refs: String = keys.split(',')
                .map(|k| format!("@{}", k.trim()))
                .collect::<Vec<_>>()
                .join(" ");
            out.push_str(&refs);
        }
        return;
    }

    if let Some(template) = cmd_map.0.get(name) {
        if template.is_empty() {
            return;
        }
        let filled = fill_template(template, args, opt);
        out.push_str(&filled);
    } else {
        // Unknown command — preserve as a TODO comment (deduplicated in report).
        let a = args.join("}{");
        let src = if args.is_empty() {
            format!("\\{name}")
        } else {
            format!("\\{name}{{{a}}}")
        };
        out.push_str(&format!("/* TODO(latex): {src} */"));
        let note = format!("Unmapped command: `\\{name}`");
        if !notes.contains(&note) {
            notes.push(note);
        }
    }
}

fn emit_env(
    name: &str,
    opt: &[String],
    _env_args: &[String],
    tokens: &[Token],
    start: usize,
    cmd_map: &CommandMap,
    env_map: &EnvMap,
    notes: &mut Vec<String>,
    state: &mut EmitState,
    out: &mut String,
) -> usize {
    // Collect everything between this \begin{name} and its matching \end{name}.
    let (inner, after) = collect_env_body(tokens, start, name);

    match name {
        // Ignore preamble-only environments in the body.
        "document" | "abstract" => {}

        "figure" | "figure*" => {
            state.in_figure = true;
            let body_tokens = tokenize(&inner);
            let (caption, label, img_path) = extract_figure_parts(&body_tokens);
            out.push_str("\n#figure(\n");
            out.push_str(&format!("  image(\"{img_path}\"),\n"));
            if !caption.is_empty() {
                out.push_str(&format!("  caption: [{}],\n", typst_escape(&caption)));
            }
            if !label.is_empty() {
                out.push_str(") ");
                out.push_str(&format!("<{label}>\n"));
            } else {
                out.push_str(")\n");
            }
            state.in_figure = false;
        }

        "table" | "table*" => {
            state.in_table = true;
            let body_tokens = tokenize(&inner);
            let (caption, label, tabular) = extract_table_parts(&body_tokens, notes);
            out.push_str("\n#figure(\n");
            if tabular.cols == 0 {
                out.push_str("  /* TODO(latex): tabular content */\n");
                notes.push(format!("Table env with complex tabular — needs manual conversion."));
            } else {
                out.push_str(&format!("  table(\n    columns: {},\n    {}\n  ),\n",
                    tabular.cols, tabular.cells));
            }
            if !caption.is_empty() {
                out.push_str(&format!("  caption: [{}],\n", typst_escape(&caption)));
            }
            out.push_str("  kind: table,\n");
            if !label.is_empty() {
                out.push_str(") ");
                out.push_str(&format!("<{label}>\n"));
            } else {
                out.push_str(")\n");
            }
            state.in_table = false;
        }

        "itemize" | "enumerate" | "description" => {
            let (begin_s, end_s) = env_map.0.get(name)
                .cloned()
                .unwrap_or_else(|| ("#list(\n".into(), ")".into()));
            let list_type = name.to_string();
            state.list_stack.push(list_type.clone());
            state.in_list = true;

            let body_tokens = tokenize(&inner);
            out.push_str("\n");
            out.push_str(&begin_s);
            // Split on \item tokens.
            let items = split_items(&body_tokens);
            for item in items {
                let item_body = emit_body(&item, cmd_map, env_map, notes);
                let item_body = item_body.trim().to_string();
                if !item_body.is_empty() {
                    out.push_str(&format!("  [{}],\n", item_body));
                }
            }
            out.push_str(&end_s);
            out.push('\n');

            state.list_stack.pop();
            state.in_list = !state.list_stack.is_empty();
        }

        "equation" | "equation*" | "align" | "align*" | "gather" | "gather*"
        | "multline" | "multline*" | "eqnarray" | "eqnarray*" => {
            out.push_str("\n$ ");
            out.push_str(&convert_math(&inner));
            out.push_str(" $\n");
            // For labelled equations, scan for \label.
            let body_tokens = tokenize(&inner);
            for t in &body_tokens {
                if let Token::Command { name: n, args, .. } = t {
                    if n == "label" {
                        if let Some(lbl) = args.first() {
                            out.push_str(&format!("<{lbl}>\n"));
                        }
                    }
                }
            }
        }

        "quote" | "quotation" => {
            out.push_str("\n#quote[\n");
            let body_tokens = tokenize(&inner);
            out.push_str(&emit_body(&body_tokens, cmd_map, env_map, notes));
            out.push_str("]\n");
        }

        "verbatim" | "lstlisting" | "minted" => {
            let lang = opt.first().map(|s| s.as_str()).unwrap_or("");
            if lang.is_empty() {
                out.push_str("\n```\n");
            } else {
                out.push_str(&format!("\n```{lang}\n"));
            }
            out.push_str(&inner);
            out.push_str("\n```\n");
        }

        _ => {
            // Unknown environment — recurse into body, wrap in comment.
            notes.push(format!("Unknown environment `{name}` — body preserved."));
            out.push_str(&format!("\n/* TODO(latex): \\begin{{{name}}} */\n"));
            let body_tokens = tokenize(&inner);
            out.push_str(&emit_body(&body_tokens, cmd_map, env_map, notes));
            out.push_str(&format!("\n/* TODO(latex): \\end{{{name}}} */\n"));
        }
    }

    after
}

// ── Environment body collection ───────────────────────────────────────────

/// Collect raw source between \begin{name} and the matching \end{name}.
/// Returns (inner_source, index-after-EndEnv).
fn collect_env_body(tokens: &[Token], start: usize, env: &str) -> (String, usize) {
    let mut depth = 1;
    let mut i = start + 1;
    let mut inner = String::new();

    while i < tokens.len() && depth > 0 {
        match &tokens[i] {
            Token::BeginEnv { name, opt, args } if name == env => {
                depth += 1;
                inner.push_str(&token_to_source(&tokens[i]));
            }
            Token::EndEnv(name) if name == env => {
                depth -= 1;
                if depth > 0 {
                    inner.push_str(&format!("\\end{{{name}}}"));
                }
            }
            t => inner.push_str(&token_to_source(t)),
        }
        i += 1;
    }

    (inner, i)
}

fn token_to_source(t: &Token) -> String {
    match t {
        Token::Text(s) => s.clone(),
        Token::Comment(s) => format!("%{s}\n"),
        Token::Math { display: true, body } => format!("\\[{body}\\]"),
        Token::Math { display: false, body } => format!("${body}$"),
        Token::Command { name, opt, args } => {
            let mut s = format!("\\{name}");
            for o in opt { s.push_str(&format!("[{o}]")); }
            for a in args { s.push_str(&format!("{{{a}}}")); }
            s
        }
        Token::BeginEnv { name, opt, args } => {
            let mut s = format!("\\begin{{{name}}}");
            for o in opt { s.push_str(&format!("[{o}]")); }
            for a in args { s.push_str(&format!("{{{a}}}")); }
            s
        }
        Token::EndEnv(name) => format!("\\end{{{name}}}"),
    }
}

// ── Figure / table helpers ────────────────────────────────────────────────

fn extract_figure_parts(tokens: &[Token]) -> (String, String, String) {
    let mut caption = String::new();
    let mut label = String::new();
    let mut img = String::new();

    for tok in tokens {
        match tok {
            Token::Command { name, args, .. } if name == "caption" => {
                caption = clean_ws(args.first().map(|s| s.as_str()).unwrap_or(""));
            }
            Token::Command { name, args, .. } if name == "label" => {
                label = args.first().cloned().unwrap_or_default();
            }
            Token::Command { name, opt, args } if name == "includegraphics" => {
                img = args.first().cloned().unwrap_or_default();
            }
            _ => {}
        }
    }
    (caption, label, img)
}

struct TabularResult {
    cols: usize,
    cells: String,
}

fn extract_table_parts(tokens: &[Token], notes: &mut Vec<String>) -> (String, String, TabularResult) {
    let mut caption = String::new();
    let mut label = String::new();
    let mut tabular = TabularResult { cols: 0, cells: String::new() };

    let mut i = 0;
    while i < tokens.len() {
        match &tokens[i] {
            Token::Command { name, args, .. } if name == "caption" => {
                caption = clean_ws(args.first().map(|s| s.as_str()).unwrap_or(""));
            }
            Token::Command { name, args, .. } if name == "label" => {
                label = args.first().cloned().unwrap_or_default();
            }
            Token::BeginEnv { name, args, .. } if name == "tabular" => {
                let col_spec = args.first().map(|s| s.as_str()).unwrap_or("");
                let ncols = col_spec.chars().filter(|c| matches!(c, 'l' | 'r' | 'c' | 'p')).count();
                tabular.cols = ncols.max(1);
                // Collect tabular body.
                let (body, _) = collect_env_body(tokens, i, "tabular");
                tabular.cells = convert_tabular_body(&body, notes);
            }
            _ => {}
        }
        i += 1;
    }

    (caption, label, tabular)
}

fn convert_tabular_body(body: &str, _notes: &mut Vec<String>) -> String {
    // Best-effort: split by \\ (row end) and & (cell sep).
    let rows = body.split("\\\\");
    let mut cells = String::new();
    for row in rows {
        let row = row.trim().trim_start_matches("\\hline").trim();
        if row.is_empty() { continue; }
        for cell in row.split('&') {
            let cell = cell.trim();
            cells.push_str(&format!("[{}], ", typst_escape(cell)));
        }
        cells.push('\n');
    }
    cells
}

// ── List helpers ──────────────────────────────────────────────────────────

fn split_items(tokens: &[Token]) -> Vec<Vec<Token>> {
    let mut items: Vec<Vec<Token>> = Vec::new();
    let mut current: Vec<Token> = Vec::new();

    for tok in tokens {
        match tok {
            Token::Command { name, .. } if name == "item" => {
                if !current.iter().all(|t| matches!(t, Token::Text(s) if s.trim().is_empty())) {
                    items.push(std::mem::take(&mut current));
                } else {
                    current.clear();
                }
            }
            t => current.push(t.clone()),
        }
    }
    if !current.iter().all(|t| matches!(t, Token::Text(s) if s.trim().is_empty())) {
        items.push(current);
    }
    items
}

// ── Math conversion ───────────────────────────────────────────────────────

fn convert_math(src: &str) -> String {
    // LaTeX math → Typst math. We do symbol substitution and \frac, \sqrt.
    // Unknown macros stay as-is; Typst is lenient about bare identifiers.
    let mut s = src.to_string();

    // Fractions: \frac{a}{b} → (a)/(b)
    s = replace_frac(&s);

    // Square root: \sqrt{x} → sqrt(x) ; \sqrt[n]{x} → root(n, x)
    s = replace_sqrt(&s);

    // Common symbol renames.
    let sym: &[(&str, &str)] = &[
        ("\\alpha", "alpha"), ("\\beta", "beta"), ("\\gamma", "gamma"),
        ("\\delta", "delta"), ("\\epsilon", "epsilon"), ("\\varepsilon", "epsilon.alt"),
        ("\\zeta", "zeta"), ("\\eta", "eta"), ("\\theta", "theta"),
        ("\\iota", "iota"), ("\\kappa", "kappa"), ("\\lambda", "lambda"),
        ("\\mu", "mu"), ("\\nu", "nu"), ("\\xi", "xi"),
        ("\\pi", "pi"), ("\\rho", "rho"), ("\\sigma", "sigma"),
        ("\\tau", "tau"), ("\\upsilon", "upsilon"), ("\\phi", "phi"),
        ("\\varphi", "phi.alt"), ("\\chi", "chi"), ("\\psi", "psi"),
        ("\\omega", "omega"),
        ("\\Gamma", "Gamma"), ("\\Delta", "Delta"), ("\\Theta", "Theta"),
        ("\\Lambda", "Lambda"), ("\\Xi", "Xi"), ("\\Pi", "Pi"),
        ("\\Sigma", "Sigma"), ("\\Upsilon", "Upsilon"), ("\\Phi", "Phi"),
        ("\\Psi", "Psi"), ("\\Omega", "Omega"),
        ("\\infty", "infinity"), ("\\partial", "diff"), ("\\nabla", "nabla"),
        ("\\sum", "sum"), ("\\prod", "product"), ("\\int", "integral"),
        ("\\oint", "integral.cont"), ("\\iint", "integral.double"),
        ("\\leq", "<="), ("\\geq", ">="), ("\\neq", "!="),
        ("\\approx", "approx"), ("\\equiv", "equiv"), ("\\sim", "tilde"),
        ("\\propto", "prop"), ("\\in", "in"), ("\\notin", "in.not"),
        ("\\subset", "subset"), ("\\supset", "supset"),
        ("\\cup", "union"), ("\\cap", "sect"),
        ("\\times", "times"), ("\\cdot", "dot.op"), ("\\ldots", "dots.h"),
        ("\\cdots", "dots.c"), ("\\vdots", "dots.v"), ("\\ddots", "dots.down"),
        ("\\to", "->"), ("\\rightarrow", "->"), ("\\leftarrow", "<-"),
        ("\\Rightarrow", "=>"), ("\\Leftarrow", "<="),
        ("\\leftrightarrow", "<->"), ("\\Leftrightarrow", "<=>"),
        ("\\forall", "forall"), ("\\exists", "exists"),
        ("\\langle", "angle.l"), ("\\rangle", "angle.r"),
        ("\\left(", "("), ("\\right)", ")"),
        ("\\left[", "["), ("\\right]", "]"),
        ("\\left\\{", "{"), ("\\right\\}", "}"),
        ("\\left|", "|"), ("\\right|", "|"),
        ("\\|", "||"), ("\\mathbb{R}", "RR"), ("\\mathbb{N}", "NN"),
        ("\\mathbb{Z}", "ZZ"), ("\\mathbb{Q}", "QQ"), ("\\mathbb{C}", "CC"),
        ("\\mathbf", "bold"), ("\\mathrm", "upright"), ("\\mathit", "italic"),
        ("\\hat", "hat"), ("\\bar", "overline"), ("\\tilde", "tilde"),
        ("\\vec", "arrow"), ("\\overline", "overline"), ("\\underline", "underline"),
        ("\\text{", "\""), // handled roughly below
        ("\\nonumber", ""), ("\\notag", ""),
        ("\\quad", "quad"), ("\\qquad", "quad quad"),
        ("\\,", " "), ("\\;", " "), ("\\:", " "), ("\\!", ""),
    ];

    // Apply longest-match-first by sorting by length desc.
    let mut sorted_sym: Vec<_> = sym.to_vec();
    sorted_sym.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    for (from, to) in &sorted_sym {
        s = s.replace(from, to);
    }

    // \text{...} → "..." already started above, close the quote.
    s = fix_text_macro(&s);

    s
}

/// Replace \frac{a}{b} with (a)/(b). Handles nested braces.
fn replace_frac(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(pos) = rest.find("\\frac") {
        out.push_str(&rest[..pos]);
        rest = &rest[pos + 5..];
        let chars: Vec<char> = rest.chars().collect();
        let mut i = 0;
        while i < chars.len() && chars[i] == ' ' { i += 1; }
        if chars.get(i) == Some(&'{') {
            if let Some((num, after_num)) = read_brace_group(&chars, i) {
                i = after_num;
                while i < chars.len() && chars[i] == ' ' { i += 1; }
                if chars.get(i) == Some(&'{') {
                    if let Some((den, after_den)) = read_brace_group(&chars, i) {
                        // Recurse so nested \frac inside num/den is also converted.
                        let num = replace_frac(&num);
                        let den = replace_frac(&den);
                        out.push_str(&format!("({num})/({den})"));
                        rest = &rest[after_den..];
                        continue;
                    }
                }
            }
        }
        out.push_str("\\frac");
    }
    out.push_str(rest);
    out
}

fn replace_sqrt(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(pos) = rest.find("\\sqrt") {
        out.push_str(&rest[..pos]);
        rest = &rest[pos + 5..];
        let chars: Vec<char> = rest.chars().collect();
        let mut i = 0;
        while i < chars.len() && chars[i] == ' ' { i += 1; }
        // Optional [n]
        let nth = if chars.get(i) == Some(&'[') {
            if let Some(end) = rest[i + 1..].find(']') {
                let n = rest[i + 1..i + 1 + end].to_string();
                i += 2 + end;
                Some(n)
            } else { None }
        } else { None };
        if chars.get(i) == Some(&'{') {
            if let Some((body, after)) = read_brace_group(&chars, i) {
                rest = &rest[after..];
                if let Some(n) = nth {
                    out.push_str(&format!("root({n}, {body})"));
                } else {
                    out.push_str(&format!("sqrt({body})"));
                }
                continue;
            }
        }
        out.push_str("\\sqrt");
    }
    out.push_str(rest);
    out
}

fn read_brace_group(chars: &[char], start: usize) -> Option<(String, usize)> {
    if chars.get(start)? != &'{' { return None; }
    let mut depth = 1;
    let mut i = start + 1;
    let body_start = i;
    while i < chars.len() {
        match chars[i] {
            '\\' if i + 1 < chars.len() => { i += 2; continue; }
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let s: String = chars[body_start..i].iter().collect();
                    return Some((s, i + 1));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// After symbol replacement, `\text{x}` becomes `"x` — close with `"`.
fn fix_text_macro(s: &str) -> String {
    // The symbol map replaced `\text{` with `"`. Now we find those and close the brace.
    // Simple approach: track unmatched `"` introduced from \text conversions.
    // Since this is rough, just do a direct search-and-replace.
    let mut out = String::new();
    let mut rest = s;
    while let Some(pos) = rest.find("\\text{") {
        out.push_str(&rest[..pos]);
        rest = &rest[pos + 6..];
        let chars: Vec<char> = rest.chars().collect();
        if let Some((body, after)) = read_brace_group(&std::iter::once('{').chain(chars.iter().copied()).collect::<Vec<_>>(), 0) {
            out.push('"');
            out.push_str(&body);
            out.push('"');
            rest = &rest[after - 1..]; // -1 because we prepended '{'
        } else {
            out.push_str("\\text{");
        }
    }
    out.push_str(rest);
    out
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn fill_template(template: &str, args: &[String], opt: &[String]) -> String {
    let mut out = template.to_string();
    for (i, arg) in args.iter().enumerate() {
        let converted = emit_arg(arg);
        out = out.replace(&format!("{{{i}}}"), &converted);
    }
    for (i, o) in opt.iter().enumerate() {
        out = out.replace(&format!("[{i}]"), o);
    }
    out
}

/// Convert a command argument using the core command map (no user macros).
fn emit_arg(src: &str) -> String {
    emit_arg_with_map(src, &core_command_map())
}

/// Convert a command argument using a given command map.
pub fn emit_arg_with_map(src: &str, cmd_map: &CommandMap) -> String {
    let tokens = tokenize(src);
    let mut out = String::new();
    let mut dummy = Vec::new();
    for tok in &tokens {
        match tok {
            Token::Text(s) => out.push_str(&typst_escape_inline(s)),
            Token::Command { name, opt, args } => {
                emit_command(name, opt, args, cmd_map, &mut dummy, &mut out);
            }
            Token::Math { display: false, body } => {
                out.push('$');
                out.push_str(&convert_math(body));
                out.push('$');
            }
            Token::Math { display: true, body } => {
                out.push_str("$ ");
                out.push_str(&convert_math(body));
                out.push_str(" $");
            }
            _ => {}
        }
    }
    out
}

// ── User macro collection ─────────────────────────────────────────────────

/// Scan the source for \def\X{body} and \newcommand{\X}{body} (no-arg)
/// and return them as a CommandMap to be merged into the core map.
fn collect_user_macros(src: &str) -> CommandMap {
    let tokens = tokenize(src);
    let mut m = HashMap::new();

    for tok in &tokens {
        match tok {
            // \newcommand{\name}{body}  (no optional [n] arg)
            Token::Command { name, opt, args }
                if (name == "newcommand" || name == "newcommand*") && opt.is_empty() =>
            {
                if let (Some(macro_name), Some(body)) = (args.first(), args.get(1)) {
                    let key = macro_name.trim_start_matches('\\').trim().to_string();
                    if !key.is_empty() {
                        m.insert(key, body.clone());
                    }
                }
            }
            // \def\name{body}  — tokenizer reads as Command{name:"def", args:["\name", "body"]}
            Token::Command { name, args, .. } if name == "def" => {
                if let (Some(macro_name), Some(body)) = (args.first(), args.get(1)) {
                    let key = macro_name.trim_start_matches('\\').trim().to_string();
                    if !key.is_empty() && !key.contains(' ') {
                        m.insert(key, body.clone());
                    }
                }
            }
            _ => {}
        }
    }
    CommandMap(m)
}

fn extend_with_user_macros(mut base: CommandMap, user: CommandMap) -> CommandMap {
    for (k, v) in user.0 {
        base.0.entry(k).or_insert(v);
    }
    base
}

fn convert_text(s: &str, _state: &EmitState) -> String {
    // Collapse runs of whitespace but preserve paragraph breaks (blank lines).
    let mut out = String::new();
    for line in s.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push('\n');
        } else {
            out.push_str(trimmed);
            out.push('\n');
        }
    }
    out
}

/// Escape Typst special characters in free text (outside math, outside markup).
pub fn typst_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('#', "\\#")
        .replace('@', "\\@")
}

fn typst_escape_inline(s: &str) -> String {
    // In inline/arg context — lighter escaping (no @, refs are handled separately).
    s.replace('#', "\\#")
}

fn clean_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn format_authors_typst(authors: &[AuthorEntry]) -> String {
    if authors.is_empty() {
        return String::new();
    }
    authors
        .iter()
        .map(|a| {
            let mut fields = format!("(name: \"{}\"", a.name.replace('"', "'"));
            if !a.affiliation.is_empty() {
                fields.push_str(&format!(", affiliation: \"{}\"", a.affiliation.replace('"', "'")));
            }
            if !a.email.is_empty() {
                fields.push_str(&format!(", email: \"{}\"", a.email.replace('"', "'")));
            }
            fields.push(')');
            fields
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd_map() -> CommandMap { merged_command_map(&crate::latex_import::profiles::cvpr::CvprProfile) }
    fn env_map()  -> EnvMap  { merged_env_map(&crate::latex_import::profiles::cvpr::CvprProfile) }

    fn emit(src: &str) -> String {
        let tokens = tokenize(src);
        emit_body(&tokens, &cmd_map(), &env_map(), &mut vec![])
    }

    // ── inline formatting ────────────────────────────────────────────────────

    #[test]
    fn textbf_converts() {
        assert!(emit("\\textbf{hello}").contains("#strong[hello]"));
    }

    #[test]
    fn textit_converts() {
        assert!(emit("\\textit{world}").contains("#emph[world]"));
    }

    #[test]
    fn emph_converts() {
        assert!(emit("\\emph{test}").contains("#emph[test]"));
    }

    #[test]
    fn nested_formatting() {
        let out = emit("\\textbf{very \\textit{important}}");
        assert!(out.contains("#strong["), "should have strong wrapper");
        assert!(out.contains("#emph[important]"), "should have emph wrapper inside");
    }

    // ── sectioning ───────────────────────────────────────────────────────────

    #[test]
    fn section_converts() {
        assert!(emit("\\section{Introduction}").contains("= Introduction"));
    }

    #[test]
    fn subsection_star_converts() {
        assert!(emit("\\subsection*{Related Work}").contains("== Related Work"));
    }

    // ── cross-references ─────────────────────────────────────────────────────

    #[test]
    fn label_converts() {
        assert!(emit("\\label{fig:cat}").contains("<fig:cat>"));
    }

    #[test]
    fn ref_converts() {
        assert!(emit("\\ref{fig:cat}").contains("@fig:cat"));
    }

    #[test]
    fn cite_converts() {
        assert!(emit("\\cite{lecun2015}").contains("@lecun2015"));
    }

    #[test]
    fn citep_converts() {
        assert!(emit("\\citep{lecun2015}").contains("@lecun2015"));
    }

    // ── math ─────────────────────────────────────────────────────────────────

    #[test]
    fn inline_math_passthrough() {
        let out = emit("$x^2$");
        assert!(out.contains("$x^2$"), "inline math should be wrapped in $");
    }

    #[test]
    fn display_math_passthrough() {
        let out = emit("\\[ a = b \\]");
        // Display math is emitted as $ ... $; body may have surrounding spaces.
        assert!(out.contains("$") && out.contains("a = b"), "display math should be wrapped: {out:?}");
    }

    #[test]
    fn frac_converts() {
        let out = convert_math("\\frac{a}{b}");
        assert_eq!(out, "(a)/(b)");
    }

    #[test]
    fn sqrt_converts() {
        assert_eq!(convert_math("\\sqrt{x}"), "sqrt(x)");
    }

    #[test]
    fn sqrt_nth_converts() {
        assert_eq!(convert_math("\\sqrt[3]{x}"), "root(3, x)");
    }

    #[test]
    fn greek_letters_convert() {
        let out = convert_math("\\alpha + \\beta");
        assert!(out.contains("alpha"), "alpha should convert");
        assert!(out.contains("beta"), "beta should convert");
    }

    #[test]
    fn nested_frac_converts() {
        let out = convert_math("\\frac{\\frac{a}{b}}{c}");
        assert!(out.contains("(a)/(b)"), "inner frac");
        assert!(out.contains(")/c") || out.contains("/(c)"), "outer denom");
    }

    #[test]
    fn equation_env_converts() {
        let out = emit("\\begin{equation}\na = b\n\\end{equation}");
        assert!(out.contains("$"), "should wrap in $ ... $");
    }

    // ── environments ─────────────────────────────────────────────────────────

    #[test]
    fn itemize_converts() {
        let out = emit("\\begin{itemize}\n\\item Foo\n\\item Bar\n\\end{itemize}");
        assert!(out.contains("#list("), "should emit #list");
        assert!(out.contains("[Foo]") || out.contains("Foo"), "items should appear");
    }

    #[test]
    fn footnote_converts() {
        let out = emit("\\footnote{see below}");
        assert!(out.contains("#footnote[see below]"));
    }

    #[test]
    fn url_converts() {
        let out = emit("\\url{https://example.com}");
        assert!(out.contains("#link(\"https://example.com\")"));
    }

    // ── unknown command passthrough ──────────────────────────────────────────

    #[test]
    fn unknown_command_becomes_todo_comment() {
        let out = emit("\\mystrangemacro{arg}");
        assert!(out.contains("TODO(latex)"), "unknown command should leave TODO comment");
        assert!(out.contains("mystrangemacro"), "command name preserved");
    }

    // ── metadata extraction ───────────────────────────────────────────────────

    #[test]
    fn extracts_title() {
        let src = "\\title{My Paper}\n\\begin{document}body\\end{document}";
        let meta = extract_metadata(src, &cmd_map());
        assert_eq!(meta.title, "My Paper");
    }

    #[test]
    fn extracts_multiple_authors() {
        let src = "\\author{Alice\\\\Uni A \\and Bob\\\\Uni B \\and Carol\\\\Uni C}\n\\begin{document}\\end{document}";
        let meta = extract_metadata(src, &cmd_map());
        assert_eq!(meta.authors.len(), 3);
        assert_eq!(meta.authors[0].name, "Alice");
    }

    #[test]
    fn cite_multi_ref() {
        let out = emit("\\cite{a,b,c}");
        assert!(out.contains("@a"), "first ref: {out}");
        assert!(out.contains("@b"), "second ref: {out}");
        assert!(out.contains("@c"), "third ref: {out}");
    }

    #[test]
    fn user_macro_expanded() {
        let src = "\\def\\etal{et al.}\n\\begin{document}Smith \\etal\\end{document}";
        let macros = collect_user_macros(src);
        let map = extend_with_user_macros(core_command_map(), macros);
        let body = body_of(&expand_inputs(src, std::path::Path::new("/"), 0));
        let tokens = tokenize(&body);
        let out = emit_body(&tokens, &map, &core_env_map(), &mut vec![]);
        assert!(out.contains("et al."), "user macro should be expanded: {out}");
    }

    #[test]
    fn backslash_space_emits_space() {
        // \ produces a space token; it should NOT become a TODO comment.
        let out = emit("hello\\ world");
        assert!(!out.contains("TODO"), "backslash-space must not become a TODO: {out}");
        assert!(out.contains("hello"), "text before should appear: {out}");
        assert!(out.contains("world"), "text after should appear: {out}");
    }

    #[test]
    fn body_of_strips_preamble() {
        let src = "\\documentclass{cvpr}\n\\usepackage{amsmath}\n\\begin{document}\nhello\n\\end{document}";
        assert_eq!(body_of(src).trim(), "hello");
    }

    // ── zip-slip rejection ────────────────────────────────────────────────────

    #[test]
    fn sanitize_rejects_absolute() {
        // sanitize contract verified in unzip tests
    }

    // ── \input expansion ─────────────────────────────────────────────────────

    #[test]
    fn expand_inputs_inline_file() {
        let dir = std::env::temp_dir().join("ts_expand_input");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("intro.tex"), "\\section{Introduction}\nHello world.").unwrap();

        let src = "Before\\input{intro}After";
        let out = expand_inputs(src, &dir, 0);
        assert!(out.contains("\\section{Introduction}"), "section should be inlined");
        assert!(out.contains("Hello world."), "text should be inlined");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn expand_inputs_skips_commented_input() {
        let dir = std::env::temp_dir().join("ts_expand_input_comment");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let src = "normal\n% \\input{hidden}\nrest";
        let out = expand_inputs(src, &dir, 0);
        // The commented \input should not be expanded (file doesn't exist either).
        assert!(out.contains("% \\input{hidden}"), "comment should be preserved");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_main_tex_prefers_main_tex() {
        let dir = std::env::temp_dir().join("ts_find_main");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sec")).unwrap();
        // preamble.tex has \begin{document} only in a comment
        fs::write(dir.join("preamble.tex"), "% example: \\begin{document}\n\\newcommand{\\x}{}").unwrap();
        fs::write(dir.join("main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\n\\end{document}").unwrap();
        fs::write(dir.join("sec").join("intro.tex"), "Hello.").unwrap();

        let found = find_main_tex(&dir).expect("should find main.tex");
        assert_eq!(found.file_name().unwrap(), "main.tex");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cvpr_style_full_conversion() {
        let dir = std::env::temp_dir().join("ts_cvpr_full");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sec")).unwrap();
        fs::write(dir.join("preamble.tex"), "% preamble\n\\newcommand{\\etal}{et al.}").unwrap();
        fs::write(dir.join("sec").join("intro.tex"), "\\section{Introduction}\nWe propose a method.").unwrap();
        fs::write(dir.join("main.tex"), r#"\documentclass[10pt]{article}
\usepackage[review]{cvpr}
\input{preamble}
\title{My CVPR Paper}
\author{Alice\and Bob}
\begin{document}
\maketitle
\input{sec/intro}
\end{document}"#).unwrap();

        let src = fs::read_to_string(dir.join("main.tex")).unwrap();
        let expanded = expand_inputs(&src, &dir, 0);
        let user_macros = collect_user_macros(&expanded);
        let map = extend_with_user_macros(core_command_map(), user_macros);
        let body = body_of(&expanded);
        let tokens = tokenize(&body);
        let mut notes = vec![];
        let out = emit_body(&tokens, &map, &core_env_map(), &mut notes);

        assert!(out.contains("= Introduction"), "section should be converted: {out:?}");
        assert!(out.contains("We propose a method."), "body text should appear: {out:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    // ── convert_tabular_body basic ────────────────────────────────────────────

    #[test]
    fn tabular_body_splits_cells() {
        let body = "a & b & c \\\\ d & e & f";
        let out = convert_tabular_body(body, &mut vec![]);
        assert!(out.contains("[a]"), "first cell present");
        assert!(out.contains("[b]"), "second cell present");
    }
}
