// Initial — and currently only — schema. Earlier history (a binary status
// CHECK widened to ternary, then a separate add-column for completed_at)
// was collapsed once production was wiped and restored from backup; the
// rebuild required by the CHECK widening cascade-deleted child rows under
// `foreign_keys = ON` (see ../db.ts for the matching boundary fix). The
// invariants those CHECKs encoded now live in the Zod layer
// (`shared/schemas.ts` — `TaskStatusSchema` enum and the TaskSchema refine
// for `status='done' ⟹ completedAt !== null`), so future enum widenings
// are a one-file Zod edit with no migration at all.

import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("tasks")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("parent_id", "text", (c) => c.references("tasks.id").onDelete("cascade"))
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("position", "real", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addColumn("completed_at", "text")
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
