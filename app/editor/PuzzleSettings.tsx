"use client";

import { useCallback, useEffect, useState } from "react";
import { MIX_CHANNELS, parseStyle, type AudioMix, type PuzzleStyle } from "../puzzle/lib/style";
import { SWORD_LIMITS, swordParamsFrom } from "../puzzle/lib/swordRecognizer";
import { SOUND_IDS } from "../puzzle/lib/roomAudio";
import { checkPuzzles, isPuzzleId, type PaintingComponent, type PuzzleComponent, type PuzzleTrigger } from "../lib/sceneData/components";

// Scene Editor Inspector components for the puzzle room (/editor?scene=puzzle).
//
//   <ObjectComponents> – on the selected object:
//       painting → "Painting": what the princess does when she appears
//       others   → "+ Puzzle": trigger, requires, instruction, sound, hint
//     Stored IN the scene file (data/scenes/puzzle.json) with the object, so
//     they autosave with the layout like position / rotation / scale.
//   <RoomAudioSettings> – channel volumes (data/puzzle-style.json, merged).
//
// Instructions describe only what the princess DOES. The art direction
// (style, character, background, camera) is fixed and always sent first, so
// a different instruction changes the action, not the look.

export type ComponentItem = { id: string; name: string; asset: string; puzzle?: PuzzleComponent; painting?: PaintingComponent };

const TRIGGER_LABEL: Record<PuzzleTrigger, string> = {
  needle: "Needle on the spinning record",
  "draw-sword": "Draw a sword on the canvas",
  touch: "Touch the object (fingertip / click)",
  pinch: "Pinch the object (pinch / click)",
};

/** Which triggers make sense on which object. */
export function triggersFor(asset: string): PuzzleTrigger[] {
  if (asset === "builtin:gramophone") return ["needle"];
  if (asset === "builtin:easel") return ["draw-sword"];
  return ["touch", "pinch"];
}

// Words that usually change the LOOK rather than the action. Only a warning.
const LOOK_WORDS =
  /\b(style|styled|realistic|photo\w*|anime|cartoon|pixel|render\w*|cinematic|lighting|lit|colou?r\w*|palette|saturat\w*|neon|dark|black and white|monochrome|watercolou?r|oil painting|sketch|3d|2d|zoom\w*|close-?up|wide shot|pans|panning|background|scene|outfit|dress\w*|hair\w*)\b/i;

const btn = "rounded px-2 py-1 text-xs font-medium disabled:opacity-40";
const field = "rounded bg-zinc-900 px-2 py-1 text-[11px]";

function Instruction(p: { label: string; value: string; onChange: (v: string) => void; hint?: string; rows?: number }) {
  const look = p.value.match(LOOK_WORDS)?.[0];
  return (
    <label className="flex flex-col gap-1">
      <span className="text-zinc-500">{p.label}</span>
      <textarea value={p.value} rows={p.rows ?? 4} maxLength={2000} onChange={(e) => p.onChange(e.target.value)} className={`${field} leading-snug`} aria-label={p.label} />
      {p.hint && <span className="text-[10px] text-zinc-600">{p.hint}</span>}
      {look && <span className="text-[10px] text-amber-400">&ldquo;{look}&rdquo; may change the look. Describe what she does; the art style is fixed.</span>}
    </label>
  );
}

function newPuzzleId(items: ComponentItem[], base: string) {
  const used = new Set(items.flatMap((i) => (i.puzzle ? [i.puzzle.id] : [])));
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "puzzle";
  let id = stem;
  for (let n = 2; used.has(id) || !isPuzzleId(id); n++) id = `${stem}-${n}`;
  return id;
}

