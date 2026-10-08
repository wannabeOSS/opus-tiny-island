"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { BufferAttribute, Color, MeshStandardMaterial, PlaneGeometry, Vector3 } from "three";
import { fbm, smoothstep, clamp } from "../lib/math";
import { patchMaterial } from "../lib/patch";
import { distToPath, height, islandD, mesaMask, pondMask } from "../lib/terrain";
import { registerGround } from "../lib/tools";
import { emit, markInput, world } from "../lib/world";
import { setCursor } from "./cursor";

const C = {
  sand: new Color("#ecd8a4"),
  sandWet: new Color("#c7ab78"),
  sandDeep: new Color("#a99a72"),
  seabed: new Color("#5f8a80"),
  meadow: new Color("#9dbd5b"),
  moss: new Color("#5f8d3d"),
  dry: new Color("#bcc46a"),
  rock: new Color("#c39472"),
  rockDark: new Color("#9a6d55"),
  rockLight: new Color("#dcb48d"),
  path: new Color("#cdb183"),
  soil: new Color("#6e5a3e"),
};

export function useTerrainGeometry() {
  return useMemo(() => {
    const size = 56;
    const seg = world.mobile ? 150 : 220;
    const geo = new PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, height(x, z));
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    const t = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = nrm.getY(i);
      const n1 = fbm(x * 0.45, z * 0.45);
      const n2 = fbm(x * 1.7 + 4, z * 1.7 - 2, 2);

      // below water
      if (y < -0.02) {
        c.copy(C.sandWet).lerp(C.sandDeep, smoothstep(-0.05, -0.8, y)).lerp(C.seabed, smoothstep(-0.6, -3.2, y));
      } else {
        const d = islandD(x, z);
        // sand
        c.copy(C.sand).lerp(C.sandWet, smoothstep(0.16, 0.0, y));
        c.offsetHSL(0, 0, n2 * 0.025);
        // grass
        const grassAmt = smoothstep(0.42, 0.62, y + n1 * 0.08) * smoothstep(0.92, 0.8, d + n1 * 0.03);
        t.copy(C.meadow).lerp(C.moss, smoothstep(-0.25, 0.35, n1));
        t.lerp(C.dry, smoothstep(0.3, 0.6, n2) * 0.45);
        const mesaTop = mesaMask(x, z);
        if (mesaTop > 0.9) {
          t.lerp(C.moss, 0.25);
        }
        c.lerp(t, grassAmt);
        // path
        const pd = distToPath(x, z) + n2 * 0.12;
        const pathAmt = smoothstep(0.42, 0.18, pd) * grassAmt;
        c.lerp(C.path, pathAmt * 0.9);
        // pond rim
        const pm = pondMask(x, z);
        c.lerp(C.soil, smoothstep(0.0, 0.5, pm) * 0.85);
      }
      // cliffs by slope
      const rockAmt = smoothstep(0.82, 0.62, ny + n2 * 0.05);
      if (rockAmt > 0) {
        const band = Math.sin(y * 5.5 + n1 * 2.0) * 0.5 + 0.5;
        t.copy(C.rockDark).lerp(C.rock, smoothstep(0.1, 0.6, band)).lerp(C.rockLight, smoothstep(0.75, 1.0, band));
        if (y < 0.15) t.lerp(C.rockDark, 0.4);
        c.lerp(t, clamp(rockAmt * 1.2));
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3));
    return geo;
  }, []);
}

const tmpP = new Vector3();

export function Terrain() {
  const geo = useTerrainGeometry();
  const mat = useMemo(
    () =>
      patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), {
        terrain: true,
        snow: 1,
      }),
    [],
  );

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    world.pointer.copy(e.point);
    world.pointerOnLand = e.point.y > 0.05;
    world.pointerOverWorld = true;
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    tmpP.copy(e.point);
    if (tmpP.y < 0) return;
    emit("disturb", { pos: tmpP.clone(), radius: 1.6 });
    const n = e.face?.normal;
    const isGrass = tmpP.y > 0.5 && (!n || n.y > 0.8);
    emit("tapGround", { pos: tmpP.clone(), grass: isGrass });
  };

  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    emit("focus", { pos: e.point.clone() });
  };

  return (
    <mesh
      ref={(m) => registerGround(m, "land")}
      geometry={geo}
      material={mat}
      receiveShadow
      onPointerMove={onMove}
      onPointerOut={() => (world.pointerOverWorld = false)}
      onClick={onClick}
      onDoubleClick={onDouble}
      onPointerOver={() => setCursor("default")}
    />
  );
}
