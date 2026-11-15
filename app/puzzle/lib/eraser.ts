import * as THREE from 'three';
import type { ToolPhysics, PhysicalTool } from './toolPhysics';
import type { DrawingBoard } from './drawingBoard';
import { BOARD_W } from '../puzzleConfig';

/** Mounted beside the canvas; wipe the board with either face while held. */
export class Eraser {
  readonly object = new THREE.Group();
  readonly tool: PhysicalTool;
  private touching = false;

  constructor(physics: ToolPhysics, mount: THREE.Object3D, private board: Pick<DrawingBoard,'worldToBoard'>, private onErase: () => void) {
    this.object.name = 'easel-eraser';
    const wood = new THREE.Mesh(new THREE.BoxGeometry(.11,.055,.035),new THREE.MeshStandardMaterial({color:0xd6a85f,roughness:.7}));
    const felt = new THREE.Mesh(new THREE.BoxGeometry(.115,.06,.02),new THREE.MeshStandardMaterial({color:0x344357,roughness:1}));
    felt.position.z = -.025;
    this.object.add(wood,felt);
    this.object.position.copy(mount.localToWorld(new THREE.Vector3(-BOARD_W/2-.055,.08,.07)));
    this.object.quaternion.copy(mount.getWorldQuaternion(new THREE.Quaternion()));
    this.tool = physics.add(this.object,new THREE.Vector3(.06,.035,.04));
  }

  update() {
    const contact = this.board.worldToBoard(this.object.getWorldPosition(new THREE.Vector3()));
    const touching = !!this.tool.holder && contact.inside && Math.abs(contact.z) <= .07;
    if (touching && !this.touching) this.onErase();
    this.touching = touching;
  }
}
