// PR 1 client. Three surface procedures over plain oRPC HTTP — no
// WebSocket, no Cell/Collection/Stream/Event reactivity. After each
// mutation the client refetches `tasks.list`; PR 2 swaps that for a
// `Collection<Id, Task>` with push deltas (and keyboard navigation /
// search filtering).
//
// The contract namespaces every procedure under `surface.<ns>` — see
// kolu-master/packages/surface/src/define.ts:640-647 — so the path is
// `client.surface.tasks.{list,add,toggle}`.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { parseInput } from "../shared/input";
import {
  type DropZone,
  type MoveTarget,
  type Task,
  type TaskId,
  ZONE_AFTER_RATIO,
  ZONE_BEFORE_RATIO,
} from "../shared/schemas";
import type { surface } from "../shared/surface";

type Client = ContractRouterClient<typeof surface.contract>;

const link = new RPCLink({ url: `${location.origin}/rpc` });
const client = createORPCClient<Client>(link);
const api = client.surface.tasks;

// ── Tree derivation: flat Task[] → ordered, indented rows ─────────────
type Row = { task: Task; depth: number };

// Parent → children adjacency map. The shared primitive behind both row
// rendering and descendant lookups for drag-veto. One construction; two
// callers walk it for different outputs.
const byParentMap = (tasks: Task[]): Map<TaskId | null, Task[]> => {
  const out = new Map<TaskId | null, Task[]>();
  for (const t of tasks) {
    const arr = out.get(t.parentId) ?? [];
    arr.push(t);
    out.set(t.parentId, arr);
  }
  return out;
};

const buildRows = (tasks: Task[]): Row[] => {
  const byParent = byParentMap(tasks);
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position);
  const out: Row[] = [];
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
  // Zero-height rows are collapsed/invisible; "inside" is the neutral
  // fallback (no positional indicator appears on such rows anyway).
  if (height <= 0) return "inside";
  const ratio = offsetY / height;
  if (ratio < ZONE_BEFORE_RATIO) return "before";
  if (ratio > ZONE_AFTER_RATIO) return "after";
  return "inside";
};

const descendantsOf = (tasks: Task[], rootId: TaskId): Set<TaskId> => {
  const byParent = byParentMap(tasks);
  const out = new Set<TaskId>();
  const walk = (id: TaskId) => {
    for (const c of byParent.get(id) ?? []) {
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(rootId);
  return out;
};

// Same-parent siblings in position order, plus the task's index inside that
// list. Keyboard reordering needs both (the "ref" sibling sits one slot away)
// and indent needs the previous sibling; computing them together avoids
// re-sorting the same array twice. Routes through `byParentMap` so the
// "siblings = children of parent in position order" derivation lives in one
// place; the `slice()` keeps the cached array unmutated for other callers.
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

// Keyboard intent → MoveTarget. Returning null means "no legal move from
// this position" (already at the top sibling, already a root, etc.) so the
// caller can no-op instead of firing a server round-trip that would just
// re-validate and refuse.
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
  const dir = action === "up" ? -1 : 1;
  const ref = sib.siblings[sib.index + dir];
  return ref ? { kind: dir < 0 ? "before" : "after", refId: ref.id } : null;
};

// `<For>` rebuilds the row DOM after refetch, so the focused element is lost
// across a successful move. Refocusing by data-task-id on the next frame
// reattaches the cursor to the same task, which is what keeps "Alt+ArrowUp"
// chains working (press it twice in a row to move two slots up).
const focusRowById = (id: TaskId) => {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(
      `[data-testid="task-row"][data-task-id="${CSS.escape(id)}"]`,
    );
    el?.focus();
  });
};

// Drag state snapshot — id of the task being dragged plus its descendant
// set, captured once at drag-start to seal the gesture against mid-drag
// refetches.
type DragSnapshot = { id: TaskId; descendants: Set<TaskId> };

