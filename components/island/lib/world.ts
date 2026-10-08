import { Color, Vector2, Vector3, Vector4 } from "three";

export type WeatherKind = "clear" | "cloudy" | "rain" | "storm" | "fog" | "snow";
export const WEATHER_ORDER: WeatherKind[] = ["clear", "cloudy", "rain", "storm", "fog", "snow"];

export type WeatherMix = { cloud: number; rain: number; storm: number; fog: number; snow: number };
export const WEATHER_TARGETS: Record<WeatherKind, WeatherMix> = {
  clear: { cloud: 0.2, rain: 0, storm: 0, fog: 0, snow: 0 },
  cloudy: { cloud: 0.85, rain: 0, storm: 0, fog: 0.1, snow: 0 },
  rain: { cloud: 1, rain: 1, storm: 0, fog: 0.25, snow: 0 },
  storm: { cloud: 1, rain: 1, storm: 1, fog: 0.3, snow: 0 },
  fog: { cloud: 0.45, rain: 0, storm: 0, fog: 1, snow: 0 },
  snow: { cloud: 0.9, rain: 0, storm: 0, fog: 0.3, snow: 1 },
};

export type Perch = { pos: Vector3; taken: boolean; id: string; disturbOnShake?: number };

export const world = {
  /** hours, 0..24 */
  time: 17.45,
  elapsed: 0,
  dt: 0.016,
  draggingTime: false,
  weather: "clear" as WeatherKind,
  w: { ...WEATHER_TARGETS.clear } as WeatherMix,
  /** wind in world xz; length is strength */
  wind: new Vector2(0.25, 0.1),
  windStrength: 0.25,
  gust: 0,
  pointer: new Vector3(0, -100, 0),
  pointerOnLand: false,
  pointerOverWorld: false,
  pointerSpeed: 0,
  lastInput: 0,
  holding: false,
  daylight: 1,
  night: 0,
  midnight: 0,
  snowCover: 0,
  wet: 0,
  flash: 0,
  sunDir: new Vector3(0, 1, 0),
  moonDir: new Vector3(0, -1, 0),
  lighthouseBeam: 0,
  beamAngle: 0,
  mobile: false,
  quality: 1,
  perches: [] as Perch[],
  // secret counters
  fishFed: 0,
  goldenFish: false,
  lighthouseTaps: [] as number[],
  bottleOpened: false,
  rainbow: 0,
  rainbowBoost: 0,
  seedPlanted: false,
  seedGrowth: 0,
  cabin: { door: 0, doorTarget: 0, knockAt: -100, villagerInside: true, lights: 0 },
  /** local rain from clouds the user poked */
  showers: [] as { x: number; z: number; r: number; i: number }[],
  sunTouched: false,
  boat: { sailing: false, pos: new Vector3(), heading: 0 },
  /** extra wind from the breeze tool, decays on its own */
  breeze: new Vector2(),
  /** user settings */
  settings: { windSense: 1, waves: 1, timeFlow: 1 },
  rabbitOut: false,
  lanternTreeDone: false,
};

export function idleSeconds() {
  return world.elapsed - world.lastInput;
}
export function markInput() {
  world.lastInput = world.elapsed;
}

