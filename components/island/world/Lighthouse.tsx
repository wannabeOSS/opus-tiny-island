"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector3,
} from "three";
import { addCollider } from "../lib/colliders";
import { LIGHTHOUSE } from "../lib/layout";
import { damp, noise2 } from "../lib/math";
import { patchMaterial } from "../lib/patch";
import { height } from "../lib/terrain";
import { emit, markInput, sfx, world } from "../lib/world";
import { hoverable } from "./cursor";
import { spawnSparkle } from "./effects/Particles";

const TOWER_H = 3.4;
const LAMP_Y = TOWER_H + 0.42;

function towerGeo() {
  const g = new CylinderGeometry(0.4, 0.62, TOWER_H, 22, 24, false);
  g.translate(0, TOWER_H / 2, 0);
  const pos = g.attributes.position as BufferAttribute;
  const cream = new Color("#f2e8d5");
  const red = new Color("#c4493c");
  const c = new Color();
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const wob = 1 + noise2(Math.atan2(z, x) * 2, y * 1.3) * 0.025;
    pos.setXYZ(i, x * wob, y, z * wob);
    const t = y / TOWER_H;
    const band = Math.floor(t * 6 + 0.02) % 2 === 1;
    c.copy(band ? red : cream);
    c.offsetHSL(0, 0, noise2(x * 6, y * 4) * 0.025 - (t < 0.05 ? 0.08 : 0));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.computeVertexNormals();
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

const beamVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const beamFrag = /* glsl */ `
uniform float uBeam; uniform float uFog;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float along = vUv.y;
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
  float a = pow(along, 2.2) * edge * uBeam * (0.16 + uFog * 0.35);
  gl_FragColor = vec4(vec3(1.0, 0.9, 0.66) * a, a);
}`;

const glowFrag = /* glsl */ `
uniform float uBeam; varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.5) * uBeam;
  gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * a, a);
}`;

export function Lighthouse() {
  const y0 = useMemo(() => height(LIGHTHOUSE.x, LIGHTHOUSE.z) - 0.1, []);
  const beam = useRef<Group>(null);
  const glow = useRef<Group>(null);
  const spin = useRef({ boost: 0, flash: 0 });

  const mats = useMemo(
    () => ({
      tower: patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), { wet: true }),
      dark: new MeshStandardMaterial({ color: "#2f3238", roughness: 0.6, metalness: 0.3 }),
      red: patchMaterial(new MeshStandardMaterial({ color: "#b8443a", roughness: 0.6 }), { snow: 1, wet: true }),
      lamp: new MeshStandardMaterial({ color: "#fff6dd", emissive: "#ffd27a", emissiveIntensity: 0, roughness: 0.3 }),
      glass: new MeshStandardMaterial({ color: "#a9c4cc", roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35 }),
      door: new MeshStandardMaterial({ color: "#3e6c74", roughness: 0.8 }),
      beam: new ShaderMaterial({
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uBeam: { value: 0 }, uFog: { value: 0 } },
      }),
      glow: new ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: glowFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uBeam: { value: 0 } },
      }),
    }),
    [],
  );

  const geos = useMemo(() => {
    const cone = new ConeGeometry(2.4, 24, 24, 1, true);
    cone.translate(0, -12, 0);
    const a = cone.clone().rotateZ(Math.PI / 2);
    const b = cone.clone().rotateZ(-Math.PI / 2);
    cone.dispose();
    return { tower: towerGeo(), beamA: a, beamB: b };
  }, []);

  useEffect(() => {
    const off = addCollider({ id: "lighthouse", x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 0.66, bottom: y0, top: y0 + LAMP_Y + 0.6, surface: "rock" });
    const perch = { id: "lighthouse", pos: new Vector3(LIGHTHOUSE.x + 0.55, y0 + TOWER_H + 0.12, LIGHTHOUSE.z + 0.2), taken: false };
    world.perches.push(perch);
    return () => {
      off();
      world.perches = world.perches.filter((p) => p !== perch);
    };
  }, [y0]);

  useFrame((state, dt) => {
    const want = world.night > 0.45 || world.w.fog > 0.55 || world.w.storm > 0.5 ? 1 : 0;
    const sp = spin.current;
    sp.flash = Math.max(0, sp.flash - dt * 1.5);
    sp.boost = Math.max(0, sp.boost - dt * 0.6);
    world.lighthouseBeam = damp(world.lighthouseBeam, Math.max(want, sp.flash), 1.2, dt);
    const b = world.lighthouseBeam;
    world.beamAngle += dt * (0.55 + sp.boost * 3);
    if (beam.current) {
      beam.current.rotation.y = world.beamAngle;
      beam.current.visible = b > 0.01;
    }
    mats.beam.uniforms.uBeam.value = b;
    mats.beam.uniforms.uFog.value = Math.max(world.w.fog, world.w.rain * 0.5);
    mats.glow.uniforms.uBeam.value = b * 0.9;
    mats.lamp.emissiveIntensity = b * 3;
    if (glow.current) glow.current.quaternion.copy(state.camera.quaternion);
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    const sp = spin.current;
    sp.flash = 1;
    sp.boost = 1;
    sfx("horn", e.point, 0.7);
    const lamp = new Vector3(LIGHTHOUSE.x, y0 + LAMP_Y, LIGHTHOUSE.z);
    spawnSparkle(lamp, 8, new Color("#ffe1a0"), 0.4, 0.5);
    emit("disturb", { pos: lamp, radius: 3 });
    // three calls into the dark sea...
    if (world.night > 0.5) {
      const now = world.elapsed;
      world.lighthouseTaps = world.lighthouseTaps.filter((t) => now - t < 5);
      world.lighthouseTaps.push(now);
      if (world.lighthouseTaps.length >= 3) {
        world.lighthouseTaps = [];
        emit("whale", {});
      }
    }
  };

  return (
    <group position={[LIGHTHOUSE.x, y0, LIGHTHOUSE.z]}>
      <group onClick={onClick} {...hoverable("pointer")}>
        {/* base plinth */}
        <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.85, 0.95, 0.22, 16]} />
          <meshStandardMaterial color="#a39a8d" roughness={1} />
        </mesh>
        <mesh geometry={geos.tower} material={mats.tower} castShadow receiveShadow />
        {/* door + windows */}
        <mesh position={[0, 0.42, 0.6]} rotation-x={-0.06} material={mats.door}>
          <boxGeometry args={[0.28, 0.5, 0.06]} />
        </mesh>
        {[1.3, 2.3].map((y, i) => (
          <mesh key={i} position={[Math.sin(i * 2.5) * 0.52, y, Math.cos(i * 2.5) * 0.52]} rotation-y={i * 2.5}>
            <boxGeometry args={[0.13, 0.2, 0.04]} />
            <meshStandardMaterial color="#2c3a44" roughness={0.4} />
          </mesh>
        ))}
        {/* gallery */}
        <mesh position={[0, TOWER_H + 0.04, 0]} material={mats.dark} castShadow>
          <cylinderGeometry args={[0.66, 0.6, 0.09, 20]} />
        </mesh>
        <mesh position={[0, TOWER_H + 0.3, 0]} rotation-x={Math.PI / 2} material={mats.dark}>
          <torusGeometry args={[0.62, 0.012, 4, 28]} />
        </mesh>
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.62, TOWER_H + 0.17, Math.sin(a) * 0.62]} material={mats.dark}>
              <cylinderGeometry args={[0.01, 0.01, 0.26, 3]} />
            </mesh>
          );
        })}
        {/* lantern room */}
        <mesh position={[0, LAMP_Y, 0]} material={mats.lamp}>
          <sphereGeometry args={[0.16, 14, 10]} />
        </mesh>
        <mesh position={[0, LAMP_Y, 0]} material={mats.glass}>
          <cylinderGeometry args={[0.34, 0.34, 0.5, 12, 1, true]} />
        </mesh>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.34, LAMP_Y, Math.sin(a) * 0.34]} material={mats.dark}>
              <boxGeometry args={[0.03, 0.5, 0.03]} />
            </mesh>
          );
        })}
        <mesh position={[0, LAMP_Y + 0.42, 0]} material={mats.red} castShadow>
          <coneGeometry args={[0.44, 0.36, 14]} />
        </mesh>
        <mesh position={[0, LAMP_Y + 0.64, 0]} material={mats.dark}>
          <sphereGeometry args={[0.05, 8, 6]} />
        </mesh>
      </group>
      <group ref={beam} position={[0, LAMP_Y, 0]}>
        <mesh geometry={geos.beamA} material={mats.beam} raycast={() => null} renderOrder={8} />
        <mesh geometry={geos.beamB} material={mats.beam} raycast={() => null} renderOrder={8} />
      </group>
      <group ref={glow} position={[0, LAMP_Y, 0]}>
        <mesh material={mats.glow} raycast={() => null} renderOrder={9}>
          <planeGeometry args={[3.2, 3.2]} />
        </mesh>
      </group>
    </group>
  );
}
