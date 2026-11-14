"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import {
  InteractionManager,
  type SelectSource,
} from "../lib/controllerInteraction";
import { VideoTextureMonitor, type VideoHealth } from "../lib/videoTextureHealth";

// Three.js renderer + WebXR + frame loop (brief §6, §7).
//
// Decoupled from Reactor: it receives a <video> element (mock OR live — it
// cannot tell which), button descriptors, HUD text, and calls onSelect(id).
//
// - One video plane (16:9) at ~2.4 m. Swapping sources swaps material.map;
//   each element's VideoTexture is created ONCE and cached.
// - renderer.setAnimationLoop only (no separate rAF loop).
// - No locomotion; physical head movement only.

export type XRButtonDesc = { id: string; label: string; color: number };

export type XRSceneProps = {
  video: HTMLVideoElement | null;
  sourceLabel: string; // e.g. "MOCK" / "LIVE ORBIS"
  buttons: ReadonlyArray<XRButtonDesc>;
  activeId: string | null;
  cooldownUntil: number;
  hudLines: string[];
  onSelect: (id: string, source: SelectSource, detail: string) => void;
  onXRSession: (active: boolean) => void;
  onInputInfo: (sources: string[]) => void;
  /** ~1 Hz report: texture uploads/s, media time advance, rVFC fallback. */
  onVideoHealth: (h: VideoHealth) => void;
};

const PLANE_W = 1.92;
const PLANE_H = 1.08;
const PLANE_POS = new THREE.Vector3(0, 1.6, -2.4);

function makeLabelTexture(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, tex };
}

function drawText(
  canvas: HTMLCanvasElement,
  tex: THREE.CanvasTexture,
  lines: string[],
  opts: { bg: string; fg: string; font: string; align?: CanvasTextAlign },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = opts.fg;
  ctx.font = opts.font;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  const lh = canvas.height / Math.max(lines.length, 1);
  const x = opts.align === "center" ? canvas.width / 2 : 16;
  lines.forEach((l, i) => ctx.fillText(l, x, lh * (i + 0.5), canvas.width - 24));
  tex.needsUpdate = true;
}

