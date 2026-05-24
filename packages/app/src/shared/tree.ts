// Tree walks over a `parentId`-pointer graph. Both directions live in
// shared/ because the same parent-pointer axis is the source of truth on
// the server (cascade-delete fan-out into the Collection's per-key bus)
// and on the client (ancestor visibility when the live filter dims rows
// that aren't direct matches). Anything that changes the parent-pointer
// schema — cycle detection, virtual parents, blocked-by edges — lands
// here exactly once.
//
// The functions take a parent-accessor callback rather than a concrete
// container so the same module serves a `Task[]` (client) and a
// `Map<TaskId, Task>` (server) without converging on a shared collection
// type that would force the server to materialize an array per call.

// Walk upward from each id in `seeds`, collecting every ancestor reachable
// via `parentOf`. Skips seeds themselves; stops cleanly on cycles (a node
// already in the accumulator short-circuits its branch).
export const ancestorIds = <Id>(seeds: Iterable<Id>, parentOf: (id: Id) => Id | null): Set<Id> => {
  const out = new Set<Id>();
  for (const seed of seeds) {
    let cursor = parentOf(seed);
    while (cursor !== null && !out.has(cursor)) {
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
