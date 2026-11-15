// Room layout data for the octagonal princess chamber (art pass 2026-11-15).
//
// Source: the top-down layout study ("8-Sided Room · Layout Study"). Front
// wall = the painting wall at z = −2.6; the viewer starts at the origin
// facing −Z (unchanged from the rectangular room, so reach distances to the
// painting stay the same).
//
// Two kinds of placement live here:
//   RESCUE_LAYOUT  gameplay props built in code (unityRoom / rescueRoom).
//                  Expressed in the PAINTING's local frame, exactly like the
//                  old hard-coded offsets, so the props still follow the
//                  painting if it is moved in the editor. With the painting
//                  at its default (0, 1.75, −2.55), world = local + that.
//   ROOM_LAYOUT    editor-placeable builtins (decor + the four singletons).
//                  World coordinates; mirrored into data/scenes/puzzle.json
//                  by scripts/write-puzzle-layout.cjs.
//
// Pure data: no three.js import, so node scripts can read it.

import { OCTAGON, ROOM, roomWalls } from "./puzzleConfig";

export type Vec3 = [number, number, number];

/** Default painting placement (world). */
export const PAINTING_HOME: Vec3 = [0, 1.75, Math.round((ROOM.minZ + 0.05) * 1000) / 1000];

const toPainting = (x: number, y: number, z: number): Vec3 => [x - PAINTING_HOME[0], y - PAINTING_HOME[1], z - PAINTING_HOME[2]];
const DEG = Math.PI / 180;
/** Yaw (radians) that turns local −Z toward (tx, tz) from (x, z). */
const lookYaw = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

// Positions are authored in the 5.6 m layout-study frame (octagon centre at
// z = 0.2) and scaled out by ROOM_GROW into the enlarged room. The front
// (painting) wall is fixed, so grown points keep their place relative to it.
export const ROOM_GROW = 1.25;
const STUDY_CZ = 0.2;
const grow = (x: number, z: number): [number, number] => [
  Math.round((OCTAGON.cx + (x - OCTAGON.cx) * ROOM_GROW) * 1000) / 1000,
  Math.round((OCTAGON.cz + (z - STUDY_CZ) * ROOM_GROW) * 1000) / 1000,
];
// World anchor points (metres), read off the layout study.
const KEY_XZ = grow(-1.5, -1.75); // hanging key, front-left by the window
const RACK_XZ = grow(1.675, -1.475); // freestanding sword rack, off the front-right window wall
const BOX_TABLE_XZ = grow(-1.89, -0.96); // portrait box table, front-left
const TABLE_TOP = 0.806; // round-table top surface (cloth)

/** Gameplay props, painting-local. Yaws are relative to the painting. */
export const RESCUE_LAYOUT = {
  /** Rope + glass enclosure (x, z); the rope runs to the ceiling. */
  rope: toPainting(KEY_XZ[0], 1.9, KEY_XZ[1]),
  glass: toPainting(KEY_XZ[0], 1.13, KEY_XZ[1]),
  /** Freestanding floor rack (origin on the floor, local +Z = front). */
  rack: { position: toPainting(RACK_XZ[0], 0, RACK_XZ[1]), yaw: -45 * DEG, width: 1.34 },
  /** Slots along the rack's local X (metres from its centre). The hammer
   *  and the decoy sword are the interactive ones; `decor` swords are part of
   *  the rack model (propModels.dressRack). */
  rackSlots: { decor: [-0.33, -0.11, 0.11, 0.33], wallSword: -0.55, hammer: 0.55 },
  /** Heights (rack local): sword pommel and hammer handle end, both hanging
   *  blade/head down so the grab point is at waist height. */
  rackHeights: { swordPommel: 1.02, hammerTop: 0.72, baseTop: 0.36 },
  /** Magic Portrait Box (the existing hand-held "camera" tool) resting on its
   *  side table, lens toward the player's start. */
  camera: {
    position: toPainting(BOX_TABLE_XZ[0], TABLE_TOP + 0.085, BOX_TABLE_XZ[1]),
    yaw: lookYaw(BOX_TABLE_XZ[0], BOX_TABLE_XZ[1], 0, 0),
  },
} as const;

// ── Editor-placeable builtins (world) ──────────────────────────────────────

export type LayoutEntry = { id: string; name: string; kind: string; position: Vec3; rotY: number; scale?: Vec3 };

const R2D = 180 / Math.PI;
const round = (v: number) => Math.round(v * 1000) / 1000;
const facing = (x: number, z: number, tx = 0, tz = 0) => Math.round(lookYaw(x, z, tx, tz) * R2D * 100) / 100 + 180; // pieces face +Z
const norm = (d: number) => Math.round((((d + 180) % 360) + 360) % 360 - 180);
const wall = (id: string) => roomWalls().find((w) => w.id === id)!;
/** A point on a wall: `along` metres from its centre (local +X), `out`
 *  metres into the room, at height y. */
