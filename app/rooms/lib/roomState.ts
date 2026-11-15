"use client";

import { create } from "zustand";
import type { RoomAction } from "../roomConfigs";

// UI-facing state of the six-room benchmark. Written only by
// useRoomController; read by the scene, the panel and the HUD.

export type RoomPhase =
  | "idle" // no room selected yet
  | "waiting-connection" // room selected, Orbis not connected
  | "resetting" // clearing previous room's prompt/image/history
  | "conditioning" // seed / resolution / reference image / prompt
  | "starting" // start sent
  | "priming" // generating, first frames not yet arrived (SR priming)
  | "live" // frames from THIS activation are on the canvas
  | "mock" // mock source (no Orbis)
  | "error";

export type RoomEvent = { t: number; room: string; msg: string };

export type RoomStateData = {
  activeRoomId: string | null;
  /** Increments on every activation; stale async work compares against it. */
  activation: number;
  phase: RoomPhase;
  /** True once THIS activation produced frames; gates live video on the canvas. */
  liveReady: boolean;
  requestedAction: RoomAction | null;
  ackedAction: RoomAction | null;
  ackedAtChunk: number | null;
  cooldownUntil: number;
  activatedAt: number | null;
  firstFrameAt: number | null;
  lastError: string | null;
  /** Per-room results for the benchmark record. */
  results: Record<
    string,
    {
      activations: number;
      lastFirstFrameMs: number | null;
      actionsAcked: Partial<Record<RoomAction, number>>;
    }
  >;
};

type RoomState = RoomStateData & {
  set: (p: Partial<RoomStateData>) => void;
};

export const useRoomState = create<RoomState>((set) => ({
  activeRoomId: null,
  activation: 0,
  phase: "idle",
  liveReady: false,
  requestedAction: null,
  ackedAction: null,
  ackedAtChunk: null,
  cooldownUntil: 0,
  activatedAt: null,
  firstFrameAt: null,
  lastError: null,
  results: {},
  set: (p) => set(p),
}));

export const roomStore = {
  get: () => useRoomState.getState(),
  set: (p: Partial<RoomStateData>) => useRoomState.getState().set(p),
  bumpResult: (
    roomId: string,
    fn: (r: RoomStateData["results"][string]) => RoomStateData["results"][string],
  ) => {
    const s = useRoomState.getState();
    const cur = s.results[roomId] ?? { activations: 0, lastFirstFrameMs: null, actionsAcked: {} };
    s.set({ results: { ...s.results, [roomId]: fn(cur) } });
  },
};
