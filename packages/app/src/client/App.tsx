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
import MarkdownIt from "markdown-it";
import {
  type Atom,
  atomEquals,
  atomToDisplayString,
  evalAtoms,
  HIDE_STALE_DONE,
  parseAtoms,
  serializeAtoms,
} from "../shared/atoms";
import { applyFilter, type Row } from "../shared/filter";
import { normalizeQuery } from "../shared/input";
import {
  BackupSchema,
  DRAG_LONGPRESS_MS,
  type DropZone,
  type MoveTarget,
  type Task,
  type TaskId,
  type TaskStatus,
  ZONE_AFTER_RATIO,
  ZONE_BEFORE_RATIO,
} from "../shared/schemas";
import { splitTitle } from "../shared/title";
import {
  byParentMap,
  descendantIds,
  type KeyMove,
  resolveKeyMove,
  type SortedTask,
  sortedWithDepths,
} from "../shared/tree";
import { Breadcrumb } from "./Breadcrumb";
import { highlightSegments } from "./highlight";
import { MeridianRule } from "./MeridianRule";
import { app } from "./wire";

const api = app.rpc.surface.tasks;
const runtimeApi = app.rpc.surface.runtime;

const REPO_URL = "https://github.com/srid/anywhen";

// Per-kind CSS class for the atoms-sentence rendering. A record so the
// JSX stays a single lookup and a new atom kind only needs one entry
// here plus the matching `.atom-*` rule in styles.css.
const ATOM_CLASS: Record<Atom["kind"], string> = {
  text: "atom-text",
  done: "atom-structured",
  not: "atom-not",
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

// Single receptacle for "are you sure?" before a write that cascades or
// wipes. The app has no in-app modal yet; native confirm is the simplest
// accessible blocker. When we eventually grow a modal, only this body
// changes — every destructive call site already speaks through the name.
const confirmDestructive = (message: string): boolean => window.confirm(message);

// markdown-it config lives behind a name so the next contributor sees
// each switch and what flipping it would change:
//   - `html: false`  → raw HTML in user content is escaped, not rendered;
//                      no `<script>` smuggling even though anywhen is
//                      single-user.
//   - `linkify: true` → bare URLs like `https://…` autolink without
//                       requiring GFM angle brackets.
//   - `breaks: false` → CommonMark default; a single newline is not a
//                       <br>. Bodies tend to be paragraphs, not poetry.
const MD_OPTIONS = { html: false, linkify: true, breaks: false } as const;
const md = new MarkdownIt(MD_OPTIONS);

// ARIA `aria-pressed` token per lifecycle status. The check is a toggle
// button (advances state on click) not a checkbox — `aria-pressed`
// natively supports tri-state `"true" | "false" | "mixed"` on a <button>
// without forcing a `role="checkbox"` override that biome's a11y lint
// (correctly) flags. Lives in the presentation layer because the values
// are WAI-ARIA spec constants — UI protocol, not domain policy.
// `Record<TaskStatus, …>` makes a future fourth status a TypeScript error
// at this declaration site rather than a silent `"false"` fallback if it
// were a chained ternary on the row's JSX.
const STATUS_TO_ARIA_PRESSED: Record<TaskStatus, "true" | "false" | "mixed"> = {
  todo: "false",
  doing: "mixed",
  done: "true",
};

// "Is this event target a place the user is typing?" — the canonical
// guard for any window-level shortcut that would otherwise eat a
// keystroke meant for an input. Lifted to module scope so the "/"
// listener and the vim-key fallback share one predicate.
const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLTextAreaElement ||
  (t instanceof HTMLElement && t.isContentEditable);

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
  // Which multi-line tasks have their body expanded. A Set keeps the
  // toggle O(1) and lets state persist across Collection deltas (re-
  // rendering a row preserves its expanded entry by id, not by element).
  const [expandedBodies, setExpandedBodies] = createSignal<Set<TaskId>>(new Set());
  const toggleBody = (id: TaskId) => {
    setExpandedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Inline title editor. `originalTitle` is captured at beginEdit time so
  // both the unchanged-title guard and the input's aria-label read a stable
  // baseline, not the live row (which can drift between mount and commit if
  // a Collection delta arrives). `draft` evolves with the user's input.
  // null = no row is being edited; populating the field means a session is
  // live, so all three values are meaningful together.
  const [editing, setEditing] = createSignal<{
    id: TaskId;
    originalTitle: string;
    draft: string;
  } | null>(null);
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
  let searchInputRef!: HTMLTextAreaElement;
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

  // Parsed atom list — the structured view of `query`. Both the filter
  // pipeline and the visibility lever derive their state from this single
  // source of truth (the raw `query` signal); no parallel boolean for the
  // lever, no separate "is filter active" flag.
  const atomList = createMemo<Atom[]>(() => parseAtoms(query()));

  // Joined free-text needles for row-title highlight. Structured atoms
  // (`done:X`, `not done:X`) don't highlight anything in titles, so the
  // highlight tracks only the text atoms the user typed.
  const highlightQuery = createMemo<string>(() =>
    atomList()
      .flatMap((a) => (a.kind === "text" ? [a.needle] : []))
      .join(" "),
  );

  // Per-minute reactive clock for the staleness evaluator — without this,
  // `done:stale` would only re-fire when something else in the filter
  // pipeline changed, so a task crossing the 24h boundary wouldn't elide
  // until the next interaction. Deliberately separate from MeridianRule's
  // clock: that one signals `Date` for hour/minute → SVG x-coordinate;
  // this one signals `number` (epoch ms) for `Date.parse` arithmetic
  // against `completedAt`. The two coincide at 60s by accident of human
  // perception, not as a shared invariant — if MeridianRule moved to 30s
  // for visual smoothness or this evaluator moved to 5m for background-tab
  // throttling, the other would stay correct.
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => clearInterval(t));
  });

  const sorted = createMemo<SortedTask[]>(() => sortedWithDepths(taskList()));

  const rows = createMemo<Row[]>(() => {
    const atoms = atomList();
    if (atoms.length === 0) return applyFilter(sorted(), null);
    const nowMs = now();
    // Text atoms match the displayed first line (not the raw multi-line
    // title) so a surviving row always carries the matching <mark>;
    // otherwise body-only matches read as "this row passed the filter
    // for no visible reason." Done/not atoms ignore title shape.
    return applyFilter(sorted(), (task) => evalAtoms(atoms, task, nowMs));
  });

  // Seed `selected` to the first visible row whenever it clears — at boot
  // (so global vim keys have a target before the user clicks anything) and
  // after a deletion empties it. The createEffect short-circuits once
  // selected is set, so this isn't a continuous-correction loop.
  createEffect(() => {
    if (selected() !== null) return;
    const first = rows()[0]?.task.id;
    if (first) setSelected(first);
  });

  // The lever is a typing shortcut: activating inserts HIDE_STALE_DONE
  // into the query; deactivating filters it out. State derives from
  // parsing `query()` — no parallel signal, so a deep-link or paste that
  // happens to contain `not done:stale` reflects in the lever's pressed
  // state without extra wiring.
  const leverOn = createMemo<boolean>(() => atomList().some((a) => atomEquals(a, HIDE_STALE_DONE)));

  const toggleLever = () => {
    const current = atomList();
    const next = leverOn()
      ? current.filter((a) => !atomEquals(a, HIDE_STALE_DONE))
      : [...current, HIDE_STALE_DONE];
    setQuery(serializeAtoms(next));
  };

  // Add is disabled whenever the parsed atoms include any structured
  // (non-text) atom — the user is filtering, not naming a task.
  const canCreate = createMemo<boolean>(() => {
    const atoms = atomList();
    return atoms.length > 0 && atoms.every((a) => a.kind === "text");
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
    // Refuse when the query has any structured atom — the user is filtering,
    // not naming a task. Same gate the Add button uses to disable itself.
    if (!canCreate()) return;
    const title = activeQuery();
    if (!title) return;
    // Clear the input synchronously before the await so subsequent keystrokes
    // aren't clobbered by a late `setQuery("")` after the mutation resolves.
    setQuery("");
    const created = await callWrite(() => api.add({ title, parentId: null }));
    if (created) setSelected(created.id);
  };

  const handleSearchKeyDown = async (e: KeyboardEvent) => {
    // Escape releases focus from the search box. With focus off the input,
    // the window-level vim handler regains control — the canonical "tab
    // away to vim mode" gesture, just on a more familiar key.
    if (e.key === "Escape") {
      e.preventDefault();
      searchInputRef.blur();
      return;
    }
    if (e.key !== "Enter") return;
    // Shift+Enter inserts a newline so the user can compose a multi-line
    // task in place — first line as the row label, subsequent lines as the
    // markdown body. Plain Enter commits.
    if (e.shiftKey) return;
    e.preventDefault();
    await createFromInput();
  };

  const cycleStatus = async (id: TaskId) => {
    await callWrite(() => api.cycleStatus(id));
    setFocusedId(id);
  };

  const remove = async (id: TaskId) => {
    // Gating here (rather than at each call site) covers the × button, the
    // x key, and the Backspace alias in one place.
    const task = taskList().find((t) => t.id === id);
    if (!task) return;
    if (!confirmDestructive(`Delete "${task.title}" and any sub-tasks?`)) return;
    await callWrite(() => api.remove(id));
    if (!error() && selected() === id) setSelected(null);
  };

  // Start editing the focused row. Seeds the draft with the current title so
  // typing replaces; a createEffect below selects the input on open so a
  // single keystroke replaces the whole title (cursor-at-end also works for
  // append-style edits).
  const beginEdit = (id: TaskId) => {
    const task = taskList().find((t) => t.id === id);
    if (!task) return;
    setEditing({ id, originalTitle: task.title, draft: task.title });
  };

  // Tear down the edit session and restore keyboard focus to the row so vim
  // navigation continues from where the user left off.
  const closeEdit = (id: TaskId) => {
    setEditing(null);
    setFocusedId(id);
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
  // (applyVimKey's editing() guard is the primary defense; this is
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
  // Composite keys ("Shift+Tab", "Alt+ArrowDown", "Alt+ArrowUp") are
  // encoded as lookup strings so every chord rides the same dispatch path
  // as a bare key — no parallel if/else ladder for modifiers.
  const ROW_KEY_ACTIONS: Record<string, (id: TaskId) => void> = {
    " ": (id) => void cycleStatus(id),
    // vim primary  │  ARIA alias
    x: (id) => void remove(id),
    Backspace: (id) => void remove(id),
    e: (id) => beginEdit(id),
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
    "Alt+ArrowDown": (id) => void moveByKey(id, "down"),
    "Alt+ArrowUp": (id) => void moveByKey(id, "up"),
  };

  // Single dispatch site for every vim binding — consumed by the per-row
  // onKeyDown (the ARIA roving-tabindex path) and the window-level fallback
  // (the "keys work everywhere" path). Owns the ctrl/meta cede and the
  // edit-mode guard so neither caller restates the policy.
  //
  // Key encoding: Alt chords become "Alt+<key>" and only match if the
  // composite is in the table (prevents Alt+J falling through to bare J);
  // Shift+Tab is encoded explicitly; everything else is e.key verbatim.
  const applyVimKey = (e: KeyboardEvent, id: TaskId): boolean => {
    if (e.ctrlKey || e.metaKey) return false;
    if (editing() !== null) return false;
    let key: string | null;
    if (e.altKey) {
      const k = `Alt+${e.key}`;
      key = k in ROW_KEY_ACTIONS ? k : null;
    } else {
      key = e.shiftKey && e.key === "Tab" ? "Shift+Tab" : e.key;
    }
    if (key === null) return false;
    const action = ROW_KEY_ACTIONS[key];
    if (!action) return false;
    e.preventDefault();
    action(id);
    return true;
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
    if (!confirmDestructive(`Replace all current tasks with ${count} from ${file.name}?`)) {
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

  // Two independent global-keystroke roles: "/" focuses search from
  // anywhere; vim keys fire when focus is outside the tree. They share
  // only the typing-target guard, so the dispatch is two sub-handlers
  // called in turn — each returning true when it consumed the event.
  const handleGlobalSearch = (e: KeyboardEvent): boolean => {
    if (e.key !== "/") return false;
    e.preventDefault();
    searchInputRef.focus();
    searchInputRef.select();
    return true;
  };

  const handleGlobalVim = (e: KeyboardEvent): boolean => {
    // If focus is already on a row, the per-row handler will run — don't
    // double-fire here.
    if (e.target instanceof HTMLElement && e.target.closest('[role="treeitem"]')) return false;
    const id = selected() ?? rows()[0]?.task.id;
    if (!id) return false;
    return applyVimKey(e, id);
  };

  onMount(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (handleGlobalSearch(e)) return;
      handleGlobalVim(e);
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
    // Don't hijack clicks on action buttons or the inline edit input — those
    // are interactive surfaces inside the row that need to receive the
    // press untransformed (button click, caret placement, text selection).
    if (e.target instanceof Element && e.target.closest("button, input, textarea")) return;
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

      <MeridianRule />

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

      <Breadcrumb selectedId={selected} tasks={taskList} />

      <div class="search">
        <svg class="search-mark" viewBox="0 0 24 24" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" stroke-width="1" opacity="0.3" />
            <circle cx="12" cy="12" r="6" stroke-width="1.3" opacity="0.6" />
          </g>
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        </svg>
        <textarea
          ref={searchInputRef}
          class="search-input"
          data-testid="search-input"
          aria-label="Search or add a task"
          placeholder="Search tasks…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={handleSearchKeyDown}
          enterkeyhint="search"
          rows={1}
        />
        <button
          type="button"
          class="add-btn"
          data-testid="add-button"
          aria-label="Add task (Enter)"
          title="Add task (Enter)"
          disabled={!canCreate()}
          onClick={() => void createFromInput()}
        >
          Add
        </button>
      </div>

      <div class="filter-meta" data-testid="filter-meta">
        <Show when={atomList().some((a) => a.kind !== "text")}>
          <p class="atoms-sentence" data-testid="atoms-sentence">
            <span class="atoms-prefix">matching </span>
            <For each={atomList()}>
              {(atom, idx) => (
                <>
                  <Show when={idx() > 0}>
                    <span class="atoms-sep">·</span>
                  </Show>
                  <span class={ATOM_CLASS[atom.kind]}>{atomToDisplayString(atom)}</span>
                </>
              )}
            </For>
          </p>
        </Show>
        <button
          type="button"
          class="lever"
          classList={{ on: leverOn() }}
          data-testid="visibility-lever"
          aria-pressed={leverOn()}
          aria-label={leverOn() ? "Show all tasks" : "Hide tasks done over 24 hours ago"}
          onClick={toggleLever}
        >
          <Show
            when={leverOn()}
            fallback={
              <>
                showing all · <span class="lever-pivot">hide done &gt;24h</span>
              </>
            }
          >
            showing recent · <span class="lever-pivot">show all</span>
          </Show>
        </button>
      </div>

      <div class="tree" data-testid="task-tree" role="tree" aria-label="Tasks">
        <Show
          when={rows().length > 0}
          fallback={
            <div class="empty">
              {activeQuery()
                ? `No tasks match "${activeQuery()}".${canCreate() ? " Press Enter to add it." : ""}`
                : "No tasks yet. Type a title and press Enter (or tap Add)."}
              <Show when={!activeQuery()}>
                <span class="empty-quote" data-testid="empty-quote">
                  — there is no rush; the tree begins whenever you do.
                </span>
              </Show>
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
              let editInputRef: HTMLTextAreaElement | undefined;
              const isEditing = createMemo(() => editing()?.id === row.task.id);
              // One memo, one split — keeps label and body derived from a
              // single `splitTitle` call rather than two independent
              // `indexOf('\n')` walks that could disagree.
              const split = createMemo(() => splitTitle(row.task.title));
              const firstLine = createMemo(() => split().label);
              const body = createMemo(() => split().body);
              // When focusedId matches this row, focus its DOM element. Runs
              // on mount and whenever focusedId changes — so a mutation that
              // tears down and rebuilds this row (Collection delta after
              // cycleStatus / move) re-establishes focus the moment the new
              // element is bound.
              createEffect(() => {
                if (focusedId() === row.task.id) rowEl.focus();
              });
              // When edit mode opens for this row, move focus into the input
              // and select its contents so the user can replace the title
              // with one keystroke (or refine it with arrow keys).
              createEffect(() => {
                if (isEditing() && editInputRef) {
                  editInputRef.focus();
                  editInputRef.select();
                }
              });
              return (
                <>
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
                    data-task-firstline={firstLine()}
                    data-task-status={row.task.status}
                    data-task-id={row.task.id}
                    data-task-parent-id={row.task.parentId ?? ""}
                    role="treeitem"
                    aria-selected={selected() === row.task.id}
                    tabIndex={0}
                    onClick={() => setSelected(row.task.id)}
                    onFocus={() => setSelected(row.task.id)}
                    onKeyDown={(e) => applyVimKey(e, row.task.id)}
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
                      classList={{
                        doing: row.task.status === "doing",
                        done: row.task.status === "done",
                      }}
                      data-testid="task-check"
                      // ARIA tri-state toggle button: false → "todo",
                      // mixed → "doing" (an in-flight state, not yet
                      // complete), true → "done". Mirrors the visual
                      // cycle so screen readers announce the same three
                      // steps. `aria-pressed` (not `aria-checked`) is
                      // correct here — the element is a <button>, not a
                      // form checkbox, and pressing advances the state.
                      aria-pressed={STATUS_TO_ARIA_PRESSED[row.task.status]}
                      aria-label={`Advance ${row.task.title} (currently ${row.task.status})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void cycleStatus(row.task.id);
                      }}
                    />
                    <Show
                      when={isEditing()}
                      fallback={
                        <span class="title">
                          <For each={highlightSegments(firstLine(), highlightQuery())}>
                            {(seg) =>
                              seg.match ? <mark>{seg.text}</mark> : <span>{seg.text}</span>
                            }
                          </For>
                          <Show when={body()}>
                            {" "}
                            <button
                              type="button"
                              class="body-toggle"
                              classList={{ open: expandedBodies().has(row.task.id) }}
                              data-testid="task-body-toggle"
                              data-task-id={row.task.id}
                              aria-label={`${expandedBodies().has(row.task.id) ? "Hide" : "Show"} details for ${firstLine()}`}
                              aria-expanded={expandedBodies().has(row.task.id)}
                              title="Toggle details"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleBody(row.task.id);
                              }}
                            >
                              …
                            </button>
                          </Show>
                        </span>
                      }
                    >
                      <textarea
                        ref={editInputRef}
                        class="title-edit"
                        data-testid="task-edit-input"
                        aria-label={`Edit title for ${editing()!.originalTitle}`}
                        value={editing()!.draft}
                        onInput={(ev) => {
                          // editing() is always non-null here — the input only
                          // mounts when isEditing() is true.
                          const current = editing()!;
                          setEditing({ ...current, draft: ev.currentTarget.value });
                        }}
                        onKeyDown={handleEditKeyDown}
                        onBlur={() => void commitEdit()}
                        rows={1}
                      />
                    </Show>
                    <button
                      type="button"
                      class="edit"
                      data-testid="task-edit"
                      aria-label={`Edit ${row.task.title}`}
                      title="Edit title"
                      onClick={(e) => {
                        e.stopPropagation();
                        beginEdit(row.task.id);
                      }}
                    >
                      ✎
                    </button>
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
                  <Show when={body()}>
                    <div
                      class="task-body-wrap"
                      classList={{ dimmed: row.dimmed }}
                      style={{ "--row-depth": row.depth }}
                      data-task-id={row.task.id}
                      hidden={!expandedBodies().has(row.task.id)}
                    >
                      <div
                        class="task-body"
                        data-testid="task-body"
                        data-task-id={row.task.id}
                        // markdown-it is constructed with html:false so user
                        // content can't smuggle raw <script> / <iframe> through.
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered HTML is sanitized by markdown-it (html:false)
                        innerHTML={md.render(body())}
                      />
                    </div>
                  </Show>
                </>
              );
            }}
          </For>
        </Show>
      </div>

      <div class="hint">
        <span>
          <kbd>↵</kbd> add task · <kbd>⇧↵</kbd> new line in body
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
          <kbd>Space</kbd> cycle status · <kbd>e</kbd> edit · <kbd>x</kbd> delete · <kbd>/</kbd>{" "}
          search
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
