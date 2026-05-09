//! HTTP-backed and file-backed `MediaSource` implementations plus their
//! background download tasks.
//!
//! Submodule layout:
//! - `icy`          — Shoutcast/Icecast inline-metadata state machine
//! - `reader`       — `AudioStreamReader` (ringbuf → `std::io::Read` shim)
//! - `local_file`   — `LocalFileSource` (file-backed, seekable)
//! - `ranged_http`  — `RangedHttpSource` (seekable HTTP) + `ranged_download_task`
//! - `radio`        — radio session state + `radio_download_task`
//! - `track_stream` — `track_download_task` (one-shot non-ranged HTTP)

mod icy;
mod local_file;
mod radio;
mod ranged_http;
mod reader;
mod track_stream;

pub(crate) use local_file::LocalFileSource;
pub(crate) use radio::{RadioLiveState, RadioSharedFlags, radio_download_task};
pub(crate) use ranged_http::{RangedHttpSource, ranged_download_task};
pub(crate) use reader::AudioStreamReader;
pub(crate) use track_stream::track_download_task;

// ── Shared tuning constants ──────────────────────────────────────────────────

/// 256 KB on the heap — ≈16 s at 128 kbps, ≈6 s at 320 kbps.
/// Small enough that stale audio drains within a few seconds on reconnect;
/// large enough to absorb brief network hiccups without stuttering.
pub(crate) const RADIO_BUF_CAPACITY: usize = 256 * 1024;
/// Minimum ring buffer for on-demand track streaming starts.
pub(crate) const TRACK_STREAM_MIN_BUF_CAPACITY: usize = 1024 * 1024;
/// Cap ring buffer growth when content-length is known.
pub(crate) const TRACK_STREAM_MAX_BUF_CAPACITY: usize = 32 * 1024 * 1024;
/// Max bytes kept in memory to promote a completed streamed track for fast replay/seek recovery.
pub(crate) const TRACK_STREAM_PROMOTE_MAX_BYTES: usize = 64 * 1024 * 1024;
/// Hot/offline `psysonic-local://` files are read from disk for waveform/LUFS seeding — not the
/// same heap pressure as retaining a full HTTP capture. FLAC/DSD tracks often exceed 64 MiB;
/// using the stream-promote cap here skipped analysis entirely (empty seekbar).
pub(crate) const LOCAL_FILE_PLAYBACK_SEED_MAX_BYTES: usize = 512 * 1024 * 1024;
/// Consecutive body-stream failures tolerated for track streaming before abort.
pub(crate) const TRACK_STREAM_MAX_RECONNECTS: u32 = 3;
/// Seconds at stall threshold while paused before hard-disconnect.
pub(crate) const RADIO_HARD_PAUSE_SECS: u64 = 5;
/// AudioStreamReader timeout: if no audio bytes arrive for this long → EOF.
pub(crate) const RADIO_READ_TIMEOUT_SECS: u64 = 15;
/// Sleep interval when ring buffer is empty (prevents CPU spin).
pub(crate) const RADIO_YIELD_MS: u64 = 2;
