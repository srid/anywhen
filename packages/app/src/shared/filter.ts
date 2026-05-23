// Task-title matcher. Shared between client (drives the live filter UI) and —
// when filter atoms (Phase 5) evaluate server-side — the server. Living in
// shared/ avoids the breaking re-import that would happen if Phase 5 had to
// lift this out of client/. Same rationale as parseInput at shared/input.ts:1-6.
//
// Highlight-segment rendering — the UI counterpart that splits a title
// around the matched needle — lives at client/highlight.ts; it has no
// server consumer. Normalization for both sides routes through
// `normalizeQuery` in shared/input.ts so parser and matcher can never
// drift on what counts as the same query.

import { normalizeQuery } from "./input";

export const matchesQuery = (title: string, query: string): boolean => {
  const needle = normalizeQuery(query).toLowerCase();
  if (!needle) return false;
  return title.toLowerCase().includes(needle);
};
