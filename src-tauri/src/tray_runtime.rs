use std::sync::Mutex;

use tauri::tray::TrayIcon;

/// Holds the live system-tray icon handle. `None` means the tray is currently hidden/removed.
/// Dropping the inner `TrayIcon` fully removes it from the OS notification area on all platforms.
pub(crate) type TrayState = Mutex<Option<TrayIcon>>;

/// Cached tray tooltip text. Updated by `set_tray_tooltip` and re-applied when the
/// icon is rebuilt (e.g. after the user toggles the tray off and on again).
/// Empty string means "use the default `Psysonic` tooltip".
pub(crate) type TrayTooltip = Mutex<String>;

#[derive(Default)]
pub(crate) struct TrayPlaybackState(pub(crate) Mutex<String>);

pub(crate) fn tray_state_icon(state: &str) -> &'static str {
    match state {
        "play" => "▶",
        "pause" => "⏸",
        _ => "⏹",
    }
}

/// Handles to all updatable tray menu items, kept around so `set_tray_menu_labels`
/// (i18n refresh) and `set_tray_tooltip` (track change) can re-text them without
/// rebuilding the whole tray icon. The `now_playing` slot is `Some` on Linux
/// only — it surfaces the current track as a disabled menu entry because
/// AppIndicator has no hover tooltip API.
pub(crate) struct TrayMenuItems {
    pub(crate) play_pause: tauri::menu::MenuItem<tauri::Wry>,
    pub(crate) next: tauri::menu::MenuItem<tauri::Wry>,
    pub(crate) previous: tauri::menu::MenuItem<tauri::Wry>,
    pub(crate) show_hide: tauri::menu::MenuItem<tauri::Wry>,
    pub(crate) quit: tauri::menu::MenuItem<tauri::Wry>,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub(crate) now_playing: Option<tauri::menu::MenuItem<tauri::Wry>>,
}

pub(crate) type TrayMenuItemsState = Mutex<Option<TrayMenuItems>>;

/// Cached translations for the tray menu. Defaults to English so the menu has
/// readable labels before the frontend has had a chance to run `set_tray_menu_labels`.
#[derive(Clone)]
pub(crate) struct TrayMenuLabels {
    pub(crate) play_pause: String,
    pub(crate) next: String,
    pub(crate) previous: String,
    pub(crate) show_hide: String,
    pub(crate) quit: String,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub(crate) nothing_playing: String,
}

impl Default for TrayMenuLabels {
    fn default() -> Self {
        Self {
            play_pause: "Play / Pause".into(),
            next: "Next Track".into(),
            previous: "Previous Track".into(),
            show_hide: "Show / Hide".into(),
            quit: "Exit Psysonic".into(),
            nothing_playing: "Nothing playing".into(),
        }
    }
}

pub(crate) type TrayMenuLabelsState = Mutex<TrayMenuLabels>;