/* ---------------- event bus ---------------- */
export type WorldEvents = {
  splash: { pos: Vector3; strength: number; kind?: string; pond?: boolean };
  impact: { pos: Vector3; strength: number; surface: "sand" | "grass" | "rock" | "wood" };
  disturb: { pos: Vector3; radius: number };
  food: { pos: Vector3 };
  shake: { pos: Vector3; id: string };
  sfx: { name: string; pos?: Vector3; strength?: number; pitch?: number };
  /** pos = where the bolt starts (cloud base); target = where it lands */
  lightning: { pos: Vector3; target?: Vector3 };
  whale: Record<string, never>;
  shootingStar: Record<string, never>;
  weather: { kind: WeatherKind };
  boatSail: Record<string, never>;
  reset: Record<string, never>;
  focus: { pos: Vector3 | null };
  hint: { text: string };
  tapGround: { pos: Vector3; grass: boolean };
  treeHit: { id: string; pos: Vector3 };
  bell: { pos: Vector3 };
  spawnProp: { kind: PropKind; pos: Vector3; vel?: Vector3; spin?: boolean };
  leaves: { pos: Vector3; n: number; color?: string; spread?: number };
  seedPlanted: { pos: Vector3 };
  seedTouched: Record<string, never>;
  /** watering can (or similar) soaked this spot */
  watered: { pos: Vector3; amount: number };
  /** crumbs landed; on water they're fish food, on land birds come */
  crumbs: { pos: Vector3; water: boolean };
  plantSprout: { pos: Vector3 };
  skip: { pos: Vector3; count: number };
  /** a strong gust from the breeze tool at pos, direction dir (xz) */
  gust: { pos: Vector3; dir: Vector3; strength: number };
};

export type PropKind =
  | "pebble"
  | "shell"
  | "coconut"
  | "apple"
  | "stick"
  | "bottle"
  | "seed"
  | "cone"
  | "starfish"
  | "paperboat"
  | "lantern";

type Handler<T> = (payload: T) => void;
const handlers = new Map<string, Set<Handler<unknown>>>();

export function on<K extends keyof WorldEvents>(type: K, fn: Handler<WorldEvents[K]>) {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(fn as Handler<unknown>);
  return () => {
    set!.delete(fn as Handler<unknown>);
  };
}

export function emit<K extends keyof WorldEvents>(type: K, payload: WorldEvents[K]) {
  const set = handlers.get(type);
  if (!set) return;
  set.forEach((fn) => fn(payload));
}

export const sfx = (name: string, pos?: Vector3, strength = 1, pitch = 1) =>
  emit("sfx", { name, pos, strength, pitch });

/* ---------------- ripples ---------------- */
export const RIPPLE_COUNT = 24;
export const ripples = Array.from({ length: RIPPLE_COUNT }, () => new Vector4(0, 0, -100, 0));
let rippleIdx = 0;
export function addRipple(x: number, z: number, strength: number) {
  ripples[rippleIdx].set(x, z, world.elapsed, strength);
  rippleIdx = (rippleIdx + 1) % RIPPLE_COUNT;
}

export const POND_RIPPLE_COUNT = 8;
export const pondRipples = Array.from({ length: POND_RIPPLE_COUNT }, () => new Vector4(0, 0, -100, 0));
let pondIdx = 0;
export function addPondRipple(x: number, z: number, strength: number) {
  pondRipples[pondIdx].set(x, z, world.elapsed, strength);
  pondIdx = (pondIdx + 1) % POND_RIPPLE_COUNT;
}

/* ---------------- shared shader uniforms ---------------- */
export const U = {
  uTime: { value: 0 },
  uWind: { value: new Vector2() },
  uWindStrength: { value: 0 },
  uPointer: { value: new Vector3(0, -100, 0) },
  uPointerStrength: { value: 0 },
  uWet: { value: 0 },
  uSnow: { value: 0 },
  uNight: { value: 0 },
  uCloud: { value: 0 },
  uSkyTint: { value: new Color() },
  uSunDirW: { value: new Vector3(0, 1, 0) },
  uSunCol: { value: new Color() },
};

/* ---------------- waves (mirrors GLSL in water shader) ---------------- */
export const waveState = { amp: 1 };
export function waveHeight(x: number, z: number, t: number, depth = 4) {
  const amp = waveState.amp * (0.3 + 0.7 * Math.min(1, Math.max(0, depth / 2)));
  const a = Math.sin((x * 0.8 + z * 0.6) * 0.55 + t * 1.1) * 0.1;
  const b = Math.sin((x * -0.4 + z * 0.92) * 0.8 + t * 1.5) * 0.07;
  const c = Math.sin((x * 0.95 + z * -0.3) * 1.4 + t * 2.1) * 0.04;
  return (a + b + c) * amp;
}
