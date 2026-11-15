"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useViskoOrbisStableChunkComplete,
  useViskoOrbisStableGenerationStarted,
} from "@reactor-models/visko-orbis-stable";
import type { useOrbisSession } from "../../mvp/lib/orbisSession";
import type { MockSource } from "../../mvp/lib/mockSource";
import { debug, type SourceMode } from "../../mvp/lib/debugState";
import {
  ACTION_COOLDOWN_MS,
  BENCHMARK_SEED,
  findRoom,
  type RoomAction,
  type RoomConfig,
} from "../roomConfigs";
import { roomStore } from "./roomState";

// Room activation + Orbis session lifecycle for the six-room benchmark.
//
// ONE Orbis connection (owned by the typed provider via useOrbisSession) is
// shared by all rooms; only the active room generates. Switching rooms:
//
//   reset            → clears prompt, image AND the model's visual history
//                      (schema: "characters and setting persist across prompts
//                      until reset"; current_chunk → 0). Seed/resolution
//                      survive reset by design.
//   set_seed(42)     → same noise in every room → fair style comparison
//   set_resolution   → once per session (survives reset)
//   [upload + set_image]  → only if the room has a reference image
//   set_prompt(room.initial) → start
//
// Safety:
//   - Activations are SERIALISED on a promise chain, so commands from two
//     rooms never interleave.
//   - Each activation has a token; after every await it re-checks the token
//     and stops if a newer activation superseded it (the newer one begins
//     with its own reset, so nothing from the stale one survives).
//   - The canvas shows live video only after THIS activation's first chunk
//     with frames (frames_emitted > 0) — never the previous room's last frame.

type Orbis = ReturnType<typeof useOrbisSession>;
type Outcome = { ok: true } | { ok: false; reason: string };

function log(room: string, msg: string, kind: "info" | "cmd" | "error" = "info") {
  debug.push(kind, `[room ${room}] ${msg}`);
}

