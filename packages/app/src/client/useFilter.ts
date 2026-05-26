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

import { type Accessor, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { applyFilter, type Row } from "../shared/filter";
import { normalizeQuery } from "../shared/input";
import {
  type Atom,
  atomEquals,
  evalAtoms,
  HIDE_STALE_DONE,
  ONLY_DOING,
  parseAtoms,
  serializeAtoms,
} from "../shared/query";
import type { Task } from "../shared/schemas";
import { type SortedTask, sortedWithDepths } from "../shared/tree";

export const useFilter = (
  query: Accessor<string>,
  setQuery: (value: string) => void,
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

  // A lever is a typing shortcut: activating appends its atom to the
  // query; deactivating filters it out. State derives from parsing
  // `query()` — no parallel signal, so a deep-link or paste that happens
  // to contain the atom reflects in the lever's pressed state without
  // extra wiring. Each call site (hide-stale, only-doing) is just a
  // different atom; the toggle shape is identical.
  const createLever = (atom: Atom) => {
    const on = createMemo(() => atomList().some((a) => atomEquals(a, atom)));
    const toggle = () => {
      const current = atomList();
      const next = on() ? current.filter((a) => !atomEquals(a, atom)) : [...current, atom];
      setQuery(serializeAtoms(next));
    };
    return { on, toggle };
  };

  const hideStaleLever = createLever(HIDE_STALE_DONE);
  const onlyDoingLever = createLever(ONLY_DOING);

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
    hideStaleLever,
    onlyDoingLever,
    canCreate,
  };
};
