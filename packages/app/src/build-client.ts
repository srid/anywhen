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
