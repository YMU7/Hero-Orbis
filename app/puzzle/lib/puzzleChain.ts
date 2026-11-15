// Puzzle chain built from the layout's components (pure, no DOM).
//
// Each scene object may carry a `puzzle` component (Scene Editor "+ Puzzle"):
// a trigger, an optional `requires` (another puzzle's id), an instruction
// sent to Orbis when solved, a sound and a hint. The painting object carries
// the opening instruction. The runtime keeps the list of solved ids per run.

import type { PaintingComponent, PuzzleComponent, PuzzleTrigger } from "../../lib/sceneData/components";
import type { SceneObject } from "../../lib/sceneData/types";
import { swordParamsFrom, type SwordParams } from "./swordRecognizer";

export type PuzzleDef = PuzzleComponent & { objectId: string; objectName: string; asset: string };

export type PuzzleSetup = {
  opening: PaintingComponent;
  puzzles: PuzzleDef[];
};

export const EMPTY_SETUP: PuzzleSetup = { opening: { startInstruction: "", audioPrompt: "" }, puzzles: [] };

export function collectPuzzles(layout: ReadonlyArray<SceneObject>): PuzzleSetup {
  const painting = layout.find((o) => o.painting)?.painting ?? EMPTY_SETUP.opening;
  const seen = new Set<string>();
  const puzzles: PuzzleDef[] = [];
  for (const o of layout) {
    if (!o.puzzle || seen.has(o.puzzle.id)) continue;
    seen.add(o.puzzle.id);
    puzzles.push({ ...o.puzzle, objectId: o.id, objectName: o.name, asset: o.asset });
  }
  return { opening: painting, puzzles };
}

export const isSolved = (p: PuzzleDef, solved: ReadonlyArray<string>) => solved.includes(p.id);

/** Requirement met (a `requires` pointing at a missing puzzle counts as met). */
export function isUnlocked(p: PuzzleDef, setup: PuzzleSetup, solved: ReadonlyArray<string>) {
  if (!p.requires) return true;
  if (!setup.puzzles.some((q) => q.id === p.requires)) return true;
  return solved.includes(p.requires);
}

/** The first unsolved puzzle in p's requirement chain that can be done now. */
export function blocker(p: PuzzleDef, setup: PuzzleSetup, solved: ReadonlyArray<string>): PuzzleDef | null {
  let cur: PuzzleDef | undefined = p;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    const req: PuzzleDef | undefined = cur.requires ? setup.puzzles.find((q) => q.id === cur!.requires) : undefined;
    if (!req || solved.includes(req.id)) return cur === p ? null : cur;
    cur = req;
  }
  return null;
}

/** Hint shown in the room: the first available, unsolved puzzle's hint. */
export function nextHint(setup: PuzzleSetup, solved: ReadonlyArray<string>): string | null {
  const p = setup.puzzles.find((q) => !isSolved(q, solved) && isUnlocked(q, setup, solved) && q.hint);
  return p?.hint ?? null;
}

export const allSolved = (setup: PuzzleSetup, solved: ReadonlyArray<string>) =>
  setup.puzzles.length > 0 && setup.puzzles.every((p) => solved.includes(p.id));

export const puzzlesWith = (setup: PuzzleSetup, trigger: PuzzleTrigger, objectId?: string) =>
  setup.puzzles.filter((p) => p.trigger === trigger && (objectId === undefined || p.objectId === objectId));

export const swordParamsOf = (p: PuzzleDef | undefined): SwordParams => swordParamsFrom(p?.sword);
