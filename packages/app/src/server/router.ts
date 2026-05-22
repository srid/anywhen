// Wire the surface's procedures to the SQLite-backed taskStore. PR 1 has
// no cells/collections/streams/events — only the three imperative tasks
// procedures. PR 2 adds a `tasks` collection that broadcasts deltas; until
// then the client refetches via `tasks.list` after each mutation.
//
// `channel` is required by ImplementSurfaceDeps but is only consulted when
// a cell / collection / stream / event is declared. PR 1 has none, so the
// stub throws on use — a real implementation arrives with PR 2's
// Collection delta push.
//
// `implementSurface` returns `{ surface: t.router(namespaces) }` where the
// inner `t.router(...)` carries the full surface contract as a hidden
// "router contract". oRPC's matcher walks the OUTER `{ surface: ... }`
// normally — and when it descends into the inner `t.router(...)`, the
// hidden contract starts the walk again from the root, duplicating the
// `surface` path segment (procedures end up registered at
// `/surface/surface/tasks/list` instead of `/surface/tasks/list`). Rewrap
// with `t.router({...fragment})` so the host-level router itself owns the
// hidden contract and the matcher walks it once from the contract root.
// (Kolu's appRouter naturally avoids this because it always spreads the
// surface fragment alongside hand-written namespaces; a procedures-only
// app needs the explicit rewrap.)

import { implement } from "@orpc/server";
import { type Channel, implementSurface } from "@kolu/surface/server";
import { surface } from "../shared/surface";
import type { TaskStore } from "../storage/tasks";

const unusedChannel = <T>(name: string): Channel<T> => {
  const fail = () => {
    throw new Error(
      `Channel(${name}): no reactive primitives declared on this surface (PR 1 has procedures only).`,
    );
  };
  return {
    publish: fail,
    subscribe: fail as never,
    consume: fail as never,
  };
};

export function buildRouter(store: TaskStore) {
  const { router: surfaceFragment } = implementSurface(surface, {
    channel: unusedChannel,
    procedures: {
      tasks: {
        list: async () => store.list(),
        add: async ({ input }) => store.add(input),
        toggle: async ({ input }) => store.toggle(input),
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: implement() is dynamically typed across the surface contract
  const t = implement(surface.contract) as any;
  return t.router({ ...surfaceFragment });
}
