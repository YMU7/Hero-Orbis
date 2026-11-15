"use client";

import { useState } from "react";
import { usePuzzleState, puzzleStore } from "../lib/puzzleState";
import { applyPaintGrade } from "../lib/roomParts";
import { DEFAULT_GRADE, GRADE_LIMITS, STYLE_PRESETS, defaultStyle, parseStyle, type PaintGrade, type PromptParts, type PuzzleStyle } from "../lib/style";

// Style tuner for the Orbis painting.
//   - Colour grade sliders: display only, applied every frame, no credit.
//   - Prompt parts: style / character / setting / camera (the actions live on
//     scene objects: painting + puzzle components in /editor?scene=puzzle).
//     "Apply to live picture" saves AND re-sends the current beat's prompt on
//     the same session (the picture morphs at the next chunk).
//   - "Save" writes data/puzzle-style.json (+ history); every later run
//     uses it, and it records the look the user wants.

const PROMPT_FIELDS: Array<{ key: keyof PromptParts; label: string; rows: number }> = [
  { key: "style", label: "Visual style + colour palette", rows: 4 },
  { key: "identity", label: "Character (face, hair, outfit)", rows: 5 },
  { key: "setting", label: "Background / setting", rows: 3 },
  { key: "camera", label: "Camera", rows: 2 },
];

export function StyleTuner(p: { live: boolean; onApplyLive: () => Promise<{ ok: boolean; reason?: string }> }) {
  const s = usePuzzleState();
  const style = s.style;
  const [status, setStatus] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const btn = "rounded px-2 py-0.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-35";

  const update = (next: PuzzleStyle) => {
    puzzleStore.set({ style: next });
    applyPaintGrade(next.grade);
    setDirty(true);
  };
  const setGrade = (k: keyof PaintGrade, v: number) => update({ ...style, grade: { ...style.grade, [k]: v } });
  const setPrompt = (k: keyof PromptParts, v: string) => update({ ...style, prompt: { ...style.prompt, [k]: v } });


  const save = async (): Promise<boolean> => {
    setStatus("saving…");
    try {
      const r = await fetch("/puzzle/api/style", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(style) });
      const body = (await r.json()) as { style?: PuzzleStyle; error?: string };
      if (!r.ok || !body.style) throw new Error(body.error ?? `HTTP ${r.status}`);
      puzzleStore.set({ styleSavedAt: body.style.savedAt ?? null });
      setDirty(false);
      setStatus(`saved ${new Date(body.style.savedAt ?? Date.now()).toLocaleTimeString()}`);
      return true;
    } catch (e) {
      setStatus(`save failed: ${(e as Error).message}`);
      return false;
    }
  };

  const applyLive = async () => {
    setBusy(true);
    try {
      if (!(await save())) return;
      const r = await p.onApplyLive();
      setStatus(r.ok ? "saved + sent to the live picture (morphs at the next chunk, ~2 s)" : `saved, not sent: ${r.reason}`);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    try {
      const r = await fetch("/puzzle/api/style", { cache: "no-store" });
      const body = (await r.json()) as { saved: boolean; style: unknown };
      const st = parseStyle(body.style);
      puzzleStore.set({ style: st, styleSavedAt: body.saved ? (st.savedAt ?? null) : null });
      applyPaintGrade(st.grade);
      setDirty(false);
      setStatus(body.saved ? "reloaded the saved style" : "no saved style yet — showing defaults");
    } catch (e) {
      setStatus(`reload failed: ${(e as Error).message}`);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <h3 className="mb-1 text-xs uppercase tracking-wider text-zinc-400">Painting style tuner</h3>
      <p className="mb-2 text-[10px] text-zinc-500">
        Colour sliders change the display instantly (no credit). Text changes the generated picture: “Apply to live picture”. Saved to data/puzzle-style.json
        {s.styleSavedAt ? ` · last saved ${new Date(s.styleSavedAt).toLocaleTimeString()}` : " · not saved yet"}
        {dirty ? " · unsaved changes" : ""}
      </p>

      <h4 className="mb-1 text-[11px] font-semibold text-zinc-300">Colour grade (display)</h4>
      <div className="mb-2 flex flex-col gap-1">
        {(Object.keys(GRADE_LIMITS) as Array<keyof PaintGrade>).map((k) => {
          const L = GRADE_LIMITS[k];
          return (
            <label key={k} className="flex items-center gap-2 text-[11px]">
              <span className="w-36 shrink-0 text-zinc-500">{L.label}</span>
              <input type="range" min={L.min} max={L.max} step={L.step} value={style.grade[k]} onChange={(e) => setGrade(k, Number(e.target.value))} className="flex-1" />
              <span className="w-10 text-right font-mono">{style.grade[k].toFixed(2)}</span>
            </label>
          );
        })}
        <button className={`${btn} self-start bg-zinc-700`} onClick={() => update({ ...style, grade: { ...DEFAULT_GRADE } })}>
          Reset colour
        </button>
      </div>

      <h4 className="mb-1 text-[11px] font-semibold text-zinc-300">Prompt (generated picture)</h4>
      <label className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="w-36 shrink-0 text-zinc-500">palette preset</span>
        <select
          className="flex-1 rounded bg-zinc-800 px-1 py-0.5 text-[11px]"
          value={STYLE_PRESETS.find((x) => x.style === style.prompt.style)?.id ?? "custom"}
          onChange={(e) => {
            const preset = STYLE_PRESETS.find((x) => x.id === e.target.value);
            if (preset) setPrompt("style", preset.style);
          }}
        >
          {STYLE_PRESETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          <option value="custom" disabled>
            custom (edited)
          </option>
        </select>
      </label>
      {PROMPT_FIELDS.map((f) => (
        <label key={f.key} className="mb-1.5 block text-[11px]">
          <span className="text-zinc-500">{f.label}</span>
          <textarea
            className="mt-0.5 w-full rounded bg-zinc-800 p-1 font-mono text-[10px] leading-4 text-zinc-200"
            rows={f.rows}
            value={style.prompt[f.key]}
            onChange={(e) => setPrompt(f.key, e.target.value)}
          />
        </label>
      ))}
      <label className="mb-2 block text-[11px]">
        <span className="text-zinc-500">Notes — what you want (kept with the style)</span>
        <textarea
          className="mt-0.5 w-full rounded bg-zinc-800 p-1 text-[11px] text-zinc-200"
          rows={2}
          value={style.notes}
          onChange={(e) => update({ ...style, notes: e.target.value })}
        />
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        <button className={`${btn} bg-emerald-700`} disabled={busy || !p.live} onClick={() => void applyLive()} title={p.live ? "" : "connect in LIVE mode first"}>
          Apply to live picture
        </button>
        <button className={`${btn} bg-sky-800`} disabled={busy} onClick={() => void save()}>
          Save
        </button>
        <button className={`${btn} bg-zinc-700`} disabled={busy} onClick={() => void reload()}>
          Reload saved
        </button>
        <button
          className={`${btn} bg-zinc-700`}
          disabled={busy}
          onClick={() => {
            update(defaultStyle());
            setStatus("defaults restored (not saved yet)");
          }}
        >
          Defaults
        </button>
      </div>
      {status && <p className="mt-1.5 text-[10px] text-zinc-400">{status}</p>}
    </section>
  );
}
