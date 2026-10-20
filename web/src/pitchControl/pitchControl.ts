// Pitch control on the tactical board (SPEC 4.2, 7): the closed-form model of
// analytics/pitch_control.py as a fragment shader over the whole pitch, one evaluation per pixel.
// Each frame the shader gets both teams' positions and velocities as uniforms.
//
// Parity with the numpy kernel is tested in headless Chrome by pitchControl.gpu.test.ts (SPEC 4).

import * as THREE from "three";
import { clampFrame, type Hero, type Run } from "../data/hero";
import { COLORS, PITCH } from "../views/scene";

/** analytics/pitch_control.py SIGMA_S, analytics/tti.py REACTION_S and V_MAX. */
export const MODEL = { sigma: 0.45, reaction: 0.7, vMax: 5.0 } as const;
export const MAX_PER_TEAM = 11;
/** Opacity of the tint where one team surely controls; contested space fades to the pitch. */
export const OPACITY = 0.45;

/** Both teams for the shader: [x, y, vx, vy] per player, m and m/s. Home is team 0. */
export class ControlInputs {
  home = new Float32Array(4 * MAX_PER_TEAM);
  away = new Float32Array(4 * MAX_PER_TEAM);
  homeCount = 0;
  awayCount = 0;
}

/**
 * Velocity of player j at integer frame f along one axis, m/s. The export has positions only.
 * The sim steps with semi-implicit Euler (pos[f] = pos[f-1] + vel[f] * dt), so the backward
 * difference is the sim's own velocity up to the export's 1 mm rounding
 * (tests/test_pitch_control_parity.py). Frame 0 has no earlier frame: forward difference.
 */
function velocity(hero: Hero, run: Run, f: number, j: number, axis: number): number {
  const b = f > 0 ? f : Math.min(1, run.frames - 1);
  const a = b - 1;
  if (a < 0) return 0;
  const n = hero.n;
  return (run.pos[(b * n + j) * 2 + axis] - run.pos[(a * n + j) * 2 + axis]) / hero.dt;
}

/** Fill `out` with both teams at fractional frame f, interpolated like `sampleInto`. */
export function controlInputsAt(out: ControlInputs, hero: Hero, run: Run, f: number) {
  const n = hero.n;
  const c = clampFrame(run, f);
  const i0 = Math.floor(c);
  const i1 = Math.min(run.frames - 1, i0 + 1);
  const t = c - i0;
  out.homeCount = 0;
  out.awayCount = 0;
  for (let j = 0; j < n; j++) {
    const home = hero.players[j].team === 0;
    const slot = home ? out.homeCount++ : out.awayCount++;
    if (slot >= MAX_PER_TEAM) throw new Error(`more than ${MAX_PER_TEAM} players in a team`);
    const dst = home ? out.home : out.away;
    for (let axis = 0; axis < 2; axis++) {
      const p0 = run.pos[(i0 * n + j) * 2 + axis];
      const p1 = run.pos[(i1 * n + j) * 2 + axis];
      const v0 = velocity(hero, run, i0, j, axis);
      const v1 = velocity(hero, run, i1, j, axis);
      dst[4 * slot + axis] = p0 + (p1 - p0) * t;
      dst[4 * slot + 2 + axis] = v0 + (v1 - v0) * t;
    }
  }
  return out;
}

