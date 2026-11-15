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
import { PUZZLE_ACTIONS, PUZZLE_AUDIO_PROMPTS, PUZZLE_INITIAL_IMAGE, PUZZLE_RESOLUTION, PUZZLE_SEED } from "../puzzleConfig";
import { composePrompt } from "./style";
import { puzzleStore, type PuzzleStateData } from "./puzzleState";
import { RESCUE_SCRIPT, type RescueBeat } from './rescueScript';
import { allSolved, blocker, isUnlocked } from "./puzzleChain";

// Orbis lifecycle for "the princess in the painting" (same patterns as
// app/rooms/lib/useRoomController.ts):
//
//   run   : [reset if this session already generated] → set_seed(42)
//           → set_resolution(1080p) once per session → set_audio_prompt(current)
//           → set_prompt(current) → start
//   solve : a puzzle component (Scene Editor "+ Puzzle") was solved: once per
//           puzzle per run, only when its `requires` is solved. If it has an
//           instruction, that becomes `current` and is sent as ONE
//           set_prompt (fixed art style + instruction), queued after any
//           command in flight.
//   reset : new run token → `current` back to the painting's opening
//           instruction, nothing solved, room reset, run again
//
// `current` survives a reconnect: the new run starts with what the princess
// was last doing, so progress is not lost.
//
// NO TIMEOUTS for the player (they may think for a long time):
//   - a command that times out (REQUEST_TIMEOUT — not a refusal) is retried
//     with backoff (2 s … 10 s) for as long as the run is current and the
//     connection is ready; a real refusal still fails;
//   - generation_complete (a run reached max_chunks) → `start` again with the
//     same prompt, so the painting never goes dead;
//   - dropped connections are reconnected by the app (useKeepConnected).
// Orbis audio generation is disabled before each run. Recorded rescue dialogue
// and local room sounds provide the puzzle audio.

type Orbis = ReturnType<typeof useOrbisSession>;
export type SolveOutcome = { ok: true } | { ok: false; reason: string; local?: boolean; hint?: string };

