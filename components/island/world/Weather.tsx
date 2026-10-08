"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  RingGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";
import { atmo } from "../lib/atmosphere";
import { clamp, damp, mulberry32 } from "../lib/math";
import { discover } from "../lib/secrets";
import { U, emit, world } from "../lib/world";
import { cloudStates, makeRainMaterial, streakGeometry } from "./SkyToys";

/* ---------------- snow ---------------- */
const snowVert = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime; uniform vec2 uWind; uniform float uAmount; uniform float uScale;
varying float vA;
void main(){
  float B = 44.0, H = 18.0;
  float fall = uTime * (0.55 + aSeed.y * 0.5);
  vec3 p = vec3(aSeed.x * B - B * 0.5, H - mod(aSeed.z * H + fall, H), aSeed.y * B - B * 0.5);
  float drift = H - p.y;
  p.x += sin(uTime * 0.7 + aSeed.x * 40.0) * 0.4 + uWind.x * drift * 0.35;
  p.z += cos(uTime * 0.6 + aSeed.z * 40.0) * 0.4 + uWind.y * drift * 0.35;
  p.xz = mod(p.xz + B * 0.5, B) - B * 0.5;
  vA = uAmount * step(fract(aSeed.x * 13.7), uAmount * 1.1) * smoothstep(0.0, 1.5, p.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.07 + aSeed.y * 0.06) * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const snowFrag = /* glsl */ `
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0), a * 0.9);
}`;

function Snow() {
  const { size, viewport } = useThree();
  const pts = useMemo(() => {
    const n = world.mobile ? 900 : 2000;
    const g = new BufferGeometry();
    const rnd = mulberry32(31);
    const seeds = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) seeds[i] = rnd();
    g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aSeed", new BufferAttribute(seeds, 3));
    const m = new ShaderMaterial({
      vertexShader: snowVert,
      fragmentShader: snowFrag,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: U.uTime, uWind: U.uWind, uAmount: { value: 0 }, uScale: { value: 300 } },
    });
    const p = new Points(g, m);
    p.frustumCulled = false;
    p.raycast = () => null;
    p.renderOrder = 6;
    return p;
  }, []);
  useFrame(() => {
    const m = pts.material as ShaderMaterial;
    m.uniforms.uAmount.value = world.w.snow;
    m.uniforms.uScale.value = size.height * viewport.dpr * 0.5;
    pts.visible = world.w.snow > 0.01;
  });
  return <primitive object={pts} />;
}

/* ---------------- rain over everything ---------------- */
function Rain() {
  const { mat, geo } = useMemo(() => ({ mat: makeRainMaterial(), geo: streakGeometry(world.mobile ? 1400 : 3200, 911) }), []);
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const u = mat.uniforms;
    u.uCenter.value.set(0, 0, 0);
    u.uRadius.value = 26;
    u.uTop.value = 15;
    u.uIntensity.value = clamp(world.w.rain * 1.1);
    u.uColor.value.copy(atmo.ambient).lerp(WHITE, 0.45).multiplyScalar(0.55 + 0.45 * world.daylight);
    if (mesh.current) mesh.current.visible = world.w.rain > 0.02;
  });
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} raycast={() => null} renderOrder={4} />;
}
const WHITE = new Color("#ffffff");
const SHIP = new Color("#20262c");

/* ---------------- storm: lightning from the clouds ---------------- */
function StormBrain() {
  const st = useRef({ next: 6 });
  useFrame((_, dt) => {
    const s = st.current;
    if (world.w.storm < 0.55) {
      s.next = Math.min(s.next, 5);
      return;
    }
    s.next -= dt;
    if (s.next > 0) return;
    s.next = 3 + Math.random() * 7;
    const vis = cloudStates.filter((c) => c.vis > 0.5);
    const c = vis[Math.floor(Math.random() * vis.length)];
    const from = c ? c.pos.clone().setY(c.pos.y - 1) : new Vector3((Math.random() - 0.5) * 60, 14, (Math.random() - 0.5) * 60);
    const a = Math.random() * Math.PI * 2;
    const r = 13 + Math.random() * 20;
    const to = Math.random() < 0.25 ? new Vector3(from.x * 0.6, 0, from.z * 0.6) : new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    emit("lightning", { pos: from, target: to });
  });
  return null;
}

