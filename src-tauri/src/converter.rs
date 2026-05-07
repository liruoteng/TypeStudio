use std::collections::HashMap;

// ── Front matter ─────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct FrontMatter {
    pub title:     Option<String>,
    pub authors:   Vec<String>,
    pub template:  Option<String>,
    pub abstract_text: Option<String>,
    pub bibliography: Option<String>,
}

/// Strip YAML front matter from `content` (the `---…---` block at the top).
/// Returns `(body, front_matter_yaml)`. If no front matter, body == content.
pub fn strip_front_matter(content: &str) -> (&str, Option<&str>) {
    if !content.starts_with("---\n") && !content.starts_with("---\r\n") {
        return (content, None);
    }
    let after_open = if content.starts_with("---\r\n") { &content[5..] } else { &content[4..] };
    // Find the closing `---` line
    for (off, _) in after_open.match_indices("\n---") {
        let rest = &after_open[off + 4..];
        if rest.starts_with('\n') || rest.starts_with('\r') || rest.is_empty() {
            let yaml = &after_open[..off];
            let body_start = off + 4 + if rest.starts_with("\r\n") { 2 } else if rest.starts_with('\n') { 1 } else { 0 };
            return (&after_open[body_start..], Some(yaml));
        }
    }
    (content, None)
}

/// Parse the YAML front matter string into a `FrontMatter`.
/// Best-effort key=value parser — no external YAML crate required.
pub fn parse_front_matter(yaml: &str) -> FrontMatter {
    let mut fm = FrontMatter::default();
    let mut in_authors = false;
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { in_authors = false; continue; }
        if trimmed.starts_with('-') && in_authors {
            let author = trimmed.trim_start_matches('-').trim().trim_matches('"').trim_matches('\'').to_string();
            if !author.is_empty() { fm.authors.push(author); }
            continue;
        }
        in_authors = false;
        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim().to_lowercase();
            let val = val.trim().trim_matches('"').trim_matches('\'').to_string();
            match key.as_str() {
                "title"    => fm.title = Some(val),
                "template" => fm.template = Some(val),
                "abstract" => fm.abstract_text = if val.is_empty() { None } else { Some(val) },
                "bibliography" => fm.bibliography = Some(val),
                "authors" | "author" => {
                    if !val.is_empty() {
                        fm.authors.push(val);
                    } else {
                        in_authors = true;
                    }
                }
                _ => {}
            }
        }
    }
    fm
}

/// Build a Typst document preamble from the parsed front matter.
pub fn build_preamble(fm: &FrontMatter) -> String {
    let template = fm.template.as_deref().unwrap_or("default");
    match template {
        "ieee" => build_ieee_preamble(fm),
        "acm"  => build_acm_preamble(fm),
        "neurips" => build_neurips_preamble(fm),
        _ => build_default_preamble(fm),
    }
}

