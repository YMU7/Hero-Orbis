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
export const PUZZLE_STYLE =
  "Cute stylized 3D fantasy animation with a whimsical fairytale diorama feel: soft rounded shapes, smooth stylized materials, warm golden sunlight, gentle soft shadows and a pastel palette of sky blue, ivory, lavender and gold.";

/** Fixed princess identity (never edited per beat). */
export const PRINCESS_IDENTITY =
  "A young princess with a short golden-blonde wavy bob haircut, a small delicate gold crown, large expressive brown eyes, rosy cheeks and rounded, charming animated facial proportions, wearing a layered royal gown in blue and ivory with gold embroidered star patterns, white puff sleeves, a gold brooch at the neckline and small gold accessories.";

/** Fixed world inside the painting. Deliberately does NOT say "painting" or
 *  "frame": measured 16:54 — "inside an enchanted painting" made the model
 *  draw pillars and a gold frame edge in the picture (a frame within our 3D
 *  frame). Described positively as an open view filling the picture. */
export const PAINTING_SETTING =
  "She stands outdoors on a sunlit fairytale garden terrace with lavender flowers and hydrangeas, a small waterfall and a distant pastel castle with pointed towers under a soft blue sky; the open garden fills the whole picture from edge to edge.";

/** Fixed camera. */
export const PUZZLE_CAMERA =
  "Static camera, eye-level medium shot framing the princess from the knees up, centred in frame, facing the camera, single continuous take.";

/** Same princess, outfit, setting and camera in BOTH prompts. */
export const PUZZLE_SCENE = `${PRINCESS_IDENTITY} ${PAINTING_SETTING} ${PUZZLE_CAMERA}`;

export const PUZZLE_ACTIONS = {
  urging:
    "She is trapped inside the painting and worried: her eyebrows are pinched together, her eyes are wide and anxious, and she calls out to the viewer with her mouth wide open; she steps up close to the picture surface, presses both palms flat against it as if against invisible glass, then waves both arms and beckons quickly, bouncing on her toes with impatience. The camera does not move.",
  happy:
    "Her worry melts away: her shoulders relax, she presses her hands together and laughs happily with a big open smile and joyful curved eyes, her shoulders shaking with laughter, then gives a cheerful little hop and claps. The camera does not move.",
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

/** Room: 5 m × 5 m play area. The viewer starts at the origin, 2.6 m from the
 *  front wall, so the painting (on that wall) is ~2.5 m straight ahead. */
export const ROOM = { minX: -2.5, maxX: 2.5, minZ: -2.6, maxZ: 2.4, height: 3.2 } as const;

/** Shared scene file for the room layout (data/scenes/puzzle.json, edited in /editor?scene=puzzle). */
export const PUZZLE_SCENE_ID = "puzzle";
