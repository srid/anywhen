// Ancestor breadcrumb: a hairline italic sentence above the search box that
// names the selected row's lineage. Not a nav widget — visually a sentence.
// Says "this task lives somewhere; the somewhere is yours, infinite, and
// structured." Renders only when a non-root row is selected; absent
// otherwise (nothing selected, or root-level selection).
//
// Walks the parent chain via shared/tree's `ancestorPath`, the canonical
// home for parent-pointer traversal. The walk algorithm lives in tree.ts
// exactly once — `ancestorIds` and `ancestorPath` are two consumers of the
// same primitive.

import { createMemo, For, Show } from "solid-js";
import { ancestorPath } from "../shared/tree";
import type { Task, TaskId } from "../shared/schemas";

type Props = {
  selectedId: () => TaskId | null;
  tasks: () => Task[];
};

export function Breadcrumb(props: Props) {
  const path = createMemo<Task[]>(() => {
    const id = props.selectedId();
    if (id === null) return [];
    const byId = new Map(props.tasks().map((t) => [t.id, t]));
    const ancestors = ancestorPath(id, (cid) => byId.get(cid)?.parentId ?? null);
    return ancestors.flatMap((aid) => {
      const t = byId.get(aid);
      return t ? [t] : [];
    });
  });
  return (
    <Show when={path().length > 0}>
      <p class="breadcrumb" data-testid="breadcrumb" aria-live="polite">
        <For each={path()}>
          {(t, i) => (
            <>
              <Show when={i() > 0}>
                <span class="breadcrumb-sep" aria-hidden="true">
                  /
                </span>
              </Show>
              <span class="breadcrumb-crumb">{t.title}</span>
            </>
          )}
        </For>
      </p>
    </Show>
  );
}
