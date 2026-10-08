"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  BallCollider,
  CapsuleCollider,
  ConvexHullCollider,
  CylinderCollider,
  RigidBody,
  type CollisionEnterPayload,
  type IntersectionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Material,
  MeshStandardMaterial,
  Plane,
  Quaternion,
  Raycaster,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { CABIN, POND } from "../lib/layout";
import { clamp } from "../lib/math";
import { height, inPond, islandD, normalAt, POND_LEVEL } from "../lib/terrain";
import { landCrumbs } from "../lib/tools";
import { addPondRipple, addRipple, emit, markInput, on, sfx, waveHeight, world, type PropKind } from "../lib/world";
import { discover } from "../lib/secrets";
import { lockCursor, setCursor } from "./cursor";
import { pools, spawnDust, spawnSparkle, spawnSplash } from "./effects/Particles";
import type { StaticInfo } from "./PhysicsWorld";
import { dockHeightAt } from "./Shore";

type PropState = "dyn" | "held" | "float" | "sink" | "dead";
type Tuple3 = [number, number, number];

export type Prop = {
  id: number;
  kind: PropKind;
  /** mirrored from the rigid body every frame */
  pos: Vector3;
  /** only used while floating (kinematic) */
  vel: Vector3;
  quat: Quaternion;
  r: number;
  state: PropState;
  floats: boolean;
  food: boolean;
  age: number;
  sinkT: number;
  still: number;
  lastImpact: number;
  skips: number;
  variant: number;
  prevVel: Vector3;
  body: RapierRigidBody | null;
  view: Group | null;
  /** spawn values handed to <RigidBody> once; must never change afterwards */
  init: { pos: Tuple3; rot: Tuple3; vel: Tuple3; spin: Tuple3; type: "dynamic" | "kinematicPosition" };
};

type PropUD = { kind: "prop"; p: Prop };
type BodyUD = StaticInfo | PropUD;

const DYNAMIC = 0;
const KINEMATIC = 2;

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
  seedball: { r: 0.07, floats: false, food: false, bounce: 0.05, mass: 0.5 },
};
const SKIMMERS = new Set<PropKind>(["pebble", "shell"]);

export const props: Prop[] = [];
let nextId = 1;
export function getFoodProps() {
  return props.filter((p) => p.food && (p.state === "float" || p.state === "sink"));
}

const rnd3 = (s: number): Tuple3 => [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s];

function makeProp(kind: PropKind, pos: Vector3, vel?: Vector3, opts: { float?: boolean; spin?: boolean } = {}): Prop {
  const k = KIND[kind];
  const yaw = Math.random() * Math.PI * 2;
  return {
    id: nextId++,
    kind,
    pos: pos.clone(),
    vel: new Vector3(),
    quat: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
    r: k.r,
    state: opts.float ? "float" : "dyn",
    floats: k.floats,
    food: k.food,
    age: 0,
    sinkT: 0,
    still: 0,
    lastImpact: -10,
    skips: 0,
    variant: Math.floor(Math.random() * 3),
    prevVel: vel ? vel.clone() : new Vector3(),
    body: null,
    view: null,
    init: {
      pos: [pos.x, pos.y, pos.z],
      rot: [0, yaw, 0],
      vel: vel ? [vel.x, vel.y, vel.z] : [0, 0, 0],
      spin: opts.spin ? rnd3(12) : [0, 0, 0],
      type: opts.float ? "kinematicPosition" : "dynamic",
    },
  };
}

/* ---------------- geometry / materials ---------------- */
const hullOf = (g: BufferGeometry, s = 1) => {
  const src = (g.attributes.position as BufferAttribute).array as Float32Array;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] * s;
  return out;
};

