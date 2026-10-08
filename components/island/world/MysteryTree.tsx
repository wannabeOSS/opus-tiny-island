"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { blob, merge, place, prep, trunk } from "../lib/geo";
import { LIGHTHOUSE } from "../lib/layout";
import { clamp, smoothstep } from "../lib/math";
import { discover } from "../lib/secrets";
import { groundMin } from "../lib/terrain";
import { emit, markInput, on, sfx, world } from "../lib/world";
import { hoverable } from "./cursor";
import { spawnPetals, spawnSparkle } from "./effects/Particles";

const NOTES = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
const ORB_COLS = ["#ffb347", "#ff8a7a", "#6fc3ff", "#a78bff", "#6fe09a"];
const MINT = new Color("#b8f5d8");

type Branch = { base: Vector3; dir: Vector3; len: number; tip: Vector3 };

function buildTree() {
  const dark = new Color("#5d4b6e");
  const light = new Color("#9a86ad");
  const t = trunk({ h: 2, r0: 0.12, r1: 0.045, bend: [0.1, -0.06], dark, light, seed: 4, segs: 10 });
  const branches: Branch[] = [];
  const spec = [
    { y: 1.25, a: 0.3, tilt: 0.95, len: 0.75 },
    { y: 1.5, a: 2.4, tilt: 0.85, len: 0.7 },
    { y: 1.75, a: 4.4, tilt: 0.9, len: 0.65 },
  ];
  const parts: BufferGeometry[] = [t];
  const up = new Vector3(0, 1, 0);
  const m = new Matrix4();
  const q = new Quaternion();
  for (const s of spec) {
    const k = s.y / 2;
    const base = new Vector3(0.1 * k * k * 2, s.y, -0.06 * k * k * 2);
    const dir = new Vector3(Math.sin(s.tilt) * Math.cos(s.a), Math.cos(s.tilt), Math.sin(s.tilt) * Math.sin(s.a)).normalize();
    const b = trunk({ h: s.len, r0: 0.045, r1: 0.02, bend: [0, 0.15], dark, light, seed: s.a, radial: 5, segs: 5 });
    q.setFromUnitVectors(up, dir);
    m.compose(base, q, new Vector3(1, 1, 1));
    b.applyMatrix4(m);
    parts.push(b);
    branches.push({ base, dir, len: s.len, tip: base.clone().addScaledVector(dir, s.len) });
  }
  const top = new Vector3(0.2, 2, -0.12);
  const leaves: BufferGeometry[] = [];
  const tips = [...branches.map((b) => b.tip), top];
  tips.forEach((p, i) => {
    const g = blob({ r: 0.32 + (i === 3 ? 0.08 : 0), detail: 1, lump: 0.3, seed: i * 3 + 1, bottom: new Color("#2f7d73"), top: new Color("#9fe3c4"), squash: 0.75 });
    place(g, [p.x, p.y + 0.1, p.z]);
    leaves.push(g);
  });
  // orb anchors hang under the leaves
  const anchors = [
    branches[0].tip.clone().add(new Vector3(0.08, -0.4, 0.06)),
    branches[1].tip.clone().add(new Vector3(-0.06, -0.42, 0.04)),
    branches[2].tip.clone().add(new Vector3(0.04, -0.38, -0.07)),
    branches[1].base.clone().lerp(branches[1].tip, 0.5).add(new Vector3(0, -0.2, 0)),
    top.clone().add(new Vector3(-0.3, -0.36, 0.22)),
  ];
  return { wood: merge(parts) as BufferGeometry, leaves: merge(leaves) as BufferGeometry, anchors };
}

export function MysteryTree() {
  const [pos, setPos] = useState<Vector3 | null>(null);
  useEffect(() => {
    return on("seedPlanted", ({ pos: p }) => setPos(new Vector3(p.x, groundMin(p.x, p.z, 0.22) - 0.02, p.z)));
  }, []);
  return (
    <>
      {/* a dark stand-in keeps the scene's light count fixed, so planting doesn't recompile every shader */}
      {pos ? <Tree pos={pos} /> : <pointLight intensity={0} distance={5} decay={1.6} />}
      <Moonflower />
    </>
  );
}

