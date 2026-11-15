"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ViskoOrbisStableProvider, useViskoOrbisStableTrack } from "@reactor-models/visko-orbis-stable";
import { useOrbisSession } from "../mvp/lib/orbisSession";
import { bindStream, streamForTrack, watchVideo } from "../mvp/lib/videoBridge";
import { createMockSource, type MockSource } from "../mvp/lib/mockSource";
import { debug, useDebug, type SourceMode } from "../mvp/lib/debugState";
import { installQuestEmulatorIfRequested } from "../mvp/lib/xrEmulation";
import type { VideoHealth } from "../mvp/lib/videoTextureHealth";
import { BOARD_H, PUZZLE_RESOLUTION, WRONG_HINT_IDLE_MS } from "./puzzleConfig";
import { MOCK_LABEL, usePuzzleController } from "./lib/usePuzzleController";
import { puzzleStore, usePuzzleState } from "./lib/puzzleState";
import { fetchPuzzleToken } from "./lib/puzzleToken";
import { recognizeSword, type Stroke } from "./lib/swordRecognizer";
import { PuzzleScene, type RoomApi } from "./components/PuzzleScene";
import { PuzzlePanel } from "./components/PuzzlePanel";

// /puzzle — "The princess in the painting". Reuses the /mvp building blocks
// (typed-provider connection via useOrbisSession, video bridge, watchdog,
// emulation) and the /rooms lifecycle pattern. Uses its own 6 h token route
// so a long sitting does not hit a mid-session token re-mint.
export function PuzzleApp({ hasKey }: { hasKey: boolean }) {
  return (
    <ViskoOrbisStableProvider jwtToken={fetchPuzzleToken}>
      <PuzzleInner hasKey={hasKey} />
    </ViskoOrbisStableProvider>
  );
}

const PLACEHOLDER: Record<string, string[]> = {
  "waiting-connection": ["An empty painting…", "(connect to wake the princess)"],
  resetting: ["The paint is drying…", ""],
  conditioning: ["Colours gather on the canvas…", ""],
  starting: ["Colours gather on the canvas…", ""],
  priming: ["Something stirs inside the painting…", ""],
  error: ["The painting has faded", "see panel — Reset to retry"],
};

/** A soft music-box loop for MOCK mode (no Orbis audio there). */
function createMusicBox(ctx: AudioContext) {
  const notes = [659.3, 784, 987.8, 784, 880, 1046.5, 880, 784];
  let i = 0;
  const gain = ctx.createGain();
  gain.gain.value = 0.12;
  gain.connect(ctx.destination);
  const tick = () => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = notes[i++ % notes.length];
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g).connect(gain);
    o.start();
    o.stop(ctx.currentTime + 0.65);
  };
  tick();
  const timer = setInterval(tick, 350);
  return () => {
    clearInterval(timer);
    gain.disconnect();
  };
}