const vertexShader = /* glsl */ `
  varying vec2 vPitch;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPitch = vec2(world.x, -world.z); // three.js (x, height, -y) back to pitch metres
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// PC_RAW writes (P, T_home, T_away) for the parity test; otherwise the board's colour ramp.
const fragmentShader = /* glsl */ `
  uniform vec4 uHome[PC_MAX_PER_TEAM]; // x, y (m), vx, vy (m/s)
  uniform vec4 uAway[PC_MAX_PER_TEAM];
  uniform int uHomeCount;
  uniform int uAwayCount;
  uniform float uReaction; // s
  uniform float uVMax; // m/s
  uniform float uSigma; // s
  uniform vec3 uHomeColor;
  uniform vec3 uAwayColor;
  uniform vec3 uLineColor;
  uniform float uOpacity;
  varying vec2 vPitch;
  const float PI = 3.141592653589793;

  // analytics/tti.py time_to_intercept: the player keeps his velocity for the reaction time,
  // then runs straight to the point at v_max. This is the squared length of that run.
  float run2(vec4 player, vec2 point) {
    vec2 d = point - (player.xy + player.zw * uReaction);
    return dot(d, d);
  }

  void main() {
    float home2 = 1e12;
    float away2 = 1e12;
    for (int i = 0; i < PC_MAX_PER_TEAM; i++) {
      if (i < uHomeCount) home2 = min(home2, run2(uHome[i], vPitch));
      if (i < uAwayCount) away2 = min(away2, run2(uAway[i], vPitch));
    }
    // Every player has the same reaction time and v_max, so a team's smallest time to intercept
    // is the reaction time plus its shortest run at v_max: one square root per team, not per
    // player.
    float tHome = uReaction + sqrt(home2) / uVMax;
    float tAway = uReaction + sqrt(away2) / uVMax;
    // analytics/pitch_control.py control_from_times, with its tanh form of the logistic. The
    // clamp keeps tanh finite where a driver computes it from exp; the logistic of +-30 is
    // within 1e-13 of 1 and 0.
    float z = PI / (sqrt(3.0) * uSigma) * (tAway - tHome);
    float p = 0.5 * (1.0 + tanh(0.5 * clamp(z, -30.0, 30.0)));
  #ifdef PC_RAW
    gl_FragColor = vec4(p, tHome, tAway, 1.0);
  #else
    // Each team's colour where it gets there first, clear where it is contested, and a thin
    // light line (about 1.5 px) on the frontier, where control passes one half.
    float lean = abs(2.0 * p - 1.0);
    vec3 tint = p >= 0.5 ? uHomeColor : uAwayColor;
    float line = 1.0 - smoothstep(0.75, 1.75, abs(p - 0.5) / max(fwidth(p), 1e-6));
    gl_FragColor = vec4(mix(tint, uLineColor, line), max(uOpacity * smoothstep(0.0, 1.0, lean), 0.8 * line));
    #include <colorspace_fragment>
  #endif
  }
`;

/** The board's material; `raw` writes P(home) and both arrival times instead of colours. */
export function createPitchControlMaterial({ raw = false } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: raw ? { PC_MAX_PER_TEAM: MAX_PER_TEAM, PC_RAW: 1 } : { PC_MAX_PER_TEAM: MAX_PER_TEAM },
    uniforms: {
      uHome: { value: new Float32Array(4 * MAX_PER_TEAM) },
      uAway: { value: new Float32Array(4 * MAX_PER_TEAM) },
      uHomeCount: { value: 0 },
      uAwayCount: { value: 0 },
      uReaction: { value: MODEL.reaction },
      uVMax: { value: MODEL.vMax },
      uSigma: { value: MODEL.sigma },
      uHomeColor: { value: new THREE.Color(COLORS.home) },
      uAwayColor: { value: new THREE.Color(COLORS.away) },
      uLineColor: { value: new THREE.Color(COLORS.fg) },
      uOpacity: { value: OPACITY },
    },
    ...(raw ? { blending: THREE.NoBlending } : { transparent: true }),
    depthTest: false,
    depthWrite: false,
  });
}

/** A plane over the whole pitch, lying in the board's XZ plane. */
export function createPitchControlMesh(material: THREE.ShaderMaterial): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.length, PITCH.width), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export function setControlInputs(material: THREE.ShaderMaterial, inputs: ControlInputs) {
  const u = material.uniforms;
  u.uHome.value = inputs.home;
  u.uAway.value = inputs.away;
  u.uHomeCount.value = inputs.homeCount;
  u.uAwayCount.value = inputs.awayCount;
}
