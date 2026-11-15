"use client";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Phase B — procedural furniture, architecture and decor for the princess
// chamber, in the final art direction ("Cute Diorama Fantasy Animation":
// rounded shapes, soft stylised materials, pastel blue / ivory / lavender /
// gold). All built in code (no downloaded assets); each piece is a
// "builtin:<kind>" placed through data/scenes/puzzle.json and the Scene
// Editor.
//
// Standalone-Quest rules followed here:
//   - every piece merges its parts into ONE mesh per material (Kit), so a
//     piece costs only a few draw calls;
//   - materials and canvas textures are shared module singletons;
//   - no transparency, no mirrors (a mirror is a matte pale-blue surface),
//     no extra lights (lamp/lantern glow is an unlit emissive-looking mesh).
//
// Local frames: pieces stand on the floor at their origin (y = 0) and face
// +Z; wall pieces have their origin on the wall surface and face +Z (into
// the room). Sizes are real-world metres.

// ── Palette (shared materials) ──────────────────────────────────────────────

type MatKey =
  | "stone"
  | "stoneDark"
  | "ivory"
  | "cream"
  | "blue"
  | "blueDeep"
  | "lavender"
  | "lavenderDeep"
  | "gold"
  | "wood"
  | "woodDark"
  | "leaf"
  | "leafDark"
  | "flowerWhite"
  | "flowerLilac"
  | "flowerBlue"
  | "flowerPink"
  | "glow"
  | "mirror"
  | "gem"
  | "bookRed"
  | "bookBlue"
  | "bookGreen"
  | "bookCream"
  | "goldDS"
  | "curtain"
  | "shadow";

const MAT_DEF: Record<MatKey, () => THREE.Material> = {
  stone: () => new THREE.MeshStandardMaterial({ color: 0xead7c2, roughness: 0.95 }),
  stoneDark: () => new THREE.MeshStandardMaterial({ color: 0xcdb39b, roughness: 0.95 }),
  ivory: () => new THREE.MeshStandardMaterial({ color: 0xf7f0e2, roughness: 0.6 }),
  cream: () => new THREE.MeshStandardMaterial({ color: 0xf1e3c6, roughness: 0.85 }),
  blue: () => new THREE.MeshStandardMaterial({ color: 0x6f8fd8, roughness: 0.8 }),
  blueDeep: () => new THREE.MeshStandardMaterial({ color: 0x4a66b8, roughness: 0.75 }),
  lavender: () => new THREE.MeshStandardMaterial({ color: 0xb6a7e2, roughness: 0.9 }),
  lavenderDeep: () => new THREE.MeshStandardMaterial({ color: 0x8f7dcc, roughness: 0.85 }),
  // Phase C: no environment map on Quest, so high metalness renders gold as
  // dark brown; a low-metal warm gold with a faint emissive lift reads as
  // the bright pastel gold of the references.
  gold: () => new THREE.MeshStandardMaterial({ color: 0xf0c25a, metalness: 0.3, roughness: 0.4, emissive: 0x5a3e10, emissiveIntensity: 0.35 }),
  goldDS: () => new THREE.MeshStandardMaterial({ color: 0xf0c25a, metalness: 0.3, roughness: 0.4, emissive: 0x5a3e10, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
  curtain: () => new THREE.MeshStandardMaterial({ color: 0x7393dc, roughness: 0.85, side: THREE.DoubleSide }),
  // Soft contact shadow under furniture (one alpha-blended quad per piece).
  shadow: () => new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x5a3a28, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false }),
  wood: () => new THREE.MeshStandardMaterial({ color: 0xc08a52, roughness: 0.7 }),
  woodDark: () => new THREE.MeshStandardMaterial({ color: 0x8f5d33, roughness: 0.7 }),
  leaf: () => new THREE.MeshStandardMaterial({ color: 0x79ad5c, roughness: 0.9, flatShading: true }),
  leafDark: () => new THREE.MeshStandardMaterial({ color: 0x4f8a47, roughness: 0.9, flatShading: true }),
  flowerWhite: () => new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.8 }),
  flowerLilac: () => new THREE.MeshStandardMaterial({ color: 0xa98be3, roughness: 0.85, flatShading: true }),
  flowerBlue: () => new THREE.MeshStandardMaterial({ color: 0x86a3ec, roughness: 0.85, flatShading: true }),
  flowerPink: () => new THREE.MeshStandardMaterial({ color: 0xf3b8cc, roughness: 0.85, flatShading: true }),
  glow: () => new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false }),
  mirror: () => new THREE.MeshStandardMaterial({ color: 0xdfe7f6, metalness: 0.25, roughness: 0.25 }),
  gem: () => new THREE.MeshStandardMaterial({ color: 0x3f6fe0, emissive: 0x1c3a9a, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.15, flatShading: true }),
  bookRed: () => new THREE.MeshStandardMaterial({ color: 0xb85c6e, roughness: 0.8 }),
  bookBlue: () => new THREE.MeshStandardMaterial({ color: 0x5d76b8, roughness: 0.8 }),
  bookGreen: () => new THREE.MeshStandardMaterial({ color: 0x7aa287, roughness: 0.8 }),
  bookCream: () => new THREE.MeshStandardMaterial({ color: 0xe8d9b5, roughness: 0.8 }),
};
const matCache = new Map<MatKey, THREE.Material>();
export function mat(k: MatKey): THREE.Material {
  let m = matCache.get(k);
  if (!m) {
    m = MAT_DEF[k]();
    m.name = k;
    matCache.set(k, m);
  }
  return m;
}

