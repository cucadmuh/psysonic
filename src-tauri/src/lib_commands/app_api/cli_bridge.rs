//! Tauri commands the frontend invokes to push player state and list payloads
//! to the JSON response files that `psysonic --info` / `--player library list`
//! / `--player server list` / `--player search …` then read.

/// Writes `psysonic-cli-snapshot.json` for `psysonic --info` (debounced from the frontend).
#[tauri::command]
pub(crate) fn cli_publish_player_snapshot(snapshot: serde_json::Value) -> Result<(), String> {
    crate::cli::write_cli_snapshot(&snapshot)
}

/// Writes `psysonic-cli-library.json` for `psysonic --player library list`.
#[tauri::command]
pub(crate) fn cli_publish_library_list(payload: serde_json::Value) -> Result<(), String> {
    crate::cli::write_library_cli_response(&payload)
}

/// Writes `psysonic-cli-servers.json` for `psysonic --player server list`.
#[tauri::command]
pub(crate) fn cli_publish_server_list(payload: serde_json::Value) -> Result<(), String> {
    crate::cli::write_server_list_cli_response(&payload)
}

/// Writes `psysonic-cli-search.json` for `psysonic --player search …`.
#[tauri::command]
pub(crate) fn cli_publish_search_results(payload: serde_json::Value) -> Result<(), String> {
    crate::cli::write_search_cli_response(&payload)
}
