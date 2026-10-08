"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  Points,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";
import { clamp, mulberry32, smoothstep } from "../../lib/math";
import { height, inPond } from "../../lib/terrain";
import { POND } from "../../lib/layout";
import { toolState } from "../../lib/tools";
import { U, idleSeconds, on, world } from "../../lib/world";
import { flowerSpots } from "../Flora";

const flyTmp = new Vector3();
const flyTo = new Vector3();

/* ---------------- butterflies ---------------- */

function wingShape() {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.25, 0.55, 0.95, 0.75, 0.9, 0.25);
  s.bezierCurveTo(0.88, 0.05, 0.5, 0.02, 0.35, -0.02);
  s.bezierCurveTo(0.75, -0.2, 0.7, -0.62, 0.4, -0.6);
  s.bezierCurveTo(0.2, -0.58, 0.05, -0.3, 0, 0);
  return new ShapeGeometry(s, 8).rotateX(Math.PI / 2);
}

type Fly = {
  pos: Vector3;
  vel: Vector3;
  target: Vector3;
  state: "flit" | "rest" | "follow" | "beam";
  timer: number;
  presence: number;
  phase: number;
  heading: number;
};

const BUTTERFLY_COLS = ["#f6c945", "#fbf7ee", "#7fb5e8", "#f08d4a", "#e8a6d6", "#f6c945"];