// ── Kit: collect parts, merge per material ──────────────────────────────────

type Tf = { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _sv = new THREE.Vector3();

function tfMatrix(t: Tf) {
  _e.set(...(t.r ?? [0, 0, 0]));
  _q.setFromEuler(_e);
  _v.set(...(t.p ?? [0, 0, 0]));
  _sv.set(...(t.s ?? [1, 1, 1]));
  return _m.compose(_v, _q, _sv);
}

class Kit {
  private readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
  private readonly extras: THREE.Object3D[] = [];

  /** Add a geometry (consumed) with a transform. */
  add(geo: THREE.BufferGeometry, k: MatKey, t: Tf = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g.applyMatrix4(tfMatrix(t));
    let list = this.parts.get(k);
    if (!list) this.parts.set(k, (list = []));
    list.push(g);
    return this;
  }

  /** A box from min corner to max corner (axis-aligned, in piece space). */
  box(k: MatKey, min: [number, number, number], max: [number, number, number], r?: [number, number, number]) {
    const s: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const c: [number, number, number] = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];
    return this.add(new THREE.BoxGeometry(...s), k, { p: c, r });
  }

  /** Soft rounded box centred at p. */
  rbox(k: MatKey, size: [number, number, number], p: [number, number, number], radius = 0.04, r?: [number, number, number]) {
    const rad = Math.min(radius, Math.min(...size) / 2 - 0.001);
    return this.add(new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.max(rad, 0.001)), k, { p, r });
  }

  cyl(k: MatKey, rTop: number, rBot: number, h: number, p: [number, number, number], seg = 16, r?: [number, number, number]) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), k, { p, r });
  }

  sphere(k: MatKey, radius: number, p: [number, number, number], s?: [number, number, number], seg = 10) {
    return this.add(new THREE.SphereGeometry(radius, seg, Math.max(6, Math.round(seg * 0.7))), k, { p, s });
  }

  /** Low-poly blob (leaves, flower heads). */
  blob(k: MatKey, radius: number, p: [number, number, number], s?: [number, number, number]) {
    return this.add(new THREE.IcosahedronGeometry(radius, 1), k, { p, s });
  }

  lathe(k: MatKey, profile: Array<[number, number]>, p: [number, number, number] = [0, 0, 0], seg = 20) {
    return this.add(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), seg), k, { p });
  }

  torus(k: MatKey, radius: number, tube: number, p: [number, number, number], r?: [number, number, number], arc = Math.PI * 2, s?: [number, number, number]) {
    return this.add(new THREE.TorusGeometry(radius, tube, 8, 24, arc), k, { p, r, s });
  }

  /** Soft contact shadow on the floor under a w × d footprint (Phase C). */
  shadow(w: number, d: number, p: [number, number] = [0, 0]) {
    return this.add(new THREE.PlaneGeometry(w, d), "shadow", { p: [p[0], 0.004, p[1]], r: [-Math.PI / 2, 0, 0] });
  }

  /** Non-merged extra object (e.g. a textured plane). */
  extra(o: THREE.Object3D) {
    this.extras.push(o);
    return this;
  }

  build(name: string): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [k, geos] of this.parts) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      geos.forEach((x) => x !== merged && x.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat(k));
      mesh.name = `${name}:${k}`;
      g.add(mesh);
    }
    this.extras.forEach((o) => g.add(o));
    return g;
  }
}

// ── Canvas textures (shared) ────────────────────────────────────────────────

const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  texCache.set(key, t);
  return t;
}

/** Radial soft blob for contact shadows. */
function shadowTexture() {
  return canvasTex("shadow", 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Deterministic pseudo-random for stable procedural detail. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Soft warm stone blocks (walls). One tile ≈ 1 m. */
export function stoneWallTexture(repeat: [number, number]) {
  return canvasTex(`stone-${repeat}`, 512, 512, (ctx, w, h) => {
    const r = rng(7);
    ctx.fillStyle = "#d9c3ac";
    ctx.fillRect(0, 0, w, h);
    const rows = 5;
    const rh = h / rows;
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * 0.5;
      const cols = 3;
      for (let x = -1; x < cols + 1; x++) {
        const bx = (x + off) * (w / cols);
        const t = 228 + Math.floor(r() * 18);
        ctx.fillStyle = `rgb(${t},${t - 18},${t - 38})`;
        const pad = 5;
        const rr = 14;
        const x0 = bx + pad;
        const y0 = y * rh + pad;
        const bw = w / cols - pad * 2;
        const bh = rh - pad * 2;
        ctx.beginPath();
        ctx.moveTo(x0 + rr, y0);
        ctx.arcTo(x0 + bw, y0, x0 + bw, y0 + bh, rr);
        ctx.arcTo(x0 + bw, y0 + bh, x0, y0 + bh, rr);
        ctx.arcTo(x0, y0 + bh, x0, y0, rr);
        ctx.arcTo(x0, y0, x0 + bw, y0, rr);
        ctx.fill();
        // soft highlight on the top edge
        ctx.fillStyle = "rgba(255,248,235,0.35)";
        ctx.fillRect(x0 + rr, y0 + 3, bw - rr * 2, 6);
      }
    }
  }, repeat);
}

/** Warm stone floor tiles. */
export function floorTileTexture(repeat: [number, number]) {
  return canvasTex(`floor-${repeat}`, 512, 512, (ctx, w, h) => {
    const r = rng(11);
    ctx.fillStyle = "#b98d6c";
    ctx.fillRect(0, 0, w, h);
    const n = 4;
    const s = w / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const t = r();
        ctx.fillStyle = `rgb(${226 + t * 16},${186 + t * 14},${150 + t * 12})`;
        ctx.fillRect(x * s + 4, y * s + 4, s - 8, s - 8);
        ctx.fillStyle = "rgba(255,240,220,0.25)";
        ctx.fillRect(x * s + 10, y * s + 10, s - 20, 8);
      }
  }, repeat);
}

