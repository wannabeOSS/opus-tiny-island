"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { on, world } from "../../lib/world";

class Pool {
  n: number;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  life: Float32Array;
  max: Float32Array;
  grow: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  base: Float32Array;
  wind: Float32Array;
  amax: Float32Array;
  cursor = 0;
  geo: BufferGeometry;
  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(-999);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.grow = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.base = new Float32Array(n);
    this.wind = new Float32Array(n);
    this.amax = new Float32Array(n);
    this.geo = new BufferGeometry();
    const p = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    const c = new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage);
    const s = new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage);
    const a = new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("position", p);
    this.geo.setAttribute("aColor", c);
    this.geo.setAttribute("aSize", s);
    this.geo.setAttribute("aAlpha", a);
  }
  spawn(o: SpawnOpts) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx ?? 0;
    this.vel[i * 3 + 1] = o.vy ?? 0;
    this.vel[i * 3 + 2] = o.vz ?? 0;
    this.col[i * 3] = o.color.r;
    this.col[i * 3 + 1] = o.color.g;
    this.col[i * 3 + 2] = o.color.b;
    this.base[i] = o.size;
    this.size[i] = o.size;
    this.life[i] = 0;
    this.max[i] = o.life;
    this.grow[i] = o.grow ?? 0;
    this.grav[i] = o.gravity ?? 9;
    this.drag[i] = o.drag ?? 0.5;
    this.alpha[i] = 0.001;
    this.amax[i] = o.alpha ?? 1;
    this.wind[i] = o.wind ?? 0;
  }
  update(dt: number) {
    const { pos, vel, life, max, size, alpha, base, grow, grav, drag, wind, amax } = this;
    const wx = world.wind.x;
    const wz = world.wind.y;
    for (let i = 0; i < this.n; i++) {
      if (life[i] >= max[i]) {
        if (alpha[i] !== 0) {
          alpha[i] = 0;
          pos[i * 3 + 1] = -999;
        }
        continue;
      }
      life[i] += dt;
      const t = life[i] / max[i];
      const k = Math.exp(-drag[i] * dt);
      vel[i * 3] = vel[i * 3] * k + wx * wind[i] * dt;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt;
      vel[i * 3 + 2] = vel[i * 3 + 2] * k + wz * wind[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = base[i] * (1 + grow[i] * t);
      alpha[i] = amax[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
    }
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as BufferAttribute).needsUpdate = true;
  }
}

type SpawnOpts = {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  color: Color;
  size: number;
  life: number;
  grow?: number;
  gravity?: number;
  drag?: number;
  alpha?: number;
  wind?: number;
};

export const pools = {
  soft: new Pool(1400),
  glow: new Pool(500),
};

