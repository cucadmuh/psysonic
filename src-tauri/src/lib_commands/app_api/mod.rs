mod analysis;
mod cli_bridge;
mod core;
mod integration;
mod perf;
mod platform;

// Tauri commands re-exported for the lib.rs invoke_handler.
pub(crate) use cli_bridge::{
    cli_publish_library_list, cli_publish_player_snapshot, cli_publish_search_results,
    cli_publish_server_list,
};
pub(crate) use core::{
    exit_app, export_runtime_logs, frontend_debug_log, greet, set_logging_mode,
    set_subsonic_wire_user_agent,
};
pub(crate) use perf::performance_cpu_snapshot;
pub(crate) use platform::{set_linux_webkit_smooth_scrolling, set_window_decorations};
pub(crate) use integration::{
    check_dir_accessible, mpris_set_metadata, mpris_set_playback, register_global_shortcut,
    unregister_global_shortcut,
};
pub(crate) use analysis::{
    analysis_delete_all_waveforms, analysis_delete_loudness_for_track,
    analysis_enqueue_seed_from_url, analysis_get_loudness_for_track, analysis_get_waveform,
    analysis_get_waveform_for_track, analysis_prune_pending_to_track_ids,
};

// Discord, Navidrome admin, last.fm + radio-browser + CORS proxy, bandsintown
// now live in `psysonic_integration`. invoke_handler! in lib.rs registers
// them with their full paths so Tauri's `__cmd__*` macros resolve correctly.