fn quote_typst(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn build_default_preamble(fm: &FrontMatter) -> String {
    // Only emit a preamble when the document has metadata to display.
    if fm.title.is_none() && fm.authors.is_empty() && fm.abstract_text.is_none() {
        return String::new();
    }
    let mut out = String::new();
    out.push_str("#set page(margin: (x: 2.5cm, y: 2.5cm))\n");
    out.push_str("#set text(font: \"Linux Libertine\", size: 11pt)\n");
    out.push_str("#set par(justify: true)\n");
    if let Some(title) = &fm.title {
        out.push_str(&format!("#align(center, text(size: 18pt, weight: \"bold\")[{}])\n\n", quote_typst(title)));
    }
    if !fm.authors.is_empty() {
        let joined = fm.authors.iter().map(|a| quote_typst(a)).collect::<Vec<_>>().join(", ");
        out.push_str(&format!("#align(center)[{}]\n\n", joined));
    }
    if let Some(abs) = &fm.abstract_text {
        out.push_str(&format!("#block(inset: (x: 1.5cm))[*Abstract.* {}]\n\n", quote_typst(abs)));
    }
    out
}

fn build_ieee_preamble(fm: &FrontMatter) -> String {
    let mut out = String::new();
    out.push_str("#set page(columns: 2, margin: (x: 1.5cm, y: 2cm))\n");
    out.push_str("#set text(font: \"Times New Roman\", size: 10pt)\n");
    out.push_str("#set par(justify: true)\n");
    if let Some(title) = &fm.title {
        out.push_str(&format!("#place(top + center, scope: \"parent\", float: true,\n  text(size: 14pt, weight: \"bold\")[{}]\n)\n\n", quote_typst(title)));
    }
    if !fm.authors.is_empty() {
        let joined = fm.authors.iter().map(|a| quote_typst(a)).collect::<Vec<_>>().join(" · ");
        out.push_str(&format!("#place(top + center, scope: \"parent\", float: true,\n  [{}]\n)\n\n", joined));
    }
    if let Some(abs) = &fm.abstract_text {
        out.push_str(&format!("#place(top, scope: \"parent\", float: true,\n  block(width: 100%, inset: 4pt)[\n    *Abstract*---{}\n  ]\n)\n\n", quote_typst(abs)));
    }
    out
}

fn build_acm_preamble(fm: &FrontMatter) -> String {
    let mut out = String::new();
    out.push_str("#set page(margin: (x: 2cm, y: 2.5cm))\n");
    out.push_str("#set text(font: \"Linux Libertine\", size: 10.5pt)\n");
    out.push_str("#set par(justify: true)\n");
    if let Some(title) = &fm.title {
        out.push_str(&format!("#align(center, text(size: 16pt, weight: \"bold\")[{}])\n\n", quote_typst(title)));
    }
    if !fm.authors.is_empty() {
        let joined = fm.authors.iter().map(|a| quote_typst(a)).collect::<Vec<_>>().join(" and ");
        out.push_str(&format!("#align(center)[{}]\n\n", joined));
    }
    if let Some(abs) = &fm.abstract_text {
        out.push_str(&format!("#block(stroke: (left: 2pt + gray), inset: (left: 8pt))[*ABSTRACT.* {}]\n\n", quote_typst(abs)));
    }
    out
}

fn build_neurips_preamble(fm: &FrontMatter) -> String {
    let mut out = String::new();
    out.push_str("#set page(margin: (x: 2cm, y: 2.5cm))\n");
    out.push_str("#set text(font: \"Linux Libertine\", size: 10pt)\n");
    out.push_str("#set par(justify: true)\n");
    if let Some(title) = &fm.title {
        out.push_str(&format!("#align(center, text(size: 14pt, weight: \"bold\")[{}])\n\n", quote_typst(title)));
    }
    if !fm.authors.is_empty() {
        let joined = fm.authors.iter().map(|a| quote_typst(a)).collect::<Vec<_>>().join(" · ");
        out.push_str(&format!("#align(center)[{}]\n\n", joined));
    }
    if let Some(abs) = &fm.abstract_text {
        out.push_str("#align(center)[*Abstract*]\n");
        out.push_str(&format!("{}\n\n", quote_typst(abs)));
    }
    out
}

/// Markdown → Typst conversion (built-in, no external dependencies).
/// Handles: headings, bold, italic, code, links, images, lists, blockquotes, HR, tables,
///          `[@cite]` citations, inline math `$...$`, and block math `$$...$$`.
pub fn markdown_to_typst(content: &str) -> (String, Vec<String>) {
    let (body, _) = strip_front_matter(content);
    let expanded = expand_references(body);
    let content = expanded.as_str();
    let mut out = String::with_capacity(content.len());
    let mut warnings: Vec<String> = Vec::new();
    let mut in_code_block = false;
    let mut code_lang = String::new();
    let mut code_buf: Vec<&str> = Vec::new();
    let mut prev_blank = true;
    let mut typst_block_count: u32 = 0;
    let mut html_warned = false;

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // ── Block math: $$...$$  ─────────────────────────────────────────────
        if line.trim() == "$$" && !in_code_block {
            let mut math_lines: Vec<&str> = Vec::new();
            i += 1;
            while i < lines.len() && lines[i].trim() != "$$" {
                math_lines.push(lines[i]);
                i += 1;
            }
            if i < lines.len() { i += 1; } // skip closing $$
            let expr = math_lines.join("\n");
            out.push_str(&format!("$ {} $\n\n", expr.trim()));
            prev_blank = true;
            continue;
        }
        // Single-line $$expr$$
        if let Some(rest) = line.trim().strip_prefix("$$").and_then(|s| s.strip_suffix("$$")) {
            if !in_code_block {
                out.push_str(&format!("$ {} $\n\n", rest.trim()));
                prev_blank = true;
                i += 1;
                continue;
            }
        }

        // ── Fenced code blocks ────────────────────────────────────────────────
        if let Some(rest) = line.strip_prefix("```").or_else(|| line.strip_prefix("~~~")) {
            if in_code_block {
                let body = code_buf.join("\n");
                if code_lang == "typst" {
                    // Raw Typst passthrough — emit verbatim
                    out.push_str(&body);
                    out.push_str("\n\n");
                    typst_block_count += 1;
                } else if code_lang.is_empty() {
                    out.push_str(&format!("```\n{body}\n```\n"));
                } else {
                    out.push_str(&format!("```{}\n{body}\n```\n", code_lang));
                }
                code_buf.clear();
                code_lang.clear();
                in_code_block = false;
            } else {
                code_lang = rest.trim().to_string();
                in_code_block = true;
            }
            i += 1;
            continue;
        }
        if in_code_block {
            code_buf.push(line);
            i += 1;
            continue;
        }

        // ── Blank line ────────────────────────────────────────────────────────
        if line.trim().is_empty() {
            out.push('\n');
            prev_blank = true;
            i += 1;
            continue;
        }

        // ── ATX headings ──────────────────────────────────────────────────────
        let heading = parse_heading(line);
        if let Some((level, text)) = heading {
            let marks: String = "=".repeat(level);
            out.push_str(&format!("{marks} {}\n", inline(text)));
            prev_blank = false;
            i += 1;
            continue;
        }

        // ── Setext headings (underline style) ─────────────────────────────────
        if i + 1 < lines.len() {
            let next = lines[i + 1];
            if !line.trim().is_empty() && (next.starts_with("===") || next.starts_with("---")) {
                let level = if next.starts_with("===") { 1 } else { 2 };
                let marks: String = "=".repeat(level);
                out.push_str(&format!("{marks} {}\n", inline(line)));
                prev_blank = false;
                i += 2;
                continue;
            }
        }

        // ── Horizontal rules ──────────────────────────────────────────────────
        let trimmed = line.trim();
        if matches!(trimmed, "---" | "***" | "___")
            || (trimmed.chars().all(|c| c == '-') && trimmed.len() >= 3)
            || (trimmed.chars().all(|c| c == '*') && trimmed.len() >= 3)
        {
            out.push_str("#line(length: 100%)\n\n");
            prev_blank = true;
            i += 1;
            continue;
        }

        // ── Unordered list ────────────────────────────────────────────────────
        if let Some(rest) = line
            .strip_prefix("- ")
            .or_else(|| line.strip_prefix("* "))
            .or_else(|| line.strip_prefix("+ "))
        {
            if prev_blank { }
            if let Some(content) = rest.strip_prefix("[ ] ") {
                out.push_str(&format!("- ☐ {}\n", inline(content)));
            } else if let Some(content) = rest.strip_prefix("[x] ").or_else(|| rest.strip_prefix("[X] ")) {
                out.push_str(&format!("- ☑ {}\n", inline(content)));
            } else {
                out.push_str(&format!("- {}\n", inline(rest)));
            }
            prev_blank = false;
            i += 1;
            continue;
        }

        // ── Ordered list ──────────────────────────────────────────────────────
        if let Some(rest) = strip_ordered_list(line) {
            out.push_str(&format!("+ {}\n", inline(rest)));
            prev_blank = false;
            i += 1;
            continue;
        }

        // ── Blockquote ────────────────────────────────────────────────────────
        if let Some(rest) = line.strip_prefix("> ").or_else(|| line.strip_prefix(">")) {
            out.push_str(&format!("#quote[{}]\n\n", inline(rest.trim())));
            prev_blank = true;
            i += 1;
            continue;
        }

        // ── Markdown table ────────────────────────────────────────────────────
        if line.contains('|') && i + 1 < lines.len() && lines[i + 1].contains("---") {
            let (rows, consumed) = collect_table(&lines, i);
            out.push_str(&render_table(&rows));
            i += consumed;
            prev_blank = false;
            continue;
        }

        // ── HTML block detection (warn once) ─────────────────────────────────
        if !html_warned {
            let t = line.trim();
            let looks_like_html = t.starts_with('<')
                && t.len() > 1
                && t.chars().nth(1).map(|c| c.is_alphabetic() || c == '/').unwrap_or(false);
            if looks_like_html {
                warnings.push(
                    "HTML elements detected — they will appear as literal text in the PDF. \
                     Use a ```typst block for raw Typst instead.".to_string(),
                );
                html_warned = true;
            }
        }

        // ── Regular paragraph line ────────────────────────────────────────────
        out.push_str(&inline(line));
        out.push('\n');
        prev_blank = false;
        i += 1;
    }

    // Flush unclosed code block
    if in_code_block && !code_buf.is_empty() {
        let body = code_buf.join("\n");
        if code_lang == "typst" {
            out.push_str(&code_buf.join("\n"));
            out.push_str("\n\n");
            typst_block_count += 1;
        } else {
            out.push_str(&format!("```{}\n{body}\n```\n", code_lang));
        }
    }

    if typst_block_count > 0 {
        warnings.push(format!(
            "{} raw Typst block{} — rendered in PDF only, not visible in the editor.",
            typst_block_count,
            if typst_block_count == 1 { "" } else { "s" }
        ));
    }

    (out, warnings)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn parse_heading(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim_start_matches('#');
    let level = line.len() - trimmed.len();
    if level == 0 || level > 6 { return None; }
    if !trimmed.starts_with(' ') && !trimmed.is_empty() { return None; }
    Some((level, trimmed.trim()))
}

fn strip_ordered_list(line: &str) -> Option<&str> {
    let bytes = line.as_bytes();
    let mut j = 0;
    while j < bytes.len() && bytes[j].is_ascii_digit() { j += 1; }
    if j == 0 || j >= bytes.len() { return None; }
    if bytes[j] != b'.' && bytes[j] != b')' { return None; }
    if j + 1 < bytes.len() && bytes[j + 1] == b' ' {
        Some(&line[j + 2..])
    } else {
        None
    }
}

fn collect_table<'a>(lines: &[&'a str], start: usize) -> (Vec<Vec<&'a str>>, usize) {
    let mut rows: Vec<Vec<&str>> = Vec::new();
    let mut i = start;
    while i < lines.len() && (lines[i].contains('|') || lines[i].contains('-')) {
        let line = lines[i];
        if line.trim().chars().all(|c| c == '|' || c == '-' || c == ':' || c == ' ') {
            i += 1;
            continue;
        }
        let row: Vec<&str> = line
            .trim()
            .trim_matches('|')
            .split('|')
            .map(|c| c.trim())
            .collect();
        rows.push(row);
        i += 1;
    }
    (rows, i - start)
}

