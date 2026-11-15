const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { initToolPhysics, ToolPhysics } = require('../app/puzzle/lib/toolPhysics.ts');
const { UnityRoom } = require('../app/puzzle/lib/unityRoom.ts');
const { HandInput } = require('../app/puzzle/lib/handInput.ts');
const { RoomMovement } = require('../app/puzzle/lib/roomMovement.ts');
const grabber = (p = new THREE.Vector3()) => ({ index: 0, kind: 'hand', source: null, pinching: true, point: p.clone(), dir: new THREE.Vector3(0, 0, -1), poke: p.clone(), tracked: true, label: 'left hand' });

test('tools unmount, cannot be stolen, fall onto furniture, and release safely on tracking loss', async () => {
  await initToolPhysics();
  const physics = new ToolPhysics();
  try {
    const object = new THREE.Group(); object.position.set(0, 1.4, 0);
    const tool = physics.add(object, new THREE.Vector3(0.05, 0.05, 0.05));
    const table = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1)); table.position.y = 0.8;
    physics.addStatic(table);
    for (let i = 0; i < 90; i++) physics.update(1 / 90);
    assert.ok(Math.abs(object.position.y - 1.4) < 1e-5, 'wall mount holds until grab');
    const g = grabber(object.position);
    assert.equal(tool.tryGrab(g), true);
    assert.equal(tool.tryGrab(grabber(object.position)), false, 'exclusive ownership');
    physics.update(1 / 90);
    tool.release(g);
    for (let i = 0; i < 180; i++) physics.update(1 / 90);
    assert.ok(object.position.y > 0.89 && object.position.y < 0.93, `rests on table: ${object.position.y}`);
    g.point.copy(object.position); assert.equal(tool.tryGrab(g), true, 'dropped tool can be regrabbed');
    g.tracked = false; physics.update(1 / 90);
    assert.equal(tool.holder, null, 'tracking loss releases immediately');
    assert.ok(Math.abs(tool.body.linvel().x) < 0.01, 'tracking loss never throws');
    physics.reset(); assert.ok(Math.abs(object.position.y - 1.4) < 1e-5);
  } finally { physics.dispose(); }
});

