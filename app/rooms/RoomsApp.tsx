"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ViskoOrbisStableProvider } from "@reactor-models/visko-orbis-stable";
import { fetchToken } from "../lib/token";
import { useOrbisSession } from "../mvp/lib/orbisSession";
import { bindStream, streamForTrack, watchVideo } from "../mvp/lib/videoBridge";
import { createMockSource, type MockSource } from "../mvp/lib/mockSource";
import { debug, useDebug, type SourceMode } from "../mvp/lib/debugState";
import { installQuestEmulatorIfRequested } from "../mvp/lib/xrEmulation";
import type { VideoHealth } from "../mvp/lib/videoTextureHealth";
import { ROOMS, DEFAULT_RESOLUTION, findRoom } from "./roomConfigs";
import { useRoomController } from "./lib/useRoomController";
import { useRoomState } from "./lib/roomState";
import { RoomsScene } from "./components/RoomsScene";
import { RoomsPanel } from "./components/RoomsPanel";

// /rooms — six-room Orbis visual-style benchmark. Reuses the proven /mvp
// building blocks (one typed-provider connection, video bridge, controller
// interaction, watchdog, emulation) — nothing in /mvp is replaced.
export function RoomsApp({ hasKey }: { hasKey: boolean }) {
  return (
    <ViskoOrbisStableProvider jwtToken={fetchToken}>
      <RoomsInner hasKey={hasKey} />
    </ViskoOrbisStableProvider>
  );
}

const PHASE_TEXT: Record<string, string> = {
  idle: "select a room",
  "waiting-connection": "press Connect (panel) to start Orbis",
  resetting: "resetting previous room…",
  conditioning: "applying style / seed…",
  starting: "starting generation…",
  priming: "priming — first frames in a few seconds…",
  live: "live",
  mock: "mock",
  error: "error — see panel",
};

