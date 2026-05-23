import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { MoveTaskInput, Task, TaskId } from "../shared/schemas";

// Row type stays internal to storage/. Domain `Task` (camelCase ISO strings)
// is what crosses the module boundary; SQLite snake_case never leaks.
type DbTask = {
  id: string;
  parent_id: string | null;
  title: string;
  status: "todo" | "done";
  position: number;
  created_at: string;
  updated_at: string;
};

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

export const taskStore = (db: Database) => {
  const listStmt = db.query<DbTask, []>("SELECT * FROM tasks ORDER BY position ASC");
  const getStmt = db.query<DbTask, [TaskId]>("SELECT * FROM tasks WHERE id = ?");
  const maxPositionStmt = db.query<{ max_pos: number | null }, [TaskId | null]>(
    "SELECT MAX(position) AS max_pos FROM tasks WHERE parent_id IS ?",
  );
  const insertStmt = db.query(
    "INSERT INTO tasks (id, parent_id, title, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const setStatusStmt = db.query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?");
  const removeStmt = db.query("DELETE FROM tasks WHERE id = ?");
  const movePositionStmt = db.query(
    "UPDATE tasks SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?",
  );
  const upsertStmt = db.query(
    "INSERT OR REPLACE INTO tasks (id, parent_id, title, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  // Sibling immediately before/after `position` within `parentId`, excluding
  // `excludeId` (the task being moved — otherwise reordering within the same
  // parent picks itself as its own neighbor).
  const prevSiblingStmt = db.query<{ position: number }, [TaskId | null, number, TaskId]>(
    "SELECT position FROM tasks WHERE parent_id IS ? AND position < ? AND id != ? ORDER BY position DESC LIMIT 1",
  );
  const nextSiblingStmt = db.query<{ position: number }, [TaskId | null, number, TaskId]>(
    "SELECT position FROM tasks WHERE parent_id IS ? AND position > ? AND id != ? ORDER BY position ASC LIMIT 1",
  );
  const maxChildPositionStmt = db.query<{ max_pos: number | null }, [TaskId, TaskId]>(
    "SELECT MAX(position) AS max_pos FROM tasks WHERE parent_id IS ? AND id != ?",
  );

  return {
    list(): Task[] {
      return listStmt.all().map(rowToTask);
    },

    // Keyed view consumed by the Collection's `readAll` — the framework
    // wraps it in the snapshot-then-deltas iterator for `tasks.keys` and
    // `tasks.get(id)`. Sharing the iteration order with `list()` keeps the
    // Collection's first-snapshot stable across deploys.
    listMap(): Map<TaskId, Task> {
      const out = new Map<TaskId, Task>();
      for (const row of listStmt.all()) out.set(row.id, rowToTask(row));
      return out;
    },

    // INSERT OR REPLACE writer for the Collection's `upsert` deps. Procedures
    // (add / toggle / move) already wrote their own rows via verb-specific
    // statements — this exists for the rare wire-level upsert path and so
    // the Collection's deps callback type-checks. Idempotent against the
    // values the procedures wrote, so no double-write side effects.
    upsert(task: Task): void {
      upsertStmt.run(
        task.id,
        task.parentId,
        task.title,
        task.status,
        task.position,
        task.createdAt,
        task.updatedAt,
      );
    },

    add(input: { title: string; parentId: TaskId | null }): Task {
      const id = randomUUID();
      const now = new Date().toISOString();
      const { max_pos } = maxPositionStmt.get(input.parentId) ?? { max_pos: null };
      const position = (max_pos ?? 0) + POSITION_GAP;
      insertStmt.run(id, input.parentId, input.title, "todo", position, now, now);
      const row = getStmt.get(id);
      if (!row) throw new Error(`Failed to read back inserted task ${id}`);
      return rowToTask(row);
    },

    // Reorder by semantic drop target. `before`/`after` make the task a
    // sibling of refId; `inside` makes it the last child. Server resolves
    // the (parentId, position) so clients never compute float midpoints.
    // Rejects: moving into self, or any move that would make an ancestor
    // become its own descendant. Dropping a task adjacent to itself is
    // permitted and resolves to an idempotent position update.
    // Returns the moved task so the router can publish an upsert delta
    // without a second `listMap()` round-trip.
    move(input: MoveTaskInput): Task {
      const { id, target } = input;
      const task = getStmt.get(id);
      if (!task) throw new Error(`Task ${id} not found`);
      const ref = getStmt.get(target.refId);
      if (!ref) throw new Error(`Task ${target.refId} not found`);
      if (id === target.refId) throw new Error("Cannot move a task relative to itself");

      const newParentId: TaskId | null = target.kind === "inside" ? ref.id : ref.parent_id;

      // Cycle check: walk up from the prospective new parent; if we hit the
      // moving task, the move would orphan its current subtree under itself.
      let cursor: string | null = newParentId;
      while (cursor) {
        if (cursor === id) throw new Error(`Cannot move task ${id} into its own subtree`);
        const parent = getStmt.get(cursor);
        cursor = parent ? parent.parent_id : null;
      }

      let newPosition: number;
      if (target.kind === "inside") {
        const { max_pos } = maxChildPositionStmt.get(ref.id, id) ?? { max_pos: null };
        newPosition = (max_pos ?? 0) + POSITION_GAP;
      } else if (target.kind === "before") {
        const prev = prevSiblingStmt.get(ref.parent_id, ref.position, id);
        newPosition = prev ? (prev.position + ref.position) / 2 : ref.position - POSITION_GAP;
      } else {
        const next = nextSiblingStmt.get(ref.parent_id, ref.position, id);
        newPosition = next ? (ref.position + next.position) / 2 : ref.position + POSITION_GAP;
      }

      movePositionStmt.run(newParentId, newPosition, new Date().toISOString(), id);
      const updated = getStmt.get(id);
      if (!updated) throw new Error(`Task ${id} disappeared after move`);
      return rowToTask(updated);
    },

    toggle(id: TaskId): Task {
      const current = getStmt.get(id);
      if (!current) throw new Error(`Task ${id} not found`);
      const next = current.status === "todo" ? "done" : "todo";
      setStatusStmt.run(next, new Date().toISOString(), id);
      const updated = getStmt.get(id);
      if (!updated) throw new Error(`Task ${id} disappeared after update`);
      return rowToTask(updated);
    },

    // Descendants cascade via the parent_id FK ON DELETE CASCADE
    // (schema.sql). Missing ids are a no-op — the UI may double-fire on
    // optimistic delete + refetch and the second call should not throw.
    remove(id: TaskId): void {
      removeStmt.run(id);
    },

    // Test-only: drop every row. Called by cucumber's "Given the app is
    // running with a fresh database" so multiple scenarios can share one
    // server process without state bleed.
    reset(): void {
      db.exec("DELETE FROM tasks");
    },
  };
};

export type TaskStore = ReturnType<typeof taskStore>;