function rugTexture() {
  return canvasTex("rug", 512, 512, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = "#a99be0";
    ctx.fillRect(0, 0, w, w);
    const ring = (rad: number, width: number, col: string) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(c, c, rad, 0, Math.PI * 2);
      ctx.stroke();
    };
    ctx.fillStyle = "#8f80cf";
    ctx.beginPath();
    ctx.arc(c, c, 236, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#a99be0";
    ctx.beginPath();
    ctx.arc(c, c, 196, 0, Math.PI * 2);
    ctx.fill();
    ring(244, 10, "#e8c46a");
    ring(200, 6, "#e8c46a");
    ring(120, 4, "#e8c46a");
    // leafy border motif
    ctx.fillStyle = "#f0d48a";
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      ctx.save();
      ctx.translate(c + Math.cos(a) * 218, c + Math.sin(a) * 218);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // central flower-lily motif
    ctx.save();
    ctx.translate(c, c);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, -48, 18, 46, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(30, -28, 10, 26, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/** Purple royal banner with gold border and a flower-lily emblem; alpha-cut point. */
function bannerTexture() {
  return canvasTex("banner", 256, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, h * 0.82);
      ctx.lineTo(w / 2, h);
      ctx.lineTo(0, h * 0.82);
      ctx.closePath();
    };
    path();
    ctx.fillStyle = "#e4b650";
    ctx.fill();
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(0.86, 0.9);
    ctx.translate(-w / 2, -h / 2);
    path();
    ctx.fillStyle = "#7d63c4";
    ctx.fill();
    ctx.restore();
    // emblem
    ctx.fillStyle = "#f1cf6e";
    ctx.save();
    ctx.translate(w / 2, h * 0.42);
    ctx.beginPath();
    ctx.ellipse(0, -10, 16, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sgn * 30, 4, 11, 32, sgn * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(-36, 24, 72, 10);
    ctx.beginPath();
    ctx.ellipse(0, 52, 10, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/** Daylight view through the window: pastel sky, clouds, hills, castle. */
function windowViewTexture() {
  return canvasTex("window-view", 256, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#7fb6ee");
    g.addColorStop(0.55, "#cfe6fb");
    g.addColorStop(1, "#fbe9d2");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const [x, y, s] of [
      [60, 90, 1],
      [190, 150, 0.8],
      [110, 220, 0.6],
    ])
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x + (i - 1.5) * 18 * s, y + (i % 2) * -8 * s, 20 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    // castle silhouette
    ctx.fillStyle = "#b9a9e6";
    ctx.fillRect(120, 300, 70, 60);
    for (const [x, tw, th] of [
      [116, 18, 90],
      [150, 22, 120],
      [184, 18, 80],
    ]) {
      ctx.fillRect(x, 360 - th, tw, th);
      ctx.beginPath();
      ctx.moveTo(x - 4, 360 - th);
      ctx.lineTo(x + tw / 2, 360 - th - 34);
      ctx.lineTo(x + tw + 4, 360 - th);
      ctx.fill();
    }
    // hills
    ctx.fillStyle = "#9fd08a";
    ctx.beginPath();
    ctx.moveTo(0, 380);
    ctx.quadraticCurveTo(80, 330, 160, 375);
    ctx.quadraticCurveTo(220, 400, 256, 360);
    ctx.lineTo(256, 512);
    ctx.lineTo(0, 512);
    ctx.fill();
    ctx.fillStyle = "#7fbf6f";
    ctx.beginPath();
    ctx.moveTo(0, 440);
    ctx.quadraticCurveTo(130, 400, 256, 450);
    ctx.lineTo(256, 512);
    ctx.lineTo(0, 512);
    ctx.fill();
  });
}

// ── Architecture ────────────────────────────────────────────────────────────

/** Tall arched window in a stone surround (wall piece). Opening 1.1 × ~2.2 m,
 *  sill at 0.8 m; daylight view is an unlit texture (no glass/transparency). */
function archedWindow() {
  const k = new Kit();
  const W = 1.1;
  const sill = 0.8;
  const rectTop = 2.3;
  const R = W / 2;
  // view (rect + arch)
  const view = new THREE.Mesh(new THREE.PlaneGeometry(W, rectTop - sill), new THREE.MeshBasicMaterial({ map: windowViewTexture(), toneMapped: false }));
  view.position.set(0, (rectTop + sill) / 2, 0.005);
  k.extra(view);
  const archView = new THREE.Mesh(new THREE.CircleGeometry(R, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x86b9ee, toneMapped: false }));
  archView.position.set(0, rectTop, 0.005);
  k.extra(archView);
  // stone surround
  k.box("stone", [-R - 0.16, sill - 0.05, 0], [-R, rectTop, 0.14]);
  k.box("stone", [R, sill - 0.05, 0], [R + 0.16, rectTop, 0.14]);
  k.torus("stone", R + 0.08, 0.08, [0, rectTop, 0.07], undefined, Math.PI);
  k.box("stoneDark", [-R - 0.22, sill - 0.12, 0], [R + 0.22, sill, 0.22]); // sill
  k.sphere("stoneDark", 0.07, [0, rectTop + R + 0.09, 0.1], [1, 1.2, 0.8]); // keystone
  // gold mullions
  k.box("gold", [-0.018, sill, 0.02], [0.018, rectTop + R - 0.02, 0.05]);
  k.box("gold", [-R, 1.6, 0.02], [R, 1.635, 0.05]);
  k.torus("gold", R * 0.55, 0.014, [0, rectTop, 0.035], undefined, Math.PI);
  k.torus("gold", R - 0.01, 0.014, [0, rectTop, 0.035], undefined, Math.PI);
  return k.build("arched-window");
}

/** A pair of flowing royal-blue curtains with gold trim, rod and tie-backs,
 *  framing a 1.1 m window (wall piece). */
function curtains() {
  const k = new Kit();
  const top = 2.95;
  const h = 2.85;
  for (const side of [-1, 1]) {
    const pw = 0.62;
    const geo = new THREE.PlaneGeometry(pw, h, 28, 8);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // folds + gathered toward the tie-back at ~1.05 m
      const yy = (y + h / 2) / h; // 0 bottom … 1 top
      const gather = 1 - 0.45 * Math.exp(-((yy - 0.38) ** 2) / 0.02);
      const nx = x * gather - side * (1 - gather) * 0.12;
      pos.setX(i, nx);
      // Folds flatten where the cloth is gathered (steep, tightly packed folds
      // there caused dark streaks — Phase C fix).
      pos.setZ(i, Math.sin((x / pw) * Math.PI * 6) * 0.03 * gather * gather);
    }
    geo.computeVertexNormals();
    const cx = side * (0.55 + 0.31 - 0.05);
    k.add(geo, "curtain", { p: [cx, top - h / 2, 0.14] });
    // gold hem
    k.box("gold", [cx - 0.3, top - h - 0.0, 0.11], [cx + 0.3, top - h + 0.05, 0.17]);
    // tie-back + tassel
    k.torus("gold", 0.06, 0.012, [cx - side * 0.1, 1.05, 0.16], [Math.PI / 2, 0, 0], Math.PI * 2, [1.6, 1, 1]);
    k.cyl("gold", 0.012, 0.035, 0.12, [cx - side * 0.18, 0.95, 0.18], 10);
  }
  // rod + finials + valance
  k.cyl("gold", 0.022, 0.022, 2.1, [0, top + 0.03, 0.15], 12, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) k.sphere("gold", 0.045, [s * 1.07, top + 0.03, 0.15]);
  const val = new THREE.CylinderGeometry(0.06, 0.06, 1.9, 16, 1, false, 0, Math.PI);
  k.add(val, "blueDeep", { p: [0, top - 0.03, 0.15], r: [0, 0, Math.PI / 2] });
  k.box("gold", [-0.95, top - 0.105, 0.19], [0.95, top - 0.08, 0.215]);
  return k.build("curtains");
}

/** Stone column with gold capital and base (floor piece). */
function stoneColumn() {
  const k = new Kit();
  const H = 3.2;
  k.lathe("stone", [
    [0, 0],
    [0.22, 0],
    [0.22, 0.12],
    [0.17, 0.18],
    [0.15, 0.3],
    [0.14, H - 0.36],
    [0.17, H - 0.26],
  ]);
  k.box("gold", [-0.22, H - 0.26, -0.22], [0.22, H - 0.2, 0.22]);
  k.box("stone", [-0.26, H - 0.2, -0.26], [0.26, H, 0.26]);
  k.torus("gold", 0.165, 0.02, [0, 0.3, 0], [Math.PI / 2, 0, 0]);
  k.shadow(0.8, 0.8);
  return k.build("stone-column");
}

/** Trailing ivy with small white flowers (wall piece; origin = top anchor). */
function ivy() {
  const k = new Kit();
  const r = rng(5);
  for (let strand = 0; strand < 4; strand++) {
    const x0 = (strand - 1.5) * 0.18;
    const len = 0.6 + r() * 0.8;
    for (let t = 0; t < len; t += 0.07) {
      const x = x0 + Math.sin(t * 5 + strand) * 0.05;
      const k2: MatKey = r() > 0.5 ? "leaf" : "leafDark";
      k.blob(k2, 0.045 + r() * 0.02, [x, -t, 0.05 + r() * 0.03], [1, 0.8, 0.45]);
      if (r() > 0.8) k.sphere("flowerWhite", 0.022, [x + 0.03, -t, 0.09], undefined, 6);
    }
  }
  return k.build("ivy");
}

// ── Furniture ───────────────────────────────────────────────────────────────

/** Tufted lavender-blue chaise sofa with gold trim and an ivory throw. */
function chaiseSofa() {
  const k = new Kit();
  k.rbox("lavender", [1.6, 0.26, 0.74], [0, 0.32, 0], 0.08);
  k.rbox("lavender", [1.42, 0.14, 0.62], [0, 0.5, 0.04], 0.06);
  k.rbox("lavender", [1.5, 0.55, 0.18], [0, 0.78, -0.28], 0.08, [-0.12, 0, 0]);
  // tufting buttons
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) k.sphere("lavenderDeep", 0.018, [-0.6 + i * 0.24, 0.72 + j * 0.16, -0.17 - j * 0.02], undefined, 6);
  // rolled arms
  for (const s of [-1, 1]) {
    k.cyl("lavender", 0.13, 0.13, 0.72, [s * 0.76, 0.58, 0.0], 18, [Math.PI / 2, 0, 0]);
    k.torus("gold", 0.13, 0.012, [s * 0.76, 0.58, 0.36], undefined);
  }
  // gold trim + legs
  k.box("gold", [-0.8, 0.2, 0.36], [0.8, 0.23, 0.38]);
  for (const [x, z] of [
    [-0.7, 0.28],
    [0.7, 0.28],
    [-0.7, -0.28],
    [0.7, -0.28],
  ])
    k.cyl("gold", 0.03, 0.018, 0.2, [x, 0.1, z], 10);
  // cushions + throw
  k.rbox("ivory", [0.42, 0.36, 0.14], [-0.42, 0.72, -0.12], 0.06, [-0.2, 0.2, 0.1]);
  k.rbox("cream", [0.5, 0.02, 0.5], [0.52, 0.585, 0.05], 0.01);
  k.rbox("cream", [0.5, 0.36, 0.02], [0.52, 0.42, 0.38], 0.01);
  k.box("gold", [0.27, 0.235, 0.385], [0.77, 0.25, 0.395]);
  k.shadow(1.9, 1.0);
  return k.build("chaise-sofa");
}

