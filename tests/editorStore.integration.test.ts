import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEditorStore, markPathJustWritten, isRecentlyWritten } from "../src/stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(""),
}));

const initialSlice = {
  chatSessions: [],
  activeChatSessionId: null,
  selectedText: null,
  aiProvider: "claude-cli" as const,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  claudeModel: "claude-sonnet-4-6",
  theme: "dark" as const,
  lspStatus: "disconnected" as const,
  previewPages: [] as string[],
  previewLoading: false,
  previewError: null,
  previewZoom: 1,
  compileStatus: "idle" as const,
  useSidecarPreview: true,
  workspacePath: null,
  tabs: [],
  activeTabPath: null,
  activePdfPath: null,
  editorFontSize: 14,
  editorMdFont: '"Source Serif 4", "Charter", "Georgia", "Times New Roman", serif',
  editorTabSize: 2,
  editorWordWrap: true,
  editorMinimap: true,
  editorLineNumbers: true,
  typewriterMode: false,
  editorWidth: 960,
  confirmOnClose: true,
  defaultPreviewZoom: 1,
  writingMode: false,
  mdSourceMode: false,
  references: [],
  sidebarTab: "files" as const,
  aiDockHeight: 280,
  sidebarOpen: true,
  activePanels: [],
  panelLayout: "horizontal" as const,
  showAiSessions: false,
  converterWarnings: [],
  lastEditTime: null,
  lastCompileMs: null,
  compileStartedAt: null,
  scrollToLine: null,
  scrollToPreviewPage: null,
};

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  useEditorStore.setState(initialSlice);
});

// ── markPathJustWritten / isRecentlyWritten ─────────────────────────────────

describe("markPathJustWritten / isRecentlyWritten", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a path as recently written", () => {
    markPathJustWritten("/path/to/file.typ");
    expect(isRecentlyWritten("/path/to/file.typ")).toBe(true);
  });

  it("clears after timeout (800ms)", () => {
    markPathJustWritten("/path/to/file.typ");
    expect(isRecentlyWritten("/path/to/file.typ")).toBe(true);
    vi.advanceTimersByTime(800);
    expect(isRecentlyWritten("/path/to/file.typ")).toBe(false);
  });

  it("returns false for path not written", () => {
    expect(isRecentlyWritten("/nonexistent.typ")).toBe(false);
  });

  it("extends the timer when same path is rewritten", () => {
    markPathJustWritten("/path/to/file.typ");
    vi.advanceTimersByTime(400);
    markPathJustWritten("/path/to/file.typ");
    vi.advanceTimersByTime(400);
    expect(isRecentlyWritten("/path/to/file.typ")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(isRecentlyWritten("/path/to/file.typ")).toBe(false);
  });
});

// ── AI Chat Sessions ────────────────────────────────────────────────────────

