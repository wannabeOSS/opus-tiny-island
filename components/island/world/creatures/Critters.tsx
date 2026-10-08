"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { merge, place, prep } from "../../lib/geo";
import { POND } from "../../lib/layout";
import { angleDelta, mulberry32 } from "../../lib/math";
import { discover } from "../../lib/secrets";
import { distToPath, height, normalAt, POND_LEVEL } from "../../lib/terrain";
import { addPondRipple, emit, idleSeconds, markInput, on, sfx, world } from "../../lib/world";
import { hoverable, shown } from "../cursor";
import { spawnDust, spawnSparkle } from "../effects/Particles";
import { LILY_PADS } from "../Pond";

const SAND = new Color("#e3cf9f");

/* ---------------- crabs ---------------- */

const BEACH_SAMPLES = 256;
/** radius of dry sand along each angle (or 0 where there's no beach) */
const beachR = (() => {
  const out = new Float32Array(BEACH_SAMPLES);
  for (let i = 0; i < BEACH_SAMPLES; i++) {
    const a = (i / BEACH_SAMPLES) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let found = 0;
    for (let r = 6; r < 16; r += 0.05) {
      const h = height(dx * r, dz * r);
      if (h < 0.1) {
        // need a gentle sandy slope behind it
        const back = height(dx * (r - 0.6), dz * (r - 0.6));
        if (back < 0.5) found = r - 0.25;
        break;
      }
    }
    out[i] = found;
  }
  return out;
})();

function beachAt(a: number, out: Vector3) {
  const k = ((a / (Math.PI * 2)) % 1 + 1) % 1;
  const i = Math.floor(k * BEACH_SAMPLES);
  const r = beachR[i];
  out.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  out.y = height(out.x, out.z);
  return r > 0;
}

function crabGeometry() {
  const red = new Color("#e2593a");
  const dark = new Color("#b9412a");
  const body = new SphereGeometry(0.5, 12, 8);
  place(body, [0, 0.18, 0], [0, 0, 0], [1, 0.42, 0.75]);
  const clawL = new SphereGeometry(0.2, 8, 6);
  place(clawL, [0.48, 0.2, 0.42], [0, 0, 0], [1, 0.7, 1.2]);
  const clawR = new SphereGeometry(0.2, 8, 6);
  place(clawR, [-0.48, 0.2, 0.42], [0, 0, 0], [1, 0.7, 1.2]);
  const parts: BufferGeometry[] = [prep(body, (p) => (p.y > 0.25 ? red : dark))];
  for (const s of [1, -1]) {
    const stalk = new CapsuleGeometry(0.03, 0.14, 2, 5);
    place(stalk, [0.13 * s, 0.38, 0.22]);
    parts.push(prep(stalk, red));
    const eye = new SphereGeometry(0.065, 8, 6);
    place(eye, [0.13 * s, 0.48, 0.22]);
    parts.push(prep(eye, new Color("#1c1c1c")));
    for (let k = 0; k < 3; k++) {
      const leg = new CapsuleGeometry(0.035, 0.38, 2, 4);
      place(leg, [0.5 * s, 0.1, -0.15 + k * 0.17 - 0.1], [0, 0, s * 1.05]);
      parts.push(prep(leg, dark));
    }
  }
  return {
    body: merge(parts) as BufferGeometry,
    claw: merge([prep(clawL, red), prep(clawR, red)]) as BufferGeometry,
  };
}

type Crab = {
  a: number;
  dir: number;
  state: "walk" | "idle" | "hidden" | "snap";
  timer: number;
  sink: number;
  pokes: number;
  pokeT: number;
  snap: number;
  pos: Vector3;
  /** claws up and waving (answering the conch) rather than snapping */
  waving: boolean;
  /** wave as soon as it's back out of the sand */
  waveNext: boolean;
};

