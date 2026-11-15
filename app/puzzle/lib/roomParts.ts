"use client";

import * as THREE from "three";
import { BOARD_H, BOARD_W, OCTAGON, PAINTING_SATURATION, PUZZLE_ACTIONS, PUZZLE_AUDIO_PROMPTS, ROOM, roomOutline, roomWalls } from "../puzzleConfig";
import { Gramophone } from "./gramophone";
import { DrawingBoard } from "./drawingBoard";
import type { SceneDoc, SceneObject } from "../../lib/sceneData/types";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FURNITURE, floorTileTexture, mat, ornateFrame, stoneWallTexture, type FurnitureKind } from "./furniture";
import { glowHalo, lookQuality, withRoomAO } from "./lookdev";
import { plasterSet, woodGrainSet } from "./proceduralTextures";
import { ROOM_LAYOUT } from "../roomLayout";

// Building blocks of the princess room, shared by the /puzzle runtime and
// the Scene Editor (/editor?scene=puzzle).
//
// Every placeable piece is built at its own local origin; its placement in
// the room comes from the shared scene file (data/scenes/puzzle.json) as an
// object with asset "builtin:<kind>". With no file, DEFAULT_PUZZLE_LAYOUT
// reproduces the original hard-coded room exactly.
//
//   singletons (interactive, exactly one, movable but not deletable):
//     painting · easel · gramophone · pedestal
//   decor (any number): rug · canopy-bed · night-window · sconce ·
//     banner-blue · banner-pink · side-table
//   shell (walls/floor/ceiling, from ROOM): code only, locked in the editor

export const BUILTIN = "builtin:";

// ── Small helpers (also used by PuzzleScene) ────────────────────────────────

export function makeCanvasTex(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, tex };
}

export function paint(
  c: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture },
  bg: string,
  lines: Array<{ text: string; font: string; color: string }>,
  align: CanvasTextAlign = "center",
) {
  const ctx = c.canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.canvas.width, c.canvas.height);
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const lh = c.canvas.height / Math.max(lines.length, 1);
  const x = align === "center" ? c.canvas.width / 2 : 16;
  lines.forEach((l, i) => {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, x, lh * (i + 0.5), c.canvas.width - 32);
  });
  c.tex.needsUpdate = true;
}

/** A box beam between two points. */
export function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function plankTexture() {
  const c = makeCanvasTex(512, 512);
  const ctx = c.canvas.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    const shade = 120 + ((i * 37) % 30);
    ctx.fillStyle = `rgb(${shade + 40},${shade},${shade - 50})`;
    ctx.fillRect(0, i * 64, 512, 64);
    ctx.fillStyle = "rgba(60,35,15,0.6)";
    ctx.fillRect(0, i * 64, 512, 3);
    ctx.fillRect(((i * 197) % 400) + 40, i * 64, 3, 64);
  }
  c.tex.wrapS = c.tex.wrapT = THREE.RepeatWrapping;
  c.tex.repeat.set(4, 4);
  return c.tex;
}

function nightWindowTexture() {
  const c = makeCanvasTex(256, 384);
  const ctx = c.canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 384);
  g.addColorStop(0, "#1b2457");
  g.addColorStop(1, "#4a5fa8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = "#fff7d6";
  for (let i = 0; i < 40; i++) ctx.fillRect((i * 97) % 256, (i * 53) % 260, 2, 2);
  ctx.beginPath();
  ctx.arc(180, 80, 30, 0, Math.PI * 2);
  ctx.fill();
  c.tex.needsUpdate = true;
  return c.tex;
}

// Phase C: one shared warm gold everywhere (see furniture.ts "gold").
const trimMat = () => mat("gold");
const goldMat = () => mat("gold");

