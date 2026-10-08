"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { CircleGeometry, Color, MeshStandardMaterial, ShaderMaterial, Vector3 } from "three";
import { atmo } from "../lib/atmosphere";
import { POND } from "../lib/layout";
import { mulberry32 } from "../lib/math";
import { patchMaterial } from "../lib/patch";
import { POND_LEVEL, height } from "../lib/terrain";
import { POND_RIPPLE_COUNT, U, addPondRipple, emit, markInput, pondRipples, sfx, world } from "../lib/world";
import { registerGround } from "../lib/tools";
import { setCursor } from "./cursor";
import { spawnSplash } from "./effects/Particles";

const frag = /* glsl */ `
uniform float uTime; uniform vec4 uRipples[${POND_RIPPLE_COUNT}];
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uDeep; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunVis; uniform float uRain; uniform float uNight;
varying vec3 vW; varying vec2 vUv;
float rip(vec2 p){
  float h = 0.0;
  for (int i = 0; i < ${POND_RIPPLE_COUNT}; i++){
    vec4 r = uRipples[i]; float age = uTime - r.z;
    if (age < 0.0 || age > 4.0) continue;
    float d = length(p - r.xy); float x = d - age * 0.9;
    h += r.w * exp(-age * 1.2) * sin(x * 22.0) * exp(-x * x * 30.0);
  }
  return h;
}
void main(){
  vec2 p = vW.xz;
  float e = 0.02;
  float h0 = rip(p), hx = rip(p + vec2(e, 0.0)), hz = rip(p + vec2(0.0, e));
  float rain = uRain * sin(fract(sin(dot(floor(p * 9.0), vec2(12.9898, 78.233))) * 43758.5) * 40.0 + uTime * 8.0) * 0.4;
  vec3 N = normalize(vec3((h0 - hx) * 0.5 + rain * 0.02, e, (h0 - hz) * 0.5));
  vec3 V = normalize(cameraPosition - vW);
  float fres = mix(0.1, 1.0, pow(1.0 - max(dot(N, V), 0.0), 3.0));
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, R.y));
  float r = length(vUv - 0.5) * 2.0;
  vec3 body = mix(uDeep * 0.9 + vec3(0.02, 0.06, 0.02), vec3(0.28, 0.36, 0.22), smoothstep(0.55, 1.0, r));
  vec3 col = mix(body, sky, fres * 0.75);
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 200.0) * 3.0 * uSunVis;
  float edge = smoothstep(0.88, 1.0, r);
  col = mix(col, vec3(0.85, 0.9, 0.86) * (0.4 + 0.6 * (1.0 - uNight)), edge * 0.35);
  gl_FragColor = vec4(col, mix(0.85, 0.3, edge));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const LILY_PADS = [
  { x: POND.x + 0.45, z: POND.z - 0.3, r: 0.2, flower: true },
  { x: POND.x - 0.5, z: POND.z + 0.35, r: 0.17, flower: false },
  { x: POND.x + 0.1, z: POND.z + 0.6, r: 0.14, flower: false },
  { x: POND.x - 0.2, z: POND.z - 0.65, r: 0.15, flower: true },
];

export function Pond() {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: frag,
        transparent: true,
        uniforms: {
          uTime: U.uTime,
          uRipples: { value: pondRipples },
          uZenith: { value: new Color() },
          uHorizon: { value: new Color() },
          uDeep: { value: new Color() },
          uSunDir: { value: world.sunDir },
          uSunColor: { value: new Color() },
          uSunVis: { value: 1 },
          uRain: { value: 0 },
          uNight: { value: 0 },
        },
      }),
    [],
  );
  const padGeo = useMemo(() => new CircleGeometry(1, 16, 0.35, Math.PI * 2 - 0.5), []);
  const padMat = useMemo(() => patchMaterial(new MeshStandardMaterial({ color: "#5f9a48", roughness: 0.55 }), { wet: true }), []);
  const reeds = useMemo(() => {
    const rnd = mulberry32(5);
    return Array.from({ length: 18 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = POND.r + 0.05 + rnd() * 0.25;
      const x = POND.x + Math.cos(a) * r;
      const z = POND.z + Math.sin(a) * r;
      return { x, z, y: height(x, z), h: 0.35 + rnd() * 0.35, tilt: (rnd() - 0.5) * 0.3, cat: rnd() < 0.35 };
    }).filter((r) => r.x > POND.x - 0.2 || r.z < POND.z);
  }, []);
  const reedMat = useMemo(() => patchMaterial(new MeshStandardMaterial({ color: "#6f8f3e", roughness: 0.9 }), { sway: { scale: 2, stiff: 1.5, push: 0.4 } }), []);

  useFrame(() => {
    const u = mat.uniforms;
    u.uZenith.value.copy(atmo.zenith);
    u.uHorizon.value.copy(atmo.horizon);
    u.uDeep.value.copy(atmo.waterDeep);
    u.uSunColor.value.copy(atmo.sunColor);
    u.uSunVis.value = atmo.sunVis;
    u.uRain.value = world.w.rain;
    u.uNight.value = world.night;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    addPondRipple(e.point.x, e.point.z, 1);
    spawnSplash(new Vector3(e.point.x, POND_LEVEL, e.point.z), 0.25);
    sfx("drip", e.point, 0.6, 1.3);
    emit("disturb", { pos: e.point.clone(), radius: 1.5 });
    emit("splash", { pos: e.point.clone(), strength: 0.3, kind: "touch", pond: true });
  };

  return (
    <group>
      <mesh
        ref={(m) => registerGround(m, "pond")}
        position={[POND.x, POND_LEVEL, POND.z]}
        rotation-x={-Math.PI / 2}
        material={mat}
        renderOrder={1}
        onClick={onClick}
        onPointerOver={() => setCursor("pointer")}
        onPointerOut={() => setCursor("default")}
        onPointerMove={(e) => {
          if (world.pointerSpeed > 600 && Math.random() < 0.2) addPondRipple(e.point.x, e.point.z, 0.3);
        }}
      >
        <circleGeometry args={[POND.r + 0.25, 40]} />
      </mesh>
      {LILY_PADS.map((p, i) => (
        <group key={i} position={[p.x, POND_LEVEL + 0.01, p.z]} rotation-y={i * 1.7}>
          <mesh geometry={padGeo} material={padMat} rotation-x={-Math.PI / 2} scale={p.r} receiveShadow />
          {p.flower && (
            <group position={[0.02, 0.03, 0.02]}>
              {Array.from({ length: 7 }, (_, k) => (
                <mesh key={k} rotation={[0.6, (k / 7) * Math.PI * 2, 0]} position={[0, 0.02, 0]}>
                  <sphereGeometry args={[0.035, 6, 4]} />
                  <meshStandardMaterial color="#f7d6e3" roughness={0.6} />
                </mesh>
              ))}
              <mesh position={[0, 0.035, 0]}>
                <sphereGeometry args={[0.02, 6, 4]} />
                <meshStandardMaterial color="#f2c14e" />
              </mesh>
            </group>
          )}
        </group>
      ))}
      {reeds.map((r, i) => (
        <group key={i} position={[r.x, r.y - 0.02, r.z]} rotation={[r.tilt, i, r.tilt * 0.6]}>
          <mesh material={reedMat} position={[0, r.h / 2, 0]}>
            <cylinderGeometry args={[0.006, 0.012, r.h, 4]} />
          </mesh>
          {r.cat && (
            <mesh position={[0, r.h - 0.04, 0]}>
              <capsuleGeometry args={[0.018, 0.07, 2, 5]} />
              <meshStandardMaterial color="#6b4630" roughness={1} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
