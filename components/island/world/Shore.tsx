"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { addCollider } from "../lib/colliders";
import { BUOY, LAUNDRY } from "../lib/layout";
import { angleDelta, damp, mulberry32 } from "../lib/math";
import { patchMaterial } from "../lib/patch";
import { DOCK, height, islandD } from "../lib/terrain";
import { addRipple, emit, markInput, sfx, waveHeight, world } from "../lib/world";
import { hoverable } from "./cursor";
import { spawnSparkle, spawnSplash, pools } from "./effects/Particles";

const wood = patchMaterial(new MeshStandardMaterial({ color: "#ffffff", vertexColors: false, roughness: 0.9 }), { wet: true, snow: 0.8 });
const woodDark = patchMaterial(new MeshStandardMaterial({ color: "#6b4c35", roughness: 0.95 }), { wet: true });
const rope = new MeshStandardMaterial({ color: "#d8c49a", roughness: 1 });

/* ================= dock ================= */
export function Dock() {
  const planks = useRef<InstancedMesh>(null);
  const lantern = useRef<MeshStandardMaterial>(null);
  const n = Math.floor(DOCK.length / 0.21);
  const posts = useMemo(() => {
    const out: { s: number; side: number; tall: boolean }[] = [];
    for (let s = 0.4; s < DOCK.length; s += 1.25) {
      out.push({ s, side: -1, tall: false }, { s, side: 1, tall: false });
    }
    out.push({ s: DOCK.length - 0.08, side: -1, tall: true }, { s: DOCK.length - 0.08, side: 1, tall: true });
    return out;
  }, []);

  useEffect(() => {
    const m = planks.current;
    if (!m) return;
    const rnd = mulberry32(12);
    const d = new Object3D();
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const s = 0.1 + i * 0.21;
      d.position.set((rnd() - 0.5) * 0.04, DOCK.deck + (rnd() - 0.5) * 0.015, s);
      d.rotation.set((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.04);
      const short = rnd() < 0.08;
      d.scale.set(short ? 0.7 : 1, 1, 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      c.set(["#a37a52", "#8f6a47", "#b48a5f", "#9a7350"][Math.floor(rnd() * 4)]);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();

    const perches = posts
      .filter((p) => p.tall)
      .map((p, i) => ({ id: `dock-${i}`, pos: toWorld(p.side * 0.47, DOCK.deck + 0.42, p.s), taken: false }));
    world.perches.push(...perches);
    return () => {
      world.perches = world.perches.filter((p) => !perches.includes(p));
    };
  }, [n, posts]);

  useFrame(() => {
    if (lantern.current) lantern.current.emissiveIntensity = world.cabin.lights * 2.6;
  });

  return (
    <group position={[DOCK.start.x, 0, DOCK.start.z]} rotation-y={DOCK.rot}>
      <instancedMesh ref={planks} args={[undefined, wood, n]} castShadow receiveShadow>
        <boxGeometry args={[0.92, 0.05, 0.18]} />
      </instancedMesh>
      {/* stringers */}
      {[-0.36, 0.36].map((x) => (
        <mesh key={x} position={[x, DOCK.deck - 0.07, DOCK.length / 2]} material={woodDark} castShadow>
          <boxGeometry args={[0.07, 0.08, DOCK.length]} />
        </mesh>
      ))}
      {posts.map((p, i) => {
        const top = DOCK.deck + (p.tall ? 0.38 : 0.06);
        const bottom = -1.6;
        return (
          <mesh key={i} position={[p.side * 0.47, (top + bottom) / 2, p.s]} material={woodDark} castShadow>
            <cylinderGeometry args={[0.055, 0.065, top - bottom, 7]} />
          </mesh>
        );
      })}
      {/* lantern post at the end */}
      <group position={[0.47, DOCK.deck, DOCK.length - 0.08]}>
        <mesh position={[0, 0.55, 0]} material={woodDark}>
          <cylinderGeometry args={[0.025, 0.03, 0.5, 5]} />
        </mesh>
        <mesh position={[-0.08, 0.8, 0]} rotation-z={Math.PI / 2} material={woodDark}>
          <cylinderGeometry args={[0.015, 0.015, 0.18, 4]} />
        </mesh>
        <mesh position={[-0.16, 0.72, 0]}>
          <boxGeometry args={[0.07, 0.1, 0.07]} />
          <meshStandardMaterial ref={lantern} color="#fff1c4" emissive="#ffb54d" emissiveIntensity={0} />
        </mesh>
      </group>
      {/* rope coil + bucket */}
      <mesh position={[-0.25, DOCK.deck + 0.05, DOCK.length * 0.62]} rotation-x={Math.PI / 2} material={rope} castShadow>
        <torusGeometry args={[0.1, 0.03, 6, 16]} />
      </mesh>
      <mesh position={[0.22, DOCK.deck + 0.1, DOCK.length * 0.35]} castShadow>
        <cylinderGeometry args={[0.09, 0.075, 0.16, 12]} />
        <meshStandardMaterial color="#5f8fa0" roughness={0.6} metalness={0.3} />
      </mesh>
    </group>
  );
}

export function toWorld(lx: number, y: number, s: number) {
  const rx = Math.cos(DOCK.rot);
  const rz = -Math.sin(DOCK.rot);
  return new Vector3(DOCK.start.x + DOCK.dir.x * s + rx * lx, y, DOCK.start.z + DOCK.dir.z * s + rz * lx);
}

/** Is (x, z) on the dock deck? Returns deck height or null. */
export function dockHeightAt(x: number, z: number) {
  const dx = x - DOCK.start.x;
  const dz = z - DOCK.start.z;
  const s = dx * DOCK.dir.x + dz * DOCK.dir.z;
  const lx = dx * Math.cos(DOCK.rot) - dz * Math.sin(DOCK.rot);
  if (s > 0 && s < DOCK.length && Math.abs(lx) < 0.48) return DOCK.deck + 0.025;
  return null;
}

/* ================= boat ================= */
function hullGeo() {
  const g = new SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const pos = g.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    x *= 0.62;
    z *= 0.25;
    y *= 0.2;
    if (x > 0) z *= 1 - (x / 0.62) * 0.75;
    if (x > 0.3) y += (x - 0.3) * 0.12;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function sailGeo() {
  const g = new BufferGeometry();
  const segs = 6;
  const v: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // luff from mast (x=0) at height t, foot along boom
    v.push(0, 0.08 + t * 0.85, 0);
    v.push(0.5 * (1 - t), 0.08 + t * 0.06, 0);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setAttribute("position", new BufferAttribute(new Float32Array(v), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const DOCKED = toWorld(1.0, 0, DOCK.length - 0.7);
const SAIL_R = (a: number) => {
  // a loop that stays in water around the island
  let r = 14;
  for (let k = 0; k < 20; k++) {
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (islandD(x, z) > 1.22 && height(x, z) < -0.8) break;
    r += 0.5;
  }
  return r;
};

export function Boat() {
  const group = useRef<Group>(null);
  const sail = useRef<Mesh>(null);
  const flag = useRef<Mesh>(null);
  const sailBase = useMemo(() => sailGeo(), []);
  const hull = useMemo(() => hullGeo(), []);
  const st = useRef({
    mode: "docked" as "docked" | "leaving" | "loop" | "return",
    pos: DOCKED.clone(),
    heading: DOCK.rot + Math.PI / 2,
    a: 0,
    a0: 0,
    speed: 0,
    wakeT: 0,
    roll: 0,
    pitch: 0,
    nudge: 0,
  });

  useEffect(() => {
    const s = st.current;
    s.heading = Math.atan2(DOCK.dir.x, DOCK.dir.z) + Math.PI / 2;
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const s = st.current;
    const t = world.elapsed;
    let targetHeading = s.heading;
    const ws = world.windStrength;

    if (s.mode === "docked") {
      s.pos.lerp(DOCKED, 1 - Math.exp(-dt * 0.8));
      s.speed = 0;
      // swings gently on its rope
      s.pos.x += Math.sin(t * 0.4) * 0.0015 + world.wind.x * 0.002 + s.nudge * 0.01;
      s.pos.z += Math.cos(t * 0.33) * 0.0015 + world.wind.y * 0.002;
      s.nudge *= 0.95;
    } else {
      const ang = Math.atan2(s.pos.z, s.pos.x);
      let goal: Vector3;
      if (s.mode === "leaving") {
        goal = new Vector3(Math.cos(ang) * SAIL_R(ang), 0, Math.sin(ang) * SAIL_R(ang));
        if (s.pos.distanceTo(goal) < 1.2) {
          s.mode = "loop";
          s.a = ang;
          s.a0 = ang;
        }
      } else if (s.mode === "loop") {
        s.a -= dt * (0.09 + ws * 0.05);
        goal = new Vector3(Math.cos(s.a - 0.25) * SAIL_R(s.a - 0.25), 0, Math.sin(s.a - 0.25) * SAIL_R(s.a - 0.25));
        if (s.a0 - s.a > Math.PI * 2 - 0.15) s.mode = "return";
      } else {
        goal = DOCKED.clone();
        if (s.pos.distanceTo(DOCKED) < 0.25) {
          s.mode = "docked";
          world.boat.sailing = false;
          sfx("knock", s.pos, 0.5, 0.7);
        }
      }
      const dx = goal.x - s.pos.x;
      const dz = goal.z - s.pos.z;
      targetHeading = Math.atan2(-dz, dx);
      const want = s.mode === "return" ? Math.min(1.4, 0.5 + s.pos.distanceTo(DOCKED) * 0.4) : 1.5 + ws * 0.8;
      s.speed = damp(s.speed, want, 0.8, dt);
      s.heading += angleDelta(s.heading, targetHeading) * Math.min(1, dt * 1.4);
      s.pos.x += Math.cos(s.heading) * s.speed * dt;
      s.pos.z -= Math.sin(s.heading) * s.speed * dt;

      s.wakeT -= dt;
      if (s.wakeT < 0) {
        s.wakeT = 0.28;
        const sx = s.pos.x - Math.cos(s.heading) * 0.5;
        const sz = s.pos.z + Math.sin(s.heading) * 0.5;
        addRipple(sx, sz, 0.22 * Math.min(1, s.speed));
        for (let i = 0; i < 3; i++) {
          pools.soft.spawn({
            x: sx + (Math.random() - 0.5) * 0.2,
            y: 0.04,
            z: sz + (Math.random() - 0.5) * 0.2,
            vx: (Math.random() - 0.5) * 0.3,
            vy: 0.3,
            vz: (Math.random() - 0.5) * 0.3,
            color: new Color("#eef8fa"),
            size: 0.08,
            life: 0.9,
            gravity: 1,
            drag: 1.5,
            alpha: 0.8,
          });
        }
      }
      if (Math.random() < dt * 0.6) emit("disturb", { pos: s.pos.clone(), radius: 2.5 });
    }

    const depth = Math.max(0, -height(s.pos.x, s.pos.z));
    const fx = s.pos.x + Math.cos(s.heading) * 0.4;
    const fz = s.pos.z - Math.sin(s.heading) * 0.4;
    const bx = s.pos.x - Math.cos(s.heading) * 0.4;
    const bz = s.pos.z + Math.sin(s.heading) * 0.4;
    const hc = waveHeight(s.pos.x, s.pos.z, t, depth);
    const hf = waveHeight(fx, fz, t, depth);
    const hb = waveHeight(bx, bz, t, depth);
    const lx = s.pos.x + Math.sin(s.heading) * 0.25;
    const lz = s.pos.z + Math.cos(s.heading) * 0.25;
    const hl = waveHeight(lx, lz, t, depth);
    const pitch = Math.atan2(hf - hb, 0.8);
    const sideWind = world.wind.x * Math.sin(s.heading) + world.wind.y * Math.cos(s.heading);
    const roll = Math.atan2(hl - hc, 0.25) * 0.6 + sideWind * 0.12 + s.nudge * 0.1;
    s.pitch = damp(s.pitch, pitch, 6, dt);
    s.roll = damp(s.roll, roll, 4, dt);
    world.boat.pos.copy(s.pos);
    world.boat.heading = s.heading;

    const g = group.current;
    if (g) {
      g.position.set(s.pos.x, hc + 0.06, s.pos.z);
      g.rotation.set(0, s.heading, 0);
      g.rotateZ(s.pitch);
      g.rotateX(s.roll);
    }

    // sail billow toward the wind
    const sm = sail.current;
    if (sm) {
      const base = sailBase.attributes.position as BufferAttribute;
      const geo = sm.geometry as BufferGeometry;
      const p = geo.attributes.position as BufferAttribute;
      const billow = 0.05 + ws * 0.14 + s.speed * 0.03;
      for (let i = 0; i < p.count; i++) {
        const x = base.getX(i);
        const y = base.getY(i);
        const u = x / 0.5;
        const vv = (y - 0.08) / 0.85;
        const belly = Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - vv) * billow;
        const flap = Math.sin(t * 9 + y * 6) * 0.01 * ws;
        p.setXYZ(i, x, y, (belly + flap) * (sideWind >= 0 ? 1 : -1));
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
      // boom swings with wind side
      sm.parent!.rotation.y = damp(sm.parent!.rotation.y, Math.PI + (sideWind >= 0 ? -0.35 : 0.35), 2, dt);
    }
    if (flag.current) {
      flag.current.rotation.y = Math.atan2(world.wind.y, -world.wind.x) - s.heading + Math.sin(t * 8) * 0.15;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    const s = st.current;
    if (s.mode === "docked") {
      s.mode = "leaving";
      world.boat.sailing = true;
      sfx("rope", s.pos, 0.7);
      spawnSplash(s.pos.clone().setY(0), 0.2);
      addRipple(s.pos.x, s.pos.z, 0.6);
    } else {
      s.nudge = 1;
      sfx("knock", s.pos, 0.6, 1.2);
      spawnSparkle(s.pos.clone().setY(0.6), 4, new Color("#ffffff"), 0.3);
    }
  };

  return (
    <group ref={group} onClick={onClick} {...hoverable("pointer")}>
      <mesh geometry={hull} castShadow receiveShadow>
        <meshStandardMaterial color="#3f6f8f" roughness={0.6} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.005, 0]} scale={[0.6, 1, 0.24]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1, 20]} />
        <meshStandardMaterial color="#c49a6c" roughness={0.9} />
      </mesh>
      <mesh position={[-0.05, 0.03, 0]}>
        <boxGeometry args={[0.08, 0.03, 0.42]} />
        <meshStandardMaterial color="#e9dcc2" roughness={0.9} />
      </mesh>
      {/* mast */}
      <mesh position={[0.12, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.018, 1.0, 5]} />
        <meshStandardMaterial color="#7b5a3d" roughness={0.9} />
      </mesh>
      <group position={[0.12, 0.02, 0]} rotation-y={Math.PI}>
        <mesh ref={sail} geometry={sailBase.clone()} castShadow>
          <meshStandardMaterial color="#f5ecdc" roughness={0.9} side={DoubleSide} />
        </mesh>
        <mesh position={[0.25, 0.085, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.009, 0.009, 0.52, 4]} />
          <meshStandardMaterial color="#7b5a3d" />
        </mesh>
      </group>
      <group position={[0.12, 1.0, 0]}>
        <mesh ref={flag} position={[0, 0, 0]}>
          <boxGeometry args={[0.001, 0.001, 0.001]} />
          <meshBasicMaterial visible={false} />
          <mesh position={[-0.06, 0, 0]}>
            <planeGeometry args={[0.12, 0.06]} />
            <meshStandardMaterial color="#e2574a" side={DoubleSide} />
          </mesh>
        </mesh>
      </group>
    </group>
  );
}

/* ================= laundry line ================= */
export function Laundry() {
  const { a, b } = LAUNDRY;
  const ya = height(a.x, a.z);
  const yb = height(b.x, b.z);
  const H = 0.95;
  const data = useMemo(() => {
    const pa = new Vector3(a.x, ya + H, a.z);
    const pb = new Vector3(b.x, yb + H, b.z);
    const mid = pa.clone().lerp(pb, 0.5).add(new Vector3(0, -0.12, 0));
    const curve = new CatmullRomCurve3([pa, mid, pb]);
    const tube = new TubeGeometry(curve, 16, 0.006, 4, false);
    const angle = Math.atan2(-(pb.z - pa.z), pb.x - pa.x);
    const cloths = [
      { t: 0.22, w: 0.22, h: 0.3, color: "#f4d27a" },
      { t: 0.5, w: 0.3, h: 0.22, color: "#9cc3d9" },
      { t: 0.76, w: 0.18, h: 0.26, color: "#f6f1e8" },
    ].map((c) => ({ ...c, pos: curve.getPoint(c.t) }));
    return { tube, angle, cloths };
  }, [a, b, ya, yb]);

  const clothMat = useMemo(
    () =>
      data.cloths.map((c) =>
        patchMaterial(new MeshStandardMaterial({ color: c.color, roughness: 0.9, side: DoubleSide }), { cloth: true, wet: true }),
      ),
    [data],
  );

  const poke = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    world.wind.x += (Math.random() - 0.5) * 2;
    world.wind.y += (Math.random() - 0.5) * 2;
    sfx("flap", e.point, 0.7);
  };

  return (
    <group>
      {[
        [a.x, ya, a.z],
        [b.x, yb, b.z],
      ].map((p, i) => (
        <mesh key={i} position={[p[0], p[1] + H / 2, p[2]]} material={woodDark} castShadow>
          <cylinderGeometry args={[0.03, 0.035, H + 0.1, 6]} />
        </mesh>
      ))}
      <mesh geometry={data.tube} material={rope} />
      {data.cloths.map((c, i) => (
        <mesh
          key={i}
          position={[c.pos.x, c.pos.y - c.h / 2, c.pos.z]}
          rotation-y={data.angle}
          material={clothMat[i]}
          castShadow
          onClick={poke}
          {...hoverable("pointer")}
        >
          <planeGeometry args={[c.w, c.h, 8, 8]} />
        </mesh>
      ))}
    </group>
  );
}

/* ================= bell buoy ================= */
export function Buoy() {
  const g = useRef<Group>(null);
  const bell = useRef<Group>(null);
  const lamp = useRef<MeshStandardMaterial>(null);
  const swing = useRef({ a: 0, v: 0 });
  const rings = useRef(0);

  const ring = (strength = 1) => {
    swing.current.v += 3 * strength;
    const p = new Vector3(BUOY.x, 1.0, BUOY.z);
    sfx("bell", p, 0.8 * strength);
    spawnSparkle(p, 6, new Color("#ffe6a8"), 0.3, 0.6);
    addRipple(BUOY.x, BUOY.z, 0.4);
    emit("bell", { pos: p });
    rings.current++;
  };

  useEffect(() => addCollider({ id: "buoy", x: BUOY.x, z: BUOY.z, r: 0.42, bottom: -0.5, top: 1.3, surface: "metal", onHit: (_, sp) => ring(Math.min(1.2, sp / 5)) }));

  useFrame((_, dt) => {
    const t = world.elapsed;
    const h = waveHeight(BUOY.x, BUOY.z, t, 5);
    const hx = waveHeight(BUOY.x + 0.4, BUOY.z, t, 5);
    const hz = waveHeight(BUOY.x, BUOY.z + 0.4, t, 5);
    if (g.current) {
      g.current.position.set(BUOY.x, h - 0.12, BUOY.z);
      g.current.rotation.set((hz - h) * 1.8, 0, -(hx - h) * 1.8);
    }
    const s = swing.current;
    s.v += (-30 * s.a - 1.2 * s.v + ((hx - h) * 6 + world.windStrength * 0.3 * Math.sin(t * 2.0))) * Math.min(dt, 1 / 30);
    s.a += s.v * Math.min(dt, 1 / 30);
    if (bell.current) bell.current.rotation.z = s.a * 0.5;
    // natural ring in big waves
    if (Math.abs(s.v) > 2.2 && Math.random() < dt * 2) sfx("bell", new Vector3(BUOY.x, 1, BUOY.z), 0.3);
    if (lamp.current) lamp.current.emissiveIntensity = world.night * (Math.sin(t * 2.2) > 0.6 ? 4 : 0.2);
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    ring(1);
  };

  return (
    <group ref={g} onClick={onClick} {...hoverable("pointer")}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.4, 0.32, 14]} />
        <meshStandardMaterial color="#c64a3d" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.33, 0.33, 0.07, 14]} />
        <meshStandardMaterial color="#f2ece0" roughness={0.6} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const ang = (i / 3) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(ang) * 0.2, 0.62, Math.sin(ang) * 0.2]} rotation={[Math.sin(ang) * 0.25, 0, -Math.cos(ang) * 0.25]}>
            <cylinderGeometry args={[0.018, 0.018, 0.78, 4]} />
            <meshStandardMaterial color="#c64a3d" roughness={0.6} />
          </mesh>
        );
      })}
      <group ref={bell} position={[0, 0.88, 0]}>
        <mesh position={[0, -0.12, 0]}>
          <cylinderGeometry args={[0.06, 0.11, 0.16, 12, 1, true]} />
          <meshStandardMaterial color="#d6a640" roughness={0.3} metalness={0.8} side={DoubleSide} />
        </mesh>
      </group>
      <mesh position={[0, 1.02, 0]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshStandardMaterial ref={lamp} color="#ff9b8a" emissive="#ff3b2a" emissiveIntensity={0} />
      </mesh>
    </group>
  );
}
