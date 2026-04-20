import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";

function makeItems(overrides: Partial<ContextMenuItem>[] = []): ContextMenuItem[] {
  return [
    { label: "Cut", action: vi.fn() },
    { label: "Copy", action: vi.fn() },
    { separator: true },
    { label: "Delete", action: vi.fn() },
    ...overrides.map((o) => ({ label: "extra", action: vi.fn(), ...o })),
  ];
}

describe("ContextMenu", () => {
  it("renders all non-separator items as buttons", () => {
    render(<ContextMenu x={0} y={0} items={makeItems()} onClose={vi.fn()} />);
    expect(screen.getByText("Cut")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("renders separators as dividers (not buttons)", () => {
    render(<ContextMenu x={0} y={0} items={makeItems()} onClose={vi.fn()} />);
    const seps = document.querySelectorAll(".context-menu-sep");
    expect(seps).toHaveLength(1);
  });

  it("clicking an item calls its action and then onClose", async () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0} y={0}
        items={[{ label: "Delete", action }]}
        onClose={onClose}
      />
    );
    await userEvent.click(screen.getByText("Delete"));
    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking item without action still calls onClose", async () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0} y={0}
        items={[{ label: "Noop" }]}
        onClose={onClose}
      />
    );
    await userEvent.click(screen.getByText("Noop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disabled item is not interactive", () => {
    render(
      <ContextMenu
        x={0} y={0}
        items={[{ label: "Disabled", action: vi.fn(), disabled: true }]}
        onClose={vi.fn()}
      />
    );
    const btn = screen.getByText("Disabled");
    expect(btn).toBeDisabled();
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={makeItems()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking outside the menu calls onClose", async () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={makeItems()} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders at specified x/y coordinates", () => {
    render(<ContextMenu x={150} y={250} items={makeItems()} onClose={vi.fn()} />);
    const menu = document.querySelector(".context-menu") as HTMLElement;
    expect(menu.style.left).toBe("150px");
    expect(menu.style.top).toBe("250px");
  });

  it("renders with no items gracefully", () => {
    render(<ContextMenu x={0} y={0} items={[]} onClose={vi.fn()} />);
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeInTheDocument();
  });

  it("renders item labels correctly", () => {
    render(
      <ContextMenu
        x={0} y={0}
        items={[{ label: "Rename File" }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Rename File")).toBeInTheDocument();
  });

  it("renders into document.body via portal", () => {
    const { unmount } = render(
      <ContextMenu x={0} y={0} items={makeItems()} onClose={vi.fn()} />
    );
    expect(document.body.querySelector(".context-menu")).not.toBeNull();
    unmount();
  });
});
