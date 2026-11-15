import { RescueRoom } from './rescueRoom';
import type { RescueBeat } from './rescueScript';
import * as THREE from "three";
import { copyDrawing, makeDrawnSword, disposeSketch } from "./drawnSword";
import type { Stroke } from "./swordRecognizer";
import type { Grabber } from "./handInput";
import { ToolPhysics, type PhysicalTool } from "./toolPhysics";
import { RESCUE_LAYOUT } from "../roomLayout";
import type { DrawingBoard } from "./drawingBoard";

const mat = (color: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.35 });
function box(g: THREE.Group, size: number[], pos: number[], material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  g.add(mesh);
  return mesh;
}
/** Royal sword, deliberately minimal for Quest: 4 boxes, Lambert + one unlit
 *  glowing core. No gems, bevels, halo sprite or reflections, and propModels
 *  doesn't re-dress it. */
function royalSword() {
  const g = new THREE.Group();
  g.name = "royal-sword";
  const lam = (color: number) => new THREE.MeshLambertMaterial({ color });
  box(g, [0.07, 0.018, 0.72], [0, 0, -0.5], lam(0xcfeeff)); // blade
  box(g, [0.016, 0.024, 0.58], [0, 0, -0.5], new THREE.MeshBasicMaterial({ color: 0x6fd8ff })); // glowing core, 3 mm proud each side
  box(g, [0.22, 0.035, 0.04], [0, 0, -0.14], lam(0xe0b850)); // guard
  box(g, [0.035, 0.035, 0.16], [0, 0, -0.04], lam(0x2d4f9a)); // grip
  return g;
}
function sword(royal: boolean) {
  if (royal) return royalSword();
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

/** Path of one curse thread in the seal's local frame (side x = -1 | 1):
 *  crystal → along the frame's bottom rail → up the side rail → top corner. */
export const CURSE_THREAD_POINTS = (x: number) =>
  [[0.1 * x, 0], [0.6 * x, -0.05], [1.2 * x, -0.03], [1.36 * x, 0.02], [1.37 * x, 0.8], [1.36 * x, 1.65]].map(([px, py]) => new THREE.Vector3(px, py, -0.03 + 0.005 * Math.abs(px)));

/** Unity gameplay, expressed in Hero's existing room coordinate space. */
export class UnityRoom {
  readonly rescue: RescueRoom;
  readonly group = new THREE.Group();
  readonly hammer: PhysicalTool;
  readonly wallSword: PhysicalTool;
  readonly rackSwords: PhysicalTool[] = [];
  readonly reward: PhysicalTool;
  readonly mute = new THREE.Group();
  /** The silence curse visuals (hidden once broken). Public so the look-dev
   *  layer (curseVisuals.ts) can dress it; gameplay never reads it. */
  readonly red = new THREE.Group();
  private readonly active = new THREE.Group();
  private readonly shards: Array<{ mesh: THREE.Mesh; v: THREE.Vector3; life: number }> = [];
  private activated = false;
  private rewarded = false;
  drawing: Stroke[] = [];
  private sketch: THREE.Group | null = null;
  private peelAge = -1;
  private hoverAge = 0;
  private audio: AudioContext | null = null;
  private ambience: AudioBufferSourceNode | null = null;
  private readonly previousHead = new THREE.Vector3();
  private hasHead = false;
  private sealTime = 0;
  private readonly sealMat = new THREE.MeshStandardMaterial({ color: 0x8a5ad8, roughness: 0.25, metalness: 0.1, emissive: 0x6a2fe0, emissiveIntensity: 0.3, flatShading: true, name: "curse-crystal" });
  /** Crystal microphone: violet crystal, glowing green while she speaks. */
  private readonly micMat = new THREE.MeshStandardMaterial({ color: 0x9a6ae6, roughness: 0.22, metalness: 0.1, emissive: 0x6a2fe0, emissiveIntensity: 0.35, flatShading: true, name: "mic" });
  /** Shards of the shattered red prohibition ring. */
  private readonly shardMat = new THREE.MeshStandardMaterial({ color: 0xe0242e, emissive: 0x7a0010, emissiveIntensity: 0.45, roughness: 0.3, flatShading: true, name: "ring-shard" });
  private speaking = false;
  /** Visual only: the princess is (not) speaking right now. */
  setSpeaking(on: boolean) {
    if (on === this.speaking) return;
    this.speaking = on;
    this.micMat.color.setHex(on ? 0x6bff9e : 0x9a6ae6);
    this.micMat.emissive.setHex(on ? 0x2bd47c : 0x6a2fe0);
    this.micMat.emissiveIntensity = on ? 1.1 : 0.35;
  }
  /** Unlit thread colour, pulsed with the core (no light, no transparency). */
  private readonly threadMat = new THREE.MeshBasicMaterial({ color: 0xd9a8ff, toneMapped: false, name: "curse-thread" });
  /** Hammer head pulses gold in time with the seal (main): "this tool, that target". */
  private readonly hammerHeadMat = mat(0xaab5c2, 0.8);

  constructor(readonly physics: ToolPhysics, painting: THREE.Group, private board: DrawingBoard, private onSound: (on: boolean) => void, onBeat: (beat: RescueBeat) => void | Promise<void> = () => {}) {
    const hammer = new THREE.Group(); hammer.name = "hammer";
    box(hammer, [0.035, 0.035, 0.32], [0, 0, -0.12], mat(0x8a5520));
    box(hammer, [0.20, 0.10, 0.10], [0, 0, -0.31], this.hammerHeadMat);
    painting.updateWorldMatrix(true, false);
    // Freestanding floor rack (octagon layout, roomLayout.RESCUE_LAYOUT): the
    // hammer and all five swords hang in it head/blade down. These boxes are
    // the collision proxy; propModels.dressRack swaps in the detailed rack
    // while each sword remains a separate interactive tool.
    const L = RESCUE_LAYOUT, H = L.rackHeights;
    const rack = new THREE.Group(); rack.name = "tool-rack";
    rack.position.copy(painting.localToWorld(new THREE.Vector3(...L.rack.position)));
    rack.quaternion.copy(painting.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), L.rack.yaw));
    box(rack, [L.rack.width, H.baseTop, 0.3], [0, H.baseTop / 2, 0], mat(0x8a5520)); // base
    for (const x of [-1, 1]) box(rack, [0.07, 1.1, 0.07], [x * (L.rack.width / 2 - 0.035), 0.55, -0.08], mat(0x8a5520)); // end posts
    this.group.add(rack); physics.addStatic(rack);
    rack.updateMatrixWorld(true);
    const hanging = rack.quaternion.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)));
    hammer.position.copy(rack.localToWorld(new THREE.Vector3(L.rackSlots.hammer, H.hammerTop, 0.02)));
    hammer.quaternion.copy(hanging);
    this.group.add(hammer);
    this.hammer = physics.add(hammer, new THREE.Vector3(0.1, 0.05, 0.2), new THREE.Vector3(0, 0, -0.15));
    for (const [index, x] of [L.rackSlots.wallSword, ...L.rackSlots.decor].entries()) {
      const blade = sword(false);
      blade.name = index === 0 ? "wall-sword" : `rack-sword-${index}`;
      blade.position.copy(rack.localToWorld(new THREE.Vector3(x, H.swordPommel, 0.02)));
      blade.quaternion.copy(hanging);
      this.group.add(blade);
      const tool = physics.add(blade, new THREE.Vector3(0.11, 0.025, 0.36), new THREE.Vector3(0, 0, -0.28));
      tool.setGrabSegment(new THREE.Vector3(0, 0, 0.08), new THREE.Vector3(0, 0, -0.67));
      this.rackSwords.push(tool);
    }
    this.wallSword = this.rackSwords[0];
    const reward = sword(true);
    reward.position.copy(board.boardToWorld({ x: 0, y: 0 }, 0.25));
    reward.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
    this.group.add(reward);
    this.reward = physics.add(reward, new THREE.Vector3(0.11, 0.025, 0.45), new THREE.Vector3(0, 0, -0.4));
    this.reward.setGrabSegment(new THREE.Vector3(0,0,.04),new THREE.Vector3(0,0,-.86));
    this.reward.onDrop = () => this.emergeReward();
    reward.visible = false; this.reward.body.setEnabled(false);
    this.mute.position.copy(painting.localToWorld(new THREE.Vector3(0, -0.82, 0.12)));
    this.mute.quaternion.copy(painting.getWorldQuaternion(new THREE.Quaternion()));
    this.group.add(this.mute);
    // Silence curse (art pass): an external crystal core hanging on the
    // frame's bottom rail, bound to the frame corners by glowing threads.
    // Same group, same position and contact radius as the old red seal.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 40), mat(0xe6c06a, 0.7));
    this.red.add(ring);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), this.sealMat);
    core.scale.set(0.85, 1.2, 0.6); core.position.z = 0.03;
    this.red.add(core);
    // Threads: core → along the bottom rail → up the side rail → top corner,
    // with small crystal knots. Merged into ONE unlit mesh (one draw per eye).
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-1, 1]) {
      const pts = CURSE_THREAD_POINTS(x);
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.006, 5, false).toNonIndexed());
      for (const k of [3, 5]) parts.push(new THREE.OctahedronGeometry(0.022, 0).translate(pts[k].x, pts[k].y, pts[k].z));
    }
    const positions = parts.flatMap((g) => Array.from(g.attributes.position.array as Float32Array));
    const threads = new THREE.BufferGeometry();
    threads.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    parts.forEach((g) => g.dispose());
    const threadMesh = new THREE.Mesh(threads, this.threadMat);
    threadMesh.name = "curse-threads";
    threadMesh.raycast = () => {}; // decorative: desktop clicks still have to hit the core/ring, as before
    this.red.add(threadMesh);
    // Violet crystal microphone in the "mic" icon shape (capsule head in a
    // U-shaped holder, stem, base). It is NOT part of the curse: it stays
    // when the hammer shatters the red prohibition ring (this.red), and it
    // glows green while the princess speaks (setSpeaking).
    const crystalMic = new THREE.Group();
    crystalMic.name = "crystal-mic";
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.07, 3, 8), this.micMat);
    head.position.y = 0.045;
    const holder = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.009, 6, 20, Math.PI).rotateZ(Math.PI), this.micMat);
    holder.position.y = 0.035;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8), this.micMat);
    stem.position.y = -0.05;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.014, 12).scale(1, 1, 0.45), this.micMat);
    foot.position.y = -0.08;
    crystalMic.add(head, holder, stem, foot);
    this.mute.add(this.red, this.active, crystalMic); this.active.visible = false;
    this.rescue = new RescueRoom(physics, painting, board, this, onBeat); this.group.add(this.rescue.group);
  }
  tryGrab(g: Grabber, ray: THREE.Ray | null) {
    if (this.rescue.camera.holder && g !== this.rescue.camera.holder && g.point.distanceTo(this.rescue.camera.object.position)<.25) return this.rescue.shoot();
    return [this.hammer, ...this.rackSwords, this.reward, this.rescue.camera, this.rescue.fire, this.rescue.key, this.rescue.photo].filter(t => this.rescue.canGrab(t)).sort((a, b) => a.distanceToGrab(g.point) - b.distanceToGrab(g.point)).some((t) => t.tryGrab(g, ray)) || this.rescue.poke(g.point);
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
    this.activated = true; this.red.visible = false; this.red.scale.setScalar(1);
    this.hammerHeadMat.emissiveIntensity = 0; // mic glow: setSpeaking
    this.rescue.hooks.haptic(this.hammer.holder, 1, 120);
    this.onSound(true); this.sound(); this.rescue.unmute();
    for (let i = 0; i < 28; i++) {
      const a = i * Math.PI * 2 / 28;
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), this.shardMat); // red ring shards (shared material)
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
    this.drawing=copyDrawing(this.board.strokes);
    this.sketch=makeDrawnSword(this.drawing);
    for(const child of this.reward.object.children)if(child!==this.reward.highlight)child.visible=false;
    this.reward.object.add(this.sketch);
    this.rewarded=true;this.reward.object.visible=true;this.reward.body.setEnabled(true);
    this.emergeReward();
  }
  /** Reappear from the drawing on every drop, then remain suspended in reach. */
  private emergeReward() {
    this.reward.reset();
    this.peelAge=0;
    this.hoverAge=0;
    if(this.board.mesh){
      const facing=this.board.mesh.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0)));
      this.reward.body.setRotation(facing,true);
    }
    this.reward.body.setTranslation(this.board.boardToWorld({x:0,y:0},.025),true);this.reward.sync();
  }
  update(dt: number) {
    if(this.peelAge>=0){
      this.peelAge+=dt;
      if(this.reward.holder){this.peelAge=-1;}
      else {
        const k=Math.min(1,this.peelAge/.7);
        this.reward.body.setTranslation(this.board.boardToWorld({x:0,y:0},.025+.3*(1-(1-k)**3)),true);
        this.reward.sync();
        if(k===1)this.peelAge=-1;
      }
    } else if(this.rewarded && this.reward.object.visible && !this.reward.holder){
      // A slow two-centimetre bob keeps the floating sketch alive and in reach.
      this.hoverAge=(this.hoverAge+dt)%3;
      const position=this.board.boardToWorld({x:0,y:0},.325);
      position.y+=.02*Math.sin(this.hoverAge*Math.PI*2/3);
      this.reward.body.setTranslation(position,true);
      this.reward.sync();
    }
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
      this.sealMat.emissiveIntensity = 0.2 + 0.45 * beat; // controlled glow, no bloom
      this.threadMat.color.setRGB(0.62 + 0.25 * beat, 0.45 + 0.2 * beat, 0.85 + 0.15 * beat);
      this.hammerHeadMat.emissive.setHex(0xffc040);
      this.hammerHeadMat.emissiveIntensity = this.hammer.holder ? 0 : 0.5 * beat;
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]; s.life -= dt; s.v.y -= 9.81 * dt;
      s.mesh.position.addScaledVector(s.v, dt); s.mesh.rotation.x += dt * 3; s.mesh.rotation.z += dt * 5;
      if (s.life <= 0) { this.group.remove(s.mesh); s.mesh.geometry.dispose(); this.shards.splice(i, 1); }
    }
  }
  reset() {
    this.rescue.reset();
    this.peelAge=-1;this.drawing=[];if(this.sketch){disposeSketch(this.sketch);this.sketch=null;}
    this.activated = this.rewarded = this.hasHead = false;
    this.red.visible = true; this.active.visible = false; this.setSpeaking(false);
    this.reward.object.visible = false; this.reward.body.setEnabled(false);
    this.ambience?.stop(); this.ambience = null; this.onSound(false);
    for (const s of this.shards) { this.group.remove(s.mesh); s.mesh.geometry.dispose(); }
    this.shards.length = 0;
  }
  dispose() { this.reset(); this.rescue.dispose(); void this.audio?.close(); }
}
