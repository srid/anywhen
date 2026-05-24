// Adds tasks.completed_at — the ISO timestamp at which the row's status
// flipped to "done". Set inside the toggle transaction (todo→done sets,
// done→todo clears). The CHECK constraint enforces "status='done' ⟺
// completed_at present" at the SQLite layer so a future direct-edit path
// can't orphan the invariant. Legacy rows backfill to NULL — the staleness
// predicate treats NULL as "completion time unknown" and keeps them
// visible until the user re-toggles.

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
