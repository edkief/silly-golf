import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHYS, stepBall, atRest } from '../shared/physics.js';

const straight = {
  name: 'test', par: 2,
  bounds: [-2, 0, 2, 10],
  tee: [0, 1],
  hole: { x: 0, z: 8, r: 0.35 },
  walls: [
    { ax: -2, az: 0, bx: 2, bz: 0 },
    { ax: 2, az: 0, bx: 2, bz: 10 },
    { ax: 2, az: 10, bx: -2, bz: 10 },
    { ax: -2, az: 10, bx: -2, bz: 0 },
  ],
  sand: [],
  posts: [],
};

test('friction stops the ball', () => {
  const b = { x: 0, z: 1, vx: 0, vz: 5 };
  let t = 0;
  while (!atRest(b) && t < 20) { stepBall(b, straight, 1 / 60); t += 1 / 60; }
  assert.ok(atRest(b), 'ball should stop');
  assert.ok(b.z > 1 && b.z < 8, 'stopped before hole');
});

test('ball reflects off wall', () => {
  const b = { x: 1.5, z: 5, vx: 6, vz: 0 };
  let bounced = false;
  for (let i = 0; i < 30 && !bounced; i++) {
    stepBall(b, straight, 1 / 60);
    bounced = b.vx < 0;
  }
  assert.ok(bounced, 'x velocity flipped');
  assert.ok(b.x <= 2 - PHYS.ballR + 1e-6, 'pushed out of wall');
  assert.ok(Math.hypot(b.vx, b.vz) < 6, 'lost energy on bounce');
});

test('slow ball near hole is captured', () => {
  const b = { x: 0.2, z: 8, vx: 0, vz: 0.5 };
  let holed = false;
  for (let i = 0; i < 240 && !holed; i++) holed = stepBall(b, straight, 1 / 60);
  assert.ok(holed);
  assert.equal(b.x, 0);
  assert.equal(b.z, 8);
});

test('fast ball can fly over the hole', () => {
  const b = { x: 0, z: 7, vx: 0, vz: PHYS.maxPower };
  let holed = false;
  for (let i = 0; i < 10; i++) if (stepBall(b, straight, 1 / 60)) { holed = true; break; }
  assert.equal(holed, false);
  assert.ok(b.z > 8.6, 'ball passed the hole without being captured');
});

test('sand kills speed fast', () => {
  const level = { ...straight, sand: [{ x: 0, z: 5, rx: 3, rz: 2 }] };
  const b = { x: 0, z: 3, vx: 0, vz: 8 };
  for (let i = 0; i < 60 * 3; i++) stepBall(b, level, 1 / 60);
  assert.ok(atRest(b), 'ball stopped');
  assert.ok(b.z < 8, 'stopped in sand well short of the hole');
});

test('posts block the ball', () => {
  const level = { ...straight, posts: [{ x: 0, z: 5, r: 0.5 }], sand: [] };
  const b = { x: 0, z: 4, vx: 0, vz: 10 };
  for (let i = 0; i < 30; i++) stepBall(b, level, 1 / 60);
  assert.ok(b.z <= 5 - 0.5 - PHYS.ballR + 0.2, 'blocked by post');
});
