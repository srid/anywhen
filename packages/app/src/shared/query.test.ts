import { describe, expect, test } from "bun:test";
import {
  type Atom,
  atomEquals,
  evalAtoms,
  HIDE_STALE_DONE,
  ONLY_DOING,
  parseAtoms,
  serializeAtoms,
  STALE_THRESHOLD_MS,
} from "./query";
import type { Task, TaskId } from "./schemas";

// ── parseAtoms ────────────────────────────────────────────────────────

describe("parseAtoms", () => {
  test("empty / whitespace-only input → no atoms", () => {
    expect(parseAtoms("")).toEqual([]);
    expect(parseAtoms("   ")).toEqual([]);
    expect(parseAtoms("\t\n  ")).toEqual([]);
  });

  test("plain free text becomes one text atom (run-joined)", () => {
    expect(parseAtoms("groc")).toEqual([{ kind: "text", needle: "groc" }]);
    expect(parseAtoms("report Q3")).toEqual([{ kind: "text", needle: "report Q3" }]);
    expect(parseAtoms("  report  Q3  ")).toEqual([{ kind: "text", needle: "report Q3" }]);
  });

  test("done:X tokens become done atoms", () => {
    expect(parseAtoms("done:no")).toEqual([{ kind: "done", value: "no" }]);
    expect(parseAtoms("done:yes")).toEqual([{ kind: "done", value: "yes" }]);
    expect(parseAtoms("done:fresh")).toEqual([{ kind: "done", value: "fresh" }]);
    expect(parseAtoms("done:stale")).toEqual([{ kind: "done", value: "stale" }]);
  });

  test("unknown done:X value falls back to free text", () => {
    expect(parseAtoms("done:maybe")).toEqual([{ kind: "text", needle: "done:maybe" }]);
  });

  test("status:X tokens become status atoms", () => {
    expect(parseAtoms("status:todo")).toEqual([{ kind: "status", value: "todo" }]);
    expect(parseAtoms("status:doing")).toEqual([{ kind: "status", value: "doing" }]);
    expect(parseAtoms("status:done")).toEqual([{ kind: "status", value: "done" }]);
  });

  test("unknown status:X value falls back to free text", () => {
    expect(parseAtoms("status:blocked")).toEqual([{ kind: "text", needle: "status:blocked" }]);
  });

  test("not <structured> becomes a negation atom", () => {
    expect(parseAtoms("not done:stale")).toEqual([
      { kind: "not", inner: { kind: "done", value: "stale" } },
    ]);
    expect(parseAtoms("not done:no")).toEqual([
      { kind: "not", inner: { kind: "done", value: "no" } },
    ]);
  });

  test("bare 'not' (no structured follow-up) joins the text run", () => {
    expect(parseAtoms("not")).toEqual([{ kind: "text", needle: "not" }]);
    expect(parseAtoms("not maybe")).toEqual([{ kind: "text", needle: "not maybe" }]);
    expect(parseAtoms("not done:maybe")).toEqual([{ kind: "text", needle: "not done:maybe" }]);
  });

  test("mixed atoms preserve order and split text runs around structured tokens", () => {
    expect(parseAtoms("done:no groc")).toEqual([
      { kind: "done", value: "no" },
      { kind: "text", needle: "groc" },
    ]);
    expect(parseAtoms("groc done:no")).toEqual([
      { kind: "text", needle: "groc" },
      { kind: "done", value: "no" },
    ]);
    expect(parseAtoms("foo done:no bar")).toEqual([
      { kind: "text", needle: "foo" },
      { kind: "done", value: "no" },
      { kind: "text", needle: "bar" },
    ]);
  });

  test("not done:stale followed by free text", () => {
    expect(parseAtoms("not done:stale groc list")).toEqual([
      { kind: "not", inner: { kind: "done", value: "stale" } },
      { kind: "text", needle: "groc list" },
    ]);
  });
});

// ── serializeAtoms ────────────────────────────────────────────────────

describe("serializeAtoms", () => {
  test("empty atom list serializes to empty string", () => {
    expect(serializeAtoms([])).toBe("");
  });

  test("text atom serializes to its needle", () => {
    expect(serializeAtoms([{ kind: "text", needle: "report Q3" }])).toBe("report Q3");
  });

  test("done atom serializes as done:X", () => {
    expect(serializeAtoms([{ kind: "done", value: "stale" }])).toBe("done:stale");
  });

  test("status atom serializes as status:X", () => {
    expect(serializeAtoms([ONLY_DOING])).toBe("status:doing");
    expect(serializeAtoms([{ kind: "status", value: "todo" }])).toBe("status:todo");
  });

  test("not atom prefixes its inner", () => {
    expect(serializeAtoms([HIDE_STALE_DONE])).toBe("not done:stale");
  });

  test("atoms join with single spaces in order", () => {
    expect(
      serializeAtoms([
        { kind: "done", value: "no" },
        { kind: "text", needle: "groc" },
      ]),
    ).toBe("done:no groc");
  });
});

