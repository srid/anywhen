import { randomUUID } from "node:crypto";
import {
  type Expression,
  type ExpressionBuilder,
  type Kysely,
  type Selectable,
  sql,
  type SqlBool,
} from "kysely";
import type { Database } from "./schema";
import type { MoveTaskInput, Task, TaskId } from "../shared/schemas";

// Row type derives from Kysely's `Selectable<TasksTable>` so the SELECT
// shape stays in lockstep with the schema interface — adding a column in
// schema.ts (and a migration) updates this type for free. The domain
// `Task` (camelCase ISO strings) is what crosses out of storage/;
// `rowToTask` is the explicit boundary. No CamelCasePlugin: the mapping
// stays visible at one site.
type DbTask = Selectable<Database["tasks"]>;

// Kysely requires 'is' (not '=') for null comparisons; this helper
// centralises the switch so call-sites read as plain English.
const whereParentIs =
  (parentId: TaskId | null) =>
  (eb: ExpressionBuilder<Database, "tasks">): Expression<SqlBool> =>
    parentId === null ? eb("parent_id", "is", null) : eb("parent_id", "=", parentId);

// Returns the position of the nearest sibling in direction `dir` relative to
// `refPosition` within the same parent, excluding `excludeId`. Used by move()
// to compute the float midpoint for before/after placements.
async function nearestSibling(
  trx: Kysely<Database>,
  parentId: TaskId | null,
  refPosition: number,
  excludeId: TaskId,
  dir: "before" | "after",
): Promise<number | undefined> {
  const row = await trx
    .selectFrom("tasks")
    .select("position")
    .where(whereParentIs(parentId))
    .where("position", dir === "before" ? "<" : ">", refPosition)
    .where("id", "!=", excludeId)
    .orderBy("position", dir === "before" ? "desc" : "asc")
    .limit(1)
    .executeTakeFirst();
  return row?.position;
}

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

    // Keyed view consumed by the Collection's `readAll` — the framework
    // wraps it in the snapshot-then-deltas iterator for `tasks.keys` and
    // `tasks.get(id)`. Same row source and order as `list()` so the
    // Collection's first snapshot is stable across deploys.
    async listMap(): Promise<Map<TaskId, Task>> {
      const rows = await db.selectFrom("tasks").selectAll().orderBy("position", "asc").execute();
      const out = new Map<TaskId, Task>();
      for (const row of rows) out.set(row.id, rowToTask(row));
      return out;
    },

    // INSERT OR REPLACE writer for the Collection's `upsert` deps. The
    // verb-specific procedures (add / toggle / move) already wrote their
    // own rows; this exists so the Collection's deps callback can route
    // wire-level upserts through SQL too. Idempotent against values the
    // procedures wrote — no double-write side effects.
    async upsert(task: Task): Promise<void> {
      await db
        .insertInto("tasks")
        .values({
          id: task.id,
          parent_id: task.parentId,
          title: task.title,
          status: task.status,
          position: task.position,
          created_at: task.createdAt,
          updated_at: task.updatedAt,
        })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({
            parent_id: task.parentId,
            title: task.title,
            status: task.status,
            position: task.position,
            created_at: task.createdAt,
            updated_at: task.updatedAt,
          }),
        )
        .execute();
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
          .where(whereParentIs(input.parentId))
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
    // permitted and resolves to an idempotent position update. Returns
    // the updated row so the Collection's upsert fan-out can publish
    // without a second round-trip. The whole sequence runs in a
    // transaction — the position calculation reads neighbour positions
    // and the resulting update has to land against the same snapshot.
    async move(input: MoveTaskInput): Promise<Task> {
      const { id, target } = input;
      return db.transaction().execute(async (trx) => {
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
          const prev = await nearestSibling(trx, ref.parent_id, ref.position, id, "before");
          newPosition =
            prev !== undefined ? (prev + ref.position) / 2 : ref.position - POSITION_GAP;
        } else {
          const next = await nearestSibling(trx, ref.parent_id, ref.position, id, "after");
          newPosition =
            next !== undefined ? (ref.position + next) / 2 : ref.position + POSITION_GAP;
        }

        const updated = await trx
          .updateTable("tasks")
          .set({
            parent_id: newParentId,
            position: newPosition,
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return rowToTask(updated);
      });
    },

    // Rename a task. No read-then-write race here (unlike toggle, which
    // must read status to flip it), so no transaction is needed —
    // the UPDATE is a single atomic statement. Title is validated non-empty
    // at the wire boundary via `EditTaskInputSchema`.
    // `executeTakeFirstOrThrow` implicitly signals a missing id.
    async edit(id: TaskId, title: string): Promise<Task> {
      const updated = await db
        .updateTable("tasks")
        .set({ title, updated_at: new Date().toISOString() })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return rowToTask(updated);
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

    // Wipe-and-replace, transactional. The import path writes the exported
    // snapshot back verbatim — same ids, positions, timestamps — so restore
    // reproduces the pre-export state. PRAGMA defer_foreign_keys lets the
    // bulk insert run in any order: parent rows and child rows land
    // independently and the FK check fires once at commit. Without this,
    // children inserted before their parents would fail mid-transaction.
    async replaceAll(tasks: Task[]): Promise<void> {
      await db.transaction().execute(async (trx) => {
        await sql`PRAGMA defer_foreign_keys = ON`.execute(trx);
        await trx.deleteFrom("tasks").execute();
        if (tasks.length === 0) return;
        await trx
          .insertInto("tasks")
          .values(
            tasks.map((t) => ({
              id: t.id,
              parent_id: t.parentId,
              title: t.title,
              status: t.status,
              position: t.position,
              created_at: t.createdAt,
              updated_at: t.updatedAt,
            })),
          )
          .execute();
      });
    },
  };
};

/** Public storage interface for the tasks domain; consumed by `router.ts`. */
export type TaskStore = ReturnType<typeof taskStore>;
