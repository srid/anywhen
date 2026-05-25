---
description: anywhen's product stance and schemas-first edit chain — agent constraints when adding features
applyTo: "**"
---

## anywhen — product stance

anywhen is a quiet personal task manager. Some affordances are **deliberate
omissions**, not absent-features-yet-to-build. Do not add any of the
following without an explicit user instruction overriding this rule:

- **No urgency theater.** No red, no "overdue", no due-today badge, no
  notifications. The app never tries to make you feel late.
- **No counts in chrome.** "12 of 247 tasks" creates pressure where the
  tree itself is the truth. If you want a count, look.
- **No surfaced timestamps.** `createdAt` / `updatedAt` exist on the row;
  they're never on the page.
- **One search box.** Filter and add are the same gesture: type.
- **Done is a state, not a triumph.** Strikethrough and italic — no
  confetti, no streaks.
- **The tree is given.** No pagination, no "load more", no depth limit.
  Long titles wrap; never truncate.
- **No smart lists.** "Today" / "This week" / "Overdue" views are out.
- **No calendar grids, no streak counters, no completion rings, no
  toasts celebrating completed tasks.**
- **No push or browser notifications.** The PWA is installable, not noisy.
- **No title-bar / favicon badges with unread counts.**
- **No "pin to top" / "snooze until" verbs.** Position in the tree is the
  only sorting.

When in doubt: the app's job is to be a quiet place to keep your
attention, not to compete for it. The canonical phrasing of these
constraints lives in `README.md` under `## Philosophy` and `### What this
rules out`.

## Schemas-first edit chain

When adding a server-mediated feature, the ripple walks one volatility axis
per file. Touch the layers in this order; treat each as the single source of
truth for its concern:

1. **`packages/app/src/shared/schemas.ts`** — domain types via Zod. New input
   shapes, new fields on `Task`, new invariants, new constants shared with
   tests (drag thresholds, position semantics) — all live here. Types are
   inferred from schemas via `z.infer`; never declare a runtime type
   alongside its Zod schema.
2. **`packages/app/src/shared/surface.ts`** — the wire contract. Add a
   procedure entry that references the schemas from step 1 as `input` /
   `output`. The Collection's verbs stay read-only (`keys`/`get`); writes
   route through procedures so server-side allocation (id, position) and
   validation stay on one side of the wire.
3. **`packages/app/src/server/router.ts`** — dispatch. Implement the
   procedure handler. Single-row writes go through `writeAndPublish` so the
   SQL→cache fan-out is structural, not a per-handler convention.
4. **`packages/app/src/storage/tasks.ts`** — SQL. Add the store method that
   the router calls. Transactional writes share a `db.transaction()` if
   they read-then-write.
5. **`packages/app/src/client/...`** — UI. New columns become row displays,
   new procedures become handlers. Per `view-component-owns-one-axis` (see
   `.agency/code-police.md`), do not bundle a new feature's state machine,
   keyboard map, or RPC wrapper into `App.tsx` — extract a sibling module.

Adding a new filter atom kind is a different walk: see the file-header
comment of `packages/app/src/shared/query.ts` — one variant added to the
union, one parser branch, one evaluator branch. Nothing in `App.tsx` or the
`rows()` memo changes.
