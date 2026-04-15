import { create } from "zustand";
import type { LspStatus } from "../components/Editor/lsp-client";

export interface Tab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export type AppTheme = "dark" | "claude";

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
  setPreview: (pages: string[]) => void;
  setPreviewLoading: (v: boolean) => void;
  setPreviewError: (err: string | null) => void;

  // Workspace
  workspacePath: string | null;
  setWorkspacePath: (path: string) => void;

  // Open tabs
  tabs: Tab[];
  activeTabPath: string | null;
  openTab: (path: string, name: string, content: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  markTabClean: (path: string) => void;

  // Active tab helpers
  activeTab: () => Tab | null;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  theme: "dark",
  setTheme: (theme) => set({ theme }),

  lspStatus: "disconnected",
  setLspStatus: (status) => set({ lspStatus: status }),

  previewPages: [],
  previewLoading: false,
  previewError: null,
  setPreview: (pages) => set({ previewPages: pages, previewError: null }),
  setPreviewLoading: (v) => set({ previewLoading: v }),
  setPreviewError: (err) => set({ previewError: err, previewLoading: false }),

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

  activeTab: () => {
    const { tabs, activeTabPath } = get();
    return tabs.find((t) => t.path === activeTabPath) ?? null;
  },
}));