/** Ivory vanity table with triple mirror (matte), gold knobs, small bottles. */
function vanity() {
  const k = new Kit();
  const W = 1.15;
  k.rbox("ivory", [W, 0.05, 0.52], [0, 0.76, 0], 0.02);
  for (const s of [-1, 1]) {
    k.rbox("ivory", [0.32, 0.5, 0.48], [s * 0.4, 0.48, 0], 0.03);
    for (let d = 0; d < 2; d++) {
      k.rbox("cream", [0.28, 0.2, 0.02], [s * 0.4, 0.37 + d * 0.23, 0.245], 0.01);
      k.sphere("gold", 0.018, [s * 0.4, 0.37 + d * 0.23, 0.265], undefined, 8);
    }
    for (const z of [-0.2, 0.2]) k.cyl("ivory", 0.03, 0.02, 0.25, [s * 0.5, 0.115, z], 10);
  }
  k.rbox("cream", [0.42, 0.1, 0.02], [0, 0.68, 0.245], 0.01);
  k.sphere("gold", 0.018, [0, 0.68, 0.265], undefined, 8);
  // triple mirror
  const my = 1.28;
  k.torus("gold", 0.3, 0.035, [0, my, -0.2], undefined, Math.PI * 2, [1, 1.3, 1]);
  k.add(new THREE.CircleGeometry(0.29, 28), "mirror", { p: [0, my, -0.205], s: [1, 1.3, 1] });
  for (const s of [-1, 1]) {
    k.torus("gold", 0.17, 0.03, [s * 0.44, my - 0.08, -0.17], [0, -s * 0.5, 0], Math.PI * 2, [1, 1.35, 1]);
    k.add(new THREE.CircleGeometry(0.16, 20), "mirror", { p: [s * 0.44, my - 0.08, -0.175], r: [0, -s * 0.5, 0], s: [1, 1.35, 1] });
  }
  k.box("ivory", [-0.05, 0.78, -0.24], [0.05, 0.9, -0.18]);
  // bottles + vase
  k.cyl("flowerPink", 0.03, 0.035, 0.1, [-0.35, 0.83, 0.08], 10);
  k.sphere("gold", 0.02, [-0.35, 0.9, 0.08], undefined, 8);
  k.cyl("lavender", 0.025, 0.03, 0.08, [-0.25, 0.82, 0.12], 10);
  k.lathe("ivory", [
    [0, 0],
    [0.06, 0.01],
    [0.08, 0.08],
    [0.04, 0.16],
    [0.05, 0.2],
  ], [0.38, 0.785, 0]);
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    k.blob(i % 2 ? "flowerLilac" : "flowerBlue", 0.06, [0.38 + Math.cos(a) * 0.07, 1.03 + (i % 3) * 0.03, Math.sin(a) * 0.07]);
  }
  k.shadow(1.4, 0.75);
  return k.build("vanity");
}

