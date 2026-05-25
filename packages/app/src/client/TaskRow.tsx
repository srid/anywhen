// Per-row UI: the JSX, the focus / edit-input effects, the highlight
// segmentation, the markdown body, and the row-scoped drop-zone memo.
//
// This is anywhen's most-edited surface (drag handles, status cycle,
// multi-line body, dimmed class all touched here in recent commits) and
// owns one volatility axis — per-row presentation. The component is
// purely a consumer: it doesn't own any signals, only reads them and
// invokes the callbacks the parent provides.

import { type Accessor, createEffect, createMemo, For, Show, type Setter } from "solid-js";
import MarkdownIt from "markdown-it";
import type { Row } from "../shared/filter";
import type { TaskId, TaskStatus } from "../shared/schemas";
import { splitTitle } from "../shared/title";
import { highlightSegments } from "./highlight";
import type { UseDragReturn } from "./useDrag";
import type { UseEditReturn } from "./useEdit";

// markdown-it config lives behind a name so a reader sees each switch and
// what flipping it would change:
//   - `html: false`  → raw HTML in user content is escaped, not rendered;
//                      no `<script>` smuggling even though anywhen is
//                      single-user.
//   - `linkify: true` → bare URLs like `https://…` autolink without
//                       requiring GFM angle brackets.
//   - `breaks: false` → CommonMark default; a single newline is not a
//                       <br>. Bodies tend to be paragraphs, not poetry.
const MD_OPTIONS = { html: false, linkify: true, breaks: false } as const;
const md = new MarkdownIt(MD_OPTIONS);

// ARIA `aria-pressed` token per lifecycle status. The check is a toggle
// button (advances state on click) not a checkbox — `aria-pressed`
// natively supports tri-state `"true" | "false" | "mixed"` on a <button>
// without forcing a `role="checkbox"` override that biome's a11y lint
// (correctly) flags. `Record<TaskStatus, …>` makes a future fourth status
// a TypeScript error here rather than a silent `"false"` fallback if it
// were a chained ternary on the row's JSX.
const STATUS_TO_ARIA_PRESSED: Record<TaskStatus, "true" | "false" | "mixed"> = {
  todo: "false",
  doing: "mixed",
  done: "true",
};

export type TaskRowProps = {
  row: Row;
  selected: Accessor<TaskId | null>;
  setSelected: Setter<TaskId | null>;
  focusedId: Accessor<TaskId | null>;
  highlightQuery: Accessor<string>;
  expandedBodies: Accessor<Set<TaskId>>;
  toggleBody: (id: TaskId) => void;
  drag: UseDragReturn;
  edit: UseEditReturn;
  onRowKeyDown: (e: KeyboardEvent, id: TaskId) => void;
  onCycleStatus: (id: TaskId) => void;
  onRemove: (id: TaskId) => void;
};

