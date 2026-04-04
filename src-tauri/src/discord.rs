/// Discord Rich Presence integration.
///
/// To enable this feature:
///   1. Go to https://discord.com/developers/applications and create an application.
///   2. Copy the Application ID and replace DISCORD_APP_ID below.
///   3. In the "Rich Presence → Art Assets" tab, upload a PNG named "psysonic"
///      (use the app icon from public/logo.png).
///
/// The commands silently no-op when Discord is not running or the App ID is wrong,
/// so the app always starts cleanly regardless of Discord availability.

use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::sync::Mutex;

const DISCORD_APP_ID: &str = "1489544859718258779";

pub struct DiscordState(pub Mutex<Option<DiscordIpcClient>>);

impl DiscordState {
    pub fn new() -> Self {
        DiscordState(Mutex::new(None))
    }
}

/// Try to create and connect a fresh IPC client. Returns None silently on failure.
fn try_connect() -> Option<DiscordIpcClient> {
    let mut client = DiscordIpcClient::new(DISCORD_APP_ID).ok()?;
    client.connect().ok()?;
    Some(client)
}

/// Update the Discord Rich Presence activity.
///
/// - `elapsed_secs`: seconds already played. `None` when paused — Discord shows
///   the song/artist without a running timer.
#[tauri::command]
pub fn discord_update_presence(
    state: tauri::State<DiscordState>,
    title: String,
    artist: String,
    album: Option<String>,
    elapsed_secs: Option<f64>,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();

    // (Re)connect lazily — handles the case where Discord starts after the app.
    if guard.is_none() {
        match try_connect() {
            Some(client) => *guard = Some(client),
            None => return Ok(()), // Discord not running — silently skip
        }
    }

    let client = guard.as_mut().unwrap();

    // Discord RPC only exposes two visible text rows (details + state).
    // The application name "Psysonic" is shown automatically by Discord as the
    // header line. Album goes into large_text — visible as a hover tooltip on
    // the cover art icon.
    let large_text = album.as_deref().unwrap_or("Psysonic");

    let assets = Assets::new()
        .large_image("psysonic")
        .large_text(large_text);

    let mut activity = Activity::new()
        .activity_type(ActivityType::Listening)
        .details(&title)
        .state(&artist)
        .assets(assets);

    // Start timestamp: Discord auto-counts up from this point. We back-calculate
    // it so the displayed elapsed time matches the actual playback position.
    if let Some(elapsed) = elapsed_secs {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let start = now - elapsed.floor() as i64;
        activity = activity.timestamps(Timestamps::new().start(start));
    }

    if client.set_activity(activity).is_err() {
        // IPC pipe broke (Discord restarted etc.) — drop the client so the next
        // call re-connects.
        *guard = None;
    }

    Ok(())
}

/// Clear the Discord Rich Presence activity (e.g. playback stopped).
#[tauri::command]
pub fn discord_clear_presence(state: tauri::State<DiscordState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(client) = guard.as_mut() {
        if client.clear_activity().is_err() {
            *guard = None;
        }
    }
    Ok(())
}
