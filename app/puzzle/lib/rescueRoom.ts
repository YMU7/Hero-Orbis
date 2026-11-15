import * as THREE from 'three';
import { RescueFinale } from './rescueFinale';
import type { PhysicalTool, ToolPhysics } from './toolPhysics';
import type { UnityRoom } from './unityRoom';
import type { RescueStage, RescueBeat } from './rescueScript';
import { RESCUE_SCRIPT } from './rescueScript';
import { recognizeSword } from './swordRecognizer';
import type { Grabber } from './handInput';
import type { SoundId } from './roomAudio';
import { BOARD_H, ROOM } from '../puzzleConfig';
import type { DrawingBoard } from './drawingBoard';
import { lookQuality } from './lookdev';

const material = (color: number, metalness = 0) => new THREE.MeshStandardMaterial({color, metalness, roughness: 0.55});
function block(g: THREE.Group, size: number[], p: number[], m: THREE.Material) {
 const o = new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),m); o.position.set(p[0],p[1],p[2]); g.add(o); return o;
}

/** Feedback the room asks the scene for (no-ops in tests). `haptic(null)`
 *  pulses every tracked controller. `bark` plays a short line if she is
 *  not already talking. */
export type RescueHooks = {
 sound: (id: SoundId) => void;
 haptic: (g: Grabber | null, strength: number, ms: number) => void;
 bark: (id: string) => void;
};

type Particle = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; drag: number; spin: THREE.Vector3 };
const particleMats = new Map<string, THREE.MeshStandardMaterial>();
function particleMat(color: number, emissive: boolean) {
  const key = `${color}|${emissive}`;
  let m = particleMats.get(key);
  if (!m) particleMats.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: .6, side: THREE.DoubleSide, ...(emissive ? { emissive: color, emissiveIntensity: 2 } : {}) })));
  return m;
}
const particleGeos = new Map<number, THREE.PlaneGeometry>();
function particleGeo(size: number) {
  let g = particleGeos.get(size);
  if (!g) particleGeos.set(size, (g = new THREE.PlaneGeometry(size, size * .6)));
  return g;
}

/** Seconds the fireball takes to float out of the canvas into the room. */
export const FIRE_EMERGE_S = 0.9;
const CONFETTI = [0xf6d47a, 0xb8e8ff, 0xf3b6d8, 0xc9b8ff, 0xffffff, 0x9fe3c1];

