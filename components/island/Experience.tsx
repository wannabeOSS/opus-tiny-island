"use client";

import { Bvh } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
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
import { Sound } from "./systems/Sound";

export default function Experience() {
  return (
    <Canvas
      shadows
      dpr={[1, world.mobile ? 1.5 : 1.75]}
      camera={{ fov: 40, near: 0.1, far: 1200, position: [34, 26, 46] }}
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      style={{ position: "fixed", inset: 0, touchAction: "none" }}
    >
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
      <Props />
      <SkyToys />
      <Weather />
      <MysteryTree />
      <Fish />
      <Birds />
      <Bugs />
      <Critters />
      <Whale />
      <Particles />
      <Tools />
      <Sound />
      <CameraRig />
    </Canvas>
  );
}
