// The virtual stadium: the app's own bowl (the baked stadium when it loads, the procedural one
// until then, Stadium.tsx) with the five screens in it as canvas-textured planes, under an orbit
// camera with three presets. The canvas draws on demand: when the camera moves, a screen's
// picture changes, or a fade runs. Each screen's texture is its one canvas (show.ts), uploaded
// again only when that canvas is redrawn.

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Grass, NIGHT, Stadium } from "../views/Stadium";
import { heightOf, SCREEN_IDS, type ScreenId } from "./formats";
import { PRESETS, toThree, type PresetId } from "./presets";
import type { Show } from "./show";

const FRAME = "#14191c";

export function StadiumPreview({ show, preset }: { show: Show; preset: PresetId }) {
  const p = PRESETS.bowl;
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ fov: 50, near: 0.5, far: 700, position: p.position }}
      fallback={
        <p className="no-webgl">This view needs WebGL: the Screen wall below shows every screen.</p>
      }
    >
      <color attach="background" args={[NIGHT.horizon]} />
      <fog attach="fog" args={[NIGHT.horizon, 160, 420]} />
      <Stadium />
      <Grass />
      {SCREEN_IDS.map((id) => (
        <ScreenPlane key={id} show={show} id={id} />
      ))}
      <OrbitControls
        makeDefault
        enableDamping={false}
        minDistance={4}
        maxDistance={240}
        maxPolarAngle={Math.PI / 2 - 0.04}
      />
      <PresetCamera preset={preset} />
    </Canvas>
  );
}

/** Puts the camera on the preset: a cut. The orbit controls take over from there. */
function PresetCamera({ preset }: { preset: PresetId }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const p = PRESETS[preset];
    camera.position.set(...p.position);
    if (controls) {
      controls.target.set(...p.target);
      controls.update();
    } else {
      camera.lookAt(...p.target);
    }
    invalidate();
  }, [camera, controls, invalidate, preset]);
  return null;
}

/** One screen: its canvas as a texture on a plane, in a dark frame, dimmed during a fade. */
function ScreenPlane({ show, id }: { show: Show; id: ScreenId }) {
  const surface = show.surfaces[id];
  const { placement } = surface.format;
  const width = placement.width;
  const height = heightOf(surface.format, width);
  const invalidate = useThree((s) => s.invalidate);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(surface.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [surface]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Re-upload the texture when its canvas is redrawn, and draw a frame for every change.
  useEffect(() => {
    let version = show.state.get().versions[id];
    let fade = show.state.get().fades[id];
    texture.needsUpdate = true;
    return show.state.subscribe(() => {
      const s = show.state.get();
      if (s.versions[id] !== version) {
        version = s.versions[id];
        texture.needsUpdate = true;
        invalidate();
      }
      if (s.fades[id] !== fade) {
        fade = s.fades[id];
        invalidate();
      }
    });
  }, [show, id, texture, invalidate]);
  useFrame(() => {
    const m = material.current;
    if (!m) return;
    m.color.setScalar(show.level(id));
    if (show.fading()) invalidate(); // until the fade is over
  });
  const position = toThree(placement.x, placement.y, placement.z);
  // A board on a roof stands on two legs down to it.
  const legs = placement.mount === undefined ? 0 : placement.z - height / 2 - placement.mount;
  return (
    <group position={position} rotation-y={placement.yaw}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={material} map={texture} toneMapped={false} fog={false} />
      </mesh>
      <mesh position-z={-0.12}>
        <boxGeometry args={[width + 0.3, height + 0.3, 0.2]} />
        <meshStandardMaterial color={FRAME} roughness={1} />
      </mesh>
      {legs > 0 &&
        [-0.3, 0.3].map((u) => (
          <mesh key={u} position={[u * width, -height / 2 - legs / 2, -0.4]}>
            <boxGeometry args={[0.5, legs, 0.5]} />
            <meshStandardMaterial color={FRAME} roughness={1} />
          </mesh>
        ))}
    </group>
  );
}
