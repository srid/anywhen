# Use git+file:// (default) instead of path: — path: disables the eval cache
# and re-copies/re-evaluates on every invocation. Caveat: new .nix files must
# be `git add`ed before nix develop sees them.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop ' + justfile_directory() + ' --accept-flake-config -c' }
# E2e shell adds Playwright browsers; the default shell omits them for cold-
# start speed, so `just test` must enter .#e2e even if already inside .#default.
nix_shell_e2e := if env('PLAYWRIGHT_BROWSERS_PATH', '') != '' { '' } else { 'nix develop ' + justfile_directory() + '#e2e --accept-flake-config -c' }

cucumber_parallel := env('CUCUMBER_PARALLEL', '1')

mod ci 'ci/mod.just'

# List available recipes
default:
    @just --list

# Install dependencies (bun) and re-link @kolu/surface from the nix store
# via the shared script (see nix/scripts/hydrate-surface.sh).
install:
    {{ nix_shell }} bun install
    {{ nix_shell }} bash nix/scripts/hydrate-surface.sh "$ANYWHEN_KOLU_SURFACE" node_modules

# Run the app with auto-reload
dev: install
    {{ nix_shell }} bun --cwd packages/app dev

# TypeScript type checking across the workspace
typecheck: install
    {{ nix_shell }} bun --cwd packages/app typecheck
    {{ nix_shell }} bun --cwd packages/tests typecheck

# Biome lint + format check
lint: install
    {{ nix_shell }} biome lint .

# Format all files in-place (Biome + nixpkgs-fmt). nixpkgs-fmt accepts a
# directory argument and recurses, so passing `.` covers every `*.nix` at
# any depth — the previous `*.nix nix/**/*.nix` glob silently dropped files
# under `nix/packages/` because POSIX sh doesn't expand `**`.
fmt: install
    {{ nix_shell }} sh -c 'biome format --write . && nixpkgs-fmt .'

# Check formatting without modifying (used by CI)
fmt-check: install
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check .'

# Scaffold a new Kysely migration: just new-migration <short_name>
new-migration name: install
    {{ nix_shell }} bun packages/app/scripts/new-migration.ts {{ name }}

# Cucumber e2e tests — builds the Nix `anywhen` package and points the
# cucumber hook at its `bin/anywhen` wrapper, so each scenario runs
# against the production closure (pre-built client `dist/`, frozen
# `node_modules`) rather than `bun src/server/index.ts` from the dev tree.
test: install
    ANYWHEN_BIN=$({{ nix_shell }} nix build .#anywhen --no-link --print-out-paths --accept-flake-config)/bin/anywhen && \
    cd packages/tests && \
      ANYWHEN_BIN=$ANYWHEN_BIN CUCUMBER_PARALLEL={{ cucumber_parallel }} {{ nix_shell_e2e }} \
        node --import tsx ../../node_modules/@cucumber/cucumber/bin/cucumber-js --profile ui

# Remove all gitignored files (node_modules, build artifacts, etc.)
clean:
    git clean -fdX
