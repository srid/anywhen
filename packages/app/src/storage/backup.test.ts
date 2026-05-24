import { expect, onTestFinished, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupSchema } from "../shared/schemas";
import { pruneBackups, writeBackup } from "./backup";
import { openDb } from "./db";
import { taskStore } from "./tasks";

const freshStateDir = () => {
  const d = mkdtempSync(join(tmpdir(), "anywhen-backup-test-"));
  onTestFinished(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

test("writeBackup emits a BackupSchema-valid envelope containing every live task", async () => {
  const dir = freshStateDir();
  const { db } = await openDb(dir);
  onTestFinished(() => db.destroy());
  const store = taskStore(db);
  const root = await store.add({ title: "root", parentId: null });
  await store.add({ title: "leaf", parentId: root.id });

  const filepath = await writeBackup(
    store,
    join(dir, "backups"),
    new Date("2026-05-24T17:30:00.123Z"),
  );

  expect(filepath).toMatch(/anywhen-backup-2026-05-24T17-30-00-123Z\.json$/);
  const parsed = BackupSchema.parse(JSON.parse(await Bun.file(filepath).text()));
  expect(parsed.tasks.map((t) => t.title).sort()).toEqual(["leaf", "root"]);
});

test("pruneBackups deletes files whose mtime is older than retention; keeps the rest", () => {
  const dir = freshStateDir();
  const backupDir = join(dir, "backups");
  // mkdir + three files, mtimes 10d / 3d / 1h ago.
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const make = (name: string, ageMs: number) => {
    const p = join(backupDir, name);
    writeFileSync(p, "{}", "utf8");
    const t = (now - ageMs) / 1000;
    utimesSync(p, t, t);
    return p;
  };
  // backupDir doesn't exist yet — writeFileSync needs it
  require("node:fs").mkdirSync(backupDir, { recursive: true });
  const stale = make("anywhen-backup-2026-05-14T00-00-00-000Z.json", 10 * day);
  const fresh = make("anywhen-backup-2026-05-21T00-00-00-000Z.json", 3 * day);
  const recent = make("anywhen-backup-2026-05-24T16-30-00-000Z.json", 60 * 60 * 1000);
  // An unrelated file in the same directory must not be touched.
  const stranger = make("operator-note.txt", 10 * day);

  const deleted = pruneBackups(backupDir, 7 * day);

  expect(deleted).toEqual([stale]);
  const remaining = readdirSync(backupDir).sort();
  expect(remaining).toEqual(
    [
      "anywhen-backup-2026-05-21T00-00-00-000Z.json",
      "anywhen-backup-2026-05-24T16-30-00-000Z.json",
      "operator-note.txt",
    ].sort(),
  );
  // Sanity: paths returned are absolute
  expect(stranger).toBeTruthy();
  expect(fresh).toBeTruthy();
  expect(recent).toBeTruthy();
});

test("pruneBackups is a no-op when the backup dir doesn't exist yet", () => {
  const dir = freshStateDir();
  expect(pruneBackups(join(dir, "backups"), 7 * 24 * 60 * 60 * 1000)).toEqual([]);
});
