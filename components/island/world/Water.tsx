"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { BufferAttribute, Color, DoubleSide, FogExp2, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { atmo } from "../lib/atmosphere";
import { LIGHTHOUSE } from "../lib/layout";
import { GLSL_NOISE } from "../lib/patch";
import { HEIGHT_TEX_SIZE, getHeightTexture } from "../lib/terrain";
import { RIPPLE_COUNT, U, addRipple, emit, markInput, ripples, sfx, waveState, world } from "../lib/world";
import { discover } from "../lib/secrets";
import { registerGround } from "../lib/tools";
import { setCursor } from "./cursor";
import { spawnSparkle, spawnSplash } from "./effects/Particles";

const BIO = new Color("#5ff2ff");

const common = /* glsl */ `
uniform float uTime; uniform float uWaveAmp; uniform sampler2D uHeight; uniform float uHSize;
uniform vec4 uRipples[${RIPPLE_COUNT}];
float terrainH(vec2 p){
  vec2 uv = p / uHSize + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -6.0;
  return texture2D(uHeight, uv).r;
}
float waves(vec2 p, float t){
  return sin(dot(p, vec2(0.8,0.6))*0.55 + t*1.1)*0.1
       + sin(dot(p, vec2(-0.4,0.92))*0.8 + t*1.5)*0.07
       + sin(dot(p, vec2(0.95,-0.3))*1.4 + t*2.1)*0.04;
}
vec2 ripple(vec2 p){
  float h = 0.0; float f = 0.0;
  for (int i = 0; i < ${RIPPLE_COUNT}; i++){
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 7.0 || r.w <= 0.0) continue;
    float d = length(p - r.xy);
    float rad = age * 1.7 + 0.1;
    float x = d - rad;
    if (abs(x) > 3.0) continue;
    float fade = exp(-age * 0.7) / (1.0 + d * 0.35);
    h += r.w * fade * sin(x * 7.0) * exp(-x * x * 2.2);
    f += r.w * exp(-age * 1.1) * exp(-x * x * 18.0) * smoothstep(0.0, 0.25, age);
  }
  return vec2(h, f);
}
`;

