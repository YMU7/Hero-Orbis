import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Grabber } from "./handInput";
import { roomWalls } from "../puzzleConfig";

/** One fixed-step physics world for room tools. Held tools are kinematic;
 * released tools inherit the last 100 ms of hand motion, capped at 8 m/s. */
export class ToolPhysics {
  readonly world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private accumulator = 0;
  readonly tools: PhysicalTool[] = [];
  constructor() {
    this.world.timestep = 1 / 90;
    const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.7));
    box(0, -0.1, 0, 10, 0.1, 10);
    // Eight octagon walls: 0.1 m thick slabs just behind each wall surface,
    // a little longer than the wall so the 135° corners have no gaps.
    for (const w of roomWalls()) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.yaw);
      const c = new THREE.Vector3(0, 0, -0.1).applyQuaternion(q).add(new THREE.Vector3(w.x, 1.6, w.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(w.length / 2 + 0.3, 3, 0.1).setTranslation(c.x, c.y, c.z).setRotation(q).setFriction(0.7));
    }
  }
  add(object: THREE.Object3D, half: THREE.Vector3, offset = new THREE.Vector3()) {
    const tool = new PhysicalTool(this.world, object, half, offset);
    this.tools.push(tool);
    return tool;
  }
  /** Fixed triangle colliders keep tools on the authored furniture, including
   * imported GLBs, rather than approximating every prop by a giant box. */
  addStatic(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const vertices = new Float32Array(geometry.attributes.position.array);
      const indices = geometry.index ? new Uint32Array(geometry.index.array) : Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i);
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.7));
      geometry.dispose();
    });
  }
  update(dt: number) {
    for (const tool of this.tools) tool.follow();
    this.accumulator += Math.min(dt, 0.05);
    while (this.accumulator >= 1 / 90) {
      this.world.step();
      this.accumulator -= 1 / 90;
    }
    for (const tool of this.tools) { tool.sync(); tool.returnFromFloor(); }
  }
  release(g: Grabber) { for (const t of this.tools) t.release(g); }
  highlight(grabbers: Grabber[]) {
    for (const tool of this.tools) {
      tool.highlight.visible = tool.object.visible && !tool.holder && grabbers.some((g) => g.tracked && !g.pinching && tool.distanceToGrab(g.point) < 0.18);
    }
  }
  reset() { for (const t of this.tools) t.reset(); }
  dispose() { this.world.free(); }
}

