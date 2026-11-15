"use client";

import * as THREE from "three";
import { ROOM } from "../puzzleConfig";
import { glowTexture } from "./proceduralTextures";

// Look-dev pass for the princess room (runtime + Scene Editor).
//
// Same art direction (cute fairytale diorama, warm morning sun, pastel
// blue / ivory / lavender / gold) with the rendering upgraded:
//   - Khronos PBR Neutral tone mapping (keeps pastel hues, rolls off highlights)
//   - a baked image-based-lighting environment of the room itself (warm walls,
//     bright windows) so gold, glaze and polished tiles have real reflections
//   - one sun shadow map rendered ONCE after the static room is built
//     (no per-frame shadow cost on Quest)
//   - analytic room ambient occlusion on the shell (corners, wall/floor seams)
//   - additive light shafts + drifting dust motes in the sunbeams and soft
//     glow halos on lamps — all shader-animated, no per-frame CPU work.
//
// Quality tiers (`?quality=`):
//   ultra — everything: sun shadow map + room environment on every material
//           (PCVR / desktop GPUs)
//   high  — default, tuned for standalone Quest: no shadow map (every
//           receiver paid a PCF lookup per pixel per eye), environment
//           reflections only on metal/glossy materials, no shader point lights
//   low   — no environment map either, simplest materials

export const lookUniforms = { uTime: { value: 0 } };

export type LookQuality = "ultra" | "high" | "low";
export function lookQuality(): LookQuality {
  if (typeof window === "undefined") return "high";
  const q = new URLSearchParams(window.location.search).get("quality");
  return q === "low" || q === "ultra" ? q : "high";
}
/** Real-time sun shadow map (ultra only). */
export const lookShadows = () => lookQuality() === "ultra";

/** Renderer colour pipeline + shadows. Call before the first render. */
export function setupRenderer(renderer: THREE.WebGLRenderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const high = lookShadows();
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Static room: render the shadow map on demand only (refreshShadows()).
  renderer.shadowMap.autoUpdate = false;
}

/** Re-render the (static) sun shadow map on the next frame. */
export function refreshShadows(renderer: THREE.WebGLRenderer) {
  renderer.shadowMap.needsUpdate = true;
}

/** Bake a small HDR "room" into a PMREM environment for reflections/IBL. */
export function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, intensity = 0.55, opts: { global?: boolean } = {}) {
  if (lookQuality() === "low") return () => undefined;
  const env = new THREE.Scene();
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;
  const H = ROOM.height;
  const eye = new THREE.Vector3((ROOM.minX + ROOM.maxX) / 2, 1.5, (ROOM.minZ + ROOM.maxZ) / 2);
  const basic = (hex: number, scale = 1) => {
    const m = new THREE.MeshBasicMaterial({ color: hex, side: THREE.BackSide });
    m.color.multiplyScalar(scale);
    return m;
  };
  const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [
    basic(0xe6cdb4, 0.9), // +x wall
    basic(0xe6cdb4, 0.9), // -x wall
    basic(0xfff5e6, 1.0), // ceiling
    basic(0xd9ab86, 0.75), // floor
    basic(0xe9d3bc, 0.9), // +z
    basic(0xe2c8ae, 0.85), // -z
  ]);
  shell.position.set(0, H / 2 - eye.y, 0);
  env.add(shell);
  const win = (x: number, z: number, rotY: number, power: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdcecff).multiplyScalar(power) }));
    m.position.set(x - eye.x, 1.8 - eye.y, z - eye.z);
    m.rotation.y = rotY;
    env.add(m);
  };
  // sun side (left) is brightest, back and right windows are skylight
  win(ROOM.minX + 0.02, -1.0, Math.PI / 2, 6);
  win(ROOM.maxX - 0.02, -1.0, -Math.PI / 2, 3);
  win(0, ROOM.maxZ - 0.02, Math.PI, 3);
  // warm sun pool on the floor + painting wall glow
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd7a0).multiplyScalar(2.2) }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(-1.2 - eye.x, 0.01 - eye.y, -0.6 - eye.z);
  env.add(pool);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035, 0.05, 20);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
    }
  });
  if (opts.global || lookQuality() === "ultra") {
    scene.environment = rt.texture;
    scene.environmentIntensity = intensity;
  } else {
    // Quest: only shiny materials get reflections (see assignEnvMaps); the
    // matte room relies on the hemisphere light for bounce.
    envTexture = rt.texture;
    envIntensity = intensity;
  }
  return () => {
    envTexture = null;
    rt.dispose();
  };
}

let envTexture: THREE.Texture | null = null;
let envIntensity = 0.55;
/** Give the baked environment to metal / glossy materials under `root` only
 *  (gold, steel, mirror, glass, glaze). The cubeUV lookup is one of the most
 *  expensive parts of MeshStandardMaterial on a mobile GPU, and matte stone,
 *  plaster, wood and fabric barely show it. No-op on ultra (global env). */
