// Initial schema — what was previously hand-applied via schema.sql. Going
// forward, each schema change is a new migration in this directory; runtime
// applies pending ones automatically via the Migrator in ../db.ts. See
// ./README.md for the convention restricting what migration bodies may do.

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("tasks")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("parent_id", "text", (c) => c.references("tasks.id").onDelete("cascade"))
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().check(sql`status IN ('todo', 'done')`))
    // REAL position with gap allocation (initial 100, 200, 300…) — sibling
    // reorder is a one-row update via float midpoint between neighbours.
    .addColumn("position", "real", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("tasks_parent_idx")
    .on("tasks")
    .columns(["parent_id", "position"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("tasks").execute();
}
