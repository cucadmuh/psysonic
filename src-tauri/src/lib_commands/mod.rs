pub(crate) mod app_api;
pub(crate) mod sync;
pub(crate) mod ui;

// Each subdirectory re-exports its Tauri commands explicitly. Flatten one
// more level here so `lib.rs`'s `use lib_commands::*;` lands every
// invoke-handler-registered name at lib.rs scope.
pub(crate) use app_api::*;
pub(crate) use sync::*;
pub(crate) use ui::*;

// Cache + file_transfer + sync commands now live in psysonic_syncfs.
// invoke_handler! in lib.rs registers them with their full paths
// (`psysonic_syncfs::cache::*` / `psysonic_syncfs::sync::*`) so Tauri's
// `__cmd__*` magic macros resolve across the crate boundary. Nothing to
// re-export at this level.
