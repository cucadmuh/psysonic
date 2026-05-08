// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod analysis_cache;
mod analysis_runtime;
pub mod cli;
mod discord;
pub(crate) mod logging;
mod lib_commands;
#[cfg(target_os = "windows")]
mod taskbar_win;
mod tray_runtime;

pub(crate) use analysis_runtime::*;
pub(crate) use tray_runtime::*;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use lib_commands::*;
// MouseButtonState is only matched on non-Windows targets — on Windows the
// tray uses DoubleClick which doesn't carry a button_state.
#[cfg(not(target_os = "windows"))]
use tauri::tray::MouseButtonState;

/// Tracks which user-configured shortcuts are currently registered (shortcut_str → action).
/// Prevents on_shortcut() accumulating duplicate handlers across JS reloads (HMR / StrictMode).
type ShortcutMap = Mutex<HashMap<String, String>>;

/// Maximum number of offline track downloads that can run concurrently.
/// The frontend queues more tasks than this; Rust is the real throttle.
const MAX_DL_CONCURRENCY: usize = 4;

fn default_subsonic_wire_user_agent() -> String {
    format!("psysonic/{}", env!("CARGO_PKG_VERSION"))
}

fn runtime_subsonic_wire_user_agent() -> &'static RwLock<String> {
    static UA: OnceLock<RwLock<String>> = OnceLock::new();
    UA.get_or_init(|| RwLock::new(default_subsonic_wire_user_agent()))
}

/// Unified outbound User-Agent for all Rust-side HTTP requests.
/// It is initialized with `psysonic/<version>` and then overridden from
/// the main WebView `navigator.userAgent` at app startup.
pub(crate) fn subsonic_wire_user_agent() -> String {
    runtime_subsonic_wire_user_agent()
        .read()
        .map(|ua| ua.clone())
        .unwrap_or_else(|_| default_subsonic_wire_user_agent())
}

/// Shared semaphore that caps simultaneous `download_track_offline` executions.
type DownloadSemaphore = Arc<tokio::sync::Semaphore>;

