import type { ThreeEvent } from "@react-three/fiber";

export type CursorKind = "default" | "grab" | "grabbing" | "pointer";

/** Read every frame by the hand-drawn DOM cursor. */
export const cursorState = { kind: "default" as CursorKind, locked: false };

export function setCursor(kind: CursorKind) {
  if (cursorState.locked) return;
  cursorState.kind = kind;
}

export function lockCursor(kind: CursorKind | null) {
  if (kind) {
    cursorState.locked = false;
    setCursor(kind);
    cursorState.locked = true;
  } else {
    cursorState.locked = false;
    setCursor("default");
  }
}

/** Spread onto a mesh/group to make the cursor hint that it can be touched. */
export const hoverable = (kind: CursorKind = "pointer") => ({
  onPointerOver: (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setCursor(kind);
  },
  onPointerOut: () => setCursor("default"),
});