function seedballGeo() {
  const g = new IcosahedronGeometry(0.07, 2);
  const pos = g.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const clay = new Color("#9b7a55");
  const speck = [new Color("#6fae4a"), new Color("#e9c46a"), new Color("#f08aa8")];
  const v = new Vector3();
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 90) * Math.sin(v.y * 80 + 1) * Math.sin(v.z * 70 + 2);
    v.multiplyScalar(1 + n * 0.08);
    pos.setXYZ(i, v.x, v.y, v.z);
    const h = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    c.copy(h > 0.86 ? speck[i % 3] : clay).offsetHSL(0, 0, (h - 0.5) * 0.06);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

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
    star.translate(0, -0.012, 0);
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
    shell.translate(0, -0.015, 0);
    const cone = new ConeGeometry(0.05, 0.13, 8);
    return {
      geo: {
        pebble: pebble as BufferGeometry,
        shell: shell as BufferGeometry,
        starfish: star as BufferGeometry,
        coconut: new SphereGeometry(0.11, 14, 10) as BufferGeometry,
        apple: new SphereGeometry(0.075, 14, 10) as BufferGeometry,
        cone: cone as BufferGeometry,
        stick: new CapsuleGeometry(0.018, 0.42, 3, 5).rotateZ(Math.PI / 2) as BufferGeometry,
        bottle: bottle as BufferGeometry,
        seed: new SphereGeometry(0.055, 14, 10) as BufferGeometry,
        seedball: seedballGeo() as BufferGeometry,
        cork: new CylinderGeometry(0.02, 0.018, 0.04, 8).rotateZ(Math.PI / 2) as BufferGeometry,
        paper: new CylinderGeometry(0.03, 0.03, 0.12, 8).rotateZ(Math.PI / 2) as BufferGeometry,
        stem: new CylinderGeometry(0.006, 0.006, 0.04, 4) as BufferGeometry,
      },
      hull: {
        pebble: [0, 1, 2].map((v) => hullOf(pebble, 0.8 + v * 0.25)),
        shell: [hullOf(shell)],
        cone: [hullOf(cone)],
        bottle: [hullOf(bottle)],
      } as Partial<Record<PropKind, Float32Array[]>>,
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
        seedball: [m("#ffffff", 0.95, { vertexColors: true })] as Material[],
        cork: m("#b88a5a", 0.9),
        paper: m("#f1e6c9", 0.9),
        stem: m("#4f7a32", 0.9),
      },
    };
  }, []);
}
type Assets = ReturnType<typeof useAssets>;

/* ---------------- shared handles (set by <Props/>) ---------------- */
const api = {
  grab: (() => {}) as (p: Prop, e: ThreeEvent<PointerEvent>) => void,
  spawn: (() => null) as (kind: PropKind, pos: Vector3, vel?: Vector3, opts?: { float?: boolean; spin?: boolean }) => Prop | null,
};

/* ---------------- one prop ---------------- */
function PropCollider({ p, assets }: { p: Prop; assets: Assets }) {
  const k = KIND[p.kind];
  const common = { mass: k.mass * 0.25, friction: 0.75, restitution: k.bounce };
  switch (p.kind) {
    case "coconut":
    case "apple":
    case "seed":
    case "seedball":
      return <BallCollider args={[k.r]} {...common} />;
    case "stick":
      return <CapsuleCollider args={[0.21, 0.02]} rotation={[0, 0, Math.PI / 2]} {...common} />;
    case "starfish":
      return <CylinderCollider args={[0.014, 0.08]} {...common} />;
    default: {
      const hulls = assets.hull[p.kind]!;
      return <ConvexHullCollider args={[hulls[p.variant % hulls.length]]} {...common} />;
    }
  }
}

