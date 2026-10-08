"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  Vector2,
  Vector3,
  type Intersection,
} from "three";
import { audio } from "../lib/audio";
import { colliders } from "../lib/colliders";
import { clamp } from "../lib/math";
import { height, inPond, normalAt, POND_LEVEL } from "../lib/terrain";
import { groundTargets, landCrumbs, setTool, subscribeTool, toolState, type Surface } from "../lib/tools";
import { addWet } from "../lib/wetmap";
import { addPondRipple, addRipple, emit, markInput, sfx, world } from "../lib/world";
import { setCursor } from "../world/cursor";
import { pools, spawnDust, spawnSparkle, spawnSplash } from "../world/effects/Particles";

const ray = new Raycaster();
const ndc = new Vector2();
const hits: Intersection[] = [];
const camFwd = new Vector3();
const camRight = new Vector3();
const tmp = new Vector3();
const tmp2 = new Vector3();

const DROP = new Color("#cfe9f2");
const CRUMB = new Color("#e2bf85");
const LEAF_COLS = ["#9cc56a", "#c9d77a", "#e9b85b", "#f3d2df"].map((c) => new Color(c));
const SEED = new Color("#8a6a3e");
const LANTERN_GLOW = new Color("#ffb85c");

type SkyLantern = { pos: Vector3; vel: Vector3; t: number; phase: number };
const MAX_SKY = 10;
const MAX_CRUMBS = 80;

