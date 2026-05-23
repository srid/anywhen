import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

Then("GET {string} returns status {int}", async function (
  this: AnywhenWorld,
  path: string,
  status: number,
) {
  const res = await fetch(`${this.serverUrl}${path}`);
  this.lastHttpResponse = res;
  expect(res.status).toBe(status);
});

Then("the response content-type starts with {string}", function (
  this: AnywhenWorld,
  prefix: string,
) {
  const res = this.lastHttpResponse;
  if (!res) throw new Error("No prior response captured");
  const ct = res.headers.get("content-type") ?? "";
  expect(ct.startsWith(prefix)).toBe(true);
});

Then("the JSON response has field {string}", async function (
  this: AnywhenWorld,
  field: string,
) {
  const res = this.lastHttpResponse;
  if (!res) throw new Error("No prior response captured");
  const json = (await res.clone().json()) as Record<string, unknown>;
  expect(json).toHaveProperty(field);
});

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