export function ObjectComponents(p: {
  item: ComponentItem;
  items: ComponentItem[];
  onChange: (patch: Partial<Pick<ComponentItem, "puzzle" | "painting">>) => void;
}) {
  const { item, items, onChange } = p;

  if (item.asset === "builtin:painting") {
    const pc = item.painting ?? { startInstruction: "", audioPrompt: "" };
    const set = (patch: Partial<PaintingComponent>) => onChange({ painting: { ...pc, ...patch } });
    return (
      <section className="flex flex-col gap-2 rounded border border-zinc-800 p-2">
        <h3 className="uppercase tracking-wider text-zinc-400">Painting</h3>
        <Instruction
          label="When she appears (sent to Orbis)"
          value={pc.startInstruction}
          onChange={(v) => set({ startInstruction: v })}
          hint="Sent at the start of every run and after Reset. Empty = built-in default."
        />
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Audio prompt (optional: what it sounds like)</span>
          <input value={pc.audioPrompt} maxLength={500} onChange={(e) => set({ audioPrompt: e.target.value })} className={field} />
        </label>
      </section>
    );
  }

  const options = triggersFor(item.asset);
  if (!item.puzzle) {
    return (
      <button
        onClick={() =>
          onChange({
            puzzle: {
              id: newPuzzleId(items, item.name),
              trigger: options[0],
              requires: null,
              instruction: "",
              audioPrompt: "",
              sound: "puzzle-solved",
              hint: "",
            },
          })
        }
        className={`${btn} w-full border border-dashed border-zinc-600 text-zinc-300 hover:bg-zinc-800`}
      >
        + Puzzle
      </button>
    );
  }

  const pz = item.puzzle;
  const set = (patch: Partial<PuzzleComponent>) => onChange({ puzzle: { ...pz, ...patch } });
  const others = items.filter((i) => i.puzzle && i.id !== item.id).map((i) => i.puzzle!);
  const problems = checkPuzzles(items).filter((m) => m.includes(`"${pz.id}"`) && !m.includes("used twice"));
  const idTaken = others.some((o) => o.id === pz.id);
  const sword = swordParamsFrom(pz.sword);

  return (
    <section className="flex flex-col gap-2 rounded border border-zinc-800 p-2">
      <div className="flex items-center justify-between">
        <h3 className="uppercase tracking-wider text-zinc-400">Puzzle</h3>
        <button
          onClick={() => {
            const users = others.filter((o) => o.requires === pz.id).map((o) => o.id);
            if (users.length && !window.confirm(`${users.join(", ")} require "${pz.id}". Remove it anyway? They will then be available from the start.`)) return;
            onChange({ puzzle: undefined });
          }}
          className="text-[10px] text-red-400 hover:underline"
        >
          Remove
        </button>
      </div>
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-zinc-500">ID</span>
        <input
          value={pz.id}
          onChange={(e) => {
            const v = e.target.value.toLowerCase();
            if (v === "" || isPuzzleId(v)) set({ id: v });
          }}
          className={`${field} min-w-0 flex-1 font-mono ${idTaken || !pz.id ? "outline outline-1 outline-red-500" : ""}`}
          aria-label="Puzzle ID"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-zinc-500">Trigger</span>
        <select value={pz.trigger} onChange={(e) => set({ trigger: e.target.value as PuzzleTrigger })} className={`${field} min-w-0 flex-1`} aria-label="Trigger">
          {options.map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABEL[t]}
            </option>
          ))}
          {!options.includes(pz.trigger) && <option value={pz.trigger}>{TRIGGER_LABEL[pz.trigger]} (not on this object)</option>}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-zinc-500">Requires</span>
        <select value={pz.requires ?? ""} onChange={(e) => set({ requires: e.target.value || null })} className={`${field} min-w-0 flex-1`} aria-label="Requires">
          <option value="">Nothing (available from the start)</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id} — {items.find((i) => i.puzzle?.id === o.id)?.name}
            </option>
          ))}
        </select>
      </label>
      <Instruction
        label="When solved, send to Orbis (what she does)"
        value={pz.instruction}
        onChange={(v) => set({ instruction: v })}
        hint="Empty = no command; she keeps doing what she was doing."
      />
      <label className="flex flex-col gap-1">
        <span className="text-zinc-500">Audio prompt (optional)</span>
        <input value={pz.audioPrompt} maxLength={500} onChange={(e) => set({ audioPrompt: e.target.value })} className={field} />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-zinc-500">Sound</span>
        <select value={pz.sound} onChange={(e) => set({ sound: e.target.value })} className={`${field} min-w-0 flex-1`} aria-label="Solved sound">
          <option value="">None</option>
          {SOUND_IDS.filter((id) => !["background", "gramophone", "crayon-draw"].includes(id)).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-zinc-500">Hint</span>
        <input value={pz.hint} maxLength={200} onChange={(e) => set({ hint: e.target.value })} className={field} aria-label="Hint" />
        <span className="text-[10px] text-zinc-600">Shown in the room while this is the next puzzle, and when the player tries a puzzle that needs this one.</span>
      </label>
      {pz.trigger === "draw-sword" && (
        <details>
          <summary className="cursor-pointer text-[11px] text-zinc-400">Sword recognition thresholds</summary>
          <div className="mt-2 flex flex-col gap-1">
            {SWORD_LIMITS.map((L) => (
              <label key={L.key} className="flex items-center gap-1 text-[11px]">
                <span className="w-28 shrink-0 text-zinc-500">{L.label}</span>
                <input
                  type="range"
                  min={L.min}
                  max={L.max}
                  step={L.step}
                  value={sword[L.key]}
                  onChange={(e) => set({ sword: { ...sword, [L.key]: Number(e.target.value) } })}
                  className="min-w-0 flex-1"
                  aria-label={L.label}
                />
                <span className="w-9 text-right font-mono">{sword[L.key]}</span>
              </label>
            ))}
            <button onClick={() => set({ sword: undefined })} className={`${btn} self-start bg-zinc-700`}>
              Default thresholds
            </button>
          </div>
        </details>
      )}
      {(idTaken || !pz.id) && <p className="text-[10px] text-red-400">{!pz.id ? "ID is empty." : `ID "${pz.id}" is already used by another puzzle.`}</p>}
      {problems.map((m) => (
        <p key={m} className="text-[10px] text-red-400">
          {m}
        </p>
      ))}
    </section>
  );
}

