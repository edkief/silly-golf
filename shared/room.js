// Authoritative game room. Pure logic + fixed step; no I/O. Driven by the
// ws server for online play and by a browser loopback for single player.

import { PHYS, stepBall, atRest } from './physics.js';
import { LEVELS } from './levels.js';

export const COLORS = [
  '#e53935', '#1e88e5', '#fdd835', '#8e24aa',
  '#00acc1', '#7cb342', '#fb8c00', '#ec407a',
];

const HOLE_PAUSE = 2.5; // seconds between holes

export class Room {
  constructor(levels = LEVELS, maxPlayers = 8) {
    this.levels = levels;
    this.maxPlayers = maxPlayers;
    this.players = [];
    this.n = 0;
    this.holeIndex = 0;
    this.turnIdx = 0;
    this.phase = 'aim'; // aim | moving | holePause | roundComplete
    this.pauseTimer = 0;
  }

  get level() { return this.levels[this.holeIndex]; }

  addPlayer(name) {
    if (this.players.length >= this.maxPlayers) return null;
    const id = 'p' + (++this.n);
    const p = {
      id,
      name: String(name || 'Golfer').slice(0, 16),
      color: COLORS[(this.players.length) % COLORS.length],
      ball: { x: 0, z: 0, vx: 0, vz: 0 },
      strokes: 0,
      scores: [],
      holed: false,
    };
    this.spawnPlayer(p);
    this.players.push(p);
    return id;
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i === -1) return;
    this.players.splice(i, 1);
    if (this.players.length === 0) return;
    this.turnIdx %= this.players.length;
    // if it was that player's turn while idle, hand turn to current index
    if (this.phase === 'aim' && this.players[this.turnIdx] && this.players[this.turnIdx].holed) {
      this.advanceTurn();
    }
  }

  spawnPlayer(p) {
    const t = this.level.tee;
    p.ball = { x: t[0], z: t[1], vx: 0, vz: 0 };
    p.strokes = 0;
    p.holed = false;
  }

  input(id, msg) {
    if (!msg || typeof msg !== 'object') return;
    const p = this.players.find((pl) => pl.id === id);
    if (!p) return;
    if (msg.t === 'restart') {
      if (this.phase !== 'roundComplete') return;
      for (const pl of this.players) { pl.scores = []; }
      this.holeIndex = 0;
      this.turnIdx = 0;
      for (const pl of this.players) this.spawnPlayer(pl);
      this.phase = 'aim';
      return;
    }
    if (msg.t !== 'shoot') return;
    if (this.phase !== 'aim') return;
    if (this.players[this.turnIdx] !== p) return;
    if (!atRest(p.ball)) return;
    let dx = Number(msg.dir && msg.dir[0]) || 0;
    let dz = Number(msg.dir && msg.dir[1]) || 0;
    const d = Math.hypot(dx, dz);
    if (d < 1e-9) return;
    const power = Math.min(1, Math.max(0.05, Number(msg.power) || 0));
    const speed = power * PHYS.maxPower;
    p.ball.vx = (dx / d) * speed;
    p.ball.vz = (dz / d) * speed;
    p.strokes++;
    this.phase = 'moving';
  }

  step(dt) {
    if (this.players.length === 0) return;
    if (this.phase === 'moving') {
      let anyHoled = false;
      for (const p of this.players) {
        if (p.holed) continue;
        if (stepBall(p.ball, this.level, dt)) {
          p.holed = true;
          p.scores[this.holeIndex] = p.strokes;
          anyHoled = true;
        }
      }
      if (this.players.every((p) => p.holed)) {
        this.phase = 'holePause';
        this.pauseTimer = HOLE_PAUSE;
        return;
      }
      const moving = this.players.some((p) => !p.holed && !atRest(p.ball));
      if (!moving) {
        this.advanceTurn();
        this.phase = 'aim';
      }
    } else if (this.phase === 'holePause') {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) this.nextHole();
    }
  }

  advanceTurn() {
    if (this.players.length === 0) return;
    for (let i = 1; i <= this.players.length; i++) {
      const idx = (this.turnIdx + i) % this.players.length;
      if (!this.players[idx].holed) { this.turnIdx = idx; return; }
    }
  }

  nextHole() {
    if (this.holeIndex + 1 >= this.levels.length) {
      this.phase = 'roundComplete';
      return;
    }
    this.holeIndex++;
    this.turnIdx = 0;
    for (const p of this.players) this.spawnPlayer(p);
    this.phase = 'aim';
  }

  snapshot() {
    return {
      hole: this.holeIndex,
      phase: this.phase,
      turn: this.players[this.turnIdx] ? this.players[this.turnIdx].id : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: Math.round(p.ball.x * 1e3) / 1e3,
        z: Math.round(p.ball.z * 1e3) / 1e3,
        holed: p.holed,
        strokes: p.strokes,
        scores: p.scores,
        total: p.scores.reduce((a, b) => a + b, 0),
      })),
    };
  }
}