const PropView = memo(function PropView({ p, assets, opened }: { p: Prop; assets: Assets; opened: boolean }) {
  const variant = p.variant;
  const mats = assets.mat[p.kind];
  const mat = mats[variant % mats.length];
  const ud = useMemo<PropUD>(() => ({ kind: "prop", p }), [p]);
  const onEnter = useMemo(() => (e: CollisionEnterPayload) => onPropCollide(p, e), [p]);
  const onSensor = useMemo(() => (e: IntersectionEnterPayload) => onPropSensor(p, e), [p]);
  return (
    <RigidBody
      ref={(b) => {
        p.body = b;
      }}
      type={p.init.type}
      colliders={false}
      position={p.init.pos}
      rotation={p.init.rot}
      linearVelocity={p.init.vel}
      angularVelocity={p.init.spin}
      linearDamping={0.08}
      angularDamping={p.kind === "coconut" || p.kind === "apple" || p.kind === "seed" ? 1.1 : 0.6}
      ccd
      userData={ud}
      onCollisionEnter={onEnter}
      onIntersectionEnter={onSensor}
    >
      <PropCollider p={p} assets={assets} />
      <group
        ref={(g) => {
          p.view = g;
        }}
        onPointerDown={(e) => api.grab(p, e)}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (!world.holding) setCursor("grab");
        }}
        onPointerOut={() => !world.holding && setCursor("default")}
      >
        <mesh geometry={assets.geo[p.kind]} material={mat} castShadow receiveShadow scale={p.kind === "pebble" ? 0.8 + variant * 0.25 : 1} />
        {p.kind === "apple" && <mesh geometry={assets.geo.stem} material={assets.mat.stem} position={[0, 0.08, 0]} />}
        {p.kind === "bottle" && !opened && (
          <>
            <mesh geometry={assets.geo.cork} material={assets.mat.cork} position={[-0.14, 0, 0]} />
            <mesh geometry={assets.geo.paper} material={assets.mat.paper} />
            <mesh geometry={assets.geo.seed} material={assets.mat.seed[0]} position={[-0.03, -0.02, 0]} scale={0.5} />
          </>
        )}
        {/* generous invisible grab target, important on touch screens */}
        <mesh visible={false}>
          <sphereGeometry args={[Math.max(0.22, p.r * 2.2), 8, 6]} />
        </mesh>
      </group>
    </RigidBody>
  );
});

/* ---------------- surfaces ---------------- */
function groundAt(x: number, z: number) {
  const dock = dockHeightAt(x, z);
  const h = height(x, z);
  return dock !== null ? Math.max(dock, h) : h;
}

const tmpN = new Vector3();
const tmpQ = new Quaternion();
const axis = new Vector3();
const tmpV = new Vector3();
const holdVel = new Vector3();
const holdSpin = { x: 0, y: 1.5, z: 0 };

type Ground = "sand" | "grass" | "rock" | "wood";
function surfaceOf(x: number, z: number, y: number): Ground {
  if (dockHeightAt(x, z) !== null && Math.abs(y - groundAt(x, z)) < 0.25) return "wood";
  const n = normalAt(x, z, tmpN);
  if (n.y < 0.75) return "rock";
  if (y > 0.5 && islandD(x, z) < 0.86) return "grass";
  return "sand";
}

function impactSound(surface: Ground, p: Prop, speed: number) {
  const s = clamp(speed / 7);
  const name = surface === "wood" ? "knock" : surface === "rock" ? "clack" : surface === "grass" ? "thud" : "sand";
  sfx(name, p.pos, s, p.kind === "coconut" ? 0.65 : p.kind === "pebble" ? 1.1 : 1);
}

/* ---------------- contact events ---------------- */
function onPropCollide(p: Prop, e: CollisionEnterPayload) {
  const b = p.body;
  if (!b || p.state !== "dyn") return;
  const ud = e.other.rigidBody?.userData as BodyUD | undefined;
  const n = e.manifold.normal();
  const impact = Math.abs(p.prevVel.x * n.x + p.prevVel.y * n.y + p.prevVel.z * n.z);
  const tr = b.translation();
  const at = new Vector3(tr.x, tr.y, tr.z);
  const t = world.elapsed;
  let surface: Ground = "rock";
  let ground = false;

  if (ud?.kind === "terrain") {
    surface = surfaceOf(at.x, at.z, at.y);
    ground = true;
  } else if (ud?.kind === "dock") {
    surface = "wood";
    ground = true;
  } else if (ud?.kind === "obstacle") {
    const c = ud.c;
    if (c.surface === "mush" && c.bounce && at.y > c.top - 0.1) {
      const lv = b.linvel();
      b.setLinvel({ x: lv.x * 0.6 + (Math.random() - 0.5) * 1.5, y: c.bounce, z: lv.z * 0.6 + (Math.random() - 0.5) * 1.5 }, true);
      sfx("boing", at, 1, 0.8 + Math.random() * 0.3);
      discover("bounce");
      spawnSparkle(at, 8, new Color("#ffd0b8"), 0.2, 0.5);
      c.onHit?.(at, impact);
      return;
    }
    surface = c.surface === "wood" ? "wood" : "rock";
    if (impact > 1.2) c.onHit?.(at.clone(), impact);
  }

  if (p.kind === "seedball" && (impact > 0.5 || ground)) {
    burstSeedball(p, at, surface, ground);
    return;
  }
  if (impact > 1.4 && t - p.lastImpact > 0.12) {
    p.lastImpact = t;
    impactSound(surface, p, impact);
    if (ground) {
      const dustCol = surface === "sand" ? "#e3cc96" : surface === "grass" ? "#9fb86a" : "#b9a58a";
      spawnDust(at.clone().setY(at.y - p.r), new Color(dustCol), clamp(impact / 6));
      emit("impact", { pos: at.clone(), strength: clamp(impact / 8), surface });
    }
    emit("disturb", { pos: at.clone(), radius: 1.5 + clamp(impact / 8) * 2.5 });
  }
}

