// Wire surface primitives + procedures to the SQLite-backed taskStore.
//
// `tasks` lives on the surface as a Collection (`collections.tasks`) — the
// framework owns its `keys` / `get(key)` snapshot+deltas streams and wraps
// `upsert` / `remove` so every persisted change publishes through the
// surface's channels. Imperative procedures (`add`, `toggle`, `move`,
// `remove`, `__test__reset`) go through `ctx.collections.tasks.{upsert,remove}`
// so each verb's side effects fan out as Collection deltas without a
// parallel `store.X + bus.publish` path.

import { implement } from "@orpc/server";
import { implementSurface } from "@kolu/surface/server";
import { surface } from "../shared/surface";
import type { TaskStore } from "../storage/tasks";
import { channelFactory } from "./channel";

// `implementSurface` returns `{ surface: t.router(namespaces) }`. The inner
// `t.router(...)` carries the full surface contract as a hidden "router
// contract" — oRPC's matcher walks the OUTER `{ surface: ... }` normally,
// then when it descends into the inner router it switches to walking the
// hidden contract from its root, duplicating the `surface` path segment
// (procedures end up registered at `/surface/surface/tasks/add`). Wrapping
// the fragment in a fresh host-level `t.router({...fragment})` makes the
// host router own the hidden contract once, so the matcher walks the
// contract from root and the path segments line up. Kolu's appRouter
// avoids this because it always spreads the surface fragment alongside
// hand-written namespaces; a surface-only host needs the explicit rewrap.

export function buildRouter(store: TaskStore) {
  const channel = channelFactory();
  const { router: surfaceFragment } = implementSurface(surface, {
    channel,
    collections: {
      tasks: {
        readAll: () => store.listMap(),
        upsert: (_key, value) => store.upsert(value),
        remove: (id) => store.remove(id),
      },
    },
    procedures: {
      tasks: {
        // `add` allocates the id server-side and publishes via the
        // wrapped upsert (which also broadcasts the new keys list).
        add: async ({ input, ctx }) => {
          const task = store.add(input);
          ctx.collections.tasks.upsert(task.id, task);
          return task;
        },
        // `toggle` produces a new task value; route it through `upsert`
        // so the per-key value bus fires for the toggled row.
        toggle: async ({ input, ctx }) => {
          const task = store.toggle(input);
          ctx.collections.tasks.upsert(task.id, task);
          return task;
        },
        // `move` rewrites parent_id / position. Re-read the moved row
        // and publish it as an upsert so subscribers see the new
        // parent / order without a separate "moved" channel.
        move: async ({ input, ctx }) => {
          store.move(input);
          const next = store.listMap().get(input.id);
          if (next) ctx.collections.tasks.upsert(input.id, next);
        },
        // FK cascade removes descendants in SQL; mirror the same fan-out
        // through the Collection so each descendant's key drops off the
        // keys stream. Snapshot descendants from the keyed view before
        // the SQL DELETE — afterwards `listMap()` no longer sees them.
        remove: async ({ input, ctx }) => {
          const before = store.listMap();
          const descendants = collectDescendants(before, input);
          store.remove(input);
          ctx.collections.tasks.remove(input);
          for (const id of descendants) ctx.collections.tasks.remove(id);
        },
        // Wipe via the Collection's ctx so the keys bus publishes the
        // post-reset empty set and each per-key subscriber sees its
        // stream tear down cleanly. Cucumber's "fresh database" Given
        // hits this endpoint between scenarios.
        __test__reset: async ({ ctx }) => {
          for (const k of Array.from(ctx.collections.tasks.readAll().keys())) {
            ctx.collections.tasks.remove(k);
          }
        },
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: implement() is dynamically typed across the surface contract
  const t = implement(surface.contract) as any;
  return t.router({ ...surfaceFragment });
}

// Walk the parent_id graph from a deleted root to collect every descendant
// the FK cascade will drop. Lives next to the router (not in storage/)
// because only the Collection fan-out needs this view — `taskStore.remove`
// itself relies on the SQL cascade and doesn't expose descendant ids.
const collectDescendants = (
  tasks: Map<string, { id: string; parentId: string | null }>,
  rootId: string,
): string[] => {
  const byParent = new Map<string | null, string[]>();
  for (const t of tasks.values()) {
    const arr = byParent.get(t.parentId) ?? [];
    arr.push(t.id);
    byParent.set(t.parentId, arr);
  }
  const out: string[] = [];
  const walk = (id: string): void => {
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(rootId);
  return out;
};
