import type { Vector3 } from "three";

export type Collider = {
  id: string;
  /** vertical cylinder */
  x: number;
  z: number;
  r: number;
  bottom: number;
  top: number;
  surface: "wood" | "rock" | "metal" | "leaf" | "mush";
  onHit?: (pos: Vector3, speed: number) => void;
  /** bouncy cap on top (mushrooms) */
  bounce?: number;
  /**
   * Exact physics shape: convex hull points relative to (x, 0, z), y in world space.
   * The cylinder fields above stay as a cheap bound for overlap tests.
   */
  hull?: Float32Array;
};

/** Hull of stacked horizontal rings, given as [radius, y] (plus an optional [dx, dz] offset per ring). */
export function ringHull(rings: ([number, number] | [number, number, number, number])[], seg = 12) {
  const pts: number[] = [];
  for (const [r, y, dx = 0, dz = 0] of rings)
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(dx + Math.cos(a) * r, y, dz + Math.sin(a) * r);
    }
  return new Float32Array(pts);
}

export const colliders: Collider[] = [];

const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};
export const getCollidersVersion = () => version;
export function subscribeColliders(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function addCollider(c: Collider) {
  const i = colliders.findIndex((o) => o.id === c.id);
  if (i >= 0) colliders[i] = c;
  else colliders.push(c);
  changed();
  return () => {
    const j = colliders.indexOf(c);
    if (j >= 0) {
      colliders.splice(j, 1);
      changed();
    }
  };
}
