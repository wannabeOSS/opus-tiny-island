"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Material,
  MeshStandardMaterial,
  Plane,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  LatheGeometry,
  ExtrudeGeometry,
  Shape,
} from "three";
import { colliders } from "../lib/colliders";
import { CABIN, POND } from "../lib/layout";
import { clamp } from "../lib/math";
import { height, inPond, islandD, normalAt, POND_LEVEL } from "../lib/terrain";
import {
  addPondRipple,
  addRipple,
  emit,
  markInput,
  on,
  sfx,
  waveHeight,
  world,
  type PropKind,
} from "../lib/world";
import { lockCursor, setCursor } from "./cursor";
import { spawnDust, spawnSparkle, spawnSplash } from "./effects/Particles";
import { dockHeightAt } from "./Shore";
import { discover } from "../lib/secrets";

type PropState = "rest" | "air" | "held" | "float" | "sink" | "planted" | "dead";

export type Prop = {
  id: number;
  kind: PropKind;
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  spin: Vector3;
  r: number;
  state: PropState;
  floats: boolean;
  food: boolean;
  age: number;
  sinkT: number;
  restT: number;
  group: Group | null;
  bounce: number;
  lastImpact: number;
  skips: number;
  variant: number;
};

const KIND: Record<PropKind, { r: number; floats: boolean; food: boolean; bounce: number; mass: number }> = {
  pebble: { r: 0.07, floats: false, food: false, bounce: 0.35, mass: 1 },
  shell: { r: 0.07, floats: false, food: false, bounce: 0.25, mass: 0.5 },
  starfish: { r: 0.08, floats: false, food: false, bounce: 0.2, mass: 0.4 },
  coconut: { r: 0.11, floats: true, food: false, bounce: 0.3, mass: 1.5 },
  apple: { r: 0.075, floats: true, food: true, bounce: 0.3, mass: 0.6 },
  cone: { r: 0.07, floats: true, food: false, bounce: 0.25, mass: 0.3 },
  stick: { r: 0.06, floats: true, food: false, bounce: 0.2, mass: 0.4 },
  bottle: { r: 0.09, floats: true, food: false, bounce: 0.3, mass: 0.8 },
  seed: { r: 0.06, floats: true, food: false, bounce: 0.3, mass: 0.3 },
  paperboat: { r: 0.11, floats: true, food: false, bounce: 0.15, mass: 0.2 },
  lantern: { r: 0.09, floats: true, food: false, bounce: 0.15, mass: 0.3 },
};
const UPRIGHT = new Set<PropKind>(["paperboat", "lantern"]);

export const props: Prop[] = [];
let nextId = 1;
export function getFoodProps() {
  return props.filter((p) => p.food && (p.state === "float" || p.state === "sink"));
}

function makeProp(kind: PropKind, pos: Vector3, vel?: Vector3): Prop {
  const k = KIND[kind];
  return {
    id: nextId++,
    kind,
    pos: pos.clone(),
    vel: vel ? vel.clone() : new Vector3(),
    quat: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.random() * 6),
    spin: new Vector3(),
    r: k.r,
    state: vel ? "air" : "rest",
    floats: k.floats,
    food: k.food,
    age: 0,
    sinkT: 0,
    restT: 0,
    group: null,
    bounce: k.bounce,
    lastImpact: -10,
    skips: 0,
    variant: Math.floor(Math.random() * 3),
  };
}

