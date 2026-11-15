import * as THREE from "three";

const FINGERS = [
  ["wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
  ...["index", "middle", "ring", "pinky"].map((f) => ["wrist", `${f}-finger-metacarpal`, `${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`, `${f}-finger-tip`]),
];

/** Continuous, articulated glove silhouettes with no runtime asset downloads.
 * Two instanced draws plus a palm per hand, all 25 device joints respected. */
export class ArticulatedHand {
  readonly group = new THREE.Group();
  private material = new THREE.MeshStandardMaterial({ color: 0xcee8ff, metalness: 0.22, roughness: 0.38 });
  private joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.material, 25);
  private bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), this.material, 24);
  private palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), this.material);
  private matrix = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  constructor(private hand: THREE.XRHandSpace) {
    this.joints.frustumCulled = this.bones.frustumCulled = false;
    this.joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.joints, this.bones, this.palm);
    hand.add(this.group);
  }
  update(tracked: boolean, pinching: boolean) {
    this.group.visible = tracked;
    if (!tracked) return;
    this.material.emissive.setHex(pinching ? 0x10354a : 0x000000);
    let ji = 0, bi = 0;
    for (const finger of FINGERS) {
      for (let i = 1; i < finger.length; i++) {
        const a = this.hand.joints[finger[i - 1] as XRHandJoint], b = this.hand.joints[finger[i] as XRHandJoint];
        if (!b?.visible) continue;
        const radius = THREE.MathUtils.clamp(b.jointRadius ?? 0.008, 0.005, 0.014);
        this.matrix.compose(b.position, b.quaternion, this.scale.setScalar(radius));
        this.joints.setMatrixAt(ji++, this.matrix);
        if (!a?.visible) continue;
        const delta = b.position.clone().sub(a.position);
        this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
        this.matrix.compose(a.position.clone().add(b.position).multiplyScalar(0.5), this.q, this.scale.set(radius * 0.88, delta.length(), radius * 0.88));
        this.bones.setMatrixAt(bi++, this.matrix);
      }
    }
    this.joints.count = ji; this.bones.count = bi;
    this.joints.instanceMatrix.needsUpdate = this.bones.instanceMatrix.needsUpdate = true;
    const wrist = this.hand.joints.wrist, middle = this.hand.joints["middle-finger-phalanx-proximal"];
    const index = this.hand.joints["index-finger-phalanx-proximal"], pinky = this.hand.joints["pinky-finger-phalanx-proximal"];
    this.palm.visible = !!(wrist?.visible && middle?.visible && index?.visible && pinky?.visible);
    if (this.palm.visible && wrist && middle && index && pinky) {
      this.palm.position.copy(wrist.position).lerp(middle.position, 0.52);
      const y = middle.position.clone().sub(wrist.position).normalize();
      const x = index.position.clone().sub(pinky.position).normalize();
      const z = new THREE.Vector3().crossVectors(x, y).normalize(); x.crossVectors(y, z).normalize();
      this.palm.quaternion.setFromRotationMatrix(this.matrix.makeBasis(x, y, z));
      this.palm.scale.set(index.position.distanceTo(pinky.position) * 0.65, wrist.position.distanceTo(middle.position) * 0.58, 0.017);
    }
  }
  dispose() {
    this.hand.remove(this.group); this.joints.geometry.dispose(); this.bones.geometry.dispose(); this.palm.geometry.dispose(); this.material.dispose();
  }
}
