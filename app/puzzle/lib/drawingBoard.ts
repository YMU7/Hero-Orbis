"use client";

import * as THREE from "three";
import type { Pt, Stroke } from "./swordRecognizer";

// The easel canvas drawing surface: a plane whose texture is a 2D canvas the
// strokes are painted into. Strokes are stored in board-local metres
// (x right, y up, origin at the board centre) — the recognizer's input.
//
// Painting into a CanvasTexture (instead of THREE.Line) gives thick, visible
// ink in VR, where WebGL line width is always 1 px.

const PX_PER_M = 1600;
const MIN_STEP_M = 0.0001; // Unity easel: the first small visible mark earns the reward

export type InkColour = "ink" | "wrong" | "right";
const COLOURS: Record<InkColour, string> = { ink: "#2b59c3", wrong: "#d8322a", right: "#1f9d55" };

export class DrawingBoard {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  readonly width: number;
  readonly height: number;
  readonly strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly tex: THREE.CanvasTexture;
  private colour: InkColour = "ink";
  private dirty = true;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(width * PX_PER_M);
    this.canvas.height = Math.round(height * PX_PER_M);
    this.ctx = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.95 }),
    );
    this.mesh.name = "drawing-board";
    this.repaint();
  }

  /** Board-local point from a world-space point (z = distance in front, +). */
  worldToBoard(world: THREE.Vector3): { p: Pt; z: number; inside: boolean } {
    const v = this.mesh.worldToLocal(world.clone());
    const inside = Math.abs(v.x) <= this.width / 2 && Math.abs(v.y) <= this.height / 2;
    return { p: { x: v.x, y: v.y }, z: v.z, inside };
  }

  /** Board-local point from a raycast hit's uv. */
  uvToBoard(uv: THREE.Vector2): Pt {
    return { x: (uv.x - 0.5) * this.width, y: (uv.y - 0.5) * this.height };
  }

  /** World position of a board-local point (for test scripts / cursor). */
  boardToWorld(p: Pt, z = 0): THREE.Vector3 {
    return this.mesh.localToWorld(new THREE.Vector3(p.x, p.y, z));
  }

  get drawing() {
    return this.current !== null;
  }

  begin(p: Pt) {
    this.colour = "ink";
    this.current = [p];
    this.strokes.push(this.current);
    this.dirty = true;
  }

  add(p: Pt) {
    if (!this.current) return this.begin(p);
    const last = this.current[this.current.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP_M) return;
    this.current.push(p);
    this.paintSegment(last, p);
  }

  /** Ends the stroke; returns false (and drops it) if it was just a dot. */
  end(): boolean {
    const s = this.current;
    this.current = null;
    if (!s) return false;
    if (s.length < 2) {
      this.strokes.pop();
      this.dirty = true;
      return false;
    }
    return true;
  }

  clear() {
    this.strokes.length = 0;
    this.current = null;
    this.colour = "ink";
    this.dirty = true;
  }

  setColour(c: InkColour) {
    if (c === this.colour) return;
    this.colour = c;
    this.dirty = true;
  }

  /** Call once per frame. */
  update() {
    if (this.dirty) this.repaint();
  }

  private toPx(p: Pt) {
    return { x: (p.x / this.width + 0.5) * this.canvas.width, y: (0.5 - p.y / this.height) * this.canvas.height };
  }

  private paintSegment(a: Pt, b: Pt) {
    const ctx = this.ctx;
    if (!ctx) return;
    const pa = this.toPx(a);
    const pb = this.toPx(b);
    ctx.strokeStyle = COLOURS[this.colour];
    ctx.lineWidth = 20;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    this.tex.needsUpdate = true;
  }

  private repaint() {
    this.dirty = false;
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    // Primed linen canvas background.
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, "#fbf8f0");
    g.addColorStop(1, "#e9e1cf");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(150,130,100,0.35)";
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = "rgba(90,60,25,0.35)";
    ctx.font = "italic 34px serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("draw here", w - 36, h - 30);
    // Strokes.
    ctx.strokeStyle = COLOURS[this.colour];
    ctx.lineWidth = 20;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of this.strokes) {
      if (s.length < 2) continue;
      ctx.beginPath();
      const p0 = this.toPx(s[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < s.length; i++) {
        const p = this.toPx(s[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
