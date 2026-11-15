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
  board.strokes=[line(0,-.15,0,.15),line(-.05,-.1,.05,-.1)];room.update(.01);assert.equal(r.stage,'drawn');assert.equal(room.reward.object.visible,true);
  grab(room.reward);move(room.reward,r.rope.position.clone().add(new THREE.Vector3(0,0,.45)));room.update(.01);assert.equal(r.stage,'fire');assert.equal(r.fire.object.visible,true);
  grab(r.fire);move(r.fire,r.rope.position);room.update(.01);assert.equal(r.rope.visible,false);
  for(let i=0;i<120;i++)room.update(1/90);
  assert.equal(r.stage,'key');assert.equal(r.glass.visible,false);assert.equal(r.canGrab(r.key),true);
  grab(r.key);move(r.key,painting.localToWorld(new THREE.Vector3(0,0,.1)));room.update(.01);assert.equal(r.stage,'rejected');assert.equal(r.key.holder,null);
  grab(r.camera);move(r.camera,new THREE.Vector3(0,1,1));move(r.key,new THREE.Vector3(.3,1,0));assert.equal(r.shoot(),true,'generous camera hitbox');assert.equal(r.stage,'photo');assert.equal(r.shoot(),false,'no duplicate photo');
  grab(r.photo);move(r.photo,painting.localToWorld(new THREE.Vector3(0,0,.1)));room.update(.01);assert.equal(r.stage,'escaped');assert.equal(r.photo.object.visible,false);
  assert.deepEqual(events,['unmuted','melted','drawn','rope','fire','key','rejected','photo','escaped']);
  physics.reset();room.reset();assert.equal(r.stage,'silence');assert.equal(r.glass.visible,true);assert.equal(r.rope.visible,true);assert.equal(r.fire.object.visible,false);assert.equal(room.reward.object.visible,false);
 } finally {room.dispose();physics.dispose();}
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
