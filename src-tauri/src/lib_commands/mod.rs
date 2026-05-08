pub(crate) mod app_api;
pub(crate) mod cache;
pub(crate) mod file_transfer;
pub(crate) mod sync;
pub(crate) mod ui;

// Each subdirectory re-exports its Tauri commands explicitly. Flatten one
// more level here so `lib.rs`'s `use lib_commands::*;` lands every
// invoke-handler-registered name at lib.rs scope.
pub(crate) use app_api::*;
pub(crate) use cache::*;
pub(crate) use sync::*;
pub(crate) use ui::*;
