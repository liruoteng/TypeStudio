import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  watch: () => Promise.resolve(() => {}),
}));

import { FileTree } from "./FileTree";
import { useEditorStore } from "../../stores/editorStore";

function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => { store.set(k, v); },
    getData: (k: string) => store.get(k) ?? "",
    types: [] as string[],
    effectAllowed: "",
    dropEffect: "",
    files: [],
  } as unknown as DataTransfer;
}

describe("FileTree DnD", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "list_dir") {
        const p = args.path as string;
        if (p === "/ws") {
          return Promise.resolve([
            { name: "sub", path: "/ws/sub", is_dir: true },
            { name: "a.typ", path: "/ws/a.typ", is_dir: false },
          ]);
        }
        if (p === "/ws/sub") return Promise.resolve([]);
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });
    useEditorStore.setState({ workspacePath: "/ws" } as Partial<ReturnType<typeof useEditorStore.getState>>);
  });

  it("moves a file into a subfolder via drag-and-drop", async () => {
    render(<FileTree />);

    // Wait for tree contents to load
    await waitFor(() => expect(screen.getByText("a.typ")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("sub")).toBeInTheDocument());

    const fileRow = screen.getByText("a.typ").closest(".tree-row") as HTMLElement;
    const dirRow = screen.getByText("sub").closest(".tree-row") as HTMLElement;
    expect(fileRow).toBeTruthy();
    expect(dirRow).toBeTruthy();

    const dt = makeDataTransfer();
    fireEvent.dragStart(fileRow, { dataTransfer: dt });
    fireEvent.dragOver(dirRow, { dataTransfer: dt });
    fireEvent.drop(dirRow, { dataTransfer: dt });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("rename_path", {
        oldPath: "/ws/a.typ",
        newPath: "/ws/sub/a.typ",
      });
    });
  });

  it("does not move when source parent equals destination dir", async () => {
    render(<FileTree />);
    await waitFor(() => expect(screen.getByText("a.typ")).toBeInTheDocument());

    const fileRow = screen.getByText("a.typ").closest(".tree-row") as HTMLElement;
    const rootRow = screen.getByText("ws").closest(".tree-row") as HTMLElement;

    const dt = makeDataTransfer();
    fireEvent.dragStart(fileRow, { dataTransfer: dt });
    fireEvent.drop(rootRow, { dataTransfer: dt });

    // Allow any pending promise microtasks to drain
    await new Promise((r) => setTimeout(r, 0));
    expect(invokeMock).not.toHaveBeenCalledWith("rename_path", expect.anything());
  });
});
