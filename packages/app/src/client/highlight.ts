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
  const lowerTitle = title.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const segments: MatchSegment[] = [];
  let cursor = 0;
  while (cursor < title.length) {
    const idx = lowerTitle.indexOf(lowerNeedle, cursor);
    if (idx < 0) {
      segments.push({ text: title.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) segments.push({ text: title.slice(cursor, idx), match: false });
    segments.push({ text: title.slice(idx, idx + needle.length), match: true });
    cursor = idx + needle.length;
  }
  return segments;
};
