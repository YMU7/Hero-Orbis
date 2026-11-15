# Art pass: octagonal princess chamber (`/puzzle`)

Date: 2026-11-15. Scope: visuals and layout only. Puzzle stages, success conditions and interaction code paths are unchanged.

References used: the final room concept (cute diorama fantasy), the Magic Portrait Box sheet, and the "8-Sided Room · Layout Study" top-down screenshot (primary spatial reference).

## 1. Audit (before changes)

| Area | Finding |
|---|---|
| Room shell | `roomParts.buildShell`: rectangular 5 × 5 m (`ROOM` box), 4 walls, 4 ceiling beams |
| Layout | Decor + 4 singletons (painting, easel, gramophone, pedestal) from `data/scenes/puzzle.json` (33 objects) |
| Gameplay props | Built in code by `unityRoom.ts` / `rescueRoom.ts` at hard-coded painting-local offsets: wall-mounted tool rack (hammer + 1 sword), rope + glass box + key, hand-held camera, fireball, photo, royal sword |
| Prop look | `propModels.dressProps` re-skins those props after construction (same pivots and colliders) |
| Bounds that assumed a box | `toolPhysics` (4 wall colliders), `roomMovement` (x/z clamp), `lookdev` (room AO shader, baked environment) |
| Assets | All procedural Three.js geometry and canvas textures in code. No GLB/GLTF files, no external assets |
| Tests at start | `tests/` 8/8 pass. `swordRecognizer.test.mjs` 5/14 pass (pre-existing; that file predates the current recognizer thresholds and is not part of `tests/`) |

## 2. What changed

### Room architecture
- Octagon defined once in `puzzleConfig.ts` (`OCTAGON`, `roomWalls()`, `roomOutline()`, `clampToRoom()`): 5.6 m across, 3.2 m high, four 3.5 m walls and four 1.49 m diagonal walls. `ROOM` is now the octagon's bounding box.
- Front wall kept at z = −2.6, so the painting (0, 1.75, −2.55), its size and the Orbis video surface are unchanged, and the viewer still starts at the origin 2.5 m from the painting.
- New shell: octagonal floor and ceiling, 8 stone walls with skirting and gold crown moulding, 8 corner pilasters, 8 ceiling ribs to a gilded centre boss.
- Physics: 8 wall colliders. Movement: clamps against all 8 walls. Room AO shader and baked environment follow the octagon and the 4 diagonal windows.

### Layout (`app/puzzle/roomLayout.ts`)
All transforms live in one data file. `scripts/write-puzzle-layout.cjs` regenerates `data/scenes/puzzle.json` from it (30 objects; the previous file is backed up to `data/scenes/backups/`).

| Zone | Pieces |
|---|---|
| Front wall | Orbis painting (unchanged), crystal silence seal, lanterns on the two corner pilasters |
| Diagonals | Four arched windows with curtains (scaled on X to fit 1.49 m), ivy on the two front windows, sun patches on the two left windows |
| Left | Hanging key enclosure beside the front-left window (−1.5, −1.75); Magic Portrait Box on a side table (−1.89, −0.96); gramophone on its round table (−2.06, 0.63); chaise sofa in the back-left diagonal |
| Right | Freestanding sword rack (centre 1.68, −1.48, parallel to the front-right window wall) holding the hammer; easel (1.55, 0.32) facing the start; RESET pedestal (1.2, 1.3; CLEAR button removed, the easel eraser clears the canvas) |
| Back | Dresser with lamp, vase and books; banner |
| Centre | Circular rug at (0, 0.42); open floor between the start and the painting |

Removed from the old layout: vanity, vanity stool, cabinet, easel stool, stone columns, front-wall banners, front-wall ivy (it hung over the frame) and two plants.

### Assets (procedural, in code)
- **Sword rack** (`propModels.dressRack`): ivory and lavender plinth, turned posts, velvet back panel, crest. Holds three display swords with distinct silhouettes (slender long sword, broad sword, rapier), the grabbable decoy sword (centre slot) and the hammer (right slot, head down).
- **Magic Portrait Box** (`propModels.dressCamera`): rectangular ivory box (24 × 13 × 16 cm) with lavender floral panels, gold trim, flat top tray with velvet inset, front crystal lens, capture button and an empty card slot.
- **Portrait card** (`propModels.dressPhoto`): ivory card, gold double frame, lavender sprigs, golden key.
- **Silence curse** (`unityRoom`): violet crystal core in a gold ring on the frame's bottom rail, with unlit threads along the frame to the corner rosettes (one merged mesh). The glow pulse is softer than the old red seal. Shards are crystal. The princess is not gagged; the curse sits only on the frame.
- On-screen copy that said "red seal" now says "crystal seal" (panel, hint plaque, desktop help). No voiced clip mentions the colour.

## 3. Interaction regression results

Methods: Node tests (`node --test tests/`), and desktop Chrome on `next dev` in MOCK mode (no live Orbis, no credits). The browser checks drove the live scene with simulated grabbers through `window.__puzzleTest`, plus real mouse input for the seal click and the drawing.

