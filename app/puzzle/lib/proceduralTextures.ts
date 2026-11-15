"use client";

import * as THREE from "three";

// Look-dev pass: procedural, tileable surface textures for the princess room.
//
// Everything is generated in code at load time (no downloaded assets) and
// cached per key. Each surface gets a colour map plus a normal map derived
// from a height field, so stone blocks, tile bevels, wood grain and cloth
// weave catch the sunlight instead of being painted flat. All textures tile
// seamlessly (value noise on a wrapped lattice).

export type SurfaceSet = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap?: THREE.Texture };

// ── Noise ───────────────────────────────────────────────────────────────────

function hash(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Periodic value noise: lattice wraps every (px, py) cells. */
function vnoise(x: number, y: number, px: number, py: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fBm over u, v ∈ [0, 1). `fx`/`fy` = base lattice cells. */
export function fbm(u: number, v: number, fx: number, fy: number, octaves: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let ax = fx;
  let ay = fy;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u * ax, v * ay, ax, ay, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    ax *= 2;
    ay *= 2;
  }
  return sum / norm;
}

export function rand(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ── Canvas ↔ texture helpers ────────────────────────────────────────────────

const cache = new Map<string, SurfaceSet | THREE.Texture>();

function toTexture(w: number, h: number, data: Uint8ClampedArray, srgb: boolean, repeat?: [number, number]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

/** Tangent-space normal map from a wrapped height field (OpenGL / +Y up). */
function normalsFrom(h: Float32Array, w: number, hh: number, strength: number) {
  const out = new Uint8ClampedArray(w * hh * 4);
  for (let y = 0; y < hh; y++) {
    const yu = ((y - 1 + hh) % hh) * w;
    const yd = ((y + 1) % hh) * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w;
      const xr = (x + 1) % w;
      const dx = (h[y * w + xr] - h[y * w + xl]) * strength;
      // canvas rows grow downward, texture v grows upward
      const dy = (h[yd + x] - h[yu + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function cloneSet(s: SurfaceSet, repeat: [number, number]): SurfaceSet {
  const c = (t: THREE.Texture) => {
    const n = t.clone();
    n.repeat.set(...repeat);
    n.needsUpdate = true;
    return n;
  };
  return { map: c(s.map), normalMap: c(s.normalMap), roughnessMap: s.roughnessMap ? c(s.roughnessMap) : undefined };
}

/** Generate once per kind, then hand out repeat-specific clones sharing the image. */
function memoSet(kind: string, repeat: [number, number], gen: () => SurfaceSet): SurfaceSet {
  const key = `${kind}@${repeat.join("x")}`;
  const hit = cache.get(key) as SurfaceSet | undefined;
  if (hit) return hit;
  let base = cache.get(kind) as SurfaceSet | undefined;
  if (!base) {
    base = gen();
    cache.set(kind, base);
  }
  const s = cloneSet(base, repeat);
  cache.set(key, s);
  return s;
}

// ── Stone wall ──────────────────────────────────────────────────────────────

/** Soft, rounded pastel stone blocks with mortar, chips and colour drift.
 *  One tile = 5 courses × 3 blocks (≈ 1.6 m with the shell's repeat). */
export function stoneWallSet(repeat: [number, number]): SurfaceSet {
  return memoSet("stone-wall", repeat, () => {
    const S = 1024;
    const rows = 5;
    const cols = 3;
    const rh = S / rows;
    const cw = S / cols;
    const height = new Float32Array(S * S);
    const col = new Uint8ClampedArray(S * S * 4);
    const rough = new Uint8ClampedArray(S * S * 4);
    const blockRnd = (r: number, c: number, k: number) => hash(((c % cols) + cols) % cols, r, 101 + k);
    const mortar = 7;
    const bevel = 26;
    const corner = 22;
    for (let y = 0; y < S; y++) {
      const r = Math.floor(y / rh);
      const off = (r % 2) * 0.5 * cw;
      const ly = y - r * rh;
      for (let x = 0; x < S; x++) {
        const xs = (((x - off) % S) + S) % S;
        const c = Math.floor(xs / cw);
        const lx = xs - c * cw;
        const u = x / S;
        const v = y / S;
        // rounded-rect signed distance (negative inside)
        const hw = cw / 2 - mortar;
        const hh = rh / 2 - mortar;
        const qx = Math.abs(lx - cw / 2) - (hw - corner);
        const qy = Math.abs(ly - rh / 2) - (hh - corner);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner;
        const big = fbm(u, v, 6, 6, 3, 3);
        const fine = fbm(u, v, 48, 48, 2, 9);
        // irregular edge: noise pushes the boundary in/out a few px
        const dd = d + (big - 0.5) * 14;
        const inside = smooth(0, bevel, -dd);
        const chip = smooth(0.62, 0.7, fbm(u, v, 14, 14, 2, 21)) * (1 - smooth(0, bevel * 2.2, -dd));
        const face = 0.82 + 0.12 * big + 0.04 * fine - 0.25 * chip;
        const hgt = inside * face + (1 - inside) * (0.05 + 0.04 * fine);
        height[y * S + x] = hgt;

        const t = blockRnd(r, c, 0);
        const warm = blockRnd(r, c, 1);
        // creamy to rosy stone drift per block
        let R = 236 + t * 12 - warm * 4;
        let G = 220 + t * 12 - warm * 12;
        let B = 200 + t * 10 - warm * 6;
        const tone = 0.93 + 0.08 * big + 0.05 * (fine - 0.5);
        R *= tone;
        G *= tone;
        B *= tone;
        // stylised top-edge highlight and bottom-edge shade on each block
        const topLight = smooth(bevel * 1.6, 0, Math.abs(ly - mortar - 6)) * inside;
        const botShade = smooth(bevel * 1.4, 0, Math.abs(rh - mortar - ly)) * inside;
        R += 14 * topLight - 10 * botShade;
        G += 12 * topLight - 12 * botShade;
        B += 10 * topLight - 10 * botShade;
        // mortar + cavity darkening
        const mR = 216 + fine * 12;
        const mG = 198 + fine * 10;
        const mB = 178 + fine * 10;
        const cav = 1 - 0.06 * (1 - inside);
        const i = (y * S + x) * 4;
        col[i] = (R * inside + mR * (1 - inside)) * cav;
        col[i + 1] = (G * inside + mG * (1 - inside)) * cav;
        col[i + 2] = (B * inside + mB * (1 - inside)) * cav;
        col[i + 3] = 255;
        const ro = 255 * (0.78 + 0.18 * (1 - inside) + 0.06 * fine);
        rough[i] = rough[i + 1] = rough[i + 2] = ro;
        rough[i + 3] = 255;
      }
    }
    return {
      map: toTexture(S, S, col, true),
      normalMap: toTexture(S, S, normalsFrom(height, S, S, 5), false),
      roughnessMap: toTexture(S, S, rough, false),
    };
  });
}

// ── Floor tiles ─────────────────────────────────────────────────────────────

/** Large warm sandstone tiles with faint veining, bevelled edges and small
 *  dusty-lavender diamond inlays at the grout crossings. 4 × 4 per tile. */
export function floorTileSet(repeat: [number, number]): SurfaceSet {
  return memoSet("floor-tile", repeat, () => {
    const S = 1024;
    const n = 4;
    const ts = S / n;
    const height = new Float32Array(S * S);
    const col = new Uint8ClampedArray(S * S * 4);
    const rough = new Uint8ClampedArray(S * S * 4);
    const grout = 5;
    const bevel = 16;
    const diamond = 34;
    for (let y = 0; y < S; y++) {
      const ty = Math.floor(y / ts);
      const ly = y - ty * ts;
      for (let x = 0; x < S; x++) {
        const tx = Math.floor(x / ts);
        const lx = x - tx * ts;
        const u = x / S;
        const v = y / S;
        const big = fbm(u, v, 5, 5, 3, 41);
        const fine = fbm(u, v, 64, 64, 2, 43);
        // distance to tile edge
        const e = Math.min(lx, ts - lx, ly, ts - ly) - grout;
        // nearest grout crossing → diamond inlay (L1 distance)
        const cx = Math.round(x / ts) * ts;
        const cy = Math.round(y / ts) * ts;
        const dl1 = Math.abs(x - cx) + Math.abs(y - cy);
        const inDia = smooth(diamond, diamond - 3, dl1);
        const diaEdge = smooth(diamond + grout, diamond, dl1);
        const tileMask = smooth(0, bevel, e) * (1 - diaEdge);
        const t = hash(tx % n, ty % n, 77);
        const t2 = hash(tx % n, ty % n, 78);
        // faint marble veining running diagonally
        const w = fbm(u, v, 3, 3, 4, 50 + tx * 3 + ty);
        const vein = Math.pow(1 - Math.abs(Math.sin((u * 2.2 + v * 1.4 + w * 2.6) * Math.PI * 2)), 18);
        let R = 236 + t * 12;
        let G = 200 + t * 10 - t2 * 6;
        let B = 166 + t * 8 - t2 * 4;
        const tone = 0.94 + 0.08 * big + 0.04 * (fine - 0.5);
        R = R * tone - vein * 18;
        G = G * tone - vein * 16;
        B = B * tone - vein * 10;
        // soft rim light on each tile's upper edge (painted, stylised)
        const rim = smooth(bevel * 1.4, bevel * 0.4, ly - grout) * tileMask;
        R += 10 * rim;
        G += 9 * rim;
        B += 8 * rim;
        // diamond inlay: dusty lavender with a pale-gold rim
        const dR = 184 + fine * 10;
        const dG = 168 + fine * 10;
        const dB = 214 + fine * 10;
        const gR = 196 + fine * 20;
        const gG = 164 + fine * 18;
        const gB = 120 + fine * 12;
        const groutR = 176 + fine * 16;
        const groutG = 142 + fine * 14;
        const groutB = 116 + fine * 12;
        const ring = diaEdge * (1 - inDia);
        const i = (y * S + x) * 4;
        const mixT = tileMask;
        let oR = groutR * (1 - mixT) + R * mixT;
        let oG = groutG * (1 - mixT) + G * mixT;
        let oB = groutB * (1 - mixT) + B * mixT;
        oR = oR * (1 - ring) + gR * ring;
        oG = oG * (1 - ring) + gG * ring;
        oB = oB * (1 - ring) + gB * ring;
        oR = oR * (1 - inDia) + dR * inDia;
        oG = oG * (1 - inDia) + dG * inDia;
        oB = oB * (1 - inDia) + dB * inDia;
        col[i] = oR;
        col[i + 1] = oG;
        col[i + 2] = oB;
        col[i + 3] = 255;
        height[y * S + x] = 0.9 * tileMask + 0.75 * inDia + 0.5 * ring + 0.03 * fine + 0.04 * big * tileMask;
        const ro = 255 * (tileMask * (0.42 + 0.14 * big) + (1 - tileMask) * 0.95);
        rough[i] = rough[i + 1] = rough[i + 2] = ro * (1 - inDia) + 255 * 0.5 * inDia;
        rough[i + 3] = 255;
      }
    }
    return {
      map: toTexture(S, S, col, true),
      normalMap: toTexture(S, S, normalsFrom(height, S, S, 4), false),
      roughnessMap: toTexture(S, S, rough, false),
    };
  });
}

// ── Detail maps (multiplied with a material colour) ─────────────────────────

/** Near-white wood grain (grain runs along v); tint comes from the material. */
export function woodGrainSet(): SurfaceSet {
  return memoSet("wood", [1, 1], () => {
    const S = 512;
    const height = new Float32Array(S * S);
    const col = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const warp = fbm(u, v, 3, 1, 3, 61);
        const ring = 0.5 + 0.5 * Math.sin((u * 18 + warp * 3.5) * Math.PI * 2);
        const streak = fbm(u, v, 64, 4, 2, 63);
        const g = 0.8 + 0.12 * ring + 0.1 * streak;
        const i = (y * S + x) * 4;
        col[i] = 255 * Math.min(1, g * 1.0);
        col[i + 1] = 255 * Math.min(1, g * 0.97);
        col[i + 2] = 255 * Math.min(1, g * 0.93);
        col[i + 3] = 255;
        height[y * S + x] = ring * 0.6 + streak * 0.4;
      }
    return { map: toTexture(S, S, col, true), normalMap: toTexture(S, S, normalsFrom(height, S, S, 1.2), false) };
  });
}

/** Soft cloth weave for upholstery and curtains. */
export function fabricSet(): SurfaceSet {
  return memoSet("fabric", [3, 3], () => {
    const S = 256;
    const height = new Float32Array(S * S);
    const col = new Uint8ClampedArray(S * S * 4);
    const N = 48;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const a = Math.sin(u * N * Math.PI * 2);
        const b = Math.sin(v * N * Math.PI * 2);
        const weave = 0.5 + 0.5 * (Math.sign(a * b) * Math.min(Math.abs(a), Math.abs(b)));
        const n = fbm(u, v, 8, 8, 3, 71);
        const g = 0.9 + 0.06 * weave + 0.06 * (n - 0.5);
        const i = (y * S + x) * 4;
        col[i] = col[i + 1] = col[i + 2] = 255 * Math.min(1, g + 0.04);
        col[i + 3] = 255;
        height[y * S + x] = weave * 0.6 + n * 0.4;
      }
    return { map: toTexture(S, S, col, true), normalMap: toTexture(S, S, normalsFrom(height, S, S, 0.9), false) };
  });
}

/** Soft hand-troweled plaster (ceiling, painted wood, ceramics). */
export function plasterSet(repeat: [number, number] = [1, 1]): SurfaceSet {
  return memoSet("plaster", repeat, () => {
    const S = 512;
    const height = new Float32Array(S * S);
    const col = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const n = fbm(u, v, 4, 4, 5, 81);
        const g = 0.94 + 0.08 * (n - 0.5);
        const i = (y * S + x) * 4;
        col[i] = col[i + 1] = col[i + 2] = 255 * Math.min(1, g + 0.03);
        col[i + 3] = 255;
        height[y * S + x] = n;
      }
    return { map: toTexture(S, S, col, true), normalMap: toTexture(S, S, normalsFrom(height, S, S, 3), false) };
  });
}

/** Radial soft glow (halos, motes, shaft edges). White, alpha in the map. */
export function glowTexture(): THREE.Texture {
  const hit = cache.get("glow") as THREE.Texture | undefined;
  if (hit) return hit;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.7)");
  g.addColorStop(0.45, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set("glow", t);
  return t;
}
