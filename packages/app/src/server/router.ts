// Wire surface primitives + procedures to the SQLite-backed taskStore.
//
// `tasks` lives on the surface as a Collection (`collections.tasks`) — the
// framework owns its `keys` / `get(key)` snapshot+deltas streams and wraps
// `upsert` / `remove` so every persisted change publishes through the
// surface's channels. Imperative procedures (`add`, `toggle`, `move`,
// `remove`, `__test__reset`) write to SQL via the async store and then
// fan out through `ctx.collections.tasks.{upsert,remove}` so each verb's
// side effects produce Collection deltas without a parallel
// `store.X + bus.publish` path.
//
// Kolu's Collection deps are strictly synchronous (`readAll: () =>
// Map<K, T>`, `upsert/remove: (...) => void`) — the framework calls them
// inline with `keysBus.publish(...)` and cannot await SQL. The bridge is
// an in-memory `cache: Map<TaskId, Task>` seeded from `store.listMap()`
// at boot: deps callbacks read and mutate the cache synchronously; the
// async DB writes happen earlier in each procedure body via `await
// store.X()`. The framework never touches SQL directly.

import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { implement } from "@orpc/server";
import { makeBackup, type Task, type TaskId } from "../shared/schemas";
import { type RuntimeInfo, surface } from "../shared/surface";
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

export function buildRouter(store: TaskStore, cache: Map<TaskId, Task>, runtimeInfo: RuntimeInfo) {
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
        readAll: () => cache,
        upsert: (_key, value) => {
          cache.set(value.id, value);
        },
        remove: (id) => {
          cache.delete(id);
        },
      },
    },
    procedures: {
      tasks: {
        // `add` allocates the id server-side and publishes via the
        // wrapped upsert (which also broadcasts the new keys list).
        add: async ({ input, ctx }) => {
          const task = await store.add(input);
          ctx.collections.tasks.upsert(task.id, task);
          return task;
        },
        // `toggle` produces a new task value; route it through `upsert`
        // so the per-key value bus fires for the toggled row.
        toggle: async ({ input, ctx }) => {
          const task = await store.toggle(input);
          ctx.collections.tasks.upsert(task.id, task);
          return task;
        },
        // `edit` rewrites only the title; same upsert fan-out as toggle so
        // every subscriber sees the renamed row in one delta.
        edit: async ({ input, ctx }) => {
          const task = await store.edit(input.id, input.title);
          ctx.collections.tasks.upsert(task.id, task);
          return task;
        },
        // `move` rewrites parent_id / position. `store.move` returns the
        // updated row, so we publish directly without a second snapshot.
        move: async ({ input, ctx }) => {
          const next = await store.move(input);
          ctx.collections.tasks.upsert(input.id, next);
        },
        // FK cascade removes descendants in SQL; mirror the same fan-out
        // through the Collection so each descendant's key drops off the
        // keys stream. Snapshot descendants from the cache before the SQL
        // DELETE — afterwards the cache no longer sees them.
        remove: async ({ input, ctx }) => {
          const childrenOf = childrenIndex(cache);
          const descendants = descendantIds<TaskId>(input, (id) => childrenOf.get(id) ?? []);
          await store.remove(input);
          ctx.collections.tasks.remove(input);
          for (const id of descendants) ctx.collections.tasks.remove(id);
        },
        // Snapshot the current task set wrapped in a versioned envelope.
        // Reads from the cache (already the live SQL view via the
        // Collection deps) so export is a single in-memory pass — no
        // separate SELECT against the store.
        export: async ({ ctx }) => {
          const tasks = [...ctx.collections.tasks.readAll().values()];
          return makeBackup(tasks, new Date());
        },
        // Replace every current task with the imported set. SQL is wiped
        // and rewritten in one transaction (`store.replaceAll`); the
        // cache fan-out then mirrors the same swap onto the Collection
        // so subscribers see one tear-down + rebuild rather than a
        // per-row diff. Remove stale keys before upserting new ones so
        // an id that disappears from the import isn't briefly orphaned
        // alongside its replacement.
        //
        // Snap `oldKeys` *before* the SQL mutation: the cache and SQL
        // must live in the same epoch when the snapshot is taken, or a
        // future read-through path would let the cache shift under us
        // across the await boundary.
        import: async ({ input, ctx }) => {
          const oldKeys = [...ctx.collections.tasks.readAll().keys()];
          await store.replaceAll(input.tasks);
          const newKeys = new Set(input.tasks.map((t) => t.id));
          for (const k of oldKeys) if (!newKeys.has(k)) ctx.collections.tasks.remove(k);
          for (const t of input.tasks) ctx.collections.tasks.upsert(t.id, t);
        },
        // Wipe via the Collection's ctx so the keys bus publishes the
        // post-reset empty set and each per-key subscriber sees its
        // stream tear down cleanly. Cucumber's "fresh database" Given
        // hits this endpoint between scenarios. The DB delete happens
        // first via store.reset() so the cache is the last source of
        // truth to drain.
        __test__reset: async ({ ctx }) => {
          await store.reset();
          for (const k of Array.from(ctx.collections.tasks.readAll().keys())) {
            ctx.collections.tasks.remove(k);
          }
        },
      },
      runtime: {
        info: async () => runtimeInfo,
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: implement() is dynamically typed across the surface contract
  const t = implement(surface.contract) as any;
  return t.router({ ...surfaceFragment });
}

// Project the parent-pointer view in the cache into a children index keyed
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
