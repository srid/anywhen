# Migrations

Each `.ts` file in this directory is one migration. They run on app start via
Kysely's `Migrator` (see `../db.ts`) and are also discoverable by the
scaffolder at `scripts/new-migration.ts` (`just new-migration <name>`).

## File shape

```ts
import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> { /* ... */ }
export async function down(db: Kysely<unknown>): Promise<void> { /* ... */ }
```

Both functions are required. `down` is currently not called at runtime — we
have no rollback flow — but Kysely still requires it; keep it accurate so a
manual rollback against a dev DB works.

## Naming

`YYYYMMDDhhmmss_short_name.ts`. The timestamp is the sort key
(`FileMigrationProvider` reads the directory and sorts lexicographically),
so any monotonic prefix works, but the scaffolder uses UTC `YYYYMMDDhhmmss`.

## What migration bodies MAY do

- Any `db.schema.*` call: `createTable`, `alterTable`, `createIndex`,
  `dropTable`, `renameColumn`, etc.
- Bounded backfill via `db.updateTable`, `db.insertInto`, `db.deleteFrom`
  when a DDL change requires populating new columns or splitting rows.
- Raw `` sql`...` `` template for DDL Kysely doesn't model ergonomically
  (partial indexes, expression indexes, FK options not exposed).

## What migration bodies MUST NOT do

- `fetch()` or any network I/O.
- Reading project files outside this directory.
- Importing application code (`../tasks`, `../../shared/schemas`, anything
  beyond `kysely`).
- Branching on external state — env vars beyond what's passed in, wall-clock
  time, random values.

If a one-time data fix needs more than the MAY list, write a one-shot
script under `packages/app/scripts/` and run it explicitly, separately
from the app's startup migration step.

## Where domain invariants live

Domain invariants — the `status` enum's allowed values, the
`status='done' ⟺ completedAt !== null` relationship, anything else the
type system shouldn't have to argue about — live in `src/shared/schemas.ts`
via Zod (`TaskStatusSchema`, the `TaskSchema` refine). Migrations declare
columns and indexes only, not CHECK constraints that mirror the same
facts.

This is a deliberate departure from the obvious "encode it twice for
defense in depth" reflex. The history: a `status` CHECK widening required
a SQLite table-rebuild (no in-place `ALTER` for CHECK), and the rebuild
under `foreign_keys = ON` cascade-deleted every non-root row through the
freshly-created `parent_id` FK — a real data-loss event. Putting the
invariant in only the Zod layer means a future widen is a one-file edit
with zero migration risk. The trade-off is that a direct `sqlite3` poke
can now write a status value Zod wouldn't accept; that risk is
symmetric with every other field (titles, timestamps, positions) and
narrower than what the rebuild cost.

The matching boundary fix lives in `../db.ts`: the migrator runs with
`PRAGMA foreign_keys = OFF` and a `foreign_key_check` after, so future
table-rebuild migrations are safe by construction even if they reach for
the rebuild idiom for an unrelated reason.

## Why the convention

Kysely's `Migrator` hands every migration the full `Kysely<any>` instance,
which is more power than schema evolution needs. Restricting bodies to the
list above keeps migrations reviewable as DDL (the actual volatility) rather
than as arbitrary procedural code.
