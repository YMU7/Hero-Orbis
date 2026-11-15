"use client";

import * as THREE from "three";
import { ControllerGauntlet, HandGauntlet } from "./articulatedHand";

// Hand-gesture input for the puzzle room (Meta Quest 3 hand tracking).
//
// Each of the two XR input slots becomes a "grabber" with, every frame:
//   point   – where a pinch holds things (midpoint of thumb tip + index tip)
//   dir     – which way a held crayon points (wrist → index tip)
//   poke    – index fingertip, for pressing buttons
//   pinching– between selectstart and selectend
//
// Optical pinches use joint-distance hysteresis (25 mm close, 45 mm open).
// Tracking recovery requires an open hand. Controllers use WebXR events.
// On Quest a thumb–index
// pinch is the primary action of a `generic-hand` input (Meta docs:
// webxr-hands), and IWER emulates the same. Joint poses come from three's
// renderer.xr.getHand(i). Controllers still work as a fallback: trigger OR
// grip counts as a pinch, the point sits just in front of the grip.
//
// Hands and controllers both show knight gauntlets generated in code (no
// downloads): tracked hands drive every joint, controllers pose the fingers
// from trigger / squeeze / thumb touch (see articulatedHand.ts).

export type GrabberKind = "hand" | "controller" | "none";

export type Grabber = {
  index: number;
  kind: GrabberKind;
  source: XRInputSource | null;
  pinching: boolean;
  point: THREE.Vector3;
  dir: THREE.Vector3;
  rotation: THREE.Quaternion;
  poke: THREE.Vector3;
  /** True when the pose above was updated this frame. */
  tracked: boolean;
  label: string;
};

type Slot = {
  g: Grabber;
  /** Visible pointer ray (controllers only). */
  line: THREE.Line;
  ray: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  hand: THREE.XRHandSpace;
  visual: HandGauntlet;
  ctrlVisual: ControllerGauntlet;
  mustOpen: boolean;
  squeezing: boolean;
  selecting: boolean;
};

export type HandInputOptions = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Object3D;
  onPinchStart: (g: Grabber) => void;
  onPinchEnd: (g: Grabber) => void;
  onInputInfo?: (sources: string[]) => void;
};

const RAY_LEN = 4;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

export class HandInput {
  readonly grabbers: Grabber[] = [];
  private readonly slots: Slot[] = [];
  private readonly opts: HandInputOptions;
  private readonly cleanups: Array<() => void> = [];
  private lastUpdate = 0;

  constructor(opts: HandInputOptions) {
    this.opts = opts;
    for (let i = 0; i < 2; i++) this.setup(i);
  }

  private setup(index: number) {
    const { renderer, scene } = this.opts;
    const ray = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);
    const hand = renderer.xr.getHand(index);
    const visual = new HandGauntlet(hand);
    const ctrlVisual = new ControllerGauntlet(grip);
    scene.add(ray, grip, hand);

