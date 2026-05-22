# Expose @kolu/surface via a Nix-store path sourced from npins-pinned kolu.
# No vendoring — surface lives upstream; this derivation just narrows the
# kolu source to packages/surface so the dev shell can symlink only what
# anywhen actually consumes.
{ runCommand }:
let
  sources = import ../../../npins;
  koluSrc = sources.kolu;
in
runCommand "kolu-surface"
{
  meta = {
    description = "@kolu/surface source extracted from juspay/kolu";
    homepage = "https://github.com/juspay/kolu";
  };
} ''
  cp -r ${koluSrc}/packages/surface $out
''
