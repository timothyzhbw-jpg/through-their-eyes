// The 3D view's grade (the Floodlit look, SPEC 7): a warm floodlit centre over a cool night edge,
// and in first person a slight vignette that deepens with the key-moment beat's push-in. In first
// person the beat also lights the edge of the picture on the side of the player the look is for
// while he is in the hero's sight but outside the camera's 95 degrees: the sim's field of view is
// wider than the picture (he sees him from the corner of his eye before he is on screen).
//
// CSS layers over the canvas, not a render pass: no fps cost, and never on the pixels the
// pitch-control parity test reads (those are on the tactical board's canvas).

import { useEffect, useRef } from "react";
import { isSeen, wrapAngle, type Hero } from "../data/hero";
import { useView } from "../session";
import type { PlaybackState } from "../store/playback";
import { useStore } from "../store/store";
import { beatAt, beatsOf, motion, pushAt, ringAt } from "./beat";

export const CAMERA_HALF = (95 / 2) * (Math.PI / 180); // the first-person camera's half width
const EDGE_RAMP = (10 * Math.PI) / 180; // the glow fades in over this angle past the frame edge

/**
 * The edge glow at this frame: -1 for the right edge, +1 for the left, 0 for none, and how
 * strong (0..1). Only while the target is in the POV player's sight and off the picture.
 */
export function peripheryAt(hero: Hero, s: PlaybackState): { side: number; strength: number } {
  const run = hero.runs[s.mode];
  const b = beatAt(beatsOf(hero, run), s.frame);
  const me = hero.ids.indexOf(s.povPlayer);
  if (!b || b.target < 0 || b.observer !== me || s.camera !== "pov")
    return { side: 0, strength: 0 };
  const ring = ringAt(b, s.frame);
  const f = Math.floor(s.frame);
  if (ring <= 0 || !isSeen(hero, run, f, me, b.target)) return { side: 0, strength: 0 };
  const n = hero.n;
  const dx = run.pos[(f * n + b.target) * 2] - run.pos[(f * n + me) * 2];
  const dy = run.pos[(f * n + b.target) * 2 + 1] - run.pos[(f * n + me) * 2 + 1];
  const off = wrapAngle(Math.atan2(dy, dx) - run.head[f * n + me]);
  const outside = Math.min(1, Math.max(0, (Math.abs(off) - CAMERA_HALF) / EDGE_RAMP));
  // Pitch angles turn anticlockwise: a player at a positive angle off the gaze is on his left.
  return { side: Math.sign(off), strength: ring * outside };
}

export function Grade() {
  const { hero, playback } = useView();
  const pov = useStore(playback, (s) => s.camera === "pov");
  const vignette = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shown = { push: -1, left: -1, right: -1 };
    const write = (key: keyof typeof shown, prop: string, v: number) => {
      const rounded = Math.round(v * 50) / 50; // write the style only when it moves visibly
      if (rounded === shown[key] || !vignette.current) return;
      shown[key] = rounded;
      vignette.current.style.setProperty(prop, String(rounded));
    };
    const update = () => {
      const s = playback.get();
      const reduced = motion.get().reduced;
      write("push", "--push", reduced ? 0 : pushAt(hero, hero.runs[s.mode], s.frame));
      const edge = peripheryAt(hero, s);
      write("left", "--edge-left", edge.side > 0 ? edge.strength : 0);
      write("right", "--edge-right", edge.side < 0 ? edge.strength : 0);
    };
    update();
    const stop = [playback.subscribe(update), motion.subscribe(update)];
    return () => stop.forEach((f) => f());
  }, [hero, playback]);
  return (
    <>
      <div className="grade" aria-hidden="true" />
      <div ref={vignette} className="pov-vignette" hidden={!pov} aria-hidden="true" />
    </>
  );
}