export function TaskRow(props: TaskRowProps) {
  let rowEl!: HTMLDivElement;
  let editInputRef: HTMLTextAreaElement | undefined;
  const isEditing = createMemo(() => props.edit.editing()?.id === props.row.task.id);
  // One memo, one split — keeps label and body derived from a single
  // `splitTitle` call rather than two independent `indexOf('\n')` walks
  // that could disagree.
  const split = createMemo(() => splitTitle(props.row.task.title));
  const firstLine = createMemo(() => split().label);
  const body = createMemo(() => split().body);
  const rowDropZone = createMemo(() => props.drag.dropZoneOn(props.row.task.id));
  const isDragging = createMemo(() => props.drag.isDragging(props.row.task.id));

  // When focusedId matches this row, focus its DOM element. Runs on mount
  // and whenever focusedId changes — so a mutation that tears down and
  // rebuilds this row (Collection delta after cycleStatus / move)
  // re-establishes focus the moment the new element is bound.
  createEffect(() => {
    if (props.focusedId() === props.row.task.id) rowEl.focus();
  });
  // When edit mode opens for this row, move focus into the input and
  // select its contents so the user can replace the title with one
  // keystroke (or refine it with arrow keys).
  createEffect(() => {
    if (isEditing() && editInputRef) {
      editInputRef.focus();
      editInputRef.select();
    }
  });

  return (
    <>
      <div
        ref={rowEl}
        class="row"
        classList={{
          "is-done": props.row.task.status === "done",
          selected: props.selected() === props.row.task.id,
          dragging: isDragging(),
          dimmed: props.row.dimmed,
          "drop-before": rowDropZone() === "before",
          "drop-after": rowDropZone() === "after",
          "drop-inside": rowDropZone() === "inside",
        }}
        data-testid="task-row"
        data-task-firstline={firstLine()}
        data-task-status={props.row.task.status}
        data-task-id={props.row.task.id}
        data-task-parent-id={props.row.task.parentId ?? ""}
        role="treeitem"
        aria-selected={props.selected() === props.row.task.id}
        tabIndex={0}
        onClick={() => props.setSelected(props.row.task.id)}
        onFocus={() => props.setSelected(props.row.task.id)}
        onKeyDown={(e) => props.onRowKeyDown(e, props.row.task.id)}
        onPointerDown={(e) => props.drag.handleRowPointerDown(e, props.row.task.id)}
        onPointerMove={(e) => props.drag.handleRowPointerMove(e, props.row.task.id)}
        onPointerUp={props.drag.handleRowPointerUp}
        onPointerCancel={props.drag.handleRowPointerCancel}
        onLostPointerCapture={props.drag.handleRowPointerCancel}
      >
        <For each={Array.from({ length: props.row.depth })}>{() => <span class="indent" />}</For>
        <span class="drag-handle" data-testid="task-drag-handle" aria-hidden="true">
          <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
            <circle cx="2.5" cy="3" r="1.2" />
            <circle cx="7.5" cy="3" r="1.2" />
            <circle cx="2.5" cy="8" r="1.2" />
            <circle cx="7.5" cy="8" r="1.2" />
            <circle cx="2.5" cy="13" r="1.2" />
            <circle cx="7.5" cy="13" r="1.2" />
          </svg>
        </span>
        <button
          type="button"
          class="check"
          classList={{
            doing: props.row.task.status === "doing",
            done: props.row.task.status === "done",
          }}
          data-testid="task-check"
          // ARIA tri-state toggle button: false → "todo", mixed →
          // "doing", true → "done". `aria-pressed` (not `aria-checked`)
          // is correct here — the element is a <button>, not a form
          // checkbox, and pressing advances the state.
          aria-pressed={STATUS_TO_ARIA_PRESSED[props.row.task.status]}
          aria-label={`Advance ${props.row.task.title} (currently ${props.row.task.status})`}
          onClick={(e) => {
            e.stopPropagation();
            props.onCycleStatus(props.row.task.id);
          }}
        />
        <Show
          when={isEditing()}
          fallback={
            <span class="title">
              <For each={highlightSegments(firstLine(), props.highlightQuery())}>
                {(seg) => (seg.match ? <mark>{seg.text}</mark> : <span>{seg.text}</span>)}
              </For>
              <Show when={body()}>
                {" "}
                <button
                  type="button"
                  class="body-toggle"
                  classList={{ open: props.expandedBodies().has(props.row.task.id) }}
                  data-testid="task-body-toggle"
                  data-task-id={props.row.task.id}
                  aria-label={`${
                    props.expandedBodies().has(props.row.task.id) ? "Hide" : "Show"
                  } details for ${firstLine()}`}
                  aria-expanded={props.expandedBodies().has(props.row.task.id)}
                  title="Toggle details"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.toggleBody(props.row.task.id);
                  }}
                >
                  …
                </button>
              </Show>
            </span>
          }
        >
          <textarea
            ref={editInputRef}
            class="title-edit"
            data-testid="task-edit-input"
            // biome-ignore lint/style/noNonNullAssertion: the input only mounts when isEditing() is true
            aria-label={`Edit title for ${props.edit.editing()!.originalTitle}`}
            // biome-ignore lint/style/noNonNullAssertion: see above
            value={props.edit.editing()!.draft}
            onInput={(ev) => props.edit.setDraft(ev.currentTarget.value)}
            onKeyDown={props.edit.handleEditKeyDown}
            onBlur={() => void props.edit.commitEdit()}
            rows={1}
          />
        </Show>
        <button
          type="button"
          class="edit"
          data-testid="task-edit"
          aria-label={`Edit ${props.row.task.title}`}
          title="Edit title"
          onClick={(e) => {
            e.stopPropagation();
            props.edit.beginEdit(props.row.task.id);
          }}
        >
          ✎
        </button>
        <button
          type="button"
          class="delete"
          data-testid="task-delete"
          aria-label={`Delete ${props.row.task.title}`}
          title="Delete (also removes any sub-tasks)"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove(props.row.task.id);
          }}
        >
          ×
        </button>
      </div>
      <Show when={body()}>
        <div
          class="task-body-wrap"
          classList={{ dimmed: props.row.dimmed }}
          style={{ "--row-depth": props.row.depth }}
          data-task-id={props.row.task.id}
          hidden={!props.expandedBodies().has(props.row.task.id)}
        >
          <div
            class="task-body"
            data-testid="task-body"
            data-task-id={props.row.task.id}
            // markdown-it is constructed with html:false so user content
            // can't smuggle raw <script> / <iframe> through.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered HTML is sanitized by markdown-it (html:false)
            innerHTML={md.render(body())}
          />
        </div>
      </Show>
    </>
  );
}
