// A task's `title` is one string: the first line is the row label, any
// remaining lines are the markdown body. Splitting in one place (rather
// than re-deriving from `indexOf('\n')` at each consumer) keeps the
// label-vs-body rule a single decision — the renderer, the filter, the
// test harness, and any future server-side caller all read it through
// the same call.

export type SplitTitle = { label: string; body: string };

export const splitTitle = (title: string): SplitTitle => {
  const i = title.indexOf("\n");
  if (i === -1) return { label: title, body: "" };
  return { label: title.slice(0, i), body: title.slice(i + 1).trimEnd() };
};
