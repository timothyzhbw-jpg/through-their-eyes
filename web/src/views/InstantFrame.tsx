// A 3D pane draws its new frame in the same paint as the layout change that moved it (SPEC 7: a
// switch is a clean cut). React Three Fiber measures its container with react-use-measure, whose
// update lands a task after the layout change: until then a pane that went from the picture in
// picture to the main view shows its old drawing buffer stretched (blurred), then one cleared
// frame. Here a ResizeObserver, which runs after layout and before paint, hands R3F the new size
// at once and draws the frame in a microtask, after R3F has re-rendered whatever reads the size
// (the board's zoom). A pane that is revealed from under another (the board under his belief map)
// draws before it shows, and once while the page is idle, so its shaders are compiled before the
// first cut to it.

import { useThree, type RootState } from "@react-three/fiber";
import { useEffect, useLayoutEffect } from "react";

/** Draw the pane now: its components' frames run and the scene renders. */
function drawNow(get: () => RootState): void {
  const state = get();
  if (state.internal.active) state.advance(performance.now());
}

/** Inside a `<Canvas>`. `visible` false: the pane is hidden and does not draw on its own. */
export function InstantFrame({ visible = true }: { visible?: boolean }) {
  const get = useThree((s) => s.get);

  useEffect(() => {
    const box = get().gl.domElement.parentElement; // the container R3F measures
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // The same rectangle react-use-measure reads, so its later update changes nothing.
      const r = box.getBoundingClientRect();
      const { size, setSize } = get();
      if (r.width === 0 || r.height === 0) return; // hidden: R3F keeps its size too
      if (r.width === size.width && r.height === size.height) return;
      setSize(r.width, r.height, r.top, r.left);
      queueMicrotask(() => drawNow(get));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [get]);

  // Revealed: the frame it shows is drawn now, not the one from before it was hidden.
  useLayoutEffect(() => {
    if (visible) drawNow(get);
  }, [visible, get]);

  // Compiled ahead of the first time it is shown.
  useEffect(() => {
    if (visible) return;
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => drawNow(get));
    return () => cancel(id);
  }, [visible, get]);

  return null;
}
