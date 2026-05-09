//! AutoEQ proxy commands: fetch entry list and FixedBandEQ profiles from
//! GitHub via Rust to bypass WebView CORS.

use tauri::State;

use super::engine::{audio_http_client, AudioEngine};

/// Proxy: fetches https://autoeq.app/entries via Rust to bypass WebView CORS restrictions.
#[tauri::command]
pub async fn autoeq_entries(state: State<'_, AudioEngine>) -> Result<String, String> {
    audio_http_client(&state)
        .get("https://autoeq.app/entries")
        .send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())
}

/// Fetches the AutoEQ FixedBandEQ profile for a specific headphone from GitHub raw content.
///
/// Directory layout in the AutoEQ repo:
///   results/{source}/{form}/{name}/{name} FixedBandEQ.txt           (most sources)
///   results/{source}/{rig} {form}/{name}/{name} FixedBandEQ.txt     (crinacle — rig-prefixed dir)
///
/// We try the rig-prefixed path first (when rig is present), then fall back to form-only.
#[tauri::command]
pub async fn autoeq_fetch_profile(
    name: String,
    source: String,
    rig: Option<String>,
    form: String,
    state: State<'_, AudioEngine>,
) -> Result<String, String> {
    let base = "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results";
    let filename = format!("{} FixedBandEQ.txt", name);

    let candidates: Vec<String> = if let Some(ref r) = rig {
        vec![
            format!("{}/{}/{} {}/{}/{}", base, source, r, form, name, filename),
            format!("{}/{}/{}/{}/{}", base, source, form, name, filename),
        ]
    } else {
        vec![format!("{}/{}/{}/{}/{}", base, source, form, name, filename)]
    };

    for url in &candidates {
        let resp = audio_http_client(&state).get(url).send().await.map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            return resp.text().await.map_err(|e| e.to_string());
        }
    }

    Err(format!("FixedBandEQ profile not found for '{}'", name))
}