export function XRScene(props: XRSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Latest props for the imperative loop, without re-creating the renderer.
  const propsRef = useRef(props);
  propsRef.current = props;

  const sceneApi = useRef<{
    setVideo: (v: HTMLVideoElement | null) => void;
    setHud: (lines: string[]) => void;
    setSourceLabel: (s: string) => void;
  } | null>(null);

  // ── One-time setup ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local-floor");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0d12);

    const camera = new THREE.PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      0.05,
      50,
    );
    camera.position.set(0, 1.5, 0.6);
    camera.lookAt(0, 1.35, -2.4);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 3, 2);
    scene.add(dir);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ color: 0x1b1d26, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(12, 24, 0x333849, 0x23262f);
    grid.position.y = 0.001;
    scene.add(grid);

    // Video plane + frame. MeshBasicMaterial, toneMapped:false (brief Gate C).
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(PLANE_W + 0.08, PLANE_H + 0.08, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x050507 }),
    );
    frame.position.copy(PLANE_POS).add(new THREE.Vector3(0, 0, -0.025));
    scene.add(frame);

    const noSignal = makeLabelTexture(832, 468);
    drawText(noSignal.canvas, noSignal.tex, ["NO VIDEO SOURCE"], {
      bg: "#000",
      fg: "#666",
      font: "bold 48px sans-serif",
      align: "center",
    });
    const videoMat = new THREE.MeshBasicMaterial({
      map: noSignal.tex,
      toneMapped: false,
    });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANE_W, PLANE_H),
      videoMat,
    );
    plane.position.copy(PLANE_POS);
    scene.add(plane);

    // Source label above the plane (MOCK must be visibly labelled).
    const srcLabel = makeLabelTexture(512, 64);
    const srcLabelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.1),
      new THREE.MeshBasicMaterial({
        map: srcLabel.tex,
        toneMapped: false,
        transparent: true,
      }),
    );
    srcLabelMesh.position.copy(PLANE_POS).add(new THREE.Vector3(0, PLANE_H / 2 + 0.09, 0));
    scene.add(srcLabelMesh);

    // Headset-safe HUD under the plane.
    const hud = makeLabelTexture(1024, 192);
    const hudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANE_W, PLANE_W * (192 / 1024)),
      new THREE.MeshBasicMaterial({ map: hud.tex, toneMapped: false }),
    );
    hudMesh.position
      .copy(PLANE_POS)
      .add(new THREE.Vector3(0, -PLANE_H / 2 - 0.25, 0));
    scene.add(hudMesh);

    // Two large selectable buttons, angled toward the viewer.
    type Btn = {
      id: string;
      mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
      face: THREE.MeshBasicMaterial;
      base: THREE.Color;
      flashUntil: number;
    };
    const btns: Btn[] = [];
    const interaction = new InteractionManager({
      renderer,
      scene,
      camera,
      onSelect: (id, src, detail) => {
        // Flash the pressed button immediately (local acknowledgment only).
        const b = btns.find((x) => x.id === id);
        if (b) b.flashUntil = performance.now() + 400;
        propsRef.current.onSelect(id, src, detail);
      },
      onInputInfo: (s) => propsRef.current.onInputInfo(s),
    });
    propsRef.current.buttons.forEach((b, i, arr) => {
      // Low and wide so they never occlude the HUD under the video plane.
      const x = (i - (arr.length - 1) / 2) * 1.5;
      const mat = new THREE.MeshStandardMaterial({
        color: b.color,
        emissive: 0x000000,
        roughness: 0.5,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.12), mat);
      mesh.position.set(x, 0.65, -1.5);
      mesh.lookAt(0, 1.5, 0.3);
      const label = makeLabelTexture(512, 256);
      drawText(label.canvas, label.tex, [b.label], {
        bg: `#${b.color.toString(16).padStart(6, "0")}`,
        fg: "#ffffff",
        font: "bold 84px sans-serif",
        align: "center",
      });
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.56, 0.28),
        new THREE.MeshBasicMaterial({ map: label.tex, toneMapped: false }),
      );
      face.position.z = 0.061;
      mesh.add(face);
      scene.add(mesh);
      interaction.register(mesh, b.id);
      btns.push({
        id: b.id,
        mesh,
        face: face.material,
        base: new THREE.Color(b.color),
        flashUntil: 0,
      });
    });

    // ── Video texture cache: one VideoTexture per element, reused. ──────────
    const textures = new Map<HTMLVideoElement, THREE.VideoTexture>();
    const monitor = new VideoTextureMonitor((h) => propsRef.current.onVideoHealth(h));
    const setVideo = (v: HTMLVideoElement | null) => {
      if (!v) {
        videoMat.map = noSignal.tex;
        monitor.setSource(null, null);
      } else {
        let tex = textures.get(v);
        if (!tex) {
          tex = new THREE.VideoTexture(v);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          textures.set(v, tex);
        }
        videoMat.map = tex;
        monitor.setSource(tex, v);
      }
      videoMat.needsUpdate = true;
    };
    const setHud = (lines: string[]) =>
      drawText(hud.canvas, hud.tex, lines, {
        bg: "#0b0c10",
        fg: "#d8dbe6",
        font: "30px monospace",
      });
    const setSourceLabel = (s: string) =>
      drawText(srcLabel.canvas, srcLabel.tex, [s], {
        bg: s.startsWith("MOCK") ? "#7a1010" : "#0e5a2a",
        fg: "#ffffff",
        font: "bold 40px sans-serif",
        align: "center",
      });
    sceneApi.current = { setVideo, setHud, setSourceLabel };
    setVideo(propsRef.current.video);
    setHud(propsRef.current.hudLines);
    setSourceLabel(propsRef.current.sourceLabel);

    // ── VR entry (user-initiated) ───────────────────────────────────────────
    const vrButton = VRButton.createButton(renderer);
    container.appendChild(vrButton);
    const onStart = () => propsRef.current.onXRSession(true);
    const onEnd = () => propsRef.current.onXRSession(false);
    renderer.xr.addEventListener("sessionstart", onStart);
    renderer.xr.addEventListener("sessionend", onEnd);

    // ── Frame loop ─────────────────────────────────────────────────────────
    renderer.setAnimationLoop(() => {
      interaction.update();
      const now = performance.now();
      const { activeId, cooldownUntil } = propsRef.current;
      const cooling = Date.now() < cooldownUntil;
      for (const b of btns) {
        const hovered = interaction.hovered.has(b.id);
        const m = b.mesh.material;
        if (now < b.flashUntil) m.emissive.setHex(0xffffff).multiplyScalar(0.6);
        else if (hovered && !cooling) m.emissive.setHex(0x444444);
        else m.emissive.setHex(0x000000);
        m.color.copy(b.base);
        if (cooling) m.color.multiplyScalar(0.35);
        // Label face: dim while cooling, brighten when hovered / flashing.
        const k = now < b.flashUntil ? 1.6 : cooling ? 0.35 : hovered ? 1.25 : 1;
        b.face.color.setScalar(k);
        const s = b.id === activeId ? 1.1 : hovered ? 1.05 : 1;
        b.mesh.scale.setScalar(s);
      }
      monitor.tick(now);
      renderer.render(scene, camera);
    });

    // ── Resize (never while presenting) ──────────────────────────────────────
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
      interaction.dispose();
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      vrButton.remove();
      renderer.domElement.remove();
      sceneApi.current = null;
    };
  }, []);

  // ── Prop-driven updates (no renderer re-creation) ─────────────────────────
  useEffect(() => {
    sceneApi.current?.setVideo(props.video);
  }, [props.video]);
  const hudKey = props.hudLines.join("\n");
  useEffect(() => {
    sceneApi.current?.setHud(hudKey.split("\n"));
  }, [hudKey]);
  useEffect(() => {
    sceneApi.current?.setSourceLabel(props.sourceLabel);
  }, [props.sourceLabel]);

  return <div ref={containerRef} className="relative h-full w-full" />;
}
