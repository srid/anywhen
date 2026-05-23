# anywhen

A personal task manager. One search box: filter the tree, or add to it.

> **PR 1 status**: scaffold + add a task (`+ title` in the search box) + view
> the tree + toggle done + delete (with cascade to descendants). Search,
> filter atoms, tags, due dates, body, blocked-by, and the detail panel land
> in later PRs.

## Stack

| Concern    | Tool                                                                                |
|------------|-------------------------------------------------------------------------------------|
| Runtime    | [Bun 1.2+](https://bun.sh) — `Bun.serve` with HTML imports bundles the SolidJS UI   |
| UI         | [SolidJS](https://solidjs.com) via `bun-plugin-solid`                               |
| Wire       | [`@kolu/surface`](https://github.com/juspay/kolu/tree/master/packages/surface) over [oRPC](https://orpc.unnoq.com) (HTTP procedures in PR 1; Collection delta push in PR 2) |
| Store      | `bun:sqlite`                                                                        |
| Schemas    | [Zod 4](https://zod.dev)                                                            |
| Lint / fmt | [Biome](https://biomejs.dev)                                                        |
| E2E tests  | [Cucumber 12](https://cucumber.io) + [Playwright](https://playwright.dev) — mirrors `kolu/packages/tests/` |
| Nix        | Zero flake inputs, `npins`-pinned nixpkgs + kolu — see [kolu's pattern](https://github.com/juspay/kolu/blob/master/flake.nix) |
| CI         | [`juspay/justci`](https://github.com/juspay/justci) — `nix run github:juspay/justci` |

## Getting started

```sh
# Enter the dev shell (direnv picks this up automatically)
nix develop

# Install bun deps + symlink @kolu/surface from the nix store
just install

# Run the app (http://localhost:7700)
just dev
```

The dev shell exports `ANYWHEN_KOLU_SURFACE` (a Nix-store path holding
[`@kolu/surface`](https://github.com/juspay/kolu/tree/master/packages/surface)'s
source). `just install` copies that into `node_modules/@kolu/surface` so
TypeScript and Bun can resolve surface's own deps (`@orpc/*`, `solid-js`,
`zod`) from anywhen's hoisted `node_modules`. Updating kolu's pin in
`npins/sources.json` is the only knob to pull a new surface.

State lives at `$ANYWHEN_STATE_DIR/anywhen.db` (a SQLite database). The dev
shell defaults `ANYWHEN_STATE_DIR` to `./state` (gitignored), so `just dev`
runs without extra setup. Cucumber overrides with a per-run `mktemp` dir
(see `packages/tests/support/hooks.ts`) so production and test paths stay
distinct.

## Tests

```sh
nix develop .#e2e -c just test
```

The `.#e2e` shell adds Playwright browsers. Each cucumber scenario gets an
ephemeral port, a fresh temp state dir, and a fresh browser context.

## Project layout

```
flake.nix · default.nix · shell.nix     # kolu-style: zero flake inputs
nix/
  nixpkgs.nix                           # npins-pinned, applies the overlay
  overlay.nix                           # adds anywhen-kolu-surface to pkgs
  env.nix                               # ANYWHEN_* shared env vars
  packages/surface/default.nix          # extracts packages/surface from kolu
  nixos/module.nix                      # services.anywhen NixOS module
  nixos/example/flake.nix               # consumer example + VM test (separate flake)
npins/sources.json                      # nixpkgs + kolu (juspay/kolu master)
bunfig.toml                             # bun workspace install config (hoisted)
biome.json · tsconfig.base.json
justfile · ci/mod.just                  # justci-compatible pipeline
.github/workflows/ci.yml                # delegates to github:juspay/justci
packages/
  app/                                  # the anywhen application
    src/
      server/                           # Bun.serve + Bun.build + oRPC HTTP handler
      storage/                          # bun:sqlite schema + CRUD
      client/                           # SolidJS UI (plain CSS, no Tailwind yet)
      shared/                           # domain types + Zod schemas + surface spec
  tests/                                # cucumber + playwright (e2e)
```

The SolidJS JSX transform (`babel-preset-solid`) runs as an in-tree
`BunPlugin` registered against `Bun.build` inside `server/index.ts` —
`Bun.serve`'s HTML-import bundler does not honor preload-registered
plugins as of Bun 1.3.10, so the server builds the client at startup
into `packages/app/dist/` and serves that as static files (plus the
`/rpc/*` oRPC endpoints).

## NixOS module

`flake.nixosModules.default` exposes `services.anywhen` — a system-level
systemd unit that runs the server under a dedicated `anywhen` user with
state at `/var/lib/anywhen`. Shape mirrors
[kolu's home-manager module](https://github.com/juspay/kolu/blob/master/nix/home/module.nix);
home-manager is intentionally not used (anywhen is a one-daemon-per-box
deployment, not a per-user agent).

```nix
{
  imports = [ inputs.anywhen.nixosModules.default ];
  services.anywhen = {
    enable = true;
    package = pkgs.anywhen;   # added in a follow-up PR
    port = 7700;              # default
  };
}
```

A NixOS VM test lives in `nix/nixos/example/flake.nix` — a separate
flake that imports the top-level `anywhen` flake as an input, mirroring
[kolu's home-manager example](https://github.com/juspay/kolu/blob/master/nix/home/example/flake.nix).
Keeping the test out of the top-level flake preserves anywhen's
zero-input convention; only the example flake carries the
`nixpkgs`/`anywhen` inputs needed for `testers.nixosTest`. CI runs it
via the `nixos-test` recipe in `ci/mod.just`, which builds the example
with `--override-input flake/anywhen .` so the test runs against the
local checkout. The test currently wires a stub package; the production
bun-bundle derivation lands alongside the module's
`services.anywhen.package` default in the follow-up package PR.

## CI

`.github/workflows/ci.yml` invokes `nix run github:juspay/justci`, which
discovers the `[metadata("ci")]` recipe in `ci/mod.just` and fans out the
nix build / typecheck / biome / format / e2e nodes across configured
platforms.

## Acknowledgements

anywhen leans on [`@kolu/surface`](https://github.com/juspay/kolu/tree/master/packages/surface)
from [juspay/kolu](https://github.com/juspay/kolu) — the typed reactive
wire framework (Cell / Collection / Stream / Event over oRPC) that the app
uses for its server↔client procedures. The surface package isn't vendored:
it's pinned via `npins` and consumed through the Nix overlay at
`nix/packages/surface/`, so updating kolu's pin pulls in the new surface
code with no source-tree churn here. The cucumber harness shape under
`packages/tests/` (cucumber.js profiles, World class, `BeforeAll` server
spawn, ephemeral ports via `get-port`) also follows kolu's patterns
verbatim.

## License

TBD.