describe("AI chat sessions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createSession() {
    vi.advanceTimersByTime(1);
    return useEditorStore.getState().createChatSession();
  }

  it("starts with no sessions", () => {
    expect(useEditorStore.getState().chatSessions).toHaveLength(0);
    expect(useEditorStore.getState().activeChatSessionId).toBeNull();
  });

  it("createChatSession adds a session and sets it active", () => {
    const id = createSession();
    const state = useEditorStore.getState();
    expect(state.chatSessions).toHaveLength(1);
    expect(state.chatSessions[0].id).toBe(id);
    expect(state.chatSessions[0].title).toBe("New chat");
    expect(state.activeChatSessionId).toBe(id);
  });

  it("createChatSession generates non-empty string IDs with session- prefix", () => {
    const id = createSession();
    expect(id).toMatch(/^session-\d+$/);
  });

  it("setActiveChatSession switches active session", () => {
    createSession();
    const id2 = createSession();
    expect(useEditorStore.getState().chatSessions).toHaveLength(2);
    useEditorStore.getState().setActiveChatSession(id2);
    expect(useEditorStore.getState().activeChatSessionId).toBe(id2);
  });

  it("updateChatSession updates messages and auto-titles from first user message", () => {
    const id = createSession();
    useEditorStore.getState().updateChatSession(id, [
      { role: "user", content: "Hello, can you help me write a paper?" },
    ]);
    const session = useEditorStore.getState().chatSessions.find((s) => s.id === id);
    expect(session?.messages).toHaveLength(1);
    expect(session?.title).toBe("Hello, can you help me write a paper?");
    expect(session?.messages[0].content).toBe("Hello, can you help me write a paper?");
  });

  it("updateChatSession truncates long titles to 40 chars", () => {
    const id = createSession();
    const longMessage = "a".repeat(100);
    useEditorStore.getState().updateChatSession(id, [
      { role: "user", content: longMessage },
    ]);
    const session = useEditorStore.getState().chatSessions.find((s) => s.id === id);
    expect(session?.title).toBe("a".repeat(40));
  });

  it("updateChatSession does not change manually renamed title", () => {
    const id = createSession();
    useEditorStore.getState().renameChatSession(id, "My Custom Title");
    useEditorStore.getState().updateChatSession(id, [
      { role: "user", content: "Hello" },
    ]);
    const session = useEditorStore.getState().chatSessions.find((s) => s.id === id);
    expect(session?.title).toBe("My Custom Title");
  });

  it("updateSessionClaudeId stores claude session id", () => {
    const id = createSession();
    useEditorStore.getState().updateSessionClaudeId(id, "claude-session-123");
    const session = useEditorStore.getState().chatSessions.find((s) => s.id === id);
    expect(session?.claudeSessionId).toBe("claude-session-123");
  });

  it("renameChatSession updates title", () => {
    const id = createSession();
    useEditorStore.getState().renameChatSession(id, "Research Notes");
    const session = useEditorStore.getState().chatSessions.find((s) => s.id === id);
    expect(session?.title).toBe("Research Notes");
  });

  it("renameChatSession ignores empty title", () => {
    const id = createSession();
    useEditorStore.getState().renameChatSession(id, "Research");
    useEditorStore.getState().renameChatSession(id, "   ");
    const session = useEditorStore.getState().chatSessions.find((s) => s.id === id);
    expect(session?.title).toBe("Research");
  });

  it("forkChatSession duplicates a session", () => {
    const originalId = createSession();
    useEditorStore.getState().updateChatSession(originalId, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);
    useEditorStore.getState().forkChatSession(originalId);
    const state = useEditorStore.getState();
    expect(state.chatSessions).toHaveLength(2);
    const forked = state.chatSessions.find((s) => s.title === "Fork of Hello");
    expect(forked).toBeDefined();
    expect(forked!.messages).toHaveLength(2);
    expect(forked!.messages[0].content).toBe("Hello");
  });

  it("forkChatSession with invalid id is a no-op", () => {
    createSession();
    useEditorStore.getState().forkChatSession("nonexistent-id");
    expect(useEditorStore.getState().chatSessions).toHaveLength(1);
  });

  it("deleteChatSession removes a session", () => {
    const id = createSession();
    useEditorStore.getState().deleteChatSession(id);
    expect(useEditorStore.getState().chatSessions).toHaveLength(0);
    expect(useEditorStore.getState().activeChatSessionId).toBeNull();
  });

  it("deleteChatSession switches to previous session when deleting active", () => {
    const id1 = createSession();
    const id2 = createSession();
    useEditorStore.getState().setActiveChatSession(id1);
    useEditorStore.getState().deleteChatSession(id1);
    expect(useEditorStore.getState().activeChatSessionId).toBe(id2);
  });

  it("deleteChatSession on nonexistent id does nothing", () => {
    createSession();
    useEditorStore.getState().deleteChatSession("nonexistent");
    expect(useEditorStore.getState().chatSessions).toHaveLength(1);
  });
});

// ── AI Provider ─────────────────────────────────────────────────────────────

describe("AI provider", () => {
  it("defaults to claude-cli", () => {
    expect(useEditorStore.getState().aiProvider).toBe("claude-cli");
  });

  it("setAiProvider changes provider", () => {
    useEditorStore.getState().setAiProvider("ollama");
    expect(useEditorStore.getState().aiProvider).toBe("ollama");
  });

  it("setOllamaUrl updates URL", () => {
    useEditorStore.getState().setOllamaUrl("http://custom:11434");
    expect(useEditorStore.getState().ollamaUrl).toBe("http://custom:11434");
  });

  it("setOllamaModel updates model", () => {
    useEditorStore.getState().setOllamaModel("mistral");
    expect(useEditorStore.getState().ollamaModel).toBe("mistral");
  });

  it("setClaudeModel updates model", () => {
    useEditorStore.getState().setClaudeModel("claude-sonnet-4-7");
    expect(useEditorStore.getState().claudeModel).toBe("claude-sonnet-4-7");
  });
});

