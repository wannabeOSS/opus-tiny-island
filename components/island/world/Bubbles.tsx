"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, InstancedBufferAttribute, InstancedMesh, Object3D, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { colliders } from "../lib/colliders";
import { height, inPond, POND_LEVEL } from "../lib/terrain";
import { toolState } from "../lib/tools";
import { addPondRipple, addRipple, sfx, U, waveHeight, world } from "../lib/world";
import { spawnSparkle } from "./effects/Particles";

export type Bubble = { pos: Vector3; vel: Vector3; r: number; age: number; life: number; seed: number; dead: boolean; hunted: boolean };

const MAX = 70;
export const bubbles: Bubble[] = [];
const FILM = new Color("#cfe8ff");

export function blowBubble(pos: Vector3, vel: Vector3, r = 0.08 + Math.random() * 0.1) {
  if (bubbles.length >= MAX) popBubble(bubbles.shift()!, true);
  bubbles.push({ pos: pos.clone(), vel: vel.clone(), r, age: 0, life: 7 + Math.random() * 7, seed: Math.random(), dead: false, hunted: false });
}

export function popBubble(b: Bubble, quiet = false) {
  if (b.dead) return;
  b.dead = true;
  if (quiet) return;
  sfx("bubble", b.pos, 0.35 + b.r * 2, 1.3 - b.r * 2 + Math.random() * 0.2);
  spawnSparkle(b.pos, 4 + Math.round(b.r * 30), FILM, b.r * 1.4, 0.35);
}

/** Pops every bubble within `radius` of `pos`; returns how many. */
export function popNear(pos: Vector3, radius: number) {
  let n = 0;
  for (const b of bubbles) {
    if (!b.dead && b.pos.distanceTo(pos) < radius + b.r) {
      popBubble(b);
      n++;
    }
  }
  return n;
}

const vert = /* glsl */ `
attribute float aSeed;
varying vec3 vN;
varying vec3 vV;
varying float vSeed;
void main(){
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform float uTime;
uniform vec3 uSunV;
uniform float uNight;
varying vec3 vN;
varying vec3 vV;
varying float vSeed;
vec3 film(float t){
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndv = abs(dot(n, vV));
  float fres = pow(1.0 - ndv, 2.2);
  // swirling thin-film colours, strongest toward the rim
  float swirl = sin(n.x * 6.0 + uTime * 0.7 + vSeed * 20.0) * 0.08 + sin(n.y * 9.0 - uTime * 0.5) * 0.06;
  vec3 col = film(fres * 1.4 + vSeed + swirl + uTime * 0.03);
  vec3 r = reflect(-vV, n);
  float glint = pow(max(dot(r, uSunV), 0.0), 80.0) * (1.0 - uNight * 0.7);
  float a = 0.1 + fres * 0.75;
  vec3 c = mix(vec3(0.85, 0.93, 1.0), col, 0.75) * (0.35 + fres * 0.9) * (1.0 - uNight * 0.55);
  gl_FragColor = vec4(c + glint * 1.6, a + glint);
}`;

const dummy = new Object3D();
const proj = new Vector3();

export function Bubbles() {
  const mesh = useRef<InstancedMesh>(null);
  const { camera, size } = useThree();
  const { geo, mat } = useMemo(() => {
    const g = new SphereGeometry(1, 20, 14);
    g.setAttribute("aSeed", new InstancedBufferAttribute(new Float32Array(MAX), 1));
    const m = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: 2,
      uniforms: { uTime: U.uTime, uSunV: { value: new Vector3(0, 1, 0) }, uNight: U.uNight },
    });
    return { geo: g, mat: m };
  }, []);

  useFrame((_, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 1 / 20);
    const t = world.elapsed;
    mat.uniforms.uSunV.value.copy(world.sunDir).transformDirection(camera.matrixWorldInverse);
    const windX = world.wind.x * 0.35 + world.breeze.x * 0.5;
    const windZ = world.wind.y * 0.35 + world.breeze.y * 0.5;
    const ndc = toolState.ndc;
    const sweeping = world.pointerSpeed > 150;

    for (const b of bubbles) {
      if (b.dead) continue;
      b.age += dt;
      b.vel.x += (windX - b.vel.x) * dt * 0.6 + Math.sin(t * 1.3 + b.seed * 30) * dt * 0.15;
      b.vel.z += (windZ - b.vel.z) * dt * 0.6 + Math.cos(t * 1.1 + b.seed * 20) * dt * 0.15;
      b.vel.y += (0.12 - b.vel.y) * dt * 0.8 + Math.sin(t * 2.1 + b.seed * 10) * dt * 0.1;
      b.pos.addScaledVector(b.vel, dt);
      const { x, z } = b.pos;
      const h = height(x, z);
      const pond = inPond(x, z);
      const floor = pond ? POND_LEVEL : h < 0.05 ? waveHeight(x, z, t, -h) : h;
      if (b.pos.y - b.r < floor) {
        if (pond) addPondRipple(x, z, 0.12);
        else if (h < 0.05) addRipple(x, z, 0.1);
        popBubble(b);
        continue;
      }
      if (b.age > b.life || Math.hypot(x, z) > 40) {
        popBubble(b);
        continue;
      }
      for (const c of colliders) {
        if (b.pos.y < c.bottom || b.pos.y > c.top + b.r) continue;
        if (Math.hypot(x - c.x, z - c.z) < c.r * (c.surface === "leaf" ? 0.75 : 1) + b.r) {
          popBubble(b);
          break;
        }
      }
      if (b.dead || !sweeping || ndc.y < -1.5) continue;
      // the cursor pops bubbles it sweeps through
      proj.copy(b.pos).project(camera);
      if (proj.z > 1) continue;
      const dx = ((proj.x - ndc.x) * size.width) / 2;
      const dy = ((proj.y - ndc.y) * size.height) / 2;
      const rpx = Math.max(12, (b.r / Math.max(0.5, camera.position.distanceTo(b.pos))) * size.height * 1.4);
      if (dx * dx + dy * dy < rpx * rpx) popBubble(b);
    }
    for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].dead) bubbles.splice(i, 1);

    const seeds = geo.attributes.aSeed as InstancedBufferAttribute;
    bubbles.forEach((b, i) => {
      const grow = Math.min(1, b.age / 0.18);
      const w = Math.sin(t * 7 + b.seed * 40) * 0.07 * grow;
      dummy.position.copy(b.pos);
      dummy.rotation.set(b.seed * 3, t * 0.3 + b.seed * 6, 0);
      dummy.scale.set(b.r * grow * (1 + w), b.r * grow * (1 - w), b.r * grow * (1 + w * 0.5));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      seeds.setX(i, b.seed);
    });
    m.count = Math.min(bubbles.length, MAX);
    m.instanceMatrix.needsUpdate = true;
    seeds.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, MAX]} frustumCulled={false} raycast={() => null} renderOrder={6} />;
}
