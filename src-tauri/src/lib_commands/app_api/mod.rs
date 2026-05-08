mod cli_bridge;
mod core;
mod navidrome;
mod perf;
mod platform;
mod remote;
mod integration;
mod analysis;

// Tauri commands re-exported for the lib.rs invoke_handler.
pub(crate) use cli_bridge::{
    cli_publish_library_list, cli_publish_player_snapshot, cli_publish_search_results,
    cli_publish_server_list,
};
pub(crate) use core::{
    exit_app, export_runtime_logs, frontend_debug_log, greet, set_logging_mode,
    set_subsonic_wire_user_agent,
};
pub(crate) use navidrome::{
    delete_radio_cover, navidrome_login, nd_create_playlist, nd_create_user, nd_delete_playlist,
    nd_delete_user, nd_get_playlist, nd_get_song_path, nd_list_albums_by_artist_role,
    nd_list_artists_by_role, nd_list_libraries, nd_list_playlists, nd_list_songs, nd_list_users,
    nd_set_user_libraries, nd_update_playlist, nd_update_user, upload_artist_image,
    upload_playlist_cover, upload_radio_cover,
};
pub(crate) use perf::performance_cpu_snapshot;
pub(crate) use platform::{set_linux_webkit_smooth_scrolling, set_window_decorations};
pub(crate) use remote::{
    fetch_icy_metadata, fetch_json_url, fetch_url_bytes, get_top_radio_stations, lastfm_request,
    resolve_stream_url, search_radio_browser,
};
pub(crate) use integration::{
    check_dir_accessible, mpris_set_metadata, mpris_set_playback, register_global_shortcut,
    unregister_global_shortcut,
};
pub(crate) use analysis::{
    analysis_delete_all_waveforms, analysis_delete_loudness_for_track,
    analysis_enqueue_seed_from_url, analysis_get_loudness_for_track, analysis_get_waveform,
    analysis_get_waveform_for_track, analysis_prune_pending_to_track_ids,
};
