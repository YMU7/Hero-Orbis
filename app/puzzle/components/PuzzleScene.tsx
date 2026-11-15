"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { VideoTextureMonitor, type VideoHealth } from "../../mvp/lib/videoTextureHealth";
import { debug } from "../../mvp/lib/debugState";
import { initToolPhysics, ToolPhysics } from "../lib/toolPhysics";
import type { RescueBeat } from '../lib/rescueScript';
import { UnityRoom } from "../lib/unityRoom";
import { RoomMovement } from "../lib/roomMovement";
import { DrawingBoard } from "../lib/drawingBoard";
import { HandInput, type Grabber } from "../lib/handInput";
import { Crayon, type DrawMode } from "../lib/crayon";
import { Eraser } from "../lib/eraser";
import { Gramophone } from "../lib/gramophone";
import { roomAudio } from "../lib/roomAudio";
import {
  addRoomLights,
  buildDecor,
  buildEasel,
  buildPainting,
  buildPedestal,
  buildShell,
  builtinKind,
  isSingletonAsset,
  normalizePuzzleScene,
  paint,
  type BuiltinKind,
  type PokeButton,
} from "../lib/roomParts";
import { applyTransform, createInstance, fetchScene } from "../../lib/sceneData/environment";
import { batchStatic } from "../lib/staticBatch";
import { emptyScene, type SceneObject } from "../../lib/sceneData/types";
import { BOARD_H, BOARD_W, PUZZLE_SCENE_ID } from "../puzzleConfig";
import type { Stroke } from "../lib/swordRecognizer";

// "The princess in the painting" — a 5 m × 5 m fantasy princess room at real
// scale. The viewer starts at the origin (1 m in from the back wall) facing -Z.
//
// LAYOUT comes from the shared scene file data/scenes/puzzle.json, edited in
// the desktop Scene Editor (/editor?scene=puzzle). Every piece is built by
// app/puzzle/lib/roomParts.ts at its own origin and placed by its transform:
//   painting   : gold-framed painting = the live Orbis stream (+ hint, HUD)
//   easel      : wooden A-frame easel with mounted pen and eraser
//   gramophone : puzzle 1 (on a side table)
//   pedestal   : RESET / CLEAR poke buttons
//   decor      : rug, canopy bed, night window, sconces, banners, tables, GLBs
// No file / empty file → the original default room (DEFAULT_PUZZLE_LAYOUT).
// The scene is built once the layout is fetched (a fetch error falls back to
// the default room).
//
// Input is hand tracking (pinch to grab, fingertip to poke) with controllers
// as a fallback; desktop uses the mouse (drag on the canvas, click the
// gramophone / buttons) and the arrow keys to look around. Nothing in the
// room solves the puzzle by itself: only a recognised drawing does.

export type RoomApi = {
  clearBoard: () => void;
  resetRoom: () => void;
  strokes: () => ReadonlyArray<Stroke>;
};

export type PuzzleSceneProps = {
  onBeat: (beat: RescueBeat) => void | Promise<void>;
  showVideo: boolean;
  video: HTMLVideoElement | null;
  placeholderLines: string[];
  hudLines: string[];
  hintText: string;
  wrongFlashUntil: number;
  swordFlashUntil: number;
  onStrokeEnd: (strokes: ReadonlyArray<Stroke>, source: string) => void;
  onButton: (id: "reset" | "clear", detail: string) => void;
  onSound: (on: boolean) => void;
  /** The layout the room was built from (puzzle components live on it). */
  onLayout: (layout: SceneObject[]) => void;
  /** An object carrying a touch/pinch puzzle was touched / pinched / clicked. */
  onObjectTrigger: (objectId: string, kind: "touch" | "pinch" | "click") => void;
  onCrayonHolder: (holder: string | null) => void;
  onTonearmHolder: (holder: string | null) => void;
  onDrawMode: (m: DrawMode) => void;
  onXRSession: (active: boolean) => void;
  onInputInfo: (sources: string[]) => void;
  onVideoHealth: (h: VideoHealth) => void;
  roomApi: React.MutableRefObject<RoomApi | null>;
};

