"use client";

import { create } from "zustand";
import { DEFAULT_SWORD_PARAMS, type SwordParams, type SwordResult } from "./swordRecognizer";
import { DEFAULT_REQUIRE_SOUND_FIRST } from "../puzzleConfig";

// UI-facing state of the /puzzle test. Written by usePuzzleController and the
// scene's interaction callbacks; read by the panel, the HUD and the scene.

export type PuzzlePhase =
  | "waiting-connection" // live mode, Orbis not connected (auto-reconnect may be pending)
  | "resetting" // reset sent (Reset puzzle / reconnect cleanup)
  | "conditioning" // seed / resolution / prompts
  | "starting" // start sent
  | "priming" // generating, no frames from THIS run yet
  | "urging" // princess on screen, waiting for a sword
  | "solving" // sword recognized, set_prompt(happy) in flight
  | "solved" // set_prompt(happy) acknowledged (or mock solved)
  | "error";

export type PuzzleStateData = {
  /** Increments on every (re)run; stale async work compares against it. */
  run: number;
  phase: PuzzlePhase;
  /** True once THIS run produced frames (gates live video in the painting). */
  liveReady: boolean;
  /** Run token for which the happy set_prompt was already sent (dedupe). */
  solvedRun: number | null;
  solvedAt: number | null;
  runStartedAt: number | null;
  firstFrameAt: number | null;
  happyAckChunk: number | null;
  lastError: string | null;
  /** Number of automatic restarts after generation_complete in this run. */
  continuations: number;
  // Puzzle 1 — gramophone
  soundOn: boolean;
  soundOnAt: number | null;
  requireSoundFirst: boolean;
  // Puzzle 2 — drawing / recognition
  strokeCount: number;
  lastResult: SwordResult | null;
  /** Local-only "that's not a sword" feedback (no Orbis command). */
  wrongHints: number;
  wrongFlashUntil: number;
  swordFlashUntil: number;
  /** A local hint line shown in the room (e.g. "she's trying to tell you something"). */
  hint: string | null;
  params: SwordParams;
  /** Who is holding the crayon / tonearm (for HUD/debug). */
  crayonHolder: string | null;
  tonearmHolder: string | null;
  drawMode: "none" | "contact" | "mouse";
  // Connection keep-alive
  autoReconnect: boolean;
  reconnectAttempts: number;
  nextReconnectAt: number | null;
};

type PuzzleState = PuzzleStateData & { set: (p: Partial<PuzzleStateData>) => void };

export const usePuzzleState = create<PuzzleState>((set) => ({
  run: 0,
  phase: "waiting-connection",
  liveReady: false,
  solvedRun: null,
  solvedAt: null,
  runStartedAt: null,
  firstFrameAt: null,
  happyAckChunk: null,
  lastError: null,
  continuations: 0,
  soundOn: false,
  soundOnAt: null,
  requireSoundFirst: DEFAULT_REQUIRE_SOUND_FIRST,
  strokeCount: 0,
  lastResult: null,
  wrongHints: 0,
  wrongFlashUntil: 0,
  swordFlashUntil: 0,
  hint: null,
  params: DEFAULT_SWORD_PARAMS,
  crayonHolder: null,
  tonearmHolder: null,
  drawMode: "none",
  autoReconnect: true,
  reconnectAttempts: 0,
  nextReconnectAt: null,
  set: (p) => set(p),
}));

export const puzzleStore = {
  get: () => usePuzzleState.getState(),
  set: (p: Partial<PuzzleStateData>) => usePuzzleState.getState().set(p),
};
