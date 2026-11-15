// Style tuner data: the painting's display colour grade + the editable prompt
// parts. Shared by the page (client) and /puzzle/api/style (server), so it
// has no "use client" and no browser APIs.
//
// The user tunes the look in the panel; "Save" writes data/puzzle-style.json.
// Every later run composes its prompts from that file, and Claude can read
// the file to understand the colour/character look the user wants.

import { PUZZLE_ACTIONS, PUZZLE_CAMERA, PRINCESS_IDENTITY, PAINTING_SETTING, PUZZLE_STYLE, PAINTING_SATURATION, type PuzzleBeat } from "../puzzleConfig";

export type PaintGrade = {
  /** 0 = grey, 1 = as generated. */
  saturation: number;
  /** Multiplier on linear colour (1 = unchanged). */
  brightness: number;
  /** Around mid grey (1 = unchanged). */
  contrast: number;
  /** -1 cool (blue) … +1 warm (amber). */
  warmth: number;
  /** -1 green … +1 magenta. */
  tint: number;
  /** >1 lifts mid-tones, <1 deepens them. */
  gamma: number;
};

export type PromptParts = {
  style: string;
  identity: string;
  setting: string;
  camera: string;
  urging: string;
  happy: string;
};

export type PuzzleStyle = {
  version: 1;
  savedAt?: string;
  grade: PaintGrade;
  prompt: PromptParts;
  /** Free notes from the user ("what I want"), kept with the style. */
  notes: string;
};

export const GRADE_LIMITS: Record<keyof PaintGrade, { min: number; max: number; step: number; label: string }> = {
  saturation: { min: 0, max: 1.5, step: 0.01, label: "saturation" },
  brightness: { min: 0.6, max: 1.4, step: 0.01, label: "brightness" },
  contrast: { min: 0.6, max: 1.4, step: 0.01, label: "contrast" },
  warmth: { min: -1, max: 1, step: 0.01, label: "warmth (cool ↔ warm)" },
  tint: { min: -1, max: 1, step: 0.01, label: "tint (green ↔ magenta)" },
  gamma: { min: 0.7, max: 1.5, step: 0.01, label: "gamma (mid-tones)" },
};

export const DEFAULT_GRADE: PaintGrade = { saturation: PAINTING_SATURATION, brightness: 1, contrast: 1, warmth: 0, tint: 0, gamma: 1 };

export const DEFAULT_PROMPT: PromptParts = {
  style: PUZZLE_STYLE,
  identity: PRINCESS_IDENTITY,
  setting: PAINTING_SETTING,
  camera: PUZZLE_CAMERA,
  urging: PUZZLE_ACTIONS.urging,
  happy: PUZZLE_ACTIONS.happy,
};

export const defaultStyle = (): PuzzleStyle => ({ version: 1, grade: { ...DEFAULT_GRADE }, prompt: { ...DEFAULT_PROMPT }, notes: "" });

/** Palette presets for the style sentence (visual traits only, no titles). */
export const STYLE_PRESETS: Array<{ id: string; label: string; style: string }> = [
  { id: "default", label: "Soft muted pastel (default)", style: PUZZLE_STYLE },
  {
    id: "airy",
    label: "Airy, light and creamy",
    style:
      "Cute stylized 3D fantasy animation with a whimsical fairytale diorama feel: soft rounded shapes, smooth matte stylized materials, bright airy diffused daylight, very soft shadows, low contrast and a light, creamy, low-saturation palette of pale sky blue, cream white, soft lilac and champagne gold, as if seen through a gentle morning haze.",
  },
  {
    id: "storybook",
    label: "Warm storybook glow",
    style:
      "Cute stylized 3D fantasy animation with a whimsical fairytale diorama feel: soft rounded shapes, smooth matte stylized materials, warm golden-hour glow, soft gentle shadows and a warm, gently muted palette of dusty blue, honey ivory, mauve lavender and antique gold, with soft bloom on the highlights.",
  },
  {
    id: "clean",
    label: "Clean, gentle and bright",
    style:
      "Cute stylized 3D fantasy animation with a whimsical fairytale diorama feel: soft rounded shapes, clean smooth stylized materials, soft even daylight, gentle shadows, moderate contrast and a fresh, softly saturated pastel palette of baby blue, white, lavender and light gold.",
  },
];

const num = (v: unknown, k: keyof PaintGrade): number => {
  const L = GRADE_LIMITS[k];
  const n = typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_GRADE[k];
  return Math.min(L.max, Math.max(L.min, n));
};
const text = (v: unknown, fallback: string, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);

/** Validate untrusted JSON (POST body or file). Missing fields → defaults. */
export function parseStyle(raw: unknown): PuzzleStyle {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const g = (r.grade && typeof r.grade === "object" ? r.grade : {}) as Record<string, unknown>;
  const p = (r.prompt && typeof r.prompt === "object" ? r.prompt : {}) as Record<string, unknown>;
  const grade = Object.fromEntries((Object.keys(DEFAULT_GRADE) as Array<keyof PaintGrade>).map((k) => [k, num(g[k], k)])) as PaintGrade;
  const prompt = Object.fromEntries((Object.keys(DEFAULT_PROMPT) as Array<keyof PromptParts>).map((k) => [k, text(p[k], DEFAULT_PROMPT[k])])) as PromptParts;
  return {
    version: 1,
    savedAt: typeof r.savedAt === "string" ? r.savedAt : undefined,
    grade,
    prompt,
    notes: typeof r.notes === "string" ? r.notes.slice(0, 2000) : "",
  };
}

/** STYLE + IDENTITY + SETTING + CAMERA (fixed) + the beat's action. */
export function composePrompt(p: PromptParts, beat: PuzzleBeat): string {
  return `${p.style} ${p.identity} ${p.setting} ${p.camera} ${p[beat]}`;
}
