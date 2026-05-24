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

  // Override the universal accept-handler for one dialog, then restore it.
  // After the .once fires the universal handler is back in place, so any
  // further dialog in the same scenario is accepted rather than left
  // unhandled. Centralized here so the Playwright dialog-event mechanics
  // live in one place — step definitions just declare intent.
  dismissNextConfirm(): void {
    this.page.removeAllListeners("dialog");
    this.page.once("dialog", async (d) => {
      await d.dismiss();
      this.page.on("dialog", (d2) => void d2.accept());
    });
  }
}

setWorldConstructor(AnywhenWorld);
