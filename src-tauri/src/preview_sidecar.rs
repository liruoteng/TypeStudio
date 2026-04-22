//! Sidecar-based preview: spawns `tinymist preview` as a child process,
//! parses the bound data-plane port from its stderr, and exposes the URL
//! to the frontend (which renders it in an <iframe>).
//!
//! This gives us tinymist's full incremental vector-IR pipeline
//! (IncrSvgDocServer + typst.ts WASM renderer) for free, at the cost of
//! an extra process per opened document.

use std::process::Stdio;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// Holds the currently running preview child and the URL it's serving.
#[derive(Default)]
pub struct PreviewSidecar {
    child: Option<Child>,
    url: Option<String>,
    path: Option<String>,
}

pub type SharedSidecar = Arc<Mutex<PreviewSidecar>>;

impl PreviewSidecar {
    /// Stop the running child, if any. Waits for it to exit.
    pub async fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        self.url = None;
        self.path = None;
    }
}

/// Spawn `tinymist preview` and return the preview URL once the data-plane
/// port is bound. The HTTP server at that URL serves both the frontend HTML
/// and the WebSocket upgrade — embedding it in an <iframe> is sufficient.
pub async fn start(
    sidecar: &SharedSidecar,
    tinymist_path: &str,
    input_path: &str,
) -> Result<String, String> {
    let mut guard = sidecar.lock().await;

    // Same file already running? Reuse.
    if guard.path.as_deref() == Some(input_path) {
        if let Some(url) = guard.url.clone() {
            return Ok(url);
        }
    }

    guard.stop().await;

    let mut child = Command::new(tinymist_path)
        .arg("preview")
        .arg("--no-open")
        // Let the OS pick free ports — avoids clashes across documents / runs.
        .arg("--data-plane-host").arg("127.0.0.1:0")
        .arg("--control-plane-host").arg("127.0.0.1:0")
        .arg("--partial-rendering").arg("true")
        .arg("--invert-colors").arg("auto")
        .arg(input_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn tinymist preview: {e}"))?;

    let stderr = child.stderr.take().ok_or("no stderr on child")?;
    let mut reader = BufReader::new(stderr).lines();

    // Read lines until we see the "Data plane server listening on: HOST:PORT"
    // marker. A short timeout guards against hangs.
    let url = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[preview] {line}");
            if let Some(addr) = parse_data_plane_addr(&line) {
                return Some(format!("http://{addr}"));
            }
        }
        None
    })
    .await
    .map_err(|_| "timeout waiting for tinymist preview to bind".to_string())?
    .ok_or_else(|| "tinymist preview exited before binding".to_string())?;

    // Keep draining stderr so the pipe buffer never fills (which would block the child).
    tokio::spawn(async move {
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[preview] {line}");
        }
    });

    guard.child = Some(child);
    guard.url = Some(url.clone());
    guard.path = Some(input_path.to_string());

    Ok(url)
}

/// Stop the current preview child, if any.
pub async fn stop(sidecar: &SharedSidecar) {
    sidecar.lock().await.stop().await;
}

fn parse_data_plane_addr(line: &str) -> Option<String> {
    // Matches e.g. "... Data plane server listening on: 127.0.0.1:54321"
    let idx = line.find("Data plane server listening on:")?;
    let tail = line[idx..].split(':').skip(1).collect::<Vec<_>>().join(":");
    // `tail` now starts with " 127.0.0.1:PORT" (leading space) — trim.
    let addr = tail.trim();
    // Sanity: must contain a colon (host:port).
    if addr.contains(':') && !addr.is_empty() {
        Some(addr.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_plane_line() {
        let line = "[2026-04-20T04:39:05Z INFO  tinymist::cmd::preview] Data plane server listening on: 127.0.0.1:54321";
        assert_eq!(parse_data_plane_addr(line).as_deref(), Some("127.0.0.1:54321"));
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert!(parse_data_plane_addr("hello world").is_none());
        assert!(parse_data_plane_addr("Control panel server listening on: 127.0.0.1:1").is_none());
    }
}
