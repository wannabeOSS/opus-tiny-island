import { Color, Vector3 } from "three";
import { clamp, smoothstep } from "./math";
import { world } from "./world";

type Key = {
  t: number;
  zen: string;
  hor: string;
  sun: string;
  amb: string;
  gnd: string;
  deep: string;
  shal: string;
};

// Gouache palette: mint mornings, peach afternoons, rose-lilac dusk, indigo nights.
const KEYS: Key[] = [
  { t: 0, zen: "#0c1736", hor: "#24356a", sun: "#9fb2ff", amb: "#3a4f8c", gnd: "#151d36", deep: "#0a1b38", shal: "#1d4a66" },
  { t: 4.5, zen: "#121d44", hor: "#2f3a6c", sun: "#9fb2ff", amb: "#3d4c86", gnd: "#181d36", deep: "#0d2142", shal: "#22506c" },
  { t: 5.7, zen: "#3c4b86", hor: "#d99a8e", sun: "#ff9f7c", amb: "#7f7fae", gnd: "#3b3042", deep: "#25476e", shal: "#5a8c9b" },
  { t: 7.0, zen: "#6b9fd6", hor: "#f0dcc8", sun: "#ffd6ad", amb: "#a8bed8", gnd: "#5f5a46", deep: "#236688", shal: "#55b5ad" },
  { t: 12, zen: "#4a8ed8", hor: "#d3e7ef", sun: "#fff3df", amb: "#b2cae0", gnd: "#6b6a50", deep: "#1c6488", shal: "#4ec0b2" },
  { t: 15.8, zen: "#5a8acb", hor: "#f2dcc2", sun: "#ffe1b2", amb: "#b2bfd6", gnd: "#6e5f48", deep: "#1f5f86", shal: "#52b3a6" },
  { t: 17.4, zen: "#6177b8", hor: "#ffc999", sun: "#ffb977", amb: "#b9a9c6", gnd: "#6e5040", deep: "#27537f", shal: "#57a59c" },
  { t: 18.4, zen: "#464f92", hor: "#ff9871", sun: "#ff8a57", amb: "#a68aaa", gnd: "#5a3c3b", deep: "#294570", shal: "#4c878d" },
  { t: 19.15, zen: "#2c306f", hor: "#c3728c", sun: "#d26a7c", amb: "#71669a", gnd: "#30283b", deep: "#1c3460", shal: "#386a7f" },
  { t: 20.2, zen: "#141e4a", hor: "#3b3c76", sun: "#9fb2ff", amb: "#3d4c86", gnd: "#161d34", deep: "#0e2244", shal: "#22506c" },
  { t: 24, zen: "#0c1736", hor: "#24356a", sun: "#9fb2ff", amb: "#3a4f8c", gnd: "#151d36", deep: "#0a1b38", shal: "#1d4a66" },
];

const parsed = KEYS.map((k) => ({
  t: k.t,
  zen: new Color(k.zen),
  hor: new Color(k.hor),
  sun: new Color(k.sun),
  amb: new Color(k.amb),
  gnd: new Color(k.gnd),
  deep: new Color(k.deep),
  shal: new Color(k.shal),
}));

export const atmo = {
  zenith: new Color(),
  horizon: new Color(),
  sunColor: new Color(),
  lightColor: new Color(),
  ambient: new Color(),
  ground: new Color(),
  fog: new Color(),
  waterDeep: new Color(),
  waterShallow: new Color(),
  lightDir: new Vector3(),
  sunIntensity: 0,
  lightIntensity: 0,
  ambientIntensity: 1,
  fogDensity: 0.008,
  sunVis: 1,
  moonVis: 0,
  stars: 0,
  overcast: 0,
  exposure: 1,
};

const tmp = new Color();
const storm = { zen: new Color("#3b4352"), hor: new Color("#717a86"), deep: new Color("#24384a"), shal: new Color("#4f6f78") };
const fogTint = new Color("#c8d0d2");
const snowTint = new Color("#dde3ea");
const moonLight = new Color("#9fb2ff");

// sun path: rises from the front-right, sets behind the island (in view of the default camera)
const E = new Vector3(0.6, 0, 0.8);
const NOON = new Vector3(0.8 * 0.42, 0.9, -0.6 * 0.42).normalize();
export function sunDirection(hours: number, out: Vector3) {
  const a = ((hours - 6) / 12) * Math.PI;
  out.copy(E).multiplyScalar(Math.cos(a)).addScaledVector(NOON, Math.sin(a));
  // keep the sun a bit lower and lazier
  out.y *= 0.82;
  return out.normalize();
}

