// Step definitions for the eternalist-UI gestures: a meridian now-tick that
// always renders, an ancestor breadcrumb that only appears when a non-root
// row is selected, and a quote in the empty state.

import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

Then("the meridian rule should show a now-tick", async function (this: AnywhenWorld) {
  const tick = this.page.locator('[data-testid="meridian-now-tick"]');
  await expect(tick).toHaveCount(1);
});

Then(
  "the empty state should contain the quote {string}",
  async function (this: AnywhenWorld, fragment: string) {
    const quote = this.page.locator('[data-testid="empty-quote"]');
    await expect(quote).toContainText(fragment);
  },
);

Then("the breadcrumb should read {string}", async function (this: AnywhenWorld, text: string) {
  const crumb = this.page.locator('[data-testid="breadcrumb"]');
  await expect(crumb).toBeVisible();
  await expect(crumb).toContainText(text);
});

Then("the breadcrumb should not be visible", async function (this: AnywhenWorld) {
  const crumb = this.page.locator('[data-testid="breadcrumb"]');
  await expect(crumb).toHaveCount(0);
});