test('rescue follows player actions, rejects shortcuts, and resets every prop', async () => {
 await initToolPhysics();
 const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const board={strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)};
 const events=[],sounds=[];
 const room=new UnityRoom(physics,painting,board,on=>sounds.push(on),beat=>events.push(beat.id));
 const r=room.rescue;
 const move=(tool,p,q=new THREE.Quaternion())=>{tool.body.setTranslation(p,true);tool.body.setRotation(q,true);tool.sync();};
 const grab=tool=>{const g=grabber(tool.object.position);g.rotation=new THREE.Quaternion();assert.equal(tool.tryGrab(g),true);return g;};
 try {
  board.strokes.push([{x:0,y:0},{x:.0002,y:0}]);room.update(.01);assert.equal(room.reward.object.visible,false,'scribble cannot spawn sword');
  assert.equal(r.canGrab(r.key),false,'key remains inside glass');
  room.desktopStrike();assert.equal(r.stage,'unmuted');assert.deepEqual(sounds,[true]);
  grab(room.wallSword);room.update(1.99);assert.equal(r.stage,'unmuted');room.update(.02);assert.equal(r.stage,'melted');assert.equal(room.wallSword.holder,null);
  const line=(ax,ay,bx,by)=>Array.from({length:31},(_,i)=>({x:ax+(bx-ax)*i/30,y:ay+(by-ay)*i/30}));
  board.strokes=[line(0,-.15,0,.15),line(-.05,-.1,.05,-.1)];room.update(.01);room.update(.66);assert.equal(r.stage,'drawn');assert.equal(room.reward.object.visible,true);
  const lensDirection=new THREE.Vector3(0,0,-1).applyQuaternion(r.camera.object.quaternion);
  // Octagon layout: the portrait box sits on the front-left table with its
  // lens level and turned toward the player's start (the origin when the
  // painting is at its default (0, 1.75, -2.55)), i.e. away from the wall.
  const boxHome=r.camera.object.position.clone().add(new THREE.Vector3(0,1.75,-2.55).sub(painting.position));
  const toStart=new THREE.Vector3(-boxHome.x,0,-boxHome.z).normalize();
  assert.ok(Math.abs(lensDirection.y)<1e-6&&lensDirection.dot(toStart)>.99,'portrait box lens faces the player start');
  grab(room.reward);move(room.reward,r.rope.position.clone().add(new THREE.Vector3(0,0,.45)));room.update(.01);
  assert.equal(r.stage,'rope');assert.equal(r.fire.object.visible,true,'appears immediately when no dialogue is pending');
  assert.equal(r.canGrab(r.fire),false,'fireball is still leaving the canvas');
  assert.ok(painting.worldToLocal(r.fire.object.position.clone()).z<.2,'fireball starts at the painting surface');
  room.update(1);assert.equal(r.canGrab(r.fire),true,'fireball is out in the room');
  room.update(5);assert.equal(r.stage,'rope','the reaction line waits for the burn, not a timer');
  grab(r.fire);move(r.fire,r.rope.position);room.update(.01);assert.equal(r.rope.visible,false);assert.equal(r.stage,'fire');
  for(let i=0;i<120;i++)room.update(1/90);
  assert.equal(r.stage,'key');assert.equal(r.glass.visible,false);assert.equal(r.canGrab(r.key),true);
  grab(r.key);move(r.key,painting.localToWorld(new THREE.Vector3(0,0,.1)));room.update(.01);assert.equal(r.stage,'rejected');assert.equal(r.key.holder,null);
  grab(r.camera);move(r.camera,new THREE.Vector3(0,1,1));move(r.key,new THREE.Vector3(.3,1,0));assert.equal(r.shoot(),true,'generous camera hitbox');assert.equal(r.stage,'photo');assert.equal(r.shoot(),false,'no duplicate photo');
  grab(r.photo);move(r.photo,painting.localToWorld(new THREE.Vector3(0,0,.1)));room.update(.01);assert.equal(r.stage,'helping');assert.equal(r.photo.object.visible,false);
  assert.equal(r.touchFinale(r.finale.hand.getWorldPosition(new THREE.Vector3())),true);assert.equal(r.stage,'escaped');
  assert.deepEqual(events,['unmuted','melted','drawn','rope','released','fire','key','rejected','photo','helping','escaped']);
  assert.ok(r.rescueSeconds!==null&&r.rescueSeconds>0,'rescue time measured from breaking the silence');
  physics.reset();room.reset();assert.equal(r.stage,'silence');assert.equal(r.glass.visible,true);assert.equal(r.rope.visible,true);assert.equal(r.fire.object.visible,false);assert.equal(room.reward.object.visible,false);
  assert.ok(new THREE.Vector3(0,0,-1).applyQuaternion(r.camera.object.quaternion).dot(lensDirection)>.99,'reset keeps camera facing player');
 } finally {room.dispose();physics.dispose();}
});

test('all five rack swords grab, shrink, and return to their slots', async () => {
 await initToolPhysics();const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const room=new UnityRoom(physics,painting,{strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)},()=>{});
 try {
  assert.equal(room.rackSwords.length,5);assert.equal(physics.tools.some(t=>t.object.name==='hip-sword'),false);
  room.desktopStrike();
  for(const tool of room.rackSwords){
   const home=tool.object.position.clone(),g=grabber(tool.object.localToWorld(new THREE.Vector3(0,0,-.3)));
   assert.equal(room.tryGrab(g,null),true);assert.equal(tool.holder,g);
   room.update(1.6);assert.ok(Math.abs(tool.object.scale.z-.5)<1e-5);
   room.update(.41);assert.equal(tool.holder,null);assert.equal(tool.object.scale.z,1);
   assert.ok(tool.object.position.distanceTo(home)<1e-5);
  }
  assert.equal(room.rescue.stage,'melted');
  for(const tool of room.rackSwords)assert.equal(tool.tryGrab(grabber(tool.object.position)),true);
  room.update(1.6);assert.ok(room.rackSwords.every(t=>t.object.scale.z<1));
  physics.reset();room.reset();assert.ok(room.rackSwords.every(t=>t.object.scale.z===1&&!t.holder));
 } finally {room.dispose();physics.dispose();}
});

