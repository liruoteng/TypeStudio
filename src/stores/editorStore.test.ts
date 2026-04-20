import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";

// Reset store state before each test so tests are isolated.
const initialSlice = {
  theme: "dark" as const,
  lspStatus: "disconnected" as const,
  previewPages: [] as string[],
  previewLoading: false,
  previewError: null,
  previewZoom: 1,
  compileStatus: "idle" as const,
  workspacePath: null,
  tabs: [],
  activeTabPath: null,
  editorFontSize: 14,
  lastEditTime: null,
  lastCompileMs: null,
  scrollToLine: null,
};

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState(initialSlice);
});

// ── Theme ──────────────────────────────────────────────────────────────────

describe("theme", () => {
  it("defaults to dark", () => {
    expect(useEditorStore.getState().theme).toBe("dark");
  });

  it("setTheme updates theme state", () => {
    useEditorStore.getState().setTheme("claude");
    expect(useEditorStore.getState().theme).toBe("claude");
  });

  it("setTheme persists to localStorage", () => {
    useEditorStore.getState().setTheme("claude");
    expect(localStorage.getItem("app-theme")).toBe("claude");
  });

  it("setTheme back to dark persists correctly", () => {
    useEditorStore.getState().setTheme("claude");
    useEditorStore.getState().setTheme("dark");
    expect(localStorage.getItem("app-theme")).toBe("dark");
    expect(useEditorStore.getState().theme).toBe("dark");
  });
});

// ── LSP status ─────────────────────────────────────────────────────────────

describe("lspStatus", () => {
  it("defaults to disconnected", () => {
    expect(useEditorStore.getState().lspStatus).toBe("disconnected");
  });

  it("setLspStatus updates status", () => {
    useEditorStore.getState().setLspStatus("connected");
    expect(useEditorStore.getState().lspStatus).toBe("connected");
  });

  it("cycles through all states", () => {
    const { setLspStatus } = useEditorStore.getState();
    setLspStatus("connecting");
    expect(useEditorStore.getState().lspStatus).toBe("connecting");
    setLspStatus("connected");
    expect(useEditorStore.getState().lspStatus).toBe("connected");
    setLspStatus("disconnected");
    expect(useEditorStore.getState().lspStatus).toBe("disconnected");
  });
});

// ── Preview ────────────────────────────────────────────────────────────────

describe("preview", () => {
  it("setPreview sets pages, clears error, sets status=success", () => {
    useEditorStore.setState({ previewError: "old error" });
    useEditorStore.getState().setPreview(["<svg>a</svg>", "<svg>b</svg>"]);
    const s = useEditorStore.getState();
    expect(s.previewPages).toEqual(["<svg>a</svg>", "<svg>b</svg>"]);
    expect(s.previewError).toBeNull();
    expect(s.compileStatus).toBe("success");
  });

  it("setPreviewLoading updates loading flag", () => {
    useEditorStore.getState().setPreviewLoading(true);
    expect(useEditorStore.getState().previewLoading).toBe(true);
    useEditorStore.getState().setPreviewLoading(false);
    expect(useEditorStore.getState().previewLoading).toBe(false);
  });

  it("setPreviewError sets error, clears loading, sets status=error", () => {
    useEditorStore.setState({ previewLoading: true });
    useEditorStore.getState().setPreviewError("compile failed");
    const s = useEditorStore.getState();
    expect(s.previewError).toBe("compile failed");
    expect(s.previewLoading).toBe(false);
    expect(s.compileStatus).toBe("error");
  });

  it("setPreviewError(null) clears error", () => {
    useEditorStore.getState().setPreviewError("some error");
    useEditorStore.getState().setPreviewError(null);
    expect(useEditorStore.getState().previewError).toBeNull();
  });

  it("setPreviewZoom clamps to min 0.25", () => {
    useEditorStore.getState().setPreviewZoom(0.1);
    expect(useEditorStore.getState().previewZoom).toBe(0.25);
  });

  it("setPreviewZoom clamps to max 4", () => {
    useEditorStore.getState().setPreviewZoom(10);
    expect(useEditorStore.getState().previewZoom).toBe(4);
  });

  it("setPreviewZoom accepts value within range", () => {
    useEditorStore.getState().setPreviewZoom(1.5);
    expect(useEditorStore.getState().previewZoom).toBe(1.5);
  });

  it("setPreviewZoom accepts exact min", () => {
    useEditorStore.getState().setPreviewZoom(0.25);
    expect(useEditorStore.getState().previewZoom).toBe(0.25);
  });

  it("setPreviewZoom accepts exact max", () => {
    useEditorStore.getState().setPreviewZoom(4);
    expect(useEditorStore.getState().previewZoom).toBe(4);
  });
});