/** Matching padded stool. */
function stool() {
  const k = new Kit();
  k.sphere("lavender", 0.21, [0, 0.46, 0], [1, 0.35, 1], 18);
  k.cyl("wood", 0.2, 0.2, 0.06, [0, 0.4, 0], 20);
  k.torus("gold", 0.2, 0.01, [0, 0.43, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.cyl("wood", 0.02, 0.03, 0.4, [Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14], 8, [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12]);
  }
  k.torus("wood", 0.15, 0.012, [0, 0.14, 0], [Math.PI / 2, 0, 0]);
  k.shadow(0.6, 0.6);
  return k.build("stool");
}

/** Lavender-blue chest of drawers with gold handles (top at 0.86 m). */
function dresser() {
  const k = new Kit();
  k.rbox("blue", [1.05, 0.72, 0.5], [0, 0.46, 0], 0.03);
  k.rbox("ivory", [1.12, 0.05, 0.56], [0, 0.845, 0], 0.02);
  for (let d = 0; d < 3; d++) {
    const y = 0.24 + d * 0.21;
    k.rbox("blueDeep", [0.95, 0.17, 0.02], [0, y, 0.255], 0.01);
    for (const s of [-1, 1]) k.torus("gold", 0.03, 0.008, [s * 0.24, y, 0.27], undefined, Math.PI, [1, 1, 1]);
  }
  k.box("gold", [-0.53, 0.09, 0.24], [0.53, 0.11, 0.26]);
  for (const [x, z] of [
    [-0.45, 0.18],
    [0.45, 0.18],
    [-0.45, -0.18],
    [0.45, -0.18],
  ])
    k.cyl("gold", 0.035, 0.02, 0.1, [x, 0.05, z], 10);
  k.shadow(1.3, 0.75);
  return k.build("dresser");
}

/** Wooden curio cabinet / bookcase with open shelves of books and bottles. */
function cabinet() {
  const k = new Kit();
  const W = 1.0;
  const H = 2.0;
  const D = 0.4;
  k.box("wood", [-W / 2, 0.08, -D / 2], [W / 2, H, -D / 2 + 0.03]); // back
  k.box("wood", [-W / 2, 0.08, -D / 2], [-W / 2 + 0.03, H, D / 2]); // sides
  k.box("wood", [W / 2 - 0.03, 0.08, -D / 2], [W / 2, H, D / 2]);
  k.box("wood", [-W / 2 + 0.03, 0, -D / 2], [W / 2 - 0.03, 0.4, D / 2]); // base cupboard
  k.box("woodDark", [-0.45, 0.06, D / 2], [-0.01, 0.36, D / 2 + 0.015]);
  k.box("woodDark", [0.01, 0.06, D / 2], [0.45, 0.36, D / 2 + 0.015]);
  for (const s of [-1, 1]) k.sphere("gold", 0.02, [s * 0.06, 0.24, D / 2 + 0.03], undefined, 8);
  k.rbox("wood", [W + 0.12, 0.1, D + 0.08], [0, H + 0.05, 0.02], 0.02); // crown
  k.box("gold", [-W / 2 - 0.06, H - 0.02, D / 2 + 0.05], [W / 2 + 0.06, H + 0.0, D / 2 + 0.065]);
  const r = rng(3);
  const shelves = [0.4, 0.8, 1.2, 1.6];
  for (const y of shelves) {
    k.box("wood", [-W / 2 + 0.03, y, -D / 2 + 0.03], [W / 2 - 0.03, y + 0.025, D / 2 - 0.02]);
    let x = -W / 2 + 0.06;
    while (x < W / 2 - 0.12) {
      if (r() < 0.18) {
        k.lathe("flowerBlue", [
          [0, 0],
          [0.04, 0.005],
          [0.045, 0.1],
          [0.015, 0.15],
          [0.02, 0.19],
        ], [x + 0.05, y + 0.025, 0]);
        x += 0.12;
        continue;
      }
      const bw = 0.03 + r() * 0.03;
      const bh = 0.2 + r() * 0.12;
      const key = (["bookRed", "bookBlue", "bookGreen", "bookCream"] as const)[Math.floor(r() * 4)];
      k.box(key, [x, y + 0.025, -0.1], [x + bw, y + 0.025 + bh, 0.1], [0, 0, r() < 0.1 ? 0.15 : 0]);
      x += bw + 0.004;
    }
  }
  // glazing bars (frame only — no glass)
  k.box("woodDark", [-W / 2, 0.4, D / 2], [-W / 2 + 0.05, H - 0.02, D / 2 + 0.02]);
  k.box("woodDark", [W / 2 - 0.05, 0.4, D / 2], [W / 2, H - 0.02, D / 2 + 0.02]);
  k.box("woodDark", [-0.025, 0.4, D / 2], [0.025, H - 0.02, D / 2 + 0.02]);
  k.shadow(1.25, 0.65);
  return k.build("cabinet");
}

/** Turned round side table with an ivory lace cloth (top surface at 0.80 m). */
function roundTable() {
  const k = new Kit();
  k.cyl("wood", 0.34, 0.34, 0.04, [0, 0.78, 0], 32);
  k.cyl("cream", 0.36, 0.36, 0.006, [0, 0.803, 0], 32);
  k.cyl("cream", 0.362, 0.37, 0.1, [0, 0.75, 0], 32);
  k.lathe("wood", [
    [0.0, 0.0],
    [0.26, 0.0],
    [0.27, 0.03],
    [0.12, 0.08],
    [0.06, 0.16],
    [0.09, 0.26],
    [0.05, 0.38],
    [0.04, 0.55],
    [0.08, 0.66],
    [0.06, 0.76],
    [0.0, 0.76],
  ], [0, 0, 0], 24);
  k.torus("gold", 0.085, 0.012, [0, 0.26, 0], [Math.PI / 2, 0, 0]);
  k.shadow(0.9, 0.9);
  return k.build("round-table");
}

// ── Decor ───────────────────────────────────────────────────────────────────

/** Large ceramic floor pot with a leafy plant and white flowers. */
function pottedPlant() {
  const k = new Kit();
  k.lathe("ivory", [
    [0, 0],
    [0.16, 0],
    [0.2, 0.1],
    [0.23, 0.3],
    [0.25, 0.42],
    [0.22, 0.45],
  ], [0, 0, 0], 24);
  k.torus("gold", 0.235, 0.012, [0, 0.38, 0], [Math.PI / 2, 0, 0]);
  const r = rng(9);
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const rad = 0.08 + r() * 0.22;
    const y = 0.5 + r() * 0.55;
    k.blob(r() > 0.4 ? "leaf" : "leafDark", 0.1 + r() * 0.06, [Math.cos(a) * rad, y, Math.sin(a) * rad], [1, 0.7, 1]);
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const rad = 0.12 + r() * 0.2;
    const y = 0.7 + r() * 0.45;
    k.sphere("flowerWhite", 0.04, [Math.cos(a) * rad, y, Math.sin(a) * rad], [1, 0.6, 1], 8);
  }
  k.shadow(0.75, 0.75);
  return k.build("potted-plant");
}

