import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

Given("the app is running with a fresh database", async function (this: AnywhenWorld) {
  // BeforeAll spawned the server with a brand-new temp ANYWHEN_STATE_DIR.
  // The single scenario in PR 1 doesn't need per-scenario isolation; PR
  // 2's search work introduces a test__reset endpoint when there's more
  // than one scenario.
  await this.page.goto(this.serverUrl);
  await this.page.locator('[data-testid="search-input"]').waitFor({ state: "visible" });
});

When("I type {string} in the search box", async function (this: AnywhenWorld, text: string) {
  const input = this.page.locator('[data-testid="search-input"]');
  await input.fill(text);
});

When("I press Enter in the search box", async function (this: AnywhenWorld) {
  await this.page.locator('[data-testid="search-input"]').press("Enter");
});

When(
  "I click the checkbox on the task titled {string}",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await row.locator('[data-testid="task-check"]').click();
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
