// PR 1 declares tasks as imperative procedures only — `list` returns a
// snapshot, `add` and `toggle` mutate. PR 2 swaps `list` for a Collection
// with push-based deltas; the procedures stay as the imperative escape
// hatch (server assigns the id, so it doesn't fit the collection's
// upsert-with-key shape — same pattern as kolu's example notes.create).

import { defineSurface } from "@kolu/surface/define";
import { z } from "zod";
import { AddTaskInputSchema, MoveTaskInputSchema, TaskIdSchema, TaskSchema } from "./schemas";

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
      // Drag-and-drop reordering. Input carries a semantic drop target
      // (before/after/inside refId); the server resolves it to a concrete
      // (parentId, position) and rejects cycles. Output is void because
      // a single moved row doesn't describe the post-move ordering — the
      // client refetches the list, which is the canonical ordered view.
      move: {
        input: MoveTaskInputSchema,
        output: z.void(),
      },
      // remove cascades to descendants via the parent_id FK's
      // `ON DELETE CASCADE` clause in the init migration — deleting a
      // parent removes its entire subtree atomically.
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
