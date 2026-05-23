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
        default = pkgs.anywhen;
        anywhen = pkgs.anywhen;
      });

      # NixOS module — see nix/nixos/module.nix. The VM test that
      # exercises it lives in nix/nixos/example/flake.nix (a separate
      # flake with its own inputs, mirroring kolu's home-manager-example
      # pattern) so this top-level flake stays zero-input. CI builds the
      # example via `just ci nixos-test`.
      #
      # Consumers wire the module as:
      #
      #   imports = [ anywhen.nixosModules.default ];
      #   services.anywhen.enable = true;
      #   services.anywhen.package = pkgs.anywhen;  # see README
      nixosModules.default = import ./nix/nixos/module.nix;

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
