// Kysely Database interface — the storage-row shape, distinct from the
// camelCase domain `Task` in shared/schemas.ts. Keys here are snake_case
// (matching the SQL columns); the explicit `rowToTask` mapper in tasks.ts
// is the boundary to camelCase. No CamelCasePlugin: the mapper stays
// visible at one site rather than being distributed as an implicit
// per-query rename. New tables get a new interface here and a new entry
// on the `Database` map; migrations under ./migrations/ create the
// columns referenced by these interfaces.

import type { TaskStatus } from "../shared/schemas";

/** Kysely DB type map — table name → row interface. New tables get an entry here. */
export interface Database {
  tasks: TasksTable;
}

/** Row shape for `tasks`. Keys are snake_case so they match the SQL columns directly. */
export interface TasksTable {
  id: string;
  parent_id: string | null;
  title: string;
  status: TaskStatus;
  position: number;
  created_at: string;
  updated_at: string;
  /** ISO timestamp of the most recent todo→done flip; null while status='todo'. */
  completed_at: string | null;
}