    const g: Grabber = {
      index,
      kind: "none",
      source: null,
      pinching: false,
      point: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      rotation: new THREE.Quaternion(),
      poke: new THREE.Vector3(),
      tracked: false,
      label: `input ${index}`,
    };
    // Controller pointer ray (Phase E): trigger on RESET / CLEAR / gramophone
    // from a distance. Hidden for hands (they pinch and poke instead).
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xfff3c4 }),
    );
    line.scale.z = RAY_LEN;
    line.visible = false;
    ray.add(line);
    const slot: Slot = { g, line, ray, grip, hand, visual, ctrlVisual, mustOpen: true, squeezing: false, selecting: false };
    this.grabbers.push(g);
    this.slots.push(slot);

    const setPinch = () => {
      if (g.kind === "hand") return;
      const now = slot.selecting || slot.squeezing;
      if (now === g.pinching) return;
      g.pinching = now;
      this.updateSlot(slot); // fresh pose for the edge
      if (now) this.opts.onPinchStart(g);
      else this.opts.onPinchEnd(g);
    };
    const onConnected = (e: { data: XRInputSource }) => {
      g.source = e.data;
      g.kind = e.data.hand ? "hand" : e.data.targetRayMode === "tracked-pointer" ? "controller" : "none";
      g.label = `${e.data.handedness} ${g.kind}`;
      slot.line.visible = g.kind === "controller";
      this.report();
    };
    const onDisconnected = () => {
      g.tracked = false;
      if (g.pinching) { g.pinching = false; this.opts.onPinchEnd(g); }
      slot.mustOpen = true;
      slot.selecting = slot.squeezing = false;
      setPinch();
      g.source = null;
      g.kind = "none";
      g.tracked = false;
      slot.line.visible = false;
      this.report();
    };
    const onSelStart = () => {
      slot.selecting = true;
      setPinch();
    };
    const onSelEnd = () => {
      slot.selecting = false;
      setPinch();
    };
    const onSqStart = () => {
      slot.squeezing = true;
      setPinch();
    };
    const onSqEnd = () => {
      slot.squeezing = false;
      setPinch();
    };
    const c = ray as unknown as THREE.EventDispatcher<{
      connected: { data: XRInputSource };
      disconnected: object;
      selectstart: object;
      selectend: object;
      squeezestart: object;
      squeezeend: object;
    }>;
    c.addEventListener("connected", onConnected);
    c.addEventListener("disconnected", onDisconnected);
    c.addEventListener("selectstart", onSelStart);
    c.addEventListener("selectend", onSelEnd);
    c.addEventListener("squeezestart", onSqStart);
    c.addEventListener("squeezeend", onSqEnd);
    this.cleanups.push(() => {
      c.removeEventListener("connected", onConnected);
      c.removeEventListener("disconnected", onDisconnected);
      c.removeEventListener("selectstart", onSelStart);
      c.removeEventListener("selectend", onSelEnd);
      c.removeEventListener("squeezestart", onSqStart);
      c.removeEventListener("squeezeend", onSqEnd);
      visual.dispose();
      ctrlVisual.dispose();
      line.geometry.dispose(); (line.material as THREE.Material).dispose();
      scene.remove(ray, grip, hand);
    });
  }

  private updateSlot(s: Slot) {
    const g = s.g;
    g.tracked = false;
    if (g.kind === "hand") {
      const j = (s.hand as unknown as { joints: Record<string, THREE.Object3D & { visible: boolean }> }).joints;
      const thumb = j["thumb-tip"];
      const index = j["index-finger-tip"];
      const wrist = j["wrist"];
      if (!s.hand.visible || !thumb || !index || !wrist || !thumb.visible || !index.visible || !wrist.visible) return;
      thumb.getWorldPosition(tmpA);
      index.getWorldPosition(tmpB);
      g.point.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      g.poke.copy(tmpB);
      wrist.getWorldPosition(tmpA);
      g.dir.copy(tmpB).sub(tmpA);
      if (g.dir.lengthSq() < 1e-8) g.dir.set(0, 0, -1);
      g.dir.normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(wrist.getWorldQuaternion(new THREE.Quaternion()));
      tmpM.lookAt(new THREE.Vector3(), g.dir, up);
      g.rotation.setFromRotationMatrix(tmpM);
      g.tracked = true;
    } else if (g.kind === "controller") {
      const space = s.grip.visible ? s.grip : s.ray;
      if (!space.visible) return;
      tmpM.identity().extractRotation(space.matrixWorld);
      g.dir.set(0, 0, -1).applyMatrix4(tmpM).normalize();
      g.point.setFromMatrixPosition(space.matrixWorld).addScaledVector(g.dir, 0.05);
      g.poke.copy(g.point).addScaledVector(g.dir, 0.03);
      space.getWorldQuaternion(g.rotation);
      g.tracked = true;
    }
  }

  /** Per frame, before interaction logic. */
  update() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = this.lastUpdate ? Math.min((now - this.lastUpdate) / 1000, 0.1) : 1 / 72;
    this.lastUpdate = now;
    for (const s of this.slots) {
      this.updateSlot(s);
      const g = s.g;
      if (!g.tracked) {
        if (g.pinching) { g.pinching = false; this.opts.onPinchEnd(g); }
        s.mustOpen = true;
        s.visual.update(false, false);
        s.ctrlVisual.update(null, false, false, dt);
        continue;
      }
      s.visual.update(g.kind === "hand", g.pinching, dt);
      s.ctrlVisual.update(g.source, g.kind === "controller" && s.grip.visible, g.pinching, dt);
      if (g.kind === "hand") {
        const joints = s.hand.joints;
        const a = joints["thumb-tip"]!.getWorldPosition(new THREE.Vector3());
        const b = joints["index-finger-tip"]!.getWorldPosition(new THREE.Vector3());
        const distance = a.distanceTo(b);
        if (distance > 0.045) s.mustOpen = false;
        const pinching = !s.mustOpen && distance < (g.pinching ? 0.045 : 0.025);
        if (pinching !== g.pinching) {
          g.pinching = pinching;
          if (pinching) this.opts.onPinchStart(g); else this.opts.onPinchEnd(g);
        }
      }
    }
  }

  /** World-space pointer ray of a controller (null for hands / untracked). */
  pointerRay(g: Grabber): THREE.Ray | null {
    const s = this.slots[g.index];
    if (!s || g.kind !== "controller" || !s.ray.visible) return null;
    const r = new THREE.Ray();
    r.origin.setFromMatrixPosition(s.ray.matrixWorld);
    tmpM.identity().extractRotation(s.ray.matrixWorld);
    r.direction.set(0, 0, -1).applyMatrix4(tmpM).normalize();
    return r;
  }

  /** Shorten a controller's visible ray to a hit distance (null = full). */
  setRayLength(g: Grabber, d: number | null) {
    const s = this.slots[g.index];
    if (s) s.line.scale.z = d ?? RAY_LEN;
  }

  pulse(g: Grabber, v: number, ms: number) {
    const act = (g.source?.gamepad as
      | (Gamepad & { hapticActuators?: Array<{ pulse?: (v: number, ms: number) => Promise<boolean> }> })
      | undefined)?.hapticActuators?.[0];
    void act?.pulse?.(v, ms)?.catch?.(() => undefined);
  }

  private report() {
    const list = this.grabbers
      .filter((g) => g.source)
      .map((g) => `#${g.index} ${g.source!.handedness} ${g.kind} [${g.source!.profiles.join(", ")}]`);
    this.opts.onInputInfo?.(list);
  }

  /** Test hook. */
  debug() {
    return this.grabbers.map((g) => ({
      index: g.index,
      kind: g.kind,
      label: g.label,
      pinching: g.pinching,
      tracked: g.tracked,
      point: g.point.toArray(),
      dir: g.dir.toArray(),
      poke: g.poke.toArray(),
    }));
  }

  releaseAll() {
    for (const s of this.slots) {
      s.g.tracked = false;
      if (s.g.pinching) { s.g.pinching = false; this.opts.onPinchEnd(s.g); }
      s.g.tracked = false; s.mustOpen = true; s.selecting = s.squeezing = false;
      s.visual.update(false, false);
      s.ctrlVisual.update(null, false, false);
    }
  }

  dispose() {
    this.releaseAll();
    this.cleanups.forEach((f) => f());
    this.cleanups.length = 0;
  }
}
