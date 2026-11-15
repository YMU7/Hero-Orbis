// Components that can be attached to a scene object (Scene Editor Inspector
// "+ Puzzle"). Pure data + validation; the puzzle room runtime gives them
// meaning (app/puzzle/lib/puzzleChain.ts).

/** How the player solves a puzzle attached to an object.
 *   needle     – put the gramophone needle on the record (gramophone only)
 *   draw-sword – draw a sword on the canvas (easel only)
 *   touch      – touch the object with a fingertip (desktop: click it)
 *   pinch      – pinch on the object (desktop: click it) */
export const PUZZLE_TRIGGERS = ["needle", "draw-sword", "touch", "pinch"] as const;
export type PuzzleTrigger = (typeof PUZZLE_TRIGGERS)[number];

export type PuzzleComponent = {
  /** Unique within the scene; other puzzles refer to it in `requires`. */
  id: string;
  trigger: PuzzleTrigger;
  /** Puzzle id that must be solved first (null = available from the start). */
  requires: string | null;
  /** Sent to Orbis when solved: what the princess DOES. The art style is
   *  fixed and always sent first. "" = no command. */
  instruction: string;
  /** Optional set_audio_prompt when solved (what it SOUNDS like). "" = none. */
  audioPrompt: string;
  /** Room sound played when solved (sound id, see roomAudio). "" = none. */
  sound: string;
  /** Shown in the room while this is the next puzzle, and when the player
   *  tries a later puzzle that needs this one first. */
  hint: string;
  /** draw-sword only: recognizer thresholds (missing keys = defaults). */
  sword?: Record<string, number>;
};

/** The painting's own settings: what the princess does when she appears. */
export type PaintingComponent = {
  startInstruction: string;
  audioPrompt: string;
};

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
export const isPuzzleId = (id: string) => /^[a-z0-9][a-z0-9_-]{0,40}$/.test(id);

export function parsePuzzle(raw: unknown, where: string): PuzzleComponent | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw new Error(`${where}.puzzle must be an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isPuzzleId(r.id)) throw new Error(`${where}.puzzle.id must be lowercase letters, digits, - or _`);
  if (!PUZZLE_TRIGGERS.includes(r.trigger as PuzzleTrigger)) throw new Error(`${where}.puzzle.trigger must be one of ${PUZZLE_TRIGGERS.join(", ")}`);
  const requires = typeof r.requires === "string" && r.requires ? r.requires : null;
  let sword: Record<string, number> | undefined;
  if (r.sword && typeof r.sword === "object") {
    sword = {};
    for (const [k, v] of Object.entries(r.sword as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && /^[a-zA-Z]{1,40}$/.test(k)) sword[k] = v;
  }
  return {
    id: r.id,
    trigger: r.trigger as PuzzleTrigger,
    requires,
    instruction: str(r.instruction),
    audioPrompt: str(r.audioPrompt, 500),
    sound: /^[a-z0-9-]{0,40}$/.test(str(r.sound)) ? str(r.sound) : "",
    hint: str(r.hint, 200),
    ...(sword ? { sword } : {}),
  };
}

export function parsePainting(raw: unknown): PaintingComponent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return { startInstruction: str(r.startInstruction), audioPrompt: str(r.audioPrompt, 500) };
}

/** Scene-level checks: unique puzzle ids, `requires` points at a puzzle,
 *  no cycles. Returns problems (empty = fine). */
export function checkPuzzles(list: Array<{ name: string; puzzle?: PuzzleComponent }>): string[] {
  const out: string[] = [];
  const byId = new Map<string, PuzzleComponent>();
  for (const o of list) {
    if (!o.puzzle) continue;
    if (byId.has(o.puzzle.id)) out.push(`puzzle id "${o.puzzle.id}" is used twice`);
    byId.set(o.puzzle.id, o.puzzle);
  }
  for (const p of byId.values()) {
    if (p.requires && !byId.has(p.requires)) out.push(`"${p.id}" requires "${p.requires}", which does not exist`);
    const seen = new Set<string>([p.id]);
    for (let q = p.requires ? byId.get(p.requires) : undefined; q; q = q.requires ? byId.get(q.requires) : undefined) {
      if (seen.has(q.id)) {
        out.push(`"${p.id}" is part of a requires loop`);
        break;
      }
      seen.add(q.id);
    }
  }
  return out;
}
