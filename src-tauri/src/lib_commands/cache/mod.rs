mod fs_utils;
mod offline;
mod downloads;
mod hot;

// Tauri commands re-exported for the lib.rs invoke_handler:
pub(crate) use offline::{
    delete_offline_track, download_track_offline, get_offline_cache_size,
};
pub(crate) use hot::{
    delete_hot_cache_track, download_track_hot_cache, get_hot_cache_size,
    promote_stream_cache_to_hot_cache, purge_hot_cache,
};
pub(crate) use downloads::{
    check_arch_linux, download_update, download_zip, fetch_netease_lyrics, get_embedded_lyrics,
    open_folder,
};
// Internal helper consumed by analysis_runtime (used as analysis_runtime depends on it):
pub(crate) use offline::enqueue_analysis_seed;
