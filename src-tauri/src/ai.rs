use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

// ── Claude streaming chat ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}

#[tauri::command]
pub async fn stream_ai_chat(
    messages: Vec<ChatMessage>,
    api_key: String,
    system: String,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let client = Client::new();

    let body = serde_json::to_string(&AnthropicRequest {
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: &system,
        messages: &messages,
        stream: true,
    })
    .map_err(|e| e.to_string())?;

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {body}"));
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
