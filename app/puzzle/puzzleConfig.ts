// "The princess in the painting" — prompts and tunables only.
//
// Story: a princess is trapped inside a painting on the wall of her room.
// The live Orbis stream IS that painting. Puzzle 1: the room is silent until
// the player lowers the gramophone needle onto the spinning record (that
// un-mutes the generated audio). Puzzle 2: she urges "draw your sword!" —
// the player picks up a crayon and DRAWS a sword on the easel.
//
// Prompt rules (skill/SKILL.md): full paragraphs, one continuous take, the
// camera named explicitly, and the second prompt restates the SAME princess,
// outfit, setting and camera verbatim before describing the change.
//
// Art direction (final, 2026-11-14): "Cute Diorama Fantasy Animation" —
// polished whimsical 3D fairytale animation, rounded shapes, soft stylised
// materials, warm sunlight, pastel blue / ivory / lavender / gold palette.
// Princess identity from the user's character sheet (blonde princess on the
// left only). Visual traits only: no film, studio, game or series names and
// no instruction to imitate an existing title.
//
// CONSISTENCY RULE: every prompt = STYLE + IDENTITY + SETTING + CAMERA (all
// four fixed, verbatim) + one action sentence. Change only the action.

/** Fixed visual style (never edited per beat). */
// Colour pass (2026-11-14, user: "saturation too high"): the first version
// gave deep royal blue, vivid purple and strong gold. Wording now asks for a
// soft, muted, low-saturation pastel grade explicitly, in style, outfit and
// setting alike (one vivid word anywhere pulls the whole frame back up).
export const PUZZLE_STYLE =
  "Cute stylized 3D fantasy animation with a whimsical fairytale diorama feel: soft rounded shapes, smooth matte stylized materials, warm hazy morning sunlight, soft diffused frontal light on faces, gentle soft shadows, gentle contrast and a soft, muted, low-saturation pastel palette of powder blue, warm ivory, dusty lavender and pale soft gold, with creamy highlights.";

/** Fixed princess identity (never edited per beat). */
// Face pass (2026-11-14, user: "face stiff, looks old"): youthful cartoon
// proportions spelled out (round soft face, big bright eyes, tiny nose and
// mouth, smooth skin) and softer expressions in the actions — strongly
// pinched brows / wide-open mouths read as wrinkles and age.
export const PRINCESS_IDENTITY =
  "A cheerful young girl princess with youthful, cute, childlike cartoon proportions: a round soft face with full cheeks and a gentle pink blush, big round sparkling brown eyes with large bright highlights, a tiny button nose and a small mouth, smooth flawless stylized skin and soft rounded features; a short golden-blonde wavy bob haircut and a small delicate pale-gold crown; she wears a layered royal gown in soft powder blue and warm ivory with pale gold embroidered star patterns, cream puff sleeves, a small pale-gold brooch at the neckline and delicate pale-gold accessories.";

/** Fixed world inside the painting. Deliberately does NOT say "painting" or
 *  "frame": measured 16:54 — "inside an enchanted painting" made the model
 *  draw pillars and a gold frame edge in the picture (a frame within our 3D
 *  frame). Described positively as an open view filling the picture. */
export const PAINTING_SETTING =
  "She stands outdoors on a sunlit fairytale garden terrace with pale lavender flowers and dusty-blue hydrangeas, a small waterfall and a distant pastel castle with pointed towers under a pale hazy sky; the open garden fills the whole picture from edge to edge.";

/** Fixed camera. */
export const PUZZLE_CAMERA =
  "Static camera, eye-level medium shot framing the princess from the waist up, centred in frame, facing the camera, her face clearly visible, single continuous take.";

/** Same princess, outfit, setting and camera in BOTH prompts. */
export const PUZZLE_SCENE = `${PRINCESS_IDENTITY} ${PAINTING_SETTING} ${PUZZLE_CAMERA}`;

export const PUZZLE_ACTIONS = {
  urging:
    "She looks worried and pleading in a cute, gentle way: her eyebrows lift softly, her big eyes glisten, and she calls out to the viewer with a small open mouth; she leans close to the picture surface, presses both small hands flat against it as if against invisible glass, then waves both arms and beckons quickly, bouncing with impatience. Her face stays soft, smooth and youthful. The camera does not move.",
  happy:
    "Her worry melts away: she beams with a big bright smile and joyful curved eyes, giggles happily with her shoulders bouncing, presses her hands together, then gives a cheerful little hop and claps. Her face stays soft, smooth and youthful. The camera does not move.",
} as const;

export type PuzzleBeat = keyof typeof PUZZLE_ACTIONS;

export const PUZZLE_PROMPTS: Record<PuzzleBeat, string> = {
  urging: `${PUZZLE_STYLE} ${PUZZLE_SCENE} ${PUZZLE_ACTIONS.urging}`,
  happy: `${PUZZLE_STYLE} ${PUZZLE_SCENE} ${PUZZLE_ACTIONS.happy}`,
};

/** set_audio_prompt per beat: what it should SOUND like (never a scene
 *  description — the schema says that makes audio worse). Best effort: a
 *  refusal is logged and ignored. Set to "" to let audio follow the picture. */
