mod device;
mod batch;
mod tray;

// Tauri commands re-exported for the lib.rs invoke_handler:
pub(crate) use device::{
    get_removable_drives, read_device_manifest, rename_device_files, sync_track_to_device,
    write_device_manifest, write_playlist_m3u8, compute_sync_paths,
};
pub(crate) use batch::{
    calculate_sync_payload, cancel_device_sync, delete_device_file, delete_device_files,
    list_device_dir_files, sync_batch_to_device,
};
pub(crate) use tray::{
    is_tiling_wm_cmd, no_compositing_mode, set_tray_menu_labels, set_tray_tooltip,
    toggle_tray_icon,
};
// Internal helpers consumed elsewhere in the crate:
pub(crate) use tray::{is_tiling_wm, stop_audio_engine, try_build_tray_icon};
