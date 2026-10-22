// What the broadcast camera adds to the 3D view (SPEC 7): the camera itself (broadcast.ts gives
// the shot, this puts the three.js camera there), the live tags over players (measured stats on
// the factual run, otherwise the sim's sprint; scans and blind-side alerts), and on the grass
// rings under the hero (white) and the runner (gold) as on the board, the blind-side lines and,
// around the decision, the pass options as on the tactical board, and on request the skeleton
// (../skeleton/). Grass
// layers are depth tested so players stand on top of them, like a broadcaster's ground graphics.

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ALERT_COLOR, alertsAt } from "../alerts/blindSide";
import type { Sample } from "../data/hero";
import type { Beat } from "../beat/beat";
import type { Vec2 } from "../data/types";
import {
  colorFor,
  optionsVisible,
  passOptions,
  valueRange,
  widthFor,
} from "../options/passOptions";
import { useView } from "../session";
import { SkeletonLayer } from "../skeleton/SkeletonLayer";
import { statsStore } from "../stats/store";
import { useStore } from "../store/store";
import { cameraPose, shotAt, type BroadcastPath, type Shot } from "./broadcast";
import { liveTags, tagSource, type LiveTag } from "./broadcastTags";
import { COLORS, teamColor } from "./scene";

const NEAR = 1; // m: the camera is 40-110 m from the play; a far near plane keeps depth precise
const FAR = 400;
const GRASS = 0.05; // m above the pitch for ground graphics
const TAG_PX = 26; // on-screen height of a live tag
const TAG_LIFT = 2.3; // m above the grass where a tag sits
const TAGS = 10; // sprites in the pool

/** The key-moment beat's framing at full push: the hero alone, this much tighter; once he has
 * seen the player the look is for, both of them with this margin (m), at most this much wider
 * than the shot was, and a little left of centre, clear of the moment card on the right. */
const PUSH = { tighten: 0.36, margin: 12, maxWiden: 1.35, left: 0.1, revealFrames: 8 };

export interface Framing {
  hero: Vec2; // pitch m
  target: Vec2 | null; // the player he sees, once he has seen him
  reveal: number; // 0..1: from the hero alone to both
  amount: number; // 0..1: the beat's push
}

/** The beat's framing at this frame (beat/beat.ts): `sample` holds the frame's positions. */
export function beatFraming(b: Beat, sample: Sample, frame: number, amount: number): Framing {
  const at = (j: number): Vec2 => [sample.pos[2 * j], sample.pos[2 * j + 1]];
  const seen = b.sighted !== null && b.target >= 0 && frame >= b.sighted;
  const t = seen ? Math.min(1, (frame - b.sighted!) / PUSH.revealFrames) : 0;
  return {
    hero: at(b.observer),
    target: seen ? at(b.target) : null,
    reveal: t * t * (3 - 2 * t),
    amount,
  };
}

/** Move `shot` towards the beat's framing: in on the hero, then out to both. */
export function pushShot(shot: Shot, f: Framing): void {
  const tight = { x: f.hero[0], y: f.hero[1], width: shot.width * (1 - PUSH.tighten) };
  let goal = tight;
  if (f.target && f.reveal > 0) {
    const [tx, ty] = f.target;
    const width = Math.min(
      shot.width * PUSH.maxWiden,
      Math.max(tight.width, Math.abs(tx - f.hero[0]) + 2 * PUSH.margin),
    );
    const both = { x: (f.hero[0] + tx) / 2 + PUSH.left * width, y: (f.hero[1] + ty) / 2, width };
    goal = {
      x: tight.x + (both.x - tight.x) * f.reveal,
      y: tight.y + (both.y - tight.y) * f.reveal,
      width: tight.width + (both.width - tight.width) * f.reveal,
    };
  }
  shot.x += (goal.x - shot.x) * f.amount;
  shot.y += (goal.y - shot.y) * f.amount;
  shot.width += (goal.width - shot.width) * f.amount;
}

/**
 * Put the three.js camera on the broadcast shot at this frame; `framing` moves it for the
 * key-moment beat.
 */
