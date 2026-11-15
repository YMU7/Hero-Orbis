# Prop design, round 2: swords, fireball, silence crystal, camera, room size

Date: 2026-11-15. Concept sheets generated with Figma AI image generation (file "Prop Design Round 2"), approved, then built procedurally in code and revised after review. Visuals and layout only: no puzzle stage, condition, timing or grab rule changed.

| Prop | Design sheet | In game |
|---|---|---|
| Sword rack | `sword-rack.png` | `ingame-sword-hilts.jpg`, `ingame-hammer-glow.jpg` |
| Fireball (VFX) | `fireball.png` | `ingame-fireball.jpg` |
| Silence device | `silence-crystal.png` (revised: crystal mic, red ring, hammer plaque) | `ingame-silence-crystal.jpg`, `ingame-mic-speaking-green.jpg` |
| Camera | — | `ingame-camera.jpg` |
| Enlarged room | — | `ingame-room-7m.jpg` |
| Live Orbis run | — | `live-rope-fireball-cue.jpg`, `live-escaped.jpg` |

## What was built

**Room size** (`puzzleConfig.ts` `OCTAGON`, `roomLayout.ts` `ROOM_GROW`)
- Octagon enlarged 1.25×: 7 m across (was 5.6 m), 4.375 m axial walls, 1.86 m diagonal window walls. Height stays 3.2 m.
- The front (painting) wall stays at z = −2.6, so the painting, the player start (origin) and eye level are unchanged; the room grows to the sides and back.
- Every free-standing piece and gameplay prop is placed by scaling its layout-study position out from the room centre; wall pieces follow the walls. Rug scaled 1.25×. Windows now fit at full size.

**Sword rack** (`propModels.ts`: `SWORD_DESIGNS`, `dressRack`)
- Rack 1.34 m wide: five sword slots plus the hammer, 0.22 m apart.
- Five distinct swords: (1) slender long sword, pink grip, curled quillons, pink gem; (2) broad sword, ivory grip, blue gem; (3) rapier with ring guard and crystal pommel; (4) curved lavender sabre with a ribbon; (5) rose-gold heart sword with a star pommel.
- Sword 1 is the existing grabbable decoy. Swords 2–5 cannot be picked up yet (open item 1).

**Fireball** (`propModels.ts`: `dressFire`), revised after review: "VFX, not a model"
- GPU particle effect: 34 soft camera-facing flame particles rise from the base, converge into a tip and cool from gold to orange to rose while fading; 4 large soft particles form the hot core; 8 embers drift above.
- One shader, one draw per eye; motion runs in the vertex shader on the shared look clock. Normal alpha blending (additive washed out to white against the pastel room). No lights. Same tool pivot, collider and emerge scaling.

**Silence device** (`unityRoom.ts`: crystal mic + `setSpeaking`; `curseVisuals.ts`: ring, plaque, notes), revised twice after review
- A violet crystal microphone in the "mic" icon shape (capsule head in a U-shaped holder, stem, base).
- Around it, the curse: a solid 3D red prohibition ring with a bar across the front. No white speaker symbol.
- Under the ring, a gold plaque with cut corners, raised border, corner studs and an embossed hammer, hanging on two chains.
- Notes drift out of the painting along the threads into the device; the hammer head on the rack pulses violet while the room is silent.
- The hammer shatters the red ring (red shards, the plaque goes with it, notes burst back into the painting). The crystal microphone stays.
- The microphone glows bright green (`#6bff9e`) while a princess voice clip is playing and returns to violet afterwards. Reset restores the ring and the violet colour.
- Unchanged: seal position, 0.23 m hammer contact radius, desktop click target, sound.
- On-screen copy now says "red seal around the microphone".

**Camera** (`propModels.ts`: `dressCamera`), revised after review: "the box read as a printer"
- A fairytale box camera: ivory body, lavender leather band, gold plates, stepped gold lens barrel with crystal glass, viewfinder, crystal flash bulb, shutter button, star emblem. Same pivot, collider and lens direction; it still produces the portrait card.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `node --test tests/` | 12/12 PASS |
| `next build` | PASS |
| Production build, cold loads | PASS (no console errors) |
| Full chain, production build, **live Orbis** (simulated grabbers): hammer → crystal breaks → sword 1 melts → drawing → royal sword → rope → fireball → key → rejected → capture → card → escape → end card | PASS. Orbis acknowledged every cue (unmuted, drawn, rope, released, escaped); 1080p at 18 fps; first frames after 4.1 s. Session about 2.5 min, then disconnected and set back to MOCK |
| Microphone during the live run (previous build, before the crystal-mic revision) | Green mic hidden while silent; `#6bff9e` with glow 1.1 while she spoke; `#58dda0` after the line |
| Final build, full chain (mock): ring shatters, crystal mic stays and glows green while she speaks, reset restores ring + violet | PASS |
| Quest 3 headset | NOT TESTED |

Dev-server note: in `next dev`, loading `/puzzle` while the server is recompiling can fail with a Rapier "not initialised" error. It did not occur in the production build.

## Open items

1. **All swords grabbable** (requested) is an interaction change and is not done: swords 2–5 need to become tools that melt and return like sword 1.
2. The design's dotted sparkle trail from the hammer to the crystal was not built (the matching violet glow carries that link).
3. In the live run the escape showed two end cards: the 3D card under the painting and a "The Princess Is Free! / Play again" card at the top of the painting. The second is not part of this art pass; check whether both are intended.
