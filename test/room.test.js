import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../shared/room.js';
import { PHYS } from '../shared/physics.js';

const oneLevel = [{
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
}];

function run(room, n) { for (let i = 0; i < n; i++) room.step(1 / 60); }

// power that stops the ball exactly on the hole (v^2 = 2 f d)
function powerFor(dist) {
  const v = Math.sqrt(2 * PHYS.friction * dist);
  return v / PHYS.maxPower;
}

test('join assigns unique ids and spawns at tee', () => {
  const room = new Room(oneLevel);
  const a = room.addPlayer('A');
  const b = room.addPlayer('B');
  assert.notEqual(a, b);
  const s = room.snapshot();
  assert.equal(s.players.length, 2);
  assert.equal(s.players[0].x, 0);
  assert.equal(s.phase, 'aim');
});

test('only the player on turn may shoot', () => {
  const room = new Room(oneLevel);
  const a = room.addPlayer('A');
  const b = room.addPlayer('B');
  room.input(b, { t: 'shoot', dir: [0, 1], power: 0.5 });
  assert.equal(room.snapshot().players[1].strokes, 0);
  room.input(a, { t: 'shoot', dir: [0, 1], power: 0.5 });
  assert.equal(room.snapshot().players[0].strokes, 1);
  assert.equal(room.snapshot().phase, 'moving');
});

test('cannot shoot while ball is moving', () => {
  const room = new Room(oneLevel);
  const a = room.addPlayer('A');
  room.input(a, { t: 'shoot', dir: [0, 1], power: 0.5 });
  room.input(a, { t: 'shoot', dir: [0, 1], power: 0.5 });
  assert.equal(room.snapshot().players[0].strokes, 1);
});

test('hole out records score and passes turn', () => {
  const room = new Room(oneLevel);
  const a = room.addPlayer('A');
  const b = room.addPlayer('B');
  room.input(a, { t: 'shoot', dir: [0, 1], power: powerFor(7) });
  run(room, 600);
  const s = room.snapshot();
  assert.equal(s.players[0].holed, true);
  assert.equal(s.players[0].scores[0], 1);
  assert.equal(s.turn, b);
  assert.equal(s.phase, 'aim');
});

test('ball stopping short passes turn to next player', () => {
  const room = new Room(oneLevel);
  const a = room.addPlayer('A');
  const b = room.addPlayer('B');
  room.input(a, { t: 'shoot', dir: [0, 1], power: 0.1 });
  run(room, 600);
  const s = room.snapshot();
  assert.equal(s.phase, 'aim');
  assert.equal(s.turn, b);
  assert.equal(s.players[0].holed, false);
});

test('all players holed advances to next hole then round completes', () => {
  const room = new Room(oneLevel);
  room.addPlayer('A');
  room.addPlayer('B');
  const p = powerFor(7);
  room.input('p1', { t: 'shoot', dir: [0, 1], power: p });
  run(room, 600);
  room.input('p2', { t: 'shoot', dir: [0, 1], power: p });
  run(room, 180); // ~3s: holed (~2.4s) then pause (2.5s) still running
  assert.equal(room.phase, 'holePause');
  run(room, 60 * 3); // pause expires, single level -> round complete
  assert.equal(room.phase, 'roundComplete');

  const s = room.snapshot();
  assert.equal(s.players[0].total, 1);
  assert.equal(s.players[1].total, 1);

  room.input('p1', { t: 'restart' });
  assert.equal(room.phase, 'aim');
  assert.equal(room.holeIndex, 0);
  assert.deepEqual(room.snapshot().players[0].scores, []);
});

test('disconnect during aim hands turn on', () => {
  const room = new Room(oneLevel);
  room.addPlayer('A');
  const b = room.addPlayer('B');
  room.removePlayer('p1');
  assert.equal(room.snapshot().turn, b);
  assert.equal(room.players.length, 1);
});

test('max players enforced', () => {
  const room = new Room(oneLevel, 2);
  room.addPlayer('A');
  room.addPlayer('B');
  assert.equal(room.addPlayer('C'), null);
});
