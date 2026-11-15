import { RescueRoom } from './rescueRoom';
import type { RescueBeat } from './rescueScript';
import * as THREE from "three";
import type { Grabber } from "./handInput";
import { ToolPhysics, type PhysicalTool } from "./toolPhysics";
import type { DrawingBoard } from "./drawingBoard";

const mat = (color: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.35 });
function box(g: THREE.Group, size: number[], pos: number[], material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  g.add(mesh);
  return mesh;
}
function sword(royal: boolean) {
  const g = new THREE.Group();
  g.name = royal ? "royal-sword" : "wall-sword";
  const gold = mat(0xdab45a, 0.75), steel = mat(royal ? 0xb8e8ff : 0xb4bfcb, 0.8);
  box(g, [royal ? 0.075 : 0.045, 0.018, royal ? 0.72 : 0.5], [0, 0, royal ? -0.5 : -0.39], steel);
  box(g, [0.22, 0.035, 0.04], [0, 0, -0.14], gold);
  box(g, [0.035, 0.035, 0.16], [0, 0, -0.04], mat(0x253b68));
  if (royal) {
    box(g, [0.018, 0.022, 0.58], [0, 0, -0.5], new THREE.MeshStandardMaterial({ color: 0x4ccfff, emissive: 0x178bdf, emissiveIntensity: 2 }));
    for (const x of [-0.08, 0, 0.08]) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.023), mat(0x1563cc, 0.4));
      gem.position.set(x, 0.03, -0.14); g.add(gem);
    }
  }
  return g;
}

/** Unity gameplay, expressed in Hero's existing room coordinate space. */
export class UnityRoom {
  readonly rescue: RescueRoom;
  readonly group = new THREE.Group();
  readonly hammer: PhysicalTool;
  readonly wallSword: PhysicalTool;
  readonly reward: PhysicalTool;
  readonly mute = new THREE.Group();
  private readonly red = new THREE.Group();
  private readonly active = new THREE.Group();
  private readonly shards: Array<{ mesh: THREE.Mesh; v: THREE.Vector3; life: number }> = [];
  private activated = false;
  private rewarded = false;
  private audio: AudioContext | null = null;
  private ambience: AudioBufferSourceNode | null = null;
  private readonly previousHead = new THREE.Vector3();
  private hasHead = false;
  private sealTime = 0;
  private readonly sealMat = mat(0xdf333e);

