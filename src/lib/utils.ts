import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { invoke } from "@tauri-apps/api/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface OutlineItem {
  level: number;
  title: string;
  line: number;
}

/** Extract document outline from Typst or Markdown content. */
export function extractOutline(content: string): OutlineItem[] {
  const lines = content.split("\n");
  const outline: OutlineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mdMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (mdMatch) {
      outline.push({ level: mdMatch[1].length, title: mdMatch[2].trim(), line: i + 1 });
      continue;
    }
    const typstMatch = line.match(/^(={1,5})\s+(.+)/);
    if (typstMatch) {
      outline.push({ level: typstMatch[1].length, title: typstMatch[2].trim(), line: i + 1 });
    }
  }

  return outline;
}

/** Format outline as a compact string for AI context. */
export function formatOutlineForContext(outline: OutlineItem[], maxDepth = 3): string {
  if (outline.length === 0) return "";
  const filtered = outline.filter((item) => item.level <= maxDepth);
  if (filtered.length === 0) return "";
  const lines = filtered.map((item) => `${"  ".repeat(item.level - 1)}${item.title}`);
  return "Document structure:\n" + lines.join("\n");
}

/** Format references as a compact string for AI context. */
export function formatReferencesForContext(
  refs: Array<{ bibKey?: string; title?: string; authors?: string[]; year?: number }>
): string {
  if (refs.length === 0) return "";
  const lines = refs
    .filter((r) => r.bibKey)
    .map((r) => {
      const authors = r.authors?.slice(0, 3).join(", ") ?? "";
      const etAl = (r.authors?.length ?? 0) > 3 ? " et al." : "";
      const year = r.year ? ` (${r.year})` : "";
      return `@${r.bibKey}: ${r.title ?? "(no title)"}${authors ? ` — ${authors}${etAl}${year}` : ""}`;
    });
  return "Available references:\n" + lines.join("\n");
}

/** Format open tabs as context for cross-file awareness. */
export function formatTabsForContext(
  tabs: Array<{ path: string; name: string; content: string }>,
  activePath: string | null,
  maxCharsPerFile = 500
): string {
  const otherTabs = tabs.filter((t) => t.path !== activePath);
  if (otherTabs.length === 0) return "";
  const lines = otherTabs.map((t) => {
    const snippet = t.content.slice(0, maxCharsPerFile);
    const truncated = t.content.length > maxCharsPerFile ? "..." : "";
    return `File: ${t.name}\n${snippet}${truncated}`;
  });
  return "Other open files:\n" + lines.join("\n\n---\n\n");
}

/** Copy dropped image files to <workspace>/assets/ and return their filenames. */
export async function copyImageFilesToAssets(
  files: File[],
  workspacePath: string,
): Promise<string[]> {
  const mediaDir = `${workspacePath}/assets`;
  const saved: string[] = [];

  try {
    const exists = await invoke<boolean>("path_exists", { path: mediaDir });
    if (!exists) {
      await invoke("create_dir", { path: mediaDir });
    }

    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const dest = `${mediaDir}/${f.name}`;
      const buf = new Uint8Array(await f.arrayBuffer());
      await invoke("write_file_bytes", { path: dest, bytes: Array.from(buf) });
      saved.push(f.name);
    }
  } catch (err) {
    console.error("copyImageFilesToAssets error", err);
  }

  return saved;
}