// ── round-trip ─────────────────────────────────────────────────────────

describe("parse/serialize round-trip", () => {
  const sample = [
    "",
    "groc",
    "report Q3",
    "done:no",
    "done:no groc",
    "groc done:no",
    "not done:stale",
    "not done:stale groc list",
    "foo done:no bar",
    "done:yes done:no", // redundant but parseable; AND-composes to empty
    "status:doing",
    "status:doing groc",
    "status:doing not done:stale",
    "not status:done",
  ];
  for (const q of sample) {
    test(`serialize(parse("${q}")) re-parses to the same atom list`, () => {
      const first = parseAtoms(q);
      const reparsed = parseAtoms(serializeAtoms(first));
      expect(reparsed).toEqual(first);
    });
  }
});

// ── atomEquals ────────────────────────────────────────────────────────

describe("atomEquals", () => {
  test("identical text atoms are equal", () => {
    expect(atomEquals({ kind: "text", needle: "x" }, { kind: "text", needle: "x" })).toBe(true);
  });

  test("different needles are not equal", () => {
    expect(atomEquals({ kind: "text", needle: "x" }, { kind: "text", needle: "y" })).toBe(false);
  });

  test("done atoms agree on kind and value", () => {
    expect(atomEquals({ kind: "done", value: "stale" }, { kind: "done", value: "stale" })).toBe(
      true,
    );
    expect(atomEquals({ kind: "done", value: "stale" }, { kind: "done", value: "fresh" })).toBe(
      false,
    );
  });

  test("not atoms compare their inner", () => {
    expect(atomEquals(HIDE_STALE_DONE, HIDE_STALE_DONE)).toBe(true);
    expect(
      atomEquals(HIDE_STALE_DONE, {
        kind: "not",
        inner: { kind: "done", value: "fresh" },
      }),
    ).toBe(false);
  });

  test("status atoms agree on kind and value", () => {
    expect(atomEquals(ONLY_DOING, ONLY_DOING)).toBe(true);
    expect(atomEquals(ONLY_DOING, { kind: "status", value: "todo" })).toBe(false);
    // status and done are different kinds even when values are spelled the same
    expect(atomEquals(ONLY_DOING, { kind: "done", value: "yes" } as Atom)).toBe(false);
  });

  test("different kinds are never equal", () => {
    expect(atomEquals({ kind: "text", needle: "done:no" }, { kind: "done", value: "no" })).toBe(
      false,
    );
  });
});

// ── evalAtoms ─────────────────────────────────────────────────────────

const mkTask = (overrides: Partial<Task> & { id: TaskId; title: string }): Task => ({
  parentId: null,
  status: "todo",
  position: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  completedAt: null,
  ...overrides,
});