  constructor(readonly physics: ToolPhysics, painting: THREE.Group, private board: DrawingBoard, private onSound: (on: boolean) => void, onBeat: (beat: RescueBeat) => void | Promise<void> = () => {}) {
    const hammer = new THREE.Group(); hammer.name = "hammer";
    box(hammer, [0.035, 0.035, 0.32], [0, 0, -0.12], mat(0x8a5520));
    box(hammer, [0.20, 0.10, 0.10], [0, 0, -0.31], mat(0xaab5c2, 0.8));
    painting.updateWorldMatrix(true, false);
    const rack = new THREE.Group(); rack.name = "tool-rack";
    rack.position.copy(painting.localToWorld(new THREE.Vector3(1.72, 0, 0.08)));
    rack.quaternion.copy(painting.getWorldQuaternion(new THREE.Quaternion()));
    box(rack, [0.72, 0.64, 0.05], [0, 0.05, 0], mat(0x8a5520));
    for (const x of [-0.17, 0.18]) box(rack, [0.08, 0.035, 0.20], [x, -0.1, 0.1], mat(0xdab45a, 0.7));
    this.group.add(rack); physics.addStatic(rack);
    hammer.position.copy(painting.localToWorld(new THREE.Vector3(1.55, -0.1, 0.25)));
    hammer.quaternion.copy(painting.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
    this.group.add(hammer);
    this.hammer = physics.add(hammer, new THREE.Vector3(0.1, 0.05, 0.2), new THREE.Vector3(0, 0, -0.15));
    const blade = sword(false);
    blade.position.copy(painting.localToWorld(new THREE.Vector3(1.9, -0.1, 0.25)));
    blade.quaternion.copy(hammer.quaternion);
    this.group.add(blade);
    this.wallSword = physics.add(blade, new THREE.Vector3(0.11, 0.025, 0.32), new THREE.Vector3(0, 0, -0.25));
    this.wallSword.setGrabSegment(new THREE.Vector3(0,0,.04),new THREE.Vector3(0,0,-.64));
    const reward = sword(true);
    reward.position.copy(board.boardToWorld({ x: 0, y: 0 }, 0.25));
    reward.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
    this.group.add(reward);
    this.reward = physics.add(reward, new THREE.Vector3(0.11, 0.025, 0.45), new THREE.Vector3(0, 0, -0.4));
    this.reward.setGrabSegment(new THREE.Vector3(0,0,.04),new THREE.Vector3(0,0,-.86));
    this.reward.resetOnGround = false;
    reward.visible = false; this.reward.body.setEnabled(false);
    this.mute.position.copy(painting.localToWorld(new THREE.Vector3(0, -0.82, 0.12)));
    this.mute.quaternion.copy(painting.getWorldQuaternion(new THREE.Quaternion()));
    this.group.add(this.mute);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 8, 40), this.sealMat);
    this.red.add(ring);
    const slash = box(this.red, [0.38, 0.025, 0.03], [0, 0, 0.025], this.sealMat);
    slash.rotation.z = -Math.PI / 4;
    const mic = box(this.active, [0.055, 0.11, 0.035], [0, 0.025, 0], mat(0x58dda0));
    // Rounded microphone mesh.
    this.active.remove(mic); mic.geometry.dispose();
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 4, 8), mic.material);
    capsule.position.copy(mic.position); this.active.add(capsule);
    box(this.active, [0.015, 0.09, 0.02], [0, -0.06, 0], mat(0x58dda0));
    box(this.active, [0.10, 0.015, 0.025], [0, -0.1, 0], mat(0x58dda0));
    this.mute.add(this.red, this.active); this.active.visible = false;
    this.rescue = new RescueRoom(physics, painting, board, this, onBeat); this.group.add(this.rescue.group);
  }
  tryGrab(g: Grabber, ray: THREE.Ray | null) {
    if (this.rescue.camera.holder && g !== this.rescue.camera.holder && g.point.distanceTo(this.rescue.camera.object.position)<.25) return this.rescue.shoot();
    return [this.hammer, this.wallSword, this.reward, this.rescue.camera, this.rescue.fire, this.rescue.key, this.rescue.photo].filter(t => this.rescue.canGrab(t)).sort((a, b) => a.distanceToGrab(g.point) - b.distanceToGrab(g.point)).some((t) => t.tryGrab(g, ray)) || this.rescue.poke(g.point);
  }
  /** Desktop follows the same hammer contact path; never accepts another tool. */
  desktopStrike() {
    const p = this.mute.getWorldPosition(new THREE.Vector3());
    this.hammer.body.setTranslation(p.clone().add(new THREE.Vector3(0, 0, 0.31)), true);
    this.hammer.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.hammer.sync(); this.activate();
  }
  private activate() {
    if (this.activated) return;
    this.activated = true; this.red.visible = false; this.active.visible = true; this.red.scale.setScalar(1);
    this.rescue.hooks.haptic(this.hammer.holder, 1, 120);
    this.onSound(true); this.sound(); this.rescue.unmute();
    for (let i = 0; i < 28; i++) {
      const a = i * Math.PI * 2 / 28;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.015), mat(0xdf333e));
      mesh.position.copy(this.mute.position).add(new THREE.Vector3(Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0.04));
      this.group.add(mesh);
      this.shards.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 0.8, 1 + Math.sin(a) * 0.8, 0.8), life: 2.5 });
    }
  }
  private sound() {
    try {
      this.audio ??= new AudioContext(); void this.audio.resume();
      const ctx = this.audio;
      const noise = (seconds: number, shatter: boolean) => {
        const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0);
        let low = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / ctx.sampleRate, n = Math.random() * 2 - 1;
          low = low * 0.985 + n * 0.015;
          d[i] = shatter ? (n * Math.exp(-30 * t) * 0.7 + Math.sin(t * Math.PI * 4682) * Math.exp(-7 * t) * 0.2) : (low * 2.4 + n * 0.025) * 0.16 * Math.min(1, i / 600, (d.length - i - 1) / 600);
        }
        const source = ctx.createBufferSource(); source.buffer = b; source.connect(ctx.destination); return source;
      };
      noise(1, true).start(); this.ambience = noise(4, false); this.ambience.loop = true; this.ambience.start();
    } catch { /* Browser without WebAudio still has visual feedback. */ }
  }
  spawnReward() {
    if(this.rewarded)return;
    this.rewarded=true;this.reward.object.visible=true;this.reward.body.setEnabled(true);this.reward.drop(new THREE.Vector3(0,0,.4));
  }
  update(dt: number) {
    this.rescue.update(dt);
    const head = this.hammer.object.localToWorld(new THREE.Vector3(0, 0, -0.31));
    const target = this.mute.getWorldPosition(new THREE.Vector3());
    // Swept head contact catches fast swings between render frames.
    const contact = this.hasHead ? new THREE.Line3(this.previousHead, head).closestPointToPoint(target, true, new THREE.Vector3()) : head;
    if (contact.distanceTo(target) < 0.23) this.activate();
    this.previousHead.copy(head); this.hasHead = true;
    // The seal breathes until it is broken, so it reads as the first thing to hit.
    if (!this.activated) {
      this.sealTime += dt;
      const beat = 0.5 + 0.5 * Math.sin(this.sealTime * 4);
      this.red.scale.setScalar(1 + 0.07 * beat);
      this.sealMat.emissive.setHex(0xff2030);
      this.sealMat.emissiveIntensity = 0.15 + 0.6 * beat;
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]; s.life -= dt; s.v.y -= 9.81 * dt;
      s.mesh.position.addScaledVector(s.v, dt); s.mesh.rotation.x += dt * 3; s.mesh.rotation.z += dt * 5;
      if (s.life <= 0) { this.group.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); this.shards.splice(i, 1); }
    }
  }
  reset() {
    this.rescue.reset();
    this.activated = this.rewarded = this.hasHead = false;
    this.red.visible = true; this.active.visible = false;
    this.reward.object.visible = false; this.reward.body.setEnabled(false);
    this.ambience?.stop(); this.ambience = null; this.onSound(false);
    for (const s of this.shards) { this.group.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); }
    this.shards.length = 0;
  }
  dispose() { this.reset(); this.rescue.dispose(); void this.audio?.close(); }
}
