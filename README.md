# anywhen

A personal task manager. One search box: filter the tree, or add to it.

> **Status**: scaffold + add a task (press `↵` in the search box, or tap
> the Add button) + view the tree + toggle done + delete (with cascade
> to descendants) + reorder via pointer drag — works for mouse, pen, and
> touch (long-press anywhere on a row, or press the grip handle on the
> left edge for an instant drag) — top edge = drop before, bottom
> edge = drop after, middle = nest as child + vim-friendly keyboard
> navigation (`j`/`k` moves selection, `l`/`h` indents/outdents, `⇧J`/`⇧K`
> reorders siblings, `x` deletes the focused row, `Space` toggles done,
> `/` focuses the search box) + live filter (type a query — matches highlight in their
> own row, ancestors stay visible but dimmed so the path to a match is
> intact) + mobile-friendly layout (responsive media queries, touch-sized
> tap targets, always-visible row actions and grip handles on coarse
> pointers) + PWA
> (installable from the browser, with a service worker that caches the
> app shell and serves `index.html` from cache when offline) + runtime
> info footer (GitHub source link, server hostname, SQLite path — so a
> user opening the app can see where their data lives at a glance).
> Filter atoms, tags, due dates, body, blocked-by, and the detail panel
> land in later PRs.

## Stack

| Concern    | Tool                                                                                |
|------------|-------------------------------------------------------------------------------------|
| Runtime    | [Bun 1.2+](https://bun.sh) — `Bun.serve` with HTML imports bundles the SolidJS UI   |
| UI         | [SolidJS](https://solidjs.com) via `bun-plugin-solid`                               |
| Wire       | [`@kolu/surface`](https://github.com/juspay/kolu/tree/master/packages/surface) over [oRPC](https://orpc.unnoq.com) — tasks are a `Collection` (snapshot+deltas over WebSocket at `/rpc/ws`); imperative verbs (`add`/`toggle`/`move`/`remove`) ride HTTP under `/rpc/*` |
| Store      | `bun:sqlite` via [Kysely](https://kysely.dev) (typed query builder + auto-migrations) |
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

# Run the app (http://localhost:7700) with auto-reload
just dev
```

Or run the built artifact directly via Nix — no dev shell, no `bun install`, no source tree required:

```sh
nix run github:srid/anywhen           # serves on :7700, state at $XDG_DATA_HOME/anywhen
nix run github:srid/anywhen -- --help # forwards args to the underlying bun process
```

`nix run` builds a wrapped binary that bakes the client `dist/`, server source, and `node_modules` into a Nix-store path; the wrapper sets `ANYWHEN_DIST_DIR` so the server skips its dev-time `Bun.build`. Dep fetching is fully offline via [`bun2nix`](https://github.com/juspay/bun2nix) — every npm tarball is its own fixed-output derivation with hashes drawn from `bun.lock`, so a clean build sandbox never touches the registry.

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

`just dev` boots with sample tasks (a small nested tree, a couple marked
done) so a first run isn't an empty screen. The seed is gated by
`ANYWHEN_SEED_SAMPLE_DATA=1` (set by the `dev` recipe; not set by `just
test`) and is a no-op once any tasks exist — re-running `just dev`
against a populated DB never clobbers user data. To start blank, delete
`./state/anywhen.db` and unset the env var, or just clear the tasks via
the UI.

Schema evolution: every change ships as a new `.ts` file under
`packages/app/src/storage/migrations/`. `openDb` applies pending migrations
on app start via Kysely's `Migrator`, so a stale DB upgrades itself the next
time the app boots — no manual migration step. Scaffold a new migration via
`just new-migration <short_name>`; the file's body is restricted to
`db.schema.*` + bounded backfill (see `migrations/README.md`).

## Tests

```sh
nix develop .#e2e -c just test
```

The `.#e2e` shell adds Playwright browsers and exposes `$ANYWHEN_TEST_BIN`,
the wrapped Nix-built binary the cucumber harness spawns. Tests exercise
the same artifact `nix run` would — not `bun src/server/index.ts` — so a
change to the build derivation, the client bundle, or the wrapper is
caught end-to-end. Each scenario gets an ephemeral port, a fresh temp
state dir, and a fresh browser context.

## Project layout

```
flake.nix · default.nix · shell.nix     # one flake input (bun2nix); see comment in flake.nix
nix/
  nixpkgs.nix                           # npins-pinned, applies the overlay
  overlay.nix                           # adds anywhen-kolu-surface to pkgs
  env.nix                               # canonical anywhen env-var surface
  packages/surface/default.nix          # extracts packages/surface from kolu
  packages/anywhen/default.nix          # build derivation (consumes bun2nix.hook + fetchBunDeps)
npins/sources.json                      # nixpkgs + kolu (juspay/kolu master)
bunfig.toml                             # bun workspace install config (hoisted)
bun.nix                                 # autogenerated from bun.lock by `just regenerate-bun-nix`
biome.json · tsconfig.base.json
justfile · ci/mod.just                  # justci-compatible pipeline
.github/workflows/ci.yml                # delegates to github:juspay/justci
packages/
  app/                                  # the anywhen application
    src/
      server/                           # Bun.serve + oRPC HTTP handler; build.ts produces dist/
      storage/                          # Kysely + migrations + per-table stores
      client/                           # SolidJS UI (plain CSS, no Tailwind yet)
      shared/                           # domain types + Zod schemas + surface spec
  tests/                                # cucumber + playwright (e2e against $ANYWHEN_TEST_BIN)
```

The SolidJS JSX transform (`babel-preset-solid`) runs as an in-tree
`BunPlugin` registered against `Bun.build` inside `server/build.ts` —
`Bun.serve`'s HTML-import bundler does not honor preload-registered
plugins as of Bun 1.3.10, so the build is driven explicitly. Two callers
share the same code path:

- **Dev** (`just dev`): `server/index.ts` invokes `buildClient(distDir)`
  at startup, writing into `packages/app/dist/`.
- **Production** (`nix run` / e2e): the build derivation's `buildPhase`
  invokes `bun packages/app/src/server/build.ts <dist>`, so the
  client is bundled inside `/nix/store`. The wrapper points the server
  at it via `ANYWHEN_DIST_DIR` and the runtime `buildClient` call is
  skipped (`resolveDistMode()` in `server/index.ts`).

## PWA

The client ships as an installable Progressive Web App. `client/index.html`
links a web manifest (`manifest.webmanifest`) and theme color, the manifest
references an SVG app icon, and `register-sw.ts` registers
`/service-worker.js` after the app mounts. The service worker precaches the
app shell (`/`, `/index.html`, manifest, icon), runtime-caches successful
same-origin GETs, and falls back to a cached `/index.html` for navigations
when the network is offline. RPC traffic (`/rpc/*`, `/api/*`) is never
cached — the wire stays online-only by design.

The manifest, icons, and service worker live alongside the rest of
`client/` and are copied verbatim into `dist/` after `Bun.build` (they
don't belong in the bundler's module graph: the SW must live at a fixed
scope-root URL, and the manifest references icons by stable path). Static
serving sets `application/manifest+json` for the manifest and
`Service-Worker-Allowed: /` for the SW.

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
