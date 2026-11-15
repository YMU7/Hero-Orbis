# Test report: "The princess in the painting" (`/puzzle`)

A puzzle room for Meta Quest 3 hand tracking. A princess is trapped in a painting on the wall of her room; the painting is the live Orbis stream.

- **Puzzle 1 (sound):** the room is silent. The player pinches the gramophone's tonearm and swings it onto the spinning record, and the room gets sound.
- **Puzzle 2 (word play):** the princess urges "draw your sword!". The solution is to pick up a crayon and draw a sword on the easel. There is no solve button: the drawing itself is the trigger. When the drawing is recognised, the app sends one `set_prompt` and the princess changes from anxious to happy.

Conventions follow [README.md](README.md): **PASS**, **FAIL**, **PARTIAL** or **NOT TESTED**. A case is marked PASS only when it was observed or logged on the stated platform. Times are Pacific on 2026-11-14.

## What was built

| Item | Location |
|---|---|
| Route | `app/puzzle/page.tsx` → `PuzzleApp.tsx`. Defaults to MOCK; `?mode=live` or the panel toggle selects live |
| Room scene (5 × 5 m room, painting, easel, gramophone, buttons) | `app/puzzle/components/PuzzleScene.tsx` |
| Hand-gesture input (pinch grabbers, fingertip poke) | `app/puzzle/lib/handInput.ts` |
| Crayon (pinch-held, draws on contact) | `app/puzzle/lib/crayon.ts` |
| Gramophone / tonearm (puzzle 1) | `app/puzzle/lib/gramophone.ts` |
| Easel canvas (canvas texture) | `app/puzzle/lib/drawingBoard.ts` |
| Recognizer (pure, no DOM) + unit tests | `app/puzzle/lib/swordRecognizer.ts`, `swordRecognizer.test.mjs` |
| Orbis lifecycle | `app/puzzle/lib/usePuzzleController.ts` |
| 6 h token route + resolver | `app/puzzle/api/token/route.ts` (`/puzzle/api/token`), `app/puzzle/lib/puzzleToken.ts` |
| Prompts and tunables | `app/puzzle/puzzleConfig.ts` |
| Panel | `app/puzzle/components/PuzzlePanel.tsx` |

These modules are reused unchanged: `useOrbisSession` (`run`, `client`, `autoStart:false`), `videoBridge`, `videoTextureHealth`, `debugState`, `mockSource`, `xrEmulation`. No file under `app/mvp/`, `app/rooms/` or `app/lib/` was changed, and no shared module gained an export. `controllerInteraction` is no longer used by `/puzzle`: its ray `select` would fire when a pinch is released and could trigger a button by accident.

### Room layout

Real scale, using the `local-floor` reference space. The layout is scene data in `data/scenes/puzzle.json`, which can be edited in `/editor?scene=puzzle`. The room shell itself comes from `ROOM` in `puzzleConfig.ts`.

**Phase A layout (2026-11-14, 16:58).** The layout follows reference image 1. The viewer starts at the origin facing −Z, and the painting hangs on the front wall about 2.5 m straight ahead. The floor in front of the painting is kept free: there are no barriers. The positions before Phase A are backed up in `data/scenes/backups/puzzle-before-phaseA-*.json`.

| Object | Position | Notes |
|---|---|---|
| Room | x −2.5…2.5, z −2.6…2.4, ceiling 3.2 m | Pastel walls with wainscot and gold trim, plank floor, rug, canopy bed (back left), windows on both side walls, two candle sconces, two banners. Decor is a placeholder until Phases B and C |
| Painting | front wall, centre (0, 1.75, −2.55), 2.4 × 1.35 m, gold frame | Orbis `VideoTexture` + `VideoTextureMonitor`. When no live frames are available it shows a painted placeholder. A brass plaque below shows the story hint |
| Easel | front-right, (0.8, 0, −1.25), turned toward the viewer | A-frame easel modelled on the reference photo: two splayed front legs, mast, back leg, cross bar, ledge, top clamp. 0.70 × 0.55 m canvas tilted back 12°, centre about 1.25 m high |
| Crayon | on the easel ledge (glowing ring) | Blue wax crayon |
| Gramophone | front-left, round side table at (−0.85, 0, −1.25), turned toward the viewer | Brass horn, record always spinning, tonearm head marked with a glowing ring |
| Buttons | pedestal at (−1.25, 0, 0.1), on the viewer's left | RESET (red) and CLEAR (blue), pressed with a fingertip |
| Debug HUD | front wall, right of the painting | Mode, phase, sound, crayon / tonearm holder, video health |

