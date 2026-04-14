/**
 * Minimal LSP client for Tinymist.
 *
 * Connects to the WebSocket bridge at ws://127.0.0.1:8765 and wires:
 *   - textDocument/publishDiagnostics → Monaco model markers
 *   - textDocument/completion          → Monaco completion provider
 *   - textDocument/hover               → Monaco hover provider
 *
 * Uses raw JSON-RPC over WebSocket — avoids the heavy @codingame/monaco-vscode-api
 * requirement of monaco-languageclient v10.
 */
import type * as Monaco from "monaco-editor";

const LSP_WS_URL = "ws://127.0.0.1:8765";
const RECONNECT_DELAY_MS = 3000;

export type LspStatus = "connecting" | "connected" | "disconnected";

// ── JSON-RPC types ─────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ── LSP position/range helpers ─────────────────────────────────────────────
function monacoRangeFromLsp(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function lspSeverityToMonaco(
  monaco: typeof Monaco,
  sev?: number
): Monaco.MarkerSeverity {
  switch (sev) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    default: return monaco.MarkerSeverity.Hint;
  }
}

// ── Client ─────────────────────────────────────────────────────────────────
export interface LspClientHandle {
  notifyOpen: (uri: string, text: string) => void;
  notifyChange: (uri: string, text: string, version: number) => void;
  notifySave: (uri: string) => void;
  stop: () => void;
}

let _idSeq = 1;
function nextId() { return _idSeq++; }

export function startLspClient(
  monaco: typeof Monaco,
  onStatusChange: (status: LspStatus) => void
): LspClientHandle {
  let ws: WebSocket | null = null;
  let stopped = false;
  let initialized = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingRequests = new Map<number, (result: unknown) => void>();
  let disposables: Monaco.IDisposable[] = [];

  // ── Send helpers ──────────────────────────────────────────────────────
  function send(msg: JsonRpcMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId();
    return new Promise((resolve) => {
      pendingRequests.set(id, resolve);
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  function notify(method: string, params: unknown) {
    send({ jsonrpc: "2.0", method, params });
  }

  // ── Initialize handshake ──────────────────────────────────────────────
  async function initialize() {
    await request("initialize", {
      processId: null,
      clientInfo: { name: "Type Studio", version: "0.1.0" },
      rootUri: null,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, willSave: false },
          completion: { completionItem: { snippetSupport: true } },
          hover: {},
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: { workspaceFolders: false },
      },
      trace: "off",
    });
    notify("initialized", {});
    initialized = true;
    onStatusChange("connected");
  }

  // ── Handle incoming messages ───────────────────────────────────────────
  function onMessage(raw: string) {
    let msg: JsonRpcMessage;
    try { msg = JSON.parse(raw); } catch { return; }

    // Response to a pending request
    if ("id" in msg && "result" in msg) {
      const cb = pendingRequests.get((msg as JsonRpcResponse).id);
      if (cb) {
        pendingRequests.delete((msg as JsonRpcResponse).id);
        cb((msg as JsonRpcResponse).result);
      }
      return;
    }

    // Server-initiated notification
    if ("method" in msg) {
      const notif = msg as JsonRpcNotification;
      if (notif.method === "textDocument/publishDiagnostics") {
        handleDiagnostics(notif.params as DiagnosticsParams);
      }
    }
  }

  interface DiagnosticsParams {
    uri: string;
    diagnostics: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      severity?: number;
      message: string;
    }>;
  }

  function handleDiagnostics(params: DiagnosticsParams) {
    // Find the Monaco model matching the URI
    const model = monaco.editor
      .getModels()
      .find((m) => m.uri.toString() === params.uri);
    if (!model) return;

    const markers: Monaco.editor.IMarkerData[] = params.diagnostics.map((d) => ({
      ...monacoRangeFromLsp(d.range),
      severity: lspSeverityToMonaco(monaco, d.severity),
      message: d.message,
    }));
    monaco.editor.setModelMarkers(model, "tinymist", markers);
  }

  // ── Register Monaco providers ─────────────────────────────────────────
  function registerProviders() {
    const completionProvider = monaco.languages.registerCompletionItemProvider("typst", {
      triggerCharacters: [".", "#", "("],
      provideCompletionItems: async (model, position) => {
        if (!initialized) return { suggestions: [] };
        const result = await request("textDocument/completion", {
          textDocument: { uri: model.uri.toString() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }) as CompletionResult | null;

        if (!result) return { suggestions: [] };
        const items = Array.isArray(result) ? result : result.items ?? [];
        const suggestions: Monaco.languages.CompletionItem[] = items.map((item: CompletionItem) => ({
          label: typeof item.label === "string" ? item.label : item.label.label,
          kind: (item.kind ?? 1) - 1 as Monaco.languages.CompletionItemKind,
          insertText: item.insertText ?? (typeof item.label === "string" ? item.label : item.label.label),
          insertTextRules: item.insertTextFormat === 2
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          documentation: typeof item.documentation === "string"
            ? item.documentation
            : item.documentation?.value,
          range: position
            ? {
                startLineNumber: position.lineNumber,
                startColumn: model.getWordUntilPosition(position).startColumn,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              }
            : undefined as never,
        }));
        return { suggestions };
      },
    });

    const hoverProvider = monaco.languages.registerHoverProvider("typst", {
      provideHover: async (model, position) => {
        if (!initialized) return null;
        const result = await request("textDocument/hover", {
          textDocument: { uri: model.uri.toString() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }) as HoverResult | null;

        if (!result?.contents) return null;
        const contents = Array.isArray(result.contents)
          ? result.contents
          : [result.contents];
        return {
          contents: contents.map((c) => ({
            value: typeof c === "string" ? c : c.value ?? "",
          })),
        };
      },
    });

    disposables = [completionProvider, hoverProvider];
  }

  // ── LSP types (minimal) ───────────────────────────────────────────────
  interface CompletionItem {
    label: string | { label: string };
    kind?: number;
    insertText?: string;
    insertTextFormat?: number;
    documentation?: string | { kind: string; value: string };
  }
  interface CompletionResult {
    isIncomplete?: boolean;
    items?: CompletionItem[];
  }
  interface HoverResult {
    contents: string | { kind: string; value: string } | Array<string | { value: string }>;
    range?: unknown;
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────────
  function connect() {
    if (stopped) return;
    onStatusChange("connecting");

    const socket = new WebSocket(LSP_WS_URL);
    ws = socket;

    socket.onopen = () => {
      if (stopped) { socket.close(); return; }
      initialize().catch(console.error);
    };

    socket.onmessage = (ev) => onMessage(ev.data as string);

    socket.onerror = () => scheduleReconnect();

    socket.onclose = () => {
      initialized = false;
      onStatusChange("disconnected");
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) connect();
    }, RECONNECT_DELAY_MS);
  }

  // ── Public API ────────────────────────────────────────────────────────
  const handle: LspClientHandle = {
    notifyOpen(uri, text) {
      if (!initialized) return;
      notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "typst", version: 1, text },
      });
    },
    notifyChange(uri, text, version) {
      if (!initialized) return;
      notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    },
    notifySave(uri) {
      if (!initialized) return;
      notify("textDocument/didSave", { textDocument: { uri } });
    },
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      disposables.forEach((d) => d.dispose());
      ws?.close();
    },
  };

  registerProviders();
  connect();

  return handle;
}