export class RescueRoom {
 stage: RescueStage = 'silence';
 readonly group = new THREE.Group();
 readonly rope = new THREE.Group();
 readonly finale: RescueFinale;
 swordLit = false;
 private readonly swordFlame = new THREE.Group();
 private drawingIdle = 0;
 private previousFire: THREE.Vector3 | null = null;
 readonly glass = new THREE.Group();
 readonly fire: PhysicalTool;
 readonly key: PhysicalTool;
 readonly camera: PhysicalTool;
 readonly photo: PhysicalTool;
 hooks: RescueHooks = { sound: () => {}, haptic: () => {}, bark: () => {} };
 /** Seconds from breaking the silence to the escape (null until escaped). */
 rescueSeconds: number | null = null;
 private elapsed = 0;
 private unmutedAt = 0;
 private melting = -1;
 private falling = false;
 private fallSpeed = 0;
 private rippleAge = -1;
 private rippleGrow = 6;
 private readonly ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
 private readonly glassHome: THREE.Vector3;
 private readonly particles: Particle[] = [];
 private fireCaught = false;
 private fireEmerge = -1;
 private fireOut = false;
 private fireT = 0;
 private shutterDown = false;
 private fireDelay: number | null = null;
 private flashAge = -1;
 private readonly flashLight: THREE.PointLight;
 private readonly flashDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
 private lastPoke = -Infinity;
 private lastGlassHammer = -Infinity;
 private lastGlassSword = -Infinity;
 private endCard: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
 private endCardAge = -1;
 private run = 0;
 constructor(private physics: ToolPhysics, private painting: THREE.Group, private board: DrawingBoard, private room: UnityRoom, private emit: (beat: RescueBeat) => void | Promise<void>) {
  this.finale=new RescueFinale(painting);
  const fireInk=new THREE.MeshBasicMaterial({color:0xffb52e,transparent:true,opacity:.8});
  for(let i=0;i<7;i++){const flame=new THREE.Mesh(new THREE.ConeGeometry(.035,.12,5),fireInk);flame.position.set(0,.04,-.12-i*.10);this.swordFlame.add(flame);}
  this.swordFlame.visible=false;room.reward.object.add(this.swordFlame);
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
  const fire=new THREE.Group(); const flame=new THREE.Mesh(new THREE.IcosahedronGeometry(.11,1),new THREE.MeshStandardMaterial({color:0xffbe39,emissive:0xff5500,emissiveIntensity:2}));fire.add(flame);if(lookQuality()==="ultra")fire.add(new THREE.PointLight(0xff9933,1,1.5)); // point lights cost every lit pixel on Quest; the emissive flame carries it
  this.fire=make('magic-fireball',fire,position(0,-.1,.9),new THREE.Vector3(.1,.1,.1));
  const camera=new THREE.Group();block(camera,[.22,.15,.12],[0,0,0],dark);block(camera,[.07,.18,.07],[.04,-.12,.015],wood);
  const lens=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.10,16),gold);lens.rotation.x=Math.PI/2;lens.position.z=-.10;camera.add(lens);block(camera,[.05,.025,.04],[.07,.09,0],gold);
  // Flash: a light burst and a bright disc on the lens front.
  this.flashLight=new THREE.PointLight(0xfff6e0,0,3);this.flashLight.position.set(0,0,-.2);if(lookQuality()==="ultra")camera.add(this.flashLight); // high/low: the flash disc alone (an idle point light still costs per pixel)
  this.flashDisc=new THREE.Mesh(new THREE.CircleGeometry(.07,24),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
  this.flashDisc.position.set(0,0,-.152);this.flashDisc.visible=false;camera.add(this.flashDisc);
  camera.quaternion.copy(painting.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
  this.camera=make('camera',camera,position(1.72,-.55,.3),new THREE.Vector3(.13,.15,.12));
  const photo=new THREE.Group();block(photo,[.25,.3,.014],[0,0,0],material(0xfff4d8));block(photo,[.21,.21,.016],[0,.025,0],dark);
  // A raised gold key silhouette remains readable from both sides in VR.
  for(const z of [-.012,.012]) {const miniature=key.clone();miniature.scale.setScalar(.65);miniature.position.set(0,.025,z);photo.add(miniature);}
  this.photo=make('key-photograph',photo,position(0,-.3,.7),new THREE.Vector3(.13,.15,.015));
  this.ripple=new THREE.Mesh(new THREE.RingGeometry(.08,.10,48),new THREE.MeshBasicMaterial({color:0x83dfff,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));painting.add(this.ripple);
  // Hidden shader templates for things created mid-game (sparks, confetti,
  // end card): lookdev.prewarm compiles hidden objects, so these variants are
  // ready before the first burst instead of stalling that frame on Quest.
  const blank=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);blank.colorSpace=THREE.SRGBColorSpace;blank.needsUpdate=true;
  for(const m of [particleMat(0xffffff,false),particleMat(0xffffff,true),new THREE.MeshBasicMaterial({map:blank,toneMapped:false,transparent:true,opacity:0})]){const t=new THREE.Mesh(particleGeo(.01),m);t.visible=false;t.frustumCulled=false;this.group.add(t);}
  this.reset();
 }
 /** The recognizer is only re-run when the drawing changed (it used to run every frame). */
 private strokeSig='';
 private strokesChanged(){let n=0;for(const s of this.board.strokes)n+=s.length;const sig=`${this.board.strokes.length}:${n}`;if(sig===this.strokeSig)return false;this.strokeSig=sig;return true;}
 private show(t:PhysicalTool,on:boolean) {if(!on&&t.holder)t.release(t.holder,false);t.object.visible=on;t.body.setEnabled(on);}
 advance(stage:RescueStage) {this.stage=stage;return this.emit(RESCUE_SCRIPT.find(b=>b.id===stage)!);}
 /** A cue-only beat (Orbis steering, no stage change, no voice). */
 private cue(id:string) {const beat=RESCUE_SCRIPT.find(b=>b.id===id);if(beat)void this.emit(beat);}
 unmute() {if(this.stage==='silence'){this.unmutedAt=this.elapsed;this.advance('unmuted');}}
 private paintingContact(t:PhysicalTool) {const p=this.painting.worldToLocal(t.object.getWorldPosition(new THREE.Vector3()));return Math.abs(p.x)<1.2&&Math.abs(p.y)<.675&&Math.abs(p.z)<.18;}
 /** A ring spreading across the canvas where something touched it. */
 private pulseRipple(world:THREE.Vector3|null,local:THREE.Vector3|null,color:number,grow=6) {
  this.ripple.position.copy(local??this.painting.worldToLocal(world!.clone()));this.ripple.position.z=.04;
  this.ripple.material.color.setHex(color);this.rippleGrow=grow;this.rippleAge=0;
 }
 private burst(at:THREE.Vector3,count:number,make:(i:number)=>{color:number;emissive?:boolean;size:number;velocity:THREE.Vector3;life:number;drag:number}) {
  for(let i=0;i<count;i++){
   const p=make(i);
   // Shared per colour / size: 140 confetti pieces no longer mean 140 new
   // materials + geometries (and allocations) on one frame.
   const mesh=new THREE.Mesh(particleGeo(p.size),particleMat(p.color,!!p.emissive));
   mesh.position.copy(at);mesh.rotation.set(i*1.7,i*2.3,i*.9);this.group.add(mesh);
   this.particles.push({mesh,velocity:p.velocity,life:p.life,drag:p.drag,spin:new THREE.Vector3(Math.sin(i*1.3)*6,Math.cos(i*.7)*6,Math.sin(i*2.1)*4)});
  }
 }
 /** Shutter: always flashes while held; makes a photo only when it matters. */
 shoot() {
  if(!this.camera.holder)return false;
  this.flashAge=0;this.hooks.sound('shutter');this.hooks.haptic(this.camera.holder,.7,60);
  if(this.stage!=='key'&&this.stage!=='rejected')return false;
  const early=this.stage==='key';
  const origin=this.camera.object.position, dir=new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.object.quaternion);
  const ray=new THREE.Ray(origin,dir), target=this.key.object.position;
  if(dir.dot(target.clone().sub(origin))<0||ray.distanceToPoint(target)>.5)return false;
  this.photo.reset();this.photo.body.setTranslation(origin.clone().addScaledVector(dir,.3),true);this.photo.sync();this.show(this.photo,true);this.photo.drop(new THREE.Vector3(0,.3,0));this.advance('photo');if(early)this.cue('clever-photo');return true;
 }
 /** A hand reached for the hanging box (it cannot be grabbed). */
 poke(point:THREE.Vector3|null) {
  if(!this.glass.visible||this.falling||this.stage==='silence')return false;
  if(point&&point.distanceTo(this.glass.position)>.4)return false;
  if(this.elapsed-this.lastPoke<12)return true;
  this.lastPoke=this.elapsed;this.hooks.bark('box-poke');return true;
 }
 /** A held hammer or sword struck the box: she says the glass won't break that way. */
 private glassStrike() {
  if(!this.glass.visible||this.falling||this.stage==='silence')return;
  const c=this.glass.position, near=(a:THREE.Vector3,b:THREE.Vector3)=>new THREE.Line3(a,b).closestPointToPoint(c,true,new THREE.Vector3()).distanceTo(c)<.3;
  const h=this.room.hammer;
  if(h.holder&&this.elapsed-this.lastGlassHammer>12&&near(h.object.localToWorld(new THREE.Vector3(0,0,-.22)),h.object.localToWorld(new THREE.Vector3(0,0,-.36)))){
   this.lastGlassHammer=this.elapsed;this.hooks.bark('glass-hammer');this.hooks.haptic(h.holder,.5,60);
  }
  for(const [s,tip] of [[this.room.reward,-.86],[this.room.wallSword,-.64]] as const){
   if(!s.holder||!s.object.visible||this.elapsed-this.lastGlassSword<=12)continue;
   if(near(s.object.localToWorld(new THREE.Vector3(0,0,-.15)),s.object.localToWorld(new THREE.Vector3(0,0,tip)))){
    this.lastGlassSword=this.elapsed;this.hooks.bark('glass-sword');this.hooks.haptic(s.holder,.5,60);
   }
  }
 }
 private spawnFire() {
  this.show(this.fire,true);this.fireEmerge=0;this.fireOut=false;this.fireT=0;
  this.placeFire(0);
  this.pulseRipple(null,new THREE.Vector3(0,-.1,0),0xffa43a,4);
  this.hooks.sound('portal');
  this.cue('released');
 }
 private placeFire(k:number) {
  const e=1-Math.pow(1-k,3);
  this.fire.body.setTranslation(this.painting.localToWorld(new THREE.Vector3(0,-.1,.02+.88*e)),true);this.fire.sync();
  this.fire.object.scale.setScalar(.25+.75*e);
 }
 private burnRope() {
  const holder=this.swordLit?this.room.reward.holder:this.fire.holder;
  this.rope.visible=false;this.show(this.fire,false);this.falling=true;
  this.hooks.sound('rope-snap');this.hooks.haptic(holder,1,140);
  const at=this.rope.position.clone();
  this.burst(at,26,i=>({color:i%3?0xff8a2a:0xffd36a,emissive:true,size:.02,velocity:new THREE.Vector3(Math.sin(i*2.4)*.5,.8+((i*37)%10)/10,Math.cos(i*2.4)*.5),life:1.2,drag:1.5}));
  this.advance('fire');
 }
 /** Accept direct hand/controller contact; desktop calls through the same gate. */
 touchFinale(point:THREE.Vector3,holder:Grabber|null=null){
  if(this.stage!=='helping'||!this.finale.touch(point))return false;
  this.hooks.haptic(holder,1,180);this.escape();return true;
 }
 private unlockPainting(){
  this.finale.begin();this.hooks.sound('portal');
  const run=this.run,spoken=this.advance('helping');
  const ready=()=>{if(this.run===run&&this.stage==='helping')this.finale.allowTouch();};
  if(spoken&&typeof spoken.then==='function')void spoken.then(ready,ready);else ready();
 }
 private escape() {
  this.finale.finish(this.room.drawing);
  this.rescueSeconds=this.elapsed-this.unmutedAt;
  this.hooks.sound('portal');this.hooks.sound('fanfare');this.hooks.haptic(null,1,250);
  const top=this.painting.localToWorld(new THREE.Vector3(0,.9,.3));
  this.burst(top,140,i=>{const a=i*2.399,r=.4+((i*53)%100)/100*1.4;return {color:CONFETTI[i%CONFETTI.length],size:.035,velocity:new THREE.Vector3(Math.cos(a)*r,1.2+((i*29)%10)/8,Math.abs(Math.sin(a))*r+.4).applyQuaternion(this.painting.getWorldQuaternion(new THREE.Quaternion())),life:7,drag:2.2};});
  const run=this.run;
  const spoken=this.advance('escaped');
  const showCard=()=>{if(this.run===run&&this.stage==='escaped')this.showEndCard();};
  if(spoken&&typeof spoken.then==='function')void spoken.then(showCard,showCard);else showCard();
 }
 private showEndCard() {
  if(this.endCard||typeof document==='undefined')return;
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const g=ctx.createLinearGradient(0,0,0,512);g.addColorStop(0,'#2a2140');g.addColorStop(1,'#151022');
  ctx.fillStyle=g;ctx.fillRect(0,0,1024,512);
  ctx.strokeStyle='#e2c068';ctx.lineWidth=10;ctx.strokeRect(14,14,996,484);ctx.lineWidth=2;ctx.strokeRect(32,32,960,448);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#f6d47a';ctx.font='bold 76px serif';ctx.fillText('The Princess Is Free!',512,140);
  const s=Math.max(0,Math.round(this.rescueSeconds??0));
  ctx.fillStyle='#fbe7b5';ctx.font='italic 46px serif';ctx.fillText(`Rescued in ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`,512,250);
  ctx.fillStyle='#cfc4e8';ctx.font='36px serif';ctx.fillText('Thank you for playing HERO',512,340);
  ctx.fillStyle='#9d93b8';ctx.font='28px serif';ctx.fillText('Press RESET on the pedestal to play again',512,415);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  this.endCard=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.6),new THREE.MeshBasicMaterial({map:tex,toneMapped:false,transparent:true,opacity:0}));
  this.endCard.position.set(0,-.95,.5);this.endCard.rotation.x=-.35;this.endCard.scale.setScalar(.01);
  this.painting.add(this.endCard);this.endCardAge=0;
 }
 private clearEndCard() {
  if(!this.endCard)return;
  this.endCard.removeFromParent();this.endCard.geometry.dispose();this.endCard.material.map?.dispose();this.endCard.material.dispose();this.endCard=null;this.endCardAge=-1;
 }
 update(dt:number) {
  this.elapsed+=dt;this.finale.update(dt);
  if(this.swordLit)this.swordFlame.scale.y=1+Math.sin(this.elapsed*14)*.15;
  if(this.fireDelay!==null){this.fireDelay-=dt;if(this.fireDelay<=0){this.fireDelay=null;this.spawnFire();}}
  if(this.room.wallSword.holder&&this.melting<0)this.melting=0;
  if(this.melting>=0){this.melting+=dt;this.room.wallSword.object.scale.z=Math.max(.03,1-Math.max(0,this.melting-1.2)/.8);if(this.melting>=2){this.room.wallSword.reset();this.room.wallSword.object.scale.setScalar(1);this.melting=-1;if(this.stage==='unmuted')this.advance('melted');}}
  // Drawing works whether or not they tried the wall sword first.
  if(this.stage==='unmuted'||this.stage==='melted'){
   if(this.strokesChanged()||this.board.drawing)this.drawingIdle=0;else this.drawingIdle+=dt;
   if(!this.board.drawing&&this.drawingIdle>=.65&&recognizeSword(this.board.strokes,BOARD_H).isSword){this.room.spawnReward();this.advance('drawn');}
  }
  const sword=this.room.reward.object;
  const blade=new THREE.Line3(sword.localToWorld(new THREE.Vector3(0,0,-.15)),sword.localToWorld(new THREE.Vector3(0,0,-.86)));
  if(this.stage==='drawn'&&this.room.reward.holder&&blade.closestPointToPoint(this.rope.position,true,new THREE.Vector3()).distanceTo(this.rope.position)<.6){
   const run=this.run;
   // The rope cue (she conjures a fireball) and the line start now; the
   // fireball leaves the canvas only after both the line and the picture
   // have caught up, so the painting already shows it in her hands.
   const spoken=this.advance('rope');
   const ready=()=>{if(this.run===run&&this.stage==='rope')this.fireDelay=1.5;};
   if(spoken&&typeof spoken.then==='function')void spoken.then(ready,ready);else ready();
  }
  // After the rope check, so a blade that reaches the rope starts that beat
  // (and she is talking) before any "sword-proof glass" quip.
  this.glassStrike();
  if(this.fireEmerge>=0){this.fireEmerge+=dt;const k=Math.min(1,this.fireEmerge/FIRE_EMERGE_S);this.placeFire(k);if(k>=1){this.fireEmerge=-1;this.fireOut=true;}}
  if(this.stage==='rope'&&this.fire.object.visible&&this.fireOut){
   if(this.fire.holder&&!this.fireCaught){this.fireCaught=true;this.hooks.sound('fire-catch');this.hooks.haptic(this.fire.holder,.6,90);}
   if(!this.fireCaught){this.fireT+=dt;this.fire.body.setTranslation(this.painting.localToWorld(new THREE.Vector3(Math.sin(this.fireT*1.3)*.7,-.1,.9)),true);this.fire.sync();}
   const p=this.fire.object.position, rope=this.rope.position;
   // Transfer the magic to the player's sword, whether the ball is floating or held.
   if(this.room.reward.holder&&blade.closestPointToPoint(p,true,new THREE.Vector3()).distanceTo(p)<.19){
    this.swordLit=true;this.swordFlame.visible=true;this.show(this.fire,false);this.hooks.sound('fire-catch');this.hooks.haptic(this.room.reward.holder,.8,100);
   } else if(this.fireCaught){
    // Swept contact also accepts a thrown fireball instead of requiring a held one.
    const contact=this.previousFire?new THREE.Line3(this.previousFire,p).closestPointToPoint(rope,true,new THREE.Vector3()):p;
    if(Math.abs(contact.y-rope.y)<.65&&Math.hypot(contact.x-rope.x,contact.z-rope.z)<.18)this.burnRope();
   }
   this.previousFire=p.clone();
  }
  if(this.stage==='rope'&&this.swordLit&&this.room.reward.holder&&blade.closestPointToPoint(this.rope.position,true,new THREE.Vector3()).distanceTo(this.rope.position)<.6)this.burnRope();
  if(this.falling){this.fallSpeed+=9.81*dt;this.glass.position.y-=this.fallSpeed*dt;this.key.body.setTranslation(this.glass.position,true);this.key.sync();if(this.glass.position.y<=.22){this.falling=false;this.glass.visible=false;this.key.drop();this.hooks.sound('portal-reject');this.advance('key');this.burst(this.glass.position.clone(),18,i=>({color:0xb8e8ff,size:.05,velocity:new THREE.Vector3(Math.sin(i*2.4),1.2,Math.cos(i*2.4)),life:Infinity,drag:0}));}}
  if(this.stage==='key'&&this.key.holder&&this.paintingContact(this.key)){
   const holder=this.key.holder;
   this.pulseRipple(this.key.object.position,null,0x83dfff);this.hooks.sound('portal-reject');this.hooks.haptic(holder,.8,120);
   this.key.release(holder,false);const normal=new THREE.Vector3(0,0,1).applyQuaternion(this.painting.getWorldQuaternion(new THREE.Quaternion()));this.key.drop(normal.multiplyScalar(1.5));this.advance('rejected');
  }
  if(this.stage==='photo'&&this.photo.holder&&this.paintingContact(this.photo)){
   this.hooks.haptic(this.photo.holder,1,150);
   this.pulseRipple(this.photo.object.position,null,0xf6d47a,9);
   this.show(this.photo,false);this.unlockPainting();
  }
  const holder=this.camera.holder;
  const shutter=!!holder?.source?.gamepad?.buttons[0]?.pressed;
  if(shutter&&!this.shutterDown)this.shoot();this.shutterDown=shutter;
  // Hand tracking: aim and pinch the camera's shutter with the free hand (handled by press).
  if(this.rippleAge>=0){this.rippleAge+=dt;this.ripple.scale.setScalar(1+this.rippleAge*this.rippleGrow);this.ripple.material.opacity=Math.max(0,1-this.rippleAge);}
  if(this.flashAge>=0){this.flashAge+=dt;const f=Math.max(0,1-this.flashAge/.25);this.flashLight.intensity=12*f;this.flashDisc.visible=f>0;this.flashDisc.material.opacity=f;if(f<=0)this.flashAge=-1;}
  if(this.endCard&&this.endCardAge>=0){this.endCardAge+=dt;const k=Math.min(1,this.endCardAge/.6),e=1-Math.pow(1-k,3);this.endCard.scale.setScalar(.01+.99*e);this.endCard.material.opacity=e;this.endCard.position.y=-.95+Math.sin(this.endCardAge*1.4)*.015;}
  for(let i=this.particles.length-1;i>=0;i--){
   const d=this.particles[i];d.life-=dt;
   d.velocity.y-=dt*9.81*(d.drag?.35:1);d.velocity.multiplyScalar(Math.max(0,1-d.drag*dt));
   d.mesh.position.addScaledVector(d.velocity,dt);
   if(d.drag){d.mesh.rotation.x+=d.spin.x*dt;d.mesh.rotation.y+=d.spin.y*dt;d.mesh.rotation.z+=d.spin.z*dt;}
   if(d.mesh.position.y<.025){d.mesh.position.y=.025;d.velocity.set(0,0,0);d.spin.set(0,0,0);}
   if(d.life<.5)d.mesh.scale.setScalar(Math.max(0,d.life/.5));
   if(d.life<=0)this.removeParticle(i);
  }
 }
 private removeParticle(i:number){const d=this.particles[i];d.mesh.removeFromParent();this.particles.splice(i,1);} // geometry + material are shared (particleGeo / particleMat)
 canGrab(t:PhysicalTool){
  if(t===this.fire)return this.fireOut;
  return t!==this.key||['key','rejected','photo','helping','escaped'].includes(this.stage);
 }
 reset(){this.finale.reset();this.swordLit=false;this.swordFlame.visible=false;this.drawingIdle=0;this.previousFire=null;this.run++;this.strokeSig='';this.fireDelay=null;this.stage='silence';this.elapsed=0;this.unmutedAt=0;this.rescueSeconds=null;this.melting=-1;this.falling=false;this.fallSpeed=0;this.fireCaught=false;this.fireEmerge=-1;this.fireOut=false;this.fireT=0;this.shutterDown=false;this.lastPoke=this.lastGlassHammer=this.lastGlassSword=-Infinity;this.rippleAge=-1;this.ripple.material.opacity=0;this.flashAge=-1;this.flashLight.intensity=0;this.flashDisc.visible=false;this.clearEndCard();this.glass.visible=this.rope.visible=true;this.glass.position.copy(this.glassHome);for(const t of [this.key,this.camera,this.photo,this.fire])t.reset();this.fire.object.scale.setScalar(1);this.show(this.key,true);this.show(this.camera,true);this.show(this.fire,false);this.show(this.photo,false);this.room.wallSword.object.scale.setScalar(1);for(let i=this.particles.length-1;i>=0;i--)this.removeParticle(i);}
 dispose(){this.finale.dispose();this.swordFlame.removeFromParent();const flameMats=new Set<THREE.Material>();this.swordFlame.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();flameMats.add(o.material);}});for(const m of flameMats)m.dispose();this.clearEndCard();this.ripple.removeFromParent();this.ripple.geometry.dispose();this.ripple.material.dispose();this.flashDisc.geometry.dispose();this.flashDisc.material.dispose();}
}