/** Tabletop vase of hydrangeas (sits on furniture; origin = vase base). */
function hydrangeaVase() {
  const k = new Kit();
  k.lathe("ivory", [
    [0, 0],
    [0.07, 0],
    [0.11, 0.08],
    [0.1, 0.18],
    [0.06, 0.24],
    [0.08, 0.27],
  ], [0, 0, 0], 20);
  k.torus("gold", 0.105, 0.008, [0, 0.12, 0], [Math.PI / 2, 0, 0]);
  const r = rng(13);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c: [number, number, number] = [Math.cos(a) * 0.1, 0.36 + r() * 0.08, Math.sin(a) * 0.1];
    k.blob(i % 2 ? "flowerLilac" : "flowerBlue", 0.09, c, [1, 0.85, 1]);
    k.blob("leaf", 0.06, [c[0] * 1.6, 0.28, c[2] * 1.6], [1, 0.5, 1]);
  }
  k.blob("flowerPink", 0.08, [0, 0.46, 0], [1, 0.85, 1]);
  return k.build("hydrangea-vase");
}

/** Gold wall lantern with a warm glowing body (wall piece, no light source). */
function wallLantern() {
  const k = new Kit();
  k.rbox("gold", [0.1, 0.16, 0.02], [0, 0, 0.01], 0.01);
  k.cyl("gold", 0.012, 0.012, 0.2, [0, 0.02, 0.11], 8, [Math.PI / 2, 0, 0]);
  k.cyl("glow", 0.07, 0.07, 0.18, [0, -0.02, 0.21], 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.cyl("gold", 0.008, 0.008, 0.2, [Math.cos(a) * 0.072, -0.02, 0.21 + Math.sin(a) * 0.072], 5);
  }
  k.cyl("gold", 0.02, 0.09, 0.08, [0, 0.11, 0.21], 6);
  k.cyl("gold", 0.08, 0.05, 0.04, [0, -0.13, 0.21], 6);
  k.sphere("gold", 0.025, [0, 0.17, 0.21], undefined, 8);
  return k.build("wall-lantern");
}

