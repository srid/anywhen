// Standalone client bundler — called by the server at startup (dev path)
// and by the Nix package's buildPhase (production path).
//
// Bun.serve's HTML-import bundler does not honor plugins registered
// through bunfig preload, so we drive Bun.build ourselves with an inline
// babel-preset-solid + babel-preset-typescript plugin. Keeping the build
// in its own module lets nix/packages/anywhen invoke `bun build-client.ts
// <outDir>` at Nix build time and ship the resulting dist/ inside the
// store path — the server then skips the build when ANYWHEN_DIST_DIR
// points at a pre-built directory.

import { resolve } from "node:path";
import { transformAsync } from "@babel/core";
// @ts-expect-error - babel preset types are loose
import babelTypeScript from "@babel/preset-typescript";
// @ts-expect-error - babel preset types are loose
import babelSolid from "babel-preset-solid";
import type { BunPlugin } from "bun";

const solidJsxPlugin: BunPlugin = {
  name: "anywhen-solid",
  setup(build) {
    build.onLoad({ filter: /\.(?:js|ts)x$/ }, async (args) => {
      const code = await Bun.file(args.path).text();
      const result = await transformAsync(code, {
        filename: args.path,
        presets: [babelSolid, babelTypeScript],
      });
      if (!result?.code) throw new Error(`Babel transform produced no output for ${args.path}`);
      return { contents: result.code, loader: "js" };
    });
  },
};

// Single source of truth for PWA assets that bypass Bun.build's HTML-import
// bundler. Each entry drives two things: the post-build copy from clientDir
// into outDir (so static serving + the SW's `cache.addAll(APP_SHELL)` find
// them at predictable URLs), and any per-path response-header overrides at
// serve time (Bun.file infers MIME from extension and gets .js / .svg right,
// but `.webmanifest` is non-standard so set it explicitly;
// Service-Worker-Allowed widens the SW's controllable scope — not strictly
// required when the SW sits at the root, but harmless and future-proof).
// Adding a new PWA asset = one row here.
export type PwaFile = { name: string; headers?: HeadersInit };
export const PWA_FILES: readonly PwaFile[] = [
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

export async function buildClient({ clientDir, outDir }: { clientDir: string; outDir: string }): Promise<void> {
  const result = await Bun.build({
    entrypoints: [resolve(clientDir, "index.html")],
    outdir: outDir,
    target: "browser",
    minify: false,
    plugins: [solidJsxPlugin],
  });
  if (!result.success) {
    for (const msg of result.logs) console.error(msg);
    throw new Error("Client build failed");
  }
  // Copy each PWA asset alongside the bundled output. The Nix package pre-
  // bakes this into $out/share/anywhen/packages/app/dist (so production
  // closures ship the SW, manifest, and icons); the dev path repeats it on
  // every server startup.
  for (const { name } of PWA_FILES) {
    await Bun.write(resolve(outDir, name), Bun.file(resolve(clientDir, name)));
  }
}

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("usage: bun build-client.ts <out-dir>");
    process.exit(1);
  }
  const clientDir = resolve(import.meta.dirname, "client");
  await buildClient({ clientDir, outDir });
  console.log(`[build-client] wrote ${outDir}`);
}