test('camera lens faces forward with an upright XR grip', async () => {
 await initToolPhysics();const physics=new ToolPhysics(),painting=new THREE.Group();
 const room=new UnityRoom(physics,painting,{strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)},()=>{}),tool=room.rescue.camera;
 try {
  for(const kind of ['hand','controller'])for(const yaw of [0,.7,-1.2]){
   const g=grabber(tool.object.position);g.kind=kind;
   const facing=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
   g.rotation=facing.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
   assert.equal(tool.tryGrab(g),true);physics.update(1/90);
   assert.ok(new THREE.Vector3(0,0,-1).applyQuaternion(tool.object.quaternion).distanceTo(new THREE.Vector3(0,0,-1).applyQuaternion(facing))<1e-5);
   assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(tool.object.quaternion).y>.999);tool.reset();
  }
  const g=grabber(tool.object.position);g.index=-1;g.rotation=new THREE.Quaternion();tool.tryGrab(g);physics.update(1/90);
  assert.ok(tool.object.quaternion.angleTo(g.rotation)<1e-5,'desktop still aims along view');
 } finally {room.dispose();physics.dispose();}
});

test('fireball waits for dialogue completion and reset cancels pending appearance', async () => {
 await initToolPhysics();
 const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const board={strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)};
 let finish;
 const room=new UnityRoom(physics,painting,board,()=>{},beat=>beat.id==='rope'?new Promise(resolve=>{finish=resolve;}):undefined);
 const r=room.rescue;
 const trigger=()=>{
  r.stage='drawn';room.spawnReward();
  const g=grabber(room.reward.object.position);g.rotation=new THREE.Quaternion();room.reward.tryGrab(g);
  room.reward.body.setTranslation(r.rope.position.clone().add(new THREE.Vector3(0,0,.45)),true);room.reward.sync();room.update(.01);
 };
 try {
  trigger();room.update(30);assert.equal(r.fire.object.visible,false,'waits for actual audio ending');
  finish();await Promise.resolve();
  assert.equal(r.fire.object.visible,true,'appears at dialogue completion without an extra delay');
  room.reset();trigger();room.reset();finish();await Promise.resolve();room.update(30);
  assert.equal(r.stage,'silence');assert.equal(r.fire.object.visible,false,'old audio cannot restart sequence after reset');
 } finally {room.dispose();physics.dispose();}
});

test('drawn sword emerges from the canvas, hovers, and repeats the emergence on release', async () => {
 await initToolPhysics();
 const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const mesh=new THREE.Group();mesh.position.set(1,1.3,-2);mesh.rotation.y=.6;mesh.updateMatrixWorld(true);
 const board={strokes:[[{x:0,y:0},{x:0,y:.2}]],mesh,boardToWorld:(p,z=0)=>mesh.localToWorld(new THREE.Vector3(p.x,p.y,z))};
 const room=new UnityRoom(physics,painting,board,()=>{});
 const local=()=>mesh.worldToLocal(room.reward.object.position.clone());
 const emergence=()=>{
  assert.ok(Math.abs(local().z-.025)<1e-5,'starts at canvas surface');
  room.update(.2);assert.ok(local().z>.025&&local().z<.325,'floats outward gradually');
  room.update(.6);assert.ok(Math.abs(local().z-.325)<1e-5,'stops about a foot from canvas even when a frame overshoots');
  const home=room.reward.object.position.clone(),q=room.reward.object.quaternion.clone();
  let minY=Infinity,maxY=-Infinity;
  for(let i=0;i<270;i++){
   physics.update(1/90);room.update(1/90);
   const p=room.reward.object.position;
   minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
   assert.ok(Math.abs(p.x-home.x)<1e-5&&Math.abs(p.z-home.z)<1e-5,'bob stays a foot from canvas');
   assert.ok(Math.abs(p.y-home.y)<=.02001,'bob stays gentle and resists gravity');
  }
  assert.ok(maxY-home.y>.019&&home.y-minY>.019,'hover bobs both up and down');
  assert.ok(room.reward.object.position.distanceTo(home)<1e-5,'bob completes a smooth three-second cycle');
  assert.ok(room.reward.object.quaternion.angleTo(q)<1e-5,'hover keeps sword upright');
 };
 try {
  room.spawnReward();emergence();
  for(const tracked of [true,false]){
   const g=grabber(room.reward.object.position);g.rotation=new THREE.Quaternion();
   assert.equal(room.reward.tryGrab(g),true);
   g.point.add(new THREE.Vector3(.5,.2,.5));physics.update(1/90);room.update(.01);
   assert.ok(room.reward.object.position.distanceTo(g.point)<1e-5,'held sword follows hand without bobbing');
   g.tracked=tracked;physics.release(g);emergence();
  }
  room.reward.drop(new THREE.Vector3(0,-5,0));emergence();
  room.reward.drop();room.reset();room.update(1);
  assert.equal(room.reward.object.visible,false,'puzzle reset cancels emergence');
 } finally {room.dispose();physics.dispose();}
});

