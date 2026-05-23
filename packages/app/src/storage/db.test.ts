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
  const db = await openDb(freshStateDir());
  onTestFinished(() => db.destroy());
  // Selecting from the table proves it exists and has the expected shape.
  const rows = await db.selectFrom("tasks").selectAll().execute();
  expect(rows).toEqual([]);
});

test("openDb is idempotent — re-opening the same DB applies no migrations", async () => {
  const dir = freshStateDir();
  const first = await openDb(dir);
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
  const second = await openDb(dir);
  onTestFinished(() => second.destroy());
  const rows = await second.selectFrom("tasks").selectAll().execute();
  expect(rows.map((r) => r.title)).toEqual(["carry-over"]);
});

test("init migration applied via Kysely's tracking table", async () => {
  const db = await openDb(freshStateDir());
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
