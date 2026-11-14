"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ViskoOrbisStableProvider } from "@reactor-models/visko-orbis-stable";
import { fetchToken } from "../lib/token";
import { XRScene } from "./components/XRScene";
import { DevPanel } from "./components/DevPanel";
import { useOrbisSession } from "./lib/orbisSession";
import { bindStream, playVideo, streamForTrack, watchVideo } from "./lib/videoBridge";
import { createMockSource, type MockSource } from "./lib/mockSource";
import { debug, useDebug, type SourceMode } from "./lib/debugState";
import { DEFAULT_COOLDOWN_MS, XR_BUTTONS, type PromptId } from "./lib/prompts";
import { installQuestEmulatorIfRequested } from "./lib/xrEmulation";
import type { VideoHealth } from "./lib/videoTextureHealth";

// Session + scene wiring for /mvp. One provider = one connection owner; the
// same `fetchToken` resolver (and module-scope JWT memo) as the reference app.
export function MVPApp({ hasKey }: { hasKey: boolean }) {
  return (
    <ViskoOrbisStableProvider jwtToken={fetchToken}>
      <MVPInner hasKey={hasKey} />
    </ViskoOrbisStableProvider>
  );
}

function MVPInner({ hasKey }: { hasKey: boolean }) {
  const [mode, setMode] = useState<SourceMode>(hasKey ? "live" : "mock");
  const [autoStart, setAutoStart] = useState(true);
  const [cooldownMs, setCooldownMs] = useState(DEFAULT_COOLDOWN_MS);
  // Diagnostic: ?res=1080p sends set_resolution before start (default: deployment tier).
  const [resolution, setResolution] = useState<string | null>(null);
  useEffect(() => {
    setResolution(new URLSearchParams(window.location.search).get("res"));
  }, []);
  const orbis = useOrbisSession({ autoStart, cooldownMs, resolution });

  // App-owned video elements (never the SDK's internal one).
  const [liveVideo, setLiveVideo] = useState<HTMLVideoElement | null>(null);
  const [mockVideo, setMockVideo] = useState<HTMLVideoElement | null>(null);
  const mockRef = useRef<MockSource | null>(null);

  // ?mode=mock|live override (read after mount to keep SSR markup stable).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mode");
    if (q === "mock" || (q === "live" && hasKey)) setMode(q);
  }, [hasKey]);
  useEffect(() => {
    debug.set({ mode });
    debug.push("info", `source mode → ${mode.toUpperCase()}`);
  }, [mode]);

  // Optional dev-only Quest 3 emulation (?emulate=quest3) must be installed
  // BEFORE the scene's VRButton probes navigator.xr, so the scene waits.
  const [xrInitDone, setXrInitDone] = useState(false);
  useEffect(() => {
    let alive = true;
    installQuestEmulatorIfRequested()
      .then((r) => {
        debug.set({ emulation: r.note });
        if (r.note !== "emulation off") debug.push("xr", r.note);
      })
      .catch((e: Error) => debug.push("error", `emulator install failed: ${e.message}`))
      .finally(() => alive && setXrInitDone(true));
    return () => {
      alive = false;
    };
  }, []);

  // WebXR capability probe (after emulation decision).
  useEffect(() => {
    if (!xrInitDone) return;
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    debug.set({ xrAvailable: !!xr });
    if (!xr) {
      debug.push("xr", "navigator.xr unavailable (needs HTTPS + WebXR browser)");
      debug.set({ immersiveVrSupported: false });
      return;
    }
    xr.isSessionSupported("immersive-vr")
      .then((ok) => {
        debug.set({ immersiveVrSupported: ok });
        debug.push("xr", `isSessionSupported('immersive-vr') = ${ok}`);
      })
      .catch((e: Error) => {
        debug.set({ immersiveVrSupported: false });
        debug.push("error", `isSessionSupported failed: ${e.message}`);
      });
  }, [xrInitDone]);

  // In-XR video watchdog: is the plane's texture still receiving frames
  // while the immersive session is presenting?
  const stallRun = useRef(0);
  const xrReports = useRef(0);
  const loopWasOk = useRef(true);
  const sourceWasSlow = useRef(false);
  const onVideoHealth = useCallback((h: VideoHealth) => {
    const d0 = debug.get();
    debug.set({ videoHealth: h });
    if (!d0.xrSessionActive) {
      stallRun.current = 0;
      return;
    }
    // A texture stall only counts when the render loop itself is healthy;
    // a throttled loop (hidden tab, overloaded device) is reported separately.
    const loopOk = h.renderFps >= 20;
    // Source slow = the <video> itself decodes few frames (network/stream),
    // which is NOT a rendering stall. Texture stall = frames decode but the
    // texture doesn't receive them.
    const sourceSlow = h.decodedFps !== null && h.decodedFps < 5;
    const stalled = h.playing && loopOk && !sourceSlow && h.texFps < 2;
    if (sourceSlow && !sourceWasSlow.current) {
      debug.push("error", `XR video SOURCE slow: decoded ${h.decodedFps} fps (stream/network, not rendering)`);
    }
    sourceWasSlow.current = sourceSlow;
    if (!loopOk && loopWasOk.current) {
      debug.push("error", `XR render loop throttled: ${h.renderFps} fps (texture ${h.texFps}/s)`);
    }
    loopWasOk.current = loopOk;
    const xv = d0.xrVideo;
    if (h.fallback && !xv.fallback) {
      debug.push(
        "error",
        "requestVideoFrameCallback stalled in XR — manual texture upload fallback engaged (≤30 Hz)",
      );
    }
    debug.set({
      xrVideo: {
        seconds: xv.seconds + 1,
        uploads: xv.uploads + Math.round(h.texFps),
        stalledSeconds: xv.stalledSeconds + (stalled || !h.playing ? 1 : 0),
        minRenderFps: Math.min(xv.minRenderFps, h.renderFps),
        fallback: xv.fallback || h.fallback,
      },
    });
    stallRun.current = stalled || !h.playing ? stallRun.current + 1 : 0;
    if (stallRun.current === 3) {
      debug.push(
        "error",
        `VIDEO STALLED in XR for 3 s (playing=${h.playing}, tex ${h.texFps}/s, media +${h.mediaAdvance}s)`,
      );
    }
    if (++xrReports.current % 5 === 0) {
      debug.push(
        "xr",
        `XR video: render ${h.renderFps} fps, decoded ${h.decodedFps ?? "?"} fps, tex ${h.texFps}/s, media +${h.mediaAdvance}s/s, playing=${h.playing}${h.fallback ? ", FALLBACK" : ""}`,
      );
    }
  }, []);

  // Mock source → mock <video>.
  useEffect(() => {
    if (!mockVideo) return;
    const src = createMockSource();
    mockRef.current = src;
    if (src.error) debug.push("error", `mock: ${src.error}`);
    void bindStream(mockVideo, src.stream).then((r) => {
      if (!r.ok) {
        debug.set({ lastPlayError: `mock: ${r.error}` });
        debug.push("error", `mock video.play failed — ${r.error}`);
      } else debug.push("media", "mock stream playing");
    });
    const stop = watchVideo(mockVideo, (st) => debug.set({ mock: st }));
    return () => {
      stop();
      src.stop();
      mockRef.current = null;
    };
  }, [mockVideo]);

  // Live main_video track → live <video>. Re-binds on every new track
  // (reconnect) and detaches when the track goes away.
  useEffect(() => {
    if (!liveVideo) return;
    const stream = streamForTrack(orbis.track);
    debug.push(
      "media",
      orbis.track
        ? `main_video track received (id=${orbis.track.id.slice(0, 8)}, state=${orbis.track.readyState})`
        : "main_video track: none",
    );
    void bindStream(liveVideo, stream).then((r) => {
      if (!r.ok) {
        debug.set({ lastPlayError: `live: ${r.error}` });
        debug.push("error", `live video.play failed — ${r.error}`);
      } else if (stream) debug.push("media", "live <video> playing main_video");
    });
  }, [liveVideo, orbis.track]);
  useEffect(() => {
    if (!liveVideo) return;
    return watchVideo(liveVideo, (st) => debug.set({ live: st }));
  }, [liveVideo]);

  const startMedia = useCallback(() => {
    for (const [name, v] of [
      ["live", liveVideo],
      ["mock", mockVideo],
    ] as const) {
      if (!v || !v.srcObject) continue;
      void playVideo(v).then((r) => {
        if (r.ok) debug.push("media", `${name} video.play ok (user gesture)`);
        else {
          debug.set({ lastPlayError: `${name}: ${r.error}` });
          debug.push("error", `${name} video.play failed — ${r.error}`);
        }
      });
    }
  }, [liveVideo, mockVideo]);

  // ── Selection handler shared by XR controller, mouse and dev panel ─────────
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const steerRef = useRef(orbis.steer);
  steerRef.current = orbis.steer;
  const cooldownRef = useRef(cooldownMs);
  cooldownRef.current = cooldownMs;

  const onSelect = useCallback((id: string, source: string, detail: string) => {
    debug.set({
      lastSelectionAt: Date.now(),
      lastSelectionId: id,
      lastSelectionSource: detail || source,
    });
    debug.push("xr", `select "${id}" via ${detail || source}`);
    const pid = id as PromptId;

    if (modeRef.current === "mock") {
      // MOCK: only the local canvas changes. Nothing is sent to Reactor.
      const now = Date.now();
      if (now < debug.get().cooldownUntil) {
        debug.push("info", "mock steer ignored (cooldown)");
        return;
      }
      mockRef.current?.setScene(pid);
      debug.set({
        requestedPrompt: pid,
        acceptedPrompt: pid,
        acceptedAtChunk: null,
        cooldownUntil: now + cooldownRef.current,
      });
      debug.push("info", `MOCK scene → ${pid} (no Reactor command sent)`);
      return;
    }

    void steerRef.current(pid).then((r) => {
      if (r.ok) debug.push("cmd", `steer "${pid}" acknowledged by model`);
      else debug.push("info", `steer "${pid}" not sent — ${r.reason}`);
    });
  }, []);

  // ── HUD text for the headset ───────────────────────────────────────────────
  const d = useDebug();
  const hudLines = [
    `MODE ${mode === "mock" ? "MOCK (not Orbis)" : "LIVE ORBIS"}   reactor:${d.reactorStatus}   chunk:${d.currentChunk ?? "-"}`,
    `prompt req:${d.requestedPrompt ?? "-"}  ack:${d.acceptedPrompt ?? "-"}${d.acceptedAtChunk != null ? `@${d.acceptedAtChunk}` : ""}  ${Date.now() < d.cooldownUntil ? "COOLDOWN" : ""}`,
    `fps ${d.videoHealth?.renderFps ?? "-"}  dec ${d.videoHealth?.decodedFps ?? "-"}  tex ${d.videoHealth?.texFps ?? "-"}/s  media +${d.videoHealth?.mediaAdvance ?? "-"}s  ctrl ${d.inputSources.length}  ${mode === "live" ? `${d.live.width}x${d.live.height}` : `${d.mock.width}x${d.mock.height}`}${d.videoHealth?.fallback ? "  FALLBACK" : ""}`,
    d.lastCommandError
      ? `ERR ${d.lastCommandError}`
      : d.lastSessionError
        ? `ERR ${d.lastSessionError}`
        : d.lastPlayError
          ? `ERR ${d.lastPlayError}`
          : "no errors",
  ];

  const activeVideo = mode === "live" ? liveVideo : mockVideo;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 lg:h-screen lg:flex-row lg:overflow-hidden">
      <main className="relative h-[60vh] flex-1 lg:h-full">
        {xrInitDone && (
        <XRScene
          onVideoHealth={onVideoHealth}
          video={activeVideo}
          sourceLabel={mode === "mock" ? "MOCK — NOT LIVE" : "LIVE ORBIS main_video"}
          buttons={XR_BUTTONS}
          activeId={d.acceptedPrompt}
          cooldownUntil={d.cooldownUntil}
          hudLines={hudLines}
          onSelect={onSelect}
          onXRSession={(active) => {
            if (active) {
              debug.set({
                xrSessionActive: true,
                xrVideo: { seconds: 0, uploads: 0, stalledSeconds: 0, fallback: false, minRenderFps: Infinity },
              });
              debug.push("xr", `immersive session started (source: ${modeRef.current.toUpperCase()})`);
            } else {
              const xv = debug.get().xrVideo;
              debug.set({ xrSessionActive: false });
              debug.push(
                "xr",
                `immersive session ended — ${xv.seconds}s in XR, ${xv.uploads} texture uploads (avg ${xv.seconds ? (xv.uploads / xv.seconds).toFixed(1) : 0}/s), stalled ${xv.stalledSeconds}s, min render ${xv.minRenderFps} fps, fallback=${xv.fallback}`,
              );
            }
          }}
          onInputInfo={(s) => {
            debug.set({ inputSources: s });
            debug.push("xr", `input sources: ${s.join(" | ") || "none"}`);
          }}
        />
        )}
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-[11px] text-zinc-300">
          /mvp · click a button (desktop) or use ENTER VR
        </div>
      </main>
      <aside className="w-full overflow-y-auto p-3 lg:h-full lg:w-[400px] lg:shrink-0">
        <DevPanel
          hasKey={hasKey}
          mode={mode}
          onModeChange={setMode}
          autoStart={autoStart}
          onAutoStartChange={setAutoStart}
          cooldownMs={cooldownMs}
          onCooldownChange={setCooldownMs}
          onConnect={() => void orbis.connect()}
          onDisconnect={() => void orbis.disconnect()}
          onStart={() => void orbis.startGeneration()}
          onStartMedia={startMedia}
          onSteer={(id) => onSelect(id, "dev-panel", "desktop dev panel")}
          sources={
            <div className="grid grid-cols-2 gap-2">
              <figure>
                <video
                  ref={setMockVideo}
                  muted
                  playsInline
                  autoPlay
                  className="aspect-video w-full rounded border border-red-900 bg-black"
                />
                <figcaption className="mt-0.5 text-[10px] text-red-400">MOCK source</figcaption>
              </figure>
              <figure>
                <video
                  ref={setLiveVideo}
                  muted
                  playsInline
                  autoPlay
                  className="aspect-video w-full rounded border border-emerald-900 bg-black"
                />
                <figcaption className="mt-0.5 text-[10px] text-emerald-400">
                  LIVE main_video
                </figcaption>
              </figure>
            </div>
          }
        />
      </aside>
    </div>
  );
}
