"use client";

import * as THREE from "three";
import { mat } from "./furniture";

// Puzzle 1: a gramophone with a spinning record. The tonearm rests beside
// the record; pinch its head, swing it over the record and let go — the
// needle drops and the room gets sound. Swing it off again → silence.
//
// Geometry (gramophone-local, metres; +Y up, record centred at origin):
//   pivot at (PIVOT_X, top, PIVOT_Z); arm of length ARM_L; head position
//   head(φ) = pivot + ARM_L · (−cos φ, 0, sin φ)
//   playing  ⇔ head lies over the grooves: RECORD_IN ≤ |head| ≤ RECORD_OUT

const PIVOT_X = 0.15;
const PIVOT_Z = -0.13;
const ARM_L = 0.2;
const RECORD_R = 0.12;
const RECORD_IN = 0.05;
const RECORD_OUT = 0.115;
const PHI_MIN = (-30 * Math.PI) / 180;
const PHI_MAX = (38 * Math.PI) / 180;
const PHI_REST = (-25 * Math.PI) / 180;
const PHI_PLAY = (20 * Math.PI) / 180;
const GRAB_R = 0.09;
const SPIN = (33.3 / 60) * Math.PI * 2; // rad/s

export class Gramophone {
  readonly group = new THREE.Group();
  /** Click target for the desktop fallback. */
  readonly clickTarget: THREE.Object3D;
  private readonly platter = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly head = new THREE.Object3D();
  private readonly glow: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly top: number;
  private phi = PHI_REST;
  private held: { grabOffset: number } | null = null;
  private needleDown = false;
  private readonly onSound: (on: boolean) => void;

  constructor(onSound: (on: boolean) => void) {
    this.onSound = onSound;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a3e1d, roughness: 0.6 });
    const brass = mat("gold"); // Phase C: shared warm gold

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.36), wood);
    base.position.y = 0.06;
    this.group.add(base);
    this.top = 0.12;
    this.clickTarget = base;

    // Spinning platter + record + label.
    this.platter.position.y = this.top + 0.008;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 48), brass);
    this.platter.add(plate);
    const record = new THREE.Mesh(
      new THREE.CylinderGeometry(RECORD_R, RECORD_R, 0.004, 64),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.25, metalness: 0.2 }),
    );
    record.position.y = 0.008;
    this.platter.add(record);
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.005, 32),
      new THREE.MeshStandardMaterial({ color: 0xc0392b }),
    );
    label.position.y = 0.009;
    this.platter.add(label);
    // A light stripe so the spin is visible.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: 0xf5e6a8 }));
    stripe.position.set(0.075, 0.009, 0);
    this.platter.add(stripe);
    this.group.add(this.platter);

    // Horn (brass flare on a neck) at the back-left.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.22, 16), brass);
    neck.position.set(-0.13, this.top + 0.11, -0.13);
    this.group.add(neck);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.34, 32, 1, true), mat("goldDS"));
    horn.position.set(-0.13, this.top + 0.36, -0.03);
    horn.rotation.x = -Math.PI * 0.62; // apex back-down to the neck, mouth toward the room (+Z, slightly up)
    this.group.add(horn);

    // Tonearm on its pivot.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.05, 16), brass);
    post.position.set(PIVOT_X, this.top + 0.025, PIVOT_Z);
    this.group.add(post);
    this.arm.position.set(PIVOT_X, this.top + 0.045, PIVOT_Z);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(ARM_L, 0.012, 0.016), brass);
    bar.position.x = -ARM_L / 2;
    this.arm.add(bar);
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5 }));
    headMesh.position.set(-ARM_L, -0.008, 0);
    this.arm.add(headMesh);
    this.head.position.set(-ARM_L, -0.02, 0);
    this.arm.add(this.head);
    this.glow = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85 }));
    this.glow.rotation.x = Math.PI / 2;
    this.glow.position.set(-ARM_L, 0.01, 0);
    this.arm.add(this.glow);
    this.group.add(this.arm);
    this.applyPhi();
  }

  get playing() {
    return this.needleDown;
  }

  get isHeld() {
    return this.held !== null;
  }

  headWorld(out = new THREE.Vector3()) {
    return this.head.getWorldPosition(out);
  }

  /** Pinch started at `point` (world). Returns true if it grabbed the arm. */
  tryGrab(point: THREE.Vector3): boolean {
    if (this.held) return false;
    if (point.distanceTo(this.headWorld()) > GRAB_R) return false;
    this.held = { grabOffset: this.phiFor(point) - this.phi };
    this.setNeedle(false); // lifting the arm stops the music
    return true;
  }

  /** While held: follow the pinch point. */
  drag(point: THREE.Vector3) {
    if (!this.held) return;
    this.phi = THREE.MathUtils.clamp(this.phiFor(point) - this.held.grabOffset, PHI_MIN, PHI_MAX);
    this.applyPhi();
  }

  release() {
    if (!this.held) return;
    this.held = null;
    this.setNeedle(this.overGrooves());
  }

  /** Desktop fallback: toggle between rest and playing. */
  toggle() {
    this.phi = this.needleDown ? PHI_REST : PHI_PLAY;
    this.applyPhi();
    this.setNeedle(!this.needleDown && this.overGrooves());
  }

  /** Back to the rest position, silent (Reset puzzle). */
  reset() {
    this.held = null;
    this.phi = PHI_REST;
    this.applyPhi();
    this.setNeedle(false);
  }

  /** Test hook: world position of the arm head at angle `deg`. */
  headWorldAt(deg: number) {
    const keep = this.phi;
    this.phi = THREE.MathUtils.degToRad(deg);
    this.applyPhi();
    this.group.updateMatrixWorld(true);
    const p = this.headWorld().toArray();
    this.phi = keep;
    this.applyPhi();
    this.group.updateMatrixWorld(true);
    return p;
  }

  update(dt: number, t: number) {
    this.platter.rotation.y -= SPIN * dt;
    this.glow.visible = !this.needleDown && !this.held;
    if (this.glow.visible) this.glow.scale.setScalar(1 + Math.sin(t * 0.004) * 0.15);
    // Needle drops a few mm when playing.
    this.arm.position.y = this.top + (this.needleDown ? 0.037 : 0.05);
  }

  private overGrooves() {
    const hx = PIVOT_X - ARM_L * Math.cos(this.phi);
    const hz = PIVOT_Z + ARM_L * Math.sin(this.phi);
    const r = Math.hypot(hx, hz);
    return r >= RECORD_IN && r <= RECORD_OUT;
  }

  private phiFor(world: THREE.Vector3) {
    const local = this.group.worldToLocal(world.clone());
    const vx = local.x - PIVOT_X;
    const vz = local.z - PIVOT_Z;
    return Math.atan2(vz, -vx);
  }

  private applyPhi() {
    this.arm.rotation.y = this.phi;
  }

  private setNeedle(down: boolean) {
    if (down === this.needleDown) return;
    this.needleDown = down;
    this.onSound(down);
  }
}
