"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Vector3 } from "three";
import { audio } from "../lib/audio";
import { clamp } from "../lib/math";
import { on, world } from "../lib/world";

const v = new Vector3();
const fwd = new Vector3();
const amb: Parameters<typeof audio.ambience>[0] = { ocean: 0, wind: 0, rain: 0, night: 0, storm: 0, dt: 0, birds: 0, fire: 0 };

/** Bridges world events to the synth and keeps the ambience in step with the weather. */
export function Sound() {
  const { camera } = useThree();

  useEffect(() => {
    const start = () => audio.start();
    // mobile browsers only unlock audio on touchend / pointerup / click, not on pointerdown
    const gestures = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    for (const g of gestures) window.addEventListener(g, start);
    audio.spatial = (p) => {
      const dist = camera.position.distanceTo(p);
      camera.getWorldDirection(fwd);
      const behind = fwd.dot(v.copy(p).sub(camera.position)) < 0 ? 0.5 : 1;
      // pan from camera space; projected x flips sign for sounds behind the camera
      v.copy(p).applyMatrix4(camera.matrixWorldInverse);
      const len = v.length();
      return { pan: clamp(len > 1e-4 ? (v.x / len) * 1.2 : 0, -1, 1), gain: clamp(22 / (dist + 8)) * behind };
    };
    const off = on("sfx", ({ name, pos, strength, pitch }) => audio.playAt(name, pos, strength, pitch));
    return () => {
      for (const g of gestures) window.removeEventListener(g, start);
      off();
    };
  }, [camera]);

  useFrame((_, dt) => {
    const w = world.w;
    const dist = camera.position.length();
    let shower = 0;
    for (const s of world.showers) shower = Math.max(shower, s.i);
    const a = amb;
    a.ocean = clamp(1.2 - dist / 90, 0.35, 1);
    a.wind = world.windStrength;
    a.rain = Math.max(w.rain, shower * 0.35);
    a.night = world.night;
    a.storm = w.storm;
    a.dt = Math.min(dt, 0.1);
    a.birds = world.daylight * (1 - w.storm) * (1 - w.snow * 0.7);
    a.fire = world.night * clamp(1 - camera.position.distanceTo(v.set(-0.5, 1, 0.7)) / 18);
    audio.ambience(a);
  });

  return null;
}
