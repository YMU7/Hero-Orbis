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
import { mockLabel, usePuzzleController } from "./lib/usePuzzleController";
import { puzzleStore, usePuzzleState } from "./lib/puzzleState";
import { fetchPuzzleToken } from "./lib/puzzleToken";
import { recognizeSword, type Stroke } from "./lib/swordRecognizer";
import { parseStyle } from "./lib/style";
import { applyPaintGrade } from "./lib/roomParts";
import { roomAudio, SOUND_IDS, type SoundId } from "./lib/roomAudio";
import { allSolved, collectPuzzles, nextHint, puzzlesWith, swordParamsOf, type PuzzleDef } from "./lib/puzzleChain";
import type { SceneObject } from "../lib/sceneData/types";
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

  // Style tuner: load the saved look (data/puzzle-style.json) on start, so
  // runs use the user's chosen prompt parts and colour grade.
  useEffect(() => {
    void fetch("/puzzle/api/style", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ saved: boolean; style: unknown }>)
      .then((b) => {
        const st = parseStyle(b.style);
        puzzleStore.set({ style: st, styleSavedAt: b.saved ? (st.savedAt ?? null) : null });
        applyPaintGrade(st.grade);
        debug.push("info", `[puzzle] style ${b.saved ? `loaded (saved ${st.savedAt})` : "defaults (no saved style)"}`);
      })
      .catch((e) => debug.push("error", `[puzzle] style load failed: ${(e as Error).message}`));
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
    src.setScene(allSolved(s.setup, s.solved) ? "initial" : "night");
    src.setLabel(mockLabel(s));
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
  // Room audio (lib/roomAudio.ts): unlocked by any user gesture.
  useEffect(() => {
    const unlock = () => {
      roomAudio.unlock();
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
  // Channels: background (gated by puzzle 1 unless the mix says otherwise),
  // gramophone record (objects, positional), voice = the Orbis <audio>.
  useEffect(() => roomAudio.setMix(ps.style.mix), [ps.style.mix]);
  useEffect(() => roomAudio.bindVoice(audioRef.current), []);
  useEffect(() => {
    roomAudio.setGramophone(ps.soundOn);
    roomAudio.setBackground(ps.soundOn || ps.style.mix.backgroundBeforeSound);
  }, [ps.soundOn, ps.style.mix.backgroundBeforeSound]);
  useEffect(() => roomAudio.setDrawing(ps.drawMode !== "none"), [ps.drawMode]);

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

  // ── Puzzle components (Scene Editor "+ Puzzle") ──────────────────────
  // attempt(): one puzzle's trigger happened. Locked → local hint only.
  const attempt = useCallback(
    (pz: PuzzleDef, how: string, quiet = false): boolean => {
      const o = puzzle.solve(pz.id);
      if (o.ok) {
        if ((SOUND_IDS as readonly string[]).includes(pz.sound)) roomAudio.play(pz.sound as SoundId);
        debug.push("info", `[puzzle] "${pz.id}" solved via ${how}`);
        return true;
      }
      if (!quiet) debug.push("info", `[puzzle] "${pz.id}" (${how}) not solved — ${o.reason}`);
      if (o.local && !quiet) flashHint(o.hint ?? "Something else must happen first…");
      return false;
    },
    [puzzle, flashHint],
  );
  // Triggers that are a STATE (needle on the record, a sword on the canvas)
  // count as soon as their requirement is met; touch/pinch must be redone.
  const retryStates = useCallback(() => {
    for (let changed = true; changed; ) {
      changed = false;
      const s = puzzleStore.get();
      const live = [
        ...(s.soundOn ? puzzlesWith(s.setup, "needle") : []),
        ...(s.lastResult?.isSword ? puzzlesWith(s.setup, "draw-sword") : []),
      ].filter((p) => !s.solved.includes(p.id));
      for (const p of live) if (attempt(p, "state already true", true)) changed = true;
    }
  }, [attempt]);
  const trigger = useCallback(
    (list: PuzzleDef[], how: string) => {
      let any = false;
      for (const p of list) if (!puzzleStore.get().solved.includes(p.id) && attempt(p, how)) any = true;
      if (any) retryStates();
    },
    [attempt, retryStates],
  );

  // Layout loaded by the scene: collect the puzzle components.
  const onLayout = useCallback(
    (layout: SceneObject[]) => {
      const setup = collectPuzzles(layout);
      const sword = puzzlesWith(setup, "draw-sword")[0];
      puzzleStore.set({ setup, params: swordParamsOf(sword) });
      puzzle.onSetup();
      debug.push("info", `[puzzle] ${setup.puzzles.length} puzzle(s): ${setup.puzzles.map((p) => `${p.id}[${p.trigger}${p.requires ? ` after ${p.requires}` : ""}]`).join(", ") || "none"}`);
    },
    [puzzle],
  );

  // ── Recognition: runs on every finished stroke ─────────────────────────
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
        if (!puzzleStore.get().swordFlashUntil || Date.now() > puzzleStore.get().swordFlashUntil) roomAudio.play("sword-right");
        puzzleStore.set({ swordFlashUntil: Date.now() + 1500, wrongFlashUntil: 0 });
        trigger(puzzlesWith(puzzleStore.get().setup, "draw-sword"), "sword drawing");
        return;
      }
      // Wrong / unfinished drawing: LOCAL feedback only, after a pause.
      const count = strokes.length;
      wrongTimer.current = setTimeout(() => {
        const now = roomApi.current?.strokes().length ?? 0;
        if (now !== count || puzzleStore.get().lastResult?.isSword) return;
        puzzleStore.set({ wrongFlashUntil: Date.now() + 1100, wrongHints: puzzleStore.get().wrongHints + 1 });
        roomAudio.play("sword-wrong");
        debug.push("info", `[puzzle] not a sword (${puzzleStore.get().lastResult?.reason ?? "?"}) — local hint only, no command sent`);
      }, WRONG_HINT_IDLE_MS);
    },
    [evaluate, trigger],
  );
  useEffect(() => () => {
    if (wrongTimer.current) clearTimeout(wrongTimer.current);
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  // Gramophone needle down / up.
  const onSound = useCallback(
    (on: boolean) => {
      roomAudio.play(on ? "needle-down" : "needle-up");
      puzzleStore.set({ soundOn: on, soundOnAt: on ? Date.now() : puzzleStore.get().soundOnAt });
      debug.push("info", `[puzzle] gramophone ${on ? "PLAYING — room has sound" : "stopped — silent"}`);
      puzzle.onSound();
      if (on) trigger(puzzlesWith(puzzleStore.get().setup, "needle"), "needle on the record");
    },
    [puzzle, trigger],
  );

  // Touch / pinch / click on an object that carries a puzzle.
  const onObjectTrigger = useCallback(
    (objectId: string, kind: "touch" | "pinch" | "click") => {
      const setup = puzzleStore.get().setup;
      const list = kind === "click" ? [...puzzlesWith(setup, "touch", objectId), ...puzzlesWith(setup, "pinch", objectId)] : puzzlesWith(setup, kind, objectId);
      trigger(list, kind);
    },
    [trigger],
  );

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
      : allSolved(ps.setup, ps.solved)
        ? "The princess laughs with joy!"
        : ps.phase === "urging"
          ? (nextHint(ps.setup, ps.solved) ?? "")
          : "Something stirs inside the painting…");

  const activeVideo = mode === "live" ? liveVideo : mockVideo;
  const vh = d.videoHealth;
  const res = ps.lastResult;
  const hudLines = [
    `${mode === "mock" ? "MOCK" : "LIVE"} · ${ps.phase} · run #${ps.run} · chunk ${d.currentChunk ?? "-"} · solved ${ps.solved.length}/${ps.setup.puzzles.length}`,
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
            onLayout={onLayout}
            onObjectTrigger={onObjectTrigger}
            onCrayonHolder={(h) => {
              const was = puzzleStore.get().crayonHolder;
              if (h && !was) roomAudio.play("crayon-pick");
              else if (!h && was) roomAudio.play("crayon-drop");
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
          onApplyStyle={() => puzzle.applyStyleLive()}
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
