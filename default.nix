# Root composer for anywhen Nix packages.
#
# For PR 1, the only consumable derivation is `kolu-surface` (the upstream
# source path for @kolu/surface). The app itself is run via `bun` from the
# dev shell — no `nix build` of the app yet. A future PR will add an
# anywhen package derivation (bun bundle + sqlite migrations baked in).
{ pkgs ? import ./nix/nixpkgs.nix { } }:
{
  inherit (pkgs) anywhen-kolu-surface;
}