export function useRoomController(opts: {
  orbis: Orbis;
  mode: SourceMode;
  mock: React.MutableRefObject<MockSource | null>;
  resolution: string | null;
}) {
  const { orbis, mode, mock, resolution } = opts;
  const { status, run, client } = orbis;

  const chain = useRef<Promise<void>>(Promise.resolve());
  /** True once this Orbis session received any per-session input/start. */
  const dirty = useRef(false);
  const resolutionSent = useRef(false);
  const inflightAction = useRef(false);
  // Latest values for async code without stale closures.
  const statusRef = useRef(status);
  statusRef.current = status;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const resRef = useRef(resolution);
  resRef.current = resolution;
  const runRef = useRef(run);
  runRef.current = run;
  const clientRef = useRef(client);
  clientRef.current = client;

  const isCurrent = (token: number) => roomStore.get().activation === token;

  // ── The serialized activation body ────────────────────────────────────────
  const runActivation = useCallback(async (token: number, room: RoomConfig) => {
    const r = runRef.current;
    const c = clientRef.current;
    const fail = (why: string) => {
      if (!isCurrent(token)) return;
      // Measured 2026-11-14: the WebRTC peer dropped mid-activation and the
      // command failed with DISCONNECTED. That is a connection problem, not a
      // room problem — park the room so the next Connect resumes it.
      if (statusRef.current !== "ready") {
        roomStore.set({ phase: "waiting-connection", liveReady: false, lastError: `${why} (connection lost)` });
        log(room.id, `activation interrupted by disconnect: ${why} — will resume on reconnect`, "error");
        return;
      }
      roomStore.set({ phase: "error", lastError: why });
      log(room.id, `activation failed: ${why}`, "error");
    };
    if (!isCurrent(token)) return;
    if (statusRef.current !== "ready") {
      roomStore.set({ phase: "waiting-connection" });
      return;
    }

    // 1) Clear the previous room completely.
    if (dirty.current) {
      roomStore.set({ phase: "resetting" });
      const rs = await r("reset", () => c.reset(), false);
      if (!rs.ok) return fail("reset refused");
      dirty.current = false;
      if (!isCurrent(token)) return log(room.id, "superseded after reset");
    }

    // 2) Session knobs (survive reset; re-sending seed is cheap and explicit).
    roomStore.set({ phase: "conditioning" });
    await r(`set_seed(${BENCHMARK_SEED})`, () => c.setSeed({ seed: BENCHMARK_SEED }), false);
    if (resRef.current && !resolutionSent.current) {
      const rr = await r(`set_resolution(${resRef.current})`, () => c.setResolution({ resolution: resRef.current! }), true);
      if (rr.ok) resolutionSent.current = true;
    }
    if (!isCurrent(token)) return log(room.id, "superseded during conditioning");

    // 3) Optional reference image (uploadFile → set_image; await = decoded).
    if (room.referenceImage) {
      try {
        const blob = await fetch(room.referenceImage).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        });
        const ref = await c.uploadFile(blob, { name: `${room.id}-ref` });
        if (!isCurrent(token)) return log(room.id, "superseded during upload");
        dirty.current = true;
        const im = await r(`set_image(${room.id})`, () => c.setImage({ image: ref }), true);
        if (!im.ok) return fail("set_image refused");
      } catch (e) {
        return fail(`reference image: ${(e as Error).message}`);
      }
      if (!isCurrent(token)) return log(room.id, "superseded after set_image");
    }

    // 4) Room's initial prompt, then start (exactly one start per activation).
    const p = await r(`set_prompt(${room.id}:initial)`, () => c.setPrompt({ prompt: room.prompts.initial }), true);
    dirty.current = true;
    if (!p.ok) return fail("set_prompt refused");
    if (!isCurrent(token)) return log(room.id, "superseded before start");
    roomStore.set({ phase: "starting", requestedAction: "initial" });
    const st = await r("start", () => c.start(), false);
    if (!st.ok) return fail("start refused");
    if (!isCurrent(token)) return log(room.id, "superseded right after start");
    roomStore.set({ phase: "priming", ackedAction: "initial", ackedAtChunk: 0 });
    log(room.id, "started — waiting for first frames of THIS run");
  }, []);

  const enqueue = useCallback(
    (token: number, room: RoomConfig) => {
      chain.current = chain.current
        .then(() => runActivation(token, room))
        .catch((e) => log(room.id, `activation crashed: ${(e as Error).message}`, "error"));
    },
    [runActivation],
  );

  // ── Public: activate a room ───────────────────────────────────────────────
  const activateRoom = useCallback(
    (id: string) => {
      const room = findRoom(id);
      if (!room) return;
      const s = roomStore.get();
      if (s.activeRoomId === id && s.phase !== "error" && s.phase !== "waiting-connection") {
        log(id, "already active");
        return;
      }
      const token = s.activation + 1;
      roomStore.set({
        activeRoomId: id,
        activation: token,
        liveReady: false,
        requestedAction: null,
        ackedAction: null,
        ackedAtChunk: null,
        cooldownUntil: 0,
        activatedAt: Date.now(),
        firstFrameAt: null,
        lastError: null,
        phase: modeRef.current === "mock" ? "mock" : statusRef.current === "ready" ? "resetting" : "waiting-connection",
      });
      roomStore.bumpResult(id, (r) => ({ ...r, activations: r.activations + 1 }));
      log(id, `activated (#${token}, ${modeRef.current})`);

      if (modeRef.current === "mock") {
        mock.current?.setScene("initial");
        mock.current?.setLabel(`${room.label} — initial (MOCK)`);
        roomStore.set({ liveReady: true, ackedAction: "initial", requestedAction: "initial", firstFrameAt: Date.now() });
        return;
      }
      enqueue(token, room);
    },
    [enqueue, mock],
  );

  // ── Public: Approach / Point for a given room ─────────────────────────────
  const triggerAction = useCallback(
    async (roomId: string, action: Exclude<RoomAction, "initial">): Promise<Outcome> => {
      const s = roomStore.get();
      const room = findRoom(roomId);
      if (!room) return { ok: false, reason: "unknown room" };
      // Buttons control ONLY their own room's canvas.
      if (s.activeRoomId !== roomId) return { ok: false, reason: "room not active — select its canvas first" };
      const now = Date.now();
      if (now < s.cooldownUntil) return { ok: false, reason: `cooldown ${((s.cooldownUntil - now) / 1000).toFixed(1)}s` };
      if (s.requestedAction === action) return { ok: false, reason: `already "${action}"` };

      if (modeRef.current === "mock") {
        mock.current?.setScene(action === "approach" ? "rain" : "night");
        mock.current?.setLabel(`${room.label} — ${action} (MOCK)`);
        roomStore.set({ requestedAction: action, ackedAction: action, cooldownUntil: now + ACTION_COOLDOWN_MS });
        log(roomId, `MOCK ${action} (no Reactor command sent)`);
        return { ok: true };
      }

      if (s.phase !== "priming" && s.phase !== "live") return { ok: false, reason: `not generating (${s.phase})` };
      if (inflightAction.current) return { ok: false, reason: "previous action in flight" };
      const token = s.activation;
      inflightAction.current = true;
      roomStore.set({ requestedAction: action, cooldownUntil: now + ACTION_COOLDOWN_MS });
      try {
        const r = await runRef.current(
          `set_prompt(${roomId}:${action})`,
          () => clientRef.current.setPrompt({ prompt: room.prompts[action] }),
          true,
        );
        // A reply that lands after the user switched rooms must not touch the new room.
        if (!isCurrent(token)) {
          log(roomId, `${action} ack arrived after room switch — ignored`);
          return { ok: false, reason: "room switched" };
        }
        if (!r.ok) return { ok: false, reason: "set_prompt refused" };
        roomStore.set({ ackedAction: action, ackedAtChunk: debug.get().currentChunk });
        roomStore.bumpResult(roomId, (x) => ({
          ...x,
          actionsAcked: { ...x.actionsAcked, [action]: (x.actionsAcked[action] ?? 0) + 1 },
        }));
        return { ok: true };
      } finally {
        inflightAction.current = false;
      }
    },
    [mock],
  );

  // ── First real frames of THIS activation → show live video ─────────────────
  useViskoOrbisStableChunkComplete((m) => {
    const s = roomStore.get();
    if (s.phase !== "priming" || (m.frames_emitted ?? 0) <= 0) return;
    const now = Date.now();
    roomStore.set({ phase: "live", liveReady: true, firstFrameAt: now });
    const ms = s.activatedAt ? now - s.activatedAt : null;
    if (s.activeRoomId) {
      roomStore.bumpResult(s.activeRoomId, (r) => ({ ...r, lastFirstFrameMs: ms }));
      log(s.activeRoomId, `first frames after ${ms != null ? (ms / 1000).toFixed(1) : "?"} s (chunk ${m.chunk_index})`);
    }
  });
  useViskoOrbisStableGenerationStarted((m) => {
    const id = roomStore.get().activeRoomId;
    if (id) log(id, `generation_started ${m.width}x${m.height} (${m.resolution})`);
  });

  // ── Connection lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready") {
      // New connection = fresh session: nothing to reset, knobs to re-send.
      dirty.current = false;
      resolutionSent.current = false;
      const s = roomStore.get();
      if (modeRef.current === "live" && s.activeRoomId) {
        roomStore.set({ phase: "waiting-connection", liveReady: false, requestedAction: null, ackedAction: null });
      }
      return;
    }
    // Connected: (re)activate whichever room is selected.
    const s = roomStore.get();
    if (modeRef.current === "live" && s.activeRoomId && s.phase === "waiting-connection") {
      const room = findRoom(s.activeRoomId);
      if (room) {
        // Time-to-first-frame is measured from this (re)start, not from the
        // original click before the connection dropped.
        roomStore.set({ activatedAt: Date.now(), firstFrameAt: null });
        enqueue(s.activation, room);
      }
    }
  }, [status, enqueue]);

  // ── Source mode switch: re-activate the current room in the new mode ──────
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    const id = roomStore.get().activeRoomId;
    if (!id) return;
    // Force a fresh activation in the new mode.
    roomStore.set({ phase: "waiting-connection" });
    activateRoom(id);
  }, [mode, activateRoom]);

  return { activateRoom, triggerAction };
}
