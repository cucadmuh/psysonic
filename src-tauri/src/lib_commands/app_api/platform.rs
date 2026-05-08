//! Native-window + WebKitGTK platform tweaks exposed as Tauri commands.

use super::*;

/// Toggle native window decorations at runtime (Linux custom title bar opt-out).
#[tauri::command]
pub(crate) fn set_window_decorations(enabled: bool, app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window("main") {
        let _ = win.set_decorations(enabled);
        // Re-enabling native decorations on GTK causes the window manager to
        // re-stack the window, which drops focus. Bring it back immediately.
        if enabled {
            let _ = win.set_focus();
        }
    }
}

/// WebKitGTK: `enable-smooth-scrolling` also drives deferred / kinetic wheel scrolling.
#[cfg(target_os = "linux")]
pub(crate) fn linux_webkit_apply_smooth_scrolling(win: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    win.with_webview(move |platform| {
        use webkit2gtk::{SettingsExt, WebViewExt};
        if let Some(settings) = platform.inner().settings() {
            settings.set_enable_smooth_scrolling(enabled);
        }
    })
    .map_err(|e| e.to_string())
}

/// Called from the frontend settings toggle (Linux); no-op on other platforms.
#[tauri::command]
pub(crate) fn set_linux_webkit_smooth_scrolling(enabled: bool, app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        // Each WebviewWindow has its own WebKitGTK Settings — main-only left the
        // mini player on the default (inertial) wheel until the user toggled again.
        for label in ["main", "mini"] {
            if let Some(win) = app_handle.get_webview_window(label) {
                linux_webkit_apply_smooth_scrolling(&win, enabled)?;
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (enabled, app_handle);
    }
    Ok(())
}
