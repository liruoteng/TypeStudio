import { describe, it, expect } from "vitest";
import { getFileIconMeta } from "../src/components/FileExplorer/fileIcons";

describe("getFileIconMeta", () => {
  it("returns dir icon for directories", () => {
    const meta = getFileIconMeta("src", true);
    expect(meta).toEqual({ kind: "text", label: "▶", className: "dir-icon" });
  });

  it("returns typst icon for .typ files", () => {
    const meta = getFileIconMeta("main.typ", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("typst-icon");
  });

  it("returns bib icon for .bib files", () => {
    const meta = getFileIconMeta("refs.bib", false);
    expect(meta).toEqual({ kind: "text", label: "B", className: "bib-icon" });
  });

  it("returns pdf icon for .pdf files", () => {
    const meta = getFileIconMeta("doc.pdf", false);
    expect(meta).toEqual({ kind: "text", label: "P", className: "pdf-icon" });
  });

  it("returns mdx icon for .mdx files", () => {
    const meta = getFileIconMeta("readme.mdx", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("mdx-icon");
  });

  it("returns markdown icon for .md files", () => {
    const meta = getFileIconMeta("readme.md", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("md-icon");
  });

  it("returns markdown icon for .markdown files", () => {
    const meta = getFileIconMeta("readme.markdown", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("md-icon");
  });

  it("returns svg icon for .svg files", () => {
    const meta = getFileIconMeta("icon.svg", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("svg-icon");
  });

  it("returns img icon for image files", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "ico", "avif"]) {
      const meta = getFileIconMeta(`image.${ext}`, false);
      expect(meta).toEqual({ kind: "text", label: "⬛", className: "img-icon" });
    }
  });

  it("returns javascript icon for .js/.mjs/.cjs files", () => {
    for (const ext of ["js", "mjs", "cjs"]) {
      const meta = getFileIconMeta(`file.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("js-icon");
    }
  });

  it("returns typescript icon for .ts/.mts/.cts files", () => {
    for (const ext of ["ts", "mts", "cts"]) {
      const meta = getFileIconMeta(`file.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("ts-icon");
    }
  });

  it("returns react icon for .jsx/.tsx files", () => {
    for (const ext of ["jsx", "tsx"]) {
      const meta = getFileIconMeta(`component.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("jsx-icon");
    }
  });

  it("returns rust icon for .rs files", () => {
    const meta = getFileIconMeta("lib.rs", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("rs-icon");
  });

  it("returns python icon for .py files", () => {
    const meta = getFileIconMeta("main.py", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("py-icon");
  });

  it("returns json icon for .json/.jsonc files", () => {
    for (const ext of ["json", "jsonc"]) {
      const meta = getFileIconMeta(`config.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("json-icon");
    }
  });

  it("returns yaml icon for .yaml/.yml files", () => {
    for (const ext of ["yaml", "yml"]) {
      const meta = getFileIconMeta(`config.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("yaml-icon");
    }
  });

  it("returns toml icon for .toml/.ini files", () => {
    for (const ext of ["toml", "ini"]) {
      const meta = getFileIconMeta(`config.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("toml-icon");
    }
  });

  it("returns html icon for .html/.htm files", () => {
    for (const ext of ["html", "htm"]) {
      const meta = getFileIconMeta(`page.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("html-icon");
    }
  });

  it("returns sass icon for .scss files", () => {
    const meta = getFileIconMeta("style.scss", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("sass-icon");
  });

  it("returns less icon for .less files", () => {
    const meta = getFileIconMeta("style.less", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("less-icon");
  });

  it("returns css icon for .css files", () => {
    const meta = getFileIconMeta("style.css", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("css-icon");
  });

  it("returns shell icon for .sh/.bash files", () => {
    for (const ext of ["sh", "bash"]) {
      const meta = getFileIconMeta(`script.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("sh-icon");
    }
  });

  it("returns zsh icon for .zsh files", () => {
    const meta = getFileIconMeta(".zshrc", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("zsh-icon");
  });

  it("returns sql icon for .sql files", () => {
    const meta = getFileIconMeta("query.sql", false);
    expect(meta).toEqual({ kind: "text", label: "db", className: "sql-icon" });
  });

  it("returns go icon for .go files", () => {
    const meta = getFileIconMeta("main.go", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("go-icon");
  });

  it("returns java icon for .java files", () => {
    const meta = getFileIconMeta("Main.java", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("java-icon");
  });

  it("returns c icon for .c/.h files", () => {
    for (const ext of ["c", "h"]) {
      const meta = getFileIconMeta(`main.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("c-icon");
    }
  });

  it("returns cpp icon for .cpp/.hpp/.cc files", () => {
    for (const ext of ["cpp", "hpp", "cc"]) {
      const meta = getFileIconMeta(`main.${ext}`, false);
      expect(meta.kind).toBe("simple");
      expect(meta.className).toBe("cpp-icon");
    }
  });

  it("returns latex icon for .tex files", () => {
    const meta = getFileIconMeta("paper.tex", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("latex-icon");
  });

  it("returns lua icon for .lua files", () => {
    const meta = getFileIconMeta("script.lua", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("lua-icon");
  });

  it("returns ruby icon for .rb files", () => {
    const meta = getFileIconMeta("script.rb", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("rb-icon");
  });

  it("returns swift icon for .swift files", () => {
    const meta = getFileIconMeta("main.swift", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("swift-icon");
  });

  it("returns kotlin icon for .kt files", () => {
    const meta = getFileIconMeta("main.kt", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("kt-icon");
  });

  it("returns php icon for .php files", () => {
    const meta = getFileIconMeta("index.php", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("php-icon");
  });

  it("returns r icon for .r files", () => {
    const meta = getFileIconMeta("script.r", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("r-icon");
  });

  it("returns csharp icon for .cs files", () => {
    const meta = getFileIconMeta("main.cs", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("cs-icon");
  });

  it("returns xml icon for .xml files", () => {
    const meta = getFileIconMeta("data.xml", false);
    expect(meta.kind).toBe("simple");
    expect(meta.className).toBe("xml-icon");
  });

  it("returns txt icon for .txt files", () => {
    const meta = getFileIconMeta("readme.txt", false);
    expect(meta).toEqual({ kind: "text", label: "≡", className: "txt-icon" });
  });

  it("returns zip icon for archive files", () => {
    for (const ext of ["zip", "tar", "gz", "bz2", "7z", "rar"]) {
      const meta = getFileIconMeta(`archive.${ext}`, false);
      expect(meta).toEqual({ kind: "text", label: "ZIP", className: "zip-icon" });
    }
  });

  it("returns generic icon for unknown extensions", () => {
    const meta = getFileIconMeta("file.unknown", false);
    expect(meta).toEqual({ kind: "text", label: "·", className: "generic-icon" });
  });

  it("returns generic icon for files with no extension", () => {
    const meta = getFileIconMeta("Makefile", false);
    expect(meta).toEqual({ kind: "text", label: "·", className: "generic-icon" });
  });

  it("handles extension case insensitively", () => {
    const upper = getFileIconMeta("README.MD", false);
    const lower = getFileIconMeta("readme.md", false);
    expect(upper.className).toBe(lower.className);
  });

  it("handles dotted filenames correctly", () => {
    const meta = getFileIconMeta(".gitignore", false);
    expect(meta.className).toBe("generic-icon");
  });
});
