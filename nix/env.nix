# Shared env vars consumed by the anywhen build, the devShell, and the wrapper.
#
# The canonical anywhen env-var surface:
#
#   ANYWHEN_KOLU_SURFACE  — set here (shell + build). /nix/store path to
#                           the @kolu/surface source. Hydrated into
#                           node_modules/@kolu/surface by shellHook and
#                           by the anywhen derivation's
#                           postBunNodeModulesInstallPhase.
#
#   ANYWHEN_STATE_DIR     — wrapper-only (see default.nix `anywhen`).
#                           Defaults to $XDG_DATA_HOME/anywhen under
#                           `nix run`. shell.nix's shellHook defaults
#                           it to $repo/state for `just dev`. Cucumber
#                           overrides per-scenario.
#
#   ANYWHEN_DIST_DIR      — wrapper-only (see default.nix `anywhenBin`).
#                           /nix/store path to the pre-built client tree.
#                           If unset (dev path), `build.ts` is invoked
#                           at server startup.
#
#   ANYWHEN_TEST_BIN      — e2e shell only (see flake.nix
#                           `devShells.e2e`). Path to the wrapped
#                           anywhen binary the cucumber harness spawns.
{ pkgs }:
{
  ANYWHEN_KOLU_SURFACE = pkgs.anywhen-kolu-surface;
}
