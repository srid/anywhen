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
    },
  },
});

export type SF = SurfaceTypes<typeof surface.spec>;
