# Runtime-contract environment variables for the anywhen binary.
#
# Two env vars cross anywhen's source-tree / nix-evaluation / runtime
# boundaries. The names are part of the contract — renaming one means
# editing every site listed below in lockstep, so this file is the
# single search anchor.
#
# ANYWHEN_STATE_DIR — absolute path to the SQLite store directory.
#   Set by: nix/shell.nix (dev shellHook → repo-local ./state),
#           nix/nixos/module.nix (systemd Environment → /var/lib/anywhen
#           or the operator-provided stateDir).
#   Read by: packages/app/src/storage/db.ts (resolveStateDir) — the
#            canonical name source; throws if unset.
#
# ANYWHEN_KOLU_SURFACE — nix-store path to the @kolu/surface package source.
#   Set by: this file, fed into the devShell via mkShell `env = ...`.
#   Read by: nix/shell.nix (shellHook copies it into node_modules/@kolu/surface),
#            packages/app/package.json postinstall (repeats the copy after
#            `bun install`), justfile `install` recipe.
#   Used only at dev / build time — the NixOS module does not set it
#   because production packages bundle surface into the closure.
{ pkgs }:
{
  ANYWHEN_KOLU_SURFACE = pkgs.anywhen-kolu-surface;
}