/** Lights of the room (same in runtime and editor). */
// Phase C: warm late-morning sunlight. Three cheap lights, no shadows, no
// point lights (Quest): a warm sky/lavender-bounce hemisphere, a warm "sun"
// from the left window and a soft cool fill from the right. Floor sun
// patches (builtin:sun-patch) fake the light coming through the windows.
// Look-dev pass: with the baked room environment (lookdev.applyEnvironment)
// supplying soft bounce light, the hemisphere is lower and the sun is
// stronger and casts the one static shadow map. Its direction matches the
// left window's light shaft (lookdev.SUN_LOCAL rotated by the window's 90°).
export function addRoomLights(scene: THREE.Scene) {
  const q = lookQuality();
  const hq = q !== "low";
  scene.background = new THREE.Color(0xf3e3cc);
  // ultra: the global room environment adds diffuse bounce, so the hemisphere
  // is low. high (Quest): env only on shiny materials → hemisphere carries it.
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0xc7a9d6, q === "ultra" ? 0.82 : hq ? 1.2 : 1.55));
  const sun = new THREE.DirectionalLight(0xffd8a4, q === "ultra" ? 2.3 : hq ? 1.9 : 1.35);
  sun.position.set(-4.25, 5, 1.3);
  sun.name = "sun";
  if (q === "ultra") {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -4;
    c.right = 4;
    c.top = 4;
    c.bottom = -4;
    c.near = 1;
    c.far = 14;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 4;
    sun.shadow.intensity = 0.72;
  }
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xd6dcff, hq ? 0.45 : 0.35);
  fill.position.set(3, 2, 1.5);
  scene.add(fill);
}

// ── Shell (locked) ──────────────────────────────────────────────────────────

/** A moulding of length `len` along local X, profile = [depth (+Z), height (+Y)]
 *  points from the wall outward and back (closed against the wall). */
function molding(len: number, profile: Array<[number, number]>, material: THREE.Material) {
  const shape = new THREE.Shape(profile.map(([d, y]) => new THREE.Vector2(d, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 4 });
  // extruded along +Z → rotate so the length runs along X and depth along +Z
  geo.rotateY(-Math.PI / 2);
  geo.translate(len / 2, 0, 0);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

export function buildShell(): THREE.Group {
  // Octagonal chamber (art pass 2026-11-15): floor + ceiling follow the
  // octagon outline, eight stone walls with skirting and gold crown
  // moulding, slim stone pilasters hide the 135° wall joints, and the
  // ceiling has eight wooden ribs meeting at a gilded centre boss. Shared
  // materials; staticBatch merges it all into a handful of draw calls.
  const shell = new THREE.Group();
  shell.name = "room shell (octagon)";
  const H = ROOM.height;
  const outline = roomOutline();
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  // Floor: ShapeGeometry UVs are in metres, so tiles repeat every 2.4 m.
  const fl = floorTileTexture([1 / 2.4, 1 / 2.4]);
  const floorMat = withRoomAO(new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughnessMap: fl.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8), name: "floor" }));
  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2); // shape (x, −z) → floor (x, 0, z), facing up
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.name = "floor";
  shell.add(floor);
  const pl = plasterSet([1 / 1.5, 1 / 1.5]);
  const ceilMat = withRoomAO(new THREE.MeshStandardMaterial({ color: 0xf8f0e2, map: pl.map, normalMap: pl.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 1, name: "ceiling" }), 0.9);
  const ceilGeo = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z))));
  ceilGeo.rotateX(Math.PI / 2); // shape (x, z) → (x, 0, z), facing down
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
  ceiling.position.y = H;
  ceiling.name = "ceiling";
  shell.add(ceiling);
  // Walls: one stone material, UVs scaled per wall (texture every 1.6 m).
  const ws = stoneWallTexture([1, 1]);
  const wallMat = withRoomAO(new THREE.MeshStandardMaterial({ map: ws.map, normalMap: ws.normalMap, roughnessMap: ws.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(1, 1), name: "wall" }));
  const wainMat = mat("stoneDark");
  const trim = trimMat();
  for (const w of roomWalls()) {
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.yaw;
    const geo = new THREE.PlaneGeometry(w.length, H);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w.length / 1.6), uv.getY(i) * (H / 1.6));
    const wall = new THREE.Mesh(geo, wallMat);
    wall.position.y = H / 2;
    g.add(wall);
    // profiled stone skirting (plinth + ogee + bead) and a gold crown
    // moulding, extruded along the wall (joints hidden by the pilasters)
    const base = molding(w.length, [[0, 0], [0.07, 0], [0.07, 0.16], [0.05, 0.19], [0.055, 0.215], [0.03, 0.235], [0.0, 0.24]], wainMat);
    g.add(base);
    const crown = molding(w.length, [[0, 0], [0.025, 0.0], [0.03, 0.02], [0.06, 0.05], [0.085, 0.085], [0.09, 0.11], [0.0, 0.11]], trim);
    crown.position.y = H - 0.11;
    g.add(crown);
    shell.add(g);
  }
  // Corner pilasters: slim turned stone shafts with gold bands.
  const stone = mat("stone");
  const pilaster = new THREE.LatheGeometry(
    [[0, 0], [0.15, 0], [0.15, 0.1], [0.12, 0.15], [0.1, 0.26], [0.095, H - 0.42], [0.12, H - 0.34], [0.12, H - 0.11], [0, H - 0.11]].map(([x, y]) => new THREE.Vector2(x, y)),
    16,
  );
  const band = new THREE.TorusGeometry(0.1, 0.016, 6, 16).rotateX(Math.PI / 2);
  for (const [x, z] of outline) {
    const p = new THREE.Mesh(pilaster, stone);
    p.position.set(x, 0, z);
    shell.add(p);
    for (const y of [0.27, H - 0.4]) {
      const b = new THREE.Mesh(band, trim);
      b.position.set(x, y, z);
      shell.add(b);
    }
  }
  // Ceiling: eight wooden ribs from the corners to a centre ring + boss.
  const c = new THREE.Vector3(OCTAGON.cx, H - 0.06, OCTAGON.cz);
  const ribMat = mat("woodDark");
  for (const [x, z] of outline) {
    const from = new THREE.Vector3(x, H - 0.06, z);
    const dir = c.clone().sub(from).normalize();
    shell.add(beam(from.clone().addScaledVector(dir, 0.1), c.clone().addScaledVector(dir, -0.42), 0.12, 0.1, ribMat));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 40).rotateX(Math.PI / 2), ribMat);
  ring.position.copy(c);
  shell.add(ring);
  const medallion = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40).rotateX(Math.PI / 2), mat("lavender"));
  medallion.position.set(c.x, H - 0.004, c.z);
  shell.add(medallion);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI), trim);
  boss.position.set(c.x, H - 0.005, c.z);
  shell.add(boss);
  return shell;
}

