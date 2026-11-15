"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { applyTransform, createInstance, fetchScene, readTransform, type BuiltinResolver } from "../lib/sceneData/environment";
import { DEFAULT_SCENE_ID, SCENE_VERSION, type SceneDoc, type SceneObject, type Vec3 } from "../lib/sceneData/types";
import { MVP_RUNTIME_LAYOUT } from "../mvp/components/XRScene";
import { ObjectComponents, RoomAudioSettings, type ComponentItem } from "./PuzzleSettings";
import { checkPuzzles } from "../lib/sceneData/components";
import { applyEnvironment } from "../puzzle/lib/lookdev";
import {
  addRoomLights,
  buildBuiltinPreview,
  buildShell,
  BUILTIN,
  DECOR_KINDS,
  isSingletonAsset,
  normalizePuzzleScene,
} from "../puzzle/lib/roomParts";
import { initToolPhysics, ToolPhysics } from "../puzzle/lib/toolPhysics";
import { UnityRoom } from "../puzzle/lib/unityRoom";
import { dressProps } from "../puzzle/lib/propModels";
import type { DrawingBoard } from "../puzzle/lib/drawingBoard";
import { PAINTING_HOME } from "../puzzle/roomLayout";

// Desktop Scene Editor for the shared environment of /mvp.
//
// Edits ONLY data/scenes/<id>.json (GLB instances + transforms). The runtime
// objects of /mvp (video plane, buttons, HUD, controllers) are drawn here as
// locked, semi-transparent reference shapes so assets can be placed around
// them — they are not selectable and never saved.
//
// Every change is auto-saved to the server (debounced), so a refresh — or the
// headset loading /mvp — sees it. The server keeps <id>.prev.json and
// timestamped backups.

type Mode = "translate" | "rotate" | "scale";
/** Hierarchy entry; components (puzzle / painting) travel with it. */
type Item = ComponentItem;
type AssetInfo = { file: string; url: string; bytes: number };

const AUTOSAVE_MS = 700;
const newId = () => `obj_${Math.random().toString(36).slice(2, 10)}`;
const assetLabel = (url: string) => decodeURIComponent(url.split("/").pop() ?? url);

function makeLabel(text: string, w = 512, h = 96) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffd27a";
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2, w - 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Locked reference shapes for the /mvp runtime-only objects. */
function buildRuntimeReference(): THREE.Group {
  const g = new THREE.Group();
  g.name = "runtime-reference (locked)";
  const L = MVP_RUNTIME_LAYOUT;
  const ghost = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(L.plane.w, L.plane.h), ghost(0x2f7fff));
  plane.position.set(...L.plane.pos);
  g.add(plane);
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.225), new THREE.MeshBasicMaterial({ map: makeLabel("Orbis video plane (runtime)"), transparent: true }));
  lbl.position.set(L.plane.pos[0], L.plane.pos[1], L.plane.pos[2] + 0.01);
  g.add(lbl);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(...L.buttons.size), ghost(0xff8a3d));
    b.position.set((i - 0.5) * L.buttons.spacing, L.buttons.y, L.buttons.z);
    b.lookAt(...L.buttons.lookAt);
    g.add(b);
  }
  g.add(viewerMarker());
  g.traverse((o) => (o.userData.locked = true));
  return g;
}

/** Viewer: standing spot + eye height + facing direction (-Z). */
function viewerMarker() {
  const g = new THREE.Group();
  const eye = MVP_RUNTIME_LAYOUT.viewer.eyeHeight;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, eye, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x40d080, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  body.position.y = eye / 2;
  g.add(body);
  g.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, eye, 0), 0.6, 0x40d080));
  return g;
}

/** Per-scene editor setup. Each scene id is one file in data/scenes/. */
type Profile = {
  label: string;
  lights: (scene: THREE.Scene) => void;
  /** Locked, non-selectable reference shapes (runtime-only objects). */
  reference: () => THREE.Object3D;
  builtins?: BuiltinResolver;
  /** Saved doc → objects to edit (e.g. fill in the default room). */
  normalize?: (doc: SceneDoc) => SceneObject[];
  /** Built-in pieces the user can add more of. */
  palette?: Array<{ asset: string; label: string }>;
  /** Required pieces: movable, but not deletable / duplicable. */
  required?: (asset: string) => boolean;
  camera: { position: Vec3; target: Vec3 };
  floorAndGrid: boolean;
  lockedNote: string;
};

