// Migration smoke test: a fresh state dir runs the init migration; a
// second open against the same dir is idempotent. This is the cheap
// guard against migration-runner regressions (bad DDL, ordering bugs,
// FileMigrationProvider config drift) that the e2e suite would only
// surface as an unrelated boot failure.

import { expect, onTestFinished, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { openDb } from "./db";

const freshStateDir = () => {
  const d = mkdtempSync(join(tmpdir(), "anywhen-db-test-"));
  onTestFinished(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

test("openDb creates the tasks table on a fresh state dir", async () => {
  const { db } = await openDb(freshStateDir());
  onTestFinished(() => db.destroy());
  // Selecting from the table proves it exists and has the expected shape.
  const rows = await db.selectFrom("tasks").selectAll().execute();
  expect(rows).toEqual([]);
});

test("openDb is idempotent — re-opening the same DB applies no migrations", async () => {
  const dir = freshStateDir();
  const { db: first } = await openDb(dir);
  await first
    .insertInto("tasks")
    .values({
      id: "t1",
      parent_id: null,
      title: "carry-over",
      status: "todo",
      position: 100,
      created_at: "2026-05-23T00:00:00.000Z",
      updated_at: "2026-05-23T00:00:00.000Z",
    })
    .execute();
  await first.destroy();

  // Reopen and confirm the row survived (i.e., migration didn't recreate
  // the table) and the second migrateToLatest() didn't error.
  const { db: second } = await openDb(dir);
  onTestFinished(() => second.destroy());
  const rows = await second.selectFrom("tasks").selectAll().execute();
  expect(rows.map((r) => r.title)).toEqual(["carry-over"]);
});

test("init migration applied via Kysely's tracking table", async () => {
  const { db } = await openDb(freshStateDir());
  onTestFinished(() => db.destroy());
  // Kysely's Migrator tracks state in `kysely_migration`; verifying the
  // one expected entry confirms the FileMigrationProvider discovered the
  // file and the migrator persisted the apply.
  const applied = await sql<{
    name: string;
  }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db);
  expect(applied.rows.map((r) => r.name)).toEqual(
    expect.arrayContaining([expect.stringMatching(/_init$/)]),
  );
});

test("widen_task_status migration accepts a doing row", async () => {
  // The widen migration rebuilds the table with CHECK (status IN
  // ('todo', 'doing', 'done')). If a future migration drops the rebuild
  // or mismatches the literals, this insert fails — the test is the
  // tripwire on the migration ↔ TaskStatusSchema invariant documented in
  // migrations/README.md.
  const { db } = await openDb(freshStateDir());
  onTestFinished(() => db.destroy());
  await db
    .insertInto("tasks")
    .values({
      id: "t-doing",
      parent_id: null,
      title: "in flight",
      status: "doing",
      position: 100,
      created_at: "2026-05-24T00:00:00.000Z",
      updated_at: "2026-05-24T00:00:00.000Z",
    })
    .execute();
  const [row] = await db
    .selectFrom("tasks")
    .select(["status"])
    .where("id", "=", "t-doing")
    .execute();
  expect(row?.status).toBe("doing");
});

test("widen_task_status down() coerces doing rows back to todo", async () => {
  // The down migration narrows the CHECK back to ('todo', 'done'). Any
  // row currently in 'doing' must be coerced before the rebuild or the
  // INSERT…SELECT into the narrower table fails. Reach in by name so a
  // future reordering of the migrations directory doesn't drift this test.
  const { db } = await openDb(freshStateDir());
  onTestFinished(() => db.destroy());
  await db
    .insertInto("tasks")
    .values({
      id: "t-doing",
      parent_id: null,
      title: "in flight",
      status: "doing",
      position: 100,
      created_at: "2026-05-24T00:00:00.000Z",
      updated_at: "2026-05-24T00:00:00.000Z",
    })
    .execute();

  const { down } = await import("./migrations/20260524210804_widen_task_status");
  await down(db);

  // Cast through `any` for the post-down read because the Kysely
  // `Database` interface still types `status` under the widened enum
  // (TaskStatus), but at this point the column has been narrowed back.
  // biome-ignore lint/suspicious/noExplicitAny: post-down narrow shape
  const [row] = await (db as any)
    .selectFrom("tasks")
    .select(["status"])
    .where("id", "=", "t-doing")
    .execute();
  expect(row?.status).toBe("todo");
});
