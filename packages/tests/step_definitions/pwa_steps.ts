import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

type FetchState = {
  response?: Response;
  body?: string;
  json?: Record<string, unknown>;
};

const state = (world: AnywhenWorld): FetchState => {
  const w = world as AnywhenWorld & { pwa?: FetchState };
  if (!w.pwa) w.pwa = {};
  return w.pwa;
};

Then("GET {string} returns status {int}", async function (
  this: AnywhenWorld,
  path: string,
  status: number,
) {
  const res = await fetch(`${this.serverUrl}${path}`);
  const body = await res.text();
  const s = state(this);
  s.response = res;
  s.body = body;
  s.json = undefined;
  try {
    s.json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    // not JSON; field assertions will fail loudly if used.
  }
  expect(res.status).toBe(status);
});

Then("the response content-type starts with {string}", function (
  this: AnywhenWorld,
  prefix: string,
) {
  const res = state(this).response;
  if (!res) throw new Error("No prior response captured");
  const ct = res.headers.get("content-type") ?? "";
  expect(ct.startsWith(prefix)).toBe(true);
});

Then("the JSON response has field {string}", function (this: AnywhenWorld, field: string) {
  const json = state(this).json;
  if (!json) throw new Error("Last response was not JSON");
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
