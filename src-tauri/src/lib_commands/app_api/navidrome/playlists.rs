//! Playlist CRUD via Navidrome's native REST API. The smart-playlist rules
//! payload is forwarded as-is so the frontend can compose any rule the
//! Navidrome version supports without backend changes.

use super::client::{nd_err, nd_http_client, nd_retry};

/// GET `/api/playlist` — list playlists; pass `smart=true` to filter smart playlists.
#[tauri::command]
pub(crate) async fn nd_list_playlists(
    server_url: String,
    token: String,
    smart: Option<bool>,
) -> Result<serde_json::Value, String> {
    let resp = nd_retry(|| {
        let client = nd_http_client();
        let mut req = client
            .get(format!("{}/api/playlist", server_url))
            .header("X-ND-Authorization", format!("Bearer {}", token));
        if let Some(s) = smart {
            req = req.query(&[("smart", s)]);
        }
        req.send()
    })
    .await?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<serde_json::Value>().await.map_err(nd_err)
}

/// POST `/api/playlist` — create playlist (supports smart rules payload).
#[tauri::command]
pub(crate) async fn nd_create_playlist(
    server_url: String,
    token: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let resp = nd_retry(|| {
        nd_http_client()
            .post(format!("{}/api/playlist", server_url))
            .header("X-ND-Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
    })
    .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// PUT `/api/playlist/{id}` — update playlist (supports smart rules payload).
#[tauri::command]
pub(crate) async fn nd_update_playlist(
    server_url: String,
    token: String,
    id: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let resp = nd_retry(|| {
        nd_http_client()
            .put(format!("{}/api/playlist/{}", server_url, id))
            .header("X-ND-Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
    })
    .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// GET `/api/playlist/{id}` — get a single playlist (includes smart rules if available).
#[tauri::command]
pub(crate) async fn nd_get_playlist(
    server_url: String,
    token: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let resp = nd_retry(|| {
        nd_http_client()
            .get(format!("{}/api/playlist/{}", server_url, id))
            .header("X-ND-Authorization", format!("Bearer {}", token))
            .send()
    })
    .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// DELETE `/api/playlist/{id}` — delete playlist.
#[tauri::command]
pub(crate) async fn nd_delete_playlist(
    server_url: String,
    token: String,
    id: String,
) -> Result<(), String> {
    let resp = nd_retry(|| {
        nd_http_client()
            .delete(format!("{}/api/playlist/{}", server_url, id))
            .header("X-ND-Authorization", format!("Bearer {}", token))
            .send()
    })
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }
    Ok(())
}
