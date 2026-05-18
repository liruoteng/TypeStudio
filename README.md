# Type Studio

A desktop AI-powered writing app for [Typst](https://typst.app) and Markdown.

Built with [Tauri v2](https://v2.tauri.app), React 19, and Rust. Features a Monaco editor with Typst language support, a WYSIWYG Markdown editor (Milkdown), live PDF preview via tinymist, LSP integration, version snapshots, AI chat (Claude CLI / Ollama), LaTeX import, and a fully customizable panel layout.

## Features

- **Dual editors** — Monaco (source mode with Typst syntax highlighting) or Markdown (WYSIWYG for Markdown). Supports Typst (`.typ`) and Markdown (`.md`); Markdown is transparently converted to Typst for live preview.
- **Live PDF preview** — Edit on the left, see the rendered PDF on the right. Toggle with **View → Toggle Sidecar Preview** (`⌘⇧P`).
- **LSP support** — Diagnostics, hover info, autocompletion, and go-to-definition via tinymist, bridged through WebSocket.
- **File management** — Tab-based editing, file tree explorer (create / rename / delete), workspace folders, and file watchers for external changes.
- **PDF export** — Export any `.typ` file to PDF and open the result immediately.
- **Version snapshots** — Automatic snapshots on save; browse and restore earlier versions from the history panel.
- **AI assistant** — Chat panel supporting Claude CLI and Ollama. Fork sessions, rename chats, and continue conversations.
- **LaTeX import** — Import LaTeX template bundles (`.zip`) and convert them to Typst projects with a detailed report.
- **References panel** — Manage papers via local PDFs, `.bib` entries, and links with citation keys.
- **Writing mode** — Distraction-free mode that hides the preview panel.
- **Customizable layout** — Panels for AI Chat, Editor, Preview, Outline, and PDF Viewer. Switch between horizontal (side-by-side) and vertical (stacked) arrangements.
- **Dark theme** — "dark" and "claude" theme variants.

## Installation

### Prerequisites

**Node.js 20+**

Install via [nvm](https://github.com/nvm-sh/nvm) (recommended) or directly from [nodejs.org](https://nodejs.org):

```bash
# Using nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
nvm install 22
nvm use 22
```

**Rust**

Install via [rustup](https://rustup.rs):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Xcode Command-Line Tools** (macOS)

```bash
xcode-select --install
```

### Run

```bash
npm install
npm run tauri dev      # dev build with hot reload
npm run tauri build    # production app bundle
```

A bundled `tinymist` binary is resolved at startup — no separate installation is needed.

## Tests

```bash
npm run test:run                       # frontend (Vitest, jsdom)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust side
```