**Phase B: furniture and architecture (2026-11-14, 17:10).** Every model is built in code in `app/puzzle/lib/furniture.ts`; there are no downloaded assets. Each one is a `builtin:<kind>` placed by `data/scenes/puzzle.json`, and the editor palette lists all of them. The art direction is cute diorama fantasy animation: rounded shapes and a pastel blue / ivory / lavender / gold palette. Reference images 1 and 2 are combined into one room.

| Group | Pieces | Placement |
|---|---|---|
| Shell (code, locked) | Warm stone floor tiles, soft stone-block walls with a stone base course and gold crown line, ivory ceiling with four wooden beams | 5 × 5 m, as in Phase A |
| Painting frame | Ornate gold frame: ivory liner, bevelled moulding, corner rosettes, side scrolls, crest with a blue gem | Front wall, around the Orbis picture. The 2.4 × 1.35 m picture area is left clear |
| Architecture | `arched-window` (daylight view: pastel sky, clouds, hills, castle; an unlit texture, no glass), `curtains` (royal blue with gold hem, rod, valance and tie-backs), `stone-column`, `ivy` | Windows with curtains on the left, right and back walls; columns in the front corners; ivy above the side windows |
| Furniture | `chaise-sofa` (tufted lavender, gold trim, throw), `vanity` (ivory, triple mirror as a matte surface, bottles, hydrangeas), `stool` ×2, `dresser` (blue, gold handles), `cabinet` (curio bookcase with books, open frame), `round-table` (turned, with a lace cloth; the gramophone stands on it) | Sofa on the left wall; vanity and stool back-left; dresser on the right wall; cabinet back-right; stool beside the easel |
| Decor | `royal-rug` (lavender with a gold pattern), `royal-banner` ×2 (purple, gold emblem), `wall-lantern` ×2 (glowing body, no light source), `potted-plant` ×2, `hydrangea-vase`, `crystal-lamp`, `book-stack` | Front wall beside the painting; plants in the front corners; lamp, vase and books on the dresser |

- **Not used in the new layout:** canopy bed, night window, candle sconces with point lights, and the two flat banners. They remain available for older layouts.
- **No barriers:** nothing stands in front of the painting.
- **Backup:** the layout before Phase B is in `data/scenes/backups/puzzle-before-phaseB-*.json`.
- **Screenshots:** `puzzle-draw-sword/phaseB-front.jpg`, `phaseB-left.jpg`, `phaseB-right.jpg`, `phaseB-back.jpg`.

**Quest cost rules followed:**

- Each piece merges its parts into one mesh per material.
- Materials and canvas textures are shared.
- There is no transparency, apart from the banner cloth, which is alpha-tested.
- There are no mirrors and no added lights.

| Measurement (MOCK, after Phase B) | Value |
|---|---|
| Desktop view facing the painting | 89 draw calls, about 35k triangles, 9 textures, 9 shader programs |
| Emulated XR (stereo, both hands tracked) | 196 draw calls, about 92k triangles per frame; 158 meshes in the scene, about 50 of them the two primitive hand models |

**Phase C: lighting and materials (2026-11-14, 17:20).**

| Change | Detail |
|---|---|
| Lighting (`addRoomLights`) | Warm late-morning light from three cheap lights: a warm hemisphere (sky `#fff1dc`, lavender bounce `#c7a9d6`), a warm "sun" from the left window and a soft cool fill from the right. No shadow maps; no point lights (the old candle sconces with point lights are not in the layout) |
| Sunlight on the floor | New `sun-patch` piece: one additive window-pane-shaped quad per window, slanted into the room. Placed under the left and back windows |
| Contact shadows | One soft radial shadow quad under each floor piece: sofa, vanity, stools, dresser, cabinet, round table, plants, columns. Merged into the piece, so each piece costs one extra draw call |
| Gold and brass | Without an environment map, metalness 0.6–0.8 rendered gold as dark brown. One shared warm gold (metalness 0.3 with a faint warm emissive) is now used everywhere, including the frame, trim and the gramophone |
| Curtains | Double-sided cloth; the folds flatten where the curtain is gathered at the tie-back. This removes the dark streaks seen in Phase B |