function Crabs() {
  const n = 3;
  const geo = useMemo(() => crabGeometry(), []);
  const mat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), []);
  const groups = useRef<(Group | null)[]>([]);
  const claws = useRef<(Mesh | null)[]>([]);
  const crabs = useMemo<Crab[]>(() => {
    const rnd = mulberry32(5);
    const out: Crab[] = [];
    const tmp = new Vector3();
    let tries = 0;
    while (out.length < n && tries++ < 500) {
      const a = rnd() * Math.PI * 2;
      if (!beachAt(a, tmp)) continue;
      out.push({ a, dir: rnd() < 0.5 ? 1 : -1, state: "idle", timer: rnd() * 3, sink: 0, pokes: 0, pokeT: 0, snap: 0, pos: tmp.clone(), waving: false, waveNext: false });
    }
    return out;
  }, []);

  useEffect(() => {
    const hide = (c: Crab) => {
      if (c.state === "hidden") return;
      c.state = "hidden";
      c.timer = 8 + Math.random() * 7;
      spawnDust(c.pos.clone().add(new Vector3(0, 0.05, 0)), SAND, 0.6);
      sfx("sand", c.pos, 0.5, 1.5);
    };
    const near = (pos: Vector3, r: number) => crabs.forEach((c) => c.pos.distanceTo(pos) < r && hide(c));
    const offs = [
      on("disturb", ({ pos, radius }) => near(pos, radius + 1.2)),
      on("impact", ({ pos, strength }) => near(pos, 1 + strength * 0.5)),
      on("splash", ({ pos, strength }) => near(pos, 1 + strength)),
      on("gust", ({ pos }) => near(pos, 1.6)),
      on("conch", () => {
        if (world.night > 0.8 || world.w.storm > 0.6) return;
        crabs.forEach((c, i) => {
          if (c.state === "hidden") {
            c.timer = Math.min(c.timer, 0.3 + i * 0.35);
            c.waveNext = true;
          } else {
            c.state = "snap";
            c.snap = 1.6;
            c.waving = true;
            setTimeout(() => sfx("snap", c.pos, 0.6, 1.1 + i * 0.1), 300 + i * 200);
          }
        });
        setTimeout(() => emit("conchAnswer", { who: "crabs" }), 1100);
      }),
    ];
    crabApi.hide = hide;
    return () => offs.forEach((o) => o());
  }, [crabs]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = world.elapsed;
    const tmp = crabTmp;
    crabs.forEach((c, i) => {
      const g = groups.current[i];
      if (!g) return;
      c.timer -= dt;
      c.pokeT -= dt;
      if (c.pokeT < 0) c.pokes = 0;
      let walking = false;
      if (c.state === "hidden") {
        c.sink = Math.min(1, c.sink + dt * 4);
        if (c.timer < 0 && world.w.storm < 0.5) {
          // pop up somewhere nearby
          for (let k = 0; k < 10; k++) {
            const na = c.a + (Math.random() - 0.5) * 1.2;
            if (beachAt(na, tmp)) {
              c.a = na;
              break;
            }
          }
          c.state = "idle";
          c.timer = 1.5;
          if (c.waveNext) {
            c.waveNext = false;
            c.state = "snap";
            c.snap = 1.6;
            c.waving = true;
            sfx("snap", c.pos, 0.6, 1.2);
          }
          beachAt(c.a, c.pos);
          spawnDust(c.pos.clone().add(new Vector3(0, 0.05, 0)), SAND, 0.4);
        }
      } else {
        c.sink = Math.max(0, c.sink - dt * 2.5);
        if (c.state === "snap") {
          c.snap -= dt;
          if (c.snap <= 0) {
            c.waving = false;
            c.state = "idle";
            c.timer = 1;
          }
        } else if (c.state === "idle") {
          if (c.timer < 0) {
            c.state = "walk";
            c.timer = 1.5 + Math.random() * 3;
            if (Math.random() < 0.4) c.dir *= -1;
          }
        } else {
          walking = true;
          const na = c.a + (c.dir * 0.32 * dt) / 10;
          if (beachAt(na, tmp)) c.a = na;
          else c.dir *= -1;
          if (c.timer < 0) {
            c.state = "idle";
            c.timer = 1 + Math.random() * 4;
          }
        }
        if (world.night > 0.8 || world.w.storm > 0.6) {
          if (Math.random() < dt * 0.3) crabApi.hide(c);
        }
      }
      beachAt(c.a, c.pos);
      const n = normalAt(c.pos.x, c.pos.z, crabNormal);
      const out = Math.atan2(c.pos.x, c.pos.z);
      const bob = walking ? Math.abs(Math.sin(t * 22 + i)) * 0.012 : 0;
      g.position.set(c.pos.x, c.pos.y - c.sink * 0.13 + bob, c.pos.z);
      // tilt with the slope, measured in the crab's own (yawed) frame
      const co = Math.cos(out);
      const so = Math.sin(out);
      const lx = n.x * co - n.z * so;
      const lz = n.x * so + n.z * co;
      g.rotation.set(lz * 0.5, out + (walking ? Math.sin(t * 22) * 0.06 : 0), -lx * 0.5, "YXZ");
      g.scale.setScalar(0.17);
      g.visible = c.sink < 0.99;
      const cl = claws.current[i];
      if (cl) {
        const up =
          c.state === "snap"
            ? c.waving
              ? 0.75 + Math.sin(c.snap * 11) * 0.35
              : Math.abs(Math.sin(c.snap * 18))
            : Math.max(0, Math.sin(t * 1.3 + i * 2)) * 0.15;
        cl.position.y = up * 0.25;
        cl.rotation.x = -up * 0.6;
      }
    });
  });

  const poke = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    if (!shown(e.object)) return;
    e.stopPropagation();
    markInput();
    const c = crabs[i];
    if (c.state === "hidden") return;
    c.pokes++;
    c.pokeT = 2.5;
    if (c.pokes >= 3) {
      crabApi.hide(c);
      return;
    }
    c.state = "snap";
    c.snap = 0.6;
    c.waving = false;
    c.dir *= -1;
    sfx("snap", c.pos, 0.8, 1 + Math.random() * 0.2);
  };

  return (
    <>
      {crabs.map((_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} onClick={poke(i)} {...hoverable()}>
          <mesh geometry={geo.body} material={mat} castShadow />
          <mesh geometry={geo.claw} material={mat} ref={(m) => { claws.current[i] = m; }} />
        </group>
      ))}
    </>
  );
}

