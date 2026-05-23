# anywhen build derivation — produces a staged tree under
# $out/lib/anywhen ready to be exec'd by the wrappers in `default.nix`.
#
# Dep fetching: `bun2nix.fetchBunDeps` reads the committed `bun.nix` (CI's
# `bun-nix-fresh` recipe keeps it in sync with bun.lock) and builds a fake
# Bun cache via per-tarball FODs (hashes from the lockfile, no network in
# the build sandbox). `bun2nix.hook` installs that cache into $src via
# `bun install --ignore-scripts`.
#
# Client bundling: re-uses `packages/app/src/server/build.ts` — the same TS
# code path the dev server invokes when ANYWHEN_DIST_DIR is unset. One
# bundle pipeline; two callers.
{ stdenv, lib, bun2nix, anywhen-kolu-surface }:
let
  src = lib.fileset.toSource {
    root = ../../..;
    fileset = lib.fileset.unions [
      ../../../package.json
      ../../../bun.lock
      ../../../bunfig.toml
      ../../../tsconfig.base.json
      ../../../bun.nix
      ../../../packages/app
      # tests are in the workspace; `bun install` walks the lockfile's
      # workspaces section and would 404 on the missing `packages/tests`
      # without this. We don't run tests in this derivation, but the
      # workspace tree has to be complete for `bun install` to succeed.
      ../../../packages/tests
      # @kolu/surface hydration script — invoked from
      # postBunNodeModulesInstallPhase below.
      ../../../scripts
    ];
  };
in
stdenv.mkDerivation {
  pname = "anywhen-built";
  version = "0.1.0";
  inherit src;

  nativeBuildInputs = [ bun2nix.hook ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ../../../bun.nix;
  };

  # hoisted linker matches `bunfig.toml`: @kolu/surface (placed below) needs
  # to resolve its transitive deps (@orpc/*, solid-js, zod) from the
  # workspace-root node_modules, not from an isolated per-package tree.
  bunInstallFlags = [ "--linker=hoisted" ];

  # The fixupPhase walks node_modules and patches shebangs / ELF. For a Bun
  # app this is pure overhead — Bun runs the source directly, no shebangs
  # we care about, no native binaries.
  dontFixup = true;
  dontPatchShebangs = true;

  # @kolu/surface is NOT in bun.lock — it's a Nix-store source supplied by
  # the overlay (same hydration strategy as `shell.nix`'s shellHook and
  # the `just install` recipes). Drop the copy in *after* bun install
  # populates node_modules, otherwise bun install would either overwrite
  # our copy or refuse to proceed.
  postBunNodeModulesInstallPhase = ''
    sh scripts/hydrate-kolu-surface.sh ${anywhen-kolu-surface}
  '';

  # Skip the hook's default `bun build --compile` invocation — that flag
  # set targets single-binary executables, which doesn't fit anywhen
  # (server entry + dist tree + node_modules).
  dontUseBunBuild = true;

  buildPhase = ''
    runHook preBuild
    mkdir -p packages/app/dist
    bun packages/app/src/server/build.ts packages/app/dist
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/anywhen
    cp -r packages $out/lib/anywhen/
    cp -r node_modules $out/lib/anywhen/
    cp package.json bunfig.toml tsconfig.base.json $out/lib/anywhen/
    # Guard: the wrapper in default.nix hard-codes this entry point path.
    # Fail the build (not runtime) if it moves.
    test -f "$out/lib/anywhen/packages/app/src/server/index.ts" || {
      echo "installPhase: server entry point missing — update default.nix anywhenBin if the path changed"
      exit 1
    }
    runHook postInstall
  '';

  meta = {
    description = "anywhen — built source tree (server + bundled client + node_modules)";
    platforms = lib.platforms.unix;
  };
}
