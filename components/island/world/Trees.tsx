"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  BoxGeometry,
  CylinderGeometry,
} from "three";
import { addCollider } from "../lib/colliders";
import { blob, merge, place, prep, sphericalNormals, trunk } from "../lib/geo";
import { OLD_TREE, PALMS, PINES, ROUND_TREES } from "../lib/layout";
import { mulberry32, noise2 } from "../lib/math";
import { patchMaterial } from "../lib/patch";
import { height } from "../lib/terrain";
import { emit, markInput, sfx, world, type PropKind } from "../lib/world";
import { hoverable } from "./cursor";

/* ---------------- shared materials ---------------- */
const mats = {
  bark: patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), {
    sway: { scale: 0.35, stiff: 2 },
    snow: 0.6,
    wet: true,
  }),
  leaf: patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), {
    sway: { scale: 0.45, stiff: 1.6, push: 0.15 },
    snow: 1,
    wet: true,
  }),
  frond: patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: DoubleSide }), {
    sway: { scale: 0.5, stiff: 1.4 },
    snow: 0.7,
    wet: true,
  }),
  fruit: new MeshStandardMaterial({ color: "#d9483b", roughness: 0.45 }),
  coconut: new MeshStandardMaterial({ color: "#6e4a2c", roughness: 0.8 }),
  cone: new MeshStandardMaterial({ color: "#8a5a36", roughness: 0.9 }),
  rope: new MeshStandardMaterial({ color: "#c9ad7d", roughness: 1 }),
  seat: new MeshStandardMaterial({ color: "#9a6b43", roughness: 0.9 }),
};

/* ---------------- shake behaviour ---------------- */
type FruitSlot = { pos: Vector3; mesh?: Mesh | null; gone: number };

