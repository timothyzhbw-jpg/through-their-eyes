// Moving between the 3D view and the tactical board (SPEC 7): the two panes swap places and sizes,
// so the change morphs with the browser's View Transitions API instead of jumping (styles.css
// names the two panes). Where the API is missing, or under reduced motion, it just changes.

import { flushSync } from "react-dom";
import { motion } from "./beat";

type WithTransition = Document & { startViewTransition?: (update: () => void) => unknown };

export function withViewTransition(change: () => void): void {
  const doc = typeof document === "undefined" ? null : (document as WithTransition);
  if (!doc?.startViewTransition || motion.get().reduced) {
    change();
    return;
  }
  doc.startViewTransition(() => flushSync(change));
}
