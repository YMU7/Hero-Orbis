"use client";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mat } from "./furniture";
import { glowHalo, lookQuality } from "./lookdev";
import { fabricSet, woodGrainSet } from "./proceduralTextures";
import type { UnityRoom } from "./unityRoom";

// Look-dev pass: higher-fidelity models for the grabbable rescue props.
//
// The gameplay files (unityRoom.ts / rescueRoom.ts) build simple box props
// and own all behaviour. This module only re-dresses those objects after
// construction: it swaps their lit body meshes for sculpted ones with the
// SAME footprint, pivot and key points (hammer head at z −0.31, sword blades
// along −Z, key bow at +Y, camera lens toward −Z), and leaves every other
// child alone (grab highlight, camera flash disc/light, fireball light).

const HQ = () => lookQuality() !== "low";

let M: Record<string, THREE.Material> | null = null;
function mats() {
  if (M) return M;
  const grain = woodGrainSet();
  const cloth = fabricSet();
  M = {
    gold: mat("gold"),
    gem: mat("gem"),
    steel: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: HQ() ? 0.95 : 0.6, roughness: 0.22, name: "steel" }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x9aa6b4, metalness: HQ() ? 0.9 : 0.5, roughness: 0.35, name: "steel-dark" }),
    royalSteel: new THREE.MeshStandardMaterial({ color: 0xd8f2ff, metalness: HQ() ? 0.95 : 0.6, roughness: 0.12, emissive: 0x2a5f80, emissiveIntensity: 0.25, name: "royal-steel" }),
    royalCore: new THREE.MeshStandardMaterial({ color: 0x8fe4ff, emissive: 0x2aa8ff, emissiveIntensity: 2.2, roughness: 0.2, name: "royal-core" }),
    wood: new THREE.MeshStandardMaterial({ color: 0xa8682c, roughness: 0.55, map: grain.map, normalMap: grain.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), name: "prop-wood" }),
    woodLight: new THREE.MeshStandardMaterial({ color: 0xcf9a5a, roughness: 0.55, map: grain.map, normalMap: grain.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), name: "prop-wood-light" }),
    leather: new THREE.MeshStandardMaterial({ color: 0x5b3524, roughness: 0.7, map: cloth.map, normalMap: cloth.normalMap, name: "leather" }),
    navy: new THREE.MeshStandardMaterial({ color: 0x2c4a86, roughness: 0.6, map: cloth.map, normalMap: cloth.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), name: "camera-leather" }),
    blueGrip: new THREE.MeshStandardMaterial({ color: 0x2d4f9a, roughness: 0.65, map: cloth.map, normalMap: cloth.normalMap, name: "royal-grip" }),
    lensGlass: new THREE.MeshStandardMaterial({ color: 0x1b2c55, metalness: 0.9, roughness: 0.05, emissive: 0x0c1838, emissiveIntensity: 0.4, name: "lens-glass" }),
    velvet: new THREE.MeshStandardMaterial({ color: 0x9a86d6, roughness: 0.95, map: cloth.map, normalMap: cloth.normalMap, name: "velvet" }),
    paper: new THREE.MeshStandardMaterial({ color: 0xfff6e2, roughness: 0.85, name: "photo-paper" }),
    flameOuter: new THREE.MeshStandardMaterial({ color: 0xffb13b, emissive: 0xff5a10, emissiveIntensity: 2.4, roughness: 0.6, flatShading: true, name: "flame-outer" }),
    flameCore: new THREE.MeshBasicMaterial({ color: 0xfff1b0, toneMapped: false, name: "flame-core" }),
    flameOuterFlat: new THREE.MeshBasicMaterial({ color: 0xff8a24, toneMapped: false, name: "flame-outer-flat" }),
  };
  return M;
}

type V3 = [number, number, number];
function part(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...p);
  mesh.rotation.set(...r);
  mesh.scale.set(...s);
  mesh.name = "prop-detail";
  g.add(mesh);
  return mesh;
}
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
/** Cylinder whose axis runs along local Z. */
const zcyl = (rt: number, rb: number, len: number, seg = 16) => new THREE.CylinderGeometry(rt, rb, len, seg).rotateX(Math.PI / 2);

