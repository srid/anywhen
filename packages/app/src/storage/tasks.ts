import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Task, TaskId } from "../shared/schemas";

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

const POSITION_GAP = 100;

export const taskStore = (db: Database) => {
  const listStmt = db.query<DbTask, []>("SELECT * FROM tasks ORDER BY position ASC");
  const getStmt = db.query<DbTask, [TaskId]>("SELECT * FROM tasks WHERE id = ?");
  const maxPositionStmt = db.query<{ max_pos: number | null }, [TaskId | null]>(
    "SELECT MAX(position) AS max_pos FROM tasks WHERE parent_id IS ?",
  );
  const insertStmt = db.prepare(
    "INSERT INTO tasks (id, parent_id, title, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const setStatusStmt = db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?");
  const removeStmt = db.prepare("DELETE FROM tasks WHERE id = ?");

  return {
    list(): Task[] {
      return listStmt.all().map(rowToTask);
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