export function assignEnvMaps(root: THREE.Object3D) {
  if (!envTexture) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = x as THREE.MeshStandardMaterial;
      if (!s.isMeshStandardMaterial || s.envMap) continue;
      if (s.metalness >= 0.3 || s.roughness <= 0.3) {
        s.envMap = envTexture;
        s.envMapIntensity = envIntensity * 1.6;
        s.needsUpdate = true;
      }
    }
  });
}

/** Decor kinds mounted on walls: they receive the sun shadow but never cast
 *  (the stylised sun reaches the whole room, so their shadows would fall
 *  from an impossible direction). */
export const WALL_PIECES: ReadonlySet<string> = new Set([
  "arched-window",
  "curtains",
  "ivy",
  "wall-lantern",
  "royal-banner",
  "sconce",
  "banner-blue",
  "banner-pink",
  "night-window",
  "sun-patch",
]);

/** Every opaque mesh under `root` casts + receives the sun shadow, except
 *  the walls/ceiling (they would block the sun coming "through" them). */
export function enableShadows(root: THREE.Object3D, opts: { cast?: boolean } = {}) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const transparent = mats.some((x) => x.transparent || (x as THREE.MeshBasicMaterial).isMeshBasicMaterial);
    if (transparent) return;
    const shellPart = mats.some((x) => x.userData.roomShell);
    m.receiveShadow = true;
    m.castShadow = opts.cast !== false && !shellPart;
  });
}

// ── Room ambient occlusion (shell materials) ────────────────────────────────

/** Darkens a material near the room's corners and floor/ceiling seams, from
 *  the world position (works after static batching). Shared uniforms. */
export function withRoomAO(m: THREE.MeshStandardMaterial, strength = 1) {
  m.userData.roomShell = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uRoomMin = { value: new THREE.Vector3(ROOM.minX, 0, ROOM.minZ) };
    shader.uniforms.uRoomMax = { value: new THREE.Vector3(ROOM.maxX, ROOM.height, ROOM.maxZ) };
    shader.uniforms.uAOStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vRoomPos;\nvoid main() {")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vRoomPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying vec3 vRoomPos;\nuniform vec3 uRoomMin;\nuniform vec3 uRoomMax;\nuniform float uAOStrength;\nvoid main() {")
      .replace(
        "#include <aomap_fragment>",
        [
          "#include <aomap_fragment>",
          "  {",
          "    vec3 p = vRoomPos;",
          "    float dx = min(p.x - uRoomMin.x, uRoomMax.x - p.x);",
          "    float dz = min(p.z - uRoomMin.z, uRoomMax.z - p.z);",
          "    float dWall = max(min(dx, dz), 0.0);",
          "    float seam = max(exp(-max(p.y, 0.0) / 0.32), exp(-max(uRoomMax.y - p.y, 0.0) / 0.28)) * exp(-dWall / 0.4);",
          "    float corner = exp(-max(max(dx, dz), 0.0) / 0.45);",
          "    float contact = exp(-max(p.y, 0.0) / 0.12) * 0.25;",
          "    float rao = clamp(1.0 - uAOStrength * (0.38 * seam + 0.32 * corner + contact * exp(-dWall / 0.25)), 0.35, 1.0);",
          "    reflectedLight.indirectDiffuse *= rao;",
          "    reflectedLight.directDiffuse *= mix(1.0, rao, 0.55);",
          "    reflectedLight.indirectSpecular *= rao;",
          "  }",
        ].join("\n"),
      );
  };
  m.customProgramCacheKey = () => `roomAO${strength}`;
  return m;
}

// ── Light shafts + dust motes (part of builtin:sun-patch) ───────────────────

/** Sun direction in a window piece's local frame (window faces +Z). Shared
 *  with the floor sun patch so beam and patch line up. */
export const SUN_LOCAL = new THREE.Vector3(0.26, -1, 0.85);
export const WINDOW_OPENING = { x0: -0.5, x1: 0.5, y0: 0.85, y1: 2.3 };

/** Where a window-plane point lands on the floor along the sun. */
export function sunFloor(x: number, y: number, z = 0.02) {
  const t = y / -SUN_LOCAL.y;
  return new THREE.Vector3(x + SUN_LOCAL.x * t, 0, z + SUN_LOCAL.z * t);
}

