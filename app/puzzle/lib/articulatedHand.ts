import * as THREE from "three";
import { assignEnvMaps, lookQuality } from "./lookdev";

// Knight gauntlets, generated in code (no asset downloads).
//
// A Gauntlet draws from 25 joint poses in the WebXR hand-joint order, given
// in its parent's local space. Per joint, -Z points along the bone toward the
// fingertip and +Y points out of the back of the hand (WebXR Hand Input
// convention). There are two pose sources:
//   HandGauntlet       – optical hand tracking (every joint tracked)
//   ControllerGauntlet – a hand skeleton posed from the controller's own
//                        sensors: trigger → index finger, squeeze → the other
//                        three, thumb touch on stick/buttons → thumb.
//
// Look: a steel lame on each finger segment (pointed on the last segment),
// four overlapping plates across the back of the hand, a flared steel cuff,
// brass knuckle studs, and dark leather underneath.
// Cost: 8 small draw calls per visible gauntlet, all instanced.

export const JOINTS = [
  "wrist",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  ...["index", "middle", "ring", "pinky"].flatMap((f) => [
    `${f}-finger-metacarpal`, `${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`, `${f}-finger-tip`,
  ]),
] as XRHandJoint[];

const FINGER_BASES = [5, 10, 15, 20];
// Steel lames: [from joint, to joint]. Tip lames are pointed.
const PLATES: Array<[number, number]> = [[1, 2], [2, 3], ...FINGER_BASES.flatMap((k): Array<[number, number]> => [[k + 1, k + 2], [k + 2, k + 3]])];
const TIPS: Array<[number, number]> = [[3, 4], ...FINGER_BASES.map((k): [number, number] => [k + 3, k + 4])];
// Leather underglove: joint spheres + segment tubes.
const LEATHER_JOINTS = [1, 2, 3, ...FINGER_BASES.flatMap((k) => [k + 1, k + 2, k + 3])];
const LEATHER_BONES: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], ...FINGER_BASES.flatMap((k): Array<[number, number]> => [[k + 1, k + 2], [k + 2, k + 3], [k + 3, k + 4]])];
// Brass studs: big ones on the knuckles, small ones on the middle joints.
const STUDS: Array<[number, number]> = [[2, 0.8], ...FINGER_BASES.flatMap((k): Array<[number, number]> => [[k + 1, 1], [k + 2, 0.7]])];
const LAMES = 4;

// ── Shared geometry (built once, ref-counted) ──────────────────────────────

/** Arched plate cross-section (in XY, +Y = back of hand), extruded along -Z
 *  from 0 to -1, scaled from `s0` to `s1` along its length. `drop` bends the
 *  far end toward the palm (pointed fingertips). */
function plateGeometry(o: { arc0: number; arc1: number; thick: number; ridge: number; s0: number; s1: number; pow?: number; drop?: number; ring?: boolean }) {
  const outer = (a: number) => 1 + o.ridge * Math.max(0, 1 - Math.abs(a - Math.PI / 2) / 0.45);
  const shape = new THREE.Shape();
  const n = 18;
  if (o.ring) {
    shape.absarc(0, 0, 1, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 1 - o.thick, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  } else {
    for (let i = 0; i <= n; i++) {
      const a = o.arc0 + ((o.arc1 - o.arc0) * i) / n, r = outer(a);
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = n; i >= 0; i--) {
      const a = o.arc0 + ((o.arc1 - o.arc0) * i) / n, r = 1 - o.thick;
      shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 6, bevelEnabled: false, curveSegments: 24 });
  geo.rotateY(Math.PI); // extrude now runs 0 → -1 along Z (shape is X-symmetric)
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp(-p.getZ(i), 0, 1);
    const s = THREE.MathUtils.lerp(o.s0, o.s1, Math.pow(t, o.pow ?? 1));
    p.setXY(i, p.getX(i) * s, p.getY(i) * s - (o.drop ?? 0) * t * t);
  }
  geo.computeVertexNormals();
  return geo;
}

