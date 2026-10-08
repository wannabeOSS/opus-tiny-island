"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Vector3 } from "three";
import { audio } from "../lib/audio";
import { clamp } from "../lib/math";
import { on, world } from "../lib/world";

const v = new Vector3();
const fwd = new Vector3();

/** Bridges world events to the synth and keeps the ambience in step with the weather. */
export function Sound() {
  const { camera } = useThree();

  useEffect(() => {
    const start = () => audio.start();
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    audio.spatial = (p) => {
      v.copy(p).project(camera);
      const dist = camera.position.distanceTo(p);
      camera.getWorldDirection(fwd);
      const behind = fwd.dot(v.copy(p).sub(camera.position)) < 0 ? 0.5 : 1;
      v.copy(p).project(camera);
      return { pan: clamp(v.x * 0.8, -1, 1), gain: clamp(22 / (dist + 8)) * behind };
    };
    const off = on("sfx", ({ name, pos, strength, pitch }) => audio.playAt(name, pos, strength, pitch));
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      off();
    };
  }, [camera]);

  useFrame((_, dt) => {
    const w = world.w;
    const dist = camera.position.length();
    const shower = world.showers.reduce((a, s) => Math.max(a, s.i), 0);
    audio.ambience({
      ocean: clamp(1.2 - dist / 90, 0.35, 1),
      wind: world.windStrength,
      rain: Math.max(w.rain, shower * 0.35),
      night: world.night,
      storm: w.storm,
      dt: Math.min(dt, 0.1),
      birds: world.daylight * (1 - w.storm) * (1 - w.snow * 0.7),
      fire: world.night * clamp(1 - camera.position.distanceTo(v.set(-0.5, 1, 0.7)) / 18),
    });
  });

  return null;
}
