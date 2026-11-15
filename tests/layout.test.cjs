const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { OCTAGON, clampToRoom, roomWalls } = require('../app/puzzle/puzzleConfig.ts');
const { ROOM_LAYOUT, RESCUE_LAYOUT, PAINTING_HOME } = require('../app/puzzle/roomLayout.ts');
const { initToolPhysics, ToolPhysics } = require('../app/puzzle/lib/toolPhysics.ts');
const { UnityRoom } = require('../app/puzzle/lib/unityRoom.ts');

const inside = (x, z, inset = 0) => { const [cx, cz] = clampToRoom(x, z, inset); return Math.hypot(cx - x, cz - z) < 1e-9; };

test('octagon: eight walls, clamp keeps points inside every wall', () => {
  const walls = roomWalls();
  assert.equal(walls.length, 8);
  assert.ok(Math.abs(walls[0].z - (OCTAGON.cz - OCTAGON.half) - 0) < 1e-9 && Math.abs(walls[0].z + 2.6) < 1e-9, 'front wall stays at z = -2.6');
  for (const [x, z] of [[0, 0], [3, 0], [0, -3], [3, 3], [-2.6, -2.4], [2.7, 2.9]]) {
    const [px, pz] = clampToRoom(x, z, 0.2);
    for (const w of walls) {
      const n = new THREE.Vector2(Math.sin(w.yaw), Math.cos(w.yaw));
      const d = (px - w.x) * n.x + (pz - w.z) * n.y;
      assert.ok(d >= 0.2 - 1e-9, `(${x},${z}) → (${px.toFixed(2)},${pz.toFixed(2)}) is ${d.toFixed(3)} m from ${w.id}`);
    }
  }
  assert.ok(inside(0, 0, 0.2), 'start position is free');
});

test('layout: floor pieces and gameplay props stand inside the octagon', () => {
  for (const o of ROOM_LAYOUT) assert.ok(inside(o.position[0], o.position[2], -0.05), `${o.id} at ${o.position}`);
  const world = (p) => [p[0] + PAINTING_HOME[0], p[1] + PAINTING_HOME[1], p[2] + PAINTING_HOME[2]];
  for (const [id, p] of [['rope', RESCUE_LAYOUT.rope], ['glass', RESCUE_LAYOUT.glass], ['rack', RESCUE_LAYOUT.rack.position], ['portrait box', RESCUE_LAYOUT.camera.position]]) {
    const [x, , z] = world(p);
    assert.ok(inside(x, z, 0.3), `${id} is at least 0.3 m from every wall`);
  }
  // Rack slots stay further apart than the 0.13 m grab radius plus a margin,
  // so reaching for a display sword never picks the decoy by accident.
  const xs = [...RESCUE_LAYOUT.rackSlots.decor, RESCUE_LAYOUT.rackSlots.wallSword, RESCUE_LAYOUT.rackSlots.hammer].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 0.2 - 1e-9, `slot spacing ${xs[i] - xs[i - 1]}`);
});

test('layout: tools spawn on the rack and table at reachable heights, hammer still breaks the seal', async () => {
  await initToolPhysics();
  const physics = new ToolPhysics(), painting = new THREE.Group();
  painting.position.set(...PAINTING_HOME); painting.updateMatrixWorld(true);
  const board = { strokes: [], boardToWorld: () => new THREE.Vector3(1.4, 1.2, 0.2) };
  const room = new UnityRoom(physics, painting, board, () => {});
  try {
    const top = room.hammer.object.position, sword = room.wallSword.object.position, box = room.rescue.camera.object.position;
    assert.ok(top.y > 0.6 && top.y < 1.1, `hammer grip height ${top.y}`);
    assert.ok(sword.y > 0.85 && sword.y < 1.2, `sword pommel height ${sword.y}`);
    assert.ok(box.y > 0.8 && box.y < 1, `portrait box on the table ${box.y}`);
    // Swing the hammer head through the seal: same contact rule as before.
    const g = { index: 0, kind: 'hand', source: null, pinching: true, point: top.clone(), dir: new THREE.Vector3(0, 0, -1), poke: top.clone(), tracked: true, label: 'right hand', rotation: new THREE.Quaternion() };
    assert.equal(room.hammer.tryGrab(g), true);
    const seal = room.mute.getWorldPosition(new THREE.Vector3());
    room.hammer.body.setTranslation(seal.clone().add(new THREE.Vector3(0, 0, 0.31)), true); room.hammer.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); room.hammer.sync();
    room.update(0.01);
    assert.equal(room.rescue.stage, 'unmuted');
  } finally { room.dispose(); physics.dispose(); }
});

test('physics: a dropped tool cannot leave through a diagonal wall', async () => {
  await initToolPhysics();
  const physics = new ToolPhysics();
  try {
    const o = new THREE.Group(); o.position.set(-1.9, 1.2, -1.6);
    const t = physics.add(o, new THREE.Vector3(0.05, 0.05, 0.05)); t.resetOnGround = false;
    t.drop(new THREE.Vector3(-4, 0, -4)); // straight at the front-left window wall
    for (let i = 0; i < 180; i++) physics.update(1 / 90);
    assert.ok(inside(o.position.x, o.position.z, 0), `tool at ${o.position.x.toFixed(2)},${o.position.z.toFixed(2)}`);
  } finally { physics.dispose(); }
});
