import { setDefaultTimeout, setWorldConstructor, World } from "@cucumber/cucumber";
import type { Browser, BrowserContext, Page } from "playwright";

// Cucumber's default step timeout is 5_000 ms — tight enough that CI
// runners under load occasionally trip a step that locally finishes in
// well under a second. Bump to 15_000 ms so async work the step is
// waiting on (page.goto, playwright auto-wait inside expect()) has
// breathing room without masking real hangs (a 15s wait is still a
// failure signal worth diagnosing).
setDefaultTimeout(15_000);

export class AnywhenWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  serverUrl!: string;
  // Single source of truth for the last HTTP response captured by a step.
  // Body / JSON parsings derive at the call site via `.clone().text()` /
  // `.clone().json()` so the world holds one fact, not three.
  lastHttpResponse?: Response;

  // Register the universal auto-accept handler. Called at scenario start
  // and after a one-shot dismiss fires, so the page always has exactly one
  // dialog handler unless an override is in flight.
  acceptAllDialogs(): void {
    this.page.removeAllListeners("dialog");
    this.page.on("dialog", (d) => void d.accept());
  }

  // Override the universal accept-handler for one dialog, then restore it.
  // After the .once fires the universal handler is back in place, so any
  // further dialog in the same scenario is accepted rather than left
  // unhandled.
  dismissNextConfirm(): void {
    this.page.removeAllListeners("dialog");
    this.page.once("dialog", async (d) => {
      await d.dismiss();
      this.acceptAllDialogs();
    });
  }
}

setWorldConstructor(AnywhenWorld);