export const PUZZLE_AUDIO_PROMPTS: Record<PuzzleBeat, string> = {
  urging: "A young girl's voice calling out urgently and anxiously, with a light breeze over grass.",
  happy: "A young girl laughing joyfully, with a light breeze and distant birdsong.",
};

/** Optional 16:9 initial image for the painting (public URL, sent with
 *  uploadFile → set_image before every run's first prompt). null = prompt
 *  only. Must show THIS princess inside the painting world — never the whole
 *  room concept art. Non-16:9 images are squashed to 832×480 by the model. */
export const PUZZLE_INITIAL_IMAGE: string | null = null;

/** Display-side saturation of the painting (1 = as generated, 0 = grey).
 *  Applied in the painting shader every frame — no Orbis command, no credit.
 *  Tunable live from the panel. */
export const PAINTING_SATURATION = 0.85;

/** Same seed/tier as the style benchmark room tests. */
export const PUZZLE_SEED = 42;
export const PUZZLE_RESOLUTION = "1080p";

/** Puzzle order: the sword only counts once the gramophone plays (default). */
export const DEFAULT_REQUIRE_SOUND_FIRST = true;

/** Wait this long after the last stroke before showing "not a sword". */
export const WRONG_HINT_IDLE_MS = 2500;

/** Easel canvas size (metres) — shared by scene and recognizer. */
export const BOARD_W = 0.7;
export const BOARD_H = 0.55;

/** Room: the viewer starts at the origin, 2.6 m from the front wall, so the
 *  painting (on that wall) is ~2.5 m straight ahead. */
// Octagonal chamber (art pass 2026-11-15, top-down layout study). Walls at
// 45° steps: four 3.5 m walls (front / left / right / back) joined by four
// 1.49 m diagonal window walls. 5.6 m across, 3.2 m high. The front wall
// stays at z = −2.6 so the painting (z = −2.55) and the viewer's start at
// the origin are exactly where they were in the rectangular room.
//   half   = centre → axial wall (apothem)
//   corner = half-length of the axial walls (where the diagonals start)
export const OCTAGON = { cx: 0, cz: 0.2, half: 2.8, corner: 1.75, height: 3.2 } as const;

/** Bounding box of the octagon (used by AO, the baked environment, the rope). */
export const ROOM = {
  minX: OCTAGON.cx - OCTAGON.half,
  maxX: OCTAGON.cx + OCTAGON.half,
  minZ: OCTAGON.cz - OCTAGON.half,
  maxZ: OCTAGON.cz + OCTAGON.half,
  height: OCTAGON.height,
} as const;

export type RoomWall = { id: string; x: number; z: number; yaw: number; length: number; diagonal: boolean };

/** The eight wall segments: centre on the floor, yaw so local +Z faces into
 *  the room, and length. Clockwise from the front (painting) wall. */
export function roomWalls(): RoomWall[] {
  const { cx, cz, half: a, corner: f } = OCTAGON;
  const m = (a + f) / 2; // diagonal wall centre offset on each axis
  const diag = (a - f) * Math.SQRT2;
  return [
    { id: "front", x: cx, z: cz - a, yaw: 0, length: 2 * f, diagonal: false },
    { id: "front-right", x: cx + m, z: cz - m, yaw: -Math.PI / 4, length: diag, diagonal: true },
    { id: "right", x: cx + a, z: cz, yaw: -Math.PI / 2, length: 2 * f, diagonal: false },
    { id: "back-right", x: cx + m, z: cz + m, yaw: (-3 * Math.PI) / 4, length: diag, diagonal: true },
    { id: "back", x: cx, z: cz + a, yaw: Math.PI, length: 2 * f, diagonal: false },
    { id: "back-left", x: cx - m, z: cz + m, yaw: (3 * Math.PI) / 4, length: diag, diagonal: true },
    { id: "left", x: cx - a, z: cz, yaw: Math.PI / 2, length: 2 * f, diagonal: false },
    { id: "front-left", x: cx - m, z: cz - m, yaw: Math.PI / 4, length: diag, diagonal: true },
  ];
}

/** Floor outline of the octagon (counter-clockwise seen from above, x/z). */
export function roomOutline(): Array<[number, number]> {
  const { cx, cz, half: a, corner: f } = OCTAGON;
  return [
    [cx - f, cz - a], [cx + f, cz - a], [cx + a, cz - f], [cx + a, cz + f],
    [cx + f, cz + a], [cx - f, cz + a], [cx - a, cz + f], [cx - a, cz - f],
  ];
}

/** Closest point to (x, z) that stays `inset` metres inside the octagon. */
export function clampToRoom(x: number, z: number, inset = 0): [number, number] {
  const { cx, cz, half, corner } = OCTAGON;
  const a = half - inset;
  let px = Math.min(a, Math.max(-a, x - cx));
  let pz = Math.min(a, Math.max(-a, z - cz));
  const k = half + corner - inset * Math.SQRT2; // diagonal walls: |x| + |z| = k
  const s = Math.abs(px) + Math.abs(pz);
  if (s > k) {
    const d = (s - k) / 2;
    px -= Math.sign(px) * d;
    pz -= Math.sign(pz) * d;
  }
  return [px + cx, pz + cz];
}

/** Shared scene file for the room layout (data/scenes/puzzle.json, edited in /editor?scene=puzzle). */
export const PUZZLE_SCENE_ID = "puzzle";