type Shared = { plate: THREE.BufferGeometry; tip: THREE.BufferGeometry; lame: THREE.BufferGeometry; cuff: THREE.BufferGeometry; sphere: THREE.BufferGeometry; tube: THREE.BufferGeometry; stud: THREE.BufferGeometry };
let shared: Shared | null = null;
let sharedUsers = 0;
function acquire(): Shared {
  sharedUsers++;
  if (!shared) {
    const rad = THREE.MathUtils.degToRad;
    shared = {
      plate: plateGeometry({ arc0: rad(-28), arc1: rad(208), thick: 0.16, ridge: 0.16, s0: 1.08, s1: 0.94 }),
      tip: plateGeometry({ arc0: rad(-28), arc1: rad(208), thick: 0.16, ridge: 0.14, s0: 1.0, s1: 0.18, pow: 1.6, drop: 0.45 }),
      lame: plateGeometry({ arc0: rad(22), arc1: rad(158), thick: 0.14, ridge: 0.05, s0: 1.0, s1: 0.97 }),
      cuff: plateGeometry({ arc0: 0, arc1: 0, thick: 0.07, ridge: 0, s0: 1.0, s1: 1.3, pow: 1.4, ring: true }),
      sphere: new THREE.SphereGeometry(1, 10, 8),
      tube: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
      stud: new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    };
  }
  return shared;
}
function release() {
  if (--sharedUsers > 0 || !shared) return;
  Object.values(shared).forEach((g) => g.dispose());
  shared = null;
}

// ── Renderer ───────────────────────────────────────────────────────────────

const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tX = new THREE.Vector3(), tY = new THREE.Vector3(), tZ = new THREE.Vector3(), tS = new THREE.Vector3();
const tM = new THREE.Matrix4();

export class Gauntlet {
  readonly group = new THREE.Group();
  /** Joint poses in the parent's local space, written by the pose source. */
  readonly P = JOINTS.map(() => new THREE.Vector3());
  readonly Q = JOINTS.map(() => new THREE.Quaternion());
  readonly R = JOINTS.map(() => 0.008);
  readonly V = JOINTS.map(() => false);
  private steel = new THREE.MeshStandardMaterial({ color: 0xc4cad3, metalness: 0.85, roughness: 0.3 });
  private brass = new THREE.MeshStandardMaterial({ color: 0xc89a3e, metalness: 0.9, roughness: 0.34, emissive: 0x000000 });
  private leather = new THREE.MeshStandardMaterial({ color: 0x3b2a20, metalness: 0, roughness: 0.85 });
  private g = acquire();
  private plates = this.inst(this.g.plate, this.steel, PLATES.length);
  private tips = this.inst(this.g.tip, this.steel, TIPS.length);
  private lames = this.inst(this.g.lame, this.steel, LAMES);
  private cuff = this.inst(this.g.cuff, this.steel, 2);
  private studs = this.inst(this.g.stud, this.brass, STUDS.length);
  private knots = this.inst(this.g.sphere, this.leather, LEATHER_JOINTS.length);
  private tubes = this.inst(this.g.tube, this.leather, LEATHER_BONES.length);
  private palm = new THREE.Mesh(this.g.sphere, this.leather);
  private glow = 0;

  constructor(parent: THREE.Object3D) {
    this.group.add(this.palm);
    this.group.visible = false;
    parent.add(this.group);
    assignEnvMaps(this.group);
    // Without any environment map polished metal renders near-black.
    if (lookQuality() === "low") { this.steel.metalness = 0.45; this.brass.metalness = 0.5; }
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(m);
    return m;
  }

  /** Writes a segment basis: origin `a`, local -Z toward `b`, +Y toward the
   *  back of the hand (from joint `up`'s orientation). Returns the length. */
  private basis(a: THREE.Vector3, b: THREE.Vector3, up: THREE.Quaternion) {
    tZ.subVectors(a, b);
    const len = tZ.length();
    if (len < 1e-5) return 0;
    tZ.multiplyScalar(1 / len);
    tY.set(0, 1, 0).applyQuaternion(up);
    tY.addScaledVector(tZ, -tY.dot(tZ));
    if (tY.lengthSq() < 1e-8) tY.set(0, 1, 0).addScaledVector(tZ, -tZ.y);
    tY.normalize();
    tX.crossVectors(tY, tZ);
    return len;
  }

