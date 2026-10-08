"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  IcosahedronGeometry,
  BufferAttribute,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { addCollider } from "../lib/colliders";
import { merge, place, prep } from "../lib/geo";
import { BOUNCY_MUSHROOM, FLOWER_PATCHES, OLD_TREE, ROUND_TREES, SEA_STACKS, CLIFF } from "../lib/layout";
import { mulberry32, noise2, smoothstep } from "../lib/math";
import { patchMaterial } from "../lib/patch";
import { distToPath, height, islandD } from "../lib/terrain";
import { emit, markInput, on, sfx, world } from "../lib/world";
import { hoverable } from "./cursor";
import { pools, spawnDust, spawnPetals, spawnSparkle } from "./effects/Particles";
import { wetAt } from "../lib/wetmap";

/* ================= flowers ================= */
const FLOWER_COLORS = ["#f7d7e2", "#ffffff", "#f2bf4a", "#a8bdf2", "#ee7f74", "#f3a6c0", "#fff1b8"];
const MAX_FLOWERS = 320;

type Flower = {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  tilt: number;
  grow: number;
  bob: number;
  color: Color;
  /** set while it is still a green bud (0..1 towards blooming) */
  sprout?: number;
};
const BUD = new Color("#86b24e");
const FLUFF = new Color("#fbf6ea");

function flowerGeo() {
  const parts: BufferGeometry[] = [];
  const tints: number[] = [];
  const add = (g: BufferGeometry, hex: string, tint: number) => {
    const p = prep(g, new Color(hex));
    parts.push(p);
    for (let i = 0; i < p.attributes.position.count; i++) tints.push(tint);
  };
  const stem = new CylinderGeometry(0.035, 0.05, 1, 5, 1);
  stem.translate(0, 0.5, 0);
  add(stem, "#5d8a3a", 0);
  const leaf = new SphereGeometry(0.12, 6, 4);
  place(leaf, [0.1, 0.35, 0], [0, 0, -0.7], [1, 0.25, 0.5]);
  add(leaf, "#6f9a42", 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new SphereGeometry(0.2, 7, 5);
    place(p, [Math.cos(a) * 0.19, 1.0, Math.sin(a) * 0.19], [0, -a, 0.12], [1, 0.3, 0.62]);
    add(p, "#ffffff", 1);
  }
  const center = new SphereGeometry(0.11, 8, 6);
  place(center, [0, 1.03, 0], [0, 0, 0], [1, 0.7, 1]);
  add(center, "#e8a93a", 0);
  const g = merge(parts);
  g.setAttribute("aTint", new BufferAttribute(new Float32Array(tints), 1));
  return g;
}

