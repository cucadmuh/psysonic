# Installable Psysonic (Tauri): npm build → cargo tauri build --no-bundle.
# Used from the repo flake as packages.<system>.psysonic.

{
  lib,
  stdenv,
  fetchNpmDeps,
  npmHooks,
  rustPlatform,
  cargo,
  rustc,
  pkg-config,
  cmake,
  openssl,
  gtk3,
  webkitgtk_4_1,
  libsoup_3,
  glib-networking,
  alsa-lib,
  libayatana-appindicator,
  atk,
  cairo,
  gdk-pixbuf,
  glib,
  pango,
  librsvg,
  cargo-tauri,
  nodejs,
  makeWrapper,
  wrapGAppsHook4,
  copyDesktopItems,
  makeDesktopItem,
  gst_all_1,
}:

let
  version = (lib.importJSON ../package.json).version;
  # WebKit media stack needs discoverable GStreamer plugins (e.g. appsink in gst-plugins-base).
  gstPlugins = with gst_all_1; [
    gstreamer
    gst-plugins-base
    gst-plugins-good
    gst-plugins-bad
  ];
  gstPluginPath = lib.makeSearchPath "lib/gstreamer-1.0" gstPlugins;
  src = lib.cleanSourceWith {
    src = ../.;
    filter =
      path: _:
      let
        f = toString path;
      in
      !(lib.hasInfix "/node_modules/" f)
      && !(lib.hasInfix "/dist/" f)
      && !(lib.hasInfix "/target/" f)
      && !(lib.hasInfix "/.git/" f)
      && !(lib.hasInfix "/result/" f)
      && !(lib.hasInfix "/upstream-src/" f)
      && !(lib.hasInfix "/.flatpak-builder/" f);
  };
  npmDeps = fetchNpmDeps {
    inherit src;
    hash = "sha256-K6qJmD7XIUCfSA9US3PDt2VfyIMMbqTIdkpy7DGxLSM=";
  };
in

stdenv.mkDerivation (finalAttrs: {
  pname = "psysonic";
  inherit version src npmDeps;

  strictDeps = true;

  # cmake is only for Rust deps (e.g. libopus); no top-level CMakeLists.txt in repo root
  dontUseCmakeConfigure = true;

  nativeBuildInputs = [
    npmHooks.npmConfigHook
    cargo
    rustc
    rustPlatform.cargoSetupHook
    pkg-config
    cmake
    makeWrapper
    wrapGAppsHook4
    copyDesktopItems
    cargo-tauri
    nodejs
  ];

  buildInputs = [
    gtk3
    webkitgtk_4_1
    libsoup_3
    glib-networking
    openssl
    alsa-lib
    libayatana-appindicator
    atk
    cairo
    gdk-pixbuf
    glib
    pango
    librsvg
  ]
  ++ gstPlugins;

  cargoRoot = "src-tauri";
  cargoDeps = rustPlatform.importCargoLock { lockFile = ../src-tauri/Cargo.lock; };

  dontUseCargoParallelJobs = true;

  env = {
    OPENSSL_DIR = "${openssl.dev}";
    OPENSSL_LIB_DIR = "${openssl.out}/lib";
    OPENSSL_INCLUDE_DIR = "${openssl.dev}/include";
    VITE_LASTFM_API_KEY = "";
    VITE_LASTFM_API_SECRET = "";
  };

  # beforeBuildCommand runs npm run build; npmConfigHook supplies offline node_modules
  buildPhase = ''
    runHook preBuild
    export HOME=$(mktemp -d)
    (cd src-tauri && cargo tauri build --no-bundle -v)
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 src-tauri/target/release/psysonic -t $out/bin
    install -Dm644 src-tauri/icons/128x128.png $out/share/icons/hicolor/128x128/apps/psysonic.png
    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "psysonic";
      desktopName = "Psysonic";
      comment = "Subsonic-compatible music player";
      icon = "psysonic";
      exec = "psysonic";
      categories = [ "AudioVideo" "Audio" "Player" ];
    })
  ];

  postFixup = ''
    wrapProgram $out/bin/psysonic \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [ libayatana-appindicator ]}" \
      --prefix GST_PLUGIN_PATH : "${gstPluginPath}" \
      --prefix GIO_EXTRA_MODULES : "${glib-networking}/lib/gio/modules" \
      --set GDK_BACKEND x11 \
      --set WEBKIT_DISABLE_COMPOSITING_MODE 1 \
      --set WEBKIT_DISABLE_DMABUF_RENDERER 1
  '';

  meta = {
    description = "Desktop music player for Subsonic-compatible servers";
    homepage = "https://github.com/Psychotoxical/psysonic";
    license = lib.licenses.gpl3Only;
    mainProgram = "psysonic";
    platforms = lib.platforms.linux;
  };
})

