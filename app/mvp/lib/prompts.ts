// Prompts for the visible steering test (brief §8). One fixed-camera world;
// each steer re-establishes the same setting verbatim and only changes the
// conditions, per the reference app's prompt rules (skill/SKILL.md).

export type PromptId = "initial" | "rain" | "night";

export const PROMPTS: Record<PromptId, string> = {
  initial:
    "A small stone courtyard with a single old tree in the center, under clear warm afternoon light. The leaves move gently in the breeze. Static camera, wide shot, single continuous take.",
  rain: "The same small stone courtyard with the single old tree in the center, same static wide shot. Gentle rain begins falling throughout the courtyard. Raindrops darken the paving stones and the old tree sways softly. Static camera, single continuous take.",
  night:
    "The same small stone courtyard with the single old tree in the center, same static wide shot. The courtyard gradually transitions into a quiet moonlit night. The tree remains in place, and soft blue moonlight illuminates the wet paving stones. Static camera, single continuous take.",
};

/** The two in-VR controls. `color` is the 3D button colour. */
export const XR_BUTTONS: ReadonlyArray<{
  id: Exclude<PromptId, "initial">;
  label: string;
  color: number;
}> = [
  { id: "rain", label: "A · RAIN", color: 0x2f7dd1 },
  { id: "night", label: "B · NIGHT", color: 0x6b4fd1 },
];

/** UI cooldown between steering presses (brief §3 Gate D: 3–5 s). */
export const DEFAULT_COOLDOWN_MS = 4000;