fn render_table(rows: &[Vec<&str>]) -> String {
    if rows.is_empty() { return String::new(); }
    let cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut out = String::from("#table(\n  columns: ");
    out.push_str(&cols.to_string());
    out.push_str(",\n");
    for row in rows {
        for cell in row {
            out.push_str(&format!("  [{}],\n", inline(cell)));
        }
    }
    out.push_str(")\n\n");
    out
}

/// Convert inline Markdown markup to Typst equivalents.
fn inline(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut result = String::with_capacity(text.len());
    let mut i = 0;

    while i < chars.len() {
        // Escape Typst special characters that aren't part of markup
        // (we'll convert markup first, then leave the rest)

        // Inline code: `...`
        if chars[i] == '`' {
            if let Some(end) = find_closing_char(&chars, i + 1, '`') {
                result.push('`');
                for c in &chars[i + 1..end] { result.push(*c); }
                result.push('`');
                i = end + 1;
                continue;
            }
        }

        // Inline math: $...$ — pass through without processing contents
        if chars[i] == '$' {
            let start = i + 1;
            if let Some(end) = find_closing_char(&chars, start, '$') {
                if end > start {
                    let math: String = chars[start..end].iter().collect();
                    result.push('$');
                    result.push_str(&math);
                    result.push('$');
                    i = end + 1;
                    continue;
                }
            }
        }

        // Citation: [@key] or [@key1; @key2] → @key / @key @key2
        if chars[i] == '[' && i + 1 < chars.len() && chars[i + 1] == '@' {
            if let Some(close) = find_closing_char(&chars, i + 1, ']') {
                let inside: String = chars[i + 1..close].iter().collect();
                let keys: Vec<String> = inside
                    .split(';')
                    .map(|k| k.trim().trim_start_matches('@').trim().to_string())
                    .filter(|k| !k.is_empty())
                    .collect();
                if !keys.is_empty() {
                    let cites = keys.iter().map(|k| format!("@{k}")).collect::<Vec<_>>().join(" ");
                    result.push_str(&cites);
                    i = close + 1;
                    continue;
                }
            }
        }

        // Image: ![alt](url)
        if chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            if let Some((alt, url, end)) = parse_link(&chars, i + 1) {
                if url.starts_with("http://") || url.starts_with("https://") {
                    // Typst image() only accepts local paths; render as a link instead
                    result.push_str(&format!("#link(\"{url}\")[{alt}]"));
                } else {
                    result.push_str(&format!("#image(\"{url}\", alt: \"{alt}\")"));
                }
                i = end;
                continue;
            }
        }

        // Link: [text](url)
        if chars[i] == '[' {
            if let Some((text_inner, url, end)) = parse_link(&chars, i) {
                let inner_text = inline(&text_inner);
                result.push_str(&format!("#link(\"{url}\")[{inner_text}]"));
                i = end;
                continue;
            }
        }

        // Bold: **text** or __text__
        let bold_marker: Option<char> = if i + 1 < chars.len() {
            if chars[i] == '*' && chars[i + 1] == '*' { Some('*') }
            else if chars[i] == '_' && chars[i + 1] == '_' { Some('_') }
            else { None }
        } else { None };

        if let Some(m) = bold_marker {
            let start = i + 2;
            if let Some(end) = find_double_closing(&chars, start, m) {
                let inner: String = chars[start..end].iter().collect();
                result.push('*');
                result.push_str(&inline(&inner));
                result.push('*');
                i = end + 2;
                continue;
            }
        }

        // Italic: *text* (single asterisk, not already bold)
        if chars[i] == '*' && (i == 0 || chars[i - 1] != '*') {
            let start = i + 1;
            if let Some(end) = find_closing_char(&chars, start, '*') {
                if end > start {
                    let inner: String = chars[start..end].iter().collect();
                    result.push('_');
                    result.push_str(&inline(&inner));
                    result.push('_');
                    i = end + 1;
                    continue;
                }
            }
        }

        // Italic: _text_ (single underscore, not already bold)
        if chars[i] == '_' && (i == 0 || chars[i - 1] != '_') {
            let start = i + 1;
            if let Some(end) = find_closing_char(&chars, start, '_') {
                if end > start {
                    let inner: String = chars[start..end].iter().collect();
                    result.push('_');
                    result.push_str(&inline(&inner));
                    result.push('_');
                    i = end + 1;
                    continue;
                }
            }
        }

        // Autolink: <https://...> or <email@...>
        if chars[i] == '<' {
            if let Some(end) = find_closing_char(&chars, i + 1, '>') {
                let content: String = chars[i + 1..end].iter().collect();
                if content.starts_with("http://") || content.starts_with("https://") {
                    result.push_str(&format!("#link(\"{content}\")"));
                    i = end + 1;
                    continue;
                } else if content.contains('@') && !content.contains(' ') {
                    let escaped = content.replace('@', "\\@");
                    result.push_str(&format!("#link(\"mailto:{content}\")[{escaped}]"));
                    i = end + 1;
                    continue;
                }
            }
        }

        // Typst special chars that need escaping in plain text
        match chars[i] {
            '@' | '#' if result.ends_with(|c: char| !c.is_alphanumeric()) => {
                result.push('\\');
                result.push(chars[i]);
            }
            c => result.push(c),
        }
        i += 1;
    }

    result
}

