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

// Walk upward from `seed` via parent pointers, invoking `visit` for each
// ancestor in encounter order. Cycle-guarded by `visited` (mutated): the
// caller controls whether the visited set is per-call (isolating each walk)
// or shared across calls (so a multi-seed batch short-circuits when a later
// seed reaches a node an earlier seed already collected, and the same Set
// doubles as both the cycle guard and the accumulator).
//
// Private to this module — both public functions below compose it; the
// shape of `visited` ownership is the knob that lets one primitive serve
// the "set across many seeds" and "ordered path for one seed" consumers
// without each re-implementing the parent walk.
const walkAncestors = <Id>(
  seed: Id,
  parentOf: (id: Id) => Id | null,
  visited: Set<Id>,
  visit: (id: Id) => void,
): void => {
  let cursor = parentOf(seed);
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    visit(cursor);
    cursor = parentOf(cursor);
  }
};

// Walk upward from each id in `seeds`, collecting every ancestor reachable
// via `parentOf`. Skips seeds themselves; stops cleanly on cycles. The
// shared `out` Set is both the result and the cycle guard, so the second
// seed's walk short-circuits through any node the first seed collected.
export const ancestorIds = <Id>(seeds: Iterable<Id>, parentOf: (id: Id) => Id | null): Set<Id> => {
  const out = new Set<Id>();
  // The visit callback is a no-op here: `walkAncestors` has already added
  // the ancestor to `out` (since `out` IS the visited set), and that
  // mutation is the accumulation step. No second list to populate.
  for (const seed of seeds) walkAncestors(seed, parentOf, out, () => {});
  return out;
};

// Walk upward from a single seed, returning the ordered root-first path of
// ancestors (excludes the seed). The ancestor *set* (see ancestorIds) covers
// "is this id in someone's lineage"; the ancestor *path* covers "what is this
// id's lineage, in order" — e.g. rendering a breadcrumb. Uses a fresh local
// visited Set so cycles in a degenerate graph terminate cleanly per-call.
export const ancestorPath = <Id>(seed: Id, parentOf: (id: Id) => Id | null): Id[] => {
  const path: Id[] = [];
  walkAncestors(seed, parentOf, new Set<Id>(), (id) => path.push(id));
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
