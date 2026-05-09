//! Cross-crate port handles.
//!
//! Exists to break the one back-edge in the audio↔analysis dependency:
//! `psysonic-analysis` needs to ask "is this track currently playing?", but
//! must not depend on `psysonic-audio` (which has the real dep on analysis,
//! not the other way around).
//!
//! Implementation note: ports are exposed as **closure handles** rather than
//! `Arc<dyn Trait>` — this avoids forcing every existing `State<AudioEngine>`
//! callsite to switch to `State<Arc<AudioEngine>>` (which Tauri State requires
//! for trait-object registration). The shell crate creates the handle by
//! capturing an `AppHandle` and looking up the audio engine at call time.

use std::sync::Arc;

/// "Is this track currently being decoded/played?" — implementation lives in
/// `psysonic-audio` (`AudioEngine::analysis_track_id_is_current_playback`).
/// The shell crate registers an instance constructed via [`PlaybackQueryHandle::new`]
/// as Tauri State; consumers in `psysonic-analysis` look it up.
#[derive(Clone)]
pub struct PlaybackQueryHandle {
    inner: Arc<dyn Fn(&str) -> bool + Send + Sync + 'static>,
}

impl PlaybackQueryHandle {
    pub fn new<F>(f: F) -> Self
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
        Self { inner: Arc::new(f) }
    }

    pub fn is_track_currently_playing(&self, track_id: &str) -> bool {
        (self.inner)(track_id)
    }
}
