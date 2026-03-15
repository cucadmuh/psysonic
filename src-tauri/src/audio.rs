use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use rodio::{Decoder, Sink, Source};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

// ─── Debug logger ─────────────────────────────────────────────────────────────

// ─── Engine state (registered as Tauri managed state) ────────────────────────

pub struct AudioEngine {
    pub stream_handle: Arc<rodio::OutputStreamHandle>,
    pub current: Arc<Mutex<AudioCurrent>>,
    /// Monotonically incremented on each audio_play / audio_stop call.
    /// The background progress task captures its own `gen` at creation and
    /// bails out if this counter has moved on, preventing stale events.
    pub generation: Arc<AtomicU64>,
    pub http_client: reqwest::Client,
}

pub struct AudioCurrent {
    /// The active rodio Sink. `None` when stopped.
    pub sink: Option<Sink>,
    pub duration_secs: f64,
    /// Position (seconds) that we seeked/resumed from.
    pub seek_offset: f64,
    /// Instant when we started counting from seek_offset (None when paused/stopped).
    pub play_started: Option<Instant>,
    /// Set when paused; holds the position at pause time.
    pub paused_at: Option<f64>,
}

impl AudioCurrent {
    pub fn position(&self) -> f64 {
        if let Some(p) = self.paused_at {
            return p;
        }
        if let Some(t) = self.play_started {
            let elapsed = t.elapsed().as_secs_f64();
            (self.seek_offset + elapsed).min(self.duration_secs.max(0.001))
        } else {
            self.seek_offset
        }
    }
}

/// Initialise the audio engine. Spawns a dedicated thread that holds the
/// `OutputStream` alive for the lifetime of the process (parking prevents
/// the thread — and thus the stream — from being dropped).
pub fn create_engine() -> (AudioEngine, std::thread::JoinHandle<()>) {
    let (tx, rx) = std::sync::mpsc::sync_channel::<rodio::OutputStreamHandle>(0);

    let thread = std::thread::Builder::new()
        .name("psysonic-audio-stream".into())
        .spawn(move || match rodio::OutputStream::try_default() {
            Ok((_stream, handle)) => {
                tx.send(handle).ok();
                // Park forever — `_stream` must stay alive for audio to work.
                loop {
                    std::thread::park();
                }
            }
            Err(e) => {
                eprintln!("[psysonic] audio output error: {e}");
            }
        })
        .expect("spawn audio stream thread");

    let stream_handle = rx.recv().expect("audio stream handle");

    let engine = AudioEngine {
        stream_handle: Arc::new(stream_handle),
        current: Arc::new(Mutex::new(AudioCurrent {
            sink: None,
            duration_secs: 0.0,
            seek_offset: 0.0,
            play_started: None,
            paused_at: None,
        })),
        generation: Arc::new(AtomicU64::new(0)),
        http_client: reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default(),
    };

    (engine, thread)
}

// ─── Event payloads ───────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub current_time: f64,
    pub duration: f64,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Download and play the given URL. Replaces any currently playing track.
