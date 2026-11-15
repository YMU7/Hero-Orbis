// "Draw a sword" recognizer — pure geometry, no DOM / Three.js, so it runs
// (and is unit-tested) on the desktop with plain Node.
//
// Model of a sword, deliberately simple and explainable:
//
//   BLADE  one long, nearly straight stroke
//   GUARD  a shorter, nearly straight stroke, roughly perpendicular to the
//          blade, that CROSSES the blade line near ONE END of the blade
//          (leaving a short handle beyond it, so a "T" or a centred "+"
//          does not count)
//
// Anything else drawn on the board (a pommel dot, a handle line, a doodle) is
// tolerated up to `maxExtraInkRatio` × blade length.
//
// Coordinates: board-local metres (x right, y up). The recognizer only uses
// ratios and angles plus one absolute length (`minBladeFrac` × board height),
// so it works the same for mouse and controller input.

export type Pt = { x: number; y: number };
export type Stroke = Pt[];

export type SwordParams = {
  /** Blade must be at least this fraction of the board height. */
  minBladeFrac: number;
  /** chord / path length for the blade (1 = perfectly straight). */
  bladeStraightMin: number;
  /** chord / path length for the guard. */
  guardStraightMin: number;
  /** Guard length relative to blade length. */
  guardMinRatio: number;
  guardMaxRatio: number;
  /** Max deviation from 90° between blade and guard (degrees). */
  angleTolDeg: number;
  /** Guard must cross the blade between these fractions from either blade end
   *  (lower bound leaves room for a handle; upper bound keeps it near an end). */
  guardPosMin: number;
  guardPosMax: number;
  /** Where along the GUARD the crossing lies (0..1); 0.5 = centred. Allowed
   *  window is [crossMin, 1 - crossMin]. */
  crossMin: number;
  /** Extra ink beyond blade + guard, relative to blade length. */
  maxExtraInkRatio: number;
};

export const DEFAULT_SWORD_PARAMS: SwordParams = {
  minBladeFrac: 0.35,
  bladeStraightMin: 0.9,
  guardStraightMin: 0.8,
  guardMinRatio: 0.15,
  guardMaxRatio: 0.9,
  angleTolDeg: 30,
  guardPosMin: 0.04,
  guardPosMax: 0.4,
  crossMin: 0.15,
  maxExtraInkRatio: 1.0,
};

