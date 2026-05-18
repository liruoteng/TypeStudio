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

  it("renders mynode.md without crashing", async () => {
    const content = readFileSync("examples/markdown/mynode.md", "utf8");
    const path = "/workspace/examples/markdown/mynode.md";
    useEditorStore.getState().openTab(path, "mynode.md", content);

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

  it("selects a rectangular range of rendered table cells with the mouse", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    let cells: NodeListOf<HTMLElement>;
    await waitFor(() => {
      cells = container.querySelectorAll(".cm-md-table-render tbody td");
      expect(cells.length).toBe(6);
    });

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => cells![4]);

    fireEvent.mouseDown(cells![0], { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 20, clientY: 20 });
    fireEvent.mouseUp(document, { button: 0 });

    document.elementFromPoint = originalElementFromPoint;

    const selected = container.querySelectorAll(".cm-md-table-render td.is-selected");
    expect(selected).toHaveLength(4);
    expect([...selected].map((cell) => cell.textContent)).toEqual(["1", "2", "4", "5"]);
  });

  it("selects a rectangular table range when drag events enter another cell", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    let cells: NodeListOf<HTMLElement>;
    await waitFor(() => {
      cells = container.querySelectorAll(".cm-md-table-render tbody td");
      expect(cells.length).toBe(6);
    });

    fireEvent.mouseDown(cells![0], { button: 0 });
    fireEvent.mouseOver(cells![4], { buttons: 1 });
    fireEvent.mouseUp(document, { button: 0 });

    const selected = container.querySelectorAll(".cm-md-table-render td.is-selected");
    expect(selected).toHaveLength(4);
    expect([...selected].map((cell) => cell.textContent)).toEqual(["1", "2", "4", "5"]);
  });

  it("does not hijack native text selection gestures inside one table cell", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(path, "table.md", "| A | B |\n| --- | --- |\n| Alpha Beta | 2 |\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    let cell: HTMLElement | null = null;
    await waitFor(() => {
      cell = container.querySelector(".cm-md-table-render tbody td");
      expect(cell).toHaveAttribute("contenteditable", "true");
    });

    const mouseDown = fireEvent.mouseDown(cell!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 4, clientY: 4 });
    fireEvent.mouseUp(document, { button: 0 });

    expect(mouseDown).toBe(true);
    expect(container.querySelectorAll(".cm-md-table-render td.is-selected")).toHaveLength(0);
  });

  it("extends rendered table cell selection with shift-click", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    let cells: NodeListOf<HTMLElement>;
    await waitFor(() => {
      cells = container.querySelectorAll(".cm-md-table-render tbody td");
      expect(cells.length).toBe(6);
    });

    fireEvent.mouseDown(cells![0], { button: 0 });
    fireEvent.mouseUp(cells![0], { button: 0 });
    fireEvent.mouseDown(cells![4], { button: 0, shiftKey: true });

    const selected = container.querySelectorAll(".cm-md-table-render td.is-selected");
    expect(selected).toHaveLength(4);
    expect([...selected].map((cell) => cell.textContent)).toEqual(["1", "2", "4", "5"]);
  });

  it("deletes a table row from the rendered table toolbar", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-table-render")).toBeInTheDocument();
    });

    const deleteRow = [...container.querySelectorAll("button")].find((button) => button.textContent === "- Row");
    fireEvent.click(deleteRow!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
    });
  });

  it("deletes a table column from the rendered table toolbar", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(
      path,
      "table.md",
      "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n",
    );

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-table-render")).toBeInTheDocument();
    });

    const deleteColumn = [...container.querySelectorAll("button")].find((button) => button.textContent === "- Column");
    fireEvent.click(deleteColumn!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
    });
  });

  it("deletes the whole table from the rendered table toolbar", async () => {
    const path = "/workspace/examples/markdown/table.md";
    useEditorStore.getState().openTab(path, "table.md", "| A | B |\n| --- | --- |\n| 1 | 2 |\n");

    const { container } = render(<MarkdownWysiwygEditor />);

    await waitFor(() => {
      expect(container.querySelector(".cm-md-table-render")).toBeInTheDocument();
    });

    const deleteTable = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete table");
    fireEvent.click(deleteTable!);

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab()?.content).toBe("");
    });
  });
});
