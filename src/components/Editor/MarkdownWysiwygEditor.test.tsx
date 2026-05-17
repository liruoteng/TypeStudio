import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";
import { useEditorStore } from "../../stores/editorStore";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (src: string) => src,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("MarkdownWysiwygEditor", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activeTabPath: null,
      editorFontSize: 14,
      editorMdFont: '"Source Serif 4", "Charter", "Georgia", "Times New Roman", serif',
      editorWidth: 960,
      theme: "dark",
    });
  });

  it("renders the markdown sample without crashing", async () => {
    const content = readFileSync("examples/markdown/sample.md", "utf8");
    const path = "/workspace/examples/markdown/sample.md";
    useEditorStore.getState().openTab(path, "sample.md", content);

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".markdown-wysiwyg-editor")).toBeInTheDocument();
      expect(container.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });

  it("lets rendered table cells update the markdown source", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(path, "table.md", "| A | B |\n| --- | --- |\n| 1 | 2 |\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let cell: HTMLElement | null = null;
    await waitFor(() => {
      cell = container.querySelector(".cm-md-table-render tbody td");
      expect(cell).toHaveAttribute("contenteditable", "true");
    });

    cell!.textContent = "Edited";
    fireEvent.input(cell!);
    fireEvent.blur(cell!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toContain("| Edited | 2 |");
    });
  });
});
