import { describe, expect, it } from "vitest";
import { normalizeWysiwygMarkdownEscapes } from "./markdownEscapeUtil";

describe("normalizeWysiwygMarkdownEscapes", () => {
  it("removes serializer escapes around inline markdown punctuation", () => {
    expect(normalizeWysiwygMarkdownEscapes("\\*hello\\* and \\[text\\]\\(url\\)")).toBe("*hello* and [text](url)");
  });

  it("keeps escaped leading list bullets because unescaping would change the block", () => {
    expect(normalizeWysiwygMarkdownEscapes("\\* literal bullet")).toBe("\\* literal bullet");
  });

  it("does not normalize escapes inside fenced code blocks", () => {
    expect(normalizeWysiwygMarkdownEscapes("```md\n\\*literal\\*\n```\n\\*text\\*")).toBe("```md\n\\*literal\\*\n```\n*text*");
  });

  it("removes serializer escapes from table row delimiters", () => {
    expect(
      normalizeWysiwygMarkdownEscapes("\\| Header 1 \\| Header 2 \\|\n\\| --- \\| --- \\|\n\\| Cell \\| Cell \\|")
    ).toBe("| Header 1 | Header 2 |\n| --- | --- |\n| Cell | Cell |");
  });

  it("keeps escaped literal pipes inside table cells", () => {
    expect(normalizeWysiwygMarkdownEscapes("| A \\| B | C |")).toBe("| A \\| B | C |");
  });
});
