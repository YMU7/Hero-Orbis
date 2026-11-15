"use client";

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mat } from "./furniture";
import { lookUniforms } from "./lookdev";
import { CURSE_THREAD_POINTS, type UnityRoom } from "./unityRoom";

// Silence crystal, art pass round 2 (design: docs/design/round2/silence-crystal.png).
//
// Visual guidance only; the gameplay object (unityRoom.mute: position, the
// 0.23 m hammer contact, desktop click on the crystal) is unchanged. Two
// messages, readable from the start position:
//   1. "This blocks the sound": a glowing mute symbol on the crystal, and
//      musical notes drifting out of the painting along the threads into the
//      crystal, where they vanish.
//   2. "A hammer breaks it": glowing hairline cracks on the crystal, a small
//      gold plaque with a hammer icon hanging under it, while the hammer head
//      on the rack pulses to guide the player.
// When the crystal breaks, the trapped notes burst out and float back up
// into the painting.
//
// Browser-only (canvas textures); called from propModels.dressProps. All
// animation reads the shared look clock (lookUniforms.uTime) in
// onBeforeRender, so nothing is added to the game loop.

const now = () => lookUniforms.uTime.value;
/** Crystal, mount and symbol size vs the first pass (readable from the start, 2.5 m away). */
const CRYSTAL_SCALE = 1.3;

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A gold plaque with cut corners, a raised border and an embossed hammer,
 *  hanging on two short chains; centre at (0, y), facing +Z. */
function hammerPlaque(y: number) {
  const g = new THREE.Group();
  g.name = "hammer-plaque";
  const gold = mat("gold");
  const deep = new THREE.MeshStandardMaterial({ color: 0xc9953e, metalness: 0.6, roughness: 0.45, name: "plaque-inset" });
  const W = 0.11, H = 0.07, C = 0.014;
  const outline = (w: number, h: number, c: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2 + c, -h / 2);
    sh.lineTo(w / 2 - c, -h / 2);
    sh.lineTo(w / 2, -h / 2 + c);
    sh.lineTo(w / 2, h / 2 - c);
    sh.lineTo(w / 2 - c, h / 2);
    sh.lineTo(-w / 2 + c, h / 2);
    sh.lineTo(-w / 2, h / 2 - c);
    sh.lineTo(-w / 2, -h / 2 + c);
    sh.closePath();
    return sh;
  };
  const extrude = (sh: THREE.Shape, depth: number, bevel: number) =>
    new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // plate, recessed inset panel, raised hammer
  const plate = new THREE.Mesh(extrude(outline(W, H, C), 0.006, 0.0025), gold);
  const inset = new THREE.Mesh(extrude(outline(W - 0.016, H - 0.016, C * 0.7), 0.002, 0.001), deep);
  inset.position.z = 0.0065;
  const hammer = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.046, 0.005), gold);
  handle.position.set(0, -0.006, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.015, 0.007), gold);
  head.position.set(0, 0.022, 0);
  hammer.add(handle, head);
  hammer.rotation.z = -0.65;
  hammer.position.z = 0.0105;
  g.add(plate, inset, hammer);
  // corner studs
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), gold);
    stud.position.set(sx * (W / 2 - 0.011), sy * (H / 2 - 0.011), 0.008);
    g.add(stud);
  }
  // two chains of three links up to the ring
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0018, 5, 10), gold);
      link.scale.set(0.8, 1.25, 1);
      link.position.set(sx * 0.034, H / 2 + 0.006 + i * 0.011, 0.003);
      if (i % 2) link.rotation.y = Math.PI / 2;
      g.add(link);
    }
  }
  g.scale.setScalar(CRYSTAL_SCALE);
  g.position.set(0, y, 0.0);
  g.traverse((o) => (o.raycast = () => {}));
  return g;
}