| Mechanic | Node tests | Desktop browser (mock) | Quest 3 |
|---|---|---|---|
| Grab / exclusive hold / tracking-loss release | PASS | — | NOT TESTED |
| Hammer contact breaks the seal (new rack position) | PASS (new test) | PASS (desktop click on the seal) | NOT TESTED |
| Decoy sword melts and returns | PASS | Sword grabbed from the rack; melt not observed to finish in the throttled tab | NOT TESTED |
| Drawing recognition → royal sword spawns | PASS | PASS (mouse strokes on the relocated easel) | NOT TESTED |
| Royal sword at rope → fireball | PASS | PASS | NOT TESTED |
| Fireball burns rope → glass falls → key | PASS | PASS | NOT TESTED |
| Key rejected by painting | PASS | PASS | NOT TESTED |
| Portrait box capture → card | PASS | PASS (box lifted from its table, aimed at the key) | NOT TESTED |
| Card into painting → escape, end card | PASS | PASS | NOT TESTED |
| Princess subtitles / dialogue | — | PASS (lines shown on unmute and on draw) | NOT TESTED |
| Reset restores all props | PASS | PASS (panel Reset) | NOT TESTED |
| Tools stay inside diagonal walls | PASS (new test) | — | NOT TESTED |
| Gramophone tonearm (decoy prop) | — | NOT TESTED (moved only; code unchanged) | NOT TESTED |
| Orbis prompt updates | — | Mock only | NOT TESTED |

Totals: `tests/` 12/12 pass (8 existing + 4 new in `tests/layout.test.cjs`). `tsc --noEmit` passes. `next build` passes (`/puzzle` first load 2.01 MB). No console errors during the browser run.

Test edits: two assertions in `tests/interactions.test.cjs` checked that the camera lens faced +Z. They now check that the lens is level and faces the player start, which is what the new table placement does.

## 4. Quest 3 performance observations

Measured on desktop with `renderer.info` (default `high` tier, 70° FOV, from the start position). These are desktop numbers, not headset numbers.

| View | Draw calls | Triangles |
|---|---|---|
| Toward the painting | 73 | 78k |
| Left / right | 61 | 73k |
| Back | 47 | 48k |

- No new lights, no new shadow maps, no new transparent materials except the window sheen on the 4th window. Curse threads are one unlit mesh. Rack, display swords and portrait box are merged per material by the existing `mergeDetails`. Shell pieces go through `staticBatch`.
- The 4th window adds one view texture quad, one additive sheen quad and one curtain set.
- No baseline for the old room was captured in this pass, so before/after numbers are not compared.
- Headset frame rate, loading time and memory: NOT TESTED.

## 5. Open items and decisions to confirm

1. **Portrait Box tray interaction is not implemented.** The box is a re-skin of the existing hand-held camera: pick it up, aim the lens at the key, press the trigger (or pinch near it) and a card appears. The requested flow (key on tray → press button → card prints) changes puzzle logic in `rescueRoom.shoot()` and the `rejected → photo` transition, so it was left for a separate change.
2. **Portrait Box side.** The brief lists it under "Right Side"; the layout study shows it on the left under the key. I followed the layout study (it also keeps the card close to where the key ends up).
3. **Display swords are not grabbable.** Only the centre decoy sword and the hammer can be grabbed. Players may reach for the display swords. Option: make them melting decoys too (a small `rescueRoom` change).
4. **Player start** stays at the origin (2.5 m from the painting). The layout study puts it near the back wall (about 4.5 m away), which would make the painting smaller and the rope harder to reach.
5. **Key after the glass falls** returns to its hanging position in mid-air (existing behaviour, unchanged here).
6. **Still placeholder-level:** easel (kept minimal for Quest in the last perf pass), gramophone, royal sword, fireball, pedestal. No GLB assets were created or imported.
7. Quest 3 on-device playthrough of the whole chain.

## Screenshots (desktop, mock)

- `art-octagon/overview-from-back.jpg`: room from the back wall
- `art-octagon/sword-rack.jpg`: rack with display swords, decoy and hammer
- `art-octagon/portrait-box.jpg`: Magic Portrait Box on its table
- `art-octagon/silence-seal.jpg`: crystal core and threads on the frame
- `art-octagon/easel-sword-drawn.jpg`: drawn sword recognised, royal sword spawned

## Re-test after merging `9f000de` (2026-11-15, ~00:00 PT)

Local `main` = `origin/main` (`9f000de`) plus the uncommitted art pass. Both teammate commits (`e182c6f` movement fix, `9f000de` hands / crayon / voice timing) are present unchanged in the working tree.

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `node --test tests/` | 12/12 PASS |
| Teammate's unmodified `tests/interactions.test.cjs` on the new code | 7/8: the only failure is the lens-direction check (the portrait box now faces the player from its table). With those 2 lines removed: 8/8 PASS |
| `next build` | PASS |
| Desktop browser (mock), full chain with simulated grabbers: hammer contact → seal, decoy melts, drawing → royal sword, rope → fireball, rope burns → key, key rejected, portrait capture, card → escape, end card | PASS |
| Pedestal: RESET only (CLEAR removed by request); pressing RESET restores every prop | PASS |

Note: in a tab that has never been clicked, the browser keeps audio locked, so a voiced line never finishes and the fireball waits. One click fixes it. This is browser autoplay policy, not a layout change; real play always starts with a click or grip.

Non-visual edits in this pass (needed for the octagon or requested): wall colliders and the movement clamp follow the 8 walls; the rack collider is a floor rack; tool spawn positions moved with the layout; the seal's click target ring is 0.15 m (was 0.18 m); the CLEAR button is removed; the editor shows the gameplay props as a locked preview. No puzzle stage, success condition, timing or grab rule changed.

The easel and the pedestal were moved in the Scene Editor (last save 23:44 PT): easel (1.775, 0, 0.308), −81.5°; pedestal (1.729, 0, 1.097), −137°. `roomLayout.ts` was synced to these values, and `scripts/write-puzzle-layout.cjs` reproduces the saved `data/scenes/puzzle.json` exactly.
