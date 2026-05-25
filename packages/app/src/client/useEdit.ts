// Edit lifecycle: own the `editing` signal plus the four entry points the
// row JSX wires to (beginEdit, commitEdit, cancelEdit, handleEditKeyDown).
// The `originalTitle` baseline is captured at beginEdit time so the
// unchanged-title guard and the input's aria-label read a stable value,
// not the live row (which can drift between mount and commit if a
// Collection delta arrives). `draft` evolves with the user's input;
// `setDraft` is the narrow setter the inline textarea binds to.

import { type Accessor, createSignal } from "solid-js";
import type { Task, TaskId } from "../shared/schemas";
import type { CallWrite } from "./rpc";

export type EditingState = { id: TaskId; originalTitle: string; draft: string } | null;

type EditApi = { edit: (input: { id: TaskId; title: string }) => Promise<Task> };

// `onEditClosed` is the post-close focus-delivery callback the parent
// wires up: the row that just left edit mode usually regains keyboard
// focus so vim navigation continues. The module takes a plain
// `(id) => void` rather than a SolidJS `Setter<TaskId | null>` so the
// edit-management axis doesn't leak the parent's reactivity primitive
// into its public surface.
export const useEdit = (
  api: EditApi,
  taskList: Accessor<Task[]>,
  onEditClosed: (id: TaskId) => void,
  callWrite: CallWrite,
) => {
  const [editing, setEditing] = createSignal<EditingState>(null);

  const setDraft = (draft: string) => {
    const current = editing();
    if (!current) return;
    setEditing({ ...current, draft });
  };

  const beginEdit = (id: TaskId) => {
    const task = taskList().find((t) => t.id === id);
    if (!task) return;
    setEditing({ id, originalTitle: task.title, draft: task.title });
  };

  // Tear down the edit session and notify the parent so it can deliver
  // keyboard focus back to the row (vim navigation continues from there).
  const closeEdit = (id: TaskId) => {
    setEditing(null);
    onEditClosed(id);
  };

  const cancelEdit = () => {
    const e = editing();
    if (!e) return;
    closeEdit(e.id);
  };

  // Commit the current draft if it's non-empty and actually changed. Trimming
  // mirrors the server's `min(1)` validation — a whitespace-only draft is a
  // no-op, not an error, so the user doesn't see a server rejection for
  // tapping outside an accidentally-cleared input. On a failed mutation we
  // keep the editor open with the draft intact: tearing down would discard
  // the user's typing, leaving no path back to the input.
  //
  // The post-await teardown is gated on `editing()?.id === e.id` — without
  // that check, a stale commit (e.g. a blur fired while the mutation was
  // in flight, then the user opened a fresh edit on a different row) would
  // wipe the new session.
  const commitEdit = async () => {
    const e = editing();
    if (!e) return;
    const title = e.draft.trim();
    if (!title || title === e.originalTitle) {
      closeEdit(e.id);
      return;
    }
    const result = await callWrite(() => api.edit({ id: e.id, title }));
    if (result === undefined) return;
    if (editing()?.id !== e.id) return;
    closeEdit(e.id);
  };

  // Editor key handling kept adjacent to the other edit lifecycle functions
  // so "what keys edit mode responds to" is one cohesive unit. Every key
  // stops propagation so the row's vim handler can't fire on typing keys
  // (the row guard at handleRowKeyDown is the primary defense; this is
  // belt-and-suspenders). Enter commits; Escape discards.
  const handleEditKeyDown = (ev: KeyboardEvent) => {
    ev.stopPropagation();
    if (ev.key === "Enter" && !ev.shiftKey) {
      // Plain Enter commits; Shift+Enter inserts a newline so the editor
      // can grow into a multi-line body without leaving the row.
      ev.preventDefault();
      void commitEdit();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancelEdit();
    }
  };

  return {
    editing,
    setDraft,
    beginEdit,
    commitEdit,
    cancelEdit,
    handleEditKeyDown,
  };
};

export type UseEditReturn = ReturnType<typeof useEdit>;