/** Two note glyphs side by side (♪ left, ♫ right), white, for tinting. */
function noteAtlas() {
  return canvasTexture(256, 128, (c) => {
    c.clearRect(0, 0, 256, 128);
    c.fillStyle = "#ffffff";
    c.strokeStyle = "#ffffff";
    c.shadowColor = "rgba(255,255,255,0.9)";
    c.shadowBlur = 8;
    // ♪
    c.beginPath();
    c.ellipse(46, 96, 20, 14, -0.4, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(64, 92);
    c.lineTo(64, 20);
    c.quadraticCurveTo(84, 40, 100, 44);
    c.stroke();
    // ♫
    c.beginPath();
    c.ellipse(158, 98, 18, 13, -0.4, 0, Math.PI * 2);
    c.ellipse(214, 88, 18, 13, -0.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(174, 94);
    c.lineTo(174, 26);
    c.lineTo(230, 16);
    c.lineTo(230, 84);
    c.stroke();
    c.lineWidth = 12;
    c.beginPath();
    c.moveTo(174, 30);
    c.lineTo(230, 20);
    c.stroke();
  });
}

const NOTE_COLORS = [0xfff1a8, 0xc9f0ff, 0xffd0e6, 0xdcd0ff, 0xfff1a8, 0xc9f0ff];

function noteMesh(atlas: THREE.Texture, i: number) {
  const g = new THREE.PlaneGeometry(0.1, 0.1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const right = i % 2 === 1;
  for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 0.5 + (right ? 0.5 : 0));
  const m = new THREE.MeshBasicMaterial({ map: atlas, color: NOTE_COLORS[i % NOTE_COLORS.length], transparent: true, depthWrite: false, toneMapped: false, name: "curse-note" });
  const mesh = new THREE.Mesh(g, m);
  mesh.raycast = () => {};
  mesh.frustumCulled = false; // positions are animated
  return mesh;
}

/** Point at fraction f (0..1) along a polyline. */
function along(points: THREE.Vector3[], f: number, out: THREE.Vector3) {
  const seg = points.length - 1;
  const x = Math.min(seg - 1e-6, Math.max(0, f * seg));
  const i = Math.floor(x);
  return out.copy(points[i]).lerp(points[i + 1], x - i);
}

export function dressCurse(unity: UnityRoom) {
  const red = unity.red;
  const crystalMat = red.children.map((c) => (c as THREE.Mesh).material).find((m) => (m as THREE.Material)?.name === "curse-crystal") as THREE.Material | undefined;
  // 1. The old curse core and its gold ring are hidden: the violet crystal
  //    microphone (unityRoom, "crystal-mic") is the device now, and it stays
  //    after the strike. Both stay as invisible desktop click targets.
  for (const c of red.children) {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh && (mesh.material === crystalMat || (mesh.geometry as THREE.TorusGeometry).type === "TorusGeometry")) mesh.visible = false;
  }
  // 2. The curse itself: a solid red prohibition ring + bar around the
  //    microphone. The hammer shatters it (the whole red group hides).
  const S = CRYSTAL_SCALE;
  const noSoundMat = new THREE.MeshStandardMaterial({ color: 0xe0242e, emissive: 0x7a0010, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.1, name: "curse-no-sound" });
  const ringGeo = new THREE.TorusGeometry(0.125 * S, 0.017 * S, 12, 48).translate(0, 0.0, 0.0).toNonIndexed();
  // bar from top-left to bottom-right, in front of the microphone
  const barGeo = new THREE.CylinderGeometry(0.015 * S, 0.015 * S, 0.25 * S, 14).rotateZ(Math.PI / 4).translate(0, 0, 0.065 * S).toNonIndexed();
  const noSound = new THREE.Mesh(mergeGeometries([ringGeo, barGeo], false)!, noSoundMat);
  noSound.position.y = 0.0;
  noSound.name = "curse-no-sound";
  red.add(noSound);
  // 3. Hammer plaque (reference: gold sign with cut corners, raised border,
  //    embossed hammer, corner studs) hanging from the ring on two chains.
  //    Part of the curse group, so it goes when the ring is shattered.
  red.add(hammerPlaque(-0.205 * CRYSTAL_SCALE)); // top chain links meet the ring's lower edge
  // 5. Notes drawn out of the painting along both threads into the crystal.
  const atlas = noteAtlas();
  const paths = [-1, 1].map((x) => CURSE_THREAD_POINTS(x).slice().reverse()); // corner → crystal
  const notes: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const n = noteMesh(atlas, i);
    const path = paths[i % 2];
    const phase = i / 6;
    const p = new THREE.Vector3();
    n.onBeforeRender = () => {
      const f = (now() * 0.12 + phase) % 1;
      along(path, f, p);
      n.position.set(p.x, p.y + Math.sin(now() * 3 + i) * 0.012, p.z + 0.03);
      const s = f < 0.1 ? f / 0.1 : f > 0.85 ? (1 - f) / 0.15 : 1; // appear, then shrink into the crystal
      n.scale.setScalar(0.4 + 0.6 * s);
      (n.material as THREE.MeshBasicMaterial).opacity = s;
      n.rotation.z = Math.sin(now() * 2 + i) * 0.25;
    };
    red.add(n);
    notes.push(n);
  }
  // 6. Release: when the crystal breaks (red group hidden), notes burst out
  //    of it and float back up into the painting, then disappear.
  const release = new THREE.Group();
  release.name = "curse-release";
  unity.mute.add(release);
  let brokeAt = -1;
  for (let i = 0; i < 8; i++) {
    const n = noteMesh(atlas, i);
    const a = -Math.PI / 2 + (i / 7) * Math.PI; // fan upward
    n.scale.setScalar(0);
    n.onBeforeRender = () => {
      if (red.visible) {
        brokeAt = -1;
        n.scale.setScalar(0);
        return;
      }
      if (brokeAt < 0) brokeAt = now();
      const t = (now() - brokeAt) / 1.8;
      if (t > 1) {
        n.scale.setScalar(0);
        return;
      }
      const e = 1 - Math.pow(1 - t, 2);
      n.position.set(Math.sin(a) * 0.5 * e, 0.1 + 0.9 * e + Math.sin(t * 9 + i) * 0.02, 0.04 - 0.1 * e);
      n.scale.setScalar(1.3 * Math.min(1, t * 5) * (1 - t * 0.5));
      (n.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    };
    release.add(n);
  }
}
