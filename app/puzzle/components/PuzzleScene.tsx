"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { VideoTextureMonitor, type VideoHealth } from "../../mvp/lib/videoTextureHealth";
import { debug } from "../../mvp/lib/debugState";
import { DrawingBoard } from "../lib/drawingBoard";
import { HandInput, type Grabber } from "../lib/handInput";
import { Crayon, type DrawMode } from "../lib/crayon";
import { Gramophone } from "../lib/gramophone";
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
//   easel      : wooden A-frame easel with a canvas + crayon on the ledge
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
    addRoomLights(scene);
    const shell = buildShell();
    scene.add(shell);

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
          return { g, builtin: o.asset.startsWith("builtin:") };
        }),
      );
    // Phase E: once every piece exists, merge the shell + built-in decor per
    // material (no multiview in this three version → each mesh costs one
    // draw call PER EYE in VR). GLB imports stay as they are.
    void Promise.all(decorJobs).then((items) => {
      if (disposed) return;
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
    const gramophone = new Gramophone((on) => propsRef.current.onSound(on));
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
      propsRef.current.onButton(b.id, detail);
    };

    scene.updateMatrixWorld(true);
    const crayonRest = mount.localToWorld(new THREE.Vector3(0.28, -BOARD_H / 2 + 0.008, 0.06));
    const crayonRestQ = mount.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));

    // ── Interaction: hands / controllers ─────────────────────────────────
    const crayon = new Crayon({
      board,
      restPosition: crayonRest,
      restQuaternion: crayonRestQ,
      onStrokeEnd: (src) => propsRef.current.onStrokeEnd(board.strokes, src),
      onHolder: (h) => propsRef.current.onCrayonHolder(h),
      onMode: (m) => propsRef.current.onDrawMode(m),
      pulse: (g, v, ms) => hands.pulse(g, v, ms),
    });
    scene.add(crayon.object);
    let tonearmHolder: Grabber | null = null;
    // Controller pointer-ray targets (Phase E): RESET / CLEAR / gramophone.
    const rayCaster = new THREE.Raycaster();
    const rayTarget = (g: Grabber): { kind: "button"; b: PokeButton; d: number } | { kind: "gramophone"; d: number } | null => {
      const r = hands.pointerRay(g);
      if (!r) return null;
      rayCaster.ray.copy(r);
      rayCaster.far = 4;
      const hit = rayCaster.intersectObjects([...buttons.map((b) => b.mesh), gramophone.group], true)[0];
      if (!hit) return null;
      const b = buttons.find((x) => x.mesh === hit.object);
      return b ? { kind: "button", b, d: hit.distance } : { kind: "gramophone", d: hit.distance };
    };
    const hands = new HandInput({
      renderer,
      scene,
      onPinchStart: (g) => {
        if (crayon.tryGrab(g)) return;
        if (!tonearmHolder && gramophone.tryGrab(g.point)) {
          tonearmHolder = g;
          propsRef.current.onTonearmHolder(g.label);
          hands.pulse(g, 0.4, 40);
          return;
        }
        // Controllers only: nothing in reach → use the pointer ray.
        const hit = rayTarget(g);
        if (hit?.kind === "button") {
          pressButton(hit.b, `controller ray (${g.label})`);
          hands.pulse(g, 0.5, 40);
        } else if (hit?.kind === "gramophone") {
          gramophone.toggle();
          hands.pulse(g, 0.5, 40);
        }
      },
      onPinchEnd: (g) => {
        crayon.release(g);
        if (tonearmHolder === g) {
          gramophone.release();
          tonearmHolder = null;
          propsRef.current.onTonearmHolder(null);
        }
      },
      onInputInfo: (s) => propsRef.current.onInputInfo(s),
    });

    const resetRoom = () => {
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
      const targets: THREE.Object3D[] = [board.mesh, gramophone.group, ...buttons.map((b) => b.mesh)];
      const hit = raycaster.intersectObjects(targets, true)[0];
      if (!hit) return null;
      if (hit.object === board.mesh && hit.uv) return { kind: "board" as const, p: board.uvToBoard(hit.uv) };
      const b = buttons.find((x) => x.mesh === hit.object);
      if (b) return { kind: "button" as const, b };
      return { kind: "gramophone" as const };
    };
    let mouseDrawing = false;
    const onDown = (ev: PointerEvent) => {
      if (renderer.xr.isPresenting || ev.button !== 0) return;
      const h = pick(ev);
      if (!h) return;
      if (h.kind === "board") {
        mouseDrawing = true;
        el.setPointerCapture(ev.pointerId);
        crayon.mouseBegin(h.p);
      } else if (h.kind === "button") pressButton(h.b, "desktop mouse");
      else gramophone.toggle();
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
      strokes: () => board.strokes.map((s) => s.length),
      crayonHolder: () => crayon.holderLabel,
      tonearmHolder: () => tonearmHolder?.label ?? null,
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
    const onEnd = () => propsRef.current.onXRSession(false);
    renderer.xr.addEventListener("sessionstart", onStart);
    renderer.xr.addEventListener("sessionend", onEnd);

    let last = performance.now();
    const tmp = new THREE.Vector3();
    renderer.setAnimationLoop((t) => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      hands.update();
      if (renderer.xr.isPresenting) for (const g of hands.grabbers) if (g.kind === "controller") hands.setRayLength(g, rayTarget(g)?.d ?? null);
      if (tonearmHolder?.tracked) gramophone.drag(tonearmHolder.point);
      gramophone.update(dt, t);
      crayon.update(t);
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
      hands.dispose();
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

    void fetchScene(PUZZLE_SCENE_ID)
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
