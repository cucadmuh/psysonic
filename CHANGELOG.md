# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Beta Hotfix

### Fixed
- **App Termination Bug**: Fixed an issue where the application would hang in the background when the close button was clicked due to default Tauri tray icon handling. The `exit_app` event is now correctly triggered.

## [0.1.0] - Initial Release

### Added
- **Core Architecture**: Full transition to Tauri v2 with React front-end.
- **Subsonic API Integration**: Complete support for browsing albums, artists, playlists, and fetching streams.
- **Theming System**: Implementation of the Catppuccin Mocha (Dark) and Latte (Light) design systems with dynamic CSS variables.
- **Internationalization (i18n)**: Multi-language support structure established with English and German translations out of the box.
- **Player & Queue**: Fully functional persistent queue with drag-and-drop support, repeat modes, and volume state retention.
- **Live "Now Playing"**: Real-time dropdown to view active streams on the connected server.
- **Settings & Network**: Dual URL configuration (LAN/External) with ping-testing capabilities.
- **Full-Screen Player**: Immersive full-screen mode showing massive album art and track metadata.
- **Continuous Integration**: Automated GitHub Actions to compile native binaries for Linux, macOS, and Windows.

*Initial public release repository setup.*
