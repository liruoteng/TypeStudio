import { create } from "zustand";
import type { LspStatus } from "../components/Editor/lsp-client";

export interface Tab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  isTemp?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export type AppTheme = "dark" | "claude";
export type CompileStatus = "idle" | "success" | "error";

interface EditorState {
  // Theme
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;

  // LSP
  lspStatus: LspStatus;
  setLspStatus: (status: LspStatus) => void;

  // Preview
  previewPages: string[];       // SVG strings, one per page
  previewLoading: boolean;
  previewError: string | null;
  previewZoom: number;          // 1.0 = 100%
  compileStatus: CompileStatus;
  setPreview: (pages: string[]) => void;
  applyPreviewUpdate: (totalPages: number, updates: { index: number; svg: string }[]) => void;
  setPreviewLoading: (v: boolean) => void;
  setPreviewError: (err: string | null) => void;
  setPreviewZoom: (zoom: number) => void;

  // Sidecar preview: when true, render an <iframe> pointing at a
  // `tinymist preview` child process instead of compiling SVG in-process.
  useSidecarPreview: boolean;
  setUseSidecarPreview: (v: boolean) => void;

  // Workspace
  workspacePath: string | null;
  setWorkspacePath: (path: string) => void;

  // Open tabs
  tabs: Tab[];
  activeTabPath: string | null;
  openTab: (path: string, name: string, content: string) => void;
  openTempTab: () => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  markTabClean: (path: string) => void;

  // Editor settings
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;

  // Metrics
  lastEditTime: number | null;
  setLastEditTime: (t: number) => void;
  lastCompileMs: number | null;
  setLastCompileMs: (ms: number) => void;

  // Preview ↔ editor sync
  scrollToLine: number | null;
  setScrollToLine: (line: number | null) => void;

  // Active tab helpers
  activeTab: () => Tab | null;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  theme: (localStorage.getItem("app-theme") as AppTheme | null) ?? "dark",
  setTheme: (theme) => {
    localStorage.setItem("app-theme", theme);
    set({ theme });
  },

  lspStatus: "disconnected",
  setLspStatus: (status) => set({ lspStatus: status }),

  previewPages: [],
  previewLoading: false,
  previewError: null,
  previewZoom: 1,
  compileStatus: "idle",
  setPreview: (pages) => set({ previewPages: pages, previewError: null, compileStatus: "success" }),

  applyPreviewUpdate: (totalPages, updates) =>
    set((s) => {
      // Resize array if page count changed; reuse existing strings otherwise
      // so per-page Zustand selectors only fire for pages that actually changed.
      const prev = s.previewPages;
      const pages =
        prev.length === totalPages
          ? prev.slice()
          : [
              ...prev.slice(0, totalPages),
              ...Array<string>(Math.max(0, totalPages - prev.length)).fill(""),
            ];
      for (const { index, svg } of updates) {
        if (index < totalPages) pages[index] = svg;
      }
      return { previewPages: pages, previewError: null, compileStatus: "success" };
    }),

  setPreviewLoading: (v) => set({ previewLoading: v }),
  setPreviewError: (err) => set({ previewError: err, previewLoading: false, compileStatus: "error" }),
  setPreviewZoom: (zoom) => set({ previewZoom: Math.min(4, Math.max(0.25, zoom)) }),

  useSidecarPreview: (localStorage.getItem("use-sidecar-preview") ?? "1") === "1",
  setUseSidecarPreview: (v) => {
    localStorage.setItem("use-sidecar-preview", v ? "1" : "0");
    set({ useSidecarPreview: v });
  },

  workspacePath: null,
  setWorkspacePath: (path) => set({ workspacePath: path }),

  tabs: [],
  activeTabPath: null,

  openTab: (path, name, content) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeTabPath: path });
      return;
    }
    set((s) => ({
      tabs: [...s.tabs, { path, name, content, isDirty: false }],
      activeTabPath: path,
    }));
  },

  openTempTab: () => {
    const tempPath = "__temp__/untitled.typ";
    const existing = get().tabs.find((t) => t.path === tempPath);
    if (existing) {
      set({ activeTabPath: tempPath });
      return;
    }
    set((s) => ({
      tabs: [...s.tabs, { path: tempPath, name: "untitled.typ", content: "", isDirty: false, isTemp: true }],
      activeTabPath: tempPath,
    }));
  },

  closeTab: (path) => {
    const { tabs, activeTabPath } = get();
    const idx = tabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.path !== path);
    let nextActive = activeTabPath;
    if (activeTabPath === path) {
      nextActive = next[Math.max(0, idx - 1)]?.path ?? null;
    }
    set({ tabs: next, activeTabPath: nextActive });
  },

  setActiveTab: (path) => set({ activeTabPath: path }),

  updateTabContent: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, content, isDirty: true } : t
      ),
    })),

  markTabClean: (path) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, isDirty: false } : t
      ),
    })),

  editorFontSize: 14,
  setEditorFontSize: (size) => set({ editorFontSize: Math.min(32, Math.max(8, size)) }),

  lastEditTime: null,
  setLastEditTime: (t) => set({ lastEditTime: t }),
  lastCompileMs: null,
  setLastCompileMs: (ms) => set({ lastCompileMs: ms }),

  scrollToLine: null,
  setScrollToLine: (line) => set({ scrollToLine: line }),

  activeTab: () => {
    const { tabs, activeTabPath } = get();
    return tabs.find((t) => t.path === activeTabPath) ?? null;
  },
}));