const vert = /* glsl */ `
${common}
varying vec3 vW; varying float vWave;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float depth = max(-terrainH(wp.xz), 0.0);
  float amp = uWaveAmp * (0.3 + 0.7 * clamp(depth / 2.0, 0.0, 1.0));
  float w = waves(wp.xz, uTime) * amp;
  float rp = 0.0;
  if (length(wp.xz) < 40.0) rp = ripple(wp.xz).x * 0.09;
  wp.y += w + rp;
  vW = wp.xyz; vWave = w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
${common}
${GLSL_NOISE}
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uZenith; uniform vec3 uHorizon;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunVis;
uniform vec3 uMoonDir; uniform float uMoonVis;
uniform vec3 uFogColor; uniform float uFogDensity;
uniform float uDaylight; uniform float uStorm; uniform float uRain; uniform float uBio; uniform float uFlash;
uniform vec2 uLH; uniform float uBeam; uniform float uBeamAngle; uniform float uCloud;
varying vec3 vW; varying float vWave;

float hsum(vec2 p, float amp, bool near){
  float h = waves(p, uTime) * amp;
  if (near) h += ripple(p).x * 0.09;
  return h;
}

void main(){
  vec2 p = vW.xz;
  float camDist = length(cameraPosition - vW);
  float depth = max(-terrainH(p), 0.0);
  float amp = uWaveAmp * (0.3 + 0.7 * clamp(depth / 2.0, 0.0, 1.0));
  bool near = length(p) < 40.0;

  // normal from wave gradient
  float e = 0.12;
  float h0 = hsum(p, amp, near);
  float hx = hsum(p + vec2(e, 0.0), amp, near);
  float hz = hsum(p + vec2(0.0, e), amp, near);
  vec3 N = normalize(vec3((h0 - hx) * 0.55, e, (h0 - hz) * 0.55));
  // fine detail: two drifting noise layers (breaks up the regular swell)
  float dt = uTime;
  vec2 q1 = p * 0.9 + vec2(dt * 0.11, dt * 0.07);
  vec2 q2 = p * 2.3 - vec2(dt * 0.16, -dt * 0.12);
  float ne = 0.15;
  float a0 = tiNoise(q1), ax = tiNoise(q1 + vec2(ne, 0.0)), az = tiNoise(q1 + vec2(0.0, ne));
  float b0 = tiNoise(q2), bx = tiNoise(q2 + vec2(ne, 0.0)), bz = tiNoise(q2 + vec2(0.0, ne));
  vec2 grad = vec2(a0 - ax, a0 - az) / ne * 0.6 + vec2(b0 - bx, b0 - bz) / ne * 0.4;
  float detail = (0.09 + uStorm * 0.1 + uRain * 0.04) * smoothstep(110.0, 8.0, camDist);
  N = normalize(N + vec3(grad.x, 0.0, grad.y) * detail);

  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(N, V), 0.0);
  float fres = mix(0.04, 1.0, pow(1.0 - ndv, 4.0));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.1, 1.0, R.y) * 0.5);

  float dShade = smoothstep(0.02, 3.4, depth);
  vec3 body = mix(uShallow * 1.08, uDeep, dShade);
  // subtle light through wave crests
  body += uShallow * max(vWave, 0.0) * 0.6 * uDaylight;

  vec3 col = mix(body, sky, fres * 0.48);

  // sun glints
  float sd = max(dot(R, uSunDir), 0.0);
  float sparkle = 0.6 + 0.8 * tiNoise(p * 6.0 + uTime * 1.5);
  col += uSunColor * (pow(sd, 260.0) * 4.0 * sparkle + pow(sd, 28.0) * 0.14) * uSunVis;
  // moon path
  float md = max(dot(R, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (pow(md, 140.0) * 2.0 * sparkle + pow(md, 14.0) * 0.06) * uMoonVis;

  // caustic shimmer in shallows
  float c1 = tiNoise(p * 1.4 + vec2(uTime * 0.3, uTime * 0.2));
  float c2 = tiNoise(p * 1.8 - vec2(uTime * 0.25, -uTime * 0.33));
  float caustic = pow(1.0 - abs(c1 - c2), 9.0);
  col += uSunColor * caustic * smoothstep(1.2, 0.2, depth) * 0.03 * uDaylight * (1.0 - uCloud * 0.5);

  // foam: shoreline + receding bands + ripples + storm crests
  float n = tiNoise(p * 2.2 + uTime * 0.25);
  float n2 = tiNoise(p * 5.0 - uTime * 0.4);
  float shore = smoothstep(0.22, 0.02, depth + (n - 0.5) * 0.14);
  float bands = smoothstep(0.55, 0.95, sin(depth * 20.0 - uTime * 1.6 + n * 5.0)) * smoothstep(0.75, 0.08, depth) * (0.55 + n2 * 0.6);
  vec2 rp = near ? ripple(p) : vec2(0.0);
  float rfoam = clamp(rp.y, 0.0, 1.0) * (0.55 + 0.45 * n2);
  float crest = smoothstep(0.1, 0.22, vWave) * uStorm * smoothstep(0.35, 0.75, n2);
  // rain rings
  float rainRing = 0.0;
  if (uRain > 0.02 && camDist < 45.0) {
    vec2 rc = p * 2.2;
    vec2 cell = floor(rc);
    float rh = tiHash(cell);
    float rt = fract(uTime * 0.9 + rh * 7.0);
    float rd = length(fract(rc) - 0.5 - (vec2(tiHash(cell + 3.1), tiHash(cell + 7.7)) - 0.5) * 0.4);
    rainRing = smoothstep(0.05, 0.0, abs(rd - rt * 0.45)) * (1.0 - rt) * step(0.45, rh) * uRain;
  }
  float foam = clamp(max(max(shore, bands * 0.7), max(rfoam, crest)) + rainRing * 0.5, 0.0, 1.0);

  vec3 foamCol = vec3(0.96, 0.97, 1.0) * (0.35 + 0.65 * uDaylight) + uSunColor * 0.08;
  vec3 bioCol = vec3(0.25, 0.95, 1.0) * 1.8;
  foamCol = mix(foamCol, bioCol, uBio * smoothstep(0.0, 0.3, max(rfoam, shore)));
  col = mix(col, foamCol, foam * 0.9);
  col += bioCol * uBio * (rfoam * 0.8 + bands * 0.15);

  // lighthouse sweep
  if (uBeam > 0.01) {
    vec2 lp = p - uLH;
    float ang = atan(lp.y, lp.x);
    float da = abs(mod(ang - uBeamAngle + 3.14159, 6.28318) - 3.14159);
    float db = abs(mod(ang - uBeamAngle, 6.28318) - 3.14159);
    float beam = (smoothstep(0.16, 0.0, da) + smoothstep(0.16, 0.0, db)) * exp(-length(lp) * 0.035) * smoothstep(2.0, 5.0, length(lp));
    col += vec3(1.0, 0.88, 0.62) * beam * uBeam * (0.25 + fres * 0.6);
  }

  col += uFlash * vec3(0.35, 0.38, 0.5) * fres;

  float alpha = mix(0.28, 1.0, smoothstep(0.0, 2.8, depth));
  alpha = max(alpha, foam);
  alpha = mix(alpha, 1.0, fres * 0.5);

  float ff = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
  col = mix(col, uFogColor, ff);
  alpha = mix(alpha, 1.0, ff);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function makeWaterGeometry(segments: number) {
  const geo = new PlaneGeometry(2, 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as BufferAttribute;
  const remap = (u: number) => 28 * u + Math.sign(u) * 322 * Math.pow(Math.abs(u), 5);
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, remap(pos.getX(i)));
    pos.setZ(i, remap(pos.getZ(i)));
  }
  geo.computeBoundingSphere();
  return geo;
}

let lastHoverRipple = 0;
const tmp = new Vector3();

export function Water() {
  const { scene } = useThree();
  const geo = useMemo(() => makeWaterGeometry(world.mobile ? 200 : 300), []);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        side: DoubleSide,
        uniforms: {
          uTime: U.uTime,
          uWaveAmp: { value: 1 },
          uHeight: { value: getHeightTexture() },
          uHSize: { value: HEIGHT_TEX_SIZE },
          uRipples: { value: ripples },
          uDeep: { value: new Color() },
          uShallow: { value: new Color() },
          uZenith: { value: new Color() },
          uHorizon: { value: new Color() },
          uSunDir: { value: world.sunDir },
          uSunColor: { value: new Color() },
          uSunVis: { value: 1 },
          uMoonDir: { value: world.moonDir },
          uMoonVis: { value: 0 },
          uFogColor: { value: new Color() },
          uFogDensity: { value: 0.008 },
          uDaylight: { value: 1 },
          uStorm: { value: 0 },
          uRain: { value: 0 },
          uBio: { value: 0 },
          uFlash: { value: 0 },
          uLH: { value: { x: LIGHTHOUSE.x, y: LIGHTHOUSE.z } },
          uBeam: { value: 0 },
          uBeamAngle: { value: 0 },
          uCloud: { value: 0 },
        },
      }),
    [],
  );

  useFrame(() => {
    const u = mat.uniforms;
    u.uWaveAmp.value = waveState.amp;
    u.uDeep.value.copy(atmo.waterDeep);
    u.uShallow.value.copy(atmo.waterShallow);
    u.uZenith.value.copy(atmo.zenith);
    u.uHorizon.value.copy(atmo.horizon);
    u.uSunColor.value.copy(atmo.sunColor);
    u.uSunVis.value = atmo.sunVis;
    u.uMoonVis.value = atmo.moonVis;
    const fog = scene.fog as FogExp2 | null;
    if (fog) {
      u.uFogColor.value.copy(fog.color);
      u.uFogDensity.value = fog.density;
    }
    u.uDaylight.value = world.daylight;
    u.uStorm.value = world.w.storm;
    u.uRain.value = world.w.rain;
    u.uBio.value = world.midnight * world.night * 0.9;
    u.uFlash.value = world.flash;
    u.uBeam.value = world.lighthouseBeam;
    u.uBeamAngle.value = -world.beamAngle;
    u.uCloud.value = world.w.cloud;
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    world.pointer.copy(e.point);
    world.pointerOnLand = false;
    world.pointerOverWorld = true;
    if (world.holding) return;
    if (world.pointerSpeed > 500 && world.elapsed - lastHoverRipple > 0.12) {
      lastHoverRipple = world.elapsed;
      addRipple(e.point.x, e.point.z, Math.min(0.35, world.pointerSpeed / 5000));
    }
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    markInput();
    tmp.copy(e.point);
    tmp.y = 0;
    addRipple(tmp.x, tmp.z, 1);
    spawnSplash(tmp, 0.5);
    sfx("drip", tmp, 0.7);
    if (world.midnight * world.night > 0.5) {
      spawnSparkle(tmp, 14, BIO, 0.5, 0.4);
      sfx("sparkle", tmp, 0.4, 0.8);
      discover("midnightTide");
    }
    emit("disturb", { pos: tmp.clone(), radius: 3 });
    emit("splash", { pos: tmp.clone(), strength: 0.4, kind: "touch" });
  };

  return (
    <group>
      <mesh geometry={geo} material={mat} renderOrder={2} frustumCulled={false} raycast={() => null} />
      {/* cheap flat proxy for pointer events */}
      <mesh
        ref={(m) => registerGround(m, "sea")}
        rotation-x={-Math.PI / 2}
        position-y={0.02}
        onPointerMove={onMove}
        onPointerOver={() => setCursor("default")}
        onPointerOut={() => (world.pointerOverWorld = false)}
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          emit("focus", { pos: e.point.clone() });
        }}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
