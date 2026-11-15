"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ViskoOrbisStableProvider, useViskoOrbisStableTrack } from "@reactor-models/visko-orbis-stable";
import { useOrbisSession } from "../mvp/lib/orbisSession";
import { bindStream, streamForTrack, watchVideo } from "../mvp/lib/videoBridge";
import { createMockSource, type MockSource } from "../mvp/lib/mockSource";
import { debug, useDebug, type SourceMode } from "../mvp/lib/debugState";
import { useShallow } from "zustand/react/shallow";

/** Skips re-rendering its subtree while `frozen` (the 2D panel during VR:
 *  invisible in the headset, and its re-renders stalled Quest frames). */
/** Fallback princess clip through an <audio> element (before WebAudio unlocks). */
function htmlVoice(id: string): { ended: Promise<void>; stop: () => void } {
  const a = new Audio("/audio/princess/" + id + ".wav");
  let end!: () => void;
  const ended = new Promise<void>((r) => (end = r));
  a.onended = () => end();
  a.onerror = () => { debug.push("error", "Princess audio failed: " + id); end(); };
  void a.play().catch((e: Error) => { debug.push("error", "Princess audio: " + e.message); end(); });
  return { ended, stop: () => { a.pause(); end(); } };
}

const FreezeWhile = memo(function FreezeWhile({ children }: { frozen: boolean; children: ReactNode }) {
  return <>{children}</>;
}, (_prev, next) => next.frozen);
import { installQuestEmulatorIfRequested } from "../mvp/lib/xrEmulation";
import type { VideoHealth } from "../mvp/lib/videoTextureHealth";
import type { RescueBeat, RescueStage } from './lib/rescueScript';
import { RESCUE_SCRIPT } from './lib/rescueScript';
import barks from './lib/rescueBarks.json';
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

