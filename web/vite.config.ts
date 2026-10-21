import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { dropWebkitBackdropFilter } from "./src/build/backdropFilter";

/** index.html: open the API's connection while the scripts download; the health probe that
 * decides live or offline data gets 3 s, and a new connection on 3G takes about 2 s of it. */
function preconnectApi(api: string | undefined): Plugin {
  const origin = URL.canParse(api ?? "") ? new URL(api!).origin : null;
  return {
    name: "tte-preconnect-api",
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

export default defineConfig(({ mode }) => {
  // Dev only: forward the API's paths to a deployed service, whose CORS allows only the site.
  // TTE_API_PROXY=https://tte-api... VITE_API_URL=http://localhost:5173 npm run dev
  const target = loadEnv(mode, ".", "TTE_").TTE_API_PROXY;
  const forward = { target, changeOrigin: true, secure: true };
  return {
    plugins: [react(), preconnectApi(loadEnv(mode, ".", "VITE_").VITE_API_URL)],
    // Keeps backdrop blur in Chrome and Edge (src/build/backdropFilter.ts).
    css: { postcss: { plugins: [dropWebkitBackdropFilter] } },
    server: target
      ? {
          proxy: {
            "/health": forward,
            "/api": forward,
            "/ws": { ...forward, ws: true },
          },
        }
      : undefined,
    build: {
      // three.js alone is ~700 KB minified; one vendor chunk keeps app updates small.
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined),
          // Dots, not Vite's dashes, since 2026-10-21: a deploy (#115) served the dash-named files
          // as application/octet-stream with a year's cache, which a browser that fetched one
          // keeps; under new names every file starts clean.
          entryFileNames: "assets/[name].[hash].js",
          chunkFileNames: "assets/[name].[hash].js",
          assetFileNames: "assets/[name].[hash][extname]",
        },
      },
    },
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      environment: "node",
    },
  };
});
