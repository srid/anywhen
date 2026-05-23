// Kysely Database interface — the storage-row shape, distinct from the
// camelCase domain `Task` in shared/schemas.ts. Keys here are snake_case
// (matching the SQL columns); the explicit `rowToTask` mapper in tasks.ts
// is the boundary to camelCase. No CamelCasePlugin: the mapper stays
// visible at one site rather than being distributed as an implicit
// per-query rename. New tables get a new interface here and a new entry
// on the `Database` map; migrations under ./migrations/ create the
// columns referenced by these interfaces.

export interface Database {
  tasks: TasksTable;
}

export interface TasksTable {
  id: string;
  parent_id: string | null;
  title: string;
  status: "todo" | "done";
  position: number;
  created_at: string;
  updated_at: string;
}
