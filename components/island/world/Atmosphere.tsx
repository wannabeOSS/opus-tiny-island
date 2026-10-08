"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import { atmo, computeAtmosphere } from "../lib/atmosphere";
import { U, world } from "../lib/world";

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform vec3 uMoonDir; uniform float uSunVis; uniform float uMoonVis; uniform float uStars; uniform float uTime;
uniform float uOvercast;
varying vec3 vDir;
float h31(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.5);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uHorizon * 0.96, smoothstep(0.0, -0.08, y));

  float sd = max(dot(d, uSunDir), 0.0);
  float clear = 1.0 - uOvercast * 0.75;
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.5) * uSunVis * clear;
  col += uSunColor * 0.22 * pow(1.0 - abs(y), 8.0) * pow(sd, 1.5) * uSunVis;
  float disc = smoothstep(0.99935, 0.9997, sd);
  col = mix(col, uSunColor * 1.35 + vec3(0.35, 0.3, 0.2), disc * uSunVis * clear);

  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.55, 0.62, 0.9) * pow(md, 40.0) * 0.18 * uMoonVis;

  if (uStars > 0.001) {
    vec3 sp = d * 160.0;
    vec3 cell = floor(sp);
    vec3 f = fract(sp) - 0.5;
    float h = h31(cell);
    vec3 jitter = vec3(h31(cell + 1.7), h31(cell + 3.1), h31(cell + 5.3)) - 0.5;
    float s = step(0.965, h) * smoothstep(0.22, 0.0, length(f - jitter * 0.5));
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 80.0);
    float big = step(0.997, h);
    col += vec3(0.9, 0.92, 1.0) * s * tw * uStars * (0.6 + big) * smoothstep(0.02, 0.3, y);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const moonFrag = /* glsl */ `
uniform vec3 uSunDir; uniform float uVis;
varying vec3 vN;
void main(){
  vec3 n = normalize(vN);
  float l = 0.62 + 0.38 * n.z;
  vec3 base = vec3(0.98, 0.95, 0.86);
  float crater = 0.0;
  crater += smoothstep(0.25, 0.15, length(n.xy - vec2(0.25, 0.3))) * 0.12;
  crater += smoothstep(0.2, 0.1, length(n.xy - vec2(-0.3, -0.1))) * 0.1;
  crater += smoothstep(0.15, 0.06, length(n.xy - vec2(0.05, -0.4))) * 0.1;
  gl_FragColor = vec4(base * l * (1.0 - crater) * 1.25, uVis);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function Atmosphere() {
  const { scene, gl, camera } = useThree();
  const sunRef = useRef<DirectionalLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const skyRef = useRef<Mesh>(null);
  const moonRef = useRef<Mesh>(null);
  const target = useMemo(() => new Object3D(), []);

  const skyMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new Color() },
          uHorizon: { value: new Color() },
          uSunDir: { value: world.sunDir },
          uSunColor: { value: new Color() },
          uMoonDir: { value: world.moonDir },
          uSunVis: { value: 1 },
          uMoonVis: { value: 0 },
          uStars: { value: 0 },
          uTime: U.uTime,
          uOvercast: { value: 0 },
        },
      }),
    [],
  );

  const moonMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: /* glsl */ `varying vec3 vN; void main(){ vN = normal; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: moonFrag,
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uSunDir: { value: world.sunDir }, uVis: { value: 0 } },
      }),
    [],
  );

  const skyGeo = useMemo(() => new SphereGeometry(500, 48, 24), []);

  useEffect(() => {
    scene.fog = new FogExp2(new Color("#f2dcc2"), 0.008);
    scene.add(target);
    return () => {
      scene.fog = null;
      scene.remove(target);
    };
  }, [scene, target]);

  useFrame(() => {
    computeAtmosphere();
    const fog = scene.fog as FogExp2;
    fog.color.copy(atmo.fog);
    fog.density = atmo.fogDensity;

    const su = skyMat.uniforms;
    su.uZenith.value.copy(atmo.zenith);
    su.uHorizon.value.copy(atmo.horizon);
    su.uSunColor.value.copy(atmo.sunColor);
    su.uSunVis.value = atmo.sunVis;
    su.uMoonVis.value = atmo.moonVis;
    su.uStars.value = atmo.stars;
    su.uOvercast.value = atmo.overcast;
    if (skyRef.current) skyRef.current.position.copy(camera.position);

    if (moonRef.current) {
      moonRef.current.position.copy(camera.position).addScaledVector(world.moonDir, 380);
      moonRef.current.lookAt(camera.position);
      moonMat.uniforms.uVis.value = Math.min(1, atmo.moonVis * 1.2);
      moonRef.current.visible = atmo.moonVis > 0.01;
    }

    const light = sunRef.current;
    if (light) {
      light.position.copy(atmo.lightDir).multiplyScalar(40);
      target.position.set(0, 0, 0);
      light.target = target;
      light.color.copy(atmo.lightColor);
      light.intensity = atmo.lightIntensity;
    }
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(atmo.ambient);
      hemi.groundColor.copy(atmo.ground);
      hemi.intensity = atmo.ambientIntensity;
    }
    gl.toneMappingExposure = atmo.exposure;

    U.uSkyTint.value.copy(atmo.zenith).lerp(atmo.horizon, 0.5);
    U.uSunCol.value.copy(atmo.lightColor).multiplyScalar(atmo.lightIntensity * 0.4);
    U.uNight.value = world.night;
    U.uCloud.value = world.w.cloud;
  });

  const shadowSize = world.mobile ? 1024 : 2048;
  return (
    <>
      <mesh ref={skyRef} geometry={skyGeo} material={skyMat} renderOrder={-10} frustumCulled={false} raycast={() => null} />
      <mesh ref={moonRef} material={moonMat} renderOrder={-9} raycast={() => null}>
        <sphereGeometry args={[7, 32, 16]} />
      </mesh>
      <hemisphereLight ref={hemiRef} intensity={1} />
      <directionalLight
        ref={sunRef}
        castShadow
        intensity={2.5}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
        shadow-camera-left={-17}
        shadow-camera-right={17}
        shadow-camera-top={17}
        shadow-camera-bottom={-17}
        shadow-camera-near={1}
        shadow-camera-far={90}
      />
    </>
  );
}
