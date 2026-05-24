// `<mark>`-segment rendering for the live filter. Lives in client/ because
// it's a UI concern — splitting a title into alternating non-match / match
// pieces only serves the highlighted-row rendering pipeline. Phase 5's
// server-side filter atoms import `matchesQuery` from shared/filter.ts;
// nothing on the server cares about segment boundaries for rendering.
//
// Match positions come from `matchPositions` in shared/filter.ts — the
// same primitive `matchesQuery` reduces to a boolean — so the highlighted
// ranges always align with what the filter pass keeps.

import { matchPositions } from "../shared/filter";

export type MatchSegment = { text: string; match: boolean };

export const highlightSegments = (title: string, query: string): MatchSegment[] => {
  const positions = matchPositions(title, query);
  if (positions.length === 0) return [{ text: title, match: false }];
  const segments: MatchSegment[] = [];
  let cursor = 0;
  for (const { start, end } of positions) {
    if (start > cursor) segments.push({ text: title.slice(cursor, start), match: false });
    segments.push({ text: title.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < title.length) segments.push({ text: title.slice(cursor), match: false });
  return segments;
};
