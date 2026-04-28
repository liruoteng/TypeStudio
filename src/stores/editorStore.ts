import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { LspStatus } from "../components/Editor/lsp-client";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiChatSession {
  id: string;
  title: string;
  messages: AiMessage[];
  createdAt: number;
  claudeSessionId?: string; // CLI session for --resume
}

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
  // AI chat sessions
  chatSessions: AiChatSession[];
  activeChatSessionId: string | null;
  createChatSession: () => string;
  setActiveChatSession: (id: string) => void;
  updateChatSession: (id: string, messages: AiMessage[]) => void;
  updateSessionClaudeId: (id: string, claudeSessionId: string) => void;
  renameChatSession: (id: string, title: string) => void;
  forkChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;

  // AI editor integration
  selectedText: string | null;
  setSelectedText: (text: string | null) => void;
  aiProvider: "claude-cli" | "ollama";
  setAiProvider: (p: "claude-cli" | "ollama") => void;
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  ollamaModel: string;
  setOllamaModel: (model: string) => void;
  claudeModel: string;
  setClaudeModel: (model: string) => void;

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
  openTempTab: (kind?: "typ" | "md") => void;
  promoteTempTab: (oldPath: string, newPath: string, newName: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  markTabClean: (path: string) => void;

  // Editor settings
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  editorTabSize: number;
  setEditorTabSize: (n: number) => void;
  editorWordWrap: boolean;
  setEditorWordWrap: (v: boolean) => void;
  editorMinimap: boolean;
  setEditorMinimap: (v: boolean) => void;
  editorLineNumbers: boolean;
  setEditorLineNumbers: (v: boolean) => void;

  // General settings
  confirmOnClose: boolean;
  setConfirmOnClose: (v: boolean) => void;
  defaultPreviewZoom: number;
  setDefaultPreviewZoom: (n: number) => void;

  // Persisted settings lifecycle
  hydrateSettings: () => Promise<void>;

  // Writing mode
  writingMode: boolean;
  setWritingMode: (v: boolean) => void;

  // Metrics
  lastEditTime: number | null;
  setLastEditTime: (t: number) => void;
  lastCompileMs: number | null;
  setLastCompileMs: (ms: number) => void;
  compileStartedAt: number | null;

  // Preview ↔ editor sync
  scrollToLine: number | null;
  setScrollToLine: (line: number | null) => void;
  scrollToPreviewPage: number | null;
  setScrollToPreviewPage: (page: number | null) => void;

  // Active tab helpers
  activeTab: () => Tab | null;
}

