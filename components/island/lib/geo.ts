import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { noise2 } from "./math";

/** Normalizes a geometry so it can be merged with others (non-indexed, position/normal/color only). */
export function prep(g: BufferGeometry, color?: Color | ((p: Vector3, i: number) => Color)) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  geo.deleteAttribute("uv");
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (color) {
    const pos = geo.attributes.position as BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const c = typeof color === "function" ? color(v, i) : color;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new BufferAttribute(col, 3));
  }
  return geo;
}

export function merge(geos: BufferGeometry[]) {
  const m = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  return m;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
export function place(g: BufferGeometry, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1) {
  const s = typeof scale === "number" ? new Vector3(scale, scale, scale) : new Vector3(...scale);
  _q.setFromEuler(_e.set(...rot));
  _m.compose(new Vector3(...pos), _q, s);
  g.applyMatrix4(_m);
  return g;
}

/** A tapered, gently bent trunk with vertex-colored bark. */
export function trunk(opts: {
  h: number;
  r0: number;
  r1: number;
  bend?: [number, number];
  radial?: number;
  segs?: number;
  dark: Color;
  light: Color;
  seed?: number;
  rings?: number;
}) {
  const { h, r0, r1, bend = [0, 0], radial = 7, segs = 8, dark, light, seed = 1, rings = 0 } = opts;
  const g = new CylinderGeometry(1, 1, h, radial, segs, false);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y / h;
    const r = r0 + (r1 - r0) * t;
    const wob = 1 + noise2(v.x * 4 + seed, v.y * 3) * 0.12;
    v.x *= r * wob;
    v.z *= r * wob;
    v.x += bend[0] * t * t * h;
    v.z += bend[1] * t * t * h;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const c = new Color();
  return prep(g, (p) => {
    const t = p.y / h;
    c.copy(dark).lerp(light, 0.3 + 0.5 * (noise2(p.x * 9 + seed, p.y * 7) * 0.5 + 0.5));
    if (rings) {
      const band = Math.sin(t * rings * Math.PI * 2) * 0.5 + 0.5;
      c.lerp(dark, band * 0.35);
    }
    return c;
  });
}

/** A lumpy foliage blob, darker underneath. */
export function blob(opts: {
  r: number;
  detail?: number;
  lump?: number;
  seed?: number;
  bottom: Color;
  top: Color;
  squash?: number;
}) {
  const { r, detail = 2, lump = 0.22, seed = 1, bottom, top, squash = 0.85 } = opts;
  const ico = new IcosahedronGeometry(r, detail);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const g = mergeVertices(ico);
  ico.dispose();
  const pos = g.attributes.position as BufferAttribute;
  const v = new Vector3();
  // displace consistently for shared positions (non-indexed geometry)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = 1 + noise2(n.x * 2.2 + seed, n.y * 2.2 + n.z * 1.7) * lump + noise2(n.x * 5 + seed * 3, n.z * 5) * lump * 0.4;
    v.copy(n).multiplyScalar(r * d);
    v.y *= squash;
    if (v.y < -r * 0.45) v.y = -r * 0.45 + (v.y + r * 0.45) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const c = new Color();
  return prep(g, (p) => {
    const t = (p.y / r) * 0.5 + 0.5;
    c.copy(bottom).lerp(top, Math.pow(Math.max(0, Math.min(1, t)), 1.3));
    c.offsetHSL(noise2(p.x * 3 + seed, p.z * 3) * 0.012, 0, noise2(p.x * 6, p.z * 6 + seed) * 0.035);
    return c;
  });
}

export function colored(g: BufferGeometry, hex: string) {
  return prep(g, new Color(hex));
}

/** Bends normals toward "outward from the canopy center" — soft, painterly foliage lighting. */
export function sphericalNormals(g: BufferGeometry, center: Vector3, k = 0.75) {
  const pos = g.attributes.position as BufferAttribute;
  const nrm = g.attributes.normal as BufferAttribute;
  const p = new Vector3();
  const n = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    s.subVectors(p, center).normalize();
    n.lerp(s, k).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  return g;
}
