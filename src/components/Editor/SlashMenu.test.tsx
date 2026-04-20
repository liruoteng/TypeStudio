import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlashMenu } from "./SlashMenu";
import type { SlashCommand } from "./SlashMenu";

const noop = () => {};

function renderMenu(props: Partial<Parameters<typeof SlashMenu>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <SlashMenu
      x={0}
      y={0}
      filter=""
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />
  );
  return { onSelect, onClose };
}

describe("SlashMenu", () => {
  it("renders all commands when filter is empty", () => {
    renderMenu();
    expect(screen.getByText("Heading 1")).toBeInTheDocument();
    expect(screen.getByText("Bold")).toBeInTheDocument();
    expect(screen.getByText("Inline Code")).toBeInTheDocument();
    expect(screen.getByText("Table")).toBeInTheDocument();
  });

  it("groups commands by category", () => {
    renderMenu();
    expect(screen.getByText("Structure")).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.getByText("Math")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });

  it("shows descriptions alongside labels", () => {
    renderMenu();
    expect(screen.getByText("Top-level heading")).toBeInTheDocument();
    expect(screen.getByText("Bold text")).toBeInTheDocument();
  });

  it("filters commands by label (case-insensitive)", () => {
    renderMenu({ filter: "heading" });
    expect(screen.getByText("Heading 1")).toBeInTheDocument();
    expect(screen.getByText("Heading 2")).toBeInTheDocument();
    expect(screen.queryByText("Bold")).not.toBeInTheDocument();
  });

  it("filters commands by category", () => {
    renderMenu({ filter: "math" });
    expect(screen.getByText("Inline Math")).toBeInTheDocument();
    expect(screen.getByText("Display Math")).toBeInTheDocument();
    expect(screen.queryByText("Heading 1")).not.toBeInTheDocument();
  });

  it("returns null when no commands match the filter", () => {
    const { container } = render(
      <SlashMenu x={0} y={0} filter="xyzzy" onSelect={noop} onClose={noop} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("highlights first item by default", () => {
    renderMenu();
    const items = document.querySelectorAll(".slash-menu-item");
    expect(items[0]).toHaveClass("selected");
    expect(items[1]).not.toHaveClass("selected");
  });

  it("ArrowDown moves selection to next item", () => {
    renderMenu();
    const items = document.querySelectorAll(".slash-menu-item");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(items[0]).not.toHaveClass("selected");
    expect(items[1]).toHaveClass("selected");
  });

  it("ArrowDown does not go past the last item", () => {
    renderMenu({ filter: "heading 1" });
    // Only one result
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const items = document.querySelectorAll(".slash-menu-item");
    expect(items[0]).toHaveClass("selected");
  });

  it("ArrowUp does not go below zero", () => {
    renderMenu();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    const items = document.querySelectorAll(".slash-menu-item");
    expect(items[0]).toHaveClass("selected");
  });

  it("ArrowDown then ArrowUp returns to first item", () => {
    renderMenu();
    const items = document.querySelectorAll(".slash-menu-item");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(items[0]).toHaveClass("selected");
  });

  it("Enter calls onSelect with the selected command", () => {
    const { onSelect } = renderMenu();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    const cmd = onSelect.mock.calls[0][0] as SlashCommand;
    expect(cmd.id).toBe("h1");
  });

  it("Enter calls onSelect with correct command after navigating down", () => {
    const { onSelect } = renderMenu();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    const cmd = onSelect.mock.calls[0][0] as SlashCommand;
    expect(cmd.id).toBe("h2");
  });

  it("Escape calls onClose", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking an item calls onSelect with that command", async () => {
    const { onSelect } = renderMenu();
    const boldItem = screen.getByText("Bold").closest(".slash-menu-item")!;
    await userEvent.click(boldItem);
    expect(onSelect).toHaveBeenCalledOnce();
    expect((onSelect.mock.calls[0][0] as SlashCommand).id).toBe("bold");
  });

  it("hovering an item updates the selection", async () => {
    renderMenu();
    const boldItem = screen.getByText("Bold").closest(".slash-menu-item")!;
    fireEvent.mouseEnter(boldItem);
    expect(boldItem).toHaveClass("selected");
  });

  it("resets selection to 0 when filter changes", async () => {
    const { rerender } = render(
      <SlashMenu x={0} y={0} filter="" onSelect={noop} onClose={noop} />
    );
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });

    rerender(
      <SlashMenu x={0} y={0} filter="bold" onSelect={noop} onClose={noop} />
    );

    const items = document.querySelectorAll(".slash-menu-item");
    expect(items[0]).toHaveClass("selected");
  });

  it("positions menu using x/y props", () => {
    render(<SlashMenu x={100} y={200} filter="" onSelect={noop} onClose={noop} />);
    const menu = document.querySelector(".slash-menu") as HTMLElement;
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("200px");
  });

  it("clicking outside calls onClose", async () => {
    const { onClose } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking inside the menu does not call onClose via outside-click", async () => {
    const { onClose } = renderMenu();
    const menu = document.querySelector(".slash-menu")!;
    fireEvent.mouseDown(menu);
    expect(onClose).not.toHaveBeenCalled();
  });
});
