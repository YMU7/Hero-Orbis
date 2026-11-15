"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DEFAULT_SCENE_ID, parseScene, type SceneDoc, type SceneObject } from "./types";

// Shared client loader: SceneDoc → THREE objects. Used by BOTH the Scene
// Editor and the /mvp WebXR runtime, so what is placed in the editor is
// exactly what appears in the headset.
//
// Each instance is a Group named after the object, carrying
// userData.sceneId, with a clone of the asset's scene graph inside. Assets
// are loaded once per URL and cloned per instance.

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

export function loadAsset(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => g.scene);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

const DEG = Math.PI / 180;

export function applyTransform(obj: THREE.Object3D, o: Pick<SceneObject, "position" | "rotation" | "scale">) {
  obj.position.fromArray(o.position);
  obj.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, "XYZ");
  obj.scale.fromArray(o.scale);
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function readTransform(obj: THREE.Object3D) {
  return {
    position: obj.position.toArray().map(r4) as SceneObject["position"],
    rotation: [obj.rotation.x / DEG, obj.rotation.y / DEG, obj.rotation.z / DEG].map((v) => Math.round(v * 100) / 100) as SceneObject["rotation"],
    scale: obj.scale.toArray().map(r4) as SceneObject["scale"],
  };
}

/** Builds "builtin:<kind>" pieces (scene-specific); null = unknown kind. */
export type BuiltinResolver = (asset: string) => THREE.Object3D | null;

/** Build one instance (asset load errors leave an empty, named group). */
export async function createInstance(o: SceneObject, onError?: (msg: string) => void, builtins?: BuiltinResolver): Promise<THREE.Group> {
  const g = new THREE.Group();
  g.name = o.name;
  g.userData.sceneId = o.id;
  g.userData.asset = o.asset;
  applyTransform(g, o);
  if (o.asset.startsWith("builtin:")) {
    const b = builtins?.(o.asset) ?? null;
    if (b) g.add(b);
    else onError?.(`unknown ${o.asset}`);
    return g;
  }
  try {
    const src = await loadAsset(o.asset);
    g.add(src.clone(true));
  } catch (e) {
    onError?.(`asset ${o.asset}: ${(e as Error).message}`);
  }
  return g;
}

export async function fetchScene(id = DEFAULT_SCENE_ID): Promise<SceneDoc> {
  const r = await fetch(`/api/scene?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/scene ${r.status}`);
  return parseScene(await r.json());
}

/** Runtime entry point (/mvp): fetch the scene and fill `parent`. Never
 *  throws — a missing or broken environment must not take the XR scene down. */
export async function loadEnvironmentInto(
  parent: THREE.Object3D,
  log: (msg: string, error?: boolean) => void,
  id = DEFAULT_SCENE_ID,
): Promise<number> {
  try {
    const doc = await fetchScene(id);
    const objs = await Promise.all(doc.objects.map((o) => createInstance(o, (m) => log(m, true))));
    objs.forEach((o) => parent.add(o));
    log(`environment "${id}": ${objs.length} object(s)`);
    return objs.length;
  } catch (e) {
    log(`environment "${id}" not loaded: ${(e as Error).message}`, true);
    return 0;
  }
}
