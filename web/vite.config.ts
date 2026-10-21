import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  // Dev only: forward the API's paths to a deployed service, whose CORS allows only the site.
  // TTE_API_PROXY=https://tte-api... VITE_API_URL=http://localhost:5173 npm run dev
  const target = loadEnv(mode, ".", "TTE_").TTE_API_PROXY;
  const forward = { target, changeOrigin: true, secure: true };
  return {
    plugins: [react()],
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