// ── applyPreviewUpdate ─────────────────────────────────────────────────────

describe("applyPreviewUpdate", () => {
  it("populates empty pages from updates", () => {
    useEditorStore.getState().applyPreviewUpdate(2, [
      { index: 0, svg: "svg0" },
      { index: 1, svg: "svg1" },
    ]);
    expect(useEditorStore.getState().previewPages).toEqual(["svg0", "svg1"]);
  });

  it("sets compileStatus=success and clears error", () => {
    useEditorStore.setState({ previewError: "old", compileStatus: "error" });
    useEditorStore.getState().applyPreviewUpdate(1, [{ index: 0, svg: "s" }]);
    const s = useEditorStore.getState();
    expect(s.compileStatus).toBe("success");
    expect(s.previewError).toBeNull();
  });

  it("extends pages when totalPages > current length", () => {
    useEditorStore.setState({ previewPages: ["old0"] });
    useEditorStore.getState().applyPreviewUpdate(3, [{ index: 2, svg: "svg2" }]);
    const pages = useEditorStore.getState().previewPages;
    expect(pages).toHaveLength(3);
    expect(pages[0]).toBe("old0");
    expect(pages[1]).toBe("");
    expect(pages[2]).toBe("svg2");
  });

  it("truncates pages when totalPages < current length", () => {
    useEditorStore.setState({ previewPages: ["a", "b", "c"] });
    useEditorStore.getState().applyPreviewUpdate(2, []);
    expect(useEditorStore.getState().previewPages).toEqual(["a", "b"]);
  });

  it("updates only changed pages in-place", () => {
    useEditorStore.setState({ previewPages: ["orig0", "orig1"] });
    useEditorStore.getState().applyPreviewUpdate(2, [{ index: 0, svg: "new0" }]);
    const pages = useEditorStore.getState().previewPages;
    expect(pages[0]).toBe("new0");
    expect(pages[1]).toBe("orig1");
  });

  it("ignores updates with index >= totalPages", () => {
    useEditorStore.getState().applyPreviewUpdate(1, [
      { index: 0, svg: "valid" },
      { index: 5, svg: "out-of-range" },
    ]);
    expect(useEditorStore.getState().previewPages).toHaveLength(1);
    expect(useEditorStore.getState().previewPages[0]).toBe("valid");
  });
});

// ── Workspace ──────────────────────────────────────────────────────────────

describe("workspacePath", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().workspacePath).toBeNull();
  });

  it("setWorkspacePath updates path", () => {
    useEditorStore.getState().setWorkspacePath("/home/user/project");
    expect(useEditorStore.getState().workspacePath).toBe("/home/user/project");
  });
});

// ── Tabs ───────────────────────────────────────────────────────────────────

describe("tabs", () => {
  it("starts with no tabs", () => {
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    expect(useEditorStore.getState().activeTabPath).toBeNull();
  });

  it("openTab adds tab and makes it active", () => {
    useEditorStore.getState().openTab("/foo/bar.typ", "bar.typ", "content");
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toEqual({ path: "/foo/bar.typ", name: "bar.typ", content: "content", isDirty: false });
    expect(s.activeTabPath).toBe("/foo/bar.typ");
  });

  it("openTab on existing path just activates it without duplicating", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabPath).toBe("/a.typ");
  });

  it("openTempTab opens an untitled temp tab", () => {
    useEditorStore.getState().openTempTab();
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].isTemp).toBe(true);
    expect(s.tabs[0].name).toBe("untitled.typ");
  });

  it("openTempTab called twice only creates one temp tab", () => {
    useEditorStore.getState().openTempTab();
    useEditorStore.getState().openTempTab();
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("closeTab removes the tab", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().closeTab("/a.typ");
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    expect(useEditorStore.getState().activeTabPath).toBeNull();
  });

  it("closeTab on unknown path is a no-op", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().closeTab("/does-not-exist.typ");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("closeTab activates previous tab when active tab is closed", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().closeTab("/b.typ");
    expect(useEditorStore.getState().activeTabPath).toBe("/a.typ");
  });

  it("closeTab activates next tab when first tab is closed", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().setActiveTab("/a.typ");
    useEditorStore.getState().closeTab("/a.typ");
    // idx was 0, prev is max(0, -1)=0 → next[0] = b.typ
    expect(useEditorStore.getState().activeTabPath).toBe("/b.typ");
  });

  it("setActiveTab switches active tab", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().setActiveTab("/a.typ");
    expect(useEditorStore.getState().activeTabPath).toBe("/a.typ");
  });

  it("updateTabContent marks tab dirty", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "original");
    useEditorStore.getState().updateTabContent("/a.typ", "modified");
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe("modified");
    expect(tab.isDirty).toBe(true);
  });

  it("markTabClean clears dirty flag", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().updateTabContent("/a.typ", "changed");
    useEditorStore.getState().markTabClean("/a.typ");
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
  });

  it("updateTabContent does not affect other tabs", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().updateTabContent("/a.typ", "A-modified");
    expect(useEditorStore.getState().tabs[1].isDirty).toBe(false);
    expect(useEditorStore.getState().tabs[1].content).toBe("B");
  });
});

