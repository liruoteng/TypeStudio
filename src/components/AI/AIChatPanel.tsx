import { useState, useRef, useEffect, useCallback } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";
import "./AIChatPanel.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

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

const SYSTEM_PROMPT =
  "You are a writing assistant in Type Studio, a Typst academic document editor. " +
  "Help users write, improve, and edit their content. Respond concisely and in plain text. " +
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

export function AIChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [citationResults, setCitationResults] = useState<CitationResult[] | null>(null);
  const [isCiteMode, setIsCiteMode] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<boolean>(false);

  const selectedText = useEditorStore((s) => s.selectedText);
  const apiKey = useEditorStore((s) => s.aiApiKey);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, citationResults]);

  const insertAtCursor = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent("editor:insert", { detail: text }));
  }, []);

  const handleCopyBib = useCallback(async (paper: CitationResult) => {
    await navigator.clipboard.writeText(generateBibEntry(paper));
    setCopiedKey(paper.paperId);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");

    // ── Citation search mode ─────────────────────────────────────────────
    if (trimmed.startsWith("/cite ")) {
      const query = trimmed.slice(6).trim();
      if (!query) return;
      setIsCiteMode(true);
      setCitationResults(null);
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setIsLoading(true);
      try {
        const results = await invoke<CitationResult[]>("search_citations", { query });
        setCitationResults(results);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              results.length === 0
                ? "No results found."
                : `Found ${results.length} papers, ranked by citation count.`,
          },
        ]);
      } catch (e) {
        setCitationResults([]);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Citation search failed: ${String(e)}` },
        ]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── AI chat mode ─────────────────────────────────────────────────────
    setIsCiteMode(false);
    setCitationResults(null);

    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        {
          role: "assistant",
          content: "No API key configured. Please add your Claude API key in Settings → AI.",
        },
      ]);
      return;
    }

    // Include selected text as context in the API message (not shown in UI history)
    let contextualContent = trimmed;
    if (selectedText) {
      contextualContent = `Selected text:\n\`\`\`\n${selectedText}\n\`\`\`\n\n${trimmed}`;
    }

    const uiMessages: Message[] = [...messages, { role: "user", content: trimmed }];
    const apiMessages = [
      ...messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: contextualContent },
    ];

    setMessages([...uiMessages, { role: "assistant", content: "" }]);
    setIsLoading(true);
    abortRef.current = false;

    try {
      const onChunk = new Channel<string>();
      onChunk.onmessage = (chunk: string) => {
        if (abortRef.current) return;
        setMessages((prev) => {
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
        apiKey,
        system: SYSTEM_PROMPT,
        onChunk,
      });
    } catch (e: unknown) {
      if (!abortRef.current) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: `Error: ${String(e)}`,
          };
          return copy;
        });
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
  };

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-messages">
        {messages.length === 0 && (
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

        {messages.map((msg, i) => (
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
                  {paper.authors
                    .slice(0, 3)
                    .map((a) => a.name)
                    .join(", ")}
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
          placeholder={
            selectedText ? "Ask about selection… or /cite query" : "Ask anything… or /cite query"
          }
          rows={3}
          disabled={isLoading}
        />
        <div className="ai-chat-input-actions">
          {isLoading ? (
            <button className="ai-chat-btn ai-chat-btn--stop" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              className="ai-chat-btn ai-chat-btn--send"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