export function App() {
  const [tasks, { refetch }] = createResource<Task[]>(() => api.list());
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<TaskId | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // Solid ref to the search input. The "/" shortcut and the post-add focus
  // path both need a stable handle to focus the element; reaching for it via
  // `document.querySelector('[data-testid=...]')` would make the production
  // shortcut depend on a test-instrumentation attribute.
  let searchInputRef!: HTMLInputElement;

  const rows = createMemo<Row[]>(() => buildRows(tasks() ?? []));

  // Every mutation has the same shape: await the RPC, refetch the list,
  // surface any error. Inlining this at three call sites would force PR 2
  // (which adds keyboard-nav mutations and search-submit) to update each
  // copy in lockstep — and Solid's signal updates would still be missed
  // on whichever copy diverged. One helper, one error path.
  const callMutation = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await fn();
      setError(null);
      await refetch();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  };

  const handleKeyDown = async (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const parsed = parseInput(query());
    if (!parsed) return;
    // PR 2 fills in the query arm (filter the tree); for now we no-op so
    // the search box still accepts free text without firing a mutation.
    if (parsed.kind === "query") return;
    e.preventDefault();
    const created = await callMutation(() => api.add({ title: parsed.title, parentId: null }));
    if (!created) return;
    setQuery("");
    setSelected(created.id);
  };

  const toggle = (id: TaskId) => {
    void callMutation(() => api.toggle(id));
  };

  const remove = async (id: TaskId) => {
    await callMutation(() => api.remove(id));
    // Clearing selection before the mutation settles would leave the user
    // with no selection on a failed delete (the row still exists, just
    // unselected). Clear only after callMutation flips the error signal.
    if (!error() && selected() === id) setSelected(null);
  };

  const moveByKey = async (id: TaskId, action: KeyMove) => {
    const target = resolveKeyMove(tasks() ?? [], id, action);
    if (!target) return;
    await callMutation(() => api.move({ id, target }));
    focusRowById(id);
  };

  // Move focus to the row offset slots away in the flat tree-order view.
  // Wraparound is intentionally not supported: the user pressing ArrowDown
  // at the last row should land "stuck" rather than warp to the top, since
  // wrapping makes Alt+ArrowDown's reorder semantics ambiguous later.
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
      toggle(id);
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

  // "/" focuses the search box from anywhere on the page, matching the
  // muscle-memory of every command-palette-ish UI. Guarded against firing
  // while the user is already typing in an input or contentEditable region —
  // otherwise it would clobber a literal "/" inside a query.
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

  // ── Drag-and-drop reordering ────────────────────────────────────────
  // The drag snapshot couples a task id with its descendant set, taken once
  // at drag-start. Tying both to a single value seals the drag gesture
  // against mid-drag refetches: a background mutation that re-reads tasks
  // can't shift the descendant set under the user's hand. The server
  // re-validates, but blocking invalid targets here keeps the visual
  // indicator off them so the UX matches the outcome.
  const [drag, setDrag] = createSignal<DragSnapshot | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{ id: TaskId; zone: DropZone } | null>(null);

  const canDropOn = (rowId: TaskId): boolean => {
    const d = drag();
    if (!d || d.id === rowId) return false;
    return !d.descendants.has(rowId);
  };

  const handleDragStart = (e: DragEvent, id: TaskId) => {
    setDrag({ id, descendants: descendantsOf(tasks() ?? [], id) });
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // Some browsers ignore the drag if no data is attached.
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
    // Use the zone the dragover handler already settled on. Re-deriving from
    // a fresh getBoundingClientRect() here would let scroll/reflow between
    // the last dragover and the drop split the indicator from the RPC.
    const t = dropTarget();
    const src = drag()?.id;
    clearDragState();
    // Guard: dragover may have last fired on a different row than where
    // drop landed (fast cursor movement); discard if the committed target
    // doesn't match the row that fired the drop event.
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
          fallback={<div class="empty">No tasks yet. Type "+ buy milk" and press Enter.</div>}
        >
          <For each={rows()}>
            {(row) => {
              // One memo per row: reads dropTarget() once, suppresses
              // recomputes when neither this row's id nor its zone changes.
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
                  <span class="title">{row.task.title}</span>
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
