# Root composer for anywhen Nix packages.
#
# The dev shell consumes `anywhen-kolu-surface` (via `nix/env.nix`); the
# wrappers below feed `nix run` / `nix build` / the e2e harness.
#
# Two wrapper layers, mirroring kolu's koluBin/default split:
#
#   anywhenBin — sets ANYWHEN_DIST_DIR to the in-store /lib/anywhen/dist
#                path. Does NOT set ANYWHEN_STATE_DIR — callers (tests,
#                NixOS modules, scripts) supply their own. db.ts crashes
#                with a clear error if it's missing, so production
#                consumers can't accidentally inherit a stale dev path.
#
#   anywhen    — wraps anywhenBin, defaulting ANYWHEN_STATE_DIR to
#                $XDG_DATA_HOME/anywhen for plain `nix run`.
#
# `b2n` carries the bun2nix helpers; passed in from flake.nix via
# `lib.mkBun2nix { inherit pkgs; }` (juspay/bun2nix PR #2 standalone API).
{ pkgs ? null
, b2n ? null
}:
let
  resolvedPkgs =
    if pkgs != null
    then pkgs
    else import ./nix/nixpkgs.nix { };
  # b2n is required for the `anywhen` derivation. When `default.nix` is
  # imported without it (e.g. `nix-build -A anywhen-kolu-surface`), only
  # the surface attribute is realizable. The build derivation throws on
  # access if needed without bun2nix wired up.
  anywhenBuilt =
    if b2n != null
    then resolvedPkgs.callPackage ./nix/packages/anywhen { bun2nix = b2n; }
    else throw "anywhen build derivation needs `b2n` (lib.mkBun2nix output) — invoke via flake.nix";

  anywhenBin = resolvedPkgs.runCommand "anywhen-bin"
    {
      nativeBuildInputs = [ resolvedPkgs.makeWrapper ];
      meta.mainProgram = "anywhen";
    } ''
    mkdir -p $out/bin
    makeWrapper ${resolvedPkgs.bun}/bin/bun $out/bin/anywhen \
      --add-flags "${anywhenBuilt}/lib/anywhen/packages/app/src/server/index.ts" \
      --set ANYWHEN_DIST_DIR "${anywhenBuilt}/lib/anywhen/packages/app/dist"
  '';

  anywhen = resolvedPkgs.runCommand "anywhen"
    {
      nativeBuildInputs = [ resolvedPkgs.makeWrapper ];
      meta.mainProgram = "anywhen";
    } ''
    mkdir -p $out/bin
    makeWrapper ${anywhenBin}/bin/anywhen $out/bin/anywhen \
      --run 'export ANYWHEN_STATE_DIR="''${ANYWHEN_STATE_DIR:-''${XDG_DATA_HOME:-$HOME/.local/share}/anywhen}"'
  '';
in
{
  inherit anywhen anywhenBin anywhenBuilt;
  inherit (resolvedPkgs) anywhen-kolu-surface;
}