function PuzzleInner({ hasKey }: { hasKey: boolean }) {
  const [mode, setMode] = useState<SourceMode>("mock");
  const [resolution, setResolution] = useState<string | null>(PUZZLE_RESOLUTION);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const m = q.get("mode");
    if (m === "mock" || (m === "live" && hasKey)) setMode(m);
    if (q.get("res")) setResolution(q.get("res"));
  }, [hasKey]);
  useEffect(() => {
    debug.set({ mode });
    debug.push("info", `source mode → ${mode.toUpperCase()}`);
  }, [mode]);

  const orbis = useOrbisSession({ autoStart: false, cooldownMs: 0 });
  const audioTrack = useViskoOrbisStableTrack("main_audio");
  const mockRef = useRef<MockSource | null>(null);
  const roomApi = useRef<RoomApi | null>(null);
  const clearBoard = useCallback(() => {
    roomApi.current?.clearBoard();
    puzzleStore.set({ strokeCount: 0, lastResult: null, wrongFlashUntil: 0, swordFlashUntil: 0 });
  }, []);
  const resetRoom = useCallback(() => {
    roomApi.current?.resetRoom();
    puzzleStore.set({ strokeCount: 0, lastResult: null, wrongFlashUntil: 0, swordFlashUntil: 0 });
  }, []);
  const puzzle = usePuzzleController({ orbis, mode, mock: mockRef, resolution, resetRoom });
  const ps = usePuzzleState();
  const d = useDebug();

  // ── Keep connected (live): user Connect/Disconnect + auto-reconnect ────
  // `orbis` is a new object every render: keep it in a ref so effects that
  // write to the store depend on `status` only (otherwise: update loop).
  const orbisRef = useRef(orbis);
  orbisRef.current = orbis;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const status = orbis.status;
  const userDisconnected = useRef(true); // nothing to keep until the first Connect
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connect = useCallback((why: string) => {
    userDisconnected.current = false;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    puzzleStore.set({ nextReconnectAt: null });
    debug.push("info", `[puzzle] connect (${why})`);
    void orbisRef.current.connect();
  }, []);
  const disconnect = useCallback(() => {
    userDisconnected.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    puzzleStore.set({ nextReconnectAt: null, reconnectAttempts: 0 });
    void orbisRef.current.disconnect();
  }, []);
  useEffect(() => {
    if (status === "ready") {
      const s = puzzleStore.get();
      if (s.reconnectAttempts || s.nextReconnectAt) {
        debug.push("info", "[puzzle] reconnected");
        puzzleStore.set({ reconnectAttempts: 0, nextReconnectAt: null });
      }
      return;
    }
    if (status !== "disconnected") return;
    const s = puzzleStore.get();
    if (mode !== "live" || userDisconnected.current || !s.autoReconnect || reconnectTimer.current) return;
    const delay = Math.min(30_000, 3000 * 2 ** s.reconnectAttempts);
    puzzleStore.set({ reconnectAttempts: s.reconnectAttempts + 1, nextReconnectAt: Date.now() + delay });
    debug.push("error", `[puzzle] connection lost — reconnecting in ${delay / 1000} s (attempt ${s.reconnectAttempts + 1})`);
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      if (userDisconnected.current || modeRef.current !== "live") return;
      puzzleStore.set({ nextReconnectAt: null });
      void orbisRef.current.connect();
    }, delay);
  }, [status, mode]);
  useEffect(() => () => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
  }, []);

  // Dev-only emulation (?emulate=quest3) before the scene's VRButton probes XR.
  const [xrInitDone, setXrInitDone] = useState(false);
  useEffect(() => {
    installQuestEmulatorIfRequested()
      .then((r) => {
        debug.set({ emulation: r.note });
        if (r.note !== "emulation off") debug.push("xr", r.note);
      })
      .finally(() => setXrInitDone(true));
  }, []);
  useEffect(() => {
    if (!xrInitDone) return;
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    debug.set({ xrAvailable: !!xr });
    if (!xr) return debug.set({ immersiveVrSupported: false });
    xr.isSessionSupported("immersive-vr")
      .then((ok) => debug.set({ immersiveVrSupported: ok }))
      .catch(() => debug.set({ immersiveVrSupported: false }));
  }, [xrInitDone]);

  // ── Video (same bridge as /mvp and /rooms) ─────────────────────────────
  const [liveVideo, setLiveVideo] = useState<HTMLVideoElement | null>(null);
  const [mockVideo, setMockVideo] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!mockVideo) return;
    const src = createMockSource();
    mockRef.current = src;
    const s = puzzleStore.get();
    const beat = s.phase === "solved" ? "happy" : "urging";
    src.setScene(beat === "happy" ? "initial" : "night");
    src.setLabel(MOCK_LABEL[beat](s.soundOn));
    void bindStream(mockVideo, src.stream);
    const stop = watchVideo(mockVideo, (st) => debug.set({ mock: st }));
    return () => {
      stop();
      src.stop();
      mockRef.current = null;
    };
  }, [mockVideo]);
  useEffect(() => {
    if (!liveVideo) return;
    void bindStream(liveVideo, streamForTrack(orbis.track)).then((r) => {
      if (!r.ok) debug.push("error", `live video.play failed — ${r.error}`);
    });
  }, [liveVideo, orbis.track]);
  useEffect(() => (liveVideo ? watchVideo(liveVideo, (st) => debug.set({ live: st })) : undefined), [liveVideo]);

  // ── Audio: generated all along, muted until the gramophone plays ───────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.srcObject = audioTrack ? new MediaStream([audioTrack]) : null;
    if (audioTrack) void a.play().catch((e) => debug.push("error", `audio.play failed — ${(e as Error).message}`));
  }, [audioTrack]);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = !(mode === "live" && ps.soundOn);
    if (!a.muted && a.paused && a.srcObject) void a.play().catch((e) => debug.push("error", `audio.play failed — ${(e as Error).message}`));
  }, [mode, ps.soundOn]);
  // WebAudio context for the mock music box, unlocked by any user gesture.
  const audioCtx = useRef<AudioContext | null>(null);
  useEffect(() => {
    const unlock = () => {
      try {
        audioCtx.current ??= new AudioContext();
        void audioCtx.current.resume();
      } catch {
        /* no WebAudio */
      }
      // The same gesture lets the live <audio> element play later.
      const a = audioRef.current;
      if (a?.srcObject && a.paused) void a.play().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);
  useEffect(() => {
    if (mode !== "mock" || !ps.soundOn || !audioCtx.current) return;
    void audioCtx.current.resume();
    return createMusicBox(audioCtx.current);
  }, [mode, ps.soundOn]);

  const onVideoHealth = useCallback((h: VideoHealth) => {
    const d0 = debug.get();
    debug.set({ videoHealth: h });
    if (!d0.xrSessionActive) return;
    const sourceSlow = h.decodedFps !== null && h.decodedFps < 5;
    const stalled = h.playing && h.renderFps >= 20 && !sourceSlow && h.texFps < 2;
    const xv = d0.xrVideo;
    debug.set({
      xrVideo: {
        seconds: xv.seconds + 1,
        uploads: xv.uploads + Math.round(h.texFps),
        stalledSeconds: xv.stalledSeconds + (stalled ? 1 : 0),
        fallback: xv.fallback || h.fallback,
        minRenderFps: Math.min(xv.minRenderFps, h.renderFps),
      },
    });
  }, []);

  // ── Hints (local only) ─────────────────────────────────────────────────
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashHint = useCallback((text: string, ms = 5000) => {
    puzzleStore.set({ hint: text });
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => puzzleStore.set({ hint: null }), ms);
  }, []);

  // ── Recognition: runs on every finished stroke ─────────────────────────
  const trySolve = useCallback(() => {
    void puzzle.solve().then((o) => {
      if (o.ok) debug.push("info", "[puzzle] sword recognized → happy prompt");
      else {
        debug.push("info", `[puzzle] sword recognized but not sent — ${o.reason}`);
        if (o.local) flashHint("She is calling out to you… but the room is silent.");
      }
    });
  }, [puzzle, flashHint]);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evaluate = useCallback((strokes: ReadonlyArray<Stroke>) => {
    const r = recognizeSword(strokes, BOARD_H, puzzleStore.get().params);
    puzzleStore.set({ lastResult: r, strokeCount: strokes.length });
    return r;
  }, []);
  const onStrokeEnd = useCallback(
    (strokes: ReadonlyArray<Stroke>, source: string) => {
      const r = evaluate(strokes);
      debug.push("info", `[puzzle] stroke ${strokes.length} via ${source} → ${r.isSword ? `SWORD (score ${r.score.toFixed(2)})` : r.reason}`);
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
      if (r.isSword) {
        puzzleStore.set({ swordFlashUntil: Date.now() + 1500, wrongFlashUntil: 0 });
        trySolve();
        return;
      }
      // Wrong / unfinished drawing: LOCAL feedback only, after a pause.
      const count = strokes.length;
      wrongTimer.current = setTimeout(() => {
        const now = roomApi.current?.strokes().length ?? 0;
        if (now !== count || puzzleStore.get().lastResult?.isSword) return;
        puzzleStore.set({ wrongFlashUntil: Date.now() + 1100, wrongHints: puzzleStore.get().wrongHints + 1 });
        debug.push("info", `[puzzle] not a sword (${puzzleStore.get().lastResult?.reason ?? "?"}) — local hint only, no command sent`);
      }, WRONG_HINT_IDLE_MS);
    },
    [evaluate, trySolve],
  );
  useEffect(() => () => {
    if (wrongTimer.current) clearTimeout(wrongTimer.current);
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  // Puzzle 1 solved / undone.
  const onSound = useCallback(
    (on: boolean) => {
      puzzleStore.set({ soundOn: on, soundOnAt: on ? Date.now() : puzzleStore.get().soundOnAt });
      debug.push("info", `[puzzle] gramophone ${on ? "PLAYING — room has sound" : "stopped — silent"}`);
      puzzle.onSound(on);
      // A sword already on the canvas counts once she can be heard.
      if (on && puzzleStore.get().lastResult?.isSword) trySolve();
    },
    [puzzle, trySolve],
  );
  // After a reconnect the run restarts at "urging": re-apply a drawn sword.
  const prevPhase = useRef(ps.phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = ps.phase;
    if (ps.phase === "urging" && was !== "urging" && was !== "solving" && puzzleStore.get().lastResult?.isSword && puzzleStore.get().soundOn) trySolve();
  }, [ps.phase, trySolve]);

  const onButton = useCallback(
    (id: "reset" | "clear", detail: string) => {
      debug.set({ lastSelectionAt: Date.now(), lastSelectionId: id, lastSelectionSource: detail });
      debug.push("xr", `button ${id} via ${detail}`);
      if (id === "clear") clearBoard();
      else puzzle.resetPuzzle("Reset puzzle");
    },
    [clearBoard, puzzle],
  );

  const onXRSession = useCallback(
    (on: boolean) => {
      debug.set({ xrSessionActive: on });
      if (on) debug.set({ xrVideo: { seconds: 0, uploads: 0, stalledSeconds: 0, fallback: false, minRenderFps: Infinity } });
      debug.push("xr", on ? "immersive session started" : "immersive session ended");
      // Entering VR in live mode is the player's "begin": connect if needed.
      if (on && modeRef.current === "live" && hasKey && debug.get().reactorStatus === "disconnected") connect("entered VR");
    },
    [connect, hasKey],
  );

  const hintText =
    ps.hint ??
    (mode === "live" && ps.phase === "waiting-connection"
      ? ps.nextReconnectAt
        ? "The painting flickers… reconnecting"
        : "An empty painting hangs on the wall."
      : ps.phase === "solved"
        ? "The princess laughs with joy!"
        : ps.phase === "urging" || ps.phase === "solving"
          ? ps.soundOn
            ? "“Draw your sword!”"
            : "The princess is calling out… but you hear nothing."
          : "Something stirs inside the painting…");

  const activeVideo = mode === "live" ? liveVideo : mockVideo;
  const vh = d.videoHealth;
  const res = ps.lastResult;
  const hudLines = [
    `${mode === "mock" ? "MOCK" : "LIVE"} · ${ps.phase} · run #${ps.run} · chunk ${d.currentChunk ?? "-"}${ps.solvedRun === ps.run ? " · SOLVED" : ""}`,
    `sound ${ps.soundOn ? "ON" : "off"} · strokes ${ps.strokeCount} · ${res ? (res.isSword ? `SWORD ${res.score.toFixed(2)}` : res.reason) : "-"}`,
    `crayon ${ps.crayonHolder ?? "on ledge"} · ${ps.drawMode} · arm ${ps.tonearmHolder ?? "-"}`,
    `fps ${vh?.renderFps ?? "-"}  dec ${vh?.decodedFps ?? "-"}  tex ${vh?.texFps ?? "-"}/s${vh?.fallback ? "  FALLBACK" : ""}`,
    d.lastCommandError ? `ERR ${d.lastCommandError}` : ps.lastError ? `ERR ${ps.lastError}` : "no errors",
  ];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 lg:h-screen lg:flex-row lg:overflow-hidden">
      <main className="relative h-[60vh] flex-1 lg:h-full">
        {xrInitDone && (
          <PuzzleScene
            showVideo={ps.liveReady}
            video={activeVideo}
            placeholderLines={PLACEHOLDER[ps.phase] ?? [ps.phase, ""]}
            hudLines={hudLines}
            hintText={hintText}
            wrongFlashUntil={ps.wrongFlashUntil}
            swordFlashUntil={ps.swordFlashUntil}
            onStrokeEnd={onStrokeEnd}
            onButton={onButton}
            onSound={onSound}
            onCrayonHolder={(h) => {
              puzzleStore.set({ crayonHolder: h });
              debug.push("xr", h ? `crayon picked up by ${h}` : "crayon back on the ledge");
            }}
            onTonearmHolder={(h) => {
              puzzleStore.set({ tonearmHolder: h });
              debug.push("xr", h ? `tonearm grabbed by ${h}` : "tonearm released");
            }}
            onDrawMode={(m) => puzzleStore.set({ drawMode: m })}
            onVideoHealth={onVideoHealth}
            onXRSession={onXRSession}
            onInputInfo={(s) => {
              debug.set({ inputSources: s });
              debug.push("xr", `input sources: ${s.join(" | ") || "none"}`);
            }}
            roomApi={roomApi}
          />
        )}
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-[11px] text-zinc-300">
          /puzzle · desktop: drag on the easel canvas to draw · click the gramophone · arrow keys look around · VR: pinch to grab, fingertip to press
        </div>
      </main>
      <aside className="w-full overflow-y-auto p-3 lg:h-full lg:w-[420px] lg:shrink-0">
        <PuzzlePanel
          hasKey={hasKey}
          mode={mode}
          onModeChange={setMode}
          onConnect={() => connect("panel")}
          onDisconnect={disconnect}
          onReset={() => puzzle.resetPuzzle("Reset puzzle (panel)")}
          onClear={clearBoard}
          onParams={() => evaluate(roomApi.current?.strokes() ?? [])}
          resolution={resolution}
          sources={
            <div className="grid grid-cols-2 gap-2">
              <video ref={setMockVideo} muted playsInline autoPlay className="aspect-video w-full rounded border border-red-900 bg-black" />
              <video ref={setLiveVideo} muted playsInline autoPlay className="aspect-video w-full rounded border border-emerald-900 bg-black" />
              <audio ref={audioRef} autoPlay muted className="hidden" />
            </div>
          }
        />
      </aside>
    </div>
  );
}
