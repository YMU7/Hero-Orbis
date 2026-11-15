// Six-room Orbis visual-style benchmark — configuration only.
//
// Every room renders the SAME character, environment, camera and actions;
// only the style sentence differs. Prompts are composed from shared parts so
// that a difference between rooms can only come from the style line.
//
// Prompt rules followed (reference app skill/SKILL.md + Orbis prompt guide):
// full paragraphs, one continuous take, camera named explicitly, and every
// action prompt re-establishes the same setting before the change.

export type RoomAction = "initial" | "approach" | "point";

export type RoomConfig = {
  id: string;
  /** Visible style label in the room. */
  label: string;
  /** One sentence describing ONLY the visual style. */
  style: string;
  /** Accent colour for the room's frame/label/buttons (hex). */
  accent: number;
  /** Optional 16:9 reference image under /public (sent via set_image before
   *  start). Non-16:9 images are squashed to 832×480 by the model. */
  referenceImage?: string;
  /** Fully composed prompts — built below, overridable per room. */
  prompts: Record<RoomAction, string>;
};

// ── Shared, style-free parts ────────────────────────────────────────────────

/** Character + environment + camera. Identical in every room and action. */
export const SHARED_SCENE =
  "A young woman with shoulder-length auburn hair, wearing a dark green hooded travelling cloak over a cream linen dress, stands in a small moss-covered stone courtyard inside an old forest ruin. Behind her and to the left, a heavy arched wooden door with iron bands and a large iron padlock is set into a weathered stone wall; the door is closed and locked. Soft overcast daylight. Static camera, eye-level medium-wide shot with both the woman and the locked door fully in frame, single continuous take.";

/** Action beats. Identical in every room. */
export const SHARED_ACTIONS: Record<RoomAction, string> = {
  initial:
    "She stands calmly near the centre of the courtyard and glances around, her cloak stirring slightly in a light breeze. The camera does not move.",
  approach:
    "She notices the viewer, turns to look directly into the camera, and slowly walks toward the camera across the courtyard, step by step, coming closer to the lens. The camera does not move.",
  point:
    "She turns her body toward the locked wooden door and raises her right arm, pointing steadily at the iron padlock on the door. The camera does not move.",
};

/** Same seed in every room so differences come from the style, not noise. */
export const BENCHMARK_SEED = 42;

/** Default delivery tier. 1080p measured ~3× the frame rate of 2K over the
 *  same bandwidth (docs/testing/desktop-and-emulator.md); overridable with ?res=. */
export const DEFAULT_RESOLUTION = "1080p";

/** UI cooldown between action presses (one set_prompt per press). */
export const ACTION_COOLDOWN_MS = 4000;

export function composePrompt(style: string, action: RoomAction): string {
  return `${style} ${SHARED_SCENE} ${SHARED_ACTIONS[action]}`;
}

function room(
  id: string,
  label: string,
  style: string,
  accent: number,
  referenceImage?: string,
): RoomConfig {
  return {
    id,
    label,
    style,
    accent,
    referenceImage,
    prompts: {
      initial: composePrompt(style, "initial"),
      approach: composePrompt(style, "approach"),
      point: composePrompt(style, "point"),
    },
  };
}

// ── The six rooms (order = position around the viewer, room 1 straight ahead)

export const ROOMS: ReadonlyArray<RoomConfig> = [
  room(
    "realistic",
    "1 · Realistic Fantasy",
    "Photorealistic live-action fantasy film look: natural skin texture, realistic fabric, stone and wood materials, physically accurate lighting, shallow depth of field and cinematic colour grading.",
    0x8a8f98,
  ),
  room(
    "storybook-realism",
    "2 · Stylized Realism / Storybook Fantasy",
    "Stylized realism like a storybook fantasy film: gently exaggerated proportions, rich saturated yet believable colours, soft warm lighting and handcrafted, tactile textures.",
    0xc7913f,
  ),
  room(
    "animated-feature",
    "3 · Animated Feature Fantasy",
    "Polished 3D animated feature film look: smooth stylized character design with large expressive eyes, clean soft-lit skin, vibrant colours and high-quality CG rendering.",
    0x3fa7c7,
  ),
  room(
    "painterly",
    "4 · Painterly Storybook Illustration",
    "Painterly storybook illustration in motion: visible gouache and watercolour brushstrokes, soft paper texture, a muted harmonious palette and a hand-painted look in every frame.",
    0x9bbf6a,
  ),
  room(
    "anime",
    "5 · Anime Adventure Fantasy",
    "Hand-drawn anime adventure fantasy style: clean line art, cel shading, luminous colours, lush painted backgrounds and expressive anime character design.",
    0xe06aa0,
  ),
  room(
    "gothic",
    "6 · Dark Fairytale / Gothic Fantasy",
    "Dark gothic fairytale look: desaturated cold palette, deep shadows, low drifting mist, faint warm accents and an ominous, melancholic atmosphere, with the same courtyard and door.",
    0x7a5ccf,
  ),
];

export function findRoom(id: string | null | undefined): RoomConfig | undefined {
  return ROOMS.find((r) => r.id === id);
}
