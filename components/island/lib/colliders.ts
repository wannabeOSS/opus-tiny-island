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
};

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