/** Slider ranges for the sword thresholds (shared by the /puzzle panel and the editor). */
export const SWORD_LIMITS: Array<{ key: keyof SwordParams; label: string; min: number; max: number; step: number }> = [
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

/** Thresholds from untrusted data: missing / bad keys → defaults, clamped. */
export function swordParamsFrom(raw: Record<string, unknown> | undefined): SwordParams {
  const out = { ...DEFAULT_SWORD_PARAMS };
  for (const L of SWORD_LIMITS) {
    const v = raw?.[L.key];
    if (typeof v === "number" && Number.isFinite(v)) out[L.key] = Math.min(L.max, Math.max(L.min, v));
  }
  return out;
}

/** Per-criterion scores in [0,1]; 1 = comfortably inside the threshold. */
export type SwordScores = {
  blade: number;
  guardShape: number;
  angle: number;
  position: number;
  crossing: number;
  clutter: number;
};

export type SwordResult = {
  isSword: boolean;
  /** Geometric mean of the component scores (0 when any criterion fails). */
  score: number;
  scores: SwordScores;
  /** Human-readable reason for the first failing criterion, or "sword". */
  reason: string;
  bladeIndex: number | null;
  guardIndex: number | null;
  /** Raw measurements for the debug panel. */
  metrics: {
    bladeLen: number;
    bladeStraight: number;
    guardLen: number;
    guardStraight: number;
    angleDeg: number;
    /** Crossing position from the nearer blade end (fraction of blade). */
    guardPos: number;
    /** Crossing position along the guard (0..1). */
    crossAt: number;
    extraInkRatio: number;
  } | null;
};

export type StrokeInfo = {
  len: number;
  chord: number;
  straight: number;
  a: Pt;
  b: Pt;
};

/** Moving-average smoothing (±`w` samples). Removes hand/controller jitter
 *  that would otherwise inflate path length and read as "not straight". */
export function smooth(s: Stroke, w = 2): Stroke {
  if (s.length < 3 || w <= 0) return s;
  return s.map((_, i) => {
    let x = 0;
    let y = 0;
    let n = 0;
    // Symmetric window that shrinks toward the ends, so endpoints stay put
    // (a 3-sample mouse drag must keep its full length).
    const r = Math.min(w, i, s.length - 1 - i);
    for (let k = i - r; k <= i + r; k++) {
      x += s[k].x;
      y += s[k].y;
      n++;
    }
    return { x: x / n, y: y / n };
  });
}

export function strokeInfo(raw: Stroke): StrokeInfo {
  const s = smooth(raw);
  let len = 0;
  for (let i = 1; i < s.length; i++) len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  const a = s[0] ?? { x: 0, y: 0 };
  const b = s[s.length - 1] ?? a;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  return { len, chord, straight: len > 0 ? chord / len : 0, a, b };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Linear margin score: 0 at the threshold, 1 at `full`. */
const above = (v: number, thr: number, full: number) => (v < thr ? 0 : full > thr ? Math.max(0.05, clamp01((v - thr) / (full - thr))) : 1);
/** 1 in the middle of [lo,hi], 0.05 at the edges, 0 outside. */
const inside = (v: number, lo: number, hi: number) => {
  if (v < lo || v > hi) return 0;
  const half = (hi - lo) / 2;
  if (half <= 0) return 1;
  return Math.max(0.05, clamp01(1 - Math.abs(v - (lo + half)) / half) * 0.95 + 0.05);
};

const ZERO: SwordScores = { blade: 0, guardShape: 0, angle: 0, position: 0, crossing: 0, clutter: 0 };

/** Recognize a sword among `strokes` drawn on a board `boardHeight` metres tall. */
export function recognizeSword(
  strokes: ReadonlyArray<Stroke>,
  boardHeight: number,
  p: SwordParams = DEFAULT_SWORD_PARAMS,
): SwordResult {
  const infos = strokes.map(strokeInfo);
  const fail = (reason: string, partial?: Partial<SwordResult>): SwordResult => ({
    isSword: false,
    score: 0,
    scores: { ...ZERO, ...(partial?.scores ?? {}) },
    reason,
    bladeIndex: partial?.bladeIndex ?? null,
    guardIndex: partial?.guardIndex ?? null,
    metrics: partial?.metrics ?? null,
  });
  if (infos.length === 0) return fail("nothing drawn");

  const minBlade = p.minBladeFrac * boardHeight;
  const totalInk = infos.reduce((s, i) => s + i.len, 0);

  // Try every (blade, guard) pair and keep the best-scoring one, so stroke
  // order and extra doodles don't matter.
  let best: SwordResult | null = null;
  let bestPartial: SwordResult | null = null;
  const better = (r: SwordResult, cur: SwordResult | null) => {
    if (!cur) return true;
    const sum = (s: SwordScores) => Object.values(s).reduce((a, b) => a + b, 0);
    return sum(r.scores) > sum(cur.scores);
  };

  for (let bi = 0; bi < infos.length; bi++) {
    const B = infos[bi];
    const bladeScore = Math.min(
      above(B.straight, p.bladeStraightMin, Math.min(1, p.bladeStraightMin + 0.08)),
      above(B.chord, minBlade, minBlade * 1.6),
    );
    if (bladeScore === 0) {
      const r = fail(B.chord < minBlade ? "blade too short" : "blade not straight", { bladeIndex: bi });
      if (!bestPartial) bestPartial = r;
      continue;
    }
    if (infos.length === 1) {
      const r = fail("no guard (cross-piece) yet", { scores: { ...ZERO, blade: bladeScore }, bladeIndex: bi });
      if (better(r, bestPartial)) bestPartial = r;
      continue;
    }

    const bx = B.b.x - B.a.x;
    const by = B.b.y - B.a.y;
    for (let gi = 0; gi < infos.length; gi++) {
      if (gi === bi) continue;
      const G = infos[gi];
      const gx = G.b.x - G.a.x;
      const gy = G.b.y - G.a.y;
      const ratio = G.chord / B.chord;
      const guardShape = Math.min(
        above(G.straight, p.guardStraightMin, Math.min(1, p.guardStraightMin + 0.1)),
        inside(ratio, p.guardMinRatio, p.guardMaxRatio),
      );

      // Angle between the two chord directions, folded into [0°, 90°].
      const cos = Math.abs(bx * gx + by * gy) / (B.chord * G.chord || 1);
      const angleDeg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
      const angle = angleDeg >= 90 - p.angleTolDeg ? Math.max(0.05, clamp01((angleDeg - (90 - p.angleTolDeg)) / p.angleTolDeg)) : 0;

      // Line–line intersection: blade A + t·(bx,by), guard A + s·(gx,gy).
      const den = bx * gy - by * gx;
      let t = NaN;
      let s = NaN;
      if (Math.abs(den) > 1e-12) {
        const dx = G.a.x - B.a.x;
        const dy = G.a.y - B.a.y;
        t = (dx * gy - dy * gx) / den;
        s = (dx * by - dy * bx) / den;
      }
      const guardPos = Number.isFinite(t) ? Math.min(t, 1 - t) : -1;
      const position = inside(guardPos, p.guardPosMin, p.guardPosMax);
      const crossing = Number.isFinite(s) ? inside(s, p.crossMin, 1 - p.crossMin) : 0;

      const extraInkRatio = (totalInk - B.len - G.len) / B.len;
      const clutter = extraInkRatio <= p.maxExtraInkRatio ? Math.max(0.05, 1 - extraInkRatio / Math.max(p.maxExtraInkRatio, 1e-6)) : 0;

      const scores: SwordScores = { blade: bladeScore, guardShape, angle, position, crossing, clutter };
      const metrics = {
        bladeLen: B.chord,
        bladeStraight: B.straight,
        guardLen: G.chord,
        guardStraight: G.straight,
        angleDeg,
        guardPos,
        crossAt: s,
        extraInkRatio,
      };
      const vals = Object.values(scores);
      const ok = vals.every((v) => v > 0);
      const r: SwordResult = ok
        ? {
            isSword: true,
            score: Math.pow(vals.reduce((a, b) => a * b, 1), 1 / vals.length),
            scores,
            reason: "sword",
            bladeIndex: bi,
            guardIndex: gi,
            metrics,
          }
        : fail(
            guardShape === 0
              ? G.straight < p.guardStraightMin
                ? "guard not straight"
                : "guard length off (vs blade)"
              : angle === 0
                ? "guard not perpendicular"
                : position === 0
                  ? guardPos < p.guardPosMin
                    ? "guard at the very tip (no handle)"
                    : "guard not near an end of the blade"
                  : crossing === 0
                    ? "guard does not cross the blade"
                    : "too much extra ink",
            { scores, bladeIndex: bi, guardIndex: gi, metrics },
          );
      if (r.isSword) {
        if (!best || r.score > best.score) best = r;
      } else if (better(r, bestPartial)) {
        bestPartial = r;
      }
    }
  }
  return best ?? bestPartial ?? fail("no straight stroke long enough for a blade");
}
