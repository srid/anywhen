import { setWorldConstructor, World } from "@cucumber/cucumber";
import type { Browser, BrowserContext, Page } from "playwright";

export class AnywhenWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  serverUrl!: string;
  // Single source of truth for the last HTTP response captured by a step.
  // Body / JSON parsings derive at the call site via `.clone().text()` /
  // `.clone().json()` so the world holds one fact, not three.
  lastHttpResponse?: Response;
}

setWorldConstructor(AnywhenWorld);