/** Channel volumes for the puzzle room (data/puzzle-style.json, merged on save). */
export function RoomAudioSettings() {
  const [mix, setMix] = useState<AudioMix | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("loading…");

  const fetchFile = async () => {
    const r = await fetch("/puzzle/api/style", { cache: "no-store" });
    return parseStyle(((await r.json()) as { style: unknown }).style);
  };
  const load = useCallback(async () => {
    try {
      setMix((await fetchFile()).mix);
      setDirty(false);
      setStatus("");
    } catch (e) {
      setStatus(`load failed: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const save = async () => {
    if (!mix) return;
    setStatus("saving…");
    try {
      const latest = await fetchFile();
      const next: PuzzleStyle = { ...latest, mix };
      const r = await fetch("/puzzle/api/style", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `HTTP ${r.status}`);
      setDirty(false);
      setStatus("saved. Refresh /puzzle to use it.");
    } catch (e) {
      setStatus(`save FAILED: ${(e as Error).message}`);
    }
  };

  if (!mix) return <p className="text-zinc-500">{status}</p>;
  const edit = (m: AudioMix) => {
    setMix(m);
    setDirty(true);
  };
  return (
    <div className="flex flex-col gap-1">
      {MIX_CHANNELS.map((c) => (
        <label key={c.key} className="flex items-center gap-1 text-[11px]">
          <span className="w-28 shrink-0 text-zinc-500">{c.label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mix[c.key]}
            onChange={(e) => edit({ ...mix, [c.key]: Number(e.target.value) })}
            className="min-w-0 flex-1"
            aria-label={`${c.label} volume`}
          />
          <span className="w-9 text-right font-mono">{mix[c.key].toFixed(2)}</span>
        </label>
      ))}
      <label className="flex items-center gap-2 text-[11px]">
        <input type="checkbox" checked={mix.backgroundBeforeSound} onChange={(e) => edit({ ...mix, backgroundBeforeSound: e.target.checked })} />
        <span>Background plays before the gramophone</span>
      </label>
      <p className="text-[10px] text-zinc-600">Recordings: data/puzzle-audio/&lt;sound id&gt;.mp3 replace the built-in sounds.</p>
      <div className="flex gap-1">
        <button onClick={() => void save()} disabled={!dirty} className={`${btn} bg-sky-700`}>
          Save audio
        </button>
        <button onClick={() => void load()} className={`${btn} bg-zinc-700`}>
          Reload
        </button>
      </div>
      {status && <p className={`text-[10px] ${/FAIL/.test(status) ? "text-red-400" : "text-zinc-400"}`}>{status}</p>}
    </div>
  );
}
