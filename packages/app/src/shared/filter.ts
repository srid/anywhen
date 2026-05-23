// Task-title matcher. Shared between client (drives the live filter UI) and —
// when filter atoms (Phase 5) evaluate server-side — the server. Living in
// shared/ avoids the breaking re-import that would happen if Phase 5 had to
// lift it out of client/. Same rationale as parseInput at shared/input.ts:1-6.
//
// Case-insensitive substring match. The query is trimmed before comparison;
// an empty query never matches anything (caller short-circuits before calling).

export const matchesQuery = (title: string, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return title.toLowerCase().includes(needle);
};

// Split a title into alternating non-match / match segments around the
// matched needle. Returns the original title as a single non-match segment
// when the needle doesn't occur. The first segment is always a non-match
// (possibly empty); segments thereafter alternate. Callers render `match`
// segments with <mark> and others as plain text.
export type MatchSegment = { text: string; match: boolean };

export const highlightSegments = (title: string, query: string): MatchSegment[] => {
  const needle = query.trim();
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
