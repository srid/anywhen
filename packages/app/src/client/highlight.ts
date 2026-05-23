// `<mark>`-segment rendering for the live filter. Lives in client/ because
// it's a UI concern — splitting a title into alternating non-match / match
// pieces only serves the highlighted-row rendering pipeline. Phase 5's
// server-side filter atoms import `matchesQuery` from shared/filter.ts;
// nothing on the server cares about segment boundaries for rendering.
//
// Normalization rules ride the same `normalizeQuery` the matcher uses, so
// the highlighted ranges always align with what `matchesQuery` returns
// true for.

import { normalizeQuery } from "../shared/input";

export type MatchSegment = { text: string; match: boolean };

export const highlightSegments = (title: string, query: string): MatchSegment[] => {
  const needle = normalizeQuery(query);
  if (!needle) return [{ text: title, match: false }];
  // matchAll with a global regex replaces the while+indexOf cursor loop:
  // each match carries its index, so we can slice the gaps between matches
  // without manually tracking a cursor variable.
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const segments: MatchSegment[] = [];
  let cursor = 0;
  for (const m of title.matchAll(re)) {
    const idx = m.index ?? cursor;
    if (idx > cursor) segments.push({ text: title.slice(cursor, idx), match: false });
    segments.push({ text: title.slice(idx, idx + m[0].length), match: true });
    cursor = idx + m[0].length;
  }
  if (cursor < title.length) segments.push({ text: title.slice(cursor), match: false });
  return segments.length ? segments : [{ text: title, match: false }];
};