/* ---------------- geometry / materials ---------------- */
function useAssets() {
  return useMemo(() => {
    const m = (color: string, rough = 0.8, extra: Partial<MeshStandardMaterial> = {}) =>
      Object.assign(new MeshStandardMaterial({ color, roughness: rough }), extra);
    const pebble = new IcosahedronGeometry(0.075, 1);
    pebble.scale(1, 0.6, 0.85);
    const shellPts = Array.from({ length: 9 }, (_, i) => new Vector2(Math.sin((i / 8) * Math.PI * 0.5) * 0.08, (i / 8) * 0.04));
    const shell = new LatheGeometry(shellPts, 10, 0, Math.PI);
    const starShape = new Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.09 : 0.035;
      if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const star = new ExtrudeGeometry(starShape, { depth: 0.015, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 });
    star.rotateX(-Math.PI / 2);
    const bottlePts = [
      new Vector2(0, -0.1),
      new Vector2(0.05, -0.1),
      new Vector2(0.055, -0.08),
      new Vector2(0.055, 0.03),
      new Vector2(0.03, 0.07),
      new Vector2(0.018, 0.1),
      new Vector2(0.018, 0.13),
    ];
    const bottle = new LatheGeometry(bottlePts, 12);
    bottle.rotateZ(Math.PI / 2);
    return {
      geo: {
        pebble: pebble as BufferGeometry,
        shell: shell as BufferGeometry,
        starfish: star as BufferGeometry,
        coconut: new SphereGeometry(0.11, 14, 10) as BufferGeometry,
        apple: new SphereGeometry(0.075, 14, 10) as BufferGeometry,
        cone: new ConeGeometry(0.05, 0.13, 8) as BufferGeometry,
        stick: new CapsuleGeometry(0.018, 0.42, 3, 5).rotateZ(Math.PI / 2) as BufferGeometry,
        bottle: bottle as BufferGeometry,
        seed: new SphereGeometry(0.055, 14, 10) as BufferGeometry,
        cork: new CylinderGeometry(0.02, 0.018, 0.04, 8).rotateZ(Math.PI / 2) as BufferGeometry,
        paper: new CylinderGeometry(0.03, 0.03, 0.12, 8).rotateZ(Math.PI / 2) as BufferGeometry,
        stem: new CylinderGeometry(0.006, 0.006, 0.04, 4) as BufferGeometry,
        paperboat: new CylinderGeometry(0.15, 0.085, 0.07, 4, 1).rotateY(Math.PI / 4).scale(1.25, 1, 0.5) as BufferGeometry,
        sail: new ConeGeometry(0.095, 0.16, 4).rotateY(Math.PI / 4).scale(1, 1, 0.12) as BufferGeometry,
        lantern: new CylinderGeometry(0.065, 0.055, 0.13, 6) as BufferGeometry,
        lanternBase: new CylinderGeometry(0.075, 0.075, 0.025, 6) as BufferGeometry,
      },
      mat: {
        pebble: [m("#9c958c", 0.7), m("#b9b0a2", 0.7), m("#7f8a8c", 0.6)] as Material[],
        shell: [m("#f3d9c8", 0.5), m("#f6eadc", 0.5), m("#e9b8a8", 0.5)] as Material[],
        starfish: [m("#ee8a5a", 0.7), m("#e2685a", 0.7)] as Material[],
        coconut: [m("#6e4a2c", 0.85)] as Material[],
        apple: [m("#d9483b", 0.45), m("#e8b23e", 0.45)] as Material[],
        cone: [m("#8a5a36", 0.9)] as Material[],
        stick: [m("#8a6444", 0.95)] as Material[],
        bottle: [m("#7fbfa8", 0.08, { transparent: true, opacity: 0.6, metalness: 0.1 })] as Material[],
        seed: [m("#bff2d6", 0.3, { emissive: new Color("#5cf2b6"), emissiveIntensity: 1.6 })] as Material[],
        cork: m("#b88a5a", 0.9),
        paper: m("#f1e6c9", 0.9),
        stem: m("#4f7a32", 0.9),
        paperboat: [m("#fbf5e8", 0.9), m("#dce9f2", 0.9), m("#f6dfe0", 0.9), m("#f4e6b8", 0.9)] as Material[],
        lantern: [
          m("#ffd9a0", 0.8, { emissive: new Color("#ff9a3d"), emissiveIntensity: 2.2, transparent: true, opacity: 0.92 }),
          m("#ffc9b0", 0.8, { emissive: new Color("#ff7a52"), emissiveIntensity: 2.0, transparent: true, opacity: 0.92 }),
        ] as Material[],
        wood: m("#6e4a2c", 0.9),
      },
    };
  }, []);
}

