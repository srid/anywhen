// Backup steps — export download interception, import file upload, and
// dialog auto-acceptance for the destructive confirm() the import path
// fires. Playwright's download event captures the JSON the client streams
// into a Blob URL; subsequent steps read the saved file off disk.

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { BackupSchema } from "../../app/src/shared/schemas";
import type { AnywhenWorld } from "../support/world";

// Per-world handle to the last download — picked up by the assertion and
// import steps. Cleared between scenarios via the After hook in support/
// hooks.ts (worlds are per-scenario; this is a fresh field each time).
declare module "../support/world" {
  interface AnywhenWorld {
    lastBackupPath?: string;
    lastBackupJson?: unknown;
  }
}

// Accept any confirm() that fires — the import path uses one as its only
// destructive guard. Attached once per scenario; Playwright auto-detaches
// when the page closes in the After hook.
const autoAcceptDialogs = (world: AnywhenWorld) => {
  world.page.on("dialog", async (d) => {
    await d.accept();
  });
};

When("I export the backup", async function (this: AnywhenWorld) {
  const downloadPromise = this.page.waitForEvent("download");
  await this.page.locator('[data-testid="export-button"]').click();
  const download = await downloadPromise;
  const dest = join(
    tmpdir(),
    `anywhen-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  await download.saveAs(dest);
  this.lastBackupPath = dest;
  const raw = await fs.readFile(dest, "utf-8");
  this.lastBackupJson = JSON.parse(raw);
});

Then(
  "the downloaded backup should have version {int}",
  async function (this: AnywhenWorld, version: number) {
    const parsed = BackupSchema.safeParse(this.lastBackupJson);
    if (!parsed.success) {
      throw new Error(`Downloaded backup is not a valid Backup envelope: ${parsed.error.message}`);
    }
    expect(parsed.data.version).toBe(version);
  },
);

Then(
  "the downloaded backup should contain a task titled {string}",
  async function (this: AnywhenWorld, title: string) {
    const parsed = BackupSchema.safeParse(this.lastBackupJson);
    if (!parsed.success) {
      throw new Error(`Downloaded backup is not a valid Backup envelope: ${parsed.error.message}`);
    }
    const found = parsed.data.tasks.some((t) => t.title === title);
    if (!found) {
      throw new Error(
        `Backup did not contain a task titled "${title}". Titles: ${parsed.data.tasks.map((t) => t.title).join(", ")}`,
      );
    }
  },
);

When("I import the most recent backup", async function (this: AnywhenWorld) {
  if (!this.lastBackupPath) throw new Error("No backup has been exported in this scenario");
  autoAcceptDialogs(this);
  await this.page.locator('[data-testid="import-input"]').setInputFiles(this.lastBackupPath);
  // Wait for the import to complete and the Collection delta to reach the
  // client by polling for the expected post-import row count.
  const expected = (this.lastBackupJson as { tasks: unknown[] }).tasks.length;
  await expect(this.page.locator('[data-testid="task-row"]')).toHaveCount(expected);
});

When("I import a file containing {string}", async function (this: AnywhenWorld, body: string) {
  autoAcceptDialogs(this);
  await this.page.locator('[data-testid="import-input"]').setInputFiles({
    name: "garbage.json",
    mimeType: "application/json",
    buffer: Buffer.from(body, "utf-8"),
  });
});

Then(
  "the error message should mention {string}",
  async function (this: AnywhenWorld, fragment: string) {
    const err = this.page.locator('[data-testid="error"]');
    await expect(err).toBeVisible();
    await expect(err).toContainText(fragment);
  },
);
