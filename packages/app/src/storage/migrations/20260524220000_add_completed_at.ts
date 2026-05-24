// Adds tasks.completed_at — the ISO timestamp at which the row's status
// flipped to "done". Set inside the toggle transaction (todo→done sets,
// done→todo clears). The CHECK constraint enforces the one-way invariant
// "status='todo' ⟹ completed_at IS NULL" at the SQLite layer — done rows
// with completed_at = NULL are deliberately allowed so legacy rows from
// before this column existed survive the migration, and the staleness
// predicate treats those NULL completion times as "unknown" (neither fresh
// nor stale; visible until the user re-toggles).

import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("tasks")
    .addColumn("completed_at", "text", (c) => c.check(sql`status = 'done' OR completed_at IS NULL`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("tasks").dropColumn("completed_at").execute();
}
