"use client";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { dustMotes, glowHalo, lightShaft, lookQuality, lookShadows, sunFloor, WINDOW_OPENING } from "./lookdev";
import { fabricSet, fbm, floorTileSet, plasterSet, stoneWallSet, woodGrainSet, type SurfaceSet } from "./proceduralTextures";

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

// Look-dev pass: the room now has a baked reflection environment (lookdev.ts),
// so metals use real metalness; `?quality=low` (no environment) falls back
// to the old low-metal gold with an emissive lift so it never renders brown.
const HQ = lookQuality() !== "low";
const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
const wood = (color: number, roughness: number) => {
  const s = woodGrainSet();
  return std({ color, roughness, map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.35, 0.35) });
};
const fabric = (color: number, roughness: number, side: THREE.Side = THREE.FrontSide) => {
  const s = fabricSet();
  return std({ color, roughness, side, map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
};
const painted = (color: number, roughness: number) => {
  const s = plasterSet([2, 2]);
  return std({ color, roughness, map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) });
};
const goldParams = (): THREE.MeshStandardMaterialParameters =>
  HQ
    ? { color: 0xf5cf72, metalness: 0.85, roughness: 0.3, emissive: 0x4a3008, emissiveIntensity: 0.25 }
    : { color: 0xf0c25a, metalness: 0.3, roughness: 0.4, emissive: 0x5a3e10, emissiveIntensity: 0.35 };

const MAT_DEF: Record<MatKey, () => THREE.Material> = {
  stone: () => painted(0xecdcc8, 0.92),
  stoneDark: () => painted(0xd2b9a0, 0.9),
  ivory: () => painted(0xf8f1e4, 0.5),
  cream: () => fabric(0xf3e6cb, 0.9),
  blue: () => painted(0x7896dc, 0.62),
  blueDeep: () => painted(0x5570c0, 0.6),
  lavender: () => fabric(0xbcaee6, 0.92),
  lavenderDeep: () => fabric(0x9483d0, 0.88),
  gold: () => std(goldParams()),
  goldDS: () => std({ ...goldParams(), side: THREE.DoubleSide }),
  curtain: () => fabric(0x7a99e0, 0.9, THREE.DoubleSide),
  // Soft contact shadow under furniture (one alpha-blended quad per piece).
  shadow: () => new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x5a3a28, transparent: true, depthWrite: false, opacity: lookShadows() ? 0.4 : 0.55, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  wood: () => wood(0xc89259, 0.62),
  woodDark: () => wood(0x96613a, 0.6),
  leaf: () => std({ color: 0x7db560, roughness: 0.75, flatShading: true }),
  leafDark: () => std({ color: 0x528f4a, roughness: 0.8, flatShading: true }),
  flowerWhite: () => std({ color: 0xfffaf0, roughness: 0.7 }),
  flowerLilac: () => std({ color: 0xae90e6, roughness: 0.75, flatShading: true }),
  flowerBlue: () => std({ color: 0x8aa8ef, roughness: 0.75, flatShading: true }),
  flowerPink: () => std({ color: 0xf5bccf, roughness: 0.75, flatShading: true }),
  glow: () => new THREE.MeshBasicMaterial({ color: 0xffe6aa, toneMapped: false }),
  mirror: () => (HQ ? std({ color: 0xe8eefa, metalness: 0.95, roughness: 0.06 }) : std({ color: 0xdfe7f6, metalness: 0.25, roughness: 0.25 })),
  gem: () => std({ color: 0x3f6fe0, emissive: 0x1c3a9a, emissiveIntensity: 0.6, metalness: HQ ? 0.6 : 0.3, roughness: 0.08, flatShading: true }),
  bookRed: () => wood(0xc06478, 0.75),
  bookBlue: () => wood(0x6380c0, 0.75),
  bookGreen: () => wood(0x80aa8e, 0.75),
  bookCream: () => wood(0xeedfbc, 0.75),
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
    return this.add(new THREE.PlaneGeometry(w, d), "shadow", { p: [p[0], 0.014, p[1]], r: [-Math.PI / 2, 0, 0] });
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

/** Soft warm stone blocks (walls): colour + normal + roughness maps. */
export function stoneWallTexture(repeat: [number, number]): SurfaceSet {
  return stoneWallSet(repeat);
}

/** Warm sandstone floor tiles with lavender inlays: colour + normal + roughness. */
export function floorTileTexture(repeat: [number, number]): SurfaceSet {
  return floorTileSet(repeat);
}

/** Speckle + pile noise painted over a canvas (rugs, banners). */
function clothGrain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const n = fbm(x / w, y / h, 32, 32, 2, seed) - 0.5;
      const f = 1 + n * amount + (((x * 7 + y * 13) % 5) - 2) * amount * 0.03;
      d[i] *= f;
      d[i + 1] *= f;
      d[i + 2] *= f;
    }
  ctx.putImageData(img, 0, 0);
}

