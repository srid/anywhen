# Shared env vars consumed by the anywhen build, the devShell, and the wrapper.
{ pkgs }:
{
  # Nix-store path to @kolu/surface source. Consumed by:
  #   - shellHook: symlinks node_modules/@kolu/surface -> $ANYWHEN_KOLU_SURFACE
  #   - postinstall in packages/app/package.json: re-creates the symlink after
  #     `bun install` repopulates node_modules.
  # @kolu/surface is pure TypeScript source — no build needed. Its transitive
  # deps (@orpc/*, solid-js, zod) are installed by bun into anywhen's
  # node_modules and resolve from the symlinked location via standard Node
  # module resolution.
  ANYWHEN_KOLU_SURFACE = pkgs.anywhen-kolu-surface;
}
