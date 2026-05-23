// Bun.serve hosts everything: bundled client, oRPC over HTTP under `/rpc/*`
// (one-shot mutations + the `__test__reset` cucumber hook), and oRPC over
// WebSocket under `/rpc/ws` (Collection snapshot+deltas via the surface's
// streaming `keys` / `get(key)` verbs).
//
// The client is built explicitly via Bun.build (NOT via Bun.serve's HTML
// import) because Bun.serve's HTML bundler does not honor plugins
// registered through bunfig preload — `bun-plugin-solid`'s JSX transform
// never fires there, and Bun's default JSX transform emits
// `React.createElement` calls that break at runtime. Bun.build accepts a
// `plugins` array directly, so we drive the build ourselves.

import { resolve } from "node:path";
import { RPCHandler as WsRPCHandler } from "@orpc/server/bun-ws";
import { RPCHandler } from "@orpc/server/fetch";
import type { ServerWebSocket } from "bun";
import { buildClient } from "../build-client";
import { openDb, resolveStateDir } from "../storage/db";
import { taskStore } from "../storage/tasks";
import { buildRouter } from "./router";

const stateDir = resolveStateDir();
const db = await openDb(stateDir);
const store = taskStore(db);
// Cache mirrors `tasks` for the Collection's synchronous `readAll`. Seeded
// once from SQL at boot; mutated by procedure handlers via the framework's
// `ctx.collections.tasks.{upsert,remove}` fan-out (see `router.ts`).
const cache = await store.listMap();
const router = buildRouter(store, cache);
const httpHandler = new RPCHandler(router);
const wsHandler = new WsRPCHandler(router);

const port = Number(process.env.PORT ?? 7700);
// `hostname` accepts an IP (`0.0.0.0` for all interfaces) or a name Bun
// resolves at boot. Default to all interfaces so `just dev` is reachable
// from other devices on the LAN; the NixOS module wires this from
// `services.anywhen.host`.
const hostname = process.env.HOST ?? "0.0.0.0";

// When ANYWHEN_DIST_DIR is set, the caller (typically the Nix package's
// wrapper) has pre-built the client bundle at that path — skip the
// runtime build so we don't try to write into the read-only Nix store.
// Unset (the dev shell path) keeps the existing behavior: build into
// packages/app/dist at startup.
const distDir = process.env.ANYWHEN_DIST_DIR;
const DIST_DIR = distDir ?? resolve(import.meta.dirname, "..", "..", "dist");
if (!distDir) {
  const clientDir = resolve(import.meta.dirname, "..", "client");
  await buildClient({ clientDir, outDir: DIST_DIR });
}

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
    // Containment check needs the trailing separator — `startsWith(DIST_DIR)`
    // alone admits sibling prefixes (`/var/lib/anywhen-dist-evil` starts with
    // `/var/lib/anywhen-dist`), which a crafted `..` path can reach. Comparing
    // with the separator (or equality with DIST_DIR itself for the dir hit)
    // rejects those.
    if (filePath !== DIST_DIR && !filePath.startsWith(`${DIST_DIR}/`)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);

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
console.log(`  dist dir:  ${DIST_DIR}`);
