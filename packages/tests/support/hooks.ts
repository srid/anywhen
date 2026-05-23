// Lifecycle for the cucumber run.
//
// BeforeAll: pick an ephemeral port, mktemp a per-run state dir, spawn
//   $ANYWHEN_BIN (the Nix-built `bin/anywhen` wrapper) with HOST/PORT/
//   ANYWHEN_STATE_DIR pointing at the test sandbox, wait for /api/health.
// Before:    open a fresh Playwright page on the server's URL.
// After:     close the page; on failure dump a screenshot to reports/.
// AfterAll:  close the browser and kill the server.
//
// E2E spawns the production binary (not `bun src/...`) so the cucumber
// run exercises the closure that ships — pre-built client `dist/`, frozen
// `node_modules`, and the wrapper that sets ANYWHEN_DIST_DIR. The just
// recipe builds `nix build .#anywhen` and exports ANYWHEN_BIN before
// invoking cucumber-js. Mirrors the shape of kolu's e2e hook.

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
// Spawn the Nix-built anywhen binary (set by `just test` after a
// `nix build .#anywhen`) so e2e exercises the production closure —
// pre-built client `dist/`, frozen `node_modules`, and the wrapper that
// pins ANYWHEN_DIST_DIR. Running `bun src/server/index.ts` from source
// would build the client at startup against the dev tree, which is a
// different code path than what ships.
const ANYWHEN_BIN = process.env.ANYWHEN_BIN;
if (!ANYWHEN_BIN) {
  throw new Error(
    "ANYWHEN_BIN is not set. Run e2e via `just test` (which builds the Nix package and points ANYWHEN_BIN at $out/bin/anywhen) instead of invoking cucumber-js directly.",
  );
}

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

  serverProcess = spawn(ANYWHEN_BIN, [], {
    stdio: "pipe",
    env: {
      ...process.env,
      HOST: "127.0.0.1",
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

Before(async function (this: AnywhenWorld) {
  if (!browserSingleton) throw new Error("Browser was not initialised by BeforeAll");
  this.serverUrl = serverUrl;
  this.browser = browserSingleton;
  this.context = await this.browser.newContext();
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