fn find_closing_char(chars: &[char], start: usize, delim: char) -> Option<usize> {
    for i in start..chars.len() {
        if chars[i] == delim { return Some(i); }
        if chars[i] == '\n' { return None; }
    }
    None
}

fn find_double_closing(chars: &[char], start: usize, delim: char) -> Option<usize> {
    let mut i = start;
    while i + 1 < chars.len() {
        if chars[i] == delim && chars[i + 1] == delim { return Some(i); }
        if chars[i] == '\n' { return None; }
        i += 1;
    }
    None
}

/// Parse `[text](url)` or `(url)` part. Returns (inner_text, url, next_i).
fn parse_link(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    if chars[start] != '[' { return None; }
    let text_end = find_closing_char(chars, start + 1, ']')?;
    let inner_text: String = chars[start + 1..text_end].iter().collect();
    if text_end + 1 >= chars.len() || chars[text_end + 1] != '(' { return None; }
    let url_end = find_closing_char(chars, text_end + 2, ')')?;
    let url_raw: String = chars[text_end + 2..url_end].iter().collect();
    let url = url_raw.split_whitespace().next().unwrap_or("").to_string();
    Some((inner_text, url, url_end + 1))
}

// ── Reference link helpers ────────────────────────────────────────────────────

fn parse_ref_def(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if !line.starts_with('[') { return None; }
    let bracket_end = line.find("]:")?;
    let key = line[1..bracket_end].to_lowercase();
    let rest = line[bracket_end + 2..].trim();
    let url = rest.split_whitespace().next()?.to_string();
    if url.is_empty() { return None; }
    Some((key, url))
}