// ── Decor ───────────────────────────────────────────────────────────────────

function rug() {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48), new THREE.MeshStandardMaterial({ color: 0xc95b84, roughness: 1 }));
  r.rotation.x = -Math.PI / 2;
  r.position.y = 0.008;
  g.add(r);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.25, 48), new THREE.MeshStandardMaterial({ color: 0xf2d27a, roughness: 1 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.011;
  g.add(ring);
  return g;
}

function canopyBed() {
  const bed = new THREE.Group();
  const trim = trimMat();
  const bedWood = new THREE.MeshStandardMaterial({ color: 0xf5f0f7, roughness: 0.6 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 2.0), bedWood);
  frame.position.y = 0.2;
  bed.add(frame);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.18, 1.94), new THREE.MeshStandardMaterial({ color: 0xf7c6dc, roughness: 1 }));
  mattress.position.y = 0.46;
  bed.add(mattress);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.35), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
  pillow.position.set(0, 0.6, -0.75);
  bed.add(pillow);
  for (const [px, pz] of [
    [-0.62, -0.97],
    [0.62, -0.97],
    [-0.62, 0.97],
    [0.62, 0.97],
  ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.2, 12), trim);
    post.position.set(px, 1.1, pz);
    bed.add(post);
  }
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.06, 2.05),
    new THREE.MeshStandardMaterial({ color: 0xf2a7c8, roughness: 1, transparent: true, opacity: 0.9 }),
  );
  canopy.position.y = 2.2;
  bed.add(canopy);
  const drapeMat = new THREE.MeshStandardMaterial({ color: 0xf8cfe2, roughness: 1, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  for (const pz of [-0.97, 0.97]) {
    const drape = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1.7), drapeMat);
    drape.position.set(0.62, 1.35, pz);
    drape.rotation.y = Math.PI / 2;
    bed.add(drape);
  }
  return bed;
}