function onPropSensor(p: Prop, e: IntersectionEnterPayload) {
  const b = p.body;
  if (!b || p.state !== "dyn") return;
  const ud = e.other.rigidBody?.userData as BodyUD | undefined;
  if (ud?.kind !== "obstacle" || ud.c.surface !== "leaf") return;
  const t = world.elapsed;
  if (t - p.lastImpact < 0.4) return;
  p.lastImpact = t;
  const lv = b.linvel();
  const speed = Math.hypot(lv.x, lv.y, lv.z);
  // foliage soaks up some speed and rustles
  b.setLinvel({ x: lv.x * 0.55, y: lv.y * 0.55, z: lv.z * 0.55 }, true);
  const tr = b.translation();
  ud.c.onHit?.(new Vector3(tr.x, tr.y, tr.z), speed);
}

const SEED_FLECK = new Color("#8a6a3e");
const BEACH_BLOOMS = ["#f49ac1", "#ffc2d9", "#ff8fa3"];

/** Clay seed ball breaks open and leaves something behind depending on where it lands. */
function burstSeedball(p: Prop, at: Vector3, surface: Ground, ground: boolean) {
  p.state = "dead";
  sfx("pop", at, 0.8, 0.75 + Math.random() * 0.15);
  sfx("sand", at, 0.5, 1.3);
  spawnDust(at, new Color(surface === "grass" ? "#9a8a5a" : "#cbb48a"), 0.6);
  for (let i = 0; i < 10; i++) {
    pools.soft.spawn({
      x: at.x,
      y: at.y + 0.04,
      z: at.z,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 0.8 + Math.random() * 0.9,
      vz: (Math.random() - 0.5) * 1.6,
      color: SEED_FLECK,
      size: 0.03,
      life: 0.5,
      gravity: 9,
      drag: 0.4,
    });
  }
  emit("disturb", { pos: at.clone(), radius: 1.6 });
  const spots = surface === "grass" ? 3 : surface === "sand" ? 2 : 0;
  for (let i = 0; i < spots; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.18 + Math.random() * 0.25;
    const x = at.x + Math.cos(a) * d;
    const z = at.z + Math.sin(a) * d;
    const h = height(x, z);
    if (inPond(x, z) || dockHeightAt(x, z) !== null || h < 0.06 || normalAt(x, z).y < 0.8) continue;
    const color = surface === "sand" ? BEACH_BLOOMS[Math.floor(Math.random() * BEACH_BLOOMS.length)] : undefined;
    setTimeout(() => emit("plantSprout", { pos: new Vector3(x, h, z), color }), 160 + i * 140);
  }
  if (ground) {
    // a few loose seeds for the birds
    for (let i = 0; i < 4; i++) {
      const x = at.x + (Math.random() - 0.5) * 0.4;
      const z = at.z + (Math.random() - 0.5) * 0.4;
      if (landCrumbs.length >= 80) landCrumbs.shift();
      landCrumbs.push({ pos: new Vector3(x, groundAt(x, z) + 0.012, z), t: world.elapsed });
    }
    emit("crumbs", { pos: at.clone(), water: false });
  }
}