function Tree({ pos }: { pos: Vector3 }) {
  const built = useMemo(() => buildTree(), []);
  const woodMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), []);
  const leafMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: new Color("#1e5c52"), emissiveIntensity: 0.15 }), []);
  const seedMat = useMemo(() => new MeshStandardMaterial({ color: "#d9fff0", emissive: new Color("#7ff3c8"), emissiveIntensity: 2 }), []);
  const orbMats = useMemo(() => ORB_COLS.map((c) => new MeshStandardMaterial({ color: c, emissive: new Color(c), emissiveIntensity: 0.4, roughness: 0.3, transparent: true })), []);
  const stringMat = useMemo(() => new MeshStandardMaterial({ color: "#d8cbb0", roughness: 1 }), []);
  const orbGeo = useMemo(() => new SphereGeometry(0.1, 14, 10), []);
  const capGeo = useMemo(() => {
    const c = new ConeGeometry(0.05, 0.05, 8);
    c.translate(0, 0.105, 0);
    return c;
  }, []);
  const tree = useRef<Group>(null);
  const leaves = useRef<Mesh>(null);
  const seed = useRef<Mesh>(null);
  const orbs = useRef<(Group | null)[]>([]);
  const glow = useRef<PointLight>(null);
  const s = useRef({
    g: 0,
    done: world.lanternTreeDone,
    touchT: 0,
    pulse: [0, 0, 0, 0, 0],
    taps: [] as { i: number; t: number }[],
    finale: -1,
    regrow: 1,
    sparkT: 0,
    lastStage: 0,
  });

  useEffect(() => {
    const st = s.current;
    sfx("grow", pos, 0.8, 1);
    spawnSparkle(pos.clone().add(new Vector3(0, 0.1, 0)), 20, MINT, 0.3, 1.2);
    emit("hint", { text: "it likes rain, sunshine and a little company" });
    const offs = [
      on("watered", ({ pos: p }) => {
        if (Math.hypot(p.x - pos.x, p.z - pos.z) < 1.3) st.g = Math.min(1, st.g + 0.0018);
      }),
      on("sunbeam", ({ pos: p, night }) => {
        if (!night && Math.hypot(p.x - pos.x, p.z - pos.z) < 1.4) st.g = Math.min(1, st.g + 0.0022);
      }),
      on("lightning", ({ target }) => {
        if (target && target.distanceTo(pos) < 4) st.g = Math.min(1, st.g + 0.05);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [pos]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const st = s.current;
    const t = world.elapsed;
    // weather and light feed it slowly
    const shower = world.showers.reduce((a, sh) => (Math.hypot(sh.x - pos.x, sh.z - pos.z) < sh.r ? Math.max(a, sh.i) : a), 0);
    const feed =
      0.0006 +
      world.w.rain * 0.006 +
      shower * 0.012 +
      world.daylight * (1 - world.w.cloud * 0.6) * 0.0014 +
      world.night * 0.001;
    st.g = Math.min(1, st.g + feed * dt);
    world.seedGrowth = st.g;
    const stage = Math.floor(st.g * 4);
    if (stage > st.lastStage) {
      st.lastStage = stage;
      sfx("grow", pos, 0.6, 1 + stage * 0.15);
      spawnSparkle(pos.clone().add(new Vector3(0, 0.5 + st.g * 1.5, 0)), 14, MINT, 0.5, 0.8);
    }
    if (st.g >= 1 && !st.done) {
      st.done = true;
      world.lanternTreeDone = true;
      discover("lanternTree");
      spawnSparkle(pos.clone().add(new Vector3(0, 2, 0)), 40, new Color("#ffe7a8"), 1, 1.2);
      sfx("chime", pos, 1, 1);
      emit("hint", { text: "each light sings a note" });
    }
    if (st.done && st.g < 1) st.g = 1;

    const ease = 1 - Math.pow(1 - st.g, 2.2);
    const o = tree.current;
    if (o) {
      o.scale.setScalar(0.03 + ease * 0.97);
      o.rotation.z = Math.sin(t * 1.3) * 0.015 * (0.5 + world.windStrength) + world.breeze.x * 0.02;
      o.rotation.x = Math.cos(t * 1.1) * 0.012 * (0.5 + world.windStrength) + world.breeze.y * 0.02;
    }
    if (leaves.current) leaves.current.scale.setScalar(smoothstep(0.22, 0.55, st.g) + 0.0001);
    if (seed.current) {
      const k = 1 - smoothstep(0.2, 0.45, st.g);
      seed.current.scale.setScalar((0.6 + Math.sin(t * 3) * 0.12) * k + 0.0001);
      seedMat.emissiveIntensity = 1.5 + Math.sin(t * 3) * 0.8;
    }
    st.sparkT -= dt;
    if (st.sparkT < 0) {
      st.sparkT = st.done ? 0.6 : 1.4;
      spawnSparkle(pos.clone().add(new Vector3((Math.random() - 0.5) * 0.6, 0.2 + st.g * 1.8 * Math.random(), (Math.random() - 0.5) * 0.6)), 1, st.done ? new Color("#ffe7a8") : MINT, 0.2, 0.4);
    }

    // finale: lanterns float up and become stars
    if (st.finale >= 0) {
      st.finale += dt;
      if (st.finale > 7) {
        st.finale = -1;
        st.regrow = 0;
      }
    } else st.regrow = Math.min(1, st.regrow + dt / 25);
    if (glow.current) glow.current.intensity = smoothstep(0.88, 1, st.g) * world.night * (st.finale >= 0 ? 0 : 3.5);
    const orbScale = smoothstep(0.6, 0.9, st.g) * (st.finale >= 0 ? 1 : smoothstep(0, 1, st.regrow));
    const lit = smoothstep(0.88, 1, st.g);
    built.anchors.forEach((a, i) => {
      const g = orbs.current[i];
      if (!g) return;
      st.pulse[i] = Math.max(0, st.pulse[i] - dt * 1.6);
      const sway = Math.sin(t * 1.7 + i * 1.3) * 0.04;
      let y = a.y;
      let fade = 1;
      if (st.finale >= 0) {
        const k = clamp((st.finale - i * 0.25) / 6);
        y += k * k * 22;
        fade = 1 - smoothstep(0.7, 1, k);
      }
      g.position.set(a.x + sway * 0.5, y, a.z + sway * 0.3);
      g.rotation.z = sway;
      g.scale.setScalar(orbScale * (1 + st.pulse[i] * 0.35) * (st.finale >= 0 ? 1 + clamp(st.finale / 6) : 1) + 0.0001);
      const m = orbMats[i];
      m.emissiveIntensity = lit * (0.35 + world.night * 0.9 + Math.sin(t * 2 + i) * 0.12) + st.pulse[i] * 1.6;
      m.opacity = fade;
    });
  });

  const touch = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    const st = s.current;
    if (world.elapsed - st.touchT < 0.5) return;
    st.touchT = world.elapsed;
    st.g = Math.min(1, st.g + 0.02);
    sfx("chime", pos, 0.5, 1 + st.g * 0.8);
    emit("seedTouched", {});
    spawnSparkle(e.point.clone(), 8, MINT, 0.25, 0.7);
  };

  const ring = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    const st = s.current;
    if (st.g < 0.9 || st.finale >= 0) return touch(e);
    e.stopPropagation();
    markInput();
    st.pulse[i] = 1;
    const p = e.point.clone();
    sfx("note", p, 0.9, NOTES[i]);
    spawnSparkle(p, 6, new Color(ORB_COLS[i]), 0.15, 0.6);
    st.taps.push({ i, t: world.elapsed });
    if (st.taps.length > 5) st.taps.shift();
    const seq = st.taps.map((x) => x.i).join("");
    if (seq === "01234" && world.elapsed - st.taps[0].t < 10) {
      st.taps.length = 0;
      st.finale = 0;
      sfx("secret", pos, 0.8, 1.2);
      for (let k = 0; k < 6; k++) setTimeout(() => emit("shootingStar", {}), 1800 + k * 700);
    }
  };

  return (
    <group position={pos}>
      <pointLight ref={glow} position={[0, 1.2, 0]} color="#ffc98a" intensity={0} distance={5} decay={1.6} />
      <mesh ref={seed} material={seedMat} position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.07, 12, 10]} />
      </mesh>
      <group ref={tree} onClick={touch} {...hoverable()}>
        <mesh geometry={built.wood} material={woodMat} castShadow />
        <mesh ref={leaves} geometry={built.leaves} material={leafMat} castShadow />
      </group>
      {built.anchors.map((a, i) => (
        <group key={i} ref={(g) => { orbs.current[i] = g; }} position={a} onClick={ring(i)} {...hoverable()}>
          <mesh material={stringMat} position={[0, 0.27, 0]}>
            <cylinderGeometry args={[0.005, 0.005, 0.4, 3]} />
          </mesh>
          <mesh geometry={capGeo} material={stringMat} />
          <mesh geometry={orbGeo} material={orbMats[i]} />
        </group>
      ))}
    </group>
  );
}

