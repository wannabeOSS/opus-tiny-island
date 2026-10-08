import { Vector2, Vector3, type Object3D } from "three";

/** Meshes the tools aim at (terrain, sea proxy, pond). */
export const groundTargets: Object3D[] = [];
export function registerGround(o: Object3D | null, surface: "land" | "sea" | "pond") {
  if (!o) return;
  o.userData.surface = surface;
  if (!groundTargets.includes(o)) groundTargets.push(o);
}

/** crumbs lying on the ground, for birds */
export const landCrumbs: { pos: Vector3; t: number }[] = [];

export type ToolKind = "hand" | "pinwheel" | "cloud" | "mirror" | "bubbles" | "seedbomb" | "conch";

export type ToolInfo = { id: ToolKind; name: string; verb: string; key: string };

export const TOOLS: ToolInfo[] = [
  { id: "hand", name: "Hand", verb: "poke, grab and throw", key: "1" },
  { id: "pinwheel", name: "Pinwheel", verb: "sweep to stir up the wind", key: "2" },
  { id: "cloud", name: "Pocket cloud", verb: "hold to rain where you point", key: "3" },
  { id: "mirror", name: "Sun mirror", verb: "hold to cast a beam of light", key: "4" },
  { id: "bubbles", name: "Bubble wand", verb: "hold and sweep to blow bubbles", key: "5" },
  { id: "seedbomb", name: "Seed bomb", verb: "tap to toss a ball of seeds", key: "6" },
  { id: "conch", name: "Conch", verb: "tap to call out to the island", key: "7" },
];

export type Surface = "land" | "sea" | "pond" | "none";

type Listener = () => void;
const listeners = new Set<Listener>();

export const toolState = {
  tool: "hand" as ToolKind,
  /** pointer is held down with a non-hand tool */
  active: false,
  point: new Vector3(),
  surface: "none" as Surface,
  /** screen-space drag velocity while active (px/s) */
  dragVel: { x: 0, y: 0 },
  /** pointer in normalised device coordinates */
  ndc: new Vector2(0, -2),
  /** monotonically increasing so the UI can re-render on change */
  version: 0,
};

export function setTool(tool: ToolKind) {
  if (toolState.tool === tool) return;
  toolState.tool = tool;
  toolState.active = false;
  toolState.version++;
  listeners.forEach((l) => l());
}

export function subscribeTool(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const getToolVersion = () => toolState.version;
