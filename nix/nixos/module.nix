# NixOS module — runs the anywhen server as a system-level systemd unit.
#
# Mirrors juspay/kolu's home-manager module shape (services.kolu with an
# `enable` + caller-supplied `package`), trimmed to the system-level
# NixOS path: no home-manager, no user-level systemd. anywhen is a
# single-user app, but the deployment surface is "one daemon on a box"
# (Pi, NAS, VPS), so a system service with a dedicated `anywhen` user
# fits cleanly.
#
# `package` is intentionally required (no default). The production
# package derivation is a separate PR — see README "NixOS module" —
# and consumers wire it in via `services.anywhen.package = pkgs.anywhen`.
# Until that lands, the only in-tree consumer is the VM test in
# nix/nixos/test.nix, which provides a stub package to exercise the
# module's systemd wiring end-to-end.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.anywhen;
in
{
  options.services.anywhen = {
    enable = lib.mkEnableOption "anywhen personal task manager";

    package = lib.mkOption {
      type = lib.types.package;
      description = ''
        The anywhen package to run. Must expose `bin/anywhen` (set via
        `meta.mainProgram`) that reads PORT and ANYWHEN_STATE_DIR from
        the environment.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 7700;
      description = "Port the HTTP server listens on (binds 0.0.0.0).";
    };

    stateDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/anywhen";
      description = ''
        Directory holding anywhen.db (the SQLite store). When
        `manageStateDir` is true (default), this must be
        `/var/lib/anywhen` because systemd's StateDirectory= forces
        that path. Set `manageStateDir = false` to point this at any
        absolute path the operator pre-creates and chowns.
      '';
    };

    manageStateDir = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether this module asks systemd to create and chown the state
        directory via StateDirectory=. With this enabled, `stateDir`
        is constrained to `/var/lib/anywhen`. Disable to manage the
        directory out-of-band (custom mount, ZFS dataset, etc.).
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "anywhen";
      description = "User the service runs as.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "anywhen";
      description = "Group the service runs as.";
    };

    createUser = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether this module declares `users.users.''${cfg.user}` and
        `users.groups.''${cfg.group}`. Disable when pointing `user`
        and `group` at identities provisioned by another module (a
        shared "services" account, an LDAP-backed user, etc.) to keep
        this module from racing with that declaration.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        # Systemd's StateDirectory= takes a name relative to /var/lib/,
        # not an absolute path. Catching this at eval time keeps the
        # failure visible at nixos-rebuild rather than at first start
        # with an opaque systemd error.
        assertion = !cfg.manageStateDir || cfg.stateDir == "/var/lib/anywhen";
        message = "services.anywhen.stateDir must be \"/var/lib/anywhen\" when manageStateDir is true; set manageStateDir = false to point stateDir elsewhere.";
      }
    ];

    users.users = lib.mkIf cfg.createUser {
      ${cfg.user} = {
        isSystemUser = true;
        group = cfg.group;
        description = "anywhen service user";
      };
    };

    users.groups = lib.mkIf cfg.createUser {
      ${cfg.group} = { };
    };

    systemd.services.anywhen = {
      description = "anywhen personal task manager";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        PORT = toString cfg.port;
        ANYWHEN_STATE_DIR = cfg.stateDir;
      };

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 2;
        User = cfg.user;
        Group = cfg.group;
        # `manageStateDir = true` (the default) asks systemd to create
        # and chown /var/lib/anywhen with mode 0700. Disabling the flag
        # leaves directory ownership and permissions to the operator;
        # the assertion above enforces that stateDir is the canonical
        # path whenever this branch is active.
      } // lib.optionalAttrs cfg.manageStateDir {
        StateDirectory = "anywhen";
        StateDirectoryMode = "0700";
      };
    };
  };
}
