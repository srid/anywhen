// Lifecycle for the cucumber run.
//
// BeforeAll: pick an ephemeral port, mktemp a per-run state dir, spawn the
//   bun server with ANYWHEN_STATE_DIR pointing at it, wait for /api/health.
// Before:    open a fresh Playwright page on the server's URL.
// After:     close the page; on failure dump a screenshot to reports/.
// AfterAll:  close the browser and kill the server.
//
// Mirrors the shape of kolu-master/packages/tests/support/hooks.ts but at
// the scale of a single feature — no agent mocks, no PTY whitelist, just
// enough to drive the search box and assert the tree.

import { AfterAll, Before, BeforeAll, After, Status } from "@cucumber/cucumber";
import type { ITestCaseHookParameter } from "@cucumber/cucumber";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import getPort from "get-port";
import { chromium } from "playwright";
import type { AnywhenWorld } from "./world";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SERVER_ENTRY = join(REPO_ROOT, "packages/app/src/server/index.ts");

let serverProcess: ChildProcess | undefined;
let serverUrl: string;
let stateDir: string;
let browserSingleton: Awaited<ReturnType<typeof chromium.launch>> | undefined;

const waitForHealth = async (url: string, timeoutMs = 15_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Server still booting; retry.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server at ${url} did not become healthy within ${timeoutMs}ms`);
};

BeforeAll({ timeout: 30_000 }, async () => {
  const port = await getPort();
  stateDir = mkdtempSync(join(tmpdir(), "anywhen-test-"));
  serverUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn("bun", [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      PORT: String(port),
      ANYWHEN_STATE_DIR: stateDir,
    },
  });

  serverProcess.stdout?.on("data", (b) => process.stderr.write(`[server] ${b}`));
  serverProcess.stderr?.on("data", (b) => process.stderr.write(`[server] ${b}`));
  serverProcess.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[server] exited code=${code} signal=${signal}\n`);
    }
  });

  await waitForHealth(serverUrl);

  browserSingleton = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

Before({ tags: "not @mobile" }, async function (this: AnywhenWorld) {
  if (!browserSingleton) throw new Error("Browser was not initialised by BeforeAll");
  this.serverUrl = serverUrl;
  this.browser = browserSingleton;
  this.context = await this.browser.newContext();
  this.page = await this.context.newPage();
});

// Scenarios tagged @mobile get a touch-enabled phone-sized context so the
// long-press drag handler exercises the pointerType='touch' branch and the
// mobile media queries kick in.
Before({ tags: "@mobile" }, async function (this: AnywhenWorld) {
  if (!browserSingleton) throw new Error("Browser was not initialised by BeforeAll");
  this.serverUrl = serverUrl;
  this.browser = browserSingleton;
  this.context = await this.browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  this.page = await this.context.newPage();
});

After(async function (this: AnywhenWorld, scenario: ITestCaseHookParameter) {
  if (scenario.result?.status === Status.FAILED && this.page) {
    const dir = join(REPO_ROOT, "packages/tests/reports/screenshots");
    mkdirSync(dir, { recursive: true });
    const slug = scenario.pickle.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    // Best-effort: don't let a screenshot failure obscure the real test failure.
    await this.page.screenshot({ path: join(dir, `${slug}.png`) }).catch(() => {});
  }
  await this.context?.close();
});

AfterAll(async () => {
  await browserSingleton?.close();
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    if (!serverProcess.killed) serverProcess.kill("SIGKILL");
  }
  if (stateDir) {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