function Butterflies() {
  const n = world.mobile ? 4 : 6;
  const groups = useRef<(Group | null)[]>([]);
  const wl = useRef<(Group | null)[]>([]);
  const wr = useRef<(Group | null)[]>([]);
  const geo = useMemo(() => wingShape(), []);
  const mats = useMemo(
    () => BUTTERFLY_COLS.map((c) => new MeshStandardMaterial({ color: c, side: DoubleSide, roughness: 0.6, emissive: new Color(c), emissiveIntensity: 0.08 })),
    [],
  );
  const bodyMat = useMemo(() => new MeshStandardMaterial({ color: "#2e2a26", roughness: 0.8 }), []);
  const flies = useMemo<Fly[]>(() => {
    const rnd = mulberry32(9);
    return Array.from({ length: n }, (_, i) => {
      const s = flowerSpots[i % flowerSpots.length];
      const p = new Vector3(s.x + rnd() - 0.5, height(s.x, s.z) + 0.6, s.z + rnd() - 0.5);
      return { pos: p, vel: new Vector3(), target: p.clone(), state: "flit", timer: rnd() * 3, presence: 0, phase: rnd() * 10, heading: 0 };
    });
  }, [n]);

  useEffect(() => {
    const scatter = (pos: Vector3, r: number, push = 2.5) => {
      flies.forEach((f) => {
        const d = f.pos.distanceTo(pos);
        if (d < r) {
          f.vel.add(f.pos.clone().sub(pos).setY(0).normalize().multiplyScalar(push)).add(new Vector3(0, 1.2, 0));
          f.state = "flit";
          f.timer = 0;
        }
      });
    };
    const offs = [
      on("disturb", ({ pos, radius }) => scatter(pos, radius + 1)),
      on("gust", ({ pos, strength }) => scatter(pos, 2 + strength, 3 + strength)),
      on("shake", ({ pos }) => scatter(pos, 2.5)),
    ];
    return () => offs.forEach((o) => o());
  }, [flies]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = world.elapsed;
    const ok = world.daylight > 0.35 && world.w.rain < 0.3 && world.w.storm < 0.3 && world.w.snow < 0.3;
    flies.forEach((f, i) => {
      const g = groups.current[i];
      if (!g) return;
      f.presence = clamp(f.presence + (ok ? dt * 0.4 : -dt * 0.5));
      g.visible = f.presence > 0.01;
      if (!g.visible) return;
      f.timer -= dt;
      const ground = height(f.pos.x, f.pos.z);

      if (f.state === "rest") {
        f.vel.multiplyScalar(0.8);
        if (f.timer < 0) {
          f.state = "flit";
          f.timer = 0;
          f.vel.y += 1;
        }
      } else {
        const beam = toolState.tool === "mirror" && toolState.active && world.night < 0.5 && toolState.surface === "land";
        if (beam && f.state !== "follow" && Math.hypot(toolState.point.x - f.pos.x, toolState.point.z - f.pos.z) < 7) {
          f.state = "beam";
          f.timer = 0.5;
        }
        if (f.state === "beam" && !beam) f.timer = Math.min(f.timer, 0);
        if (f.timer < 0) {
          // choose: follow the cursor if it's near and gentle, else a flower
          const p = world.pointer;
          const near = world.pointerOnLand && Math.hypot(p.x - f.pos.x, p.z - f.pos.z) < 4 && world.pointerSpeed < 400;
          if (near && Math.random() < 0.35) {
            f.state = "follow";
            f.timer = 3 + Math.random() * 3;
          } else {
            f.state = "flit";
            const s = flowerSpots[Math.floor(Math.random() * flowerSpots.length)];
            f.target.set(s.x + (Math.random() - 0.5) * 0.6, 0, s.z + (Math.random() - 0.5) * 0.6);
            f.target.y = height(f.target.x, f.target.z) + 0.18;
            f.timer = 5 + Math.random() * 6;
          }
        }
        if (f.state === "follow") f.target.copy(world.pointer).add(flyTmp.set(Math.sin(t * 1.3 + i) * 0.35, 0.45, Math.cos(t * 1.1 + i) * 0.35));
        // dancing in the sunbeam
        if (f.state === "beam") f.target.copy(toolState.point).add(flyTmp.set(Math.sin(t * 1.7 + i * 2) * 0.45, 0.35 + Math.sin(t * 2.3 + i) * 0.2, Math.cos(t * 1.5 + i * 2) * 0.45));
        const to = flyTo.copy(f.target).sub(f.pos);
        const d = to.length();
        to.normalize().multiplyScalar(f.state === "follow" || f.state === "beam" ? 2.2 : 1.6);
        f.vel.lerp(to, Math.min(1, dt * 1.6));
        // flutter
        f.vel.x += Math.sin(t * 7 + f.phase) * dt * 3;
        f.vel.y += Math.sin(t * 9.3 + f.phase * 2) * dt * 4;
        f.vel.z += Math.cos(t * 6.1 + f.phase) * dt * 3;
        if (f.state === "flit" && d < 0.12) {
          f.state = "rest";
          f.timer = 2 + Math.random() * 5;
        }
      }
      f.vel.x += world.breeze.x * dt * 0.8;
      f.vel.z += world.breeze.y * dt * 0.8;
      f.pos.addScaledVector(f.vel, dt);
      if (f.pos.y < ground + 0.1) {
        f.pos.y = ground + 0.1;
        f.vel.y = Math.abs(f.vel.y);
      }
      const away = 1 - f.presence;
      g.position.set(f.pos.x, f.pos.y + away * 6, f.pos.z);
      const hv = Math.hypot(f.vel.x, f.vel.z);
      if (hv > 0.05) f.heading = Math.atan2(f.vel.x, f.vel.z);
      g.rotation.set(0, f.heading, 0);
      g.scale.setScalar(0.11 * smoothstep(0, 0.3, f.presence));
      const flap = f.state === "rest" ? 0.25 + Math.sin(t * 2.2 + f.phase) * 0.35 : 0.2 + Math.abs(Math.sin(t * 16 + f.phase)) * 1.25;
      const L = wl.current[i];
      const R = wr.current[i];
      if (L && R) {
        L.rotation.z = flap;
        R.rotation.z = flap;
      }
    });
  });

  return (
    <>
      {flies.map((_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} visible={false}>
          <mesh material={bodyMat} scale={[0.07, 0.07, 0.5]}>
            <sphereGeometry args={[0.5, 6, 5]} />
          </mesh>
          <group ref={(g) => { wl.current[i] = g; }}>
            <mesh geometry={geo} material={mats[i % mats.length]} />
          </group>
          <group rotation={[0, Math.PI, 0]} ref={(g) => { wr.current[i] = g; }}>
            <mesh geometry={geo} material={mats[i % mats.length]} />
          </group>
        </group>
      ))}
    </>
  );
}

/* ---------------- fireflies ---------------- */

