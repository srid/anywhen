// Live tree view over the `tasks` Collection. App.tsx is the composition
// root: it owns the top-level signals (query, selection, focus,
// expanded-body set, error toast, runtime info, the per-minute staleness
// clock), composes the per-axis modules (`createRpc`, `useDrag`,
// `useEdit`), and renders the shell — search box, filter meta, the
// `<For>` over rows mapping to `<TaskRow>`, hints, backup, footer.
//
// Each volatility axis lives in its own sibling module (see
// `.agency/code-police.md` → `view-component-owns-one-axis`): pointer drag
// state machine in `useDrag.ts`, edit lifecycle in `useEdit.ts`, RPC
// error policy in `rpc.ts`, per-row JSX in `TaskRow.tsx`. App.tsx wires
// them and the small handlers (status cycle, remove, keyboard map,
// backup flow) that span more than one axis.

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
import { type Atom, atomToDisplayString } from "../shared/query";
import { BackupSchema, type Task, type TaskId } from "../shared/schemas";
import { type KeyMove, resolveKeyMove } from "../shared/tree";
import { Breadcrumb } from "./Breadcrumb";
import { MeridianRule } from "./MeridianRule";
import { confirmDestructive, createRpc } from "./rpc";
import { TaskRow } from "./TaskRow";
import { useDrag } from "./useDrag";
import { useEdit } from "./useEdit";
import { useFilter } from "./useFilter";
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
  // distinct from `selected` (the logical/aria selection driving styling).
  // A per-row `createEffect` inside TaskRow re-applies focus whenever this
  // signal matches the row's id. Setting focusedId from a mutation handler
  // survives the <For>'s teardown-and-rebuild when the Collection delta
  // arrives — the new row's effect runs on mount and reads the signal.
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

  // ── Composed axes ─────────────────────────────────────────────────────
  const { callWrite, callQuery } = createRpc(setError);
  const drag = useDrag(api, taskList, callWrite);
  const edit = useEdit(api, taskList, setFocusedId, callWrite);
  const { activeQuery, atomList, highlightQuery, rows, leverOn, toggleLever, canCreate } =
    useFilter(query, setQuery, taskList);

  // Seed `selected` to the first visible row whenever it clears — at boot
  // (so global vim keys have a target before the user clicks anything) and
  // after a deletion empties it. The createEffect short-circuits once
  // selected is set, so this isn't a continuous-correction loop.
  createEffect(() => {
    if (selected() !== null) return;
    const first = rows()[0]?.task.id;
    if (first) setSelected(first);
  });

  // ── Mutation handlers (small enough to stay inline) ───────────────────
  const createFromInput = async () => {
    // Refuse when the query has any structured atom — the user is
    // filtering, not naming a task. Same gate the Add button uses.
    if (!canCreate()) return;
    const title = activeQuery();
    if (!title) return;
    // Clear the input synchronously before the await so subsequent
    // keystrokes aren't clobbered by a late `setQuery("")`.
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
    // task in place — first line as the row label, subsequent lines as
    // the markdown body. Plain Enter commits.
    if (e.shiftKey) return;
    e.preventDefault();
    await createFromInput();
  };

  const cycleStatus = async (id: TaskId) => {
    await callWrite(() => api.cycleStatus(id));
    setFocusedId(id);
  };

  const remove = async (id: TaskId) => {
    // Gating here (rather than at each call site) covers the × button,
    // the x key, and the Backspace alias in one place.
    const task = taskList().find((t) => t.id === id);
    if (!task) return;
    if (!confirmDestructive(`Delete "${task.title}" and any sub-tasks?`)) return;
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

  // Vim-style row bindings, with WAI-ARIA tree-pattern aliases. Each
  // action lists its vim primary first; ArrowUp/Down + Tab/Shift+Tab +
  // Backspace are the ARIA-required aliases (the tree/treeitem roles on
  // the rows are a contract screen-reader users navigate by), and
  // Alt+ArrowUp/Down stay as the legacy reorder aliases.
  //
  // Composite keys ("Shift+Tab", "Alt+ArrowDown", "Alt+ArrowUp") are
  // encoded as lookup strings so every chord rides the same dispatch path
  // as a bare key — no parallel if/else ladder for modifiers.
  const ROW_KEY_ACTIONS: Record<string, (id: TaskId) => void> = {
    " ": (id) => void cycleStatus(id),
    // vim primary  │  ARIA alias
    x: (id) => void remove(id),
    Backspace: (id) => void remove(id),
    e: (id) => edit.beginEdit(id),
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
    if (edit.editing() !== null) return false;
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

  // ── Backup (thin call-throughs; deferred extraction per the rule) ─────
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
            {(row) => (
              <TaskRow
                row={row}
                selected={selected}
                setSelected={setSelected}
                focusedId={focusedId}
                highlightQuery={highlightQuery}
                expandedBodies={expandedBodies}
                toggleBody={toggleBody}
                drag={drag}
                edit={edit}
                onRowKeyDown={applyVimKey}
                onCycleStatus={(id) => void cycleStatus(id)}
                onRemove={(id) => void remove(id)}
              />
            )}
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
