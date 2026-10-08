"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CurvePath,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { atmo, sunDirection } from "../lib/atmosphere";
import { blob, merge, place, sphericalNormals } from "../lib/geo";
import { clamp, damp, mulberry32, smoothstep } from "../lib/math";
import { height, waterLevelAt } from "../lib/terrain";
import { U, addRipple, emit, markInput, on, sfx, world } from "../lib/world";
import { discover } from "../lib/secrets";
import { lockCursor, setCursor } from "./cursor";
import { pools, spawnDust, spawnSparkle, spawnSplash } from "./effects/Particles";

/* =====================================================================
   Sun & moon: grab either one and drag it along its arc to move time.
   ===================================================================== */

const glowFrag = /* glsl */ `
uniform float uAlpha; uniform vec3 uColor; varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float a = (pow(max(0.0, 1.0 - d), 3.0) * 0.8 + smoothstep(0.32, 0.26, d) * 0.25) * uAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

function makeGlow() {
  return new ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: glowFrag,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uAlpha: { value: 0 }, uColor: { value: new Color("#fff1d6") } },
  });
}

const noRaycast = () => undefined;
const MOON_GLOW = new Color("#c9d6ff");
const SUN_DIST = 320;
const MOON_DIST = 380;
const tmpA = new Vector3();
const tmpB = new Vector3();

function moonDirection(hours: number, out: Vector3) {
  sunDirection(hours - 12, out);
  out.y = Math.abs(out.y) * 0.9 + 0.08;
  return out.normalize();
}

function CelestialHandle({ body }: { body: "sun" | "moon" }) {
  const { camera, gl, size, controls } = useThree();
  const hit = useRef<Mesh>(null);
  const glow = useRef<Mesh>(null);
  const glowMat = useMemo(() => makeGlow(), []);
  const st = useRef({ hover: 0, hovering: false, dragging: false, last: new Vector2(), lastHour: 0 });
  const dist = body === "sun" ? SUN_DIST : MOON_DIST;
  const dirOf = body === "sun" ? sunDirection : moonDirection;

  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const s = st.current;
      if (!s.dragging) return;
      const dx = e.clientX - s.last.x;
      const dy = e.clientY - s.last.y;
      s.last.set(e.clientX, e.clientY);
      // where would the body be on screen a quarter-hour from now?
      const h = world.time;
      const p0 = dirOf(h, tmpA).multiplyScalar(dist).add(camera.position).project(camera);
      const p1 = dirOf(h + 0.25, tmpB).multiplyScalar(dist).add(camera.position).project(camera);
      const sx = ((p1.x - p0.x) * size.width) / 2;
      const sy = (-(p1.y - p0.y) * size.height) / 2;
      const len2 = sx * sx + sy * sy;
      if (len2 < 0.5) return;
      const dh = clamp(((dx * sx + dy * sy) / len2) * 0.25, -1.2, 1.2);
      world.time = (((world.time + dh) % 24) + 24) % 24;
      const hour = Math.floor(world.time);
      if (hour !== s.lastHour) {
        s.lastHour = hour;
        sfx("tick", undefined, 0.25, 1.6 + (hour % 6) * 0.08);
      }
      markInput();
    };
    const up = () => {
      const s = st.current;
      if (!s.dragging) return;
      s.dragging = false;
      world.draggingTime = false;
      lockCursor(null);
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
      sfx("chime", undefined, 0.3, body === "sun" ? 1.2 : 0.9);
    };
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [camera, gl, size, controls, dirOf, dist, body]);

  useFrame((_, dt) => {
    const s = st.current;
    const dir = body === "sun" ? world.sunDir : world.moonDir;
    const vis = body === "sun" ? atmo.sunVis : atmo.moonVis;
    const pos = tmpA.copy(dir).multiplyScalar(dist).add(camera.position);
    if (hit.current) {
      hit.current.position.copy(pos);
      // only grabbable while it's in the sky (or while already held)
      hit.current.raycast = s.dragging || vis > 0.08 ? Mesh.prototype.raycast : noRaycast;
    }
    s.hover = damp(s.hover, s.hovering || s.dragging ? 1 : 0, 8, dt);
    if (glow.current) {
      glow.current.position.copy(pos);
      glow.current.quaternion.copy(camera.quaternion);
      // until someone discovers it, the sun breathes softly
      const invite = body === "sun" && !world.sunTouched ? (0.5 + 0.5 * Math.sin(world.elapsed * 1.6)) * 0.35 * smoothstep(3, 6, world.elapsed) : 0;
      glowMat.uniforms.uAlpha.value = (s.hover * 0.7 + invite) * clamp(vis * 1.5);
      glowMat.uniforms.uColor.value.copy(body === "sun" ? atmo.sunColor : MOON_GLOW).multiplyScalar(1.1);
    }
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    markInput();
    const s = st.current;
    s.dragging = true;
    s.last.set(e.nativeEvent.clientX, e.nativeEvent.clientY);
    s.lastHour = Math.floor(world.time);
    world.draggingTime = true;
    if (body === "sun") world.sunTouched = true;
    discover("timekeeper");
    lockCursor("grabbing");
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
    sfx("chime", undefined, 0.35, body === "sun" ? 1.5 : 1.1);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || body !== "moon") return;
    e.stopPropagation();
    // a wish on the moon
    emit("shootingStar", {});
    discover("wish");
  };

  return (
    <>
      <mesh
        ref={hit}
        onPointerDown={onDown}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          st.current.hovering = true;
          if (!world.holding) setCursor("grab");
        }}
        onPointerOut={() => {
          st.current.hovering = false;
          setCursor("default");
        }}
      >
        <sphereGeometry args={[body === "sun" ? 24 : 20, 12, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} fog={false} />
      </mesh>
      <mesh ref={glow} material={glowMat} raycast={() => null} renderOrder={-8}>
        <planeGeometry args={[body === "sun" ? 90 : 70, body === "sun" ? 90 : 70]} />
      </mesh>
    </>
  );
}

/* =====================================================================
   Shooting stars: rare at night, or when you tap the moon.
   ===================================================================== */

const starFrag = /* glsl */ `
uniform float uT; varying vec2 vUv;
void main(){
  float head = uT;
  float x = vUv.x;
  float tail = smoothstep(head - 0.45, head, x) * step(x, head);
  float w = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
  float a = tail * tail * w * smoothstep(0.0, 0.1, uT) * smoothstep(1.0, 0.75, uT);
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a * 1.6, a);
}`;

function ShootingStars() {
  const { camera } = useThree();
  const group = useRef<Group>(null);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: starFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        uniforms: { uT: { value: 0 } },
      }),
    [],
  );
  const st = useRef({ t: 2, next: 25, dir: new Vector3() });

  const launch = () => {
    const s = st.current;
    s.t = 0;
    // in the upper part of the current view, but always above the horizon
    s.dir
      .set((Math.random() - 0.5) * 1.1, 0.6 + Math.random() * 0.3, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    if (s.dir.y < 0.07) s.dir.setY(0.07 + Math.random() * 0.05).normalize();
    sfx("sparkle", undefined, 0.35);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => on("shootingStar", launch), []);

  useFrame((_, dt) => {
    const s = st.current;
    if (world.night > 0.7 && atmo.stars > 0.4) {
      s.next -= dt;
      if (s.next < 0) {
        s.next = 30 + Math.random() * 50;
        launch();
      }
    }
    s.t += dt / 1.1;
    const g = group.current;
    if (!g) return;
    g.visible = s.t < 1;
    if (!g.visible) return;
    g.position.copy(camera.position).addScaledVector(s.dir, 260);
    g.quaternion.copy(camera.quaternion);
    g.rotateZ(-0.45);
    mat.uniforms.uT.value = s.t;
  });

  return (
    <group ref={group} visible={false}>
      <mesh material={mat} raycast={() => null} renderOrder={-7}>
        <planeGeometry args={[70, 0.9]} />
      </mesh>
    </group>
  );
}

/* =====================================================================
   Clouds: puffy, sky-tinted, drifting with the wind. Poke one and it
   rains; keep poking a raining cloud and it loses its temper.
   ===================================================================== */

type CloudState = {
  x: number;
  z: number;
  /** extra height above the sky dome at this spot */
  lift: number;
  yaw: number;
  speed: number;
  scale: number;
  threshold: number;
  /** 0..1 fade after (re)spawning on the upwind edge */
  enter: number;
  geo: BufferGeometry;
  mat: ShaderMaterial;
  mesh: Group | null;
  squish: number;
  rain: number;
  pokes: number[];
  vis: number;
  pos: Vector3;
};

function cloudGeo(seed: number) {
  const rnd = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const n = 5 + Math.floor(rnd() * 4);
  const bottom = new Color("#c9ced9");
  const top = new Color("#ffffff");
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const r = (1.0 + rnd() * 0.9) * (1 - Math.abs(t) * 0.8);
    const g = blob({ r, detail: 2, lump: 0.1, seed: seed * 7 + i, bottom, top, squash: 0.78 });
    place(g, [t * 5.2 + (rnd() - 0.5) * 0.6, r * 0.25 + rnd() * 0.4, (rnd() - 0.5) * 1.6]);
    parts.push(g);
  }
  const m = merge(parts);
  return sphericalNormals(m, new Vector3(0, -0.6, 0), 0.82);
}

const cloudVert = /* glsl */ `
attribute vec3 color;
varying vec3 vN; varying vec3 vW; varying vec3 vCol;
void main(){
  vCol = color;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const cloudFrag = /* glsl */ `
uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uRim; uniform vec3 uLightDir;
uniform vec3 uFog; uniform float uFogDensity; uniform float uOpacity;
varying vec3 vN; varying vec3 vW; varying vec3 vCol;
void main(){
  vec3 n = normalize(vN);
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  float wrap = dot(n, uLightDir) * 0.5 + 0.5;
  float sky = n.y * 0.5 + 0.5;
  float k = clamp(wrap * 0.55 + sky * 0.55, 0.0, 1.0);
  k = smoothstep(0.15, 0.95, k);
  vec3 col = mix(uShade, uLit, k) * mix(0.9, 1.0, vCol.r);
  // silver lining when the light sits behind the cloud
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.2);
  float behind = pow(max(dot(-v, uLightDir), 0.0), 3.0);
  col += uRim * fres * (0.18 + 1.1 * behind);
  float f = 1.0 - exp(-pow(dist * uFogDensity * 0.55, 2.0));
  col = mix(col, uFog, clamp(f, 0.0, 0.85));
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}`;

function makeCloudMaterial() {
  return new ShaderMaterial({
    vertexShader: cloudVert,
    fragmentShader: cloudFrag,
    transparent: true,
    uniforms: {
      uLit: { value: new Color() },
      uShade: { value: new Color() },
      uRim: { value: new Color() },
      uLightDir: { value: new Vector3(0, 1, 0) },
      uFog: { value: new Color() },
      uFogDensity: { value: 0.008 },
      uOpacity: { value: 1 },
    },
  });
}

export const cloudStates: CloudState[] = [];

/** clouds live inside this disc, drifting downwind and re-entering upwind */
const SKY_R = 58;
const driftDir = new Vector2(0.9, 0.4).normalize();
/** a fresh sky every visit */
const SKY_SEED = (Math.random() * 2 ** 31) | 0;

/** high overhead, sinking toward the horizon so distant clouds stay in frame from any angle */
function cloudBase(r: number) {
  return 11 - 6 * smoothstep(10, 40, r);
}

function rollCloud(c: CloudState, rnd: () => number) {
  c.lift = rnd() * 2.5;
  c.yaw = rnd() * Math.PI * 2;
  c.speed = 0.6 + rnd() * 0.8;
  c.scale = 0.75 + rnd() * 0.95;
}

/** put a cloud back on the upwind rim, somewhere random along it */
function respawnUpwind(c: CloudState) {
  const side = (Math.random() * 2 - 1) * SKY_R * 0.85;
  const back = -Math.sqrt(SKY_R * SKY_R - side * side) * 0.97;
  c.x = driftDir.x * back - driftDir.y * side;
  c.z = driftDir.y * back + driftDir.x * side;
  c.enter = 0;
  rollCloud(c, Math.random);
}

function Clouds() {
  const { camera } = useThree();
  const count = world.mobile ? 9 : 14;
  const clouds = useMemo<CloudState[]>(() => {
    const rnd = mulberry32(SKY_SEED);
    // how many puffs hang around on a clear day
    const fair = 4 + Math.floor(rnd() * 3);
    const out: CloudState[] = [];
    for (let i = 0; i < count; i++) {
      // scattered over the whole disc, keeping the patch right above the island clear
      const a = rnd() * Math.PI * 2;
      const r = 14 + Math.sqrt(rnd()) * (SKY_R * 0.8 - 14);
      const c: CloudState = {
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        lift: 0,
        yaw: 0,
        speed: 1,
        scale: 1,
        threshold: i < fair ? -0.2 + rnd() * 0.2 : 0.25 + ((i - fair) / Math.max(1, count - fair)) * 0.55,
        enter: 1,
        geo: cloudGeo(100 + Math.floor(rnd() * 5000)),
        mat: makeCloudMaterial(),
        mesh: null,
        squish: 0,
        rain: 0,
        pokes: [],
        vis: i < fair ? 1 : 0,
        pos: new Vector3(),
      };
      rollCloud(c, rnd);
      out.push(c);
    }
    return out;
  }, [count]);

  useEffect(
    () => () => {
      for (const c of clouds) {
        c.geo.dispose();
        c.mat.dispose();
      }
    },
    [clouds],
  );

  useEffect(() => {
    cloudStates.length = 0;
    cloudStates.push(...clouds);
    const dbg = (window as unknown as { __island?: Record<string, unknown> }).__island;
    if (dbg) dbg.clouds = cloudStates;
    return () => {
      cloudStates.length = 0;
    };
  }, [clouds]);

  const lit = useMemo(() => new Color(), []);
  const shade = useMemo(() => new Color(), []);
  const rim = useMemo(() => new Color(), []);
  const dark = useMemo(() => new Color("#5d6673"), []);
  const darkShade = useMemo(() => new Color(), []);
  const lilac = useMemo(() => new Color("#b9a9c9"), []);
  const moonLit = useMemo(() => new Color("#1c2236"), []);
  const nightLit = useMemo(() => new Color(), []);
  const white = useMemo(() => new Color("#ffffff"), []);
  const moonRim = useMemo(() => new Color("#6c7fa8"), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const w = world.w;
    const t = world.elapsed;
    world.showers.length = 0;

    // the whole sky leans slowly into the wind; cursor gusts barely register up here
    if (world.windStrength > 0.05) {
      const k = 1 - Math.exp(-dt * 0.15);
      driftDir.x += (world.wind.x / world.windStrength - driftDir.x) * k;
      driftDir.y += (world.wind.y / world.windStrength - driftDir.y) * k;
      driftDir.normalize();
    }
    const drift = 0.22 + Math.min(world.windStrength, 2) * 0.45;

    // lit side: cream warmed by the sun; shaded side borrows the sky's colour
    lit.set("#fff8ef").lerp(atmo.sunColor, 0.3 * world.daylight);
    lit.multiplyScalar(0.3 + 0.62 * world.daylight);
    // at night: barely brighter than the sky, so they read as soft moonlit shapes
    nightLit.copy(atmo.zenith).lerp(atmo.horizon, 0.5).multiplyScalar(1.5).add(moonLit);
    lit.lerp(nightLit, world.night);
    shade.copy(atmo.zenith).lerp(atmo.horizon, 0.45).multiplyScalar(0.8 - world.night * 0.15).lerp(lilac, 0.25 * world.daylight);
    rim.copy(atmo.sunColor).lerp(white, 0.4).multiplyScalar(0.25 + 0.75 * world.daylight);
    rim.lerp(moonRim, world.night);

    for (const c of clouds) {
      // a raining cloud lingers so you can stand under it
      const pace = drift * c.speed * (c.rain > 0.02 ? 0.25 : 1);
      c.x += driftDir.x * pace * dt;
      c.z += driftDir.y * pace * dt;
      const along = c.x * driftDir.x + c.z * driftDir.y;
      if (c.x * c.x + c.z * c.z > SKY_R * SKY_R && along > 0) respawnUpwind(c);
      c.enter = Math.min(1, c.enter + dt / 8);

      const stormDrop = w.storm * 3.5 + w.rain * 1.2;
      const x = c.x;
      const z = c.z;
      const r = Math.hypot(x, z);
      const y = Math.max(4, cloudBase(r) + c.lift - stormDrop);
      c.pos.set(x, y, z);

      const edge = 1 - smoothstep(SKY_R * 0.8, SKY_R, r);
      const want = Math.max(smoothstep(c.threshold - 0.05, c.threshold + 0.15, w.cloud), c.rain > 0.01 ? 1 : 0) * edge * c.enter;
      c.vis = damp(c.vis, want, 0.6, dt);
      c.squish = Math.max(0, c.squish - dt * 2.2);
      c.rain = Math.max(0, c.rain - dt / 14);
      // thin out rather than swallow the camera when it flies close
      const near = smoothstep(5, 12, camera.position.distanceTo(c.pos) - 3 * c.scale);

      const g = c.mesh;
      if (g) {
        const wob = Math.sin(c.squish * 16) * c.squish * 0.18;
        const breathe = 1 + Math.sin(t * 0.3 + c.yaw * 5) * 0.03;
        const s = c.scale * (0.35 + 0.65 * c.vis) * (1 + w.storm * 0.4 + w.rain * 0.2);
        g.position.set(x, y, z);
        g.rotation.y = c.yaw;
        g.scale.set(s * (1 + wob) * breathe, s * (1 - wob) * breathe, s * (1 + wob * 0.5));
        g.visible = c.vis * near > 0.02;
        const m = g.children[0] as Mesh | undefined;
        if (m) m.raycast = c.vis > 0.3 && near > 0.5 ? Mesh.prototype.raycast : noRaycast;
      }

      // color: storms and personal grudges make clouds darker
      const gloom = clamp(w.storm * 0.75 + w.rain * 0.35 + c.rain * 0.55);
      const u = c.mat.uniforms;
      const dk = 0.35 + 0.55 * world.daylight;
      darkShade.copy(dark).multiplyScalar(dk * 0.6);
      u.uLit.value.copy(lit).lerp(dark, gloom * 0.85).multiplyScalar(1 - gloom * (1 - dk) * 0.5);
      u.uShade.value.copy(shade).lerp(darkShade, gloom);
      u.uRim.value.copy(rim).multiplyScalar(1 - gloom * 0.8);
      u.uLightDir.value.copy(atmo.lightDir);
      u.uFog.value.copy(atmo.fog);
      u.uFogDensity.value = atmo.fogDensity;
      u.uOpacity.value = clamp(c.vis * 1.4) * near;

      if (c.rain > 0.02) world.showers.push({ x, z, r: 2.4 * c.scale, i: c.rain });
    }
  });

  const poke = (c: CloudState) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    c.squish = 1;
    const now = world.elapsed;
    c.pokes = c.pokes.filter((p) => now - p < 2.5);
    c.pokes.push(now);
    const wasRaining = c.rain > 0.3;
    c.rain = Math.min(1, c.rain + 0.8);
    sfx("puff", c.pos, 0.6, 0.8 + Math.random() * 0.3);
    if (wasRaining && c.pokes.length >= 3) {
      c.pokes = [];
      const target = new Vector3(c.pos.x + (Math.random() - 0.5) * 3, 0, c.pos.z + (Math.random() - 0.5) * 3);
      emit("lightning", { pos: c.pos.clone().setY(c.pos.y - 1), target });
      discover("temper");
    }
  };

  return (
    <group>
      {clouds.map((c, i) => (
        <group
          key={i}
          ref={(g) => {
            c.mesh = g;
          }}
          onClick={poke(c)}
          onPointerOver={(e) => {
            e.stopPropagation();
            setCursor("pointer");
          }}
          onPointerOut={() => setCursor("default")}
        >
          <mesh geometry={c.geo} material={c.mat} />
        </group>
      ))}
    </group>
  );
}