// ── selectedText ────────────────────────────────────────────────────────────

describe("selectedText", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().selectedText).toBeNull();
  });

  it("setSelectedText updates value", () => {
    useEditorStore.getState().setSelectedText("selected content");
    expect(useEditorStore.getState().selectedText).toBe("selected content");
  });

  it("setSelectedText(null) clears it", () => {
    useEditorStore.getState().setSelectedText("something");
    useEditorStore.getState().setSelectedText(null);
    expect(useEditorStore.getState().selectedText).toBeNull();
  });
});

// ── References ──────────────────────────────────────────────────────────────

describe("references", () => {
  it("starts empty", () => {
    expect(useEditorStore.getState().references).toHaveLength(0);
  });

  it("addReference adds a reference", () => {
    useEditorStore.getState().addReference({
      name: "paper.pdf",
      kind: "pdf",
      path: "/path/to/paper.pdf",
      bibKey: "smith2024",
      title: "A Great Paper",
      authors: ["John Smith"],
      year: 2024,
    });
    const refs = useEditorStore.getState().references;
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("paper.pdf");
    expect(refs[0].bibKey).toBe("smith2024");
    expect(refs[0].id).toBeDefined();
    expect(refs[0].addedAt).toBeGreaterThan(0);
  });

  it("adds references to the front of the list", () => {
    useEditorStore.getState().addReference({ name: "first", kind: "pdf" });
    useEditorStore.getState().addReference({ name: "second", kind: "pdf" });
    expect(useEditorStore.getState().references[0].name).toBe("second");
  });

  it("removeReference removes by id", () => {
    useEditorStore.getState().addReference({ name: "test", kind: "bib" });
    const id = useEditorStore.getState().references[0].id;
    useEditorStore.getState().removeReference(id);
    expect(useEditorStore.getState().references).toHaveLength(0);
  });

  it("removeReference with unknown id is a no-op", () => {
    useEditorStore.getState().addReference({ name: "test", kind: "pdf" });
    useEditorStore.getState().removeReference("nonexistent-id");
    expect(useEditorStore.getState().references).toHaveLength(1);
  });

  it("clearReferences removes all references", () => {
    useEditorStore.getState().addReference({ name: "a", kind: "pdf" });
    useEditorStore.getState().addReference({ name: "b", kind: "bib" });
    useEditorStore.getState().clearReferences();
    expect(useEditorStore.getState().references).toHaveLength(0);
  });
});

// ── Sidebar, Panels, Layout ─────────────────────────────────────────────────

describe("sidebar and panels", () => {
  it("sidebarTab defaults to files", () => {
    expect(useEditorStore.getState().sidebarTab).toBe("files");
  });

  it("setSidebarTab switches tab", () => {
    useEditorStore.getState().setSidebarTab("references");
    expect(useEditorStore.getState().sidebarTab).toBe("references");
  });

  it("sidebarOpen defaults to true", () => {
    expect(useEditorStore.getState().sidebarOpen).toBe(true);
  });

  it("setSidebarOpen toggles", () => {
    useEditorStore.getState().setSidebarOpen(false);
    expect(useEditorStore.getState().sidebarOpen).toBe(false);
  });

  it("setActivePanels updates panel list", () => {
    useEditorStore.getState().setActivePanels(["editor", "preview"]);
    expect(useEditorStore.getState().activePanels).toEqual(["editor", "preview"]);
  });

  it("panelLayout defaults to horizontal", () => {
    expect(useEditorStore.getState().panelLayout).toBe("horizontal");
  });

  it("setPanelLayout changes layout", () => {
    useEditorStore.getState().setPanelLayout("vertical");
    expect(useEditorStore.getState().panelLayout).toBe("vertical");
  });

  it("setAiDockHeight clamps to 0 minimum", () => {
    useEditorStore.getState().setAiDockHeight(-100);
    expect(useEditorStore.getState().aiDockHeight).toBe(0);
  });
});

// ── Editor settings ─────────────────────────────────────────────────────────