The Orbis painting uses an unlit material (`MeshBasicMaterial`, no tone mapping), so these lighting changes do not alter its colours. Its MOCK stream was checked on the painting; the live stream was not re-run in this phase.

| Measurement (MOCK, after Phase C) | Value |
|---|---|
| Desktop view toward the left window | 71 draw calls, about 28k triangles, 14 textures, 10 programs |
| Emulated XR (stereo, both hands tracked) | 208 draw calls, about 92k triangles per frame; 171 meshes |

Screenshots: `puzzle-draw-sword/phaseC-front.jpg`, `phaseC-left-sunpatch.jpg`.

**Layout-file protection (found during Phase C).** A stale `/editor` tab overwrote `data/scenes/puzzle.json` four times with the very first layout: at 16:57:46, 17:08:41, 17:17:46, and once earlier at 16:5x. The editor autosaves its in-memory copy after any change, and that copy was loaded before Phase A. Fix:

- **Server:** `writeScene` takes an optional base version, the `savedAt` the editor loaded. If the file on disk has a different `savedAt`, it refuses the save with HTTP 409.
- **Editor:** sends that version as `X-Scene-Base`. On 409 it shows "SAVE BLOCKED … reload the editor" and writes nothing.
- **Other callers:** a save without the header (scripts) is unchanged.

Verified against the 3200 dev server: a save with an old base returned 409, and the file kept its 33 Phase C objects.

Changed files (outside `app/puzzle`): `app/lib/sceneData/serverStore.ts`, `app/api/scene/route.ts`, `app/editor/EditorApp.tsx`. All three changes are additive.

### Interaction

| Input | Crayon | Tonearm | Buttons |
|---|---|---|---|
| Quest hand tracking (primary) | Pinch within 9 cm of the crayon to pick it up. It sits in the pinch, pointing along the hand. It draws while the tip (or the pinch point) is within 2.5 cm in front of the canvas, or up to 3.5 cm through it. Release the pinch and it returns to the ledge | Pinch within 9 cm of the arm head, swing it, release | Index fingertip within 3 cm. The button re-arms once the finger moves 7 cm away |
| Touch controllers (fallback) | Trigger or grip acts as a pinch, at a point 5 cm in front of the grip | Same | Controller tip |
| Desktop | Mouse drag on the canvas | Click the gramophone (toggles) | Click |

Pinch detection uses the WebXR `select` events: a thumb–index pinch is the primary action of a `generic-hand` input, per Meta's webxr-hands documentation. Joint poses come from `renderer.xr.getHand(i)`. Hands are drawn with three's primitive "spheres" hand model, which needs no downloads. The VR button requests `hand-tracking` as an optional feature.

### Puzzle logic

- **Puzzle 1:** the tonearm is "playing" when its head is released over the grooves, between 5 and 11.5 cm from the record centre. Audio is generated all the time (the model default); the gramophone only mutes or unmutes the `main_audio` track on the page. So puzzle 1 sends no command and spends no extra credit. In MOCK mode the needle starts a soft synthesised music-box loop instead.
- **Audio prompts:**
  - urging: "A young girl's voice calling out urgently and anxiously, with a light breeze over grass."
  - happy: "A young girl laughing joyfully, with a light breeze and distant birdsong."
  - Both describe sound only, per the schema. A refusal is logged and ignored.
- **Puzzle 2:** the sword recognizer is unchanged (see below).
- **Order:**
  - With "sword counts only after sound" on (the default), a sword drawn before the gramophone plays is recognised but not sent. The plaque says the princess is calling but the room is silent.
  - If a sword is already on the canvas when the needle drops, it counts at that moment.