// ── activeTab() helper ─────────────────────────────────────────────────────

describe("activeTab()", () => {
  it("returns null when no tabs open", () => {
    expect(useEditorStore.getState().activeTab()).toBeNull();
  });

  it("returns the currently active tab", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    const tab = useEditorStore.getState().activeTab();
    expect(tab?.path).toBe("/a.typ");
  });

  it("returns correct tab after switching", () => {
    useEditorStore.getState().openTab("/a.typ", "a.typ", "A");
    useEditorStore.getState().openTab("/b.typ", "b.typ", "B");
    useEditorStore.getState().setActiveTab("/a.typ");
    expect(useEditorStore.getState().activeTab()?.path).toBe("/a.typ");
  });
});

// ── Editor font size ───────────────────────────────────────────────────────

describe("editorFontSize", () => {
  it("defaults to 14", () => {
    expect(useEditorStore.getState().editorFontSize).toBe(14);
  });

  it("setEditorFontSize clamps to min 8", () => {
    useEditorStore.getState().setEditorFontSize(4);
    expect(useEditorStore.getState().editorFontSize).toBe(8);
  });

  it("setEditorFontSize clamps to max 32", () => {
    useEditorStore.getState().setEditorFontSize(100);
    expect(useEditorStore.getState().editorFontSize).toBe(32);
  });

  it("setEditorFontSize accepts value in range", () => {
    useEditorStore.getState().setEditorFontSize(18);
    expect(useEditorStore.getState().editorFontSize).toBe(18);
  });

  it("setEditorFontSize accepts exact min", () => {
    useEditorStore.getState().setEditorFontSize(8);
    expect(useEditorStore.getState().editorFontSize).toBe(8);
  });

  it("setEditorFontSize accepts exact max", () => {
    useEditorStore.getState().setEditorFontSize(32);
    expect(useEditorStore.getState().editorFontSize).toBe(32);
  });
});

// ── Metrics ────────────────────────────────────────────────────────────────

describe("metrics", () => {
  it("lastEditTime defaults to null", () => {
    expect(useEditorStore.getState().lastEditTime).toBeNull();
  });

  it("setLastEditTime updates value", () => {
    const now = Date.now();
    useEditorStore.getState().setLastEditTime(now);
    expect(useEditorStore.getState().lastEditTime).toBe(now);
  });

  it("lastCompileMs defaults to null", () => {
    expect(useEditorStore.getState().lastCompileMs).toBeNull();
  });

  it("setLastCompileMs updates value", () => {
    useEditorStore.getState().setLastCompileMs(42);
    expect(useEditorStore.getState().lastCompileMs).toBe(42);
  });
});

// ── Scroll sync ────────────────────────────────────────────────────────────

describe("scrollToLine", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().scrollToLine).toBeNull();
  });

  it("setScrollToLine updates value", () => {
    useEditorStore.getState().setScrollToLine(42);
    expect(useEditorStore.getState().scrollToLine).toBe(42);
  });

  it("setScrollToLine(null) clears it", () => {
    useEditorStore.getState().setScrollToLine(42);
    useEditorStore.getState().setScrollToLine(null);
    expect(useEditorStore.getState().scrollToLine).toBeNull();
  });
});