describe("evalAtoms", () => {
  const NOW = Date.parse("2026-01-15T12:00:00.000Z");
  const yesterday = new Date(NOW - 2 * STALE_THRESHOLD_MS).toISOString();
  const recently = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();

  const todo = mkTask({ id: "t1", title: "draft PR description" });
  const doing = mkTask({ id: "t1d", title: "WIP feature", status: "doing" });
  const doneFresh = mkTask({
    id: "t2",
    title: "reply to Sam",
    status: "done",
    completedAt: recently,
  });
  const doneStale = mkTask({
    id: "t3",
    title: "grocery list",
    status: "done",
    completedAt: yesterday,
  });
  const doneLegacy = mkTask({
    id: "t4",
    title: "old completed task",
    status: "done",
    completedAt: null,
  });

  test("empty atom list matches everything", () => {
    expect(evalAtoms([], todo, NOW)).toBe(true);
    expect(evalAtoms([], doneStale, NOW)).toBe(true);
  });

  test("text atom is case-insensitive substring on the title's first line", () => {
    expect(evalAtoms(parseAtoms("draft"), todo, NOW)).toBe(true);
    expect(evalAtoms(parseAtoms("DRAFT"), todo, NOW)).toBe(true);
    expect(evalAtoms(parseAtoms("grocery"), todo, NOW)).toBe(false);
    // Multi-line title: only the label (first line) is searched; matches
    // in the markdown body fall through.
    const multiline = mkTask({
      id: "ml",
      title: "ship visibility lever\nDetails: lever inserts not done:stale",
    });
    expect(evalAtoms(parseAtoms("lever"), multiline, NOW)).toBe(true);
    expect(evalAtoms(parseAtoms("Details"), multiline, NOW)).toBe(false);
  });

  test("done:no keeps every not-done task (todo + doing)", () => {
    const atoms = parseAtoms("done:no");
    expect(evalAtoms(atoms, todo, NOW)).toBe(true);
    expect(evalAtoms(atoms, doing, NOW)).toBe(true);
    expect(evalAtoms(atoms, doneFresh, NOW)).toBe(false);
    expect(evalAtoms(atoms, doneStale, NOW)).toBe(false);
  });

  test("done:yes keeps any done task", () => {
    const atoms = parseAtoms("done:yes");
    expect(evalAtoms(atoms, todo, NOW)).toBe(false);
    expect(evalAtoms(atoms, doneFresh, NOW)).toBe(true);
    expect(evalAtoms(atoms, doneStale, NOW)).toBe(true);
    expect(evalAtoms(atoms, doneLegacy, NOW)).toBe(true);
  });

  test("done:fresh keeps done tasks completed within the threshold", () => {
    const atoms = parseAtoms("done:fresh");
    expect(evalAtoms(atoms, todo, NOW)).toBe(false);
    expect(evalAtoms(atoms, doneFresh, NOW)).toBe(true);
    expect(evalAtoms(atoms, doneStale, NOW)).toBe(false);
    // Legacy done task (completedAt: null) is not considered fresh either —
    // we don't know when it was completed.
    expect(evalAtoms(atoms, doneLegacy, NOW)).toBe(false);
  });

  test("done:stale keeps done tasks completed beyond the threshold", () => {
    const atoms = parseAtoms("done:stale");
    expect(evalAtoms(atoms, todo, NOW)).toBe(false);
    expect(evalAtoms(atoms, doneFresh, NOW)).toBe(false);
    expect(evalAtoms(atoms, doneStale, NOW)).toBe(true);
    // Legacy done (completedAt: null) is NOT stale — predicate treats null
    // as "completion time unknown, so don't hide it".
    expect(evalAtoms(atoms, doneLegacy, NOW)).toBe(false);
  });

  test("not done:stale keeps everything except stale-done", () => {
    const atoms = parseAtoms("not done:stale");
    expect(evalAtoms(atoms, todo, NOW)).toBe(true);
    expect(evalAtoms(atoms, doneFresh, NOW)).toBe(true);
    expect(evalAtoms(atoms, doneStale, NOW)).toBe(false);
    expect(evalAtoms(atoms, doneLegacy, NOW)).toBe(true);
  });

  test("status:doing keeps only doing tasks", () => {
    const atoms = parseAtoms("status:doing");
    expect(evalAtoms(atoms, todo, NOW)).toBe(false);
    expect(evalAtoms(atoms, doing, NOW)).toBe(true);
    expect(evalAtoms(atoms, doneFresh, NOW)).toBe(false);
    expect(evalAtoms(atoms, doneStale, NOW)).toBe(false);
  });

  test("status:todo and status:done match their lifecycle state", () => {
    expect(evalAtoms(parseAtoms("status:todo"), todo, NOW)).toBe(true);
    expect(evalAtoms(parseAtoms("status:todo"), doing, NOW)).toBe(false);
    expect(evalAtoms(parseAtoms("status:done"), doneFresh, NOW)).toBe(true);
    expect(evalAtoms(parseAtoms("status:done"), doneLegacy, NOW)).toBe(true);
    expect(evalAtoms(parseAtoms("status:done"), todo, NOW)).toBe(false);
  });

  test("done:yes and status:done evaluate identically — pins the documented overlap", () => {
    // The two atoms are equivalent by construction (both reduce to
    // task.status === "done"). The atoms.ts comment at evalDone's "yes"
    // case warns that any future widening of the "done" lifecycle must
    // touch both branches; this test fails immediately if one is updated
    // without the other.
    const tasks = [todo, doing, doneFresh, doneStale, doneLegacy];
    const doneYes = parseAtoms("done:yes");
    const statusDone = parseAtoms("status:done");
    for (const task of tasks) {
      expect(evalAtoms(doneYes, task, NOW)).toBe(evalAtoms(statusDone, task, NOW));
    }
  });

  test("AND-composition: free text + structured atom", () => {
    const atoms = parseAtoms("done:no draft");
    expect(evalAtoms(atoms, todo, NOW)).toBe(true);
    // Status is done — done:no fails:
    const doneDraft = mkTask({
      id: "x",
      title: "draft PR description",
      status: "done",
      completedAt: recently,
    });
    expect(evalAtoms(atoms, doneDraft, NOW)).toBe(false);
    // Status is todo but title doesn't match:
    expect(evalAtoms(atoms, doneFresh, NOW)).toBe(false);
  });
});
