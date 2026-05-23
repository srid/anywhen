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

      # Stub package — mimics anywhen's runtime contract (reads PORT and
      # ANYWHEN_STATE_DIR, listens on PORT, answers /api/health) without
      # dragging bun packaging into this PR. Swapped for the production
      # `anywhen.packages.${system}.default` once that derivation lands.
      stubPackage = linuxPkgs.writeShellApplication {
        name = "anywhen";
        runtimeInputs = [ linuxPkgs.python3 ];
        text = ''
          : "''${PORT:?PORT must be set}"
          : "''${ANYWHEN_STATE_DIR:?ANYWHEN_STATE_DIR must be set}"
          mkdir -p "$ANYWHEN_STATE_DIR"
          : > "$ANYWHEN_STATE_DIR/anywhen.db"
          exec python3 -c '
          import http.server, os
          class H(http.server.BaseHTTPRequestHandler):
              def do_GET(self):
                  if self.path == "/api/health":
                      self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
                  else:
                      self.send_response(404); self.end_headers()
              def log_message(self, *a, **k): pass
          http.server.HTTPServer(("0.0.0.0", int(os.environ["PORT"])), H).serve_forever()
          '
        '';
      };
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
              package = stubPackage;
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
              package = stubPackage;
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
              package = stubPackage;
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