- **Dedupe:** exactly one `set_prompt(happy)` per run, deduplicated by run token.
- **Wrong drawings:** local feedback only. The ink flashes red 2.5 s after the last stroke, and no command is sent.
- **Reset:** a new run (`reset` → urging → `start`). The needle goes back to rest, the crayon returns to the ledge, and the canvas is cleared.

### No time limit for the player

| Risk | Handling |
|---|---|
| A command times out (`REQUEST_TIMEOUT`, seen on the Quest at 15:38:45: `set_prompt did not complete within 10s`) | Every command in a run, and the happy `set_prompt`, is retried after a timeout with 2 s → 10 s backoff. There is no attempt limit while the run is current and the connection is ready. A refusal still fails immediately |
| A run ends (`generation_complete`) | Measured `max_chunks=2000` (about 1 h at 18 fps). On `generation_complete` the app sends `start` again with the same prompt and counts it in the panel ("auto-continues") |
| The connection drops | Live mode reconnects automatically after 3 s, doubling up to 30 s, until it succeeds. A Disconnect pressed by the user is respected. After a reconnect the urging run restarts. Room progress (needle, drawing) is kept, and a sword already drawn counts again |
| The session token is re-minted after 1 h, and later session hops would 403 | `/puzzle` uses its own route, which mints 6 h tokens (the server cap) with a 20-session budget |
| The headset user can't reach the panel | Entering VR in live mode connects automatically |

### Prompts

**Phase D (2026-11-14, art direction "Cute Diorama Fantasy Animation").** Each prompt is built from four fixed parts, repeated word for word in every prompt:

- `PUZZLE_STYLE`: cute stylized 3D fantasy animation, whimsical diorama feel, rounded shapes, warm sunlight, a pastel sky-blue / ivory / lavender / gold palette.
- `PRINCESS_IDENTITY`: short golden-blonde wavy bob, small gold crown, large expressive brown eyes, rounded animated proportions, a blue-and-ivory layered gown with gold star embroidery, white puff sleeves, a gold brooch.
- `PAINTING_SETTING`: a sunlit garden terrace with lavender and hydrangeas, a waterfall and a distant pastel castle.
- `PUZZLE_CAMERA`: a static, eye-level medium shot.

Only one action sentence is added per beat:

- **urging:** anxious, calling out, palms pressed to the picture surface, beckoning.
- **happy:** laughing, clapping.

The prompts describe visual traits only and name no film, studio, game or series. The full text is in `app/puzzle/puzzleConfig.ts`.

`PUZZLE_INITIAL_IMAGE` (default `null`) adds an optional `uploadFile` → `set_image` step before each run's first prompt. It is meant for a 16:9 image of this princess in the garden world, never the room concept art. No image is set yet: the only source available is a 259 × 389 character sheet, and a crop of it on a plain background would pull the painting toward a plain background.

| Case (live, desktop, seed 42, 1080p) | Result | Evidence |
|---|---|---|
| Run 1, 16:54:41–16:55:19: identity matches the reference (blonde wavy bob, gold crown, blue/ivory gown with gold stars, puff sleeves); anxious urging | PASS | `puzzle-draw-sword/orbis-v2-run1-urging.png` |
| Run 1: happy beat keeps the same identity and background; she smiles | PASS | `set_prompt(puzzle:happy)` acknowledged at chunk 11; `orbis-v2-run1-happy.png` |
| Run 1: the setting text "inside an enchanted painting" made the model paint pillars and a gold frame edge inside the picture | FAIL → fixed | `orbis-v2-run1-urging.png`. The setting now describes an open outdoor garden that fills the picture edge to edge, without mentioning a painting or a frame |
| Run 2 after the fix, 16:56:27–16:56:52: no inner frame; same identity as run 1; anxious and calling out | PASS | `orbis-v3-run2-urging-a.png`, `orbis-v3-run2-urging-b.png`. One frame in between showed her with eyes closed and calling out, less obviously anxious |
| Happy beat with the fixed setting | NOT TESTED | Not repeated, to save credits |

**Colour pass (2026-11-14, about 17:58): lower saturation.** The user judged the generated picture too saturated: deep royal blue, vivid purple, strong gold. Two changes:

1. **Prompt (source).**
   - `PUZZLE_STYLE` now asks for "smooth matte stylized materials, warm hazy morning sunlight, gentle contrast and a soft, muted, low-saturation pastel palette of powder blue, warm ivory, dusty lavender and pale soft gold, with creamy highlights".
   - `PRINCESS_IDENTITY` uses a "soft powder blue and warm ivory" gown with "pale gold" stars and crown, and cream sleeves.
   - `PAINTING_SETTING` uses "pale lavender flowers and dusty-blue hydrangeas" and a "pale hazy sky".
   - The princess's identity is otherwise unchanged.
2. **Display (no credit).** The painting's shader applies a saturation factor, `paintingGrade`, read every frame. The default is `PAINTING_SATURATION = 0.85`, and the panel has a 0–1.3 slider ("Painting colour (display only, no credit)").

| Case | Result | Evidence |
|---|---|---|
| Live run 17:58:27–17:59:13 (about 46 s, disconnected) with the muted prompt | PARTIAL | `puzzle-draw-sword/orbis-v4-muted-urging.png`, compared with `orbis-v3-run2-urging-b.png`. The gown is lighter periwinkle instead of deep royal blue, and there is a warm haze in the background. The hydrangeas and the gold crown are still fairly saturated, so the model keeps a vivid bias. Identity is preserved: blonde bob, crown, star gown, anxious expression |
| Display saturation slider | PASS | MOCK painting at 1.0 and at 0.3: blue and red go nearly grey, applied instantly. The live stream uses the same material path; the live run was too short to take an in-room screenshot |
| Default 0.85 applied after rebuild | PASS | `next build` passed; `/puzzle` returns 200 locally and through the tunnel |

**Style tuner and face pass (2026-11-14, 18:09).**

*Style tuner* (`app/puzzle/components/StyleTuner.tsx`, `app/puzzle/lib/style.ts`, `/puzzle/api/style`):

- **Colour grade:** saturation, brightness, contrast, warmth, tint and gamma, applied to the painting by its shader every frame. No Orbis command, no credit.
- **Prompt parts:** style and palette (with four presets: soft muted pastel, airy and creamy, warm storybook glow, clean and bright), character, background, camera, and the two action lines. There is also a free notes field.
- **Apply to live picture:** saves the style, then re-sends the current beat's prompt on the same session. The picture morphs at the next chunk; there is no restart.
- **Save:** writes `data/puzzle-style.json`, plus a timestamped copy in `data/puzzle-style-history/`. Every run composes its prompts from this file. Without a file, the defaults in `puzzleConfig.ts` are used.

*Face* (user: "stiff and looks old"):

- `PRINCESS_IDENTITY` now spells out youthful cartoon proportions: a round soft face with full cheeks and a gentle blush, big round sparkling eyes, a tiny button nose and small mouth, and smooth stylized skin.
- `PUZZLE_STYLE` adds "soft diffused frontal light on faces".
- The camera is now waist-up with the face clearly visible, which gives the face more pixels.
- The actions are softer: "eyebrows lift softly, big eyes glisten, small open mouth" instead of pinched brows and a wide-open mouth. Both actions end with "Her face stays soft, smooth and youthful".

| Case (live, 18:09:10–18:11:10, disconnected) | Result | Evidence |
|---|---|---|
| Face, urging | PASS | Young cartoon face, big eyes, small nose and mouth, smooth skin, lively expression: `puzzle-draw-sword/orbis-v5-face-urging.jpg`. Colours in the raw stream are still fairly vivid (hydrangeas, crown) |
| Style tuner, "Apply to live picture" with the airy preset | PASS | `set_prompt(puzzle:urging, style tuner) ok` → `style applied live (urging) at chunk 22`. A hazier, lighter background; identity kept: `orbis-v5-airy-preset-live.png` |
| Display grade on the painting in the room (saturation 0.6, warmth 0.25) | PASS | Soft, muted, warm picture: `orbis-v5-room-grade-sat060-warm025.jpg` |
| Happy beat with the new face | PASS | `SWORD (score 0.84)` → `happy prompt acknowledged at chunk 46`. Smiling with curved eyes, youthful: `orbis-v5-happy.png` |
| Saved style file | — | The test's save (airy preset) was deleted afterwards, so the file only ever holds the user's own choice |

