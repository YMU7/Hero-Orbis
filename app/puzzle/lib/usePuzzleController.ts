"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useViskoOrbisStableChunkComplete,
  useViskoOrbisStableGenerationComplete,
  useViskoOrbisStableGenerationStarted,
} from "@reactor-models/visko-orbis-stable";
import type { useOrbisSession } from "../../mvp/lib/orbisSession";
import type { MockSource } from "../../mvp/lib/mockSource";
import { debug, type SourceMode } from "../../mvp/lib/debugState";
import { PUZZLE_AUDIO_PROMPTS, PUZZLE_INITIAL_IMAGE, PUZZLE_PROMPTS, PUZZLE_RESOLUTION, PUZZLE_SEED, type PuzzleBeat } from "../puzzleConfig";
import { puzzleStore } from "./puzzleState";

// Orbis lifecycle for "the princess in the painting" (same patterns as
// app/rooms/lib/useRoomController.ts):
//
//   run   : [reset if this session already generated] → set_seed(42)
//           → set_resolution(1080p) once per session → set_audio_prompt(urging)
//           → set_prompt(urging) → start
//   solve : exactly ONE set_prompt(happy) per run (deduped by run token),
//           only once the gramophone plays (unless that gate is turned off)
//   reset : new run token → run again; the room is reset too
//
// NO TIMEOUTS for the player (they may think for a long time):
//   - a command that times out (REQUEST_TIMEOUT — not a refusal) is retried
//     with backoff (2 s … 10 s) for as long as the run is current and the
//     connection is ready; a real refusal still fails;
//   - generation_complete (a run reached max_chunks) → `start` again with the
//     same prompt, so the painting never goes dead;
//   - dropped connections are reconnected by the app (useKeepConnected).
// Audio is generated all along (model default) and only muted/unmuted
// locally by the gramophone — puzzle 1 costs no extra command or credit.

type Orbis = ReturnType<typeof useOrbisSession>;
export type SolveOutcome = { ok: true } | { ok: false; reason: string; local?: boolean };