/** Remove the lit (MeshStandard) body meshes of a prop, keep everything else. */
function strip(o: THREE.Object3D) {
  for (const c of [...o.children]) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.name === "grab-highlight") continue;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => (x as THREE.MeshStandardMaterial).isMeshStandardMaterial)) {
      m.removeFromParent();
      m.geometry.dispose();
    }
  }
}

// ── Builders ────────────────────────────────────────────────────────────────

function dressHammer(h: THREE.Object3D) {
  const m = mats();
  strip(h);
  // turned wooden handle, leather grip at the butt, gold collar under the head
  part(h, zcyl(0.016, 0.019, 0.3, 16), m.woodLight, [0, 0, -0.12]);
  part(h, zcyl(0.021, 0.021, 0.1, 16), m.leather, [0, 0, -0.0]);
  for (let i = 0; i < 5; i++) part(h, new THREE.TorusGeometry(0.0215, 0.0035, 6, 18), m.leather, [0, 0, 0.04 - i * 0.02]);
  part(h, new THREE.SphereGeometry(0.024, 14, 10), m.gold, [0, 0, 0.055], [0, 0, 0], [1, 1, 0.7]);
  part(h, zcyl(0.022, 0.018, 0.03, 16), m.gold, [0, 0, -0.255]);
  // steel head: rounded body + two flared striking faces + gold band
  part(h, rbox(0.12, 0.085, 0.085, 0.018), m.steelDark, [0, 0, -0.31]);
  for (const sx of [-1, 1]) {
    part(h, new THREE.CylinderGeometry(0.046, 0.042, 0.04, 20).rotateZ(Math.PI / 2), m.steel, [sx * 0.078, 0, -0.31]);
    part(h, new THREE.CylinderGeometry(0.049, 0.049, 0.008, 20).rotateZ(Math.PI / 2), m.steel, [sx * 0.098, 0, -0.31]);
  }
  part(h, rbox(0.03, 0.092, 0.092, 0.01), m.gold, [0, 0, -0.31]);
}

function bladeGeometry(len: number, width: number, thick: number) {
  const bs = width * 0.32;
  const hw = width / 2 - bs;
  const taper = width * 1.7;
  const s = new THREE.Shape();
  s.moveTo(-hw, 0);
  s.lineTo(hw, 0);
  s.lineTo(hw * 0.92, len - taper);
  s.lineTo(0, len - bs * 0.6);
  s.lineTo(-hw * 0.92, len - taper);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 1.4, bevelSize: bs, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2); // shape +Y → −Z (along the blade), extrusion → ±Y (thickness)
  g.computeVertexNormals();
  return g;
}

function dressSword(sw: THREE.Object3D, royal: boolean) {
  const m = mats();
  strip(sw);
  const start = -0.15;
  const len = royal ? 0.71 : 0.49;
  const width = royal ? 0.07 : 0.046;
  part(sw, bladeGeometry(len, width, 0.004), royal ? m.royalSteel : m.steel, [0, 0, start]);
  // fuller groove / glowing core. The royal core stands ≥ 2.5 mm proud of
  // the blade (~15 mm thick incl. bevels): 0.4 mm z-fought (flickered) in VR.
  if (royal) part(sw, rbox(0.014, 0.021, len * 0.78, 0.006), m.royalCore, [0, 0, start - len * 0.42]);
  else part(sw, rbox(0.01, 0.0105, len * 0.7, 0.004), m.steelDark, [0, 0, start - len * 0.38]);
  // cross-guard
  const gw = royal ? 0.24 : 0.2;
  part(sw, rbox(gw, 0.026, 0.034, 0.012), m.gold, [0, 0, -0.14]);
  for (const sx of [-1, 1]) {
    part(sw, new THREE.SphereGeometry(0.022, 14, 10), m.gold, [sx * gw * 0.5, 0, -0.14 - 0.008]);
    if (royal) part(sw, new THREE.TorusGeometry(0.03, 0.007, 6, 16, Math.PI * 1.2), m.gold, [sx * 0.07, 0, -0.165], [Math.PI / 2, 0, sx > 0 ? -0.3 : Math.PI + 0.3]);
  }
  // wrapped grip + pommel
  part(sw, zcyl(0.016, 0.018, 0.15, 14), royal ? m.blueGrip : m.leather, [0, 0, -0.045]);
  for (let i = 0; i < 6; i++) part(sw, new THREE.TorusGeometry(0.0175, 0.003, 6, 16), royal ? m.gold : m.leather, [0, 0, -0.105 + i * 0.024]);
  part(sw, zcyl(0.02, 0.02, 0.012, 16), m.gold, [0, 0, 0.032]);
  part(sw, new THREE.SphereGeometry(royal ? 0.03 : 0.025, 16, 12), m.gold, [0, 0, 0.055]);
  if (royal) {
    for (const x of [-0.08, 0, 0.08]) part(sw, new THREE.OctahedronGeometry(0.02), m.gem, [x, 0.022, -0.14], [0, 0, 0], [1, 0.7, 1]);
    part(sw, new THREE.OctahedronGeometry(0.018), m.gem, [0, 0, 0.055], [0, 0, 0], [1, 1, 1]);
    const halo = glowHalo(0x7fd6ff, 0.35, 0.35);
    halo.position.set(0, 0, start - len * 0.5);
    halo.scale.set(0.25, 0.25, 1);
    sw.add(halo);
  }
}