/** Royal purple banner with gold rod (wall piece; origin = rod centre). */
function royalBanner() {
  const k = new Kit();
  const w = 0.55;
  const h = 1.1;
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: bannerTexture(), alphaTest: 0.5, roughness: 0.95, side: THREE.DoubleSide }),
  );
  cloth.position.set(0, -h / 2 - 0.03, 0.03);
  k.extra(cloth);
  k.cyl("gold", 0.014, 0.014, w + 0.16, [0, 0, 0.03], 10, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) k.sphere("gold", 0.03, [s * (w / 2 + 0.09), 0, 0.03], undefined, 8);
  k.cyl("gold", 0.006, 0.006, 0.12, [0, 0.06, 0.03], 6);
  return k.build("royal-banner");
}

/** Round lavender rug with gold pattern (floor, flat). */
function royalRug() {
  const g = new THREE.Group();
  g.name = "royal-rug";
  const r = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
  r.rotation.x = -Math.PI / 2;
  r.position.y = 0.005;
  g.add(r);
  return g;
}

/** Glowing crystal-ball lamp on a gold stand (sits on furniture). */
function crystalLamp() {
  const k = new Kit();
  k.lathe("gold", [
    [0, 0],
    [0.08, 0],
    [0.08, 0.02],
    [0.03, 0.06],
    [0.025, 0.12],
    [0.06, 0.15],
    [0.0, 0.15],
  ], [0, 0, 0], 16);
  k.sphere("glow", 0.1, [0, 0.24, 0], undefined, 16);
  return k.build("crystal-lamp");
}

/** Warm sunlight patch on the floor in front of a window (Phase C). Origin =
 *  the wall under the window (place it with the window's transform); the
 *  patch falls into the room along +Z, slanted like low morning sun. One
 *  additive quad, no lights. */
function sunPatch() {
  const geo = new THREE.BufferGeometry();
  const v = [-0.5, 0, 0.25, 0.5, 0, 0.25, 1.15, 0, 2.1, 0.05, 0, 2.1];
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: sunPatchTexture(), color: 0xffd9a0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  m.position.y = 0.006;
  const g = new THREE.Group();
  g.name = "sun-patch";
  g.add(m);
  return g;
}

