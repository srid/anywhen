// PR 1 declares tasks as imperative procedures only — `list` returns a
// snapshot, `add` and `toggle` mutate. PR 2 swaps `list` for a Collection
// with push-based deltas; the procedures stay as the imperative escape
// hatch (server assigns the id, so it doesn't fit the collection's
// upsert-with-key shape — same pattern as kolu's example notes.create).

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";
import { AddTaskInputSchema, TaskIdSchema, TaskSchema } from "./schemas";

export const surface = defineSurface({
  procedures: {
    tasks: {
      list: {
        input: z.void(),
        output: z.array(TaskSchema),
      },
      add: {
        input: AddTaskInputSchema,
        output: TaskSchema,
      },
      toggle: {
        input: TaskIdSchema,
        output: TaskSchema,
      },
      // remove cascades to descendants via the parent_id FK's
      // `ON DELETE CASCADE` clause in schema.sql — deleting a parent
      // removes its entire subtree atomically.
      remove: {
        input: TaskIdSchema,
        output: z.void(),
      },
      // Test-only: wipe all tasks. Lets cucumber scenarios share one
      // server process without bleeding state between them. Convention
      // mirrors kolu surface's `test__set` verbs. In a multi-tenant app
      // this would be gated by an env flag; anywhen is single-user
      // local, so the procedure ships unconditionally.
      __test__reset: {
        input: z.void(),
        output: z.void(),
      },
    },
  },
});

export type SF = SurfaceTypes<typeof surface.spec>;