export function Flowers() {
  const mesh = useRef<InstancedMesh>(null);
  const geo = useMemo(() => flowerGeo(), []);
  const mat = useMemo(
    () =>
      patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }), {
        sway: { scale: 2.2, stiff: 1.3, push: 0.45 },
        snow: 0.6,
        tintAttr: true,
      }),
    [],
  );

  const flowers = useMemo<Flower[]>(() => {
    const out: Flower[] = [];
    const rnd = mulberry32(77);
    for (const patch of FLOWER_PATCHES) {
      const palette = [FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)], FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)]];
      for (let i = 0; i < patch.n; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * patch.r;
        const x = patch.x + Math.cos(a) * r;
        const z = patch.z + Math.sin(a) * r;
        const y = height(x, z);
        if (y < 0.45 || distToPath(x, z) < 0.3) continue;
        out.push({
          x,
          y,
          z,
          s: 0.15 + rnd() * 0.13,
          rot: rnd() * 6,
          tilt: (rnd() - 0.5) * 0.3,
          grow: 1,
          bob: 0,
          color: new Color(palette[rnd() < 0.8 ? 0 : 1]),
        });
      }
    }
    return out;
  }, []);

  const dummy = useMemo(() => new Object3D(), []);
  const dirty = useRef(true);
  const lastCount = useRef(0);

  const writeOne = (i: number) => {
    const f = flowers[i];
    const g = f.grow;
    const ease = g >= 1 ? 1 : 1 - Math.pow(1 - g, 3) + Math.sin(g * Math.PI) * 0.25;
    const bob = Math.sin(f.bob * 18) * f.bob * 0.25;
    dummy.position.set(f.x, f.y - 0.01, f.z);
    dummy.rotation.set(f.tilt + bob, f.rot, f.tilt * 0.5);
    const budScale = f.sprout === undefined ? 1 : 0.32 + f.sprout * 0.3;
    dummy.scale.setScalar(Math.max(0.001, f.s * ease * budScale));
    if (f.sprout !== undefined) dummy.scale.x *= 0.7;
    dummy.updateMatrix();
    mesh.current!.setMatrixAt(i, dummy.matrix);
    mesh.current!.setColorAt(i, f.sprout === undefined ? f.color : BUD);
  };

  useEffect(() => {
    const offTap = on("tapGround", ({ pos, grass }) => {
      if (!grass) {
        // sand: a little puff, and sometimes a shell turns up
        spawnDust(pos, new Color("#e6d2a0"), 0.6);
        sfx("sand", pos, 0.6);
        if (islandD(pos.x, pos.z) > 0.72 && Math.random() < 0.28) {
          emit("spawnProp", { kind: Math.random() < 0.2 ? "starfish" : "shell", pos: pos.clone().setY(pos.y + 0.05), vel: new Vector3(0, 2.2, 0) });
        }
        return;
      }
      // grass: a rustle and a puff of seed fluff drifting off on the wind
      sfx("rustle", pos, 0.5);
      for (let i = 0; i < 6; i++) {
        pools.soft.spawn({
          x: pos.x + (Math.random() - 0.5) * 0.3,
          y: pos.y + 0.12,
          z: pos.z + (Math.random() - 0.5) * 0.3,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 0.4 + Math.random() * 0.5,
          vz: (Math.random() - 0.5) * 0.5,
          color: FLUFF,
          size: 0.035,
          life: 2.2 + Math.random(),
          gravity: 0.05,
          drag: 1.2,
          wind: 2.2,
          alpha: 0.9,
        });
      }
    });
    const offSprout = on("plantSprout", ({ pos }) => {
      if (flowers.length >= MAX_FLOWERS) flowers.splice(60, 1);
      const rnd = Math.random;
      const color = new Color(FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)]);
      flowers.push({ x: pos.x, y: height(pos.x, pos.z), z: pos.z, s: 0.17 + rnd() * 0.12, rot: rnd() * 6, tilt: (rnd() - 0.5) * 0.25, grow: 0, bob: 0, color, sprout: 0 });
      spawnDust(pos, new Color("#7a6040"), 0.3);
      sfx("pop", pos, 0.5, 1.3 + rnd() * 0.3);
      dirty.current = true;
    });
    const offWater = on("watered", ({ pos, amount }) => {
      for (const f of flowers) {
        if (Math.abs(f.x - pos.x) > 0.7 || Math.abs(f.z - pos.z) > 0.7) continue;
        if (Math.hypot(f.x - pos.x, f.z - pos.z) > 0.7) continue;
        if (f.sprout !== undefined) f.sprout += amount * 2.2;
        else {
          f.bob = Math.max(f.bob, 0.35);
          f.s = Math.min(0.42, f.s + amount * 0.05);
        }
      }
      dirty.current = true;
    });
    return () => {
      offTap();
      offSprout();
      offWater();
    };
  }, [flowers]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    let any = dirty.current;
    const rain = world.w.rain;
    for (let i = 0; i < flowers.length; i++) {
      const f = flowers[i];
      if (f.sprout !== undefined) {
        f.sprout += dt * (0.011 + rain * 0.07 + wetAt(f.x, f.z) * 0.05);
        if (f.sprout >= 1) {
          // bloom!
          f.sprout = undefined;
          f.grow = 0.35;
          const p = new Vector3(f.x, f.y + f.s, f.z);
          spawnPetals(p, f.color, 6);
          spawnSparkle(p, 4, f.color, 0.2, 0.4);
          sfx("pop", p, 0.7, 0.9 + Math.random() * 0.4);
          flowerSpots.push(new Vector3(f.x, 0, f.z));
          if (flowerSpots.length > 40) flowerSpots.splice(FLOWER_PATCHES.length, 1);
        }
        if (f.grow < 1) f.grow = Math.min(1, f.grow + dt * 1.2);
        writeOne(i);
        any = true;
        continue;
      }
      if (f.grow < 1) {
        f.grow = Math.min(1, f.grow + dt * (1.1 + rain));
        writeOne(i);
        any = true;
      } else if (f.bob > 0) {
        f.bob = Math.max(0, f.bob - dt * 1.4);
        writeOne(i);
        any = true;
      } else if (dirty.current) {
        writeOne(i);
      }
    }
    if (lastCount.current !== flowers.length) {
      lastCount.current = flowers.length;
      m.count = flowers.length;
      any = true;
    }
    if (any) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    dirty.current = false;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || e.instanceId === undefined) return;
    e.stopPropagation();
    markInput();
    const f = flowers[e.instanceId];
    if (!f) return;
    f.bob = 1;
    const p = new Vector3(f.x, f.y + f.s, f.z);
    spawnPetals(p, f.color, 7);
    sfx("bloop", p, 0.5, 0.8 + Math.random() * 0.6);
    for (const o of flowers) if (Math.hypot(o.x - f.x, o.z - f.z) < 0.6) o.bob = Math.max(o.bob, 0.6);
    emit("disturb", { pos: p, radius: 0.8 });
  };

  return (
    <instancedMesh
      ref={mesh}
      args={[geo, mat, MAX_FLOWERS]}
      onClick={onClick}
      {...hoverable("pointer")}
      castShadow
      receiveShadow
    />
  );
}