fn expand_references(content: &str) -> String {
    let mut refs: HashMap<String, String> = HashMap::new();
    for line in content.lines() {
        if let Some((key, url)) = parse_ref_def(line) {
            refs.insert(key, url);
        }
    }
    if refs.is_empty() {
        return content.to_string();
    }
    let mut out = String::with_capacity(content.len());
    for line in content.lines() {
        if parse_ref_def(line).is_some() {
            continue;
        }
        out.push_str(&expand_ref_links(line, &refs));
        out.push('\n');
    }
    out
}

fn expand_ref_links(line: &str, refs: &HashMap<String, String>) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut result = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            if let Some(text_end) = chars[i + 1..].iter().position(|&c| c == ']').map(|p| i + 1 + p) {
                let text: String = chars[i + 1..text_end].iter().collect();
                if text_end + 1 < chars.len() && chars[text_end + 1] == '[' {
                    let ref_start = text_end + 2;
                    if let Some(ref_end) = chars[ref_start..].iter().position(|&c| c == ']').map(|p| ref_start + p) {
                        let ref_key: String = chars[ref_start..ref_end].iter().collect();
                        if let Some(url) = refs.get(&ref_key.to_lowercase()) {
                            result.push_str(&format!("[{text}]({url})"));
                            i = ref_end + 1;
                            continue;
                        }
                    }
                }
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

// ── External tool helpers ─────────────────────────────────────────────────────

/// Try to run pandoc to convert `src` from `from_fmt` to Typst.
pub fn try_pandoc(from_fmt: &str, src: &str) -> Result<String, String> {
    let out = std::process::Command::new("pandoc")
        .args(["-f", from_fmt, "-t", "typst", src])
        .output()
        .map_err(|_| "pandoc not found — install pandoc to convert this format".to_string())?;
    if out.status.success() {
        String::from_utf8(out.stdout).map_err(|e| e.to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

/// Extract text from a PDF using pdftotext (poppler), then wrap in a Typst stub.
pub fn try_pdf_to_typst(src: &str) -> Result<String, String> {
    let out = std::process::Command::new("pdftotext")
        .args([src, "-"])
        .output()
        .map_err(|_| {
            "pdftotext not found — install poppler (brew install poppler) to convert PDFs"
                .to_string()
        })?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // Wrap extracted text in a basic Typst document
    Ok(format!(
        "#set page(margin: 2.5cm)\n#set text(font: \"Linux Libertine\")\n\n{}\n",
        text.lines()
            .map(|l| l.to_string())
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn convert(md: &str) -> String {
        markdown_to_typst(md).0
    }

    // ── Headings ──────────────────────────────────────────────────────────────

    #[test]
    fn atx_heading_h1() {
        assert!(convert("# Hello\n").contains("= Hello"));
    }

    #[test]
    fn atx_heading_h2() {
        assert!(convert("## World\n").contains("== World"));
    }

    #[test]
    fn atx_heading_h3() {
        assert!(convert("### Deep\n").contains("=== Deep"));
    }

    #[test]
    fn atx_heading_h4_to_h6() {
        assert!(convert("#### H4\n").contains("==== H4"));
        assert!(convert("##### H5\n").contains("===== H5"));
        assert!(convert("###### H6\n").contains("====== H6"));
    }

    #[test]
    fn atx_heading_not_h7() {
        // 7 hashes is not a heading in CommonMark; treated as paragraph text
        let out = convert("####### Not a heading\n");
        assert!(!out.contains("======= Not a heading"));
    }

    #[test]
    fn setext_heading_level1() {
        let out = convert("Title\n=====\n");
        assert!(out.contains("= Title"));
    }

    #[test]
    fn setext_heading_level2() {
        let out = convert("Subtitle\n--------\n");
        assert!(out.contains("== Subtitle"));
    }

    // ── Inline formatting ─────────────────────────────────────────────────────

    #[test]
    fn bold_double_asterisk() {
        assert!(convert("**bold**\n").contains("*bold*"));
    }

    #[test]
    fn bold_double_underscore() {
        assert!(convert("__bold__\n").contains("*bold*"));
    }

    #[test]
    fn italic_single_asterisk() {
        let out = convert("*italic*\n");
        assert!(out.contains("_italic_"));
    }

    #[test]
    fn italic_single_underscore() {
        let out = convert("_italic_\n");
        assert!(out.contains("_italic_"));
    }

    #[test]
    fn inline_code() {
        assert!(convert("`code`\n").contains("`code`"));
    }

    #[test]
    fn link() {
        let out = convert("[text](https://example.com)\n");
        assert!(out.contains("#link(\"https://example.com\")[text]"));
    }

    #[test]
    fn image() {
        let out = convert("![alt text](image.png)\n");
        assert!(out.contains("#image(\"image.png\", alt: \"alt text\")"));
    }

    #[test]
    fn image_empty_alt() {
        let out = convert("![](photo.jpg)\n");
        assert!(out.contains("#image(\"photo.jpg\", alt: \"\")"));
    }

    // ── Block elements ────────────────────────────────────────────────────────

    #[test]
    fn fenced_code_block_with_lang() {
        let md = "```rust\nfn main() {}\n```\n";
        let out = convert(md);
        assert!(out.contains("```rust"));
        assert!(out.contains("fn main() {}"));
    }

    #[test]
    fn fenced_code_block_no_lang() {
        let md = "```\nsome code\n```\n";
        let out = convert(md);
        assert!(out.contains("```\nsome code\n```"));
    }

    #[test]
    fn tilde_fenced_code_block() {
        let md = "~~~\nsome code\n~~~\n";
        let out = convert(md);
        assert!(out.contains("some code"));
    }

    #[test]
    fn unclosed_code_block_flushed() {
        let out = convert("```\nunfenced code");
        assert!(out.contains("unfenced code"));
    }

    #[test]
    fn unordered_list_dash() {
        assert!(convert("- item\n").contains("- item"));
    }

    #[test]
    fn unordered_list_asterisk() {
        assert!(convert("* item\n").contains("- item"));
    }

    #[test]
    fn unordered_list_plus() {
        assert!(convert("+ item\n").contains("- item"));
    }

    #[test]
    fn ordered_list() {
        assert!(convert("1. first\n").contains("+ first"));
        assert!(convert("2. second\n").contains("+ second"));
        assert!(convert("10. tenth\n").contains("+ tenth"));
    }

    #[test]
    fn ordered_list_parenthesis() {
        assert!(convert("1) item\n").contains("+ item"));
    }

    #[test]
    fn blockquote() {
        let out = convert("> quoted text\n");
        assert!(out.contains("#quote[quoted text]"));
    }

    #[test]
    fn blockquote_no_space() {
        let out = convert(">no space\n");
        assert!(out.contains("#quote[no space]"));
    }

    #[test]
    fn horizontal_rule_dashes() {
        assert!(convert("---\n").contains("#line(length: 100%)"));
    }

    #[test]
    fn horizontal_rule_asterisks() {
        assert!(convert("***\n").contains("#line(length: 100%)"));
    }

    #[test]
    fn horizontal_rule_underscores() {
        assert!(convert("___\n").contains("#line(length: 100%)"));
    }

    #[test]
    fn horizontal_rule_many_dashes() {
        assert!(convert("--------\n").contains("#line(length: 100%)"));
    }

    #[test]
    fn markdown_table() {
        let md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
        let out = convert(md);
        assert!(out.contains("#table("));
        assert!(out.contains("columns: 2"));
        assert!(out.contains("[A]"));
        assert!(out.contains("[B]"));
        assert!(out.contains("[1]"));
        assert!(out.contains("[2]"));
    }

    #[test]
    fn blank_line_becomes_newline() {
        let out = convert("a\n\nb\n");
        assert!(out.contains('\n'));
    }

    #[test]
    fn plain_paragraph() {
        assert_eq!(convert("Hello world\n").trim(), "Hello world");
    }

    #[test]
    fn empty_input() {
        assert_eq!(convert(""), "");
    }

    // ── parse_heading edge cases ──────────────────────────────────────────────

    #[test]
    fn heading_no_space_not_matched() {
        // `#text` (no space) is not a heading
        let out = convert("#notaheading\n");
        assert!(!out.starts_with('='));
    }

    #[test]
    fn heading_extra_spaces_trimmed() {
        let out = convert("#   Spaces   \n");
        assert!(out.contains("= Spaces"));
    }

    // ── strip_ordered_list edge cases ─────────────────────────────────────────

    #[test]
    fn not_ordered_list_no_dot() {
        // "1text" — no dot or paren, so treated as paragraph
        let out = convert("1text\n");
        assert!(!out.starts_with('+'));
    }

    // ── inline: mixed formatting ──────────────────────────────────────────────

    #[test]
    fn bold_and_italic_combined() {
        // **bold** _italic_ in same line
        let out = convert("**bold** and _italic_\n");
        assert!(out.contains("*bold*"));
        assert!(out.contains("_italic_"));
    }

    #[test]
    fn link_with_bold_label() {
        let out = convert("[**bold**](url)\n");
        assert!(out.contains("#link(\"url\")"));
    }

    #[test]
    fn link_title_stripped() {
        let out = convert("[text](https://example.com \"Title\")\n");
        assert!(out.contains("#link(\"https://example.com\")[text]"));
        assert!(!out.contains("Title"));
    }

    #[test]
    fn reference_link_resolved() {
        let md = "[ref link][myref]\n\n[myref]: https://example.com\n";
        let out = convert(md);
        assert!(out.contains("#link(\"https://example.com\")[ref link]"));
    }

    #[test]
    fn reference_definition_line_skipped() {
        let out = convert("[myref]: https://example.com\n");
        assert!(!out.contains("[myref]"));
        assert!(!out.contains("https://example.com"));
    }

    #[test]
    fn autolink_url() {
        let out = convert("See <https://example.com> for details\n");
        assert!(out.contains("#link(\"https://example.com\")"));
    }

    #[test]
    fn autolink_email() {
        let out = convert("Email <user@example.com> here\n");
        assert!(out.contains("#link(\"mailto:user@example.com\")[user\\@example.com]"));
    }

    #[test]
    fn image_local_path() {
        let out = convert("![alt](photo.jpg)\n");
        assert!(out.contains("#image(\"photo.jpg\", alt: \"alt\")"));
    }

    #[test]
    fn image_url_becomes_link() {
        let out = convert("![alt](https://example.com/img.png)\n");
        assert!(out.contains("#link(\"https://example.com/img.png\")[alt]"));
        assert!(!out.contains("#image("));
    }

    // ── Citations ─────────────────────────────────────────────────────────────

    #[test]
    fn citation_single() {
        let out = convert("See [@vaswani2017] for details.\n");
        assert!(out.contains("@vaswani2017"), "got: {out}");
        assert!(!out.contains("[@vaswani2017]"), "should not contain raw citation: {out}");
    }

    #[test]
    fn citation_multi() {
        let out = convert("See [@smith2020; @jones2021].\n");
        assert!(out.contains("@smith2020"), "got: {out}");
        assert!(out.contains("@jones2021"), "got: {out}");
    }

    // ── Inline math ───────────────────────────────────────────────────────────

    #[test]
    fn inline_math_passthrough() {
        let out = convert("We use $E = mc^2$ here.\n");
        assert!(out.contains("$E = mc^2$"), "got: {out}");
    }

    #[test]
    fn inline_math_no_escaped_at() {
        let out = convert("Formula $\\alpha$ done.\n");
        assert!(!out.contains("\\@"), "@ should not be escaped inside math: {out}");
    }

    // ── Block math ────────────────────────────────────────────────────────────

    #[test]
    fn block_math_fenced() {
        let md = "$$\nE = mc^2\n$$\n";
        let out = convert(md);
        assert!(out.contains("$ E = mc^2 $") || out.contains("$E = mc^2$"), "got: {out}");
    }

    #[test]
    fn block_math_inline_double_dollar() {
        let out = convert("$$x + y = z$$\n");
        assert!(out.contains("$ x + y = z $") || out.contains("$x + y = z$"), "got: {out}");
    }

    // ── Front matter ─────────────────────────────────────────────────────────

    #[test]
    fn front_matter_stripped_from_body() {
        let md = "---\ntitle: \"My Paper\"\n---\n\n# Introduction\n";
        let out = convert(md);
        assert!(!out.contains("title:"), "front matter key should be stripped: {out}");
        assert!(out.contains("= Introduction"), "body should remain: {out}");
    }

    #[test]
    fn strip_front_matter_returns_body() {
        let md = "---\ntitle: Hello\n---\n\nBody text.\n";
        let (body, fm) = strip_front_matter(md);
        assert!(fm.is_some());
        assert!(body.contains("Body text"), "got: {body}");
    }

    #[test]
    fn parse_front_matter_title_and_authors() {
        let yaml = "title: \"My Paper\"\nauthors:\n  - Alice\n  - Bob\n";
        let fm = parse_front_matter(yaml);
        assert_eq!(fm.title.as_deref(), Some("My Paper"));
        assert_eq!(fm.authors, vec!["Alice", "Bob"]);
    }

    #[test]
    fn build_preamble_empty_when_no_metadata() {
        let fm = FrontMatter::default();
        assert!(build_preamble(&fm).is_empty());
    }

    #[test]
    fn build_preamble_has_title() {
        let fm = FrontMatter { title: Some("Test".into()), ..Default::default() };
        let p = build_preamble(&fm);
        assert!(p.contains("Test"), "got: {p}");
        assert!(p.contains("#set page"), "got: {p}");
    }
}
