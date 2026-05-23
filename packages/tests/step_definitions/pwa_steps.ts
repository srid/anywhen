// PWA-specific step definitions — DOM assertions on the rendered HTML.
// Generic HTTP status / content-type / JSON-shape steps live in
// http_steps.ts so other features can reuse the same vocabulary.

import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

Then(
  "the page head has a link with rel {string} pointing at {string}",
  async function (this: AnywhenWorld, rel: string, href: string) {
    await this.page.goto(this.serverUrl);
    const locator = this.page.locator(`head link[rel="${rel}"][href="${href}"]`);
    await expect(locator).toHaveCount(1);
  },
);

Then("the page head has a meta tag {string}", async function (this: AnywhenWorld, name: string) {
  await this.page.goto(this.serverUrl);
  const locator = this.page.locator(`head meta[name="${name}"]`);
  await expect(locator).toHaveCount(1);
});
