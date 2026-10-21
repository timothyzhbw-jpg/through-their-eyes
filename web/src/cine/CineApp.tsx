// Full-screen capture renderer (SPEC 10), for filming the demo video only. Nothing in the app
// links here. An external script opens /?cine=1 (with intro=0 and autoplay=0), waits until
// window.__cine.ready, calls load(shot), then render(t) once per output frame and screenshots
// the page. There is no animation loop: render draws exactly one frame, and the same shot and t
// always make the same picture.
//
// load checks the shot (the zod spec, then the opened data's players and vision model) and keeps
// it. A shot maps seconds to match frames and to a camera: each key's eye and look are a world
// point, a player (with an offset or an orbit), the ball, or a player's eyes. Optional pieces are
// handheld shake, depth of field, bloom, head-whip blur, peripheral darkening, a vision cone,
// rings, shirt numbers, belief ghosts, fog, exposure and a letterbox.
//
// info() describes the opened data: the two runs (frames, decision, reception, scans, events)
// and, for a stitched match, its possessions. render() returns the frame, run, eye and look in
// pitch metres, the vertical field of view and the head-whip blur sigma it drew.

import { advance, Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import type { Hero, Run, Scan } from "../data/hero";
import { RiggedFallback, RiggedPlayers } from "../players/RiggedPlayers";
import { trial } from "../players/trial";
import { useView } from "../session";
import { useStore } from "../store/store";
import { CinePost } from "./CinePost";
import { CineScene } from "./CineScene";
import { bindView, cineRuntime, onShot, publishShot, requireView, type DrawnPose } from "./runtime";
import { frameAt, loadShot, type Vec3 } from "./shot";
import { whenStadiumSettled } from "../views/bakedStadium";

export interface CineRunInfo {
  frames: number;
  decision: number | null;
  reception: number | null;
  scans: { id: string; player: string; start: number; end: number; key: boolean }[];
  events: { id: string; type: string; frame: number; player: string }[];
}

export interface CineInfo {
  kind: Hero["kind"];
  scenario: string;
  seed: number;
  dt: number;
  /** Player id, or null when the opened data has no hero (a stitched match). */
  hero: string | null;
  runner: string | null;
  keyScan: { id: string; player: string; start: number; end: number; key: boolean } | null;
  players: { id: string; team: number; number: number }[];
  runs: { factual: CineRunInfo; counterfactual: CineRunInfo };
  /** A stitched match's possessions, or null for a hero moment. `end` is the last frame. */
  possessions: { index: number; start: number; end: number; hero: string | null }[] | null;
}

export interface CineApi {
  version: 1;
  ready: boolean;
  info(): CineInfo;
  load(shot: unknown): { ok: true; duration: number } | { ok: false; errors: string[] };
  render(t: number): {
    frame: number;
    run: string;
    eye: Vec3;
    look: Vec3;
    fov: number;
    blurSigma: number;
  };
}

declare global {
  interface Window {
    __cine: CineApi;
  }
}

function scanInfo(scan: Scan | null) {
  if (!scan) return null;
  return { id: scan.id, player: scan.player, start: scan.start, end: scan.end, key: scan.key };
}

function runInfo(hero: Hero, run: Run): CineRunInfo {
  const reception = run.events.find((e) => e.type === "reception" && e.player === hero.heroId);
  return {
    frames: run.frames,
    decision: run.decision?.frame ?? null,
    reception: reception ? reception.frame : null,
    scans: run.scans.map((s) => ({
      id: s.id,
      player: s.player,
      start: s.start,
      end: s.end,
      key: s.key,
    })),
    events: run.events.map((e) => ({ id: e.id, type: e.type, frame: e.frame, player: e.player })),
  };
}

const cineApi: CineApi = {
  version: 1,
  ready: false,
  info() {
    const { hero } = requireView();
    return {
      kind: hero.kind,
      scenario: hero.scenario,
      seed: hero.seed,
      dt: hero.dt,
      hero: hero.heroId,
      runner: hero.runnerId,
      keyScan: scanInfo(hero.keyScan),
      players: hero.players.map((p) => ({ id: p.id, team: p.team, number: p.number })),
      runs: {
        factual: runInfo(hero, hero.runs.factual),
        counterfactual: runInfo(hero, hero.runs.counterfactual),
      },
      possessions: hero.match
        ? hero.match.possessions.map((p) => ({
            index: p.index,
            start: p.start,
            end: p.start + p.frames - 1,
            hero: p.hero,
          }))
        : null,
    };
  },
  load(input) {
    const { hero } = requireView();
    const result = loadShot(input, {
      ids: hero.ids,
      heroId: hero.heroId,
      hasVision: hero.vision !== null,
    });
    if (!result.ok) return result;
    flushSync(() => publishShot(result.shot));
    return { ok: true, duration: result.shot.duration };
  },
  render(t) {
    const shot = cineRuntime.shot;
    if (!shot) throw new Error("call load(shot) before render(t)");
    const { playback } = requireView();
    cineRuntime.t = t;
    cineRuntime.blurSigma = 0;
    cineRuntime.drawn = null;
    const frame = frameAt(shot, t);
    playback.set({
      mode: shot.run,
      frame,
      playing: false,
      comfort: false,
      camera: shot.pov ? "pov" : "broadcast",
      ...(shot.pov ? { povPlayer: shot.pov } : {}),
      beliefGhosts: shot.ghosts,
    });
    advance(t * 1000);
    const drawn = cineRuntime.drawn as DrawnPose | null; // set by the camera rig inside advance()
    if (!drawn) throw new Error("cine drew no frame");
    return {
      frame,
      run: shot.run,
      eye: drawn.eye,
      look: drawn.look,
      fov: drawn.fov,
      blurSigma: cineRuntime.blurSigma,
    };
  },
};

if (typeof window !== "undefined") window.__cine = cineApi;

/** One warmup frame, then the capture script may drive. A second path must not draw again. The
 * warmup frame also asks for the baked stadium: ready waits until it is in (or has failed), so a
 * shot never cuts from one stadium to the other. */
let warming = false;
function markReady() {
  if (cineApi.ready || warming) return;
  warming = true;
  advance(0);
  whenStadiumSettled(() => {
    advance(0);
    cineApi.ready = true;
  });
}

function CineReady() {
  useEffect(() => {
    markReady();
  }, []);
  return null;
}

function TokenReady() {
  useEffect(() => {
    markReady();
  }, []);
  return null;
}

function Players() {
  const rigged = useStore(trial, (s) => s.rigged);
  if (!rigged) return <TokenReady />;
  return (
    <RiggedFallback>
      <Suspense fallback={null}>
        <RiggedPlayers />
        <CineReady />
      </Suspense>
    </RiggedFallback>
  );
}

function barsFor(ratio: number, w: number, h: number): { axis: "x" | "y"; size: number } | null {
  if (w < 1 || h < 1) return null;
  if (w / h > ratio) {
    const size = (w - h * ratio) / 2;
    return size > 0.5 ? { axis: "x", size } : null;
  }
  const size = (h - w / ratio) / 2;
  return size > 0.5 ? { axis: "y", size } : null;
}

function Letterbox({ ratio }: { ratio: number | null }) {
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  if (ratio == null) return null;
  const bars = barsFor(ratio, viewport.w, viewport.h);
  if (!bars) return null;
  const style = {
    position: "fixed" as const,
    background: "#000",
    pointerEvents: "none" as const,
    zIndex: 2,
  };
  if (bars.axis === "x") {
    return (
      <>
        <div style={{ ...style, top: 0, left: 0, width: bars.size, height: "100vh" }} />
        <div style={{ ...style, top: 0, right: 0, width: bars.size, height: "100vh" }} />
      </>
    );
  }
  return (
    <>
      <div style={{ ...style, top: 0, left: 0, width: "100vw", height: bars.size }} />
      <div style={{ ...style, bottom: 0, left: 0, width: "100vw", height: bars.size }} />
    </>
  );
}

export function CineApp() {
  const view = useView();
  bindView(view);
  const forced = useRef(false);
  if (!forced.current) {
    forced.current = true;
    trial.set({ rigged: true });
  }
  const [letterbox, setLetterbox] = useState<number | null>(null);
  // Bound during render: load() flushes the bars before it returns, ahead of any effect.
  onShot((shot) => setLetterbox(shot.letterbox));
  useEffect(() => () => onShot(null), []);
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlBg: html.style.background,
      bodyBg: body.style.background,
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
    };
    html.style.background = "#000";
    body.style.background = "#000";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.background = previous.htmlBg;
      body.style.background = previous.bodyBg;
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
    };
  }, []);

  return (
    <>
      <Canvas
        frameloop="never"
        dpr={1}
        gl={{
          antialias: false,
          preserveDrawingBuffer: true,
          toneMapping: ACESFilmicToneMapping,
          outputColorSpace: SRGBColorSpace,
        }}
        camera={{ fov: 40, near: 0.05, far: 400, position: [0, 15, 30] }}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh" }}
      >
        <CineScene />
        <CinePost />
        <Players />
      </Canvas>
      <Letterbox ratio={letterbox} />
    </>
  );
}