let shaftMaterial: THREE.ShaderMaterial | null = null;
function shaftMat() {
  if (shaftMaterial) return shaftMaterial;
  shaftMaterial = new THREE.ShaderMaterial({
    name: "light-shaft",
    uniforms: { uTime: lookUniforms.uTime, uColor: { value: new THREE.Color(0xffe2b0) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        // vUv.y: 1 at the window, 0 on the floor; vUv.x across the sheet
        float along = smoothstep(0.0, 0.35, vUv.y) * (0.55 + 0.45 * vUv.y);
        float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
        float drift = 0.75 + 0.25 * sin(vWorld.x * 3.1 + vWorld.z * 2.3 + uTime * 0.35)
                           * sin(vWorld.y * 2.7 - uTime * 0.22);
        float a = along * edge * drift * 0.11;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return shaftMaterial;
}

/** Soft volumetric-looking sunbeam through a window: a lattice of additive
 *  sheets along the sun direction. Local frame = window piece. */
export function lightShaft(): THREE.Mesh {
  const { x0, x1, y0, y1 } = WINDOW_OPENING;
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    // a,b on the window (uv.y = 1), c,d on the floor (uv.y = 0); a/d at uv.x 0
    pos.push(...a.toArray(), ...d.toArray(), ...b.toArray(), ...b.toArray(), ...d.toArray(), ...c.toArray());
    uv.push(0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0);
  };
  // sheets along the beam, spaced across the window width (kept few: each
  // sheet is full-screen additive overdraw when the player stands in a beam)
  const nx = lookQuality() === "ultra" ? 5 : 3;
  for (let i = 0; i < nx; i++) {
    const x = x0 + ((i + 0.5) / nx) * (x1 - x0);
    const wt = new THREE.Vector3(x, y1, 0.02);
    const wb = new THREE.Vector3(x, y0, 0.02);
    quad(wb, wt, sunFloor(x, y1), sunFloor(x, y0));
  }
  // ribbons spanning the width, spaced over the window height
  const ny = lookQuality() === "ultra" ? 4 : 2;
  for (let j = 0; j < ny; j++) {
    const y = y0 + ((j + 0.5) / ny) * (y1 - y0);
    quad(new THREE.Vector3(x0, y, 0.02), new THREE.Vector3(x1, y, 0.02), sunFloor(x1, y), sunFloor(x0, y));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, shaftMat());
  m.name = "light-shaft";
  m.renderOrder = 2;
  return m;
}

let moteMaterial: THREE.ShaderMaterial | null = null;
/** Dust motes drifting inside a sunbeam (THREE.Points, GPU-animated). */
export function dustMotes(count = 140, seed = 1): THREE.Points {
  const { x0, x1, y0, y1 } = WINDOW_OPENING;
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const wx = x0 + r() * (x1 - x0);
    const wy = y0 + r() * (y1 - y0);
    const f = 0.08 + r() * 0.85; // how far along the beam
    const p = new THREE.Vector3(wx, wy, 0.02).lerp(sunFloor(wx, wy), f);
    pos.set([p.x, p.y, p.z], i * 3);
    rnd[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 1));
  moteMaterial ??= new THREE.ShaderMaterial({
    name: "dust-motes",
    uniforms: { uTime: lookUniforms.uTime, uMap: { value: glowTexture() }, uScale: { value: 380 } },
    vertexShader: /* glsl */ `
      attribute float aRnd;
      uniform float uTime;
      uniform float uScale;
      varying float vA;
      void main() {
        float t = uTime * (0.05 + 0.06 * aRnd) + aRnd * 40.0;
        vec3 p = position + vec3(sin(t * 1.7) * 0.06, sin(t * 1.1 + 2.0) * 0.08, cos(t * 1.3) * 0.06);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.006 + 0.008 * aRnd) * uScale / max(-mv.z, 0.2);
        vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + aRnd) + aRnd * 30.0));
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA * 0.75;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const pts = new THREE.Points(g, moteMaterial);
  pts.name = "dust-motes";
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return pts;
}

// ── Glow halos ──────────────────────────────────────────────────────────────

const haloMats = new Map<number, THREE.SpriteMaterial>();
/** Soft additive halo around a light-emitting prop (lamp, lantern, flame). */
export function glowHalo(color: number, size: number, opacity = 0.55): THREE.Sprite {
  const key = color * 1000 + Math.round(opacity * 100);
  let m = haloMats.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    haloMats.set(key, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 2;
  s.name = "glow-halo";
  return s;
}

/** Compile every shader program and upload every texture up front, including
 *  objects that start hidden (reward sword, fireball, photo, flash, end card,
 *  particle templates). Otherwise each one compiles on the frame it first
 *  appears, a stall of 100 ms or more per program on Quest. Call once after
 *  the room is fully built. */
export function prewarm(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const hidden: THREE.Object3D[] = [];
  const textures = new Set<THREE.Texture>();
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
    const m = o as THREE.Mesh;
    if (!m.material) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(x)) {
        const t = v as THREE.Texture;
        if (t && t.isTexture && !(t as THREE.VideoTexture).isVideoTexture && t.image) textures.add(t);
      }
    }
  });
  try {
    renderer.compile(scene, camera);
    for (const t of textures) renderer.initTexture(t);
    // compile() doesn't upload vertex buffers; that happens on first draw
    // (~80 ms for the hidden props on desktop, far more on Quest). Draw
    // everything once through a 1-pixel scissor so nobody sees it.
    if (!renderer.xr.isPresenting) {
      const prevScissor = renderer.getScissorTest();
      const box = renderer.getScissor(new THREE.Vector4());
      renderer.setScissor(0, 0, 1, 1);
      renderer.setScissorTest(true);
      renderer.render(scene, camera);
      renderer.setScissor(box);
      renderer.setScissorTest(prevScissor);
    }
  } finally {
    for (const o of hidden) o.visible = false;
  }
  return { programs: renderer.info.programs?.length ?? 0, textures: textures.size };
}

/** Per-frame: advance shader time (shafts, motes). */
export function tickLook(seconds: number) {
  lookUniforms.uTime.value = seconds;
}