const vert = /* glsl */ `
attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
uniform float uScale;
varying vec3 vColor; varying float vAlpha;
void main(){
  vColor = aColor; vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
uniform float uSoft;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.5 - uSoft, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function makeMat(additive: boolean, soft: number) {
  return new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    uniforms: { uScale: { value: 300 }, uSoft: { value: soft } },
  });
}

export function Particles() {
  const { size, viewport } = useThree();
  const softPts = useMemo(() => {
    const p = new Points(pools.soft.geo, makeMat(false, 0.25));
    p.frustumCulled = false;
    p.renderOrder = 5;
    p.raycast = () => null;
    return p;
  }, []);
  const glowPts = useMemo(() => {
    const p = new Points(pools.glow.geo, makeMat(true, 0.5));
    p.frustumCulled = false;
    p.renderOrder = 6;
    p.raycast = () => null;
    return p;
  }, []);

  useEffect(
    () =>
      on("leaves", ({ pos, n, color, spread = 0.8 }) => {
        const base = new Color(color ?? "#8fb84e");
        for (let i = 0; i < n; i++) {
          c.copy(base).offsetHSL((rnd() - 0.5) * 0.05, 0, (rnd() - 0.5) * 0.12);
          pools.soft.spawn({
            x: pos.x + (rnd() - 0.5) * spread * 1.4,
            y: pos.y + (rnd() - 0.5) * spread * 0.6,
            z: pos.z + (rnd() - 0.5) * spread * 1.4,
            vx: (rnd() - 0.5) * 0.8,
            vy: 0.3 + rnd() * 0.6,
            vz: (rnd() - 0.5) * 0.8,
            color: c.clone(),
            size: 0.07 + rnd() * 0.05,
            life: 2.2 + rnd() * 1.6,
            gravity: 0.9,
            drag: 1.6,
            wind: 2.4,
          });
        }
      }),
    [],
  );

  useFrame((_, dt) => {
    const d = Math.min(dt, 1 / 20);
    pools.soft.update(d);
    pools.glow.update(d);
    const scale = size.height * viewport.dpr * 0.5;
    (softPts.material as ShaderMaterial).uniforms.uScale.value = scale;
    (glowPts.material as ShaderMaterial).uniforms.uScale.value = scale;
  });

  return (
    <>
      <primitive object={softPts} />
      <primitive object={glowPts} />
    </>
  );
}

/* ---------------- spawn helpers ---------------- */
const white = new Color("#f4fbff");
const foam = new Color("#d9f1f4");
const c = new Color();
const rnd = Math.random;

export function spawnSplash(p: Vector3, strength: number) {
  const n = Math.round(10 + strength * 36);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const s = (0.6 + rnd() * 1.6) * (0.6 + strength);
    pools.soft.spawn({
      x: p.x + Math.cos(a) * 0.08,
      y: Math.max(p.y, 0) + 0.02,
      z: p.z + Math.sin(a) * 0.08,
      vx: Math.cos(a) * s * 0.7,
      vy: (2.2 + rnd() * 3.2) * (0.5 + strength * 0.8),
      vz: Math.sin(a) * s * 0.7,
      color: rnd() < 0.5 ? white : foam,
      size: 0.05 + rnd() * 0.07 + strength * 0.03,
      life: 0.5 + rnd() * 0.5,
      gravity: 11,
      drag: 0.6,
    });
  }
}

export function spawnDust(p: Vector3, color: Color, strength: number) {
  const n = Math.round(4 + strength * 12);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    pools.soft.spawn({
      x: p.x,
      y: p.y + 0.03,
      z: p.z,
      vx: Math.cos(a) * (0.4 + rnd()) * strength,
      vy: 0.5 + rnd() * 1.2 * strength,
      vz: Math.sin(a) * (0.4 + rnd()) * strength,
      color,
      size: 0.06 + rnd() * 0.08,
      life: 0.5 + rnd() * 0.5,
      gravity: 2.5,
      drag: 2.5,
      grow: 1.5,
      alpha: 0.7,
    });
  }
}

export function spawnSparkle(p: Vector3, n: number, color: Color, spread = 0.4, up = 1) {
  for (let i = 0; i < n; i++) {
    pools.glow.spawn({
      x: p.x + (rnd() - 0.5) * spread,
      y: p.y + (rnd() - 0.5) * spread,
      z: p.z + (rnd() - 0.5) * spread,
      vx: (rnd() - 0.5) * 0.8,
      vy: (0.3 + rnd() * 0.9) * up,
      vz: (rnd() - 0.5) * 0.8,
      color,
      size: 0.08 + rnd() * 0.12,
      life: 0.9 + rnd() * 1.2,
      gravity: -0.1,
      drag: 1.2,
    });
  }
}

export function spawnPetals(p: Vector3, color: Color, n = 8) {
  for (let i = 0; i < n; i++) {
    c.copy(color).offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.1);
    pools.soft.spawn({
      x: p.x,
      y: p.y,
      z: p.z,
      vx: (rnd() - 0.5) * 1.6,
      vy: 0.8 + rnd() * 1.4,
      vz: (rnd() - 0.5) * 1.6,
      color: c.clone(),
      size: 0.06 + rnd() * 0.05,
      life: 1.4 + rnd(),
      gravity: 1.2,
      drag: 2.0,
      wind: 2.5,
    });
  }
}

const smokeCol = new Color();
export function spawnSmoke(p: Vector3, tone: number, amount = 1) {
  smokeCol.setRGB(0.78 * tone, 0.78 * tone, 0.8 * tone);
  pools.soft.spawn({
    x: p.x + (rnd() - 0.5) * 0.05,
    y: p.y,
    z: p.z + (rnd() - 0.5) * 0.05,
    vx: (rnd() - 0.5) * 0.1,
    vy: 0.35 + rnd() * 0.2,
    vz: (rnd() - 0.5) * 0.1,
    color: smokeCol.clone(),
    size: 0.16 * amount,
    life: 3.2 + rnd() * 1.5,
    grow: 4,
    gravity: -0.05,
    drag: 0.4,
    wind: 0.9,
    alpha: 0.55,
  });
}
