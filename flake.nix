# IMPORTANT: zero flake inputs *except* `bun2nix` — kolu convention.
# nixpkgs and kolu (for @kolu/surface) are pinned via npins (see
# npins/sources.json), bypassing the flake input system to keep `nix
# develop` cold-eval fast (~1.0s vs ~7s per input). DO NOT add further
# flake inputs.
#
# `bun2nix` is the documented exception: there is no fetchBunDeps /
# buildBunPackage in nixpkgs, and bun2nix's nix layer is flake-parts-
# shaped — it cannot be cleanly imported from a non-flake-parts context.
# juspay/bun2nix#2 adds `lib.mkBun2nix { pkgs }` so we feed it OUR
# npins-pinned pkgs (no transitive nixpkgs eval in our flake). The input
# is only realized when the `packages.*` attrset is evaluated — `nix
# develop` cold eval stays unchanged.
#
# Operator note (flake.lock vs npins/sources.json):
# - `npins/sources.json` is the SINGLE source of truth for the
#   application's nixpkgs. Every derivation in this repo (anywhen, the
#   dev shell, @kolu/surface) builds against the npins pin.
# - `flake.lock` carries a SECOND nixpkgs revision: bun2nix's own input
#   used to build bun2nix's Rust CLI binary. That nixpkgs never enters
#   anywhen's build graph — `mkBun2nix { pkgs }` consumes ours.
# - Consequence: `nix flake update bun2nix` and `npins update nixpkgs`
#   are independent operations on independent pins. The divergence is
#   acceptable because the two nixpkgs serve disjoint purposes (build a
#   CLI tool vs. build the app); the partition is what keeps the dev
#   shell off the bun2nix eval path.
{
  inputs.bun2nix.url = "github:juspay/bun2nix/rawflake";

  outputs = { self, bun2nix, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      eachSystem = f: builtins.listToAttrs (map
        (system:
          let
            pkgs = import ./nix/nixpkgs.nix { inherit system; };
            b2n = bun2nix.lib.mkBun2nix { inherit pkgs; };
          in
          {
            name = system;
            value = f { inherit pkgs b2n; };
          })
        systems);
    in
    {
      packages = eachSystem ({ pkgs, b2n }:
        let drvs = import ./default.nix { inherit pkgs b2n; };
        in {
          # `nix run .` → wrapped binary with XDG_DATA_HOME state-dir default.
          default = drvs.anywhen;
          inherit (drvs) anywhen anywhenBin anywhenBuilt;
          # @kolu/surface source path — exposed so `nix build .#kolu-surface`
          # realizes the store path used by the dev shell's symlink hook.
          kolu-surface = pkgs.anywhen-kolu-surface;
          # bun2nix CLI — `nix run .#bun2nix -- -o bun.nix` regenerates
          # the lockfile-derived nix expression. Used by the
          # `bun-nix-fresh` justci recipe.
          bun2nix = b2n.bun2nix;
        });

      # NixOS module — see nix/nixos/module.nix. The VM test that
      # exercises it lives in nix/nixos/example/flake.nix (a separate
      # flake with its own inputs, mirroring kolu's home-manager-example
      # pattern) so this top-level flake stays zero-input. CI builds the
      # example via `just ci nixos-test`.
      #
      # Consumers wire the module as:
      #
      #   imports = [ anywhen.nixosModules.default ];
      #   services.anywhen.enable = true;
      #   services.anywhen.package = pkgs.anywhen;  # see README
      nixosModules.default = import ./nix/nixos/module.nix;

      # `nix fmt` — format *.nix files only. JS/TS/CSS/JSON go through Biome
      # via `just fmt`; pulling Biome into the flake formatter would require
      # writing a `treefmt` wrapper for two formatters, which isn't worth the
      # extra surface at this scale.
      formatter = eachSystem ({ pkgs, ... }: pkgs.nixpkgs-fmt);

      devShells = eachSystem ({ pkgs, b2n }:
        let
          default = import ./shell.nix { inherit pkgs; };
          drvs = import ./default.nix { inherit pkgs b2n; };
        in
        {
          inherit default;
          # Extended shell with Playwright browsers + the wrapped anywhen
          # binary exposed via ANYWHEN_TEST_BIN. The cucumber harness
          # spawns that binary instead of `bun src/server/index.ts`, so
          # tests exercise the same artifact `nix run` would.
          # Usage: nix develop .#e2e
          e2e = default.overrideAttrs (prev: {
            name = "anywhen-shell-e2e";
            env = (prev.env or { }) // {
              PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
              ANYWHEN_TEST_BIN = "${drvs.anywhenBin}/bin/anywhen";
            };
          });
        });
    };
}