  private segments(mesh: THREE.InstancedMesh, list: Array<[number, number]>, rMul: number, back: number, lenMul: number) {
    let n = 0;
    for (const [a, b] of list) {
      if (!this.V[a] || !this.V[b]) continue;
      const len = this.basis(this.P[a], this.P[b], this.Q[a]);
      if (!len) continue;
      const r = THREE.MathUtils.clamp(this.R[a], 0.005, 0.013) * rMul;
      tA.copy(this.P[a]).addScaledVector(tZ, back * len);
      tM.makeBasis(tX, tY, tZ).scale(tS.set(r, r, len * lenMul)).setPosition(tA);
      mesh.setMatrixAt(n++, tM);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Draw from the current poses. `dt` is only used to ease the pinch glow. */
  render(visible: boolean, pinching: boolean, dt = 1 / 72) {
    this.group.visible = visible;
    if (!visible) return;
    this.glow += ((pinching ? 1 : 0) - this.glow) * (1 - Math.exp(-dt * 18));
    this.brass.emissive.setRGB(0.55 * this.glow, 0.32 * this.glow, 0.06 * this.glow);

    this.segments(this.plates, PLATES, 1.32, 0.06, 1.0);
    this.segments(this.tips, TIPS, 1.25, 0.05, 1.22);
    this.segments(this.tubes, LEATHER_BONES, 0.85, 0, 1);

    let n = 0;
    for (const j of LEATHER_JOINTS) {
      if (!this.V[j]) continue;
      tM.compose(this.P[j], this.Q[j], tS.setScalar(THREE.MathUtils.clamp(this.R[j], 0.005, 0.013) * 0.9));
      this.knots.setMatrixAt(n++, tM);
    }
    this.knots.count = n;
    this.knots.instanceMatrix.needsUpdate = true;

    n = 0;
    for (const [j, size] of STUDS) {
      if (!this.V[j]) continue;
      const r = THREE.MathUtils.clamp(this.R[j], 0.005, 0.013);
      tY.set(0, 1, 0).applyQuaternion(this.Q[j]);
      tA.copy(this.P[j]).addScaledVector(tY, r * 1.38);
      tM.compose(tA, this.Q[j], tS.set(r * 0.62 * size, r * 0.42 * size, r * 0.62 * size));
      this.studs.setMatrixAt(n++, tM);
    }
    this.studs.count = n;
    this.studs.instanceMatrix.needsUpdate = true;

    this.backOfHand();
  }

  /** Overlapping plates over the back of the hand, the cuff, the leather palm. */
  private backOfHand() {
    const W = this.P[0], mid = this.P[11], idx = this.P[6], pky = this.P[21];
    const ok = this.V[0] && this.V[11] && this.V[6] && this.V[21];
    this.palm.visible = ok;
    if (!ok) { this.lames.count = this.cuff.count = 0; return; }
    const L = this.basis(W, mid, this.Q[0]);
    if (!L) { this.palm.visible = false; this.lames.count = this.cuff.count = 0; return; }
    const span = tB.subVectors(idx, pky).dot(tX);
    const width = Math.max(Math.abs(span), 0.045);
    const fx = tX.clone(), fy = tY.clone(), fz = tZ.clone(); // palm frame: -fz toward the fingers
    const at = (out: THREE.Vector3, along: number, up: number) =>
      out.copy(W).addScaledVector(fz, -along).addScaledVector(fy, up);

    const sx = (width / 2 + 0.011) / 0.93, sy = 0.022;
    for (let i = 0; i < LAMES; i++) {
      const grow = 1 + 0.025 * i; // each lame overlaps the one before it
      at(tA, L * (0.02 + 0.25 * i), 0.0125 - sy * grow);
      tM.makeBasis(fx, fy, fz).scale(tS.set(sx * grow, sy * grow, L * (i === LAMES - 1 ? 0.24 : 0.31))).setPosition(tA);
      this.lames.setMatrixAt(i, tM);
    }
    this.lames.count = LAMES;
    this.lames.instanceMatrix.needsUpdate = true;

    // Cuff: flares from the wrist back toward the elbow (local -Z → +fz).
    const nz = fz.clone().negate(), nx = fx.clone().negate();
    const cx = width * 0.5 + 0.006, cy = 0.024;
    at(tA, L * 0.04, 0.002);
    tM.makeBasis(nx, fy, nz).scale(tS.set(cx, cy, 0.075)).setPosition(tA);
    this.cuff.setMatrixAt(0, tM);
    at(tA, -0.075 + L * 0.04, 0.002); // rolled rim at the open end
    tM.makeBasis(nx, fy, nz).scale(tS.set(cx * 1.24, cy * 1.24, 0.006)).setPosition(tA);
    this.cuff.setMatrixAt(1, tM);
    this.cuff.count = 2;
    this.cuff.instanceMatrix.needsUpdate = true;

    at(this.palm.position, L * 0.5, -0.002);
    this.palm.quaternion.setFromRotationMatrix(tM.makeBasis(fx, fy, fz));
    this.palm.scale.set(width * 0.62, 0.0125, L * 0.56);
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of [this.plates, this.tips, this.lames, this.cuff, this.studs, this.knots, this.tubes]) m.dispose();
    this.steel.dispose(); this.brass.dispose(); this.leather.dispose();
    release();
  }
}

// ── Pose source 1: optical hand tracking ──────────────────────────────────

export class HandGauntlet {
  readonly gauntlet: Gauntlet;
  constructor(private hand: THREE.XRHandSpace) { this.gauntlet = new Gauntlet(hand); }
  update(tracked: boolean, pinching: boolean, dt?: number) {
    if (tracked) {
      const joints = this.hand.joints;
      const { P, Q, R, V } = this.gauntlet;
      for (let i = 0; i < JOINTS.length; i++) {
        const j = joints[JOINTS[i]];
        V[i] = !!j?.visible;
        if (!j || !V[i]) continue;
        P[i].copy(j.position); Q[i].copy(j.quaternion); R[i] = j.jointRadius ?? 0.008;
      }
    }
    this.gauntlet.render(tracked, pinching, dt);
  }
  dispose() { this.gauntlet.dispose(); }
}

// ── Pose source 2: controllers ─────────────────────────────────────────────
//
// The skeleton is built in a canonical right-hand frame (wrist at origin,
// fingers toward -Z, back of hand +Y, thumb toward -X, pinky toward +X) and
// mirrored in X for the left hand. It is then placed in grip space: per the
// WebXR spec the grip's -Z runs along the held handle (the knuckle line,
// out past the thumb), +Y runs from the knuckles back toward the wrist, and
// X is perpendicular to the palm (+X = back of the right hand, palm of the
// left). Measured from IWER's Quest 3 hand data via frame.getJointPose(joint,
// gripSpace): right wrist ≈ (0.036, 0.065, 0.003), its +Y → grip +X.

type FingerDef = { meta: [number, number, number]; knuckle: [number, number, number]; len: [number, number, number]; r: number };
const FINGERS: FingerDef[] = [
  // Knuckles from IWER's Quest 3 hand (see GRIP_IN_HAND).
  { meta: [-0.010, -0.002, -0.026], knuckle: [-0.024, -0.007, -0.096], len: [0.040, 0.024, 0.021], r: 1.0 },
  { meta: [0.000, -0.001, -0.026], knuckle: [-0.002, -0.002, -0.096], len: [0.044, 0.028, 0.023], r: 1.03 },
  { meta: [0.010, -0.002, -0.024], knuckle: [0.017, -0.006, -0.090], len: [0.041, 0.026, 0.022], r: 0.97 },
  { meta: [0.018, -0.004, -0.021], knuckle: [0.035, -0.013, -0.078], len: [0.032, 0.019, 0.020], r: 0.85 },
];
const JOINT_R = [0.0105, 0.009, 0.008, 0.0068];
// Bend per joint (degrees) at full curl: knuckle, middle, last.
const BEND = [82, 100, 68].map(THREE.MathUtils.degToRad);
const THUMB_LEN = [0.040, 0.032, 0.027];
const THUMB_BEND = [18, 32, 40].map(THREE.MathUtils.degToRad);
/** Where the grip origin (centre of the held handle) sits in the canonical frame. */
const GRIP_IN_HAND = new THREE.Vector3(-0.003, -0.036, -0.065);

const cD = new THREE.Vector3(), cU = new THREE.Vector3(), cAxis = new THREE.Vector3(), cP = new THREE.Vector3();
const cQ = new THREE.Quaternion(), cR = new THREE.Quaternion(), cM = new THREE.Matrix4();
const v3 = (a: [number, number, number], mirror: number) => new THREE.Vector3(a[0] * mirror, a[1], a[2]);

export class ControllerGauntlet {
  readonly gauntlet: Gauntlet;
  /** Eased curls: index, middle/ring/pinky, thumb-down. */
  private curl = { index: 0.3, grip: 0.55, thumb: 1 };
  private toGrip = new THREE.Matrix4();
  private toGripQ = new THREE.Quaternion();
  private handed: XRHandedness | null = null;