function nightWindow() {
  const win = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), new THREE.MeshBasicMaterial({ map: nightWindowTexture(), toneMapped: false }));
  win.add(glass);
  const wf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  win.add(beam(V(-0.42, -0.62, 0.01), V(-0.42, 0.62, 0.01), 0.06, 0.04, wf));
  win.add(beam(V(0.42, -0.62, 0.01), V(0.42, 0.62, 0.01), 0.06, 0.04, wf));
  win.add(beam(V(-0.45, 0.62, 0.01), V(0.45, 0.62, 0.01), 0.06, 0.04, wf));
  win.add(beam(V(-0.45, -0.62, 0.01), V(0.45, -0.62, 0.01), 0.06, 0.04, wf));
  win.add(beam(V(0, -0.6, 0.01), V(0, 0.6, 0.01), 0.03, 0.03, wf));
  win.add(beam(V(-0.4, 0, 0.01), V(0.4, 0, 0.01), 0.03, 0.03, wf));
  return win;
}

/** Wall candle sconce with a warm point light (origin = wall plate). */
function sconce() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.03), trimMat());
  g.add(plate);
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xfff6e0 }));
  candle.position.set(0, 0.1, 0.08);
  g.add(candle);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffc04d }));
  flame.position.set(0, 0.18, 0.08);
  g.add(flame);
  const halo = glowHalo(0xffb45e, 0.35, 0.55);
  halo.position.copy(flame.position);
  g.add(halo);
  // Point lights are evaluated per pixel in every standard material (Quest):
  // the flame + halo carry the look, the real light is ultra-only.
  if (lookQuality() === "ultra") {
    const light = new THREE.PointLight(0xffb45e, 1.4, 5, 1.5);
    light.position.set(0, 0.25, 0.23);
    g.add(light);
  }
  return g;
}

function banner(color: number) {
  return () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1.0), new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide })));
    return g;
  };
}

/** Round side table, top surface at y = 0.8. */
function sideTable() {
  const table = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x9b6a3c, roughness: 0.6 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 32), wood);
  top.position.y = 0.78;
  table.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.76, 16), wood);
  leg.position.y = 0.38;
  table.add(leg);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 24), wood);
  foot.position.y = 0.015;
  table.add(foot);
  return table;
}

// ── Interactive singletons ──────────────────────────────────────────────────

/** Live colour grade of the Orbis painting (read by its shader every frame;
 *  no Orbis command, no credit). Set through applyPaintGrade(). */
export const paintingGrade = {
  saturation: { value: PAINTING_SATURATION },
  brightness: { value: 1 },
  contrast: { value: 1 },
  warmth: { value: 0 },
  tint: { value: 0 },
  gamma: { value: 1 },
};

/** Painting "magic" effect while Orbis catches up with a new cue (#9):
 *  0 = still, 1 = full shimmer. Eased every frame by the scene. */
export const paintingFx = {
  shimmer: { value: 0 },
  time: { value: 0 },
};

export function applyPaintGrade(g: { saturation: number; brightness: number; contrast: number; warmth: number; tint: number; gamma: number }) {
  paintingGrade.saturation.value = g.saturation;
  paintingGrade.brightness.value = g.brightness;
  paintingGrade.contrast.value = g.contrast;
  paintingGrade.warmth.value = g.warmth;
  paintingGrade.tint.value = g.tint;
  paintingGrade.gamma.value = g.gamma;
}

export const PAINT_W = 2.4;
export const PAINT_H = 1.35;