test('both swords can be grabbed along the blade and dropped props return', async () => {
 await initToolPhysics();
 const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const board={strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)};
 const room=new UnityRoom(physics,painting,board,()=>{});
 try {
  room.spawnReward();
  for(const tool of [...room.rackSwords,room.reward]){
   for(const z of [-.2,-.4,tool===room.reward?-.84:-.62]){
    const point=tool.object.localToWorld(new THREE.Vector3(0,0,z));
    const g=grabber(point);assert.equal(tool.tryGrab(g),true,'hand can grab blade through tip');tool.reset();
    const ray=new THREE.Ray(point.clone().add(new THREE.Vector3(0,0,1)),new THREE.Vector3(0,0,-1));
    const controller={...grabber(new THREE.Vector3(10,10,10)),kind:'controller'};
    assert.equal(tool.tryGrab(controller,ray),true,`controller can target blade ${tool.object.name} ${z} at ${point.toArray()}`);tool.reset();
   }
  }
  const tool=room.rescue.camera, home=tool.object.position.clone(),homeQ=tool.object.quaternion.clone();
  tool.drop();tool.body.setTranslation({x:0,y:.12,z:0},true);tool.sync();tool.returnFromFloor();
  assert.ok(tool.object.position.distanceTo(home)<1e-5);assert.ok(tool.object.quaternion.angleTo(homeQ)<1e-5);
  assert.equal(tool.body.isFixed(),true,'returned prop stays on its mount');
  room.reward.drop();room.update(.7);
  assert.equal(room.reward.body.isFixed(),true,'drawn sword returns to hovering');
  const strands=room.rescue.rope.children.filter(o=>o.name==='hemp-rope-strand');assert.equal(strands.length,3);
  const bounds=new THREE.Box3().setFromObject(room.rescue.rope);assert.ok(bounds.max.y>=3.19,'rope reaches ceiling');
 } finally {room.dispose();physics.dispose();}
});

test('sword recognition accepts rough VR drawings while ignoring taps and tiny scribbles', () => {
 const { recognizeSword }=require('../app/puzzle/lib/swordRecognizer.ts');
 const line=(ax,ay,bx,by)=>Array.from({length:21},(_,i)=>({x:ax+(bx-ax)*i/20,y:ay+(by-ay)*i/20}));
 const shapes=[
  [line(0,0,0,.10)], // a small blade, no guard
  [line(0,-.1,0,.1),line(-.07,-.1,.07,-.1)], // T
  [line(0,-.1,0,.1),line(-.07,0,.07,0)], // centred cross
  [[{x:0,y:-.12},{x:.03,y:.02},{x:0,y:.14},{x:-.03,y:.02},{x:0,y:-.12}]], // one-stroke outline
  [Array.from({length:30},(_,i)=>({x:Math.sin(i*2)*.012,y:i*.006}))], // shaky blade
  [line(0,-.12,0,.12),line(.015,-.08,.06,-.04)], // guard doesn't quite connect
  [line(0,0,0,.10),line(-.3,-.2,.3,.2),line(-.3,.2,.3,-.2)], // extra ink never disqualifies a line
 ];
 for(const shape of shapes)for(const angle of [0,.7,Math.PI/2]){
  const rotated=shape.map(stroke=>stroke.map(p=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)})));
  assert.equal(recognizeSword(rotated,.55).isSword,true,'rough sword accepted regardless of orientation');
 }
 assert.equal(recognizeSword([],.55).isSword,false);
 assert.equal(recognizeSword([[{x:0,y:0}]],.55).isSword,false);
 assert.equal(recognizeSword([line(0,0,.005,.005)],.55).isSword,false);
});

