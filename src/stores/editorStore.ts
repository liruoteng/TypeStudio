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

interface EditorState {
  // LSP
  lspStatus: LspStatus;
  setLspStatus: (status: LspStatus) => void;

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
  lspStatus: "disconnected",
  setLspStatus: (status) => set({ lspStatus: status }),

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
