// See ../README.md for the migration convention — db.schema.* + bounded
// backfill only; no network, no app imports, no external state.
//
// SQLite cannot ALTER a CHECK constraint in place, so the standard
// table-rebuild pattern applies: build a new table with the widened
// CHECK, copy every row over verbatim, drop the old table, rename, and
// recreate the (parent_id, position) index. The schema is otherwise
// unchanged — only the CHECK clause widens to admit 'doing'.
//
// INVARIANT: the CHECK values below MUST match `TaskStatusSchema.options`
// in src/shared/schemas.ts. The migrations convention forbids importing
// app code (the values are pinned at migration-author time), so the two
// declarations live in lockstep by convention rather than derivation.
// Adding a new status value requires (a) widening the Zod enum AND
// (b) a fresh widening migration that mirrors this file's shape.

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
      position REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `.execute(db);

  await sql`
    INSERT INTO tasks_new (id, parent_id, title, status, position, created_at, updated_at)
    SELECT id, parent_id, title, status, position, created_at, updated_at FROM tasks
  `.execute(db);

  await sql`DROP TABLE tasks`.execute(db);
  await sql`ALTER TABLE tasks_new RENAME TO tasks`.execute(db);

  await db.schema
    .createIndex("tasks_parent_idx")
    .on("tasks")
    .columns(["parent_id", "position"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Reverse the widening. Any rows currently in 'doing' would violate the
  // narrower CHECK, so coerce them back to 'todo' before the rebuild — a
  // doing task downgrading to a pre-doing schema reads as "not yet done"
  // (the previous meaning of "not done"), which is the safest collapse.
  await sql`UPDATE tasks SET status = 'todo' WHERE status = 'doing'`.execute(db);

  await sql`
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('todo', 'done')),
      position REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `.execute(db);

  await sql`
    INSERT INTO tasks_new (id, parent_id, title, status, position, created_at, updated_at)
    SELECT id, parent_id, title, status, position, created_at, updated_at FROM tasks
  `.execute(db);

  await sql`DROP TABLE tasks`.execute(db);
  await sql`ALTER TABLE tasks_new RENAME TO tasks`.execute(db);

  await db.schema
    .createIndex("tasks_parent_idx")
    .on("tasks")
    .columns(["parent_id", "position"])
    .execute();
}