test('easel eraser clears only on held canvas contact and returns after a floor drop', async () => {
 const { Eraser }=require('../app/puzzle/lib/eraser.ts');
 await initToolPhysics();const physics=new ToolPhysics();
 const mount=new THREE.Group();mount.position.y=1.3;
 let hits=0;
 const eraser=new Eraser(physics,mount,{worldToBoard:world=>({inside:Math.abs(world.x)<.35&&Math.abs(world.y-1.3)<.275,z:world.z})},()=>hits++);
 try {
  const home=eraser.object.position.clone();assert.ok(home.x<-.35,'mounted beside canvas');
  eraser.update();assert.equal(hits,0,'mounted eraser does not clear');
  const g=grabber(home);assert.equal(eraser.tool.tryGrab(g),true);
  eraser.object.position.set(0,1.3,.03);eraser.update();eraser.update();assert.equal(hits,1,'one clear per contact');
  eraser.object.position.z=.2;eraser.update();eraser.object.position.z=.03;eraser.update();assert.equal(hits,2);
  eraser.tool.release(g,false);eraser.tool.body.setTranslation({x:0,y:.035,z:0},true);eraser.tool.sync();eraser.tool.returnFromFloor();
  assert.ok(eraser.object.position.distanceTo(home)<1e-5,'dropped eraser returns to easel');
 } finally {physics.dispose();}
});

test('hand pinches use hysteresis and require opening after loss of tracking', () => {
  const make = () => new THREE.Group();
  const rays = [make(), make()], grips = [make(), make()], hands = [make(), make()];
  for (const h of hands) h.joints = {};
  const scene = new THREE.Scene(); let grabs = 0, releases = 0;
  const input = new HandInput({ scene, renderer: { xr: { getController: (i) => rays[i], getControllerGrip: (i) => grips[i], getHand: (i) => hands[i] } }, onPinchStart: () => grabs++, onPinchEnd: () => releases++ });
  try {
    for (const name of ['thumb-tip', 'index-finger-tip', 'wrist']) { const joint = make(); joint.jointRadius = 0.008; hands[0].joints[name] = joint; hands[0].add(joint); }
    const index = hands[0].joints['index-finger-tip'];
    const tick = (distance) => { index.position.x = distance; scene.updateMatrixWorld(true); input.update(); };
    rays[0].dispatchEvent({ type: 'connected', data: { hand: {}, handedness: 'left', profiles: ['generic-hand'] } });
    tick(0.02); assert.equal(grabs, 0, 'start closed cannot grab');
    tick(0.06); tick(0.02); assert.equal(grabs, 1);
    tick(0.035); assert.equal(releases, 0, 'jitter does not release');
    hands[0].visible = false; tick(0.02); assert.equal(releases, 1);
    hands[0].visible = true; tick(0.02); assert.equal(grabs, 1, 'tracking restoration while closed cannot regrab');
    tick(0.06); tick(0.02); assert.equal(grabs, 2);
    rays[0].dispatchEvent({ type: 'disconnected' }); assert.equal(releases, 2);
  } finally { input.dispose(); }
});