/** Window-pane shaped light with soft edges. */
function sunPatchTexture() {
  return canvasTex("sun-patch", 128, 256, (ctx, w, h) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0.15)");
    ctx.fillStyle = g;
    ctx.filter = "blur(6px)";
    ctx.fillRect(10, 10, w / 2 - 16, h / 2 - 14);
    ctx.fillRect(w / 2 + 6, 10, w / 2 - 16, h / 2 - 14);
    ctx.fillRect(10, h / 2 + 4, w / 2 - 16, h / 2 - 14);
    ctx.fillRect(w / 2 + 6, h / 2 + 4, w / 2 - 16, h / 2 - 14);
    ctx.filter = "none";
  });
}

/** Small stack of books (sits on furniture or floor). */
function bookStack() {
  const k = new Kit();
  k.rbox("bookBlue", [0.3, 0.05, 0.22], [0, 0.025, 0], 0.01);
  k.rbox("bookRed", [0.27, 0.045, 0.2], [0.01, 0.073, 0], 0.01, [0, 0.15, 0]);
  k.rbox("bookCream", [0.24, 0.04, 0.18], [-0.01, 0.115, 0], 0.01, [0, -0.1, 0]);
  return k.build("book-stack");
}

// ── Ornate painting frame (used by the painting singleton) ──────────────────

/** Ornate gold frame around a w × h picture centred at the origin, facing +Z:
 *  ivory liner, bevelled gold moulding, corner rosettes, side scrolls and a
 *  crest with a blue gem. Leaves the picture area itself completely clear. */
export function ornateFrame(w: number, h: number): THREE.Group {
  const k = new Kit();
  const hw = w / 2;
  const hh = h / 2;
  const ring = (inner: number, width: number, depth: number, z: number, key: MatKey) => {
    const a = inner;
    const b = inner + width;
    k.box(key, [-hw - b, hh + a, z], [hw + b, hh + b, z + depth]); // top
    k.box(key, [-hw - b, -hh - b, z], [hw + b, -hh - a, z + depth]); // bottom
    k.box(key, [-hw - b, -hh - a, z], [-hw - a, hh + a, z + depth]); // left
    k.box(key, [hw + a, -hh - a, z], [hw + b, hh + a, z + depth]); // right
  };
  ring(0, 0.04, 0.03, -0.01, "ivory"); // liner
  ring(0.04, 0.05, 0.075, -0.01, "gold"); // inner bevel
  ring(0.09, 0.14, 0.05, -0.01, "gold"); // body
  ring(0.23, 0.025, 0.085, -0.01, "gold"); // outer bead
  const edge = 0.255;
  // corner rosettes
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const p: [number, number, number] = [sx * (hw + 0.16), sy * (hh + 0.16), 0.08];
      k.torus("gold", 0.075, 0.018, p);
      k.sphere("gold", 0.045, p, [1, 1, 0.6], 10);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        k.sphere("gold", 0.03, [p[0] + Math.cos(a) * 0.1, p[1] + Math.sin(a) * 0.1, 0.07], [1.4, 0.8, 0.5], 8);
      }
    }
  // side scrolls (mid-height)
  for (const sx of [-1, 1]) {
    k.torus("gold", 0.07, 0.016, [sx * (hw + edge + 0.03), 0.06, 0.05], [0, 0, sx * 0.3], Math.PI * 1.4);
    k.torus("gold", 0.05, 0.014, [sx * (hw + edge + 0.03), -0.08, 0.05], [0, 0, Math.PI + sx * 0.3], Math.PI * 1.4);
  }
  // crest: pediment arc, C-scrolls, leaves and a blue gem
  const cy = hh + edge;
  k.torus("gold", 0.55, 0.03, [0, cy - 0.02, 0.05], undefined, Math.PI, [1, 0.32, 1]);
  for (const sx of [-1, 1]) {
    k.torus("gold", 0.12, 0.022, [sx * 0.24, cy + 0.12, 0.06], [0, 0, sx > 0 ? -0.6 : Math.PI + 0.6], Math.PI * 1.5);
    k.torus("gold", 0.07, 0.018, [sx * 0.45, cy + 0.06, 0.06], [0, 0, sx > 0 ? 0.4 : Math.PI - 0.4], Math.PI * 1.4);
    k.sphere("gold", 0.05, [sx * 0.13, cy + 0.26, 0.06], [0.6, 1.4, 0.5], 8);
  }
  k.torus("gold", 0.105, 0.022, [0, cy + 0.2, 0.08]);
  k.add(new THREE.OctahedronGeometry(0.085, 0), "gem", { p: [0, cy + 0.2, 0.1], s: [0.85, 1.15, 0.6] });
  k.sphere("gold", 0.035, [0, cy + 0.34, 0.07], undefined, 8);
  // bottom shell
  k.sphere("gold", 0.08, [0, -hh - edge + 0.02, 0.06], [1.4, 0.7, 0.5], 10);
  return k.build("ornate-frame");
}

// ── Registry ───────────────────────────────────────────────────────────────

export const FURNITURE = {
  "arched-window": archedWindow,
  curtains,
  "stone-column": stoneColumn,
  ivy,
  "chaise-sofa": chaiseSofa,
  vanity,
  stool,
  dresser,
  cabinet,
  "round-table": roundTable,
  "potted-plant": pottedPlant,
  "hydrangea-vase": hydrangeaVase,
  "wall-lantern": wallLantern,
  "royal-banner": royalBanner,
  "royal-rug": royalRug,
  "crystal-lamp": crystalLamp,
  "book-stack": bookStack,
  "sun-patch": sunPatch,
} as const;

export type FurnitureKind = keyof typeof FURNITURE;
