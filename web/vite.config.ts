import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { dropWebkitBackdropFilter } from "./src/build/backdropFilter";
import { siteHints } from "./src/build/siteHints";

export default defineConfig(({ mode }) => {
  // Dev only: forward the API's paths to a deployed service, whose CORS allows only the site.
  // TTE_API_PROXY=https://tte-api... VITE_API_URL=http://localhost:5173 npm run dev
  const target = loadEnv(mode, ".", "TTE_").TTE_API_PROXY;
  const forward = { target, changeOrigin: true, secure: true };
  return {
    // The API's preconnect and the hashed files' names (src/build/siteHints.ts).
    plugins: [react(), siteHints(loadEnv(mode, ".", "VITE_").VITE_API_URL)],
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
      // three.js alone is ~700 KB minified; one vendor chunk keeps app updates small. The meshopt
      // decoder stays its own chunk: only the baked stadium loads it, after the first frame.
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: (id) =>
            id.includes("node_modules") && !id.includes("meshopt_decoder") ? "vendor" : undefined,
        },
      },
    },
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      environment: "node",
    },
  };
});
