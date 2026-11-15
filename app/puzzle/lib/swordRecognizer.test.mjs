// Desktop unit tests for the sword recognizer (no browser, no Reactor).
// Run:  node --test app/puzzle/lib/swordRecognizer.test.mjs
// Node ≥ 23.6 strips the TypeScript types of the imported module natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recognizeSword, DEFAULT_SWORD_PARAMS } from "./swordRecognizer.ts";

const H = 0.42; // board height (m), same as the scene

/** Straight stroke from a to b with n samples and optional seeded jitter (m). */
function line(ax, ay, bx, by, n = 30, jitter = 0, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: ax + (bx - ax) * t + rnd() * jitter, y: ay + (by - ay) * t + rnd() * jitter });
  }
  return pts;
}
function rot(stroke, deg, cx = 0, cy = 0) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return stroke.map((p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }));
}
function circle(cx, cy, r, n = 60) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

// Vertical blade from y=-0.15 (hilt end) to y=+0.15 (tip); guard at y=-0.10.
const blade = line(0, -0.15, 0, 0.15);
const guard = line(-0.05, -0.1, 0.05, -0.1);

test("classic upright sword (blade + guard near hilt) is recognized", () => {
  const r = recognizeSword([blade, guard], H);
  assert.equal(r.isSword, true, r.reason);
  assert.ok(r.score > 0.2, `score ${r.score}`);
});

test("stroke order does not matter (guard first)", () => {
  assert.equal(recognizeSword([guard, blade], H).isSword, true);
});

test("upside-down and rotated swords are recognized", () => {
  const down = [line(0, 0.15, 0, -0.15), line(-0.05, 0.1, 0.05, 0.1)];
  assert.equal(recognizeSword(down, H).isSword, true);
  for (const deg of [30, 45, 90, 135]) {
    const r = recognizeSword([rot(blade, deg), rot(guard, deg)], H);
    assert.equal(r.isSword, true, `${deg}°: ${r.reason}`);
  }
});

test("hand jitter (~3 mm) still passes", () => {
  const r = recognizeSword([line(0, -0.15, 0, 0.15, 60, 0.003, 7), line(-0.05, -0.1, 0.05, -0.1, 20, 0.003, 9)], H);
  assert.equal(r.isSword, true, r.reason);
});

test("sparse strokes (3-sample mouse drags) keep their length", () => {
  const r = recognizeSword([line(0, -0.15, 0, 0.15, 2), line(-0.05, -0.1, 0.05, -0.1, 2)], H);
  assert.equal(r.isSword, true, r.reason);
  assert.ok(Math.abs(r.metrics.bladeLen - 0.3) < 1e-9);
});

test("extra handle / pommel strokes are tolerated", () => {
  const pommel = circle(0, -0.16, 0.01, 16);
  assert.equal(recognizeSword([blade, guard, pommel], H).isSword, true);
});

test("a single line is not a sword", () => {
  const r = recognizeSword([blade], H);
  assert.equal(r.isSword, false);
  assert.match(r.reason, /guard/);
});

test("plus sign (guard in the middle) is not a sword", () => {
  const r = recognizeSword([blade, line(-0.08, 0, 0.08, 0)], H);
  assert.equal(r.isSword, false);
  assert.match(r.reason, /near an end/);
});

test("T shape (guard at the very tip, no handle) is not a sword", () => {
  const r = recognizeSword([blade, line(-0.05, -0.15, 0.05, -0.15)], H);
  assert.equal(r.isSword, false);
});

test("X / V shapes (no perpendicular guard) are not swords", () => {
  const x = [line(-0.12, -0.12, 0.12, 0.12), line(-0.12, 0.12, 0.12, -0.12)];
  assert.equal(recognizeSword(x, H).isSword, false);
  const v = [line(-0.1, 0.15, 0, -0.15), line(0, -0.15, 0.1, 0.15)];
  assert.equal(recognizeSword(v, H).isSword, false);
});

test("guard that does not touch the blade is not a sword", () => {
  const r = recognizeSword([blade, line(0.06, -0.1, 0.14, -0.1)], H);
  assert.equal(r.isSword, false);
  assert.match(r.reason, /cross/);
});

test("circle, scribble and tiny sword are not swords", () => {
  assert.equal(recognizeSword([circle(0, 0, 0.1)], H).isSword, false);
  const zig = [];
  for (let i = 0; i <= 20; i++) zig.push({ x: -0.1 + i * 0.01, y: i % 2 ? 0.05 : -0.05 });
  assert.equal(recognizeSword([zig, guard], H).isSword, false);
  const tiny = [line(0, -0.03, 0, 0.03), line(-0.01, -0.02, 0.01, -0.02)];
  assert.equal(recognizeSword(tiny, H).isSword, false);
});

test("lots of extra doodling is rejected (clutter)", () => {
  const r = recognizeSword([blade, guard, circle(0.2, 0.1, 0.06), circle(-0.2, 0.1, 0.06)], H);
  assert.equal(r.isSword, false);
  assert.match(r.reason, /extra ink/);
});

test("thresholds are tunable", () => {
  const bent = [line(0, -0.15, 0, 0.15), line(-0.05, -0.1, 0.05, -0.04)]; // guard ~31° off perpendicular
  assert.equal(recognizeSword(bent, H).isSword, false);
  assert.equal(recognizeSword(bent, H, { ...DEFAULT_SWORD_PARAMS, angleTolDeg: 40 }).isSword, true);
});
