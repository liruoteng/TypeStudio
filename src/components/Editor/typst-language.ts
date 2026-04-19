import type * as Monaco from "monaco-editor";

/**
 * Register the "typst" language with Monaco:
 *  - file extensions (.typ)
 *  - basic tokenizer for syntax highlighting
 *  - bracket pairs, comments, folding
 */
export function registerTypstLanguage(monaco: typeof Monaco) {
  monaco.languages.register({
    id: "typst",
    extensions: [".typ"],
    aliases: ["Typst", "typst"],
  });

  monaco.languages.setLanguageConfiguration("typst", {
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "$", close: "$", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "$", close: "$" },
    ],
    folding: {
      markers: {
        start: /^\s*\/\/ *#region\b/,
        end: /^\s*\/\/ *#endregion\b/,
      },
    },
    indentationRules: {
      increaseIndentPattern: /^\s*[^\/].*[{(\[]\s*$/,
      decreaseIndentPattern: /^\s*[}\]\)]/,
    },
  });

  monaco.languages.setMonarchTokensProvider("typst", {
    defaultToken: "",
    tokenPostfix: ".typst",

    keywords: [
      "let", "set", "show", "if", "else", "for", "in", "while",
      "break", "continue", "return", "import", "include", "as",
      "not", "and", "or", "none", "auto", "true", "false",
    ],

    builtins: [
      "align", "block", "box", "circle", "colbreak", "columns",
      "ellipse", "figure", "footnote", "grid", "heading", "hide",
      "image", "line", "link", "list", "locate", "math", "move",
      "outline", "overline", "pad", "page", "pagebreak", "par",
      "parbreak", "path", "place", "polygon", "quote", "raw",
      "rect", "ref", "rotate", "scale", "smallcaps", "square",
      "stack", "strike", "strong", "sub", "super", "table",
      "terms", "text", "underline", "v", "h", "enum",
    ],

    operators: [
      "=", "+", "-", "*", "/", "<", ">", "<=", ">=", "==", "!=",
      "+=", "-=", "*=", "/=", "..", "=>",
    ],

    tokenizer: {
      root: [
        // Heading
        [/^(={1,6})\s/, "markup.heading"],

        // Code mode — everything after # until end of expression
        [/#[a-zA-Z_]\w*/, "keyword.control"],

        // Math mode
        [/\$/, { token: "string.math", bracket: "@open", next: "@math" }],

        // Line comment
        [/\/\/.*$/, "comment"],

        // Block comment
        [/\/\*/, { token: "comment.block", bracket: "@open", next: "@blockComment" }],

        // String literal
        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],

        // Label / reference
        [/<[a-zA-Z_][\w-]*>/, "entity.name.tag"],
        [/@[a-zA-Z_][\w-]*/, "entity.name.tag"],

        // Numbers
        [/\d+(\.\d+)?(pt|em|cm|mm|in|%|fr|deg|rad)?/, "number"],

        // Keywords and identifiers
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@builtins": "support.function",
              "@default": "identifier",
            },
          },
        ],

        // Brackets
        [/[{}()\[\]]/, "@brackets"],

        // Operators
        [/[=+\-*/<>!]+/, "operator"],

        // Raw / code block
        [/`{3}(\w+)/, { token: "string.raw", bracket: "@open", nextEmbedded: "$1", next: "@rawBlockEmbedded" }],
        [/`{3}/, { token: "string.raw", bracket: "@open", next: "@rawBlock" }],
        [/`[^`]*`/, "string.raw"],

        // Bold / italic markup
        [/\*[^*]+\*/, "markup.bold"],
        [/_[^_]+_/, "markup.italic"],

        // Whitespace
        [/\s+/, "white"],
      ],

      math: [
        [/\$/, { token: "string.math", bracket: "@close", next: "@pop" }],
        [/[a-zA-Z_]\w*/, "variable.math"],
        [/\d+(\.\d+)?/, "number"],
        [/[\\^_{}()\[\]]/, "operator.math"],
        [/./, "string.math"],
      ],

      blockComment: [
        [/[^/*]+/, "comment.block"],
        [/\*\//, { token: "comment.block", bracket: "@close", next: "@pop" }],
        [/./, "comment.block"],
      ],

      string: [
        [/[^"\\]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],

      rawBlockEmbedded: [
        [/`{3}/, { token: "string.raw", bracket: "@close", nextEmbedded: "@pop", next: "@pop" }],
        [/./, ""],
      ],
      rawBlock: [
        [/`{3}/, { token: "string.raw", bracket: "@close", next: "@pop" }],
        [/./, "string.raw"],
      ],
    },
  });

  // Dark theme tokens for Typst
  monaco.editor.defineTheme("typst-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "markup.heading", foreground: "569CD6", fontStyle: "bold" },
      { token: "keyword", foreground: "C586C0" },
      { token: "keyword.control", foreground: "4FC1FF" },
      { token: "support.function", foreground: "DCDCAA" },
      { token: "string", foreground: "CE9178" },
      { token: "string.math", foreground: "B5CEA8" },
      { token: "string.raw", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "comment.block", foreground: "6A9955", fontStyle: "italic" },
      { token: "operator", foreground: "D4D4D4" },
      { token: "entity.name.tag", foreground: "4EC9B0" },
      { token: "markup.bold", foreground: "D7BA7D", fontStyle: "bold" },
      { token: "markup.italic", foreground: "D7BA7D", fontStyle: "italic" },
      { token: "variable.math", foreground: "9CDCFE" },
    ],
    colors: {
      "editor.background": "#1E1E1E",
    },
  });

  // Claude light theme tokens for Typst (warm, claude.ai-inspired)
  monaco.editor.defineTheme("typst-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "markup.heading", foreground: "6B4FAE", fontStyle: "bold" },
      { token: "keyword", foreground: "A0328C" },
      { token: "keyword.control", foreground: "D97559" },
      { token: "support.function", foreground: "8B6914" },
      { token: "string", foreground: "B5471C" },
      { token: "string.math", foreground: "4E8B4E" },
      { token: "string.raw", foreground: "B5471C" },
      { token: "number", foreground: "4E8B4E" },
      { token: "comment", foreground: "7A7672", fontStyle: "italic" },
      { token: "comment.block", foreground: "7A7672", fontStyle: "italic" },
      { token: "operator", foreground: "3A3A3A" },
      { token: "entity.name.tag", foreground: "1A7A6E" },
      { token: "markup.bold", foreground: "8B6914", fontStyle: "bold" },
      { token: "markup.italic", foreground: "8B6914", fontStyle: "italic" },
      { token: "variable.math", foreground: "1D6BB3" },
    ],
    colors: {
      "editor.background": "#FAF9F6",
      "editor.foreground": "#1C1C1C",
      "editorLineNumber.foreground": "#ABA59A",
      "editorLineNumber.activeForeground": "#4A4846",
      "editor.selectionBackground": "#D6CEBD",
      "editor.lineHighlightBackground": "#F0EDE4",
      "editorCursor.foreground": "#D97559",
      "editor.findMatchBackground": "#F0C4A8",
      "editor.findMatchHighlightBackground": "#F5DDD0",
      "editorWidget.background": "#F0EDE4",
      "editorWidget.border": "#D4CFBF",
      "editorSuggestWidget.background": "#F0EDE4",
      "editorSuggestWidget.border": "#D4CFBF",
      "editorSuggestWidget.selectedBackground": "#D6CEBD",
      "scrollbarSlider.background": "#C4BFAF66",
      "scrollbarSlider.hoverBackground": "#C4BFAF99",
    },
  });
}
