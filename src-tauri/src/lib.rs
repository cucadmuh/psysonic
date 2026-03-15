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

pub fn run() {
    let (audio_engine, _audio_thread) = audio::create_engine();

    tauri::Builder::default()
        .manage(audio_engine)
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
                // Emit event so JS can decide: hide to tray or allow close.
                // JS handles prevent_close via onCloseRequested() in App.tsx.
                let _ = window.emit("window:close-requested", ());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Psysonic");
}
