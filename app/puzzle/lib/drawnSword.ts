import * as THREE from 'three';
import type { Stroke } from './swordRecognizer';

/** Freeze the accepted artwork; clearing the easel must not erase the reward. */
export const copyDrawing = (strokes: readonly Stroke[]): Stroke[] => strokes.map(s => s.map(p => ({ ...p })));

/** Crayon strokes become a lightweight, double-sided solid sketch. The fixed
 * forgiving physics blade is independent of the player's wobbles. */
export function makeDrawnSword(strokes: readonly Stroke[]) {
  const group = new THREE.Group(); group.name = 'player-drawn-sword';
  const points = strokes.flat();
  if (points.length < 2) return group;
  // Longest end-to-end stroke supplies the blade direction, even sideways.
  const longest = strokes.filter(s => s.length > 1).reduce((a,b) =>
    new THREE.Vector2(a.at(-1)!.x-a[0].x,a.at(-1)!.y-a[0].y).lengthSq() >
    new THREE.Vector2(b.at(-1)!.x-b[0].x,b.at(-1)!.y-b[0].y).lengthSq() ? a : b);
  const axis = new THREE.Vector2(longest.at(-1)!.x-longest[0].x,longest.at(-1)!.y-longest[0].y).normalize();
  if (axis.lengthSq() === 0) axis.set(0,1);
  const others=strokes.filter(s=>s!==longest).flat();
  if(others.length){
    const center=others.reduce<THREE.Vector2>((v,p)=>v.add(new THREE.Vector2(p.x,p.y)),new THREE.Vector2()).multiplyScalar(1/others.length);
    const mid=new THREE.Vector2(longest[0].x+longest.at(-1)!.x,longest[0].y+longest.at(-1)!.y).multiplyScalar(.5);
    if(center.sub(mid).dot(axis)>0)axis.negate();
  } else if(axis.y<0)axis.negate();
  const side=new THREE.Vector2(axis.y,-axis.x);
  const along=points.map(p=>axis.x*p.x+axis.y*p.y), across=points.map(p=>side.x*p.x+side.y*p.y);
  const min=Math.min(...along), span=Math.max(.01,Math.max(...along)-min), center=(Math.min(...across)+Math.max(...across))/2;
  // Uniform scale preserves the drawing's proportions. Keep broad sketches in reach.
  const scale=Math.min(.82/span,.65/Math.max(.01,Math.max(...across)-Math.min(...across)));
  const ink=new THREE.MeshStandardMaterial({color:0x2b59c3,emissive:0x183878,emissiveIntensity:.25,roughness:.85});
  const budget=Math.max(2,Math.floor(500/Math.max(1,strokes.length)));
  for(const stroke of strokes){
    if(stroke.length<2)continue;
    const count=Math.min(stroke.length,budget);
    const path=Array.from({length:count},(_,i)=>{
      const p=stroke[Math.round(i*(stroke.length-1)/(count-1))];
      return new THREE.Vector3((p.x*side.x+p.y*side.y-center)*scale,0,-.02-(p.x*axis.x+p.y*axis.y-min)*scale);
    }).filter((p,i,a)=>i===0||p.distanceToSquared(a[i-1])>1e-10);
    if(path.length<2)continue;
    const curve=new THREE.CurvePath<THREE.Vector3>();
    for(let i=1;i<path.length;i++)curve.add(new THREE.LineCurve3(path[i-1],path[i]));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,Math.min(160,path.length*2),.009,5,false),ink));
  }
  // A little crayon hilt makes even a single-stroke blade read as a sword.
  // It meets the drawing's base at z=-.02, with the grip at the hand origin.
  const gold=new THREE.MeshStandardMaterial({color:0xe0b850,roughness:.85});
  const hiltStroke=(name:string,coords:number[][],radius:number,material:THREE.Material)=>{
    const curve=new THREE.CurvePath<THREE.Vector3>();
    const path=coords.map(([x,z])=>new THREE.Vector3(x,0,z));
    for(let i=1;i<path.length;i++)curve.add(new THREE.LineCurve3(path[i-1],path[i]));
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,coords.length*4,radius,6,false),material);
    mesh.name=name;group.add(mesh);
  };
  hiltStroke('doodle-sword-grip',[[0,-.02],[.003,.025],[-.003,.07],[0,.11]],.018,ink);
  hiltStroke('doodle-sword-crossguard',[[-.11,-.035],[-.065,-.02],[0,-.02],[.065,-.02],[.11,-.035]],.015,gold);
  hiltStroke('doodle-sword-pommel',[[-.02,.11],[0,.13],[.02,.11],[0,.095],[-.02,.11]],.01,gold);
  return group;
}

export function disposeSketch(group: THREE.Group) {
  const materials=new Set<THREE.Material>();
  group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
  for(const m of materials)m.dispose();
  group.removeFromParent();
}