/* ---------------- one prop view ---------------- */
function PropView({ p, assets, onGrab }: { p: Prop; assets: ReturnType<typeof useAssets>; onGrab: (p: Prop, e: ThreeEvent<PointerEvent>) => void }) {
  const variant = p.variant;
  const mats = assets.mat[p.kind];
  const mat = mats[variant % mats.length];
  return (
    <group
      ref={(g) => {
        p.group = g;
      }}
      position={p.pos}
      onPointerDown={(e) => onGrab(p, e)}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!world.holding) setCursor("grab");
      }}
      onPointerOut={() => !world.holding && setCursor("default")}
    >
      <mesh geometry={assets.geo[p.kind]} material={mat} castShadow scale={p.kind === "pebble" ? 0.8 + variant * 0.25 : 1} />
      {p.kind === "apple" && <mesh geometry={assets.geo.stem} material={assets.mat.stem} position={[0, 0.08, 0]} />}
      {p.kind === "paperboat" && <mesh geometry={assets.geo.sail} material={mat} position={[0, 0.1, 0]} castShadow />}
      {p.kind === "lantern" && <mesh geometry={assets.geo.lanternBase} material={assets.mat.wood} position={[0, -0.07, 0]} />}
      {p.kind === "bottle" && !world.bottleOpened && (
        <>
          <mesh geometry={assets.geo.cork} material={assets.mat.cork} position={[0.14, 0, 0]} />
          <mesh geometry={assets.geo.paper} material={assets.mat.paper} />
          <mesh geometry={assets.geo.seed} material={assets.mat.seed[0]} position={[-0.03, -0.02, 0]} scale={0.5} />
        </>
      )}
      {/* generous invisible grab target, important on touch screens */}
      <mesh visible={false}>
        <sphereGeometry args={[Math.max(0.22, p.r * 2.2), 8, 6]} />
      </mesh>
    </group>
  );
}

/* ---------------- surfaces ---------------- */
function groundAt(x: number, z: number) {
  const dock = dockHeightAt(x, z);
  const h = height(x, z);
  return dock !== null ? Math.max(dock, h) : h;
}

const tmpN = new Vector3();
const up = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();
const axis = new Vector3();

function surfaceOf(x: number, z: number, y: number): "sand" | "grass" | "rock" | "wood" {
  if (dockHeightAt(x, z) !== null && Math.abs(y - groundAt(x, z)) < 0.2) return "wood";
  const n = normalAt(x, z, tmpN);
  if (n.y < 0.75) return "rock";
  if (y > 0.5 && islandD(x, z) < 0.86) return "grass";
  return "sand";
}

/* ---------------- the system ---------------- */
function scatterInitialProps() {
  if (props.length > 0) return;
  const beach = (a: number, r: number) => {
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return new Vector3(x, groundAt(x, z) + 0.07, z);
  };
  const init: [PropKind, Vector3][] = [
    ["pebble", beach(0.55, 8.9)],
    ["pebble", beach(0.6, 9.1)],
    ["pebble", beach(0.5, 9.25)],
    ["shell", beach(1.0, 9.15)],
    ["pebble", beach(1.45, 8.8)],
    ["starfish", beach(0.15, 9.3)],
    ["pebble", beach(2.05, 9.0)],
    ["shell", beach(-0.2, 9.2)],
    ["coconut", beach(0.85, 8.3)],
    ["pebble", new Vector3(CABIN.x + 1.6, height(CABIN.x + 1.6, CABIN.z + 1.1) + 0.06, CABIN.z + 1.1)],
    ["stick", new Vector3(1.2, height(1.2, 0.2) + 0.05, 0.2)],
    ["pebble", new Vector3(POND.x + 1.5, height(POND.x + 1.5, POND.z + 0.4) + 0.06, POND.z + 0.4)],
  ];
  init.forEach(([k, p]) => props.push(makeProp(k, p)));
}

