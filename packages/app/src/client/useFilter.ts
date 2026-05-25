// Filter pipeline derived from the user's query signal. Owns the
// per-minute staleness clock (for `done:stale`/`done:fresh` evaluation)
// and the visibility-lever toggle. Everything in here is a function of
// `query()` and `tasks()` — no parallel state — so a deep-linked URL or
// pasted query reflects in the UI without extra wiring. Lever state and
// canCreate ride along because they derive from the same atomList memo.
//
// Volatility axis: anywhen's roadmap (README → "Further filter atoms")
// grows the atom grammar (tag, has:body, root, under:title). Each new
// kind ripples through the parser/evaluator in `shared/query.ts` and
// touches nothing here.

import { type Accessor, createMemo, createSignal, onCleanup, onMount, type Setter } from "solid-js";
import { applyFilter, type Row } from "../shared/filter";
import { normalizeQuery } from "../shared/input";
import {
  type Atom,
  atomEquals,
  evalAtoms,
  HIDE_STALE_DONE,
  parseAtoms,
  serializeAtoms,
} from "../shared/query";
import type { Task } from "../shared/schemas";
import { type SortedTask, sortedWithDepths } from "../shared/tree";

export const useFilter = (
  query: Accessor<string>,
  setQuery: Setter<string>,
  tasks: Accessor<Task[]>,
) => {
  // Per-minute reactive clock for the staleness evaluator. Without this,
  // `done:stale` would only re-fire when something else in the filter
  // pipeline changed, so a task crossing the 24h boundary wouldn't elide
  // until the next interaction. Deliberately separate from MeridianRule's
  // clock: that one signals `Date` for hour/minute → SVG x-coordinate;
  // this one signals `number` (epoch ms) for `Date.parse` arithmetic
  // against `completedAt`. The two coincide at 60s by accident of human
  // perception, not as a shared invariant.
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => clearInterval(t));
  });

  // The normalized non-empty query. Empty input → null so both the filter
  // pipeline (skip when null) and the create path (refuse to add) read
  // the same gate.
  const activeQuery = createMemo<string | null>(() => normalizeQuery(query()) || null);

  // Parsed atom list — the structured view of `query`. Both the filter
  // pipeline and the visibility lever derive their state from this
  // single source of truth (the raw `query` signal); no parallel boolean
  // for the lever, no separate "is filter active" flag.
  const atomList = createMemo<Atom[]>(() => parseAtoms(query()));

  // Joined free-text needles for row-title highlight. Structured atoms
  // (`done:X`, `not done:X`) don't highlight anything in titles, so the
  // highlight tracks only the text atoms the user typed.
  const highlightQuery = createMemo<string>(() =>
    atomList()
      .flatMap((a) => (a.kind === "text" ? [a.needle] : []))
      .join(" "),
  );

  const sorted = createMemo<SortedTask[]>(() => sortedWithDepths(tasks()));

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

  return {
    activeQuery,
    atomList,
    highlightQuery,
    rows,
    leverOn,
    toggleLever,
    canCreate,
  };
};

export type UseFilterReturn = ReturnType<typeof useFilter>;
