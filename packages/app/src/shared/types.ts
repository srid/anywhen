// Domain types — single source of truth. SQLite row shape stays inside
// storage/. New fields (body, tags, due, recurrence) widen this schema in
// later PRs; PR 1 ships the minimum that lets the UI add, view, and toggle.

export type TaskId = string;
export type TaskStatus = "todo" | "done";

export type Task = {
  id: TaskId;
  parentId: TaskId | null;
  title: string;
  status: TaskStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
};
