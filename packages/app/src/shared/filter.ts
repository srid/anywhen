// Title matcher + filter pass. Shared between client (drives the live
// filter UI) and — when filter atoms (Phase 5) evaluate server-side —
// the server. Living in shared/ avoids the breaking re-import that would
// happen if Phase 5 had to lift this out of client/.
//
// `matchPositions` is the canonical needle-locator: both the boolean
// reduction (`matchesQuery`) and the segment renderer in client/highlight.ts
// consume it, so the two can't drift on what counts as a match.
//
// `applyFilter` wraps the live-filter policy itself: direct matches stay
// undimmed, ancestors stay dimmed so the path to a match is intact, and
// rows with no matched descendant elide. Future filter expansion (atom
// grammar) swaps the predicate; the ancestor-preservation policy stays.
//
// Normalization for all callers routes through `normalizeQuery` in
// shared/input.ts so the search box, the matcher, and the renderer can
// never drift on what counts as the same query.

import { normalizeQuery } from "./input";
import type { Task, TaskId } from "./schemas";
import { ancestorIds, type SortedTask } from "./tree";

export type MatchPosition = { start: number; end: number };

// Case-insensitive needle locator. Indices are valid offsets into the
// original `title` for ASCII inputs; titles containing characters whose
// case-fold changes length (e.g. German ß → SS) may yield indices that
// slice slightly off — acceptable for English task titles.
export const matchPositions = (title: string, query: string): MatchPosition[] => {
  const needle = normalizeQuery(query).toLowerCase();
  if (!needle) return [];
  const haystack = title.toLowerCase();
  const out: MatchPosition[] = [];
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    out.push({ start: idx, end: idx + needle.length });
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return out;
};

export const matchesQuery = (title: string, query: string): boolean =>
  matchPositions(title, query).length > 0;

export type Row = { task: Task; depth: number; dimmed: boolean };

// `matches=null` → no filter, every row visible and undimmed. Otherwise:
// direct matches keep `dimmed: false`; their ancestors (via parent-pointer
// walk) ride along dimmed so the path stays readable; non-matches with no
// matched descendant elide.
export const applyFilter = (
  sorted: SortedTask[],
  matches: ((task: Task) => boolean) | null,
): Row[] => {
  if (!matches) return sorted.map(({ task, depth }) => ({ task, depth, dimmed: false }));
  const byId = new Map<TaskId, Task>(sorted.map(({ task }) => [task.id, task]));
  const matched = new Set<TaskId>();
  for (const { task } of sorted) if (matches(task)) matched.add(task.id);
  const ancestors = ancestorIds(matched, (id) => byId.get(id)?.parentId ?? null);
  return sorted
    .filter(({ task }) => matched.has(task.id) || ancestors.has(task.id))
    .map(({ task, depth }) => ({
      task,
      depth,
      dimmed: !matched.has(task.id),
    }));
};
