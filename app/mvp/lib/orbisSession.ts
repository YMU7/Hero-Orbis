"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useViskoOrbisStable,
  useViskoOrbisStableMessage,
  useViskoOrbisStableTrack,
  type ViskoOrbisStableStateMessage,
} from "@reactor-models/visko-orbis-stable";
import { useReactor, useStats, type ReactorError } from "@reactor-team/js-sdk";
import { PROMPTS, type PromptId } from "./prompts";
import { debug } from "./debugState";

// The ONE long-lived Orbis session owner for /mvp.
//
// Connection ownership: <ViskoOrbisStableProvider> (the typed provider from
// the reference app) owns the WebRTC session. This hook never creates a
// second Reactor instance; it reads the provider's store:
//   - useViskoOrbisStableTrack("main_video") → the raw MediaStreamTrack
//     (verified in @reactor-models/visko-orbis-stable@2.3.0:
//     `useReactor((s) => s.tracks[name])`), which videoBridge binds to an
//     app-owned <video> for THREE.VideoTexture.
//   - typed setPrompt()/start() → correlated awaited replies (js-sdk 3.x).
//   - command failures arrive two ways and BOTH are captured:
//       • `command_error` broadcast message (documented in the schema page)
//       • SDK `error` event with operation "sendCommand" (js-sdk 3.x; the
//         reference H3 templates read refusals this way — app/lib/command.tsx)
//     A refused call resolves `undefined`; it never throws.

const COMMAND_FAILURE = /^command '([^']+)' failed \(([^)]*)\): ([\s\S]*)$/;

export type SteerResult =
  | { ok: true }
  | { ok: false; reason: string };

