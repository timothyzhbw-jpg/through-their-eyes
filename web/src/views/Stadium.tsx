// The stadium around the pitch in the 3D view (first person and broadcast), all generated here:
// a two-tier bowl under a roof, an instanced crowd (one draw call), four floodlight masts with a
// glow, our own boards ("Through Their Eyes", "Synthetic match": no real brands), a night sky
// gradient, and faint floodlight shadows under the players. It is background: dark, low
// contrast and hazed by the fog, so the players and the look over the shoulder stay the subject.
// Glow and shadows are faked (additive sprites, soft decals) instead of a bloom pass and shadow
// maps, to keep 60 fps on integrated GPUs.

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Sample, sampleInto } from "../data/hero";
import { useView } from "../session";
import { BROADCAST_CAMERA } from "./broadcast";
import { BOARDS, BOWL, FLOODLIGHTS, hash01, loopAt, PROFILE, ROOF, seats } from "./stadiumGeometry";
import { COLORS } from "./scene";
import { useStore } from "../store/store";
import { featuresOf, quality } from "../quality/quality";
import { LOOK } from "../quality/look";

/** Colours of the night: the fog and the sky's horizon match, so the stands fade into it. */
export const NIGHT = { zenith: "#04070c", horizon: "#16212a", lamp: "#fff2d8" };

/**
 * Seconds the crowd animation reads. The live view uses the wall clock; capture replaces
 * `now` while it is mounted, so a filmed frame does not depend on when it was drawn.
 */
export const sceneClock: { now: () => number } = {
  now: () => performance.now() / 1000,
};

export function Stadium() {
  return (
    <>
      <Sky />
      <StadiumLights />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.03}>
        <planeGeometry args={[2 * BOWL.halfX + 70, 2 * BOWL.halfY + 70]} />
        <meshStandardMaterial color="#121a17" roughness={1} />
      </mesh>
      <Bowl />
      <Crowd />
      <Boards />
      <Floodlights />
      <Gantry />
    </>
  );
}

// ---------- sky: a gradient dome that moves with the camera ----------

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uZenith, uHorizon;
  varying vec3 vDir;
  void main() {
    float up = smoothstep(-0.02, 0.45, vDir.y);
    gl_FragColor = vec4(mix(uHorizon, uZenith, up), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function Sky() {
  const mesh = useRef<THREE.Mesh>(null);
  const look = useStore(quality, (s) => featuresOf(s.tier, false).look);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: {
          uZenith: { value: new THREE.Color(look ? LOOK.sky.zenith : NIGHT.zenith) },
          uHorizon: { value: new THREE.Color(look ? LOOK.sky.horizon : NIGHT.horizon) },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        // With the look the sky goes through the curve like everything else (classic: as authored).
        toneMapped: look,
      }),
    [look],
  );
  useFrame(({ camera }) => mesh.current?.position.copy(camera.position));
  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[250, 32, 16]} />
    </mesh>
  );
}

/** Soft cross-lighting from two opposite masts plus a cool sky fill. */
function StadiumLights() {
  const [a, , c] = FLOODLIGHTS;
  return (
    <>
      <hemisphereLight args={["#cfdcea", "#1a2c22", 1.5]} />
      <directionalLight position={[a.x, a.height, -a.y]} intensity={1.6} color={NIGHT.lamp} />
      <directionalLight position={[c.x, c.height, -c.y]} intensity={1.2} color={NIGHT.lamp} />
    </>
  );
}

// ---------- the bowl: the profile swept around the pitch ----------

const CORNER_STEPS = 10;

/** Loop parameters: the straights need their ends only, the corners a few steps. */
function loopParams(): { side: number; t: number }[] {
  const out: { side: number; t: number }[] = [];
  for (let side = 0; side < 8; side++) {
    const steps = side % 2 ? CORNER_STEPS : 1;
    for (let k = 0; k < steps; k++) out.push({ side, t: k / steps });
  }
  return out;
}

