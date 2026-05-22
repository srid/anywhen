// Wire surface procedures to the SQLite-backed taskStore.
//
// Why the rewrap on line 30: `implementSurface` returns
// `{ surface: t.router(namespaces) }`. The inner `t.router(...)` carries
// the full surface contract as a hidden "router contract" — oRPC's
// matcher walks the OUTER `{ surface: ... }` normally, then when it
// descends into the inner router it switches to walking the hidden
// contract from its root, duplicating the `surface` path segment
// (procedures end up registered at `/surface/surface/tasks/list` —
// observed directly in the matcher's `tree` keys before this rewrap).
// Wrapping the fragment in a fresh host-level `t.router({...fragment})`
// makes the host router own the hidden contract once, so the matcher
// walks the contract from root and the path segments line up.
//
// Kolu's appRouter naturally avoids this because it always spreads the
// surface fragment alongside hand-written namespaces; a procedures-only
// app needs the explicit rewrap.

import { implement } from "@orpc/server";
import { type Channel, implementSurface } from "@kolu/surface/server";
import { surface } from "../shared/surface";
import type { TaskStore } from "../storage/tasks";

export function buildRouter(store: TaskStore) {
  const { router: surfaceFragment } = implementSurface(surface, {
    // `channel` is required by ImplementSurfaceDeps but only invoked when a
    // cell / collection / stream / event is declared. PR 1 has none, so any
    // call here is a wiring bug — throw with implementation-neutral language
    // (PR 2 will add real channels for the tasks collection).
    channel: <T>(name: string): Channel<T> => {
      const fail = () => {
        throw new Error(
          `Channel(${name}): not wired — add this channel to implementSurface deps when declaring reactive primitives.`,
        );
      };
      return { publish: fail, subscribe: fail as never, consume: fail as never };
    },
    procedures: {
      tasks: {
        list: async () => store.list(),
        add: async ({ input }) => store.add(input),
        toggle: async ({ input }) => store.toggle(input),
        remove: async ({ input }) => store.remove(input),
        __test__reset: async () => store.reset(),
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: implement() is dynamically typed across the surface contract
  const t = implement(surface.contract) as any;
  return t.router({ ...surfaceFragment });
}
