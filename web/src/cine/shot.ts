// A shot the capture renderer films (SPEC 10): the zod spec, and the pure maths that turns a
// time into a frame and a camera. No React and no scene graph, so the same functions run in
// unit tests with a stand-in for "where is this anchor". Positions stay in pitch metres
// (x, y, height); pitchToWorld is the one conversion onto three.js.

import { z } from "zod";

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const EaseSchema = z.enum(["linear", "in", "out", "inOut"]);

/** Pitch x (m), pitch y (m), height (m). */
export type Vec3 = [number, number, number];
export type Ease = z.infer<typeof EaseSchema>;

const Orbit = z.strictObject({
  r: z.number(),
  az: z.number(),
  h: z.number(),
});

const WorldAnchor = z.strictObject({ at: z.literal("world"), p: Vec3Schema });
const PlayerAnchor = z.strictObject({
  at: z.literal("player"),
  id: z.string().min(1),
  offset: Vec3Schema.optional(),
  orbit: Orbit.optional(),
  axes: z.enum(["world", "body", "head"]).default("world"),
});
const BallAnchor = z.strictObject({
  at: z.literal("ball"),
  offset: Vec3Schema.optional(),
});
const EyesAnchor = z.strictObject({ at: z.literal("eyes"), id: z.string().min(1) });

export const Anchor = z.discriminatedUnion("at", [
  WorldAnchor,
  PlayerAnchor,
  BallAnchor,
  EyesAnchor,
]);
export type Anchor = z.infer<typeof Anchor>;
/** An anchor as a shot spec writes it (defaults not applied yet). */
export type AnchorInput = z.input<typeof Anchor>;

const TimeKey = z.strictObject({
  t: z.number(),
  frame: z.number(),
  ease: EaseSchema.default("linear"),
});

const CameraKey = z.strictObject({
  t: z.number(),
  eye: Anchor,
  look: Anchor,
  fov: z.number().positive().optional(),
  roll: z.number().default(0),
  ease: EaseSchema.default("linear"),
});

const Bloom = z.strictObject({
  strength: z.number(),
  radius: z.number(),
  threshold: z.number(),
});

const Dof = z.strictObject({
  focus: z.union([Anchor, z.number()]),
  aperture: z.number(),
  maxBlur: z.number(),
});

const Cone = z.strictObject({
  id: z.string().min(1),
  opacity: z.number(),
  flash: z.number(),
  radius: z.number().positive().default(35),
});

const Shake = z.strictObject({
  amp: z.number(),
  freq: z.number(),
});

function keyOrder(
  keys: { t: number }[],
  where: string,
  duration: number,
  ctx: {
    addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void;
  },
) {
  for (let i = 0; i < keys.length; i++) {
    const t = keys[i].t;
    if (t < 0 || t > duration) {
      ctx.addIssue({
        code: "custom",
        path: [where, i, "t"],
        message: `${t} is outside [0, ${duration}]`,
      });
    }
    if (i > 0 && !(t > keys[i - 1].t)) {
      ctx.addIssue({
        code: "custom",
        path: [where, i, "t"],
        message: `${t} is not after ${keys[i - 1].t}`,
      });
    }
  }
}

export const CineShot = z
  .strictObject({
    id: z.string().min(1),
    run: z.enum(["factual", "counterfactual"]).default("factual"),
    duration: z.number().positive(),
    time: z.array(TimeKey).min(1),
    camera: z.array(CameraKey).min(1),
    smooth: z.number().min(0).default(0.2),
    shake: Shake.nullable().default(null),
    pov: z.string().nullable().default(null),
    dof: Dof.nullable().default(null),
    bloom: Bloom.nullable().default(() => ({ strength: 0.6, radius: 0.5, threshold: 0.85 })),
    motionBlur: z.boolean().default(true),
    periphery: z.number().min(0).max(1).default(0),
    cone: Cone.nullable().default(null),
    rings: z.boolean().default(false),
    labels: z.boolean().default(false),
    ghosts: z.boolean().default(false),
    fog: z.tuple([z.number(), z.number()]).default((): [number, number] => [60, 220]),
    exposure: z.number().default(1),
    letterbox: z.number().positive().nullable().default(null),
  })
  .superRefine((shot, ctx) => {
    keyOrder(shot.time, "time", shot.duration, ctx);
    keyOrder(shot.camera, "camera", shot.duration, ctx);
  });

