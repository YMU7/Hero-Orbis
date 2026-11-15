"use client";

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Phase E (Quest 3): runtime static batching for the puzzle room.
//
// This three version's WebGLRenderer has no multiview, so in VR every mesh is
// drawn once per eye. The room shell and the built-in decor never move at
// runtime, so after they are created we bake their world transforms into
// ONE merged mesh per material. Typical effect: ~150 static meshes → a few
// dozen draw calls per eye. Interactive pieces (painting, easel, gramophone,
// buttons, crayon), hands and imported GLBs are NOT batched.
//
// The Scene Editor still sees individual pieces — batching happens only in
// the /puzzle runtime, after the layout is built.

export type BatchStats = { meshesIn: number; meshesOut: number; skipped: number };

function prepare(src: THREE.BufferGeometry, world: THREE.Matrix4): THREE.BufferGeometry {
  let g = src.clone();
  if (g.index) {
    const n = g.toNonIndexed();
    g.dispose();
    g = n;
  }
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  g.applyMatrix4(world);
  return g;
}

/** Merge all static meshes under `sources` into `target` (one mesh per
 *  material). `target` must sit at the world origin with identity transform.
 *  Sources are removed from the scene and their geometries disposed. */
export function batchStatic(target: THREE.Object3D, sources: THREE.Object3D[]): BatchStats {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let meshesIn = 0;
  let skipped = 0;
  const done: THREE.Mesh[] = [];
  for (const root of sources) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      if (!m.visible || Array.isArray(m.material)) {
        skipped++;
        return;
      }
      meshesIn++;
      let list = byMat.get(m.material);
      if (!list) byMat.set(m.material, (list = []));
      list.push(prepare(m.geometry, m.matrixWorld));
      done.push(m);
    });
  }
  for (const m of done) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  for (const root of sources) root.removeFromParent();
  let meshesOut = 0;
  for (const [material, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `static:${material.name || material.type}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // Transparent decals (contact shadows, sun patches) draw after the room.
    if (material.transparent) mesh.renderOrder = 1;
    target.add(mesh);
    meshesOut++;
  }
  return { meshesIn, meshesOut, skipped };
}
