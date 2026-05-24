// Bun.serve hosts everything: bundled client, oRPC over HTTP under `/rpc/*`
// (one-shot mutations + the `__test__reset` cucumber hook), and oRPC over
// WebSocket under `/rpc/ws` (Collection snapshot+deltas via the surface's
// streaming `keys` / `get(key)` verbs).
//
// Client bundling lives in `./build.ts` so the Nix `buildPhase` invokes the
// same code path. At dev/test boot we call `buildClient(dist.path)`; under
// `nix run` the wrapper sets `ANYWHEN_DIST_DIR` to a pre-built /nix/store
// path and the build call is skipped.

import { hostname as osHostname } from "node:os";
import { resolve } from "node:path";
import { RPCHandler as WsRPCHandler } from "@orpc/server/bun-ws";
import { RPCHandler } from "@orpc/server/fetch";
import type { ServerWebSocket } from "bun";
import { startBackupScheduler } from "../storage/backup";
import { openDb, resolveStateDir } from "../storage/db";
import { seedSampleData } from "../storage/seed";
import { taskStore } from "../storage/tasks";
import { buildClient, pwaHeadersFor } from "./build";
import { buildRouter } from "./router";

const stateDir = resolveStateDir();
const { db, dbPath } = await openDb(stateDir);
const store = taskStore(db);
// Opt-in sample data for `just dev`. The recipe sets the env var; cucumber
// does not, so e2e scenarios still start from an empty DB. seedSampleData is
// itself a no-op once any tasks exist, so repeated `just dev` runs against a
// populated DB never clobber user data.
if (process.env.ANYWHEN_SEED_SAMPLE_DATA === "1") {
  await seedSampleData(store);
}
// Cache mirrors `tasks` for the Collection's synchronous `readAll`. Seeded
// once from SQL at boot; mutated by procedure handlers via the framework's
// `ctx.collections.tasks.{upsert,remove}` fan-out (see `router.ts`).
const cache = await store.listMap();
// Rolling on-disk backup. Writes once immediately, then hourly; prunes
// anything older than seven days. Files share `BackupSchema` with
// `api.export`, so any one of them is a drop-in for `api.import`.
startBackupScheduler(store, resolve(stateDir, "backups"));
const router = buildRouter(store, cache, { hostname: osHostname(), dbPath });
const httpHandler = new RPCHandler(router);
const wsHandler = new WsRPCHandler(router);

const port = Number(process.env.PORT ?? 7700);
const hostname = process.env.HOST;

// Either "use this pre-built dist" (production / `nix run`) or "build into
// this writable path" (dev / cucumber). The env var is the sole adapter;
// the rest of the server treats `dist.path` uniformly.
const dist = process.env.ANYWHEN_DIST_DIR
  ? { kind: "prebuilt" as const, path: process.env.ANYWHEN_DIST_DIR }
  : { kind: "build" as const, path: resolve(import.meta.dirname, "..", "..", "dist") };
if (dist.kind === "build") {
  await buildClient(dist.path);
} else {
  // Fail loud at startup if the wrapper points at a directory missing the
  // built dist — without this assertion, `Bun.file` on a missing path
  // returns a zero-byte BunFile and the SPA fallback (below) would serve
  // 200 OK with an empty body instead of a clear error.
  if (!(await Bun.file(resolve(dist.path, "index.html")).exists())) {
    throw new Error(
      `ANYWHEN_DIST_DIR=${dist.path} is set but index.html is missing — the wrapper points at an unbuilt dist.`,
    );
  }
}
const DIST_DIR = dist.path;

const server = Bun.serve({
  port,
  hostname,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/rpc/ws") {
      const ok = srv.upgrade(req);
      if (ok) return undefined;
      return new Response("WebSocket upgrade failed", { status: 426 });
    }

    // `/rpc/*` and `/api/*` are the "always network-only" namespaces — the
    // service worker's isRpcPath predicate (client/service-worker.js) mirrors
    // this. New top-level RPC-ish prefixes must be added in both places.
    if (path === "/api/health") return new Response("ok", { status: 200 });

    if (path.startsWith("/rpc/")) {
      try {
        const result = await httpHandler.handle(req, { prefix: "/rpc" });
        if (result.matched && result.response) return result.response;
        return new Response("RPC not matched", { status: 404 });
      } catch (err) {
        console.error("[rpc] error", err);
        return new Response(String(err), { status: 500 });
      }
    }

    // Static serve from dist/ for everything else; SPA fallback to index.html.
    const candidate = path === "/" ? "/index.html" : path;
    const filePath = resolve(DIST_DIR, `.${candidate}`);
    if (!filePath.startsWith(DIST_DIR)) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file, { headers: pwaHeadersFor(path) });

    // SPA fallback — any unknown path serves index.html so client-side
    // routing (if introduced later) doesn't 404 on direct navigation.
    return new Response(Bun.file(resolve(DIST_DIR, "index.html")));
  },
  websocket: {
    async message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
      await wsHandler.message(ws, message);
    },
    close(ws: ServerWebSocket<unknown>) {
      wsHandler.close(ws);
    },
  },
});

console.log(`anywhen listening on http://${server.hostname}:${server.port}`);
console.log(`  state dir: ${stateDir}`);
console.log(`  dist dir:  ${DIST_DIR} (${dist.kind})`);
