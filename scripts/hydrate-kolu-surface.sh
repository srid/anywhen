#!/usr/bin/env sh
# Materialize the @kolu/surface source into ./node_modules/@kolu/surface.
#
# Usage: hydrate-kolu-surface.sh <source-path>
#
# Three callers, one strategy:
#   shell.nix shellHook                 — passes "$ANYWHEN_KOLU_SURFACE"
#   {justfile,ci/mod.just} install      — passes "$ANYWHEN_KOLU_SURFACE"
#   nix/packages/anywhen postBunNodeModulesInstallPhase
#                                       — passes "${anywhen-kolu-surface}"
#
# cp -rL (not symlink) because TypeScript resolves transitive imports from
# the *real* file location: a symlink whose target sits in /nix/store has
# no adjacent node_modules, so @orpc/contract / zod / solid-js can't be
# found from surface's source. Copying lets resolution walk up to the
# consumer's own hoisted node_modules where those packages live.
set -eu
src="${1:?usage: hydrate-kolu-surface.sh <source-path>}"
mkdir -p node_modules/@kolu
rm -rf node_modules/@kolu/surface
cp -rL "$src" node_modules/@kolu/surface
chmod -R u+w node_modules/@kolu/surface
