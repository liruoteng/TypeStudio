import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { invoke } from "@tauri-apps/api/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
