// Search-box input grammar + the canonical query-normalization function.
// Shared between client (drives the UI) and — when filter atoms (Phase 5)
// evaluate server-side — the server, so the wire-shape evolution doesn't
// have to lift this out of client/.
//
// `parseInput` returns `q` already passed through `normalizeQuery`; the
// matcher in shared/filter.ts re-applies the same function on its own
// inputs so a caller that bypasses `parseInput` (e.g. future server-side
// filter-atom evaluation) still hits the same normalization rules.

// Whitespace-trim is the only normalization today. Centralized here so
// when the rules grow (Unicode NFC, fold case, strip diacritics), both
// the parser and the matcher pick up the change atomically.
export const normalizeQuery = (raw: string): string => raw.trim();

export type Input = { kind: "create"; title: string } | { kind: "query"; q: string } | null;

export const parseInput = (raw: string): Input => {
  const trimmed = normalizeQuery(raw);
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const title = trimmed.slice(1).trim();
    return title ? { kind: "create", title } : null;
  }
  return { kind: "query", q: trimmed };
};
