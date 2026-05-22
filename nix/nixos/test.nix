# NixOS VM test — boots the anywhen module under a real systemd and
# verifies the service starts, binds the configured port, and answers
# /api/health.
#
# Until the production package derivation lands (see README "NixOS
# module"), this test wires up a minimal stub package: a python3
# http.server that mimics anywhen's runtime contract (reads PORT and
# ANYWHEN_STATE_DIR from env, listens on PORT, responds 200 "ok" on
# /api/health). The stub exercises every wire of the module — user
# creation, StateDirectory, environment, ExecStart, systemd unit
# lifecycle — without dragging bun packaging into the same PR.
{ pkgs }:
let
  stubPackage = pkgs.writeShellApplication {
    name = "anywhen";
    runtimeInputs = [ pkgs.python3 ];
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
    # writeShellApplication sets meta.mainProgram to `name`, which is
    # what `lib.getExe` reads in module.nix. No extra wiring needed.
  };
in
pkgs.testers.nixosTest {
  name = "anywhen";

  nodes = {
    # Default machine — exercises the managed branch: systemd creates
    # /var/lib/anywhen via StateDirectory=, the module declares the
    # `anywhen` user/group, default port 7700.
    machine = { ... }: {
      imports = [ ../../nix/nixos/module.nix ];

      services.anywhen = {
        enable = true;
        package = stubPackage;
      };
    };

    # Unmanaged machine — exercises `manageStateDir = false`. The
    # operator (here, a tmpfiles rule) provisions the state directory
    # at a non-canonical path; the module must NOT emit StateDirectory=
    # and must NOT create /var/lib/anywhen.
    unmanaged = { ... }: {
      imports = [ ../../nix/nixos/module.nix ];

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
  # tracks `services.anywhen.port` automatically — changing the option's
  # default (or wiring a different port in a future test variant)
  # propagates without two values getting out of sync.
  testScript = { nodes, ... }:
    let
      port = toString nodes.machine.services.anywhen.port;
      unmanagedPort = toString nodes.unmanaged.services.anywhen.port;
    in
    ''
      machine.wait_for_unit("anywhen.service")
      unmanaged.wait_for_unit("anywhen.service")

      # systemd reports "active" before the listener binds. Poll until
      # the port answers — 60s headroom for qemu TCG fallback on hosts
      # without KVM (Python stdlib http.server is fast, but VM cold
      # start dominates).
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
      # /var/lib/anywhen; the operator-provisioned /srv/anywhen-state is
      # what the service writes into.
      unmanaged.fail("test -d /var/lib/anywhen")
      unmanaged.succeed("test -d /srv/anywhen-state")
      unmanaged.succeed("test -f /srv/anywhen-state/anywhen.db")
    '';
}
