"use client";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mat } from "./furniture";
import { glowHalo, lookQuality, lookUniforms } from "./lookdev";
import { fabricSet, woodGrainSet } from "./proceduralTextures";
import type { UnityRoom } from "./unityRoom";
import { RESCUE_LAYOUT } from "../roomLayout";
import { dressCurse } from "./curseVisuals";

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
    // art pass: portrait box, rack and display swords
    lilacPaint: new THREE.MeshStandardMaterial({ color: 0xc8b8ee, roughness: 0.6, name: "lilac-paint" }),
    crystal: new THREE.MeshStandardMaterial({ color: 0xd6c8ff, emissive: 0x6c52c8, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.12, flatShading: true, name: "crystal" }),
    buttonBlue: new THREE.MeshStandardMaterial({ color: 0x9fb2ec, roughness: 0.4, name: "button-blue" }),
    slot: new THREE.MeshStandardMaterial({ color: 0x4a3c5e, roughness: 0.9, name: "slot" }),
    pinkGrip: new THREE.MeshStandardMaterial({ color: 0xf2b8cf, roughness: 0.7, name: "pink-grip" }),
    violetGrip: new THREE.MeshStandardMaterial({ color: 0x7d64b8, roughness: 0.7, name: "violet-grip" }),
    lilacSteel: new THREE.MeshStandardMaterial({ color: 0xe4dcf6, metalness: HQ() ? 0.85 : 0.5, roughness: 0.22, name: "lilac-steel" }),
    roseGold: new THREE.MeshStandardMaterial({ color: 0xf0b8a8, metalness: HQ() ? 0.85 : 0.5, roughness: 0.25, emissive: 0x3a1a14, emissiveIntensity: 0.2, name: "rose-gold" }),
    ribbon: new THREE.MeshStandardMaterial({ color: 0xc3a6ee, roughness: 0.8, side: THREE.DoubleSide, name: "ribbon" }),
    pinkGem: new THREE.MeshStandardMaterial({ color: 0xf2a6c8, emissive: 0x8a3a64, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.1, flatShading: true, name: "pink-gem" }),
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
  if (!royal) {
    // Art pass round 2: the grabbable decoy is sword #1 of the rack set.
    SWORD_DESIGNS[0](sw);
    return;
  }
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