export function filmBroadcast(
  camera: THREE.PerspectiveCamera,
  path: BroadcastPath,
  frame: number,
  aspect: number,
  shot: Shot,
  framing?: Framing,
): void {
  shotAt(path, frame, shot);
  if (framing && framing.amount > 0) pushShot(shot, framing);
  const pose = cameraPose(shot, aspect);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  if (camera.fov !== pose.fov || camera.near !== NEAR || camera.aspect !== aspect) {
    camera.fov = pose.fov;
    camera.near = NEAR;
    camera.far = FAR;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}

/** Broadcast-only layers; `sample` is the frame the view sampled this redraw. */
export function BroadcastLayers({ sample }: { sample: Sample }) {
  const { playback } = useView();
  const on = useStore(playback, (s) => s.camera === "broadcast");
  return (
    <group visible={on}>
      <KeyPlayers sample={sample} />
      <GrassBlindSide sample={sample} />
      <GrassOptions />
      <TagSprites sample={sample} />
      <SkeletonLayer sample={sample} variant="broadcast" />
    </group>
  );
}

// ---------- the hero and the runner, ringed on the grass ----------

function KeyPlayers({ sample }: { sample: Sample }) {
  const { hero } = useView();
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const keys = [
    { j: hero.hero, color: COLORS.white },
    { j: hero.runner, color: COLORS.gold },
  ].filter((k) => k.j >= 0);
  useFrame(() => {
    keys.forEach(({ j }, k) => {
      rings.current[k]?.position.set(sample.pos[2 * j], GRASS, -sample.pos[2 * j + 1]);
    });
  });
  return (
    <>
      {keys.map(({ j, color }, k) => (
        <mesh
          key={j}
          ref={(m) => {
            rings.current[k] = m;
          }}
          rotation-x={-Math.PI / 2}
        >
          <ringGeometry args={[0.8, 1.0, 40]} />
          <meshBasicMaterial color={color} opacity={0.8} toneMapped={false} {...grass} />
        </mesh>
      ))}
    </>
  );
}

// ---------- blind side: a thin line on the grass from each observer to the player he lost ----------

function GrassBlindSide({ sample }: { sample: Sample }) {
  const { hero, playback } = useView();
  const lines = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const size = hero.n * hero.n * 6;
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(size), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(size), 3));
    return geometry;
  }, [hero]);
  const bright = useMemo(() => new THREE.Color(ALERT_COLOR), []);
  const dim = useMemo(() => new THREE.Color(ALERT_COLOR).multiplyScalar(0.55), []);

  useFrame(() => {
    const s = playback.get();
    const run = hero.runs[s.mode];
    const me = hero.ids.indexOf(s.povPlayer);
    const alerts = s.blindSide && s.camera === "broadcast" ? alertsAt(hero, run, s.frame) : [];
    const xyz = lines.attributes.position.array as Float32Array;
    const rgb = lines.attributes.color.array as Float32Array;
    alerts.forEach((a, k) => {
      const [ox, oy] = [sample.pos[2 * a.observer], sample.pos[2 * a.observer + 1]];
      const [tx, ty] = [sample.pos[2 * a.target], sample.pos[2 * a.target + 1]];
      xyz.set([ox, GRASS, -oy, tx, GRASS, -ty], k * 6);
      const c = a.observer === me ? bright : dim;
      rgb.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
    });
    lines.setDrawRange(0, alerts.length * 2);
    lines.attributes.position.needsUpdate = true;
    lines.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments geometry={lines} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  );
}

// ---------- pass options on the grass, around the decision ----------

const grass = { transparent: true, depthWrite: false } as const;
const g3 = ([x, y]: Vec2): [number, number, number] => [x, GRASS, -y];

const ring = Array.from({ length: 41 }, (_, k) => {
  const a = (k / 40) * 2 * Math.PI;
  return [1.2 * Math.cos(a), GRASS, 1.2 * Math.sin(a)] as [number, number, number];
});

/** The tactical board's pass options, drawn on the grass: same widths, colours and halo. */
function GrassOptions() {
  const { hero, playback } = useView();
  const mode = useStore(playback, (s) => s.mode);
  const run = hero.runs[mode];
  const options = useMemo(() => passOptions(hero, run), [hero, run]);
  const range = useMemo(() => valueRange(hero), [hero]);
  const group = useRef<THREE.Group>(null);
  const decision = run.decision?.frame;
  useFrame(() => {
    const s = playback.get();
    if (group.current) {
      group.current.visible =
        s.options && decision !== undefined && optionsVisible(s.frame, decision);
    }
  });
  return (
    <group ref={group} visible={false}>
      {options.map((o) => {
        const color = colorFor(o.value, range);
        const width = widthFor(o.prob);
        if (o.kind !== "pass") {
          return (
            <group key={o.action} position={[o.target[0], 0, -o.target[1]]}>
              <Line points={ring} color={color} lineWidth={width} {...grass} />
            </group>
          );
        }
        const line = [g3(o.from), g3(o.target)];
        const moved =
          o.targetTrue &&
          Math.hypot(o.targetTrue[0] - o.target[0], o.targetTrue[1] - o.target[1]) > 1.5;
        return (
          <group key={o.action}>
            {o.chosen && (
              <Line points={line} color="#ffffff" opacity={0.22} lineWidth={width + 4} {...grass} />
            )}
            {moved && o.targetTrue && (
              <Line
                points={[g3(o.from), g3(o.targetTrue)]}
                color={colorFor(o.valueTrue ?? o.value, range)}
                opacity={0.9}
                lineWidth={1.6}
                dashed
                dashSize={1.2}
                gapSize={0.9}
                {...grass}
              />
            )}
            <Line points={line} color={color} lineWidth={width} {...grass} />
          </group>
        );
      })}
    </group>
  );
}

