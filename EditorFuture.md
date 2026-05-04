# TypeStudio — Editor Future Design

> Full architecture and implementation design from design session, May 2026.
> Covers: Markdown rendering, WYSIWYG editor, Typst pipeline, Citation Manager, Version History.

-----

## Table of Contents

1. [Project Overview](#1-project-overview)
1. [Tech Stack Decisions](#2-tech-stack-decisions)
1. [Full Architecture](#3-full-architecture)
1. [Markdown → Typst Pipeline](#4-markdown--typst-pipeline)
1. [Parser (parser.rs)](#5-parserrs)
1. [Mapper (mapper.rs)](#6-mapperrs)
1. [Template Engine (template.rs)](#7-template-enginetemplatersrs)
1. [Citation Manager](#8-citation-manager)
1. [Version History](#9-version-history)
1. [Frontend Warning System](#10-frontend-warning-system)
1. [Three-Month Roadmap](#11-three-month-roadmap)

-----

## 1. Project Overview

TypeStudio is a desktop academic writing app targeting **researchers**. The core UX philosophy is:

- Users write in **Markdown** (WYSIWYG) and focus entirely on content
- The backend converts Markdown → Typst → PDF using academic templates (IEEE, ACM, NeurIPS)
- **Content and style are fully separated** — the user never touches Typst directly unless they want to

**Key constraints:**

- Single developer, **3-month launch target**
- Performance is a top priority (large papers with heavy LaTeX)
- User experience must never be interrupted (no blocking errors)
- Built with **Tauri + React + Rust**

-----

## 2. Tech Stack Decisions

### Editor: Milkdown

Chosen over ProseMirror (too low-level), TipTap (LaTeX coverage insufficient), and Lexical.

**Why Milkdown:**

- Markdown-first WYSIWYG, matches the content-focused UX goal
- Built on ProseMirror — solid performance foundation
- Plugin system supports custom nodes (citations, math)
- 3-month feasible for a solo developer

```bash
npm install @milkdown/core @milkdown/preset-commonmark
npm install @milkdown/plugin-math
```

### LaTeX: KaTeX (first), MathJax (later)

KaTeX is used at launch for speed. MathJax 3 can be swapped in post-launch if users report coverage gaps.

KaTeX covers ~95% of common academic math. Missing cases (e.g. `\begin{theorem}`, custom operators) can be handled via the Typst passthrough block (see below).

### Typst Rendering

Typst replaces LaTeX as the document rendering engine:

- **Millisecond compilation** (vs seconds for LaTeX)
- **Rust-native** via the `typst` crate — fits Tauri perfectly
- Modern template syntax, active community (Typst Universe)
- Templates available for IEEE, ACM, NeurIPS

### Local Media: Tauri `asset://` Protocol

```json
// tauri.conf.json
{
  "tauri": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": ["$APPDATA/*", "$DOCUMENT/*"]
      }
    }
  }
}
```

```typescript
import { convertFileSrc } from '@tauri-apps/api/core';
const assetUrl = convertFileSrc('/Users/xxx/image.png');
// → "asset://localhost/Users/xxx/image.png"
```

-----

## 3. Full Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend — React                                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────┐ │
│  │Milkdown      │  │KaTeX         │  │Media         │  │Stat│ │
│  │editor        │  │renderer      │  │renderer      │  │bar │ │
│  │WYSIWYG+MD    │  │$$ equations  │  │asset://      │  │    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────┘ │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │Citation panel    │  │Version panel     │  │PDF preview  │  │
│  │Search·Insert·DOI │  │List·Restore·Diff │  │File tree    │  │
│  └──────────────────┘  └──────────────────┘  └─────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │Editor plugins                                           │   │
│  │[@] citation autocomplete · useAutoSave (30s) · Cmd+S   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ invoke() / IPC
┌─────────────────────────────────────────────────────────────────┐
│  Tauri Bridge                                                   │
│  invoke() · asset:// · Event system · IPC                      │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│  Rust Backend                                                   │
│                                                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │File system               │  │PDF parser                │    │
│  │Read · Write · Watch      │  │pdfium · text + metadata  │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │Version History                                          │   │
│  │Auto save (30s) · Manual save (Cmd+S) · Restore · Diff  │   │
│  │SQLite versions table · full snapshots · max 100 shown  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │Citation Manager                                         │   │
│  │Manual entry · BibTeX import · DOI fetch (CrossRef API) │   │
│  │Fuzzy search → [@] autocomplete · export refs.bib       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │Typst Rendering Pipeline                                 │   │
│  │MD → AST → Typst mapper → Template engine → typst crate │   │
│  │pulldown-cmark  custom   IEEE/ACM/NeurIPS    → PDF bytes │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│  Storage                                                        │
│                                                                 │
│  .md files     assets/        app.db            refs.bib · PDF │
│  (papers)      (images/video) (citations+vers)  (generated)    │
│                                                                 │
│  templates/ — ieee.typ · acm.typ · neurips.typ · default.typ  │
│  (compiled into binary via include_str!)                       │
└─────────────────────────────────────────────────────────────────┘
```

-----

## 4. Markdown → Typst Pipeline

### Philosophy: Content and Style Separation

```
User writes Markdown (.md)
        ↓
[pulldown-cmark] — parse to AST
        ↓
[Custom mapper] — AST → Typst nodes
        ↓
[Template engine] — inject into ieee.typ / acm.typ / etc.
        ↓
[typst crate] — compile to PDF (milliseconds)
```

### Front Matter Schema

The front matter is the “API” between the user and the template engine. It must be designed carefully as it defines the ceiling of template capabilities.

```yaml
---
title: "Attention Is All You Need"
template: ieee          # ieee | acm | neurips | default
authors:
  - name: "Vaswani"
    affiliation: "Google Brain"
  - name: "Shazeer"
    affiliation: "Google Brain"
abstract: |
  We propose a new simple network architecture...
bibliography: refs.bib
---
```

### Mapping Table

|Markdown         |Typst                                      |Notes                 |
|-----------------|-------------------------------------------|----------------------|
|`# Heading 1`    |`= Heading 1`                              |Direct                |
|`## Heading 2`   |`== Heading 2`                             |Direct                |
|`**bold**`       |`*bold*`                                   |Direct                |
|`*italic*`       |`_italic_`                                 |Direct                |
|``code``         |``code``                                   |Direct                |
|`$inline$`       |`$inline$`                                 |Near-identical        |
|`$$block$$`      |`$ block $`                                |Outer delimiter change|
|`[@smith2020]`   |`@smith2020`                               |Custom syntax → native|
|`[@a; @b]`       |`@a @b`                                    |Multi-cite            |
|`![cap](img.png)`|`#figure(image("img.png"), caption: [cap])`|Context-aware         |
|`|table|`        |`#table(columns: N, ...)`                  |With degradation      |
|````typst`       |passthrough                                |Raw Typst escape hatch|

### Citation Syntax Decision: `[@cite]`

**Chosen: `[@cite]` Pandoc-style** over bare `@cite`.

Reasons:

1. Researchers familiar with Pandoc/RMarkdown will recognize it immediately
1. Enables Milkdown to treat `[@cite]` as a **dedicated node type** — rendered as a blue clickable tag in the editor, not plain text
1. Eliminates false positives (bare `@` appears in emails, Twitter handles, etc.)

```
Editor display:     [Smith 2020]  ← styled blue tag
Stored Markdown:    [@smith2020]
Typst output:       @smith2020
```

### Degradation Strategy: Graceful Degradation (Never Block)

Three-tier approach — user experience is never interrupted:

**Tier 1 — Simplify:** Convert with warning (yellow inline indicator)

```
Complex nested table → simplified #table(), warning issued
HTML tags → text content extracted, tags stripped
```

**Tier 2 — Passthrough:** Raw Typst escape hatch

```markdown
```typst
#grid(columns: 2, [Column 1], [Column 2])
```
```

**Tier 3 — Comment:** Complete fallback, never blocks compilation

```typst
/* [unsupported] :::theorem ... ::: */
```

Status bar (bottom right) shows `⚠ 2 processed with simplifications` — non-intrusive, clickable to expand.

-----

## 5. Parser (parser.rs)

### File Location

```
src/
└── converter/
    ├── mod.rs
    ├── parser.rs      ← this file
    ├── mapper.rs
    ├── template.rs
    └── typst_writer.rs
```

### DocNode Enum

```rust
#[derive(Debug, Clone)]
pub enum DocNode {
    Heading     { level: u8, children: Vec<DocNode> },
    Paragraph   (Vec<DocNode>),
    Text        (String),
    Bold        (Vec<DocNode>),
    Italic      (Vec<DocNode>),
    InlineCode  (String),
    CodeBlock   { lang: Option<String>, content: String },
    InlineMath  (String),
    BlockMath   (String),
    Citation    (Vec<String>),          // [@a; @b] → vec!["a", "b"]
    Figure      { src: String, caption: Option<String> },
    Table       { headers: Vec<String>, rows: Vec<Vec<String>> },
    TypstRaw    (String),               // ```typst passthrough
    Unsupported (String),               // fallback
    SoftBreak,
    HardBreak,
}
```

### FrontMatter Struct

```rust
#[derive(Debug, Deserialize, Default)]
pub struct Author {
    pub name:        String,
    pub affiliation: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct FrontMatter {
    pub title:         Option<String>,
    pub authors:       Option<Vec<Author>>,
    pub template:      Option<String>,
    pub bibliography:  Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
}
```

### Preprocessing Steps

Before `pulldown-cmark` parses the body, two preprocessing steps protect special syntax:

**1. Citation protection** — prevents `[@cite]` from being parsed as a link:

```rust
fn protect_citations(md: &str) -> String {
    // [@smith2020; @jones2021] → __CITE__smith2020|jones2021__
    let re = Regex::new(r"\[@([^\]]+)\]").unwrap();
    re.replace_all(&md, |caps: &regex::Captures| {
        let keys = caps[1]
            .split(';')
            .map(|k| k.trim().trim_start_matches('@'))
            .collect::<Vec<_>>()
            .join("|");
        format!("__CITE__{}__", keys)
    }).to_string()
}
```

**2. Math protection** — preserves `$...$` and `$$...$$`:

```rust
fn protect_math(md: &str) -> String {
    // $$ block $$ → __BLOCKMATH__...__
    let block_re = Regex::new(r"(?s)\$\$(.+?)\$\$").unwrap();
    let md = block_re.replace_all(&md, |caps: &regex::Captures| {
        format!("__BLOCKMATH__{}__", caps[1].trim())
    }).to_string();

    // $inline$ → __INLINEMATH__...__
    let inline_re = Regex::new(r"\$([^\$\n]+?)\$").unwrap();
    inline_re.replace_all(&md, |caps: &regex::Captures| {
        format!("__INLINEMATH__{}__", &caps[1])
    }).to_string()
}
```

### Cargo Dependencies

```toml
[dependencies]
pulldown-cmark = "0.11"
serde_yaml     = "0.9"
regex          = "1"
typst          = "0.11"
```

-----

## 6. Mapper (mapper.rs)

### MappedNode Result Type

```rust
pub enum MappedNode {
    Ok(String),
    Degraded(String, String),   // (typst output, warning message)
}

pub struct Warning {
    pub message: String,
}

pub struct MapResult {
    pub typst:    String,
    pub warnings: Vec<Warning>,
}
```

### Key Mapping Logic

```rust
fn map_node(node: &DocNode, warnings: &mut Vec<Warning>) -> String {
    match node {
        DocNode::Heading { level, children } => {
            let prefix = "=".repeat(*level as usize);
            format!("{} {}", prefix, map_children(children, warnings))
        }
        DocNode::BlockMath(expr) => {
            format!("$ {} $", expr)
        }
        DocNode::Citation(keys) => {
            keys.iter().map(|k| format!("@{}", k))
                .collect::<Vec<_>>().join(" ")
        }
        DocNode::Figure { src, caption } => {
            match caption {
                Some(cap) => format!(
                    "#figure(\n  image(\"{}\"),\n  caption: [{}],\n)", src, cap
                ),
                None => format!("#image(\"{}\")", src),
            }
        }
        DocNode::TypstRaw(content) => content.clone(),
        DocNode::Unsupported(raw) => {
            warnings.push(Warning {
                message: format!("Unsupported element skipped: {}", &raw[..50.min(raw.len())]),
            });
            format!("/* [unsupported] {} */", raw)
        }
        // ... other nodes
    }
}
```

### Table Degradation

Tables with complex cell content (nested images, bold, math) are simplified with a warning:

```rust
fn map_table(headers: &[String], rows: &[Vec<String>], warnings: &mut Vec<Warning>) -> String {
    let has_complex = headers.iter().chain(rows.iter().flatten())
        .any(|cell| cell.contains("![") || cell.contains("**"));

    if has_complex {
        warnings.push(Warning {
            message: "Table with complex content simplified".to_string(),
        });
    }
    // ... generate #table(...)
}
```

-----

## 7. Template Engine (template.rs)

### Template Storage

Templates are compiled into the binary at build time — zero runtime file I/O:

```rust
const TEMPLATE_IEEE:    &str = include_str!("../../templates/ieee.typ");
const TEMPLATE_ACM:     &str = include_str!("../../templates/acm.typ");
const TEMPLATE_NEURIPS: &str = include_str!("../../templates/neurips.typ");
const TEMPLATE_DEFAULT: &str = include_str!("../../templates/default.typ");
```

### Template File Format

Placeholders use `{{}}` syntax:

```typst
// templates/ieee.typ
#import "@preview/charged-ieee:0.1.3": ieee

#show: ieee.with(
  title: [{{TITLE}}],
  abstract: [{{ABSTRACT}}],
  authors: (
    {{AUTHORS}}
  ),
  bibliography: bibliography("{{BIBLIOGRAPHY}}"),
)

{{BODY}}
```

### TemplateResult

```rust
pub struct TemplateResult {
    pub typst:    String,
    pub warnings: Vec<String>,
}

pub fn apply(frontmatter: &FrontMatter, body: &str) -> Result<TemplateResult, TemplateError> {
    let title = frontmatter.title.as_deref().ok_or(TemplateError::MissingTitle)?;
    let template_name = frontmatter.template.as_deref().unwrap_or("default");
    let template = select_template(template_name);

    let typst = template
        .replace("{{TITLE}}",        title)
        .replace("{{AUTHORS}}",      &build_authors(frontmatter))
        .replace("{{ABSTRACT}}",     &build_abstract(frontmatter))
        .replace("{{BIBLIOGRAPHY}}", &build_bibliography(frontmatter, &mut warnings))
        .replace("{{BODY}}",         body);

    Ok(TemplateResult { typst, warnings })
}
```

### End-to-End Example

**Input Markdown:**

```markdown
---
title: "Attention Is All You Need"
template: ieee
authors:
  - name: "Vaswani"
    affiliation: "Google Brain"
abstract: "We propose a new architecture..."
bibliography: refs.bib
---

## Introduction

Transformers [@vaswani2017] rely on $Q, K, V$ matrices.

$$\text{Attention}(Q,K,V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$
```

**Output Typst:**

```typst
#import "@preview/charged-ieee:0.1.3": ieee

#show: ieee.with(
  title: [Attention Is All You Need],
  abstract: [We propose a new architecture...],
  authors: (
    (name: "Vaswani", affiliation: "Google Brain"),
  ),
  bibliography: bibliography("refs.bib"),
)

== Introduction

Transformers @vaswani2017 rely on $Q, K, V$ matrices.

$ text("Attention")(Q,K,V) = text("softmax")(frac(Q K^T, sqrt(d_k)))V $
```

-----

## 8. Citation Manager

### Data Model

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Citation {
    pub id:          String,         // "vaswani2017" — used in [@vaswani2017]
    pub kind:        CitationKind,   // Article | InProceedings | Book | Misc
    pub title:       String,
    pub authors:     Vec<String>,
    pub year:        Option<u32>,
    pub venue:       Option<String>, // journal name or conference name
    pub doi:         Option<String>,
    pub url:         Option<String>,
    pub raw_bibtex:  Option<String>, // used as-is on export if present
}
```

### SQLite Schema

```sql
CREATE TABLE citations (
    id          TEXT    PRIMARY KEY,
    kind        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    authors     TEXT    NOT NULL,   -- JSON array
    year        INTEGER,
    venue       TEXT,
    doi         TEXT,
    url         TEXT,
    raw_bibtex  TEXT,
    created_at  INTEGER NOT NULL
);
```

### Three Import Sources

**1. Manual entry** — form submission → SQLite insert

**2. BibTeX file import** (using `nom-bibtex` crate):

```rust
pub fn import_bibtex(content: &str) -> Vec<Citation> {
    let bib = Bibtex::parse(content).unwrap_or_default();
    bib.bibliographies().iter().map(|entry| {
        Citation {
            id:    entry.citation_key().to_string(),
            title: get_tag(entry, "title").unwrap_or_default(),
            authors: parse_authors(&get_tag(entry, "author").unwrap_or_default()),
            // ...
        }
    }).collect()
}
```

**3. DOI auto-fetch** (CrossRef public API, no key required):

```rust
pub async fn fetch_doi(doi: &str) -> Result<Citation, String> {
    let url = format!("https://api.crossref.org/works/{}", urlencoding::encode(doi));
    let resp: CrossRefResponse = reqwest::get(&url).await?.json().await?;
    // parse and auto-generate id: first_author_last_name + year
    // e.g. "Vaswani 2017" → "vaswani2017"
}
```

### [@] Autocomplete Plugin

Milkdown plugin monitors text input for `[@` trigger:

```typescript
// Detects [@vas → queries backend → shows dropdown
const match = textBefore.match(/\[@([\w]*)$/)
if (match) {
    const results = await invoke<Citation[]>('search_citations', { query: match[1] })
    showDropdown(results)
}
```

Dropdown UI shows: `@vaswani2017` / title (truncated to 50 chars) / `Vaswani et al. · 2017`

### refs.bib Export

Before every PDF compilation, all citations are exported to `refs.bib`:

```rust
pub fn citation_to_bibtex(c: &Citation) -> String {
    if let Some(raw) = &c.raw_bibtex {
        return raw.clone();  // use original if available
    }
    format!(
        "@{}{{{},\n  title={{{}}},\n  author={{{}}},\n  year={{{}}}\n}}",
        kind_str, c.id, c.title,
        c.authors.join(" and "),
        c.year.unwrap_or(0)
    )
}
```

Typst template’s `bibliography("refs.bib")` then handles all formatting (APA, IEEE, ACS, etc.) automatically.

-----

## 9. Version History

### Storage Strategy: Full Snapshots

Each version stores the **complete Markdown content**. No delta/diff compression.

**Rationale:** Researcher papers are typically under 50k words. 1000 versions × ~100KB = 100MB — acceptable for a local desktop app. Simpler to implement and faster to restore.

### SQLite Schema

```sql
CREATE TABLE versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id    TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    label       TEXT,                -- null for auto-saves
    kind        TEXT    NOT NULL,    -- "auto" | "manual"
    created_at  INTEGER NOT NULL
);

CREATE INDEX idx_versions_paper ON versions(paper_id, created_at DESC);
```

### Rust Types

```rust
pub struct Version {
    pub id:         i64,
    pub paper_id:   String,
    pub content:    String,
    pub label:      Option<String>,
    pub created_at: i64,
    pub kind:       VersionKind,    // Auto | Manual
}
```

### Save Logic

Auto-save deduplicates — skips if content identical to last version:

```rust
pub fn save(conn: &Connection, paper_id: &str, content: &str,
            label: Option<&str>, kind: &str) -> rusqlite::Result<i64> {
    if kind == "auto" {
        if let Some(last) = fetch_latest(conn, paper_id)? {
            if last.content == content {
                return Ok(last.id);  // skip duplicate
            }
        }
    }
    // insert new version...
}
```

### Tauri Commands

```rust
#[tauri::command] save_version(paper_id, content, label, kind) → i64
#[tauri::command] list_versions(paper_id) → Vec<VersionMeta>    // metadata only, no content
#[tauri::command] restore_version(version_id) → String           // returns full content
#[tauri::command] fetch_two_versions(id_a, id_b) → (String, String) // for diff
```

### Auto-Save Timing

```
User stops typing for 30 seconds → auto-save triggered
Cmd+S                            → manual save, prompt for optional label
Document close                   → force auto-save (prevent data loss)
```

The 30-second debounce for version saving is separate from the 800ms debounce for Typst PDF compilation.

### Frontend: Version Panel

```tsx
<VersionPanel>
  ├── Header: "Version History" + "Compare mode" toggle button
  ├── Compare mode hint: "Select two versions to compare"
  └── Version list (max 100):
      ├── [manual] label text (if set)
      ├── badge: "manual" (accent color) or "auto" (subtle)
      ├── timestamp: "5/4 14:32"
      ├── [normal mode] "Restore" button
      └── [compare mode] checkbox for selection
```

### Diff View

Diff computation runs **entirely on the frontend** using the `diff` npm package — no backend involvement needed.

```bash
npm install diff @types/diff
```

```typescript
import * as Diff from 'diff'

const parts = Diff.diffLines(contentA, contentB)
// Each part: { value: string, added?: boolean, removed?: boolean }
```

Visual rendering:

```
  ## Introduction                    ← grey,  unchanged
- This paper shows $E=mc^2$.        ← red,   removed
+ This paper demonstrates $E=mc^2$. ← green, added
  [@vaswani2017]                     ← grey,  unchanged
```

-----

## 10. Frontend Warning System

### Design Principle

> Warnings have minimal presence but are findable when needed.

No blocking dialogs. No interruptions to writing flow.

### Warning Levels

|Level    |Example                   |Behavior                    |
|---------|--------------------------|----------------------------|
|`info`   |Table simplified          |Silent, shown in panel only |
|`warning`|Unsupported syntax skipped|Status bar count + panel    |
|`error`  |PDF compilation failed    |Status bar highlight + panel|

### Status Bar (Bottom Right)

```
Normal:    ✓ Synced
Warnings:  ⚠ 2 simplified          ← click to open panel
Compiling: ◌ Generating PDF...
Error:     ✕ Compilation failed     ← click to view details
```

### Warning Panel

Slides up from bottom right on status bar click:

```
┌─────────────────────────────┐
│  Render warnings (2)    ✕   │
├─────────────────────────────┤
│ ⚠ Line 12                  │
│   Table simplified          │
│                             │
│ ℹ Line 45                  │
│   Table simplified          │
└─────────────────────────────┘
```

Each item is clickable to jump to the relevant editor line.

### TypeScript Types

```typescript
export type WarningLevel = 'info' | 'warning' | 'error';

export interface Warning {
    level:   WarningLevel;
    line?:   number;
    message: string;
}
```

### Debounce Strategy

```typescript
// PDF compilation: fast feedback
const compilePdf = useDebouncedCallback(async (content) => {
    const warns = await invoke<Warning[]>('export_pdf', { content });
    setWarnings(warns);
}, 800);   // 800ms after keystroke

// Version save: infrequent snapshots
const autoSave = useDebouncedCallback(async (content) => {
    await invoke('save_version', { content, kind: 'auto' });
}, 30_000); // 30s after last change
```

-----

## 11. Three-Month Roadmap

### Month 1 — Core Pipeline

- [ ] Tauri project setup + React + Milkdown integration
- [ ] `parser.rs` — all common DocNode types
- [ ] `mapper.rs` — basic Typst output
- [ ] `template.rs` — default template working
- [ ] `typst` crate compilation → PDF bytes
- [ ] `asset://` protocol for local images
- [ ] Status bar + basic warning display

### Month 2 — Academic Features

- [ ] KaTeX integration in Milkdown
- [ ] `[@cite]` custom node + autocomplete plugin
- [ ] Citation Manager — BibTeX import + manual entry
- [ ] DOI fetch (CrossRef API)
- [ ] Version history — auto-save + manual save
- [ ] IEEE / ACM / NeurIPS templates

### Month 3 — Polish + Launch

- [ ] Version diff view
- [ ] Citation panel sidebar
- [ ] Version panel sidebar
- [ ] PDF preview panel
- [ ] ````typst` passthrough block
- [ ] Graceful degradation warnings (inline editor markers)
- [ ] PDF export with refs.bib generation
- [ ] Performance testing with large papers
- [ ] Bug fixes + macOS/Windows packaging

### Priority Order Within Each Module

```
Citation Manager:   SQLite store → BibTeX import → sidebar UI → [@] autocomplete → DOI fetch
Version History:    auto-save → manual save → restore → diff view
Typst pipeline:     default template → IEEE → ACM → NeurIPS
```

-----

## Appendix: Cargo.toml Dependencies

```toml
[dependencies]
tauri          = { version = "2", features = ["protocol-asset"] }
serde          = { version = "1", features = ["derive"] }
serde_json     = "1"
serde_yaml     = "0.9"
pulldown-cmark = "0.11"
regex          = "1"
typst          = "0.11"
rusqlite       = { version = "0.31", features = ["bundled"] }
nom-bibtex     = "0.5"
reqwest        = { version = "0.12", features = ["json"] }
urlencoding    = "2"
tokio          = { version = "1", features = ["full"] }
```

## Appendix: npm Dependencies

```json
{
  "dependencies": {
    "@milkdown/core": "latest",
    "@milkdown/preset-commonmark": "latest",
    "@milkdown/plugin-math": "latest",
    "@tauri-apps/api": "^2",
    "use-debounce": "^10",
    "diff": "^5",
    "katex": "^0.16"
  }
}
```

-----

*Generated from design session — TypeStudio EDITOR_Future design, May 2026*
