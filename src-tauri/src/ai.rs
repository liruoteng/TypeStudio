use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

// ── Shared types ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// ── Claude (Anthropic) streaming ───────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}

async fn stream_claude(
    client: &Client,
    messages: &[ChatMessage],
    api_key: &str,
    system: &str,
    on_chunk: &Channel<String>,
) -> Result<(), String> {
    let body = serde_json::to_string(&AnthropicRequest {
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system,
        messages,
        stream: true,
    })
    .map_err(|e| e.to_string())?;

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error {status}: {body}"));
    }

    let mut byte_stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        loop {
            match buffer.find('\n') {
                None => break,
                Some(pos) => {
                    let line = buffer[..pos].trim().to_string();
                    buffer = buffer[pos + 1..].to_string();
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            return Ok(());
                        }
                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                            if event["type"] == "content_block_delta"
                                && event["delta"]["type"] == "text_delta"
                            {
                                if let Some(text) = event["delta"]["text"].as_str() {
                                    on_chunk.send(text.to_string()).map_err(|e| e.to_string())?;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
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
    provider: String,
    api_key: String,
    ollama_url: String,
    ollama_model: String,
    system: String,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let client = Client::new();
    match provider.as_str() {
        "ollama" => {
            stream_ollama(&client, &messages, &ollama_url, &ollama_model, &system, &on_chunk).await
        }
        _ => stream_claude(&client, &messages, &api_key, &system, &on_chunk).await,
    }
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
