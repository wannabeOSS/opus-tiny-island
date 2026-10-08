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

export function addCollider(c: Collider) {
  const i = colliders.findIndex((o) => o.id === c.id);
  if (i >= 0) colliders[i] = c;
  else colliders.push(c);
  return () => {
    const j = colliders.indexOf(c);
    if (j >= 0) colliders.splice(j, 1);
  };
}