  constructor(grip: THREE.XRGripSpace) { this.gauntlet = new Gauntlet(grip); }

  private setHandedness(h: XRHandedness) {
    this.handed = h;
    const left = h === "left";
    // Canonical axes → grip axes (see comment above): right [Z, X, Y], left [-Z, -X, Y].
    const ex = new THREE.Vector3(0, 0, left ? -1 : 1), ey = new THREE.Vector3(left ? -1 : 1, 0, 0), ez = new THREE.Vector3(0, 1, 0);
    const rot = new THREE.Matrix4().makeBasis(ex, ey, ez);
    // Canonical coordinates are mirrored for the left hand before this, so
    // the grip origin offset is mirrored too.
    const grip = GRIP_IN_HAND.clone();
    if (left) grip.x *= -1;
    this.toGrip.copy(rot).multiply(new THREE.Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z));
    this.toGripQ.setFromRotationMatrix(rot);
  }

  update(source: XRInputSource | null, tracked: boolean, pinching: boolean, dt = 1 / 72) {
    if (!tracked || !source) { this.gauntlet.render(false, false, dt); return; }
    if (source.handedness !== this.handed) this.setHandedness(source.handedness);
    const b = source.gamepad?.buttons ?? [];
    const val = (i: number) => b[i]?.value ?? (b[i]?.pressed ? 1 : 0);
    const touched = (i: number) => !!(b[i]?.touched || b[i]?.pressed);
    // Index: lifted off the trigger → mostly straight; resting → slight curl; pulled → curled.
    const trig = val(0);
    const index = touched(0) || trig > 0.02 ? 0.32 + 0.58 * trig : 0.1;
    // Other fingers wrap the handle even at rest; squeeze closes the fist.
    const grip = 0.5 + 0.45 * val(1);
    const thumb = [3, 4, 5, 6].some(touched) ? 1 : 0;
    const k = 1 - Math.exp(-dt * 22);
    this.curl.index += (index - this.curl.index) * k;
    this.curl.grip += (grip - this.curl.grip) * k;
    this.curl.thumb += (thumb - this.curl.thumb) * k;
    this.pose(source.handedness === "left" ? -1 : 1);
    this.gauntlet.render(true, pinching, dt);
  }

