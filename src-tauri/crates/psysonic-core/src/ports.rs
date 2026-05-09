//! Cross-crate port traits.
//!
//! These traits exist purely to break dependency cycles that would otherwise
//! force `psysonic-audio` ↔ `psysonic-analysis` to depend on each other in
//! both directions. Implementers register themselves as Tauri State on app
//! bootstrap; consumers look them up via `app.try_state::<Arc<dyn _>>()`.
//!
//! Layout:
//! - `AnalysisOrchestrator`  — implemented in `psysonic-analysis`, called from
//!   `psysonic-audio` to enqueue full-buffer loudness/waveform analysis.
//! - `PlaybackQuery`         — implemented in `psysonic-audio` on `AudioEngine`,
//!   called from `psysonic-analysis` to ask "is this track currently playing?".

use std::future::Future;
use std::pin::Pin;

use tauri::AppHandle;

/// Read-only queries about the live playback session. Implemented on
/// `AudioEngine` in `psysonic-audio`.
///
/// Registered as `Arc<dyn PlaybackQuery>` in Tauri State so non-audio crates
/// can query without taking a hard dep on the audio crate.
pub trait PlaybackQuery: Send + Sync + 'static {
    /// `true` if `track_id` is the track currently being decoded/played.
    fn is_track_currently_playing(&self, track_id: &str) -> bool;
}

/// Triggers full-buffer analysis on already-captured track bytes. Implemented
/// on `AnalysisRuntime` in `psysonic-analysis`.
///
/// Registered as `Arc<dyn AnalysisOrchestrator>` in Tauri State so audio
/// callsites (`stream::ranged_http`, `stream::track_stream`, `helpers`,
/// `play_input`, `preload_commands`) can submit without depending on
/// `psysonic-analysis`.
pub trait AnalysisOrchestrator: Send + Sync + 'static {
    /// Enqueue a CPU-seed analysis pass for `track_id` over the given byte
    /// buffer. `high_priority` mirrors the HTTP-backfill head-insertion
    /// behaviour for the currently playing track.
    ///
    /// Errors are stringified — audio callers only care about pass/fail.
    fn submit_cpu_seed<'a>(
        &'a self,
        app: AppHandle,
        track_id: String,
        bytes: Vec<u8>,
        high_priority: bool,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}
