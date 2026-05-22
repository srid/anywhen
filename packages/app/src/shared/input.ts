// Search-box input parser. Shared between client (drives the UI) and —
// when PR 2/3 lands — the server (evaluates filter atoms server-side
// for Collection deltas). Living in shared/ avoids the multi-file
// breaking refactor that would happen if PR 2 had to lift it out of
// client/.
//
// PR 1: only the `create` arm is consumed by handleKeyDown (Enter on
// `+ title` adds a task). The `query` arm is wired but inert until
// PR 2 fills in the matcher.

export type Input = { kind: "create"; title: string } | { kind: "query"; q: string } | null;

export const parseInput = (raw: string): Input => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const title = trimmed.slice(1).trim();
    return title ? { kind: "create", title } : null;
  }
  return { kind: "query", q: trimmed };
};
