// Single source of truth for the domain. Zod schemas are primary; runtime
// types (`Task`, `TaskId`, `TaskStatus`) derive from them via `z.infer`.
// This mirrors the kolu surface example pattern (`packages/surface/example/
// src/common/surface.ts`) and ensures schema widening (PR 2+: body, tags,
// due, recurrence) updates the type in lockstep — no silent drift between
// the Zod-validated wire shape and what callers think they're handling.

import { z } from "zod";

export const TaskIdSchema = z.string().min(1);
export const TaskStatusSchema = z.enum(["todo", "done"]);

export const TaskSchema = z.object({
  id: TaskIdSchema,
  parentId: TaskIdSchema.nullable(),
  title: z.string(),
  status: TaskStatusSchema,
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AddTaskInputSchema = z.object({
  title: z.string().min(1),
  parentId: TaskIdSchema.nullable(),
});

// Drop semantics for tasks.move. The client speaks intent — drop X before /
// after / inside Y — and the server owns position allocation, so the
// gap-allocation strategy (REAL midpoints today; could become a doubly-
// linked list later) never leaks across the wire.
export const MoveTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("before"), refId: TaskIdSchema }),
  z.object({ kind: z.literal("after"), refId: TaskIdSchema }),
  z.object({ kind: z.literal("inside"), refId: TaskIdSchema }),
]);

export const MoveTaskInputSchema = z.object({
  id: TaskIdSchema,
  target: MoveTargetSchema,
});

export type TaskId = z.infer<typeof TaskIdSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type AddTaskInput = z.infer<typeof AddTaskInputSchema>;
export type MoveTarget = z.infer<typeof MoveTargetSchema>;
export type MoveTaskInput = z.infer<typeof MoveTaskInputSchema>;
