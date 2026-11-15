"use client";

import { type ReactNode } from "react";
import { useDebug, type SourceMode } from "../../mvp/lib/debugState";
import { usePuzzleState, puzzleStore } from "../lib/puzzleState";
import { DEFAULT_SWORD_PARAMS, type SwordParams } from "../lib/swordRecognizer";
import { StyleTuner } from "./StyleTuner";

// Desktop diagnostics + controls for /puzzle. Reads stores only; actions are
// callbacks. There is deliberately NO "solve" button: only a recognised
// drawing sends the happy prompt.

function Row({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-zinc-800/60 py-0.5 text-[11px]">
      <span className="shrink-0 text-zinc-500">{k}</span>
      <span className={`truncate text-right font-mono ${warn ? "text-red-400" : "text-zinc-200"}`}>{v}</span>
    </div>
  );
}

function Bar({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 text-zinc-500">{k}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${v > 0 ? "bg-emerald-500" : "bg-red-600"}`} style={{ width: `${Math.max(v, 0.03) * 100}%` }} />
      </div>
      <span className="w-10 text-right font-mono">{v.toFixed(2)}</span>
    </div>
  );
}

const SLIDERS: Array<{ key: keyof SwordParams; label: string; min: number; max: number; step: number }> = [
  { key: "minBladeFrac", label: "min blade (× board h)", min: 0.1, max: 0.9, step: 0.05 },
  { key: "bladeStraightMin", label: "blade straightness", min: 0.6, max: 0.99, step: 0.01 },
  { key: "guardStraightMin", label: "guard straightness", min: 0.5, max: 0.99, step: 0.01 },
  { key: "guardMinRatio", label: "guard ≥ × blade", min: 0.05, max: 0.6, step: 0.01 },
  { key: "guardMaxRatio", label: "guard ≤ × blade", min: 0.3, max: 1.5, step: 0.05 },
  { key: "angleTolDeg", label: "angle tol (°)", min: 5, max: 60, step: 1 },
  { key: "guardPosMin", label: "guard pos ≥ (from end)", min: 0, max: 0.3, step: 0.01 },
  { key: "guardPosMax", label: "guard pos ≤ (from end)", min: 0.15, max: 0.5, step: 0.01 },
  { key: "crossMin", label: "crossing margin", min: 0, max: 0.45, step: 0.01 },
  { key: "maxExtraInkRatio", label: "extra ink ≤ × blade", min: 0, max: 4, step: 0.1 },
];

