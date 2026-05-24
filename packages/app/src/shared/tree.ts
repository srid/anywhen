// Tree walks over a `parentId`-pointer graph. The generic walks at the
// bottom are parametric over Id with a parent-accessor callback so the
// same module serves both server (Map<TaskId, Task>) and client (Task[])
// — anything that changes the parent-pointer schema (cycle detection,
// virtual parents, blocked-by edges) lands here exactly once.
//
// The Task-typed walks at the top are the display layer's view of that
// same graph: flatten by position, compute depths, sibling navigation,
// keyboard-driven moves. They live alongside the generic walks because
// they answer questions of the same shape; splitting them across files
// would force one conceptual change to diff two files for no benefit.

import type { MoveTarget, Task, TaskId } from "./schemas";

// ── Task display walks ────────────────────────────────────────────────

export type SortedTask = { task: Task; depth: number };

export const byParentMap = (tasks: Task[]): Map<TaskId | null, Task[]> =>
  Map.groupBy(tasks, (t) => t.parentId);

// Single DFS walk: position-orders siblings, visits parent before children,
// and records depth inline — one byParentMap, one allocation, one traversal.
export const sortedWithDepths = (tasks: Task[]): SortedTask[] => {
  const byParent = byParentMap(tasks);
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position);
  const out: SortedTask[] = [];
  const walk = (parentId: TaskId | null, depth: number) => {
    for (const t of byParent.get(parentId) ?? []) {
      out.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
};

// Rebuilds byParentMap on every call rather than taking a pre-built one:
// the caller is a keyboard-paced resolveKeyMove, so the per-call O(n)
// allocation is fine and threading a shared map through the signature
// would complect this function's contract with the caller's caching.
const siblingsOf = (
  tasks: Task[],
  id: TaskId,
): { siblings: Task[]; index: number; task: Task } | null => {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const siblings = (byParentMap(tasks).get(task.parentId) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((s) => s.id === id);
  return { siblings, index, task };
};

export type KeyMove = "indent" | "outdent" | "up" | "down";

export const resolveKeyMove = (tasks: Task[], id: TaskId, action: KeyMove): MoveTarget | null => {
  const sib = siblingsOf(tasks, id);
  if (!sib) return null;
  if (action === "outdent") {
    return sib.task.parentId ? { kind: "after", refId: sib.task.parentId } : null;
  }
  if (action === "indent") {
    const prev = sib.siblings[sib.index - 1];
    return prev ? { kind: "inside", refId: prev.id } : null;
  }
  const offset = action === "up" ? -1 : 1;
  const ref = sib.siblings[sib.index + offset];
  return ref ? { kind: action === "up" ? "before" : "after", refId: ref.id } : null;
};

// ── Generic parent-pointer walks ──────────────────────────────────────

// Walk upward from each id in `seeds`, collecting every ancestor reachable
// via `parentOf`. Skips seeds themselves; stops cleanly on cycles. The
// per-seed guard against `seed` itself is what guarantees the
// "skips seeds" promise even when a cycle loops back through the seed —
// without it, a graph like A→B→A would include A in its own ancestor set.
export const ancestorIds = <Id>(seeds: Iterable<Id>, parentOf: (id: Id) => Id | null): Set<Id> => {
  const out = new Set<Id>();
  for (const seed of seeds) {
    let cursor = parentOf(seed);
    while (cursor !== null && cursor !== seed && !out.has(cursor)) {
      out.add(cursor);
      cursor = parentOf(cursor);
    }
  }
  return out;
};

// Walk upward from a single seed, returning the root-first ordered path of
// ancestors (excludes the seed itself). Uses a visited set for cycle safety.
// Use ancestorIds when you only need set membership across multiple seeds.
export const ancestorPath = <Id>(seed: Id, parentOf: (id: Id) => Id | null): Id[] => {
  const path: Id[] = [];
  const visited = new Set<Id>();
  let cursor = parentOf(seed);
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    path.push(cursor);
    cursor = parentOf(cursor);
  }
  return path.reverse();
};

// Walk downward from `rootId`, collecting every descendant reachable via
// `childrenOf`. Excludes the root itself.
export const descendantIds = <Id>(rootId: Id, childrenOf: (id: Id) => Iterable<Id>): Set<Id> => {
  const out = new Set<Id>();
  const walk = (id: Id): void => {
    for (const child of childrenOf(id)) {
      if (out.has(child)) continue;
      out.add(child);
      walk(child);
    }
  };
  walk(rootId);
  return out;
};
