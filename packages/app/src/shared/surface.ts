// Tasks live on the surface as a Collection — declared up-front so future
// server-side delta evaluation (Phase 5: filter atoms) is a channel-
// implementation swap rather than a contract migration. The procedures stay
// as the imperative escape hatch: `add` assigns the id, `move`/`cycleStatus`/
// `remove` carry verb-shaped intent the upsert primitive can't model
// (same pattern as kolu's notes.create in example/src/common/surface.ts).
//
// Live filter (Phase 1) runs over the client's local Collection cache —
// the matcher in shared/filter.ts is what consumes it.

import { defineSurface } from "@kolu/surface/define";
import { z } from "zod";
import {
  AddTaskInputSchema,
  BackupSchema,
  EditTaskInputSchema,
  MoveTaskInputSchema,
  TaskIdSchema,
  TaskSchema,
} from "./schemas";

// Runtime metadata the server reports about itself — hostname of the box
// it's running on and the absolute path of the SQLite file it's writing
// to. Static at process boot, so a single one-shot procedure is enough;
// the footer fetches it once on mount.
export const RuntimeInfoSchema = z.object({
  hostname: z.string(),
  dbPath: z.string(),
});
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export const surface = defineSurface({
  collections: {
    // Wire-level mutation goes through the imperative procedures below
    // (server-allocated id, position resolution, cascade) — not through
    // the Collection's `upsert`/`delete` verbs. Restricting verbs to
    // read-only narrows the wire and forces clients to route writes
    // through the procedures' validation paths.
    tasks: {
      keySchema: TaskIdSchema,
      schema: TaskSchema,
      verbs: ["keys", "get"],
    },
  },
  procedures: {
    tasks: {
      add: {
        input: AddTaskInputSchema,
        output: TaskSchema,
      },
      // Advance a task one step through the lifecycle cycle (todo → doing
      // → done → todo). The server owns the wrap inside its txn so the
      // direction can't drift across client/server. See `nextInCycle` in
      // ../shared/schemas.ts.
      cycleStatus: {
        input: TaskIdSchema,
        output: TaskSchema,
      },
      // Rename a task. Title is the only user-editable free-text field
      // today; status / parentId / position have their own verbs
      // (cycleStatus, move). The server returns the updated row so the
      // Collection's upsert fan-out can publish without a follow-up snapshot.
      edit: {
        input: EditTaskInputSchema,
        output: TaskSchema,
      },
      // Drag-and-drop reordering. Input carries a semantic drop target
      // (before/after/inside refId); the server resolves it to a concrete
      // (parentId, position) and rejects cycles. Output is void because
      // a single moved row doesn't describe the post-move ordering — the
      // Collection delta tells the client the new state.
      move: {
        input: MoveTaskInputSchema,
        output: z.void(),
      },
      // remove cascades to descendants via the parent_id FK's
      // `ON DELETE CASCADE` clause in the init migration — deleting a
      // parent removes its entire subtree atomically. The server fans
      // `remove` through `ctx.collections.tasks.remove` for each affected
      // id so the keys bus publishes once per descendant.
      remove: {
        input: TaskIdSchema,
        output: z.void(),
      },
      // Backup envelope export — returns the full task set wrapped in a
      // versioned envelope. The client serialises to JSON and triggers a
      // browser download; downstream (Dropbox, git, anything) is a file-
      // system concern outside the wire's scope.
      export: {
        input: z.void(),
        output: BackupSchema,
      },
      // Restore from a backup envelope. Wipe-and-replace semantics: the
      // server validates the version, drops every current row, and writes
      // the import set verbatim (same ids, positions, timestamps). The
      // client guards with a confirm() before invoking — once this lands,
      // pre-import state is gone.
      import: {
        input: BackupSchema,
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
    // Runtime info is a separate concern from tasks — different volatility
    // (server boot vs. per-action), different consumer (footer vs. tree),
    // no shared invariants. Keeping it in its own namespace avoids wedging
    // an unrelated read into the tasks contract.
    runtime: {
      info: {
        input: z.void(),
        output: RuntimeInfoSchema,
      },
    },
  },
});