const crabApi: { hide: (c: Crab) => void } = { hide: () => {} };
const crabTmp = new Vector3();
const crabNormal = new Vector3();

/* ---------------- frog ---------------- */

function frogGeometry() {
  const green = new Color("#6aa84f");
  const belly = new Color("#d9e6a0");
  const body = new SphereGeometry(0.5, 12, 9);
  place(body, [0, 0.32, 0], [-0.35, 0, 0], [0.9, 0.62, 1]);
  const parts: BufferGeometry[] = [prep(body, (p) => (p.y < 0.22 && p.z > 0 ? belly : green))];
  for (const s of [1, -1]) {
    const eye = new SphereGeometry(0.16, 10, 8);
    place(eye, [0.22 * s, 0.66, 0.26]);
    parts.push(prep(eye, green));
    const pupil = new SphereGeometry(0.09, 8, 6);
    place(pupil, [0.25 * s, 0.7, 0.36]);
    parts.push(prep(pupil, new Color("#141414")));
    const thigh = new SphereGeometry(0.22, 8, 6);
    place(thigh, [0.36 * s, 0.18, -0.2], [0, 0, 0], [0.8, 0.7, 1.3]);
    parts.push(prep(thigh, green));
    const foot = new SphereGeometry(0.1, 6, 5);
    place(foot, [0.3 * s, 0.04, 0.38], [0, 0, 0], [1, 0.4, 1.4]);
    parts.push(prep(foot, green));
  }
  return merge(parts) as BufferGeometry;
}

