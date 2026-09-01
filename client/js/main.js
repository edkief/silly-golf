import { createRenderer } from './renderer.js';
import { createInput } from './input.js';
import { SoloTransport, OnlineTransport } from './net.js';
import { LEVELS } from '../../shared/levels.js';
import { PHYS } from '../../shared/physics.js';
import { m4identity } from './math.js';

const $ = (id) => document.getElementById(id);
const ui = {
  start: $('start'), name: $('name'), solo: $('solo'), join: $('join'),
  room: $('room'), hud: $('hud'), hole: $('hole'), status: $('status'),
  board: $('board'), invite: $('invite'), power: $('power'), powerbar: $('powerbar'),
  end: $('end'), endboard: $('endboard'), again: $('again'), msg: $('msg'),
};

let renderer = null;
let transport = null;
let myId = null;
let snap = null;
let curLevelIndex = -1;
const disp = {}; // id -> {x,z} smoothed display positions

const input = createInput($gl(), {
  canAim: () => !!snap && snap.phase === 'aim' && snap.turn === myId && !myHoled(),
  ballPos: () => {
    const p = snap?.players.find((pl) => pl.id === myId);
    return p ? { x: p.x, z: p.z } : null;
  },
  rayGround: (x, y) => renderer.rayGround(x, y),
  onShoot: (dir, power) => transport.send({ t: 'shoot', dir, power }),
});

function $gl() { return $('gl'); }
function myHoled() { return !!snap?.players.find((p) => p.id === myId && p.holed); }

function startGame(t) {
  transport = t;
  transport.onWelcome = ({ id, room }) => {
    myId = id;
    ui.invite.textContent = room ? 'Room code: ' + room : 'Solo';
  };
  transport.onState = (s) => applyState(s);
  transport.onError = (m) => flashMsg(m);
  transport.onClose = () => { flashMsg('Disconnected'); showStart(); };
  ui.start.classList.add('hidden');
  ui.end.classList.add('hidden');
  ui.hud.classList.remove('hidden');
}

function showStart() {
  ui.hud.classList.add('hidden');
  ui.end.classList.add('hidden');
  ui.start.classList.remove('hidden');
}

function applyState(s) {
  snap = s;
  if (s.hole !== curLevelIndex) {
    curLevelIndex = s.hole;
    renderer.buildLevel(LEVELS[s.hole]);
    for (const id in disp) delete disp[id];
  }
  renderHud();
}

function flashMsg(text) {
  ui.msg.textContent = text;
  ui.msg.classList.remove('hidden');
  clearTimeout(flashMsg._t);
  flashMsg._t = setTimeout(() => ui.msg.classList.add('hidden'), 2500);
}

function renderHud() {
  const lvl = LEVELS[snap.hole];
  ui.hole.textContent = `Hole ${snap.hole + 1}/${LEVELS.length} — ${lvl.name} (Par ${lvl.par})`;
  let status = '';
  if (snap.phase === 'aim') {
    const tp = snap.players.find((p) => p.id === snap.turn);
    status = snap.turn === myId ? 'Your turn — hold left mouse to charge, release to putt'
      : `Waiting for ${tp ? tp.name : '...'}`;
  } else if (snap.phase === 'moving') status = 'Rolling...';
  else if (snap.phase === 'holePause') status = 'Hole complete — moving on...';
  else if (snap.phase === 'roundComplete') status = 'Round complete!';
  ui.status.textContent = status;
  ui.board.innerHTML = snap.players.map((p) => {
    const me = p.id === myId ? ' me' : '';
    const turn = p.id === snap.turn ? '<span class="turn">●</span>' : '';
    const score = p.holed ? p.scores[snap.hole] : (p.strokes || '—');
    const tot = p.total + (p.holed ? 0 : p.strokes);
    return `<div class="row${me}"><span class="dot" style="background:${p.color}"></span>` +
      `${turn}${p.name}<b>${score}</b><i>${tot}</i></div>`;
  }).join('');
  if (snap.phase === 'roundComplete') showEnd();
}

function showEnd() {
  const rows = [...snap.players].sort((a, b) => a.total - b.total);
  ui.endboard.innerHTML =
    '<div class="row head"><span>Player</span><b>Hole avg</b><i>Total</i></div>' +
    rows.map((p, i) =>
      `<div class="row"><span class="dot" style="background:${p.color}"></span>${i + 1}. ${p.name}` +
      `<b>${(p.total / LEVELS.length).toFixed(2)}</b><i>${p.total}</i></div>`).join('');
  ui.end.classList.remove('hidden');
}

ui.solo.onclick = () => startGame(new SoloTransport(ui.name.value.trim() || 'Golfer'));
ui.join.onclick = () => startGame(new OnlineTransport(ui.name.value.trim() || 'Golfer', ui.room.value.trim()));
ui.room.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.join.click(); });
ui.again.onclick = () => transport.send({ t: 'restart' });

// URL: ?room=CODE pre-fills online join
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) ui.room.value = urlRoom.toUpperCase();

renderer = createRenderer($gl());

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (transport) transport.tick(dt);
  input.update(dt);

  if (snap) {
    // smooth display positions (exponential)
    const k = 1 - Math.exp(-dt * 14);
    for (const p of snap.players) {
      const d = disp[p.id];
      if (!d) disp[p.id] = { x: p.x, z: p.z };
      else { d.x += (p.x - d.x) * k; d.z += (p.z - d.z) * k; }
    }
    const camS = input.state;
    const focus = disp[myId] ||
      (snap.players.find((p) => p.id === snap.turn) && disp[snap.players.find((p) => p.id === snap.turn).id]) ||
      { x: 0, z: 2 };
    const cp = Math.cos(camS.pitch);
    const pos = [
      focus.x + Math.sin(camS.yaw) * camS.dist * cp,
      camS.dist * Math.sin(camS.pitch) + PHYS.ballR,
      focus.z + Math.cos(camS.yaw) * camS.dist * cp,
    ];
    let aim = null;
    if (camS.aiming) {
      const b = disp[myId];
      if (b) aim = { x: b.x, z: b.z, dx: camS.dirX, dz: camS.dirZ, power: camS.power };
    }
    renderer.frame({
      cam: { pos, target: [focus.x, PHYS.ballR, focus.z] },
      players: snap.players.map((p) => ({ ...p, x: disp[p.id].x, z: disp[p.id].z })),
      aim,
    });
    ui.powerbar.style.width = Math.round((camS.aiming ? camS.power : 0) * 100) + '%';
    ui.power.style.opacity = camS.aiming ? 1 : 0;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
