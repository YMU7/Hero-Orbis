import * as THREE from 'three';
import type { Stroke } from './swordRecognizer';
import { disposeSketch } from './drawnSword';

/** Local effects guarantee the lock/hand/escape payoff even during a slow stream. */
export class RescueFinale {
  readonly group=new THREE.Group();
  readonly hand=new THREE.Group();
  readonly lock=new THREE.Group();
  private readonly key=new THREE.Group();
  readonly crown=new THREE.Group();
  private readonly cracks=new THREE.Group();
  private age=0;
  private escapeAge=-1;
  private ready=false;
  private trophy: THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>|null=null;
  private readonly wash=new THREE.Mesh(new THREE.PlaneGeometry(2.4,1.35),new THREE.MeshBasicMaterial({color:0xffedbb,transparent:true,opacity:0,depthWrite:false}));
  private readonly gold=new THREE.MeshBasicMaterial({color:0xffd76b});
  constructor(private painting:THREE.Group){
    painting.add(this.group);this.group.position.z=.075;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.12,.018,8,32),this.gold);this.lock.add(ring);
    const slot=new THREE.Mesh(new THREE.BoxGeometry(.035,.09,.015),this.gold);slot.position.y=-.055;this.lock.add(slot);
    this.lock.position.set(1.04,-.3,.03);this.group.add(this.lock);
    const keyRing=new THREE.Mesh(new THREE.TorusGeometry(.035,.01,6,20),this.gold);this.key.add(keyRing);
    const shaft=new THREE.Mesh(new THREE.BoxGeometry(.018,.11,.018),this.gold);shaft.position.y=-.07;this.key.add(shaft);
    const tooth=new THREE.Mesh(new THREE.BoxGeometry(.045,.018,.018),this.gold);tooth.position.set(.018,-.11,0);this.key.add(tooth);this.group.add(this.key);
    // A readable palm with five rounded fingers, rather than a generic button.
    const palm=new THREE.Mesh(new THREE.CircleGeometry(.09,24),this.gold);palm.scale.y=1.2;this.hand.add(palm);
    for(let i=0;i<4;i++){
      const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.019,.09+(i===1?.025:0),4,8),this.gold);
      finger.position.set((i-1.5)*.044,.115,0);this.hand.add(finger);
    }
    const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.025,.07,4,8),this.gold);thumb.rotation.z=-.7;thumb.position.set(-.105,.015,0);this.hand.add(thumb);
    this.hand.position.set(0,-.08,.08);this.group.add(this.hand);
    const band=new THREE.Mesh(new THREE.TorusGeometry(.13,.025,8,32),this.gold);band.rotation.x=Math.PI/2;this.crown.add(band);
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5;
      const point=new THREE.Mesh(new THREE.ConeGeometry(.045,.14,4),this.gold);point.position.set(Math.sin(a)*.12,.055,Math.cos(a)*.12);this.crown.add(point);
    }
    for(let i=0;i<12;i++){
      const x=(i%6)/5*2.3-1.15,y=i<6?.64:-.64;
      const path=new THREE.CurvePath<THREE.Vector3>();
      const a=new THREE.Vector3(x,y,.04),b=new THREE.Vector3(x+.04,y*.85,.04),c=new THREE.Vector3(x-.02,y*.65,.04);
      path.add(new THREE.LineCurve3(a,b));path.add(new THREE.LineCurve3(b,c));
      this.cracks.add(new THREE.Mesh(new THREE.TubeGeometry(path,4,.005,4,false),this.gold));
    }
    this.group.add(this.cracks,this.crown,this.wash);this.wash.position.z=.13;this.reset();
  }
  begin(){this.group.visible=true;this.lock.visible=true;this.age=0;}
  allowTouch(){this.ready=true;this.hand.visible=true;}
  get touchable(){return this.ready&&this.escapeAge<0;}
  touch(world:THREE.Vector3){return this.touchable&&this.hand.getWorldPosition(new THREE.Vector3()).distanceTo(world)<.23;}
  finish(strokes:readonly Stroke[]){
    this.ready=false;this.hand.visible=false;this.lock.visible=false;this.key.visible=false;this.escapeAge=0;this.crown.visible=true;
    if(typeof document==='undefined')return;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=576;
    const c=canvas.getContext('2d');if(!c)return;
    c.fillStyle='#faf1dc';c.fillRect(0,0,1024,576);c.strokeStyle='#c69a42';c.lineWidth=12;c.strokeRect(24,24,976,528);
    c.fillStyle='#533c62';c.textAlign='center';c.font='italic 32px serif';c.fillText('The Royal Gallery',512,80);
    c.font='22px serif';c.fillText('The masterpiece that brought me home.',512,520);
    const points=strokes.flat();
    if(points.length){
      const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      const s=Math.min(700/Math.max(.01,x1-x0),330/Math.max(.01,y1-y0));
      c.strokeStyle='#2b59c3';c.lineWidth=9;c.lineCap='round';c.lineJoin='round';
      for(const stroke of strokes){c.beginPath();stroke.forEach((p,i)=>{const x=512+(p.x-(x0+x1)/2)*s,y=295-(p.y-(y0+y1)/2)*s;if(i)c.lineTo(x,y);else c.moveTo(x,y);});c.stroke();}
    }
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
    this.trophy=new THREE.Mesh(new THREE.PlaneGeometry(2.4,1.35),new THREE.MeshBasicMaterial({map:tex}));this.trophy.position.z=.10;this.trophy.visible=false;this.group.add(this.trophy);
  }
  update(dt:number){
    if(!this.group.visible)return;this.age+=dt;
    this.lock.rotation.z=-Math.min(1,this.age/1.5)*Math.PI/2;
    this.key.visible=this.escapeAge<0;
    const travel=Math.min(1,this.age/.75);
    this.key.position.set(1.04*travel,-.3*travel,.08);this.key.rotation.z=-Math.max(0,Math.min(1,(this.age-.75)/.75))*Math.PI/2;
    this.cracks.visible=this.age>.7&&this.escapeAge<0;this.cracks.scale.y=Math.min(1,this.age/1.5);
    this.hand.scale.setScalar(1+Math.sin(this.age*3)*.04);
    if(this.escapeAge>=0){
      this.escapeAge+=dt;const t=this.escapeAge;
      this.wash.material.opacity=t<.3?t/.3:Math.max(0,1-(t-.3)/1.2);
      if(this.trophy)this.trophy.visible=t>=.3;
      // A little crown tumbles out of the same plane as her earlier fireball.
      const floor=this.group.worldToLocal(new THREE.Vector3(0,.15,0)).y;
      const y=Math.max(floor,-.1-Math.max(0,t-.5)**2*2);
      this.crown.position.set(.35,y,.2+Math.min(1,t)*.9);
      if(y>floor)this.crown.rotation.set(t*2,0,t);
    }
  }
  reset(){this.ready=false;this.escapeAge=-1;this.age=0;this.group.visible=false;this.hand.visible=false;this.lock.visible=false;this.crown.visible=false;this.wash.material.opacity=0;if(this.trophy){this.trophy.material.map?.dispose();disposeSketchMesh(this.trophy);this.trophy=null;}}
  dispose(){this.reset();disposeSketch(this.group);}
}
function disposeSketchMesh(mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}
