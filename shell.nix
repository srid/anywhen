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
    # Hydrate node_modules/@kolu/surface from the nix-store path. We `cp -r`
    # (not symlink) because TypeScript resolves transitive imports from the
    # *real* file location: a symlink target sitting in /nix/store has no
    # adjacent node_modules, so @orpc/contract / zod / solid-js can't be
    # found from surface's source. Copying lets resolution walk up to
    # anywhen's own node_modules where those packages live.
    #
    # This is not vendoring — the canonical source is npins-pinned kolu;
    # node_modules is gitignored cache regenerated on every install.
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      mkdir -p "$root/node_modules/@kolu"
      rm -rf "$root/node_modules/@kolu/surface"
      cp -rL "$ANYWHEN_KOLU_SURFACE" "$root/node_modules/@kolu/surface"
      chmod -R u+w "$root/node_modules/@kolu/surface"

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