/** Sweep a cross-section along the loop into one triangle mesh. */
function sweep(profile: readonly (readonly [number, number])[]): THREE.BufferGeometry {
  const params = loopParams();
  const rings = profile.map(([d, h]) =>
    params.map(({ side, t }) => {
      const [x, y] = loopAt(d, side, t);
      return [x, h, -y] as const;
    }),
  );
  const xyz: number[] = [];
  const n = params.length;
  for (let j = 0; j + 1 < rings.length; j++) {
    for (let i = 0; i < n; i++) {
      const p = rings[j][i];
      const q = rings[j][(i + 1) % n];
      const r = rings[j + 1][(i + 1) % n];
      const s = rings[j + 1][i];
      xyz.push(...p, ...q, ...r, ...p, ...r, ...s);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(xyz, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function Bowl() {
  const stands = useMemo(() => sweep(PROFILE), []);
  const roof = useMemo(() => sweep([ROOF.back, ROOF.front]), []);
  return (
    <>
      <mesh geometry={stands}>
        <meshStandardMaterial color="#1b2226" roughness={1} flatShading side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={roof}>
        <meshStandardMaterial color="#0e1316" roughness={1} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

// ---------- the crowd: one instanced quad per seat ----------

/** Head and shoulders, white on transparent; tinted per instance. */
function silhouette(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 32;
  cv.height = 64;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.arc(16, 13, 8, 0, 2 * Math.PI);
  c.fill();
  c.beginPath();
  c.roundRect(3, 24, 26, 40, [11, 11, 0, 0]);
  c.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Muted shirts, mostly dark, some in the clubs' colours (greyed): the home end on the left, an
 * away section in one half of the right end. Dim on purpose: the crowd is background. */
const DARK_SHIRTS = ["#2b3036", "#383d44", "#3b342e", "#2c3832", "#46484c", "#25292f"];
const CROWD_GREY = new THREE.Color("#30353a");
function shirtColor(k: number, x: number, y: number, out: THREE.Color, look = false): THREE.Color {
  const r = hash01(k);
  if (look) {
    // The shared look: the same shirts, mostly greyed, so the stands read neutral-cool.
    shirtColor(k, x, y, out, false);
    return out.lerp(CROWD_GREY, LOOK.crowdGrey);
  }
  const homeEnd = x < -BOWL.halfX + 4 && r < 0.5;
  const awaySection = x > BOWL.halfX - 4 && y > 0 && r < 0.5;
  if (homeEnd || (!awaySection && r < 0.07)) out.set(COLORS.home).lerp(CROWD_GREY, 0.45);
  else if (awaySection || r < 0.12) out.set(COLORS.away).lerp(CROWD_GREY, 0.45);
  else if (r < 0.2) out.set("#9aa0a6");
  else out.set(DARK_SHIRTS[Math.floor(hash01(k + 7) * DARK_SHIRTS.length)]);
  return out.multiplyScalar(0.4 + 0.2 * hash01(k + 3));
}

const OCCUPANCY = 0.82;

function Crowd() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const placed = useMemo(() => seats().filter((_, k) => hash01(k + 11) < OCCUPANCY), []);
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.5, 0.8).translate(0, 0.4, 0), []);
  const time = useMemo(() => ({ value: 0 }), []);
  // The shared look tints the crowd neutral-cool (quality/look.ts).
  const look = useStore(quality, (s) => featuresOf(s.tier, false).look);
  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({
      map: silhouette(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    // A third of the crowd bobs on its own beat: enough to read as people from afar.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float seed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
          transformed.y += step(0.66, seed) * 0.09 * max(0.0, sin(uTime * (4.0 + 3.0 * seed) + 6.2832 * seed));`,
        );
    };
    m.customProgramCacheKey = () => "crowd";
    return m;
  }, [time]);
  useEffect(() => {
    material.color.set(look ? LOOK.crowdTint : "#ffffff");
  }, [look, material]);

  useFrame(() => {
    time.value = sceneClock.now();
  });
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const at = new THREE.Object3D();
    const color = new THREE.Color();
    placed.forEach((seat, k) => {
      at.position.set(seat.x, seat.z - 0.12, -seat.y);
      // Face the pitch: the quad's normal (+z) turned to the seat's inward normal.
      at.rotation.set(0, Math.atan2(Math.cos(seat.facing), -Math.sin(seat.facing)), 0);
      at.scale.setScalar(0.9 + 0.2 * hash01(k + 5));
      at.updateMatrix();
      m.setMatrixAt(k, at.matrix);
      m.setColorAt(k, shirtColor(k, seat.x, seat.y, color, look));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [placed, look]);
  return (
    <instancedMesh ref={mesh} args={[geometry, material, placed.length]} frustumCulled={false} />
  );
}

// ---------- boards: our own words only ----------

function boardTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 2048;
  cv.height = 64;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#0a1416";
  c.fillRect(0, 0, cv.width, cv.height);
  c.font = '700 40px "Saira Condensed", "Arial Narrow", sans-serif';
  c.textBaseline = "middle";
  const words = ["THROUGH THEIR EYES", "SYNTHETIC MATCH", "ALL PLAYERS FICTIONAL"];
  let x = 40;
  let k = 0;
  while (x < cv.width) {
    c.fillStyle = k % 3 === 1 ? "#c99a4a" : "#7fa89a";
    c.fillText(words[k % words.length], x, 34);
    x += c.measureText(words[k % words.length]).width + 70;
    k++;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function Boards() {
  const { touchline, goalLine, height } = BOARDS;
  const boards = useMemo(() => {
    const base = boardTexture();
    const one = (length: number) => {
      const map = base.clone();
      map.repeat.set(length / 40, 1);
      map.needsUpdate = true;
      return map;
    };
    // [x, z (three), yaw facing the pitch, length]
    const t = 2 * touchline.halfLength;
    const g = 2 * goalLine.halfLength;
    return [
      { at: [0, -touchline.y], yaw: 0, length: t, map: one(t) },
      { at: [0, touchline.y], yaw: Math.PI, length: t, map: one(t) },
      { at: [goalLine.x, 0], yaw: -Math.PI / 2, length: g, map: one(g) },
      { at: [-goalLine.x, 0], yaw: Math.PI / 2, length: g, map: one(g) },
    ];
  }, [touchline, goalLine]);
  return (
    <>
      {boards.map((b, k) => (
        <group key={k} position={[b.at[0], height / 2, b.at[1]]} rotation-y={b.yaw}>
          <mesh>
            <planeGeometry args={[b.length, height]} />
            <meshBasicMaterial map={b.map} color="#b8c4bf" />
          </mesh>
          <mesh position-z={-0.09}>
            <boxGeometry args={[b.length, height, 0.16]} />
            <meshStandardMaterial color="#101618" roughness={1} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ---------- floodlights ----------

function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,244,220,1)");
  g.addColorStop(0.18, "rgba(255,240,210,0.55)");
  g.addColorStop(0.5, "rgba(255,236,200,0.12)");
  g.addColorStop(1, "rgba(255,236,200,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A horizontal streak, as a lens draws a bright lamp (the bloom's flare). */
function flareTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 16;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, "rgba(255,236,200,0)");
  g.addColorStop(0.5, "rgba(255,240,214,1)");
  g.addColorStop(1, "rgba(255,236,200,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 16);
  const v = c.createLinearGradient(0, 0, 0, 16);
  v.addColorStop(0, "rgba(0,0,0,1)");
  v.addColorStop(0.5, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,1)");
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = v;
  c.fillRect(0, 0, 256, 16);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Floodlights() {
  const glow = useMemo(glowTexture, []);
  const flare = useMemo(flareTexture, []);
  // The shared look (quality/look.ts): brighter lamp faces (the high tier blooms them), the glow
  // capped at about three lamp heads, no wide halo and no flare streak.
  const look = useStore(quality, (s) => featuresOf(s.tier, false).look);
  const lamp = useMemo(
    () => new THREE.Color(NIGHT.lamp).multiplyScalar(look ? LOOK.lamp : 2.5),
    [look],
  );
  const glowSize = look ? LOOK.glowScale : 34;
  return (
    <>
      {FLOODLIGHTS.map((m, k) => {
        const yaw = Math.atan2(-m.x, m.y); // face the centre spot
        return (
          <group key={k} position={[m.x, 0, -m.y]}>
            <mesh position-y={m.height / 2}>
              <cylinderGeometry args={[0.35, 0.7, m.height, 8]} />
              <meshStandardMaterial color="#262c31" roughness={0.9} />
            </mesh>
            <group position-y={m.height} rotation={[0, yaw, 0]}>
              <group rotation-x={0.5}>
                <mesh>
                  <boxGeometry args={[10, 5, 0.8]} />
                  <meshStandardMaterial color="#1c2125" roughness={0.9} />
                </mesh>
                <mesh position-z={0.42}>
                  <planeGeometry args={[9.2, 4.2]} />
                  <meshBasicMaterial color={lamp} />
                </mesh>
              </group>
            </group>
            <sprite position-y={m.height} scale={[glowSize, glowSize, 1]}>
              <spriteMaterial
                map={glow}
                transparent
                opacity={look ? LOOK.glowOpacity : 0.5}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                fog={false}
                toneMapped={false}
              />
            </sprite>
            {/* The bloom: a wide, faint halo in the night air, and the lens's flare. */}
            <sprite position-y={m.height} scale={[96, 96, 1]} visible={!look}>
              <spriteMaterial
                map={glow}
                transparent
                opacity={0.13}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                fog={false}
                toneMapped={false}
              />
            </sprite>
            <sprite position-y={m.height} scale={[70, 2.6, 1]} visible={!look}>
              <spriteMaterial
                map={flare}
                transparent
                opacity={0.2}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                fog={false}
                toneMapped={false}
              />
            </sprite>
          </group>
        );
      })}
    </>
  );
}

/** The broadcast camera's gantry under the near roof (seen from the pitch, not from itself). */
function Gantry() {
  const c = BROADCAST_CAMERA;
  return (
    <mesh position={[c.x, c.height + 0.9, -c.y + 1.2]}>
      <boxGeometry args={[6, 0.5, 3]} />
      <meshStandardMaterial color="#20262a" roughness={1} />
    </mesh>
  );
}

// ---------- faint floodlight shadows under the players ----------

const PLAYER_H = 1.8; // m: casts the shadows
const SHADOW_WIDTH = 0.65; // m

function blobTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

/** The players' floodlight shadows: the classic decals, or with the shared look (quality/) the
 * art director's mast shadows. */
export function PlayerShadows() {
  const look = useStore(quality, (s) => featuresOf(s.tier, false).look);
  return look ? <MastShadows /> : <ClassicShadows />;
}

/** A wedge for a mast shadow: dark at the feet (left), fading to nothing at the tip (right),
 * 0.5 m wide at the feet and widening to the tip (the plane is 1 × 1, scaled per player). */
function wedgeTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 64;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(128, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const u = x / 127; // 0 at the feet, 1 at the tip
      const half = 0.5 * (0.55 + 0.45 * u); // of the plane's width (the plane is the tip's width)
      const v = Math.abs(y / 63 - 0.5);
      const across = Math.max(0, Math.min(1, (half - v) / (0.18 * half) + 0.5));
      const along = Math.pow(1 - u, 1.4) * Math.min(1, u * 14 + 0.35); // soft start under the core
      const a = Math.round(255 * along * across);
      const k = 4 * (y * 128 + x);
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = a;
    }
  }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

/**
 * Four shadows per player, as the Blender shots draw them (LOOKDEV §2a): each points from a
 * mast's foot through the player's feet, 1.8 m × the horizontal distance to the mast ÷ its 46 m
 * height long, about the shoulders' width at the feet and widening as it fades to the tip; the
 * key mast's (+x, +y) a little darker than the fills', over the dark contact core.
 */
function MastShadows() {
  const { hero, playback } = useView();
  const sample = useMemo(() => new Sample(hero.n), [hero]);
  const key = useRef<THREE.InstancedMesh>(null);
  const fill = useRef<THREE.InstancedMesh>(null);
  const contact = useRef<THREE.InstancedMesh>(null);
  const core = useRef<THREE.InstancedMesh>(null);
  // The wedge's plane starts at its local origin (the feet) and runs along +x.
  const wedge = useMemo(
    () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0),
    [],
  );
  const blob = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const materials = useMemo(() => {
    const make = (alphaMap: THREE.Texture, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: "#000000",
        alphaMap,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    const w = wedgeTexture();
    const b = blobTexture();
    return {
      key: make(w, LOOK.keyShadow),
      fill: make(w, LOOK.starShadow),
      contact: make(b, 0.42),
      core: make(b, 0.4),
    };
  }, []);
  const at = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const s = playback.get();
    sampleInto(sample, hero, hero.runs[s.mode], s.frame, s.comfort);
    const me = s.camera === "pov" ? hero.ids.indexOf(s.povPlayer) : -1;
    for (let j = 0; j < hero.n; j++) {
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      const size = j === me ? 0 : 1;
      FLOODLIGHTS.forEach((m, k) => {
        const dx = x - m.x;
        const dy = y - m.y;
        const reach = Math.hypot(dx, dy);
        const length = (PLAYER_H * reach) / m.height;
        at.position.set(x, 0.02, -y);
        at.rotation.set(0, Math.atan2(dy, dx), 0);
        at.scale.set(length * size, 1, LOOK.shadowTipWidth * size);
        at.updateMatrix();
        if (k === 0) key.current?.setMatrixAt(j, at.matrix);
        else fill.current?.setMatrixAt(3 * j + k - 1, at.matrix);
      });
      at.position.set(x, 0.021, -y);
      at.rotation.set(0, 0, 0);
      at.scale.set(size, 1, size);
      at.updateMatrix();
      contact.current?.setMatrixAt(j, at.matrix);
      at.position.y = 0.022;
      at.scale.set(0.5 * size, 1, 0.5 * size);
      at.updateMatrix();
      core.current?.setMatrixAt(j, at.matrix);
    }
    for (const r of [key, fill, contact, core]) {
      if (r.current) r.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh
        ref={key}
        args={[wedge, materials.key, hero.n]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={fill}
        args={[wedge, materials.fill, 3 * hero.n]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={contact}
        args={[blob, materials.contact, hero.n]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={core}
        args={[blob, materials.core, hero.n]}
        frustumCulled={false}
        renderOrder={1}
      />
    </>
  );
}

/** One faint shadow per mast, pointing away from it, plus a darker contact blob. In first
 * person the POV player's own are left out, like his body. */
function ClassicShadows() {
  const { hero, playback } = useView();

  const sample = useMemo(() => new Sample(hero.n), [hero]);
  const star = useRef<THREE.InstancedMesh>(null);
  const contact = useRef<THREE.InstancedMesh>(null);
  const core = useRef<THREE.InstancedMesh>(null); // the darker spot right under the feet
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const materials = useMemo(() => {
    const alphaMap = blobTexture();
    const make = (opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: "#000000",
        alphaMap,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    return { star: make(0.2), contact: make(0.42), core: make(0.4) };
  }, []);
  const at = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const s = playback.get();
    sampleInto(sample, hero, hero.runs[s.mode], s.frame, s.comfort);
    const me = s.camera === "pov" ? hero.ids.indexOf(s.povPlayer) : -1;
    for (let j = 0; j < hero.n; j++) {
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      const size = j === me ? 0 : 1;
      FLOODLIGHTS.forEach((m, k) => {
        const dx = x - m.x;
        const dy = y - m.y;
        const reach = Math.hypot(dx, dy);
        const length = (PLAYER_H * reach) / (m.height - PLAYER_H);
        at.position.set(x + (dx / reach) * (length / 2), 0.02, -(y + (dy / reach) * (length / 2)));
        at.rotation.set(0, Math.atan2(dy, dx), 0);
        at.scale.set(length * size, 1, SHADOW_WIDTH * size);
        at.updateMatrix();
        star.current?.setMatrixAt(4 * j + k, at.matrix);
      });
      at.position.set(x, 0.021, -y);
      at.rotation.set(0, 0, 0);
      at.scale.set(size, 1, size);
      at.updateMatrix();
      contact.current?.setMatrixAt(j, at.matrix);
      at.position.y = 0.022;
      at.scale.set(0.5 * size, 1, 0.5 * size);
      at.updateMatrix();
      core.current?.setMatrixAt(j, at.matrix);
    }
    if (star.current) star.current.instanceMatrix.needsUpdate = true;
    if (contact.current) contact.current.instanceMatrix.needsUpdate = true;
    if (core.current) core.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh
        ref={star}
        args={[geometry, materials.star, 4 * hero.n]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={contact}
        args={[geometry, materials.contact, hero.n]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={core}
        args={[geometry, materials.core, hero.n]}
        frustumCulled={false}
        renderOrder={1}
      />
    </>
  );
}