export function computeAtmosphere() {
  const h = ((world.time % 24) + 24) % 24;
  let i = 0;
  while (i < parsed.length - 2 && parsed[i + 1].t <= h) i++;
  const a = parsed[i];
  const b = parsed[i + 1];
  const f = smoothstep(0, 1, (h - a.t) / (b.t - a.t));

  atmo.zenith.copy(a.zen).lerp(b.zen, f);
  atmo.horizon.copy(a.hor).lerp(b.hor, f);
  atmo.sunColor.copy(a.sun).lerp(b.sun, f);
  atmo.ambient.copy(a.amb).lerp(b.amb, f);
  atmo.ground.copy(a.gnd).lerp(b.gnd, f);
  atmo.waterDeep.copy(a.deep).lerp(b.deep, f);
  atmo.waterShallow.copy(a.shal).lerp(b.shal, f);

  sunDirection(h, world.sunDir);
  sunDirection(h - 12, world.moonDir);
  world.moonDir.y = Math.abs(world.moonDir.y) * 0.9 + 0.08;
  world.moonDir.normalize();

  const sunY = world.sunDir.y;
  const day = smoothstep(-0.12, 0.18, sunY);
  world.daylight = day;
  world.night = 1 - smoothstep(-0.2, 0.05, sunY);
  world.midnight = 1 - smoothstep(0.4, 1.0, Math.min(h, 24 - h));

  const w = world.w;
  const overcast = clamp((w.cloud - 0.3) / 0.7) * 0.75 + w.storm * 0.25;
  atmo.overcast = overcast;

  // weather tinting (scaled by daylight so nights stay dark)
  const lum = 0.35 + 0.65 * day;
  tmp.copy(storm.zen).multiplyScalar(lum);
  atmo.zenith.lerp(tmp, overcast * 0.85);
  tmp.copy(storm.hor).multiplyScalar(lum);
  atmo.horizon.lerp(tmp, overcast * 0.8);
  tmp.copy(storm.deep).multiplyScalar(lum);
  atmo.waterDeep.lerp(tmp, overcast * 0.6);
  tmp.copy(storm.shal).multiplyScalar(lum);
  atmo.waterShallow.lerp(tmp, overcast * 0.5);

  const fogW = Math.max(w.fog, w.snow * 0.5);
  tmp.copy(w.snow > w.fog ? snowTint : fogTint).multiplyScalar(0.25 + 0.75 * day);
  atmo.horizon.lerp(tmp, fogW * 0.7);
  atmo.zenith.lerp(tmp, fogW * 0.45);

  atmo.fog.copy(atmo.horizon).lerp(atmo.zenith, 0.12);
  atmo.fogDensity = 0.0075 + w.fog * 0.03 + w.rain * 0.006 + w.snow * 0.01;

  // lights
  const sunUp = smoothstep(-0.04, 0.14, sunY);
  const moonUp = smoothstep(0.0, 0.2, world.moonDir.y) * (1 - smoothstep(-0.1, 0.05, sunY));
  atmo.sunVis = smoothstep(-0.08, 0.02, sunY) * (1 - overcast * 0.9);
  atmo.moonVis = (1 - smoothstep(-0.15, 0.1, sunY)) * (1 - overcast * 0.8);
  atmo.stars = (1 - smoothstep(-0.18, 0.02, sunY)) * (1 - clamp(overcast * 1.2)) * (1 - fogW * 0.8);

  if (sunY > -0.03) {
    atmo.lightDir.copy(world.sunDir);
    atmo.lightColor.copy(atmo.sunColor);
    atmo.lightIntensity = 2.9 * sunUp * (1 - overcast * 0.72);
  } else {
    atmo.lightDir.copy(world.moonDir);
    atmo.lightColor.copy(moonLight);
    atmo.lightIntensity = 0.55 * moonUp * (1 - overcast * 0.6);
  }
  atmo.ambientIntensity = (0.55 + 0.6 * day) * (1 + overcast * 0.35);
  atmo.exposure = 1.0;

  if (world.flash > 0) {
    atmo.ambientIntensity += world.flash * 3;
    atmo.zenith.lerp(tmp.set("#c9d4ff"), world.flash * 0.6);
    atmo.horizon.lerp(tmp.set("#c9d4ff"), world.flash * 0.4);
  }
}