export function Props() {
  const assets = useAssets();
  const [list, setList] = useState<Prop[]>(() => {
    scatterInitialProps();
    return props.filter((p) => p.state !== "dead");
  });
  const { camera, gl, controls } = useThree();
  const drag = useRef({
    prop: null as Prop | null,
    plane: new Plane(),
    target: new Vector3(),
    offset: new Vector3(),
    hist: [] as { t: number; p: Vector3 }[],
    downAt: 0,
    downXY: new Vector2(),
    moved: false,
  });
  const ray = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const bottleTimer = useRef(28);

  const sync = () => setList(props.filter((p) => p.state !== "dead").slice());

  const spawn = (kind: PropKind, pos: Vector3, vel?: Vector3) => {
    const p = makeProp(kind, pos, vel);
    if (vel && !UPRIGHT.has(kind)) p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6);
    if (UPRIGHT.has(kind)) {
      const same = props.filter((q) => q.kind === kind && q.state !== "dead");
      if (same.length >= 8) same[0].state = "dead";
    }
    props.push(p);
    // keep it light: retire the oldest ordinary resting prop
    const live = props.filter((q) => q.state !== "dead");
    if (live.length > 36) {
      const victim = live.find((q) => q.state === "rest" && q.kind !== "seed" && q.kind !== "bottle");
      if (victim) victim.state = "dead";
    }
    sync();
    return p;
  };

  // external spawns
  useEffect(() => {

    const off = on("spawnProp", ({ kind, pos, vel }) => {
      spawn(kind, pos, vel ?? new Vector3());
    });
    const offGust = on("gust", ({ pos, dir, strength }) => {
      for (const p of props) {
        if (p.state !== "rest" && p.state !== "float") continue;
        const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
        if (d > 2.2 || KIND[p.kind].mass > 1.2) continue;
        const k = (1 - d / 2.2) * strength / Math.max(0.3, KIND[p.kind].mass);
        if (p.state === "float") {
          p.vel.x += dir.x * k * 0.6;
          p.vel.z += dir.z * k * 0.6;
        } else if (k > 0.5) {
          p.vel.set(dir.x * k * 1.4, 0.6 + k * 0.4, dir.z * k * 1.4);
          p.state = "air";
        }
      }
    });
    return () => {
      off();
      offGust();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pointer handling while dragging
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d.prop) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = new Vector3();
      if (ray.ray.intersectPlane(d.plane, hit)) {
        d.target.copy(hit).add(d.offset);
      }
      if (Math.hypot(e.clientX - d.downXY.x, e.clientY - d.downXY.y) > 6) d.moved = true;
    };
    const upH = () => {
      const d = drag.current;
      const p = d.prop;
      if (!p) return;
      d.prop = null;
      world.holding = false;
      lockCursor(null);
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
      if (!d.moved && world.elapsed - d.downAt < 0.35) {
        tapProp(p);
        return;
      }
      // throw velocity from the recent motion
      const h = d.hist;
      const v = new Vector3();
      if (h.length >= 2) {
        const a = h[0];
        const b = h[h.length - 1];
        const dt = Math.max(0.016, b.t - a.t);
        v.subVectors(b.p, a.p).divideScalar(dt);
      }
      const speed = v.length();
      if (speed > 0.8) {
        const fwd = new Vector3();
        camera.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        v.addScaledVector(fwd, speed * 0.55);
        v.y += speed * 0.12;
        v.clampLength(0, 22);
        sfx("whoosh", p.pos, clamp(speed / 12), 0.8 + Math.random() * 0.3);
      }
      p.vel.copy(v);
      p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4 + speed);
      p.state = "air";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", upH);
    window.addEventListener("pointercancel", upH);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", upH);
      window.removeEventListener("pointercancel", upH);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, controls]);

  const onGrab = (p: Prop, e: ThreeEvent<PointerEvent>) => {
    if (p.state === "planted" || p.state === "dead") return;
    e.stopPropagation();
    markInput();
    const d = drag.current;
    d.prop = p;
    d.moved = false;
    d.downAt = world.elapsed;
    d.downXY.set(e.nativeEvent.clientX, e.nativeEvent.clientY);
    const n = new Vector3();
    camera.getWorldDirection(n);
    n.y = 0;
    n.normalize();
    d.plane.setFromNormalAndCoplanarPoint(n.negate(), p.pos);
    d.offset.set(0, 0, 0);
    d.target.copy(p.pos).add(new Vector3(0, 0.25, 0));
    d.hist = [];
    world.holding = true;
    p.state = "held";
    lockCursor("grabbing");
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
    sfx("pick", p.pos, 0.5, 1 + Math.random() * 0.2);
    emit("disturb", { pos: p.pos.clone(), radius: 1.2 });
  };

  const tapProp = (p: Prop) => {
    if (p.kind === "bottle" && !world.bottleOpened) {
      world.bottleOpened = true;
      discover("bottle");
      sfx("cork", p.pos, 1);
      spawnSparkle(p.pos, 18, new Color("#9ff7d0"), 0.3, 1.2);
      spawn("seed", p.pos.clone().add(new Vector3(0, 0.15, 0)), new Vector3(0.6, 3.2, 0.4));
      emit("hint", { text: "it wants to be planted" });
      sync();
      return;
    }
    // a little hop
    p.vel.set((Math.random() - 0.5) * 0.8, 2.4 + Math.random(), (Math.random() - 0.5) * 0.8);
    p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
    p.state = p.state === "float" ? "float" : "air";
    if (p.state === "float") {
      p.vel.y = 1.4;
      p.state = "air";
    }
    sfx("tick", p.pos, 0.6, p.kind === "coconut" ? 0.6 : 1.3);
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const t = world.elapsed;
    let changed = false;
    const d = drag.current;

    // a bottle drifts ashore now and then (until it's been opened)
    if (!world.bottleOpened && !props.some((p) => p.kind === "bottle" && p.state !== "dead")) {
      bottleTimer.current -= dt;
      if (bottleTimer.current < 0) {
        bottleTimer.current = 60;
        const a = 0.2 + Math.random() * 1.6;
        spawn("bottle", new Vector3(Math.cos(a) * 15, 0, Math.sin(a) * 15)).state = "float";
      }
    }

    for (const p of props) {
      if (p.state === "dead") continue;
      p.age += dt;
      if (p.state === "held" && p === d.prop) {
        const k = 1 - Math.exp(-dt * 22);
        const ground = groundAt(d.target.x, d.target.z) + p.r + 0.05;
        if (d.target.y < ground) d.target.y = ground;
        p.pos.lerp(d.target, k);
        d.hist.push({ t, p: p.pos.clone() });
        while (d.hist.length > 2 && t - d.hist[0].t > 0.09) d.hist.shift();
        // dangle
        tmpQ.setFromAxisAngle(up, dt * 1.5);
        p.quat.premultiply(tmpQ);
      } else if (p.state === "air" || p.state === "rest") {
        step(p, dt, t);
      } else if (p.state === "float") {
        floatStep(p, dt, t);
      } else if (p.state === "sink") {
        p.sinkT += dt;
        p.pos.y -= dt * 0.35;
        p.pos.x += Math.sin(t * 2 + p.id) * dt * 0.05;
        const floor = height(p.pos.x, p.pos.z) + p.r * 0.5;
        if (p.pos.y < floor) p.pos.y = floor;
        if (p.sinkT > 5) {
          p.state = "dead";
          changed = true;
        }
      }
      if (p.pos.lengthSq() > 70 * 70 || p.pos.y < -8) {
        p.state = "dead";
        changed = true;
      }
      const g = p.group;
      if (g) {
        g.position.copy(p.pos);
        g.quaternion.copy(p.quat);
        const fade = p.state === "sink" ? Math.max(0, 1 - p.sinkT / 5) : 1;
        g.scale.setScalar(fade);
      }
    }
    if (!changed) changed = props.some((p) => p.state === "dead");
    if (changed) {
      for (let i = props.length - 1; i >= 0; i--) if (props[i].state === "dead") props.splice(i, 1);
      sync();
    }
  });

  return (
    <group>
      {list.map((p) => (
        <PropView key={p.id} p={p} assets={assets} onGrab={onGrab} />
      ))}
    </group>
  );
}

