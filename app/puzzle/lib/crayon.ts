"use client";

import * as THREE from "three";
import type { DrawingBoard } from "./drawingBoard";
import type { Grabber } from "./handInput";

// Puzzle 2 tool: a fat wax crayon, held between thumb and index like real
// chalk. Pinch near it to pick it up; it sits in the pinch, pointing along
// the hand. While held, it draws whenever its tip (or, forgivingly, the
// pinch point itself) touches the easel canvas — no button. Let go and it
// drops back onto the easel ledge.
//
// Desktop fallback: drag with the mouse on the canvas (no crayon needed).

export type DrawMode = "none" | "contact" | "mouse";

const GRAB_R = 0.09; // pinch point to crayon centre
const TIP = 0.045; // tip ahead of the pinch point along the hand direction
const CONTACT_FRONT = 0.025; // tip up to 2.5 cm in front of the canvas …
const CONTACT_BEHIND = 0.035; // … or pushed up to 3.5 cm through it
const LOST_FRAMES = 6;

export type CrayonOptions = {
  board: DrawingBoard;
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
  onStrokeEnd: (source: string) => void;
  onHolder: (holder: string | null) => void;
  onMode: (m: DrawMode) => void;
  /** Haptic tick for controllers (no-op for hands). */
  pulse: (g: Grabber, v: number, ms: number) => void;
};

function makeCrayon(): THREE.Group {
  const g = new THREE.Group();
  g.name = "crayon";
  // Built along -Z with the tip at z = -TIP (so the group origin = pinch point).
  const wax = new THREE.MeshStandardMaterial({ color: 0x2b59c3, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.075, 16).rotateX(Math.PI / 2), wax);
  body.position.z = -0.005;
  g.add(body);
  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0085, 0.0085, 0.045, 16).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf3e9c6, roughness: 0.9 }),
  );
  wrap.position.z = 0.008;
  g.add(wrap);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.012, 16).rotateX(-Math.PI / 2), wax);
  tip.position.z = -TIP + 0.006;
  g.add(tip);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.003, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85 }),
  );
  halo.name = "halo";
  g.add(halo);
  return g;
}

const Z = new THREE.Vector3(0, 0, -1);

export class Crayon {
  readonly object: THREE.Group;
  private readonly opts: CrayonOptions;
  private holder: Grabber | null = null;
  private lost = 0;
  private mode: DrawMode = "none";
  private readonly cursor: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly tip = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(opts: CrayonOptions) {
    this.opts = opts;
    this.object = makeCrayon();
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.006, 0.011, 24),
      new THREE.MeshBasicMaterial({ color: 0x1f9d55, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    opts.board.mesh.add(this.cursor);
    this.putBack();
  }

  get holderLabel() {
    return this.holder ? this.holder.label : null;
  }

  get isHeld() {
    return this.holder !== null;
  }

  /** Pinch started: pick the crayon up if the pinch is near it. */
  tryGrab(g: Grabber): boolean {
    if (this.holder) return false;
    const c = this.object.getWorldPosition(new THREE.Vector3());
    if (g.point.distanceTo(c) > GRAB_R) return false;
    this.holder = g;
    (this.object.getObjectByName("halo") as THREE.Object3D).visible = false;
    this.opts.onHolder(g.label);
    this.opts.pulse(g, 0.4, 40);
    return true;
  }

  /** Pinch ended by this grabber: drop the crayon back on the ledge. */
  release(g: Grabber) {
    if (this.holder !== g) return;
    this.endStroke(g.label);
    this.putBack();
  }

  putBack() {
    if (this.holder) this.endStroke(this.holder.label);
    this.holder = null;
    this.object.position.copy(this.opts.restPosition);
    this.object.quaternion.copy(this.opts.restQuaternion);
    const halo = this.object.getObjectByName("halo");
    if (halo) halo.visible = true;
    this.opts.onHolder(null);
    this.setMode("none");
  }

  private endStroke(source: string) {
    const b = this.opts.board;
    if (b.drawing && b.end()) this.opts.onStrokeEnd(source);
  }

  private setMode(m: DrawMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.opts.onMode(m);
  }

  /** Mouse drawing (desktop). */
  mouseBegin(p: { x: number; y: number }) {
    this.opts.board.begin(p);
    this.setMode("mouse");
  }
  mouseMove(p: { x: number; y: number } | null) {
    if (this.mode === "mouse" && p) this.opts.board.add(p);
    this.cursor.visible = !!p && !this.holder;
    if (p) this.cursor.position.set(p.x, p.y, 0.002);
  }
  mouseEnd() {
    if (this.mode !== "mouse") return;
    this.endStroke("mouse");
    this.setMode("none");
  }

  /** Per frame (XR): follow the hand and draw on contact. */
  update(t: number) {
    const halo = this.object.getObjectByName("halo");
    if (halo?.visible) halo.scale.setScalar(1 + Math.sin(t * 0.004) * 0.15);
    const g = this.holder;
    if (!g) return;
    if (g.tracked) {
      this.object.position.copy(g.point);
      this.q.setFromUnitVectors(Z, g.dir);
      this.object.quaternion.copy(this.q);
    }
    const b = this.opts.board;
    this.tip.copy(g.point).addScaledVector(g.dir, TIP);
    const hit = this.contact(this.tip) ?? this.contact(g.point);
    this.cursor.visible = !!hit;
    if (hit) {
      this.cursor.position.set(hit.x, hit.y, 0.002);
      if (!b.drawing) {
        b.begin(hit);
        this.opts.pulse(g, 0.2, 15);
      } else b.add(hit);
      this.lost = 0;
      this.setMode("contact");
    } else if (b.drawing && ++this.lost > LOST_FRAMES) {
      this.endStroke(g.label);
      this.setMode("none");
    }
  }

  private contact(world: THREE.Vector3) {
    const r = this.opts.board.worldToBoard(world);
    return r.inside && r.z <= CONTACT_FRONT && r.z >= -CONTACT_BEHIND ? r.p : null;
  }

  /** Test hook: where the tip is relative to the canvas. */
  debugTip() {
    const g = this.holder;
    if (!g) return null;
    const tip = g.point.clone().addScaledVector(g.dir, TIP);
    return { tip: tip.toArray(), canvas: this.opts.board.worldToBoard(tip), point: this.opts.board.worldToBoard(g.point.clone()) };
  }
}
