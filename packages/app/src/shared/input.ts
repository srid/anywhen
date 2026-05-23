// Query normalization. Shared between client (drives the live filter UI) and —
// when filter atoms (Phase 5) evaluate server-side — the server, so the wire
// shape evolution doesn't have to lift this out of client/.
//
// `normalizeQuery` is the single canonical normalization point; the matcher
// in shared/filter.ts re-applies it on its own inputs so a caller that
// bypasses the search-box UI (e.g. future server-side filter-atom evaluation)
// still hits the same rules.

// Whitespace-trim is the only normalization today. Centralized here so when
// the rules grow (Unicode NFC, fold case, strip diacritics), both the search
// box and the matcher pick up the change atomically.
export const normalizeQuery = (raw: string): string => raw.trim();
