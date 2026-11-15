// SERVER-ONLY helpers for scene files and uploaded assets (used by the
// /api/scene route handlers). Never import this from a client component.

import { promises as fs, existsSync } from "fs";
import path from "path";
import { emptyScene, isAssetName, isSceneId, parseScene, type SceneDoc } from "./types";

/** Project root. The launch config starts `next start orbis-xr-mvp` from the
 *  parent folder, so process.cwd() may be one level up. SCENE_DATA_DIR overrides. */
function projectRoot() {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "next.config.ts"))) return cwd;
  const nested = path.join(cwd, "orbis-xr-mvp");
  if (existsSync(path.join(nested, "next.config.ts"))) return nested;
  return cwd;
}

export function dataDir() {
  return process.env.SCENE_DATA_DIR ? path.resolve(process.env.SCENE_DATA_DIR) : path.join(projectRoot(), "data");
}
const scenesDir = () => path.join(dataDir(), "scenes");
const backupsDir = () => path.join(dataDir(), "scenes", "backups");
export const assetsDir = () => path.join(dataDir(), "scene-assets");

/** Editor + write APIs: on in `next dev`; in production only with ENABLE_SCENE_EDITOR=1. */
export function editorEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_SCENE_EDITOR === "1";
}

export async function readScene(id: string): Promise<SceneDoc> {
  if (!isSceneId(id)) throw new Error("bad scene id");
  try {
    const txt = await fs.readFile(path.join(scenesDir(), `${id}.json`), "utf8");
    return parseScene(JSON.parse(txt));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyScene();
    throw e;
  }
}

const BACKUP_EVERY_MS = 5 * 60_000;
const lastBackup = new Map<string, number>();

/** Thrown when a save is based on an older version than the file on disk. */
export class SceneConflictError extends Error {
  constructor(readonly current: string | null) {
    super("scene file changed on disk since this editor loaded it — reload the editor");
  }
}

/** Validate + write atomically. The previous file is kept as <id>.prev.json
 *  on every save, and a timestamped copy goes to backups/ at most every 5 min.
 *
 *  `baseSavedAt` (optional): the savedAt the caller loaded. If given and the
 *  file on disk has a different savedAt, the write is refused
 *  (SceneConflictError) — this stops a stale editor tab from silently
 *  overwriting newer layout changes (seen 2026-11-14 on the puzzle scene). */
export async function writeScene(id: string, raw: unknown, baseSavedAt?: string | null): Promise<SceneDoc> {
  if (!isSceneId(id)) throw new Error("bad scene id");
  if (baseSavedAt !== undefined) {
    const current = (await readScene(id)).savedAt ?? null;
    if (current !== baseSavedAt) throw new SceneConflictError(current);
  }
  const doc = parseScene(raw);
  doc.savedAt = new Date().toISOString();
  await fs.mkdir(backupsDir(), { recursive: true });
  const file = path.join(scenesDir(), `${id}.json`);
  if (existsSync(file)) {
    await fs.copyFile(file, path.join(scenesDir(), `${id}.prev.json`));
    const now = Date.now();
    if (now - (lastBackup.get(id) ?? 0) > BACKUP_EVERY_MS) {
      lastBackup.set(id, now);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.copyFile(file, path.join(backupsDir(), `${id}-${stamp}.json`));
    }
  }
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
  return doc;
}

export async function listAssets(): Promise<Array<{ file: string; bytes: number }>> {
  try {
    const names = await fs.readdir(assetsDir());
    const out: Array<{ file: string; bytes: number }> = [];
    for (const n of names) {
      if (!isAssetName(n)) continue;
      const st = await fs.stat(path.join(assetsDir(), n));
      out.push({ file: n, bytes: st.size });
    }
    return out.sort((a, b) => a.file.localeCompare(b.file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/** Store an upload under a safe, unused name; returns the stored file name. */
export async function saveAsset(originalName: string, bytes: Uint8Array): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  if (ext !== ".glb" && ext !== ".gltf") throw new Error("only .glb / .gltf files");
  const stem = path.basename(originalName, path.extname(originalName)).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+/, "").slice(0, 60) || "asset";
  await fs.mkdir(assetsDir(), { recursive: true });
  let name = `${stem}${ext}`;
  for (let i = 2; existsSync(path.join(assetsDir(), name)); i++) name = `${stem}-${i}${ext}`;
  if (!isAssetName(name)) throw new Error("bad file name");
  await fs.writeFile(path.join(assetsDir(), name), bytes);
  return name;
}

export async function readAsset(file: string): Promise<Buffer | null> {
  if (!isAssetName(file)) return null;
  try {
    return await fs.readFile(path.join(assetsDir(), file));
  } catch {
    return null;
  }
}