/// Emits `audio:playing` (with duration as f64) once playback starts,
/// then `audio:progress` every 500 ms, and `audio:ended` when done.
#[tauri::command]
pub async fn audio_play(
    url: String,
    volume: f32,
    duration_hint: f64,
    app: AppHandle,
    state: State<'_, AudioEngine>,
) -> Result<(), String> {
    // Claim this generation — any in-flight progress task with the old gen will exit.
    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;

    // Stop existing playback immediately.
    {
        let mut cur = state.current.lock().unwrap();
        if let Some(sink) = cur.sink.take() {
            sink.stop();
        }
        cur.seek_offset = 0.0;
        cur.play_started = None;
        cur.paused_at = None;
        cur.duration_secs = duration_hint;
    }

    // ── Download ──────────────────────────────────────────────────────────────
    let response = state
        .http_client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        if state.generation.load(Ordering::SeqCst) != gen {
            return Ok(());
        }
        let msg = format!("HTTP {status}");
        app.emit("audio:error", &msg).ok();
        return Err(msg);
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    // Bail if superseded while downloading.
    if state.generation.load(Ordering::SeqCst) != gen {
        return Ok(());
    }

    // ── Decode ────────────────────────────────────────────────────────────────
    let data: Vec<u8> = bytes.into();

    // Trust the Subsonic API duration_hint as the primary source.
    // Decoder::total_duration() is unreliable for VBR MP3 (symphonia may
    // return a single-frame or header duration that is far too short).
    let decoder_duration = {
        let cursor = Cursor::new(data.clone());
        Decoder::new(cursor)
            .ok()
            .and_then(|d| d.total_duration())
            .map(|d| d.as_secs_f64())
    };
    let duration_secs = if duration_hint > 1.0 {
        duration_hint
    } else {
        decoder_duration.unwrap_or(duration_hint)
    };

    let cursor = Cursor::new(data);
    let decoder = Decoder::new(cursor).map_err(|e| {
        app.emit("audio:error", e.to_string()).ok();
        e.to_string()
    })?;

    // Final generation check before committing.
    if state.generation.load(Ordering::SeqCst) != gen {
        return Ok(());
    }

    // ── Create sink and start playback ────────────────────────────────────────
    let sink = Sink::try_new(&*state.stream_handle).map_err(|e| e.to_string())?;
    sink.set_volume(volume.clamp(0.0, 1.0));
    sink.append(decoder);

    {
        let mut cur = state.current.lock().unwrap();
        cur.sink = Some(sink);
        cur.duration_secs = duration_secs;
        cur.seek_offset = 0.0;
        cur.play_started = Some(Instant::now());
        cur.paused_at = None;
    }

    app.emit("audio:playing", duration_secs).ok();

    // ── Progress + ended detection ────────────────────────────────────────────
    // We do NOT use `sink.empty()` because in rodio 0.19 the source moves from
    // the pending queue to the active state almost immediately after `append()`,
    // making `empty()` return `true` within milliseconds even for long tracks.
    //
    // Instead we use the wall-clock position (seek_offset + elapsed).
    // `AudioCurrent::position()` is clamped to `duration_secs`, so once it
    // reaches the end it stays there. We fire `audio:ended` after two
    // consecutive ticks where position >= duration - 1.0 s, which:
    //   • avoids false positives from seeking very close to the end
    //   • fires roughly 0.5–1 s before the last sample, giving the frontend
    //     enough time to queue the next download.
    let gen_counter = state.generation.clone();
    let current_arc = state.current.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let mut near_end_ticks: u32 = 0;

        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;

            if gen_counter.load(Ordering::SeqCst) != gen {
                break;
            }

            let (pos, dur, is_paused) = {
                let cur = current_arc.lock().unwrap();
                (cur.position(), cur.duration_secs, cur.paused_at.is_some())
            };

            app_clone
                .emit(
                    "audio:progress",
                    ProgressPayload { current_time: pos, duration: dur },
                )
                .ok();

            if is_paused {
                // Don't advance near-end counter while paused (stay put).
                continue;
            }


            if dur > 1.0 && pos >= dur - 1.0 {
                near_end_ticks += 1;
                if near_end_ticks >= 2 {
                    gen_counter.fetch_add(1, Ordering::SeqCst);
                    app_clone.emit("audio:ended", ()).ok();
                    break;
                }
            } else {
                near_end_ticks = 0;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn audio_pause(state: State<'_, AudioEngine>) {
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        if !sink.is_paused() {
            let pos = cur.position();
            sink.pause();
            cur.paused_at = Some(pos);
            cur.play_started = None;
        }
    }
}

#[tauri::command]
pub fn audio_resume(state: State<'_, AudioEngine>) {
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        if sink.is_paused() {
            let pos = cur.paused_at.unwrap_or(cur.seek_offset);
            sink.play();
            cur.seek_offset = pos;
            cur.play_started = Some(Instant::now());
            cur.paused_at = None;
        }
    }
}

#[tauri::command]
pub fn audio_stop(state: State<'_, AudioEngine>) {
    state.generation.fetch_add(1, Ordering::SeqCst);
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = cur.sink.take() {
        sink.stop();
    }
    cur.duration_secs = 0.0;
    cur.seek_offset = 0.0;
    cur.play_started = None;
    cur.paused_at = None;
}

#[tauri::command]
pub fn audio_seek(seconds: f64, state: State<'_, AudioEngine>) -> Result<(), String> {
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        sink.try_seek(Duration::from_secs_f64(seconds.max(0.0)))
            .map_err(|e: rodio::source::SeekError| e.to_string())?;
        if cur.paused_at.is_some() {
            cur.paused_at = Some(seconds);
        } else {
            cur.seek_offset = seconds;
            cur.play_started = Some(Instant::now());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn audio_set_volume(volume: f32, state: State<'_, AudioEngine>) {
    let cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        sink.set_volume(volume.clamp(0.0, 1.0));
    }
}