/** Gold-framed painting; origin = centre of the picture, facing +Z. */
export function buildPainting() {
  const group = new THREE.Group();
  // Phase B: ornate gold frame (liner, bevel, rosettes, scrolls, gem crest).
  group.add(ornateFrame(PAINT_W, PAINT_H));
  const placeholder = makeCanvasTex(832, 468);
  const paintMat = new THREE.MeshBasicMaterial({ map: placeholder.tex, toneMapped: false });
  // Display-side colour grade (saturation), shared uniform — see paintingGrade.
  paintMat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintSaturation = paintingGrade.saturation;
    shader.uniforms.uPaintBrightness = paintingGrade.brightness;
    shader.uniforms.uPaintContrast = paintingGrade.contrast;
    shader.uniforms.uPaintWarmth = paintingGrade.warmth;
    shader.uniforms.uPaintTint = paintingGrade.tint;
    shader.uniforms.uPaintGamma = paintingGrade.gamma;
    shader.uniforms.uShimmer = paintingFx.shimmer;
    shader.uniforms.uFxTime = paintingFx.time;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        [
          "uniform float uPaintSaturation;",
          "uniform float uPaintBrightness;",
          "uniform float uPaintContrast;",
          "uniform float uPaintWarmth;",
          "uniform float uPaintTint;",
          "uniform float uPaintGamma;",
          "uniform float uShimmer;",
          "uniform float uFxTime;",
          "float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
          "void main() {",
        ].join("\n"),
      )
      .replace(
        "#include <map_fragment>",
        [
          "#ifdef USE_MAP",
          // Liquid ripple on the canvas: the picture wobbles like paint
          // that is still wet while the new scene arrives.
          "  vec2 fxUv = vMapUv;",
          "  vec2 fxC = fxUv - 0.5;",
          "  float fxR = length(fxC * vec2(1.78, 1.0));",
          "  float fxWave = sin(fxR * 38.0 - uFxTime * 7.0) * 0.5 + 0.5;",
          "  fxUv += uShimmer * (0.0045 * vec2(sin(fxUv.y * 31.0 + uFxTime * 4.3), cos(fxUv.x * 27.0 + uFxTime * 3.7)) + normalize(fxC + 1e-4) * 0.004 * fxWave);",
          "  vec4 sampledDiffuseColor = texture2D( map, fxUv );",
          "  #ifdef DECODE_VIDEO_TEXTURE",
          "  sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );",
          "  #endif",
          "  diffuseColor *= sampledDiffuseColor;",
          "#endif",
          "  vec3 pc = max(diffuseColor.rgb, vec3(0.0));",
          "  pc = pow(pc, vec3(1.0 / uPaintGamma));",
          "  pc *= uPaintBrightness;",
          "  pc = (pc - 0.18) * uPaintContrast + 0.18;",
          "  pc += vec3(0.06 * uPaintWarmth, -0.04 * uPaintTint, -0.06 * uPaintWarmth);",
          "  pc.rb += vec2(0.02 * uPaintTint);",
          "  float paintLuma = dot(pc, vec3(0.2126, 0.7152, 0.0722));",
          "  diffuseColor.rgb = max(mix(vec3(paintLuma), pc, uPaintSaturation), vec3(0.0));",
          // Golden glints drifting upward + a soft glow sweeping the edges.
          "  vec2 fxCell = floor(vec2(vMapUv.x * 64.0, vMapUv.y * 36.0 - uFxTime * 3.0));",
          "  float fxSpark = step(0.985, fxHash(fxCell)) * (0.5 + 0.5 * sin(uFxTime * 9.0 + fxHash(fxCell + 3.1) * 6.28));",
          "  float fxEdge = smoothstep(0.40, 0.5, max(abs(vMapUv.x - 0.5), abs(vMapUv.y - 0.5)));",
          "  vec3 fxGold = vec3(1.0, 0.82, 0.45);",
          // Ripple and warm tint are multiplicative (dark frames stay dark);
          // only the edge glow and the glints add light.
          "  vec3 fxCol = diffuseColor.rgb * (0.94 + 0.16 * fxWave) * mix(vec3(1.0), fxGold * 1.2, 0.25);",
          "  fxCol += fxGold * (0.08 * fxEdge * (0.6 + 0.4 * sin(uFxTime * 3.0)) + 0.6 * fxSpark);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, fxCol, uShimmer);",
        ].join("\n"),
      );
  };
  const paintMesh = new THREE.Mesh(new THREE.PlaneGeometry(PAINT_W, PAINT_H), paintMat);
  paintMesh.position.z = 0.01;
  group.add(paintMesh);
  const hint = makeCanvasTex(1024, 96);
  const hintMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5 * (96 / 1024)), new THREE.MeshBasicMaterial({ map: hint.tex, toneMapped: false }));
  hintMesh.position.set(0, -PAINT_H / 2 - 0.54, 0.02); // below the frame and the silence crystal's hammer plaque
  group.add(hintMesh);
  const hud = makeCanvasTex(1024, 200);
  const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8 * (200 / 1024)), new THREE.MeshBasicMaterial({ map: hud.tex, toneMapped: false }));
  hudMesh.position.set(1.2, -1.02, 0.02); // below the frame, right of the hint plaque (octagon front wall ends at x = ±1.75)
  group.add(hudMesh);
  return { group, paintMat, placeholder, hint, hud };
}

