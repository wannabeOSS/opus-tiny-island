import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { mulberry32 } from "./math";

const cache = new Map<string, CanvasTexture>();

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/** Horizontal clapboard planks with grain and knots. */
export function plankTexture(base: string, seed = 1, rows = 7) {
  return make(`plank-${base}-${seed}-${rows}`, 256, 256, (ctx) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    const rh = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const l = (rnd() - 0.5) * 18;
      ctx.fillStyle = `rgba(${l > 0 ? 255 : 0},${l > 0 ? 240 : 0},${l > 0 ? 220 : 0},${Math.abs(l) / 100})`;
      ctx.fillRect(0, y, 256, rh);
      // grain
      for (let g = 0; g < 9; g++) {
        ctx.strokeStyle = `rgba(60,35,20,${0.04 + rnd() * 0.06})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const gy = y + rnd() * rh;
        ctx.moveTo(0, gy);
        for (let x = 0; x <= 256; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.05 + g) * 1.5);
        ctx.stroke();
      }
      // shadow line under each board
      ctx.fillStyle = "rgba(40,22,12,0.35)";
      ctx.fillRect(0, y + rh - 3, 256, 3);
      ctx.fillStyle = "rgba(255,245,230,0.15)";
      ctx.fillRect(0, y, 256, 1.5);
      // a vertical seam
      const sx = rnd() * 256;
      ctx.fillStyle = "rgba(40,22,12,0.25)";
      ctx.fillRect(sx, y, 2, rh);
      if (rnd() < 0.4) {
        ctx.fillStyle = "rgba(70,40,25,0.25)";
        ctx.beginPath();
        ctx.ellipse(rnd() * 256, y + rh / 2, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

/** Overlapping roof shingles. */
export function shingleTexture(base: string, seed = 2) {
  return make(`shingle-${base}-${seed}`, 256, 256, (ctx) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    const rows = 9;
    const rh = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 16;
      for (let x = -32; x < 256; x += 32) {
        const l = (rnd() - 0.5) * 0.18;
        ctx.fillStyle = l > 0 ? `rgba(255,255,255,${l})` : `rgba(0,0,0,${-l})`;
        ctx.beginPath();
        ctx.roundRect(x + off + 1, r * rh, 30, rh - 1, [0, 0, 6, 6]);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(x + off + 1, r * rh + rh - 3, 30, 3);
      }
    }
  });
}

/** Rough stone for foundations. */
export function stoneTexture(seed = 3) {
  return make(`stone-${seed}`, 128, 128, (ctx) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = "#8f877c";
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) {
      const l = 120 + rnd() * 70;
      ctx.fillStyle = `rgb(${l},${l - 6},${l - 14})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * 128, rnd() * 128, 8 + rnd() * 10, 6 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(50,45,40,0.5)";
      ctx.stroke();
    }
  });
}