const PROFILES: Record<string, Profile> = {
  mvp: {
    label: "/mvp (Orbis XR MVP)",
    lights: (scene) => {
      scene.background = new THREE.Color(0x0c0d12);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2));
      const dir = new THREE.DirectionalLight(0xffffff, 1.2);
      dir.position.set(1, 3, 2);
      scene.add(dir);
    },
    reference: buildRuntimeReference,
    camera: { position: [3.2, 2.6, 2.8], target: [0, 1, -1.2] },
    floorAndGrid: true,
    lockedNote: "Locked (runtime, not editable): Orbis video plane, buttons, viewer.",
  },
  puzzle: {
    label: "/puzzle (princess room)",
    lights: addRoomLights,
    reference: () => {
      const g = new THREE.Group();
      g.name = "runtime-reference (locked)";
      const shell = buildShell();
      const ceiling = shell.getObjectByName("ceiling");
      if (ceiling) ceiling.visible = false; // so the room can be seen from above
      g.add(shell, viewerMarker());
      g.traverse((o) => (o.userData.locked = true));
      // Gameplay props (key enclosure + rope, sword rack with hammer and
      // swords, Magic Portrait Box, silence seal) are built in code by the
      // /puzzle runtime, not stored in the scene file. Show them here as a
      // locked preview, built by the same code at the default painting
      // position (roomLayout.RESCUE_LAYOUT).
      void initToolPhysics().then(() => {
        const painting = new THREE.Group();
        painting.position.set(...PAINTING_HOME);
        painting.updateMatrixWorld(true);
        const board = { strokes: [], boardToWorld: () => new THREE.Vector3(0, -10, 0) } as unknown as DrawingBoard;
        const unity = new UnityRoom(new ToolPhysics(), painting, board, () => {});
        dressProps(unity);
        unity.group.name = "gameplay props (locked preview)";
        unity.group.traverse((o) => (o.userData.locked = true));
        g.add(unity.group);
      });
      return g;
    },
    builtins: buildBuiltinPreview,
    normalize: normalizePuzzleScene,
    palette: DECOR_KINDS.map((k) => ({ asset: BUILTIN + k, label: k })),
    required: isSingletonAsset,
    camera: { position: [3.4, 3.4, 2.4], target: [0, 0.9, -1.6] },
    floorAndGrid: false,
    lockedNote: "Locked: room shell (octagon, 5.6 m across), viewer, gameplay props (key + rope, sword rack + hammer, portrait box, seal: placed in app/puzzle/roomLayout.ts). Required (move only): painting, easel, gramophone, pedestal.",
  },
};
const profileFor = (id: string) => PROFILES[id] ?? PROFILES.mvp;

/** Number input that tolerates partial typing ("-", "1.") and commits valid
 *  numbers live; shows the object's value again when not focused. */
function NumField({ value, step, onCommit }: { value: number; step: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text ?? String(value)}
      onFocus={() => setText(String(value))}
      onChange={(e) => {
        setText(e.target.value);
        if (/^-?\d+(\.\d+)?$/.test(e.target.value.trim())) onCommit(parseFloat(e.target.value));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const v = Math.round((value + (e.key === "ArrowUp" ? step : -step)) * 1e4) / 1e4;
          setText(String(v));
          onCommit(v);
        } else if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => setText(null)}
      className="w-full min-w-0 rounded bg-zinc-900 px-1 py-0.5 font-mono"
    />
  );
}

