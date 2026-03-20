// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[tauri::command]
fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

/// Proxy Last.fm API calls through Rust/reqwest to avoid WebView networking restrictions.
/// `params` is a list of [key, value] pairs (method must be included).
/// If `sign` is true an api_sig is computed. If `get` is true, a GET request is made.
#[tauri::command]
async fn lastfm_request(
    params: Vec<[String; 2]>,
    sign: bool,
    get: bool,
    api_key: String,
    api_secret: String,
) -> Result<serde_json::Value, String> {
    use std::collections::HashMap;

    let mut map: HashMap<String, String> = params.into_iter().map(|[k, v]| (k, v)).collect();
    map.insert("api_key".into(), api_key.clone());

    if sign {
        let mut keys: Vec<String> = map.keys().cloned().collect();
        keys.sort();
        let sig_str: String = keys.iter()
            .filter(|k| k.as_str() != "format" && k.as_str() != "callback")
            .map(|k| format!("{}{}", k, map[k]))
            .collect::<String>();
        let sig_input = format!("{}{}", sig_str, api_secret);
        let digest = md5::compute(sig_input.as_bytes());
        map.insert("api_sig".into(), format!("{:x}", digest));
    }

    map.insert("format".into(), "json".into());

    let client = reqwest::Client::new();
    let resp = if get {
        client
            .get("https://ws.audioscrobbler.com/2.0/")
            .query(&map)
            .header("User-Agent", "psysonic/1.6.0")
            .send()
            .await
    } else {
        client
            .post("https://ws.audioscrobbler.com/2.0/")
            .form(&map)
            .header("User-Agent", "psysonic/1.6.0")
            .send()
            .await
    }.map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(format!("Last.fm {} {}", err, json.get("message").and_then(|m| m.as_str()).unwrap_or("")));
    }

    Ok(json)
}


pub fn run() {
    let (audio_engine, _audio_thread) = audio::create_engine();

    tauri::Builder::default()
        .manage(audio_engine)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Build tray menu
            let play_pause = MenuItemBuilder::with_id("play_pause", "Play / Pause").build(app)?;
            let next = MenuItemBuilder::with_id("next", "Next Track").build(app)?;
            let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
            let show = MenuItemBuilder::with_id("show", "Show Psysonic").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Exit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&play_pause)
                .item(&next)
                .item(&separator)
                .item(&show)
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Psysonic")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "play_pause" => {
                        let _ = app.emit("tray:play-pause", ());
                    }
                    "next" => {
                        let _ = app.emit("tray:next", ());
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        std::process::exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // Left click shows app (handled in JS side via tray event)
                    }
                })
                .build(app)?;

            // Register media key global shortcuts
            #[cfg(not(target_os = "linux"))]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
                let shortcuts = ["MediaPlayPause", "MediaNextTrack", "MediaPreviousTrack"];
                for shortcut_str in &shortcuts {
                    if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
                        let shortcut_clone = shortcut_str.to_string();
                        let _ = app.global_shortcut().on_shortcut(shortcut, move |app, _shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                let event_name = match shortcut_clone.as_str() {
                                    "MediaPlayPause" => "media:play-pause",
                                    "MediaNextTrack" => "media:next",
                                    "MediaPreviousTrack" => "media:prev",
                                    _ => return,
                                };
                                let _ = app.emit(event_name, ());
                            }
                        });
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Only intercept close for the main window (hide to tray).
                // Browser popup windows (browser_*) close normally.
                if window.label() == "main" {
                    let _ = window.emit("window:close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            exit_app,
            audio::audio_play,
            audio::audio_pause,
            audio::audio_resume,
            audio::audio_stop,
            audio::audio_seek,
            audio::audio_set_volume,
            audio::audio_set_eq,
            audio::audio_preload,
            audio::audio_set_crossfade,
            lastfm_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Psysonic");
}
