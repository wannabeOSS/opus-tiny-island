"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { merge, place, prep } from "../../lib/geo";
import { mulberry32 } from "../../lib/math";
import { height } from "../../lib/terrain";
import { landCrumbs } from "../../lib/tools";
import { emit, markInput, on, sfx, world, type Perch } from "../../lib/world";
import { bubbles, popNear } from "../Bubbles";
import { hoverable } from "../cursor";
import { spawnSparkle } from "../effects/Particles";

type BirdState = "perch" | "fly" | "peck" | "away";
type Goal = "perch" | "crumb" | "away" | "bubble";

type Bird = {
  state: BirdState;
  goal: Goal;
  pos: Vector3;
  from: Vector3;
  ctrl: Vector3;
  to: Vector3;
  t: number;
  dur: number;
  perch: Perch | null;
  heading: number;
  timer: number;
  hop: number;
  peck: number;
  scale: number;
  awayFor: number;
};

const tmp = new Vector3();

function birdBody(back: string, belly: string) {
  const cb = new Color(back);
  const cl = new Color(belly);
  const body = new SphereGeometry(0.5, 10, 8);
  place(body, [0, 0, 0], [0, 0, 0], [0.62, 0.62, 1]);
  const head = new SphereGeometry(0.34, 10, 8);
  place(head, [0, 0.38, 0.38]);
  const tail = new ConeGeometry(0.2, 0.55, 4);
  place(tail, [0, 0.08, -0.62], [-Math.PI / 2 - 0.3, 0, 0], [1, 1, 0.3]);
  const tint = (p: Vector3) => (p.y < -0.05 && p.z > -0.25 ? cl : cb);
  const beak = new ConeGeometry(0.08, 0.24, 5);
  place(beak, [0, 0.36, 0.78], [Math.PI / 2, 0, 0]);
  const eyeL = new SphereGeometry(0.055, 6, 5);
  place(eyeL, [0.2, 0.46, 0.56]);
  const eyeR = new SphereGeometry(0.055, 6, 5);
  place(eyeR, [-0.2, 0.46, 0.56]);
  return merge([
    prep(body, tint),
    prep(head, cb),
    prep(tail, cb),
    prep(beak, new Color("#e8a23a")),
    prep(eyeL, new Color("#1b1b1b")),
    prep(eyeR, new Color("#1b1b1b")),
  ]) as BufferGeometry;
}

function wingGeo(color: string, span = 0.75) {
  const w = new SphereGeometry(0.5, 8, 5);
  place(w, [span * 0.5, 0, 0], [0, 0, 0], [span, 0.08, 0.42]);
  return prep(w, new Color(color)) as BufferGeometry;
}

const LOOKS = [
  { back: "#7a5a43", belly: "#f0a35c", wing: "#5f4433" }, // robin
  { back: "#4f7db0", belly: "#f3e9d6", wing: "#3d6290" }, // bluebird
  { back: "#c9a54a", belly: "#fbe9a6", wing: "#8d7334" }, // finch
  { back: "#8a8f86", belly: "#efe7da", wing: "#62675f" }, // sparrow
  { back: "#b5523e", belly: "#f6d7b8", wing: "#7c3628" }, // red
];

function awayPoint() {
  const a = Math.random() * Math.PI * 2;
  return new Vector3(Math.cos(a) * 34, 9 + Math.random() * 4, Math.sin(a) * 34);
}

function freePerches(exclude?: Perch | null) {
  return world.perches.filter((p) => !p.taken && p !== exclude);
}