const POKE_R = 0.03;
const POKE_REARM = 0.07;

export function PuzzleScene(props: PuzzleSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const api = useRef<{ sync: () => void; setHud: (l: string[]) => void; setHint: (t: string) => void } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let teardown: (() => void) | null = null;

    const build = (layout: SceneObject[]) => {
    const placement = (k: BuiltinKind) => layout.find((o) => builtinKind(o.asset) === k)!;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local-floor");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.02, 30);
    camera.position.set(0, 1.6, 0.3);
    let yaw = 0;
    let pitch = -0.12;
    camera.rotation.set(pitch, yaw, 0, "YXZ");
    const rig = new THREE.Group();
    scene.add(rig); rig.add(camera);
    const movement = new RoomMovement(rig, camera, renderer);
    addRoomLights(scene);
    const shell = buildShell();
    scene.add(shell);

    // ── Objects with a touch / pinch puzzle component ────────────────────
    // World bounds are taken once (the room is static); a fingertip inside
    // (+2 cm) is a touch, a pinch inside (+5 cm) is a pinch, a mouse click or
    // controller ray hit is a click.
    type Target = { id: string; group: THREE.Object3D; box: THREE.Box3; armed: boolean };
    const targets: Target[] = [];
    const isTargetPuzzle = (o: SceneObject) => o.puzzle?.trigger === "touch" || o.puzzle?.trigger === "pinch";
    const addTarget = (id: string, g: THREE.Object3D) => {
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      if (box.isEmpty()) box.setFromCenterAndSize(g.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.3, 0.3, 0.3));
      targets.push({ id, group: g, box, armed: true });
    };
    const targetOf = (obj: THREE.Object3D | null): Target | undefined => {
      for (let o = obj; o; o = o.parent) {
        const t = targets.find((x) => x.group === o);
        if (t) return t;
      }
      return undefined;
    };
    const fireTarget = (t: Target, kind: "touch" | "pinch" | "click") => propsRef.current.onObjectTrigger(t.id, kind);

    // ── Decor + imported GLBs from the layout (non-interactive) ─────────
    const env = new THREE.Group();
    env.name = "environment";
    scene.add(env);
    const staticRoot = new THREE.Group();
    staticRoot.name = "static (batched)";
    scene.add(staticRoot);
    const decorJobs = layout
      .filter((o) => !isSingletonAsset(o.asset))
      .map((o) =>
        createInstance(
          o,
          (m) => debug.push("error", `[puzzle] layout: ${m}`),
          (a) => {
            const k = builtinKind(a);
            return k ? buildDecor(k) : null;
          },
        ).then((g) => {
          if (!disposed) env.add(g);
          if (isTargetPuzzle(o)) addTarget(o.id, g);
          return { g, builtin: o.asset.startsWith("builtin:") && !isTargetPuzzle(o) };
        }),
      );
    // Phase E: once every piece exists, merge the shell + built-in decor per
    // material (no multiview in this three version → each mesh costs one
    // draw call PER EYE in VR). GLB imports stay as they are.
    void Promise.all(decorJobs).then((items) => {
      if (disposed) return;
      for (const item of items) physics.addStatic(item.g);
      const builtins = items.filter((x) => x.builtin).map((x) => x.g);
      const st = batchStatic(staticRoot, [shell, ...builtins]);
      debug.push("info", `[puzzle] static batching: ${st.meshesIn} meshes → ${st.meshesOut} (skipped ${st.skipped})`);
    });

    // ── Painting (Orbis stream) + hint + HUD ─────────────────────────────
    const painting = buildPainting();
    applyTransform(painting.group, placement("painting"));
    scene.add(painting.group);
    const { paintMat, placeholder, hint, hud } = painting;
    const setHint = (t: string) => paint(hint, "#6b4a1e", [{ text: t, font: "italic 40px serif", color: "#fbe7b5" }]);
    const setHud = (lines: string[]) =>
      paint(hud, "#0b0c10", lines.map((t) => ({ text: t, font: "26px monospace", color: "#d8dbe6" })), "left");

    // ── Easel + canvas + crayon ──────────────────────────────────────────
    const easel = buildEasel();
    applyTransform(easel.group, placement("easel"));
    scene.add(easel.group);
    const { mount } = easel;
    const board = new DrawingBoard(BOARD_W, BOARD_H);
    mount.add(board.mesh);

    // ── Gramophone ───────────────────────────────────────────────────────
    const gramophone = new Gramophone(() => undefined);
    applyTransform(gramophone.group, placement("gramophone"));
    scene.add(gramophone.group);

    // ── Pedestal with poke buttons ───────────────────────────────────────
    const pedestal = buildPedestal();
    applyTransform(pedestal.group, placement("pedestal"));
    scene.add(pedestal.group);
    const buttons: PokeButton[] = pedestal.buttons;
    const pressButton = (b: PokeButton, detail: string) => {
      const now = performance.now();
      if (now < b.flashUntil + 600) return;
      b.flashUntil = now + 400;
      roomAudio.play("button");
      propsRef.current.onButton(b.id, detail);
    };

    scene.updateMatrixWorld(true);
    for (const [k, g] of [["painting", painting.group], ["pedestal", pedestal.group]] as const) {
      const o = placement(k);
      if (isTargetPuzzle(o)) addTarget(o.id, g);
    }
    propsRef.current.onLayout(layout);
    const crayonRest = mount.localToWorld(new THREE.Vector3(BOARD_W / 2 + 0.055, 0.08, 0.065));
    const crayonRestQ = mount.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));

    const physics = new ToolPhysics();
    const unity = new UnityRoom(physics, painting.group, board, (on) => propsRef.current.onSound(on), (beat) => propsRef.current.onBeat(beat));
    scene.add(unity.group);
    for (const prop of [easel.group, pedestal.group, gramophone.group]) physics.addStatic(prop);

    // ── Interaction: hands / controllers ─────────────────────────────────
    const crayon = new Crayon({
      board,
      restPosition: crayonRest,
      restQuaternion: crayonRestQ,
      onStrokeEnd: (src) => propsRef.current.onStrokeEnd(board.strokes, src),
      onHolder: (h) => propsRef.current.onCrayonHolder(h),
      onMode: (m) => propsRef.current.onDrawMode(m),
      pulse: (g, v, ms) => hands.pulse(g, v, ms),
      physics,
    });
    scene.add(crayon.object);
    const eraser = new Eraser(physics, mount, board, () => propsRef.current.onButton('clear','eraser on canvas'));
    scene.add(eraser.object);
    let tonearmHolder: Grabber | null = null;
    // Controller pointer-ray targets (Phase E): RESET / CLEAR / gramophone.
    const rayCaster = new THREE.Raycaster();
    const rayTarget = (g: Grabber): { kind: "button"; b: PokeButton; d: number } | { kind: "tool"; d: number } | null => {
      const r = hands.pointerRay(g);
      if (!r) return null;
      rayCaster.ray.copy(r);
      rayCaster.far = 4;
      const hit = rayCaster.intersectObjects([...buttons.map((b) => b.mesh), ...physics.tools.filter((t) => t.object.visible).map((t) => t.object)], true)[0];
      if (!hit) return null;
      const b = buttons.find((x) => x.mesh === hit.object);
      return b ? { kind: "button", b, d: hit.distance } : { kind: "tool", d: hit.distance };
    };
    const hands = new HandInput({
      renderer,
      scene: rig,
      onPinchStart: (g) => {
        if (crayon.tryGrab(g, hands.pointerRay(g))) return;
        if (eraser.tool.tryGrab(g, hands.pointerRay(g))) { hands.pulse(g, 0.3, 35); return; }
        if (unity.tryGrab(g, hands.pointerRay(g))) { hands.pulse(g, 0.5, 45); return; }
        // Controllers only: nothing in reach → use the pointer ray.
        const hit = rayTarget(g);
        if (hit?.kind === "button") {
          pressButton(hit.b, `controller ray (${g.label})`);
          hands.pulse(g, 0.5, 40);
        } else if (hit?.kind === "tool") {
          // Only a hammer impact restores room sound.
          hands.pulse(g, 0.5, 40);
        }
      },
      onPinchEnd: (g) => {
        crayon.release(g);
        physics.release(g);
        if (tonearmHolder === g) {
          gramophone.release();
          tonearmHolder = null;
          propsRef.current.onTonearmHolder(null);
        }
      },
      onInputInfo: (s) => propsRef.current.onInputInfo(s),
    });

    const resetRoom = () => {
      physics.reset();
      unity.reset();
      movement.reset();
      crayon.putBack();
      board.clear();
      if (tonearmHolder) {
        tonearmHolder = null;
        propsRef.current.onTonearmHolder(null);
      }
      gramophone.reset();
    };
    propsRef.current.roomApi.current = { clearBoard: () => board.clear(), resetRoom, strokes: () => board.strokes };

    // ── Desktop: mouse + arrow keys ──────────────────────────────────────
    const el = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const targets: THREE.Object3D[] = [board.mesh, unity.mute, ...physics.tools.filter(t=>t.object.visible && unity.rescue.canGrab(t)).map(t=>t.object), ...buttons.map((b) => b.mesh)];
      const hit = raycaster.intersectObjects(targets, true)[0];
      if (!hit) return null;
      if (hit.object === board.mesh && hit.uv) return { kind: "board" as const, p: board.uvToBoard(hit.uv) };
      const b = buttons.find((x) => x.mesh === hit.object);
      if (b) return { kind: "button" as const, b };
      let object: THREE.Object3D | null = hit.object;
      while(object){const tool=physics.tools.find(t=>t.object===object);if(tool)return {kind:'tool' as const,tool};object=object.parent;}
      return { kind: "mute" as const };
    };
    const desktop: Grabber = {index: -1,kind:'controller',source:null,pinching:true,point:new THREE.Vector3(),dir:new THREE.Vector3(0,0,-1),rotation:new THREE.Quaternion(),poke:new THREE.Vector3(),tracked:true,label:'desktop'};
    let desktopTool: typeof unity.hammer | null = null;
    const updateDesktop = () => {camera.getWorldDirection(desktop.dir);camera.getWorldQuaternion(desktop.rotation);desktop.point.copy(camera.getWorldPosition(new THREE.Vector3())).addScaledVector(desktop.dir,.65);};
    let mouseDrawing = false;
    const onDown = (ev: PointerEvent) => {
      if (renderer.xr.isPresenting || ev.button !== 0) return;
      if(desktopTool){if(desktopTool===unity.rescue.camera&&unity.rescue.shoot())return;desktopTool.release(desktop);desktopTool=null;return;}
      const h = pick(ev);
      if (!h) return;
      if(h.kind==='tool'){updateDesktop();desktop.point.copy(h.tool.object.position);if(h.tool.tryGrab(desktop)){desktopTool=h.tool;}return;}
      if (h.kind === "board") {
        mouseDrawing = true;
        el.setPointerCapture(ev.pointerId);
        crayon.mouseBegin(h.p);
      } else if (h.kind === "button") pressButton(h.b, "desktop mouse");
      else unity.desktopStrike();
    };
    const onMove = (ev: PointerEvent) => {
      if (renderer.xr.isPresenting) return;
      const h = pick(ev);
      crayon.mouseMove(h?.kind === "board" ? h.p : null);
      el.style.cursor = h ? (h.kind === "board" ? "crosshair" : "pointer") : "default";
    };
    const onUp = (ev: PointerEvent) => {
      if (!mouseDrawing) return;
      mouseDrawing = false;
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      crayon.mouseEnd();
    };
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if(ev.code==='Space'&&desktopTool===unity.rescue.camera){ev.preventDefault();unity.rescue.shoot();return;}
      const step = 0.06;
      if (ev.key === "ArrowLeft") yaw += step;
      else if (ev.key === "ArrowRight") yaw -= step;
      else if (ev.key === "ArrowUp") pitch = Math.min(1.2, pitch + step);
      else if (ev.key === "ArrowDown") pitch = Math.max(-1.2, pitch - step);
      else return;
      ev.preventDefault();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);

    // Test hooks for scripted emulator runs (read-only helpers + pose math).
    (window as unknown as { __puzzleTest?: unknown }).__puzzleTest = {
      hands: () => hands.debug(),
      crayonWorld: () => crayon.object.getWorldPosition(new THREE.Vector3()).toArray(),
      crayonTip: () => crayon.debugTip(),
      boardPoint: (u: number, v: number, z = 0) => board.boardToWorld({ x: (u - 0.5) * board.width, y: (v - 0.5) * board.height }, z).toArray(),
      boardNormal: () => new THREE.Vector3(0, 0, 1).transformDirection(board.mesh.matrixWorld).toArray(),
      headWorld: () => gramophone.headWorld().toArray(),
      headWorldAt: (deg: number) => gramophone.headWorldAt(deg),
      soundOn: () => gramophone.playing,
      buttonWorld: (id: string) => buttons.find((b) => b.id === id)?.mesh.getWorldPosition(new THREE.Vector3()).toArray() ?? null,
      /** Puzzle target objects (touch / pinch) and where they are on screen (desktop). */
      targets: () =>
        targets.map((t) => {
          const c = t.box.getCenter(new THREE.Vector3()).project(camera);
          const r = renderer.domElement.getBoundingClientRect();
          return { id: t.id, screen: [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height], onScreen: Math.abs(c.x) < 1 && Math.abs(c.y) < 1 && c.z < 1 };
        }),
      strokes: () => board.strokes.map((s) => s.length),
      crayonHolder: () => crayon.holderLabel,
      tonearmHolder: () => tonearmHolder?.label ?? null,
      tools: () => physics.tools.map((tool) => ({ name: tool.object.name, visible: tool.object.visible, holder: tool.holder?.label ?? null, position: tool.object.position.toArray() })),
      /** Render cost of the last frame (Quest budget checks). */
      renderInfo: () => {
        let meshes = 0;
        scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.visible) meshes++;
        });
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, meshes, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? null };
      },
    };

    // ── Video texture on the painting ────────────────────────────────────
    const textures = new Map<HTMLVideoElement, THREE.VideoTexture>();
    const monitor = new VideoTextureMonitor((h) => propsRef.current.onVideoHealth(h));
    let monitoredTex: THREE.VideoTexture | null = null;
    const videoTex = (v: HTMLVideoElement) => {
      let t = textures.get(v);
      if (!t) {
        t = new THREE.VideoTexture(v);
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        textures.set(v, t);
      }
      return t;
    };
    const sync = () => {
      const p = propsRef.current;
      if (p.showVideo && p.video) {
        const t = videoTex(p.video);
        if (paintMat.map !== t) {
          paintMat.map = t;
          paintMat.needsUpdate = true;
        }
        if (monitoredTex !== t) {
          monitor.setSource(t, p.video);
          monitoredTex = t;
        }
      } else {
        paint(
          placeholder,
          "#efe3c8",
          p.placeholderLines.map((text, i) => ({
            text,
            font: i === 0 ? "italic bold 46px serif" : "32px serif",
            color: i === 0 ? "#5a3c1a" : "#8a6a3a",
          })),
        );
        if (paintMat.map !== placeholder.tex) {
          paintMat.map = placeholder.tex;
          paintMat.needsUpdate = true;
        }
        if (monitoredTex) {
          monitor.setSource(null, null);
          monitoredTex = null;
        }
      }
    };
    api.current = { sync, setHud, setHint };
    sync();
    setHud(propsRef.current.hudLines);
    setHint(propsRef.current.hintText);

    const vrButton = VRButton.createButton(renderer, { optionalFeatures: ["hand-tracking", "local-floor", "bounded-floor"] });
    container.appendChild(vrButton);
    const onStart = () => propsRef.current.onXRSession(true);
    const onEnd = () => { hands.releaseAll(); propsRef.current.onXRSession(false); };
    renderer.xr.addEventListener("sessionstart", onStart);
    renderer.xr.addEventListener("sessionend", onEnd);

    let last = performance.now();
    const tmp = new THREE.Vector3();
    renderer.setAnimationLoop((t) => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      movement.update(dt);
      rig.updateMatrixWorld(true);
      hands.update();
      if (renderer.xr.isPresenting) for (const g of hands.grabbers) if (g.kind === "controller") hands.setRayLength(g, rayTarget(g)?.d ?? null);
      if (tonearmHolder?.tracked) gramophone.drag(tonearmHolder.point);
      gramophone.update(dt, t);
      crayon.update(t);
      eraser.update();
      updateDesktop();
      if(desktopTool?.holder!==desktop)desktopTool=null;
      physics.update(dt);
      physics.highlight(hands.grabbers);
      unity.update(dt);
      // Poke buttons with a fingertip (hands) or the controller tip.
      if (renderer.xr.isPresenting) {
        for (const b of buttons) {
          b.mesh.getWorldPosition(tmp);
          tmp.y += 0.015;
          let near = Infinity;
          for (const g of hands.grabbers) if (g.tracked) near = Math.min(near, g.poke.distanceTo(tmp));
          if (b.armed && near < POKE_R) {
            b.armed = false;
            pressButton(b, "fingertip poke");
          } else if (!b.armed && near > POKE_REARM) b.armed = true;
        }
      }
      if (renderer.xr.isPresenting) {
        for (const t of targets) {
          const zone = t.box.clone().expandByScalar(0.02);
          const inside = hands.grabbers.some((g) => g.tracked && zone.containsPoint(g.poke));
          if (inside && t.armed) {
            t.armed = false;
            fireTarget(t, "touch");
          } else if (!inside) t.armed = true;
        }
      }
      for (const b of buttons) {
        const pressed = now < b.flashUntil;
        b.mat.emissive.setHex(pressed ? 0x666666 : 0x000000);
        b.mesh.scale.y = pressed ? 0.5 : 1;
      }
      const p = propsRef.current;
      const wall = Date.now();
      board.setColour(wall < p.swordFlashUntil ? "right" : wall < p.wrongFlashUntil && Math.floor(wall / 180) % 2 === 0 ? "wrong" : "ink");
      board.update();
      if (!renderer.xr.isPresenting) camera.rotation.set(pitch, yaw, 0, "YXZ");
      monitor.tick(now);
      renderer.render(scene, camera);
      roomAudio.tick(camera, gramophone.group);
    });

    const ro = new ResizeObserver(() => {
      if (renderer.xr.isPresenting) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      renderer.setAnimationLoop(null);
      renderer.xr.removeEventListener("sessionstart", onStart);
      renderer.xr.removeEventListener("sessionend", onEnd);
      void renderer.xr.getSession()?.end().catch(() => undefined);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      movement.dispose();
      hands.dispose();
      unity.dispose();
      physics.dispose();
      board.dispose();
      textures.forEach((t) => t.dispose());
      placeholder.tex.dispose();
      hud.tex.dispose();
      hint.tex.dispose();
      buttons.forEach((b) => b.tex.tex.dispose());
      renderer.dispose();
      vrButton.remove();
      renderer.domElement.remove();
      api.current = null;
      propsRef.current.roomApi.current = null;
      delete (window as unknown as { __puzzleTest?: unknown }).__puzzleTest;
    };
    };

    void initToolPhysics().then(() => fetchScene(PUZZLE_SCENE_ID))
      .catch((e) => {
        debug.push("error", `[puzzle] layout not loaded (${(e as Error).message}) — using the default room`);
        return emptyScene();
      })
      .then((doc) => {
        if (disposed) return;
        const layout = normalizePuzzleScene(doc);
        debug.push("info", `[puzzle] layout "${PUZZLE_SCENE_ID}": ${layout.length} objects${doc.objects.length ? "" : " (default room)"}`);
        teardown = build(layout);
      });
    return () => {
      disposed = true;
      teardown?.();
    };
  }, []);

  const phKey = props.placeholderLines.join("\n");
  useEffect(() => {
    api.current?.sync();
  }, [props.showVideo, props.video, phKey]);
  const hudKey = props.hudLines.join("\n");
  useEffect(() => {
    api.current?.setHud(hudKey.split("\n"));
  }, [hudKey]);
  useEffect(() => {
    api.current?.setHint(props.hintText);
  }, [props.hintText]);

  return <div ref={containerRef} className="relative h-full w-full" />;
}
