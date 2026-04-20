/// Markdown → Typst conversion (built-in, no external dependencies).
/// Handles: headings, bold, italic, code, links, images, lists, blockquotes, HR, tables.
pub fn markdown_to_typst(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut in_code_block = false;
    let mut code_lang = String::new();
    let mut code_buf: Vec<&str> = Vec::new();
    let mut prev_blank = true;

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // ── Fenced code blocks ────────────────────────────────────────────────
        if let Some(rest) = line.strip_prefix("```").or_else(|| line.strip_prefix("~~~")) {
            if in_code_block {
                let body = code_buf.join("\n");
                if code_lang.is_empty() {
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
            out.push_str(&format!("- {}\n", inline(rest)));
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

        // ── Regular paragraph line ────────────────────────────────────────────
        out.push_str(&inline(line));
        out.push('\n');
        prev_blank = false;
        i += 1;
    }

    // Flush unclosed code block
    if in_code_block && !code_buf.is_empty() {
        let body = code_buf.join("\n");
        out.push_str(&format!("```{}\n{body}\n```\n", code_lang));
    }

    out
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

        // Image: ![alt](url)
        if chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            if let Some((alt, url, end)) = parse_link(&chars, i + 1) {
                result.push_str(&format!("#image(\"{url}\", alt: \"{alt}\")"));
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
    let url: String = chars[text_end + 2..url_end].iter().collect();
    Some((inner_text, url, url_end + 1))
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
        markdown_to_typst(md)
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
}
