"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { InteractionManager, type SelectSource } from "../../mvp/lib/controllerInteraction";
import { VideoTextureMonitor, type VideoHealth } from "../../mvp/lib/videoTextureHealth";
import type { RoomAction, RoomConfig } from "../roomConfigs";

// Six rooms arranged as a hexagon around the viewer (no locomotion: the
// viewer turns physically). Room i sits at yaw i·60°, room 0 straight ahead
// (-Z). Each room: back wall, 16:9 canvas, style label, APPROACH / POINT
// buttons. Partition walls separate neighbours.
//
// Selection target ids (InteractionManager):
//   canvas:<roomId>              → activate that room
//   act:<roomId>:approach|point  → action for THAT room only
//
// Only the active room's canvas ever shows the video texture; every other
// canvas shows its own static labelled placeholder.

export type RoomsSceneProps = {
  rooms: ReadonlyArray<RoomConfig>;
  activeRoomId: string | null;
  /** Show video on the active canvas (false → active placeholder with status). */
  showVideo: boolean;
  video: HTMLVideoElement | null;
  /** Status line for the active room's placeholder while not showing video. */
  activeStatus: string;
  ackedAction: RoomAction | null;
  cooldownUntil: number;
  modeLabel: string; // "MOCK" | "LIVE"
  hudLines: string[];
  onSelect: (targetId: string, source: SelectSource, detail: string) => void;
  onXRSession: (active: boolean) => void;
  onInputInfo: (sources: string[]) => void;
  onVideoHealth: (h: VideoHealth) => void;
};

const CANVAS_W = 1.92;
const CANVAS_H = 1.08;
const CANVAS_Y = 1.6;
const CANVAS_Z = -2.6;
const BUTTON_Z = -1.6;
const BUTTON_Y = 0.85;
const STEP = (Math.PI * 2) / 6;

function hex(c: number) {
  return `#${c.toString(16).padStart(6, "0")}`;
}

function makeCanvasTex(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, tex };
}