type Bark = { id: string; kind: string; stage?: string; text: string };
const BARKS: Bark[] = barks;
const STAGES = ['silence','unmuted','melted','drawn','rope','fire','key','rejected','photo','escaped'] as const satisfies readonly RescueStage[];
/** Spoken hints after this long in one stage without progress (ms). */
const HINT_DELAYS_MS = [25_000, 55_000];
/** The silent opening has no voice: a plaque nudge instead. */
const SILENCE_NUDGE_MS = 20_000;
/** Keep the subtitle up briefly after a line ends. */
const SUBTITLE_HOLD_MS = 2500;
/** After `morphing` clears, the scene eases the shimmer out (rate 1.6/s). */
const SHIMMER_FADE_MS = 1200;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Minimum gap between "that's not a sword" quips. */
const QUIP_GAP_MS = 8000;
const QUIPS = ['quip-baguette', 'quip-butter', 'quip-witch'];
/** What the plaque under the painting says when nobody is talking. */
const OBJECTIVE: Record<RescueStage, string> = {
  silence: 'She is trying to speak… break the silence.',
  unmuted: 'Draw your sword, hero!',
  melted: 'There must be another way to draw a sword…',
  drawn: 'Free the key from the box.',
  rope: 'Something needs to catch fire…',
  fire: 'The box is falling!',
  key: 'Get the key into the picture.',
  rejected: 'Get the key into the picture… somehow.',
  photo: 'Bring the photograph to the painting.',
  escaped: 'The princess is free!',
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
  // ── Princess voice: story beats (queued) and barks (hints / quips) ─────
  // Barks only play when she is silent, so a hint never stacks on a story
  // line. The subtitle clears shortly after the last clip ends, letting the
  // plaque fall back to the current objective.
  const [subtitle,setSubtitle]=useState('');
  const [stage,setStage]=useState<RescueStage>('silence');
  const stageRef=useRef<RescueStage>('silence');
  const [ending,setEnding]=useState<{seconds:number}|null>(null);
  const [idleNonce,setIdleNonce]=useState(0);
  const voices=useRef(new Set<{ended:Promise<void>;stop:()=>void}>());
  const voiceQueue=useRef<Promise<void>>(Promise.resolve());
  const voiceRun=useRef(0);
  const voiceBusy=useRef(0);
  const subtitleTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const unmutedAt=useRef<number|null>(null);
  const lastQuipAt=useRef(0);
  const quipIndex=useRef(0);
  const smallQuipSaid=useRef(false);
  const stopVoices=useCallback(()=>{
    voiceRun.current++; voiceQueue.current=Promise.resolve(); voiceBusy.current=0;
    if(subtitleTimer.current)clearTimeout(subtitleTimer.current);
    setSubtitle(''); for(const v of voices.current)v.stop(); voices.current.clear();
  },[]);
  /** Queue a line. `gate` holds it (in order, and counted as busy so barks
   *  don't jump in) until e.g. the painting's shimmer has settled. */
  const speak=useCallback((id:string,text:string,gate:Promise<unknown>=Promise.resolve())=>{
    const run=voiceRun.current;
    voiceBusy.current++;
    const spoken=voiceQueue.current.then(()=>gate).then(()=>new Promise<void>(resolve=>{
      if(run!==voiceRun.current){resolve();return;}
      if(subtitleTimer.current)clearTimeout(subtitleTimer.current);
      setSubtitle(text);
      // Preloaded WebAudio buffer (no media pipeline at the beat); <audio> only
      // before the audio context is unlocked.
      const v=roomAudio.playVoice(id)??htmlVoice(id);voices.current.add(v);
      let done=false;
      const finish=()=>{
        if(done)return;done=true;
        voices.current.delete(v);
        if(run===voiceRun.current){
          voiceBusy.current=Math.max(0,voiceBusy.current-1);
          if(voiceBusy.current===0)subtitleTimer.current=setTimeout(()=>{if(voiceBusy.current===0)setSubtitle('');},SUBTITLE_HOLD_MS);
        }
        resolve();
      };
      void v.ended.then(finish);
    }));
    voiceQueue.current=spoken;
    return spoken;
  },[]);
  /** A voice clip (line, hint or quip) is playing right now. */
  const isSpeaking=useCallback(()=>voices.current.size>0,[]);
  /** A hint or quip: dropped (false) while she is already talking. */
  const bark=useCallback((id:string)=>{
    const line=BARKS.find(b=>b.id===id);
    if(!line||voiceBusy.current>0)return false;
    debug.push('info',`[puzzle] princess says "${id}"`);
    void speak(line.id,line.text);
    return true;
  },[speak]);
  const resetRoom = useCallback(() => {
    stopVoices();
    setStage('silence'); stageRef.current='silence'; setEnding(null);
    unmutedAt.current=null; smallQuipSaid.current=false; quipIndex.current=0; lastQuipAt.current=0;
    roomApi.current?.resetRoom();
    puzzleStore.set({ strokeCount: 0, lastResult: null, wrongFlashUntil: 0, swordFlashUntil: 0 });
  }, [stopVoices]);
  const puzzle = usePuzzleController({ orbis, mode, mock: mockRef, resolution, resetRoom });
  const onBeat=useCallback((beat:RescueBeat)=>{
    const landed=puzzle.steerScript(beat);
    if((STAGES as readonly string[]).includes(beat.id)){const s=beat.id as RescueStage;stageRef.current=s;setStage(s);}
    if(beat.id==='unmuted')unmutedAt.current=Date.now();
    // Her line waits for the shimmer: the morph lands, then the shader eases out.
    const shimmerOver=puzzleStore.get().morphing?landed.then(()=>sleep(SHIMMER_FADE_MS)):Promise.resolve();
    const spoken=beat.text?speak(beat.id,beat.text,shimmerOver):Promise.resolve();
    // The room waits for both the line and the picture (capped) before
    // the next physical effect, e.g. the fireball leaving the canvas.
    const done=Promise.all([spoken,landed]).then(()=>undefined);
    if(beat.id==='escaped'){
      const run=voiceRun.current;
      const seconds=unmutedAt.current?(Date.now()-unmutedAt.current)/1000:0;
      void done.then(()=>{if(run===voiceRun.current)setEnding({seconds});});
    }
    return done;
  },[puzzle,speak]);
  useEffect(()=>()=>{voiceRun.current++;for(const v of voices.current)v.stop();voices.current.clear();},[]);
  const ps = usePuzzleState();
  // Only the fields this component shows: a bare useDebug() re-rendered the
  // whole page on every log line and Orbis chunk (several per story beat),
  // which stalls a Quest mid-session.
  const d = useDebug(useShallow((s) => ({ videoHealth: s.videoHealth, currentChunk: s.currentChunk, lastCommandError: s.lastCommandError, xrSessionActive: s.xrSessionActive })));

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

  // Orbis generation is silent by default; retain playback for optional mixing.
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
      // Decode every princess line now, in the background, so no beat waits on it.
      roomAudio.preloadVoices([...RESCUE_SCRIPT.filter((b) => b.text).map((b) => b.id), ...BARKS.map((b) => b.id)]);
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

  // Idle hints: gentle first, blunt second, timed from entering the stage
  // (or from the player's last drawing attempt). A hint that finds her
  // talking retries a few seconds later instead of interrupting.
  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    if (stage === "silence") {
      timers.push(setTimeout(() => flashHint("That red seal around the microphone looks fragile… try the hammer.", 9000), SILENCE_NUDGE_MS));
    }
    BARKS.filter((b) => b.kind === "hint" && b.stage === stage).forEach((h, i) => {
      const attempt = () => {
        if (stageRef.current !== stage) return;
        if (!bark(h.id)) timers.push(setTimeout(attempt, 4000));
      };
      timers.push(setTimeout(attempt, HINT_DELAYS_MS[i] ?? HINT_DELAYS_MS[HINT_DELAYS_MS.length - 1] + 30_000 * i));
    });
    return () => timers.forEach(clearTimeout);
  }, [stage, idleNonce, bark, flashHint]);

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
      setup.puzzles = []; // Rescue script owns progression; editor still supplies room layout.
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
      setIdleNonce((n) => n + 1);
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
        const reason = puzzleStore.get().lastResult?.reason ?? "?";
        debug.push("info", `[puzzle] not a sword (${reason}) — local hint only, no command sent`);
        // She reacts to the doodle (only while a drawn sword is what she needs).
        if (stageRef.current === "melted" && Date.now() - lastQuipAt.current > QUIP_GAP_MS) {
          const small = /short|longer|nothing/.test(reason) && !smallQuipSaid.current;
          const id = small ? "quip-small" : QUIPS[quipIndex.current % QUIPS.length];
          if (bark(id)) {
            lastQuipAt.current = Date.now();
            if (small) smallQuipSaid.current = true;
            else quipIndex.current++;
          }
        }
      }, WRONG_HINT_IDLE_MS);
    },
    [evaluate, trigger, bark],
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
      debug.push("info", `[puzzle] hammer seal ${on ? "PLAYING — room has sound" : "stopped — silent"}`);
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
      : ps.phase === "urging"
        ? OBJECTIVE[stage]
        : "Something stirs inside the painting…");

  const activeVideo = mode === "live" ? liveVideo : mockVideo;
  const vh = d.videoHealth;
  const res = ps.lastResult;
  const hudLines = [
    `${mode === "mock" ? "MOCK" : "LIVE"} · ${ps.phase} · run #${ps.run} · chunk ${d.currentChunk ?? "-"} · solved ${ps.solved.length}/${ps.setup.puzzles.length}`,
    `sound ${ps.soundOn ? "ON" : "off"} · strokes ${ps.strokeCount} · ${res ? (res.isSword ? `SWORD ${res.score.toFixed(2)}` : res.reason) : "-"}`,
    `pen ${ps.crayonHolder ?? "released"} · ${ps.drawMode} · hammer the red seal to hear her`,
    `fps ${vh?.renderFps ?? "-"}  dec ${vh?.decodedFps ?? "-"}  tex ${vh?.texFps ?? "-"}/s${vh?.fallback ? "  FALLBACK" : ""}`,
    d.lastCommandError ? `ERR ${d.lastCommandError}` : ps.lastError ? `ERR ${ps.lastError}` : "no errors",
  ];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 lg:h-screen lg:flex-row lg:overflow-hidden">
      <main className="relative h-[60vh] min-h-[420px] shrink-0 lg:min-h-0 lg:flex-1 lg:h-full">
        {xrInitDone && (
          <PuzzleScene
            isSpeaking={isSpeaking}
            onBeat={onBeat}
            onBark={bark}
            morphing={ps.morphing}
            showVideo={ps.liveReady}
            video={activeVideo}
            placeholderLines={PLACEHOLDER[ps.phase] ?? [ps.phase, ""]}
            hudLines={hudLines}
            hintText={stage === "silence" ? subtitle || hintText : hintText}
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
        {subtitle && <div className="pointer-events-none absolute bottom-4 left-4 right-4 rounded bg-black/80 p-3 text-sm text-amber-50">{subtitle}</div>}
        {ending && (
          <div className="absolute left-1/2 top-12 w-[min(92%,440px)] -translate-x-1/2 rounded-lg border-2 border-amber-300/80 bg-gradient-to-b from-[#2a2140]/95 to-[#151022]/95 p-5 text-center shadow-2xl">
            <div className="font-serif text-2xl font-bold text-amber-200">The Princess Is Free!</div>
            <div className="mt-1 font-serif italic text-amber-50">
              Rescued in {Math.floor(Math.round(ending.seconds) / 60)}:{String(Math.round(ending.seconds) % 60).padStart(2, "0")}
            </div>
            <div className="mt-2 text-sm text-violet-200">Thank you for playing HERO</div>
            <button
              className="mt-4 rounded border border-amber-300 px-4 py-1.5 text-sm text-amber-100 hover:bg-amber-300/20"
              onClick={() => puzzle.resetPuzzle("Play again (end card)")}
            >
              Play again
            </button>
          </div>
        )}
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-[11px] text-zinc-300">
          /puzzle · desktop: drag on the easel canvas to draw · click the red seal to strike · click tools to carry/drop · Space to shoot camera · WASD move · arrows look · VR: pinch/grip to grab, left stick move, right stick smooth turn
        </div>
      </main>
      <aside className="w-full overflow-y-auto p-3 lg:h-full lg:w-[420px] lg:shrink-0">
        <FreezeWhile frozen={d.xrSessionActive}>
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
        </FreezeWhile>
      </aside>
    </div>
  );
}
