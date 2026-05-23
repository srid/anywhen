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
install:
    {{ nix_shell }} bun install
    {{ nix_shell }} sh -c 'mkdir -p node_modules/@kolu && rm -rf node_modules/@kolu/surface && cp -rL "$ANYWHEN_KOLU_SURFACE" node_modules/@kolu/surface && chmod -R u+w node_modules/@kolu/surface'

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

# Cucumber e2e tests (spawns server from source on an ephemeral port)
test: install
    cd packages/tests && \
      CUCUMBER_PARALLEL={{ cucumber_parallel }} {{ nix_shell_e2e }} \
        node --import tsx ../../node_modules/@cucumber/cucumber/bin/cucumber-js --profile ui

# Remove all gitignored files (node_modules, build artifacts, etc.)
clean:
    git clean -fdX
