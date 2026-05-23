// Live tree view over the `tasks` Collection. `app.collections.tasks.use()`
// subscribes to the server's keys stream and, per key, the per-row value
// stream — snapshot-then-deltas semantics keep the UI eventually consistent
// without an explicit refetch after each mutation.
//
// The search box is a single concept: typing filters the tree live. Creating
// a task is a separate action — Cmd/Ctrl+Enter from the keyboard, or the
// visible Add button (works the same on desktop and touch). The input grammar
// no longer overloads "+ prefix" with two meanings.
//
// Drag-to-reorder uses Pointer Events (not HTML5 DnD) so the same code path
// covers mouse, touch, and pen. Touch initiates drag via a short long-press
// so vertical scroll on a row remains a finger-flick away.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { matchesQuery } from "../shared/filter";
import { normalizeQuery } from "../shared/input";
import {
  BackupSchema,
  DRAG_LONGPRESS_MS,
  type DropZone,
  type MoveTarget,
  type Task,
  type TaskId,
  ZONE_AFTER_RATIO,
  ZONE_BEFORE_RATIO,
} from "../shared/schemas";
import { ancestorIds, descendantIds } from "../shared/tree";
import { highlightSegments } from "./highlight";
import { app } from "./wire";

const api = app.rpc.surface.tasks;
const runtimeApi = app.rpc.surface.runtime;

const REPO_URL = "https://github.com/srid/anywhen";

// ── Tree derivation: flat Task[] → ordered, indented rows ─────────────
type Row = { task: Task; depth: number; dimmed: boolean };

const byParentMap = (tasks: Task[]): Map<TaskId | null, Task[]> => {
  const out = new Map<TaskId | null, Task[]>();
  for (const t of tasks) {
    const arr = out.get(t.parentId) ?? [];
    arr.push(t);
    out.set(t.parentId, arr);
  }
  return out;
};

