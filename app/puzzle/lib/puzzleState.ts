"use client";

import { create } from "zustand";
import { DEFAULT_SWORD_PARAMS, type SwordParams, type SwordResult } from "./swordRecognizer";
import { EMPTY_SETUP, type PuzzleSetup } from "./puzzleChain";
import { defaultStyle, type PuzzleStyle } from "./style";

// UI-facing state of the /puzzle test. Written by usePuzzleController and the
// scene's interaction callbacks; read by the panel, the HUD and the scene.

export type PuzzlePhase =
  | "waiting-connection" // live mode, Orbis not connected (auto-reconnect may be pending)
  | "resetting" // reset sent (Reset puzzle / reconnect cleanup)
  | "conditioning" // seed / resolution / prompts
  | "starting" // start sent
  | "priming" // generating, no frames from THIS run yet
  | "urging" // princess on screen, waiting for a sword
  | "solving" // (unused since puzzle components; kept for old panels)
  | "solved" // (unused since puzzle components; see allSolved())
  | "error";

export type PuzzleStateData = {
  /** Increments on every (re)run; stale async work compares against it. */
  run: number;
  phase: PuzzlePhase;
  /** True once THIS run produced frames (gates live video in the painting). */
  liveReady: boolean;
  /** Puzzles from the layout's components (Scene Editor "+ Puzzle"). */
  setup: PuzzleSetup;
  /** Puzzle ids solved in this run (kept across reconnects, cleared by Reset). */
  solved: string[];
  solvedAt: number | null;
  /** What the princess is currently doing: the opening instruction or the
   *  last solved puzzle's instruction. Re-sent after a reconnect. */
  current: { label: string; instruction: string; audioPrompt: string };
  runStartedAt: number | null;
  firstFrameAt: number | null;
  /** Chunk at which the last puzzle instruction was acknowledged. */
  ackChunk: number | null;
  lastError: string | null;
  /** Number of automatic restarts after generation_complete in this run. */
  continuations: number;
  // Gramophone (needle on the record)
  soundOn: boolean;
  soundOnAt: number | null;
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
  /** Style tuner: colour grade + prompt parts (saved to data/puzzle-style.json). */
  style: PuzzleStyle;
  /** savedAt of the style file on the server (null = never saved). */
  styleSavedAt: string | null;
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
  setup: EMPTY_SETUP,
  solved: [],
  solvedAt: null,
  current: { label: "opening", instruction: "", audioPrompt: "" },
  runStartedAt: null,
  firstFrameAt: null,
  ackChunk: null,
  lastError: null,
  continuations: 0,
  soundOn: false,
  soundOnAt: null,
  strokeCount: 0,
  lastResult: null,
  wrongHints: 0,
  wrongFlashUntil: 0,
  swordFlashUntil: 0,
  hint: null,
  params: DEFAULT_SWORD_PARAMS,
  style: defaultStyle(),
  styleSavedAt: null,
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
