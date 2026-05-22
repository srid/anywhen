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
      : "''${PORT:=7700}"
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

  nodes.machine = { ... }: {
    imports = [ ../../nix/nixos/module.nix ];

    services.anywhen = {
      enable = true;
      package = stubPackage;
    };
  };

  # Pull the port from the evaluated module config so the curl URL
  # tracks `services.anywhen.port` automatically — changing the option's
  # default (or wiring a different port in a future test variant)
  # propagates without two values getting out of sync.
  testScript = { nodes, ... }:
    let
      port = toString nodes.machine.services.anywhen.port;
    in
    ''
      machine.wait_for_unit("anywhen.service")

      # systemd reports "active" before the listener binds. Poll until
      # the port answers — 60s headroom for qemu TCG fallback on hosts
      # without KVM (Python stdlib http.server is fast, but VM cold
      # start dominates).
      machine.wait_until_succeeds(
          "curl --fail --silent http://127.0.0.1:${port}/api/health",
          timeout=60,
      )

      # StateDirectory= must have created /var/lib/anywhen with mode 0700
      # owned by the anywhen user. Verify both — a regression that drops
      # the dedicated user would chown to root.
      machine.succeed("test -d /var/lib/anywhen")
      machine.succeed("[ \"$(stat -c %U /var/lib/anywhen)\" = anywhen ]")
      machine.succeed("[ \"$(stat -c %a /var/lib/anywhen)\" = 700 ]")
    '';
}