function Frog() {
  const g = useRef<Group>(null);
  const throat = useRef<Mesh>(null);
  const geo = useMemo(() => frogGeometry(), []);
  const mat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }), []);
  const throatMat = useMemo(() => new MeshStandardMaterial({ color: "#f1e9b5", roughness: 0.4 }), []);
  const s = useRef({ pad: 0, from: 0, to: 0, jump: 0, croak: 6, puff: 0, heading: 1, idleJump: 30, watered: 0 });

  const padPos = (i: number) => new Vector3(LILY_PADS[i].x, POND_LEVEL + 0.02, LILY_PADS[i].z);

  const jump = () => {
    const st = s.current;
    if (st.jump > 0) return;
    st.from = st.pad;
    let next = st.pad;
    while (next === st.pad) next = Math.floor(Math.random() * LILY_PADS.length);
    st.to = next;
    st.jump = 0.0001;
    const a = padPos(st.from);
    const b = padPos(st.to);
    st.heading = Math.atan2(b.x - a.x, b.z - a.z);
    addPondRipple(a.x, a.z, 0.3);
  };
  const croak = () => {
    const st = s.current;
    st.puff = 1;
    sfx("croak", padPos(st.pad), 0.7, 0.9 + Math.random() * 0.2);
  };

  useEffect(() => {
    const near = (pos: Vector3, r: number) => Math.hypot(pos.x - POND.x, pos.z - POND.z) < POND.r + r;
    const offs = [
      on("disturb", ({ pos, radius }) => near(pos, radius) && jump()),
      on("splash", ({ pos }) => near(pos, 0.5) && jump()),
      on("conch", () => {
        if (world.w.snow > 0.5) return;
        [350, 900, 1500].forEach((d) => setTimeout(croak, d));
        setTimeout(jump, 1950);
        setTimeout(() => emit("conchAnswer", { who: "frog" }), 1000);
      }),
      on("watered", ({ pos }) => {
        if (!near(pos, 0.6)) return;
        const st = s.current;
        st.watered += 1;
        if (st.watered > 6) {
          st.watered = 0;
          croak();
        }
      }),
    ];
    return () => offs.forEach((o) => o());
  });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const st = s.current;
    const o = g.current;
    if (!o) return;
    st.croak -= dt;
    st.idleJump -= dt;
    if (st.croak < 0) {
      const rainy = world.w.rain > 0.4;
      const evening = world.night > 0.3;
      st.croak = rainy ? 2.5 + Math.random() * 4 : evening ? 5 + Math.random() * 7 : 18 + Math.random() * 25;
      if (world.w.snow < 0.5) croak();
    }
    if (st.idleJump < 0) {
      st.idleJump = 25 + Math.random() * 30;
      jump();
    }
    st.puff = Math.max(0, st.puff - dt * 1.6);
    let p: Vector3;
    let lift = 0;
    let squash = 1;
    if (st.jump > 0) {
      st.jump += dt / 0.55;
      const k = Math.min(1, st.jump);
      p = padPos(st.from).lerp(padPos(st.to), k);
      lift = Math.sin(k * Math.PI) * 0.45;
      squash = 1.15;
      if (st.jump >= 1) {
        st.jump = 0;
        st.pad = st.to;
        addPondRipple(p.x, p.z, 0.4);
        sfx("plop", p, 0.4, 1.6);
      }
    } else {
      p = padPos(st.pad);
      st.heading += angleDelta(st.heading, Math.atan2(-POND.x + p.x, -POND.z + p.z) + Math.PI) * dt * 0.5;
      squash = 1 - Math.sin(world.elapsed * 2.1) * 0.02;
    }
    o.position.set(p.x, p.y + lift, p.z);
    o.rotation.set(st.jump > 0 ? -0.4 : 0, st.heading, 0, "YXZ");
    o.scale.set(0.2, 0.2 * squash, 0.2 / Math.sqrt(squash));
    if (throat.current) {
      const k = Math.sin(st.puff * Math.PI * 3) * st.puff;
      throat.current.scale.setScalar(0.4 + Math.max(0, k) * 1.4);
    }
  });

  return (
    <group
      ref={g}
      onClick={(e) => {
        e.stopPropagation();
        markInput();
        croak();
        setTimeout(jump, 260);
      }}
      {...hoverable()}
    >
      <mesh geometry={geo} material={mat} castShadow />
      <mesh ref={throat} material={throatMat} position={[0, 0.2, 0.42]}>
        <sphereGeometry args={[0.18, 10, 8]} />
      </mesh>
    </group>
  );
}

/* ---------------- rabbit ---------------- */

const BURROW = (() => {
  const cands = [
    [1.4, 3.0], [0.6, 3.6], [2.2, 2.6], [-1.2, 3.4], [1.8, 4.2], [3.2, 2.2], [0.2, 2.6],
  ];
  for (const [x, z] of cands) {
    const h = height(x, z);
    if (h > 0.55 && h < 2 && distToPath(x, z) > 0.9 && normalAt(x, z).y > 0.92) return { x, z };
  }
  return { x: 1.4, z: 3.0 };
})();

