/**
 * Hand-placed landmarks (x, z). Heights are always derived from the terrain.
 * Default camera looks from the front-right (+x, +z) toward the sunset (-x, -z).
 */
export const ISLAND_R = 11;

export const CLIFF = { x: 4.9, z: -5.6, r: 3.1, top: 2.55 };
export const POND = { x: -3.5, z: -2.3, r: 1.3 };

export const CABIN = { x: -0.5, z: 0.7, rot: -0.81, w: 1.7, d: 1.4 };
export const DOCK_ANGLE = 2.36;

export const LIGHTHOUSE = { x: 5.5, z: -6.3 };

export const OLD_TREE = { x: 2.6, z: -1.1 };

export const ROUND_TREES = [
  { x: -4.9, z: 1.0, s: 1.05, seed: 3 },
  { x: -1.6, z: -3.7, s: 1.15, seed: 7 },
  { x: -5.6, z: -4.4, s: 0.9, seed: 11 },
  { x: 3.7, z: 2.9, s: 0.72, seed: 19 },
];

export const PINES = [
  { x: 3.3, z: -4.6, s: 1.0, seed: 5 },
  { x: 4.0, z: -7.3, s: 0.85, seed: 9 },
  { x: 6.9, z: -4.3, s: 0.75, seed: 13 },
];

export const PALMS = [
  { a: 0.32, r: 8.4, lean: 0.32, s: 1.0, seed: 2 },
  { a: 0.78, r: 8.0, lean: 0.38, s: 0.92, seed: 4 },
  { a: 1.25, r: 8.5, lean: 0.28, s: 1.08, seed: 6 },
];

export const FLOWER_PATCHES = [
  { x: 0.9, z: 2.5, r: 1.0, n: 26 },
  { x: 1.9, z: 0.9, r: 0.8, n: 18 },
  { x: -2.1, z: -1.5, r: 0.8, n: 16 },
  { x: 3.1, z: -2.4, r: 0.9, n: 20 },
  { x: -5.3, z: -1.0, r: 1.1, n: 22 },
  { x: -0.4, z: -2.4, r: 0.7, n: 12 },
  { x: -3.6, z: 1.6, r: 0.7, n: 14 },
  { x: 4.6, z: -5.6, r: 1.3, n: 22 },
];

export const LAUNDRY = { a: { x: -2.9, z: 0.4 }, b: { x: -2.1, z: -0.75 } };

export const BUOY = { x: 10.6, z: 12.8 };

export const SEA_STACKS = [
  { x: 12.6, z: -4.4, h: 3.4, r: 1.1, seed: 1 },
  { x: 11.2, z: -7.4, h: 2.2, r: 0.8, seed: 2 },
  { x: 13.8, z: -2.2, h: 1.2, r: 0.55, seed: 3 },
  { x: -12.4, z: -6.5, h: 1.6, r: 0.7, seed: 4 },
];

export const BOUNCY_MUSHROOM = { x: 3.25, z: -0.35 };
