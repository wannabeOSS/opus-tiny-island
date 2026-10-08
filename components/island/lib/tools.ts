import { Vector3, type Object3D } from "three";

/** Meshes the tools aim at (terrain, sea proxy, pond). */
export const groundTargets: Object3D[] = [];
export function registerGround(o: Object3D | null, surface: "land" | "sea" | "pond") {
  if (!o) return;
  o.userData.surface = surface;
  if (!groundTargets.includes(o)) groundTargets.push(o);
}

/** crumbs lying on the ground, for birds */
export const landCrumbs: { pos: Vector3; t: number }[] = [];

export type ToolKind = "hand" | "breeze" | "water" | "seeds" | "crumbs" | "pebble" | "float";

export type ToolInfo = { id: ToolKind; name: string; verb: string; key: string };

export const TOOLS: ToolInfo[] = [
  { id: "hand", name: "Hand", verb: "poke, grab and throw", key: "1" },
  { id: "breeze", name: "Breeze", verb: "sweep to blow a gust", key: "2" },
  { id: "water", name: "Watering can", verb: "hold to pour", key: "3" },
  { id: "seeds", name: "Seed pouch", verb: "tap grass to sow", key: "4" },
  { id: "crumbs", name: "Crumbs", verb: "sprinkle for fish and birds", key: "5" },
  { id: "pebble", name: "Pebbles", verb: "tap to throw, skim the sea", key: "6" },
  { id: "float", name: "Paper float", verb: "set a boat or lantern adrift", key: "7" },
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
