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
        Directory holding anywhen.db (the SQLite store). Created on
        first start by systemd's StateDirectory= with mode 0700 owned
        by the service user.
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
  };

  config = lib.mkIf cfg.enable {
    users.users = lib.mkIf (cfg.user == "anywhen") {
      anywhen = {
        isSystemUser = true;
        group = cfg.group;
        description = "anywhen service user";
      };
    };

    users.groups = lib.mkIf (cfg.group == "anywhen") {
      anywhen = { };
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
        # When stateDir is the default /var/lib/anywhen, systemd creates
        # and chowns it automatically. For a custom absolute path, the
        # operator is responsible for the directory's existence and
        # permissions — StateDirectory= can't take an absolute path.
        StateDirectory = lib.mkIf (cfg.stateDir == "/var/lib/anywhen") "anywhen";
        StateDirectoryMode = "0700";
      };
    };
  };
}