function rugTexture() {
  return canvasTex("rug", 1024, 1024, (ctx, w) => {
    ctx.scale(2, 2);
    w = 512;
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
    // pearl dots between the rings + scalloped inner border
    ctx.fillStyle = "#f6ead0";
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 160, c + Math.sin(a) * 160, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#e8c46a";
    ctx.lineWidth = 3;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 128, c + Math.sin(a) * 128, 14, a + Math.PI * 0.5, a + Math.PI * 1.5, true);
      ctx.stroke();
    }
    // soft centre sheen (worn pile)
    const sheen = ctx.createRadialGradient(c, c, 20, c, c, 250);
    sheen.addColorStop(0, "rgba(255,250,240,0.10)");
    sheen.addColorStop(1, "rgba(60,40,90,0.10)");
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.arc(c, c, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    clothGrain(ctx, 1024, 1024, 0.16, 91);
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
    // embroidered stars + stitched inner border
    ctx.fillStyle = "#f1cf6e";
    const star = (x: number, y: number, r: number) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? r * 0.45 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.fill();
    };
    for (const [x, y] of [[60, 70], [196, 70], [70, 330], [186, 330], [128, 380]]) star(x, y, 9);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(0.78, 0.84);
    ctx.translate(-w / 2, -h / 2);
    path();
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(241,207,110,0.85)";
    ctx.stroke();
    ctx.restore();
    // fabric fold shading (vertical soft bands)
    for (let x = 0; x < w; x += 2) {
      const f = Math.sin((x / w) * Math.PI * 3.2) * 0.08;
      ctx.fillStyle = f > 0 ? `rgba(255,245,230,${f})` : `rgba(40,20,70,${-f})`;
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillRect(x, 0, 2, h);
    }
    ctx.globalCompositeOperation = "source-over";
    clothGrain(ctx, w, h, 0.12, 93);
  });
}

