//! Auth + retry + HTTP client for Navidrome's native REST API.
//! Used by every other navidrome submodule for `/auth/*` and `/api/*` calls.

/// Authenticate with Navidrome's own REST API and return a Bearer token.
pub(crate) async fn navidrome_token(server_url: &str, username: &str, password: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/auth/login", server_url))
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    data["token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Navidrome auth: no token in response".to_string())
}

/// Payload returned by Navidrome's `/auth/login`.
#[derive(serde::Serialize)]
pub(crate) struct NdLoginResult {
    pub(super) token: String,
    #[serde(rename = "userId")]
    pub(super) user_id: String,
    #[serde(rename = "isAdmin")]
    pub(super) is_admin: bool,
}

/// Flatten an error and its `source` chain into a single readable string so
/// frontend toasts can show the actual transport cause (connection refused,
/// tls handshake fail, cert expired, etc.) instead of reqwest's opaque
/// "error sending request for url (…)" wrapper.
pub(crate) fn nd_err(e: reqwest::Error) -> String {
    let mut msg = e.to_string();
    let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(&e);
    while let Some(s) = src {
        msg.push_str(" | ");
        msg.push_str(&s.to_string());
        src = s.source();
    }
    msg
}

/// Retry a request-building closure on transient transport errors
/// (connect/timeout — includes ECONNRESET, TLS handshake EOF, DNS flakes).
/// Three attempts with calm backoff: 0 → 300ms → 700ms (total worst case
/// ~1s). Retrying too aggressively (5+ attempts, short backoff) can drive
/// an already-stressed nginx upstream-probe into "offline" mode, which
/// turns a transient glitch into a visible outage. Status-level failures
/// (401/403/400 with body) return immediately — we don't retry logic
/// errors.
pub(crate) async fn nd_retry<F, Fut>(mut build_and_send: F) -> Result<reqwest::Response, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    // Reverse-proxies in front of Navidrome (Caddy/nginx + Cloudflare etc.)
    // sometimes drop a TLS handshake mid-stream when their keep-alive pool
    // churns. One 500 ms retry isn't always enough — exponential backoff
    // across 4 attempts gives the upstream pool time to settle without
    // making the user-visible wait worse for the common single-failure case.
    const BACKOFFS_MS: [u64; 3] = [300, 800, 1800];
    let mut last: Option<reqwest::Error> = None;
    for attempt in 0..=BACKOFFS_MS.len() {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(BACKOFFS_MS[attempt - 1])).await;
        }
        match build_and_send().await {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                if !e.is_connect() && !e.is_timeout() {
                    return Err(nd_err(e));
                }
                last = Some(e);
            }
        }
    }
    Err(nd_err(last.expect("loop ran at least once")))
}

/// Build a reqwest client for Navidrome's native REST endpoints. Plain
/// `reqwest::Client::new()` defaults to HTTP/2 over ALPN with no User-Agent,
/// which some reverse-proxies (strict nginx rules, Cloudflare Tunnel, CDN
/// WAFs) abort mid-TLS-handshake. Pinning HTTP/1.1 and advertising a real
/// User-Agent makes the handshake match what browsers do for the Subsonic
/// endpoints, so `/auth/*` + `/api/*` go through the same path as `/rest/*`.
///
/// `pool_max_idle_per_host(0)` disables connection pooling. Keeping stale
/// keep-alive connections in the pool caused intermittent "tls handshake
/// eof" errors on the second call to an admin endpoint when a server or
/// proxy had already closed the TCP connection between calls.
pub(crate) fn nd_http_client() -> reqwest::Client {
    // TLS 1.2 only: rustls + nginx with TLS-1.3 session resumption caches
    // produces intermittent ECONNRESET mid-handshake when the upstream
    // starts churning keep-alive connections. Pinning TLS 1.2 matches what
    // the WebKit-side Subsonic calls end up negotiating most of the time
    // on these setups.
    reqwest::Client::builder()
        .user_agent(format!("Psysonic/{} (Tauri)", env!("CARGO_PKG_VERSION")))
        .http1_only()
        .pool_max_idle_per_host(0)
        .max_tls_version(reqwest::tls::Version::TLS_1_2)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}
