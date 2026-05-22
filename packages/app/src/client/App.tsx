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
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { Task, TaskId } from "../shared/schemas";
import { surface } from "../shared/surface";

type Client = ContractRouterClient<typeof surface.contract>;

const link = new RPCLink({ url: `${location.origin}/rpc` });
const client = createORPCClient<Client>(link);
const api = client.surface.tasks;

// ── Tree derivation: flat Task[] → ordered, indented rows ─────────────
type Row = { task: Task; depth: number };

const buildRows = (tasks: Task[]): Row[] => {
  const byParent = new Map<TaskId | null, Task[]>();
  for (const t of tasks) {
    const k = t.parentId;
    const arr = byParent.get(k) ?? [];
    arr.push(t);
    byParent.set(k, arr);
  }
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

const parseInput = (raw: string): { kind: "create"; title: string } | null => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("+")) return null;
  const title = trimmed.slice(1).trim();
  if (!title) return null;
  return { kind: "create", title };
};

export function App() {
  const [tasks, { refetch }] = createResource<Task[]>(() => api.list());
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<TaskId | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const rows = createMemo<Row[]>(() => buildRows(tasks() ?? []));

  const handleKeyDown = async (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const parsed = parseInput(query());
      if (!parsed) return;
      e.preventDefault();
      try {
        const created = await api.add({ title: parsed.title, parentId: null });
        setQuery("");
        setSelected(created.id);
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleRowKeyDown = async (e: KeyboardEvent, id: TaskId) => {
    if (e.key === " ") {
      e.preventDefault();
      try {
        await api.toggle(id);
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const toggle = async (id: TaskId) => {
    try {
      await api.toggle(id);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
          data-testid="search-input"
          aria-label="Search or add a task"
          placeholder="Search or type + to add a task"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div class="tree" data-testid="task-tree">
        <Show
          when={rows().length > 0}
          fallback={<div class="empty">No tasks yet. Type "+ buy milk" and press Enter.</div>}
        >
          <For each={rows()}>
            {(row) => (
              <div
                class={`row ${row.task.status === "done" ? "is-done" : ""} ${
                  selected() === row.task.id ? "selected" : ""
                }`}
                data-testid="task-row"
                data-task-title={row.task.title}
                data-task-status={row.task.status}
                data-task-id={row.task.id}
                tabindex="0"
                onClick={() => setSelected(row.task.id)}
                onFocus={() => setSelected(row.task.id)}
                onKeyDown={(e) => handleRowKeyDown(e, row.task.id)}
              >
                <For each={Array.from({ length: row.depth })}>{() => <span class="indent" />}</For>
                <span
                  class={`check ${row.task.status === "done" ? "done" : ""}`}
                  data-testid="task-check"
                  role="checkbox"
                  aria-checked={row.task.status === "done"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggle(row.task.id);
                  }}
                />
                <span class="title">{row.task.title}</span>
              </div>
            )}
          </For>
        </Show>
      </div>

      <div class="hint">
        <span>
          <kbd>+ title</kbd> then <kbd>↵</kbd> to add
        </span>
        <span>
          <kbd>Space</kbd> on a focused row to toggle done
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