/** Daylight view through the window: pastel sky, clouds, hills, castle. */
function windowViewTexture() {
  // Painted at 256 × 640 design units (opening incl. arch), rendered 2×.
  return canvasTex("window-view-v2", 512, 1280, (ctx) => {
    ctx.scale(2, 2);
    const w = 256;
    const h = 640;
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, "#6fa8ea");
    sky.addColorStop(0.45, "#a9d0f6");
    sky.addColorStop(0.8, "#e4f0fb");
    sky.addColorStop(1, "#fdeedb");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // sun glow from the upper left
    const sun = ctx.createRadialGradient(30, 120, 4, 30, 120, 190);
    sun.addColorStop(0, "rgba(255,250,225,0.95)");
    sun.addColorStop(0.25, "rgba(255,236,190,0.45)");
    sun.addColorStop(1, "rgba(255,236,190,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);
    // puffy clouds with a shaded underside
    const cloud = (x: number, y: number, s: number) => {
      const puffs: Array<[number, number, number]> = [[-34, 6, 16], [-16, -6, 22], [6, -12, 26], [28, -2, 20], [44, 8, 14], [0, 8, 22]];
      ctx.fillStyle = "rgba(196,206,236,0.85)";
      for (const [dx, dy, r] of puffs) {
        ctx.beginPath();
        ctx.arc(x + dx * s, y + (dy + 5) * s, r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.97)";
      for (const [dx, dy, r] of puffs) {
        ctx.beginPath();
        ctx.arc(x + dx * s, y + dy * s, r * s * 0.94, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    cloud(70, 150, 1);
    cloud(196, 230, 0.75);
    cloud(110, 300, 0.55);
    cloud(214, 92, 0.6);
    // distant hazy mountains
    ctx.fillStyle = "#c3c8ec";
    ctx.beginPath();
    ctx.moveTo(0, 430);
    for (const [x, y] of [[30, 392], [62, 410], [104, 370], [150, 404], [196, 380], [256, 412]]) ctx.lineTo(x, y);
    ctx.lineTo(256, 470);
    ctx.lineTo(0, 470);
    ctx.fill();
    // castle on a far hill
    ctx.fillStyle = "#d8cff2";
    ctx.beginPath();
    ctx.ellipse(158, 470, 90, 26, 0, Math.PI, 0);
    ctx.fill();
    const lilac = "#b3a3e4";
    const roof = "#8f86d6";
    ctx.fillStyle = lilac;
    ctx.fillRect(126, 398, 66, 54);
    for (let i = 0; i < 6; i++) ctx.fillRect(126 + i * 12, 392, 7, 8);
    for (const [x, tw, th] of [[118, 16, 92], [150, 22, 124], [186, 16, 82], [138, 12, 70]] as const) {
      ctx.fillStyle = lilac;
      ctx.fillRect(x, 452 - th, tw, th);
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(x - 4, 452 - th);
      ctx.lineTo(x + tw / 2, 452 - th - 34);
      ctx.lineTo(x + tw + 4, 452 - th);
      ctx.fill();
      ctx.strokeStyle = "#e7b95a";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + tw / 2, 452 - th - 34);
      ctx.lineTo(x + tw / 2, 452 - th - 46);
      ctx.stroke();
      ctx.fillStyle = "#f2a7c8";
      ctx.beginPath();
      ctx.moveTo(x + tw / 2, 452 - th - 46);
      ctx.lineTo(x + tw / 2 + 9, 452 - th - 42);
      ctx.lineTo(x + tw / 2, 452 - th - 38);
      ctx.fill();
      ctx.fillStyle = "#fff4c8";
      ctx.fillRect(x + tw / 2 - 2, 452 - th + 14, 4, 7);
    }
    ctx.fillStyle = "#8f86d6";
    ctx.beginPath();
    ctx.arc(159, 452, 9, Math.PI, 0);
    ctx.fill();
    // rolling hills, front to back, with soft top highlights
    const hill = (y0: number, pts: Array<[number, number, number, number]>, fill: string, lip: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (const [cx, cy, x, y] of pts) ctx.quadraticCurveTo(cx, cy, x, y);
      ctx.lineTo(256, 640);
      ctx.lineTo(0, 640);
      ctx.fill();
      ctx.strokeStyle = lip;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (const [cx, cy, x, y] of pts) ctx.quadraticCurveTo(cx, cy, x, y);
      ctx.stroke();
    };
    hill(472, [[70, 440, 140, 468], [210, 492, 256, 456]], "#b7dc9a", "#d6efb8");
    hill(520, [[90, 488, 170, 520], [230, 544, 256, 520]], "#9ccf85", "#c4e8a8");
    hill(574, [[120, 540, 256, 578], [256, 578, 256, 578]], "#84c072", "#a8dc92");
    // round trees
    const tree = (x: number, y: number, r: number) => {
      ctx.fillStyle = "#8a6a4a";
      ctx.fillRect(x - r * 0.12, y, r * 0.24, r * 0.8);
      ctx.fillStyle = "#5fa560";
      ctx.beginPath();
      ctx.arc(x, y - r * 0.2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7cbf6c";
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.5, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    };
    tree(30, 500, 13);
    tree(52, 506, 9);
    tree(226, 528, 12);
    tree(204, 566, 16);
    tree(16, 592, 18);
    // flower dots in the near meadow
    const r = rng(17);
    for (let i = 0; i < 90; i++) {
      const x = r() * 256;
      const y = 560 + r() * 80;
      ctx.fillStyle = ["#fff6f0", "#f5bccf", "#c9b4f0", "#fbe08a"][i % 4];
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + r() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // atmospheric haze toward the horizon
    const haze = ctx.createLinearGradient(0, 360, 0, 520);
    haze.addColorStop(0, "rgba(255,244,230,0)");
    haze.addColorStop(0.5, "rgba(255,244,230,0.25)");
    haze.addColorStop(1, "rgba(255,244,230,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);
  });
}

// ── Architecture ────────────────────────────────────────────────────────────

let _viewMat: THREE.MeshBasicMaterial | null = null;
const viewMat = () => (_viewMat ??= new THREE.MeshBasicMaterial({ map: windowViewTexture(), toneMapped: false, name: "window-view" }));
let _sheenMat: THREE.MeshBasicMaterial | null = null;
const sheenMat = () =>
  (_sheenMat ??= new THREE.MeshBasicMaterial({
    name: "window-sheen",
    map: canvasTex("window-sheen", 128, 256, (ctx, w, h) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.5);
      for (const [x, wd, a] of [[-40, 34, 0.5], [6, 14, 0.35], [40, 8, 0.25]] as const) {
        const g = ctx.createLinearGradient(x - wd, 0, x + wd, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, `rgba(255,255,255,${a})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - wd, -h, wd * 2, h * 2);
      }
      ctx.restore();
    }),
    color: 0x9fb6d8,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.35,
    toneMapped: false,
  }));

/** Tall arched window in a stone surround (wall piece). Opening 1.1 × ~2.2 m,
 *  sill at 0.8 m; daylight view is an unlit texture (no glass/transparency). */
function archedWindow() {
  const k = new Kit();
  const W = 1.1;
  const sill = 0.8;
  const rectTop = 2.3;
  const R = W / 2;
  // view: one arched pane (rect + half circle) with the landscape mapped
  // across the whole opening, so the sky continues into the arch.
  const outline = new THREE.Shape();
  outline.moveTo(-R, sill);
  outline.lineTo(R, sill);
  outline.lineTo(R, rectTop);
  outline.absarc(0, rectTop, R, 0, Math.PI, false);
  outline.lineTo(-R, sill);
  const paneGeo = new THREE.ShapeGeometry(outline, 24);
  const pp = paneGeo.attributes.position as THREE.BufferAttribute;
  const puv = paneGeo.attributes.uv as THREE.BufferAttribute;
  const topY = rectTop + R;
  for (let i = 0; i < pp.count; i++) puv.setXY(i, (pp.getX(i) + R) / W, (pp.getY(i) - sill) / (topY - sill));
  const view = new THREE.Mesh(paneGeo, viewMat());
  view.position.z = 0.005;
  k.extra(view);
  // faint glass sheen: a cool reflection gradient over the lower panes
  // (additive, so the view stays bright and the "no transparency" budget holds)
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(W, rectTop - sill), sheenMat());
  sheen.position.set(0, (rectTop + sill) / 2, 0.012);
  k.extra(sheen);
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
  // candle inside + soft warm halo
  k.cyl("flowerWhite", 0.018, 0.018, 0.06, [0, -0.08, 0.21], 8);
  const halo = glowHalo(0xffc874, 0.55, 0.5);
  halo.position.set(0, -0.02, 0.24);
  k.extra(halo);
  return k.build("wall-lantern");
}

/** Royal purple banner with gold rod (wall piece; origin = rod centre). */
function royalBanner() {
  const k = new Kit();
  const w = 0.55;
  const h = 1.1;
  // gentle hanging folds (wavy along x, flattening toward the rod)
  const clothGeo = new THREE.PlaneGeometry(w, h, 16, 8);
  const cp = clothGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const y01 = (h / 2 - cp.getY(i)) / h;
    cp.setZ(i, Math.sin((cp.getX(i) / w) * Math.PI * 3.2) * 0.022 * Math.min(1, y01 * 3));
  }
  clothGeo.computeVertexNormals();
  const cloth = new THREE.Mesh(
    clothGeo,
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
  r.position.y = 0.008; // floor layers ≥ 4 mm apart (rug 8, shadows 14, sun 18): closer z-fights in VR
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
  const halo = glowHalo(0xffd9a0, 0.6, 0.45);
  halo.position.set(0, 0.24, 0);
  k.extra(halo);
  return k.build("crystal-lamp");
}

/** Warm sunlight patch on the floor in front of a window (Phase C). Origin =
 *  the wall under the window (place it with the window's transform); the
 *  patch falls into the room along +Z, slanted like low morning sun. One
 *  additive quad, no lights. */
function sunPatch() {
  // Floor patch = the window opening projected along the shared sun
  // direction (lookdev.SUN_LOCAL), so it lines up with the light shaft.
  const { x0, x1, y0, y1 } = WINDOW_OPENING;
  const corners = [sunFloor(x0, y0), sunFloor(x1, y0), sunFloor(x1, y1), sunFloor(x0, y1)];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap((c) => [c.x, 0, c.z]), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, sunPatchMat());
  m.position.y = 0.018;
  const g = new THREE.Group();
  g.name = "sun-patch";
  g.add(m);
  g.add(lightShaft());
  if (HQ) g.add(dustMotes(150, Math.round(Math.random() * 1000)));
  return g;
}

let _sunPatchMat: THREE.MeshBasicMaterial | null = null;
const sunPatchMat = () =>
  (_sunPatchMat ??= new THREE.MeshBasicMaterial({ name: "sun-patch", map: sunPatchTexture(), color: 0xffd9a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));

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
    // four panes split by the gold mullion + transom (v = 0 near the wall)
    ctx.fillRect(8, 8, w / 2 - 12, h * 0.48 - 10);
    ctx.fillRect(w / 2 + 4, 8, w / 2 - 12, h * 0.48 - 10);
    ctx.fillRect(8, h * 0.48 + 4, w / 2 - 12, h * 0.52 - 12);
    ctx.fillRect(w / 2 + 4, h * 0.48 + 4, w / 2 - 12, h * 0.52 - 12);
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
