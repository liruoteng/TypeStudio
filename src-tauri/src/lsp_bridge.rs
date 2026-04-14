//! LSP bridge: spawns Tinymist and proxies messages between
//! its stdio and a local WebSocket server on localhost:8765.
//!
//! Protocol: each message on the wire is a raw LSP frame
//!   Content-Length: <n>\r\n\r\n<json>
//! The WebSocket side sends/receives JSON strings (the body only,
//! without the Content-Length header), and the bridge wraps/unwraps
//! the header when talking to the Tinymist process.

use futures_util::{SinkExt, StreamExt};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

const LSP_PORT: u16 = 8765;

/// Start the LSP bridge. Runs forever until the process exits.
/// Call this in a dedicated tokio task via `tokio::spawn`.
pub async fn run_lsp_bridge(tinymist_path: String) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{LSP_PORT}")).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[lsp_bridge] Failed to bind WebSocket port {LSP_PORT}: {e}");
            return;
        }
    };
    eprintln!("[lsp_bridge] WebSocket server listening on ws://127.0.0.1:{LSP_PORT}");

    while let Ok((stream, addr)) = listener.accept().await {
        eprintln!("[lsp_bridge] New connection from {addr}");
        let path = tinymist_path.clone();
        tokio::spawn(handle_connection(stream, path));
    }
}

/// Handle one WebSocket connection: spawn Tinymist and wire up the pipes.
async fn handle_connection(
    stream: tokio::net::TcpStream,
    tinymist_path: String,
) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[lsp_bridge] WebSocket handshake failed: {e}");
            return;
        }
    };
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // Spawn Tinymist
    let mut child = match Command::new(&tinymist_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[lsp_bridge] Failed to spawn tinymist at {tinymist_path}: {e}");
            return;
        }
    };

    let mut child_stdin = child.stdin.take().expect("stdin");
    let child_stdout = child.stdout.take().expect("stdout");
    let mut stdout_reader = BufReader::new(child_stdout);

    // Broadcast channel so we can signal shutdown to both halves
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    // ── Tinymist stdout → WebSocket ───────────────────────────────────────
    let shutdown_tx2 = shutdown_tx.clone();
    let stdout_task = tokio::spawn(async move {
        loop {
            // Read the "Content-Length: N" header line
            let mut header = String::new();
            match stdout_reader.read_line(&mut header).await {
                Ok(0) | Err(_) => break,
                _ => {}
            }
            let header = header.trim();
            if header.is_empty() {
                continue;
            }
            let len: usize = match header
                .strip_prefix("Content-Length: ")
                .and_then(|s| s.parse().ok())
            {
                Some(n) => n,
                None => continue, // skip other headers
            };

            // Read the blank separator line(s)
            let mut sep = String::new();
            while sep.trim().is_empty() {
                sep.clear();
                if stdout_reader.read_line(&mut sep).await.unwrap_or(0) == 0 {
                    return;
                }
            }

            // Read exactly `len` bytes of JSON body
            let mut body = vec![0u8; len];
            if stdout_reader.read_exact(&mut body).await.is_err() {
                break;
            }
            let json = String::from_utf8_lossy(&body).to_string();

            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
        let _ = shutdown_tx2.send(());
    });

    // ── WebSocket → Tinymist stdin ────────────────────────────────────────
    let mut shutdown_rx = shutdown_tx.subscribe();
    let stdin_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = ws_rx.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            let body = text.as_bytes();
                            let frame = format!(
                                "Content-Length: {}\r\n\r\n",
                                body.len()
                            );
                            if child_stdin.write_all(frame.as_bytes()).await.is_err() { break; }
                            if child_stdin.write_all(body).await.is_err() { break; }
                            let _ = child_stdin.flush().await;
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }
                _ = shutdown_rx.recv() => break,
            }
        }
    });

    // Wait for either half to finish
    tokio::select! {
        _ = stdout_task => {}
        _ = stdin_task => {}
    }

    let _ = child.kill().await;
    eprintln!("[lsp_bridge] Connection closed, Tinymist process killed");
}
