// The site's build hints (SPEC 8): the API's connection opened from index.html when the build
// has an API, and hashed files named [name].[hash] whatever else the config sets.

import { mergeConfig, type IndexHtmlTransformHook, type UserConfig } from "vite";
import { describe, expect, it } from "vitest";
import { siteHints } from "./siteHints";

const tags = (api: string | undefined) => {
  const hook = siteHints(api).transformIndexHtml as IndexHtmlTransformHook;
  return hook.call({} as never, "", {} as never);
};

const config = (api?: string) => {
  const hook = siteHints(api).config as () => UserConfig;
  // As Vite merges a plugin's config into the project's (vite.config.ts sets manualChunks).
  const own: UserConfig = { build: { rollupOptions: { output: { manualChunks: () => "x" } } } };
  return mergeConfig(own, hook());
};

describe("siteHints", () => {
  it("preconnects to the API's origin, with the CORS mode its fetches use", () => {
    expect(tags("https://api.example.test/some/path")).toEqual([
      {
        tag: "link",
        attrs: { rel: "preconnect", href: "https://api.example.test", crossorigin: true },
        injectTo: "head",
      },
    ]);
  });

  it("adds nothing without an API, or with one that is not a URL", () => {
    expect(tags(undefined)).toEqual([]);
    expect(tags("")).toEqual([]);
    expect(tags("%VITE_API_URL%")).toEqual([]);
  });

  it("names hashed files [name].[hash], keeping the project's chunking", () => {
    const output = config().build!.rollupOptions!.output as Record<string, unknown>;
    expect(output.entryFileNames).toBe("assets/[name].[hash].js");
    expect(output.chunkFileNames).toBe("assets/[name].[hash].js");
    expect(output.assetFileNames).toBe("assets/[name].[hash][extname]");
    expect(typeof output.manualChunks).toBe("function");
  });
});
