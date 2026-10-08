"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  PointLight,
  ShaderMaterial,
  Vector3,
} from "three";
import { addCollider } from "../lib/colliders";
import { CABIN } from "../lib/layout";
import { damp } from "../lib/math";
import { patchMaterial } from "../lib/patch";
import { height } from "../lib/terrain";
import { plankTexture, shingleTexture, stoneTexture } from "../lib/textures";
import { emit, markInput, sfx, U, world } from "../lib/world";
import { hoverable } from "./cursor";
import { spawnSmoke } from "./effects/Particles";

const W = CABIN.w;
const D = CABIN.d;
const WALL = 1.0;
const PEAK = 0.72;
const BASE = 0.14;

const windowFrag = /* glsl */ `
uniform float uLight; uniform float uTime; uniform float uSil; uniform vec3 uSky;
varying vec2 vUv;
void main(){
  vec2 uv = vUv;
  vec3 day = mix(vec3(0.16, 0.22, 0.28), uSky * 0.9, smoothstep(0.2, 0.9, uv.y + uv.x * 0.3) * 0.5);
  float streak = smoothstep(0.08, 0.0, abs(uv.x - uv.y * 0.6 - 0.25));
  day += streak * 0.12;
  vec3 warm = mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.82, 0.5), uv.y);
  warm *= 1.0 + 0.06 * sin(uTime * 7.0) * sin(uTime * 3.1);
  // a little silhouette that wanders past
  float sx = uSil;
  float head = smoothstep(0.13, 0.11, length((uv - vec2(sx, 0.62)) * vec2(1.0, 0.9)));
  float body = smoothstep(0.24, 0.22, length((uv - vec2(sx, 0.1)) * vec2(0.8, 0.55)));
  float sil = max(head, body) * step(-0.5, sx);
  warm = mix(warm, warm * 0.25, sil * 0.85);
  vec3 col = mix(day, warm * 1.6, uLight);
  // muntins
  float m = step(abs(uv.x - 0.5), 0.035) + step(abs(uv.y - 0.5), 0.035);
  col = mix(col, vec3(0.95, 0.93, 0.88) * (0.3 + 0.7 * (1.0 - uLight * 0.6)), clamp(m, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function gableGeo() {
  const g = new BufferGeometry();
  const v = new Float32Array([-W / 2, 0, 0, W / 2, 0, 0, 0, PEAK, 0]);
  const uv = new Float32Array([0, 0, W / 1.4, 0, W / 2.8, PEAK / 1.4]);
  g.setAttribute("position", new BufferAttribute(v, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function Cabin() {
  const y0 = useMemo(() => height(CABIN.x, CABIN.z), []);
  const door = useRef<Group>(null);
  const vane = useRef<Group>(null);
  const lamp = useRef<PointLight>(null);
  const lampMat = useRef<MeshStandardMaterial>(null);
  const smokeT = useRef(0);
  const sil = useRef({ x: -1, v: 0, next: 6 });

  const mats = useMemo(() => {
    const wallTex = plankTexture("#eadbc0", 4, 7);
    const roofTex = shingleTexture("#4f7f82", 5);
    roofTex.repeat.set(2, 2);
    const stoneTex = stoneTexture(6);
    stoneTex.repeat.set(4, 1);
    const doorTex = plankTexture("#d6a24a", 9, 4).clone();
    doorTex.rotation = Math.PI / 2;
    doorTex.needsUpdate = true;
    return {
      wall: patchMaterial(new MeshStandardMaterial({ map: wallTex, roughness: 0.9 }), { wet: true }),
      gable: patchMaterial(new MeshStandardMaterial({ map: wallTex, roughness: 0.9, side: DoubleSide }), { wet: true }),
      roof: patchMaterial(new MeshStandardMaterial({ map: roofTex, roughness: 0.8 }), { snow: 1, wet: true }),
      stone: new MeshStandardMaterial({ map: stoneTex, roughness: 1 }),
      trim: new MeshStandardMaterial({ color: "#f6efe2", roughness: 0.8 }),
      door: new MeshStandardMaterial({ map: doorTex, color: "#ffffff", roughness: 0.8 }),
      dark: new MeshStandardMaterial({ color: "#2a1d16", roughness: 1 }),
      chimney: new MeshStandardMaterial({ map: stoneTex, color: "#c9a48f", roughness: 1 }),
      metal: new MeshStandardMaterial({ color: "#3c3a3a", roughness: 0.5, metalness: 0.6 }),
      box: new MeshStandardMaterial({ color: "#8a5a3a", roughness: 0.9 }),
      window: new ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: windowFrag,
        uniforms: { uLight: { value: 0 }, uTime: U.uTime, uSil: { value: -1 }, uSky: U.uSkyTint },
      }),
    };
  }, []);

  const gable = useMemo(() => gableGeo(), []);
  const roofLen = Math.hypot(W / 2 + 0.18, PEAK + 0.12);
  const roofAng = Math.atan2(PEAK + 0.12, W / 2 + 0.18);

  useEffect(() => {
    const rot = CABIN.rot;
    const toWorld = (lx: number, ly: number, lz: number) =>
      new Vector3(CABIN.x + lx * Math.cos(rot) + lz * Math.sin(rot), y0 + ly, CABIN.z - lx * Math.sin(rot) + lz * Math.cos(rot));
    // hull points in the collider's frame: local layout rotated, y in world space
    const hull = (pts: [number, number, number][], ox = 0, oz = 0) =>
      new Float32Array(
        pts.flatMap(([lx, ly, lz]) => [(lx - ox) * Math.cos(rot) + (lz - oz) * Math.sin(rot), y0 + ly, -(lx - ox) * Math.sin(rot) + (lz - oz) * Math.cos(rot)]),
      );
    const eave = BASE + WALL;
    const house: [number, number, number][] = [];
    for (const sz of [-1, 1]) {
      house.push([-W / 2 - 0.06, -0.05, sz * (D / 2 + 0.06)], [W / 2 + 0.06, -0.05, sz * (D / 2 + 0.06)]);
      house.push([-W / 2 - 0.18, eave, sz * (D / 2 + 0.18)], [W / 2 + 0.18, eave, sz * (D / 2 + 0.18)]);
      house.push([0, eave + PEAK + 0.11, sz * (D / 2 + 0.18)]);
    }
    const chimney: [number, number, number][] = [];
    for (const [cx, cz] of [[0.36, -0.42], [0.6, -0.42], [0.36, -0.18], [0.6, -0.18]] as const)
      chimney.push([cx, eave + PEAK * 0.5, cz], [cx, eave + PEAK + 0.36, cz]);
    const chim = toWorld(0.48, 0, -0.3);
    const offs = [
      addCollider({ id: "cabin", x: CABIN.x, z: CABIN.z, r: 0.95, bottom: y0, top: y0 + eave + PEAK, surface: "wood", hull: hull(house) }),
      addCollider({
        id: "cabin-chimney",
        x: chim.x,
        z: chim.z,
        r: 0.17,
        bottom: y0 + eave,
        top: y0 + eave + PEAK + 0.36,
        surface: "rock",
        hull: hull(chimney, 0.48, -0.3),
      }),
    ];
    const off = () => offs.forEach((o) => o());
    const perches = [
      { id: "roof-front", pos: toWorld(0, BASE + WALL + PEAK + 0.06, D / 2 - 0.1), taken: false },
      { id: "roof-back", pos: toWorld(0, BASE + WALL + PEAK + 0.06, -D / 2 + 0.2), taken: false },
      { id: "chimney", pos: toWorld(0.48, BASE + WALL + PEAK + 0.42, -0.3), taken: false },
    ];
    world.perches.push(...perches);
    return () => {
      off();
      world.perches = world.perches.filter((p) => !perches.includes(p));
    };
  }, [y0]);

  useFrame((_, dt) => {
    const cab = world.cabin;
    // close the door again after a while
    if (cab.doorTarget > 0 && world.elapsed - cab.knockAt > 4.2 && cab.villagerInside) cab.doorTarget = 0;
    cab.door = damp(cab.door, cab.doorTarget, cab.doorTarget > cab.door ? 6 : 3, dt);
    if (door.current) door.current.rotation.y = -cab.door * 1.7;

    // lights: on at night and in gloomy weather
    const want = Math.max(world.night, world.w.storm * 0.8, world.w.rain * 0.5, world.w.fog * 0.4);
    cab.lights = damp(cab.lights, want > 0.35 ? 1 : 0, 1.5, dt);
    mats.window.uniforms.uLight.value = cab.lights;
    if (lamp.current) lamp.current.intensity = cab.lights * 2.2 * (1 + 0.05 * Math.sin(world.elapsed * 9));
    if (lampMat.current) lampMat.current.emissiveIntensity = cab.lights * 2.5;

    // wandering silhouette
    const s = sil.current;
    if (cab.lights > 0.5 && cab.villagerInside) {
      s.next -= dt;
      if (s.next < 0 && s.v === 0) {
        s.x = -0.4;
        s.v = 0.18 + Math.random() * 0.1;
        s.next = 8 + Math.random() * 14;
      }
    }
    if (s.v) {
      s.x += s.v * dt;
      if (s.x > 1.4) {
        s.v = 0;
        s.x = -1;
      }
    }
    mats.window.uniforms.uSil.value = s.x;

    // weathervane points downwind
    if (vane.current) {
      const target = Math.atan2(-world.wind.y, world.wind.x) - CABIN.rot;
      const cur = vane.current.rotation.y;
      let d = target - cur;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      vane.current.rotation.y = cur + d * Math.min(1, dt * 2) + Math.sin(world.elapsed * 3) * 0.01 * world.windStrength;
    }

    // chimney smoke
    smokeT.current -= dt;
    if (smokeT.current < 0) {
      const cold = Math.max(world.night, world.w.snow, world.w.rain * 0.6);
      smokeT.current = 0.35 - cold * 0.18;
      const rot = CABIN.rot;
      const lx = 0.48;
      const lz = -0.3;
      const p = new Vector3(
        CABIN.x + lx * Math.cos(rot) + lz * Math.sin(rot),
        y0 + BASE + WALL + PEAK + 0.45,
        CABIN.z - lx * Math.sin(rot) + lz * Math.cos(rot),
      );
      spawnSmoke(p, 0.7 + world.daylight * 0.3, 0.8 + cold * 0.5);
    }
  });

  const knock = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    const cab = world.cabin;
    cab.knockAt = world.elapsed;
    if (cab.doorTarget === 0) {
      cab.doorTarget = 1;
      sfx("door", e.point, 0.8);
    } else {
      sfx("knock", e.point, 0.8);
    }
    emit("disturb", { pos: e.point.clone(), radius: 2 });
  };

  const poke = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    sfx("knock", e.point, 0.6, 0.8 + Math.random() * 0.3);
    emit("disturb", { pos: e.point.clone(), radius: 2.2 });
  };

  return (
    <group position={[CABIN.x, y0, CABIN.z]} rotation-y={CABIN.rot}>
      {/* foundation */}
      <mesh position={[0, BASE / 2 - 0.05, 0]} material={mats.stone} castShadow receiveShadow>
        <boxGeometry args={[W + 0.12, BASE + 0.1, D + 0.12]} />
      </mesh>
      <group position={[0, BASE, 0]} onClick={poke} {...hoverable("pointer")}>
        {/* walls */}
        <mesh position={[0, WALL / 2, 0]} material={mats.wall} castShadow receiveShadow>
          <boxGeometry args={[W, WALL, D]} />
        </mesh>
        {/* gables */}
        <mesh geometry={gable} material={mats.gable} position={[0, WALL, D / 2]} castShadow />
        <mesh geometry={gable} material={mats.gable} position={[0, WALL, -D / 2]} rotation-y={Math.PI} castShadow />
        {/* roof */}
        <mesh position={[-(W / 4 + 0.04), WALL + PEAK / 2 + 0.05, 0]} rotation-z={roofAng} material={mats.roof} castShadow receiveShadow>
          <boxGeometry args={[roofLen, 0.07, D + 0.36]} />
        </mesh>
        <mesh position={[W / 4 + 0.04, WALL + PEAK / 2 + 0.05, 0]} rotation-z={-roofAng} material={mats.roof} castShadow receiveShadow>
          <boxGeometry args={[roofLen, 0.07, D + 0.36]} />
        </mesh>
        <mesh position={[0, WALL + PEAK + 0.07, 0]} rotation-z={Math.PI / 4} material={mats.trim} castShadow>
          <boxGeometry args={[0.07, 0.07, D + 0.38]} />
        </mesh>
        {/* chimney */}
        <mesh position={[0.48, WALL + PEAK - 0.02, -0.3]} material={mats.chimney} castShadow>
          <boxGeometry args={[0.24, 0.75, 0.24]} />
        </mesh>
        <mesh position={[0.48, WALL + PEAK + 0.37, -0.3]} material={mats.stone}>
          <boxGeometry args={[0.29, 0.06, 0.29]} />
        </mesh>
        {/* front window + flower box */}
        <mesh position={[0.42, 0.6, D / 2 + 0.006]} material={mats.window}>
          <planeGeometry args={[0.36, 0.36]} />
        </mesh>
        <mesh position={[0.42, 0.6, D / 2 + 0.01]} material={mats.trim}>
          <boxGeometry args={[0.44, 0.44, 0.01]} />
        </mesh>
        <mesh position={[0.42, 0.38, D / 2 + 0.07]} material={mats.box} castShadow>
          <boxGeometry args={[0.46, 0.09, 0.12]} />
        </mesh>
        {[-0.16, -0.05, 0.06, 0.17].map((dx, i) => (
          <mesh key={i} position={[0.42 + dx, 0.45, D / 2 + 0.07]}>
            <sphereGeometry args={[0.04, 8, 6]} />
            <meshStandardMaterial color={["#f2b5c4", "#ffffff", "#f2bf4a", "#ee7f74"][i]} roughness={0.7} />
          </mesh>
        ))}
        {/* side windows */}
        <mesh position={[W / 2 + 0.006, 0.6, 0.05]} rotation-y={Math.PI / 2} material={mats.window}>
          <planeGeometry args={[0.36, 0.36]} />
        </mesh>
        <mesh position={[W / 2 + 0.01, 0.6, 0.05]} rotation-y={Math.PI / 2} material={mats.trim}>
          <boxGeometry args={[0.44, 0.44, 0.01]} />
        </mesh>
        <mesh position={[-W / 2 - 0.006, 0.6, -0.1]} rotation-y={-Math.PI / 2} material={mats.window}>
          <planeGeometry args={[0.36, 0.36]} />
        </mesh>
        <mesh position={[-W / 2 - 0.01, 0.6, -0.1]} rotation-y={-Math.PI / 2} material={mats.trim}>
          <boxGeometry args={[0.44, 0.44, 0.01]} />
        </mesh>
        {/* attic round window */}
        <mesh position={[0, WALL + 0.28, D / 2 + 0.008]} material={mats.window}>
          <circleGeometry args={[0.1, 20]} />
        </mesh>
        <mesh position={[0, WALL + 0.28, D / 2 + 0.004]} material={mats.trim}>
          <circleGeometry args={[0.135, 20]} />
        </mesh>
      </group>

      {/* door (hinged on its left edge) */}
      <group position={[-0.3, BASE, D / 2]}>
        <mesh position={[0, 0.37, -0.02]} material={mats.dark}>
          <boxGeometry args={[0.44, 0.74, 0.04]} />
        </mesh>
        <group ref={door} position={[-0.21, 0, 0.012]} onClick={knock} {...hoverable("pointer")}>
          <mesh position={[0.21, 0.36, 0]} material={mats.door} castShadow>
            <boxGeometry args={[0.42, 0.72, 0.035]} />
          </mesh>
          <mesh position={[0.36, 0.36, 0.03]} material={mats.metal}>
            <sphereGeometry args={[0.018, 8, 6]} />
          </mesh>
        </group>
        <mesh position={[0, 0.76, 0.03]} material={mats.trim}>
          <boxGeometry args={[0.52, 0.05, 0.04]} />
        </mesh>
        {/* step */}
        <mesh position={[0, -0.06, 0.2]} material={mats.stone} castShadow receiveShadow>
          <boxGeometry args={[0.56, 0.1, 0.3]} />
        </mesh>
        {/* lantern */}
        <group position={[0.34, 0.66, 0.08]}>
          <mesh material={mats.metal}>
            <boxGeometry args={[0.07, 0.1, 0.07]} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.05, 0.07, 0.075]} />
            <meshStandardMaterial ref={lampMat} color="#fff1c4" emissive="#ffb54d" emissiveIntensity={0} />
          </mesh>
          <pointLight ref={lamp} color="#ffb766" intensity={0} distance={5} decay={1.6} position={[0, 0, 0.15]} />
        </group>
      </group>

      {/* weathervane */}
      <group position={[0, BASE + WALL + PEAK + 0.1, D / 2 - 0.12]}>
        <mesh position={[0, 0.16, 0]} material={mats.metal}>
          <cylinderGeometry args={[0.008, 0.008, 0.32, 4]} />
        </mesh>
        <group ref={vane} position={[0, 0.3, 0]}>
          <mesh position={[0.02, 0, 0]} rotation-z={Math.PI / 2} material={mats.metal}>
            <cylinderGeometry args={[0.006, 0.006, 0.3, 4]} />
          </mesh>
          <mesh position={[0.17, 0, 0]} rotation-z={-Math.PI / 2} material={mats.metal}>
            <coneGeometry args={[0.025, 0.06, 4]} />
          </mesh>
          <mesh position={[-0.1, 0.02, 0]} material={mats.metal}>
            <boxGeometry args={[0.08, 0.07, 0.006]} />
          </mesh>
        </group>
      </group>

      {/* a woodpile by the side wall */}
      <group position={[-W / 2 - 0.22, 0.02, 0.35]}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[0, 0.06 + Math.floor(i / 3) * 0.1, -0.12 + (i % 3) * 0.11 + (Math.floor(i / 3) ? 0.05 : 0)]} rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.36, 7]} />
            <meshStandardMaterial color={i % 2 ? "#8a6444" : "#9b7350"} roughness={1} />
          </mesh>
        ))}
      </group>
      <InteriorGlow />
    </group>
  );
}

function InteriorGlow() {
  const ref = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    if (ref.current) ref.current.emissiveIntensity = world.cabin.lights * 1.2 + world.cabin.door * 0.2;
  });
  return (
    <mesh position={[-0.3, BASE + 0.37, D / 2 + 0.002]}>
      <planeGeometry args={[0.42, 0.72]} />
      <meshStandardMaterial ref={ref} color="#3a2414" emissive={new Color("#ff9c45")} emissiveIntensity={0} />
    </mesh>
  );
}