// ── Portrait card (the "photo" the box prints) ──────────────────────────────
// Ivory card, lavender floral border, double gold frame, the golden key on a
// soft lavender ground (matches the Magic Portrait Box reference sheet).
function portraitCardTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fbf4e6";
  ctx.fillRect(0, 0, 256, 320);
  // gold double frame
  ctx.strokeStyle = "#d9b15c";
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 236, 300);
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, 216, 280);
  // picture area with an arched top
  const g = ctx.createLinearGradient(0, 40, 0, 270);
  g.addColorStop(0, "#efe6fb");
  g.addColorStop(1, "#d9ccf2");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(40, 270);
  ctx.lineTo(40, 110);
  ctx.arc(128, 110, 88, Math.PI, 0);
  ctx.lineTo(216, 270);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#c9b0e6";
  ctx.lineWidth = 3;
  ctx.stroke();
  // lavender flower sprigs in the four corners
  const sprig = (x: number, y: number, s: number) => {
    ctx.fillStyle = "#9fbf86";
    ctx.beginPath();
    ctx.ellipse(x + 9 * s, y + 4, 9, 4, 0.6 * s, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? "#b49ae6" : "#cdb8f2";
      ctx.beginPath();
      ctx.arc(x - i * 3 * s, y - i * 6, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  sprig(34, 300, 1);
  sprig(222, 300, -1);
  sprig(34, 46, 1);
  sprig(222, 46, -1);
  // golden key (bow with gem, shaft, two teeth) with a soft glow
  ctx.save();
  ctx.translate(128, 165);
  ctx.shadowColor = "rgba(255,226,150,0.95)";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = "#e9b949";
  ctx.fillStyle = "#e9b949";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, -58, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillRect(-6, -34, 12, 108);
  ctx.fillRect(6, 44, 22, 10);
  ctx.fillRect(6, 62, 16, 10);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#b79af0";
  ctx.beginPath();
  ctx.arc(0, -58, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // sparkles
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  for (const [x, y, r] of [[70, 92, 4], [190, 120, 3], [178, 232, 3.5], [78, 214, 2.5]]) {
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
  // Same 0.25 x 0.30 m footprint and collider as before; the printed face
  // now covers the whole card on both sides.
  part(photo, rbox(0.25, 0.3, 0.012, 0.006), m.paper);
  const pic = new THREE.MeshStandardMaterial({ map: portraitCardTexture(), roughness: 0.6, name: "portrait-card" });
  for (const side of [1, -1]) part(photo, new THREE.PlaneGeometry(0.244, 0.294), pic, [0, 0, side * 0.0065], [0, side > 0 ? 0 : Math.PI, 0]);
}

// ── Magic camera (the hand-held capture tool) ───────────────────────────────
// Art pass round 2b, on request: back to a camera (the Portrait Box read as a
// printer). A small fairytale box camera in the room palette: ivory body,
// lavender leather band, gold plates, a stepped gold lens barrel with a
// crystal glass, a viewfinder, a crystal flash bulb, a shutter button and a
// star emblem. Same pivot (body centre), same collider (fits inside the
// 0.26 x 0.30 x 0.24 m box), lens toward -Z (the shutter ray and the flash
// disc at z -0.152 are unchanged). It still prints the portrait card.
function dressCamera(cam: THREE.Object3D) {
  const m = mats();
  strip(cam);
  const ivory = mat("ivory");
  // body, leather band, gold top and bottom plates
  part(cam, rbox(0.2, 0.13, 0.1, 0.022), ivory, [0, 0, 0.01]);
  part(cam, rbox(0.204, 0.066, 0.104, 0.012), m.lilacPaint, [0, -0.012, 0.01]);
  for (const y of [-0.066, 0.066]) part(cam, rbox(0.206, 0.012, 0.106, 0.005), m.gold, [0, y, 0.01]);
  // stepped lens barrel: gold mount, lavender ribbed barrel, gold front ring, crystal glass
  part(cam, zcyl(0.052, 0.054, 0.016, 28), m.gold, [0.012, -0.004, -0.046]);
  part(cam, zcyl(0.044, 0.046, 0.05, 28), m.lilacPaint, [0.012, -0.004, -0.078]);
  for (const z of [-0.064, -0.08, -0.096]) part(cam, new THREE.TorusGeometry(0.046, 0.0035, 6, 28), m.gold, [0.012, -0.004, z]);
  part(cam, zcyl(0.049, 0.049, 0.012, 28), m.gold, [0.012, -0.004, -0.108]);
  part(cam, new THREE.TorusGeometry(0.04, 0.005, 6, 28), m.gold, [0.012, -0.004, -0.115]);
  part(cam, new THREE.CircleGeometry(0.037, 28).rotateY(Math.PI), m.lensGlass, [0.012, -0.004, -0.116]);
  part(cam, new THREE.IcosahedronGeometry(0.014, 0), m.crystal, [0.012, -0.004, -0.115], [0, 0, 0], [1, 1, 0.4]);
  // viewfinder (top left) with a small glass window
  part(cam, rbox(0.052, 0.032, 0.05, 0.008), ivory, [-0.055, 0.086, 0.012]);
  part(cam, rbox(0.056, 0.006, 0.054, 0.003), m.gold, [-0.055, 0.1, 0.012]);
  part(cam, rbox(0.03, 0.016, 0.004, 0.002), m.lensGlass, [-0.055, 0.087, -0.015]);
  // crystal flash bulb on a gold cup (top right)
  part(cam, new THREE.CylinderGeometry(0.008, 0.008, 0.026, 10), m.gold, [0.06, 0.084, 0.02]);
  part(cam, new THREE.CylinderGeometry(0.024, 0.012, 0.014, 16), m.gold, [0.06, 0.1, 0.02]);
  part(cam, new THREE.OctahedronGeometry(0.02, 0), m.crystal, [0.06, 0.12, 0.02], [0, 0.4, 0], [1, 1.2, 1]);
  // shutter button + winding knob
  part(cam, new THREE.CylinderGeometry(0.012, 0.014, 0.012, 16), m.gold, [0.022, 0.078, 0.035]);
  part(cam, new THREE.CylinderGeometry(0.009, 0.009, 0.008, 16), m.buttonBlue, [0.022, 0.088, 0.035]);
  part(cam, new THREE.CylinderGeometry(0.016, 0.016, 0.01, 12), m.gold, [-0.01, 0.077, 0.04]);
  // star emblem on the front, strap lugs on the sides
  part(cam, new THREE.OctahedronGeometry(0.016, 0), m.gold, [-0.068, 0.03, -0.042], [0, 0, Math.PI / 4], [1, 1, 0.35]);
  for (const sx of [-1, 1]) part(cam, new THREE.TorusGeometry(0.012, 0.004, 6, 12), m.gold, [sx * 0.104, 0.045, 0.01], [0, Math.PI / 2, 0]);
  // little lavender flower sprig on the right side
  for (let i = 0; i < 4; i++) part(cam, new THREE.SphereGeometry(0.006, 6, 5), mat("flowerLilac"), [0.1035, -0.03 + i * 0.011, 0.03 - i * 0.006]);
}

// ── Magic fireball (art pass round 2b): a VFX flame, not a model ────────────
// One GPU particle system, one draw per eye: camera-facing soft quads that
// are born at the base, rise, pull together into a flame tip, cool from
// white-gold to orange to rose and fade out, in a loop. Additive blending
// gives the glow; a few large slow quads at the base make the hot core and
// a few tiny fast ones are embers. Everything moves in the vertex shader on
// the shared look clock, so the game loop does nothing. Same tool pivot,
// collider and emerge scaling as before (the object scale is applied).

const FIRE_FLAMES = 34;
const FIRE_CORE = 4;
const FIRE_EMBERS = 8;

let fireVfxMat: THREE.ShaderMaterial | null = null;
function fireVfxMaterial() {
  if (fireVfxMat) return fireVfxMat;
  fireVfxMat = new THREE.ShaderMaterial({
    name: "fire-vfx",
    uniforms: { uTime: lookUniforms.uTime },
    transparent: true,
    depthWrite: false,
    // Normal alpha blending: additive washed out to white on the pastel room.
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec2 aCorner;   // quad corner, -1..1
      attribute vec4 aSeed;     // phase, angle, radius, kind (0 flame, 1 core, 2 ember)
      varying vec2 vCorner;
      varying float vHeat;      // 1 = white-hot, 0 = cool tip
      varying float vFade;
      void main() {
        float kind = aSeed.w;
        float speed = kind < 0.5 ? 1.15 : (kind < 1.5 ? 0.5 : 0.7);
        float t = fract(uTime * speed + aSeed.x);
        float base = -0.09;
        vec3 c;
        float size;
        if (kind < 0.5) {
          // flame: born in a ring at the base, rises and converges to the tip
          float r = aSeed.z * (1.0 - t) * (1.0 - 0.4 * t);
          float wob = sin(uTime * 9.0 + aSeed.y * 3.0 + t * 6.0) * 0.012 * t;
          c = vec3(cos(aSeed.y) * r + wob, base + t * t * 0.08 + t * 0.22, sin(aSeed.y) * r);
          size = mix(0.07, 0.016, t);
          vHeat = 1.0 - 1.5 * t;
          vFade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t));
        } else if (kind < 1.5) {
          // core: big soft glow that breathes at the base
          c = vec3(cos(aSeed.y) * 0.012, base + 0.045 + sin(uTime * 5.0 + aSeed.x * 6.28) * 0.006, sin(aSeed.y) * 0.012);
          size = 0.075 + 0.01 * sin(uTime * 7.0 + aSeed.y);
          vHeat = 1.0;
          vFade = 0.45;
        } else {
          // embers: tiny sparks drifting high above the flame
          c = vec3(cos(aSeed.y) * aSeed.z * (0.4 + t) + sin(uTime * 3.0 + aSeed.y) * 0.015, base + 0.12 + t * 0.26, sin(aSeed.y) * aSeed.z * (0.4 + t));
          size = 0.016 * (1.0 - t);
          vHeat = 0.75;
          vFade = 1.0 - t;
        }
        float objScale = length(modelMatrix[0].xyz);
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += aCorner * size * objScale;
        vCorner = aCorner;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vCorner;
      varying float vHeat;
      varying float vFade;
      void main() {
        // soft teardrop-ish blob: a little taller than wide
        vec2 q = vCorner * vec2(1.0, 0.85);
        float d = length(q);
        float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.3) * vFade * 0.85;
        if (a < 0.003) discard;
        vec3 hot = vec3(1.0, 0.95, 0.75);
        vec3 gold = vec3(1.0, 0.72, 0.25);
        vec3 orange = vec3(1.0, 0.42, 0.12);
        vec3 rose = vec3(0.95, 0.25, 0.35);
        float h = clamp(vHeat, 0.0, 1.0);
        vec3 col = h > 0.66 ? mix(gold, hot, (h - 0.66) / 0.34) : (h > 0.33 ? mix(orange, gold, (h - 0.33) / 0.33) : mix(rose, orange, h / 0.33));
        gl_FragColor = vec4(col, a);
      }`,
  });
  return fireVfxMat;
}

function fireVfxGeometry() {
  const total = FIRE_FLAMES + FIRE_CORE + FIRE_EMBERS;
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  const pos = new Float32Array(total * 4 * 3); // centre is computed in the shader
  const corner = new Float32Array(total * 4 * 2);
  const seed = new Float32Array(total * 4 * 4);
  const index: number[] = [];
  for (let i = 0; i < total; i++) {
    const kind = i < FIRE_FLAMES ? 0 : i < FIRE_FLAMES + FIRE_CORE ? 1 : 2;
    const k = kind === 0 ? i : kind === 1 ? i - FIRE_FLAMES : i - FIRE_FLAMES - FIRE_CORE;
    const n = kind === 0 ? FIRE_FLAMES : kind === 1 ? FIRE_CORE : FIRE_EMBERS;
    const phase = (k / n + ((k * 0.618) % 1) * 0.37) % 1;
    const angle = k * 2.39996;
    const radius = kind === 0 ? 0.025 + ((k * 37) % 10) / 10 * 0.035 : 0.03 + ((k * 13) % 10) / 10 * 0.03;
    for (let v = 0; v < 4; v++) {
      corner.set([corners[v * 2], corners[v * 2 + 1]], (i * 4 + v) * 2);
      seed.set([phase, angle, radius, kind], (i * 4 + v) * 4);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  g.setIndex(index);
  // bounds for culling: the flame and embers stay inside this sphere
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.05, 0), 0.32);
  return g;
}

function dressFire(fire: THREE.Object3D) {
  strip(fire);
  const vfx = new THREE.Mesh(fireVfxGeometry(), fireVfxMaterial());
  vfx.name = "fire-vfx"; // not merged: keeps its particle attributes
  vfx.renderOrder = 3; // after the opaque room, so the glow adds on top
  vfx.raycast = () => {}; // grabbing uses the tool collider, not this mesh
  fire.add(vfx);
}

// ── Freestanding sword rack ─────────────────────────────────────────────────

/** A blade like bladeGeometry, bent sideways along its length (scimitar). */
function curvedBladeGeometry(len: number, width: number, thick: number, bend: number) {
  const g = bladeGeometry(len, width, thick);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, -p.getZ(i)) / len; // 0 at the guard, 1 at the tip
    p.setX(i, p.getX(i) + bend * t * t);
  }
  g.computeVertexNormals();
  return g;
}

/** A flat outline (x, y) extruded `depth` thick and laid in the sword's
 *  X / Z plane (shape +Y points toward the pommel, +Z), thickness along Y. */
function flatShape(shape: THREE.Shape, depth: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.3, bevelSize: depth * 0.3, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  g.rotateX(Math.PI / 2); // shape +Y -> +Z, extrusion -> Y
  return g;
}

function heartShape(s: number) {
  // point toward the blade (-Y in shape space = -Z on the sword)
  const h = new THREE.Shape();
  h.moveTo(0, -s);
  h.bezierCurveTo(s * 0.4, -s * 0.55, s * 1.05, -s * 0.15, s * 0.95, s * 0.35);
  h.bezierCurveTo(s * 0.85, s * 0.85, s * 0.2, s * 0.9, 0, s * 0.45);
  h.bezierCurveTo(-s * 0.2, s * 0.9, -s * 0.85, s * 0.85, -s * 0.95, s * 0.35);
  h.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.4, -s * 0.55, 0, -s);
  const hole = new THREE.Path();
  hole.absellipse(0, s * 0.05, s * 0.38, s * 0.3, 0, Math.PI * 2, false, 0);
  h.holes.push(hole);
  return h;
}

function starShape(r: number) {
  const st = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i) st.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else st.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return st;
}

/** Wrapped grip: core + raised wraps, from z0 (guard side) to z1 (pommel side). */
function wrappedGrip(g: THREE.Object3D, core: THREE.Material, wrap: THREE.Material, r: number, z0 = -0.12, z1 = 0.02) {
  const len = z1 - z0;
  part(g, zcyl(r, r * 1.08, len, 14), core, [0, 0, (z0 + z1) / 2]);
  const n = Math.round(len / 0.022);
  for (let i = 0; i < n; i++) part(g, new THREE.TorusGeometry(r + 0.0012, 0.0028, 5, 14), wrap, [0, 0, z0 + 0.012 + i * 0.022], [0, 0.35, 0]);
}

/** The five swords of the rack, built along -Z with the pommel at the origin
 *  (same frame as the grabbable sword: guard at z -0.14, blade from -0.15).
 *  All five are separate grabbable props in their rack slots. Blades
 *  stay <= 0.52 m so every tip rests in its slot. */
const SWORD_DESIGNS: Array<(g: THREE.Object3D) => void> = [
  // 1. slender long sword: curled gold quillons, pink wrapped grip, pink gem pommel
  (g) => {
    const m = mats();
    part(g, bladeGeometry(0.49, 0.044, 0.004), m.steel, [0, 0, -0.15]);
    part(g, rbox(0.008, 0.0105, 0.32, 0.003), m.gold, [0, 0, -0.33]); // gilded fuller
    part(g, rbox(0.12, 0.024, 0.032, 0.01), m.gold, [0, 0, -0.14]);
    for (const sx of [-1, 1]) {
      part(g, new THREE.TorusGeometry(0.026, 0.007, 6, 16, Math.PI * 1.35), m.gold, [sx * 0.072, 0, -0.128], [Math.PI / 2, 0, sx > 0 ? 0.5 : Math.PI - 0.5]);
      part(g, new THREE.SphereGeometry(0.009, 8, 6), m.gold, [sx * 0.098, 0, -0.112]);
    }
    part(g, new THREE.OctahedronGeometry(0.013, 0), m.crystal, [0, 0.016, -0.14], [0, 0, 0], [1, 0.6, 1.3]);
    wrappedGrip(g, m.pinkGrip, m.gold, 0.015);
    part(g, zcyl(0.02, 0.016, 0.014, 14), m.gold, [0, 0, 0.026]);
    part(g, new THREE.OctahedronGeometry(0.024, 0), m.pinkGem, [0, 0, 0.055], [0, 0, 0], [1, 0.8, 1.35]);
  },
  // 2. broad sword: wide blade, straight bar guard with diamond ends, ivory grip, blue gem
  (g) => {
    const m = mats();
    part(g, bladeGeometry(0.46, 0.066, 0.005), m.steel, [0, 0, -0.15]);
    part(g, rbox(0.012, 0.012, 0.3, 0.004), m.steelDark, [0, 0, -0.32]);
    part(g, rbox(0.21, 0.028, 0.034, 0.012), m.gold, [0, 0, -0.14]);
    for (const sx of [-1, 1]) part(g, new THREE.OctahedronGeometry(0.02, 0), m.gold, [sx * 0.112, 0, -0.14], [0, 0, 0], [1, 0.7, 1]);
    part(g, new THREE.OctahedronGeometry(0.016, 0), m.gem, [0, 0.018, -0.14], [0, 0, 0], [1, 0.5, 1.3]);
    wrappedGrip(g, mat("ivory"), m.gold, 0.018);
    part(g, new THREE.SphereGeometry(0.028, 14, 10), m.gold, [0, 0, 0.04]);
    part(g, new THREE.OctahedronGeometry(0.02, 0), m.gem, [0, 0, 0.07], [0, 0, 0], [1, 0.8, 1.4]);
  },
  // 3. rapier: thin blade, round gold hand-guard ring and knuckle bow, crystal pommel
  (g) => {
    const m = mats();
    part(g, bladeGeometry(0.52, 0.024, 0.003), m.steel, [0, 0, -0.15]);
    part(g, new THREE.TorusGeometry(0.05, 0.006, 6, 24), m.gold, [0, 0, -0.14]);
    part(g, new THREE.TorusGeometry(0.05, 0.004, 6, 24), m.gold, [0, 0, -0.14], [Math.PI / 2, 0, 0]);
    part(g, new THREE.TorusGeometry(0.075, 0.005, 6, 18, Math.PI), m.gold, [0.0, 0.0, -0.06], [0, Math.PI / 2, Math.PI / 2]);
    part(g, rbox(0.11, 0.016, 0.022, 0.007), m.gold, [0, 0, -0.14]);
    wrappedGrip(g, m.violetGrip, m.gold, 0.012);
    part(g, new THREE.OctahedronGeometry(0.022, 0), m.crystal, [0, 0, 0.045], [0, 0, 0], [1, 1, 1.5]);
  },
  // 4. curved sabre: lavender-tinted curved blade, S-guard, violet grip, lavender ribbon
  (g) => {
    const m = mats();
    part(g, curvedBladeGeometry(0.47, 0.05, 0.005, 0.07), m.lilacSteel, [0, 0, -0.15]);
    part(g, rbox(0.1, 0.022, 0.03, 0.01), m.gold, [0, 0, -0.14]);
    part(g, new THREE.TorusGeometry(0.03, 0.006, 6, 16, Math.PI * 1.2), m.gold, [0.05, 0, -0.12], [Math.PI / 2, 0, 0.3]);
    part(g, new THREE.TorusGeometry(0.03, 0.006, 6, 16, Math.PI * 1.2), m.gold, [-0.05, 0, -0.16], [Math.PI / 2, 0, Math.PI + 0.3]);
    wrappedGrip(g, m.violetGrip, m.lilacPaint, 0.015);
    part(g, zcyl(0.018, 0.02, 0.02, 14), m.gold, [0, 0, 0.032], [0, 0, 0]);
    part(g, new THREE.SphereGeometry(0.016, 10, 8), m.gold, [0.012, 0, 0.05]);
    // ribbon: a bow knot on the grip and two tails
    part(g, new THREE.TorusGeometry(0.018, 0.006, 5, 12), m.ribbon, [0.022, 0.0, -0.02], [0, Math.PI / 2, 0], [1, 1.4, 0.6]);
    part(g, new THREE.TorusGeometry(0.018, 0.006, 5, 12), m.ribbon, [-0.022, 0.0, -0.02], [0, Math.PI / 2, 0], [1, 1.4, 0.6]);
    part(g, rbox(0.022, 0.004, 0.11, 0.002), m.ribbon, [0.03, 0.006, -0.085], [0, 0.25, 0]);
    part(g, rbox(0.022, 0.004, 0.09, 0.002), m.ribbon, [0.05, -0.006, -0.075], [0, 0.55, 0]);
  },
  // 5. heart sword: rose-gold blade, heart guard, pink grip, gold star pommel
  (g) => {
    const m = mats();
    part(g, bladeGeometry(0.44, 0.04, 0.004), m.roseGold, [0, 0, -0.15]);
    part(g, rbox(0.008, 0.0105, 0.26, 0.003), m.gold, [0, 0, -0.3]);
    part(g, flatShape(heartShape(0.04), 0.012), m.roseGold, [0, 0, -0.13]);
    part(g, new THREE.OctahedronGeometry(0.012, 0), m.pinkGem, [0, 0.012, -0.128], [0, 0, 0], [1, 0.6, 1.2]);
    wrappedGrip(g, m.pinkGrip, m.roseGold, 0.014, -0.11, 0.015);
    part(g, zcyl(0.017, 0.014, 0.012, 14), m.gold, [0, 0, 0.02]);
    part(g, flatShape(starShape(0.03), 0.01), m.gold, [0, 0, 0.05]);
  },
];

function dressRack(rack: THREE.Object3D) {
  const m = mats();
  strip(rack);
  const L = RESCUE_LAYOUT, H = L.rackHeights, hw = L.rack.width / 2;
  const ivory = mat("ivory");
  const midY = 0.06 + (H.baseTop - 0.08) / 2;
  // plinth: gold-edged ivory base with a lavender front panel and slots
  part(rack, rbox(L.rack.width + 0.04, 0.06, 0.34, 0.02), m.woodLight, [0, 0.03, 0]);
  part(rack, rbox(L.rack.width, H.baseTop - 0.08, 0.3, 0.02), ivory, [0, midY, 0]);
  part(rack, rbox(L.rack.width - 0.12, H.baseTop - 0.16, 0.006, 0.003), m.lilacPaint, [0, midY, 0.151]);
  part(rack, rbox(L.rack.width - 0.1, H.baseTop - 0.14, 0.004, 0.002), m.gold, [0, midY, 0.1495]);
  part(rack, rbox(L.rack.width + 0.02, 0.025, 0.32, 0.01), m.gold, [0, H.baseTop - 0.012, 0]);
  for (const x of [...L.rackSlots.decor, L.rackSlots.wallSword]) part(rack, rbox(0.09, 0.006, 0.03, 0.002), m.slot, [x, H.baseTop + 0.001, 0.02]);
  // turned end posts with gold finials
  for (const sx of [-1, 1]) {
    part(rack, new THREE.CylinderGeometry(0.03, 0.036, 0.84, 14), m.woodLight, [sx * (hw - 0.035), H.baseTop + 0.42, -0.08]);
    for (const y of [H.baseTop + 0.05, H.baseTop + 0.78]) part(rack, new THREE.TorusGeometry(0.036, 0.008, 6, 16), m.gold, [sx * (hw - 0.035), y, -0.08], [Math.PI / 2, 0, 0]);
    part(rack, new THREE.SphereGeometry(0.045, 14, 10), m.gold, [sx * (hw - 0.035), H.baseTop + 0.88, -0.08]);
  }
  // lavender velvet back panel framed in gold, behind the blades
  const top = H.baseTop + 0.76;
  part(rack, rbox(L.rack.width - 0.13, top - H.baseTop - 0.04, 0.02, 0.01), m.velvet, [0, (top + H.baseTop) / 2, -0.1]);
  part(rack, rbox(L.rack.width - 0.1, 0.02, 0.026, 0.008), m.gold, [0, top, -0.1]);
  // cross-bar the sword guards rest on (left part of the rack)
  const barY = H.swordPommel - 0.16;
  const barR = L.rackSlots.hammer - 0.12;
  const barL = -hw + 0.07;
  part(rack, rbox(barR - barL, 0.035, 0.05, 0.012), m.woodLight, [(barR + barL) / 2, barY, 0.0]);
  part(rack, rbox(barR - barL, 0.008, 0.054, 0.003), m.gold, [(barR + barL) / 2, barY + 0.019, 0.0]);
  // hammer cradle on the right: two gold prongs around the handle
  for (const sx of [-1, 1]) part(rack, rbox(0.012, 0.012, 0.09, 0.004), m.gold, [L.rackSlots.hammer + sx * 0.03, H.hammerTop - 0.12, -0.02]);
  part(rack, rbox(0.1, 0.018, 0.02, 0.006), m.woodLight, [L.rackSlots.hammer, H.hammerTop - 0.12, -0.07]);
  // crest: gold arch with a lavender shield and a gold star
  part(rack, new THREE.TorusGeometry(0.2, 0.014, 6, 28, Math.PI), m.gold, [0, top + 0.02, -0.1], [0, 0, 0], [1.4, 0.55, 1]);
  part(rack, rbox(0.13, 0.15, 0.025, 0.04), m.lilacPaint, [0, top + 0.1, -0.09]);
  part(rack, rbox(0.14, 0.16, 0.018, 0.045), m.gold, [0, top + 0.1, -0.095]);
  part(rack, new THREE.OctahedronGeometry(0.035, 0), m.gold, [0, top + 0.1, -0.072], [0, 0, Math.PI / 4], [1, 1, 0.35]);
  // soft contact shadow
  part(rack, new THREE.PlaneGeometry(L.rack.width + 0.3, 0.6), mat("shadow"), [0, 0.014, 0], [-Math.PI / 2, 0, 0]);
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
  for (const tool of unity.rackSwords.slice(1)) mergeDetails(tool.object);
  if (unity.rescue.glass) mergeDetails(unity.rescue.glass);
  // Silence crystal guidance (mute symbol, notes, cracks, hammer plaque + hint).
  dressCurse(unity);
}

function dressAll(unity: UnityRoom) {
  const byName = (n: string) => unity.group.getObjectByName(n);
  const h = byName("hammer");
  if (h) dressHammer(h);
  unity.rackSwords.forEach((tool, index) => {
    if (index === 0) dressSword(tool.object, false);
    else {
      strip(tool.object);
      SWORD_DESIGNS[index](tool.object);
    }
  });
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