export type CineShot = z.infer<typeof CineShot>;

/** What load() checks against the opened match. A stitched match has no vision model. */
export interface ShotData {
  ids: readonly string[];
  heroId: string | null;
  hasVision: boolean;
}

export interface CameraPose {
  eye: Vec3;
  look: Vec3;
  fov: number;
  roll: number;
}

/** Horizontal field of the first-person view, degrees. PovView.POV_HFOV is the same angle in radians. */
export const POV_HFOV_DEG = 95;
const DEFAULT_FOV = 40;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function anchorError(anchor: Anchor, where: string, ids: ReadonlySet<string>): string | null {
  if (anchor.at !== "player" && anchor.at !== "eyes") return null;
  if (ids.has(anchor.id)) return null;
  const kind = anchor.at === "eyes" ? "eyes player" : "player";
  return `${where}: unknown ${kind} "${anchor.id}"`;
}

/** Schema failures plus players, eyes, ghosts and a cone the opened data cannot draw. */
export function loadShot(
  input: unknown,
  data: ShotData,
): { ok: true; shot: CineShot } | { ok: false; errors: string[] } {
  const parsed = CineShot.safeParse(input);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };
  const shot = parsed.data;
  const ids = new Set(data.ids);
  const errors: string[] = [];
  if (shot.pov !== null && !ids.has(shot.pov)) {
    errors.push(`pov: unknown player "${shot.pov}"`);
  }
  if (shot.ghosts && data.heroId === null) {
    errors.push("ghosts: need a hero player; this data has none");
  }
  if (shot.cone) {
    if (!data.hasVision) errors.push("cone: needs a vision model; this data has none");
    if (!ids.has(shot.cone.id)) errors.push(`cone.id: unknown player "${shot.cone.id}"`);
  }
  shot.camera.forEach((key, i) => {
    for (const [role, anchor] of [
      ["eye", key.eye],
      ["look", key.look],
    ] as const) {
      const error = anchorError(anchor, `camera.${i}.${role}`, ids);
      if (error) errors.push(error);
    }
  });
  if (shot.dof && typeof shot.dof.focus !== "number") {
    const error = anchorError(shot.dof.focus, "dof.focus", ids);
    if (error) errors.push(error);
  }
  return errors.length ? { ok: false, errors } : { ok: true, shot };
}

/** Cubic easing on [0, 1]. `inOut` is the smoothstep polynomial. */
export function ease(kind: Ease, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  if (kind === "linear") return x;
  if (kind === "in") return x * x * x;
  if (kind === "out") return 1 - (1 - x) ** 3;
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

interface Keyed {
  t: number;
}

function segment<T extends Keyed>(keys: T[], t: number): { from: T; to: T; u: number } {
  if (keys.length === 1 || t <= keys[0].t) return { from: keys[0], to: keys[0], u: 0 };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { from: last, to: last, u: 0 };
  let i = 1;
  while (i < keys.length - 1 && keys[i].t < t) i += 1;
  const from = keys[i - 1];
  const to = keys[i];
  const span = to.t - from.t;
  return { from, to, u: span === 0 ? 1 : (t - from.t) / span };
}

/** Match frame at shot time `t`. A segment may run backwards: a rewind is a segment. */
export function frameAt(shot: CineShot, t: number): number {
  const { from, to, u } = segment(shot.time, t);
  if (from === to) return from.frame;
  return from.frame + (to.frame - from.frame) * ease(to.ease, u);
}

function lerp(a: number, b: number, w: number): number {
  return a + (b - a) * w;
}

function lerpVec(a: Vec3, b: Vec3, w: number): Vec3 {
  return [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];
}

function offsetOf(anchor: Anchor): Vec3 {
  if (anchor.at === "player" || anchor.at === "ball") return anchor.offset ?? [0, 0, 0];
  return [0, 0, 0];
}

/** Same subject, so the anchor's own numbers can be blended and resolved once. */
function sameSubject(a: Anchor, b: Anchor): boolean {
  if (a.at !== b.at) return false;
  if (a.at === "world" || a.at === "ball") return true;
  if (a.at === "eyes") return b.at === "eyes" && a.id === b.id;
  if (b.at !== "player") return false;
  if (a.id !== b.id || a.axes !== b.axes) return false;
  return (a.orbit == null) === (b.orbit == null);
}

function blendAnchor(a: Anchor, b: Anchor, w: number): Anchor {
  if (a.at === "world" && b.at === "world") return { at: "world", p: lerpVec(a.p, b.p, w) };
  if (a.at === "ball" && b.at === "ball") {
    const offset = lerpVec(offsetOf(a), offsetOf(b), w);
    return offset[0] === 0 && offset[1] === 0 && offset[2] === 0
      ? { at: "ball" }
      : { at: "ball", offset };
  }
  if (a.at === "player" && b.at === "player") {
    const ao = a.offset;
    const bo = b.offset;
    const orbit =
      a.orbit && b.orbit
        ? {
            r: lerp(a.orbit.r, b.orbit.r, w),
            az: lerp(a.orbit.az, b.orbit.az, w),
            h: lerp(a.orbit.h, b.orbit.h, w),
          }
        : undefined;
    return {
      at: "player",
      id: a.id,
      axes: a.axes,
      ...(ao || bo ? { offset: lerpVec(ao ?? [0, 0, 0], bo ?? [0, 0, 0], w) } : {}),
      ...(orbit ? { orbit } : {}),
    };
  }
  return a;
}

/** Vertical degrees for a fixed horizontal field, the way PovView holds 95° across aspects. */
export function verticalFovDeg(hfovDeg: number, aspect: number): number {
  const h = (hfovDeg * Math.PI) / 180;
  const safe = aspect > 1e-6 ? aspect : 1;
  return (2 * Math.atan(Math.tan(h / 2) / safe) * 180) / Math.PI;
}

/** Horizontal degrees from a vertical field, for the motion-blur pixel scale. */
export function horizontalFovDeg(vfovDeg: number, aspect: number): number {
  const v = (vfovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(v / 2) * aspect) * 180) / Math.PI;
}

