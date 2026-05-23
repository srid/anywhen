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
import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { surface } from "../shared/surface";
import type { TaskId } from "../shared/schemas";
import { descendantIds } from "../shared/tree";
import type { TaskStore } from "../storage/tasks";

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
  // MemoryPublisher's generic insists on `Record<string, object>`; we publish
  // `Task` objects and `string[]` key snapshots, both of which satisfy
  // `object` in JS. Per-channel typing lives on the surface contract — the
  // publisher's `any` carrier just keeps TypeScript out of the way here.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const publisher = new MemoryPublisher<Record<string, any>>();
  const { router: surfaceFragment } = implementSurface(surface, {
    channel: <T>(name: string) => publisherChannel<T>(publisher, name),
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
          const childrenOf = childrenIndex(before);
          const descendants = descendantIds<TaskId>(input, (id) => childrenOf.get(id) ?? []);
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

// Project the parent-pointer view in `listMap()` into a children index keyed
// by parent id — the shape `descendantIds` consumes. Lives at the router
// because the Collection fan-out is the only caller; `taskStore.remove`
// itself relies on the SQL FK cascade and doesn't need this view.
const childrenIndex = (
  tasks: Map<TaskId, { id: TaskId; parentId: TaskId | null }>,
): Map<TaskId, TaskId[]> => {
  const out = new Map<TaskId, TaskId[]>();
  for (const t of tasks.values()) {
    if (t.parentId === null) continue;
    const arr = out.get(t.parentId) ?? [];
    arr.push(t.id);
    out.set(t.parentId, arr);
  }
  return out;
};
