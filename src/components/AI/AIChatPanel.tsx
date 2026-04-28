import { useState, useRef, useEffect, useCallback } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useEditorStore, type AiMessage } from "../../stores/editorStore";
import "./AIChatPanel.css";

interface CitationAuthor {
  name: string;
}

interface CitationResult {
  paperId: string;
  title: string | null;
  authors: CitationAuthor[];
  year: number | null;
  abstract: string | null;
  citationCount: number | null;
  externalIds: { DOI?: string } | null;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type ChatMode = "plan" | "action";

const CLAUDE_MODELS = [
  { id: "claude-opus-4-7",           label: "Opus 4.7" },
  { id: "claude-sonnet-4-6",         label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const SYSTEM_PROMPT =
  "You are a writing assistant in Type Studio, a Typst academic document editor. " +
  "Help users write, improve, and edit their content. Respond in plain text. " +
  "When given selected text as context, focus your response on working with that text.";

function generateBibKey(paper: CitationResult): string {
  const firstAuthor = paper.authors[0]?.name ?? "unknown";
  const lastName = firstAuthor.split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown";
  return `${lastName}${paper.year ?? "nd"}`;
}

function generateBibEntry(paper: CitationResult): string {
  const key = generateBibKey(paper);
  const authors = paper.authors.map((a) => a.name).join(" and ");
  const doi = paper.externalIds?.DOI ? `  doi = {${paper.externalIds.DOI}},\n` : "";
  return `@article{${key},\n  title = {${paper.title ?? ""}},\n  author = {${authors}},\n  year = {${paper.year ?? ""}},\n${doi}}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AIChatPanel() {
  // ── Sessions from store ────────────────────────────────────────────────
  const chatSessions        = useEditorStore((s) => s.chatSessions);
  const activeChatSessionId = useEditorStore((s) => s.activeChatSessionId);
  const createChatSession     = useEditorStore((s) => s.createChatSession);
  const setActiveChatSession  = useEditorStore((s) => s.setActiveChatSession);
  const updateChatSession     = useEditorStore((s) => s.updateChatSession);
  const updateSessionClaudeId = useEditorStore((s) => s.updateSessionClaudeId);
  const renameChatSession     = useEditorStore((s) => s.renameChatSession);
  const forkChatSession       = useEditorStore((s) => s.forkChatSession);
  const deleteChatSession     = useEditorStore((s) => s.deleteChatSession);

  const activeSession = chatSessions.find((s) => s.id === activeChatSessionId) ?? null;

  // ── Local view state ───────────────────────────────────────────────────
  const [showSessions, setShowSessions] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [cliStatus, setCliStatus] = useState<"checking" | "ready" | "not_found">("checking");
  // Local messages: mirrors active session + live streaming turn
  const [localMessages, setLocalMessages] = useState<AiMessage[]>(activeSession?.messages ?? []);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [citationResults, setCitationResults] = useState<CitationResult[] | null>(null);
  const [isCiteMode, setIsCiteMode] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<boolean>(false);
  const localMessagesRef = useRef(localMessages);
  localMessagesRef.current = localMessages;

  // ── Toolbar state ──────────────────────────────────────────────────────
  const [effort, setEffort] = useState<Effort>("high");
  const [thinking, setThinking] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("plan");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  // ── Provider settings ──────────────────────────────────────────────────
  const selectedText = useEditorStore((s) => s.selectedText);
  const aiProvider   = useEditorStore((s) => s.aiProvider);
  const setAiProvider  = useEditorStore((s) => s.setAiProvider);
  const ollamaUrl      = useEditorStore((s) => s.ollamaUrl);
  const ollamaModel    = useEditorStore((s) => s.ollamaModel);
  const setOllamaModel = useEditorStore((s) => s.setOllamaModel);
  const claudeModel    = useEditorStore((s) => s.claudeModel);
  const setClaudeModel = useEditorStore((s) => s.setClaudeModel);

  // ── Check Claude CLI on mount ──────────────────────────────────────────
  useEffect(() => {
    if (aiProvider === "claude-cli") {
      invoke<string>("check_claude_cli")
        .then((s) => setCliStatus(s as "ready" | "not_found"))
        .catch(() => setCliStatus("not_found"));
    }
  }, [aiProvider]);

  // ── Fetch Ollama models ────────────────────────────────────────────────
  useEffect(() => {
    invoke<string[]>("list_ollama_models", { baseUrl: ollamaUrl })
      .then(setOllamaModels)
      .catch(() => setOllamaModels([]));
  }, [ollamaUrl]);

  // Sync local messages when active session changes (panel switch or session switch)
  useEffect(() => {
    setLocalMessages(activeSession?.messages ?? []);
    setCitationResults(null);
    setIsCiteMode(false);
  }, [activeChatSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Commit local messages back to the store when streaming finishes or on unmount
  const commitMessages = useCallback((msgs: AiMessage[]) => {
    if (activeChatSessionId) updateChatSession(activeChatSessionId, msgs);
  }, [activeChatSessionId, updateChatSession]);

  useEffect(() => {
    return () => { commitMessages(localMessagesRef.current); };
  }, [commitMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages, citationResults]);

  // ── Ensure there is always an active session ───────────────────────────
  useEffect(() => {
    if (!activeChatSessionId) createChatSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewSession = () => {
    commitMessages(localMessagesRef.current);
    createChatSession();
    setShowSessions(false);
  };

  const handleSwitchSession = (id: string) => {
    commitMessages(localMessagesRef.current);
    setActiveChatSession(id);
    setShowSessions(false);
  };

  const insertAtCursor = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent("editor:insert", { detail: text }));
  }, []);

  const handleCopyBib = useCallback(async (paper: CitationResult) => {
    await navigator.clipboard.writeText(generateBibEntry(paper));
    setCopiedKey(paper.paperId);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  // ── Toolbar helpers ────────────────────────────────────────────────────
  const modelValue = aiProvider === "claude-cli"
    ? `claude-cli:${claudeModel}`
    : `ollama:${ollamaModel}`;

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val.startsWith("claude-cli:")) {
      const newModel = val.slice(11);
      setAiProvider("claude-cli");
      setClaudeModel(newModel);
      if (effort === "xhigh" && newModel !== "claude-opus-4-7") setEffort("high");
    } else if (val.startsWith("ollama:")) {
      setAiProvider("ollama");
      setOllamaModel(val.slice(7));
      if (effort === "xhigh") setEffort("high");
    }
  };

  const estimatedTokens = localMessages.reduce(
    (sum, m) => sum + Math.ceil(m.content.length / 4),
    0
  );
  const contextPct = Math.min(99, Math.round(estimatedTokens / 2000)); // 200k token window

  // ── Send message ───────────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");

    // Citation search
    if (trimmed.startsWith("/cite ")) {
      const query = trimmed.slice(6).trim();
      if (!query) return;
      setIsCiteMode(true);
      setCitationResults(null);
      const next: AiMessage[] = [...localMessages, { role: "user", content: trimmed }];
      setLocalMessages(next);
      setIsLoading(true);
      try {
        const results = await invoke<CitationResult[]>("search_citations", { query });
        setCitationResults(results);
        const withReply: AiMessage[] = [
          ...next,
          {
            role: "assistant",
            content: results.length === 0
              ? "No results found."
              : `Found ${results.length} papers, ranked by citation count.`,
          },
        ];
        setLocalMessages(withReply);
        commitMessages(withReply);
      } catch (e) {
        setCitationResults([]);
        const withErr: AiMessage[] = [...next, { role: "assistant", content: `Citation search failed: ${String(e)}` }];
        setLocalMessages(withErr);
        commitMessages(withErr);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // AI chat
    setIsCiteMode(false);
    setCitationResults(null);

    if (aiProvider === "claude-cli" && cliStatus !== "ready") {
      const msgs: AiMessage[] = [
        ...localMessages,
        { role: "user", content: trimmed },
        { role: "assistant", content: "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code, then run `claude` to authenticate." },
      ];
      setLocalMessages(msgs);
      commitMessages(msgs);
      return;
    }

    let contextualContent = trimmed;
    if (selectedText) {
      contextualContent = `Selected text:\n\`\`\`\n${selectedText}\n\`\`\`\n\n${trimmed}`;
    }

    const withUser: AiMessage[] = [...localMessages, { role: "user", content: trimmed }];
    const withPlaceholder: AiMessage[] = [...withUser, { role: "assistant", content: "" }];
    setLocalMessages(withPlaceholder);

    setIsLoading(true);
    abortRef.current = false;

    try {
      if (aiProvider === "ollama") {
        const apiMessages = [
          ...localMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: contextualContent },
        ];
        const onChunk = new Channel<string>();
        onChunk.onmessage = (chunk: string) => {
          if (abortRef.current) return;
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: (copy[copy.length - 1]?.content ?? "") + chunk,
            };
            return copy;
          });
        };
        await invoke("stream_ai_chat", {
          messages: apiMessages,
          ollamaUrl,
          ollamaModel,
          system: SYSTEM_PROMPT,
          onChunk,
        });
      } else {
        // Claude CLI: session-based, no need to replay history
        const onChunk = new Channel<string>();
        onChunk.onmessage = (chunk: string) => {
          if (abortRef.current) return;
          setLocalMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: (copy[copy.length - 1]?.content ?? "") + chunk,
            };
            return copy;
          });
        };

        const returnedSessionId = await invoke<string | null>("stream_claude_cli", {
          sessionId: activeSession?.claudeSessionId ?? null,
          message: contextualContent,
          system: activeSession?.claudeSessionId ? "" : SYSTEM_PROMPT,
          model: claudeModel || null,
          effort,
          thinking,
          onChunk,
        });

        if (returnedSessionId && activeChatSessionId) {
          updateSessionClaudeId(activeChatSessionId, returnedSessionId);
        }
      }

      commitMessages(localMessagesRef.current);

      if (chatMode === "action") {
        const msgs = localMessagesRef.current;
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant" && last.content) {
          insertAtCursor(last.content);
        }
      }
    } catch (e: unknown) {
      if (!abortRef.current) {
        setLocalMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: `Error: ${String(e)}` };
          return copy;
        });
        commitMessages(localMessagesRef.current);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setIsLoading(false);
    commitMessages(localMessagesRef.current);
  };

  // ── Session list helpers ───────────────────────────────────────────────
  function dateGroup(ts: number): string {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= todayStart) return "Today";
    if (ts >= todayStart - 86400000) return "Yesterday";
    if (ts >= todayStart - 6 * 86400000) return "This week";
    return "Older";
  }

  const filteredSessions = [...chatSessions]
    .reverse()
    .filter((s) => s.title.toLowerCase().includes(sessionSearch.toLowerCase()));

  const grouped = filteredSessions.reduce<Record<string, typeof filteredSessions>>((acc, sess) => {
    const g = dateGroup(sess.createdAt);
    (acc[g] ??= []).push(sess);
    return acc;
  }, {});

  const GROUP_ORDER = ["Today", "Yesterday", "This week", "Older"];

  const commitRename = () => {
    if (renamingId) renameChatSession(renamingId, renameValue);
    setRenamingId(null);
  };

  // ── Sessions list view ─────────────────────────────────────────────────
  if (showSessions) {
    return (
      <div className="ai-chat-panel">
        <div className="ai-sessions-header">
          <button className="ai-sessions-back" onClick={() => setShowSessions(false)}>← Back</button>
          <span className="ai-sessions-header-title">Chats</span>
          <button className="ai-chat-btn ai-chat-btn--send ai-sessions-new" onClick={handleNewSession}>+ New</button>
        </div>

        <div className="ai-sessions-search-row">
          <input
            className="ai-sessions-search"
            placeholder="Search chats…"
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
          />
        </div>

        <div className="ai-sessions-list">
          {filteredSessions.length === 0 && (
            <div className="ai-sessions-empty">
              {sessionSearch ? "No matching chats." : "No chats yet."}
            </div>
          )}

          {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
            <div key={group} className="ai-sessions-group">
              <div className="ai-sessions-group-label">{group}</div>
              {grouped[group].map((sess) => {
                const lastMsg = [...sess.messages].reverse().find((m) => m.role === "assistant");
                const isActive = sess.id === activeChatSessionId;
                const isRenaming = renamingId === sess.id;
                return (
                  <div
                    key={sess.id}
                    className={`ai-session-item${isActive ? " ai-session-item--active" : ""}`}
                    onClick={() => !isRenaming && handleSwitchSession(sess.id)}
                  >
                    <div className="ai-session-item-main">
                      {isRenaming ? (
                        <input
                          className="ai-session-rename-input"
                          value={renameValue}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setRenamingId(null);
                            e.stopPropagation();
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div
                          className="ai-session-item-title"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(sess.id);
                            setRenameValue(sess.title);
                          }}
                          title="Double-click to rename"
                        >
                          {sess.title}
                        </div>
                      )}
                      {lastMsg && !isRenaming && (
                        <div className="ai-session-item-preview">
                          {lastMsg.content.slice(0, 80)}{lastMsg.content.length > 80 ? "…" : ""}
                        </div>
                      )}
                      <div className="ai-session-item-meta">
                        {formatDate(sess.createdAt)} · {sess.messages.length} msg{sess.messages.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="ai-session-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="ai-session-action-btn"
                        onClick={() => { forkChatSession(sess.id); setShowSessions(false); }}
                        title="Fork session"
                      >
                        ⎇
                      </button>
                      <button
                        className="ai-session-action-btn ai-session-action-btn--delete"
                        onClick={() => deleteChatSession(sess.id)}
                        title="Delete session"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Chat view ──────────────────────────────────────────────────────────
  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-topbar">
        <button className="ai-topbar-btn" onClick={() => setShowSessions(true)} title="All sessions">☰</button>
        <span className="ai-topbar-title">{activeSession?.title ?? "New chat"}</span>
        <button className="ai-topbar-btn" onClick={handleNewSession} title="New chat">+</button>
      </div>

      {aiProvider === "claude-cli" && cliStatus !== "ready" && (
        <div className={`ai-cli-banner ai-cli-banner--${cliStatus}`}>
          {cliStatus === "checking" ? "Checking Claude CLI…" : (
            <>
              Claude CLI not found.{" "}
              <a href="https://claude.ai/download" target="_blank" rel="noreferrer">Install Claude</a>
              {" "}and run <code>claude</code> to log in.
            </>
          )}
        </div>
      )}

      <div className="ai-chat-messages">
        {localMessages.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-icon">✦</div>
            <p>Ask anything about your document.</p>
            <p className="ai-chat-hint">
              Select text in the editor to provide context.
              <br />
              Use <code>/cite query</code> to search references.
            </p>
          </div>
        )}

        {localMessages.map((msg, i) => (
          <div key={i} className={`ai-chat-message ai-chat-message--${msg.role}`}>
            <div className="ai-chat-message-body">{msg.content}</div>
            {msg.role === "assistant" &&
              msg.content &&
              !msg.content.startsWith("Found ") &&
              !msg.content.startsWith("No results") && (
                <button
                  className="ai-chat-insert-btn"
                  onClick={() => insertAtCursor(msg.content)}
                  title="Insert response at cursor position"
                >
                  Insert at cursor
                </button>
              )}
          </div>
        ))}

        {isCiteMode && citationResults && citationResults.length > 0 && (
          <div className="ai-cite-results">
            {citationResults.map((paper) => (
              <div key={paper.paperId} className="ai-cite-card">
                <div className="ai-cite-card-title">{paper.title ?? "(no title)"}</div>
                <div className="ai-cite-card-meta">
                  {paper.authors.slice(0, 3).map((a) => a.name).join(", ")}
                  {paper.authors.length > 3 && " et al."}
                  {paper.year ? ` · ${paper.year}` : ""}
                  {` · ${paper.citationCount ?? 0} citations`}
                </div>
                {paper.abstract && (
                  <div className="ai-cite-card-abstract">
                    {paper.abstract.slice(0, 180)}
                    {paper.abstract.length > 180 ? "…" : ""}
                  </div>
                )}
                <div className="ai-cite-card-actions">
                  <button
                    className="ai-cite-btn"
                    onClick={() => insertAtCursor(`@${generateBibKey(paper)}`)}
                    title="Insert @key citation at cursor"
                  >
                    Insert @{generateBibKey(paper)}
                  </button>
                  <button
                    className="ai-cite-btn ai-cite-btn--secondary"
                    onClick={() => handleCopyBib(paper)}
                    title="Copy BibTeX entry to clipboard"
                  >
                    {copiedKey === paper.paperId ? "Copied!" : "Copy BibTeX"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {selectedText && (
        <div className="ai-context-badge">
          <span className="ai-context-label">Context:</span>
          <span className="ai-context-text">
            {selectedText.slice(0, 80)}
            {selectedText.length > 80 ? "…" : ""}
          </span>
        </div>
      )}

      <div className="ai-chat-input-area">
        <textarea
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedText ? "Ask about selection… or /cite query" : "Ask anything… or /cite query"}
          rows={3}
          disabled={isLoading}
        />
        <div className="ai-chat-input-actions">
          <select
            className="ai-toolbar-model"
            value={modelValue}
            onChange={handleModelChange}
            title="Model"
          >
            <optgroup label="Claude">
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={`claude-cli:${m.id}`}>{m.label}</option>
              ))}
            </optgroup>
            {ollamaModels.length > 0 && (
              <optgroup label="Ollama (local)">
                {ollamaModels.map((m) => (
                  <option key={m} value={`ollama:${m}`}>{m}</option>
                ))}
                {aiProvider === "ollama" && !ollamaModels.includes(ollamaModel) && (
                  <option value={`ollama:${ollamaModel}`}>{ollamaModel}</option>
                )}
              </optgroup>
            )}
          </select>

          <span className="ai-toolbar-sep" />

          <span className="ai-toolbar-label">Effort:</span>
          <select
            className="ai-toolbar-select"
            value={effort}
            onChange={(e) => setEffort(e.target.value as Effort)}
            title="Effort"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            {claudeModel === "claude-opus-4-7" && (
              <option value="xhigh">XHigh</option>
            )}
            <option value="max">Max</option>
          </select>

          <button
            className={`ai-think-btn${thinking ? " active" : ""}`}
            onClick={() => setThinking((t) => !t)}
            title={thinking ? "Thinking on" : "Thinking off"}
          >
            ◑
          </button>

          <span className="ai-toolbar-tokens" title="Estimated context usage">
            {contextPct}%
          </span>

          <span className="ai-toolbar-spacer" />

          <span className="ai-toolbar-label">Act</span>
          <label className="ai-mode-toggle" title={chatMode === "action" ? "Auto-insert on" : "Auto-insert off"}>
            <input
              type="checkbox"
              checked={chatMode === "action"}
              onChange={(e) => setChatMode(e.target.checked ? "action" : "plan")}
            />
            <span className="ai-mode-toggle-track" />
          </label>

          <span className="ai-toolbar-sep" />

          {isLoading ? (
            <button className="ai-chat-btn ai-chat-btn--stop" onClick={handleStop}>Stop</button>
          ) : (
            <button className="ai-chat-btn ai-chat-btn--send" onClick={handleSend} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