function rabbitGeometry() {
  const fur = new Color("#a88a6e");
  const pale = new Color("#efe4d4");
  const body = new SphereGeometry(0.5, 12, 9);
  place(body, [0, 0.36, -0.08], [-0.2, 0, 0], [0.78, 0.72, 1]);
  const head = new SphereGeometry(0.3, 12, 9);
  place(head, [0, 0.72, 0.36]);
  const tail = new SphereGeometry(0.13, 8, 6);
  place(tail, [0, 0.36, -0.6]);
  const nose = new SphereGeometry(0.05, 6, 5);
  place(nose, [0, 0.72, 0.66]);
  const parts: BufferGeometry[] = [
    prep(body, (p) => (p.y < 0.2 && p.z > 0 ? pale : fur)),
    prep(head, (p) => (p.y < 0.62 && p.z > 0.45 ? pale : fur)),
    prep(tail, pale),
    prep(nose, new Color("#d98b8b")),
  ];
  for (const s of [1, -1]) {
    const eye = new SphereGeometry(0.05, 6, 5);
    place(eye, [0.17 * s, 0.8, 0.56]);
    parts.push(prep(eye, new Color("#141414")));
    const foot = new SphereGeometry(0.12, 6, 5);
    place(foot, [0.2 * s, 0.05, 0.05], [0, 0, 0], [0.8, 0.5, 1.6]);
    parts.push(prep(foot, fur));
  }
  return merge(parts) as BufferGeometry;
}

