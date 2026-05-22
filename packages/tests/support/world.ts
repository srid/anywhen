import { setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";
import type { Browser, BrowserContext, Page } from "playwright";

export class AnywhenWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  serverUrl!: string;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(AnywhenWorld);
