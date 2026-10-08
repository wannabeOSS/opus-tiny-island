"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Raycaster,
  RingGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Intersection,
} from "three";
import { audio } from "../lib/audio";
import { colliders } from "../lib/colliders";
import { merge, prep } from "../lib/geo";
import { clamp } from "../lib/math";
import { discover } from "../lib/secrets";
import { height, inPond, POND_LEVEL } from "../lib/terrain";
import { groundTargets, landCrumbs, setTool, subscribeTool, toolState, type Surface } from "../lib/tools";
import { addWet, wetAt } from "../lib/wetmap";
import { addPondRipple, addRipple, emit, markInput, on, sfx, U, world } from "../lib/world";
import { blowBubble } from "../world/Bubbles";
import { setCursor } from "../world/cursor";
import { pools, spawnSparkle, spawnSplash } from "../world/effects/Particles";

const ray = new Raycaster();
const ndc = new Vector2();
const hits: Intersection[] = [];
const camFwd = new Vector3();
const camRight = new Vector3();
const tmp = new Vector3();
const tmp2 = new Vector3();
const UP = new Vector3(0, 1, 0);

const DROP = new Color("#cfe9f2");
const FLAKE = new Color("#ffffff");
const STEAM = new Color("#f4efe6");
const SUN_COL = new Color("#ffe2a0");
const MOON_COL = new Color("#b9d2ff");
const LEAF_COLS = ["#9cc56a", "#c9d77a", "#e9b85b", "#f3d2df"].map((c) => new Color(c));
const MAX_CRUMBS = 80;
const RING_POOL = 6;
/** seconds of steady rain before a pocket cloud crackles */
const CLOUD_TEMPER = 7;

type Ring = { pos: Vector3; t: number; sea: boolean };

function cloudGeometry() {
  const white = new Color("#ffffff");
  const belly = new Color("#c9d3dc");
  const blobs: [number, number, number, number][] = [
    [0, 0, 0, 0.4],
    [0.36, -0.05, 0.04, 0.3],
    [-0.35, -0.06, -0.03, 0.29],
    [0.12, 0.2, -0.05, 0.28],
    [-0.14, 0.15, 0.12, 0.25],
    [0.06, -0.08, 0.24, 0.25],
    [-0.02, -0.08, -0.25, 0.25],
  ];
  const g = merge(
    blobs.map(([x, y, z, r]) => {
      const b = new IcosahedronGeometry(r, 2);
      b.translate(x, y, z);
      return prep(b, (p) => (p.y < -0.12 ? belly : white));
    }),
  );
  g.scale(1, 0.78, 1);
  return g;
}

const beamVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main(){
  float core = pow(abs(dot(normalize(vN), vV)), 1.6);
  float fade = smoothstep(1.0, 0.15, vUv.y) * smoothstep(0.0, 0.03, vUv.y);
  float motes = 0.8 + 0.2 * sin(vUv.y * 60.0 - uTime * 2.5 + vUv.x * 25.0);
  gl_FragColor = vec4(uColor * core * fade * motes * uAmount * 0.55, 1.0);
}`;
const glowFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
uniform float uTime;
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float g = pow(max(1.0 - d, 0.0), 1.8);
  float shimmer = 0.9 + 0.1 * sin(uTime * 6.0 + d * 12.0);
  gl_FragColor = vec4(uColor * g * shimmer * uAmount * 0.9, 1.0);
}`;
const glowVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function surfaceY(p: Vector3, surf: Surface) {
  return surf === "land" ? height(p.x, p.z) : surf === "pond" ? POND_LEVEL : Math.max(p.y, 0);
}

