use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command as TokioCommand;

// ── Cancellation flag ──────────────────────────────────────────────────────

pub struct AiCancelFlag(pub Arc<AtomicBool>);

impl Default for AiCancelFlag {
    fn default() -> Self {
        AiCancelFlag(Arc::new(AtomicBool::new(false)))
    }
}

#[tauri::command]
pub fn cancel_ai_stream(cancel: tauri::State<AiCancelFlag>) {
    cancel.0.store(true, Ordering::Relaxed);
}

// ── Shared types ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// ── Claude CLI ────────────────────────────────────────────────────────────

fn extended_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let extras = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ];
    let mut parts: Vec<String> = extras
        .iter()
        .filter(|p| !current.contains(*p))
        .map(|p| p.to_string())
        .collect();
    parts.push(current);
    parts.join(":")
}

#[tauri::command]
pub async fn check_claude_cli() -> String {
    let ok = TokioCommand::new("claude")
        .arg("--version")
        .env("PATH", extended_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if ok { "ready".to_string() } else { "not_found".to_string() }
}

#[tauri::command]
pub async fn stream_claude_cli(
    session_id: Option<String>,
    message: String,
    system: String,
    model: Option<String>,
    effort: Option<String>,
    thinking: bool,
    on_chunk: Channel<String>,
    cancel: tauri::State<'_, AiCancelFlag>,
) -> Result<Option<String>, String> {
    cancel.0.store(false, Ordering::Relaxed);
    let mut cmd = TokioCommand::new("claude");
    cmd.env("PATH", extended_path())
        .arg("--output-format")
        .arg("stream-json")
        .arg("-p")
        .arg(&message);

    if let Some(ref sid) = session_id {
        cmd.arg("--resume").arg(sid);
    } else if !system.is_empty() {
        cmd.arg("--system-prompt").arg(&system);
    }

    if let Some(ref m) = model {
        cmd.arg("--model").arg(m);
    }

    if let Some(ref e) = effort {
        cmd.arg("--effort").arg(e);
    }

    if thinking {
        cmd.arg("--think");
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Claude CLI not found: {e}. Install with: npm install -g @anthropic-ai/claude-code"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Collect stderr in background so it doesn't block
    let stderr_task = tokio::spawn(async move {
        let mut out = String::new();
        BufReader::new(stderr).read_to_string(&mut out).await.ok();
        out
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut new_session_id: Option<String> = None;

    while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
        if cancel.0.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return Err("cancelled".to_string());
        }
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        match event["type"].as_str() {
            Some("stream_event") => {
                let ev = &event["event"];
                if ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta" {
                    if let Some(text) = ev["delta"]["text"].as_str() {
                        on_chunk.send(text.to_string()).map_err(|e| e.to_string())?;
                    }
                }
            }
            Some("system") => {
                if let Some(sid) = event["session_id"].as_str() {
                    new_session_id = Some(sid.to_string());
                }
            }
            Some("result") => {
                if let Some(sid) = event["session_id"].as_str() {
                    new_session_id = Some(sid.to_string());
                }
                if event["subtype"].as_str().map_or(false, |s| s != "success") {
                    let msg = event["error"].as_str().unwrap_or("Claude CLI returned an error");
                    return Err(msg.to_string());
                }
            }
            _ => {}
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() && new_session_id.is_none() {
        return Err(if stderr_output.is_empty() {
            "Claude CLI failed. Make sure you are authenticated — run `claude` in your terminal.".to_string()
        } else {
            stderr_output.trim().to_string()
        });
    }

    Ok(new_session_id)
}

// ── Ollama streaming ───────────────────────────────────────────────────────

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    messages: Vec<OllamaMessage<'a>>,
    stream: bool,
}

#[derive(Serialize)]
struct OllamaMessage<'a> {
    role: &'a str,
    content: &'a str,
}

async fn stream_ollama(
    client: &Client,
    messages: &[ChatMessage],
    base_url: &str,
    model: &str,
    system: &str,
    on_chunk: &Channel<String>,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    // Prepend system message
    let mut ollama_messages: Vec<OllamaMessage> = vec![OllamaMessage {
        role: "system",
        content: system,
    }];
    for m in messages {
        ollama_messages.push(OllamaMessage {
            role: &m.role,
            content: &m.content,
        });
    }

    let body = serde_json::to_string(&OllamaRequest {
        model,
        messages: ollama_messages,
        stream: true,
    })
    .map_err(|e| e.to_string())?;

    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {url}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error {status}: {body}"));
    }

    // Ollama streams NDJSON: each line is a complete JSON object
    let mut byte_stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = byte_stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        loop {
            match buffer.find('\n') {
                None => break,
                Some(pos) => {
                    let line = buffer[..pos].trim().to_string();
                    buffer = buffer[pos + 1..].to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(text) = event["message"]["content"].as_str() {
                            if !text.is_empty() {
                                on_chunk.send(text.to_string()).map_err(|e| e.to_string())?;
                            }
                        }
                        if event["done"].as_bool().unwrap_or(false) {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

// ── Public command ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn stream_ai_chat(
    messages: Vec<ChatMessage>,
    ollama_url: String,
    ollama_model: String,
    system: String,
    on_chunk: Channel<String>,
    cancel: tauri::State<'_, AiCancelFlag>,
) -> Result<(), String> {
    cancel.0.store(false, Ordering::Relaxed);
    let client = Client::new();
    stream_ollama(&client, &messages, &ollama_url, &ollama_model, &system, &on_chunk, &cancel.0).await
}

// ── Ollama server lifecycle ────────────────────────────────────────────────

/// Check if Ollama is reachable; if not, start `ollama serve` in the background.
pub async fn ensure_ollama_server(base_url: String) {
    let client = Client::new();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    if client.get(&url).send().await.is_ok() {
        return; // already running
    }
    eprintln!("[ollama] server not detected, starting `ollama serve`…");
    let _ = TokioCommand::new("ollama")
        .arg("serve")
        .env("PATH", extended_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

// ── List Ollama models ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct OllamaModel {
    pub name: String,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[tauri::command]
pub async fn list_ollama_models(base_url: String) -> Result<Vec<String>, String> {
    let client = Client::new();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {url}: {e}"))?;
    let data: OllamaTagsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data.models.into_iter().map(|m| m.name).collect())
}

// ── Citation search (Semantic Scholar) ────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct CitationAuthor {
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CitationExternalIds {
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CitationResult {
    #[serde(rename = "paperId")]
    pub paper_id: String,
    pub title: Option<String>,
    pub authors: Vec<CitationAuthor>,
    pub year: Option<u32>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    #[serde(rename = "citationCount")]
    pub citation_count: Option<u32>,
    #[serde(rename = "externalIds")]
    pub external_ids: Option<CitationExternalIds>,
}

#[derive(Deserialize)]
struct SemanticScholarResponse {
    data: Option<Vec<CitationResult>>,
}

#[tauri::command]
pub async fn search_citations(query: String) -> Result<Vec<CitationResult>, String> {
    let client = Client::new();
    let resp = client
        .get("https://api.semanticscholar.org/graph/v1/paper/search")
        .query(&[
            ("query", query.as_str()),
            ("fields", "title,authors,year,abstract,citationCount,externalIds"),
            ("limit", "6"),
        ])
        .header("User-Agent", "TypeStudio/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: SemanticScholarResponse = resp.json().await.map_err(|e| e.to_string())?;
    let mut results = data.data.unwrap_or_default();
    results.sort_by(|a, b| {
        b.citation_count
            .unwrap_or(0)
            .cmp(&a.citation_count.unwrap_or(0))
    });
    Ok(results)
}
