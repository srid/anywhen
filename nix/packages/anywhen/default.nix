# anywhen — production package. Ships the bun + SolidJS app as a single
# `bin/anywhen` wrapper that runs `bun packages/app/src/server/index.ts`
# against a frozen `node_modules` tree and a pre-built client `dist/`,
# all materialized inside the Nix store.
#
# Two derivations:
#
#   1. `nodeModules` — a fixed-output derivation that runs
#      `bun install --frozen-lockfile` against the workspace lockfiles.
#      The FOD captures the exact tree bun produces for a given (bun
#      version × bun.lock × workspace package.jsons) tuple; updating any
#      of those inputs invalidates `outputHash` and forces a refetch.
#
#   2. `anywhen` — non-FOD wrapper derivation. Hydrates node_modules
#      from (1), replaces `@kolu/surface` with the npins-pinned source
#      (same dance as shell.nix's shellHook), runs `bun build-client.ts`
#      to pre-bake the client bundle, then installs the source tree
#      under `$out/share/anywhen` and a `bin/anywhen` wrapper that
#      points the runtime at the pre-built dist via `ANYWHEN_DIST_DIR`.
#
# Mirrors kolu's packaging shape but uses bun's lockfile / node_modules
# directly rather than pnpm. The same FOD-based dance applies — see
# kolu's `pnpmDeps` for the pnpm equivalent.
{ stdenv
, lib
, bun
, cacert
, makeWrapper
, anywhen-kolu-surface
}:
let
  # Source filtered to what `bun install` and the build need: the
  # workspace's package.json/bun.lock files plus the packages/ tree.
  # Excluding the rest keeps the FOD's hash stable against unrelated
  # changes (CI workflows, README, NixOS module sources, …).
  src = lib.cleanSourceWith {
    src = ../../..;
    filter = path: type:
      let
        rel = lib.removePrefix (toString ../../.. + "/") (toString path);
      in
      rel == "package.json"
      || rel == "bun.lock"
      || rel == "bunfig.toml"
      || rel == "tsconfig.base.json"
      || rel == "packages"
      || lib.hasPrefix "packages/" rel;
  };

  nodeModules = stdenv.mkDerivation {
    pname = "anywhen-node-modules";
    version = "0";
    inherit src;

    nativeBuildInputs = [ bun cacert ];

    # Bun honors SSL_CERT_FILE for HTTPS to the npm registry; without it
    # the FOD fails inside the sandbox.
    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

    # Bun creates relative workspace symlinks inside node_modules
    # (`node_modules/anywhen-app -> ../packages/app`). They only resolve
    # in the final layout where `packages/` sits alongside `node_modules/`;
    # the FOD ships only `node_modules/`, so the symlinks dangle there
    # and nixpkgs' noBrokenSymlinks check would fail. Skip that check —
    # the symlinks are re-resolved in the anywhen derivation's installPhase
    # where the source tree is back next to them.
    dontCheckForBrokenSymlinks = true;

    # FODs must not reference other store paths in their output, so skip
    # the default nixpkgs phases that bake store paths in — patchShebangs
    # would rewrite `#!/usr/bin/env bash` headers (e.g. in playwright-core's
    # reinstall scripts) to absolute `/nix/store/.../bash` paths and the
    # hash check would fail.
    dontPatchShebangs = true;
    dontStrip = true;
    dontFixup = true;

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      # --ignore-scripts skips lifecycle hooks (postinstall etc.) — none
      # of anywhen's deps need them, and disabling keeps the FOD
      # deterministic against environment leakage.
      bun install --frozen-lockfile --ignore-scripts --no-progress
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r node_modules $out/
      runHook postInstall
    '';

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-vHk7BXPEHdG1nbuboKtWy+BMalGDv2XkaP+VE9z5RF0=";
  };
in
stdenv.mkDerivation {
  pname = "anywhen";
  version = "0";
  inherit src;

  nativeBuildInputs = [ bun makeWrapper ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    # Hydrate node_modules from the FOD, then overlay @kolu/surface
    # from the npins-pinned source — same shape as shell.nix's hook.
    # `cp -r` (not symlink) because TypeScript resolves transitive
    # imports from the *real* file location; a symlink target inside
    # /nix/store has no adjacent node_modules.
    cp -r ${nodeModules}/node_modules ./node_modules
    chmod -R u+w ./node_modules
    rm -rf ./node_modules/@kolu/surface
    mkdir -p ./node_modules/@kolu
    cp -rL ${anywhen-kolu-surface} ./node_modules/@kolu/surface
    chmod -R u+w ./node_modules/@kolu/surface

    # Pre-build the client bundle so the server never tries to write
    # into the read-only Nix store at runtime. The server skips its own
    # `Bun.build` when ANYWHEN_DIST_DIR is set (which the wrapper does).
    mkdir -p packages/app/dist
    bun packages/app/src/build-client.ts $PWD/packages/app/dist

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/anywhen
    cp -r packages $out/share/anywhen/packages
    cp -r node_modules $out/share/anywhen/node_modules
    cp package.json bun.lock bunfig.toml tsconfig.base.json $out/share/anywhen/

    # bun resolves imports via Node-style walk-up from the script path,
    # so $out/share/anywhen/node_modules covers the workspace. Pointing
    # ANYWHEN_DIST_DIR at the pre-built bundle tells the server to skip
    # its boot-time Bun.build (see packages/app/src/server/index.ts).
    makeWrapper ${lib.getExe bun} $out/bin/anywhen \
      --add-flags "$out/share/anywhen/packages/app/src/server/index.ts" \
      --set-default ANYWHEN_DIST_DIR "$out/share/anywhen/packages/app/dist"

    runHook postInstall
  '';

  meta = {
    description = "anywhen — personal task manager";
    mainProgram = "anywhen";
  };
}
