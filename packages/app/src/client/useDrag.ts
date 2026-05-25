// Pointer-events drag state machine. A row's pointerdown stages a "pending
// press"; the drag commits only when the user moves past DRAG_MOVE_THRESHOLD
// (mouse) or holds for DRAG_LONGPRESS_MS without moving (touch / pen).
//
// The lifecycle is one discriminated-union signal — `idle` / `pending` /
// `active` are mutually exclusive by type, so the invariants the original
// inline code maintained by handler-ordering convention (clear pendingPress
// before beginDrag, never let dropTarget linger after the drag ends) are
// now enforced structurally. The long-press timer is a closure-scoped
// side-effect handle rather than a state-machine slot — it's the
// *mechanism* for pending→active, not part of *what* we're tracking.

import { type Accessor, createSignal } from "solid-js";
import {
  DRAG_LONGPRESS_MS,
  type DropZone,
  type MoveTarget,
  type Task,
  type TaskId,
  ZONE_AFTER_RATIO,
  ZONE_BEFORE_RATIO,
} from "../shared/schemas";
import { byParentMap, descendantIds } from "../shared/tree";
import type { CallWrite } from "./rpc";

type PendingPress = {
  id: TaskId;
  startX: number;
  startY: number;
  pointerType: string;
};

export type DragState =
  | { kind: "idle" }
  | { kind: "pending"; press: PendingPress }
  | {
      kind: "active";
      src: TaskId;
      descendants: Set<TaskId>;
      drop: { id: TaskId; zone: DropZone } | null;
    };

// Distance the pointer must travel before a mouse press becomes a drag.
// Below this threshold the press is treated as a click (select / focus).
const DRAG_MOVE_THRESHOLD = 5;

// Map a pointer's Y inside a row to a drop zone. Top quarter → before,
// bottom quarter → after, middle half → inside (re-parent). Symmetric so
// the user can always nudge a task one step up, one step down, or one
// level deeper.
const zoneAt = (offsetY: number, height: number): DropZone => {
  if (height <= 0) return "inside";
  const ratio = offsetY / height;
  if (ratio < ZONE_BEFORE_RATIO) return "before";
  if (ratio > ZONE_AFTER_RATIO) return "after";
  return "inside";
};

type MoveApi = { move: (input: { id: TaskId; target: MoveTarget }) => Promise<void> };

