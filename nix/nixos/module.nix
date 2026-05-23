{ config, lib, pkgs, ... }:
let
  cfg = config.services.anywhen;
in
{
  options.services.anywhen = {
    enable = lib.mkEnableOption "anywhen task manager";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The anywhen package to use.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address to listen on.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 7700;
      description = "Port to listen on.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.anywhen = {
      description = "anywhen task manager";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        HOST = cfg.host;
        PORT = toString cfg.port;
        ANYWHEN_STATE_DIR = "/var/lib/anywhen";
      };
      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        DynamicUser = true;
        StateDirectory = "anywhen";
        Restart = "on-failure";
      };
    };
  };
}