/// Per-job cancellation flags for `sync_batch_to_device`.
/// Each running sync registers an `Arc<AtomicBool>` here; `cancel_device_sync` flips it.
fn sync_cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Shared handle to OS media controls (MPRIS2 on Linux, Now Playing on macOS, SMTC on Windows).
/// `None` if souvlaki failed to initialize (e.g. no D-Bus session on Linux).
type MprisControls = Mutex<Option<souvlaki::MediaControls>>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WaveformCachePayload {
    bins: Vec<u8>,
    bin_count: i64,
    is_partial: bool,
    known_until_sec: f64,
    duration_sec: f64,
    updated_at: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoudnessCachePayload {
    integrated_lufs: f64,
    true_peak: f64,
    recommended_gain_db: f64,
    target_lufs: f64,
    updated_at: i64,
}

pub fn run() {
    // Linux: second `psysonic --player …` forwards over D-Bus before heavy startup.
    #[cfg(target_os = "linux")]
    {
        let argv: Vec<String> = std::env::args().collect();
        if crate::cli::parse_cli_command(&argv).is_some() {
            match crate::cli::linux_try_forward_player_cli_secondary(&argv) {
                Ok(crate::cli::LinuxPlayerForwardResult::Forwarded) => std::process::exit(0),
                Ok(crate::cli::LinuxPlayerForwardResult::ContinueStartup) => {}
                Err(msg) => {
                    crate::app_eprintln!("NOT OK: {msg}");
                    std::process::exit(1);
                }
            }
        }
    }

    let (audio_engine, _audio_thread) = audio::create_engine();

    tauri::Builder::default()
        .manage(audio_engine)
        .manage(ShortcutMap::default())
        .manage(discord::DiscordState::new())
        .manage(Arc::new(tokio::sync::Semaphore::new(MAX_DL_CONCURRENCY)) as DownloadSemaphore)
        .manage(TrayState::default())
        .manage(TrayTooltip::default())
        .manage(TrayPlaybackState::default())
        .manage(TrayMenuItemsState::default())
        .manage(TrayMenuLabelsState::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["mini"])
                .build()
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if !crate::cli::handle_cli_on_primary_instance(app, &argv) {
                let window = app.get_webview_window("main").expect("no main window");
                // The window may have been hidden via the close-to-tray path,
                // which injects PAUSE_RENDERING_JS (sets `__psyHidden=true`,
                // pauses CSS animations). Tray-icon restore mirrors this with
                // RESUME_RENDERING_JS — second-launch restore must do the same,
                // otherwise the webview comes back with rendering still paused
                // and navigation looks blank (issue #497).
                let _ = window.eval(RESUME_RENDERING_JS);
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))

        .setup(|app| {
            // ── Analysis cache (SQLite) ───────────────────────────────────
            {
                let cache = analysis_cache::AnalysisCache::init(&app.handle())
                    .map_err(|e| format!("analysis cache init failed: {e}"))?;
                app.manage(cache);
            }

            // Periodic analysis queue sizes (debug logging mode only).
            tauri::async_runtime::spawn(analysis_queue_snapshot_loop());

            // ── Custom title bar on Linux ─────────────────────────────────
            // Remove OS window decorations on all Linux so the React TitleBar
            // can take over.  The frontend checks is_tiling_wm() to decide
            // whether to actually render the TitleBar (hidden on tiling WMs).
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_decorations(false);
                }
            }

            // ── System tray ───────────────────────────────────────────────
            // Always build on startup when possible; the frontend calls toggle_tray_icon(false)
            // immediately after load if the user has disabled the tray icon.
            // May be skipped if Ayatana/AppIndicator libraries are missing (no panic).
            {
                if let Some(tray) = try_build_tray_icon(app.handle()) {
                    *app.state::<TrayState>().lock().unwrap() = Some(tray);
                }
            }

            // ── MPRIS2 / OS media controls via souvlaki ──────────────────
            {
                use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};

                // Collect pre-conditions and the platform-specific HWND.
                // Returns None early (with a log) on any unrecoverable condition
                // so app.manage() always executes exactly once at the bottom.
                let maybe_controls: Option<MediaControls> = (|| {
                    // Linux: requires a live D-Bus session.
                    #[cfg(target_os = "linux")]
                    {
                        let dbus_ok = std::env::var("DBUS_SESSION_BUS_ADDRESS")
                            .map(|v| !v.is_empty())
                            .unwrap_or(false);
                        if !dbus_ok {
                            crate::app_eprintln!("[Psysonic] No D-Bus session — MPRIS media controls disabled");
                            return None;
                        }
                    }

                    // Windows: souvlaki SMTC must hook into the existing Win32
                    // message loop rather than spinning up its own. Pass the
                    // main window's HWND so it can do so. If we can't get one,
                    // skip init (no crash, just no media overlay).
                    #[cfg(target_os = "windows")]
                    let hwnd = {
                        use tauri::Manager;
                        let h = app.get_webview_window("main")
                            .and_then(|w| w.hwnd().ok())
                            .map(|h| h.0 as *mut std::ffi::c_void);
                        if h.is_none() {
                            crate::app_eprintln!("[Psysonic] Could not get HWND — Windows media controls disabled");
                            return None;
                        }
                        h
                    };
                    #[cfg(not(target_os = "windows"))]
                    let hwnd: Option<*mut std::ffi::c_void> = None;

                    let config = PlatformConfig {
                        dbus_name: "psysonic",
                        display_name: "Psysonic",
                        hwnd,
                    };

                    match MediaControls::new(config) {
                        Ok(mut controls) => {
                            let app_handle = app.handle().clone();
                            if let Err(e) = controls.attach(move |event: MediaControlEvent| {
                                match event {
                                    MediaControlEvent::Toggle
                                    | MediaControlEvent::Play
                                    | MediaControlEvent::Pause => {
                                        let _ = app_handle.emit("media:play-pause", ());
                                    }
                                    MediaControlEvent::Next => {
                                        let _ = app_handle.emit("media:next", ());
                                    }
                                    MediaControlEvent::Previous => {
                                        let _ = app_handle.emit("media:prev", ());
                                    }
                                    MediaControlEvent::Seek(direction) => {
                                        use souvlaki::SeekDirection;
                                        let delta: f64 = match direction {
                                            SeekDirection::Forward  =>  5.0,
                                            SeekDirection::Backward => -5.0,
                                        };
                                        let _ = app_handle.emit("media:seek-relative", delta);
                                    }
                                    MediaControlEvent::SetPosition(pos) => {
                                        let secs = pos.0.as_secs_f64();
                                        let _ = app_handle.emit("media:seek-absolute", secs);
                                    }
                                    _ => {}
                                }
                            }) {
                                crate::app_eprintln!("[Psysonic] Failed to attach media controls: {e:?}");
                            }
                            Some(controls)
                        }
                        Err(e) => {
                            crate::app_eprintln!("[Psysonic] Could not create media controls: {e:?}");
                            None
                        }
                    }
                })();

                app.manage(MprisControls::new(maybe_controls));
            }

            // ── Windows Taskbar Thumbnail Toolbar ────────────────────────
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    if let Ok(hwnd) = w.hwnd() {
                        taskbar_win::init(app.handle(), hwnd.0 as isize);
                    }
                }
            }

            // ── Audio device-change watcher ───────────────────────────────
            {
                use tauri::Manager;
                let engine = app.state::<audio::AudioEngine>();
                audio::start_device_watcher(&engine, app.handle().clone());
            }

            // ── Reopen output after system sleep/resume (WASAPI / PipeWire etc.)
            audio::register_post_sleep_audio_recovery(app.handle().clone());

            // ── Pre-create mini player window (Windows) ──────────────────
            // Creating the second WebView2 webview lazily from an invoke
            // handler on Windows reliably stalls the Tauri event loop —
            // the mini shows a blank white window, neither main nor mini
            // can be closed, and the user has to kill the process via
            // Task Manager. Building it at startup (hidden) avoids the
            // runtime-creation code path entirely; later `open_mini_player`
            // calls are pure show/hide.
            #[cfg(target_os = "windows")]
            {
                if let Err(e) = build_mini_player_window(app.handle(), false) {
                    crate::app_eprintln!("[psysonic] Failed to pre-create mini window: {e}");
                }
            }

            // Cold start with `--player …`: defer emit so the webview can register listeners.
            crate::cli::spawn_deferred_cli_argv_handler(app.handle());

            Ok(())
        })
        .on_window_event(|window, event| {
            // Persist mini player position whenever the user drags it.
            if window.label() == "mini" {
                if let tauri::WindowEvent::Moved(pos) = event {
                    persist_mini_pos_throttled(window.app_handle(), pos.x, pos.y);
                }
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();

                    #[cfg(target_os = "macos")]
                    {
                        // On macOS the red close button quits the app entirely.
                        // Route through JS so playback position + Orbit state get
                        // flushed; exit_app on the way back stops the audio engine.
                        let _ = window.emit("app:force-quit", ());
                    }

                    #[cfg(not(target_os = "macos"))]
                    {
                        // Pause rendering before JS decides whether to hide to tray or exit.
                        if let Some(w) = window.app_handle().get_webview_window("main") {
                            let _ = w.eval(PAUSE_RENDERING_JS);
                        }
                        // Let JS decide: minimize to tray or exit, based on user setting.
                        let _ = window.emit("window:close-requested", ());
                    }
                } else if window.label() == "mini" {
                    // Native close on the mini: hide instead of destroying so
                    // state is preserved, and restore the main window.
                    api.prevent_close();
                    if let Some(w) = window.app_handle().get_webview_window("mini") {
                        let _ = w.eval(PAUSE_RENDERING_JS);
                    }
                    let _ = window.hide();
                    if let Some(main) = window.app_handle().get_webview_window("main") {
                        let _ = main.unminimize();
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            calculate_sync_payload,
            exit_app,
            cli_publish_player_snapshot,
            cli_publish_library_list,
            cli_publish_server_list,
            cli_publish_search_results,
            set_window_decorations,
            set_linux_webkit_smooth_scrolling,
            set_logging_mode,
            export_runtime_logs,
            frontend_debug_log,
            performance_cpu_snapshot,
            set_subsonic_wire_user_agent,
            no_compositing_mode,
            is_tiling_wm_cmd,
            open_mini_player,
            preload_mini_player,
            close_mini_player,
            set_mini_player_always_on_top,
            resize_mini_player,
            show_main_window,
            pause_rendering,
            resume_rendering,
            register_global_shortcut,
            unregister_global_shortcut,
            mpris_set_metadata,
            mpris_set_playback,
            audio::commands::audio_play,
            audio::commands::audio_pause,
            audio::commands::audio_resume,
            audio::commands::audio_stop,
            audio::commands::audio_seek,
            audio::mix_commands::audio_set_volume,
            audio::mix_commands::audio_update_replay_gain,
            audio::mix_commands::audio_set_eq,
            audio::autoeq_commands::autoeq_entries,
            audio::autoeq_commands::autoeq_fetch_profile,
            audio::commands::audio_preload,
            audio::commands::audio_play_radio,
            audio::preview::audio_preview_play,
            audio::preview::audio_preview_stop,
            audio::preview::audio_preview_stop_silent,
            audio::preview::audio_preview_set_volume,
            audio::mix_commands::audio_set_crossfade,
            audio::mix_commands::audio_set_gapless,
            audio::mix_commands::audio_set_normalization,
            audio::device_commands::audio_list_devices,
            audio::device_commands::audio_canonicalize_selected_device,
            audio::device_commands::audio_default_output_device_name,
            audio::device_commands::audio_set_device,
            audio::commands::audio_chain_preload,
            discord::discord_update_presence,
            discord::discord_clear_presence,
            lastfm_request,
            upload_playlist_cover,
            upload_radio_cover,
            upload_artist_image,
            delete_radio_cover,
            navidrome_login,
            nd_list_users,
            nd_create_user,
            nd_update_user,
            nd_delete_user,
            nd_list_libraries,
            nd_list_songs,
            nd_list_artists_by_role,
            nd_list_albums_by_artist_role,
            nd_set_user_libraries,
            nd_list_playlists,
            nd_create_playlist,
            nd_update_playlist,
            nd_get_playlist,
            nd_delete_playlist,
            nd_get_song_path,
            search_radio_browser,
            get_top_radio_stations,
            fetch_url_bytes,
            fetch_json_url,
            fetch_icy_metadata,
            resolve_stream_url,
            analysis_get_waveform,
            analysis_get_waveform_for_track,
            analysis_get_loudness_for_track,
            analysis_delete_loudness_for_track,
            analysis_delete_all_waveforms,
            analysis_enqueue_seed_from_url,
            analysis_prune_pending_to_track_ids,
            download_track_offline,
            delete_offline_track,
            get_offline_cache_size,
            download_track_hot_cache,
            promote_stream_cache_to_hot_cache,
            get_hot_cache_size,
            delete_hot_cache_track,
            purge_hot_cache,
            sync_track_to_device,
            sync_batch_to_device,
            cancel_device_sync,
            compute_sync_paths,
            list_device_dir_files,
            delete_device_file,
            delete_device_files,
            get_removable_drives,
            write_device_manifest,
            read_device_manifest,
            write_playlist_m3u8,
            rename_device_files,
            toggle_tray_icon,
            set_tray_tooltip,
            set_tray_menu_labels,
            check_dir_accessible,
            download_zip,
            check_arch_linux,
            download_update,
            open_folder,
            get_embedded_lyrics,
            fetch_netease_lyrics,
            fetch_bandsintown_events,
            #[cfg(target_os = "windows")]
            taskbar_win::update_taskbar_icon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Psysonic");
}
