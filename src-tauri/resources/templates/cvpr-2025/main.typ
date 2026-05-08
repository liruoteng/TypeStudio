#import "/cvpr.typ": cvpr2025, conf-name, conf-year, eg, etal, indent
#import "/logo.typ": LaTeX, TeX

// ── Author affiliations ────────────────────────────────────────────────────
// Add entries here for each unique institution.
#let affls = (
  one: (institution: "Institution 1", location: "City, Country"),
  two: (institution: "Institution 2", location: "City, Country"),
)

// ── Author list ────────────────────────────────────────────────────────────
// affl must match keys defined in `affls` above.
#let authors = (
  (name: "First Author",  affl: ("one",), email: "author1@institution.edu"),
  (name: "Second Author", affl: ("two",), email: "author2@institution.edu"),
)

// ── Paper metadata ─────────────────────────────────────────────────────────
#show: cvpr2025.with(
  title: [Paper Title],
  authors: (authors, affls),
  keywords: ("keyword1", "keyword2", "keyword3"),
  abstract: [
    Replace this with your abstract. Aim for 150--250 words summarizing
    the problem, your approach, and key results.
  ],
  bibliography: bibliography("refs.bib"),
  accepted: false,
  id: none,
)

// ── Paper body ─────────────────────────────────────────────────────────────
// Written in content.md — edit that file to write your paper.
// content.typ is auto-generated from content.md on every save.
#include "content.typ"