/* =====================================================================
   Rain streaks under poked clouds (instanced, animated on the GPU).
   ===================================================================== */

const SHOWER_SLOTS = 3;
const RAIN_WHITE = new Color("#ffffff");
const SPLASH_COLOR = new Color("#dfe8f2");

const rainVert = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime; uniform vec3 uCenter; uniform float uRadius; uniform float uTop; uniform vec2 uWind; uniform float uIntensity;
varying float vA; varying float vT;
void main(){
  float a = aSeed.x * 6.28318;
  float r = sqrt(aSeed.y) * uRadius;
  float H = uTop;
  float fall = fract(aSeed.z + uTime * (11.0 / H) * (0.85 + aSeed.y * 0.3));
  float y = H * (1.0 - fall);
  vec3 base = vec3(uCenter.x + cos(a) * r, y, uCenter.z + sin(a) * r);
  base.xz += uWind * (H - y) * 0.12;
  vec3 toCamV = cameraPosition - base;
  float dist = length(toCamV);
  vec3 toCam = toCamV / dist;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  // keep streaks about a pixel wide however far away the shower is
  float wdt = max(0.016, dist * 0.0021);
  float len = 0.45 + dist * 0.008;
  vec3 p = base + right * position.x * wdt + vec3(uWind.x * 0.04, 1.0, uWind.y * 0.04) * position.y * len;
  float thin = clamp(0.016 / wdt * 2.5, 0.45, 1.0);
  vA = thin * uIntensity * step(aSeed.x, uIntensity * 1.2 + 0.05) * smoothstep(0.0, 0.08, fall) * (1.0 - smoothstep(0.92, 1.0, fall));
  vT = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const rainFrag = /* glsl */ `
uniform vec3 uColor; varying float vA; varying float vT;
void main(){
  float a = vA * vT * 0.55;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function streakGeometry(count: number, seed: number) {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  const rnd = mulberry32(seed);
  const s = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) s[i] = rnd();
  g.setAttribute("aSeed", new InstancedBufferAttribute(s, 3));
  g.instanceCount = count;
  return g;
}

export function makeRainMaterial() {
  return new ShaderMaterial({
    vertexShader: rainVert,
    fragmentShader: rainFrag,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uTime: U.uTime,
      uCenter: { value: new Vector3() },
      uRadius: { value: 2 },
      uTop: { value: 12 },
      uWind: U.uWind,
      uIntensity: { value: 0 },
      uColor: { value: new Color("#cfd8e6") },
    },
  });
}
export { streakGeometry };

function Showers() {
  const slots = useMemo(
    () =>
      Array.from({ length: SHOWER_SLOTS }, (_, i) => ({
        geo: streakGeometry(world.mobile ? 260 : 520, 50 + i),
        mat: makeRainMaterial(),
      })),
    [],
  );
  const splashT = useRef(0);
  const raining = useMemo<CloudState[]>(() => [], []);

  useFrame((_, dt) => {
    raining.length = 0;
    for (const c of cloudStates) if (c.rain > 0.02) raining.push(c);
    if (raining.length > 1) raining.sort((a, b) => b.rain - a.rain);
    slots.forEach((s, i) => {
      const c = raining[i];
      const u = s.mat.uniforms;
      if (!c) {
        u.uIntensity.value = damp(u.uIntensity.value, 0, 4, dt);
        return;
      }
      u.uCenter.value.copy(c.pos);
      u.uTop.value = Math.max(4, c.pos.y - 0.6);
      u.uRadius.value = 2.2 * c.scale;
      u.uIntensity.value = damp(u.uIntensity.value, clamp(c.rain * 1.3), 3, dt);
      u.uColor.value.copy(atmo.ambient).lerp(RAIN_WHITE, 0.5).multiplyScalar(0.6 + 0.4 * world.daylight);
    });

    // drops landing: ripples on water, little splashes on land
    splashT.current -= dt;
    if (splashT.current < 0 && raining.length) {
      splashT.current = 0.05;
      for (const c of raining.slice(0, SHOWER_SLOTS)) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 2.2 * c.scale;
        const x = c.pos.x + Math.cos(a) * r + world.wind.x * 1.2;
        const z = c.pos.z + Math.sin(a) * r + world.wind.y * 1.2;
        const wl = waterLevelAt(x, z);
        if (wl !== null) {
          if (Math.random() < 0.35 * c.rain) addRipple(x, z, 0.12);
        } else {
          pools.soft.spawn({
            x,
            y: height(x, z) + 0.02,
            z,
            vx: (Math.random() - 0.5) * 0.4,
            vy: 0.8,
            vz: (Math.random() - 0.5) * 0.4,
            color: SPLASH_COLOR,
            size: 0.035,
            life: 0.25,
            gravity: 8,
            drag: 1,
            alpha: 0.7 * c.rain,
          });
        }
      }
    }
  });

  return (
    <group>
      {slots.map((s, i) => (
        <mesh key={i} geometry={s.geo} material={s.mat} frustumCulled={false} raycast={() => null} renderOrder={4} />
      ))}
    </group>
  );
}

/* =====================================================================
   Lightning: a jagged bolt, a flash over the whole world, thunder.
   ===================================================================== */

function boltGeometry(from: Vector3, to: Vector3) {
  const path = new CurvePath<Vector3>();
  const segs = 14;
  let prev = from.clone();
  const len = from.distanceTo(to);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = from.clone().lerp(to, t);
    if (i < segs) {
      const j = (1 - t * 0.6) * len * 0.07;
      p.x += (Math.random() - 0.5) * j;
      p.z += (Math.random() - 0.5) * j;
    }
    path.add(new LineCurve3(prev, p));
    prev = p;
  }
  const main = new TubeGeometry(path, segs * 3, 0.07, 3, false);
  // one short fork
  const forkStart = path.getPoint(0.35);
  const forkEnd = forkStart.clone().add(new Vector3((Math.random() - 0.5) * 4, -len * 0.25, (Math.random() - 0.5) * 4));
  const fork = new TubeGeometry(new LineCurve3(forkStart, forkEnd), 4, 0.035, 3, false);
  const m = merge([main, fork].map((g) => {
    g.deleteAttribute("uv");
    return g.index ? g.toNonIndexed() : g;
  }));
  return m;
}

function Lightning() {
  const mesh = useRef<Mesh>(null);
  const mat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color("#eaf0ff"),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    [],
  );
  const st = useRef({ t: 10 });

  useEffect(
    () =>
      on("lightning", ({ pos, target, small }) => {
        const to = target ? target.clone() : new Vector3(pos.x + (Math.random() - 0.5) * 4, 0, pos.z + (Math.random() - 0.5) * 4);
        const wl = waterLevelAt(to.x, to.z);
        to.y = wl !== null ? wl : height(to.x, to.z);
        const m = mesh.current;
        if (m) {
          m.geometry.dispose();
          m.geometry = boltGeometry(pos, to);
        }
        st.current.t = 0;
        world.flash = small ? 0.3 : 1;
        emit("disturb", { pos: to, radius: small ? 3 : 8 });
        if (wl !== null) {
          addRipple(to.x, to.z, 1.6);
          spawnSplash(to.clone(), 1);
        } else {
          spawnDust(to.clone(), new Color("#d8d0c0"), 1);
          spawnSparkle(to.clone().setY(to.y + 0.2), 14, new Color("#fff3c4"), 0.4, 1.4);
        }
        sfx("zap", to, small ? 0.5 : 0.8, small ? 1.4 : 1);
        // thunder arrives a beat later the farther away it is
        const delay = small ? 120 : 250 + Math.min(2000, to.length() * 40);
        setTimeout(() => sfx("thunder", to, small ? 0.3 : 0.9), delay);
      }),
    [],
  );

  useFrame((_, dt) => {
    const s = st.current;
    s.t += dt;
    // a double flicker
    const f = s.t < 0.08 ? 1 : s.t < 0.14 ? 0.2 : s.t < 0.24 ? 0.9 : Math.max(0, 1 - (s.t - 0.24) * 5);
    mat.opacity = f;
    if (mesh.current) mesh.current.visible = f > 0.01;
    if (s.t > 0.12 && s.t < 0.16) world.flash = Math.max(world.flash, 0.7);
  });

  return <mesh ref={mesh} geometry={new BufferGeometry()} material={mat} raycast={() => null} visible={false} renderOrder={10} />;
}

/* ===================================================================== */

export function SkyToys() {
  return (
    <>
      <CelestialHandle body="sun" />
      <CelestialHandle body="moon" />
      <ShootingStars />
      <Clouds />
      <Showers />
      <Lightning />
    </>
  );
}
