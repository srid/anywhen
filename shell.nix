# Dev shell — shared by `nix develop` (via flake.nix) and `nix-shell`.
#
# Playwright is NOT in the default shell — it adds ~600ms cold start.
# flake.nix exposes devShells.e2e for Cucumber: `nix develop .#e2e`.
{ pkgs ? import ./nix/nixpkgs.nix { } }:
let
  anywhenEnv = import ./nix/env.nix { inherit pkgs; };
in
pkgs.mkShell {
  name = "anywhen-shell";

  env = anywhenEnv;

  shellHook = ''
    # Hydrate node_modules/@kolu/surface and default the dev state dir.
    # Hydration strategy lives in scripts/hydrate-kolu-surface.sh — one
    # script, three callers (this shellHook, the just `install` recipes,
    # and the anywhen build derivation's postBunNodeModulesInstallPhase).
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      (cd "$root" && sh scripts/hydrate-kolu-surface.sh "$ANYWHEN_KOLU_SURFACE")

      # Default dev state dir to repo-local ./state so `just dev` runs without
      # ceremony. Cucumber overrides with a per-run mktemp -d (see
      # packages/tests/support/hooks.ts) so prod-vs-test paths stay distinct.
      : "''${ANYWHEN_STATE_DIR:=$root/state}"
      export ANYWHEN_STATE_DIR
    fi
  '';

  packages = with pkgs; [
    just
    jq
    bun
    nodejs # used by cucumber-js (via `node --import tsx ...`)
    biome
    nixpkgs-fmt
    sqlite # CLI handy for inspecting the local DB
  ];
}