### Recognition (unchanged algorithm, new canvas size)

- **Blade:** one long, nearly straight stroke.
- **Guard:** a shorter, nearly straight, roughly perpendicular stroke. It must cross the blade line near one end, leaving a handle beyond it.
- Every stroke pair is tried. Strokes are smoothed with the endpoints kept in place.
- Thresholds are relative to the canvas height, which is now 0.55 m. Defaults:

| Parameter | Default |
|---|---|
| `minBladeFrac` | 0.35 |
| `bladeStraightMin` / `guardStraightMin` | 0.90 / 0.80 |
| guard length ÷ blade | 0.15…0.90 |
| `angleTolDeg` | 30 |
| guard position from the blade end | 0.04…0.40 |
| `crossMin` | 0.15 |
| `maxExtraInkRatio` | 1.0 |

All thresholds have sliders in the panel.

## Desktop (Chromium)

Tested on a separate `next start` on port 3100, built from a copy of `app/puzzle` outside the repo. The server on port 3000 and its `.next` were not touched.

| Case | Result | Evidence |
|---|---|---|
| `tsc --noEmit` (puzzle files) | PASS | No errors in `app/puzzle` |
| `next build` (includes type check) | PASS | `/puzzle` 36.1 kB / 305 kB first load; `/puzzle/api/token` built |
| Recognizer unit tests (`node --test app/puzzle/lib/swordRecognizer.test.mjs`) | PASS | 14/14 |
| Room renders: painting, easel, crayon, gramophone, pedestal, bed, window, sconces | PASS | `puzzle-draw-sword/room-desktop-mock.jpg` |
| MOCK: mouse drawing on the easel canvas; wrong shapes give local hints only | PASS | `guard length off (vs blade)`, then `guard at the very tip (no handle)`, then `not a sword … local hint only, no command sent` |
| MOCK: sword before sound is held back | PASS | `stroke 2 via mouse → SWORD (score 0.88)` → `sword recognized but not sent — no sound yet (puzzle 1 unsolved)` |
| MOCK: click gramophone → sound on → the waiting sword counts | PASS | `gramophone PLAYING — room has sound` → `MOCK solved` → `sword recognized → happy prompt` |
| LIVE: connect with the 6 h token route | PASS | `reactor status → ready` in about 2 s |
| LIVE: run commands | PASS | `set_seed(42)` → `set_resolution(1080p)` → `set_audio_prompt(urging)` ok → `set_prompt(puzzle:urging)` ok → `start` ok → `generation_started max_chunks=2000 audio=true` → first frames after 6.0 s |
| LIVE: princess visible in the painting | PASS | `puzzle-draw-sword/room-live-painting.png` |
| LIVE: audio track bound and muted, then unmuted by the gramophone | PASS | `<audio>`: 1 track, `muted: true, paused: false` → click gramophone → `muted: false`. Not listened to; the desktop test was silent by design |
| LIVE: user Disconnect does not auto-reconnect | PASS | `reactor status → disconnected` at 16:09:36, with no reconnect afterwards. The live session ran 16:09:11–16:09:36 (about 25 s) |
| LIVE: sword → happy prompt in the new room | NOT TESTED | Not repeated, to save credits. The same path passed in the earlier version (below) |
| LIVE: auto-reconnect after an unexpected drop; auto-continue after `generation_complete`; timeout retry | NOT TESTED | No drop, run end or timeout happened during the short test |

