// Lifecycle for the cucumber run.
//
// BeforeAll: pick an ephemeral port, mktemp a per-run state dir, spawn the
//   wrapped anywhen binary (Nix-built, exposed via $ANYWHEN_TEST_BIN by
//   `nix develop .#e2e`) with ANYWHEN_STATE_DIR pointing at it, wait for
//   /api/health.
// Before:    open a fresh Playwright page on the server's URL.
// After:     close the page; on failure dump a screenshot to reports/.
// AfterAll:  close the browser and kill the server.
//
// Mirrors the shape of kolu-master/packages/tests/support/hooks.ts but at
// the scale of a single feature — no agent mocks, no PTY whitelist, just
// enough to drive the search box and assert the tree.
//
// Black-box e2e: tests spawn the *same* artifact `nix run` would, not
// `bun src/server/index.ts`. Changes to the build derivation (deps,
// client bundle, wrapper) get exercised end-to-end; the source-tree
// spawn path is reserved for `just dev`.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ITestCaseHookParameter } from "@cucumber/cucumber";
import { After, AfterAll, Before, BeforeAll, Status } from "@cucumber/cucumber";
import getPort from "get-port";
import { chromium } from "playwright";
import type { AnywhenWorld } from "./world";

const REPORTS_DIR = resolve(import.meta.dirname, "..", "reports");

const resolveTestBin = (): string => {
  const bin = process.env.ANYWHEN_TEST_BIN;
  if (!bin) {
    // Distinguish "no e2e shell at all" from "stale e2e shell that pre-dates
    // ANYWHEN_TEST_BIN being added". PLAYWRIGHT_BROWSERS_PATH is the canary
    // for the latter — it was set by the e2e shell long before TEST_BIN was.
    const inE2eShell = process.env.PLAYWRIGHT_BROWSERS_PATH !== undefined;
    const hint = inE2eShell
      ? "You appear to be inside the e2e shell (PLAYWRIGHT_BROWSERS_PATH is set), but ANYWHEN_TEST_BIN is missing — the shell is likely stale. Exit and re-enter via `nix develop .#e2e`."
      : "Run tests via `nix develop .#e2e -c just test` so the wrapped Nix-built binary is available.";
    throw new Error(`ANYWHEN_TEST_BIN is not set. ${hint}`);
  }
  return bin;
};

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

  serverProcess = spawn(resolveTestBin(), [], {
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
    const dir = join(REPORTS_DIR, "screenshots");
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
    // Give the server 200 ms to flush and exit cleanly before SIGKILL.
    await new Promise((r) => setTimeout(r, 200));
    if (!serverProcess.killed) serverProcess.kill("SIGKILL");
  }
  if (stateDir) {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
