# anywhen code-police rules

anywhen-specific rules layered on top of the base `code-police` skill — read by
`code-police` from this file (`.agency/code-police.md`) when it runs. Each
appears as its own row in Pass 1 (rule checklist) alongside the generic rules.

## view-component-owns-one-axis

A SolidJS view component file (a `packages/app/src/client/*.tsx` that
default-exports a component) should own **one** volatility axis — the page or
row layout it renders, plus the top-level signals that drive that layout —
and compose sibling modules for anything with independent volatility.

**Trigger.** The file owns **≥3** of the following independent axes in one
closure (state machine, derived state, and handlers all in the same scope):

- A pointer/touch state machine (mutually-exclusive pending / active
  drag-or-drop lifecycle).
- An RPC error-handling policy (mutation wrapper, error-toast policy,
  destructive-confirm helper).
- A form-edit lifecycle (begin / commit / cancel / inline-input key handler).
- A filter / query grammar pipeline derived from a single signal (parsed
  atoms, derived rows, lever state, staleness clock).
- A keyboard binding map paired with its dispatcher, when the map exceeds
  ~10 entries or the dispatcher branches on modifiers.
- A multi-step import/export flow with parsing + validation + user confirm.
- Per-row presentation — the body of a `<For>` over the main collection,
  plus per-row memos and effects — when that body exceeds ~100 LOC of JSX.

File length is not the trigger on its own. `storage/tasks.ts` at 324 LOC
bundles one axis (SQL CRUD for the tasks table) and stays unsplit; a 600-LOC
`App.tsx` whose body is shell JSX + 1-2 small axes also stays unsplit. The
rule fires when **multiple independent volatility axes** are interleaved in
the same closure, not on raw size.

Bad: a single `App.tsx` whose body holds signals, a mutation wrapper, the
drag state machine, the keyboard binding map, the edit lifecycle, the
import/export flow, and ~200 lines of row JSX, all reading and writing the
same closure-scoped signals — seven axes braided together (the original
1101-LOC version of `client/App.tsx`).

Good: `App.tsx` owns signals + shell JSX + composition; each high-volatility
axis lives in its own module that takes a **narrow** signal slice (never a
god-context bag of every signal in the parent):

- `client/rpc.ts` — `callWrite`, `callQuery`, `confirmDestructive` (RPC
  error-handling policy).
- `client/useDrag.ts` — owns its own `DragState` signal (a discriminated
  union, not parallel slots); returns `pointerHandlers`.
- `client/useEdit.ts` — owns its own `editing` signal; returns lifecycle +
  `handleEditKeyDown`.
- `client/TaskRow.tsx` — the per-row JSX (the most-edited surface in the app).

_Rationale_. This codebase's strongest LLM-coding affordance is the
schemas-first edit chain (`shared/schemas.ts → shared/surface.ts →
server/router.ts → storage/tasks.ts → client/...`) — one volatility axis
per file. A view component that re-bundles many axes back into one
thousand-line closure undoes that affordance at the consumption boundary;
every change to drag, every change to keys, every change to edit forces the
entire file into the agent's context window. Codified after the first
refactor that collapsed `client/App.tsx` from 1101 LOC down to a composition
root plus four sibling modules.

_How to apply_. When a PR touches a `.tsx` that crosses the trigger, the
police finding proposes the extraction shape with explicit per-module
signal slices (not a `Signals` god-bag — that pattern moves the file
boundary without removing the coupling). Two structural prerequisites for
any drag extraction:

1. Collapse parallel slots (`drag`, `dropTarget`, `pendingPress`) into one
   `createSignal<DragState>` discriminated union **before** extracting —
   otherwise the new module enforces an invariant across a file gap instead
   of within a type.
2. Wrap the store so the cache fan-out (`store.X()` → collection upsert) is
   structural in `server/router.ts`, not a per-procedure checklist —
   otherwise the "add a procedure" recipe is patching a structural bug with
   documentation.

_Axes that don't pull their weight on extraction_. A small keyboard binding
map (a `Record<string, Handler>` literal + a 10-line dispatcher) and a thin
import/export flow (call `api.export()`, save blob; or `safeParse` + `confirm`
+ `api.import()`) each count as one axis when tallying the trigger but are
**not extracted by default** — the trigger has to be ≥3 axes for the rule to
fire, and these two are usually the last to go. Extract them when their
volatility becomes real: context-conditional keybinding arrives, or
client-side cloud sync / schema versioning lands in the backup flow.

_Limits_. A 250-line component with one coherent concern is fine — this rule
is about **multiple axes**, not raw size. `client/MeridianRule.tsx` (79 LOC),
`client/Breadcrumb.tsx` (41 LOC), `client/highlight.ts` (27 LOC) are the
right shape for this codebase.