  private set(i: number, p: THREE.Vector3, d: THREE.Vector3, u: THREE.Vector3, r: number) {
    const g = this.gauntlet;
    g.P[i].copy(p).applyMatrix4(this.toGrip);
    // Joint basis: -Z along the bone, +Y out of the back of the hand.
    cAxis.crossVectors(u, cP.copy(d).negate());
    cM.makeBasis(cAxis, u, cP);
    g.Q[i].setFromRotationMatrix(cM).premultiply(this.toGripQ);
    g.R[i] = r;
    g.V[i] = true;
  }

  /** Bend direction `d` and back-of-finger `u` toward the palm by `angle`. */
  private bend(d: THREE.Vector3, u: THREE.Vector3, angle: number) {
    cAxis.crossVectors(u, d).normalize();
    cR.setFromAxisAngle(cAxis, angle);
    d.applyQuaternion(cR); u.applyQuaternion(cR);
  }

  private pose(mirror: number) {
    const up = new THREE.Vector3(0, 1, 0);
    this.set(0, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), up, 0.014);
    FINGERS.forEach((f, fi) => {
      const k = FINGER_BASES[fi];
      const meta = v3(f.meta, mirror), knuckle = v3(f.knuckle, mirror);
      cD.subVectors(knuckle, meta).normalize();
      cU.copy(up).addScaledVector(cD, -up.dot(cD)).normalize();
      this.set(k, meta, cD, cU, 0.011 * f.r);
      const curl = fi === 0 ? this.curl.index : this.curl.grip;
      // Fingers splay a touch outward from the middle finger when straight.
      cD.set((fi - 1.2) * 0.07 * mirror * (1 - curl), 0, -1).normalize();
      cU.copy(up);
      const p = knuckle.clone();
      for (let s = 0; s < 3; s++) {
        this.bend(cD, cU, BEND[s] * curl);
        this.set(k + 1 + s, p, cD, cU, JOINT_R[s] * f.r);
        p.addScaledVector(cD, f.len[s]);
      }
      this.set(k + 4, p, cD, cU, JOINT_R[3] * f.r);
    });

    // Thumb: raised beside the fist (thumbs-up) or laid across the stick and buttons.
    const t = this.curl.thumb;
    const base = new THREE.Vector3(-0.019 * mirror, -0.012, -0.028);
    const raised = new THREE.Vector3(-0.8 * mirror, 0.2, -0.55).normalize();
    const down = new THREE.Vector3(-0.32 * mirror, 0.05, -0.95).normalize();
    cD.copy(raised).lerp(down, t).normalize();
    // Thumbnail faces away from the fingers, toward the thumb side and up.
    cU.set(-0.5 * mirror, 0.85, 0.15);
    cU.addScaledVector(cD, -cU.dot(cD)).normalize();
    this.set(1, base, cD, cU, 0.012);
    const p = base.clone().addScaledVector(cD, THUMB_LEN[0]);
    const curl = 0.25 + 0.4 * t;
    for (let s = 0; s < 2; s++) {
      this.bend(cD, cU, THUMB_BEND[s] * curl);
      this.set(2 + s, p, cD, cU, JOINT_R[s] * 0.98);
      p.addScaledVector(cD, THUMB_LEN[s + 1]);
    }
    this.bend(cD, cU, THUMB_BEND[2] * curl * 0.5);
    this.set(4, p, cD, cU, JOINT_R[3]);
  }

  dispose() { this.gauntlet.dispose(); }
}