/* ---------------- rainbow after rain ---------------- */
const rainbowFrag = /* glsl */ `
uniform float uAlpha; varying vec2 vUv; varying float vR;
vec3 spectrum(float t){
  return clamp(vec3(
    abs(t * 6.0 - 3.0) - 1.0,
    2.0 - abs(t * 6.0 - 2.0),
    2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0);
}
void main(){
  float t = clamp(vR, 0.0, 1.0);
  vec3 c = spectrum(1.0 - t);
  float edge = smoothstep(0.0, 0.18, t) * smoothstep(1.0, 0.82, t);
  float foot = smoothstep(0.0, 0.25, vUv.y);
  gl_FragColor = vec4(c * 0.9 + 0.1, edge * foot * uAlpha * 0.32);
}`;
const rainbowVert = /* glsl */ `
uniform float uInner; uniform float uOuter; varying vec2 vUv; varying float vR;
void main(){
  vUv = vec2(position.x, position.y) / uOuter * 0.5 + 0.5;
  vR = (length(position.xy) - uInner) / (uOuter - uInner);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function Rainbow() {
  const { camera } = useThree();
  const g = useRef<Group>(null);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: rainbowVert,
        fragmentShader: rainbowFrag,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: { uAlpha: { value: 0 }, uInner: { value: 62 }, uOuter: { value: 70 } },
      }),
    [],
  );
  const geo = useMemo(() => new RingGeometry(62, 70, 96, 1, 0, Math.PI), []);
  const st = useRef({ hadRain: 0, show: 0, t: 0, yaw: 0 });
  const fwd = useMemo(() => new Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    const w = world.w;
    if (w.rain > 0.55) s.hadRain = 1;
    if (s.hadRain && w.rain < 0.15 && world.daylight > 0.5 && w.storm < 0.2) {
      s.hadRain = 0;
      s.t = 50;
      camera.getWorldDirection(fwd);
      s.yaw = Math.atan2(fwd.x, fwd.z);
    }
    s.t = Math.max(0, s.t - dt);
    const want = s.t > 0 ? clamp(s.t / 6) * world.daylight * (1 - w.rain) : 0;
    s.show = damp(s.show, Math.max(want, world.rainbowBoost), 0.6, dt);
    world.rainbow = s.show;
    world.rainbowBoost = Math.max(0, world.rainbowBoost - dt * 0.03);
    mat.uniforms.uAlpha.value = s.show;
    if (g.current) {
      g.current.visible = s.show > 0.01;
      g.current.position.set(Math.sin(s.yaw) * 150, -18, Math.cos(s.yaw) * 150);
      g.current.rotation.set(0, s.yaw + Math.PI, 0);
    }
    if (s.show > 0.4) discover("rainbow");
  });

  return (
    <group ref={g} visible={false}>
      <mesh geometry={geo} material={mat} raycast={() => null} renderOrder={-6} />
    </group>
  );
}

/* ---------------- the ship that only sails in storms ---------------- */
function GhostShip() {
  const { camera } = useThree();
  const g = useRef<Group>(null);
  const st = useRef({ a: 2.2, vis: 0, seen: 0 });
  const mat = useMemo(() => new MeshBasicMaterial({ color: "#2a3138", transparent: true, opacity: 0, fog: false, depthWrite: false }), []);
  const lampMat = useMemo(() => new MeshBasicMaterial({ color: new Color("#ffcf7a").multiplyScalar(2), transparent: true, opacity: 0, toneMapped: false, fog: false }), []);
  const geo = useMemo(() => {
    const s = new Shape();
    // hull
    s.moveTo(-3.4, 0.4);
    s.lineTo(3.6, 0.4);
    s.lineTo(2.8, -0.6);
    s.lineTo(-2.6, -0.6);
    s.lineTo(-3.4, 0.4);
    // masts and tattered sails
    const sail = (x: number, h: number, w: number) => {
      s.moveTo(x - 0.06, 0.4);
      s.lineTo(x - 0.06, h);
      s.lineTo(x + 0.06, h);
      s.lineTo(x + 0.06, 0.4);
      s.moveTo(x + 0.1, h - 0.3);
      s.quadraticCurveTo(x + w * 0.7, h - 1.2, x + w * 0.3, 1.0);
      s.lineTo(x + 0.1, 1.0);
      s.lineTo(x + 0.1, h - 0.3);
    };
    sail(-1.6, 4.2, 2.0);
    sail(0.4, 5.2, 2.4);
    sail(2.2, 3.6, 1.6);
    return new ShapeGeometry(s);
  }, []);
  const v = useMemo(() => new Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    const want = world.w.storm > 0.6 ? 1 : 0;
    s.vis = damp(s.vis, want, 0.3, dt);
    const grp = g.current;
    if (!grp) return;
    grp.visible = s.vis > 0.01;
    if (!grp.visible) return;
    s.a += dt * 0.008;
    const R = 78;
    grp.position.set(Math.cos(s.a) * R, -0.4 + Math.sin(world.elapsed * 0.6) * 0.15, Math.sin(s.a) * R);
    grp.lookAt(camera.position.x, grp.position.y, camera.position.z);
    grp.rotation.z = Math.sin(world.elapsed * 0.5) * 0.04;
    mat.color.copy(SHIP).lerp(atmo.fog, 0.45 - world.flash * 0.3);
    mat.opacity = s.vis * (0.7 + 0.3 * world.flash);
    lampMat.opacity = s.vis * (0.6 + 0.4 * Math.sin(world.elapsed * 3.1));
    // seen it?
    v.copy(grp.position).project(camera);
    if (s.vis > 0.6 && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z < 1) {
      s.seen += dt;
      if (s.seen > 3) discover("ghostShip");
    }
  });

  return (
    <group ref={g} visible={false}>
      <mesh geometry={geo} material={mat} raycast={() => null} scale={1.4} />
      <mesh material={lampMat} position={[3.6 * 1.4, 0.9, 0.05]} raycast={() => null}>
        <circleGeometry args={[0.18, 10]} />
      </mesh>
    </group>
  );
}

export function Weather() {
  return (
    <>
      <Rain />
      <Snow />
      <StormBrain />
      <Rainbow />
      <GhostShip />
    </>
  );
}
