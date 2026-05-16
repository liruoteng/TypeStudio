const INLINE_MARKDOWN_ESCAPES = new Set(["*", "_", "~", "`", "[", "]", "(", ")"]);

function shouldKeepEscaped(line: string, index: number, escaped: string) {
  if (escaped !== "*") return false;

  const before = line.slice(0, index);
  const after = line[index + 2] ?? "";
  return before.trim() === "" && /\s/.test(after);
}

function normalizeLineEscapes(line: string) {
  let next = "";

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const escaped = line[i + 1];

    if (char === "\\" && escaped && INLINE_MARKDOWN_ESCAPES.has(escaped) && !shouldKeepEscaped(line, i, escaped)) {
      next += escaped;
      i += 1;
    } else {
      next += char;
    }
  }

  return next;
}

export function normalizeWysiwygMarkdownEscapes(markdown: string) {
  const lines = markdown.split("\n");
  let inFence = false;

  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }

    if (inFence) return line;
    return normalizeLineEscapes(line);
  }).join("\n");
}
