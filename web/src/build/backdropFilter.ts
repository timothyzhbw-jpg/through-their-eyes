// A PostCSS step for the build (vite.config.ts). Lightning CSS, Vite's CSS minifier, folds a rule's
// `backdrop-filter` followed by `-webkit-backdrop-filter` into the prefixed declaration alone,
// which Chrome and Edge ignore: every glass panel lost its blur there. Dropping the prefixed
// declaration first lets the minifier write both forms for the build targets, however a
// stylesheet spells them.
export const dropWebkitBackdropFilter = {
  postcssPlugin: "drop-webkit-backdrop-filter",
  Declaration: {
    "-webkit-backdrop-filter": (decl: { remove(): void }) => {
      decl.remove();
    },
  },
};
