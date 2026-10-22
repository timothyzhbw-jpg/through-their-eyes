// Build hints for the static website (SPEC 8), a Vite plugin so vite.config.ts stays small.
//
// - index.html opens the API's connection while the scripts download: the health probe that
//   decides live or offline data gets 3 s, and a new connection on 3G takes about 2 s of it.
// - Hashed files are named [name].[hash], not Vite's [name]-[hash], since 2026-10-21: a deploy
//   (#115) served the dash-named files as application/octet-stream with a year's cache, which a
//   browser that fetched one keeps; under new names every file starts clean.

import type { Plugin } from "vite";

export function siteHints(api: string | undefined): Plugin {
  const origin = URL.canParse(api ?? "") ? new URL(api!).origin : null;
  return {
    name: "tte-site-hints",
    config: () => ({
      build: {
        rollupOptions: {
          output: {
            entryFileNames: "assets/[name].[hash].js",
            chunkFileNames: "assets/[name].[hash].js",
            assetFileNames: "assets/[name].[hash][extname]",
          },
        },
      },
    }),
    transformIndexHtml: () =>
      origin
        ? [
            {
              tag: "link",
              attrs: { rel: "preconnect", href: origin, crossorigin: true },
              injectTo: "head",
            },
          ]
        : [],
  };
}
