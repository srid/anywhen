import { expect, test } from "bun:test";
import { ancestorIds, ancestorPath } from "./tree";

// Tree fixture: root → a → b → c, plus a sibling `s` under root.
//   root
//   ├── a
//   │   └── b
//   │       └── c
//   └── s
const PARENTS: Record<string, string | null> = {
  root: null,
  a: "root",
  b: "a",
  c: "b",
  s: "root",
};
const parentOf = (id: string): string | null => PARENTS[id] ?? null;

test("ancestorPath returns the root-first chain for a deep node", () => {
  expect(ancestorPath("c", parentOf)).toEqual(["root", "a", "b"]);
});

test("ancestorPath returns an empty array for a root node", () => {
  expect(ancestorPath("root", parentOf)).toEqual([]);
});

test("ancestorPath excludes the seed itself", () => {
  const path = ancestorPath("b", parentOf);
  expect(path).not.toContain("b");
  expect(path).toEqual(["root", "a"]);
});

test("ancestorPath stops cleanly on cycles instead of looping", () => {
  // Pathological graph: x → y → x.
  const cyclic = (id: string): string | null => (id === "x" ? "y" : id === "y" ? "x" : null);
  const path = ancestorPath("x", cyclic);
  // The exact result is "walk until we revisit"; the important guarantee is
  // termination + no duplicates, mirroring how ancestorIds handles cycles.
  expect(new Set(path).size).toBe(path.length);
  expect(path.length).toBeLessThanOrEqual(2);
});

test("ancestorPath and ancestorIds agree on membership", () => {
  const path = ancestorPath("c", parentOf);
  const ids = ancestorIds(["c"], parentOf);
  expect(new Set(path)).toEqual(ids);
});
