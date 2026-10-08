"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { merge, place, prep } from "../../lib/geo";
import { POND } from "../../lib/layout";
import { angleDelta, clamp, mulberry32 } from "../../lib/math";
import { discover } from "../../lib/secrets";
import { height, inPond, POND_LEVEL } from "../../lib/terrain";
import { U, addPondRipple, addRipple, emit, on, sfx, waveHeight, world } from "../../lib/world";
import { bubbles, popBubble, type Bubble } from "../Bubbles";
import { spawnSparkle, spawnSplash } from "../effects/Particles";

type Fish = {
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  tx: number;
  tz: number;
  flee: number;
  jump: number; // >0 while airborne (0..1)
  jx: number;
  jz: number;
  size: number;
  color: Color;
  golden: boolean;
  pond: boolean;
  retarget: number;
  /** the bubble this fish is leaping for */
  prey: Bubble | null;
};

type Food = { pos: Vector3; left: number; pond: boolean; t: number };

const GOLD = new Color("#ffc23a");

function fishGeometry() {
  const body = new SphereGeometry(0.5, 10, 7);
  place(body, [0, 0, 0], [0, 0, 0], [0.32, 0.38, 1]);
  const tail = new ConeGeometry(0.22, 0.34, 4);
  place(tail, [0, 0, -0.62], [-Math.PI / 2, 0, 0], [0.25, 1, 1.2]);
  const fin = new ConeGeometry(0.1, 0.25, 3);
  place(fin, [0, 0.2, 0], [0, 0, 0], [0.2, 1, 0.9]);
  const g = merge([prep(body, new Color("#ffffff")), prep(tail, new Color("#f0f0f0")), prep(fin, new Color("#e8e8e8"))]);
  return g as BufferGeometry;
}