export function EditorApp() {
  const sceneId = useRef(DEFAULT_SCENE_ID);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const three = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    gizmo: TransformControls;
    env: THREE.Group;
    objects: Map<string, THREE.Group>;
  } | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [sid, setSid] = useState(DEFAULT_SCENE_ID);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("translate");
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [status, setStatus] = useState("loading…");
  const [dirty, setDirty] = useState(0); // bumps on every change
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Version this tab is based on (sent with every save; the server refuses a
  // save if the file changed on disk since — a stale tab can't overwrite).
  const baseSavedAt = useRef<string | null>(null);
  const [, setTick] = useState(0); // re-render Inspector after gizmo drags
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const markDirty = useCallback(() => setDirty((d) => d + 1), []);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    sceneId.current = new URLSearchParams(window.location.search).get("scene") ?? DEFAULT_SCENE_ID;
    const profile = profileFor(sceneId.current);
    profileRef.current = profile;
    setSid(sceneId.current);

    // Same background + lights as the runtime scene, so placement looks the same.
    const scene = new THREE.Scene();
    profile.lights(scene);
    // Princess room: same tone mapping + reflection environment as /puzzle
    // (its metallic gold needs the environment; shadows stay runtime-only).
    let disposeEnv = () => {};
    if (sceneId.current === "puzzle") {
      renderer.toneMapping = THREE.NeutralToneMapping;
      disposeEnv = applyEnvironment(renderer, scene, 0.55, { global: true }); // desktop editor: full look
    }
    if (profile.floorAndGrid) {
      scene.add(new THREE.GridHelper(12, 24, 0x333849, 0x23262f));
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x1b1d26, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.001;
      scene.add(floor);
    } else {
      const grid = new THREE.GridHelper(12, 48, 0x6a5a8a, 0x4a3f63);
      grid.position.y = 0.002;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.35;
      scene.add(grid);
    }
    scene.add(new THREE.AxesHelper(0.5));
    scene.add(profile.reference());

    const env = new THREE.Group();
    env.name = "environment";
    scene.add(env);

    const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.02, 200);
    camera.position.fromArray(profile.camera.position);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.fromArray(profile.camera.target);
    orbit.enableDamping = true;
    orbit.update();

    const gizmo = new TransformControls(camera, renderer.domElement);
    scene.add(gizmo.getHelper());
    gizmo.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !(e as unknown as { value: boolean }).value;
    });
    gizmo.addEventListener("objectChange", () => setTick((t) => t + 1));
    gizmo.addEventListener("mouseUp", () => markDirty());

    const objects = new Map<string, THREE.Group>();
    three.current = { scene, camera, orbit, gizmo, env, objects };

    // Click-to-select (ignore drags and gizmo interaction).
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || gizmo.dragging || gizmo.axis) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(env.children, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && o.parent !== env) o = o.parent;
      setSelected((o?.userData.sceneId as string | undefined) ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    renderer.setAnimationLoop(() => {
      orbit.update();
      renderer.render(scene, camera);
    });
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    // Load the saved scene.
    let cancelled = false;
    (async () => {
      try {
        const doc = await fetchScene(sceneId.current);
        const list = profile.normalize ? profile.normalize(doc) : doc.objects;
        const errors: string[] = [];
        const built = await Promise.all(list.map((o) => createInstance(o, (m) => errors.push(m), profile.builtins)));
        if (cancelled) return;
        built.forEach((g, i) => {
          env.add(g);
          objects.set(list[i].id, g);
        });
        setItems(list.map((o) => ({ id: o.id, name: o.name, asset: o.asset, puzzle: o.puzzle, painting: o.painting })));
        setSavedAt(doc.savedAt ?? null);
        baseSavedAt.current = doc.savedAt ?? null;
        const note = doc.objects.length === 0 && list.length > 0 ? " — default layout, saved on first change" : "";
        setStatus(errors.length ? `loaded with errors: ${errors.join("; ")}` : `loaded "${sceneId.current}" (${list.length} objects)${note}`);
      } catch (e) {
        setStatus(`load failed: ${(e as Error).message} — not saving until fixed`);
        loadFailed.current = true;
      }
      loaded.current = true;
    })();
    void refreshAssets();

    return () => {
      cancelled = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      gizmo.dispose();
      orbit.dispose();
      disposeEnv();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loaded = useRef(false);
  const profileRef = useRef<Profile>(PROFILES.mvp);
  const loadFailed = useRef(false);

  // ── Gizmo follows selection / mode ──────────────────────────────────────
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const obj = selected ? t.objects.get(selected) : undefined;
    if (obj) t.gizmo.attach(obj);
    else t.gizmo.detach();
  }, [selected, items]);
  useEffect(() => {
    three.current?.gizmo.setMode(mode);
  }, [mode]);

  // ── Serialize + autosave ────────────────────────────────────────────────
  const serialize = useCallback((): SceneDoc => {
    const t = three.current!;
    const objects: SceneObject[] = itemsRef.current.flatMap((it) => {
      const g = t.objects.get(it.id);
      return g
        ? [{ id: it.id, name: it.name, asset: it.asset, ...readTransform(g), ...(it.puzzle ? { puzzle: it.puzzle } : {}), ...(it.painting ? { painting: it.painting } : {}) }]
        : [];
    });
    return { version: SCENE_VERSION, objects };
  }, []);

  const save = useCallback(async () => {
    if (!three.current || !loaded.current || loadFailed.current) return;
    setStatus("saving…");
    try {
      const r = await fetch(`/api/scene?id=${encodeURIComponent(sceneId.current)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Scene-Base": baseSavedAt.current ?? "none" },
        body: JSON.stringify(serialize()),
      });
      const body = (await r.json()) as SceneDoc & { error?: string };
      if (r.status === 409) {
        setStatus("SAVE BLOCKED: the scene file changed on disk (another tab or tool). Reload the editor to continue — your unsaved changes here were NOT written.");
        return;
      }
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setSavedAt(body.savedAt ?? null);
      baseSavedAt.current = body.savedAt ?? null;
      setStatus(`saved ${body.objects.length} objects`);
    } catch (e) {
      setStatus(`SAVE FAILED: ${(e as Error).message}`);
    }
  }, [serialize]);

  useEffect(() => {
    if (!dirty) return;
    const h = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(h);
  }, [dirty, save]);

  // ── Assets ──────────────────────────────────────────────────────────────
  const refreshAssets = useCallback(async () => {
    try {
      const r = await fetch("/api/scene/assets", { cache: "no-store" });
      if (r.ok) setAssets((await r.json()) as AssetInfo[]);
    } catch {
      /* listed again after the next upload */
    }
  }, []);

  /** Place a new instance of `asset` in front of the camera target, on the floor. */
  const addInstance = useCallback(
    async (asset: string, name: string, from?: SceneObject) => {
      const t = three.current;
      if (!t) return;
      const o: SceneObject = from ?? {
        id: newId(),
        name,
        asset,
        position: [Math.round(t.orbit.target.x * 100) / 100, 0, Math.round(t.orbit.target.z * 100) / 100],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const g = await createInstance(o, (m) => setStatus(`asset error: ${m}`), profileRef.current.builtins);
      t.env.add(g);
      t.objects.set(o.id, g);
      setItems((xs) => [...xs, { id: o.id, name: o.name, asset: o.asset }]);
      setSelected(o.id);
      markDirty();
    },
    [markDirty],
  );

  const importFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      for (const f of Array.from(files)) {
        setStatus(`uploading ${f.name}…`);
        const fd = new FormData();
        fd.append("file", f);
        try {
          const r = await fetch("/api/scene/assets", { method: "POST", body: fd });
          const body = (await r.json()) as { url?: string; file?: string; error?: string };
          if (!r.ok || !body.url) throw new Error(body.error ?? `HTTP ${r.status}`);
          await addInstance(body.url, body.file!.replace(/\.(glb|gltf)$/i, ""));
          setStatus(`imported ${body.file}`);
        } catch (e) {
          setStatus(`import failed (${f.name}): ${(e as Error).message}`);
        }
      }
      void refreshAssets();
    },
    [addInstance, refreshAssets],
  );

  // ── Object operations ───────────────────────────────────────────────────
  const duplicate = useCallback(
    (id: string | null) => {
      const t = three.current;
      const it = items.find((x) => x.id === id);
      const g = id ? t?.objects.get(id) : undefined;
      if (!t || !it || !g) return;
      if (profileRef.current.required?.(it.asset)) {
        setStatus(`"${it.name}" is a required piece — it can be moved, not duplicated`);
        return;
      }
      const tr = readTransform(g);
      void addInstance(it.asset, it.name, {
        id: newId(),
        name: `${it.name} copy`,
        asset: it.asset,
        ...tr,
        position: [tr.position[0] + 0.3, tr.position[1], tr.position[2]] as Vec3,
      });
    },
    [items, addInstance],
  );

  const remove = useCallback(
    (id: string | null) => {
      const t = three.current;
      const g = id ? t?.objects.get(id) : undefined;
      if (!t || !id || !g) return;
      const asset = g.userData.asset as string;
      if (profileRef.current.required?.(asset)) {
        setStatus(`"${g.name}" is a required piece — it can be moved, not deleted`);
        return;
      }
      t.gizmo.detach();
      t.env.remove(g);
      t.objects.delete(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
      setSelected(null);
      markDirty();
    },
    [markDirty],
  );

  const setComponents = useCallback(
    (id: string, patch: Partial<Pick<Item, "puzzle" | "painting">>) => {
      setItems((xs) =>
        xs.map((x) => {
          if (x.id !== id) return x;
          const next = { ...x, ...patch };
          if ("puzzle" in patch && !patch.puzzle) delete next.puzzle;
          return next;
        }),
      );
      markDirty();
    },
    [markDirty],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, name } : x)));
      const g = three.current?.objects.get(id);
      if (g) g.name = name;
      markDirty();
    },
    [markDirty],
  );

  const setTransform = useCallback(
    (key: "position" | "rotation" | "scale", axis: 0 | 1 | 2, value: number) => {
      const id = selectedRef.current;
      const g = id ? three.current?.objects.get(id) : undefined;
      if (!g || !Number.isFinite(value)) return;
      const tr = readTransform(g);
      tr[key][axis] = value;
      applyTransform(g, tr);
      setTick((t) => t + 1);
      markDirty();
    },
    [markDirty],
  );

  const focus = useCallback((id: string | null) => {
    const t = three.current;
    const g = id ? t?.objects.get(id) : undefined;
    if (!t || !g) return;
    const box = new THREE.Box3().setFromObject(g);
    const c = box.isEmpty() ? g.position.clone() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 1 : Math.max(box.getSize(new THREE.Vector3()).length(), 0.3);
    const dirv = t.camera.position.clone().sub(t.orbit.target).normalize();
    t.orbit.target.copy(c);
    t.camera.position.copy(c).addScaledVector(dirv, size * 1.6 + 0.5);
  }, []);

  // ── Keyboard: W/E/R, Del, Ctrl+D, Ctrl+S, F, Esc ─────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "s") {
        e.preventDefault();
        void save();
      } else if ((e.ctrlKey || e.metaKey) && k === "d") {
        e.preventDefault();
        duplicate(selectedRef.current);
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      } else if (k === "w") setMode("translate");
      else if (k === "e") setMode("rotate");
      else if (k === "r") setMode("scale");
      else if (k === "f") focus(selectedRef.current);
      else if (k === "escape") setSelected(null);
      else if (k === "delete" || k === "backspace") remove(selectedRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, duplicate, remove, focus]);

  const sel = items.find((x) => x.id === selected) ?? null;
  const selObj = selected ? three.current?.objects.get(selected) : undefined;
  const tr = selObj ? readTransform(selObj) : null;
  const btn = "rounded px-2 py-1 text-xs font-medium disabled:opacity-40";

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-200">
      {/* Hierarchy + assets */}
      <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-zinc-800 p-3 text-xs">
        <div>
          <h1 className="text-sm font-semibold">Scene Editor</h1>
          <div className="mt-1 flex gap-1">
            {Object.entries(PROFILES).map(([id, p]) => (
              <a
                key={id}
                href={`/editor?scene=${id}`}
                className={`rounded px-2 py-0.5 text-[11px] ${id === sid ? "bg-sky-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                title={p.label}
              >
                {id}
              </a>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            data/scenes/{sid}.json → shown in {profileFor(sid).label}
          </p>
        </div>
        <section>
          <h2 className="mb-1 uppercase tracking-wider text-zinc-500">Hierarchy</h2>
          {items.length === 0 && <p className="text-zinc-600">No objects. Import a GLB below.</p>}
          <ul>
            {items.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => setSelected(it.id)}
                  onDoubleClick={() => focus(it.id)}
                  className={`w-full truncate rounded px-2 py-1 text-left ${it.id === selected ? "bg-sky-800" : "hover:bg-zinc-800"}`}
                  aria-label={it.name}
                  title={`${assetLabel(it.asset)} — double-click to focus`}
                >
                  {it.name}
                  {profileFor(sid).required?.(it.asset) && <span className="ml-1 text-[10px] text-amber-400">●</span>}
                  {it.puzzle && (
                    <span className="ml-1 rounded bg-violet-800 px-1 text-[9px] text-violet-100" title={`puzzle "${it.puzzle.id}"`}>
                      puzzle
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-zinc-600">{profileFor(sid).lockedNote}</p>
          {sid === "puzzle" &&
            checkPuzzles(items).map((m) => (
              <p key={m} className="mt-1 text-[10px] text-red-400">
                ⚠ {m}
              </p>
            ))}
        </section>
        {profileFor(sid).palette && (
          <section>
            <h2 className="mb-1 uppercase tracking-wider text-zinc-500">Room pieces</h2>
            <ul>
              {profileFor(sid).palette!.map((p) => (
                <li key={p.asset} className="flex items-center gap-1 py-0.5">
                  <span className="flex-1 truncate">{p.label}</span>
                  <button onClick={() => void addInstance(p.asset, p.label)} className={`${btn} bg-zinc-700`}>
                    + Add
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="mb-1 uppercase tracking-wider text-zinc-500">Assets</h2>
          <input ref={fileRef} type="file" accept=".glb,.gltf" multiple className="hidden" onChange={(e) => void importFiles(e.target.files).finally(() => (e.target.value = ""))} />
          <button onClick={() => fileRef.current?.click()} className={`${btn} mb-2 w-full bg-emerald-700`}>
            Import GLB / GLTF…
          </button>
          <ul>
            {assets.map((a) => (
              <li key={a.file} className="flex items-center gap-1 py-0.5">
                <span className="flex-1 truncate" title={a.file}>
                  {a.file}
                </span>
                <span className="text-zinc-600">{(a.bytes / 1024 / 1024).toFixed(1)}M</span>
                <button onClick={() => void addInstance(a.url, a.file.replace(/\.(glb|gltf)$/i, ""))} className={`${btn} bg-zinc-700`}>
                  + Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      {/* Viewport */}
      <main className="relative flex-1">
        <div ref={viewportRef} className="h-full w-full" />
        <div className="absolute left-3 top-3 flex gap-1">
          {(["translate", "rotate", "scale"] as const).map((m, i) => (
            <button key={m} onClick={() => setMode(m)} className={`${btn} ${mode === m ? "bg-sky-700" : "bg-zinc-800/90"}`}>
              {["W Move", "E Rotate", "R Scale"][i]}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[11px] text-zinc-300">
          LMB orbit · RMB pan · wheel zoom · click to select · F focus · Del delete · Ctrl+D duplicate · Ctrl+S save
        </div>
      </main>

      {/* Inspector */}
      <aside className={`${sid === "puzzle" ? "w-80" : "w-72"} shrink-0 overflow-y-auto border-l border-zinc-800 p-3 text-xs`}>
        <h2 className="mb-2 uppercase tracking-wider text-zinc-500">Inspector</h2>
        {!sel || !tr ? (
          <p className="text-zinc-600">Select an object.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-zinc-500">Name</span>
              <input value={sel.name} onChange={(e) => rename(sel.id, e.target.value)} className="rounded bg-zinc-900 px-2 py-1" />
            </label>
            <p className="truncate text-[10px] text-zinc-600" title={sel.asset}>
              asset: {assetLabel(sel.asset)}
            </p>
            {(
              [
                ["position", "Position (m)", 0.05],
                ["rotation", "Rotation (°)", 1],
                ["scale", "Scale", 0.05],
              ] as const
            ).map(([key, label, step]) => (
              <div key={key}>
                <div className="mb-1 text-zinc-500">{label}</div>
                <div className="grid grid-cols-3 gap-1">
                  {(["X", "Y", "Z"] as const).map((ax, i) => (
                    <label key={ax} className="flex items-center gap-1">
                      <span className={["text-red-400", "text-green-400", "text-blue-400"][i]}>{ax}</span>
                      <NumField value={tr[key][i]} step={step} onCommit={(v) => setTransform(key, i as 0 | 1 | 2, v)} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex gap-1">
              <button onClick={() => duplicate(sel.id)} className={`${btn} bg-zinc-700`}>
                Duplicate
              </button>
              <button onClick={() => focus(sel.id)} className={`${btn} bg-zinc-700`}>
                Focus
              </button>
              <button onClick={() => remove(sel.id)} className={`${btn} ml-auto bg-red-800`}>
                Delete
              </button>
            </div>
            {sid === "puzzle" && <ObjectComponents item={sel} items={items} onChange={(patch) => setComponents(sel.id, patch)} />}
          </div>
        )}
        {sid === "puzzle" && (
          <details className="mt-6 border-t border-zinc-800 pt-3">
            <summary className="cursor-pointer uppercase tracking-wider text-zinc-500">Room audio</summary>
            <div className="mt-2">
              <RoomAudioSettings />
            </div>
          </details>
        )}
        <div className="mt-6 border-t border-zinc-800 pt-3">
          <button onClick={() => void save()} className={`${btn} bg-sky-700`}>
            Save now (Ctrl+S)
          </button>
          <p className={`mt-2 break-words ${/FAIL|error/i.test(status) ? "text-red-400" : "text-zinc-400"}`}>{status}</p>
          <p className="text-[10px] text-zinc-600">Auto-saves after every change. Last saved: {savedAt ? new Date(savedAt).toLocaleTimeString() : "—"}</p>
        </div>
      </aside>
    </div>
  );
}