const log = (msg: string, kind: "info" | "cmd" | "error" = "info") => debug.push(kind, `[puzzle] ${msg}`);
const isTimeout = (e: string | null) => !!e && /REQUEST_TIMEOUT|timed out/i.test(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MOCK_LABEL: Record<PuzzleBeat, (sound: boolean) => string> = {
  urging: (s) => `Princess URGING — "draw your sword!" ${s ? "(sound ON)" : "(silent)"} (MOCK)`,
  happy: (s) => `Princess LAUGHING — sword drawn! ${s ? "(sound ON)" : "(silent)"} (MOCK)`,
};

export function usePuzzleController(opts: {
  orbis: Orbis;
  mode: SourceMode;
  mock: React.MutableRefObject<MockSource | null>;
  resolution: string | null;
  /** Clears the easel and lifts the gramophone needle (scene-owned). */
  resetRoom: () => void;
}) {
  const { orbis, mode, mock, resolution, resetRoom } = opts;
  const { status, run, client } = orbis;

  const chain = useRef<Promise<void>>(Promise.resolve());
  const dirty = useRef(false);
  const resolutionSent = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const resRef = useRef(resolution ?? PUZZLE_RESOLUTION);
  resRef.current = resolution ?? PUZZLE_RESOLUTION;
  const runRef = useRef(run);
  runRef.current = run;
  const clientRef = useRef(client);
  clientRef.current = client;
  const resetRoomRef = useRef(resetRoom);
  resetRoomRef.current = resetRoom;

  const isCurrent = (token: number) => puzzleStore.get().run === token;

  const setMockBeat = useCallback(
    (beat: PuzzleBeat) => {
      mock.current?.setScene(beat === "urging" ? "night" : "initial");
      mock.current?.setLabel(MOCK_LABEL[beat](puzzleStore.get().soundOn));
    },
    [mock],
  );

  /** One command, retried on timeout until it succeeds or the run/connection ends. */
  const cmd = useCallback(async <T,>(token: number, label: string, call: () => Promise<T | undefined>, expectsReply: boolean) => {
    for (let attempt = 1; ; attempt++) {
      const before = debug.get().lastCommandError;
      const r = await runRef.current(attempt > 1 ? `${label} (retry ${attempt - 1})` : label, call, expectsReply);
      if (r.ok) return r;
      const err = debug.get().lastCommandError;
      if (err === before || !isTimeout(err)) return r; // a real refusal
      if (!isCurrent(token) || statusRef.current !== "ready") return r;
      const wait = Math.min(attempt * 2, 10);
      log(`${label} timed out — retrying in ${wait} s (no limit while connected)`, "error");
      await sleep(wait * 1000);
      if (!isCurrent(token) || statusRef.current !== "ready") return r;
    }
  }, []);

  // ── Serialized run body ─────────────────────────────────────────────────
  const runPuzzle = useCallback(
    async (token: number) => {
      const c = clientRef.current;
      const fail = (why: string) => {
        if (!isCurrent(token)) return;
        if (statusRef.current !== "ready") {
          puzzleStore.set({ phase: "waiting-connection", liveReady: false, lastError: `${why} (connection lost)` });
          log(`run interrupted by disconnect: ${why} — restarts on reconnect`, "error");
          return;
        }
        puzzleStore.set({ phase: "error", lastError: why });
        log(`run failed: ${why}`, "error");
      };
      if (!isCurrent(token)) return;
      if (statusRef.current !== "ready") {
        puzzleStore.set({ phase: "waiting-connection" });
        return;
      }
      if (dirty.current) {
        puzzleStore.set({ phase: "resetting" });
        const rs = await cmd(token, "reset", () => c.reset(), false);
        if (!rs.ok) return fail("reset refused");
        dirty.current = false;
        if (!isCurrent(token)) return log("superseded after reset");
      }
      puzzleStore.set({ phase: "conditioning" });
      await cmd(token, `set_seed(${PUZZLE_SEED})`, () => c.setSeed({ seed: PUZZLE_SEED }), false);
      if (!resolutionSent.current) {
        const rr = await cmd(token, `set_resolution(${resRef.current})`, () => c.setResolution({ resolution: resRef.current }), true);
        if (rr.ok) resolutionSent.current = true;
      }
      if (!isCurrent(token)) return log("superseded during conditioning");
      if (PUZZLE_INITIAL_IMAGE) {
        // Optional identity anchor (same pattern as the /rooms reference image).
        try {
          const blob = await fetch(PUZZLE_INITIAL_IMAGE).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.blob();
          });
          const ref = await c.uploadFile(blob, { name: "puzzle-initial" });
          if (!isCurrent(token)) return log("superseded during image upload");
          dirty.current = true;
          const im = await cmd(token, "set_image(puzzle-initial)", () => c.setImage({ image: ref }), true);
          if (!im.ok) log("set_image refused — continuing prompt-only", "error");
        } catch (e) {
          log(`initial image skipped: ${(e as Error).message}`, "error");
        }
      }
      if (PUZZLE_AUDIO_PROMPTS.urging) {
        const ap = await cmd(token, "set_audio_prompt(urging)", () => c.setAudioPrompt({ prompt: PUZZLE_AUDIO_PROMPTS.urging }), true);
        if (!ap.ok) log("set_audio_prompt refused — audio follows the picture", "error");
      }
      const p = await cmd(token, "set_prompt(puzzle:urging)", () => c.setPrompt({ prompt: PUZZLE_PROMPTS.urging }), true);
      dirty.current = true;
      if (!p.ok) return fail("set_prompt(urging) refused");
      if (!isCurrent(token)) return log("superseded before start");
      puzzleStore.set({ phase: "starting" });
      const st = await cmd(token, "start", () => c.start(), false);
      if (!st.ok) return fail("start refused");
      if (!isCurrent(token)) return log("superseded right after start");
      puzzleStore.set({ phase: "priming" });
      log(`run #${token} started — waiting for first frames of THIS run`);
    },
    [cmd],
  );

  const enqueue = useCallback(
    (job: () => Promise<void>) => {
      chain.current = chain.current.then(job).catch((e) => log(`job crashed: ${(e as Error).message}`, "error"));
    },
    [],
  );

  /** Start a fresh run (new token): Reset puzzle, mode switch, reconnect. */
  const resetPuzzle = useCallback(
    (why: string) => {
      const s = puzzleStore.get();
      const token = s.run + 1;
      resetRoomRef.current();
      puzzleStore.set({
        run: token,
        liveReady: false,
        solvedRun: null,
        solvedAt: null,
        happyAckChunk: null,
        runStartedAt: Date.now(),
        firstFrameAt: null,
        lastError: null,
        lastResult: null,
        strokeCount: 0,
        continuations: 0,
        soundOn: false,
        soundOnAt: null,
        hint: null,
        phase: modeRef.current === "mock" ? "urging" : statusRef.current === "ready" ? "resetting" : "waiting-connection",
      });
      log(`new run #${token} (${modeRef.current}) — ${why}`);
      if (modeRef.current === "mock") {
        setMockBeat("urging");
        puzzleStore.set({ liveReady: true, firstFrameAt: Date.now() });
        return;
      }
      if (statusRef.current === "ready") enqueue(() => runPuzzle(token));
    },
    [enqueue, runPuzzle, setMockBeat],
  );

  /** Called by the drawing layer when the recognizer accepts a sword. */
  const solve = useCallback(async (): Promise<SolveOutcome> => {
    const s = puzzleStore.get();
    if (s.solvedRun === s.run) return { ok: false, reason: "already solved this run (deduped)" };
    if (s.requireSoundFirst && !s.soundOn) return { ok: false, reason: "no sound yet (puzzle 1 unsolved)", local: true };
    if (s.phase !== "urging") return { ok: false, reason: `princess not on screen yet (${s.phase})` };
    const token = s.run;
    puzzleStore.set({ solvedRun: token, solvedAt: Date.now() });

    if (modeRef.current === "mock") {
      setMockBeat("happy");
      puzzleStore.set({ phase: "solved" });
      log("MOCK solved — no Reactor command sent");
      return { ok: true };
    }
    puzzleStore.set({ phase: "solving" });
    const c = clientRef.current;
    if (PUZZLE_AUDIO_PROMPTS.happy) {
      void runRef.current("set_audio_prompt(happy)", () => c.setAudioPrompt({ prompt: PUZZLE_AUDIO_PROMPTS.happy }), true);
    }
    const r = await cmd(token, "set_prompt(puzzle:happy)", () => c.setPrompt({ prompt: PUZZLE_PROMPTS.happy }), true);
    if (!isCurrent(token)) return { ok: false, reason: "run was reset" };
    if (!r.ok) {
      puzzleStore.set({ phase: "urging", solvedRun: null, lastError: "set_prompt(happy) refused" });
      return { ok: false, reason: "set_prompt refused" };
    }
    const chunk = debug.get().currentChunk;
    puzzleStore.set({ phase: "solved", happyAckChunk: chunk });
    log(`happy prompt acknowledged at chunk ${chunk ?? "?"} — picture morphs at the next chunk boundary`, "cmd");
    return { ok: true };
  }, [cmd, setMockBeat]);

  /** Gramophone changed (mock label only; live audio is muted locally by the app). */
  const onSound = useCallback(
    (on: boolean) => {
      if (modeRef.current === "mock") {
        const beat: PuzzleBeat = puzzleStore.get().phase === "solved" ? "happy" : "urging";
        mock.current?.setLabel(MOCK_LABEL[beat](on));
      }
    },
    [mock],
  );

  // ── First frames of THIS run → show live video ──────────────────────────
  useViskoOrbisStableChunkComplete((m) => {
    const s = puzzleStore.get();
    if (s.phase !== "priming" || (m.frames_emitted ?? 0) <= 0) return;
    const now = Date.now();
    puzzleStore.set({ phase: "urging", liveReady: true, firstFrameAt: now });
    log(`first frames after ${s.runStartedAt ? ((now - s.runStartedAt) / 1000).toFixed(1) : "?"} s (chunk ${m.chunk_index})`);
  });
  useViskoOrbisStableGenerationStarted((m) => {
    log(`generation_started max_chunks=${m.max_chunks}${m.max_chunks === 0 ? " (unlimited)" : ""} audio=${m.audio_enabled}`);
  });
  // A run that reached max_chunks: keep the painting alive with the same prompt.
  useViskoOrbisStableGenerationComplete((m) => {
    if (modeRef.current !== "live") return;
    const token = puzzleStore.get().run;
    const n = puzzleStore.get().continuations + 1;
    puzzleStore.set({ continuations: n });
    log(`generation_complete after ${m.total_chunks} chunks — continuing (start #${n + 1}, same prompt)`);
    enqueue(async () => {
      if (!isCurrent(token) || statusRef.current !== "ready") return;
      const st = await cmd(token, "start (continue)", () => clientRef.current.start(), false);
      if (!st.ok && isCurrent(token)) puzzleStore.set({ lastError: "continue start refused — press Reset puzzle" });
    });
  });

  // ── Connection lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready") {
      dirty.current = false;
      resolutionSent.current = false;
      if (modeRef.current === "live") {
        const ph = puzzleStore.get().phase;
        if (ph !== "waiting-connection") puzzleStore.set({ phase: "waiting-connection", liveReady: false });
      }
      return;
    }
    if (modeRef.current === "live" && puzzleStore.get().phase === "waiting-connection") {
      // A fresh session after a drop: restart the urging run, but keep the
      // player's progress in the room (needle position, drawing).
      const s = puzzleStore.get();
      const token = s.run + 1;
      puzzleStore.set({ run: token, liveReady: false, solvedRun: null, happyAckChunk: null, runStartedAt: Date.now(), firstFrameAt: null, lastError: null, continuations: 0 });
      log(`new run #${token} (live) — connected`);
      enqueue(() => runPuzzle(token));
    }
  }, [status, enqueue, runPuzzle]);

  // ── Mode switch (and first mount): fresh run in that mode ───────────────
  useEffect(() => {
    resetPuzzle(`mode ${mode}`);
  }, [mode, resetPuzzle]);

  return { resetPuzzle, solve, onSound };
}
