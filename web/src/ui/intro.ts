// Page-lifetime state: only main opens the card, before the first render. Session changes keep
// the dismissed state when a stitched match opens a hero breakdown or the viewer returns.

import { createStore } from "../store/store";

export const intro = createStore({ open: false });
