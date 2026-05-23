import { expect, onTestFinished, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import { seedSampleData } from "./seed";
import { taskStore } from "./tasks";

const freshStateDir = () => {
  const d = mkdtempSync(join(tmpdir(), "anywhen-seed-test-"));
  onTestFinished(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

test("seedSampleData populates an empty database", async () => {
  const { db } = await openDb(freshStateDir());
  onTestFinished(() => db.destroy());
  const store = taskStore(db);

  await seedSampleData(store);

  const tasks = await store.list();
  expect(tasks.length).toBeGreaterThan(0);
  // Tree depth ≥ 2: at least one task has a parent that itself has a parent.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasGrandchild = tasks.some((t) => {
    if (!t.parentId) return false;
    const parent = byId.get(t.parentId);
    return parent?.parentId != null;
  });
  expect(hasGrandchild).toBe(true);
  // At least one done task so the UI's strikethrough state is visible.
  expect(tasks.some((t) => t.status === "done")).toBe(true);
});

test("seedSampleData is idempotent — does not duplicate when tasks already exist", async () => {
  const { db } = await openDb(freshStateDir());
  onTestFinished(() => db.destroy());
  const store = taskStore(db);

  await store.add({ title: "user's own task", parentId: null });
  const before = await store.list();

  await seedSampleData(store);

  const after = await store.list();
  expect(after).toEqual(before);
});
