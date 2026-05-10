import type { SimpleIcon } from "simple-icons";
import {
  siC,
  siCplusplus,
  siCss,
  siDotnet,
  siGnubash,
  siGo,
  siHtml5,
  siJavascript,
  siJson,
  siKotlin,
  siLatex,
  siLess,
  siLua,
  siMarkdown,
  siMdx,
  siOpenjdk,
  siPhp,
  siPython,
  siR,
  siReact,
  siRuby,
  siRust,
  siSass,
  siSvg,
  siSwift,
  siToml,
  siTypescript,
  siTypst,
  siXml,
  siYaml,
  siZsh,
} from "simple-icons/icons";

export type FileIconMeta =
  | { kind: "simple"; icon: SimpleIcon; className: string }
  | { kind: "text"; label: string; className: string };

export function getFileIconMeta(name: string, isDir: boolean): FileIconMeta {
  if (isDir) return { kind: "text", label: "▶", className: "dir-icon" };

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "typ") return { kind: "simple", icon: siTypst, className: "typst-icon" };
  if (ext === "bib") return { kind: "text", label: "B", className: "bib-icon" };
  if (ext === "pdf") return { kind: "text", label: "P", className: "pdf-icon" };
  if (ext === "mdx") return { kind: "simple", icon: siMdx, className: "mdx-icon" };
  if (["md", "markdown"].includes(ext)) return { kind: "simple", icon: siMarkdown, className: "md-icon" };
  if (ext === "svg") return { kind: "simple", icon: siSvg, className: "svg-icon" };
  if (["png", "jpg", "jpeg", "gif", "webp", "ico", "avif"].includes(ext)) return { kind: "text", label: "⬛", className: "img-icon" };
  if (["js", "mjs", "cjs"].includes(ext)) return { kind: "simple", icon: siJavascript, className: "js-icon" };
  if (["ts", "mts", "cts"].includes(ext)) return { kind: "simple", icon: siTypescript, className: "ts-icon" };
  if (["jsx", "tsx"].includes(ext)) return { kind: "simple", icon: siReact, className: "jsx-icon" };
  if (ext === "rs") return { kind: "simple", icon: siRust, className: "rs-icon" };
  if (ext === "py") return { kind: "simple", icon: siPython, className: "py-icon" };
  if (["json", "jsonc"].includes(ext)) return { kind: "simple", icon: siJson, className: "json-icon" };
  if (["yaml", "yml"].includes(ext)) return { kind: "simple", icon: siYaml, className: "yaml-icon" };
  if (["toml", "ini"].includes(ext)) return { kind: "simple", icon: siToml, className: "toml-icon" };
  if (["html", "htm"].includes(ext)) return { kind: "simple", icon: siHtml5, className: "html-icon" };
  if (ext === "scss") return { kind: "simple", icon: siSass, className: "sass-icon" };
  if (ext === "less") return { kind: "simple", icon: siLess, className: "less-icon" };
  if (ext === "css") return { kind: "simple", icon: siCss, className: "css-icon" };
  if (["sh", "bash"].includes(ext)) return { kind: "simple", icon: siGnubash, className: "sh-icon" };
  if (ext === "zsh") return { kind: "simple", icon: siZsh, className: "zsh-icon" };
  if (ext === "sql") return { kind: "text", label: "db", className: "sql-icon" };
  if (ext === "go") return { kind: "simple", icon: siGo, className: "go-icon" };
  if (ext === "java") return { kind: "simple", icon: siOpenjdk, className: "java-icon" };
  if (["c", "h"].includes(ext)) return { kind: "simple", icon: siC, className: "c-icon" };
  if (["cpp", "hpp", "cc"].includes(ext)) return { kind: "simple", icon: siCplusplus, className: "cpp-icon" };
  if (ext === "tex") return { kind: "simple", icon: siLatex, className: "latex-icon" };
  if (ext === "lua") return { kind: "simple", icon: siLua, className: "lua-icon" };
  if (ext === "rb") return { kind: "simple", icon: siRuby, className: "rb-icon" };
  if (ext === "swift") return { kind: "simple", icon: siSwift, className: "swift-icon" };
  if (ext === "kt") return { kind: "simple", icon: siKotlin, className: "kt-icon" };
  if (ext === "php") return { kind: "simple", icon: siPhp, className: "php-icon" };
  if (ext === "r") return { kind: "simple", icon: siR, className: "r-icon" };
  if (ext === "cs") return { kind: "simple", icon: siDotnet, className: "cs-icon" };
  if (ext === "xml") return { kind: "simple", icon: siXml, className: "xml-icon" };
  if (ext === "txt") return { kind: "text", label: "≡", className: "txt-icon" };
  if (["zip", "tar", "gz", "bz2", "7z", "rar"].includes(ext)) return { kind: "text", label: "ZIP", className: "zip-icon" };
  return { kind: "text", label: "·", className: "generic-icon" };
}