export function PuzzlePanel(p: {
  hasKey: boolean;
  mode: SourceMode;
  onModeChange: (m: SourceMode) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onReset: () => void;
  onClear: () => void;
  onParams: () => void;
  onApplyStyle: () => Promise<{ ok: boolean; reason?: string }>;
  resolution: string | null;
  sources: ReactNode;
}) {
  const d = useDebug();
  const s = usePuzzleState();
  const btn = "rounded px-2 py-0.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-35";
  const generating = d.reactorStatus === "ready" && d.started;
  const res = s.lastResult;
  const m = res?.metrics;

  return (
    <div className="flex flex-col gap-3 text-zinc-200">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider text-zinc-400">Princess in the painting · puzzle test</h2>
          <div className="flex overflow-hidden rounded border border-zinc-700 text-[11px]">
            {(["mock", "live"] as const).map((mm) => (
              <button
                key={mm}
                onClick={() => p.onModeChange(mm)}
                disabled={mm === "live" && !p.hasKey}
                className={`px-2.5 py-0.5 ${p.mode === mm ? (mm === "mock" ? "bg-red-700" : "bg-emerald-700") : "bg-zinc-900 text-zinc-400"} disabled:opacity-40`}
              >
                {mm === "mock" ? "MOCK" : "LIVE ORBIS"}
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
          <button onClick={p.onReset} className={`${btn} bg-red-900`}>
            Reset puzzle
          </button>
          <button onClick={p.onClear} className={`${btn} bg-sky-900`}>
            Clear board
          </button>
          <span className="ml-auto text-[10px] text-zinc-500">res {p.resolution ?? "default"} · seed 42</span>
        </div>
        {p.mode === "mock" && generating && (
          <p className="mb-2 text-[11px] text-amber-400">Live session still generating while MOCK is shown — Disconnect to stop using credits.</p>
        )}
        <Row k="reactor" v={`${d.reactorStatus}${d.sessionId ? ` · ${d.sessionId.slice(0, 8)}` : ""}`} />
        <Row k="chunk" v={d.currentChunk ?? "—"} />
        <Row k="phase / run" v={`${s.phase} · #${s.run}`} warn={s.phase === "error"} />
        <Row k="first frames after" v={s.runStartedAt && s.firstFrameAt ? `${((s.firstFrameAt - s.runStartedAt) / 1000).toFixed(1)} s` : "—"} />
        <Row k="solved (happy ack @chunk)" v={s.solvedRun === s.run ? `yes${s.happyAckChunk != null ? ` @${s.happyAckChunk}` : ""}` : "no"} />
        <Row k="puzzle 1: gramophone sound" v={s.soundOn ? "ON" : "off (muted)"} />
        <label className="flex items-center justify-between gap-3 border-b border-zinc-800/60 py-0.5 text-[11px]">
          <span className="text-zinc-500">sword counts only after sound</span>
          <input type="checkbox" checked={s.requireSoundFirst} onChange={(e) => puzzleStore.set({ requireSoundFirst: e.target.checked })} />
        </label>
        <Row k="crayon / tonearm" v={`${s.crayonHolder ?? "on ledge"} · ${s.drawMode} / ${s.tonearmHolder ?? "—"}`} />
        <Row k="auto-continues (generation_complete)" v={s.continuations} />
        <Row
          k="auto-reconnect"
          v={`${s.autoReconnect ? "on" : "off"}${s.reconnectAttempts ? ` · attempt ${s.reconnectAttempts}` : ""}${s.nextReconnectAt ? ` · in ${Math.max(0, Math.round((s.nextReconnectAt - Date.now()) / 1000))} s` : ""}`}
          warn={!!s.nextReconnectAt}
        />
        <Row k="room hint" v={s.hint ?? "—"} />
        <Row k="wrong-drawing hints (local)" v={s.wrongHints} />
        <Row k="puzzle error" v={s.lastError ?? "—"} warn={!!s.lastError} />
        <Row k="last command error" v={d.lastCommandError ?? "—"} warn={!!d.lastCommandError} />
        <Row k="net fps / kbps" v={d.net ? `${d.net.fps ?? "—"} / ${d.net.kbps ?? "—"}` : "—"} />
        <Row k="render / dec / tex" v={d.videoHealth ? `${d.videoHealth.renderFps} / ${d.videoHealth.decodedFps ?? "?"} / ${d.videoHealth.texFps}` : "—"} />
        <Row k="emulation" v={d.emulation} />
        <Row k="XR / inputs" v={`${d.xrSessionActive ? "in XR" : "2D"} · ${d.inputSources.length}`} />
      </section>

      <StyleTuner live={p.mode === "live" && d.reactorStatus === "ready"} onApplyLive={p.onApplyStyle} />

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Recognizer</h3>
        <Row k="strokes" v={s.strokeCount} />
        <Row k="verdict" v={res ? (res.isSword ? `SWORD · score ${res.score.toFixed(2)}` : res.reason) : "—"} warn={!!res && !res.isSword} />
        <div className="my-2 flex flex-col gap-1">
          {res && Object.entries(res.scores).map(([k, v]) => <Bar key={k} k={k} v={v} />)}
        </div>
        {m && (
          <div className="mb-2 font-mono text-[10px] text-zinc-400">
            blade {(m.bladeLen * 100).toFixed(1)} cm · str {m.bladeStraight.toFixed(2)} | guard {(m.guardLen * 100).toFixed(1)} cm · str{" "}
            {m.guardStraight.toFixed(2)} | angle {m.angleDeg.toFixed(0)}° | pos {m.guardPos.toFixed(2)} | cross {Number.isFinite(m.crossAt) ? m.crossAt.toFixed(2) : "—"} | extra{" "}
            {m.extraInkRatio.toFixed(2)}
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-[11px] text-zinc-400">Thresholds</summary>
          <div className="mt-2 flex flex-col gap-1">
            {SLIDERS.map((sl) => (
              <label key={sl.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-36 shrink-0 text-zinc-500">{sl.label}</span>
                <input
                  type="range"
                  min={sl.min}
                  max={sl.max}
                  step={sl.step}
                  value={s.params[sl.key]}
                  onChange={(e) => {
                    puzzleStore.set({ params: { ...puzzleStore.get().params, [sl.key]: Number(e.target.value) } });
                    p.onParams();
                  }}
                  className="flex-1"
                />
                <span className="w-10 text-right font-mono">{s.params[sl.key]}</span>
              </label>
            ))}
            <button
              className={`${btn} mt-1 self-start bg-zinc-700`}
              onClick={() => {
                puzzleStore.set({ params: DEFAULT_SWORD_PARAMS });
                p.onParams();
              }}
            >
              Defaults
            </button>
          </div>
        </details>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Sources (mock · live)</h3>
        {p.sources}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Event log</h3>
        <div className="max-h-72 overflow-y-auto font-mono text-[10px] leading-4">
          {d.log.slice(0, 80).map((l, i) => (
            <div key={i} className={l.kind === "error" ? "text-red-400" : l.kind === "cmd" ? "text-sky-300" : l.kind === "xr" ? "text-violet-300" : "text-zinc-400"}>
              {new Date(l.t).toLocaleTimeString(undefined, { hour12: false })} {l.msg}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
