import { describe, it, expect } from "vitest";
import {
  extractFrontmatter,
  restoreFrontmatter,
  parseFrontmatterRows,
  updateFrontmatterValue,
} from "../src/components/Editor/frontmatterUtil";

describe("extractFrontmatter", () => {
  it("extracts frontmatter and body from content with frontmatter", () => {
    const result = extractFrontmatter("---\ntitle: Hello\ndraft: true\n---\n\nBody text");
    expect(result.frontmatter).toBe("title: Hello\ndraft: true");
    expect(result.body).toBe("\nBody text");
  });

  it("returns empty frontmatter and full content when no frontmatter", () => {
    const result = extractFrontmatter("Just body text\nNo frontmatter");
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("Just body text\nNo frontmatter");
  });

  it("handles CRLF line endings", () => {
    const result = extractFrontmatter("---\r\ntitle: CRLF\r\n---\r\n\r\nBody");
    expect(result.frontmatter).toBe("title: CRLF");
    expect(result.body).toBe("\r\nBody");
  });

  it("handles empty frontmatter block (regex requires non-empty separator line)", () => {
    const result = extractFrontmatter("---\n---\nBody");
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("---\n---\nBody");
  });

  it("handles content with no body after frontmatter", () => {
    const result = extractFrontmatter("---\ntitle: Only\n---\n");
    expect(result.frontmatter).toBe("title: Only");
    expect(result.body).toBe("");
  });

  it("frontmatter must start on first line", () => {
    const result = extractFrontmatter("\n---\ntitle: Not on first line\n---\nBody");
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("\n---\ntitle: Not on first line\n---\nBody");
  });
});

describe("restoreFrontmatter", () => {
  it("restores frontmatter with body", () => {
    expect(restoreFrontmatter("title: Hello", "Body")).toBe("---\ntitle: Hello\n---\nBody");
  });

  it("returns only body when frontmatter is empty", () => {
    expect(restoreFrontmatter("", "Body only")).toBe("Body only");
  });

  it("preserves body with leading whitespace", () => {
    const result = restoreFrontmatter("key: val", "\n\n  Indented body");
    expect(result).toBe("---\nkey: val\n---\n\n\n  Indented body");
  });
});

describe("parseFrontmatterRows", () => {
  it("parses key-value rows from raw frontmatter string", () => {
    const rows = parseFrontmatterRows("title: Hello\ndraft: true\ntags: a, b");
    expect(rows).toEqual([
      { key: "title", value: "Hello" },
      { key: "draft", value: "true" },
      { key: "tags", value: "a, b" },
    ]);
  });

  it("skips empty lines and comments", () => {
    const rows = parseFrontmatterRows("title: Hello\n\n# This is a comment\ndraft: true");
    expect(rows).toEqual([
      { key: "title", value: "Hello" },
      { key: "draft", value: "true" },
    ]);
  });

  it("handles values with colons", () => {
    const rows = parseFrontmatterRows("title: 10:00 AM");
    expect(rows).toEqual([{ key: "title", value: "10:00 AM" }]);
  });

  it("trims whitespace around keys and values", () => {
    const rows = parseFrontmatterRows("  title  :  hello  ");
    expect(rows).toEqual([{ key: "title", value: "hello" }]);
  });

  it("returns empty array for empty input", () => {
    expect(parseFrontmatterRows("")).toEqual([]);
  });

  it("returns empty array for input without colons", () => {
    expect(parseFrontmatterRows("just some text\nwithout colons")).toEqual([]);
  });
});

describe("updateFrontmatterValue", () => {
  it("updates existing key value", () => {
    const result = updateFrontmatterValue("title: Hello\ndraft: true", "draft", "false");
    expect(result).toBe("title: Hello\ndraft: false");
  });

  it("appends key-value when key does not exist", () => {
    const result = updateFrontmatterValue("title: Hello", "draft", "true");
    expect(result).toBe("title: Hello\ndraft: true");
  });

  it("trims overall result (leading whitespace on first line removed by final .trim())", () => {
    const result = updateFrontmatterValue("  title: Hello", "title", "World");
    expect(result).toBe("title: World");
  });

  it("preserves indentation on middle lines", () => {
    const result = updateFrontmatterValue("a: 1\n  title: Hello\nc: 3", "title", "World");
    expect(result).toBe("a: 1\n  title: World\nc: 3");
  });

  it("does not append when key is empty", () => {
    const result = updateFrontmatterValue("title: Hello", "", "value");
    expect(result).toBe("title: Hello");
  });

  it("trims key and value before matching", () => {
    const result = updateFrontmatterValue("title: Hello", "  title  ", "  World  ");
    expect(result).toBe("title: World");
  });

  it("handles multiple keys and only updates the matching one", () => {
    const result = updateFrontmatterValue("a: 1\nb: 2\nc: 3", "b", "22");
    expect(result).toBe("a: 1\nb: 22\nc: 3");
  });

  it("works with empty raw string and appends", () => {
    const result = updateFrontmatterValue("", "key", "val");
    expect(result).toBe("key: val");
  });

  it("does not modify unrelated lines that contain a colon but are not key-value", () => {
    const result = updateFrontmatterValue("title: Hello\ndescription: A: B", "title", "World");
    expect(result).toBe("title: World\ndescription: A: B");
  });
});
