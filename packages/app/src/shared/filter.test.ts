import { expect, test } from "bun:test";
import { applyFilter, matchPositions, matchesQuery } from "./filter";
import type { Task, TaskId } from "./schemas";
import { sortedWithDepths } from "./tree";

// ── matchPositions ────────────────────────────────────────────────────

test("matchPositions returns empty for an empty needle", () => {
  expect(matchPositions("anything", "")).toEqual([]);
  expect(matchPositions("anything", "   ")).toEqual([]);
});

test("matchPositions finds a single hit case-insensitively", () => {
  expect(matchPositions("Grocery list", "groc")).toEqual([{ start: 0, end: 4 }]);
  expect(matchPositions("the Quiet Place", "quiet")).toEqual([{ start: 4, end: 9 }]);
});

test("matchPositions finds non-overlapping repeats", () => {
  expect(matchPositions("abab", "ab")).toEqual([
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
});

test("matchPositions returns empty when the needle is absent", () => {
  expect(matchPositions("hello world", "xyz")).toEqual([]);
});

test("matchesQuery agrees with matchPositions on emptiness", () => {
  expect(matchesQuery("Grocery list", "groc")).toBe(true);
  expect(matchesQuery("Grocery list", "xyz")).toBe(false);
  expect(matchesQuery("anything", "")).toBe(false);
});

// ── applyFilter ───────────────────────────────────────────────────────

const mkTask = (id: string, parentId: TaskId | null, position: number, title: string): Task => ({
  id,
  parentId,
  title,
  status: "todo",
  position,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  completedAt: null,
});

// root
// ├── a       (matches "needle" via title)
// │   └── b   (no match, not an ancestor of any match — elides)
// └── c       (no match, not an ancestor of any match — elides)
const fixture = (): Task[] => [
  mkTask("root", null, 0, "Top container"),
  mkTask("a", "root", 0, "needle in a"),
  mkTask("b", "a", 0, "leaf below"),
  mkTask("c", "root", 1, "unrelated"),
];

test("applyFilter with null predicate returns every row undimmed", () => {
  const sorted = sortedWithDepths(fixture());
  const rows = applyFilter(sorted, null);
  expect(rows.map((r) => r.task.id)).toEqual(["root", "a", "b", "c"]);
  expect(rows.every((r) => !r.dimmed)).toBe(true);
});

test("applyFilter keeps direct matches undimmed and their ancestors dimmed", () => {
  const sorted = sortedWithDepths(fixture());
  const rows = applyFilter(sorted, (t) => t.title.includes("needle"));
  // root is an ancestor of the match → kept, dimmed
  // a is the match → kept, undimmed
  // b has no matched descendant and isn't an ancestor → elides
  // c isn't a match and isn't an ancestor → elides
  expect(rows.map((r) => r.task.id)).toEqual(["root", "a"]);
  const byId = new Map(rows.map((r) => [r.task.id, r]));
  expect(byId.get("root")?.dimmed).toBe(true);
  expect(byId.get("a")?.dimmed).toBe(false);
});

test("applyFilter with no matches returns an empty list", () => {
  const sorted = sortedWithDepths(fixture());
  const rows = applyFilter(sorted, () => false);
  expect(rows).toEqual([]);
});
