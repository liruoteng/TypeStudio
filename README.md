# Type Studio

A desktop AI-Powered writing app for [Typst](https://typst.app) and MarkDown

## What it does

- **Live preview.** Edit on the left, see the rendered PDF on the right.
    **View → Toggle Sidecar Preview** (⌘⇧P).
- **Monaco editor** with a Typst language mode, slash-command palette, and
  Cmd+S snapshots so you can walk back to any earlier save.
- **Markdown mode.** Open `.md` and the app converts it to a hidden `.typ`
  so you get the same live preview without leaving Markdown.
- **LSP features** from tinymist: diagnostics, hover, completion, go-to.
- **File tree** with create/rename/delete, watched for external changes.
- **PDF export** via the current file's Typst world.

## Running

Prerequisites: Rust (stable), Node 20+, and Xcode command-line tools on
macOS.

```bash
npm install
npm run tauri dev      # dev build + hot reload
npm run tauri build    # production app bundle
```

A bundled `tinymist` binary is resolved at startup; no separate install
needed.

## Tests

```bash
npm run test:run                       # frontend (Vitest, jsdom)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust side
```

84 frontend tests and 61 Rust tests at last count.


## Layout

```
src/                 React app
  components/        Editor, Preview, FileExplorer, Layout, FileHistory
  stores/            Zustand editor store
  hooks/             usePreview, etc.
src-tauri/           Rust backend
  src/lib.rs         commands, menu, compile actor
  src/preview_sidecar.rs   tinymist preview process manager
  src/lsp_bridge.rs  LSP WebSocket bridge to tinymist
```

## Status

Early, single-developer project. Expect rough edges; file issues freely.
