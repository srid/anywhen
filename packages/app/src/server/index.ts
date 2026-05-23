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
import { transformAsync } from "@babel/core";
// @ts-expect-error - babel preset types are loose
import babelTypeScript from "@babel/preset-typescript";
import { RPCHandler as WsRPCHandler } from "@orpc/server/bun-ws";
import { RPCHandler } from "@orpc/server/fetch";
// @ts-expect-error - babel preset types are loose
import babelSolid from "babel-preset-solid";
import type { BunPlugin, ServerWebSocket } from "bun";
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

// Solid JSX transform. babel-preset-solid emits the compiled-template
// runtime (template/insert/createComponent) so signals drive DOM updates;
// the typescript preset strips type annotations first.
const solidJsxPlugin: BunPlugin = {
  name: "anywhen-solid",
  setup(build) {
    build.onLoad({ filter: /\.(?:js|ts)x$/ }, async (args) => {
      const code = await Bun.file(args.path).text();
      const result = await transformAsync(code, {
        filename: args.path,
        presets: [
          [babelSolid, {}],
          [babelTypeScript, {}],
        ],
      });
      if (!result?.code) throw new Error(`Babel transform produced no output for ${args.path}`);
      return { contents: result.code, loader: "js" };
    });
  },
};

const CLIENT_DIR = resolve(import.meta.dirname, "..", "client");
const DIST_DIR = resolve(import.meta.dirname, "..", "..", "dist");

const buildResult = await Bun.build({
  entrypoints: [resolve(CLIENT_DIR, "index.html")],
  outdir: DIST_DIR,
  target: "browser",
  minify: false,
  plugins: [solidJsxPlugin],
});

if (!buildResult.success) {
  for (const msg of buildResult.logs) console.error(msg);
  throw new Error("Client build failed");
}

const server = Bun.serve({
  port,
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
    if (!filePath.startsWith(DIST_DIR)) return new Response("Forbidden", { status: 403 });

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

console.log(`anywhen listening on http://localhost:${server.port}`);
console.log(`  state dir: ${stateDir}`);
console.log(`  dist dir:  ${DIST_DIR}`);