function onWall(id: string, along: number, out: number, y: number): { position: Vec3; rotY: number } {
  const w = wall(id);
  const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
  // local +X → (cos, −sin), local +Z → (sin, cos)
  return { position: [round(w.x + along * c + out * s), y, round(w.z - along * s + out * c)], rotY: Math.round(w.yaw * R2D) };
}
const e = (id: string, name: string, kind: string, p: { position: Vec3; rotY: number }, scale?: Vec3): LayoutEntry => ({ id, name, kind, position: p.position, rotY: p.rotY, scale });
/** A free-standing piece at a layout-study point (grown into the room). */
const at = (x: number, y: number, z: number, rotY: number) => {
  const [gx, gz] = grow(x, z);
  return { position: [gx, y, gz] as Vec3, rotY: norm(rotY) };
};

// Diagonal walls are 1.86 m wide: the window fits at full size; the 2.1 m
// curtain set is narrowed on X only, so the arch keeps its height.
const WIN_S: Vec3 = [1, 1, 1];
const CURTAIN_S: Vec3 = [0.84, 1, 1];

export const ROOM_LAYOUT: ReadonlyArray<LayoutEntry> = [
  // Singletons (interactive): painting, easel, gramophone, button pedestal.
  e("painting", "Painting (Orbis)", "painting", { position: PAINTING_HOME, rotY: 0 }), // fixed: never grown
  // Easel and pedestal: positions as moved in the Scene Editor (2026-11-15 23:44 PT).
  e("easel", "Easel + canvas", "easel", at(1.7752, 0, 0.3075, -81.47)),
  e("gramophone", "Gramophone", "gramophone", at(-2.06, 0.8, 0.63, facing(-2.06, 0.63))),
  e("pedestal", "Button pedestal", "pedestal", at(1.7287, 0, 1.0966, -137)),
  // Front wall: painting flanked by lanterns on the corner pilasters. No ivy
  // on this wall: its strands hung over the frame and the Orbis picture.
  e("lantern-l", "Wall lantern L", "wall-lantern", at(-1.704, 1.85, -2.489, 22.5)),
  e("lantern-r", "Wall lantern R", "wall-lantern", at(1.704, 1.85, -2.489, -22.5)),
  // Four diagonal arched windows with blue-lavender curtains.
  ...(["front-left", "front-right", "back-left", "back-right"] as const).flatMap((id) => [
    e(`window-${id}`, `Arched window ${id}`, "arched-window", onWall(id, 0, 0, 0), WIN_S),
    e(`curtains-${id}`, `Curtains ${id}`, "curtains", onWall(id, 0, 0, 0), CURTAIN_S),
  ]),
  e("ivy-wfl", "Ivy (window FL)", "ivy", onWall("front-left", 0.45, 0.02, 3.1)),
  e("ivy-wfr", "Ivy (window FR)", "ivy", onWall("front-right", -0.45, 0.02, 3.1)),
  // Sun from the left: light through the two left windows.
  e("sun-fl", "Sun patch (front-left window)", "sun-patch", onWall("front-left", 0, 0, 0)),
  e("sun-bl", "Sun patch (back-left window)", "sun-patch", onWall("back-left", 0, 0, 0)),
  // Left side: portrait box table, gramophone table, royal sofa (rear-left).
  e("table-portrait", "Round table (portrait box)", "round-table", { position: [BOX_TABLE_XZ[0], 0, BOX_TABLE_XZ[1]], rotY: 0 }, [0.8, 1, 0.8]),
  e("table-gramophone", "Round table (gramophone)", "round-table", at(-2.06, 0, 0.63, 0)),
  e("sofa", "Chaise sofa", "chaise-sofa", onWall("back-left", 0, 0.52, 0)),
  e("banner-l", "Royal banner L", "royal-banner", onWall("left", 0, 0.01, 2.85)),
  // Right side: banner over the easel side, a plant by the rack.
  e("banner-r", "Royal banner R", "royal-banner", onWall("right", 0, 0.01, 2.85)),
  e("plant-r", "Potted plant R", "potted-plant", at(2.42, 0, -0.55, -90)),
  // Back wall (behind the start): dresser with lamp, vase and books.
  e("dresser", "Dresser", "dresser", onWall("back", 0, 0.28, 0)),
  e("lamp-dresser", "Crystal lamp", "crystal-lamp", onWall("back", 0.32, 0.28, 0.87)),
  e("vase-dresser", "Hydrangea vase", "hydrangea-vase", onWall("back", -0.3, 0.28, 0.87)),
  e("books-dresser", "Book stack", "book-stack", onWall("back", 0.02, 0.25, 0.87)),
  e("banner-b", "Royal banner back", "royal-banner", onWall("back", 0, 0.01, 2.85)),
  // Centre: ornate circular rug, open floor toward the painting.
  e("rug", "Royal rug", "royal-rug", at(OCTAGON.cx, 0, 0.42, 0), [ROOM_GROW, 1, ROOM_GROW]),
];