function useTree(opts: {
  id: string;
  x: number;
  z: number;
  trunkR: number;
  top: number;
  canopyY: number;
  canopyR: number;
  drop: PropKind | null;
  leafColor: string;
  fruits: FruitSlot[];
  stiffness?: number;
}) {
  const group = useRef<Group>(null);
  const s = useRef({ ax: 0, az: 0, vx: 0, vz: 0, lastShake: -10 });
  const y0 = useMemo(() => height(opts.x, opts.z), [opts.x, opts.z]);

  const shake = (strength: number, from?: Vector3) => {
    const st = s.current;
    const a = from ? Math.atan2(opts.z - from.z, opts.x - from.x) : Math.random() * Math.PI * 2;
    st.vx += Math.cos(a) * 2.2 * strength;
    st.vz += Math.sin(a) * 2.2 * strength;
    const top = new Vector3(opts.x, y0 + opts.canopyY, opts.z);
    emit("leaves", { pos: top, n: Math.round(6 + strength * 10), color: opts.leafColor, spread: opts.canopyR });
    emit("disturb", { pos: top, radius: 3.5 });
    emit("shake", { pos: top, id: opts.id });
    sfx("rustle", top, 0.6 + strength * 0.5);
    // drop something?
    if (world.elapsed - st.lastShake > 0.35 && opts.drop) {
      const avail = opts.fruits.filter((f) => f.gone === 0);
      if (avail.length && Math.random() < 0.75) {
        const f = avail[Math.floor(Math.random() * avail.length)];
        f.gone = world.elapsed;
        if (f.mesh) f.mesh.visible = false;
        const wp = f.pos.clone().add(new Vector3(opts.x, y0, opts.z));
        emit("spawnProp", { kind: opts.drop, pos: wp, vel: new Vector3((Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6) });
      }
    }
    st.lastShake = world.elapsed;
  };

  useEffect(() => {
    const off1 = addCollider({
      id: opts.id,
      x: opts.x,
      z: opts.z,
      r: opts.trunkR + 0.06,
      bottom: y0 - 0.2,
      top: y0 + opts.top,
      surface: "wood",
    });
    const off2 = addCollider({
      id: opts.id + "-canopy",
      x: opts.x,
      z: opts.z,
      r: opts.canopyR * 0.9,
      bottom: y0 + opts.canopyY - opts.canopyR * 0.6,
      top: y0 + opts.canopyY + opts.canopyR * 0.6,
      surface: "leaf",
      onHit: (p, speed) => shake(Math.min(1.2, speed / 8), p),
    });
    const perch = {
      id: opts.id,
      pos: new Vector3(opts.x + 0.1, y0 + opts.canopyY + opts.canopyR * 0.75, opts.z + 0.05),
      taken: false,
    };
    world.perches.push(perch);
    return () => {
      off1();
      off2();
      world.perches = world.perches.filter((p) => p !== perch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const st = s.current;
    const k = 55 * (opts.stiffness ?? 1);
    const d = 5.5;
    const step = Math.min(dt, 1 / 30);
    st.vx += (-k * st.ax - d * st.vx) * step;
    st.vz += (-k * st.az - d * st.vz) * step;
    st.ax += st.vx * step;
    st.az += st.vz * step;
    if (group.current) {
      group.current.rotation.z = -st.ax * 0.06;
      group.current.rotation.x = st.az * 0.06;
    }
    // regrow fruit
    for (const f of opts.fruits) {
      if (f.gone && world.elapsed - f.gone > 45) {
        f.gone = 0;
        if (f.mesh) {
          f.mesh.visible = true;
          f.mesh.scale.setScalar(0.01);
        }
      }
      if (f.mesh && f.mesh.visible && f.mesh.scale.x < 1) f.mesh.scale.setScalar(Math.min(1, f.mesh.scale.x + dt * 0.5));
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    shake(1, e.point);
  };

  return { group, y0, onClick, shake };
}

/* ---------------- round tree ---------------- */
function roundTreeGeo(seed: number, autumn = false) {
  const rnd = mulberry32(seed);
  const h = 1.35 + rnd() * 0.4;
  const bark = trunk({
    h,
    r0: 0.15,
    r1: 0.085,
    bend: [(rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25],
    dark: new Color("#5b4030"),
    light: new Color("#8c6a4c"),
    seed,
  });
  const br1 = place(
    trunk({ h: 0.6, r0: 0.06, r1: 0.03, dark: new Color("#5b4030"), light: new Color("#8c6a4c"), seed: seed + 1 }),
    [0, h * 0.62, 0],
    [0.9, rnd() * 6, 0],
  );
  const br2 = place(
    trunk({ h: 0.5, r0: 0.05, r1: 0.025, dark: new Color("#5b4030"), light: new Color("#8c6a4c"), seed: seed + 2 }),
    [0, h * 0.72, 0],
    [-0.8, rnd() * 6, 0.3],
  );
  const bark2 = merge([bark, br1, br2]);

  const bottom = new Color(autumn ? "#8c6a2a" : "#3f6a33");
  const top = new Color(autumn ? "#e4b54e" : "#a9c65c");
  bottom.offsetHSL((rnd() - 0.5) * 0.03, 0, 0);
  top.offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.05);
  const blobs: BufferGeometry[] = [];
  const centers: { p: Vector3; r: number }[] = [];
  const main = 0.85 + rnd() * 0.2;
  centers.push({ p: new Vector3(0, h + 0.45, 0), r: main });
  const n = 4 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const rr = 0.5 + rnd() * 0.25;
    centers.push({ p: new Vector3(Math.cos(a) * 0.62, h + 0.1 + rnd() * 0.5, Math.sin(a) * 0.62), r: rr });
  }
  centers.forEach((c, i) => {
    blobs.push(place(blob({ r: c.r, seed: seed * 10 + i, bottom, top, lump: 0.14 }), [c.p.x, c.p.y, c.p.z]));
  });
  const canopy = sphericalNormals(merge(blobs), new Vector3(0, h + 0.35, 0), 0.72);
  // fruit slots on the lower outer surface
  const fruits: Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const c = centers[1 + (i % (centers.length - 1))];
    const dir = c.p.clone().setY(0).normalize();
    fruits.push(c.p.clone().addScaledVector(dir, c.r * 0.85).add(new Vector3(0, -c.r * 0.35, 0)));
  }
  return { bark: bark2, canopy, h, fruits, canopyY: h + 0.4, canopyR: 1.25 };
}

const fruitGeo = new SphereGeometry(0.075, 12, 8);

function RoundTree({ x, z, s, seed, id }: { x: number; z: number; s: number; seed: number; id: string }) {
  const g = useMemo(() => roundTreeGeo(seed), [seed]);
  const fruits = useMemo<FruitSlot[]>(() => g.fruits.map((p) => ({ pos: p.clone().multiplyScalar(s), gone: 0 })), [g, s]);
  const { group, y0, onClick } = useTree({
    id,
    x,
    z,
    trunkR: 0.16 * s,
    top: g.h * s,
    canopyY: g.canopyY * s,
    canopyR: g.canopyR * s,
    drop: "apple",
    leafColor: "#86ad4c",
    fruits,
  });
  return (
    <group position={[x, y0 - 0.05, z]}>
      <group ref={group} scale={s} onClick={onClick} {...hoverable("pointer")}>
        <mesh geometry={g.bark} material={mats.bark} castShadow receiveShadow />
        <mesh geometry={g.canopy} material={mats.leaf} castShadow receiveShadow />
        {fruits.map((f, i) => (
          <mesh
            key={i}
            ref={(m) => {
              f.mesh = m;
            }}
            geometry={fruitGeo}
            material={mats.fruit}
            position={f.pos.clone().divideScalar(s)}
            castShadow
          />
        ))}
      </group>
    </group>
  );
}

/* ---------------- pine ---------------- */
function pineGeo(seed: number) {
  const rnd = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const h = 0.7;
  parts.push(trunk({ h: h + 0.6, r0: 0.11, r1: 0.05, dark: new Color("#4d3526"), light: new Color("#7a573d"), seed }));
  const tiers = 4;
  const leaves: BufferGeometry[] = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 0.95 - t * 0.55;
    const hh = 0.95 - t * 0.25;
    const cone = new ConeGeometry(r, hh, 11, 3, false);
    const pos = cone.attributes.position as BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const vx = pos.getX(k);
      const vy = pos.getY(k);
      const vz = pos.getZ(k);
      const a = Math.atan2(vz, vx);
      const jag = 1 + Math.sin(a * 11) * 0.06 + noise2(a * 3 + seed, vy * 2 + i) * 0.1;
      const droop = vy < -hh * 0.45 ? -0.06 * Math.abs(Math.sin(a * 5.5)) : 0;
      pos.setXYZ(k, vx * jag, vy + droop, vz * jag);
    }
    cone.computeVertexNormals();
    const bottom = new Color("#2c5444");
    const top = new Color("#5f8e5f");
    const c = new Color();
    const y = h + i * 0.48 + hh / 2;
    leaves.push(
      place(
        prep(cone, (p) => c.copy(bottom).lerp(top, Math.max(0, Math.min(1, p.y / hh + 0.5)) * 0.8 + t * 0.2)),
        [0, y, 0],
        [0, rnd() * 3, 0],
      ),
    );
  }
  return { bark: merge(parts), canopy: sphericalNormals(merge(leaves), new Vector3(0, h + 1.0, 0), 0.4), height: h + tiers * 0.48 + 0.6 };
}

function Pine({ x, z, s, seed, id }: { x: number; z: number; s: number; seed: number; id: string }) {
  const g = useMemo(() => pineGeo(seed), [seed]);
  const fruits = useMemo<FruitSlot[]>(
    () => [
      { pos: new Vector3(0.45, 1.0, 0.2).multiplyScalar(s), gone: 0 },
      { pos: new Vector3(-0.3, 1.4, -0.35).multiplyScalar(s), gone: 0 },
    ],
    [s],
  );
  const { group, y0, onClick } = useTree({
    id,
    x,
    z,
    trunkR: 0.12 * s,
    top: g.height * s,
    canopyY: 1.6 * s,
    canopyR: 0.9 * s,
    drop: "cone",
    leafColor: "#3f6b55",
    fruits,
    stiffness: 1.4,
  });
  return (
    <group position={[x, y0 - 0.05, z]}>
      <group ref={group} scale={s} onClick={onClick} {...hoverable("pointer")}>
        <mesh geometry={g.bark} material={mats.bark} castShadow receiveShadow />
        <mesh geometry={g.canopy} material={mats.leaf} castShadow receiveShadow />
      </group>
    </group>
  );
}

/* ---------------- palm ---------------- */
function frondGeo(len: number, seed: number) {
  const segs = 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const base = new Color("#4a8236");
  const tip = new Color("#93b74e");
  const c = new Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.26 * (1 - t * 0.3);
    const x = t * len;
    const y = Math.sin(t * 1.4) * 0.35 - t * t * 0.95;
    const serr = i % 2 === 0 ? 1 : 0.72;
    pos.push(x, y + w * 0.25, -w * serr, x, y + 0.06, 0, x, y + w * 0.25, w * serr);
    c.copy(base).lerp(tip, t);
    c.offsetHSL(noise2(t * 5, seed) * 0.02, 0, 0);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function palmGeo(seed: number, lean: number, angle: number) {
  const rnd = mulberry32(seed);
  const h = 3.0 + rnd() * 0.4;
  const bx = Math.cos(angle) * lean;
  const bz = Math.sin(angle) * lean;
  const bark = trunk({
    h,
    r0: 0.15,
    r1: 0.09,
    bend: [bx, bz],
    radial: 8,
    segs: 14,
    dark: new Color("#7d6246"),
    light: new Color("#b39572"),
    seed,
    rings: 11,
  });
  const crown = new Vector3(bx * h, h, bz * h);
  const fronds: BufferGeometry[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const f = frondGeo(1.35 + rnd() * 0.35, seed + i);
    f.deleteAttribute("uv");
    place(f, [crown.x, crown.y, crown.z], [0, -a, 0.15 + rnd() * 0.25]);
    fronds.push(f);
  }
  const nut = new SphereGeometry(1, 8, 6);
  const nuts = [0, 1, 2].map((i) => {
    const a = i * 2.1 + rnd();
    return new Vector3(crown.x + Math.cos(a) * 0.13, crown.y - 0.12, crown.z + Math.sin(a) * 0.13);
  });
  nut.dispose();
  return { bark, fronds: merge(fronds), crown, nuts, h };
}

const nutGeo = new SphereGeometry(0.105, 12, 8);

function Palm({ a, r, lean, s, seed, id }: { a: number; r: number; lean: number; s: number; seed: number; id: string }) {
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const g = useMemo(() => palmGeo(seed, lean, a), [seed, lean, a]);
  const fruits = useMemo<FruitSlot[]>(() => g.nuts.map((p) => ({ pos: p.clone().multiplyScalar(s), gone: 0 })), [g, s]);
  const { group, y0, onClick } = useTree({
    id,
    x,
    z,
    trunkR: 0.15 * s,
    top: g.h * s * 0.5,
    canopyY: g.crown.y * s,
    canopyR: 1.1 * s,
    drop: "coconut",
    leafColor: "#7fa94a",
    fruits,
    stiffness: 0.7,
  });
  return (
    <group position={[x, y0 - 0.05, z]}>
      <group ref={group} scale={s} onClick={onClick} {...hoverable("pointer")}>
        <mesh geometry={g.bark} material={mats.bark} castShadow receiveShadow />
        <mesh geometry={g.fronds} material={mats.frond} castShadow receiveShadow />
        {fruits.map((f, i) => (
          <mesh
            key={i}
            ref={(m) => {
              f.mesh = m;
            }}
            geometry={nutGeo}
            material={mats.coconut}
            position={f.pos.clone().divideScalar(s)}
            castShadow
          />
        ))}
      </group>
    </group>
  );
}

/* ---------------- old tree with a rope swing ---------------- */
function oldTreeGeo() {
  const seed = 31;
  const h = 1.45;
  const dark = new Color("#4f3a2c");
  const light = new Color("#86654a");
  const main = trunk({ h, r0: 0.3, r1: 0.16, bend: [-0.12, 0.08], radial: 9, dark, light, seed });
  const limb = place(trunk({ h: 1.55, r0: 0.11, r1: 0.05, bend: [0, 0.1], dark, light, seed: seed + 1 }), [0.0, h * 0.78, 0], [0, 0, -1.25]);
  const limb2 = place(trunk({ h: 0.8, r0: 0.08, r1: 0.04, dark, light, seed: seed + 2 }), [0, h * 0.9, 0], [0.9, 2.2, 0]);
  // roots
  const roots = [0, 1, 2, 3].map((i) =>
    place(trunk({ h: 0.55, r0: 0.09, r1: 0.03, dark, light, seed: seed + 5 + i }), [0, 0.12, 0], [1.25, i * 1.6 + 0.4, 0]),
  );
  const bark = merge([main, limb, limb2, ...roots]);

  const bottom = new Color("#8c6a2a");
  const top = new Color("#e9bb52");
  const blobs = [
    place(blob({ r: 1.0, seed: 301, bottom, top, lump: 0.25 }), [-0.15, h + 0.75, 0]),
    place(blob({ r: 0.75, seed: 302, bottom, top }), [0.85, h + 0.55, 0.2]),
    place(blob({ r: 0.7, seed: 303, bottom, top }), [1.45, h + 0.45, -0.1]),
    place(blob({ r: 0.65, seed: 304, bottom, top }), [-0.8, h + 0.35, -0.4]),
    place(blob({ r: 0.6, seed: 305, bottom, top }), [-0.2, h + 0.5, 0.75]),
  ];
  return { bark, canopy: sphericalNormals(merge(blobs), new Vector3(0.3, h + 0.5, 0), 0.72), h, branch: new Vector3(1.05, h * 0.78 + 1.05 * Math.tan(0.32) + 0.1, 0) };
}

const ropeGeo = new CylinderGeometry(0.008, 0.008, 1, 4);
const seatGeo = new BoxGeometry(0.34, 0.035, 0.16);

function OldTree() {
  const g = useMemo(() => oldTreeGeo(), []);
  const swing = useRef<Group>(null);
  const sw = useRef({ a: 0, v: 0 });
  const ropeLen = 1.05;
  const fruits = useMemo<FruitSlot[]>(
    () => [
      { pos: new Vector3(0.3, g.h + 0.2, 0.6), gone: 0 },
      { pos: new Vector3(1.3, g.h + 0.1, 0.4), gone: 0 },
    ],
    [g],
  );
  const { group, y0, onClick } = useTree({
    id: "old-tree",
    x: OLD_TREE.x,
    z: OLD_TREE.z,
    trunkR: 0.3,
    top: g.h,
    canopyY: g.h + 0.6,
    canopyR: 1.5,
    drop: "stick",
    leafColor: "#d9a845",
    fruits,
    stiffness: 1.6,
  });

  useFrame((_, dt) => {
    const st = sw.current;
    const step = Math.min(dt, 1 / 30);
    // wind along the swing plane (local z) pushes it
    const force = world.wind.y * 0.9 + world.wind.x * 0.3;
    st.v += (-9.8 / ropeLen * Math.sin(st.a) + force * 0.6 - st.v * 0.35) * step;
    st.a += st.v * step;
    if (swing.current) swing.current.rotation.x = st.a;
  });

  const pushSwing = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    sw.current.v += 1.6 * (sw.current.v >= 0 ? 1 : -1);
    sfx("creak", e.point, 0.8);
  };

  return (
    <group position={[OLD_TREE.x, y0 - 0.08, OLD_TREE.z]} rotation-y={0.5}>
      <group ref={group} onClick={onClick} {...hoverable("pointer")}>
        <mesh geometry={g.bark} material={mats.bark} castShadow receiveShadow />
        <mesh geometry={g.canopy} material={mats.leaf} castShadow receiveShadow />
      </group>
      <group ref={swing} position={[g.branch.x, g.branch.y, g.branch.z]} onClick={pushSwing} {...hoverable("pointer")}>
        <mesh geometry={ropeGeo} material={mats.rope} position={[-0.14, -ropeLen / 2, 0]} scale={[1, ropeLen, 1]} />
        <mesh geometry={ropeGeo} material={mats.rope} position={[0.14, -ropeLen / 2, 0]} scale={[1, ropeLen, 1]} />
        <mesh geometry={seatGeo} material={mats.seat} position={[0, -ropeLen, 0]} castShadow />
      </group>
    </group>
  );
}

/* ---------------- all trees ---------------- */
export function Trees() {
  return (
    <group>
      {ROUND_TREES.map((t, i) => (
        <RoundTree key={i} id={`tree-${i}`} {...t} />
      ))}
      {PINES.map((t, i) => (
        <Pine key={i} id={`pine-${i}`} {...t} />
      ))}
      {PALMS.map((t, i) => (
        <Palm key={i} id={`palm-${i}`} {...t} />
      ))}
      <OldTree />
    </group>
  );
}
