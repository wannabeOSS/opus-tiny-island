"use client";

import { Bvh, PerformanceMonitor } from "@react-three/drei";
import { Canvas, type RootState } from "@react-three/fiber";
import { Suspense, useCallback, useState } from "react";
import { IslandFallback } from "./ui/Fallback";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { world } from "./lib/world";
import { CameraRig } from "./systems/CameraRig";
import { Director } from "./systems/Director";
import { Atmosphere } from "./world/Atmosphere";
import { Particles } from "./world/effects/Particles";
import { Terrain } from "./world/Terrain";
import { Water } from "./world/Water";
import { Grass } from "./world/Grass";
import { Trees } from "./world/Trees";
import { Flowers, Mushrooms, Rocks } from "./world/Flora";
import { Cabin } from "./world/Cabin";
import { Lighthouse } from "./world/Lighthouse";
import { Boat, Buoy, Dock, Laundry } from "./world/Shore";
import { Props } from "./world/Props";
import { PhysicsWorld } from "./world/PhysicsWorld";
import { Pond } from "./world/Pond";
import { SkyToys } from "./world/SkyToys";
import { Weather } from "./world/Weather";
import { MysteryTree } from "./world/MysteryTree";
import { Fish } from "./world/creatures/Fish";
import { Birds } from "./world/creatures/Birds";
import { Bugs } from "./world/creatures/Bugs";
import { Critters } from "./world/creatures/Critters";
import { Whale } from "./world/creatures/Whale";
import { Tools } from "./systems/Tools";
import { Bubbles } from "./world/Bubbles";
import { Sound } from "./systems/Sound";

const MAX_DPR = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, world.mobile ? 1.5 : 1.75);
const MIN_DPR = Math.min(MAX_DPR, world.mobile ? 0.8 : 1);
const dprFor = (factor: number) => Math.round((MIN_DPR + (MAX_DPR - MIN_DPR) * factor) * 8) / 8;

export default function Experience() {
  const [dpr, setDpr] = useState(MAX_DPR);
  const [lost, setLost] = useState(false);

  const onCreated = useCallback(({ gl }: RootState) => {
    const el = gl.domElement;
    el.addEventListener("webglcontextlost", (e) => {
      // lets the browser hand the context back instead of killing it
      e.preventDefault();
      setLost(true);
    });
    el.addEventListener("webglcontextrestored", () => setLost(false));
  }, []);

  return (
    <>
      <Canvas
        shadows
        dpr={dpr}
        camera={{ fov: 40, near: 0.1, far: 1200, position: [34, 26, 46] }}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
        style={{ position: "fixed", inset: 0, touchAction: "none" }}
        onCreated={onCreated}
      >
        <PerformanceMonitor
          factor={1}
          step={0.2}
          flipflops={4}
          onChange={({ factor }) => setDpr(dprFor(factor))}
          onFallback={() => setDpr(MIN_DPR)}
        />
        <Scene />
      </Canvas>
      {lost && <IslandFallback reason="lost" />}
    </>
  );
}

function Scene() {
  return (
    <>
      <Director />
      <Atmosphere />
      <Bvh firstHitOnly>
        <Terrain />
        <Water />
        <Pond />
        <Trees />
        <Rocks />
        <Cabin />
        <Lighthouse />
        <Dock />
      </Bvh>
      <Grass />
      <Flowers />
      <Mushrooms />
      <Laundry />
      <Boat />
      <Buoy />
      <Suspense fallback={null}>
        <PhysicsWorld>
          <Props />
        </PhysicsWorld>
      </Suspense>
      <SkyToys />
      <Weather />
      <MysteryTree />
      <Fish />
      <Birds />
      <Bugs />
      <Critters />
      <Whale />
      <Bubbles />
      <Particles />
      <Tools />
      <Sound />
      <CameraRig />
    </>
  );
}
