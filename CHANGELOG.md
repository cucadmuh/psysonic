# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-15

### Added

#### Rust Audio Engine (replaces Howler.js)
- **New native audio backend** built in Rust using [rodio](https://github.com/RustAudio/rodio). Audio is now decoded and played entirely in the Tauri backend — no more reliance on the WebView's `<audio>` element or GStreamer pipeline quirks.
- Tauri commands: `audio_play`, `audio_pause`, `audio_resume`, `audio_stop`, `audio_seek`, `audio_set_volume`.
- Frontend events: `audio:playing` (with duration), `audio:progress` (every 500 ms), `audio:ended`, `audio:error`.
- Generation counter (`AtomicU64`) ensures stale downloads from skipped tracks are cancelled immediately and do not emit events.
- Wall-clock position tracking (`seek_offset + elapsed`) instead of `sink.empty()` (unreliable in rodio 0.19 for VBR MP3). `audio:ended` fires after two consecutive ticks within 1 second of the track end — avoids false positives near the end without adding latency.
- Seek via `sink.try_seek()` — no pause/play cycle, no spurious `ended` events.
- Volume clamped to `[0.0, 1.0]` on every call.

#### Playback Persistence & Cold-Start Resume
- `currentTrack`, `queue`, `queueIndex`, and `currentTime` are now persisted to `localStorage` via Zustand `partialize`.
- On app restart with a previously loaded track, clicking Play resumes from the saved position without losing the queue.
- Position priority: server play queue position (if > 0) takes precedence over the locally saved value, so cross-device resume works correctly.

#### Random Mix — Genre Filter & Blacklist
- **Exclude audiobooks & radio plays** toggle: filters out songs whose genre, title, or album match a hardcoded list (`Hörbuch`, `Hörspiel`, `Audiobook`, `Spoken Word`, `Podcast`, `Krimi`, `Thriller`, `Speech`, `Fantasy`, `Comedy`, `Literature`, and more).
- **Custom genre blacklist**: add any genre keyword via the collapsible chip panel on the Random Mix page or in Settings → Random Mix. Persisted across sessions.
- **Clickable genre chips** in the tracklist: clicking an unblocked genre tag adds it to the blacklist instantly with 1.5 s visual feedback. Blocked genres are shown in red.
- Blacklist filter checks `song.genre`, `song.title`, and `song.album` to catch mislabelled tracks.

#### Random Mix — Super Genre Mix
- Nine pre-defined **Super Genres** (Metal, Rock, Pop, Electronic, Jazz, Classical, Hip-Hop, Country, World) appear as buttons, auto-generated from the server's genre list — only genres with at least one matching keyword are shown.
- Selecting a Super Genre fetches up to 50 songs distributed across all matched sub-genres in parallel, then shuffles the result.
- **Progressive rendering**: the tracklist appears as soon as the first genre request returns — users with large Metal/Rock libraries no longer stare at a spinner for the entire fetch. A small inline spinner next to the title indicates that more genres are still loading.
- **"Load 10 more"** button: fetches 10 additional songs from the same matched genres and appends them to the play queue.
- Random playlist is automatically hidden while a Genre Mix is active.
- Fetch timeout raised to **45 seconds** per genre request (was 15 s) and `Promise.allSettled` used so a single slow/failing genre does not abort the entire mix.

#### Queue Panel
- **Shuffle button** in the queue header: Fisher-Yates shuffles all queued tracks while keeping the currently playing track at position 0. Button is disabled when the queue has fewer than 2 entries.

#### UI / UX
- **LiveSearch keyboard navigation**: arrow keys navigate the dropdown, Enter selects the highlighted item or navigates to the full search results page, Escape closes the dropdown.
- **Multi-line tooltip support**: add `data-tooltip-wrap` attribute to any element with `data-tooltip` to enable line-wrapping (uses `white-space: pre-line` + `\n` in the string). Respects a 220 px max-width.
- **Genre column info icon** in Random Mix tracklist header: hover tooltip explains the clickable-genre-to-blacklist feature.
- **Update link** in the sidebar now uses Tauri Shell plugin `open()` to launch the system browser correctly — `<a target="_blank">` has no effect inside a Tauri WebView.

### Fixed
- **Songs skipping immediately** (root cause: Tauri v2 IPC maps Rust `snake_case` parameters to **camelCase** on the JS side — `duration_hint` must be `durationHint`). All `invoke()` calls updated.
- **Play button doing nothing after restart**: `currentTrack` was `null` after restart (not persisted). Fixed by adding it to `partialize`.
- **Position not restored after restart**: `initializeFromServerQueue` overwrote the local saved position with the server value even when the server reported 0. Now falls back to the localStorage value when the server position is 0.
- **Genre Mix blank on Metal/Rock**: a single timed-out genre request caused `Promise.all` to reject the entire mix. Replaced with `Promise.allSettled` + 45 s timeout; partial results are shown immediately.
- **Tooltip z-index**: tooltips in the main content area were rendered behind the queue panel. Fixed by giving `.main-content` `z-index: 1`, establishing a stacking context above the queue (which sits later in DOM order).
- **Sidebar title clipping**: "Psysonic" brand text was truncated at narrow viewport widths. Minimum sidebar width raised from 180 px to 200 px.

### Changed
- **Audio architecture**: Howler.js removed. All audio state (`isPlaying`, `isAudioPaused`, `currentTime`, `duration`) is now driven by Tauri events from the Rust engine rather than Howler callbacks.
- **Random Mix layout**: Filter/blacklist panel and Genre Mix buttons are now combined in a two-column card at the top of the page instead of being scattered across the page.
- **Hardcoded genre blacklist** extended with: `Fantasy`, `Comedy`, `Literature`.
- **`getRandomSongs`** now accepts an optional `timeout` parameter (default 15 s) so callers can pass a longer value for large-library scenarios.

## [1.0.12] - 2026-03-14

### Fixed
- **Seek Stop Bug**: Clicking the progress bar a second time no longer stops playback. Root cause: WebKit and GStreamer fire spurious `ended` events immediately after a direct `audioNode.currentTime` seek. A guard now checks `lastSeekAt` + playhead position to silently discard these false alarms.
- **Play/Pause Hang**: Rapidly double-clicking the play/pause button no longer freezes the audio pipeline. A 300 ms lock prevents a second toggle from issuing `pause→play` before GStreamer has finished the previous state transition.
- **Queue DnD (macOS / Windows)**: Drop target index is now calculated from the mouse `clientY` position at drop time instead of refs, eliminating the `dragend`-before-`drop` timing race on macOS WKWebView and Windows WebView2.

### Added
- **Live Now Playing navigation**: Clicking an entry in the Live dropdown now navigates to the corresponding album page.

### Changed
- **Hero blur**: Increased background blur in the Hero section for a more immersive look.

## [1.0.11] - 2026-03-14

### Added
- **Search Results Page**: Pressing Enter in the search bar now navigates to a dedicated full search results page showing artists, albums, and songs with proper column layout and headers.

### Fixed
- **Search Results Column Alignment**: Artist and album columns in the search results song list are now correctly aligned with their column headers.
- **Search Results Header Alignment**: Fixed column header labels not aligning with song row content (root cause: `auto`-width Format column was sized independently per grid row).

### Changed
- **Gapless Playback removed**: Removed the experimental gapless playback feature. It caused intermittent song skipping and beginning cutoffs and was not reliable enough to ship. Standard sequential playback is used instead.

### Known Issues
- ~~**Seeking**: Seeking may occasionally be unreliable, particularly on Linux/GStreamer.~~ Fixed in 1.0.12.
- ~~**Queue drag & drop (macOS / Windows)**: Queue reordering via drag & drop may not always work correctly on macOS and Windows.~~ Fixed in 1.0.12.

## [1.0.10] - 2026-03-14

### Added
- **Active Track Highlighting**: The currently playing song is highlighted in album tracklists with a subtle pulsing accent background and a play icon — persists when navigating away and returning.
- **Marquee Title in Fullscreen Player**: Long song titles now scroll smoothly as a marquee instead of being cut off.
- **Clickable Artist / Album in Player Bar**: Clicking the artist name navigates to the artist page; clicking the song title navigates to the album page. Same behaviour in the Queue panel's now-playing strip.
- **Linux App Menu Category**: Application now appears under **Multimedia** in desktop application menus (GNOME, KDE, etc.) instead of "Other".
- **Windows MSI Upgrade Support**: Added stable `upgradeCode` GUID so the MSI installer recognises previous versions and upgrades in-place without requiring manual uninstallation first.

### Fixed
- **Drag & Drop (macOS / Windows)**: Queue reordering now works correctly on macOS WKWebView and Windows WebView2. The previous fix cleared index refs synchronously in `onDragEnd`, which fires before `drop` on both platforms — refs are now cleared with a short delay so `onDropQueue` can read the correct source and destination indices.
- **Settings Dropdowns**: Language and theme selects now have a clearly visible border (was invisible against the card background).
- **Tracklist Format Column**: Removed file size and kHz from the format column — codec and bitrate only. Column moved to the far right, after duration. Width is now dynamic (`auto`).
- **`tauri.conf.json`**: Fixed invalid placement of `shortDescription`/`longDescription` (were incorrectly nested under `bundle.linux`, now at `bundle` level). Removed invalid `nsis.allowDowngrades` field.

### Changed
- **Favorites Icon**: Replaced the incorrect fork icon with a star icon in the Random Mix page, consistent with all other pages.
- **Sidebar**: Removed drag-to-resize handle. Width now adapts dynamically to the viewport via `clamp(180px, 15vw, 220px)`.
- **About Section**: Added "Developed with the support of Claude Code by Anthropic" credit. Fixed "weiterzugeben" wording in German MIT licence text.
- **Minimize to Tray**: Now disabled by default.

## [1.0.9] - 2026-03-13

### Added
- **Gapless Playback**: The next track's audio pipeline is silently pre-warmed before the current track ends, eliminating the gap between songs — especially noticeable on live albums and concept records.
- **Pre-caching**: Prefetched Howl instances are now actually reused for playback, giving near-instant track transitions instead of a new HTTP connection each time.
- **Buffered Progress Indicator**: The seek bar now shows a secondary fill indicating how much of the current track has been buffered by the browser — visible in both the Player Bar and Fullscreen Player.
- **Resume on Startup**: Pressing Play after launching the app now resumes the last track at the saved playback position instead of doing nothing.
- **Album Track Hover Play Button**: Hovering over a track number in Album Detail reveals a play button for quick single-click playback.
- **Ken Burns Background**: The Fullscreen Player background now slowly drifts and zooms (Ken Burns effect) for a more cinematic feel.
- **F11 Fullscreen**: Toggle native borderless fullscreen with F11.
- **Compact Queue Now-Playing**: The current track block in the Queue Panel is now a slim horizontal strip (72 px thumbnail) instead of a full-width cover, freeing up significantly more space for the queue list on smaller screens.

### Fixed
- **GStreamer Seek Stability**: Implemented a three-layer recovery system for Linux/GStreamer seek hangs: (1) seek queuing to prevent overlapping GStreamer seeks, (2) a 2-second watchdog that triggers automatic recovery if a seek never completes, (3) an 8-second hang detector that silently recreates the audio pipeline and resumes from the last known position if playback freezes entirely.
- **Fullscreen Player**: Removed drop shadow from cover art — looks cleaner on lighter artist backgrounds.

### Changed
- **Hero Section**: Increased height (300 → 360 px) and cover art size (180 → 220 px) to prevent long album titles from clipping.
- **Player Bar**: Controls and progress bar moved closer together for a more balanced layout.

## [1.0.8] - 2026-03-13

### Added
- **Ambient Stage**: Completely redesigned Fullscreen Player. Experience an immersive atmosphere with drifting color orbs, a "breathing" cover animation, and high-resolution artist backgrounds.
- **Improved Drag & Drop**: Rewritten Play Queue reordering for rock-solid reliability on macOS (WKWebView) and Windows (WebView2).

### Fixed
- **Linux Audio Stability**: Resolved playback stuttering when seeking under GStreamer by implementing a robust pause-seek-play sequence.
- **Data Integration**: Standardized `artistId` propagation across all track sources for better metadata consistency.

## [1.0.7] - 2026-03-13

### Added
- **Update Notifications**: Integrated a native update check system in the sidebar that notifies you when a new version is available on GitHub.
- **Improved Settings**: Refined layout and styling for a cleaner settings experience.

### Fixed
- **UI/UX Refinements**: Polished sidebar animations and layout for better visual consistency.
- **i18n**: Added missing translations for update notifications and system status.

## [1.0.6] - 2026-03-13

### Added
- **Extended Themes**: Selection expanded to 8 themes, including the complete Nord series (Nord, Snowstorm, Frost, Aurora).
- **Light Theme Support**: Enhanced readability for Hero and Fullscreen Player components when using light themes (Latte, Snowstorm).

### Fixed
- **Linux/Wayland Compatibility**: Fixed immediate crash on Wayland environments by forcing X11 backend for the AppImage.
- **Playback Stability**: Introduced seek debouncing to prevent audio stalls on Linux/GStreamer.
- **Windows Integration**: Improved drag-and-drop compatibility for systems using WebView2.

## [1.0.5] - 2026-03-12

### Added
- **Image Caching**: Integrated IndexedDB-based image caching for cover art and artist images, providing significantly faster loading times for frequently accessed items.
- **Improved Artist Discovery**: Faster scrolling in the Artists list using color-coded initial-based avatars for quick visual identification.
- **Random Albums**: New discovery page for exploring your library with random album selections.
- **Help & Documentation**: Added a dedicated help page for better user onboarding.

### Changed
- **Optimized UI**: Instant "Now Playing" status updates via local state filtering for a more responsive experience.
- **Enhanced Data Flow**: General performance improvements in server communication and state management.

## [1.0.4] - 2026-03-12

### Added
- **Album Downloads**: Support for downloading entire albums with real-time progress tracking.

### Fixed
- **Linux GPU Compatibility**: Patched AppImage to disable DMABUF renderer, fixing EGL/GPU crashes on older hardware.
- **CI/CD Reliability**: Optimized release workflow with split jobs for better stability across platforms.

## [1.0.3] - 2026-03-12

### Fixed
- **CI/CD Build**: Resolved build conflicts on Ubuntu 22.04 by removing redundant dev packages (`libunwind-dev`, gstreamer dev).
- **Linux AppImage**: Configured GStreamer bundling and verified runtime environment settings.

## [1.0.2] - 2026-03-11

### Fixed
- **Linux AppImage**: Integrated GStreamer bundling fix in CI/CD workflow.
- **CI/CD Reliability**: Set `APPIMAGE_EXTRACT_AND_RUN=1` to prevent FUSE-related issues.

## [1.0.1] - 2026-03-11

### Fixed
- **Optimized Codebase**: Integrated core fixes and performance improvements.
- **Improved Multi-Server Support**: Fixed edge cases in server switching and credential management.
- **Enhanced Security**: Switched to `crypto.getRandomValues()` for more robust auth salt generation.
- **Connection Reliability**: Added pre-verification for server connections to prevent state synchronization issues.
- **Linux Compatibility**: Applied workarounds for WebKitGTK compositing issues on Linux.

### Changed
- Repository maintenance and preparation for the 1.0.1 release.

## [1.0.0] - 2026-03-09

### Added
- **Initial Public Release**: The first stable release of Psysonic.
- **Subsonic/Navidrome API**: Full integration for browsing library, artists, albums, and playlists.
- **Audio Playback**: Modern audio engine powered by Howler.js with support for various codecs.
- **Queue Management**: Persistent play queue with drag-and-drop reordering and server-side synchronization.
- **Secured Credentials**: Industry-standard security using Tauri's encrypted store for authentication tokens.
- **Design System**: Premium aesthetics based on the Catppuccin palette (Mocha & Latte themes).
- **Multi-Language**: Full localization support for English and German.
- **Fullscreen Mode**: Dedicated immersive player view with high-res album art.
- **Last.fm Scrobbling**: Built-in support for track scrobbling to Last.fm via Navidrome.
- **System Integration**: Native tray icon support, minimize-to-tray, and global media key handling.
- **Intelligent Networking**: Automatic or manual switching between LAN (Local) and External (Internet) addresses.
- **Live Now Playing**: Real-time view of what other users or players are streaming on your server.
- **Search**: Fast, real-time search for songs, albums, and artists.

### Security
- **Hardened Sandbox**: Restricted filesystem permissions to only necessary download/cache directories.
- **API Lockdown**: Disabled global Tauri objects to mitigate XSS risks.
- **Credential Storage**: Replaced insecure `localStorage` with a native encrypted store.

### Fixed
- Fixed a memory leak in the track prefetching engine.
- Improved Error handling for unstable Subsonic server responses.