// ── Settings persistence ────────────────────────────────────────────────────
// Keys persisted to disk via Tauri (settings.json in app config dir).
const PERSISTED_KEYS = [
  "theme",
  "editorFontSize",
  "editorTabSize",
  "editorWordWrap",
  "editorMinimap",
  "editorLineNumbers",
  "useSidecarPreview",
  "defaultPreviewZoom",
  "confirmOnClose",
  "aiProvider",
  "ollamaUrl",
  "ollamaModel",
  "claudeModel",
  "chatSessions",
  "activeChatSessionId",
  "writingMode",
] as const;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(getState: () => EditorState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = getState();
    const payload: Record<string, unknown> = {};
    for (const k of PERSISTED_KEYS) payload[k] = (s as unknown as Record<string, unknown>)[k];
    invoke("write_settings", { contents: JSON.stringify(payload, null, 2) }).catch(console.error);
  }, 150);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  chatSessions: [],
  activeChatSessionId: null,
  createChatSession: () => {
    const id = `session-${Date.now()}`;
    const session: AiChatSession = { id, title: "New chat", messages: [], createdAt: Date.now() };
    set((s) => ({ chatSessions: [...s.chatSessions, session], activeChatSessionId: id }));
    schedulePersist(get);
    return id;
  },
  setActiveChatSession: (id) => { set({ activeChatSessionId: id }); schedulePersist(get); },
  updateChatSession: (id, messages) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : {
          ...sess,
          messages,
          title: sess.title === "New chat" && messages.length > 0
            ? (messages.find((m) => m.role === "user")?.content.slice(0, 40) ?? "New chat")
            : sess.title,
        }
      ),
    }));
    schedulePersist(get);
  },
  updateSessionClaudeId: (id, claudeSessionId) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : { ...sess, claudeSessionId }
      ),
    }));
    schedulePersist(get);
  },
  renameChatSession: (id, title) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id !== id ? sess : { ...sess, title: title.trim() || sess.title }
      ),
    }));
    schedulePersist(get);
  },
  forkChatSession: (id) => {
    const original = get().chatSessions.find((s) => s.id === id);
    if (!original) return;
    const newId = `session-${Date.now()}`;
    const forked: AiChatSession = {
      id: newId,
      title: `Fork of ${original.title}`,
      messages: [...original.messages],
      createdAt: Date.now(),
    };
    set((s) => ({ chatSessions: [...s.chatSessions, forked], activeChatSessionId: newId }));
    schedulePersist(get);
  },
  deleteChatSession: (id) => {
    set((s) => {
      const remaining = s.chatSessions.filter((sess) => sess.id !== id);
      const nextActive =
        s.activeChatSessionId === id ? (remaining[remaining.length - 1]?.id ?? null) : s.activeChatSessionId;
      return { chatSessions: remaining, activeChatSessionId: nextActive };
    });
    schedulePersist(get);
  },

  selectedText: null,
  setSelectedText: (text) => set({ selectedText: text }),
  aiProvider: "claude-cli",
  setAiProvider: (p) => { set({ aiProvider: p }); schedulePersist(get); },
  ollamaUrl: "http://localhost:11434",
  setOllamaUrl: (url) => { set({ ollamaUrl: url }); schedulePersist(get); },
  ollamaModel: "llama3.2",
  setOllamaModel: (model) => { set({ ollamaModel: model }); schedulePersist(get); },
  claudeModel: "claude-sonnet-4-6",
  setClaudeModel: (model) => { set({ claudeModel: model }); schedulePersist(get); },

  theme: (localStorage.getItem("app-theme") as AppTheme | null) ?? "dark",
  setTheme: (theme) => {
    localStorage.setItem("app-theme", theme);
    set({ theme });
    schedulePersist(get);
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

  setPreviewLoading: (v) => set(v ? { previewLoading: true, compileStartedAt: performance.now() } : { previewLoading: false }),
  setPreviewError: (err) => set({ previewError: err, previewLoading: false, compileStatus: "error" }),
  setPreviewZoom: (zoom) => set({ previewZoom: Math.min(4, Math.max(0.25, zoom)) }),

  useSidecarPreview: (localStorage.getItem("use-sidecar-preview") ?? "1") === "1",
  setUseSidecarPreview: (v) => {
    localStorage.setItem("use-sidecar-preview", v ? "1" : "0");
    set({ useSidecarPreview: v });
    schedulePersist(get);
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

  openTempTab: (kind = "typ") => {
    const ext = kind === "md" ? "md" : "typ";
    const name = `untitled.${ext}`;
    const tempPath = `__temp__/${name}`;
    const existing = get().tabs.find((t) => t.path === tempPath);
    if (existing) {
      set({ activeTabPath: tempPath });
      return;
    }
    set((s) => ({
      tabs: [...s.tabs, { path: tempPath, name, content: "", isDirty: false, isTemp: true }],
      activeTabPath: tempPath,
    }));
  },

  promoteTempTab: (oldPath, newPath, newName) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === oldPath
          ? { ...t, path: newPath, name: newName, isDirty: false, isTemp: false }
          : t
      ),
      activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath,
    })),

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
  setEditorFontSize: (size) => {
    set({ editorFontSize: Math.min(32, Math.max(8, size)) });
    schedulePersist(get);
  },
  editorTabSize: 2,
  setEditorTabSize: (n) => {
    set({ editorTabSize: Math.min(8, Math.max(1, Math.round(n))) });
    schedulePersist(get);
  },
  editorWordWrap: true,
  setEditorWordWrap: (v) => { set({ editorWordWrap: v }); schedulePersist(get); },
  editorMinimap: true,
  setEditorMinimap: (v) => { set({ editorMinimap: v }); schedulePersist(get); },
  editorLineNumbers: true,
  setEditorLineNumbers: (v) => { set({ editorLineNumbers: v }); schedulePersist(get); },

  confirmOnClose: true,
  setConfirmOnClose: (v) => { set({ confirmOnClose: v }); schedulePersist(get); },
  defaultPreviewZoom: 1,
  setDefaultPreviewZoom: (n) => {
    set({ defaultPreviewZoom: Math.min(4, Math.max(0.25, n)) });
    schedulePersist(get);
  },

  hydrateSettings: async () => {
    try {
      const raw = await invoke<string>("read_settings");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<(typeof PERSISTED_KEYS)[number], unknown>>;
      const patch: Partial<EditorState> = {};
      if (typeof parsed.theme === "string") patch.theme = parsed.theme as AppTheme;
      if (typeof parsed.editorFontSize === "number") patch.editorFontSize = parsed.editorFontSize;
      if (typeof parsed.editorTabSize === "number") patch.editorTabSize = parsed.editorTabSize;
      if (typeof parsed.editorWordWrap === "boolean") patch.editorWordWrap = parsed.editorWordWrap;
      if (typeof parsed.editorMinimap === "boolean") patch.editorMinimap = parsed.editorMinimap;
      if (typeof parsed.editorLineNumbers === "boolean") patch.editorLineNumbers = parsed.editorLineNumbers;
      if (typeof parsed.useSidecarPreview === "boolean") patch.useSidecarPreview = parsed.useSidecarPreview;
      if (typeof parsed.defaultPreviewZoom === "number") {
        patch.defaultPreviewZoom = parsed.defaultPreviewZoom;
        patch.previewZoom = parsed.defaultPreviewZoom;
      }
      if (typeof parsed.confirmOnClose === "boolean") patch.confirmOnClose = parsed.confirmOnClose;
      // Migrate old "claude" provider value to "claude-cli"
      if (parsed.aiProvider === "claude" || parsed.aiProvider === "claude-cli") patch.aiProvider = "claude-cli";
      else if (parsed.aiProvider === "ollama") patch.aiProvider = "ollama";
      if (typeof parsed.ollamaUrl === "string") patch.ollamaUrl = parsed.ollamaUrl;
      if (typeof parsed.ollamaModel === "string") patch.ollamaModel = parsed.ollamaModel;
      if (typeof parsed.claudeModel === "string") patch.claudeModel = parsed.claudeModel;
      if (Array.isArray(parsed.chatSessions)) patch.chatSessions = parsed.chatSessions as AiChatSession[];
      if (typeof parsed.activeChatSessionId === "string") patch.activeChatSessionId = parsed.activeChatSessionId;
      if (typeof parsed.writingMode === "boolean") patch.writingMode = parsed.writingMode;
      set(patch);
    } catch (e) {
      console.error("hydrateSettings failed", e);
    }
  },

  writingMode: false,
  setWritingMode: (v) => { set({ writingMode: v }); schedulePersist(get); },

  lastEditTime: null,
  setLastEditTime: (t) => set({ lastEditTime: t }),
  lastCompileMs: null,
  setLastCompileMs: (ms) => set({ lastCompileMs: ms }),
  compileStartedAt: null,

  scrollToLine: null,
  setScrollToLine: (line) => set({ scrollToLine: line }),
  scrollToPreviewPage: null,
  setScrollToPreviewPage: (page) => set({ scrollToPreviewPage: page }),

  activeTab: () => {
    const { tabs, activeTabPath } = get();
    return tabs.find((t) => t.path === activeTabPath) ?? null;
  },
}));