function RoomsInner({ hasKey }: { hasKey: boolean }) {
  const [mode, setMode] = useState<SourceMode>(hasKey ? "live" : "mock");
  const [resolution, setResolution] = useState<string | null>(DEFAULT_RESOLUTION);
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

  // autoStart:false — the room controller owns set_prompt/start.
  const orbis = useOrbisSession({ autoStart: false, cooldownMs: 0 });
  const mockRef = useRef<MockSource | null>(null);
  const rooms = useRoomController({ orbis, mode, mock: mockRef, resolution });
  const rs = useRoomState();
  const d = useDebug();

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
      .then((ok) => {
        debug.set({ immersiveVrSupported: ok });
        debug.push("xr", `isSessionSupported('immersive-vr') = ${ok}`);
      })
      .catch(() => debug.set({ immersiveVrSupported: false }));
  }, [xrInitDone]);

  // App-owned video elements.
  const [liveVideo, setLiveVideo] = useState<HTMLVideoElement | null>(null);
  const [mockVideo, setMockVideo] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!mockVideo) return;
    const src = createMockSource();
    mockRef.current = src;
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

  // In-XR watchdog (same rules as /mvp: source-slow vs texture-stall vs loop).
  const xrReports = useRef(0);
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
    if (++xrReports.current % 5 === 0) {
      debug.push(
        "xr",
        `XR video [${roomIdRef.current ?? "-"}]: render ${h.renderFps} fps, decoded ${h.decodedFps ?? "?"} fps, tex ${h.texFps}/s${sourceSlow ? " (SOURCE slow)" : ""}${stalled ? " STALLED" : ""}`,
      );
    }
  }, []);
  const roomIdRef = useRef<string | null>(null);
  roomIdRef.current = rs.activeRoomId;

  // Selection from XR controller / mouse / panel.
  const onSelect = useCallback(
    (target: string, source: string, detail: string) => {
      debug.set({ lastSelectionAt: Date.now(), lastSelectionId: target, lastSelectionSource: detail || source });
      debug.push("xr", `select ${target} via ${detail || source}`);
      const c = /^canvas:(.+)$/.exec(target);
      if (c) return rooms.activateRoom(c[1]);
      const a = /^act:(.+):(approach|point)$/.exec(target);
      if (a) {
        void rooms.triggerAction(a[1], a[2] as "approach" | "point").then((r) => {
          if (!r.ok) debug.push("info", `[room ${a[1]}] ${a[2]} not sent — ${r.reason}`);
          else if (mode === "live") debug.push("cmd", `[room ${a[1]}] ${a[2]} acknowledged by model`);
        });
      }
    },
    [rooms, mode],
  );

  const active = findRoom(rs.activeRoomId);
  const activeVideo = mode === "live" ? liveVideo : mockVideo;
  const vh = d.videoHealth;
  const hudLines = [
    `${active ? active.label : "no room"}  ·  ${mode === "mock" ? "MOCK" : "LIVE"}  ·  ${rs.phase}  ·  chunk ${d.currentChunk ?? "-"}`,
    `action req:${rs.requestedAction ?? "-"} ack:${rs.ackedAction ?? "-"}${Date.now() < rs.cooldownUntil ? "  COOLDOWN" : ""}`,
    `fps ${vh?.renderFps ?? "-"}  dec ${vh?.decodedFps ?? "-"}  tex ${vh?.texFps ?? "-"}/s  ctrl ${d.inputSources.length}${vh?.fallback ? "  FALLBACK" : ""}`,
    d.lastCommandError ? `ERR ${d.lastCommandError}` : rs.lastError ? `ERR ${rs.lastError}` : "no errors",
  ];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 lg:h-screen lg:flex-row lg:overflow-hidden">
      <main className="relative h-[60vh] flex-1 lg:h-full">
        {xrInitDone && (
          <RoomsScene
            rooms={ROOMS}
            activeRoomId={rs.activeRoomId}
            showVideo={rs.liveReady}
            video={activeVideo}
            activeStatus={PHASE_TEXT[rs.phase] ?? rs.phase}
            ackedAction={rs.ackedAction}
            cooldownUntil={rs.cooldownUntil}
            modeLabel={mode === "mock" ? "MOCK" : "LIVE"}
            hudLines={hudLines}
            onSelect={onSelect}
            onVideoHealth={onVideoHealth}
            onXRSession={(on) => {
              if (on) debug.set({ xrSessionActive: true, xrVideo: { seconds: 0, uploads: 0, stalledSeconds: 0, fallback: false, minRenderFps: Infinity } });
              else {
                const xv = debug.get().xrVideo;
                debug.set({ xrSessionActive: false });
                debug.push("xr", `immersive session ended — ${xv.seconds}s in XR, stalled ${xv.stalledSeconds}s, min render ${xv.minRenderFps} fps, fallback=${xv.fallback}`);
                return;
              }
              debug.push("xr", "immersive session started");
            }}
            onInputInfo={(s) => {
              debug.set({ inputSources: s });
              debug.push("xr", `input sources: ${s.length}`);
            }}
          />
        )}
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-[11px] text-zinc-300">
          /rooms · aim at a canvas + trigger to activate a room
        </div>
      </main>
      <aside className="w-full overflow-y-auto p-3 lg:h-full lg:w-[420px] lg:shrink-0">
        <RoomsPanel
          rooms={ROOMS}
          hasKey={hasKey}
          mode={mode}
          onModeChange={setMode}
          onConnect={() => void orbis.connect()}
          onDisconnect={() => void orbis.disconnect()}
          onActivate={(id) => onSelect(`canvas:${id}`, "panel", "desktop panel")}
          onAction={(id, a) => onSelect(`act:${id}:${a}`, "panel", "desktop panel")}
          resolution={resolution}
          sources={
            <div className="mb-2 grid grid-cols-2 gap-2">
              <video ref={setMockVideo} muted playsInline autoPlay className="aspect-video w-full rounded border border-red-900 bg-black" />
              <video ref={setLiveVideo} muted playsInline autoPlay className="aspect-video w-full rounded border border-emerald-900 bg-black" />
            </div>
          }
        />
      </aside>
    </div>
  );
}