export function Tools() {
  const { camera, gl, setEvents } = useThree();
  const ring = useRef<Mesh>(null);
  const st = useRef({
    down: false,
    downXY: new Vector2(),
    lastXY: new Vector2(),
    lastT: 0,
    acc: 0,
    lastPlant: new Vector3(1e9, 0, 0),
    gustSfx: 0,
    hintedLook: false,
  });
  const sky = useRef<SkyLantern[]>([]);
  const skyMesh = useRef<InstancedMesh>(null);
  const crumbMesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const lanternGeo = useMemo(() => {
    const g = new CylinderGeometry(0.11, 0.08, 0.22, 8, 1, true);
    return g;
  }, []);
  const lanternMat = useMemo(
    () => new MeshBasicMaterial({ color: new Color("#ffb85c").multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.95, side: 2 }),
    [],
  );
  const crumbMat = useMemo(() => new MeshStandardMaterial({ color: "#d9b478", roughness: 1 }), []);

  // pick what's under the pointer
  const pick = (clientX: number, clientY: number): Surface => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
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
      s.downXY.set(e.clientX, e.clientY);
      s.lastXY.set(e.clientX, e.clientY);
      s.lastT = performance.now();
      s.acc = 1; // fire immediately
      s.lastPlant.set(1e9, 0, 0);
      const surf = pick(e.clientX, e.clientY);
      toolState.active = surf !== "none" || toolState.tool === "breeze";
      toolState.dragVel.x = toolState.dragVel.y = 0;
      if (toolState.active) tap(surf);
    };
    const move = (e: PointerEvent) => {
      if (toolState.tool === "hand") return;
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
      case "pebble":
        throwPebble(p, surf);
        break;
      case "float":
        launchFloat(p, surf);
        break;
      case "seeds":
        sow(p, surf);
        break;
      case "breeze":
        sfx("gust", p, 0.4);
        break;
      default:
        break;
    }
  };

  const throwPebble = (p: Vector3, surf: Surface) => {
    camera.getWorldDirection(camFwd);
    camRight.crossVectors(camFwd, tmp.set(0, 1, 0)).normalize();
    const start = tmp2.copy(camera.position).addScaledVector(camFwd, 2.2).addScaledVector(camRight, 0.5);
    start.y -= 0.9;
    const dist = Math.hypot(p.x - start.x, p.z - start.z);
    // sea throws go low and fast so they can skim; land throws arc softly
    const flat = surf === "sea" && height(p.x, p.z) < -0.25;
    const T = flat ? clamp(dist / 26, 0.35, 1.3) : clamp(dist / 15, 0.45, 1.6);
    const v = new Vector3((p.x - start.x) / T, (p.y - start.y) / T + 0.5 * 13 * T, (p.z - start.z) / T);
    if (flat) v.multiplyScalar(1.05);
    emit("spawnProp", { kind: "pebble", pos: start.clone(), vel: v, spin: true });
    sfx("whoosh", start, 0.6, 1.1 + Math.random() * 0.2);
  };

  const launchFloat = (p: Vector3, surf: Surface) => {
    const night = world.night > 0.45;
    if (surf === "sea" || surf === "pond") {
      emit("spawnProp", { kind: night ? "lantern" : "paperboat", pos: p.clone().setY(Math.max(p.y, 0) + 0.25), vel: new Vector3(0, -0.6, 0) });
      sfx("plop", p, 0.35, 1.4);
    } else if (surf === "land") {
      if (night) {
        if (sky.current.length >= MAX_SKY) sky.current.shift();
        sky.current.push({ pos: p.clone().setY(p.y + 0.15), vel: new Vector3(0, 0.25, 0), t: 0, phase: Math.random() * 6 });
        sfx("chime", p, 0.35, 0.8);
        spawnSparkle(p, 6, new Color("#ffcf7a"), 0.2, 0.4);
      } else {
        emit("spawnProp", { kind: "paperboat", pos: p.clone().setY(p.y + 0.4), vel: new Vector3(0, 0.6, 0) });
        sfx("pick", p, 0.4);
      }
    }
  };

  const sow = (p: Vector3, surf: Surface) => {
    st.current.lastPlant.copy(p);
    for (let i = 0; i < 5; i++) {
      pools.soft.spawn({
        x: p.x + (Math.random() - 0.5) * 0.1,
        y: p.y + 0.5,
        z: p.z + (Math.random() - 0.5) * 0.1,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -0.5,
        vz: (Math.random() - 0.5) * 0.6,
        color: SEED,
        size: 0.035,
        life: 0.4,
        gravity: 9,
        drag: 0.5,
      });
    }
    sfx("seeds", p, 0.6);
    if (surf === "land") {
      const n = normalAt(p.x, p.z);
      if (p.y > 0.5 && n.y > 0.8 && !inPond(p.x, p.z)) {
        setTimeout(() => emit("plantSprout", { pos: p.clone() }), 260);
      } else {
        spawnDust(p, new Color("#e6d2a0"), 0.4);
      }
    } else if (surf === "sea" || surf === "pond") {
      setTimeout(() => {
        emit("crumbs", { pos: p.clone(), water: true });
        if (surf === "pond") addPondRipple(p.x, p.z, 0.3);
        else addRipple(p.x, p.z, 0.2);
      }, 300);
    }
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = st.current;
    const p = toolState.point;
    const surf = toolState.surface;
    const tool = toolState.tool;
    const act = toolState.active && s.down;

    // aim ring
    const r = ring.current;
    if (r) {
      r.visible = tool !== "hand" && surf !== "none" && world.pointerOverWorld && !world.mobile;
      if (r.visible) {
        const y = surf === "land" ? height(p.x, p.z) + 0.03 : surf === "pond" ? POND_LEVEL + 0.02 : Math.max(p.y, 0) + 0.06;
        r.position.set(p.x, y, p.z);
        const sc = tool === "water" ? 0.45 : tool === "breeze" ? 0.7 : tool === "crumbs" ? 0.4 : 0.25;
        r.scale.setScalar(sc * (act ? 0.85 + Math.sin(world.elapsed * 12) * 0.05 : 1));
        (r.material as MeshBasicMaterial).opacity = act ? 0.55 : 0.32;
      }
    }

    audio.loop("pour", act && tool === "water" ? 0.1 : 0);

    if (act) {
      markInput();
      s.acc += dt;
      if (tool === "water") pour(p, surf, dt);
      if (tool === "crumbs" && s.acc > 0.12) {
        s.acc = 0;
        sprinkle(p, surf);
      }
      if (tool === "seeds" && surf === "land" && p.distanceTo(s.lastPlant) > 0.45) sow(p, surf);
      if (tool === "breeze") blow(p, dt);
    }

    // sky lanterns drift up and away
    const lanterns = sky.current;
    for (let i = lanterns.length - 1; i >= 0; i--) {
      const l = lanterns[i];
      l.t += dt;
      l.vel.y = Math.min(0.9, l.vel.y + dt * 0.12);
      l.pos.x += (world.wind.x * 0.5 + Math.sin(l.t * 0.7 + l.phase) * 0.15) * dt;
      l.pos.z += (world.wind.y * 0.5 + Math.cos(l.t * 0.6 + l.phase) * 0.15) * dt;
      l.pos.y += l.vel.y * dt;
      if (l.t > 60) lanterns.splice(i, 1);
      else if (Math.random() < dt * 2) {
        pools.glow.spawn({ x: l.pos.x, y: l.pos.y - 0.05, z: l.pos.z, color: LANTERN_GLOW, size: 0.5, life: 0.5, gravity: 0, drag: 1, alpha: 0.25 });
      }
    }
    const sm = skyMesh.current;
    if (sm) {
      lanterns.forEach((l, i) => {
        dummy.position.copy(l.pos);
        const flick = 1 + Math.sin(l.t * 9 + l.phase) * 0.03;
        dummy.scale.set(flick, flick, flick);
        dummy.rotation.set(Math.sin(l.t + l.phase) * 0.08, l.t * 0.2, 0);
        dummy.updateMatrix();
        sm.setMatrixAt(i, dummy.matrix);
      });
      sm.count = lanterns.length;
      sm.instanceMatrix.needsUpdate = true;
      lanternMat.opacity = 0.95 * clamp(world.night * 1.4);
    }

    // crumbs on the ground
    const cm = crumbMesh.current;
    if (cm) {
      for (let i = landCrumbs.length - 1; i >= 0; i--) if (world.elapsed - landCrumbs[i].t > 90) landCrumbs.splice(i, 1);
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

  const pour = (p: Vector3, surf: Surface, dt: number) => {
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    camFwd.normalize();
    camRight.set(-camFwd.z, 0, camFwd.x);
    // the can hovers above and a little in front of the aim point
    const sx = p.x - camFwd.x * 0.5 - camRight.x * 0.55;
    const sz = p.z - camFwd.z * 0.5 - camRight.z * 0.55;
    const sy = p.y + 1.25;
    const T = 0.42;
    const n = Math.ceil(dt * 90);
    for (let i = 0; i < n; i++) {
      const tx = p.x + (Math.random() - 0.5) * 0.35;
      const tz = p.z + (Math.random() - 0.5) * 0.35;
      pools.soft.spawn({
        x: sx,
        y: sy,
        z: sz,
        vx: (tx - sx) / T,
        vy: (p.y - sy) / T + 0.5 * 9 * T,
        vz: (tz - sz) / T,
        color: DROP,
        size: 0.04 + Math.random() * 0.03,
        life: T,
        gravity: 9,
        drag: 0,
        alpha: 0.85,
      });
    }
    if (st.current.acc > 0.08) {
      st.current.acc = 0;
      const jx = p.x + (Math.random() - 0.5) * 0.3;
      const jz = p.z + (Math.random() - 0.5) * 0.3;
      if (surf === "land") {
        addWet(jx, jz, 0.5, 0.12);
        emit("watered", { pos: new Vector3(jx, p.y, jz), amount: 0.08 });
        if (Math.random() < 0.5) spawnSplash(tmp.set(jx, p.y, jz), 0.02);
      } else if (surf === "pond") {
        addPondRipple(jx, jz, 0.25);
        emit("watered", { pos: new Vector3(jx, p.y, jz), amount: 0.04 });
      } else if (surf === "sea") {
        addRipple(jx, jz, 0.12);
      }
    }
  };

  const sprinkle = (p: Vector3, surf: Surface) => {
    for (let i = 0; i < 4; i++) {
      pools.soft.spawn({
        x: p.x + (Math.random() - 0.5) * 0.3,
        y: p.y + 0.9,
        z: p.z + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -0.3,
        vz: (Math.random() - 0.5) * 0.4,
        color: CRUMB,
        size: 0.04,
        life: 0.42,
        gravity: 9,
        drag: 0.3,
        wind: 0.5,
      });
    }
    if (Math.random() < 0.5) sfx("seeds", p, 0.35, 0.7);
    const at = p.clone();
    setTimeout(() => {
      if (surf === "land") {
        if (landCrumbs.length >= MAX_CRUMBS) landCrumbs.shift();
        const x = at.x + (Math.random() - 0.5) * 0.25;
        const z = at.z + (Math.random() - 0.5) * 0.25;
        landCrumbs.push({ pos: new Vector3(x, height(x, z) + 0.012, z), t: world.elapsed });
        emit("crumbs", { pos: at, water: false });
      } else if (surf === "sea" || surf === "pond") {
        if (surf === "pond") addPondRipple(at.x, at.z, 0.15);
        else addRipple(at.x, at.z, 0.12);
        emit("crumbs", { pos: at, water: true });
      }
    }, 380);
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
      <instancedMesh ref={skyMesh} args={[lanternGeo, lanternMat, MAX_SKY]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={crumbMesh} args={[undefined, crumbMat, MAX_CRUMBS]} frustumCulled={false} raycast={() => null}>
        <boxGeometry args={[0.035, 0.02, 0.03]} />
      </instancedMesh>
    </group>
  );
}