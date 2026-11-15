"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDebug, type SourceMode } from "../../mvp/lib/debugState";
import { useRoomState } from "../lib/roomState";
import type { RoomConfig } from "../roomConfigs";

// Desktop diagnostics + controls for the six-room benchmark. Reads stores
// only; every action is a callback.

function Row({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-zinc-800/60 py-0.5 text-[11px]">
      <span className="shrink-0 text-zinc-500">{k}</span>
      <span className={`truncate text-right font-mono ${warn ? "text-red-400" : "text-zinc-200"}`}>{v}</span>
    </div>
  );
}

const fmt = (t: number | null) => (t ? new Date(t).toLocaleTimeString(undefined, { hour12: false }) : "—");

export function RoomsPanel(p: {
  rooms: ReadonlyArray<RoomConfig>;
  hasKey: boolean;
  mode: SourceMode;
  onModeChange: (m: SourceMode) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onActivate: (id: string) => void;
  onAction: (id: string, a: "approach" | "point") => void;
  resolution: string | null;
  sources: ReactNode;
}) {
  const d = useDebug();
  const r = useRoomState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const btn = "rounded px-2 py-0.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-35";
  const generating = d.reactorStatus === "ready" && d.started;

  return (
    <div className="flex flex-col gap-3 text-zinc-200">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider text-zinc-400">Orbis style benchmark</h2>
          <div className="flex overflow-hidden rounded border border-zinc-700 text-[11px]">
            {(["mock", "live"] as const).map((m) => (
              <button
                key={m}
                onClick={() => p.onModeChange(m)}
                disabled={m === "live" && !p.hasKey}
                className={`px-2.5 py-0.5 ${p.mode === m ? (m === "mock" ? "bg-red-700" : "bg-emerald-700") : "bg-zinc-900 text-zinc-400"} disabled:opacity-40`}
              >
                {m === "mock" ? "MOCK" : "LIVE ORBIS"}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button onClick={p.onConnect} disabled={!p.hasKey || d.reactorStatus !== "disconnected" || p.mode !== "live"} className={`${btn} bg-emerald-700`}>
            Connect
          </button>
          <button onClick={p.onDisconnect} disabled={d.reactorStatus === "disconnected"} className={`${btn} bg-zinc-700`}>
            Disconnect
          </button>
          <span className="ml-auto text-[10px] text-zinc-500">res {p.resolution ?? "default"} · seed 42</span>
        </div>
        {p.mode === "mock" && generating && (
          <p className="mb-2 text-[11px] text-amber-400">Live session still generating while MOCK is shown — Disconnect to stop using credits.</p>
        )}
        <Row k="reactor" v={`${d.reactorStatus}${d.sessionId ? ` · ${d.sessionId.slice(0, 8)}` : ""}`} />
        <Row k="chunk" v={d.currentChunk ?? "—"} />
        <Row k="active room" v={r.activeRoomId ?? "—"} />
        <Row k="phase / activation" v={`${r.phase} · #${r.activation}`} warn={r.phase === "error"} />
        <Row k="action req / ack" v={`${r.requestedAction ?? "—"} / ${r.ackedAction ?? "—"}${r.ackedAtChunk != null ? ` @${r.ackedAtChunk}` : ""}`} />
        <Row k="first frames after" v={r.activatedAt && r.firstFrameAt ? `${((r.firstFrameAt - r.activatedAt) / 1000).toFixed(1)} s` : "—"} />
        <Row k="room error" v={r.lastError ?? "—"} warn={!!r.lastError} />
        <Row k="command error" v={d.lastCommandError ?? "—"} warn={!!d.lastCommandError} />
        {now < r.cooldownUntil && <p className="mt-1 text-[10px] text-amber-400">cooldown {((r.cooldownUntil - now) / 1000).toFixed(1)} s</p>}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Rooms</h2>
        <div className="flex flex-col gap-1.5">
          {p.rooms.map((room) => {
            const active = r.activeRoomId === room.id;
            const res = r.results[room.id];
            return (
              <div
                key={room.id}
                className={`rounded border px-2 py-1.5 ${active ? "border-zinc-400 bg-zinc-800/70" : "border-zinc-800"}`}
                style={{ borderLeft: `4px solid #${room.accent.toString(16).padStart(6, "0")}` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 truncate text-[11px] font-medium">{room.label}</span>
                  <button onClick={() => p.onActivate(room.id)} className={`${btn} bg-zinc-700`}>
                    {active ? "Re-activate" : "Activate"}
                  </button>
                  <button onClick={() => p.onAction(room.id, "approach")} disabled={!active} className={`${btn} bg-sky-700`}>
                    Approach
                  </button>
                  <button onClick={() => p.onAction(room.id, "point")} disabled={!active} className={`${btn} bg-violet-700`}>
                    Point
                  </button>
                </div>
                {res && (
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
                    act×{res.activations} · first frames {res.lastFirstFrameMs != null ? `${(res.lastFirstFrameMs / 1000).toFixed(1)}s` : "—"} · approach✓{res.actionsAcked.approach ?? 0} point✓{res.actionsAcked.point ?? 0}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Video / XR</h2>
        {p.sources}
        <Row
          k="plane texture"
          v={d.videoHealth ? `render ${d.videoHealth.renderFps} · dec ${d.videoHealth.decodedFps ?? "?"} · tex ${d.videoHealth.texFps}/s${d.videoHealth.fallback ? " · FALLBACK" : ""}` : "—"}
        />
        <Row
          k="webrtc in"
          v={d.net ? `${d.net.fps ?? "?"} fps · ${d.net.kbps ?? "?"} kbps · loss ${d.net.loss != null ? (d.net.loss * 100).toFixed(1) + "%" : "?"} · ${d.net.candidate ?? "?"}` : "—"}
        />
        <Row k="immersive-vr" v={d.immersiveVrSupported == null ? "…" : String(d.immersiveVrSupported)} />
        <Row k="XR session" v={String(d.xrSessionActive)} />
        <Row k="XR totals" v={`${d.xrVideo.seconds}s · stalled ${d.xrVideo.stalledSeconds}s`} warn={d.xrVideo.stalledSeconds > 0} />
        <Row k="inputs" v={d.inputSources.length ? `${d.inputSources.length}` : "—"} />
        <Row k="last selection" v={d.lastSelectionId ? `${d.lastSelectionId} · ${fmt(d.lastSelectionAt)}` : "—"} />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Event log</h2>
        <div className="max-h-64 overflow-y-auto font-mono text-[10px] leading-snug">
          {d.log.map((e, i) => (
            <div key={`${e.t}-${i}`} className={e.kind === "error" ? "text-red-400" : e.kind === "cmd" ? "text-sky-300" : e.kind === "xr" ? "text-violet-300" : "text-zinc-400"}>
              {fmt(e.t)} {e.msg}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
