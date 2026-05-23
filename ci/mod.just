# anywhen CI pipeline — consumed by github:juspay/justci.
#
# The runner discovers the recipe tagged [metadata("ci")] (exactly one across
# this justfile and its submodules), expands its reachable dependency subgraph,
# and fans every (recipe × platform) pair out into a process-compose node.

set working-directory := '..'

# Re-enter nix devShell when the runner ssh's into a remote that doesn't have
# the project's dev tools on PATH. Skipped when already inside the shell.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }
nix_shell_e2e := if env('PLAYWRIGHT_BROWSERS_PATH', '') != '' { '' } else { 'nix develop .#e2e --accept-flake-config -c' }

# Pipeline root: every recipe listed here becomes a (recipe × platform) node.
[linux]
[macos]
[parallel]
[metadata("ci")]
default: nix typecheck biome fmt-check e2e

# Single per-platform `bun install`. Funnel every bun consumer through this
# node so concurrent `bun install` runs against the same workspace don't race.
install:
    {{ nix_shell }} bun install
    {{ nix_shell }} sh -c 'mkdir -p node_modules/@kolu && rm -rf node_modules/@kolu/surface && cp -rL "$ANYWHEN_KOLU_SURFACE" node_modules/@kolu/surface && chmod -R u+w node_modules/@kolu/surface'

# Build all flake outputs via devour-flake.
nix:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

# TypeScript type checking across the workspace
typecheck: install
    {{ nix_shell }} bun --cwd packages/app typecheck
    {{ nix_shell }} bun --cwd packages/tests typecheck

# Biome lint check
biome: install
    {{ nix_shell }} biome lint .

# Check formatting without modifying (Biome + nixpkgs-fmt). nixpkgs-fmt
# accepts a directory and recurses, so `.` covers every *.nix at any depth.
fmt-check: install
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check .'

# Cucumber e2e — runs the full pipeline (server spawn, browser, scenarios).
e2e: install
    {{ nix_shell }} just test