export const useDrag = (api: MoveApi, taskList: Accessor<Task[]>, callWrite: CallWrite) => {
  const [dragState, setDragState] = createSignal<DragState>({ kind: "idle" });

  // Long-press timer for touch / pen presses. Lives outside the state
  // signal because it's a side-effect handle, not state worth observing.
  // Always cleared on transitions out of `pending` (whether to `idle`,
  // `active`, or a fresh `pending`) so a stale timer can't promote an
  // orphaned press.
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  const clearLongPressTimer = () => {
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  };

  const goIdle = () => {
    clearLongPressTimer();
    setDragState({ kind: "idle" });
  };

  const beginDrag = (id: TaskId) => {
    const tasks = taskList();
    const byParent = byParentMap(tasks);
    const descendants = descendantIds(id, (tid) => (byParent.get(tid) ?? []).map((c) => c.id));
    clearLongPressTimer();
    setDragState({ kind: "active", src: id, descendants, drop: null });
  };

  // Derived accessors the row JSX consumes. Reading `dragState()` inside
  // makes them reactive; the row wraps each in a `createMemo` so a
  // dragState change recomputes once per affected row, not per render.
  const isDragging = (id: TaskId): boolean => {
    const s = dragState();
    return s.kind === "active" && s.src === id;
  };
  const dropZoneOn = (id: TaskId): DropZone | null => {
    const s = dragState();
    return s.kind === "active" && s.drop?.id === id ? s.drop.zone : null;
  };
  const canDropOn = (rowId: TaskId): boolean => {
    const s = dragState();
    if (s.kind !== "active" || s.src === rowId) return false;
    return !s.descendants.has(rowId);
  };

  const handleRowPointerDown = (e: PointerEvent, id: TaskId) => {
    // Ignore right/middle clicks and modifier-key chords (those navigate).
    if (e.button !== 0) return;
    // Don't hijack clicks on action buttons or the inline edit input —
    // those are interactive surfaces inside the row that need to receive
    // the press untransformed.
    if (e.target instanceof Element && e.target.closest("button, input, textarea")) return;
    const sourceEl = e.currentTarget as HTMLElement;
    // Two-layer affordance. CSS (`@media (pointer: coarse)`) reveals the
    // handle span only on touch / coarse-pointer devices. The JS guard
    // below fires for ANY pointer type that lands on the handle DOM node
    // — the node is always present, just visually hidden on fine pointers.
    // When it fires, the press bypasses both the long-press timer
    // (touch / pen) and the movement threshold (mouse) and begins
    // dragging immediately.
    const fromHandle =
      e.target instanceof Element && e.target.closest('[data-testid="task-drag-handle"]') !== null;
    // Capture the pointer so subsequent pointermove/up fire on this row
    // even after the pointer leaves it. Mouse has no implicit capture;
    // without this, the first move out of the source row would lose the
    // drag stream.
    try {
      sourceEl.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some headless environments reject capture for released pointers;
      // the drag falls back to whatever element happens to be under the
      // pointer.
      console.warn("setPointerCapture failed:", err);
    }
    // Cancel any previous pending press before starting a new one (guards
    // against the second-finger case where a new pointerdown arrives
    // before the first long-press timer fires).
    clearLongPressTimer();
    if (fromHandle) {
      beginDrag(id);
      return;
    }
    const press: PendingPress = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      pointerType: e.pointerType,
    };
    setDragState({ kind: "pending", press });
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      longPressTimer = setTimeout(() => {
        // Identity-check the current pending press: the timer might fire
        // after the press was cancelled or replaced by a fresh one.
        const s = dragState();
        if (s.kind === "pending" && s.press === press) beginDrag(id);
      }, DRAG_LONGPRESS_MS);
    }
  };

  const handleRowPointerMove = (e: PointerEvent, id: TaskId) => {
    const s = dragState();
    if (s.kind === "pending") {
      const dx = e.clientX - s.press.startX;
      const dy = e.clientY - s.press.startY;
      const movedEnough = Math.hypot(dx, dy) > DRAG_MOVE_THRESHOLD;
      if (!movedEnough) return;
      if (s.press.pointerType === "mouse") {
        beginDrag(id);
      } else {
        // Touch moved before the long-press fired → user is scrolling,
        // not dragging. Cancel the pending press and let native scroll
        // happen.
        goIdle();
        return;
      }
    } else if (s.kind !== "active") {
      return;
    }
    // Active drag: hit-test the row visually under the pointer.
    e.preventDefault();
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const rowEl = hit?.closest('[data-testid="task-row"]') as HTMLElement | null;
    const cur = dragState();
    if (cur.kind !== "active") return;
    if (!rowEl) {
      if (cur.drop) setDragState({ ...cur, drop: null });
      return;
    }
    const targetId = rowEl.getAttribute("data-task-id") as TaskId | null;
    if (!targetId || !canDropOn(targetId)) {
      if (cur.drop) setDragState({ ...cur, drop: null });
      return;
    }
    const rect = rowEl.getBoundingClientRect();
    const zone = zoneAt(e.clientY - rect.top, rect.height);
    if (!cur.drop || cur.drop.id !== targetId || cur.drop.zone !== zone) {
      setDragState({ ...cur, drop: { id: targetId, zone } });
    }
  };

  const handleRowPointerUp = (_e: PointerEvent) => {
    const s = dragState();
    goIdle();
    if (s.kind !== "active" || !s.drop) return;
    const target: MoveTarget = { kind: s.drop.zone, refId: s.drop.id };
    void callWrite(() => api.move({ id: s.src, target }));
  };

  const handleRowPointerCancel = () => {
    goIdle();
  };

  return {
    dragState,
    isDragging,
    dropZoneOn,
    canDropOn,
    handleRowPointerDown,
    handleRowPointerMove,
    handleRowPointerUp,
    handleRowPointerCancel,
  };
};

export type UseDragReturn = ReturnType<typeof useDrag>;
