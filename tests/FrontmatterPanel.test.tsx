import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FrontmatterPanel } from "../src/components/Editor/FrontmatterPanel";

describe("FrontmatterPanel", () => {
  const multiRow = "title: Hello\ndraft: true";
  const tripleRow = "a: 1\nb: 2\nc: 3";

  it("renders null when rows are empty", () => {
    const { container } = render(<FrontmatterPanel raw="" onChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders collapsed header with property count", () => {
    render(<FrontmatterPanel raw={multiRow} onChange={vi.fn()} />);
    expect(screen.getByText("Properties")).toBeInTheDocument();
    expect(screen.getByText("▶")).toBeInTheDocument();
  });

  it("expands to show rows when header is clicked", async () => {
    render(<FrontmatterPanel raw={multiRow} onChange={vi.fn()} />);
    await userEvent.click(screen.getByText("Properties"));
    expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
    expect(screen.getByDisplayValue("true")).toBeInTheDocument();
    expect(screen.getByText("▼")).toBeInTheDocument();
  });

  it("shows Add button when expanded", async () => {
    render(<FrontmatterPanel raw="title: Hello" onChange={vi.fn()} />);
    await userEvent.click(screen.getByText("Properties"));
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("calls onChange with updated value when input blurs", async () => {
    const onChange = vi.fn();
    render(<FrontmatterPanel raw="title: Hello" onChange={onChange} />);
    await userEvent.click(screen.getByText("Properties"));
    const input = screen.getByDisplayValue("Hello");
    await userEvent.clear(input);
    await userEvent.type(input, "World");
    input.blur();
    expect(onChange).toHaveBeenCalledWith("title: World");
  });

  it("submits value on Enter key", async () => {
    const onChange = vi.fn();
    render(<FrontmatterPanel raw="title: Hello" onChange={onChange} />);
    await userEvent.click(screen.getByText("Properties"));
    const input = screen.getByDisplayValue("Hello");
    await userEvent.clear(input);
    await userEvent.type(input, "World{Enter}");
    expect(onChange).toHaveBeenCalledWith("title: World");
  });

  it("renders multiple rows when expanded", async () => {
    render(<FrontmatterPanel raw={tripleRow} onChange={vi.fn()} />);
    await userEvent.click(screen.getByText("Properties"));
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
  });

  it("collapses and expands when toggled", async () => {
    render(<FrontmatterPanel raw="title: Hello" onChange={vi.fn()} />);
    await userEvent.click(screen.getByText("Properties"));
    expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Properties"));
    expect(screen.queryByDisplayValue("Hello")).not.toBeInTheDocument();
  });
});
