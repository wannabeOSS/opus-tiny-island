"use client";

import { ConvexHullCollider, CuboidCollider, CylinderCollider, Physics, RigidBody, TrimeshCollider } from "@react-three/rapier";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { colliders, getCollidersVersion, subscribeColliders, type Collider } from "../lib/colliders";
import { DOCK, height } from "../lib/terrain";
import { world } from "../lib/world";

/** What a prop touched; read from `rigidBody.userData` in collision events. */
export type StaticInfo = { kind: "terrain" } | { kind: "dock" } | { kind: "obstacle"; c: Collider };

const TERRAIN: StaticInfo = { kind: "terrain" };
const DECK: StaticInfo = { kind: "dock" };

function TerrainBody() {
  const [verts, idx] = useMemo(() => {
    const size = 56;
    // must match the grid (and diagonal) of the visible terrain mesh in Terrain.tsx
    const seg = world.mobile ? 150 : 220;
    const n = seg + 1;
    const v = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = (i / seg - 0.5) * size;
        const z = (j / seg - 0.5) * size;
        v.set([x, height(x, z), z], (j * n + i) * 3);
      }
    const ix = new Uint32Array(seg * seg * 6);
    let k = 0;
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        ix.set([a, c, b, b, c, d], k);
        k += 6;
      }
    return [v, ix];
  }, []);
  return (
    <RigidBody type="fixed" colliders={false} userData={TERRAIN}>
      <TrimeshCollider args={[verts, idx]} friction={0.9} restitution={0.05} />
    </RigidBody>
  );
}

function DockBody() {
  const cx = DOCK.start.x + DOCK.dir.x * DOCK.length * 0.5;
  const cz = DOCK.start.z + DOCK.dir.z * DOCK.length * 0.5;
  return (
    <RigidBody type="fixed" colliders={false} userData={DECK} position={[cx, DOCK.deck - 0.015, cz]} rotation={[0, DOCK.rot, 0]}>
      <CuboidCollider args={[0.48, 0.04, DOCK.length / 2]} friction={0.8} restitution={0.2} />
    </RigidBody>
  );
}

/** Rounded profile for boulders and stacks, as (height fraction, radius fraction) rings. */
const DOME: [number, number][] = [
  [0, 1],
  [0.45, 0.97],
  [0.75, 0.78],
  [0.92, 0.48],
  [1, 0.12],
];
const PILLAR: [number, number][] = [
  [0, 1.1],
  [0.5, 0.95],
  [0.85, 0.8],
  [0.96, 0.5],
  [1, 0.15],
];

function hullPoints(c: Collider) {
  const h = c.top - c.bottom;
  const prof = h > c.r * 2.4 ? PILLAR : DOME;
  const pts: number[] = [];
  for (const [fy, fr] of prof)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      pts.push(Math.cos(a) * c.r * fr, c.bottom + h * fy, Math.sin(a) * c.r * fr);
    }
  return new Float32Array(pts);
}

function ObstacleBody({ c }: { c: Collider }) {
  const info = useMemo<StaticInfo>(() => ({ kind: "obstacle", c }), [c]);
  const half = (c.top - c.bottom) / 2;
  const pts = useMemo(() => c.hull ?? (c.surface === "rock" ? hullPoints(c) : null), [c]);
  return (
    <RigidBody type="fixed" colliders={false} userData={info} position={[c.x, 0, c.z]}>
      {c.surface === "leaf" ? (
        pts ? <ConvexHullCollider sensor args={[pts]} /> : <CylinderCollider sensor args={[half, c.r]} position={[0, c.bottom + half, 0]} />
      ) : pts ? (
        <ConvexHullCollider args={[pts]} friction={c.surface === "rock" ? 0.85 : 0.7} restitution={c.surface === "metal" ? 0.4 : 0.15} />
      ) : (
        <CylinderCollider args={[half, c.r]} position={[0, c.bottom + half, 0]} friction={0.7} restitution={c.surface === "metal" ? 0.4 : 0.15} />
      )}
    </RigidBody>
  );
}

function Obstacles() {
  useSyncExternalStore(subscribeColliders, getCollidersVersion, getCollidersVersion);
  return (
    <>
      {colliders.map((c) => (
        <ObstacleBody key={`${c.id}:${c.x.toFixed(2)}:${c.z.toFixed(2)}:${c.r.toFixed(2)}:${c.top.toFixed(2)}`} c={c} />
      ))}
    </>
  );
}

export function PhysicsWorld({ children }: { children: ReactNode }) {
  return (
    <Physics gravity={[0, -12, 0]} timeStep={1 / 60} interpolate colliders={false}>
      <TerrainBody />
      <DockBody />
      <Obstacles />
      {children}
    </Physics>
  );
}