**Issue found and fixed during testing:** the first build crashed in live mode as soon as the connection became ready (React error #185, maximum update depth). The auto-reconnect effect depended on the `useOrbisSession` return object, which is new on every render, and it wrote to the store on every run. It now depends on `status` only and writes only on change. After the fix, the live run above passed. The crashed attempt was closed by navigating away from the page.

## Emulated Quest 3 (IWER `metaQuest3`, hand mode)

The test sets `window.__iwer.primaryInputMode = 'hand'`, then drives `hands.right.position` and `updatePinchValue(1/0)` from a script. The `window.__puzzleTest` helpers used are `hands`, `crayonWorld`, `headWorld`, `headWorldAt`, `boardPoint`, `buttonWorld`, `strokes`, `soundOn`, `crayonHolder` and `tonearmHolder`.

| Case | Result | Evidence |
|---|---|---|
| Hand input sources | PASS | `#0 left hand [oculus-hand, generic-hand, generic-hand-select, generic-trigger]`, `#1 right hand […]`; joints tracked; sphere hand models visible (`puzzle-draw-sword/room-iwer-hands.jpg`) |
| Pinch the tonearm, swing it onto the record, release → sound | PASS | `tonearm grabbed by right hand` → `gramophone PLAYING — room has sound` → `tonearm released` |
| Pinch the crayon | PASS | `crayon picked up by right hand` |
| Draw by touching the canvas (no button) → sword | PASS | `stroke 1 via right hand → no guard (cross-piece) yet` → local hint → `stroke 2 via right hand → SWORD (score 0.87)` → `MOCK solved` |
| Release the pinch → crayon back on the ledge | PASS | `crayon back on the ledge` |
| Fingertip poke on RESET | PASS | `button reset via fingertip poke` → `new run #2 (mock)`, needle back to rest (`gramophone stopped — silent`), canvas cleared |
| Phase A layout (16:59): tonearm → sound → crayon → sword | PASS | `gramophone PLAYING` → `crayon picked up by right hand` → `stroke 2 via right hand → SWORD (score 0.87)` → `MOCK solved` → `crayon back on the ledge` |
| Phase B room (17:14–17:15): tonearm → sound → crayon → sword → fingertip RESET | PASS | `crayon picked up by right hand` → `stroke 2 via right hand → SWORD (score 0.87)` → `MOCK solved` (the sound gate was on, so sound was on) → `crayon back on the ledge` → `button reset via fingertip poke`. An earlier attempt with 0.7 s script steps lost poses: the heavier scene in a hidden pane renders slower. It passed with 1.3 s steps; this was a test-script timing issue, not an app change |
| Phase C room (17:21–17:22): tonearm → sound → crayon → sword → fingertip RESET | PASS | `gramophone PLAYING` → `crayon picked up by right hand` → `stroke 2 via right hand → SWORD (score 0.87)` → `MOCK solved` → `crayon back on the ledge` → `button reset via fingertip poke` |
| Haptics | NOT TESTED | Not observable in IWER |

## Physical Meta Quest 3 (Meta Quest Browser)

None of these have been tested on the device in the new room design.

| Case | Result |
|---|---|
| `/puzzle` loads over the tunnel; ENTER VR with hand tracking | NOT TESTED |
| Room scale and layout feel right (5 × 5 m; painting easy to see on entering) | NOT TESTED |
| Hands visible (sphere model) and stable | NOT TESTED |
| Pinch picks up the crayon; it sits naturally in the pinch | NOT TESTED |
| Drawing by touching the easel canvas, with live ink | NOT TESTED |
| Recognition of a hand-drawn sword with default thresholds | NOT TESTED |
| Pinch-and-swing the tonearm onto the record | NOT TESTED |
| Live: princess audio audible after the needle drops; silent before | NOT TESTED |
| Live: sword drawn before sound is held back; counts after sound | NOT TESTED |
| Live: happy princess after the sword | NOT TESTED |
| Fingertip poke on RESET / CLEAR | NOT TESTED |
| Entering VR in live mode auto-connects | NOT TESTED |
| Long sitting (> 10 min) without the painting dying; auto-reconnect after a Wi-Fi drop | NOT TESTED |
| Controller fallback (trigger or grip as pinch) | NOT TESTED |
| Controller ray: trigger on RESET / CLEAR / gramophone from a distance | NOT TESTED |
| Frame rate in the room (HUD `fps`, right of the painting): steady at the headset refresh rate (72/90 Hz), no stutter while turning | NOT TESTED |
| Video health in XR (HUD `dec` ≈ 18 and `tex` ≈ `dec`, no `FALLBACK`) with the live stream | NOT TESTED |

## Phase E: Quest 3 performance and interaction (2026-11-14, 17:28)

| Change | Detail |
|---|---|
| Runtime static batching (`app/puzzle/lib/staticBatch.ts`) | After the layout is built, the room shell and all built-in decor are merged into one mesh per material, with transforms baked and `matrixAutoUpdate` off. Not batched: the painting, easel, gramophone, buttons, crayon, hands and imported GLBs. This three version (0.187) has no WebGL multiview, so in VR every mesh is drawn once per eye; fewer meshes means proportionally fewer draw calls. The Scene Editor still shows individual pieces |
| Controller pointer ray | Hands are unchanged (pinch to grab, fingertip to press). A controller shows a short pale ray. Its trigger first tries to grab the crayon or tonearm within reach; if nothing is in reach, the ray presses RESET / CLEAR or toggles the gramophone. The ray shortens to the object it hits |
| Hand model | Already instanced in three (`XRHandPrimitiveModel`: one draw call per hand); unchanged |

| Measurement (MOCK) | Before Phase E | After Phase E |
|---|---|---|
| Static meshes | 129 | 39 (log: `static batching: 129 meshes → 39`) |
| Desktop view facing the painting | 89 draw calls | 57 draw calls, about 59k triangles. Merged meshes are no longer frustum-culled piece by piece, so the triangle count goes up |
| Emulated XR, stereo, controllers | — | 130 draw calls, about 119k triangles per frame (both eyes) |
| Emulated XR, stereo, hands | 208 draw calls, about 92k triangles | 126 draw calls, about 136k triangles per frame (both eyes) |

The triangle count stays far below what a Quest 3 handles comfortably; draw calls are the usual limit on standalone headsets. The real frame rate must be read on the device: the HUD `fps` value is the frame-loop rate inside XR.

| Case (IWER, MOCK) | Result | Evidence |
|---|---|---|
| Controller ray on the gramophone → sound on | PASS | `gramophone PLAYING — room has sound` after one trigger press aimed at the tonearm head; `soundOn() = true` |
| Controller ray on RESET | PASS | `button reset via controller ray (right controller)` → `new run #2 (mock) — Reset puzzle` |
| Hands after batching: tonearm → sound → crayon → sword | PASS | `tonearm grabbed by right hand` → `gramophone PLAYING` → `crayon picked up by right hand` → `stroke 2 via right hand → SWORD (score 0.87)` → `MOCK solved` → `crayon back on the ledge` |
| Room looks unchanged after batching | PASS | Front view identical to Phase C; `puzzle-draw-sword/phaseE-iwer-xr.jpg` (emulated XR) |

## Earlier version (lectern + pen, controllers), same day

These results are for the first `/puzzle` version and were not re-run in the new room. The screenshots are kept in `puzzle-draw-sword/` (`mock-*`, `iwer-contact-solved.jpg`, `live-*`).

| Case | Result | Evidence |
|---|---|---|
| LIVE: urging → mouse-drawn sword → one `set_prompt(happy)` → happy princess | PASS | `set_prompt(puzzle:happy) ok`, `acknowledged at chunk 15`; screenshots `live-1-urging.jpg`, `live-3-happy-closeup.png` (hands pressed together, smiling) |
| LIVE: an open-mouthed laugh specifically | PARTIAL | The captured frames showed a closed-mouth smile |
| IWER controllers: grip picks up the pen, trigger draws (ray and contact) → sword | PASS | `SWORD (score 0.88)` (ray), `SWORD (score 0.83)` (contact) |
| Physical Quest 3, live: `set_prompt(puzzle:urging)` timed out at 15:38:45 (`REQUEST_TIMEOUT … within 10s`) | FAIL | This led to the timeout retry above |

## Known limits

- The recognizer is geometric. A cross with its bar about 30% from one end is accepted.
- Pinch detection relies on Quest firing `select` for a hand pinch. If a build of Quest Browser does not, hands could not grab.
- The held crayon points along the wrist → index-tip direction. Contact also counts at the pinch point itself, to forgive how the crayon is held. This has not been tuned on the device.
- The audio prompt for urging asks for a calling voice. The audio is not lip-synced dialogue, and the words "draw your sword" are not expected to be intelligible.