function wiggle(mat: MeshStandardMaterial) {
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      float ph = float(gl_InstanceID) * 1.37;
      float back = clamp(-transformed.z, 0.0, 1.0);
      transformed.x += sin(uTime * 9.0 + ph - transformed.z * 4.0) * (0.04 + back * back * 0.22);
      `,
    );
  };
  return mat;
}

const SEA_N = 16;
const POND_N = 3;

function validSea(x: number, z: number) {
  const h = height(x, z);
  return h < -0.35 && h > -2.4 && Math.hypot(x, z) < 21;
}

/** A bubble drifting low over the sea near this fish, worth swimming under. */
function lureFor(f: Fish) {
  for (const b of bubbles) {
    if (b.dead || b.hunted || b.pos.y > 1.05) continue;
    if (Math.hypot(b.pos.x - f.x, b.pos.z - f.z) < 6 && height(b.pos.x, b.pos.z) < -0.5) return b;
  }
  return null;
}

/** One helping eaten; enough of them and the golden fish shows up. */
function fed(f: Fish, at: Vector3) {
  if (f.pond) return;
  world.fishFed++;
  if (world.fishFed < 4 || world.goldenFish) return;
  world.goldenFish = true;
  f.golden = true;
  f.size = 0.34;
  f.color.copy(GOLD);
  if (f.jump <= 0) {
    f.jump = 0.0001;
    f.jx = f.x;
    f.jz = f.z;
  }
  spawnSparkle(new Vector3(f.x, 0.2, f.z), 24, GOLD, 0.6, 1);
  sfx("sparkle", at, 0.8);
  discover("goldfish");
}

export function Fish() {
  const mesh = useRef<InstancedMesh>(null);
  const shadows = useRef<InstancedMesh>(null);
  const geo = useMemo(() => fishGeometry(), []);
  const mat = useMemo(() => wiggle(new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 })), []);
  const shadowMat = useMemo(() => new MeshBasicMaterial({ color: "#16343a", transparent: true, opacity: 0.18, depthWrite: false }), []);
  const shadowGeo = useMemo(() => new CircleGeometry(0.5, 12).rotateX(-Math.PI / 2), []);
  const dummy = useMemo(() => new Object3D(), []);
  const food = useRef<Food[]>([]);
  const st = useRef({ jumpT: 8, fedSessions: 0, bubbleT: 0 });
  const gather = useRef<{ pos: Vector3; until: number; pond: boolean } | null>(null);

  const fish = useMemo<Fish[]>(() => {
    const rnd = mulberry32(404);
    const out: Fish[] = [];
    const seaCols = ["#e9884a", "#9fb7c4", "#c6d2d6", "#e8b251", "#8aa6b8", "#f0a37a"];
    let tries = 0;
    while (out.length < (world.mobile ? 10 : SEA_N) && tries++ < 2000) {
      const a = rnd() * Math.PI * 2;
      const r = 11 + rnd() * 8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!validSea(x, z)) continue;
      out.push({
        x, z, y: -0.4, heading: rnd() * 6, speed: 0.5, tx: x, tz: z, flee: 0, jump: 0, jx: 0, jz: 0,
        size: 0.2 + rnd() * 0.12,
        color: new Color(seaCols[Math.floor(rnd() * seaCols.length)]),
        golden: false, pond: false, retarget: 0, prey: null,
      });
    }
    const koi = ["#f08a3c", "#fbfbf6", "#e8502e"];
    for (let i = 0; i < POND_N; i++) {
      const a = (i / POND_N) * Math.PI * 2;
      out.push({
        x: POND.x + Math.cos(a) * 0.5, z: POND.z + Math.sin(a) * 0.5, y: POND_LEVEL - 0.07, heading: a + 1.6, speed: 0.3,
        tx: POND.x, tz: POND.z, flee: 0, jump: 0, jx: 0, jz: 0, size: 0.17, color: new Color(koi[i]), golden: false, pond: true, retarget: 0, prey: null,
      });
    }
    return out;
  }, []);

  useEffect(() => {
    const scare = (pos: Vector3, radius: number) => {
      for (const f of fish) {
        const dx = f.x - pos.x;
        const dz = f.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < radius + 1.5 && f.jump <= 0) {
          f.flee = 1.4;
          f.heading = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.6;
        }
      }
    };
    const offs = [
      on("splash", ({ pos, strength }) => scare(pos, 1 + strength * 3)),
      on("disturb", ({ pos, radius }) => {
        if (height(pos.x, pos.z) < 0.05 || inPond(pos.x, pos.z)) scare(pos, radius * 0.6);
      }),
      on("crumbs", ({ pos, water }) => {
        if (!water) return;
        const pond = inPond(pos.x, pos.z);
        const near = food.current.find((f) => f.pos.distanceTo(pos) < 0.8);
        if (near) near.left += 2;
        else food.current.push({ pos: pos.clone(), left: 3, pond, t: world.elapsed });
      }),
      on("food", ({ pos }) => {
        food.current.push({ pos: pos.clone(), left: 4, pond: inPond(pos.x, pos.z), t: world.elapsed });
      }),
      on("conch", ({ pos, sea }) => {
        const pond = inPond(pos.x, pos.z);
        if (!sea && !pond) return;
        gather.current = { pos: pos.clone(), until: world.elapsed + 9, pond };
        const near = fish.some((f) => f.pond === pond && Math.hypot(f.x - pos.x, f.z - pos.z) < 10);
        if (near) setTimeout(() => emit("conchAnswer", { who: "fish" }), 1300);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [fish]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = world.elapsed;
    const m = mesh.current;
    const sh = shadows.current;
    if (!m || !sh) return;
    const foods = food.current;
    for (let i = foods.length - 1; i >= 0; i--) if (foods[i].left <= 0 || t - foods[i].t > 40) foods.splice(i, 1);

    // an occasional leap, more often in rain and at dusk
    const s = st.current;
    s.jumpT -= dt * (1 + world.w.rain * 1.5 + (world.daylight < 0.7 && world.daylight > 0.1 ? 1 : 0));
    if (s.jumpT < 0) {
      s.jumpT = 9 + Math.random() * 16;
      const cands = fish.filter((f) => !f.pond && f.jump <= 0 && height(f.x, f.z) < -0.7);
      const f = cands[Math.floor(Math.random() * cands.length)];
      if (f) {
        f.jump = 0.0001;
        f.jx = f.x;
        f.jz = f.z;
      }
    }

    // fish leap for bubbles drifting low over the water
    s.bubbleT -= dt;
    if (s.bubbleT < 0 && bubbles.length) {
      s.bubbleT = 0.4;
      for (const b of bubbles) {
        if (b.dead || b.hunted || b.pos.y > 1.05 || height(b.pos.x, b.pos.z) > -0.5) continue;
        let best: Fish | null = null;
        let bd = 1.4;
        for (const f of fish) {
          if (f.pond || f.jump > 0 || f.flee > 0) continue;
          const d = Math.hypot(f.x - b.pos.x, f.z - b.pos.z);
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
        if (!best) continue;
        b.hunted = true;
        best.prey = b;
        best.heading = Math.atan2(b.pos.x - best.x, b.pos.z - best.z);
        best.jx = b.pos.x - Math.sin(best.heading) * 0.65;
        best.jz = b.pos.z - Math.cos(best.heading) * 0.65;
        best.jump = 0.0001;
        break;
      }
    }

    fish.forEach((f, i) => {
      if (f.jump > 0) {
        // leap: a little arc out of the water
        const prev = f.jump;
        f.jump += dt / 0.85;
        const p = Math.min(1, f.jump);
        f.x = f.jx + Math.sin(f.heading) * p * 1.3;
        f.z = f.jz + Math.cos(f.heading) * p * 1.3;
        f.y = -0.3 + Math.sin(p * Math.PI) * (0.75 + f.size);
        if (f.prey && prev < 0.5 && f.jump >= 0.5) {
          const b = f.prey;
          f.prey = null;
          if (!b.dead && Math.hypot(b.pos.x - f.x, b.pos.z - f.z) < 0.7) {
            popBubble(b);
            fed(f, b.pos);
          }
        }
        if (prev < 0.12 && f.jump >= 0.12) {
          spawnSplash(new Vector3(f.x, 0, f.z), 0.25);
          addRipple(f.x, f.z, 0.4);
          sfx("plop", new Vector3(f.x, 0, f.z), 0.5, 1.4);
        }
        if (f.jump >= 1) {
          f.jump = 0;
          spawnSplash(new Vector3(f.x, 0, f.z), 0.35);
          addRipple(f.x, f.z, 0.6);
          sfx("splash", new Vector3(f.x, 0, f.z), 0.35, 1.3);
          if (f.golden) spawnSparkle(new Vector3(f.x, 0.1, f.z), 10, GOLD, 0.3, 0.6);
        }
      } else {
        // pick a target: food, wander
        let target: Food | null = null;
        let best = f.pond ? 3 : 9;
        for (const fd of foods) {
          if (fd.pond !== f.pond) continue;
          const d = Math.hypot(fd.pos.x - f.x, fd.pos.z - f.z);
          if (d < best) {
            best = d;
            target = fd;
          }
        }
        f.retarget -= dt;
        if (target && f.flee <= 0) {
          f.tx = target.pos.x;
          f.tz = target.pos.z;
          if (best < 0.25 + f.size) {
            target.left -= dt * 1.5;
            if (Math.random() < dt * 3) {
              if (f.pond) addPondRipple(f.x, f.z, 0.15);
              else addRipple(f.x, f.z, 0.1);
              sfx("bloop", target.pos, 0.3, 1.4 + Math.random() * 0.4);
            }
            if (target.left <= 0 && !f.pond) fed(f, target.pos);
          }
        } else if (!f.pond && f.flee <= 0 && lureFor(f)) {
          const b = lureFor(f)!;
          f.tx = b.pos.x;
          f.tz = b.pos.z;
        } else if (gather.current && gather.current.until > t && gather.current.pond === f.pond && Math.hypot(gather.current.pos.x - f.x, gather.current.pos.z - f.z) < 10 && f.flee <= 0) {
          // circle round whoever blew the conch
          const gp = gather.current.pos;
          const a = t * 0.6 + i * 1.7;
          const rr = f.pond ? 0.35 : 0.7 + (i % 3) * 0.25;
          f.tx = gp.x + Math.cos(a) * rr;
          f.tz = gp.z + Math.sin(a) * rr;
          if (!f.pond && !validSea(f.tx, f.tz)) {
            f.tx = f.x;
            f.tz = f.z;
          }
        } else if (f.retarget < 0 || Math.hypot(f.tx - f.x, f.tz - f.z) < 0.4) {
          f.retarget = 4 + Math.random() * 6;
          for (let k = 0; k < 12; k++) {
            if (f.pond) {
              const a = Math.random() * Math.PI * 2;
              const r = Math.random() * (POND.r - 0.35);
              f.tx = POND.x + Math.cos(a) * r;
              f.tz = POND.z + Math.sin(a) * r;
              break;
            }
            const nx = f.x + (Math.random() - 0.5) * 6;
            const nz = f.z + (Math.random() - 0.5) * 6;
            if (validSea(nx, nz)) {
              f.tx = nx;
              f.tz = nz;
              break;
            }
          }
        }
        // steer
        const want = Math.atan2(f.tx - f.x, f.tz - f.z);
        if (f.flee <= 0) f.heading += angleDelta(f.heading, want) * Math.min(1, dt * (target ? 3 : 1.4));
        f.heading += Math.sin(t * 0.9 + i) * dt * 0.25;
        f.flee = Math.max(0, f.flee - dt);
        const sp = (f.pond ? 0.25 : 0.55) * (f.flee > 0 ? 5 : target ? 1.8 : 1) * (1 + world.w.rain * 0.4);
        f.speed += (sp - f.speed) * Math.min(1, dt * 4);
        let nx = f.x + Math.sin(f.heading) * f.speed * dt;
        let nz = f.z + Math.cos(f.heading) * f.speed * dt;
        if (f.pond) {
          const dx = nx - POND.x;
          const dz = nz - POND.z;
          const d = Math.hypot(dx, dz);
          if (d > POND.r - 0.3) {
            nx = POND.x + (dx / d) * (POND.r - 0.3);
            nz = POND.z + (dz / d) * (POND.r - 0.3);
            f.heading += Math.PI * 0.5 * dt * 4;
          }
          f.y = POND_LEVEL - 0.07;
        } else {
          if (!validSea(nx, nz)) {
            f.heading += Math.PI * dt * 2.5;
            nx = f.x;
            nz = f.z;
            f.retarget = 0;
          }
          const depth = -height(nx, nz);
          const surf = waveHeight(nx, nz, t, depth);
          f.y = surf - clamp(depth * 0.35, 0.22, 0.6);
        }
        f.x = nx;
        f.z = nz;
      }

      const pitch = f.jump > 0 ? -Math.cos(Math.min(1, f.jump) * Math.PI) * 0.9 : 0;
      dummy.position.set(f.x, f.y, f.z);
      dummy.rotation.set(pitch, f.heading, 0, "YXZ");
      dummy.scale.setScalar(f.size);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, f.color);

      // soft shadow on the bottom
      const gy = f.pond ? POND_LEVEL - 0.2 : height(f.x, f.z) + 0.02;
      dummy.position.set(f.x + 0.06, gy, f.z + 0.04);
      dummy.rotation.set(0, f.heading, 0);
      const fade = f.pond ? 0.3 : clamp(1 - (f.y - gy) * 0.4, 0.3, 1);
      dummy.scale.set(f.size * 0.5 * fade, 1, f.size * 1.1 * fade);
      dummy.updateMatrix();
      sh.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    sh.instanceMatrix.needsUpdate = true;
    shadowMat.opacity = 0.2 * world.daylight * (1 - world.w.cloud * 0.5);

    // golden fish glitters now and then
    const g = fish.find((f) => f.golden);
    if (g && Math.random() < dt * 2) spawnSparkle(new Vector3(g.x, g.y + 0.1, g.z), 1, GOLD, 0.2, 0.3);
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[geo, mat, fish.length]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={shadows} args={[shadowGeo, shadowMat, fish.length]} frustumCulled={false} raycast={() => null} renderOrder={1} />
    </group>
  );
}
