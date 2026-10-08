import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, Vector3 } from "three";
import { CABIN, CLIFF, DOCK_ANGLE, ISLAND_R, POND } from "./layout";
import { fbm, smoothstep, lerp, clamp } from "./math";

function islandRadius(th: number) {
  return (
    ISLAND_R *
    (1 +
      0.1 * Math.sin(2 * th + 0.6) +
      0.06 * Math.sin(3 * th + 2.1) +
      0.035 * Math.sin(5 * th + 1.0) +
      0.02 * Math.sin(9 * th + 0.3))
  );
}

/** How cliffy the grass bank is at a given angle (back-left gets a little rock wall). */
function cliffiness(th: number) {
  return smoothstep(0.2, 0.9, Math.cos(th - 3.6)) * 0.85;
}

const CLIFF_IN = (() => {
  const l = Math.hypot(CLIFF.x, CLIFF.z);
  return { x: -CLIFF.x / l, z: -CLIFF.z / l };
})();

function mesaMask(x: number, z: number) {
  const dx = x - CLIFF.x;
  const dz = z - CLIFF.z;
  const len = Math.hypot(dx, dz) || 1;
  // stretched along the coast, lumpy outline
  const ax = dx * 0.78 + dz * 0.62;
  const az = -dx * 0.62 + dz * 0.78;
  const dist = Math.hypot(ax * 0.82, az * 1.08) + fbm(x * 0.32 + 7, z * 0.32) * 1.3;
  // the side facing the island center rolls down gently, the sea side drops as a cliff
  const facing = smoothstep(-0.1, 0.8, (dx * CLIFF_IN.x + dz * CLIFF_IN.z) / len);
  const width = 0.55 + facing * 2.6;
  const m = smoothstep(CLIFF.r + width * 0.6, CLIFF.r - width * 0.4, dist);
  const k = m * 3;
  const f = k - Math.floor(k);
  const terraced = (Math.floor(k) + smoothstep(0.25, 0.75, f)) / 3;
  return terraced * (1 - facing) + m * facing;
}

function rawHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const th = Math.atan2(z, x);
  const R = islandRadius(th) * (1 + 0.05 * fbm(x * 0.15, z * 0.15));
  const d = r / R;
  const bankW = lerp(0.24, 0.045, cliffiness(th));
  const beach = 0.42 * smoothstep(1.02, 0.8, d);
  const bank = 0.7 * smoothstep(0.76, 0.76 - bankW, d);
  const hills = (0.5 + 0.5 * fbm(x * 0.17 + 3, z * 0.17 - 1)) * 0.6 * smoothstep(0.7, 0.3, d);
  const sea = -3.8 * smoothstep(1.0, 1.8, d);
  let h = -0.28 + beach + bank + hills + sea;
  h += 0.035 * fbm(x * 1.4, z * 1.4, 2) * smoothstep(0.65, 0.9, d);

  const m = mesaMask(x, z);
  if (m > 0) {
    const top = CLIFF.top + 0.18 * fbm(x * 0.4, z * 0.4);
    h = lerp(h, Math.max(h, top), m);
  }
  return h;
}

const CABIN_BASE = rawHeight(CABIN.x, CABIN.z) + 0.02;
export const POND_LEVEL = rawHeight(POND.x, POND.z) - 0.14;

export function pondMask(x: number, z: number) {
  return smoothstep(POND.r + 0.35, POND.r - 0.45, Math.hypot(x - POND.x, z - POND.z));
}

export function height(x: number, z: number) {
  let h = rawHeight(x, z);
  const cm = smoothstep(1.55, 1.0, Math.hypot(x - CABIN.x, z - CABIN.z));
  if (cm > 0) h = lerp(h, CABIN_BASE, cm);
  const pm = pondMask(x, z);
  if (pm > 0) h -= 0.62 * pm;
  return h;
}

/** Lowest ground under a circular footprint, so wide things sit into slopes instead of hovering. */
export function groundMin(x: number, z: number, r: number) {
  let m = height(x, z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    m = Math.min(m, height(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return m;
}

export function normalAt(x: number, z: number, out = new Vector3()) {
  const e = 0.08;
  const hx = height(x + e, z) - height(x - e, z);
  const hz = height(x, z + e) - height(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

export function inPond(x: number, z: number) {
  return Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.15 && height(x, z) < POND_LEVEL;
}

/** Water surface level at (x, z), or null when that spot is dry land. */
export function waterLevelAt(x: number, z: number): number | null {
  const h = height(x, z);
  if (inPond(x, z)) return POND_LEVEL;
  if (h < 0) return 0;
  return null;
}

/* ---------- dock (computed from the shoreline) ---------- */
function shoreRadiusAlong(angle: number) {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  for (let r = 4; r < 20; r += 0.05) {
    if (rawHeight(dx * r, dz * r) < 0) return r;
  }
  return 10;
}

const shoreR = shoreRadiusAlong(DOCK_ANGLE);
export const DOCK = (() => {
  const dir = { x: Math.cos(DOCK_ANGLE), z: Math.sin(DOCK_ANGLE) };
  const r0 = shoreR - 1.6;
  const r1 = shoreR + 3.6;
  return {
    dir,
    start: { x: dir.x * r0, z: dir.z * r0 },
    end: { x: dir.x * r1, z: dir.z * r1 },
    length: r1 - r0,
    deck: Math.max(0.5, rawHeight(dir.x * r0, dir.z * r0) + 0.12),
    rot: Math.atan2(dir.x, dir.z),
  };
})();

/* ---------- path from cabin door to dock ---------- */
const front = { x: Math.sin(CABIN.rot), z: Math.cos(CABIN.rot) };
export const DOOR = {
  x: CABIN.x + front.x * (CABIN.d / 2 + 0.05) + Math.cos(CABIN.rot) * -0.3,
  z: CABIN.z + front.z * (CABIN.d / 2 + 0.05) - Math.sin(CABIN.rot) * -0.3,
};
export const PATH = [
  { x: DOOR.x + front.x * 0.3, z: DOOR.z + front.z * 0.3 },
  { x: -2.6, z: 2.7 },
  { x: -3.9, z: 3.7 },
  { x: DOCK.start.x + 0.2, z: DOCK.start.z - 0.2 },
];

export function distToPath(x: number, z: number) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz));
    const px = a.x + abx * t - x;
    const pz = a.z + abz * t - z;
    best = Math.min(best, Math.hypot(px, pz));
  }
  return best;
}

/** Normalized distance from island center (1 ≈ outer shallow edge). */
export function islandD(x: number, z: number) {
  return Math.hypot(x, z) / islandRadius(Math.atan2(z, x));
}

export { mesaMask };

/* ---------- height texture for the water shader ---------- */
export const HEIGHT_TEX_SIZE = 64; // world units covered
let heightTex: DataTexture | null = null;
export function getHeightTexture() {
  if (heightTex) return heightTex;
  const res = 256;
  const data = new Uint16Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = (i / (res - 1) - 0.5) * HEIGHT_TEX_SIZE;
      const z = (j / (res - 1) - 0.5) * HEIGHT_TEX_SIZE;
      let h = height(x, z);
      if (inPond(x, z)) h = 2; // pond is not ocean
      data[j * res + i] = DataUtils.toHalfFloat(h);
    }
  }
  const tex = new DataTexture(data, res, res, RedFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  heightTex = tex;
  return tex;
}