export function useOrbisSession(opts: {
  autoStart: boolean;
  cooldownMs: number;
  /** Optional delivery tier sent via set_resolution BEFORE start (e.g. "1080p"). */
  resolution?: string | null;
}) {
  const s = useViskoOrbisStable();
  const { status, sessionId } = s;
  const track = useViskoOrbisStableTrack("main_video");
  const reactor = useReactor((st) => st.internal.reactor);
  const [snapshot, setSnapshot] = useState<ViskoOrbisStableStateMessage | null>(
    null,
  );
  // Session-scoped "already started" guard. Keyed by sessionId so a
  // reconnect (new session) starts again, and React Strict Mode's double
  // effect run can't send a second `start` for the same session.
  const startedForSession = useRef<string | null>(null);
  const inflight = useRef(false);
  const snapshotSeen = useRef(false);

  // ── Status / session mirrors ─────────────────────────────────────────────
  useEffect(() => {
    debug.set({ reactorStatus: status, sessionId: sessionId ?? null });
    debug.push("info", `reactor status → ${status}`);
    if (status !== "ready") {
      // The SDK emits no final `state` on disconnect — clear stale snapshot.
      setSnapshot(null);
      debug.set({
        started: false,
        running: false,
        currentChunk: null,
        requestedPrompt: null,
        acceptedPrompt: null,
        acceptedAtChunk: null,
      });
    }
    if (status === "disconnected") {
      startedForSession.current = null;
      snapshotSeen.current = false;
    }
  }, [status, sessionId]);

  // ── WebRTC stats from the SDK (received fps, bitrate, loss, RTT) ────────
  // Distinguishes "stream/network slow" from "rendering froze".
  const stats = useStats();
  useEffect(() => {
    if (!stats) return;
    debug.set({
      net: {
        fps: stats.framesPerSecond ?? null,
        kbps: stats.incomingBitrate != null ? Math.round(stats.incomingBitrate / 1000) : null,
        availKbps:
          stats.availableIncomingBitrate != null
            ? Math.round(stats.availableIncomingBitrate / 1000)
            : null,
        loss: stats.packetLossRatio ?? null,
        rttMs: stats.rtt ?? null,
        candidate: stats.candidateType ?? null,
      },
    });
  }, [stats]);

  // ── SDK error event: refusals + session/transport failures ───────────────
  useEffect(() => {
    const onError = (e: ReactorError) => {
      if (e.operation === "sendCommand") {
        const m = COMMAND_FAILURE.exec(e.message);
        const text = m ? `${m[1]}: ${m[3]} (${m[2]})` : `${e.code}: ${e.message}`;
        debug.set({ lastCommandError: text });
        debug.push("error", `command refused — ${text}`);
      } else {
        const text = `${e.code ?? "error"}${e.operation ? ` [${e.operation}]` : ""}: ${e.message}`;
        debug.set({ lastSessionError: text });
        debug.push("error", `session error — ${text}`);
      }
    };
    reactor.on("error", onError);
    return () => reactor.off("error", onError);
  }, [reactor]);

  // ── Model broadcasts ──────────────────────────────────────────────────────
  useViskoOrbisStableMessage((msg) => {
    switch (msg.type) {
      case "state":
        if (!snapshotSeen.current) {
          snapshotSeen.current = true;
          debug.push(
            "info",
            `first state: resolution=${msg.resolution} available=[${Array.isArray(msg.available_resolutions) ? msg.available_resolutions.join(", ") : "?"}]`,
          );
        }
        setSnapshot(msg);
        debug.set({
          started: msg.started,
          running: msg.running,
          currentChunk: msg.current_chunk,
        });
        break;
      case "command_error":
        debug.set({ lastCommandError: `${msg.command}: ${msg.reason}` });
        debug.push("error", `command_error — ${msg.command}: ${msg.reason}`);
        break;
      case "generation_started":
        debug.push(
          "info",
          `generation_started ${msg.width}x${msg.height} @ ${msg.fps} fps (${msg.resolution})`,
        );
        break;
      case "generation_complete":
        debug.push(
          "info",
          "generation_complete — model returned to WAITING (press Start to run again)",
        );
        startedForSession.current = null;
        break;
      case "generation_reset":
        debug.push("info", "generation_reset");
        break;
      default:
        break;
    }
  });

  // ── Command wrapper: log, time, read failures off the call ───────────────
  const run = useCallback(
    async <T,>(
      label: string,
      call: () => Promise<T | undefined>,
      expectsReply: boolean,
    ): Promise<{ ok: boolean; reply: T | undefined }> => {
      debug.set({ lastCommand: label, lastCommandAt: Date.now() });
      debug.push("cmd", `→ ${label}`);
      let failed = false;
      const onError = (e: ReactorError) => {
        if (e.operation === "sendCommand") failed = true;
      };
      reactor.on("error", onError);
      let reply: T | undefined;
      try {
        reply = await call();
      } catch (err) {
        // Not expected (commands resolve undefined on refusal) — but surface it.
        failed = true;
        const text = `${label}: ${(err as Error).message}`;
        debug.set({ lastCommandError: text });
        debug.push("error", `command threw — ${text}`);
      } finally {
        reactor.off("error", onError);
      }
      const ok = !failed && (!expectsReply || reply !== undefined);
      debug.push("cmd", `← ${label} ${ok ? "ok" : "FAILED/refused"}`);
      return { ok, reply };
    },
    [reactor],
  );

  // ── Start: setPrompt(initial) → start, once per session ─────────────────
  const startGeneration = useCallback(async () => {
    if (status !== "ready" || !sessionId) return;
    if (startedForSession.current === sessionId) return;
    startedForSession.current = sessionId;
    if (opts.resolution) {
      // Read once at `start`; must precede it. A value not on the deployment's
      // available_resolutions is refused (command_error names the list) and
      // the run proceeds at the default tier.
      await run(`set_resolution(${opts.resolution})`, () => s.setResolution({ resolution: opts.resolution! }), true);
    }
    const p = await run("set_prompt(initial)", () => s.setPrompt({ prompt: PROMPTS.initial }), true);
    if (!p.ok) {
      startedForSession.current = null;
      return;
    }
    debug.set({ requestedPrompt: "initial", acceptedPrompt: "initial" });
    const st = await run("start", () => s.start(), false);
    if (!st.ok) startedForSession.current = null;
  }, [status, sessionId, run, s, opts.resolution]);

  useEffect(() => {
    if (!opts.autoStart) return;
    // Measured 2026-11-14: the model sends NO `state` snapshot on connect —
    // only after the first command / chunk — so waiting for one deadlocked
    // auto-start. Start on `ready`; the per-sessionId guard prevents a double
    // start, and a snapshot that already says `started` skips it.
    if (status === "ready" && !snapshot?.started) {
      void startGeneration();
    }
  }, [opts.autoStart, status, snapshot, startGeneration]);

  // ── Steering: set_prompt on the SAME session, never start/reset ─────────
  const steer = useCallback(
    async (id: PromptId): Promise<SteerResult> => {
      const now = Date.now();
      const d = debug.get();
      if (status !== "ready") return { ok: false, reason: `not ready (${status})` };
      if (!snapshot?.started) return { ok: false, reason: "not generating yet" };
      if (now < d.cooldownUntil)
        return { ok: false, reason: `cooldown ${((d.cooldownUntil - now) / 1000).toFixed(1)}s` };
      if (inflight.current) return { ok: false, reason: "previous set_prompt in flight" };
      if (d.requestedPrompt === id) return { ok: false, reason: `already on "${id}"` };

      inflight.current = true;
      debug.set({ requestedPrompt: id, cooldownUntil: now + opts.cooldownMs });
      try {
        const r = await run(`set_prompt(${id})`, () => s.setPrompt({ prompt: PROMPTS[id] }), true);
        if (r.ok) {
          // Acknowledged by the model — NOT proof the picture has changed.
          debug.set({ acceptedPrompt: id, acceptedAtChunk: debug.get().currentChunk });
          return { ok: true };
        }
        return { ok: false, reason: "set_prompt refused (see command error)" };
      } finally {
        inflight.current = false;
      }
    },
    [status, snapshot, opts.cooldownMs, run, s],
  );

  return {
    status,
    sessionId,
    track,
    snapshot,
    lastError: s.lastError,
    connect: () => s.connect(),
    disconnect: () => s.disconnect(),
    startGeneration,
    steer,
  };
}
