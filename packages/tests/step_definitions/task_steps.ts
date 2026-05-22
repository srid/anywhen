import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

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

When(
  "I click the delete button on the task titled {string}",
  async function (this: AnywhenWorld, title: string) {
    const row = this.page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
    await row.hover();
    await row.locator('[data-testid="task-delete"]').click();
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