function keyFov(key: CineShot["camera"][number], aspect: number): number {
  if (key.fov !== undefined) return key.fov;
  if (key.eye.at === "eyes") return verticalFovDeg(POV_HFOV_DEG, aspect);
  return DEFAULT_FOV;
}

export type ResolveAnchor = (anchor: Anchor, role: "eye" | "look") => Vec3;

/**
 * Eye, look, fov and roll at shot time `t`. Anchors that stay on the same subject are blended
 * in their own numbers (orbit azimuth linearly, no wrap) and resolved once; a cut between
 * subjects lerps the two resolved points. `aspect` is the canvas width/height, for an eyes key
 * whose fov was left out.
 */
export function cameraAt(
  shot: CineShot,
  t: number,
  resolve: ResolveAnchor,
  aspect = 16 / 9,
): CameraPose {
  const { from, to, u } = segment(shot.camera, t);
  const w = from === to ? 0 : ease(to.ease, u);
  const point = (role: "eye" | "look"): Vec3 => {
    const a = role === "eye" ? from.eye : from.look;
    const b = role === "eye" ? to.eye : to.look;
    if (sameSubject(a, b)) return resolve(blendAnchor(a, b, w), role);
    return lerpVec(resolve(a, role), resolve(b, role), w);
  };
  return {
    eye: point("eye"),
    look: point("look"),
    fov: lerp(keyFov(from, aspect), keyFov(to, aspect), w),
    roll: lerp(from.roll, to.roll, w),
  };
}

// Three sines per axis, at freq, freq√2 and freq√3, so the path does not repeat on a beat.
const SHAKE_PHASES: readonly (readonly number[])[] = [
  [0.0, 1.7, 3.1],
  [2.3, 0.4, 5.2],
  [4.1, 2.8, 0.9],
];

/** Handheld offset in pitch metres. Null shake is a locked-off camera. */
export function shakeAt(shake: { amp: number; freq: number } | null, t: number): Vec3 {
  if (!shake || shake.amp === 0) return [0, 0, 0];
  const freqs = [shake.freq, shake.freq * Math.SQRT2, shake.freq * Math.sqrt(3)];
  const out: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      sum += Math.sin(2 * Math.PI * freqs[k] * t + SHAKE_PHASES[axis][k]);
    }
    out[axis] = (shake.amp / 3) * sum;
  }
  return out;
}

/** Pitch (x, y, height) to three.js (x, height, -y). The same map as views/scene.ts. */
export function pitchToWorld(p: Vec3): Vec3 {
  return [p[0], p[2], -p[1]];
}
