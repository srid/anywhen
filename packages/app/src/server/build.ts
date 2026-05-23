// Client bundler — extracted from server/index.ts so the Nix build
// derivation can invoke the same code path the dev server uses at startup.
// One implementation; two callers: `bun build.ts <distDir>` from the Nix
// `buildPhase`, and `buildClient(distDir)` from the dev server when
// ANYWHEN_DIST_DIR is unset.
//
// Bun.serve's HTML-import bundler does not honor plugins registered through
// bunfig preload — `babel-preset-solid`'s JSX transform never fires there,
// and Bun's default JSX transform emits `React.createElement` calls that
// break at runtime. Bun.build accepts a `plugins` array directly, so we
// drive the build ourselves.

import { resolve } from "node:path";
import { transformAsync } from "@babel/core";
// @ts-expect-error - babel preset types are loose
import babelTypeScript from "@babel/preset-typescript";
// @ts-expect-error - babel preset types are loose
import babelSolid from "babel-preset-solid";
import type { BunPlugin } from "bun";

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

// Single source of truth for PWA assets that bypass Bun.build's HTML-import
// bundler. Each entry drives two things: the post-build copy from CLIENT_DIR
// into the dist directory, and any per-path response-header overrides at
// serve time (Bun.file infers MIME from extension and gets .js / .svg right,
// but `.webmanifest` is non-standard so set it explicitly;
// Service-Worker-Allowed widens the SW's controllable scope — not strictly
// required when the SW sits at the root, but harmless and future-proof).
// Adding a new PWA asset = one row here.
type PwaFile = { name: string; headers?: HeadersInit };
const PWA_FILES: readonly PwaFile[] = [
  {
    name: "service-worker.js",
    headers: { "Content-Type": "application/javascript", "Service-Worker-Allowed": "/" },
  },
  { name: "manifest.webmanifest", headers: { "Content-Type": "application/manifest+json" } },
  { name: "icon.svg" },
  { name: "icon-maskable.svg" },
];

export const pwaHeadersFor = (path: string): HeadersInit | undefined =>
  PWA_FILES.find((f) => path === `/${f.name}`)?.headers;

const CLIENT_DIR = resolve(import.meta.dirname, "..", "client");

export async function buildClient(distDir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [resolve(CLIENT_DIR, "index.html")],
    outdir: distDir,
    target: "browser",
    minify: false,
    plugins: [solidJsxPlugin],
  });
  if (!result.success) {
    for (const msg of result.logs) console.error(msg);
    throw new Error("Client build failed");
  }
  for (const { name } of PWA_FILES) {
    await Bun.write(resolve(distDir, name), Bun.file(resolve(CLIENT_DIR, name)));
  }
}

// CLI form for the Nix builder: `bun build.ts <outdir>`.
if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: bun build.ts <distDir>");
    process.exit(1);
  }
  await buildClient(resolve(out));
}
