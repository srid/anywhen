#!/usr/bin/env bash
# Materialize the @kolu/surface package source from a Nix-store path
# into a node_modules tree. Called from three execution contexts that
# don't share a runtime — the dev shell's shellHook (shell.nix), the
# `install` recipes in justfile and ci/mod.just, and the anywhen
# package's buildPhase (nix/packages/anywhen/default.nix). Encapsulating
# the four-step sequence here keeps those sites from drifting.
#
# `cp -rL` (dereference symlinks, not preserve them) is the load-bearing
# choice — TypeScript resolves transitive imports from the *real* file
# location, so a symlink target sitting in /nix/store has no adjacent
# node_modules and @orpc/* / zod / solid-js can't resolve. Copying the
# tree lets resolution walk up to the workspace's hoisted node_modules
# where those packages actually live.
#
# Usage: hydrate-surface.sh <surface-store-path> <node_modules-dir>
set -euo pipefail
src="${1:?usage: hydrate-surface.sh <surface-store-path> <node_modules-dir>}"
nm="${2:?usage: hydrate-surface.sh <surface-store-path> <node_modules-dir>}"
mkdir -p "$nm/@kolu"
rm -rf "$nm/@kolu/surface"
cp -rL "$src" "$nm/@kolu/surface"
chmod -R u+w "$nm/@kolu/surface"
