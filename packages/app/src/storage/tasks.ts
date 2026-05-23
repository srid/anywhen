import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "./schema";
import type { MoveTaskInput, Task, TaskId } from "../shared/schemas";

// Row type derives from Kysely's `Selectable<TasksTable>` so the SELECT
// shape stays in lockstep with the schema interface — adding a column in
// schema.ts (and a migration) updates this type for free. The domain
// `Task` (camelCase ISO strings) is what crosses out of storage/;
// `rowToTask` is the explicit boundary. No CamelCasePlugin: the mapping
// stays visible at one site.
type DbTask = Selectable<Database["tasks"]>;

const rowToTask = (r: DbTask): Task => ({
  id: r.id,
  parentId: r.parent_id,
  title: r.title,
  status: r.status,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Initial spacing between sibling positions, also the step size when
// appending to the end of a parent. Float midpoints can interpolate ~50
// times between two siblings before precision collapses; values smaller
// than that would force a rebalance scan to ship alongside the move op.
// 100 leaves comfortable headroom and matches the gap `add()` uses for
// new tasks so positions allocated at insert time and at move time stay
// in the same dynamic range.
const POSITION_GAP = 100;

export const taskStore = (db: Kysely<Database>) => {
  return {
    async list(): Promise<Task[]> {
      const rows = await db.selectFrom("tasks").selectAll().orderBy("position", "asc").execute();
      return rows.map(rowToTask);
    },

    // Transactional: the synchronous bun:sqlite store ran read+insert
    // atomically by virtue of being non-async; the Kysely rewrite yields
    // the event loop between awaits, so the max-position read and the
    // insert need to share a transaction or a concurrent caller could
    // pick the same position.
    async add(input: { title: string; parentId: TaskId | null }): Promise<Task> {
      const id = randomUUID();
      const now = new Date().toISOString();
      return db.transaction().execute(async (trx) => {
        const maxRow = await trx
          .selectFrom("tasks")
          .select((eb) => eb.fn.max<number | null>("position").as("max_pos"))
          .where((eb) =>
            input.parentId === null
              ? eb("parent_id", "is", null)
              : eb("parent_id", "=", input.parentId),
          )
          .executeTakeFirst();
        const position = (maxRow?.max_pos ?? 0) + POSITION_GAP;
        const row = await trx
          .insertInto("tasks")
          .values({
            id,
            parent_id: input.parentId,
            title: input.title,
            status: "todo",
            position,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return rowToTask(row);
      });
    },

    // Reorder by semantic drop target. `before`/`after` make the task a
    // sibling of refId; `inside` makes it the last child. Server resolves
    // the (parentId, position) so clients never compute float midpoints.
    // Rejects: moving into self, or any move that would make an ancestor
    // become its own descendant. Dropping a task adjacent to itself is
    // permitted and resolves to an idempotent position update. The whole
    // sequence runs in a transaction because the position calculation
    // reads neighbour positions and the resulting update has to land
    // against the same snapshot — without the txn, a concurrent insert
    // could create a duplicate position between the read and the write.
    async move(input: MoveTaskInput): Promise<void> {
      const { id, target } = input;
      await db.transaction().execute(async (trx) => {
        const task = await trx
          .selectFrom("tasks")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        if (!task) throw new Error(`Task ${id} not found`);
        const ref = await trx
          .selectFrom("tasks")
          .selectAll()
          .where("id", "=", target.refId)
          .executeTakeFirst();
        if (!ref) throw new Error(`Task ${target.refId} not found`);
        if (id === target.refId) throw new Error("Cannot move a task relative to itself");

        const newParentId: TaskId | null = target.kind === "inside" ? ref.id : ref.parent_id;

        // Cycle check: walk up from the prospective new parent; if we hit
        // the moving task, the move would orphan its current subtree under
        // itself.
        let cursor: string | null = newParentId;
        while (cursor) {
          if (cursor === id) throw new Error(`Cannot move task ${id} into its own subtree`);
          const parent = await trx
            .selectFrom("tasks")
            .select("parent_id")
            .where("id", "=", cursor)
            .executeTakeFirst();
          cursor = parent ? parent.parent_id : null;
        }

        let newPosition: number;
        if (target.kind === "inside") {
          const maxChild = await trx
            .selectFrom("tasks")
            .select((eb) => eb.fn.max<number | null>("position").as("max_pos"))
            .where("parent_id", "=", ref.id)
            .where("id", "!=", id)
            .executeTakeFirst();
          newPosition = (maxChild?.max_pos ?? 0) + POSITION_GAP;
        } else if (target.kind === "before") {
          const prev = await trx
            .selectFrom("tasks")
            .select("position")
            .where((eb) =>
              ref.parent_id === null
                ? eb("parent_id", "is", null)
                : eb("parent_id", "=", ref.parent_id),
            )
            .where("position", "<", ref.position)
            .where("id", "!=", id)
            .orderBy("position", "desc")
            .limit(1)
            .executeTakeFirst();
          newPosition = prev ? (prev.position + ref.position) / 2 : ref.position - POSITION_GAP;
        } else {
          const next = await trx
            .selectFrom("tasks")
            .select("position")
            .where((eb) =>
              ref.parent_id === null
                ? eb("parent_id", "is", null)
                : eb("parent_id", "=", ref.parent_id),
            )
            .where("position", ">", ref.position)
            .where("id", "!=", id)
            .orderBy("position", "asc")
            .limit(1)
            .executeTakeFirst();
          newPosition = next ? (ref.position + next.position) / 2 : ref.position + POSITION_GAP;
        }

        await trx
          .updateTable("tasks")
          .set({
            parent_id: newParentId,
            position: newPosition,
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", id)
          .execute();
      });
    },

    // Transactional: read-then-flip is a lost-update risk without a txn,
    // since the async boundary lets a concurrent toggle land between the
    // status read and the update write.
    async toggle(id: TaskId): Promise<Task> {
      return db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom("tasks")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        if (!current) throw new Error(`Task ${id} not found`);
        const next = current.status === "todo" ? "done" : "todo";
        const updated = await trx
          .updateTable("tasks")
          .set({ status: next, updated_at: new Date().toISOString() })
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return rowToTask(updated);
      });
    },

    // Descendants cascade via the parent_id FK ON DELETE CASCADE (set up
    // in the init migration). Missing ids are a no-op — the UI may
    // double-fire on optimistic delete + refetch and the second call
    // should not throw.
    async remove(id: TaskId): Promise<void> {
      await db.deleteFrom("tasks").where("id", "=", id).execute();
    },

    // Test-only: drop every row. Called by cucumber's "Given the app is
    // running with a fresh database" so multiple scenarios can share one
    // server process without state bleed.
    async reset(): Promise<void> {
      await db.deleteFrom("tasks").execute();
    },
  };
};

/** Public storage interface for the tasks domain; consumed by `router.ts`. */
export type TaskStore = ReturnType<typeof taskStore>;