export function Birds() {
  const n = world.mobile ? 4 : 5;
  const groups = useRef<(Group | null)[]>([]);
  const wingsL = useRef<(Group | null)[]>([]);
  const wingsR = useRef<(Group | null)[]>([]);
  const heads = useRef<(Group | null)[]>([]);
  const mats = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), []);
  const geos = useMemo(
    () => LOOKS.slice(0, n).map((l) => ({ body: birdBody(l.back, l.belly), wing: wingGeo(l.wing) })),
    [n],
  );
  const birds = useMemo<Bird[]>(() => {
    const rnd = mulberry32(77);
    return Array.from({ length: n }, () => {
      const p = awayPoint();
      return {
        state: "away" as BirdState,
        goal: "away" as Goal,
        pos: p.clone(),
        from: p.clone(),
        ctrl: p.clone(),
        to: p.clone(),
        t: 0,
        dur: 1,
        perch: null,
        heading: 0,
        timer: 0,
        hop: 0,
        peck: 0,
        scale: 0.15 + rnd() * 0.03,
        awayFor: 0.5 + rnd() * 4,
      };
    });
  }, [n]);

  useEffect(() => {
    const flyTo = (b: Bird, to: Vector3, goal: Goal) => {
      if (b.perch) {
        b.perch.taken = false;
        b.perch = null;
      }
      b.from.copy(b.pos);
      b.to.copy(to);
      const d = b.from.distanceTo(b.to);
      b.ctrl.copy(b.from).lerp(b.to, 0.5);
      b.ctrl.y = Math.max(b.from.y, b.to.y) + 0.8 + d * 0.18;
      b.t = 0;
      b.dur = 0.5 + d / 4.2;
      b.state = "fly";
      b.goal = goal;
      sfx("flap", b.pos, 0.35, 0.9 + Math.random() * 0.3);
    };
    const flee = (b: Bird) => {
      if (b.state !== "perch" && b.state !== "peck") return;
      const far = freePerches(b.perch).filter((p) => p.pos.distanceTo(b.pos) > 5);
      if (far.length && Math.random() < 0.55 && world.w.storm < 0.5) {
        const p = far[Math.floor(Math.random() * far.length)];
        p.taken = true;
        const old = b.perch;
        b.perch = null;
        if (old) old.taken = false;
        flyTo(b, p.pos, "perch");
        b.perch = p;
      } else {
        flyTo(b, awayPoint(), "away");
      }
      if (world.daylight > 0.2) sfx("chirp", b.pos, 0.5, 1.3);
    };
    birdsApi.flee = flee;
    birdsApi.flyTo = flyTo;

    const offs = [
      on("disturb", ({ pos, radius }) => {
        birds.forEach((b) => {
          if (b.pos.distanceTo(pos) < radius + 1.4) flee(b);
        });
      }),
      on("shake", ({ pos }) => {
        birds.forEach((b) => {
          if (b.pos.distanceTo(pos) < 2.6) flee(b);
        });
      }),
      on("splash", ({ pos, strength }) => {
        birds.forEach((b) => {
          if (b.pos.distanceTo(pos) < 1.5 + strength * 2) flee(b);
        });
      }),
      on("gust", ({ pos, strength }) => {
        birds.forEach((b) => {
          if (b.pos.distanceTo(pos) < 1.2 + strength) flee(b);
        });
      }),
      on("lightning", () => birds.forEach((b) => flee(b))),
      on("conch", () => {
        if (world.w.storm > 0.5) return;
        let answered = 0;
        birds.forEach((b, i) => {
          if (b.state === "away" || b.state === "fly") return;
          answered++;
          const sleepy = world.night > 0.75;
          setTimeout(() => {
            b.hop = 1;
            b.peck = 1;
            sfx("chirp", b.pos, sleepy ? 0.35 : 0.7, 0.85 + i * 0.09 + Math.random() * 0.15);
            if (!sleepy) setTimeout(() => sfx("chirp", b.pos, 0.5, 1 + Math.random() * 0.3), 380);
          }, 500 + i * 260 + Math.random() * 300);
        });
        // nobody home? in daylight one of them comes back to see who's calling
        if (!answered && world.daylight > 0.3) {
          const b = birds.find((x) => x.state === "away");
          if (b) b.awayFor = Math.min(b.awayFor, 0.6);
        }
        if (answered) setTimeout(() => emit("conchAnswer", { who: "birds" }), 900);
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      birds.forEach((b) => {
        if (b.perch) b.perch.taken = false;
      });
    };
  }, [birds]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = world.elapsed;
    const storm = world.w.storm > 0.5;
    const asleep = world.night > 0.75;

    birds.forEach((b, i) => {
      const g = groups.current[i];
      if (!g) return;
      let flap = 0;
      b.timer -= dt;

      if (b.state === "away") {
        g.visible = false;
        b.awayFor -= dt;
        if (b.awayFor < 0 && !storm && world.perches.length) {
          const free = freePerches();
          if (free.length) {
            const p = free[Math.floor(Math.random() * free.length)];
            p.taken = true;
            b.pos.copy(awayPoint());
            birdsApi.flyTo(b, p.pos, "perch");
            b.perch = p;
            b.timer = 4 + Math.random() * 8;
          } else b.awayFor = 5;
        }
        return;
      }
      g.visible = true;

      if (b.state === "fly") {
        b.t += dt / b.dur;
        const k = Math.min(1, b.t);
        const e = k * k * (3 - 2 * k);
        const a = 1 - e;
        tmp.copy(b.pos);
        b.pos.set(
          a * a * b.from.x + 2 * a * e * b.ctrl.x + e * e * b.to.x,
          a * a * b.from.y + 2 * a * e * b.ctrl.y + e * e * b.to.y,
          a * a * b.from.z + 2 * a * e * b.ctrl.z + e * e * b.to.z,
        );
        const dx = b.pos.x - tmp.x;
        const dz = b.pos.z - tmp.z;
        if (dx * dx + dz * dz > 1e-7) b.heading = Math.atan2(dx, dz);
        if (bubbles.length) popNear(b.pos, 0.18);
        const descending = b.pos.y < tmp.y;
        flap = descending && k > 0.3 && k < 0.85 ? 0.35 : Math.sin(t * 34 + i) * 0.95;
        if (k >= 1) {
          if (b.goal === "away") {
            b.state = "away";
            b.awayFor = storm ? 30 : 10 + Math.random() * 18;
          } else if (b.goal === "bubble") {
            if (popNear(b.pos, 0.55)) sfx("chirp", b.pos, 0.45, 1.4);
            const free = freePerches();
            if (free.length && !storm) {
              const p = free[Math.floor(Math.random() * free.length)];
              p.taken = true;
              birdsApi.flyTo(b, p.pos, "perch");
              b.perch = p;
            } else birdsApi.flyTo(b, awayPoint(), "away");
          } else if (b.goal === "crumb") {
            b.state = "peck";
            b.timer = 0.6;
          } else {
            b.state = "perch";
            b.timer = 2 + Math.random() * 5;
            sfx("flap", b.pos, 0.2, 1.3);
          }
        }
      } else if (b.state === "perch") {
        if (storm) {
          birdsApi.flyTo(b, awayPoint(), "away");
        } else if (b.timer < 0) {
          b.timer = 1.5 + Math.random() * 4;
          const crumb = !asleep && landCrumbs.length ? nearestCrumb(b.pos, 14) : null;
          const bubble = !asleep ? bubbles.find((x) => !x.dead && !x.hunted && x.age > 0.8 && x.pos.distanceTo(b.pos) < 4.5) : undefined;
          const r = Math.random();
          if (bubble && Math.random() < 0.6) {
            bubble.hunted = true;
            // aim a little ahead of where it's drifting
            const lead = bubble.pos.clone().addScaledVector(bubble.vel, 0.6 + bubble.pos.distanceTo(b.pos) / 4.2);
            birdsApi.flyTo(b, lead, "bubble");
          } else if (crumb && Math.random() < 0.8) {
            const c = crumb.pos;
            const to = new Vector3(c.x + (Math.random() - 0.5) * 0.3, 0, c.z + (Math.random() - 0.5) * 0.3);
            to.y = height(to.x, to.z) + 0.02;
            birdsApi.flyTo(b, to, "crumb");
          } else if (asleep) {
            // sleeping: stay put, head tucked
          } else if (r < 0.35) {
            b.hop = 1;
            b.heading += (Math.random() - 0.5) * 2.2;
          } else if (r < 0.6) {
            if (world.daylight > 0.25 && world.w.rain < 0.6) sfx("chirp", b.pos, 0.55, 0.85 + Math.random() * 0.5);
            b.peck = 1;
          } else if (r < 0.7) {
            const free = freePerches(b.perch);
            if (free.length) {
              const p = free[Math.floor(Math.random() * free.length)];
              p.taken = true;
              const old = b.perch;
              birdsApi.flyTo(b, p.pos, "perch");
              if (old) old.taken = false;
              b.perch = p;
            }
          }
        }
        if (b.perch && b.state === "perch") b.pos.copy(b.perch.pos);
      } else if (b.state === "peck") {
        if (b.timer < 0) {
          b.timer = 0.7 + Math.random() * 0.8;
          const c = nearestCrumb(b.pos, 0.7);
          if (c) {
            b.peck = 1;
            b.heading = Math.atan2(c.pos.x - b.pos.x, c.pos.z - b.pos.z);
            if (Math.random() < 0.45) {
              landCrumbs.splice(landCrumbs.indexOf(c), 1);
              sfx("pick", b.pos, 0.25, 1.8 + Math.random() * 0.4);
            }
          } else {
            const next = nearestCrumb(b.pos, 3);
            if (next) {
              b.hop = 1;
              const to = new Vector3(next.pos.x, height(next.pos.x, next.pos.z) + 0.02, next.pos.z);
              b.heading = Math.atan2(to.x - b.pos.x, to.z - b.pos.z);
              b.pos.lerp(to, 0.5);
            } else {
              const free = freePerches();
              if (free.length && !storm) {
                const p = free[Math.floor(Math.random() * free.length)];
                p.taken = true;
                birdsApi.flyTo(b, p.pos, "perch");
                b.perch = p;
              } else birdsApi.flyTo(b, awayPoint(), "away");
            }
          }
        }
      }

      b.hop = Math.max(0, b.hop - dt * 4);
      b.peck = Math.max(0, b.peck - dt * 3);
      const hopY = Math.sin(b.hop * Math.PI) * 0.06;
      g.position.set(b.pos.x, b.pos.y + hopY, b.pos.z);
      g.rotation.set(b.state === "fly" ? -0.1 : Math.sin(b.peck * Math.PI) * 0.6, b.heading, 0, "YXZ");
      g.scale.setScalar(b.scale);
      const wl = wingsL.current[i];
      const wr = wingsR.current[i];
      if (wl && wr) {
        const rest = b.state === "fly" ? 0 : -1.25;
        wl.rotation.z = b.state === "fly" ? flap : rest;
        wr.rotation.z = wl.rotation.z;
      }
      const h = heads.current[i];
      if (h) h.position.y = asleep && b.state === "perch" ? -0.12 : 0;
    });
  });

  const tapBird = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    markInput();
    const b = birds[i];
    spawnSparkle(b.pos.clone().add(new Vector3(0, 0.1, 0)), 6, new Color("#fff3df"), 0.15, 0.6);
    birdsApi.flee(b);
  };

  return (
    <group>
      {birds.map((_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} visible={false} onClick={tapBird(i)} {...hoverable()}>
          <group ref={(g) => { heads.current[i] = g; }}>
            <mesh geometry={geos[i].body} material={mats} castShadow />
          </group>
          <group position={[0.22, 0.1, 0]} ref={(g) => { wingsL.current[i] = g; }}>
            <mesh geometry={geos[i].wing} material={mats} />
          </group>
          <group position={[-0.22, 0.1, 0]} rotation={[0, Math.PI, 0]} ref={(g) => { wingsR.current[i] = g; }}>
            <mesh geometry={geos[i].wing} material={mats} />
          </group>
        </group>
      ))}
      <Gulls />
    </group>
  );
}