test('smooth turn is frame-rate independent, respects the dead zone, and pivots about the tracked head', () => {
  global.window = { addEventListener() {}, removeEventListener() {} };
  const simulate = (rate, axis) => {
    const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
    camera.position.set(0.3, 1.6, 0.2); rig.add(camera); rig.updateMatrixWorld(true);
    const renderer = { xr: { isPresenting: true, getCamera: () => camera, getSession: () => ({ inputSources: [{ handedness: 'right', gamepad: { axes: [0, 0, axis, 0] } }] }) } };
    const movement = new RoomMovement(rig, camera, renderer);
    try {
      for (let i = 0; i < rate; i++) { rig.updateMatrixWorld(true); movement.update(1 / rate); }
      rig.updateMatrixWorld(true);
      assert.ok(camera.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(0.3, 1.6, 0.2)) < 1e-6, 'head position stays fixed while turning');
      return rig.rotation.y;
    } finally { movement.dispose(); }
  };
  assert.ok(Math.abs(simulate(90, 1) + Math.PI / 2) < 1e-6);
  assert.ok(Math.abs(simulate(60, 1) - simulate(90, 1)) < 1e-6);
  assert.equal(simulate(90, 0.1), 0, 'stick drift does not turn');
  delete global.window;
});

test('drawn artwork waits for pen-up, survives erasing, and resets cleanly', async () => {
 await initToolPhysics();const physics=new ToolPhysics(),painting=new THREE.Group();
 const board={drawing:true,strokes:[[{x:0,y:-.15},{x:.02,y:0},{x:0,y:.15}]],boardToWorld:()=>new THREE.Vector3(0,1.3,0)};
 const room=new UnityRoom(physics,painting,board,()=>{});
 try {
  room.rescue.unmute();room.update(1);room.update(1);assert.equal(room.reward.object.visible,false,'never materializes mid-stroke');
  board.drawing=false;room.update(.7);assert.equal(room.rescue.stage,'drawn');
  const sketch=room.reward.object.getObjectByName('player-drawn-sword');assert.ok(sketch.children.length>0,'actual strokes create geometry');
  const accepted=JSON.stringify(room.drawing);board.strokes[0][1].x=8;board.strokes.length=0;
  assert.equal(JSON.stringify(room.drawing),accepted,'reward is a deep snapshot');
  room.reset();assert.equal(room.reward.object.getObjectByName('player-drawn-sword'),undefined);assert.deepEqual(room.drawing,[]);
 } finally {room.dispose();physics.dispose();}
});

test('fireball can ignite the drawn sword and the burning blade frees the key', async () => {
 await initToolPhysics();const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const board={strokes:[[{x:0,y:-.15},{x:0,y:.15}]],boardToWorld:()=>new THREE.Vector3(0,1.3,0)};
 const room=new UnityRoom(physics,painting,board,()=>{});const r=room.rescue;
 try {
  room.spawnReward();r.stage='rope';r.spawnFire();room.update(1);
  const g=grabber(room.reward.object.position);room.reward.tryGrab(g);
  const fire=r.fire.object.position.clone();
  room.reward.body.setTranslation(fire.add(new THREE.Vector3(0,0,.4)),true);room.reward.body.setRotation(new THREE.Quaternion(),true);room.reward.sync();
  room.update(.001);assert.equal(r.swordLit,true);assert.equal(r.fire.object.visible,false);assert.equal(r.stage,'rope');
  room.reward.body.setTranslation(r.rope.position.clone().add(new THREE.Vector3(0,0,.4)),true);room.reward.sync();room.update(.01);
  assert.equal(r.stage,'fire');assert.equal(r.rope.visible,false);
  room.reset();assert.equal(r.swordLit,false);
 } finally {room.dispose();physics.dispose();}
});

test('a thrown fireball crosses the rope without needing to stay held', async () => {
 await initToolPhysics();const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const board={strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)};
 const room=new UnityRoom(physics,painting,board,()=>{}),r=room.rescue;
 try {
  r.stage='rope';r.spawnFire();room.update(1);
  const g=grabber(r.fire.object.position);r.fire.tryGrab(g);room.update(.01);r.fire.release(g,false);
  r.fire.body.setTranslation(r.rope.position.clone().add(new THREE.Vector3(-.4,0,0)),true);r.fire.sync();room.update(.01);
  r.fire.body.setTranslation(r.rope.position.clone().add(new THREE.Vector3(.4,0,0)),true);r.fire.sync();room.update(.01);
  assert.equal(r.stage,'fire','swept collision accepts the crossing');
 } finally {room.dispose();physics.dispose();}
});

