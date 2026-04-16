{
  description = ''
    Psysonic for NixOS / nixpkgs: installable app + dev shell.

    Packages:
      nix build .#psysonic          # or .#default — desktop app (.desktop + icon)
      nix profile install .#psysonic

    Run (after build, or from any clone with flake):
      nix run .#psysonic
      nix run github:OWNER/psysonic

    Development:
      nix develop                   # mkShell (Rust/Node/WebKit deps + hooks)
      nix shell .#devShells.default # same environment without entering subshell semantics
  '';

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forSystem = f: lib.genAttrs systems f;

      mkShellFor =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            rustc
            cargo
            cmake
            pkg-config
            openssl
            gtk3
            webkitgtk_4_1
            libsoup_3
            glib-networking
            atk
            cairo
            gdk-pixbuf
            glib
            pango
            librsvg
            alsa-lib
            libayatana-appindicator
          ];

          shellHook = ''
            export LD_LIBRARY_PATH="${pkgs.libayatana-appindicator}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules''${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}"
            export GDK_BACKEND=x11
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
            export WEBKIT_DISABLE_DMABUF_RENDERER=1
            unset CI
          '';

          OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
          OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";
        };

      psysonicFor = system: nixpkgs.legacyPackages.${system}.callPackage ./nix/psysonic.nix { };
    in
    {
      devShells = forSystem (system: { default = mkShellFor system; });

      packages = forSystem (system: {
        psysonic = psysonicFor system;
        default = psysonicFor system;
      });

      apps = forSystem (
        system:
        let
          p = psysonicFor system;
        in
        {
          default = {
            type = "app";
            program = lib.getExe p;
            meta = {
              inherit (p.meta) description homepage license;
              mainProgram = "psysonic";
            };
          };
        }
      );
    };
}
