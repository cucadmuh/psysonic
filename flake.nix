{
  description = "Psysonic — Nix dev shell (parity with shell.nix; for NixOS and fork CI)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
    in
    {
      devShells = lib.genAttrs systems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
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
        }
      );
    };
}