test('early key photo succeeds and final hand touch waits for speech; reset cancels it', async () => {
 await initToolPhysics();const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
 const board={strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)};
 const events=[];let finish;
 const room=new UnityRoom(physics,painting,board,()=>{},b=>{events.push(b.id);if(b.id==='helping')return new Promise(resolve=>finish=resolve);}),r=room.rescue;
 const photoContact=()=>{const g=grabber(r.photo.object.position);assert.equal(r.photo.tryGrab(g),true);r.photo.body.setTranslation(painting.localToWorld(new THREE.Vector3(0,0,.1)),true);r.photo.sync();room.update(.01);};
 try {
  r.stage='key';const g=grabber(r.camera.object.position);r.camera.tryGrab(g);
  r.camera.body.setTranslation({x:0,y:1,z:1},true);r.camera.body.setRotation(new THREE.Quaternion(),true);r.camera.sync();r.key.body.setTranslation({x:0,y:1,z:0},true);r.key.sync();
  assert.equal(r.shoot(),true);assert.equal(r.stage,'photo');assert.ok(events.includes('clever-photo'));assert.equal(events.includes('rejected'),false);
  photoContact();assert.equal(r.stage,'helping');assert.equal(r.touchFinale(r.finale.hand.getWorldPosition(new THREE.Vector3())),false);
  finish();await Promise.resolve();assert.equal(r.touchFinale(r.finale.hand.getWorldPosition(new THREE.Vector3())),true);assert.equal(r.stage,'escaped');
  room.reset();r.stage='photo';r.photo.object.visible=true;r.photo.body.setEnabled(true);photoContact();
  room.reset();finish();await Promise.resolve();assert.equal(r.finale.touchable,false);assert.equal(r.stage,'silence');
 } finally {room.dispose();physics.dispose();}
});


test('fireball preparation overlaps Orbis, then catch dialogue gates spawning and reset cancels it', async () => {
 const { playFireballDialogue }=require('../app/puzzle/lib/fireballDialogue.ts');
 const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 await initToolPhysics();
 for(const transitionFirst of [true,false]){
  const physics=new ToolPhysics(),painting=new THREE.Group();painting.position.y=1.8;
  const transition=deferred(),preparation=deferred(),catchLine=deferred(),calls=[];
  let current=true;
  const speak=(id,text)=>{calls.push({id,text});return id==='rope'?preparation.promise:catchLine.promise;};
  const room=new UnityRoom(physics,painting,{strokes:[],boardToWorld:()=>new THREE.Vector3(0,1.3,0)},()=>{},beat=>beat.id==='rope'?playFireballDialogue(transition.promise,speak,()=>current):undefined);
  try {
   room.spawnReward();room.rescue.stage='drawn';
   const tool=room.reward;tool.tryGrab(grabber(tool.object.position));
   tool.body.setTranslation(room.rescue.rope.position.clone().add(new THREE.Vector3(0,0,.45)),true);tool.sync();room.update(.01);
   assert.deepEqual(calls.map(c=>c.id),['rope'],'preparation dialogue starts during transition');
   (transitionFirst?transition:preparation).resolve();await flush();
   assert.equal(calls.length,1,'both transition and first line must finish');
   assert.equal(room.rescue.fire.object.visible,false);
   (transitionFirst?preparation:transition).resolve();await flush();
   assert.deepEqual(calls.map(c=>c.id),['rope','catch-fireball']);
   assert.equal(calls[1].text,'Catch my fireball!');
   room.update(30);assert.equal(room.rescue.fire.object.visible,false,'never spawns while catch line plays');
   catchLine.resolve();await flush();assert.equal(room.rescue.fire.object.visible,true,'spawns exactly after catch line');
  } finally {current=false;room.dispose();physics.dispose();}
 }
 const transition=deferred(),preparation=deferred(),calls=[];let current=true;
 const done=playFireballDialogue(transition.promise,(id)=>{calls.push(id);return preparation.promise;},()=>current);
 current=false;transition.resolve();preparation.resolve();await done;
 assert.deepEqual(calls,['rope'],'reset prevents a stale catch line');
});
