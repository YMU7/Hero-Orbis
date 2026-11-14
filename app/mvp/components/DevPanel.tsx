"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDebug, type SourceMode } from "../lib/debugState";
import { XR_BUTTONS } from "../lib/prompts";

// Desktop diagnostics (brief §9) + controls. Reads the debug store only; all
// actions are callbacks so this panel has no Reactor or Three.js knowledge.

export type DevPanelProps = {
  hasKey: boolean;
  mode: SourceMode;
  onModeChange: (m: SourceMode) => void;
  autoStart: boolean;
  onAutoStartChange: (v: boolean) => void;
  cooldownMs: number;
  onCooldownChange: (ms: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onStart: () => void;
  onStartMedia: () => void;
  onSteer: (id: string) => void;
  sources: ReactNode; // the two app-owned <video> thumbnails
};

function Row({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-zinc-800/60 py-0.5 text-[11px]">
      <span className="shrink-0 text-zinc-500">{k}</span>
      <span
        className={`truncate text-right font-mono ${warn ? "text-red-400" : "text-zinc-200"}`}
        title={typeof v === "string" ? v : undefined}
      >
        {v}
      </span>
    </div>
  );
}

const fmtTime = (t: number | null) =>
  t ? new Date(t).toLocaleTimeString(undefined, { hour12: false }) : "—";
const yn = (b: boolean | null) => (b === null ? "…" : b ? "yes" : "no");

export function DevPanel(p: DevPanelProps) {
  const d = useDebug();
  const [ua, setUa] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Read browser-only values after mount so SSR and hydration markup match.
  const [secure, setSecure] = useState("…");
  useEffect(() => {
    setUa(navigator.userAgent);
    setSecure(String(window.isSecureContext));
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const ready = d.reactorStatus === "ready";
  const cooling = now < d.cooldownUntil;
  const btn =
    "rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col gap-3 text-zinc-200">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider text-zinc-400">
            Source
          </h2>
          <div className="flex overflow-hidden rounded-md border border-zinc-700 text-xs">
            {(["mock", "live"] as const).map((m) => (
              <button
                key={m}
                onClick={() => p.onModeChange(m)}
                disabled={m === "live" && !p.hasKey}
                className={`px-3 py-1 ${p.mode === m ? (m === "mock" ? "bg-red-700 text-white" : "bg-emerald-700 text-white") : "bg-zinc-900 text-zinc-400"} disabled:opacity-40`}
              >
                {m === "mock" ? "MOCK" : "LIVE ORBIS"}
              </button>
            ))}
          </div>
        </div>
        {!p.hasKey && (
          <p className="mb-2 text-[11px] text-amber-400">
            REACTOR_API_KEY not set on the server — live mode disabled. Mock
            mode still exercises Three.js/WebXR.
          </p>
        )}
        {p.sources}
        <button
          onClick={p.onStartMedia}
          className={`${btn} mt-2 w-full bg-zinc-800 hover:bg-zinc-700`}
        >
          Start media (retry video.play)
        </button>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
          Orbis session
        </h2>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            onClick={p.onConnect}
            disabled={!p.hasKey || d.reactorStatus !== "disconnected"}
            className={`${btn} bg-emerald-700 text-white hover:bg-emerald-600`}
          >
            Connect
          </button>
          <button
            onClick={p.onStart}
            disabled={!ready || d.started}
            className={`${btn} bg-sky-700 text-white hover:bg-sky-600`}
          >
            Start
          </button>
          <button
            onClick={p.onDisconnect}
            disabled={d.reactorStatus === "disconnected"}
            className={`${btn} bg-zinc-700 hover:bg-zinc-600`}
          >
            Disconnect
          </button>
          <label className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={p.autoStart}
              onChange={(e) => p.onAutoStartChange(e.target.checked)}
            />
            auto-start on ready
          </label>
        </div>
        <Row k="status" v={d.reactorStatus} />
        <Row k="session" v={d.sessionId ?? "—"} />
        <Row k="started / running" v={`${d.started} / ${d.running}`} />
        <Row k="current_chunk" v={d.currentChunk ?? "—"} />
        <Row k="session error" v={d.lastSessionError ?? "—"} warn={!!d.lastSessionError} />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
          Steering (same session — set_prompt only)
        </h2>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {XR_BUTTONS.map((b) => (
            <button
              key={b.id}
              onClick={() => p.onSteer(b.id)}
              disabled={cooling}
              className={`${btn} py-2 text-white`}
              style={{ background: `#${b.color.toString(16).padStart(6, "0")}` }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-400">
          cooldown
          <input
            type="number"
            min={0}
            step={500}
            value={p.cooldownMs}
            onChange={(e) => p.onCooldownChange(Math.max(0, Number(e.target.value) || 0))}
            className="w-20 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-zinc-200"
          />
          ms {cooling && <span className="text-amber-400">({((d.cooldownUntil - now) / 1000).toFixed(1)}s)</span>}
        </div>
        <Row k="requested prompt" v={d.requestedPrompt ?? "—"} />
        <Row
          k="accepted (ack)"
          v={
            !d.acceptedPrompt
              ? "—"
              : p.mode === "mock"
                ? `${d.acceptedPrompt} (mock, local only)`
                : `${d.acceptedPrompt} @ chunk ${d.acceptedAtChunk ?? "?"}`
          }
        />
        <Row k="last command" v={d.lastCommand ? `${d.lastCommand} · ${fmtTime(d.lastCommandAt)}` : "—"} />
        <Row k="command error" v={d.lastCommandError ?? "—"} warn={!!d.lastCommandError} />
        <Row
          k="last selection"
          v={d.lastSelectionId ? `${d.lastSelectionId} · ${d.lastSelectionSource} · ${fmtTime(d.lastSelectionAt)}` : "—"}
        />
        <p className="mt-1 text-[10px] leading-snug text-zinc-500">
          “accepted” = model acknowledged set_prompt. The picture morphs at a
          later chunk boundary (~1.8 s chunks) — verify visually.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
          WebXR / media
        </h2>
        <Row k="navigator.xr" v={yn(d.xrAvailable)} warn={d.xrAvailable === false} />
        <Row k="immersive-vr supported" v={yn(d.immersiveVrSupported)} warn={d.immersiveVrSupported === false} />
        <Row k="XR session active" v={yn(d.xrSessionActive)} />
        <Row k="emulation" v={d.emulation} warn={d.emulation.startsWith("IWER")} />
        <Row
          k="plane texture"
          v={
            d.videoHealth
              ? `render ${d.videoHealth.renderFps} fps · decoded ${d.videoHealth.decodedFps ?? "?"} fps · tex ${d.videoHealth.texFps}/s · media +${d.videoHealth.mediaAdvance}s/s${d.videoHealth.fallback ? " · FALLBACK" : ""}`
              : "—"
          }
          warn={!!d.videoHealth && d.videoHealth.playing && d.videoHealth.texFps === 0}
        />
        <Row
          k="webrtc in"
          v={
            d.net
              ? `${d.net.fps ?? "?"} fps · ${d.net.kbps ?? "?"} kbps (avail ${d.net.availKbps ?? "?"}) · loss ${d.net.loss != null ? (d.net.loss * 100).toFixed(1) + "%" : "?"} · rtt ${d.net.rttMs != null ? Math.round(d.net.rttMs) : "?"}ms · ${d.net.candidate ?? "?"}`
              : "—"
          }
        />
        <Row
          k="XR video totals"
          v={`${d.xrVideo.seconds}s · ${d.xrVideo.uploads} uploads · stalled ${d.xrVideo.stalledSeconds}s`}
          warn={d.xrVideo.stalledSeconds > 0}
        />
        <Row k="input sources" v={d.inputSources.length ? d.inputSources.join(" | ") : "—"} />
        <Row
          k="live video"
          v={`rs=${d.live.readyState} ${d.live.width}x${d.live.height} ${d.live.paused ? "paused" : "playing"} f=${d.live.frameCount}`}
        />
        <Row
          k="mock video"
          v={`rs=${d.mock.readyState} ${d.mock.width}x${d.mock.height} ${d.mock.paused ? "paused" : "playing"} f=${d.mock.frameCount}`}
        />
        <Row k="last play error" v={d.lastPlayError ?? "—"} warn={!!d.lastPlayError} />
        <Row k="secure context" v={secure} warn={secure === "false"} />
        <div className="mt-1 break-all text-[10px] text-zinc-500">{ua}</div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
          Event log
        </h2>
        <div className="max-h-64 overflow-y-auto font-mono text-[10px] leading-snug">
          {d.log.map((e, i) => (
            <div
              key={`${e.t}-${i}`}
              className={
                e.kind === "error"
                  ? "text-red-400"
                  : e.kind === "cmd"
                    ? "text-sky-300"
                    : e.kind === "xr"
                      ? "text-violet-300"
                      : e.kind === "media"
                        ? "text-emerald-300"
                        : "text-zinc-400"
              }
            >
              {fmtTime(e.t)} {e.kind.padEnd(5)} {e.msg}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