/* ---------------- the system ---------------- */
function scatterInitialProps() {
  if (props.length > 0) return;
  const beach = (a: number, r: number, kind: PropKind) => {
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return new Vector3(x, groundAt(x, z) + KIND[kind].r + 0.03, z);
  };
  const at = (x: number, z: number, kind: PropKind) => new Vector3(x, groundAt(x, z) + KIND[kind].r + 0.03, z);
  const init: [PropKind, Vector3][] = [
    ["pebble", beach(0.55, 8.9, "pebble")],
    ["pebble", beach(0.6, 9.1, "pebble")],
    ["pebble", beach(0.5, 9.25, "pebble")],
    ["shell", beach(1.0, 9.15, "shell")],
    ["pebble", beach(1.45, 8.8, "pebble")],
    ["starfish", beach(0.15, 9.3, "starfish")],
    ["pebble", beach(2.05, 9.0, "pebble")],
    ["shell", beach(-0.2, 9.2, "shell")],
    ["coconut", beach(0.85, 8.3, "coconut")],
    ["pebble", at(CABIN.x + 1.6, CABIN.z + 1.1, "pebble")],
    ["stick", at(1.2, 0.2, "stick")],
    ["pebble", at(POND.x + 1.9, POND.z + 0.5, "pebble")],
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
    hist: [] as { t: number; p: Vector3 }[],
    downAt: 0,
    downXY: new Vector2(),
    moved: false,
    pointerId: -1,
  });
  const ray = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const bottleTimer = useRef(28);

  const sync = () => setList(props.filter((p) => p.state !== "dead").slice());

  const spawn = (kind: PropKind, pos: Vector3, vel?: Vector3, opts?: { float?: boolean; spin?: boolean }) => {
    const p = makeProp(kind, pos, vel, opts);
    props.push(p);
    // keep it light: retire the oldest ordinary prop, preferring ones lying still or long adrift
    const live = props.filter((q) => q.state !== "dead");
    if (live.length > 36) {
      const ok = (q: Prop) => q !== p && q.kind !== "seed" && q.kind !== "bottle";
      const victim =
        live.find((q) => ok(q) && q.state === "dyn" && q.body?.isSleeping()) ??
        live.find((q) => ok(q) && q.state === "float" && q.age > 20) ??
        live.find((q) => ok(q) && q.state === "dyn");
      if (victim) victim.state = "dead";
    }
    sync();
    return p;
  };

  const tapProp = (p: Prop) => {
    const b = p.body;
    if (!b) return;
    if (p.kind === "bottle" && !world.bottleOpened) {
      world.bottleOpened = true;
      discover("bottle");
      sfx("cork", p.pos, 1);
      spawnSparkle(p.pos, 18, new Color("#9ff7d0"), 0.3, 1.2);
      spawn("seed", p.pos.clone().add(new Vector3(0, 0.2, 0)), new Vector3(0.6, 3.2, 0.4));
      emit("hint", { text: "it wants to be planted" });
      sync();
      return;
    }
    if (p.state === "float") {
      p.state = "dyn";
      b.setBodyType(DYNAMIC, true);
      b.setTranslation({ x: p.pos.x, y: p.pos.y + p.r + 0.06, z: p.pos.z }, true);
      b.setLinvel({ x: (Math.random() - 0.5) * 0.4, y: 1.8, z: (Math.random() - 0.5) * 0.4 }, true);
    } else {
      const lv = b.linvel();
      b.setLinvel({ x: lv.x + (Math.random() - 0.5) * 0.8, y: 2.4 + Math.random(), z: lv.z + (Math.random() - 0.5) * 0.8 }, true);
      const [sx, sy, sz] = rnd3(16);
      b.setAngvel({ x: sx, y: sy, z: sz }, true);
    }
    sfx("tick", p.pos, 0.6, p.kind === "coconut" ? 0.6 : 1.3);
  };

  const grab = (p: Prop, e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    // one thing at a time: a second finger must not orphan the first prop mid-air
    if (d.prop || p.state === "dead" || p.state === "sink" || !p.body) return;
    e.stopPropagation();
    markInput();
    d.prop = p;
    d.pointerId = e.nativeEvent.pointerId;
    d.moved = false;
    d.downAt = world.elapsed;
    d.downXY.set(e.nativeEvent.clientX, e.nativeEvent.clientY);
    const n = new Vector3();
    camera.getWorldDirection(n);
    n.y = 0;
    n.normalize();
    d.plane.setFromNormalAndCoplanarPoint(n.negate(), p.pos);
    d.target.copy(p.pos).add(new Vector3(0, 0.25, 0));
    d.hist = [];
    world.holding = true;
    p.state = "held";
    // carried as a weightless dynamic body steered by velocity, so it bumps into the world
    // instead of passing through cabins and rocks or batting other props away with infinite mass
    p.body.setBodyType(DYNAMIC, true);
    p.body.setGravityScale(0, true);
    lockCursor("grabbing");
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
    sfx("pick", p.pos, 0.5, 1 + Math.random() * 0.2);
    emit("disturb", { pos: p.pos.clone(), radius: 1.2 });
  };

  useEffect(() => {
    api.grab = grab;
    api.spawn = spawn;
  });

  useEffect(() => {
    const dbg = (window as unknown as { __island?: Record<string, unknown> }).__island;
    if (dbg) {
      dbg.props = props;
      dbg.propApi = api;
    }
  }, []);

  // external spawns and gusts
  useEffect(() => {
    const off = on("spawnProp", ({ kind, pos, vel, spin }) => {
      spawn(kind, pos, vel ?? new Vector3(), { spin });
    });
    const offGust = on("gust", ({ pos, dir, strength }) => {
      for (const p of props) {
        if (p.state !== "dyn" && p.state !== "float") continue;
        const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
        if (d > 2.2 || KIND[p.kind].mass > 1.2) continue;
        const k = ((1 - d / 2.2) * strength) / Math.max(0.3, KIND[p.kind].mass);
        if (p.state === "float") {
          p.vel.x += dir.x * k * 0.6;
          p.vel.z += dir.z * k * 0.6;
        } else if (k > 0.5 && p.body) {
          const lv = p.body.linvel();
          p.body.setLinvel({ x: lv.x + dir.x * k * 1.4, y: lv.y + 0.6 + k * 0.4, z: lv.z + dir.z * k * 1.4 }, true);
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
      if (!d.prop || e.pointerId !== d.pointerId) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = new Vector3();
      if (ray.ray.intersectPlane(d.plane, hit)) d.target.copy(hit);
      if (Math.hypot(e.clientX - d.downXY.x, e.clientY - d.downXY.y) > 6) d.moved = true;
    };
    const upH = (e?: PointerEvent | FocusEvent) => {
      const d = drag.current;
      const p = d.prop;
      if (!p) return;
      if (e && "pointerId" in e && e.pointerId !== d.pointerId) return;
      d.prop = null;
      d.pointerId = -1;
      world.holding = false;
      lockCursor(null);
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
      const b = p.body;
      p.state = "dyn";
      if (!b) return;
      b.setGravityScale(1, true);
      if (!d.moved && world.elapsed - d.downAt < 0.35) {
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        tapProp(p);
        return;
      }
      // throw velocity from the recent motion
      const h = d.hist;
      const v = new Vector3();
      if (h.length >= 2) {
        const a = h[0];
        const z = h[h.length - 1];
        v.subVectors(z.p, a.p).divideScalar(Math.max(0.016, z.t - a.t));
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
      b.setLinvel(v, true);
      const [sx, sy, sz] = rnd3(4 + speed);
      b.setAngvel({ x: sx, y: sy, z: sz }, true);
      p.prevVel.copy(v);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", upH);
    window.addEventListener("pointercancel", upH);
    window.addEventListener("blur", upH);
    const onVis = () => document.hidden && upH();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", upH);
      window.removeEventListener("pointercancel", upH);
      window.removeEventListener("blur", upH);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, controls]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const t = world.elapsed;
    const d = drag.current;

    // a bottle drifts ashore now and then (until it's been opened)
    if (!world.bottleOpened && !props.some((p) => p.kind === "bottle" && p.state !== "dead")) {
      bottleTimer.current -= dt;
      if (bottleTimer.current < 0) {
        bottleTimer.current = 60;
        const a = 0.2 + Math.random() * 1.6;
        spawn("bottle", new Vector3(Math.cos(a) * 15, 0, Math.sin(a) * 15), undefined, { float: true });
      }
    }

    for (const p of props) {
      if (p.state === "dead") continue;
      const b = p.body;
      if (!b) continue;
      p.age += dt;
      if (p.state === "held" && p === d.prop) {
        const ground = groundAt(d.target.x, d.target.z) + p.r + 0.05;
        if (d.target.y < ground) d.target.y = ground;
        const tr = b.translation();
        p.pos.set(tr.x, tr.y, tr.z);
        // chase the hand with a velocity, so the solver still blocks it on anything solid
        holdVel.subVectors(d.target, p.pos).multiplyScalar(18).clampLength(0, 16);
        b.setLinvel(holdVel, true);
        b.setAngvel(holdSpin, true);
        d.hist.push({ t, p: p.pos.clone() });
        while (d.hist.length > 2 && t - d.hist[0].t > 0.09) d.hist.shift();
      } else if (p.state === "dyn") {
        const tr = b.translation();
        p.pos.set(tr.x, tr.y, tr.z);
        const lv = b.linvel();
        if (waterEntry(p, b, lv, t)) {
          // handled
        } else {
          p.prevVel.set(lv.x, lv.y, lv.z);
          const speed = p.prevVel.length();
          // cursor swipes nudge light things that are lying around
          if (speed < 0.3 && !world.holding && world.pointerOnLand && world.pointerSpeed > 900 && KIND[p.kind].mass < 1.2 && p.pos.distanceTo(world.pointer) < 0.7) {
            b.setLinvel({ x: world.wind.x * 1.2, y: 0.8, z: world.wind.y * 1.2 }, true);
          }
          if (p.kind === "seed") {
            p.still = speed < 0.15 ? p.still + dt : 0;
            if (p.still > 0.5) plantSeed(p);
          }
        }
      } else if (p.state === "float") {
        floatStep(p, b, dt, t);
      } else if (p.state === "sink") {
        p.sinkT += dt;
        const tr = b.translation();
        p.pos.set(tr.x, tr.y, tr.z);
        if (p.sinkT > 5) p.state = "dead";
      }
      if (p.pos.lengthSq() > 70 * 70 || p.pos.y < -8) p.state = "dead";
      if (p.view) p.view.scale.setScalar(p.state === "sink" ? Math.max(0.001, 1 - p.sinkT / 5) : 1);
    }
    if (props.some((p) => p.state === "dead")) {
      for (let i = props.length - 1; i >= 0; i--) if (props[i].state === "dead") props.splice(i, 1);
      sync();
    }
  });

  return (
    <group>
      {list.map((p) => (
        <PropView key={p.id} p={p} assets={assets} opened={world.bottleOpened} />
      ))}
    </group>
  );
}

/* ---------------- water ---------------- */
type Vec = { x: number; y: number; z: number };

/** Returns true if the prop met the water this frame (skim, float, sink or burst). */
function waterEntry(p: Prop, b: RapierRigidBody, lv: Vec, t: number) {
  const { x, z } = p.pos;
  const pond = inPond(x, z);
  const h = height(x, z);
  if (!pond && h > -0.12) return false;
  const wl = pond ? POND_LEVEL : waveHeight(x, z, t, -h);
  if (p.pos.y > wl) return false;
  const speed = Math.hypot(lv.x, lv.y, lv.z);
  const strength = clamp(speed / 10 + 0.15);
  const at = new Vector3(x, wl, z);

  // flat, fast stones skim
  const vh = Math.hypot(lv.x, lv.z);
  if (SKIMMERS.has(p.kind) && !pond && p.skips < 6 && vh > 4.2 && -lv.y < vh * 0.62) {
    p.skips++;
    b.setTranslation({ x, y: wl + 0.03, z }, true);
    b.setLinvel({ x: lv.x * 0.76, y: Math.abs(lv.y) * 0.45 + 0.9, z: lv.z * 0.76 }, true);
    addRipple(x, z, 0.5);
    spawnSplash(at, 0.12);
    sfx("skip", at, 0.9, 1 + p.skips * 0.09);
    emit("skip", { pos: at, count: p.skips });
    emit("disturb", { pos: at, radius: 1.6 });
    if (p.skips >= 3) discover("skipper");
    return true;
  }

  if (pond) addPondRipple(x, z, 1);
  else {
    addRipple(x, z, 0.5 + strength * 1.2);
    if (strength > 0.5) setTimeout(() => addRipple(at.x, at.z, 0.5), 220);
  }
  spawnSplash(at, strength * (pond ? 0.6 : 1));
  sfx(strength > 0.45 ? "splash" : "plop", at, strength);
  emit("splash", { pos: at, strength, kind: p.kind, pond });
  emit("disturb", { pos: at, radius: 2 + strength * 4 });

  if (p.kind === "seedball") {
    // dissolves into a cloud of seeds the fish love
    p.state = "dead";
    setTimeout(() => emit("crumbs", { pos: at, water: true }), 250);
    return true;
  }
  if (p.food) emit("food", { pos: at });
  if (p.floats) {
    p.state = "float";
    const r = b.rotation();
    p.quat.set(r.x, r.y, r.z, r.w);
    p.vel.set(lv.x * 0.25, 0, lv.z * 0.25);
    b.setBodyType(KINEMATIC, true);
  } else {
    p.state = "sink";
    b.setLinvel({ x: lv.x * 0.1, y: lv.y * 0.1, z: lv.z * 0.1 }, true);
    b.setLinearDamping(5);
    b.setAngularDamping(3);
    b.setGravityScale(0.35, true);
  }
  return true;
}

function floatStep(p: Prop, b: RapierRigidBody, dt: number, t: number) {
  const pond = inPond(p.pos.x, p.pos.z);
  const wl = pond ? POND_LEVEL : waveHeight(p.pos.x, p.pos.z, t, -height(p.pos.x, p.pos.z));
  p.pos.y += (wl - p.r * 0.25 - p.pos.y) * Math.min(1, dt * 6);
  // drift with the wind, and the sea slowly returns things to shore
  if (!pond) tmpV.set(-p.pos.x, 0, -p.pos.z).normalize().multiplyScalar(0.12);
  else tmpV.set(0, 0, 0);
  p.vel.x += (world.wind.x * 0.12 + tmpV.x) * dt;
  p.vel.z += (world.wind.y * 0.12 + tmpV.z) * dt;
  p.vel.multiplyScalar(Math.exp(-dt * 0.8));
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  tmpQ.setFromAxisAngle(axis.set(Math.sin(t + p.id), 0, Math.cos(t * 0.8 + p.id)).normalize(), Math.sin(t * 1.7 + p.id) * 0.004);
  p.quat.premultiply(tmpQ);
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
  // washed up on the beach: hand it back to the physics world
  const h = height(p.pos.x, p.pos.z);
  if (!pond && h > -0.06) {
    p.state = "dyn";
    b.setBodyType(DYNAMIC, true);
    b.setTranslation({ x: p.pos.x, y: Math.max(h, 0) + p.r + 0.04, z: p.pos.z }, true);
    b.setLinvel({ x: p.vel.x, y: 0, z: p.vel.z }, true);
    if (p.kind === "bottle") {
      sfx("chime", p.pos, 0.35);
      spawnSparkle(p.pos, 6, new Color("#cff9ea"), 0.2, 0.5);
    }
    return;
  }
  b.setNextKinematicTranslation(p.pos);
  b.setNextKinematicRotation(p.quat);
}

function plantSeed(p: Prop) {
  if (world.seedPlanted) return;
  const h = height(p.pos.x, p.pos.z);
  if (h < 0.45 || inPond(p.pos.x, p.pos.z) || dockHeightAt(p.pos.x, p.pos.z) !== null) return;
  if (normalAt(p.pos.x, p.pos.z).y < 0.85) return;
  world.seedPlanted = true;
  emit("seedPlanted", { pos: p.pos.clone().setY(h) });
  p.state = "dead";
}