export function Tools() {
  const { camera, gl, setEvents } = useThree();
  const ring = useRef<Mesh>(null);
  const cloud = useRef<Group>(null);
  const beam = useRef<Mesh>(null);
  const glow = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);
  const ringMeshes = useRef<(Mesh | null)[]>([]);
  const crumbMesh = useRef<InstancedMesh>(null);
  const st = useRef({
    down: false,
    lastXY: new Vector2(),
    lastT: 0,
    acc: 0,
    gustSfx: 0,
    hintedLook: false,
    cloudPos: new Vector3(0, -50, 0),
    cloudShow: 0,
    cloudHold: 0,
    cloudFlash: 0,
    beam: 0,
    beamAcc: 0,
    lastBomb: -10,
    lastConch: -10,
    answerUntil: -10,
  });
  const rings = useRef<Ring[]>([]);
  const answers = useRef(new Set<string>());
  const dummy = useMemo(() => new Object3D(), []);
  const crumbMat = useMemo(() => new MeshStandardMaterial({ color: "#d9b478", roughness: 1 }), []);
  const cloudGeo = useMemo(() => cloudGeometry(), []);
  const cloudMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 1, emissive: new Color("#fff4dc"), emissiveIntensity: 0.12, transparent: true }), []);
  const beamGeo = useMemo(() => new CylinderGeometry(0.62, 0.34, 1, 28, 1, true).translate(0, 0.5, 0), []);
  const beamMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        uniforms: { uColor: { value: SUN_COL.clone() }, uAmount: { value: 0 }, uTime: U.uTime },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: 2,
        toneMapped: false,
      }),
    [],
  );
  const glowGeo = useMemo(() => new CircleGeometry(0.85, 40).rotateX(-Math.PI / 2), []);
  const glowMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: glowVert,
        fragmentShader: glowFrag,
        uniforms: beamMat.uniforms,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [beamMat],
  );
  const ringGeo = useMemo(() => new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), []);
  const ringMats = useMemo(
    () =>
      Array.from(
        { length: RING_POOL },
        () => new MeshBasicMaterial({ color: "#fff3d6", transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      ),
    [],
  );

  // pick what's under the pointer
  const pick = (clientX: number, clientY: number): Surface => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    toolState.ndc.copy(ndc);
    ray.setFromCamera(ndc, camera);
    hits.length = 0;
    ray.intersectObjects(groundTargets, false, hits);
    const h = hits[0];
    if (!h) {
      toolState.surface = "none";
      return "none";
    }
    toolState.point.copy(h.point);
    let s = h.object.userData.surface as Surface;
    if (s === "land" && h.point.y < 0.02) s = "sea";
    if (s === "sea" && inPond(h.point.x, h.point.z)) s = "pond";
    toolState.surface = s;
    world.pointer.copy(h.point);
    world.pointerOnLand = s === "land";
    world.pointerOverWorld = true;
    return s;
  };

  useEffect(() => {
    const apply = () => {
      const hand = toolState.tool === "hand";
      setEvents({ enabled: hand });
      setCursor("default");
    };
    apply();
    return subscribeTool(apply);
  }, [setEvents]);

  // creatures answering the conch
  useEffect(
    () =>
      on("conchAnswer", ({ who }) => {
        if (world.elapsed > st.current.answerUntil) return;
        answers.current.add(who);
        if (answers.current.size >= 3) discover("chorus");
      }),
    [],
  );

  useEffect(() => {
    const el = gl.domElement;
    const s = st.current;
    const down = (e: PointerEvent) => {
      if (toolState.tool === "hand" || e.button !== 0) return;
      if (e.pointerType === "touch" && !e.isPrimary) {
        // second finger: let the camera have it
        toolState.active = false;
        s.down = false;
        return;
      }
      markInput();
      s.down = true;
      s.lastXY.set(e.clientX, e.clientY);
      s.lastT = performance.now();
      s.acc = 1; // fire immediately
      const surf = pick(e.clientX, e.clientY);
      toolState.active = surf !== "none" || toolState.tool === "pinwheel";
      toolState.dragVel.x = toolState.dragVel.y = 0;
      if (toolState.active) tap(surf);
    };
    const move = (e: PointerEvent) => {
      if (toolState.tool === "hand") {
        const rect = el.getBoundingClientRect();
        toolState.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        return;
      }
      pick(e.clientX, e.clientY);
      if (!s.down) return;
      const now = performance.now();
      const dt = Math.max(1, now - s.lastT) / 1000;
      const vx = (e.clientX - s.lastXY.x) / dt;
      const vy = (e.clientY - s.lastXY.y) / dt;
      toolState.dragVel.x = toolState.dragVel.x * 0.5 + vx * 0.5;
      toolState.dragVel.y = toolState.dragVel.y * 0.5 + vy * 0.5;
      s.lastXY.set(e.clientX, e.clientY);
      s.lastT = now;
    };
    const up = () => {
      s.down = false;
      toolState.active = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTool("hand");
    };
    const ctx = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    el.addEventListener("contextmenu", ctx);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      el.removeEventListener("contextmenu", ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  /** one-off actions at the moment of pressing */
  const tap = (surf: Surface) => {
    const p = toolState.point;
    const s = st.current;
    if (!s.hintedLook) {
      s.hintedLook = true;
      emit("hint", { text: world.mobile ? "two fingers to look around" : "right-drag to look around" });
    }
    switch (toolState.tool) {
      case "seedbomb":
        throwSeedBomb(p);
        break;
      case "conch":
        blowConch(p, surf);
        break;
      case "pinwheel":
        sfx("gust", p, 0.4);
        break;
      case "cloud":
        sfx("puff", p, 0.4, 0.8);
        break;
      case "mirror":
        sfx("sparkle", p, 0.35, world.night > 0.5 ? 0.7 : 1.1);
        break;
      default:
        break;
    }
  };

  const throwSeedBomb = (p: Vector3) => {
    const s = st.current;
    if (world.elapsed - s.lastBomb < 0.28) return;
    s.lastBomb = world.elapsed;
    camera.getWorldDirection(camFwd);
    camRight.crossVectors(camFwd, UP).normalize();
    const start = tmp2.copy(camera.position).addScaledVector(camFwd, 2.2).addScaledVector(camRight, 0.5);
    start.y = Math.max(start.y - 0.9, height(start.x, start.z) + 0.6, 0.6);
    const dist = Math.hypot(p.x - start.x, p.z - start.z);
    const T = clamp(dist / 14, 0.5, 1.5);
    const v = new Vector3((p.x - start.x) / T, (p.y - start.y) / T + 0.5 * 12 * T, (p.z - start.z) / T);
    emit("spawnProp", { kind: "seedball", pos: start.clone(), vel: v, spin: true });
    sfx("whoosh", start, 0.55, 0.9 + Math.random() * 0.2);
  };

  const blowConch = (p: Vector3, surf: Surface) => {
    const s = st.current;
    if (world.elapsed - s.lastConch < 1.6) return;
    s.lastConch = world.elapsed;
    const sea = surf === "sea";
    const at = p.clone().setY(surfaceY(p, surf) + 0.04);
    sfx("conch", at, 1, 0.94 + Math.random() * 0.1);
    for (let i = 0; i < 3; i++) rings.current.push({ pos: at.clone(), t: -i * 0.3, sea: sea || surf === "pond" });
    if (rings.current.length > RING_POOL) rings.current.splice(0, rings.current.length - RING_POOL);
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (surf === "pond") addPondRipple(at.x, at.z, 0.35);
        else if (sea) addRipple(at.x, at.z, 0.35);
      }, i * 300);
    }
    answers.current.clear();
    s.answerUntil = world.elapsed + 3.2;
    emit("conch", { pos: at.clone(), sea });
    if (sea && world.night > 0.5) {
      setTimeout(() => {
        emit("whale", {});
        emit("conchAnswer", { who: "whale" });
      }, 1500);
    }
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = st.current;
    const p = toolState.point;
    const surf = toolState.surface;
    const tool = toolState.tool;
    const act = toolState.active && s.down;
    const t = world.elapsed;
    const night = world.night > 0.5;

    // aim ring
    const r = ring.current;
    if (r) {
      r.visible = tool !== "hand" && surf !== "none" && world.pointerOverWorld && !world.mobile;
      if (r.visible) {
        r.position.set(p.x, surfaceY(p, surf) + 0.03, p.z);
        const sc = { pinwheel: 0.7, cloud: 0.5, mirror: 0.55, bubbles: 0.3, seedbomb: 0.28, conch: 0.4, hand: 0.25 }[tool];
        r.scale.setScalar(sc * (act ? 0.85 + Math.sin(t * 12) * 0.05 : 1));
        (r.material as MeshBasicMaterial).opacity = act ? 0.55 : 0.32;
      }
    }

    if (act) {
      markInput();
      s.acc += dt;
      if (tool === "pinwheel") blow(p, dt);
      if (tool === "bubbles") bubbleLoop(p, surf);
      if (tool === "mirror") shine(p, surf, dt);
    }

    // pocket cloud: drifts after the pointer, rains while held
    const showCloud = tool === "cloud" && (act || (!world.mobile && surf !== "none" && world.pointerOverWorld));
    s.cloudShow = clamp(s.cloudShow + (showCloud ? dt * 4 : -dt * 3));
    const raining = tool === "cloud" && act && surf !== "none";
    if (surf !== "none") {
      const target = tmp.set(p.x, surfaceY(p, surf) + 1.75, p.z);
      if (s.cloudPos.y < -10) s.cloudPos.copy(target);
      s.cloudPos.lerp(target, 1 - Math.exp(-dt * 7));
    }
    s.cloudHold = raining ? s.cloudHold + dt : Math.max(0, s.cloudHold - dt * 2);
    s.cloudFlash = Math.max(0, s.cloudFlash - dt * 3);
    if (raining) rain(p, surf, dt);
    const cg = cloud.current;
    if (cg) {
      cg.visible = s.cloudShow > 0.01;
      cg.position.copy(s.cloudPos);
      cg.position.y += Math.sin(t * 1.6) * 0.05;
      const sq = raining ? Math.sin(t * 9) * 0.02 : 0;
      cg.scale.set(s.cloudShow * (1 + sq), s.cloudShow * (1 - sq), s.cloudShow * (1 + sq));
      cg.rotation.y = Math.sin(t * 0.4) * 0.3;
      const temper = clamp(s.cloudHold / CLOUD_TEMPER);
      cloudMat.color.setRGB(1 - temper * 0.42, 1 - temper * 0.36, 1 - temper * 0.28);
      cloudMat.emissiveIntensity = 0.12 + s.cloudFlash * 2.5;
      cloudMat.opacity = Math.min(1, s.cloudShow * 1.2);
    }
    audio.loop("pour", raining && world.w.snow < 0.5 ? 0.07 : 0);

    // sun mirror beam
    s.beam += ((act && tool === "mirror" && surf !== "none" ? 1 : 0) - s.beam) * (1 - Math.exp(-dt * 10));
    const bm = beam.current;
    const gw = glow.current;
    const lt = light.current;
    if (bm && gw && lt) {
      const on = s.beam > 0.01;
      bm.visible = gw.visible = on;
      lt.visible = on;
      if (on) {
        const y = surfaceY(p, surf);
        const src = world.sunDir.y > 0.05 ? world.sunDir : world.moonDir.y > 0.05 ? world.moonDir : tmp2.set(0.3, 1, 0.2);
        // a low sun would lay the shaft flat across the hills; keep it falling from the sky
        const dir = tmp2.set(src.x, Math.max(src.y, 1.4), src.z).normalize();
        bm.position.set(p.x, y, p.z);
        bm.quaternion.setFromUnitVectors(UP, dir);
        bm.scale.set(1, 16, 1);
        gw.position.set(p.x, y + 0.03, p.z);
        const col = night ? MOON_COL : SUN_COL;
        beamMat.uniforms.uColor.value.copy(col);
        beamMat.uniforms.uAmount.value = s.beam * (night ? 0.8 : 1);
        lt.position.set(p.x, y + 0.55, p.z);
        lt.color.copy(col);
        lt.intensity = s.beam * (night ? 1.6 : 2.6);
      }
    }

    // conch rings spreading out
    const rs = rings.current;
    for (let i = rs.length - 1; i >= 0; i--) {
      rs[i].t += dt;
      if (rs[i].t > 1.8) rs.splice(i, 1);
    }
    for (let i = 0; i < RING_POOL; i++) {
      const m = ringMeshes.current[i];
      if (!m) continue;
      const rg = rs[i];
      if (!rg || rg.t < 0) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      const k = rg.t / 1.8;
      m.position.copy(rg.pos);
      if (!rg.sea) m.position.y = height(rg.pos.x, rg.pos.z) + 0.05;
      m.scale.setScalar(0.3 + (1 - Math.pow(1 - k, 2)) * 5.5);
      ringMats[i].opacity = (1 - k) * 0.55;
    }

    // crumbs and loose seeds on the ground
    const cm = crumbMesh.current;
    if (cm) {
      for (let i = landCrumbs.length - 1; i >= 0; i--) if (t - landCrumbs[i].t > 90) landCrumbs.splice(i, 1);
      landCrumbs.forEach((c, i) => {
        dummy.position.copy(c.pos);
        dummy.rotation.set(i, i * 2.3, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        cm.setMatrixAt(i, dummy.matrix);
      });
      cm.count = landCrumbs.length;
      cm.instanceMatrix.needsUpdate = true;
    }
  });

  const rain = (p: Vector3, surf: Surface, dt: number) => {
    const s = st.current;
    const c = s.cloudPos;
    const snow = world.w.snow > 0.5;
    const ground = surfaceY(p, surf);
    const fall = Math.max(0.3, c.y - 0.22 - ground);
    const n = Math.ceil(dt * (snow ? 28 : 85));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * 0.38;
      const vy = snow ? -0.9 : -6.5;
      pools.soft.spawn({
        x: c.x + Math.cos(a) * rr,
        y: c.y - 0.22,
        z: c.z + Math.sin(a) * rr,
        vx: 0,
        vy,
        vz: 0,
        color: snow ? FLAKE : DROP,
        size: snow ? 0.04 : 0.026,
        life: fall / -vy,
        gravity: 0,
        drag: 0,
        alpha: snow ? 0.95 : 0.75,
        wind: snow ? 0.6 : 0,
      });
    }
    if (s.acc > 0.08) {
      s.acc = 0;
      const jx = c.x + (Math.random() - 0.5) * 0.6;
      const jz = c.z + (Math.random() - 0.5) * 0.6;
      if (surf === "land") {
        if (!snow) addWet(jx, jz, 0.55, 0.1);
        emit("watered", { pos: new Vector3(jx, ground, jz), amount: snow ? 0.03 : 0.08 });
        if (!snow && Math.random() < 0.4) spawnSplash(tmp.set(jx, ground, jz), 0.02);
      } else if (surf === "pond") {
        addPondRipple(jx, jz, 0.2);
        emit("watered", { pos: new Vector3(jx, ground, jz), amount: 0.04 });
      } else if (surf === "sea") {
        addRipple(jx, jz, 0.1);
      }
    }
    // a cloud kept raining too long gets cross
    if (s.cloudHold > CLOUD_TEMPER && !snow) {
      s.cloudHold = 0;
      s.cloudFlash = 1;
      emit("lightning", { pos: c.clone().setY(c.y - 0.2), target: p.clone().setY(ground), small: true });
      discover("pocketStorm");
    } else if (s.cloudHold > CLOUD_TEMPER * 0.7 && Math.random() < dt * 1.5) {
      s.cloudFlash = Math.max(s.cloudFlash, 0.4);
      sfx("thunder", c, 0.12);
    }
  };

  const shine = (p: Vector3, surf: Surface, dt: number) => {
    const s = st.current;
    s.beamAcc += dt;
    if (s.beamAcc < 0.12) return;
    s.beamAcc = 0;
    const night = world.night > 0.5;
    const y = surfaceY(p, surf);
    emit("sunbeam", { pos: p.clone().setY(y), night });
    const col = night ? MOON_COL : SUN_COL;
    if (surf === "land") {
      if (!night && wetAt(p.x, p.z) > 0.08) {
        addWet(p.x, p.z, 0.6, -0.07);
        for (let i = 0; i < 3; i++) {
          pools.soft.spawn({
            x: p.x + (Math.random() - 0.5) * 0.6,
            y: y + 0.05,
            z: p.z + (Math.random() - 0.5) * 0.6,
            vx: 0,
            vy: 0.5 + Math.random() * 0.4,
            vz: 0,
            color: STEAM,
            size: 0.12 + Math.random() * 0.08,
            life: 1.2,
            gravity: -0.2,
            drag: 0.8,
            alpha: 0.35,
            wind: 1,
          });
        }
        if (Math.random() < 0.15) sfx("sand", p, 0.25, 1.6);
      }
      spawnSparkle(tmp.set(p.x + (Math.random() - 0.5) * 0.7, y + 0.15, p.z + (Math.random() - 0.5) * 0.7), 1, col, 0.1, 0.5);
    } else {
      for (let i = 0; i < 3; i++) spawnSparkle(tmp.set(p.x + (Math.random() - 0.5) * 1.2, y + 0.04, p.z + (Math.random() - 0.5) * 1.2), 1, col, 0.05, 0.4);
    }
  };

  const bubbleLoop = (p: Vector3, surf: Surface) => {
    const s = st.current;
    const dv = toolState.dragVel;
    const speed = Math.hypot(dv.x, dv.y);
    const rate = 3 + Math.min(14, speed / 70);
    if (s.acc < 1 / rate) return;
    s.acc = 0;
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    camFwd.normalize();
    camRight.set(-camFwd.z, 0, camFwd.x);
    const k = Math.min(1.6, speed / 450);
    const sx = speed > 1 ? dv.x / speed : 0;
    const sy = speed > 1 ? dv.y / speed : 0;
    const vel = new Vector3(
      (camRight.x * sx - camFwd.x * sy) * k + (Math.random() - 0.5) * 0.3,
      0.2 + Math.random() * 0.25,
      (camRight.z * sx - camFwd.z * sy) * k + (Math.random() - 0.5) * 0.3,
    );
    const big = Math.random() < 0.06;
    blowBubble(new Vector3(p.x, surfaceY(p, surf) + 0.45, p.z), vel, big ? 0.2 + Math.random() * 0.08 : undefined);
    if (Math.random() < 0.3) sfx("puff", p, 0.12, 1.6);
  };

  const blow = (p: Vector3, dt: number) => {
    const s = st.current;
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    camFwd.normalize();
    camRight.set(-camFwd.z, 0, camFwd.x);
    const dv = toolState.dragVel;
    const k = 1 / 600;
    const gx = (camRight.x * dv.x - camFwd.x * dv.y) * k;
    const gz = (camRight.z * dv.x - camFwd.z * dv.y) * k;
    toolState.dragVel.x *= Math.exp(-dt * 5);
    toolState.dragVel.y *= Math.exp(-dt * 5);
    world.breeze.x += gx * dt * 6;
    world.breeze.y += gz * dt * 6;
    const bl = world.breeze.length();
    if (bl > 3.2) world.breeze.multiplyScalar(3.2 / bl);
    const strength = Math.hypot(gx, gz);
    if (strength < 0.05) return;
    const dir = tmp.set(gx, 0, gz).normalize();
    // leaves and petals swept along
    if (Math.random() < dt * 40 * Math.min(1, strength)) {
      const c = LEAF_COLS[Math.floor(Math.random() * LEAF_COLS.length)];
      pools.soft.spawn({
        x: p.x + (Math.random() - 0.5) * 0.8,
        y: Math.max(p.y, 0) + 0.15 + Math.random() * 0.4,
        z: p.z + (Math.random() - 0.5) * 0.8,
        vx: dir.x * (2 + strength * 3),
        vy: 0.6 + Math.random() * 0.6,
        vz: dir.z * (2 + strength * 3),
        color: c,
        size: 0.05 + Math.random() * 0.04,
        life: 1.4 + Math.random(),
        gravity: 0.6,
        drag: 0.8,
        wind: 1.5,
      });
    }
    if (world.elapsed - s.gustSfx > 0.18) {
      s.gustSfx = world.elapsed;
      const pos = p.clone();
      emit("gust", { pos, dir: dir.clone(), strength: Math.min(2, strength) });
      emit("disturb", { pos, radius: 1.5 + strength });
      if (toolState.surface === "sea") addRipple(p.x + dir.x * 0.6, p.z + dir.z * 0.6, Math.min(0.4, strength * 0.2));
      // canopies in the path rustle
      for (const c of colliders) {
        if (c.surface !== "leaf") continue;
        if (Math.hypot(c.x - p.x, c.z - p.z) < c.r + 1.2 && strength > 0.6) c.onHit?.(pos, strength * 3);
      }
      if (strength > 0.9 && Math.random() < 0.3) sfx("gust", p, Math.min(1, strength * 0.5));
    }
  };

  return (
    <group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} raycast={() => null} renderOrder={8} visible={false}>
        <ringGeometry args={[0.82, 1, 40]} />
        <meshBasicMaterial color="#fff6dc" transparent opacity={0.35} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <group ref={cloud} visible={false}>
        <mesh geometry={cloudGeo} material={cloudMat} castShadow raycast={() => null} />
      </group>
      <mesh ref={beam} geometry={beamGeo} material={beamMat} visible={false} raycast={() => null} renderOrder={7} frustumCulled={false} />
      <mesh ref={glow} geometry={glowGeo} material={glowMat} visible={false} raycast={() => null} renderOrder={7} />
      <pointLight ref={light} visible={false} distance={3.5} decay={2} intensity={0} />
      {ringMats.map((m, i) => (
        <mesh
          key={i}
          ref={(o) => {
            ringMeshes.current[i] = o;
          }}
          geometry={ringGeo}
          material={m}
          visible={false}
          raycast={() => null}
          renderOrder={8}
        />
      ))}
      <instancedMesh ref={crumbMesh} args={[undefined, crumbMat, MAX_CRUMBS]} frustumCulled={false} raycast={() => null}>
        <boxGeometry args={[0.035, 0.02, 0.03]} />
      </instancedMesh>
    </group>
  );
}
