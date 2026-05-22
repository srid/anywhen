# IMPORTANT: zero flake inputs — kolu convention. nixpkgs and kolu (for
# @kolu/surface) are pinned via npins (see npins/sources.json), bypassing
# the flake input system to keep `nix develop` cold-eval fast (~1.0s vs
# ~7s per input). DO NOT add flake inputs.
{
  outputs = { self, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      eachSystem = f: builtins.listToAttrs (map
        (system: {
          name = system;
          value = f (import ./nix/nixpkgs.nix { inherit system; });
        })
        systems);
    in
    {
      packages = eachSystem (pkgs: {
        # @kolu/surface source path — exposed so `nix build .#kolu-surface`
        # realizes the store path used by the dev shell's symlink hook.
        kolu-surface = pkgs.anywhen-kolu-surface;
      });

      # `nix fmt` — format *.nix files only. JS/TS/CSS/JSON go through Biome
      # via `just fmt`; pulling Biome into the flake formatter would require
      # writing a `treefmt` wrapper for two formatters, which isn't worth the
      # extra surface at this scale.
      formatter = eachSystem (pkgs: pkgs.nixpkgs-fmt);

      devShells = eachSystem (pkgs:
        let default = import ./shell.nix { inherit pkgs; };
        in {
          inherit default;
          # Extended shell with Playwright browsers for Cucumber e2e tests.
          # Usage: nix develop .#e2e
          e2e = default.overrideAttrs (prev: {
            name = "anywhen-shell-e2e";
            env = (prev.env or { }) // {
              PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            };
          });
        });
    };
}
