import type { Material, WebGLProgramParametersWithUniforms } from "three";
import { WET_SIZE, wetTexture } from "./wetmap";
import { U } from "./world";

export type PatchOptions = {
  /** wind sway: offset grows with (localY - base) * scale */
  sway?: { base?: number; scale?: number; push?: number; stiff?: number };
  snow?: number;
  wet?: boolean;
  terrain?: boolean;
  cloth?: boolean;
  cloudShadow?: boolean;
  /** per-vertex `aTint` decides how much instanceColor applies */
  tintAttr?: boolean;
};

export const GLSL_NOISE = /* glsl */ `
float tiHash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float tiNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(tiHash(i), tiHash(i+vec2(1,0)), u.x), mix(tiHash(i+vec2(0,1)), tiHash(i+vec2(1,1)), u.x), u.y);
}
float tiFbm(vec2 p){ float s=0.0; float a=0.5; for(int i=0;i<4;i++){ s+=a*tiNoise(p); p=p*2.03+17.1; a*=0.5;} return s; }
`;

/**
 * Injects island-wide behaviour (wind, snow, wetness, caustics...) into a built-in material
 * so it keeps three.js lighting, shadows and fog.
 */
export function patchMaterial<T extends Material>(mat: T, opts: PatchOptions): T {
  const sway = opts.sway;
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, U);
    shader.uniforms.uSwayBase = { value: sway?.base ?? 0 };
    shader.uniforms.uSwayScale = { value: sway?.scale ?? 0 };
    shader.uniforms.uSwayPush = { value: sway?.push ?? 0 };
    shader.uniforms.uSwayStiff = { value: sway?.stiff ?? 1.5 };
    shader.uniforms.uSnowAmt = { value: opts.snow ?? 0 };
    if (opts.terrain) shader.uniforms.uWetMap = { value: wetTexture };

    const header = /* glsl */ `
      uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;
      uniform vec3 uPointer; uniform float uPointerStrength;
      uniform float uSwayBase; uniform float uSwayScale; uniform float uSwayPush; uniform float uSwayStiff;
      varying vec3 vTiWorld; varying vec3 vTiNormal;
    `;
    shader.vertexShader = header + shader.vertexShader;

    if (opts.tintAttr) {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute float aTint;\nvoid main() {")
        .replace(
          "#include <color_vertex>",
          /* glsl */ `
          vColor = vec4(1.0);
          vColor.xyz = color.xyz;
          #ifdef USE_INSTANCING_COLOR
            vColor.xyz = mix(color.xyz, color.xyz * instanceColor.xyz, aTint);
          #endif
          `,
        );
    }

    if (opts.cloth) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        float hang = 1.0 - uv.y;
        float flap = sin(uv.x*5.0 + uTime*(4.0+uWindStrength*6.0) + position.x*3.0) * (0.03 + uWindStrength*0.09);
        flap += sin(uv.x*11.0 - uTime*7.0) * 0.012 * uWindStrength;
        transformed.z += (flap + uWindStrength*0.22 + 0.02) * hang;
        transformed.y += uWindStrength*0.06*hang*hang;
        `,
      );
    }

    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      /* glsl */ `
      vec4 tiLocal = vec4(transformed, 1.0);
      vec4 tiRoot = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        tiLocal = instanceMatrix * tiLocal;
        tiRoot = instanceMatrix * tiRoot;
      #endif
      vec4 tiW = modelMatrix * tiLocal;
      tiRoot = modelMatrix * tiRoot;
      if (uSwayScale > 0.0) {
        float hgt = max(tiW.y - tiRoot.y - uSwayBase, 0.0) * uSwayScale;
        float k = pow(hgt, uSwayStiff);
        float ph = tiRoot.x * 0.37 + tiRoot.z * 0.29;
        vec2 osc = vec2(sin(uTime*1.3 + ph), cos(uTime*1.07 + ph*1.3)) * (0.35 + uWindStrength*1.2);
        osc += vec2(sin(uTime*3.1 + ph*2.0 + tiW.y*2.0)) * 0.15 * uWindStrength;
        vec2 off = (uWind * 0.9 + osc * 0.18) * k * 0.12;
        if (uSwayPush > 0.0) {
          vec2 dp = tiRoot.xz - uPointer.xz;
          float dl = length(dp);
          off += (dp / max(dl, 0.001)) * smoothstep(1.3, 0.0, dl) * uPointerStrength * uSwayPush * k;
        }
        tiW.xz += off;
        tiW.y -= dot(off, off) * 0.25;
      }
      vTiWorld = tiW.xyz;
      vTiNormal = normalize(mat3(modelMatrix) * objectNormal);
      vec4 mvPosition = viewMatrix * tiW;
      gl_Position = projectionMatrix * mvPosition;
      `,
    );

    shader.fragmentShader =
      /* glsl */ `
      uniform float uTime; uniform vec2 uWind; uniform float uWet; uniform float uSnow; uniform float uSnowAmt;
      uniform float uNight; uniform float uCloud; uniform vec3 uSkyTint; uniform vec3 uSunCol;
      varying vec3 vTiWorld; varying vec3 vTiNormal;
      ${opts.terrain ? `uniform sampler2D uWetMap;` : ""}
      ${GLSL_NOISE}
    ` + shader.fragmentShader;

    let colorInject = "";
    if (opts.terrain) {
      colorInject += /* glsl */ `
        float tiFlat = smoothstep(0.86, 0.97, vTiNormal.y);
        float tiDry = smoothstep(-0.05, 0.12, vTiWorld.y);
        float puddle = uWet * tiFlat * smoothstep(0.58, 0.7, tiFbm(vTiWorld.xz*0.55)) * tiDry * smoothstep(0.5, 0.7, vTiWorld.y);
        float tiSpot = texture2D(uWetMap, vTiWorld.xz / ${WET_SIZE.toFixed(1)} + 0.5).r * tiDry;
        tiSpot *= 0.8 + 0.2 * tiNoise(vTiWorld.xz * 6.0);
        puddle = max(puddle, tiFlat * smoothstep(0.75, 0.95, tiSpot) * 0.6);
        diffuseColor.rgb *= 1.0 - 0.32*uWet*tiDry - 0.36*tiSpot;
        diffuseColor.rgb = mix(diffuseColor.rgb, uSkyTint*0.55, puddle*0.75);
        float underwater = smoothstep(0.02, -0.25, vTiWorld.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.55,0.85,0.88), underwater*0.8);
      `;
    } else if (opts.wet) {
      colorInject += `diffuseColor.rgb *= 1.0 - 0.28*uWet;`;
    }
    if (opts.snow) {
      colorInject += /* glsl */ `
        float tiSnowN = smoothstep(0.35, 0.85, vTiNormal.y) * smoothstep(0.08, 0.35, vTiWorld.y);
        float tiSnowM = uSnow * uSnowAmt * tiSnowN * (0.75 + 0.25*tiNoise(vTiWorld.xz*3.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92,0.94,1.0), clamp(tiSnowM*1.3, 0.0, 1.0));
      `;
    }
    if (colorInject) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" + colorInject,
      );
    }

    if (opts.terrain || opts.wet) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, uWet*0.55);
        ${opts.terrain ? "roughnessFactor = mix(roughnessFactor, 0.35, tiSpot*0.7); roughnessFactor = mix(roughnessFactor, 0.06, puddle);" : ""}
        `,
      );
    }

    let outInject = "";
    if (opts.cloudShadow || opts.terrain) {
      outInject += /* glsl */ `
        vec2 csUv = vTiWorld.xz*0.045 - uWind*uTime*0.02 - vec2(uTime*0.006, uTime*0.004);
        float cs = smoothstep(0.45, 0.75, tiFbm(csUv));
        outgoingLight *= 1.0 - cs * 0.22 * smoothstep(0.1, 0.6, uCloud) * (1.0 - uNight);
      `;
    }
    if (opts.terrain) {
      outInject += /* glsl */ `
        float uwd = smoothstep(0.0, -0.2, vTiWorld.y) * smoothstep(-3.0, -0.4, vTiWorld.y);
        vec2 cp = vTiWorld.xz*1.1;
        float c1 = tiNoise(cp + vec2(uTime*0.35, uTime*0.22));
        float c2 = tiNoise(cp*1.3 - vec2(uTime*0.27, -uTime*0.31));
        float caustic = pow(1.0 - abs(c1 - c2), 10.0);
        outgoingLight += caustic * uwd * uSunCol * 0.07 * (1.0 - uNight) * (1.0 - uCloud*0.6);
      `;
    }
    if (outInject) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        outInject + "\n#include <opaque_fragment>",
      );
    }
  };
  mat.customProgramCacheKey = () => JSON.stringify(opts);
  return mat;
}