const log = (msg: string, kind: "info" | "cmd" | "error" = "info") => debug.push(kind, `[puzzle] ${msg}`);
const isTimeout = (e: string | null) => !!e && /REQUEST_TIMEOUT|timed out/i.test(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Chunks after the set_prompt ack before a cue counts as on screen. */
const MORPH_CHUNKS = 2;
/** Hard cap on any wait for the picture (the room never stalls on Orbis). */
const MORPH_CAP_MS = 5000;
/** Mock mode has no model: a short shimmer shows the effect. */
const MOCK_MORPH_MS = 1600;

/** The painting's opening (falls back to the built-in text before the layout loads). */
export function openingOf(s: PuzzleStateData): PuzzleStateData["current"] {
  const o = s.setup.opening;
  return {
    label: "opening",
    instruction: RESCUE_SCRIPT[0].cue,
    audioPrompt: "Quiet castle room ambience, no speech or music.",
  };
}

export function mockLabel(s: PuzzleStateData): string {
  const n = s.setup.puzzles.length;
  return `Princess · ${s.current.label} · solved ${s.solved.length}/${n} ${s.soundOn ? "(sound ON)" : "(silent)"} (MOCK)`;
}

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

  const updateMock = useCallback(() => {
    const s = puzzleStore.get();
    mock.current?.setScene(allSolved(s.setup, s.solved) ? "initial" : "night");
    mock.current?.setLabel(mockLabel(s));
  }, [mock]);

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

  const promptOf = (instruction: string) => composePrompt(puzzleStore.get().style.prompt, instruction);

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
      const audio = await cmd(token, "set_audio_enabled(false)", () => c.setAudioEnabled({ audio_enabled: false }), true);
      if (!audio.ok) return fail("set_audio_enabled(false) refused");
      if (!isCurrent(token)) return log("superseded while disabling Orbis audio");
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
      const cur = puzzleStore.get().current;
      if (cur.audioPrompt) {
        const ap = await cmd(token, `set_audio_prompt(${cur.label})`, () => c.setAudioPrompt({ prompt: cur.audioPrompt }), true);
        if (!ap.ok) log("set_audio_prompt refused — audio follows the picture", "error");
      }
      const p = await cmd(token, `set_prompt(puzzle:${cur.label})`, () => c.setPrompt({ prompt: promptOf(cur.instruction) }), true);
      dirty.current = true;
      if (!p.ok) return fail(`set_prompt(${cur.label}) refused`);
      if (!isCurrent(token)) return log("superseded before start");
      puzzleStore.set({ phase: "starting" });
      const st = await cmd(token, "start", () => c.start(), false);
      if (!st.ok) return fail("start refused");
      if (!isCurrent(token)) return log("superseded right after start");
      puzzleStore.set({ phase: "priming" });
      log(`run #${token} started (${cur.label}) — waiting for first frames of THIS run`);
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
      morphSeq.current++;
      for (const w of waiters.current.splice(0)) w.resolve();
      puzzleStore.set({
        run: token,
        morphing: false,
        liveReady: false,
        solved: [],
        solvedAt: null,
        current: openingOf(s),
        ackChunk: null,
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
        updateMock();
        puzzleStore.set({ liveReady: true, firstFrameAt: Date.now() });
        return;
      }
      if (statusRef.current === "ready") enqueue(() => runPuzzle(token));
    },
    [enqueue, runPuzzle, updateMock],
  );

  /** Layout loaded: puzzles known. Before anything is solved, the opening
   *  follows the painting component. */
  const onSetup = useCallback(() => {
    const s = puzzleStore.get();
    if (s.solved.length === 0 && s.current.label === "opening") puzzleStore.set({ current: openingOf(s) });
    if (modeRef.current === "mock") updateMock();
  }, [updateMock]);

  /** A puzzle's trigger happened (sword drawn, needle down, object touched…). */
  const solve = useCallback(
    (id: string): SolveOutcome => {
      const s = puzzleStore.get();
      const p = s.setup.puzzles.find((q) => q.id === id);
      if (!p) return { ok: false, reason: `no puzzle "${id}"` };
      if (s.solved.includes(id)) return { ok: false, reason: "already solved this run" };
      if (!isUnlocked(p, s.setup, s.solved)) {
        const b = blocker(p, s.setup, s.solved);
        return { ok: false, local: true, reason: `needs "${p.requires}" first`, hint: b?.hint || undefined };
      }
      const token = s.run;
      const solved = [...s.solved, id];
      const instruction = p.instruction.trim();
      puzzleStore.set({
        solved,
        solvedAt: Date.now(),
        ...(instruction ? { current: { label: p.id, instruction, audioPrompt: p.audioPrompt.trim() } } : {}),
      });
      log(`puzzle "${id}" solved (${solved.length}/${s.setup.puzzles.length})${instruction ? " → new instruction" : " (no instruction)"}`);
      if (modeRef.current === "mock") {
        updateMock();
        return { ok: true };
      }
      if (!instruction) return { ok: true };
      if (statusRef.current !== "ready") {
        log(`"${id}" instruction will be sent when the painting reconnects`);
        return { ok: true };
      }
      const c = clientRef.current;
      enqueue(async () => {
        if (!isCurrent(token) || statusRef.current !== "ready") return;
        const cur = puzzleStore.get().current;
        if (cur.label !== id) return; // a later puzzle already replaced it
        if (cur.audioPrompt) void runRef.current(`set_audio_prompt(${id})`, () => c.setAudioPrompt({ prompt: cur.audioPrompt }), true);
        const r = await cmd(token, `set_prompt(puzzle:${id})`, () => c.setPrompt({ prompt: promptOf(cur.instruction) }), true);
        if (!isCurrent(token)) return;
        if (!r.ok) {
          puzzleStore.set({ lastError: `set_prompt(${id}) refused — press Reset puzzle` });
          return;
        }
        const chunk = debug.get().currentChunk;
        puzzleStore.set({ ackChunk: chunk });
        log(`"${id}" instruction acknowledged at chunk ${chunk ?? "?"} — picture morphs at the next chunk boundary`, "cmd");
      });
      return { ok: true };
    },
    [cmd, enqueue, updateMock],
  );

  /** Style tuner: re-send the current instruction with the edited style
   *  (same session — the picture morphs at the next chunk, no restart). */
  const applyStyleLive = useCallback(async (): Promise<SolveOutcome> => {
    const s = puzzleStore.get();
    if (modeRef.current !== "live") return { ok: false, reason: "not in live mode" };
    if (statusRef.current !== "ready") return { ok: false, reason: "not connected" };
    if (s.phase !== "urging" && s.phase !== "priming") return { ok: false, reason: `not generating (${s.phase})` };
    const cur = s.current;
    const r = await cmd(s.run, `set_prompt(puzzle:${cur.label}, style tuner)`, () => clientRef.current.setPrompt({ prompt: promptOf(cur.instruction) }), true);
    if (!r.ok) return { ok: false, reason: "set_prompt refused" };
    log(`style applied live (${cur.label}) at chunk ${debug.get().currentChunk ?? "?"}`, "cmd");
    return { ok: true };
  }, [cmd]);

  /** Gramophone changed (mock label only; live audio is muted locally by the app). */
  const onSound = useCallback(() => {
    if (modeRef.current === "mock") updateMock();
  }, [updateMock]);

  // ── Morph tracking (script cues) ────────────────────────────────────────
  // Orbis applies a prompt at the next chunk boundary (~1.8 s) after the
  // set_prompt ack. A cue counts as "landed" once MORPH_CHUNKS chunks have
  // completed after its ack: by then the new prompt's frames are on screen.
  // Every wait is capped, so nothing in the room can hang on the model.
  const chunks = useRef(0);
  const waiters = useRef<Array<{ at: number; resolve: () => void }>>([]);
  const morphSeq = useRef(0);
  const settleWaiters = () => {
    const due = waiters.current.filter((w) => w.at <= chunks.current);
    waiters.current = waiters.current.filter((w) => w.at > chunks.current);
    for (const w of due) w.resolve();
  };
  const afterChunks = (n: number) => new Promise<void>((resolve) => waiters.current.push({ at: chunks.current + n, resolve }));

  // ── First frames of THIS run → show live video ──────────────────────────
  useViskoOrbisStableChunkComplete((m) => {
    chunks.current++;
    settleWaiters();
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
      // A fresh session after a drop: run again with the CURRENT instruction,
      // keeping the player's progress (solved puzzles, needle, drawing).
      const s = puzzleStore.get();
      const token = s.run + 1;
      puzzleStore.set({ run: token, liveReady: false, ackChunk: null, runStartedAt: Date.now(), firstFrameAt: null, lastError: null, continuations: 0 });
      log(`new run #${token} (live) — connected`);
      enqueue(() => runPuzzle(token));
    }
  }, [status, enqueue, runPuzzle]);

  // ── Mode switch (and first mount): fresh run in that mode ───────────────
  useEffect(() => {
    resetPuzzle(`mode ${mode}`);
  }, [mode, resetPuzzle]);

  /** Send a script cue at the moment of the action. Resolves when the picture
   *  has (probably) caught up — never later than MORPH_CAP_MS — so room
   *  effects can wait for it. The painting shimmers until then. */
  const steerScript = useCallback((beat: RescueBeat): Promise<void> => {
    if(!beat.cue)return Promise.resolve();
    const instruction=beat.cue;
    puzzleStore.set({current:{label:beat.id,instruction,audioPrompt:'Quiet castle room ambience, no speech or music.'}});
    const seq=++morphSeq.current;
    const settle=()=>{if(morphSeq.current===seq)puzzleStore.set({morphing:false});};
    const capped=(p:Promise<unknown>,ms:number)=>Promise.race([p.then(()=>undefined),sleep(ms)]).then(settle);
    if(modeRef.current==='mock'){updateMock();puzzleStore.set({morphing:true});return capped(sleep(MOCK_MORPH_MS),MOCK_MORPH_MS);}
    const s=puzzleStore.get();
    if(statusRef.current!=='ready'||!s.liveReady){settle();return Promise.resolve();}
    puzzleStore.set({morphing:true});
    const token=s.run;
    // Dispatch at the action, with no dialogue timers; only the shimmer waits.
    const landed=cmd(token, 'set_prompt(script:'+beat.id+')',()=>clientRef.current.setPrompt({prompt:promptOf(instruction)}),true).then(r=>{
      if(!r.ok){if(isCurrent(token))puzzleStore.set({lastError:'Script cue failed: '+beat.id});return;}
      const chunk=debug.get().currentChunk;
      puzzleStore.set({ackChunk:chunk});
      log(`cue "${beat.id}" acknowledged at chunk ${chunk ?? "?"}`,'cmd');
      return afterChunks(MORPH_CHUNKS);
    });
    return capped(landed,MORPH_CAP_MS);
  },[cmd,updateMock]);
  return { steerScript, resetPuzzle, solve, onSound, onSetup, applyStyleLive };
}
