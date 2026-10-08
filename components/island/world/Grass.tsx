"use client";

import { useMemo } from "react";
import {
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { CABIN, LIGHTHOUSE, OLD_TREE, POND } from "../lib/layout";
import { fbm, mulberry32, smoothstep } from "../lib/math";
import { distToPath, height, islandD, normalAt } from "../lib/terrain";
import { U, world } from "../lib/world";

function bladeGeometry() {
  // 4 segments, tapering to a tip
  const segs = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.5 * Math.pow(1 - t, 0.9);
    if (i === segs) {
      pos.push(0, 1, 0);
    } else {
      pos.push(-w, t, 0, w, t, 0);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segs - 1) * 2;
  idx.push(last, last + 1, segs * 2);
  return { pos: new Float32Array(pos), idx };
}

function scatter(count: number) {
  const rnd = mulberry32(42);
  const offsets = new Float32Array(count * 4);
  const params = new Float32Array(count * 4);
  const n = new Vector3();
  let k = 0;
  let tries = 0;
  while (k < count && tries < count * 12) {
    tries++;
    const x = (rnd() * 2 - 1) * 11.5;
    const z = (rnd() * 2 - 1) * 11.5;
    const y = height(x, z);
    if (y < 0.5) continue;
    if (islandD(x, z) > 0.86) continue;
    normalAt(x, z, n);
    if (n.y < 0.84) continue;
    const clump = fbm(x * 0.55 + 11, z * 0.55 - 4);
    const near = (px: number, pz: number, r: number) => Math.hypot(x - px, z - pz) < r;
    if (near(CABIN.x, CABIN.z, 1.25)) continue;
    if (near(POND.x, POND.z, POND.r + 0.25)) continue;
    if (near(LIGHTHOUSE.x, LIGHTHOUSE.z, 0.85)) continue;
    if (near(OLD_TREE.x, OLD_TREE.z, 0.35)) continue;
    const pd = distToPath(x, z);
    if (pd < 0.28) continue;
    // patchy: denser in clumps, sparse at path edges and near beach
    const keep = smoothstep(-0.35, 0.25, clump) * smoothstep(0.28, 0.6, pd) * smoothstep(0.5, 0.75, y);
    if (rnd() > keep * 0.95 + 0.05) continue;
    offsets[k * 4] = x;
    offsets[k * 4 + 1] = y - 0.02;
    offsets[k * 4 + 2] = z;
    offsets[k * 4 + 3] = clump;
    const tall = 0.09 + rnd() * 0.1 + smoothstep(0.0, 0.6, clump) * 0.12;
    params[k * 4] = rnd() * Math.PI;
    params[k * 4 + 1] = tall;
    params[k * 4 + 2] = 0.035 + rnd() * 0.03;
    params[k * 4 + 3] = rnd();
    k++;
  }
  return { offsets, params, count: k };
}

export function Grass() {
  const { geo, mat } = useMemo(() => {
    const blade = bladeGeometry();
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", new BufferAttribute(blade.pos, 3));
    g.setIndex(blade.idx);
    const s = scatter(world.mobile ? 9000 : 22000);
    g.setAttribute("aOffset", new InstancedBufferAttribute(s.offsets, 4));
    g.setAttribute("aParams", new InstancedBufferAttribute(s.params, 4));
    g.instanceCount = s.count;

    const m = new MeshStandardMaterial({ roughness: 0.85, side: DoubleSide, color: new Color("#ffffff") });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader =
        /* glsl */ `
        attribute vec4 aOffset; attribute vec4 aParams;
        uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;
        uniform vec3 uPointer; uniform float uPointerStrength;
        varying float vT; varying float vVar; varying float vClump; varying vec3 vGW;
      ` +
        shader.vertexShader
          .replace(
            "#include <beginnormal_vertex>",
            "vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0,0.0,0.0);\n#endif",
          )
          .replace(
            "#include <begin_vertex>",
            /* glsl */ `
            float t = position.y;
            vec3 transformed = vec3(position.x * aParams.z * 1.7, t * aParams.y, 0.0);
            float c = cos(aParams.x), s = sin(aParams.x);
            transformed.xz = mat2(c, -s, s, c) * transformed.xz;
            vec3 root = aOffset.xyz;
            float ph = root.x * 0.6 + root.z * 0.45;
            float wave = sin(ph + uTime * 1.8) * 0.5 + sin(root.x * 1.7 - uTime * 2.6 + root.z * 1.2) * 0.3;
            vec2 bend = uWind * (0.55 + 0.45 * wave) * 0.75 + vec2(wave, wave * 0.6) * 0.05;
            vec2 dp = root.xz - uPointer.xz;
            float dl = length(dp);
            bend += (dp / max(dl, 0.001)) * smoothstep(1.25, 0.1, dl) * uPointerStrength * 1.1;
            float bl = length(bend);
            if (bl > 1.2) bend *= 1.2 / bl;
            float k = t * t;
            transformed.xz += bend * k * aParams.y;
            transformed.y -= dot(bend, bend) * k * aParams.y * 0.3;
            transformed += root;
            vT = t; vVar = aParams.w; vClump = aOffset.w; vGW = root;
          `,
          );
      shader.fragmentShader =
        /* glsl */ `
        uniform float uSnow; uniform float uWet; uniform vec3 uSunCol; uniform float uNight;
        varying float vT; varying float vVar; varying float vClump; varying vec3 vGW;
      ` +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
          vec3 base = mix(vec3(0.16, 0.28, 0.08), vec3(0.22, 0.34, 0.1), vClump * 0.5 + 0.5);
          vec3 tip = mix(vec3(0.40, 0.58, 0.17), vec3(0.58, 0.66, 0.24), smoothstep(0.75, 1.0, vVar));
          tip = mix(tip, vec3(0.30, 0.48, 0.14), smoothstep(0.1, 0.6, vClump) * 0.7);
          vec3 g = mix(base, tip, smoothstep(0.0, 1.0, vT));
          g *= 0.9 + vVar * 0.2;
          g *= 1.0 - 0.3 * uWet;
          g = mix(g, vec3(0.9, 0.93, 1.0), uSnow * smoothstep(0.3, 1.0, vT));
          diffuseColor.rgb = g;
          `,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);",
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        outgoingLight += uSunCol * vec3(0.45, 0.6, 0.2) * vT * vT * 0.18 * (1.0 - uNight);
        #include <opaque_fragment>`,
      );
    };
    m.customProgramCacheKey = () => "grass";
    return { geo: g, mat: m };
  }, []);

  return <mesh geometry={geo} material={mat} frustumCulled={false} receiveShadow raycast={() => null} />;
}