export const EASEL_TILT = 0.21; // rad, canvas top leans away from the viewer

/** Wooden A-frame studio easel; origin on the floor between the front legs,
 *  facing +Z. Returns the tilted canvas mount (the DrawingBoard goes on it). */
export function buildEasel() {
  // Deliberately minimal for Quest: two untextured Lambert woods, plain
  // boxes, merged into one mesh per material at the end (2 draw calls).
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0xc07c34, name: "easel-wood" });
  const dark = new THREE.MeshLambertMaterial({ color: 0x8f5a26, name: "easel-dark" });
  group.add(beam(V(0, 0, 0.256), V(0, 2.05, -0.18), 0.055, 0.035, wood)); // mast
  group.add(beam(V(-0.42, 0, 0.2), V(-0.04, 1.7, -0.1), 0.04, 0.03, wood)); // front legs
  group.add(beam(V(0.42, 0, 0.2), V(0.04, 1.7, -0.1), 0.04, 0.03, wood));
  group.add(beam(V(0, 0, -0.75), V(0, 1.65, -0.11), 0.04, 0.03, dark)); // back leg
  group.add(beam(V(-0.33, 0.4, 0.13), V(0.33, 0.4, 0.13), 0.035, 0.03, dark)); // cross bar
  group.add(beam(V(0, 0.4, 0.13), V(0, 0.42, -0.6), 0.03, 0.025, dark)); // brace
  const mount = new THREE.Group();
  mount.position.set(0, 1.25, 0.02);
  mount.rotation.x = -EASEL_TILT;
  group.add(mount);
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.035, 0.11), wood);
  ledge.position.set(0, -BOARD_H / 2 - 0.02, 0.04);
  mount.add(ledge);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.03, 0.012), dark);
  lip.position.set(0, -BOARD_H / 2, 0.094);
  mount.add(lip);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), dark);
  clamp.position.set(0, BOARD_H / 2 + 0.02, -0.005);
  mount.add(clamp);
  const back = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.03, BOARD_H + 0.03, 0.022), dark);
  back.position.z = -0.012;
  mount.add(back);
  // A visible pen clip beside the canvas, above the tray and clear of drawing.
  const penPlate = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.035), dark);
  penPlate.position.set(BOARD_W / 2 + 0.055, 0.08, 0.025);
  mount.add(penPlate);
  const eraserPlate = new THREE.Mesh(new THREE.BoxGeometry(.14,.10,.025),dark);
  eraserPlate.position.set(-BOARD_W/2-.055,.08,.025);
  mount.add(eraserPlate);
  mergeByMaterial(group);
  return { group, mount };
}

/** Bake every mesh under `root` into one mesh per material in root's space
 *  (empty child groups such as the easel mount stay for later attachments). */
function mergeByMaterial(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const g = m.geometry.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld));
    (byMat.get(m.material) ?? byMat.set(m.material, []).get(m.material)!).push(g);
    meshes.push(m);
  });
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  for (const [material, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (merged) root.add(new THREE.Mesh(merged, material));
  }
}

export type PokeButton = { id: "reset" | "clear" | "hint"; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; base: THREE.Color; armed: boolean; flashUntil: number; tex: ReturnType<typeof makeCanvasTex> };

/** Stone pedestal with the RESET and HINT poke buttons (CLEAR removed: the
 *  easel eraser clears the canvas); origin on the floor. */
