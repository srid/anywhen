# Root composer for anywhen Nix packages. `default` is the production
# anywhen app binary (`bin/anywhen` — `bun` running the server against a
# pre-built client bundle and a frozen node_modules tree); the
# `anywhen-kolu-surface` source path is exposed for the dev-shell hook
# that hydrates `node_modules/@kolu/surface` and for the package
# derivation's own build phase.
{ pkgs ? import ./nix/nixpkgs.nix { } }:
{
  inherit (pkgs) anywhen anywhen-kolu-surface;
  default = pkgs.anywhen;
}
