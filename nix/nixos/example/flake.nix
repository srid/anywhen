# Example flake demonstrating how to consume `anywhen.nixosModules.default`
# in a downstream NixOS configuration — and, incidentally, the home of
# anywhen's VM test.
#
# Mirrors `kolu/nix/home/example/flake.nix`: the top-level anywhen flake
# stays zero-input and ships only the module + dev packages; the VM test
# lives here because it needs nixpkgs.lib.nixosSystem / testers.nixosTest
# which require a real nixpkgs flake input. CI builds this with
# `--override-input flake/anywhen .` so the test runs against the local
# checkout (see ci/mod.just `nixos-test` recipe).
{
  inputs = {
    anywhen.url = "github:srid/anywhen";
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs = { nixpkgs, anywhen, ... }:
    let
      linuxSystem = "x86_64-linux";
      linuxPkgs = nixpkgs.legacyPackages.${linuxSystem};

      # The production anywhen package — pulled from the local checkout
      # in CI via `--override-input flake/anywhen .`. Same closure that
      # `services.anywhen.package = pkgs.anywhen` would consume.
      anywhenPackage = anywhen.packages.${linuxSystem}.default;
    in
    {
      # Default machine — exercises the managed branch (systemd creates
      # /var/lib/anywhen via StateDirectory=, dedicated `anywhen` user,
      # default port 7700).
      nixosConfigurations.example = nixpkgs.lib.nixosSystem {
        system = linuxSystem;
        modules = [
          anywhen.nixosModules.default
          {
            boot.loader.grub.devices = [ "nodev" ];
            fileSystems."/" = { device = "none"; fsType = "tmpfs"; };
            system.stateVersion = "24.11";

            services.anywhen = {
              enable = true;
              package = anywhenPackage;
            };
          }
        ];
      };

      # VM test — boots both the managed and unmanaged-stateDir branches
      # under qemu and asserts the systemd unit, port binding, and
      # state-dir wiring end-to-end.
      checks.${linuxSystem}.vm-test = linuxPkgs.testers.nixosTest {
        name = "anywhen";

        nodes = {
          machine = { ... }: {
            imports = [ anywhen.nixosModules.default ];

            services.anywhen = {
              enable = true;
              package = anywhenPackage;
            };
          };

          # Unmanaged machine — exercises `manageStateDir = false`. The
          # operator (here, a tmpfiles rule) provisions the state
          # directory at a non-canonical path; the module must NOT emit
          # StateDirectory= and must NOT create /var/lib/anywhen.
          unmanaged = { ... }: {
            imports = [ anywhen.nixosModules.default ];

            services.anywhen = {
              enable = true;
              package = anywhenPackage;
              port = 7711;
              stateDir = "/srv/anywhen-state";
              manageStateDir = false;
            };

            systemd.tmpfiles.rules = [
              "d /srv/anywhen-state 0700 anywhen anywhen -"
            ];
          };
        };

        # Pull the port from the evaluated module config so the curl URL
        # tracks `services.anywhen.port` automatically.
        testScript = { nodes, ... }:
          let
            port = toString nodes.machine.services.anywhen.port;
            unmanagedPort = toString nodes.unmanaged.services.anywhen.port;
          in
          ''
            machine.wait_for_unit("anywhen.service")
            unmanaged.wait_for_unit("anywhen.service")

            # systemd reports "active" before the listener binds. Poll
            # until the port answers — 60s headroom for qemu TCG
            # fallback on hosts without KVM (Python stdlib http.server is
            # fast, but VM cold start dominates).
            machine.wait_until_succeeds(
                "curl --fail --silent http://127.0.0.1:${port}/api/health",
                timeout=60,
            )
            unmanaged.wait_until_succeeds(
                "curl --fail --silent http://127.0.0.1:${unmanagedPort}/api/health",
                timeout=60,
            )

            # Managed branch: StateDirectory= must have created
            # /var/lib/anywhen with mode 0700 owned by the anywhen user.
            machine.succeed("test -d /var/lib/anywhen")
            machine.succeed("[ \"$(stat -c %U /var/lib/anywhen)\" = anywhen ]")
            machine.succeed("[ \"$(stat -c %a /var/lib/anywhen)\" = 700 ]")

            # Unmanaged branch: systemd must NOT have created
            # /var/lib/anywhen; the operator-provisioned
            # /srv/anywhen-state is what the service writes into.
            unmanaged.fail("test -d /var/lib/anywhen")
            unmanaged.succeed("test -d /srv/anywhen-state")
            unmanaged.succeed("test -f /srv/anywhen-state/anywhen.db")
          '';
      };
    };
}
