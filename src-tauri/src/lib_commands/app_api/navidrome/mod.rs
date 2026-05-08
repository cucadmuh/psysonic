//! Navidrome native REST API: split into a small client/auth/retry core
//! plus per-domain submodules (covers, users, queries, playlists). Each
//! Tauri command goes through `nd_http_client()` + `nd_retry()` so flaky
//! reverse proxies in front of the server don't surface as user-visible
//! transport errors on a single retry-able blip.

mod client;
mod covers;
mod users;
mod queries;
mod playlists;

// Re-export only the Tauri commands — `client` items (nd_http_client,
// nd_retry, navidrome_token, NdLoginResult, nd_err) are internal helpers
// used by the other submodules and don't need crate-wide visibility.
pub(crate) use covers::{
    delete_radio_cover, upload_artist_image, upload_playlist_cover, upload_radio_cover,
};
pub(crate) use users::{
    navidrome_login, nd_create_user, nd_delete_user, nd_list_users, nd_update_user,
};
pub(crate) use queries::{
    nd_get_song_path, nd_list_albums_by_artist_role, nd_list_artists_by_role, nd_list_libraries,
    nd_list_songs, nd_set_user_libraries,
};
pub(crate) use playlists::{
    nd_create_playlist, nd_delete_playlist, nd_get_playlist, nd_list_playlists, nd_update_playlist,
};
