// Domain-agnostic HTTP step definitions. Anything that talks to the server
// via raw `fetch` — status / content-type / JSON-shape assertions — lives
// here so future endpoint tests share the same vocabulary instead of
// reinventing it per feature file. The last response is captured on
// AnywhenWorld so subsequent Thens can interrogate it.

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