// Single DFS walk: position-orders siblings, visits parent before children,
// and records depth inline — one byParentMap, one allocation, one traversal.
const sortedWithDepths = (tasks: Task[]): { task: Task; depth: number }[] => {
  const byParent = byParentMap(tasks);
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position);
  const out: { task: Task; depth: number }[] = [];
  const walk = (parentId: TaskId | null, depth: number) => {
    for (const t of byParent.get(parentId) ?? []) {
      out.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
};

// Map a pointer's Y inside a row to a drop zone. Top quarter → before, bottom
// quarter → after, middle half → inside (re-parent). Symmetric so the user
// can always nudge a task one step up, one step down, or one level deeper.
const zoneAt = (offsetY: number, height: number): DropZone => {
  if (height <= 0) return "inside";
  const ratio = offsetY / height;
  if (ratio < ZONE_BEFORE_RATIO) return "before";
  if (ratio > ZONE_AFTER_RATIO) return "after";
  return "inside";
};

const siblingsOf = (
  tasks: Task[],
  id: TaskId,
): { siblings: Task[]; index: number; task: Task } | null => {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const siblings = (byParentMap(tasks).get(task.parentId) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((s) => s.id === id);
  return { siblings, index, task };
};

type KeyMove = "indent" | "outdent" | "up" | "down";

const resolveKeyMove = (tasks: Task[], id: TaskId, action: KeyMove): MoveTarget | null => {
  const sib = siblingsOf(tasks, id);
  if (!sib) return null;
  if (action === "outdent") {
    return sib.task.parentId ? { kind: "after", refId: sib.task.parentId } : null;
  }
  if (action === "indent") {
    const prev = sib.siblings[sib.index - 1];
    return prev ? { kind: "inside", refId: prev.id } : null;
  }
  const offset = action === "up" ? -1 : 1;
  const ref = sib.siblings[sib.index + offset];
  return ref ? { kind: action === "up" ? "before" : "after", refId: ref.id } : null;
};

type DragSnapshot = { id: TaskId; descendants: Set<TaskId> };

// Pointer-events drag state. A row's pointerdown stages a "pending press";
// the drag commits only when the user moves past DRAG_MOVE_THRESHOLD (mouse)
// or holds for DRAG_LONGPRESS_MS without moving (touch / pen).
type PendingPress = {
  id: TaskId;
  startX: number;
  startY: number;
  pointerType: string;
  longPressTimer?: ReturnType<typeof setTimeout>;
};

// Distance the pointer must travel before a mouse press becomes a drag. Below
// this threshold the press is treated as a click (select / focus).
const DRAG_MOVE_THRESHOLD = 5;

// Backup filename uses the local date — Dropbox-friendly, sorts well,
// and matches the unit the user thinks in ("today's backup").
const backupFilename = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `anywhen-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
};

export function App() {
  // Live subscription to the tasks Collection. `notes.keys()` is a reactive
  // accessor; `notes.byKey(id)?.()` is the per-row value, undefined until
  // its first snapshot lands.
  const tasksColl = app.collections.tasks.use({
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<TaskId | null>(null);
  // "Which row should hold keyboard focus" — a render-lifecycle instruction,
  // distinct from `selected` (the logical/aria selection driving styling). A
  // per-row `createEffect` inside the <For> below re-applies focus whenever
  // this signal matches the row's id. Setting focusedId from a mutation
  // handler survives the <For>'s teardown-and-rebuild when the Collection
  // delta arrives — the new row's effect runs on mount and reads the signal.
  const [focusedId, setFocusedId] = createSignal<TaskId | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // Server-reported runtime metadata for the footer. Static at boot, so
  // one fetch on mount is enough — no re-fetch on focus, no polling.
  const [runtimeInfo] = createResource(() => runtimeApi.info());
  // Surface fetch failures explicitly rather than letting the footer sit
  // on its "…" placeholder forever. A console error is enough for a
  // single-user local app — there's no other UI to swap in.
  createEffect(() => {
    const err = runtimeInfo.error;
    if (err) console.error("[runtime] info fetch failed:", err);
  });
  let searchInputRef!: HTMLInputElement;
  let importInputRef!: HTMLInputElement;

  // Reconstruct the flat task list from the keys + per-key values. Each
  // value may still be undefined immediately after its key arrived; filter
  // those out so renders never see partial rows.
  const taskList = createMemo<Task[]>(() => {
    const keys = tasksColl.keys() as TaskId[];
    const tasks: Task[] = [];
    for (const k of keys) {
      const v = tasksColl.byKey(k)?.();
      if (v) tasks.push(v as Task);
    }
    return tasks;
  });

  // The normalized non-empty query. Empty input → null so both the filter
  // pipeline (skip when null) and the create path (refuse to add) read the
  // same gate.
  const activeQuery = createMemo<string | null>(() => normalizeQuery(query()) || null);

  const sorted = createMemo<{ task: Task; depth: number }[]>(() => sortedWithDepths(taskList()));

  const rows = createMemo<Row[]>(() => {
    const list = sorted();
    const q = activeQuery();
    if (!q) {
      return list.map(({ task, depth }) => ({ task, depth, dimmed: false }));
    }
    const byId = new Map<TaskId, Task>(list.map(({ task: t }) => [t.id, t]));
    const matched = new Set<TaskId>();
    for (const { task: t } of list) if (matchesQuery(t.title, q)) matched.add(t.id);
    const ancestors = ancestorIds(matched, (id) => byId.get(id)?.parentId ?? null);
    return list
      .filter(({ task: t }) => matched.has(t.id) || ancestors.has(t.id))
      .map(({ task, depth }) => ({
        task,
        depth,
        dimmed: !matched.has(task.id),
      }));
  });

  // Two variants so the "success clears the error toast" policy applies
  // only where it makes sense — to user-initiated *writes* whose success
  // implies the prior failure is resolved. A successful read (export)
  // shouldn't silently erase an unrelated error the user is still looking
  // at, so callQuery captures failures but does not touch a stale toast.
  const captureError = (err: unknown): undefined => {
    setError(err instanceof Error ? err.message : String(err));
    return undefined;
  };

  const callWrite = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (err) {
      return captureError(err);
    }
  };

  const callQuery = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      return captureError(err);
    }
  };

  const createFromInput = async () => {
    const title = activeQuery();
    if (!title) return;
    // Clear the input synchronously before the await so subsequent keystrokes
    // aren't clobbered by a late `setQuery("")` after the mutation resolves.
    setQuery("");
    const created = await callWrite(() => api.add({ title, parentId: null }));
    if (created) setSelected(created.id);
  };

  const handleSearchKeyDown = async (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    // Enter commits the current input as a new task — same action as the
    // visible Add button, just the keyboard path. The live filter already
    // applied as the user typed, so Enter has no other meaning here.
    e.preventDefault();
    await createFromInput();
  };

  const toggle = async (id: TaskId) => {
    await callWrite(() => api.toggle(id));
    setFocusedId(id);
  };

  const remove = async (id: TaskId) => {
    await callWrite(() => api.remove(id));
    if (!error() && selected() === id) setSelected(null);
  };

  const moveByKey = async (id: TaskId, action: KeyMove) => {
    const target = resolveKeyMove(taskList(), id, action);
    if (!target) return;
    await callWrite(() => api.move({ id, target }));
    setFocusedId(id);
  };

  const moveSelection = (id: TaskId, offset: 1 | -1) => {
    const rs = rows();
    const idx = rs.findIndex((r) => r.task.id === id);
    if (idx < 0) return;
    const next = rs[idx + offset];
    if (!next) return;
    setSelected(next.task.id);
    setFocusedId(next.task.id);
  };

  // Vim-style row bindings, with WAI-ARIA tree-pattern aliases. Each action
  // lists its vim primary first; ArrowUp/Down + Tab/Shift+Tab + Backspace
  // are the ARIA-required aliases (the tree/treeitem roles on the rows are
  // a contract screen-reader users navigate by), and Alt+ArrowUp/Down stay
  // as the legacy reorder aliases.
  //
  // Ctrl/Meta chords cede to the browser. Alt is consumed only by the
  // ArrowUp/Down reorder aliases, so plain Alt+x or Alt+j fall through to
  // the browser unchanged.
  //
  // Composite key "Shift+Tab" is encoded as the lookup key so the Tab and
  // Shift+Tab cases don't need a nested conditional inside the handler.
  const ROW_KEY_ACTIONS: Record<string, (id: TaskId) => void> = {
    " ": (id) => void toggle(id),
    // vim primary  │  ARIA alias
    x: (id) => void remove(id),
    Backspace: (id) => void remove(id),
    j: (id) => moveSelection(id, 1),
    ArrowDown: (id) => moveSelection(id, 1),
    k: (id) => moveSelection(id, -1),
    ArrowUp: (id) => moveSelection(id, -1),
    J: (id) => void moveByKey(id, "down"),
    K: (id) => void moveByKey(id, "up"),
    l: (id) => void moveByKey(id, "indent"),
    Tab: (id) => void moveByKey(id, "indent"),
    h: (id) => void moveByKey(id, "outdent"),
    "Shift+Tab": (id) => void moveByKey(id, "outdent"),
  };

  const handleRowKeyDown = (e: KeyboardEvent, id: TaskId) => {
    if (e.ctrlKey || e.metaKey) return;

    // Alt is consumed only by the legacy ArrowUp/Down reorder aliases; any
    // other alt-chord falls through to the browser unchanged.
    if (e.altKey) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        void moveByKey(id, "down");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        void moveByKey(id, "up");
      }
      return;
    }

    const key = e.shiftKey && e.key === "Tab" ? "Shift+Tab" : e.key;
    const action = ROW_KEY_ACTIONS[key];
    if (action) {
      e.preventDefault();
      action(id);
    }
  };

  const exportTasks = async () => {
    const backup = await callQuery(() => api.export());
    if (!backup) return;
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(`Import failed: not valid JSON (${err instanceof Error ? err.message : err})`);
      return;
    }
    const validated = BackupSchema.safeParse(parsed);
    if (!validated.success) {
      setError(`Import failed: file does not match the backup format (${validated.error.message})`);
      return;
    }
    const count = validated.data.tasks.length;
    // Destructive: confirm before wiping the current store. The current
    // codebase has no in-app modal pattern; window.confirm is the simplest
    // accessible blocker for an action the user can't undo from inside
    // the app.
    if (!window.confirm(`Replace all current tasks with ${count} from ${file.name}?`)) {
      return;
    }
    await callWrite(() => api.import(validated.data));
  };

  const handleImportChange = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset before any await so re-importing the same file fires `change` again.
    input.value = "";
    if (!file) return;
    await handleImportFile(file);
  };

  onMount(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      searchInputRef.focus();
      searchInputRef.select();
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onGlobalKeyDown));
  });

  const [drag, setDrag] = createSignal<DragSnapshot | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{
    id: TaskId;
    zone: DropZone;
  } | null>(null);

  let pendingPress: PendingPress | null = null;

  const canDropOn = (rowId: TaskId): boolean => {
    const d = drag();
    if (!d || d.id === rowId) return false;
    return !d.descendants.has(rowId);
  };

  const beginDrag = (id: TaskId) => {
    const tasks = taskList();
    const byParent = byParentMap(tasks);
    const descendants = descendantIds(id, (tid) => (byParent.get(tid) ?? []).map((c) => c.id));
    // Pending-press and active-drag are mutually exclusive states. Clearing
    // here makes the invariant structural rather than relying on the
    // pointerup handler to eventually null both.
    clearPendingPress();
    setDrag({ id, descendants });
  };

  const clearPendingPress = () => {
    if (pendingPress?.longPressTimer) clearTimeout(pendingPress.longPressTimer);
    pendingPress = null;
  };

  const clearDragState = () => {
    setDrag(null);
    setDropTarget(null);
  };

  const handleRowPointerDown = (e: PointerEvent, id: TaskId) => {
    // Ignore right/middle clicks and modifier-key chords (those navigate).
    if (e.button !== 0) return;
    // Don't hijack clicks on action buttons inside the row.
    if (e.target instanceof Element && e.target.closest("button")) return;
    const sourceEl = e.currentTarget as HTMLElement;
    // Two-layer affordance. CSS (`@media (pointer: coarse)`) reveals the handle
    // span only on touch / coarse-pointer devices, so a mouse user normally
    // sees nothing to click. The JS guard below fires for ANY pointer type
    // that lands on the handle DOM node — the node is always present, just
    // visually hidden on fine pointers. When it fires, the press bypasses
    // both the long-press timer (touch / pen) and the movement threshold
    // (mouse) and begins dragging immediately.
    const fromHandle =
      e.target instanceof Element && e.target.closest('[data-testid="task-drag-handle"]') !== null;
    // Capture the pointer so subsequent pointermove/up fire on this row even
    // after the pointer leaves it. Mouse has no implicit capture; without
    // this, the first move out of the source row would lose the drag stream.
    try {
      sourceEl.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some headless environments reject capture for released pointers;
      // the drag falls back to whatever element happens to be under the pointer.
      console.warn("setPointerCapture failed:", err);
    }
    // Cancel any previous pending press before starting a new one (guards
    // against the second-finger case where a new pointerdown arrives before
    // the first long-press timer fires, which would otherwise orphan the old
    // timer until it expires).
    clearPendingPress();
    if (fromHandle) {
      beginDrag(id);
      return;
    }
    // Only stage pendingPress for the paths that actually consume it — the
    // mouse-threshold check in handleRowPointerMove and the long-press timer
    // below. The handle path above bypasses both and short-circuits here.
    pendingPress = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      pointerType: e.pointerType,
    };
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      // `press` captures the identity of this specific press so the timer
      // guard can tell if a later clearPendingPress() already cancelled it.
      const press = pendingPress;
      press.longPressTimer = setTimeout(() => {
        if (pendingPress === press) beginDrag(id);
      }, DRAG_LONGPRESS_MS);
    }
  };

  const handleRowPointerMove = (e: PointerEvent, id: TaskId) => {
    if (!drag()) {
      if (!pendingPress) return;
      const dx = e.clientX - pendingPress.startX;
      const dy = e.clientY - pendingPress.startY;
      const movedEnough = Math.hypot(dx, dy) > DRAG_MOVE_THRESHOLD;
      if (!movedEnough) return;
      if (pendingPress.pointerType === "mouse") {
        beginDrag(id);
      } else {
        // Touch moved before the long-press fired → user is scrolling, not
        // dragging. Cancel the pending press and let native scroll happen.
        clearPendingPress();
        return;
      }
    }
    // Active drag: hit-test the row visually under the pointer.
    e.preventDefault();
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const rowEl = hit?.closest('[data-testid="task-row"]') as HTMLElement | null;
    if (!rowEl) {
      setDropTarget(null);
      return;
    }
    const targetId = rowEl.getAttribute("data-task-id") as TaskId | null;
    if (!targetId || !canDropOn(targetId)) {
      setDropTarget(null);
      return;
    }
    const rect = rowEl.getBoundingClientRect();
    const zone = zoneAt(e.clientY - rect.top, rect.height);
    const current = dropTarget();
    if (!current || current.id !== targetId || current.zone !== zone) {
      setDropTarget({ id: targetId, zone });
    }
  };

  const handleRowPointerUp = (e: PointerEvent) => {
    const src = drag()?.id;
    const t = dropTarget();
    clearPendingPress();
    clearDragState();
    if (!src || !t) return;
    const target: MoveTarget = { kind: t.zone, refId: t.id };
    void callWrite(() => api.move({ id: src, target }));
  };

  const handleRowPointerCancel = () => {
    clearPendingPress();
    clearDragState();
  };

  return (
    <main>
      <header class="brand">
        <svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-linecap="round">
            <circle cx="50" cy="50" r="40" stroke-width="1.6" opacity="0.22" />
            <circle cx="50" cy="50" r="28" stroke-width="2" opacity="0.55" />
            <circle cx="50" cy="50" r="16" stroke-width="2.4" opacity="0.88" />
          </g>
          <circle cx="50" cy="50" r="6" fill="currentColor" />
        </svg>
        <h1>
          anywhen<span class="dot">.</span>
        </h1>
      </header>

      <svg class="meridian" viewBox="0 0 240 12" preserveAspectRatio="none" aria-hidden="true">
        <line
          x1="0"
          y1="6"
          x2="240"
          y2="6"
          stroke="currentColor"
          stroke-width="0.5"
          opacity="0.5"
        />
        <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}>
          {(i) => {
            const major = i % 3 === 0;
            return (
              <line
                x1={i * 20}
                x2={i * 20}
                y1={major ? 2 : 4}
                y2={major ? 10 : 8}
                stroke="currentColor"
                stroke-width={major ? 0.8 : 0.5}
                opacity={major ? 0.7 : 0.4}
              />
            );
          }}
        </For>
      </svg>

      <p class="tagline">
        A personal task manager. <em>One search box</em>: filter the tree, or add to it.
      </p>

      <Show when={error()}>
        {(msg) => (
          <div class="err" data-testid="error">
            {msg()}
          </div>
        )}
      </Show>

      <div class="search">
        <svg class="search-mark" viewBox="0 0 24 24" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" stroke-width="1" opacity="0.3" />
            <circle cx="12" cy="12" r="6" stroke-width="1.3" opacity="0.6" />
          </g>
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        </svg>
        <input
          ref={searchInputRef}
          data-testid="search-input"
          aria-label="Search or add a task"
          placeholder="Search tasks…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={handleSearchKeyDown}
          enterkeyhint="search"
        />
        <button
          type="button"
          class="add-btn"
          data-testid="add-button"
          aria-label="Add task (Enter)"
          title="Add task (Enter)"
          disabled={!activeQuery()}
          onClick={() => void createFromInput()}
        >
          Add
        </button>
      </div>

      <div class="tree" data-testid="task-tree" role="tree" aria-label="Tasks">
        <Show
          when={rows().length > 0}
          fallback={
            <div class="empty">
              {activeQuery()
                ? `No tasks match "${activeQuery()}". Press Enter to add it.`
                : "No tasks yet. Type a title and press Enter (or tap Add)."}
            </div>
          }
        >
          <For each={rows()}>
            {(row) => {
              const rowDropZone = createMemo((): DropZone | null => {
                const dt = dropTarget();
                return dt?.id === row.task.id ? dt.zone : null;
              });
              let rowEl!: HTMLDivElement;
              // When focusedId matches this row, focus its DOM element. Runs
              // on mount and whenever focusedId changes — so a mutation that
              // tears down and rebuilds this row (Collection delta after
              // toggle / move) re-establishes focus the moment the new
              // element is bound.
              createEffect(() => {
                if (focusedId() === row.task.id) rowEl.focus();
              });
              return (
                <div
                  ref={rowEl}
                  class="row"
                  classList={{
                    "is-done": row.task.status === "done",
                    selected: selected() === row.task.id,
                    dragging: drag()?.id === row.task.id,
                    dimmed: row.dimmed,
                    "drop-before": rowDropZone() === "before",
                    "drop-after": rowDropZone() === "after",
                    "drop-inside": rowDropZone() === "inside",
                  }}
                  data-testid="task-row"
                  data-task-title={row.task.title}
                  data-task-status={row.task.status}
                  data-task-id={row.task.id}
                  data-task-parent-id={row.task.parentId ?? ""}
                  role="treeitem"
                  aria-selected={selected() === row.task.id}
                  tabIndex={0}
                  onClick={() => setSelected(row.task.id)}
                  onFocus={() => setSelected(row.task.id)}
                  onKeyDown={(e) => handleRowKeyDown(e, row.task.id)}
                  onPointerDown={(e) => handleRowPointerDown(e, row.task.id)}
                  onPointerMove={(e) => handleRowPointerMove(e, row.task.id)}
                  onPointerUp={handleRowPointerUp}
                  onPointerCancel={handleRowPointerCancel}
                  onLostPointerCapture={handleRowPointerCancel}
                >
                  <For each={Array.from({ length: row.depth })}>
                    {() => <span class="indent" />}
                  </For>
                  <span class="drag-handle" data-testid="task-drag-handle" aria-hidden="true">
                    <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
                      <circle cx="2.5" cy="3" r="1.2" />
                      <circle cx="7.5" cy="3" r="1.2" />
                      <circle cx="2.5" cy="8" r="1.2" />
                      <circle cx="7.5" cy="8" r="1.2" />
                      <circle cx="2.5" cy="13" r="1.2" />
                      <circle cx="7.5" cy="13" r="1.2" />
                    </svg>
                  </span>
                  <button
                    type="button"
                    class="check"
                    classList={{ done: row.task.status === "done" }}
                    data-testid="task-check"
                    aria-pressed={row.task.status === "done"}
                    aria-label={`Mark ${row.task.title} ${
                      row.task.status === "done" ? "not done" : "done"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggle(row.task.id);
                    }}
                  />
                  <span class="title">
                    <For each={highlightSegments(row.task.title, activeQuery() ?? "")}>
                      {(seg) => (seg.match ? <mark>{seg.text}</mark> : <span>{seg.text}</span>)}
                    </For>
                  </span>
                  <button
                    type="button"
                    class="delete"
                    data-testid="task-delete"
                    aria-label={`Delete ${row.task.title}`}
                    title="Delete (also removes any sub-tasks)"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(row.task.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      <div class="hint">
        <span>
          <kbd>↵</kbd> to add the typed task
        </span>
        <span>
          <kbd>j</kbd>
          <kbd>k</kbd> to move selection
        </span>
        <span>
          <kbd>l</kbd> / <kbd>h</kbd> to indent / outdent
        </span>
        <span>
          <kbd>⇧J</kbd>
          <kbd>⇧K</kbd> to reorder siblings
        </span>
        <span>
          <kbd>Space</kbd> toggle · <kbd>x</kbd> delete · <kbd>/</kbd> search
        </span>
      </div>

      <div class="backup" data-testid="backup">
        <span class="backup-label">Backup</span>
        <button
          type="button"
          class="backup-btn"
          data-testid="export-button"
          onClick={() => void exportTasks()}
        >
          Export
        </button>
        <span class="backup-sep">·</span>
        <button
          type="button"
          class="backup-btn"
          data-testid="import-button"
          onClick={() => importInputRef.click()}
        >
          Import
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          data-testid="import-input"
          class="backup-file"
          onChange={(e) => void handleImportChange(e)}
        />
      </div>

      <footer class="runtime" data-testid="footer-runtime">
        <a
          class="runtime-source"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="View source on GitHub"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              fill-rule="evenodd"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
          <span class="sr-only">View source on GitHub</span>
        </a>
        <span class="runtime-sep" aria-hidden="true">
          ·
        </span>
        {/* "…" is the loading placeholder shown until runtime.info resolves.
            Fetch errors are logged via the createEffect on runtimeInfo.error,
            so a "…" that never clears is a cue to check the console. */}
        <span class="runtime-host" title="Server hostname">
          <span class="runtime-label">host</span>
          <code data-testid="footer-hostname">{runtimeInfo()?.hostname ?? "…"}</code>
        </span>
        <span class="runtime-sep" aria-hidden="true">
          ·
        </span>
        <span class="runtime-db" title="SQLite database path">
          <span class="runtime-label">db</span>
          <code data-testid="footer-dbpath">{runtimeInfo()?.dbPath ?? "…"}</code>
        </span>
      </footer>
    </main>
  );
}
