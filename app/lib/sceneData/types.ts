// Shared scene data for the desktop Scene Editor (/editor) and the WebXR
// runtime (/mvp).
//
// Only the EDITABLE ENVIRONMENT lives here: imported GLB/GLTF instances and
// their transforms. Runtime-only objects (Orbis video plane, selectable
// buttons, HUD, XR controllers, floor/grid, lights) stay in code
// (app/mvp/components/XRScene.tsx) and are never written to this file.
//
// Stored on disk at data/scenes/<sceneId>.json and served by /api/scene.

import { parsePainting, parsePuzzle, type PaintingComponent, type PuzzleComponent } from "./components";

export const SCENE_VERSION = 1;
export const DEFAULT_SCENE_ID = "mvp";

export type Vec3 = [number, number, number];

export type SceneObject = {
  /** Stable unique id (never shown, never reused). */
  id: string;
  /** Display name (Hierarchy / Inspector). */
  name: string;
  /** Asset URL, e.g. "/api/scene/assets/chair.glb", or "builtin:<kind>" for a
   *  piece built in code by the scene that owns it (e.g. the puzzle room). */
  asset: string;
  /** Metres. */
  position: Vec3;
  /** Euler XYZ in DEGREES (readable when editing the JSON by hand). */
  rotation: Vec3;
  scale: Vec3;
  /** Optional components (Scene Editor "+ Puzzle"; see ./components.ts). */
  puzzle?: PuzzleComponent;
  painting?: PaintingComponent;
};

export type SceneDoc = {
  version: number;
  /** ISO time of the last save (informational). */
  savedAt?: string;
  objects: SceneObject[];
};

export const emptyScene = (): SceneDoc => ({ version: SCENE_VERSION, objects: [] });

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** Validate untrusted JSON (from disk or a POST). Throws with a reason. */
export function parseScene(raw: unknown): SceneDoc {
  if (!raw || typeof raw !== "object") throw new Error("scene must be an object");
  const r = raw as Record<string, unknown>;
  if (r.version !== SCENE_VERSION) throw new Error(`unsupported scene version ${String(r.version)}`);
  if (!Array.isArray(r.objects)) throw new Error("objects must be an array");
  const ids = new Set<string>();
  const objects = r.objects.map((o, i): SceneObject => {
    const x = o as Record<string, unknown>;
    if (typeof x.id !== "string" || !x.id) throw new Error(`objects[${i}].id missing`);
    if (ids.has(x.id)) throw new Error(`duplicate id ${x.id}`);
    ids.add(x.id);
    if (typeof x.asset !== "string" || !(x.asset.startsWith("/") || /^builtin:[a-z0-9-]+$/.test(x.asset)))
      throw new Error(`objects[${i}].asset must be a site-relative URL or builtin:<kind>`);
    if (!isVec3(x.position) || !isVec3(x.rotation) || !isVec3(x.scale)) throw new Error(`objects[${i}] transform must be three numbers each`);
    const puzzle = parsePuzzle(x.puzzle, `objects[${i}]`);
    const painting = parsePainting(x.painting);
    return {
      id: x.id,
      name: typeof x.name === "string" && x.name ? x.name.slice(0, 120) : x.id,
      asset: x.asset,
      position: x.position,
      rotation: x.rotation,
      scale: x.scale,
      ...(puzzle ? { puzzle } : {}),
      ...(painting ? { painting } : {}),
    };
  });
  return { version: SCENE_VERSION, savedAt: typeof r.savedAt === "string" ? r.savedAt : undefined, objects };
}

/** Scene ids are file names: keep them boring. */
export const isSceneId = (id: string) => /^[a-z0-9][a-z0-9_-]{0,40}$/.test(id);

/** Uploaded asset file names. */
export const isAssetName = (n: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(glb|gltf)$/.test(n) && !n.includes("..");

export const assetUrl = (file: string) => `/api/scene/assets/${encodeURIComponent(file)}`;