const ffVert = /* glsl */ `
attribute float aSeed;
uniform float uTime; uniform float uScale; uniform float uAmount;
varying float vA;
void main(){
  float blink = 0.5 + 0.5 * sin(uTime * (1.4 + aSeed * 2.1) + aSeed * 40.0);
  blink = pow(blink, 3.0);
  vA = uAmount * (0.25 + blink * 0.75);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (0.09 + blink * 0.07) * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const ffFrag = /* glsl */ `
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.35, 0.0, d);
  float halo = smoothstep(1.0, 0.0, d) * 0.45;
  vec3 col = mix(vec3(0.75, 1.0, 0.35), vec3(1.0, 1.0, 0.85), core);
  gl_FragColor = vec4(col * (core + halo) * vA, 1.0);
}`;

type FF = { home: Vector3; pos: Vector3; vel: Vector3; seed: number };

function Fireflies() {
  const n = world.mobile ? 36 : 64;
  const { size, viewport } = useThree();
  const s = useRef({ still: 0 });
  const ffs = useMemo<FF[]>(() => {
    const rnd = mulberry32(31);
    const out: FF[] = [];
    let tries = 0;
    while (out.length < n && tries++ < 4000) {
      const nearPond = out.length < n * 0.3;
      const x = nearPond ? POND.x + (rnd() - 0.5) * 4 : (rnd() - 0.5) * 16;
      const z = nearPond ? POND.z + (rnd() - 0.5) * 4 : (rnd() - 0.5) * 16;
      const h = height(x, z);
      if (h < 0.35 || h > 2.4 || inPond(x, z)) continue;
      const home = new Vector3(x, h + 0.35 + rnd() * 0.8, z);
      out.push({ home, pos: home.clone(), vel: new Vector3(), seed: rnd() });
    }
    return out;
  }, [n]);
  const pts = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(ffs.length * 3), 3));
    g.setAttribute("aSeed", new BufferAttribute(new Float32Array(ffs.map((f) => f.seed)), 1));
    const m = new ShaderMaterial({
      vertexShader: ffVert,
      fragmentShader: ffFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: U.uTime, uScale: { value: 300 }, uAmount: { value: 0 } },
    });
    const p = new Points(g, m);
    p.frustumCulled = false;
    p.raycast = () => {};
    return p;
  }, [ffs]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = world.elapsed;
    const amount = smoothstep(0.35, 0.8, world.night) * (1 - world.w.rain * 0.85) * (1 - world.w.snow * 0.9);
    const m = pts.material as ShaderMaterial;
    m.uniforms.uAmount.value = amount;
    m.uniforms.uScale.value = size.height * viewport.dpr * 0.5;
    pts.visible = amount > 0.01;
    if (!pts.visible) return;

    // a still cursor on the grass draws them in
    const st = s.current;
    st.still = world.pointerOnLand && world.pointerSpeed < 60 && idleSeconds() < 30 ? st.still + dt : 0;
    const moonbeam = toolState.tool === "mirror" && toolState.active && toolState.surface === "land";
    const gather = st.still > 1.2 || moonbeam;
    const p = moonbeam ? toolState.point : world.pointer;
    const arr = pts.geometry.attributes.position.array as Float32Array;
    ffs.forEach((f, i) => {
      const k = f.seed * 50;
      let tx = f.home.x + Math.sin(t * 0.3 + k) * 0.9;
      let ty = f.home.y + Math.sin(t * 0.7 + k * 1.3) * 0.25;
      let tz = f.home.z + Math.cos(t * 0.27 + k * 0.7) * 0.9;
      if (gather && Math.hypot(p.x - f.home.x, p.z - f.home.z) < 6) {
        const a = t * (0.5 + f.seed * 0.6) + k;
        const r = 0.35 + f.seed * 0.6;
        tx = p.x + Math.cos(a) * r;
        ty = p.y + 0.35 + Math.sin(a * 1.7) * 0.25 + f.seed * 0.4;
        tz = p.z + Math.sin(a) * r;
      }
      f.vel.x += (tx - f.pos.x) * dt * 1.2 + world.breeze.x * dt * 0.5;
      f.vel.y += (ty - f.pos.y) * dt * 1.2;
      f.vel.z += (tz - f.pos.z) * dt * 1.2 + world.breeze.y * dt * 0.5;
      f.vel.multiplyScalar(Math.exp(-dt * 1.5));
      f.pos.addScaledVector(f.vel, dt);
      arr[i * 3] = f.pos.x;
      arr[i * 3 + 1] = f.pos.y;
      arr[i * 3 + 2] = f.pos.z;
    });
    pts.geometry.attributes.position.needsUpdate = true;
  });

  return <primitive object={pts} />;
}

export function Bugs() {
  return (
    <>
      <Butterflies />
      <Fireflies />
    </>
  );
}
