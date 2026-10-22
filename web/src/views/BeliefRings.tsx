// Belief ghosts in the 3D view (SPEC 7: "where he thought they were"), drawn as the tactical board
// draws them: a dashed ring on the grass where the hero believes a player is (gold for the runner)
// and a thin line from it to where the player really is, so a ghost reads as a player he has
// misplaced, not as a white block. Which ghosts, and how strongly, is views/ghosts.ts: by default
// the runner's alone, from his key scan to his decision, coming and going with how wrong his
// picture is; on the broadcast camera only when the viewer asks for everyone's (View options).
// For its first two seconds the runner's ghost says what it is. Used by the app's 3D view and by
// the trailer's capture scene (cine/), so both draw the same ghost.

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Line2 } from "three/examples/jsm/lines/Line2.js";
import type { Sample } from "../data/hero";
import { useView } from "../session";
import { ghostAlpha, ghostLabelAlpha } from "./ghosts";
import { COLORS, getLabelTexture, LABEL } from "./scene";

const RING_R = 0.55; // m: about a player's footprint
const LIFT = 0.04; // m above the grass: clear of it at every distance the stadium shows
const RING_OPACITY = { runner: 0.95, other: 0.7 };
const LINE_OPACITY = 0.5;
const LABEL_UP = 1.1; // m above his ring
const LABEL_SIZE = 0.03; // the label's height as an angle (rad): ~20 px in first person at 900 px

const ring = Array.from({ length: 49 }, (_, k) => {
  const a = (k / 48) * 2 * Math.PI;
  return [RING_R * Math.cos(a), 0, RING_R * Math.sin(a)] as [number, number, number];
});

/** `sampleOf`: the view's own sample, filled for this frame before the layers run. */
export function BeliefRings({ sampleOf }: { sampleOf: () => Sample | null }) {
  const { hero, playback } = useView();
  const groups = useRef<(THREE.Group | null)[]>([]);
  const lines = useRef<(Line2 | null)[]>([]);
  const label = useRef<THREE.Sprite>(null);
  const connectors = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hero.n * 6), 3));
    // RGBA per end: each player's line fades with his ghost
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(hero.n * 8), 4));
    return geometry;
  }, [hero]);
  const fg = useMemo(() => new THREE.Color(COLORS.fg), []);
  const gold = useMemo(() => new THREE.Color(COLORS.gold), []);
  const labelMap = useMemo(() => {
    const number = hero.runner >= 0 ? hero.players[hero.runner].number : null;
    return number === null
      ? null
      : getLabelTexture(`where he thinks #${number} is`, { ...LABEL.tag, color: COLORS.gold });
  }, [hero]);

  useFrame(() => {
    const sample = sampleOf();
    if (!sample) return;
    const s = playback.get();
    const run = hero.runs[s.mode];
    const pov = hero.ids.indexOf(s.povPlayer);
    const show =
      s.beliefGhosts &&
      hero.hero >= 0 &&
      pov === hero.hero &&
      (s.camera !== "broadcast" || s.ghostsAll);
    const xyz = connectors.attributes.position.array as Float32Array;
    const rgba = connectors.attributes.color.array as Float32Array;
    let runnerAlpha = 0;
    for (let j = 0; j < hero.n; j++) {
      const alpha = show ? ghostAlpha(hero, run, s.frame, j, s.ghostsAll) : 0;
      if (j === hero.runner) runnerAlpha = alpha;
      const gx = sample.ghost[2 * j];
      const gy = sample.ghost[2 * j + 1];
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      const g = groups.current[j];
      if (g) {
        g.visible = alpha > 0.01;
        g.position.set(gx, LIFT, -gy);
      }
      const line = lines.current[j];
      if (line) {
        line.material.opacity =
          alpha * (j === hero.runner ? RING_OPACITY.runner : RING_OPACITY.other);
      }
      // From the ring's edge to his feet, so the line never crosses the ring.
      const d = Math.hypot(x - gx, y - gy) || 1;
      const ex = gx + ((x - gx) / d) * RING_R;
      const ey = gy + ((y - gy) / d) * RING_R;
      xyz.set(alpha > 0.01 ? [ex, LIFT, -ey, x, LIFT, -y] : [0, 0, 0, 0, 0, 0], j * 6);
      const c = j === hero.runner ? gold : fg;
      const a = alpha * LINE_OPACITY;
      rgba.set([c.r, c.g, c.b, a, c.r, c.g, c.b, a], j * 8);
    }
    connectors.attributes.position.needsUpdate = true;
    connectors.attributes.color.needsUpdate = true;
    connectors.computeBoundingSphere();
    const tag = label.current;
    if (tag && hero.runner >= 0) {
      const a = runnerAlpha * ghostLabelAlpha(hero, run, s.frame);
      tag.visible = a > 0.01;
      tag.material.opacity = a;
      tag.position.set(sample.ghost[2 * hero.runner], LABEL_UP, -sample.ghost[2 * hero.runner + 1]);
    }
  });

  return (
    <group>
      <lineSegments geometry={connectors}>
        <lineBasicMaterial vertexColors transparent depthWrite={false} />
      </lineSegments>
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            groups.current[j] = g;
          }}
          visible={false}
        >
          <Line
            ref={(l) => {
              lines.current[j] = l as Line2 | null;
            }}
            points={ring}
            color={j === hero.runner ? COLORS.gold : COLORS.fg}
            transparent
            opacity={0}
            lineWidth={2}
            dashed
            dashSize={0.32}
            gapSize={0.22}
            depthWrite={false}
            toneMapped={false}
          />
        </group>
      ))}
      {labelMap && (
        <sprite
          ref={label}
          visible={false}
          scale={[(LABEL_SIZE * 512) / 96, LABEL_SIZE, 1]}
          renderOrder={10}
        >
          <spriteMaterial
            map={labelMap}
            transparent
            opacity={0}
            sizeAttenuation={false}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      )}
    </group>
  );
}
