// Step definitions for the runtime-info footer. The footer reads hostname
// and dbPath from the server via the `runtime.info` surface procedure, so
// these steps assert against whatever the running test server reports —
// not against a hardcoded value.

import { hostname } from "node:os";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

const footer = (world: AnywhenWorld) => world.page.locator('[data-testid="footer-runtime"]');

Then("the footer should link to {string}", async function (this: AnywhenWorld, href: string) {
  const link = footer(this).locator(`a[href="${href}"]`);
  await expect(link).toBeVisible();
});

Then("the footer should show the server hostname", async function (this: AnywhenWorld) {
  const host = footer(this).locator('[data-testid="footer-hostname"]');
  await expect(host).toHaveText(hostname());
});

Then(
  "the footer should show a database path ending in {string}",
  async function (this: AnywhenWorld, suffix: string) {
    const path = footer(this).locator('[data-testid="footer-dbpath"]');
    await expect(path).toContainText(suffix);
  },
);
