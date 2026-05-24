// Single source of truth for the domain. Zod schemas are primary; runtime
// types (`Task`, `TaskId`, `TaskStatus`) derive from them via `z.infer`.
// This mirrors the kolu surface example pattern (`packages/surface/example/
// src/common/surface.ts`) and ensures schema widening (PR 2+: body, tags,
// due, recurrence) updates the type in lockstep — no silent drift between
// the Zod-validated wire shape and what callers think they're handling.

import { z } from "zod";

export const TaskIdSchema = z.string().min(1);
export const TaskStatusSchema = z.enum(["todo", "doing", "done"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Cycle map for the row checkbox + Space key. Colocated with the enum so
// adding a future state edits one place — adding a key to the enum forces
// a key in the `Record` here (TS exhaustiveness), and the wrap direction
// is data rather than control flow. The server applies it inside the
// cycleStatus txn so the cycle direction can never drift between client
// and store.
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

export const nextInCycle = (status: TaskStatus): TaskStatus => NEXT_STATUS[status];

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

// Derived from MoveTargetSchema so the runtime set stays in sync with the
// schema automatically — no parallel maintenance.
export const DROP_ZONES = MoveTargetSchema.options.map((o) => o.shape.kind.value) as [
  "before",
  "after",
  "inside",
];

// Pointer-Y thresholds inside a target row that pick the drop zone. Shared
// so the e2e test computes its synthetic mouse offset from the same
// boundaries the client uses — a single source of truth for the protocol.
export const ZONE_BEFORE_RATIO = 0.25;
export const ZONE_AFTER_RATIO = 0.75;

// How long a pointer must be held in place before touch/pen drag activates.
// Exported so the e2e test can derive its pre-drag delay from the same
// value — changing this constant here keeps the test timing in sync.
export const DRAG_LONGPRESS_MS = 350;

export const MoveTaskInputSchema = z.object({
  id: TaskIdSchema,
  target: MoveTargetSchema,
});

export const EditTaskInputSchema = z.object({
  id: TaskIdSchema,
  title: z.string().min(1),
});

// Backup envelope for export/import. The version literal lets a future schema
// migration discriminate against older dumps (today there is only v1, so the
// import path simply rejects anything else — no migration table yet). The
// tasks array is the full domain shape; export/import round-trips IDs,
// positions, and timestamps verbatim so a restore reproduces the pre-export
// state exactly.
export const BACKUP_VERSION = 1;
export const BackupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  tasks: z.array(TaskSchema),
});

// Constructor for the envelope. The single in-repo site that knows how a
// `Backup` value is assembled — the on-disk auto-backup and the `api.export`
// procedure both call this so a future schema widening (adding e.g. a
// `hostname` annotation) doesn't have to be applied at two construction
// sites in lockstep.
export const makeBackup = (
  tasks: z.infer<typeof TaskSchema>[],
  now: Date,
): z.infer<typeof BackupSchema> => ({
  version: BACKUP_VERSION,
  exportedAt: now.toISOString(),
  tasks,
});

export type TaskId = z.infer<typeof TaskIdSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type AddTaskInput = z.infer<typeof AddTaskInputSchema>;
export type MoveTarget = z.infer<typeof MoveTargetSchema>;
export type MoveTaskInput = z.infer<typeof MoveTaskInputSchema>;
export type EditTaskInput = z.infer<typeof EditTaskInputSchema>;
export type DropZone = MoveTarget["kind"];
export type Backup = z.infer<typeof BackupSchema>;