export function buildPedestal() {
  const group = new THREE.Group();
  const pl = plasterSet([1, 2]);
  const stone = new THREE.MeshStandardMaterial({ color: 0xeee6f3, roughness: 0.45, map: pl.map, normalMap: pl.normalMap, normalScale: new THREE.Vector2(0.2, 0.2) });
  // turned marble pedestal: plinth, fluted-looking shaft, gold collar
  const column = new THREE.Mesh(
    new THREE.LatheGeometry(
      [[0, 0], [0.16, 0], [0.16, 0.06], [0.13, 0.09], [0.12, 0.13], [0.09, 0.18], [0.085, 0.75], [0.11, 0.8], [0.12, 0.86], [0.14, 0.9], [0, 0.9]].map(([x, y]) => new THREE.Vector2(x, y)),
      24,
    ),
    stone,
  );
  group.add(column);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.012, 8, 32), goldMat());
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.2;
  group.add(collar);
  const capital = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.045, 0.26, 2, 0.012), goldMat());
  capital.position.y = 0.92;
  group.add(capital);
  const buttons: PokeButton[] = (["reset", "hint"] as const).map((id, k) => {
    const base = new THREE.Color(id === "reset" ? 0xc0392b : 0xc08b2b);
    const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.4 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 24), mat);
    mesh.position.set((k - 0.5) * 0.15, 0.955, 0);
    group.add(mesh);
    const tex = makeCanvasTex(256, 96);
    paint(tex, "#3a2a4a", [{ text: id.toUpperCase(), font: "bold 60px sans-serif", color: "#ffffff" }]);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.045), new THREE.MeshBasicMaterial({ map: tex.tex, toneMapped: false }));
    label.position.set((k - 0.5) * 0.15, 0.945, 0.135);
    label.rotation.x = -0.3;
    group.add(label);
    return { id, mesh, mat, base, armed: true, flashUntil: 0, tex };
  });
  return { group, buttons };
}

// ── Registry + default layout ───────────────────────────────────────────────

export type BuiltinKind =
  | "painting"
  | "easel"
  | "gramophone"
  | "pedestal"
  | "rug"
  | "canopy-bed"
  | "night-window"
  | "sconce"
  | "banner-blue"
  | "banner-pink"
  | "side-table"
  | FurnitureKind;

export const SINGLETONS: ReadonlyArray<BuiltinKind> = ["painting", "easel", "gramophone", "pedestal"];

// Phase B pieces (app/puzzle/lib/furniture.ts) come first in the editor
// palette; the original placeholder pieces stay available for old layouts.
const DECOR: Record<Exclude<BuiltinKind, "painting" | "easel" | "gramophone" | "pedestal">, () => THREE.Object3D> = {
  ...FURNITURE,
  rug,
  "canopy-bed": canopyBed,
  "night-window": nightWindow,
  sconce,
  "banner-blue": banner(0x5a7fd6),
  "banner-pink": banner(0xd65a8a),
  "side-table": sideTable,
};

export const DECOR_KINDS = Object.keys(DECOR) as BuiltinKind[];

export const builtinKind = (asset: string): BuiltinKind | null => {
  if (!asset.startsWith(BUILTIN)) return null;
  const k = asset.slice(BUILTIN.length) as BuiltinKind;
  return (SINGLETONS as string[]).includes(k) || k in DECOR ? k : null;
};

export const isSingletonAsset = (asset: string) => {
  const k = builtinKind(asset);
  return !!k && SINGLETONS.includes(k);
};

/** Decor pieces (runtime + editor). */
export function buildDecor(kind: BuiltinKind): THREE.Object3D | null {
  const f = (DECOR as Record<string, () => THREE.Object3D>)[kind];
  return f ? f() : null;
}

