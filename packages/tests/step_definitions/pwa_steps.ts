// PWA-specific step definitions — DOM assertions on the rendered HTML.
// Generic HTTP status / content-type / JSON-shape steps live in
// http_steps.ts so other features can reuse the same vocabulary.

import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

// These Thens operate on whatever page `Given the app is running with a
// fresh database` (in task_steps.ts) navigated to. Navigation lives in the
// Given step by convention; Then steps are read-only on `this.page`.

Then(
  "the page head has a link with rel {string} pointing at {string}",
  async function (this: AnywhenWorld, rel: string, href: string) {
    const locator = this.page.locator(`head link[rel="${rel}"][href="${href}"]`);
    await expect(locator).toHaveCount(1);
  },
);

Then("the page head has a meta tag {string}", async function (this: AnywhenWorld, name: string) {
  const locator = this.page.locator(`head meta[name="${name}"]`);
  // ≥1 — names like `theme-color` repeat with `media` queries for adaptive
  // light/dark chrome (the W3C-recommended pattern). The step asserts
  // presence, not uniqueness, so use first()/toBeAttached().
  await expect(locator.first()).toBeAttached();
});