/* ---------------- physics steps ---------------- */
function impactSound(surface: string, p: Prop, speed: number) {
  const s = clamp(speed / 7);
  const name = surface === "wood" ? "knock" : surface === "rock" ? "clack" : surface === "grass" ? "thud" : "sand";
  sfx(name, p.pos, s, p.kind === "coconut" ? 0.65 : p.kind === "pebble" ? 1.1 : 1);
}

function step(p: Prop, dt: number, t: number) {
  if (p.state === "rest") {
    // cursor gusts can nudge light things that are lying around
    const near = p.pos.distanceTo(world.pointer);
    if (near < 0.7 && world.pointerSpeed > 900 && world.pointerOnLand && KIND[p.kind].mass < 1.2 && !world.holding) {
      p.vel.set(world.wind.x * 1.2, 0.8, world.wind.y * 1.2);
      p.state = "air";
    } else {
      // resting on the ground: settle
      const g = groundAt(p.pos.x, p.pos.z) + p.r * 0.8;
      if (p.pos.y > g + 0.05) p.state = "air";
      else p.pos.y = g;
      const wl = waterSurface(p.pos.x, p.pos.z, t);
      if (wl !== null && p.pos.y < wl && height(p.pos.x, p.pos.z) < -0.12) {
        p.state = p.floats ? "float" : "sink";
      }
      return;
    }
  }

  const prev = p.pos.clone();
  p.vel.y -= 13 * dt;
  p.vel.multiplyScalar(Math.exp(-0.15 * dt));
  p.pos.addScaledVector(p.vel, dt);
  // spin
  const sp = p.spin.length();
  if (sp > 0.01) {
    axis.copy(p.spin).divideScalar(sp);
    tmpQ.setFromAxisAngle(axis, sp * dt);
    p.quat.premultiply(tmpQ);
  }

  // colliders (trees, cabin, rocks, buoy...)
  for (const c of colliders) {
    const dx = p.pos.x - c.x;
    const dz = p.pos.z - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < c.r + p.r && p.pos.y > c.bottom && p.pos.y < c.top + p.r) {
      const speed = p.vel.length();
      if (c.bounce && prev.y >= c.top - 0.05 && p.vel.y < 0) {
        p.pos.y = c.top + p.r;
        p.vel.y = c.bounce;
        p.vel.x += (Math.random() - 0.5) * 1.5;
        p.vel.z += (Math.random() - 0.5) * 1.5;
        sfx("boing", p.pos, 1, 0.8 + Math.random() * 0.3);
        discover("bounce");
        spawnSparkle(p.pos, 8, new Color("#ffd0b8"), 0.2, 0.5);
        c.onHit?.(p.pos, speed);
        continue;
      }
      if (c.surface === "leaf") {
        // pass through foliage, but shake it
        if (t - p.lastImpact > 0.4) {
          p.lastImpact = t;
          p.vel.multiplyScalar(0.55);
          c.onHit?.(p.pos.clone(), speed);
        }
        continue;
      }
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      const vn = p.vel.x * nx + p.vel.z * nz;
      if (vn < 0) {
        p.vel.x -= 1.6 * vn * nx;
        p.vel.z -= 1.6 * vn * nz;
        p.vel.multiplyScalar(0.6);
      }
      p.pos.x = c.x + nx * (c.r + p.r);
      p.pos.z = c.z + nz * (c.r + p.r);
      if (speed > 1.5 && t - p.lastImpact > 0.15) {
        p.lastImpact = t;
        impactSound(c.surface === "metal" ? "rock" : c.surface, p, speed);
        c.onHit?.(p.pos.clone(), speed);
        emit("disturb", { pos: p.pos.clone(), radius: 2 });
      }
    }
  }

  // water entry
  const wl = waterSurface(p.pos.x, p.pos.z, t);
  if (wl !== null && p.pos.y < wl) {
    const speed = p.vel.length();
    const pond = inPond(p.pos.x, p.pos.z);
    const strength = clamp(speed / 10 + 0.15);
    const at = new Vector3(p.pos.x, wl, p.pos.z);
    // flat, fast pebbles skim
    const vh = Math.hypot(p.vel.x, p.vel.z);
    if (p.kind === "pebble" && !pond && p.skips < 6 && vh > 4.2 && -p.vel.y < vh * 0.62) {
      p.skips++;
      p.pos.y = wl + 0.02;
      p.vel.y = Math.abs(p.vel.y) * 0.45 + 0.9;
      p.vel.x *= 0.76;
      p.vel.z *= 0.76;
      addRipple(at.x, at.z, 0.5);
      spawnSplash(at, 0.12);
      sfx("skip", at, 0.9, 1 + p.skips * 0.09);
      emit("skip", { pos: at, count: p.skips });
      emit("disturb", { pos: at, radius: 1.6 });
      if (p.skips >= 3) discover("skipper");
      return;
    }
    if (UPRIGHT.has(p.kind)) {
      p.quat.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      p.spin.set(0, 0, 0);
    }
    if (pond) addPondRipple(p.pos.x, p.pos.z, 1);
    else {
      addRipple(p.pos.x, p.pos.z, 0.5 + strength * 1.2);
      if (strength > 0.5) setTimeout(() => addRipple(at.x, at.z, 0.5), 220);
    }
    spawnSplash(at, strength * (pond ? 0.6 : 1));
    sfx(strength > 0.45 ? "splash" : "plop", at, strength);
    emit("splash", { pos: at, strength, kind: p.kind, pond });
    emit("disturb", { pos: at, radius: 2 + strength * 4 });
    if (p.food) emit("food", { pos: at });
    p.state = p.floats ? "float" : "sink";
    p.vel.multiplyScalar(p.floats ? 0.25 : 0.1);
    p.vel.y = 0;
    return;
  }

  // ground collision
  const g = groundAt(p.pos.x, p.pos.z);
  if (p.pos.y - p.r < g) {
    const surface = surfaceOf(p.pos.x, p.pos.z, g);
    const n = dockHeightAt(p.pos.x, p.pos.z) !== null ? tmpN.set(0, 1, 0) : normalAt(p.pos.x, p.pos.z, tmpN);
    p.pos.y = g + p.r;
    const vn = p.vel.dot(n);
    const speed = p.vel.length();
    if (vn < 0) {
      const e = surface === "sand" ? p.bounce * 0.5 : p.bounce;
      p.vel.addScaledVector(n, -(1 + e) * vn);
      const fr = surface === "sand" ? 0.82 : 0.9;
      p.vel.x *= fr;
      p.vel.z *= fr;
      p.spin.multiplyScalar(0.7);
      if (-vn > 1.6 && t - p.lastImpact > 0.12) {
        p.lastImpact = t;
        impactSound(surface, p, -vn);
        const dustCol = surface === "sand" ? "#e3cc96" : surface === "grass" ? "#9fb86a" : "#b9a58a";
        spawnDust(p.pos.clone().setY(g), new Color(dustCol), clamp(-vn / 6));
        emit("impact", { pos: p.pos.clone(), strength: clamp(-vn / 8), surface });
        emit("disturb", { pos: p.pos.clone(), radius: 1.5 + clamp(-vn / 8) * 2.5 });
      }
    }
    // rolling: gravity along slope
    p.vel.x += n.x * 9 * dt;
    p.vel.z += n.z * 9 * dt;
    // rolling rotation
    const hs = Math.hypot(p.vel.x, p.vel.z);
    if (hs > 0.05) {
      axis.set(p.vel.z, 0, -p.vel.x).normalize();
      tmpQ.setFromAxisAngle(axis, (hs / p.r) * dt * (p.kind === "stick" ? 0.15 : 0.6));
      p.quat.premultiply(tmpQ);
    }
    if (speed < 0.35 && n.y > 0.8) {
      p.restT += dt;
      if (p.restT > 0.25) {
        p.state = "rest";
        p.vel.set(0, 0, 0);
        p.spin.set(0, 0, 0);
        p.restT = 0;
        if (p.kind === "seed") plantSeed(p);
      }
    } else p.restT = 0;
  }
}

