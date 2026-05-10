// ── Frontmatter utilities ────────────────────────────────────────────────────

export interface FrontmatterExtract {
  frontmatter: string;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function extractFrontmatter(content: string): FrontmatterExtract {
  const match = content.match(FRONTMATTER_RE);
  if (match) {
    return {
      frontmatter: match[1].trim(),
      body: content.slice(match[0].length),
    };
  }
  return { frontmatter: "", body: content };
}

export function restoreFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return `---\n${frontmatter}\n---\n${body}`;
}

export function parseFrontmatterRows(raw: string): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    rows.push({
      key: trimmed.slice(0, colonIdx).trim(),
      value: trimmed.slice(colonIdx + 1).trim(),
    });
  }
  return rows;
}

export function updateFrontmatterValue(raw: string, key: string, value: string): string {
  const lines = raw.split("\n");
  const targetKey = key.trim();
  const nextValue = value.trim();
  let updated = false;

  const next = lines.map((line) => {
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) return line;

    const lineKey = trimmed.slice(0, colonIdx).trim();
    if (lineKey !== targetKey) return line;

    updated = true;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    return `${indent}${targetKey}: ${nextValue}`;
  });

  if (!updated && targetKey) {
    next.push(`${targetKey}: ${nextValue}`);
  }

  return next.join("\n").trim();
}