/** Editor preview of ANY builtin (singletons without their interaction logic). */
export function buildBuiltinPreview(asset: string): THREE.Object3D | null {
  const k = builtinKind(asset);
  if (!k) return null;
  switch (k) {
    case "painting": {
      const p = buildPainting();
      paint(p.placeholder, "#efe3c8", [
        { text: "Orbis painting (live video)", font: "italic bold 46px serif", color: "#5a3c1a" },
        { text: "the princess appears here", font: "32px serif", color: "#8a6a3a" },
      ]);
      paint(p.hint, "#6b4a1e", [{ text: "hint plaque", font: "italic 40px serif", color: "#fbe7b5" }]);
      paint(p.hud, "#0b0c10", [{ text: "debug HUD", font: "26px monospace", color: "#d8dbe6" }]);
      return p.group;
    }
    case "easel": {
      const e = buildEasel();
      const board = new DrawingBoard(BOARD_W, BOARD_H);
      board.update();
      e.mount.add(board.mesh);
      return e.group;
    }
    case "gramophone":
      return new Gramophone(() => undefined).group;
    case "pedestal":
      return buildPedestal().group;
    default:
      return buildDecor(k);
  }
}

const obj = (id: string, name: string, kind: BuiltinKind, position: [number, number, number], rotY = 0): SceneObject => ({
  id,
  name,
  asset: BUILTIN + kind,
  position,
  rotation: [0, rotY, 0],
  scale: [1, 1, 1],
});

/** Default room (fallback when data/scenes/puzzle.json is missing/empty).
 *  Octagonal chamber from the top-down layout study (app/puzzle/roomLayout.ts,
 *  which also holds the gameplay prop placements). Mirrors
 *  data/scenes/puzzle.json (scripts/write-puzzle-layout.cjs). */
export const DEFAULT_PUZZLE_LAYOUT: ReadonlyArray<SceneObject> = ROOM_LAYOUT.map((o) => ({
  ...obj(o.id, o.name, o.kind as BuiltinKind, o.position, o.rotY),
  ...(o.scale ? { scale: o.scale } : {}),
}));

/** Saved puzzle scene → usable layout: an empty/missing file gives the
 *  default room; each singleton exists exactly once (missing → default,
 *  extra copies dropped); unknown builtins are dropped. */
export function normalizePuzzleScene(doc: SceneDoc): SceneObject[] {
  if (doc.objects.length === 0) return withDefaultPuzzles(DEFAULT_PUZZLE_LAYOUT.map((o) => ({ ...o })));
  return withDefaultPuzzles(normalizePieces(doc));
}

/** Default puzzle components (the original two puzzles), added once: a layout
 *  whose painting has no `painting` component predates components. After
 *  that the editor owns them (a removed puzzle stays removed). */
export function withDefaultPuzzles(list: SceneObject[]): SceneObject[] {
  const painting = list.find((o) => o.asset === BUILTIN + "painting");
  if (!painting || painting.painting) return list;
  return list.map((o) => {
    const k = builtinKind(o.asset);
    if (k === "painting") return { ...o, painting: { startInstruction: PUZZLE_ACTIONS.urging, audioPrompt: PUZZLE_AUDIO_PROMPTS.urging } };
    if (k === "gramophone" && !o.puzzle)
      return {
        ...o,
        puzzle: { id: "sound-on", trigger: "needle", requires: null, instruction: "", audioPrompt: "", sound: "", hint: "The princess is calling out… but you hear nothing." },
      };
    if (k === "easel" && !o.puzzle)
      return {
        ...o,
        puzzle: {
          id: "sword",
          trigger: "draw-sword",
          requires: "sound-on",
          instruction: PUZZLE_ACTIONS.happy,
          audioPrompt: PUZZLE_AUDIO_PROMPTS.happy,
          sound: "puzzle-solved",
          hint: "“Draw your sword!”",
        },
      };
    return o;
  });
}

function normalizePieces(doc: SceneDoc): SceneObject[] {
  const seen = new Set<string>();
  const out: SceneObject[] = [];
  for (const o of doc.objects) {
    if (o.asset.startsWith(BUILTIN)) {
      const k = builtinKind(o.asset);
      if (!k) continue;
      if (SINGLETONS.includes(k)) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
    }
    out.push(o);
  }
  for (const k of SINGLETONS) {
    if (!seen.has(k)) {
      const d = DEFAULT_PUZZLE_LAYOUT.find((o) => o.asset === BUILTIN + k)!;
      out.push({ ...d });
    }
  }
  return out;
}
