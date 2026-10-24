// The door on screen for the page's lifetime (like the tour's and the journey's state): a stitched
// match opening one of its hero moments keeps it.

import { createStore } from "../store/store";
import { jumpTo, jumpToTop } from "../ui/reveal";
import { type Door, withDoor } from "./doors";

export interface DoorState {
  door: Door;
  seq: number; // bumps on every opening asked for, so the new door's page comes up at its top
}

export const doors = createStore<DoorState>({ door: "look", seq: 0 });

/**
 * Open `door`. `address`: write `?door=` into the address, so the link the viewer copies opens it.
 * `focus`: move the keyboard to the door's heading once it is drawn (the end card's choices; a tab
 * keeps the focus on itself).
 */
export function openDoor(
  door: Door,
  { address = false, focus = false }: { address?: boolean; focus?: boolean } = {},
): void {
  const same = doors.get().door === door;
  // A new door's page starts at its top: a jump, so the headings there stay plain text.
  if (!same && typeof window !== "undefined") jumpToTop();
  doors.set((s) => ({ door, seq: same ? s.seq : s.seq + 1 }));
  if (address && typeof window !== "undefined") {
    const search = withDoor(window.location.search, door);
    window.history.replaceState(window.history.state, "", `${search}${window.location.hash}`);
  }
  if (focus && typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() =>
      document.getElementById(DOOR_HEADING_ID[door])?.focus({ preventScroll: true }),
    );
  }
}

/** Bring door 1's compare into view once it is drawn (the old ?step=event): a cut, not a glide. */
export function revealCompare(tries = 900): void {
  if (typeof requestAnimationFrame === "undefined") return;
  const el = document.querySelector(".journey-event");
  if (el) jumpTo(el);
  else if (tries > 0) requestAnimationFrame(() => revealCompare(tries - 1));
}

/** Each door's heading: where the keyboard lands when a door is opened from elsewhere. */
export const DOOR_HEADING_ID: Record<Door, string> = {
  look: "moment-title",
  turn: "turn-title",
  studios: "studios-title",
};
