import { describe, it, expect } from "vitest";
import { normalizeTableDelimiterEscapes } from "../src/components/Editor/markdownEscapeUtil";

describe("normalizeTableDelimiterEscapes", () => {
  it("removes all pipe escapes in a full table row", () => {
    const result = normalizeTableDelimiterEscapes("\\| Header 1 \\| Header 2 \\|");
    expect(result).toBe("| Header 1 | Header 2 |");
  });

  it("removes leading pipe escape when followed by valid table row", () => {
    const result = normalizeTableDelimiterEscapes("\\| a | b |");
    expect(result).toBe("| a | b |");
  });

  it("removes trailing pipe escape when preceded by valid table row", () => {
    const result = normalizeTableDelimiterEscapes("| a | b \\|");
    expect(result).toBe("| a | b |");
  });

  it("does NOT unescape pipes inside non-table lines", () => {
    const result = normalizeTableDelimiterEscapes("\\| not a table row");
    expect(result).toBe("\\| not a table row");
  });

  it("does NOT unescape when row has fewer than 2 cells", () => {
    const result = normalizeTableDelimiterEscapes("\\| single cell \\|");
    expect(result).toBe("\\| single cell \\|");
  });

  it("preserves escaped pipes inside table cells (literal pipes)", () => {
    const result = normalizeTableDelimiterEscapes("| A \\| B | C |");
    expect(result).toBe("| A \\| B | C |");
  });

  it("handles separator row with edge escapes", () => {
    const result = normalizeTableDelimiterEscapes("\\| --- \\| --- \\|");
    expect(result).toBe("| --- | --- |");
  });

  it("handles leading whitespace before escaped pipe", () => {
    const result = normalizeTableDelimiterEscapes("  \\| a | b |");
    expect(result).toBe("  | a | b |");
  });

  it("returns line unchanged when no pipes found", () => {
    const line = "just a normal line of text";
    expect(normalizeTableDelimiterEscapes(line)).toBe(line);
  });
});
