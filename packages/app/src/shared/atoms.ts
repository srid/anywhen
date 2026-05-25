// Filter-atom grammar. The search box accepts a sequence of atoms (today:
// free text, `done:X`, `not <structured>`) — AND-composed — that
// `applyFilter` evaluates against each task. The shape is a closed
// discriminated union so adding a new atom kind is one variant + one
// parser branch + one evaluator branch; nothing in App.tsx or the rows()
// memo changes.
//
// Round-trip is a load-bearing property for the visibility lever: it
// inserts `not done:stale` into the user's typed query and, on
// deactivation, parses the query, drops the atom, and re-serializes.
// `parseAtoms(serializeAtoms(parseAtoms(q)))` must equal
// `parseAtoms(q)` — otherwise the lever would rewrite the user's text on
// every click.
//
// STALE_THRESHOLD_MS lives here (not in shared/schemas.ts beside the drag
// constants) because it encapsulates done-axis temporal volatility — a
// distinct axis from drag geometry.

import { matchesQuery } from "./filter";
import { normalizeQuery } from "./input";
import type { Task } from "./schemas";
import { splitTitle } from "./title";

const DONE_VALUES = ["no", "yes", "fresh", "stale"] as const;
type DoneValue = (typeof DONE_VALUES)[number];

const STATUS_VALUES = ["todo", "doing", "done"] as const;
type StatusValue = (typeof STATUS_VALUES)[number];

export type Atom =
  | { kind: "text"; needle: string }
  | { kind: "done"; value: DoneValue }
  | { kind: "status"; value: StatusValue }
  | { kind: "not"; inner: Atom };

export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// The atom the visibility lever inserts. Named so call sites stay agnostic
// to its internal structure — a future redesign (e.g. a new `visibility:`
// kind) only edits this constant.
export const HIDE_STALE_DONE: Atom = {
  kind: "not",
  inner: { kind: "done", value: "stale" },
};

// The atom the focus lever inserts. "Only what I'm doing" reads as the
// lever's intent; the underlying atom is the literal status:doing the
// user could also type by hand.
export const ONLY_DOING: Atom = { kind: "status", value: "doing" };

// Recognises one structured atom in a single token (today: done:X).
// Returns null for tokens that should fall through to free text. Future
// atom kinds extend this without touching the surrounding tokenizer.
const parseStructured = (token: string): Atom | null => {
  if (token.startsWith("done:")) {
    const value = token.slice("done:".length);
    if ((DONE_VALUES as readonly string[]).includes(value)) {
      return { kind: "done", value: value as DoneValue };
    }
  }
  if (token.startsWith("status:")) {
    const value = token.slice("status:".length);
    if ((STATUS_VALUES as readonly string[]).includes(value)) {
      return { kind: "status", value: value as StatusValue };
    }
  }
  return null;
};

export const parseAtoms = (query: string): Atom[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/);
  const atoms: Atom[] = [];
  let textBuf: string[] = [];
  const flushText = () => {
    if (textBuf.length > 0) {
      atoms.push({ kind: "text", needle: textBuf.join(" ") });
      textBuf = [];
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] as string;
    // `not <structured>` is the only two-token form. Bare "not" or
    // "not <free text>" falls through to the text run.
    const lookahead = tokens[i + 1];
    if (tok === "not" && lookahead !== undefined) {
      const next = parseStructured(lookahead);
      if (next) {
        flushText();
        atoms.push({ kind: "not", inner: next });
        i++;
        continue;
      }
    }
    const structured = parseStructured(tok);
    if (structured) {
      flushText();
      atoms.push(structured);
      continue;
    }
    textBuf.push(tok);
  }
  flushText();
  return atoms;
};

const serializeAtom = (atom: Atom): string => {
  switch (atom.kind) {
    case "text":
      return atom.needle;
    case "done":
      return `done:${atom.value}`;
    case "status":
      return `status:${atom.value}`;
    case "not":
      return `not ${serializeAtom(atom.inner)}`;
  }
};

export const serializeAtoms = (atoms: Atom[]): string => atoms.map(serializeAtom).join(" ");

// Display rendering — the single place that knows what to *show* the user
// for each atom kind. Returned as a string; the caller wraps in whatever
// element it likes. Today the only display caller is the atoms-sentence
// in App.tsx (which renders one classed span per atom); a future detail
// pane that wants to badge atoms can reuse this without re-implementing
// the kind switch.
export const atomToDisplayString = (atom: Atom): string => {
  switch (atom.kind) {
    case "text":
      return `"${atom.needle}"`;
    case "done":
      return `done:${atom.value}`;
    case "status":
      return `status:${atom.value}`;
    case "not":
      return `not ${atomToDisplayString(atom.inner)}`;
  }
};

export const atomEquals = (a: Atom, b: Atom): boolean => {
  if (a.kind !== b.kind) return false;
  // b.kind === a.kind at this point; re-switch on b so TypeScript narrows
  // both sides without Extract<> casts.
  switch (a.kind) {
    case "text":
      return b.kind === "text" && a.needle === b.needle;
    case "done":
      return b.kind === "done" && a.value === b.value;
    case "status":
      return b.kind === "status" && a.value === b.value;
    case "not":
      return b.kind === "not" && atomEquals(a.inner, b.inner);
  }
};

// Age of the completion event, or null if the task isn't done with a known
// timestamp. `completedAt === null` (a legacy or test-imported done row)
// is treated as "completion time unknown" — both isStaleDone and
// isFreshDone return false, so neither `done:fresh` nor `done:stale`
// matches it. `done:yes` still does.
const completedAgeMs = (task: Task, now: number): number | null => {
  if (task.status !== "done" || task.completedAt === null) return null;
  return now - Date.parse(task.completedAt);
};

const isStaleDone = (task: Task, now: number): boolean => {
  const age = completedAgeMs(task, now);
  return age !== null && age > STALE_THRESHOLD_MS;
};

const isFreshDone = (task: Task, now: number): boolean => {
  const age = completedAgeMs(task, now);
  return age !== null && age <= STALE_THRESHOLD_MS;
};

const evalDone = (value: DoneValue, task: Task, now: number): boolean => {
  switch (value) {
    case "no":
      // "Not done" covers every non-done lifecycle state — today: todo and
      // doing. A future status like "blocked" would also fall here.
      return task.status !== "done";
    case "yes":
      // Equivalent to `status:done` by construction — same predicate, two
      // grammars. `done:` owns temporal completion semantics (yes / no /
      // fresh / stale); `status:` owns raw lifecycle equality. If the
      // definition of "done" ever widens (e.g. a future "archived"
      // state that also counts as done), both this branch and the
      // status:done branch below must move in lockstep — the round-trip
      // test in atoms.test.ts pins the equivalence.
      return task.status === "done";
    case "fresh":
      return isFreshDone(task, now);
    case "stale":
      return isStaleDone(task, now);
  }
};

const evalAtom = (atom: Atom, task: Task, now: number): boolean => {
  switch (atom.kind) {
    case "text":
      // Match the displayed first line (not the raw multi-line title) so a
      // surviving row always carries the matching <mark>; body-only matches
      // would read as "this row passed the filter for no visible reason."
      return matchesQuery(splitTitle(task.title).label, atom.needle);
    case "done":
      return evalDone(atom.value, task, now);
    case "status":
      return task.status === atom.value;
    case "not":
      return !evalAtom(atom.inner, task, now);
  }
};

export const evalAtoms = (atoms: Atom[], task: Task, now: number): boolean =>
  atoms.every((a) => evalAtom(a, task, now));