function waterSurface(x: number, z: number, t: number) {
  if (inPond(x, z)) return POND_LEVEL;
  const h = height(x, z);
  if (h >= 0.02) return null;
  if (dockHeightAt(x, z) !== null) {
    // under the dock is still water, but the deck catches things first
  }
  return waveHeight(x, z, t, -h);
}

function floatStep(p: Prop, dt: number, t: number) {
  const pond = inPond(p.pos.x, p.pos.z);
  const wl = pond ? POND_LEVEL : waveHeight(p.pos.x, p.pos.z, t, -height(p.pos.x, p.pos.z));
  p.pos.y += (wl - p.r * 0.25 - p.pos.y) * Math.min(1, dt * 6);
  // drift with the wind, and the sea slowly returns things to shore
  const toShore = pond ? new Vector3() : new Vector3(-p.pos.x, 0, -p.pos.z).normalize().multiplyScalar(0.12);
  const sail = p.kind === "paperboat" ? 0.45 : p.kind === "lantern" ? 0.25 : 0.12;
  p.vel.x += (world.wind.x * sail + toShore.x) * dt;
  p.vel.z += (world.wind.y * sail + toShore.z) * dt;
  p.vel.multiplyScalar(Math.exp(-dt * 0.8));
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  tmpQ.setFromAxisAngle(axis.set(Math.sin(t + p.id), 0, Math.cos(t * 0.8 + p.id)).normalize(), Math.sin(t * 1.7 + p.id) * 0.004);
  p.quat.premultiply(tmpQ);
  // beached?
  const h = height(p.pos.x, p.pos.z);
  if (!pond && h > -0.06) {
    p.state = "rest";
    p.vel.set(0, 0, 0);
    p.pos.y = Math.max(h, 0) + p.r * 0.8;
    if (p.kind === "bottle") {
      sfx("chime", p.pos, 0.35);
      spawnSparkle(p.pos, 6, new Color("#cff9ea"), 0.2, 0.5);
    }
  }
  if (pond) {
    const dx = p.pos.x - POND.x;
    const dz = p.pos.z - POND.z;
    const dd = Math.hypot(dx, dz);
    if (dd > POND.r - 0.2) {
      p.pos.x = POND.x + (dx / dd) * (POND.r - 0.2);
      p.pos.z = POND.z + (dz / dd) * (POND.r - 0.2);
      p.vel.multiplyScalar(-0.3);
    }
  }
}

function plantSeed(p: Prop) {
  if (world.seedPlanted) return;
  const h = height(p.pos.x, p.pos.z);
  if (h < 0.45 || inPond(p.pos.x, p.pos.z) || dockHeightAt(p.pos.x, p.pos.z) !== null) return;
  if (normalAt(p.pos.x, p.pos.z).y < 0.85) return;
  world.seedPlanted = true;
  p.state = "planted";
  emit("seedPlanted", { pos: p.pos.clone() });
  p.state = "dead";
}
