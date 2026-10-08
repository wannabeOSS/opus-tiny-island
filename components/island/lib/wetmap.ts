import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from "three";

/** Per-spot soil wetness from rain and the pocket cloud, covering the island in world xz. */
export const WET_SIZE = 32; // world units
const RES = 96;
const data = new Uint8Array(RES * RES);
const values = new Float32Array(RES * RES);

export const wetTexture = new DataTexture(data, RES, RES, RedFormat, UnsignedByteType);
wetTexture.magFilter = LinearFilter;
wetTexture.minFilter = LinearFilter;
wetTexture.needsUpdate = true;

let dirty = false;
let acc = 0;

export function wetAt(x: number, z: number) {
  const i = Math.round((x / WET_SIZE + 0.5) * (RES - 1));
  const j = Math.round((z / WET_SIZE + 0.5) * (RES - 1));
  if (i < 0 || j < 0 || i >= RES || j >= RES) return 0;
  return values[j * RES + i];
}

export function addWet(x: number, z: number, radius: number, amount: number) {
  const cx = (x / WET_SIZE + 0.5) * (RES - 1);
  const cz = (z / WET_SIZE + 0.5) * (RES - 1);
  const r = (radius / WET_SIZE) * RES;
  const r0 = Math.ceil(r);
  for (let j = Math.floor(cz - r0); j <= cz + r0; j++) {
    for (let i = Math.floor(cx - r0); i <= cx + r0; i++) {
      if (i < 0 || j < 0 || i >= RES || j >= RES) continue;
      const d = Math.hypot(i - cx, j - cz) / r;
      if (d > 1) continue;
      const k = j * RES + i;
      values[k] = Math.max(0, Math.min(1, values[k] + amount * (1 - d * d)));
    }
  }
  dirty = true;
}

/** Slowly dries; call every frame. */
export function updateWet(dt: number, rain: number) {
  acc += dt;
  if (acc < 0.2 && !dirty) return;
  const dry = acc * (rain > 0.3 ? 0 : 0.018);
  acc = 0;
  if (dry > 0 && acc === 0) {
    for (let k = 0; k < values.length; k++) {
      if (values[k] > 0) {
        values[k] = Math.max(0, values[k] - dry);
        dirty = true;
      }
    }
  }
  if (dirty) {
    for (let k = 0; k < values.length; k++) data[k] = values[k] * 255;
    wetTexture.needsUpdate = true;
    dirty = false;
  }
}

export function clearWet() {
  values.fill(0);
  dirty = true;
}