function keyModel(): THREE.Group {
  const m = mats();
  const k = new THREE.Group();
  // ornate bow: outer ring, quatrefoil inside, centre gem
  part(k, new THREE.TorusGeometry(0.05, 0.012, 10, 32), m.gold, [0, 0.07, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    part(k, new THREE.TorusGeometry(0.017, 0.005, 6, 16), m.gold, [Math.cos(a) * 0.02, 0.07 + Math.sin(a) * 0.02, 0]);
  }
  part(k, new THREE.OctahedronGeometry(0.014), m.gem, [0, 0.07, 0], [0, 0, 0], [1, 1, 0.6]);
  // collar + shaft + tip
  part(k, new THREE.CylinderGeometry(0.016, 0.016, 0.012, 14), m.gold, [0, 0.014, 0]);
  part(k, new THREE.CylinderGeometry(0.019, 0.014, 0.008, 14), m.gold, [0, 0.003, 0]);
  part(k, new THREE.CylinderGeometry(0.0105, 0.0105, 0.12, 12), m.gold, [0, -0.055, 0]);
  part(k, new THREE.SphereGeometry(0.012, 10, 8), m.gold, [0, -0.115, 0]);
  // bit with two teeth
  part(k, rbox(0.05, 0.03, 0.016, 0.004), m.gold, [0.03, -0.09, 0]);
  part(k, rbox(0.012, 0.018, 0.016, 0.003), m.gold, [0.05, -0.068, 0]);
  part(k, rbox(0.012, 0.012, 0.016, 0.003), m.gold, [0.032, -0.11, 0]);
  return k;
}

function dressKey(key: THREE.Object3D) {
  strip(key);
  const model = keyModel();
  for (const c of [...model.children]) key.add(c);
}

function photoTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const bg = ctx.createRadialGradient(128, 110, 10, 128, 128, 180);
  bg.addColorStop(0, "#cfe3f7");
  bg.addColorStop(1, "#6f8fc8");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);
  // soft velvet cushion
  ctx.fillStyle = "#9a86d6";
  ctx.beginPath();
  ctx.ellipse(128, 200, 92, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  // golden key, drawn diagonally with a glow
  ctx.save();
  ctx.translate(128, 120);
  ctx.rotate(-0.6);
  ctx.shadowColor = "rgba(255,230,150,0.9)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "#f2c454";
  ctx.fillStyle = "#f2c454";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(-58, 0, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillRect(-32, -6, 104, 12);
  ctx.fillRect(48, 6, 12, 22);
  ctx.fillRect(66, 6, 10, 15);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#3f6fe0";
  ctx.beginPath();
  ctx.arc(-58, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // sparkles + slight vignette
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const [x, y, r] of [[60, 60, 4], [196, 76, 3], [176, 168, 3.5], [84, 176, 2.5]]) {
    ctx.beginPath();
    ctx.moveTo(x - r * 2, y);
    ctx.lineTo(x, y - r * 0.4);
    ctx.lineTo(x + r * 2, y);
    ctx.lineTo(x, y + r * 0.4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2);
    ctx.lineTo(x + r * 0.4, y);
    ctx.lineTo(x, y + r * 2);
    ctx.lineTo(x - r * 0.4, y);
    ctx.fill();
  }
  const vig = ctx.createRadialGradient(128, 128, 90, 128, 128, 190);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(30,20,60,0.35)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dressPhoto(photo: THREE.Object3D) {
  const m = mats();
  for (const c of [...photo.children]) {
    // also drop the cloned miniature keys (groups of lit meshes)
    if ((c as THREE.Group).isGroup && c.name !== "grab-highlight") {
      c.removeFromParent();
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }
  strip(photo);
  part(photo, rbox(0.25, 0.3, 0.012, 0.006), m.paper);
  const pic = new THREE.MeshStandardMaterial({ map: photoTexture(), roughness: 0.35, name: "photo-print" });
  for (const side of [1, -1]) part(photo, new THREE.PlaneGeometry(0.21, 0.21), pic, [0, 0.025, side * 0.0065], [0, side > 0 ? 0 : Math.PI, 0]);
}

function dressCamera(cam: THREE.Object3D) {
  const m = mats();
  strip(cam);
  // body: navy leatherette over a rounded box, gold corner caps + top plate
  part(cam, rbox(0.22, 0.15, 0.12, 0.022), m.navy);
  part(cam, rbox(0.224, 0.02, 0.124, 0.008), m.gold, [0, 0.067, 0]);
  part(cam, rbox(0.224, 0.014, 0.124, 0.006), m.gold, [0, -0.07, 0]);
  // viewfinder + shutter button
  part(cam, rbox(0.06, 0.035, 0.05, 0.008), m.navy, [-0.05, 0.092, 0.01]);
  part(cam, rbox(0.04, 0.022, 0.006, 0.003), m.lensGlass, [-0.05, 0.092, 0.037]);
  part(cam, new THREE.CylinderGeometry(0.014, 0.016, 0.02, 16), m.gold, [0.07, 0.085, 0]);
  part(cam, new THREE.CylinderGeometry(0.01, 0.01, 0.01, 16), m.gem, [0.07, 0.098, 0]);
  // stepped brass lens barrel with glass (flash disc sits just in front)
  part(cam, zcyl(0.07, 0.07, 0.02, 28), m.gold, [0, 0, -0.07]);
  part(cam, zcyl(0.06, 0.064, 0.05, 28), m.steelDark, [0, 0, -0.1]);
  part(cam, zcyl(0.067, 0.067, 0.014, 28), m.gold, [0, 0, -0.13]);
  part(cam, new THREE.TorusGeometry(0.058, 0.006, 8, 28), m.gold, [0, 0, -0.142]);
  part(cam, new THREE.CircleGeometry(0.054, 28).rotateY(Math.PI), m.lensGlass, [0, 0, -0.143]);
  // rounded wooden handle
  part(cam, rbox(0.068, 0.18, 0.068, 0.026), m.wood, [0.04, -0.12, 0.015]);
  part(cam, new THREE.TorusGeometry(0.036, 0.005, 6, 20), m.gold, [0.04, -0.035, 0.015], [Math.PI / 2, 0, 0]);
}

function dressFire(fire: THREE.Object3D) {
  const m = mats();
  strip(fire);
  // Deliberately minimal for Quest: two low-poly unlit spheres (outer flame +
  // bright core). No lit/emissive shell, no additive halo sprite near the face.
  part(fire, new THREE.IcosahedronGeometry(0.1, 1), m.flameOuterFlat, [0, 0, 0], [0, 0, 0], [1, 1.25, 1]);
  part(fire, new THREE.IcosahedronGeometry(0.055, 1), m.flameCore, [0, -0.01, 0]);
}

function dressRack(rack: THREE.Object3D) {
  const m = mats();
  strip(rack);
  part(rack, rbox(0.72, 0.64, 0.05, 0.02), m.wood, [0, 0.05, 0]);
  // gold beading frame
  part(rack, rbox(0.7, 0.018, 0.012, 0.005), m.gold, [0, 0.355, 0.028]);
  part(rack, rbox(0.7, 0.018, 0.012, 0.005), m.gold, [0, -0.255, 0.028]);
  for (const x of [-0.35, 0.35]) part(rack, rbox(0.018, 0.6, 0.012, 0.005), m.gold, [x, 0.05, 0.028]);
  // carved crest
  part(rack, new THREE.TorusGeometry(0.09, 0.014, 8, 24, Math.PI), m.gold, [0, 0.37, 0.02]);
  part(rack, new THREE.SphereGeometry(0.028, 14, 10), m.gem, [0, 0.43, 0.025], [0, 0, 0], [1, 1, 0.6]);
  // turned pegs with ball ends
  for (const x of [-0.17, 0.18]) {
    part(rack, zcyl(0.014, 0.018, 0.18, 14), m.gold, [x, -0.1, 0.11]);
    part(rack, new THREE.SphereGeometry(0.025, 14, 10), m.gold, [x, -0.1, 0.2]);
    part(rack, zcyl(0.032, 0.032, 0.012, 18), m.gold, [x, -0.1, 0.03]);
  }
}

function dressGlass(glass: THREE.Object3D) {
  const m = mats();
  for (const c of [...glass.children]) {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) continue;
    const sm = mesh.material as THREE.MeshStandardMaterial;
    if (sm.transparent) {
      // crystal panes: glossy, faint tint, real reflections
      sm.roughness = 0.04;
      sm.metalness = 0.25;
      sm.opacity = 0.2;
      sm.color.setHex(0xd4f0ff);
      sm.envMapIntensity = 1.6;
      sm.depthWrite = false;
      mesh.renderOrder = 1;
    } else {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
  }
  // gold frame: top/bottom plates + corner posts with finials
  for (const y of [-0.21, 0.21]) part(glass, rbox(0.52, 0.03, 0.44, 0.01), m.gold, [0, y, 0]);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      part(glass, new THREE.CylinderGeometry(0.012, 0.012, 0.4, 10), m.gold, [sx * 0.245, 0, sz * 0.205]);
      part(glass, new THREE.SphereGeometry(0.022, 12, 10), m.gold, [sx * 0.25, 0.235, sz * 0.21]);
    }
  part(glass, new THREE.OctahedronGeometry(0.03), m.gem, [0, 0.25, 0], [0, 0, 0], [1, 1.3, 1]);
  // velvet cushion the key rests on
  part(glass, rbox(0.22, 0.05, 0.18, 0.024), m.velvet, [0, -0.17, 0]);
}

/** Quest budget: merge a prop's detail parts into one mesh per material
 *  (each separate mesh costs a draw call per eye in VR). */
function mergeDetails(o: THREE.Object3D) {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const c of [...o.children]) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.name !== "prop-detail") continue;
    m.updateMatrix();
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const n of Object.keys(g.attributes)) if (n !== "position" && n !== "normal" && n !== "uv") g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    g = g.applyMatrix4(m.matrix);
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
    m.removeFromParent();
    m.geometry.dispose();
  }
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `prop:${mat.name || mat.type}`;
    o.add(mesh);
  }
}

/** Re-dress the rescue props with detailed models (same pivots/footprints). */
export function dressProps(unity: UnityRoom) {
  dressAll(unity);
  for (const n of ["hammer", "wall-sword", "royal-sword", "tool-rack", "golden-key", "camera", "magic-fireball", "key-photograph"]) {
    const o = unity.group.getObjectByName(n);
    if (o) mergeDetails(o);
  }
  if (unity.rescue.glass) mergeDetails(unity.rescue.glass);
}

function dressAll(unity: UnityRoom) {
  const byName = (n: string) => unity.group.getObjectByName(n);
  const h = byName("hammer");
  if (h) dressHammer(h);
  const ws = byName("wall-sword");
  if (ws) dressSword(ws, false);
  // royal-sword stays the minimal model from unityRoom (Quest perf).
  const rack = byName("tool-rack");
  if (rack) dressRack(rack);
  const key = byName("golden-key");
  if (key) dressKey(key);
  const cam = byName("camera");
  if (cam) dressCamera(cam);
  const fire = byName("magic-fireball");
  if (fire) dressFire(fire);
  const photo = byName("key-photograph");
  if (photo) dressPhoto(photo);
  if (unity.rescue.glass) dressGlass(unity.rescue.glass);
}