/* ---------------- moonflower ---------------- */

const MOON_SPOT = (() => {
  const x = LIGHTHOUSE.x - 1.05;
  const z = LIGHTHOUSE.z + 0.75;
  return new Vector3(x, groundMin(x, z, 0.12) - 0.01, z);
})();

function petalGeo() {
  const p = new SphereGeometry(0.5, 10, 6);
  place(p, [0, 0.5, 0], [0, 0, 0], [0.32, 1, 0.1]);
  return prep(p, (v) => new Color("#f4f1ff").lerp(new Color("#b9c6ff"), clamp(1 - v.y))) as BufferGeometry;
}

export function Moonflower() {
  const petals = useRef<(Group | null)[]>([]);
  const head = useRef<Group>(null);
  const geo = useMemo(() => petalGeo(), []);
  const mat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: new Color("#a9bcff"), emissiveIntensity: 0 }), []);
  const stemMat = useMemo(() => new MeshStandardMaterial({ color: "#5f8f5a", roughness: 0.8 }), []);
  const coreMat = useMemo(() => new MeshStandardMaterial({ color: "#fff7cf", emissive: new Color("#fff1a8"), emissiveIntensity: 0 }), []);
  const s = useRef({ water: 0, open: 0, hinted: false, sparkT: 0 });
  const N = 6;

  useEffect(() => {
    const off = on("watered", ({ pos }) => {
      if (Math.hypot(pos.x - MOON_SPOT.x, pos.z - MOON_SPOT.z) > 0.9) return;
      const st = s.current;
      if (world.night > 0.5) {
        st.water = Math.min(1, st.water + 0.06);
        if (st.water >= 1 && st.open < 0.05) {
          sfx("bell", MOON_SPOT, 0.6, 1.5);
          spawnPetals(MOON_SPOT.clone().add(new Vector3(0, 0.3, 0)), new Color("#dfe6ff"), 6);
        }
      } else if (!st.hinted) {
        st.hinted = true;
        emit("hint", { text: "the pale bud stays shut by day" });
      }
    });
    return off;
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const st = s.current;
    const t = world.elapsed;
    const want = st.water >= 1 && world.night > 0.4 ? 1 : 0;
    st.open += (want - st.open) * Math.min(1, dt * (want ? 0.8 : 0.3));
    if (world.daylight > 0.6) st.water = Math.max(0, st.water - dt * 0.02);
    if (st.open > 0.9) discover("moonflower");
    petals.current.forEach((p, i) => {
      if (!p) return;
      p.rotation.set(0.15 + st.open * 1.15 + Math.sin(t * 1.5 + i) * 0.03 * st.open, (i / N) * Math.PI * 2, 0, "YXZ");
    });
    mat.emissiveIntensity = st.open * (0.6 + Math.sin(t * 1.2) * 0.15);
    coreMat.emissiveIntensity = st.open * 1.8;
    if (head.current) head.current.rotation.z = Math.sin(t * 1.1) * 0.05 * (0.5 + world.windStrength);
    st.sparkT -= dt;
    if (st.open > 0.6 && st.sparkT < 0) {
      st.sparkT = 0.5;
      spawnSparkle(MOON_SPOT.clone().add(new Vector3(0, 0.35, 0)), 2, new Color("#cdd8ff"), 0.25, 0.5);
    }
  });

  return (
    <group
      position={MOON_SPOT}
      onClick={(e) => {
        if (e.delta > 6) return;
        e.stopPropagation();
        markInput();
        const st = s.current;
        sfx("rustle", MOON_SPOT, 0.4, 1.4);
        spawnSparkle(MOON_SPOT.clone().add(new Vector3(0, 0.3, 0)), 4, new Color("#dfe6ff"), 0.15, 0.4);
        if (!st.hinted && world.night < 0.5) {
          st.hinted = true;
          emit("hint", { text: "a pale bud, waiting for something" });
        }
      }}
      {...hoverable()}
    >
      <mesh material={stemMat} position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.012, 0.018, 0.28, 5]} />
      </mesh>
      <group ref={head} position={[0, 0.28, 0]}>
        <mesh material={coreMat} position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.03, 8, 6]} />
        </mesh>
        {Array.from({ length: N }, (_, i) => (
          <group key={i} ref={(g) => { petals.current[i] = g; }}>
            <mesh geometry={geo} material={mat} scale={0.13} position={[0, 0, 0.012]} />
          </group>
        ))}
      </group>
      {/* a couple of leaves */}
      <mesh material={stemMat} position={[0.06, 0.05, 0]} rotation={[0, 0, -1.1]} scale={[0.09, 0.025, 0.04]}>
        <sphereGeometry args={[1, 6, 4]} />
      </mesh>
      <mesh material={stemMat} position={[-0.05, 0.07, 0.02]} rotation={[0.3, 0, 1.0]} scale={[0.08, 0.022, 0.035]}>
        <sphereGeometry args={[1, 6, 4]} />
      </mesh>
    </group>
  );
}
