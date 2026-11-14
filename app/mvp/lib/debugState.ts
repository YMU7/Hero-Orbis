"use client";

import { create } from "zustand";
import type { PromptId } from "./prompts";
import type { VideoHealth } from "./videoTextureHealth";

// One store for every diagnostic in brief §9. Written by the session hook,
// the video bridge and the XR scene; read by DevPanel and the in-headset HUD.
// It holds diagnostics only — nothing in here drives the Reactor connection.

export type SourceMode = "mock" | "live";
export type LogKind = "info" | "cmd" | "error" | "xr" | "media";
export type LogEntry = { t: number; kind: LogKind; msg: string };

export type VideoStats = {
  readyState: number;
  width: number;
  height: number;
  paused: boolean;
  /** Increments while frames are arriving — proves the texture source moves. */
  frameCount: number;
  hasStream: boolean;
};

export type DebugState = {
  mode: SourceMode;
  // WebXR
  xrAvailable: boolean | null;
  immersiveVrSupported: boolean | null;
  xrSessionActive: boolean;
  inputSources: string[];
  // Reactor
  reactorStatus: string;
  sessionId: string | null;
  started: boolean;
  running: boolean;
  currentChunk: number | null;
  lastSessionError: string | null;
  // Commands
  lastCommand: string | null;
  lastCommandAt: number | null;
  lastCommandError: string | null;
  requestedPrompt: PromptId | null;
  acceptedPrompt: PromptId | null;
  acceptedAtChunk: number | null;
  cooldownUntil: number;
  // Input
  lastSelectionAt: number | null;
  lastSelectionId: string | null;
  lastSelectionSource: string | null;
  // Media
  live: VideoStats;
  mock: VideoStats;
  lastPlayError: string | null;
  /** Texture-level health of the ACTIVE source on the plane (~1 Hz). */
  videoHealth: VideoHealth | null;
  /** Totals accumulated while an immersive session is active. */
  xrVideo: { seconds: number; uploads: number; stalledSeconds: number; fallback: boolean; minRenderFps: number };
  emulation: string;
  /** WebRTC inbound stats from the SDK's useStats(). */
  net: {
    fps: number | null;
    kbps: number | null;
    availKbps: number | null;
    loss: number | null;
    rttMs: number | null;
    candidate: string | null;
  } | null;
  log: LogEntry[];

  set: (patch: Partial<DebugState>) => void;
  push: (kind: LogKind, msg: string) => void;
};

const EMPTY_VIDEO: VideoStats = {
  readyState: 0,
  width: 0,
  height: 0,
  paused: true,
  frameCount: 0,
  hasStream: false,
};

const MAX_LOG = 200;

export const useDebug = create<DebugState>((set) => ({
  mode: "mock",
  xrAvailable: null,
  immersiveVrSupported: null,
  xrSessionActive: false,
  inputSources: [],
  reactorStatus: "disconnected",
  sessionId: null,
  started: false,
  running: false,
  currentChunk: null,
  lastSessionError: null,
  lastCommand: null,
  lastCommandAt: null,
  lastCommandError: null,
  requestedPrompt: null,
  acceptedPrompt: null,
  acceptedAtChunk: null,
  cooldownUntil: 0,
  lastSelectionAt: null,
  lastSelectionId: null,
  lastSelectionSource: null,
  live: EMPTY_VIDEO,
  mock: EMPTY_VIDEO,
  lastPlayError: null,
  videoHealth: null,
  xrVideo: { seconds: 0, uploads: 0, stalledSeconds: 0, fallback: false, minRenderFps: Infinity },
  emulation: "off",
  net: null,
  log: [],

  set: (patch) => set(patch),
  push: (kind, msg) => {
    // Mirror to the console so a remote-debugged headset shows the same log.
    // Never log tokens or keys through here.
    const line = `[mvp:${kind}] ${msg}`;
    if (kind === "error") console.warn(line);
    else console.info(line);
    set((s) => ({
      log: [{ t: Date.now(), kind, msg }, ...s.log].slice(0, MAX_LOG),
    }));
  },
}));

/** Non-React accessor for imperative modules (scene, bridge). */
export const debug = {
  get: () => useDebug.getState(),
  set: (patch: Partial<DebugState>) => useDebug.getState().set(patch),
  push: (kind: LogKind, msg: string) => useDebug.getState().push(kind, msg),
};