export class PhysicalTool {
  resetOnGround = true;
  readonly gripRotation = new THREE.Quaternion();
  /** Optional return animation for props that should never enter free fall. */
  onDrop: (() => void) | null = null;
  private grabSegment: THREE.Line3 | null = null;
  readonly body: RAPIER.RigidBody;
  readonly highlight = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.003, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffdf86, depthTest: false }));
  holder: Grabber | null = null;
  private readonly home: THREE.Vector3;
  private readonly homeQ: THREE.Quaternion;
  private samples: Array<{ t: number; p: THREE.Vector3; q: THREE.Quaternion }> = [];
  private readonly q = new THREE.Quaternion();
  constructor(private world: RAPIER.World, readonly object: THREE.Object3D, private half: THREE.Vector3, private offset: THREE.Vector3) {
    this.home = object.position.clone();
    this.homeQ = object.quaternion.clone();
    this.highlight.name = "grab-highlight"; this.highlight.visible = false;
    object.add(this.highlight);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...this.home.toArray()).setRotation(this.homeQ).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(offset.x, offset.y, offset.z).setMass(0.25).setFriction(0.7).setRestitution(0.15), this.body);
  }
  setGrabSegment(start: THREE.Vector3, end: THREE.Vector3) {
    this.grabSegment = new THREE.Line3(start.clone(), end.clone());
  }
  private worldGrabSegment() {
    return this.grabSegment && new THREE.Line3(this.object.localToWorld(this.grabSegment.start.clone()), this.object.localToWorld(this.grabSegment.end.clone()));
  }
  distanceToGrab(point: THREE.Vector3) {
    const segment = this.worldGrabSegment();
    return segment ? segment.closestPointToPoint(point, true, new THREE.Vector3()).distanceTo(point) : this.object.getWorldPosition(new THREE.Vector3()).distanceTo(point);
  }
  returnFromFloor() {
    if (!this.resetOnGround || this.holder || !this.object.visible || !this.body.isDynamic()) return;
    const q = this.object.quaternion;
    const center = this.offset.clone().applyQuaternion(q).add(this.object.position);
    const extent = Math.abs(new THREE.Vector3(1,0,0).applyQuaternion(q).y)*this.half.x
      + Math.abs(new THREE.Vector3(0,1,0).applyQuaternion(q).y)*this.half.y
      + Math.abs(new THREE.Vector3(0,0,1).applyQuaternion(q).y)*this.half.z;
    if (center.y - extent <= 0.035) this.reset();
  }
  tryGrab(g: Grabber, ray?: THREE.Ray | null) {
    if (this.holder || !this.object.visible || !g.tracked) return false;
    const p = this.object.getWorldPosition(new THREE.Vector3());
    const near = this.distanceToGrab(g.point) < 0.13;
    const segment = this.worldGrabSegment();
    const rayPoint = new THREE.Vector3(), targetPoint = p.clone();
    const rayDistance = ray && segment ? Math.sqrt(Math.max(0,ray.distanceSqToSegment(segment.start, segment.end, rayPoint, targetPoint))) : ray?.distanceToPoint(p);
    const remote = g.kind === "controller" && ray && rayDistance !== undefined && rayDistance < 0.09 && ray.direction.dot(targetPoint.clone().sub(ray.origin)) > 0 && ray.origin.distanceTo(targetPoint) < 4;
    if (!near && !remote) return false;
    this.holder = g;
    this.samples = [];
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    return true;
  }
  follow() {
    const g = this.holder;
    if (!g) return;
    if (!g.tracked) { this.release(g, false); return; }
    if (g.rotation) this.q.copy(g.rotation);
    else this.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), g.dir);
    if (g.index !== -1) this.q.multiply(this.gripRotation);
    this.body.setNextKinematicTranslation(g.point);
    this.body.setNextKinematicRotation(this.q);
    const t = performance.now();
    this.samples.push({ t, p: g.point.clone(), q: this.q.clone() });
    while (this.samples.length > 2 && this.samples[1].t < t - 100) this.samples.shift();
  }
  release(g: Grabber, throwing = g.tracked) {
    if (g !== this.holder) return;
    this.holder = null;
    if (this.onDrop) { this.samples = []; this.onDrop(); return; }
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const a = this.samples[0], b = this.samples.at(-1);
    const v = throwing && a && b && b.t > a.t ? b.p.clone().sub(a.p).multiplyScalar(1000 / (b.t - a.t)).clampLength(0, 8) : new THREE.Vector3();
    this.body.setLinvel(v, true);
    const spin = new THREE.Vector3();
    if (throwing && a && b && b.t > a.t) {
      const delta = b.q.clone().multiply(a.q.clone().invert()).normalize();
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
      spin.set(delta.x, delta.y, delta.z).normalize().multiplyScalar(angle * 1000 / (b.t - a.t)).clampLength(0, 20);
    }
    this.body.setAngvel(spin, true);
    this.samples = [];
  }
  drop(velocity = new THREE.Vector3()) {
    if (this.onDrop) { this.onDrop(); return; }
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel(velocity, true);
  }
  sync() {
    this.object.position.copy(this.body.translation());
    this.object.quaternion.copy(this.body.rotation());
  }
  reset() {
    this.holder = null;
    this.samples = [];
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    this.body.setTranslation(this.home, true);
    this.body.setRotation(this.homeQ, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.sync();
  }
}

export async function initToolPhysics() { await RAPIER.init(); }
