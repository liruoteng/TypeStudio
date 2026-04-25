//! CVPR author-kit profile.
//!
//! Detection: \documentclass[...]{cvpr} or \usepackage{cvpr}.
//! Template: idiomatic Typst re-implementation of the CVPR two-column format.

use std::collections::HashMap;

use super::super::convert::{CommandMap, EnvMap};
use super::Profile;

pub struct CvprProfile;

impl Profile for CvprProfile {
    fn name(&self) -> &'static str { "cvpr" }

    fn matches(&self, preamble: &str) -> bool {
        preamble.contains("{cvpr}") || preamble.contains("\\usepackage{cvpr}")
    }

    fn command_overrides(&self) -> CommandMap {
        let mut m = HashMap::new();
        // CVPR-specific commands.
        m.insert("cvprPaperID".into(), String::new());
        m.insert("confName".into(), String::new());
        m.insert("printruler".into(), String::new());
        m.insert("ificcv".into(), String::new());
        m.insert("affiliations".into(), String::new());
        CommandMap(m)
    }

    fn env_overrides(&self) -> EnvMap {
        EnvMap::default()
    }

    fn typst_template(&self) -> &'static str {
        CVPR_TYP
    }

    fn main_preamble(&self) -> &'static str {
        CVPR_MAIN_PREAMBLE
    }
}

const CVPR_MAIN_PREAMBLE: &str = r#"#import "template.typ": template
"#;

const CVPR_TYP: &str = r#"// CVPR-style Typst template.
//
// Derived from the CVPR author kit (cvpr.cls / cvpr.sty). Two-column,
// US-letter, 10 pt. Suitable for review submission and camera-ready.
//
// Usage:
//   #import "template.typ": template
//   #show: doc => template(
//     title: [Your Paper Title],
//     authors: (
//       (name: "First Author", affiliation: "University A", email: "a@b.com"),
//       (name: "Second Author", affiliation: "University B"),
//     ),
//     abstract: [We present ...],
//     bibliography: bibliography("references.bib"),
//     paper-id: none,   // set to an integer for the review-mode header
//     doc,
//   )

// Helper defined first so template() can call it.
#let _cvpr-authors(authors) = {
  if authors.len() == 0 { return }
  let entries = authors.map(a => {
    let name = a.at("name", default: "")
    let aff  = a.at("affiliation", default: "")
    let mail = a.at("email", default: "")
    align(center)[
      #text(size: 11pt, weight: "bold")[#name] \
      #if aff  != "" [#text(size: 9pt)[#aff] \ ]
      #if mail != "" [#text(size: 9pt)[#link("mailto:" + mail)[#mail]] \ ]
    ]
  })
  let n = authors.len()
  let cols = if n <= 3 { n } else { 3 }
  grid(
    columns: (1fr,) * cols,
    gutter: 0.8em,
    ..entries,
  )
}

#let template(
  title: [],
  authors: (),
  abstract: [],
  bibliography: none,
  paper-id: none,
  doc,
) = {

  // ── Page geometry ────────────────────────────────────────────────────────
  set page(
    paper: "us-letter",
    margin: (top: 1in, bottom: 1.1875in, left: 0.875in, right: 0.875in),
    columns: 2,
    header: context {
      if paper-id != none {
        set text(size: 8pt, fill: luma(120))
        align(center)[
          CVPR 2025 Submission \##paper-id.
          CONFIDENTIAL REVIEW COPY. DO NOT DISTRIBUTE.
        ]
      }
    },
  )

  // ── Typography ───────────────────────────────────────────────────────────
  set text(font: "New Computer Modern", size: 10pt, lang: "en")
  set par(justify: true, leading: 0.55em, spacing: 0.8em)
  set heading(numbering: "1.")

  show heading.where(level: 1): it => block(above: 1em, below: 0.5em,
    text(size: 10pt, weight: "bold", it))
  show heading.where(level: 2): it => block(above: 0.8em, below: 0.4em,
    text(size: 10pt, weight: "bold", style: "italic", it))
  show heading.where(level: 3): it => block(above: 0.6em, below: 0.3em,
    text(size: 10pt, weight: "bold", it))

  // ── Figures / tables ─────────────────────────────────────────────────────
  set figure(placement: top)
  show figure: set text(size: 8pt)
  show figure.caption: set text(size: 8pt)
  show figure.where(kind: table): set figure.caption(position: top)

  // ── Citations ────────────────────────────────────────────────────────────
  set bibliography(style: "ieee")

  // ── Title block — spans both columns via float ───────────────────────────
  place(
    top + center,
    float: true,
    scope: "parent",
    block(width: 100%, {
      v(0.35in)
      align(center, text(size: 14pt, weight: "bold")[#title])
      v(0.4em)
      _cvpr-authors(authors)
      v(0.5em)
      // Abstract (centered, 90 % width)
      align(center,
        block(width: 90%, {
          text(size: 9pt, weight: "bold")[Abstract]
          v(0.25em)
          align(left, text(size: 9pt)[#abstract])
        })
      )
      v(0.4em)
      line(length: 100%, stroke: 0.4pt)
      v(0.2em)
    })
  )

  doc

  if bibliography != none { bibliography }
}
"#;