/** World positions of flowers, for butterflies. */
export const flowerSpots: Vector3[] = FLOWER_PATCHES.map((p) => new Vector3(p.x, 0, p.z));

/* ================= mushrooms ================= */
type Shroom = { x: number; z: number; s: number; red: boolean; tilt: number };
const SHROOMS: Shroom[] = [
  { x: OLD_TREE.x + 0.55, z: OLD_TREE.z + 0.45, s: 1, red: false, tilt: 0.1 },
  { x: OLD_TREE.x + 0.7, z: OLD_TREE.z + 0.25, s: 0.7, red: false, tilt: -0.2 },
  { x: OLD_TREE.x + 0.42, z: OLD_TREE.z + 0.7, s: 0.55, red: false, tilt: 0.25 },
  { x: BOUNCY_MUSHROOM.x, z: BOUNCY_MUSHROOM.z, s: 1.9, red: true, tilt: 0.05 },
  { x: ROUND_TREES[1].x + 0.6, z: ROUND_TREES[1].z + 0.4, s: 0.8, red: false, tilt: 0.15 },
  { x: ROUND_TREES[1].x + 0.8, z: ROUND_TREES[1].z + 0.1, s: 0.6, red: true, tilt: -0.1 },
  { x: ROUND_TREES[0].x - 0.5, z: ROUND_TREES[0].z + 0.5, s: 0.7, red: false, tilt: 0.1 },
];

