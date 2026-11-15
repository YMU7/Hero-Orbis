import * as THREE from 'three';
import type { PhysicalTool, ToolPhysics } from './toolPhysics';
import type { UnityRoom } from './unityRoom';
import type { RescueStage, RescueBeat } from './rescueScript';
import { RESCUE_SCRIPT } from './rescueScript';
import { recognizeSword } from './swordRecognizer';
import { BOARD_H, ROOM } from '../puzzleConfig';
import type { DrawingBoard } from './drawingBoard';

const material = (color: number, metalness = 0) => new THREE.MeshStandardMaterial({color, metalness, roughness: 0.55});
function block(g: THREE.Group, size: number[], p: number[], m: THREE.Material) {
 const o = new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),m); o.position.set(p[0],p[1],p[2]); g.add(o); return o;
}
export class RescueRoom {
 stage: RescueStage = 'silence';
 readonly group = new THREE.Group();
 readonly rope = new THREE.Group();
 readonly glass = new THREE.Group();
 readonly fire: PhysicalTool;
 readonly key: PhysicalTool;
 readonly camera: PhysicalTool;
 readonly photo: PhysicalTool;
 private elapsed = 0;
 private melting = -1;
 private falling = false;
 private fallSpeed = 0;
 private rippleAge = -1;
 private readonly ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
 private readonly glassHome: THREE.Vector3;
 private readonly debris: Array<{mesh: THREE.Mesh; velocity: THREE.Vector3}> = [];
 private fireCaught = false;
 private shutterDown = false;
 private fireDelay: number | null = null;
 private fireDialogueDelay: number | null = null;
 private run = 0;
 constructor(private physics: ToolPhysics, private painting: THREE.Group, private board: DrawingBoard, private room: UnityRoom, private emit: (beat: RescueBeat) => void | Promise<void>) {
  const gold=material(0xdab45a,.7), wood=material(0x8a5520), dark=material(0x253b68);
  const position=(x:number,y:number,z:number)=>painting.localToWorld(new THREE.Vector3(x,y,z));
  this.rope.position.copy(position(-1.65,.15,.5));
  const bottom=-.55, top=ROOM.height-this.rope.position.y;
  const ropeLength=top-bottom;
  // Three twisted hemp strands give the cord a readable braided silhouette.
  for(let strand=0;strand<3;strand++){
   const steps=Math.ceil(ropeLength*100);
   const points=Array.from({length:steps+1},(_,i)=>{
    const y=bottom+ropeLength*i/steps, angle=(y-bottom)*Math.PI*2*12+strand*Math.PI*2/3;
    return new THREE.Vector3(Math.cos(angle)*.012,y,Math.sin(angle)*.012);
   });
   const cord=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),points.length-1,.010,6,false),material([0xb58a50,0xd2ac70,0x98703e][strand]));
   cord.name='hemp-rope-strand';this.rope.add(cord);
  }
  const anchor=new THREE.Mesh(new THREE.TorusGeometry(.055,.012,8,20),gold);anchor.rotation.x=Math.PI/2;anchor.position.y=top-.012;this.rope.add(anchor);
  for(let i=0;i<3;i++){const knot=new THREE.Mesh(new THREE.TorusGeometry(.025,.009,6,16),wood);knot.rotation.x=Math.PI/2;knot.position.y=bottom+.025+i*.017;this.rope.add(knot);}
  this.group.add(this.rope);
  this.glass.position.copy(position(-1.65,-.62,.5)); this.glassHome=this.glass.position.clone();
  const crystal=new THREE.MeshStandardMaterial({color:0xb8e8ff,transparent:true,opacity:.28,roughness:.12,metalness:.1,side:THREE.DoubleSide});
  block(this.glass,[.48,.40,.40],[0,0,0],crystal);
  for(const y of [-.21,.21]) block(this.glass,[.5,.025,.42],[0,y,0],gold);
  this.group.add(this.glass);
  const make=(name:string,g:THREE.Group,p:THREE.Vector3,half:THREE.Vector3)=>{g.name=name;g.position.copy(p);this.group.add(g);return physics.add(g,half);};
  const key=new THREE.Group();
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.055,.014,8,24),gold);ring.position.y=.07;key.add(ring);
  block(key,[.025,.14,.025],[0,-.035,0],gold);block(key,[.065,.025,.025],[.025,-.09,0],gold);
  this.key=make('golden-key',key,this.glass.position.clone(),new THREE.Vector3(.08,.14,.03));
  const fire=new THREE.Group(); const flame=new THREE.Mesh(new THREE.IcosahedronGeometry(.11,1),new THREE.MeshStandardMaterial({color:0xffbe39,emissive:0xff5500,emissiveIntensity:2}));fire.add(flame);fire.add(new THREE.PointLight(0xff9933,1,1.5));
  this.fire=make('magic-fireball',fire,position(0,-.1,.9),new THREE.Vector3(.1,.1,.1));
  const camera=new THREE.Group();block(camera,[.22,.15,.12],[0,0,0],dark);block(camera,[.07,.18,.07],[.04,-.12,.015],wood);
  const lens=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.10,16),gold);lens.rotation.x=Math.PI/2;lens.position.z=-.10;camera.add(lens);block(camera,[.05,.025,.04],[.07,.09,0],gold);
  camera.quaternion.copy(painting.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
  this.camera=make('camera',camera,position(1.72,-.55,.3),new THREE.Vector3(.13,.15,.12));
  const photo=new THREE.Group();block(photo,[.25,.3,.014],[0,0,0],material(0xfff4d8));block(photo,[.21,.21,.016],[0,.025,0],dark);
  // A raised gold key silhouette remains readable from both sides in VR.
  for(const z of [-.012,.012]) {const miniature=key.clone();miniature.scale.setScalar(.65);miniature.position.set(0,.025,z);photo.add(miniature);}
  this.photo=make('key-photograph',photo,position(0,-.3,.7),new THREE.Vector3(.13,.15,.015));
  this.ripple=new THREE.Mesh(new THREE.RingGeometry(.08,.10,48),new THREE.MeshBasicMaterial({color:0x83dfff,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));painting.add(this.ripple);
  this.reset();
 }
 private show(t:PhysicalTool,on:boolean) {if(!on&&t.holder)t.release(t.holder,false);t.object.visible=on;t.body.setEnabled(on);}
 advance(stage:RescueStage) {this.stage=stage;return this.emit(RESCUE_SCRIPT.find(b=>b.id===stage)!);}
 unmute() {if(this.stage==='silence')this.advance('unmuted');}
 private paintingContact(t:PhysicalTool) {const p=this.painting.worldToLocal(t.object.getWorldPosition(new THREE.Vector3()));return Math.abs(p.x)<1.2&&Math.abs(p.y)<.675&&Math.abs(p.z)<.18;}
 shoot() {
  if(this.stage!=='rejected'||!this.camera.holder)return false;
  const origin=this.camera.object.position, dir=new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.object.quaternion);
  const ray=new THREE.Ray(origin,dir), target=this.key.object.position;
  if(dir.dot(target.clone().sub(origin))<0||ray.distanceToPoint(target)>.5)return false;
  this.photo.reset();this.photo.body.setTranslation(origin.clone().addScaledVector(dir,.3),true);this.photo.sync();this.show(this.photo,true);this.photo.drop(new THREE.Vector3(0,.3,0));this.advance('photo');return true;
 }
 update(dt:number) {
  this.elapsed+=dt;
  if(this.fireDialogueDelay!==null){this.fireDialogueDelay-=dt;if(this.fireDialogueDelay<=0){this.fireDialogueDelay=null;this.advance('fire');}}
  if(this.fireDelay!==null){this.fireDelay-=dt;if(this.fireDelay<=0){this.fireDelay=null;this.show(this.fire,true);this.fireDialogueDelay=1.5;}}
  if(this.room.wallSword.holder&&this.melting<0)this.melting=0;
  if(this.melting>=0){this.melting+=dt;this.room.wallSword.object.scale.z=Math.max(.03,1-Math.max(0,this.melting-1.2)/.8);if(this.melting>=2){this.room.wallSword.reset();this.room.wallSword.object.scale.setScalar(1);this.melting=-1;if(this.stage==='unmuted')this.advance('melted');}}
  if(this.stage==='melted'&&recognizeSword(this.board.strokes,BOARD_H).isSword){this.room.spawnReward();this.advance('drawn');}
  const sword=this.room.reward.object;
  const blade=new THREE.Line3(sword.localToWorld(new THREE.Vector3(0,0,-.15)),sword.localToWorld(new THREE.Vector3(0,0,-.86)));
  if(this.stage==='drawn'&&this.room.reward.holder&&blade.closestPointToPoint(this.rope.position,true,new THREE.Vector3()).distanceTo(this.rope.position)<.6){
   const run=this.run;
   const spoken=this.advance('rope');
   const ready=()=>{if(this.run===run&&this.stage==='rope')this.fireDelay=1.5;};
   if(spoken&&typeof spoken.then==='function')void spoken.then(ready,ready);else ready();
  }
  if(this.stage==='fire'||(this.stage==='rope'&&this.fire.object.visible)){
   if(this.fire.holder)this.fireCaught=true;
   if(!this.fireCaught){this.fire.body.setTranslation(this.painting.localToWorld(new THREE.Vector3(Math.sin(this.elapsed*1.3)*.7,-.1,.9)),true);this.fire.sync();}
   const p=this.fire.object.position, rope=this.rope.position;
   if(this.stage==='fire'&&this.fireCaught&&Math.abs(p.y-rope.y)<.65&&Math.hypot(p.x-rope.x,p.z-rope.z)<.18){this.rope.visible=false;this.show(this.fire,false);this.falling=true;}
  }
  if(this.falling){this.fallSpeed+=9.81*dt;this.glass.position.y-=this.fallSpeed*dt;this.key.body.setTranslation(this.glass.position,true);this.key.sync();if(this.glass.position.y<=.22){this.falling=false;this.glass.visible=false;this.key.drop();this.advance('key');for(let i=0;i<18;i++){const mesh=new THREE.Mesh(new THREE.TetrahedronGeometry(.04),material(0xb8e8ff));mesh.position.copy(this.glass.position);this.group.add(mesh);this.debris.push({mesh,velocity:new THREE.Vector3(Math.sin(i*2.4),1.2,Math.cos(i*2.4))});}}}
  if(this.stage==='key'&&this.key.holder&&this.paintingContact(this.key)){
   this.ripple.position.copy(this.painting.worldToLocal(this.key.object.position.clone()));this.ripple.position.z=.04;this.rippleAge=0;
   this.key.release(this.key.holder,false);const normal=new THREE.Vector3(0,0,1).applyQuaternion(this.painting.getWorldQuaternion(new THREE.Quaternion()));this.key.drop(normal.multiplyScalar(1.5));this.advance('rejected');
  }
  if(this.stage==='photo'&&this.photo.holder&&this.paintingContact(this.photo)){this.show(this.photo,false);this.advance('escaped');}
  const holder=this.camera.holder;
  const shutter=!!holder?.source?.gamepad?.buttons[0]?.pressed;
  if(shutter&&!this.shutterDown)this.shoot();this.shutterDown=shutter;
  // Hand tracking: aim and pinch the camera's shutter with the free hand (handled by press).
  if(this.rippleAge>=0){this.rippleAge+=dt;this.ripple.scale.setScalar(1+this.rippleAge*6);this.ripple.material.opacity=Math.max(0,1-this.rippleAge);}
  for(const d of this.debris){d.velocity.y-=dt*9.81;d.mesh.position.addScaledVector(d.velocity,dt);if(d.mesh.position.y<.025){d.mesh.position.y=.025;d.velocity.set(0,0,0);}}
 }
 canGrab(t:PhysicalTool){return t!==this.key||['key','rejected','photo','escaped'].includes(this.stage);}
 reset(){this.run++;this.fireDelay=null;this.fireDialogueDelay=null;this.stage='silence';this.elapsed=0;this.melting=-1;this.falling=false;this.fallSpeed=0;this.fireCaught=false;this.shutterDown=false;this.rippleAge=-1;this.ripple.material.opacity=0;this.glass.visible=this.rope.visible=true;this.glass.position.copy(this.glassHome);for(const t of [this.key,this.camera,this.photo,this.fire])t.reset();this.show(this.key,true);this.show(this.camera,true);this.show(this.fire,false);this.show(this.photo,false);this.room.wallSword.object.scale.setScalar(1);for(const d of this.debris){d.mesh.removeFromParent();d.mesh.geometry.dispose();(d.mesh.material as THREE.Material).dispose();}this.debris.length=0;}
 dispose(){this.ripple.removeFromParent();this.ripple.geometry.dispose();this.ripple.material.dispose();}
}