describe("editor settings", () => {
  it("editorTabSize defaults to 2", () => {
    expect(useEditorStore.getState().editorTabSize).toBe(2);
  });

  it("setEditorTabSize clamps min to 1", () => {
    useEditorStore.getState().setEditorTabSize(0);
    expect(useEditorStore.getState().editorTabSize).toBe(1);
  });

  it("setEditorTabSize clamps max to 8", () => {
    useEditorStore.getState().setEditorTabSize(20);
    expect(useEditorStore.getState().editorTabSize).toBe(8);
  });

  it("setEditorTabSize rounds to nearest integer", () => {
    useEditorStore.getState().setEditorTabSize(3.7);
    expect(useEditorStore.getState().editorTabSize).toBe(4);
  });

  it("setEditorWidth clamps min to 480", () => {
    useEditorStore.getState().setEditorWidth(100);
    expect(useEditorStore.getState().editorWidth).toBe(480);
  });

  it("setEditorWidth clamps max to 1600", () => {
    useEditorStore.getState().setEditorWidth(2000);
    expect(useEditorStore.getState().editorWidth).toBe(1600);
  });

  it("editorWordWrap toggles", () => {
    useEditorStore.getState().setEditorWordWrap(false);
    expect(useEditorStore.getState().editorWordWrap).toBe(false);
    useEditorStore.getState().setEditorWordWrap(true);
    expect(useEditorStore.getState().editorWordWrap).toBe(true);
  });

  it("editorMinimap toggles", () => {
    useEditorStore.getState().setEditorMinimap(false);
    expect(useEditorStore.getState().editorMinimap).toBe(false);
  });

  it("editorLineNumbers toggles", () => {
    useEditorStore.getState().setEditorLineNumbers(false);
    expect(useEditorStore.getState().editorLineNumbers).toBe(false);
  });

  it("typewriterMode toggles", () => {
    useEditorStore.getState().setTypewriterMode(true);
    expect(useEditorStore.getState().typewriterMode).toBe(true);
  });

  it("setEditorMdFont updates font", () => {
    useEditorStore.getState().setEditorMdFont("Georgia");
    expect(useEditorStore.getState().editorMdFont).toBe("Georgia");
  });
});

// ── Writing/Markdown mode ────────────────────────────────────────────────────

describe("writing and markdown modes", () => {
  it("writingMode defaults to false", () => {
    expect(useEditorStore.getState().writingMode).toBe(false);
  });

  it("setWritingMode toggles", () => {
    useEditorStore.getState().setWritingMode(true);
    expect(useEditorStore.getState().writingMode).toBe(true);
  });

  it("mdSourceMode defaults to false", () => {
    expect(useEditorStore.getState().mdSourceMode).toBe(false);
  });

  it("setMdSourceMode toggles", () => {
    useEditorStore.getState().setMdSourceMode(true);
    expect(useEditorStore.getState().mdSourceMode).toBe(true);
  });
});

// ── Misc state ──────────────────────────────────────────────────────────────

describe("misc state", () => {
  it("activePdfPath defaults to null", () => {
    expect(useEditorStore.getState().activePdfPath).toBeNull();
  });

  it("setActivePdfPath updates path", () => {
    useEditorStore.getState().setActivePdfPath("/path/to/doc.pdf");
    expect(useEditorStore.getState().activePdfPath).toBe("/path/to/doc.pdf");
  });

  it("showAiSessions defaults to false", () => {
    expect(useEditorStore.getState().showAiSessions).toBe(false);
  });

  it("setShowAiSessions toggles", () => {
    useEditorStore.getState().setShowAiSessions(true);
    expect(useEditorStore.getState().showAiSessions).toBe(true);
  });

  it("converterWarnings defaults to empty", () => {
    expect(useEditorStore.getState().converterWarnings).toEqual([]);
  });

  it("setConverterWarnings updates warnings", () => {
    useEditorStore.getState().setConverterWarnings(["Warning 1", "Warning 2"]);
    expect(useEditorStore.getState().converterWarnings).toEqual(["Warning 1", "Warning 2"]);
  });

  it("scrollToPreviewPage defaults to null", () => {
    expect(useEditorStore.getState().scrollToPreviewPage).toBeNull();
  });

  it("setScrollToPreviewPage updates value", () => {
    useEditorStore.getState().setScrollToPreviewPage(3);
    expect(useEditorStore.getState().scrollToPreviewPage).toBe(3);
  });
});
