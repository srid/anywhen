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

## Invariants the convention can't enforce

Some schema facts are mirrored between a migration and an app-level Zod
schema — most notably enum CHECK constraints, e.g. `status IN ('todo',
'doing', 'done')` mirrors `TaskStatusSchema` in `src/shared/schemas.ts`.
Because migrations can't import `../../shared/`, the two declarations are
kept in lockstep by convention: when an enum widens or narrows, a new
migration mirrors the change, and the migration's body comments the
cross-reference. The matching SQLite CHECK is what catches a non-Zod
writer (a future CLI, a manual `sqlite3` poke) from inserting a value the
domain doesn't model.

## Why the convention

Kysely's `Migrator` hands every migration the full `Kysely<any>` instance,
which is more power than schema evolution needs. Restricting bodies to the
list above keeps migrations reviewable as DDL (the actual volatility) rather
than as arbitrary procedural code.