function Mushroom({ m, i }: { m: Shroom; i: number }) {
  const ref = useRef<Object3D>(null);
  const capMat = useRef<MeshStandardMaterial>(null);
  const squish = useRef(0);
  const y = useMemo(() => height(m.x, m.z), [m]);
  const capGeo = useMemo(() => {
    const g = new SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    g.scale(1, 0.75, 1);
    return g;
  }, []);
  const spots = useMemo(() => {
    const rnd = mulberry32(i * 13 + 5);
    return Array.from({ length: m.red ? 6 : 3 }, () => {
      const a = rnd() * Math.PI * 2;
      const el = 0.35 + rnd() * 0.7;
      return new Vector3(Math.cos(a) * Math.sin(el) * 0.11, Math.cos(el) * 0.11 * 0.75 + 0.002, Math.sin(a) * Math.sin(el) * 0.11);
    });
  }, [i, m.red]);

  useEffect(() => {
    if (!m.red || m.s < 1.5) return;
    return addCollider({
      id: "mushroom-bouncy",
      x: m.x,
      z: m.z,
      r: 0.2 * m.s,
      bottom: y,
      top: y + 0.3 * m.s,
      surface: "mush",
      bounce: 9,
      onHit: () => {
        squish.current = 1;
      },
    });
  }, [m, y]);

  useFrame((_, dt) => {
    squish.current = Math.max(0, squish.current - dt * 2.2);
    const s = squish.current;
    if (ref.current) {
      const k = Math.sin(s * 14) * s * 0.35;
      ref.current.scale.set(m.s * (1 + k * 0.6), m.s * (1 - k), m.s * (1 + k * 0.6));
    }
    if (capMat.current) {
      const glow = world.night * (m.red ? 0.15 : 0.9);
      capMat.current.emissiveIntensity = glow * (0.6 + 0.4 * Math.sin(world.elapsed * 1.3 + i));
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    squish.current = 1;
    const p = new Vector3(m.x, y + 0.2 * m.s, m.z);
    spawnSparkle(p, 10, new Color(world.night > 0.5 ? "#7ff5e0" : "#f4e6a0"), 0.2, 0.6);
    sfx("boing", p, 0.6, m.red ? 0.8 : 1.3);
    emit("disturb", { pos: p, radius: 1 });
  };

  return (
    <group ref={ref} position={[m.x, y - 0.01, m.z]} rotation={[m.tilt, i, m.tilt * 0.5]} onClick={onClick} {...hoverable("pointer")}>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.04, 0.12, 8]} />
        <meshStandardMaterial color="#efe6d2" roughness={0.8} />
      </mesh>
      <mesh geometry={capGeo} position={[0, 0.1, 0]} castShadow>
        <meshStandardMaterial
          ref={capMat}
          color={m.red ? "#d6473a" : "#d9b98a"}
          emissive={m.red ? "#ff6040" : "#5ff0d0"}
          emissiveIntensity={0}
          roughness={0.55}
        />
      </mesh>
      {spots.map((p, k) => (
        <mesh key={k} position={[p.x, p.y + 0.1, p.z]}>
          <sphereGeometry args={[0.013, 6, 4]} />
          <meshStandardMaterial color="#fff8ea" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export function Mushrooms() {
  return (
    <group>
      {SHROOMS.map((m, i) => (
        <Mushroom key={i} m={m} i={i} />
      ))}
    </group>
  );
}

/* ================= rocks ================= */
export function rockGeo(seed: number, r: number, squash = 0.7, tone = "#a79a8a", moss = 0) {
  const ico = new IcosahedronGeometry(r, 2);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const g = mergeVertices(ico);
  const pos = g.attributes.position as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let d = 1 + noise2(n.x * 1.8 + seed, n.z * 1.8 + n.y) * 0.28 + noise2(n.x * 4 + seed * 2, n.y * 4) * 0.08;
    // chisel some flat facets
    d = Math.round(d * 7) / 7 * 0.4 + d * 0.6;
    v.copy(n).multiplyScalar(r * d);
    v.y *= squash;
    if (v.y < -r * 0.2) v.y = -r * 0.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const base = new Color(tone);
  const mossC = new Color("#7d9a48");
  const c = new Color();
  const nrm = g.attributes.normal as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.copy(base).offsetHSL(0, 0, noise2(v.x * 5 + seed, v.z * 5) * 0.05 - (v.y < 0.05 ? 0.06 : 0));
    const up = nrm.getY(i);
    c.lerp(mossC, moss * smoothstep(0.55, 0.9, up) * (0.6 + 0.4 * noise2(v.x * 3, v.z * 3 + seed)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return g;
}

const rockMat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), { snow: 0.9, wet: true });

type RockSpec = { x: number; z: number; r: number; squash: number; seed: number; tone?: string; moss?: number; rot?: number; sink?: number };

export function Rocks() {
  const rocks = useMemo<RockSpec[]>(() => {
    const out: RockSpec[] = [];
    const rnd = mulberry32(99);
    // beach clusters
    const clusters = [
      { a: 0.05, r: 9.6, n: 4 },
      { a: 1.72, r: 9.4, n: 3 },
      { a: 2.75, r: 9.3, n: 3 },
      { a: 3.9, r: 8.9, n: 4 },
      { a: -0.4, r: 9.0, n: 3 },
    ];
    for (const c of clusters) {
      for (let i = 0; i < c.n; i++) {
        const a = c.a + (rnd() - 0.5) * 0.18;
        const rr = c.r + (rnd() - 0.5) * 1.2;
        out.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, r: 0.18 + rnd() * (i === 0 ? 0.45 : 0.2), squash: 0.55 + rnd() * 0.3, seed: rnd() * 100, moss: 0.2 });
      }
    }
    // scree at the cliff foot
    for (let i = 0; i < 9; i++) {
      const a = -0.55 - rnd() * 0.9;
      const rr = 10 + rnd() * 2.2;
      out.push({ x: Math.cos(a) * rr + 1.2, z: Math.sin(a) * rr - 0.3, r: 0.2 + rnd() * 0.5, squash: 0.7, seed: rnd() * 100, tone: "#b08468", sink: 0.1 });
    }
    // meadow stones
    const meadow = [
      [-2.0, 4.8, 0.32],
      [3.6, 1.8, 0.24],
      [-5.9, 1.9, 0.28],
      [0.2, -5.6, 0.3],
      [-4.4, -3.0, 0.22],
    ];
    meadow.forEach(([x, z, r]) => out.push({ x, z, r, squash: 0.55, seed: rnd() * 100, moss: 0.7 }));
    return out;
  }, []);

  const geos = useMemo(() => rocks.map((r) => rockGeo(r.seed, r.r, r.squash, r.tone, r.moss ?? 0)), [rocks]);

  useEffect(() => {
    const offs = rocks.map((r, i) =>
      addCollider({ id: `rock-${i}`, x: r.x, z: r.z, r: r.r * 0.9, bottom: height(r.x, r.z) - 0.5, top: height(r.x, r.z) + r.r * r.squash, surface: "rock" }),
    );
    return () => offs.forEach((o) => o());
  }, [rocks]);

  return (
    <group>
      {rocks.map((r, i) => (
        <mesh
          key={i}
          geometry={geos[i]}
          material={rockMat}
          position={[r.x, height(r.x, r.z) - (r.sink ?? 0.05) - r.r * 0.1, r.z]}
          rotation-y={r.seed}
          castShadow
          receiveShadow
        />
      ))}
      <SeaStacks />
    </group>
  );
}

function SeaStacks() {
  const stacks = useMemo(
    () =>
      SEA_STACKS.map((s) => {
        const parts: BufferGeometry[] = [];
        const levels = Math.max(2, Math.round(s.h / 1.1));
        for (let i = 0; i < levels; i++) {
          const t = i / Math.max(1, levels - 1);
          const r = s.r * (1 - t * 0.3);
          const g = rockGeo(s.seed * 10 + i, r, (s.h / levels) / r * 0.95, "#b88a6c", i === levels - 1 ? 0.8 : 0.05);
          place(g, [Math.sin(i * 1.7) * 0.1, -1.0 + (t * (s.h - 0.6)), Math.cos(i * 2.3) * 0.1], [0, i * 1.3, 0]);
          parts.push(g);
        }
        return merge(parts);
      }),
    [],
  );
  useEffect(() => {
    const perches = SEA_STACKS.slice(0, 2).map((s, i) => ({
      id: `stack-${i}`,
      pos: new Vector3(s.x, -1.2 + s.h + s.r * 0.6, s.z),
      taken: false,
    }));
    world.perches.push(...perches);
    const offs = SEA_STACKS.map((s, i) =>
      addCollider({ id: `stack-${i}`, x: s.x, z: s.z, r: s.r, bottom: -3, top: -1.2 + s.h + s.r * 0.5, surface: "rock" }),
    );
    return () => {
      world.perches = world.perches.filter((p) => !perches.includes(p));
      offs.forEach((o) => o());
    };
  }, []);
  return (
    <group>
      {SEA_STACKS.map((s, i) => (
        <mesh key={i} geometry={stacks[i]} material={rockMat} position={[s.x, 0, s.z]} castShadow receiveShadow />
      ))}
    </group>
  );
}

void CLIFF;