// ---------- live tags: a pool of sprites at a fixed pixel size ----------

const TAG_W = 768;
const TAG_H = 96;

/** Label colour: the player's team for a name, gold for speed, sight for the measured events. */
function tagFill(tag: LiveTag, hero: { players: { team: number }[] }): string {
  switch (tag.kind) {
    case "name":
      return teamColor(hero.players[tag.player]?.team ?? 0);
    case "speed":
    case "sprint":
      return COLORS.gold;
    case "distance":
    case "pass":
    case "shot":
    case "scan":
      return COLORS.sight;
    case "blind":
      return ALERT_COLOR;
  }
}

/** A tag as a texture: a dark pill with the label in colour, the text, and where it was measured. */
const tagTextures = new Map<string, THREE.CanvasTexture>();
function tagTexture(tag: LiveTag, color: string): THREE.CanvasTexture {
  const source = tagSource(tag.kind);
  const key = `${color}|${source}|${tag.kind}|${tag.label}|${tag.text}`;
  const hit = tagTextures.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = TAG_W;
  cv.height = TAG_H;
  const c = cv.getContext("2d")!;
  const big = '700 50px "Saira Condensed", "Arial Narrow", sans-serif';
  const small = '600 34px "IBM Plex Mono", ui-monospace, monospace';
  c.textBaseline = "middle";
  c.font = big;
  const label = c.measureText(tag.label).width;
  const text = c.measureText(tag.text).width;
  c.font = small;
  const mark = c.measureText(source).width;
  const gap = 16;
  const pad = 22;
  const width = Math.min(TAG_W - 4, pad + label + gap + text + gap + mark + pad);
  const x0 = (TAG_W - width) / 2;
  c.fillStyle = "rgba(8, 14, 12, 0.86)";
  c.beginPath();
  c.roundRect(x0, 8, width, TAG_H - 16, 14);
  c.fill();
  c.fillStyle = color;
  c.fillRect(x0, 8, 7, TAG_H - 16);
  let x = x0 + pad;
  c.font = big;
  c.fillText(tag.label, x, TAG_H / 2 + 2);
  x += label + gap;
  c.fillStyle = "#ffffff";
  c.fillText(tag.text, x, TAG_H / 2 + 2);
  x += text + gap;
  c.font = small;
  c.fillStyle = COLORS.muted;
  c.fillText(source, x, TAG_H / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tagTextures.set(key, tex);
  return tex;
}

function TagSprites({ sample }: { sample: Sample }) {
  const view = useView();
  const { hero, playback } = view;
  const statsState = statsStore(view);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(({ size }) => {
    const s = playback.get();
    const st = statsState.get();
    const run = hero.runs[s.mode];
    const tags =
      s.camera === "broadcast"
        ? liveTags(
            hero,
            run,
            s.frame,
            hero.ids.indexOf(s.povPlayer),
            s.blindSide,
            st.status === "ready" ? st.stats : null,
          )
        : [];
    // World height of TAG_PX on screen for a sprite that ignores distance (sizeAttenuation off).
    const h = (2 * TAG_PX * Math.tan(((camera.fov / 2) * Math.PI) / 180)) / size.height;
    const stacked = new Map<number, number>();
    for (let k = 0; k < TAGS; k++) {
      const sprite = sprites.current[k];
      if (!sprite) continue;
      const tag = tags[k];
      sprite.visible = !!tag;
      if (!tag) continue;
      const level = stacked.get(tag.player) ?? 0;
      stacked.set(tag.player, level + 1);
      const material = sprite.material;
      const map = tagTexture(tag, tagFill(tag, hero));
      if (material.map !== map) {
        material.map = map;
        material.needsUpdate = true;
      }
      const j = tag.player;
      sprite.position.set(sample.pos[2 * j], TAG_LIFT, -sample.pos[2 * j + 1]);
      sprite.scale.set((h * TAG_W) / TAG_H, h, 1);
      sprite.center.set(0.5, -1.1 * level); // bottom-centre on the player; a second tag above
    }
  });
  return (
    <>
      {Array.from({ length: TAGS }, (_, k) => (
        <sprite
          key={k}
          ref={(s) => {
            sprites.current[k] = s;
          }}
          visible={false}
          renderOrder={20}
        >
          <spriteMaterial
            sizeAttenuation={false}
            depthTest={false}
            depthWrite={false}
            transparent
            toneMapped={false}
          />
        </sprite>
      ))}
    </>
  );
}