const birdsApi: { flee: (b: Bird) => void; flyTo: (b: Bird, to: Vector3, goal: Goal) => void } = {
  flee: () => {},
  flyTo: () => {},
};

function nearestCrumb(p: Vector3, max: number) {
  let best: (typeof landCrumbs)[number] | null = null;
  let bd = max;
  for (const c of landCrumbs) {
    const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/* ---------------- gulls ---------------- */

function gullWing() {
  const inner = new SphereGeometry(0.5, 8, 5);
  place(inner, [0.35, 0, 0], [0, 0, 0.12], [0.75, 0.05, 0.3]);
  const tip = new SphereGeometry(0.5, 8, 5);
  place(tip, [0.95, 0.09, -0.04], [0, 0.2, -0.2], [0.6, 0.04, 0.2]);
  const g = merge([prep(inner, new Color("#f4f4f0")), prep(tip, new Color("#3b3f45"))]);
  return g as BufferGeometry;
}

function gullBody() {
  const b = new SphereGeometry(0.5, 10, 7);
  place(b, [0, 0, 0], [0, 0, 0], [0.42, 0.42, 1.2]);
  const h = new SphereGeometry(0.26, 8, 6);
  place(h, [0, 0.12, 0.6]);
  const beak = new ConeGeometry(0.06, 0.26, 5);
  place(beak, [0, 0.1, 0.9], [Math.PI / 2, 0, 0]);
  const tail = new ConeGeometry(0.18, 0.4, 4);
  place(tail, [0, 0, -0.75], [-Math.PI / 2, 0, 0], [1, 1, 0.3]);
  return merge([
    prep(b, new Color("#fbfbf8")),
    prep(h, new Color("#ffffff")),
    prep(beak, new Color("#f0b53c")),
    prep(tail, new Color("#d9dcdf")),
  ]) as BufferGeometry;
}

function Gulls() {
  const refs = useRef<(Group | null)[]>([]);
  const wl = useRef<(Group | null)[]>([]);
  const wr = useRef<(Group | null)[]>([]);
  const mat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), []);
  const body = useMemo(() => gullBody(), []);
  const wing = useMemo(() => gullWing(), []);
  const s = useRef({ presence: 1, cry: 6 });
  const gulls = useMemo(
    () => [
      { r: 17, h: 9, speed: 0.11, phase: 0, flapT: 0 },
      { r: 21, h: 11, speed: -0.085, phase: 2.4, flapT: 3 },
    ],
    [],
  );

  useFrame((_, dt) => {
    const t = world.elapsed;
    const st = s.current;
    const want = world.w.storm > 0.5 || world.night > 0.6 ? 0 : 1;
    st.presence += (want - st.presence) * Math.min(1, dt * 0.3);
    st.cry -= dt;
    if (st.cry < 0) {
      st.cry = 14 + Math.random() * 20;
      if (st.presence > 0.7) {
        const g = gulls[Math.floor(Math.random() * gulls.length)];
        const a = t * g.speed + g.phase;
        sfx("gull", new Vector3(Math.cos(a) * g.r, g.h, Math.sin(a) * g.r), 0.5, 0.9 + Math.random() * 0.25);
      }
    }
    gulls.forEach((g, i) => {
      const o = refs.current[i];
      if (!o) return;
      const away = 1 - st.presence;
      const r = g.r + away * 60;
      const a = t * g.speed + g.phase + Math.sin(t * 0.13 + i) * 0.3;
      const y = g.h + Math.sin(t * 0.4 + i * 2) * 0.8 + away * 12;
      o.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      o.visible = st.presence > 0.02;
      const dir = Math.sign(g.speed);
      o.rotation.set(0, -a + (dir > 0 ? 0 : Math.PI), -dir * 0.35, "YXZ");
      // glide with an occasional burst of flaps
      g.flapT -= dt;
      if (g.flapT < -1.4) g.flapT = 4 + Math.random() * 6;
      const flapping = g.flapT < 0;
      const f = flapping ? Math.sin(t * 13 + i) * 0.55 : 0.12 + Math.sin(t * 1.3 + i) * 0.05;
      const L = wl.current[i];
      const R = wr.current[i];
      if (L && R) {
        L.rotation.z = f;
        R.rotation.z = f;
      }
    });
  });

  return (
    <>
      {gulls.map((_, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g; }} scale={0.42}>
          <mesh geometry={body} material={mat} />
          <group position={[0.15, 0.05, 0.05]} ref={(g) => { wl.current[i] = g; }}>
            <mesh geometry={wing} material={mat} />
          </group>
          <group position={[-0.15, 0.05, 0.05]} rotation={[0, Math.PI, 0]} ref={(g) => { wr.current[i] = g; }}>
            <mesh geometry={wing} material={mat} />
          </group>
        </group>
      ))}
    </>
  );
}
