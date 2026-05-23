# Env vars exported by this module for the dev shell and the build
# derivation (and re-used by NixOS modules consuming the app).
#
# This file holds only vars whose value is a Nix-store path; other
# anywhen env vars are set closer to their consumer (because they
# depend on runtime values: a port, a user, an XDG dir, an ephemeral
# tmpdir). The full anywhen env-var surface — for grepping — is:
#
#   ANYWHEN_KOLU_SURFACE  — set HERE (shell + build).
#                           /nix/store path to the @kolu/surface
#                           source. Hydrated into
#                           node_modules/@kolu/surface by
#                           scripts/hydrate-kolu-surface.sh.
#
#   ANYWHEN_STATE_DIR     — set in shell.nix (shellHook defaults it
#                           to $repo/state), default.nix (the
#                           `anywhen` wrapper defaults it to
#                           $XDG_DATA_HOME/anywhen), and per-scenario
#                           in packages/tests/support/hooks.ts.
#                           Read by resolveStateDir() in
#                           packages/app/src/storage/db.ts.
#
#   ANYWHEN_DIST_DIR      — set in default.nix (the `anywhenBin`
#                           wrapper points it at the in-store dist
#                           tree). Read by resolveDistMode() in
#                           packages/app/src/server/index.ts.
#                           Unset = dev path (buildClient at boot).
#
#   ANYWHEN_TEST_BIN      — set in flake.nix (devShells.e2e). Path
#                           to the wrapped anywhen binary the
#                           cucumber harness spawns. Nix sets it
#                           because the in-store path isn't
#                           computable from the harness — this is
#                           a configuration-injection point, not a
#                           volatility seam.
{ pkgs }:
{
  ANYWHEN_KOLU_SURFACE = pkgs.anywhen-kolu-surface;
}
