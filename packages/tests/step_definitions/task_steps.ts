import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import {
  DROP_ZONES,
  type DropZone,
  ZONE_AFTER_RATIO,
  ZONE_BEFORE_RATIO,
} from "../../app/src/shared/schemas";
import type { AnywhenWorld } from "../support/world";

const isDropZone = (value: string): value is DropZone =>
  (DROP_ZONES as readonly string[]).includes(value);

// Row-relative Y for the centre of each drop zone — derived from the same
// ratios the UI's zoneAt() reads. One module-scoped table so a future
// threshold tweak in App.tsx moves both the mouse and touch step in lockstep.
const ZONE_CENTRE: Record<DropZone, number> = {
  before: ZONE_BEFORE_RATIO / 2,
  inside: (ZONE_BEFORE_RATIO + ZONE_AFTER_RATIO) / 2,
  after: (ZONE_AFTER_RATIO + 1) / 2,
};

Given("the app is running with a fresh database", async function (this: AnywhenWorld) {
  // BeforeAll spawned one server with a temp ANYWHEN_STATE_DIR; scenarios
  // share it. Reset the tasks table via the surface's __test__reset verb
  // so each scenario starts from a known-empty store.
  const res = await fetch(`${this.serverUrl}/rpc/surface/tasks/__test__reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`Reset failed: ${res.status} ${await res.text()}`);
  await this.page.goto(this.serverUrl);
  await this.page.locator('[data-testid="search-input"]').waitFor({ state: "visible" });
  await this.page.waitForLoadState("networkidle");
});

When("I type {string} in the search box", async function (this: AnywhenWorld, text: string) {
  const input = this.page.locator('[data-testid="search-input"]');
  await input.fill(text);
});

When("I press Enter in the search box", async function (this: AnywhenWorld) {
  await this.page.locator('[data-testid="search-input"]').press("Enter");
});

// Type a title + commit with Enter. Used everywhere a scenario needs to seed
// a task — collapses the old "type '+ X' then press Enter" pair.
When("I add a task titled {string}", async function (this: AnywhenWorld, title: string) {
  const input = this.page.locator('[data-testid="search-input"]');
  await input.fill(title);
  await input.press("Enter");
});

When("I click the add button", async function (this: AnywhenWorld) {
  await this.page.locator('[data-testid="add-button"]').click();
});

When(
  "I click the checkbox on the task titled {string}",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await row.locator('[data-testid="task-check"]').click();
  },
);

When(
  "I click the delete button on the task titled {string}",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    // Click without hover so the mobile "visible without hovering" scenario
    // isn't silently rescued by a synthesized :hover state. Force-clicks
    // bypass Playwright's actionability gate — fine here because visibility
    // is asserted separately on the mobile path (see the dedicated step
    // below) and the desktop scenarios assert behavior, not pixel visibility.
    await row.locator('[data-testid="task-delete"]').click({ force: true });
  },
);

// Mobile scenarios assert the CSS @media (pointer: coarse) rule actually
// reveals the delete button. Playwright's toBeVisible() doesn't check opacity,
// so we read the computed value directly — opacity 1 means the coarse-pointer
// rule applied; opacity 0 means the row's hover-only rule is in effect.
Then(
  "the delete button on the task titled {string} should be revealed without hover",
  async function (this: AnywhenWorld, title: string) {
    const btn = this.page
      .locator(`[data-testid="task-row"][data-task-title="${title}"]`)
      .locator('[data-testid="task-delete"]');
    const opacity = await btn.evaluate((el) => Number(getComputedStyle(el).opacity));
    if (opacity < 1) {
      throw new Error(
        `delete button opacity was ${opacity}; the @media (pointer: coarse) rule did not apply`,
      );
    }
  },
);

// The drag handle is display:none on fine pointers and revealed by the
// @media (pointer: coarse) rule. Asserting toBeVisible() exercises the
// same code path that determines real-world visibility on touch devices.
Then(
  "the drag handle on the task titled {string} should be visible",
  async function (this: AnywhenWorld, title: string) {
    const handle = this.page
      .locator(`[data-testid="task-row"][data-task-title="${title}"]`)
      .locator('[data-testid="task-drag-handle"]');
    await expect(handle).toBeVisible();
  },
);

Then(
  "the tree should not contain a task titled {string}",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).toHaveCount(0);
  },
);

Then(
  "the tree should contain a task titled {string}",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).toBeVisible();
  },
);

Then(
  "the task titled {string} should have status {string}",
  async function (this: AnywhenWorld, title: string, status: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).toHaveAttribute("data-task-status", status);
  },
);

// HTML5 native drag-and-drop in headless Chromium needs intermediate
// mousemove events between mousedown and mouseup — otherwise dragover never
// fires on the target and the row's drop handler is silent. We move via the
// raw mouse API with `steps` to force interpolated moves, landing the final
// position inside the target row's before / inside / after zone (matching
// the 25% / 75% split in client/App.tsx → zoneAt).
// Touch-driven reorder: long-press on the source row, then move to the
// target's drop zone. We dispatch synthetic PointerEvents on the rows
// directly (with pointerType: "touch") rather than firing CDP touch events
// — Chromium's touch → pointer-event translation through the input
// pipeline is unreliable in headless test mode. The handlers under test
// consume PointerEvents regardless of provenance, so this exercises the
// long-press + drop-zone logic with the same fidelity and far less
// flake.
When(
  "I touch-drag the task titled {string} {word} the task titled {string}",
  async function (this: AnywhenWorld, source: string, where: string, target: string) {
    if (!isDropZone(where)) {
      throw new Error(`Unknown drop zone: ${where} (expected ${DROP_ZONES.join(", ")})`);
    }
    const sourceRow = this.page.locator(`[data-testid="task-row"][data-task-title="${source}"]`);
    const targetRow = this.page.locator(`[data-testid="task-row"][data-task-title="${target}"]`);
    const sourceBox = await sourceRow.boundingBox();
    const targetBox = await targetRow.boundingBox();
    if (!sourceBox || !targetBox) throw new Error("Could not measure rows for touch-drag");
    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;
    const dx = targetBox.x + targetBox.width / 2;
    const dy = targetBox.y + targetBox.height * ZONE_CENTRE[where];
    const pointer = {
      pointerType: "touch",
      pointerId: 1,
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
    };
    await sourceRow.dispatchEvent("pointerdown", { ...pointer, clientX: sx, clientY: sy });
    // Wait past the long-press window (DRAG_LONGPRESS_MS = 350 in App.tsx).
    await this.page.waitForTimeout(450);
    await sourceRow.dispatchEvent("pointermove", { ...pointer, clientX: dx, clientY: dy });
    // A second move lets the dropTarget signal settle on the final zone
    // before pointerup commits.
    await sourceRow.dispatchEvent("pointermove", { ...pointer, clientX: dx, clientY: dy });
    await sourceRow.dispatchEvent("pointerup", {
      ...pointer,
      clientX: dx,
      clientY: dy,
      buttons: 0,
    });
  },
);

// Handle-drag: presses on the explicit drag handle, which bypasses the
// 350 ms long-press timer and begins dragging immediately. No waitForTimeout
// is needed — that's the entire point of the handle.
When(
  "I handle-drag the task titled {string} {word} the task titled {string}",
  async function (this: AnywhenWorld, source: string, where: string, target: string) {
    if (!isDropZone(where)) {
      throw new Error(`Unknown drop zone: ${where} (expected ${DROP_ZONES.join(", ")})`);
    }
    const sourceRow = this.page.locator(`[data-testid="task-row"][data-task-title="${source}"]`);
    const sourceHandle = sourceRow.locator('[data-testid="task-drag-handle"]');
    const targetRow = this.page.locator(`[data-testid="task-row"][data-task-title="${target}"]`);
    const handleBox = await sourceHandle.boundingBox();
    const targetBox = await targetRow.boundingBox();
    if (!handleBox || !targetBox) {
      throw new Error("Could not measure handle/target for handle-drag");
    }
    const sx = handleBox.x + handleBox.width / 2;
    const sy = handleBox.y + handleBox.height / 2;
    const dx = targetBox.x + targetBox.width / 2;
    const dy = targetBox.y + targetBox.height * ZONE_CENTRE[where];
    const pointer = {
      pointerType: "touch",
      pointerId: 1,
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
    };
    await sourceHandle.dispatchEvent("pointerdown", { ...pointer, clientX: sx, clientY: sy });
    await sourceRow.dispatchEvent("pointermove", { ...pointer, clientX: dx, clientY: dy });
    await sourceRow.dispatchEvent("pointermove", { ...pointer, clientX: dx, clientY: dy });
    await sourceRow.dispatchEvent("pointerup", {
      ...pointer,
      clientX: dx,
      clientY: dy,
      buttons: 0,
    });
  },
);

When(
  "I drag the task titled {string} {word} the task titled {string}",
  async function (this: AnywhenWorld, source: string, where: string, target: string) {
    if (!isDropZone(where)) {
      throw new Error(`Unknown drop zone: ${where} (expected ${DROP_ZONES.join(", ")})`);
    }
    const sourceRow = this.page.locator(`[data-testid="task-row"][data-task-title="${source}"]`);
    const targetRow = this.page.locator(`[data-testid="task-row"][data-task-title="${target}"]`);
    const sourceBox = await sourceRow.boundingBox();
    const targetBox = await targetRow.boundingBox();
    if (!sourceBox || !targetBox) throw new Error("Could not measure rows for drag");
    const dropY = targetBox.y + targetBox.height * ZONE_CENTRE[where];
    const dropX = targetBox.x + targetBox.width / 2;
    await this.page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await this.page.mouse.down();
    // Two interpolated moves: first to a neutral point on the target row,
    // then to the precise drop zone. The intermediate steps trigger the
    // dragstart / dragenter / dragover sequence that headless Chromium
    // skips when mousedown and mouseup share a frame.
    await this.page.mouse.move(dropX, targetBox.y + targetBox.height / 2, {
      steps: 10,
    });
    await this.page.mouse.move(dropX, dropY, { steps: 5 });
    await this.page.mouse.up();
  },
);

Then(
  "the tasks should appear in order: {string}, {string}",
  async function (this: AnywhenWorld, first: string, second: string) {
    const rows = this.page.locator('[data-testid="task-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-task-title", first);
    await expect(rows.nth(1)).toHaveAttribute("data-task-title", second);
  },
);

Then(
  "the task titled {string} should be a child of the task titled {string}",
  async function (this: AnywhenWorld, child: string, parent: string) {
    const parentRow = this.page.locator(`[data-testid="task-row"][data-task-title="${parent}"]`);
    const childRow = this.page.locator(`[data-testid="task-row"][data-task-title="${child}"]`);
    const parentId = await parentRow.getAttribute("data-task-id");
    if (!parentId) throw new Error(`Parent row "${parent}" has no data-task-id`);
    await expect(childRow).toHaveAttribute("data-task-parent-id", parentId);
  },
);

Then(
  "the task titled {string} should be a root task",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).toHaveAttribute("data-task-parent-id", "");
  },
);

// Keyboard nav: Playwright's locator.press() accepts the same key syntax as
// page.keyboard.press(), so vim chords like "Shift+J" and plain "h"/"l"
// flow through unchanged. Focus first so the row's onKeyDown receives the
// event (the tree has no global keydown for these keys — they're per-row).
When(
  "I press {string} on the task titled {string}",
  async function (this: AnywhenWorld, key: string, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await row.focus();
    await row.press(key);
  },
);

When("I focus the task titled {string}", async function (this: AnywhenWorld, title: string) {
  await this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`).focus();
});

// "/" is a global focus-search shortcut, so it shouldn't be dispatched at the
// row — fire it at the page so the window-level handler runs.
When("I press {string} globally", async function (this: AnywhenWorld, key: string) {
  await this.page.keyboard.press(key);
});

Then(
  "the task titled {string} should be selected",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).toHaveAttribute("aria-selected", "true");
  },
);

Then(
  "the task titled {string} should be focused",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).toBeFocused();
  },
);

Then("the search box should be focused", async function (this: AnywhenWorld) {
  await expect(this.page.locator('[data-testid="search-input"]')).toBeFocused();
});

When("I clear the search box", async function (this: AnywhenWorld) {
  await this.page.locator('[data-testid="search-input"]').fill("");
});

Then(
  "the matched substring {string} in the task titled {string} should be highlighted",
  async function (this: AnywhenWorld, fragment: string, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    const mark = row.locator("mark", { hasText: fragment });
    await expect(mark).toBeVisible();
  },
);

Then(
  "the task titled {string} should be dimmed",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).toHaveClass(/(?:^|\s)dimmed(?:\s|$)/);
  },
);

Then(
  "the task titled {string} should not be dimmed",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await expect(row).not.toHaveClass(/(?:^|\s)dimmed(?:\s|$)/);
  },
);
