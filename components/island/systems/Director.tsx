"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector2, Vector3 } from "three";
import { clamp, damp } from "../lib/math";
import { updateWet } from "../lib/wetmap";
import { U, WEATHER_TARGETS, emit, markInput, on, sfx, waveState, world, type WeatherKind } from "../lib/world";

const camRight = new Vector3();
const camFwd = new Vector3();
const gust = new Vector2();
const base = new Vector2();

/** Drives time, weather blending, wind and shared uniforms. Renders nothing. */
export function Director() {
  const { camera, gl, scene } = useThree();
  const ptr = useRef({ x: 0, y: 0, vx: 0, vy: 0, t: 0, has: false });

  useEffect(() => {
    const dbg = (window as unknown as { __island?: Record<string, unknown> }).__island;
    if (dbg) {
      dbg.camera = camera;
      dbg.scene = scene;
      dbg.gl = gl;
    }
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      // during a pinch the two fingers alternate, which reads as huge jumps
      if (!e.isPrimary) return;
      const p = ptr.current;
      const now = performance.now() / 1000;
      if (p.has) {
        const dt = Math.max(now - p.t, 1 / 240);
        const vx = (e.clientX - p.x) / dt;
        const vy = (e.clientY - p.y) / dt;
        p.vx = p.vx * 0.6 + vx * 0.4;
        p.vy = p.vy * 0.6 + vy * 0.4;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      p.t = now;
      p.has = true;
      markInput();
    };
    const down = (e: PointerEvent) => {
      markInput();
      // a fresh touch elsewhere is a jump, not a fling
      if (e.pointerType !== "mouse") ptr.current.has = false;
    };
    const wheel = () => markInput();
    const lift = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") ptr.current.has = false;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", lift);
    const leave = () => (ptr.current.has = false);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("wheel", wheel, { passive: true });
    const offW = on("weather", ({ kind }) => setWeather(kind));
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", lift);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
      offW();
    };
  }, [gl, camera, scene]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    world.dt = dt;
    world.elapsed += dt;
    U.uTime.value = world.elapsed;

    // time of day: ~14 min per day; golden hour lingers, nights pass a little faster
    if (!world.draggingTime) {
      const h = world.time;
      const golden = h > 16.8 && h < 19.6 ? 0.6 : 1;
      const rate = (24 / 840) * (world.night > 0.5 ? 1.6 : golden) * world.settings.timeFlow;
      world.time = (world.time + dt * rate) % 24;
    }

    // weather blend
    const target = WEATHER_TARGETS[world.weather];
    const w = world.w;
    w.cloud = damp(w.cloud, target.cloud, 0.35, dt);
    w.rain = damp(w.rain, target.rain, w.rain < target.rain ? 0.25 : 0.4, dt);
    w.storm = damp(w.storm, target.storm, 0.3, dt);
    w.fog = damp(w.fog, target.fog, 0.3, dt);
    w.snow = damp(w.snow, target.snow, 0.3, dt);

    world.wet = clamp(world.wet + (w.rain > 0.3 ? dt * 0.12 : -dt * 0.025));
    world.snowCover = clamp(world.snowCover + (w.snow > 0.5 ? dt * 0.05 : -dt * 0.03));
    U.uWet.value = world.wet;
    updateWet(dt, w.rain);
    U.uSnow.value = world.snowCover;
    waveState.amp = (1 + w.storm * 1.5 + w.rain * 0.25 + world.windStrength * 0.25) * world.settings.waves;

    // wind = weather base + cursor gusts
    const p = ptr.current;
    const speed = Math.hypot(p.vx, p.vy);
    world.pointerSpeed = speed;
    p.vx *= Math.exp(-dt * 6);
    p.vy *= Math.exp(-dt * 6);
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    camFwd.normalize();
    camRight.set(-camFwd.z, 0, camFwd.x);
    const s = world.settings.windSense / 900;
    gust.set(camRight.x * p.vx * s - camFwd.x * p.vy * s, camRight.z * p.vx * s - camFwd.z * p.vy * s);
    if (world.holding || world.draggingTime) gust.multiplyScalar(0.3);
    const gl2 = gust.length();
    if (gl2 > 1.6) gust.multiplyScalar(1.6 / gl2);
    gust.add(world.breeze);
    world.breeze.multiplyScalar(Math.exp(-dt * 1.4));

    const t = world.elapsed;
    const baseStrength = 0.22 + w.rain * 0.35 + w.storm * 1.1 + w.snow * 0.15;
    base.set(Math.cos(t * 0.05 + 1) * 0.8 + 0.4, Math.sin(t * 0.04) * 0.6 + 0.3).normalize();
    base.multiplyScalar(baseStrength * (0.75 + 0.25 * Math.sin(t * 0.7) * Math.sin(t * 0.31)));
    if (w.storm > 0.2) base.multiplyScalar(1 + Math.max(0, Math.sin(t * 1.3) * Math.sin(t * 0.47)) * w.storm);

    const tx = base.x + gust.x;
    const tz = base.y + gust.y;
    world.wind.x = damp(world.wind.x, tx, 3, dt);
    world.wind.y = damp(world.wind.y, tz, 3, dt);
    world.windStrength = world.wind.length();
    world.gust = gl2;
    U.uWind.value.copy(world.wind);
    U.uWindStrength.value = world.windStrength;

    // cursor presence for grass/flower brushing
    const present = world.pointerOverWorld && world.pointerOnLand ? 1 : 0;
    U.uPointer.value.lerp(world.pointer, 1 - Math.exp(-dt * 18));
    U.uPointerStrength.value = damp(
      U.uPointerStrength.value,
      present * (0.35 + Math.min(1, speed / 1200) * 0.65),
      present ? 8 : 3,
      dt,
    );

    world.flash = Math.max(0, world.flash - dt * 4);
  });

  return null;
}

export function setWeather(kind: WeatherKind) {
  world.weather = kind;
  if (kind === "storm") sfx("thunder", undefined, 0.5);
}

export function cycleWeather(order: WeatherKind[]) {
  const i = order.indexOf(world.weather);
  const next = order[(i + 1) % order.length];
  emit("weather", { kind: next });
  return next;
}