function Rabbit() {
  const g = useRef<Group>(null);
  const earL = useRef<Mesh>(null);
  const earR = useRef<Mesh>(null);
  const geo = useMemo(() => rabbitGeometry(), []);
  const mat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), []);
  const earGeo = useMemo(() => {
    const e = new CapsuleGeometry(0.075, 0.38, 3, 6);
    e.translate(0, 0.22, 0);
    return e;
  }, []);
  const earMat = useMemo(() => new MeshStandardMaterial({ color: "#a88a6e", roughness: 0.85 }), []);
  const holeGeo = useMemo(() => new CircleGeometry(0.17, 16).rotateX(-Math.PI / 2), []);
  const holeMat = useMemo(() => new MeshStandardMaterial({ color: "#2b2118", roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  const moundGeo = useMemo(() => new TorusGeometry(0.2, 0.06, 6, 18).rotateX(Math.PI / 2), []);
  const moundMat = useMemo(() => new MeshStandardMaterial({ color: "#7d6448", roughness: 1 }), []);
  const base = useMemo(() => new Vector3(BURROW.x, height(BURROW.x, BURROW.z), BURROW.z), []);
  const s = useRef({
    state: "hidden" as "hidden" | "peek" | "hop" | "sit" | "bolt",
    timer: 0,
    cooldown: 12,
    pos: base.clone(),
    spot: base.clone(),
    hopK: 0,
    hopFrom: base.clone(),
    hopTo: base.clone(),
    hops: 0,
    heading: 0,
    outFor: 0,
    emerge: 0,
  });

  useEffect(() => {
    const off = on("disturb", ({ pos, radius }) => {
      const st = s.current;
      if (st.state !== "hidden" && st.pos.distanceTo(pos) < radius + 2.5) st.state = "bolt";
    });
    return off;
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const st = s.current;
    const o = g.current;
    if (!o) return;
    const t = world.elapsed;
    st.timer -= dt;
    const calm = world.daylight > 0.3 && world.w.rain < 0.4 && world.w.storm < 0.3;
    const startHop = (to: Vector3) => {
      st.hopFrom.copy(st.pos);
      st.hopTo.copy(to);
      st.hopTo.y = height(to.x, to.z);
      st.hopK = 0.0001;
      st.heading = Math.atan2(to.x - st.pos.x, to.z - st.pos.z);
    };

    if (st.state === "hidden") {
      st.cooldown -= dt;
      st.emerge = Math.max(0, st.emerge - dt * 3);
      if (st.cooldown < 0 && idleSeconds() > 20 && calm) {
        st.state = "peek";
        st.timer = 1.6;
        st.pos.copy(base);
        st.heading = Math.random() * Math.PI * 2;
      }
    } else if (st.state === "peek") {
      st.emerge = Math.min(0.55, st.emerge + dt * 1.2);
      if (idleSeconds() < 0.4) st.state = "bolt";
      else if (st.timer < 0) {
        st.state = "hop";
        st.emerge = 1;
        st.hops = 3 + Math.floor(Math.random() * 2);
        const a = Math.random() * Math.PI * 2;
        st.spot.set(base.x + Math.cos(a) * 1.3, 0, base.z + Math.sin(a) * 1.3);
        startHop(st.pos.clone().lerp(st.spot, 1 / st.hops));
      }
    } else if (st.state === "hop" || st.state === "bolt") {
      if (st.state === "hop" && idleSeconds() < 0.4) st.state = "bolt";
      if (st.state === "bolt" && st.hopK <= 0) {
        if (st.pos.distanceTo(base) < 0.15) {
          st.state = "hidden";
          st.cooldown = 30 + Math.random() * 30;
          world.rabbitOut = false;
          spawnDust(base.clone(), new Color("#8c7457"), 0.3);
        } else {
          const d = st.pos.distanceTo(base);
          startHop(d < 0.9 ? base : st.pos.clone().lerp(base, 0.9 / d));
          sfx("hop", st.pos, 0.3, 1.4);
        }
      }
      if (st.hopK > 0) {
        st.hopK += dt / (st.state === "bolt" ? 0.22 : 0.36);
        const k = Math.min(1, st.hopK);
        st.pos.lerpVectors(st.hopFrom, st.hopTo, k);
        st.pos.y += Math.sin(k * Math.PI) * (st.state === "bolt" ? 0.2 : 0.14);
        if (st.hopK >= 1) {
          st.hopK = 0;
          if (st.state === "hop") {
            st.hops--;
            if (st.hops <= 0) {
              st.state = "sit";
              st.timer = 6 + Math.random() * 10;
              st.outFor = 0;
              world.rabbitOut = true;
            } else startHop(st.pos.clone().lerp(st.spot, 1 / st.hops));
          }
        }
      }
      st.emerge = st.state === "bolt" && st.pos.distanceTo(base) < 0.2 ? Math.max(0, st.emerge - dt * 4) : 1;
    } else if (st.state === "sit") {
      st.outFor += dt;
      if (st.outFor > 2) discover("visitor");
      if (idleSeconds() < 0.4 || !calm) st.state = "bolt";
      else if (st.timer < 0) {
        st.timer = 3 + Math.random() * 6;
        // nibble around a little
        const a = Math.random() * Math.PI * 2;
        const to = new Vector3(st.pos.x + Math.cos(a) * 0.35, 0, st.pos.z + Math.sin(a) * 0.35);
        if (Math.hypot(to.x - base.x, to.z - base.z) < 2) {
          st.state = "hop";
          st.hops = 1;
          st.spot.copy(to);
          startHop(to);
        }
      }
      if (st.outFor > 1 && Math.random() < dt * 0.25) spawnSparkle(st.pos.clone().add(new Vector3(0, 0.25, 0)), 2, new Color("#fff3c4"), 0.1, 0.3);
    }

    const visible = st.state !== "hidden" || st.emerge > 0;
    o.visible = visible;
    const sink = (1 - st.emerge) * 0.3;
    o.position.set(st.pos.x, Math.max(st.pos.y, height(st.pos.x, st.pos.z)) - sink, st.pos.z);
    o.rotation.set(0, st.heading, 0);
    const nib = st.state === "sit" ? Math.sin(t * 14) * 0.01 : 0;
    o.scale.set(0.24, 0.24 + nib, 0.24);
    const twitch = st.state === "sit" || st.state === "peek" ? Math.max(0, Math.sin(t * 3.1) - 0.8) * 2 : 0;
    if (earL.current) earL.current.rotation.set(-0.25 - (st.state === "bolt" ? 0.8 : 0), 0, 0.2 + twitch * 0.4);
    if (earR.current) earR.current.rotation.set(-0.2 - (st.state === "bolt" ? 0.8 : 0), 0, -0.2);
  });

  return (
    <group>
      <group position={base}>
        <mesh geometry={holeGeo} material={holeMat} position={[0, 0.012, 0]} />
        <mesh geometry={moundGeo} material={moundMat} position={[0, 0.0, 0]} scale={[1, 0.7, 1]} />
      </group>
      <group ref={g} visible={false}>
        <mesh geometry={geo} material={mat} castShadow />
        <mesh ref={earL} geometry={earGeo} material={earMat} position={[0.1, 0.92, 0.3]} />
        <mesh ref={earR} geometry={earGeo} material={earMat} position={[-0.1, 0.92, 0.3]} />
      </group>
    </group>
  );
}

export function Critters() {
  return (
    <>
      <Crabs />
      <Frog />
      <Rabbit />
    </>
  );
}