function paint(
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

type RoomObj = {
  cfg: RoomConfig;
  group: THREE.Group;
  canvasMat: THREE.MeshBasicMaterial;
  placeholder: ReturnType<typeof makeCanvasTex>;
  frameMat: THREE.MeshBasicMaterial;
  buttons: Array<{
    action: Exclude<RoomAction, "initial">;
    mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
    face: THREE.MeshBasicMaterial;
    base: THREE.Color;
    flashUntil: number;
  }>;
};

export function RoomsScene(props: RoomsSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const api = useRef<{ sync: () => void; setHud: (l: string[]) => void } | null>(null);

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
    scene.background = new THREE.Color(0x0b0c11);
    const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.05, 50);
    camera.position.set(0, 1.55, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(0, 4, 0);
    scene.add(dir);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4, 6),
      new THREE.MeshStandardMaterial({ color: 0x17181f, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.rotation.z = Math.PI / 6;
    scene.add(floor);

    // Partition walls on the boundaries between rooms.
    const partitionMat = new THREE.MeshStandardMaterial({ color: 0x0f1016, roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const b = i * STEP + STEP / 2;
      const len = 1.8;
      const r = 1.15 + len / 2;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.7, len), partitionMat);
      wall.position.set(Math.sin(b) * r, 1.35, -Math.cos(b) * r);
      wall.rotation.y = -b;
      scene.add(wall);
    }

    const interaction = new InteractionManager({
      renderer,
      scene,
      camera,
      onSelect: (id, src, detail) => {
        const m = /^act:(.+):(approach|point)$/.exec(id);
        if (m) {
          const b = rooms.find((r) => r.cfg.id === m[1])?.buttons.find((x) => x.action === m[2]);
          if (b) b.flashUntil = performance.now() + 400;
        }
        propsRef.current.onSelect(id, src, detail);
      },
      onInputInfo: (s) => propsRef.current.onInputInfo(s),
    });

    // ── Rooms ────────────────────────────────────────────────────────────────
    const rooms: RoomObj[] = propsRef.current.rooms.map((cfg, i) => {
      const group = new THREE.Group();
      group.rotation.y = -i * STEP; // local -Z → yaw i·60°
      scene.add(group);
      const accent = new THREE.Color(cfg.accent);

      const backWall = new THREE.Mesh(
        new THREE.PlaneGeometry(3.0, 2.9),
        new THREE.MeshStandardMaterial({ color: accent.clone().multiplyScalar(0.18), roughness: 1 }),
      );
      backWall.position.set(0, 1.45, CANVAS_Z - 0.12);
      group.add(backWall);

      const frameMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.35) });
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(CANVAS_W + 0.1, CANVAS_H + 0.1), frameMat);
      frame.position.set(0, CANVAS_Y, CANVAS_Z - 0.01);
      group.add(frame);

      const placeholder = makeCanvasTex(832, 468);
      const canvasMat = new THREE.MeshBasicMaterial({ map: placeholder.tex, toneMapped: false });
      const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(CANVAS_W, CANVAS_H), canvasMat);
      canvasMesh.position.set(0, CANVAS_Y, CANVAS_Z);
      group.add(canvasMesh);
      interaction.register(canvasMesh, `canvas:${cfg.id}`);

      const label = makeCanvasTex(1024, 96);
      paint(label, hex(cfg.accent), [{ text: cfg.label, font: "bold 52px sans-serif", color: "#ffffff" }]);
      const labelMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 1.9 * (96 / 1024)),
        new THREE.MeshBasicMaterial({ map: label.tex, toneMapped: false }),
      );
      labelMesh.position.set(0, CANVAS_Y + CANVAS_H / 2 + 0.17, CANVAS_Z);
      group.add(labelMesh);

      const buttons: RoomObj["buttons"] = (["approach", "point"] as const).map((action, k) => {
        const base = accent.clone().multiplyScalar(k === 0 ? 0.9 : 0.6);
        const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.5 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.1), mat);
        mesh.position.set(k === 0 ? -0.42 : 0.42, BUTTON_Y, BUTTON_Z);
        mesh.rotation.x = -0.35;
        const tex = makeCanvasTex(512, 256);
        paint(tex, hex(base.getHex()), [{ text: action.toUpperCase(), font: "bold 92px sans-serif", color: "#ffffff" }]);
        const face = new THREE.MeshBasicMaterial({ map: tex.tex, toneMapped: false });
        const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.47, 0.21), face);
        faceMesh.position.z = 0.051;
        mesh.add(faceMesh);
        group.add(mesh);
        interaction.register(mesh, `act:${cfg.id}:${action}`);
        return { action, mesh, face, base, flashUntil: 0 };
      });

      return { cfg, group, canvasMat, placeholder, frameMat, buttons };
    });

    // ── HUD (one, re-parented under the active room's canvas) ───────────────
    const hud = makeCanvasTex(1024, 160);
    const hudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CANVAS_W, CANVAS_W * (160 / 1024)),
      new THREE.MeshBasicMaterial({ map: hud.tex, toneMapped: false }),
    );
    hudMesh.position.set(0, CANVAS_Y - CANVAS_H / 2 - 0.22, CANVAS_Z);
    hudMesh.visible = false;
    const setHud = (lines: string[]) =>
      paint(
        hud,
        "#0b0c10",
        lines.map((t) => ({ text: t, font: "28px monospace", color: "#d8dbe6" })),
        "left",
      );

    // ── Video texture: one per element, reused; only on the active canvas ──
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

    // Desktop view: turn toward the active room (XR uses head pose).
    let targetYaw = 0;

    const sync = () => {
      const p = propsRef.current;
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        const active = r.cfg.id === p.activeRoomId;
        const accent = new THREE.Color(r.cfg.accent);
        r.frameMat.color.copy(accent).multiplyScalar(active ? 1.0 : 0.3);
        if (active) {
          targetYaw = -i * STEP;
          if (hudMesh.parent !== r.group) r.group.add(hudMesh);
          hudMesh.visible = true;
        }
        if (active && p.showVideo && p.video) {
          const t = videoTex(p.video);
          if (r.canvasMat.map !== t) {
            r.canvasMat.map = t;
            r.canvasMat.needsUpdate = true;
          }
          if (monitoredTex !== t) {
            monitor.setSource(t, p.video);
            monitoredTex = t;
          }
        } else {
          paint(r.placeholder, hex(accent.clone().multiplyScalar(active ? 0.3 : 0.14).getHex()), [
            { text: active ? "ACTIVE" : "INACTIVE", font: "bold 40px sans-serif", color: active ? "#ffffff" : "#8a8d99" },
            { text: r.cfg.label, font: "bold 46px sans-serif", color: "#ffffff" },
            {
              text: active ? p.activeStatus : "point here + trigger to activate",
              font: "32px sans-serif",
              color: active ? "#ffd27a" : "#9a9daa",
            },
            { text: `${p.modeLabel} · placeholder (no video)`, font: "24px monospace", color: "#6d7080" },
          ]);
          if (r.canvasMat.map !== r.placeholder.tex) {
            r.canvasMat.map = r.placeholder.tex;
            r.canvasMat.needsUpdate = true;
          }
          if (active && monitoredTex) {
            monitor.setSource(null, null);
            monitoredTex = null;
          }
        }
      }
      if (!p.activeRoomId) hudMesh.visible = false;
    };
    api.current = { sync, setHud };
    sync();
    setHud(propsRef.current.hudLines);

    const vrButton = VRButton.createButton(renderer);
    container.appendChild(vrButton);
    const onStart = () => propsRef.current.onXRSession(true);
    const onEnd = () => propsRef.current.onXRSession(false);
    renderer.xr.addEventListener("sessionstart", onStart);
    renderer.xr.addEventListener("sessionend", onEnd);

    let yaw = 0;
    renderer.setAnimationLoop(() => {
      interaction.update();
      const now = performance.now();
      const p = propsRef.current;
      const cooling = Date.now() < p.cooldownUntil;
      for (const r of rooms) {
        const active = r.cfg.id === p.activeRoomId;
        for (const b of r.buttons) {
          const hovered = interaction.hovered.has(`act:${r.cfg.id}:${b.action}`);
          const m = b.mesh.material;
          m.color.copy(b.base);
          if (!active) m.color.multiplyScalar(0.25);
          else if (cooling) m.color.multiplyScalar(0.45);
          m.emissive.setHex(now < b.flashUntil ? 0x777777 : hovered && active ? 0x333333 : 0x000000);
          b.face.color.setScalar(!active ? 0.3 : now < b.flashUntil ? 1.6 : cooling ? 0.45 : hovered ? 1.25 : 1);
          b.mesh.scale.setScalar(active && b.action === p.ackedAction ? 1.1 : 1);
        }
      }
      if (!renderer.xr.isPresenting) {
        yaw += (targetYaw - yaw) * 0.12;
        camera.rotation.set(-0.05, yaw, 0, "YXZ");
      }
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
      interaction.dispose();
      textures.forEach((t) => t.dispose());
      rooms.forEach((r) => r.placeholder.tex.dispose());
      hud.tex.dispose();
      renderer.dispose();
      vrButton.remove();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  // Re-sync canvases when anything that affects them changes.
  useEffect(() => {
    api.current?.sync();
  }, [props.activeRoomId, props.showVideo, props.video, props.activeStatus, props.modeLabel]);
  const hudKey = props.hudLines.join("\n");
  useEffect(() => {
    api.current?.setHud(hudKey.split("\n"));
  }, [hudKey]);

  return <div ref={containerRef} className="relative h-full w-full" />;
}
