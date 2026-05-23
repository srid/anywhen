// Live tree view over the `tasks` Collection. `app.collections.tasks.use()`
// subscribes to the server's keys stream and, per key, the per-row value
// stream — snapshot-then-deltas semantics keep the UI eventually consistent
// without an explicit refetch after each mutation.
//
// The search box does double duty: `+ title` adds a task (Enter), a plain
// query narrows the tree as you type (live filter). The matcher lives in
// shared/filter.ts so a future server-side delta evaluation imports the
// same function.

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { matchesQuery } from "../shared/filter";
import { parseInput } from "../shared/input";
import {
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

const focusRowById = (id: TaskId) => {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(
      `[data-testid="task-row"][data-task-id="${CSS.escape(id)}"]`,
    );
    el?.focus();
  });
};

type DragSnapshot = { id: TaskId; descendants: Set<TaskId> };

export function App() {
  // Live subscription to the tasks Collection. `notes.keys()` is a reactive
  // accessor; `notes.byKey(id)?.()` is the per-row value, undefined until
  // its first snapshot lands.
  const tasksColl = app.collections.tasks.use({
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<TaskId | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let searchInputRef!: HTMLInputElement;

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

  // The filter is on for non-empty plain queries. `+ title` (the create
  // arm) leaves the tree unfiltered so users see what they're typing as
  // they're composing a new task title.
  const filterQuery = createMemo<string | null>(() => {
    const parsed = parseInput(query());
    return parsed?.kind === "query" ? parsed.q : null;
  });

  const sorted = createMemo<{ task: Task; depth: number }[]>(() => sortedWithDepths(taskList()));

  const rows = createMemo<Row[]>(() => {
    const list = sorted();
    const q = filterQuery();
    if (!q) {
      return list.map(({ task, depth }) => ({ task, depth, dimmed: false }));
    }
    const byId = new Map<TaskId, Task>(list.map(({ task: t }) => [t.id, t]));
    const matched = new Set<TaskId>();
    for (const { task: t } of list) if (matchesQuery(t.title, q)) matched.add(t.id);
    const ancestors = ancestorIds(matched, (id) => byId.get(id)?.parentId ?? null);
    return list
      .filter(({ task: t }) => matched.has(t.id) || ancestors.has(t.id))
      .map(({ task, depth }) => ({ task, depth, dimmed: !matched.has(task.id) }));
  });

  const callMutation = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  };

  const handleKeyDown = async (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    // Query arm: filter is already applied live; Enter is a no-op so the
    // input keeps focus and the user can refine their query. Reading
    // `filterQuery()` here keeps `parseInput` callers down to one — the
    // create arm below — instead of re-parsing the signal a second time.
    if (filterQuery() !== null) return;
    const parsed = parseInput(query());
    if (!parsed || parsed.kind !== "create") return;
    e.preventDefault();
    // Clear the input synchronously before the await so subsequent keystrokes
    // aren't clobbered by a late `setQuery("")` after the mutation resolves.
    // The earlier ordering raced with rapid "+ title ↵" sequences — the user's
    // second `+ title` could land in the box, then the first add's resolution
    // would erase it before its Enter ran.
    setQuery("");
    const created = await callMutation(() => api.add({ title: parsed.title, parentId: null }));
    if (created) setSelected(created.id);
  };

  const toggle = async (id: TaskId) => {
    await callMutation(() => api.toggle(id));
    focusRowById(id);
  };

  const remove = async (id: TaskId) => {
    await callMutation(() => api.remove(id));
    if (!error() && selected() === id) setSelected(null);
  };

  const moveByKey = async (id: TaskId, action: KeyMove) => {
    const target = resolveKeyMove(taskList(), id, action);
    if (!target) return;
    await callMutation(() => api.move({ id, target }));
    focusRowById(id);
  };

  const moveSelection = (id: TaskId, offset: 1 | -1) => {
    const rs = rows();
    const idx = rs.findIndex((r) => r.task.id === id);
    if (idx < 0) return;
    const next = rs[idx + offset];
    if (!next) return;
    setSelected(next.task.id);
    focusRowById(next.task.id);
  };

  const handleRowKeyDown = (e: KeyboardEvent, id: TaskId) => {
    if (e.key === " ") {
      e.preventDefault();
      void toggle(id);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      void remove(id);
      return;
    }
    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void moveByKey(id, e.shiftKey ? "outdent" : "indent");
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (e.altKey) {
        void moveByKey(id, e.key === "ArrowUp" ? "up" : "down");
      } else {
        moveSelection(id, e.key === "ArrowUp" ? -1 : 1);
      }
    }
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
  const [dropTarget, setDropTarget] = createSignal<{ id: TaskId; zone: DropZone } | null>(null);

  const canDropOn = (rowId: TaskId): boolean => {
    const d = drag();
    if (!d || d.id === rowId) return false;
    return !d.descendants.has(rowId);
  };

  const handleDragStart = (e: DragEvent, id: TaskId) => {
    const tasks = taskList();
    const byParent = byParentMap(tasks);
    const descendants = descendantIds(id, (tid) => (byParent.get(tid) ?? []).map((c) => c.id));
    setDrag({ id, descendants });
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
  };

  const handleDragOver = (e: DragEvent, rowId: TaskId) => {
    if (!canDropOn(rowId)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const zone = zoneAt(e.clientY - rect.top, rect.height);
    const current = dropTarget();
    if (!current || current.id !== rowId || current.zone !== zone) {
      setDropTarget({ id: rowId, zone });
    }
  };

  const clearDragState = () => {
    setDrag(null);
    setDropTarget(null);
  };

  const handleDrop = (e: DragEvent, rowId: TaskId) => {
    e.preventDefault();
    const t = dropTarget();
    const src = drag()?.id;
    clearDragState();
    if (!src || !t || t.id !== rowId) return;
    const target: MoveTarget = { kind: t.zone, refId: rowId };
    void callMutation(() => api.move({ id: src, target }));
  };

  return (
    <main>
      <h1>
        anywhen<span class="dot">.</span>
      </h1>
      <p class="tagline">A personal task manager. One search box: filter the tree, or add to it.</p>

      <Show when={error()}>
        {(msg) => (
          <div class="err" data-testid="error">
            {msg()}
          </div>
        )}
      </Show>

      <div class="search">
        <input
          ref={searchInputRef}
          data-testid="search-input"
          aria-label="Search or add a task"
          placeholder="Search or type + to add a task"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div class="tree" data-testid="task-tree" role="tree" aria-label="Tasks">
        <Show
          when={rows().length > 0}
          fallback={
            <div class="empty">
              {filterQuery()
                ? `No tasks match "${filterQuery()}".`
                : 'No tasks yet. Type "+ buy milk" and press Enter.'}
            </div>
          }
        >
          <For each={rows()}>
            {(row) => {
              const rowDropZone = createMemo((): DropZone | null => {
                const dt = dropTarget();
                return dt?.id === row.task.id ? dt.zone : null;
              });
              return (
                <div
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
                  draggable={true}
                  onClick={() => setSelected(row.task.id)}
                  onFocus={() => setSelected(row.task.id)}
                  onKeyDown={(e) => handleRowKeyDown(e, row.task.id)}
                  onDragStart={(e) => handleDragStart(e, row.task.id)}
                  onDragOver={(e) => handleDragOver(e, row.task.id)}
                  onDrop={(e) => handleDrop(e, row.task.id)}
                  onDragEnd={clearDragState}
                >
                  <For each={Array.from({ length: row.depth })}>
                    {() => <span class="indent" />}
                  </For>
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
                    <For each={highlightSegments(row.task.title, filterQuery() ?? "")}>
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
          <kbd>+ title</kbd> then <kbd>↵</kbd> to add
        </span>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to move selection
        </span>
        <span>
          <kbd>Tab</kbd> / <kbd>⇧Tab</kbd> to indent / outdent
        </span>
        <span>
          <kbd>Alt</kbd>+<kbd>↑</kbd>
          <kbd>↓</kbd> to reorder siblings
        </span>
        <span>
          <kbd>Space</kbd> toggle · <kbd>⌫</kbd> delete · <kbd>/</kbd> search
        </span>
      </div>

      <footer class="credit">
        Wired with{" "}
        <a
          href="https://github.com/juspay/kolu/tree/master/packages/surface"
          target="_blank"
          rel="noopener noreferrer"
        >
          @kolu/surface
        </a>{" "}
        from{" "}
        <a href="https://github.com/juspay/kolu" target="_blank" rel="noopener noreferrer">
          juspay/kolu
        </a>
        .
      </footer>
    </main>
  );
}
