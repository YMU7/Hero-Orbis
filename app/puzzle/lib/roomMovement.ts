import * as THREE from "three";
import { clampToRoom } from "../puzzleConfig";

/** Move all XR spaces together and turn smoothly about the actual head. */
export class RoomMovement {
  private keys = new Set<string>();
  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.matches("input,textarea,select,[contenteditable]")) return;
    this.keys.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();
  constructor(private rig: THREE.Group, private camera: THREE.PerspectiveCamera, private renderer: THREE.WebGLRenderer) {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
  }
  update(dt: number) {
    let x = 0, y = 0, turn = 0;
    for (const input of this.renderer.xr.getSession()?.inputSources ?? []) {
      const axes = input.gamepad?.axes;
      if (!axes) continue;
      const ix = axes.length >= 4 ? 2 : 0;
      if (input.handedness === "left") { x = axes[ix] ?? 0; y = axes[ix + 1] ?? 0; }
      if (input.handedness === "right") turn = axes[ix] ?? 0;
    }
    if (!this.renderer.xr.isPresenting) {
      x = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
      y = Number(this.keys.has("KeyS")) - Number(this.keys.has("KeyW"));
    }
    // Always use the user camera (a child of the rig). In XR, three.js copies
    // the headset pose into it each frame, so its world transform includes the
    // rig's turn and offset. Don't use renderer.xr.getCamera(): it has no
    // parent, so getWorldPosition/Direction rebuild its matrixWorld from the
    // raw reference-space pose. That drops the rig transform, so after a stick
    // turn "forward" stayed pointing the old way and the turn pivot drifted.
    const head = this.camera;
    const headPos = head.getWorldPosition(new THREE.Vector3());
    const deadZone = 0.15;
    if (Math.abs(turn) > deadZone) {
      const amount = (Math.abs(turn) - deadZone) / (1 - deadZone);
      const angle = -Math.sign(turn) * amount * (Math.PI / 2) * dt;
      this.rig.position.sub(headPos).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(headPos);
      this.rig.rotation.y += angle;
    }
    if (Math.hypot(x, y) < 0.15) return;
    const forward = head.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const motion = forward.multiplyScalar(-y).addScaledVector(right, x).clampLength(0, 1).multiplyScalar(2 * dt);
    // Keep the head/body 20 cm inside the room shell. Physical room-scale
    // safety remains the headset's guardian boundary.
    // Octagon: clamp against all eight walls (diagonals included).
    const [nx, nz] = clampToRoom(headPos.x + motion.x, headPos.z + motion.z, 0.2);
    this.rig.position.x += nx - headPos.x;
    this.rig.position.z += nz - headPos.z;
  }
  reset() { this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0); this.keys.clear(); }
  dispose() {
    window.removeEventListener("keydown", this.onDown); window.removeEventListener("keyup", this.onUp); window.removeEventListener("blur", this.onBlur);
  }
}
