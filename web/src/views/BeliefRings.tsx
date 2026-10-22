// Belief ghosts in the 3D view (SPEC 7: "where he thought they were"), drawn as the tactical board
// draws them: a dashed ring on the grass where the hero believes a player is (gold for the runner)
// and a thin line from it to where the player really is. They used to be translucent bodies, which
// next to the animated players read as rendering ghosts. As on the board, only players his picture
// has at least 1.2 m wrong, and only through his own eyes or the broadcast camera while he is the
// player whose eyes are chosen.

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Sample } from "../data/hero";
import { useView } from "../session";
import { COLORS } from "./scene";

const RING_R = 0.55; // m: about a player's footprint
const LIFT = 0.04; // m above the grass: clear of it at every distance the stadium shows
const WRONG_BY = 1.2; // m, as on the board

const ring = Array.from({ length: 49 }, (_, k) => {
  const a = (k / 48) * 2 * Math.PI;
  return [RING_R * Math.cos(a), 0, RING_R * Math.sin(a)] as [number, number, number];
});

/** `sample` is the 3D view's own, filled for this frame before the layers run. */
export function BeliefRings({ sample }: { sample: Sample }) {
  const { hero, playback } = useView();
  const all = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Group | null)[]>([]);
  const connectors = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hero.n * 6), 3));
    return geometry;
  }, [hero]);

  useFrame(() => {
    const s = playback.get();
    const pov = hero.ids.indexOf(s.povPlayer);
    const show = s.beliefGhosts && pov === hero.hero && hero.hero >= 0;
    if (all.current) all.current.visible = show;
    if (!show) return;
    const xyz = connectors.attributes.position.array as Float32Array;
    for (let j = 0; j < hero.n; j++) {
      const gx = sample.ghost[2 * j];
      const gy = sample.ghost[2 * j + 1];
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      const wrong = j !== pov && Math.hypot(gx - x, gy - y) >= WRONG_BY;
      const g = rings.current[j];
      if (g) {
        g.visible = wrong;
        g.position.set(gx, LIFT, -gy);
      }
      // From the ring's edge to his feet, so the line never crosses the ring.
      const d = Math.hypot(x - gx, y - gy) || 1;
      const ex = gx + ((x - gx) / d) * RING_R;
      const ey = gy + ((y - gy) / d) * RING_R;
      xyz.set(wrong ? [ex, LIFT, -ey, x, LIFT, -y] : [0, 0, 0, 0, 0, 0], j * 6);
    }
    connectors.attributes.position.needsUpdate = true;
    connectors.computeBoundingSphere();
  });

  return (
    <group ref={all} visible={false}>
      <lineSegments geometry={connectors}>
        <lineBasicMaterial color={COLORS.fg} transparent opacity={0.45} depthWrite={false} />
      </lineSegments>
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            rings.current[j] = g;
          }}
          visible={false}
        >
          <Line
            points={ring}
            color={j === hero.runner ? COLORS.gold : COLORS.fg}
            opacity={j === hero.runner ? 0.95 : 0.7}
            transparent
            lineWidth={2}
            dashed
            dashSize={0.32}
            gapSize={0.22}
            depthWrite={false}
            toneMapped={false}
          />
        </group>
      ))}
    </group>
  );
}
