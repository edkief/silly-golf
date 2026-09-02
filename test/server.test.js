import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';

function wsConnect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on = ws.on || undefined;
    const msgs = [];
    let openCb;
    ws.on('open', () => openCb?.());
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('error', reject);
    ws.ready = new Promise((r) => { ws.on('open', r); });
    resolve({ ws, msgs });
  });
}

async function waitFor(ws, pred, timeout = 4000) {
  const seen = [];
  const start = Date.now();
  for (const m of ws.__buf || []) if (pred(m)) return m;
  return new Promise((resolve, reject) => {
    const onMsg = (d) => {
      const m = JSON.parse(d.toString());
      (ws.__buf = ws.__buf || []).push(m);
      if (pred(m)) { ws.off('message', onMsg); resolve(m); }
      if (Date.now() - start > timeout) { ws.off('message', onMsg); reject(new Error('timeout')); }
    };
    ws.on('message', onMsg);
    setTimeout(() => { ws.off('message', onMsg); reject(new Error('timeout')); }, timeout);
  });
}

test('http serves client', async () => {
  const s = await startServer(0);
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Mini Golf 3D/);
    const js = await fetch(`http://127.0.0.1:${s.port}/js/main.js`);
    assert.equal(js.status, 200);
    const shared = await fetch(`http://127.0.0.1:${s.port}/shared/room.js`);
    assert.equal(shared.status, 200);
    const physics = await fetch(`http://127.0.0.1:${s.port}/shared/physics.js`);
    assert.equal(physics.status, 200);
    const bad = await fetch(`http://127.0.0.1:${s.port}/../../etc/passwd`);
    assert.ok(bad.status === 404 || bad.status === 403);
    const escape = await fetch(`http://127.0.0.1:${s.port}/shared/../../package.json`);
    assert.ok(escape.status === 404 || escape.status === 403);
  } finally { await s.stop(); }
});

test('two players join same room and see each other', async () => {
  const s = await startServer(0);
  const clients = [];
  try {
    const c1 = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    const c2 = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    clients.push(c1, c2);
    await Promise.all([
      new Promise((r) => c1.on('open', r)),
      new Promise((r) => c2.on('open', r)),
    ]);
    c1.send(JSON.stringify({ t: 'join', name: 'Alice' }));
    const w1 = await waitFor(c1, (m) => m.t === 'welcome');
    assert.ok(w1.room && w1.room.length >= 4);
    c2.send(JSON.stringify({ t: 'join', name: 'Bob', room: w1.room }));
    const w2 = await waitFor(c2, (m) => m.t === 'welcome');
    assert.equal(w2.room, w1.room);
    const st = await waitFor(c2, (m) => m.t === 'state' && m.s.players.length === 2);
    assert.equal(st.s.players[1].name, 'Bob');
  } finally {
    for (const c of clients) c.terminate();
    await s.stop();
  }
});

test('shoot over the wire updates state; wrong-room code rejected', async () => {
  const s = await startServer(0);
  const clients = [];
  try {
    const c1 = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    clients.push(c1);
    await new Promise((r) => c1.on('open', r));
    c1.send(JSON.stringify({ t: 'join', name: 'Solo' }));
    const w = await waitFor(c1, (m) => m.t === 'welcome');
    c1.send(JSON.stringify({ t: 'shoot', dir: [0, 1], power: 0.4 }));
    const st = await waitFor(c1, (m) => m.t === 'state' && m.s.players[0].strokes > 0);
    assert.equal(st.s.phase, 'moving');

    const c2 = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    clients.push(c2);
    await new Promise((r) => c2.on('open', r));
    c2.send(JSON.stringify({ t: 'join', name: 'X', room: 'ZZZZ' }));
    const err = await waitFor(c2, (m) => m.t === 'error');
    assert.match(err.msg, /not found/);
  } finally {
    for (const c of clients) c.terminate();
    await s.stop();
  }
});

test('rooms persist across restart when DATA_FILE is set', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'golf-'));
  const file = path.join(dir, 'rooms.json');
  process.env.DATA_FILE = file;
  const clients = [];
  let s = null;
  const stop = async (srv) => { if (srv) { s = null; await srv.stop(); } };
  try {
    s = await startServer(0);
    const c1 = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    clients.push(c1);
    await new Promise((r) => c1.on('open', r));
    c1.send(JSON.stringify({ t: 'join', name: 'Alice' }));
    const w1 = await waitFor(c1, (m) => m.t === 'welcome');
    const roomCode = w1.room;
    c1.terminate();
    await stop(s); // flushes rooms.json

    s = await startServer(0);
    const c2 = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    clients.push(c2);
    await new Promise((r) => c2.on('open', r));
    c2.send(JSON.stringify({ t: 'join', name: 'Bob', room: roomCode }));
    const w2 = await waitFor(c2, (m) => m.t === 'welcome');
    assert.equal(w2.room, roomCode);
    // restored offline Alice + live Bob
    const st = await waitFor(c2, (m) => m.t === 'state' && m.s.players.length === 2);
    assert.ok(st.s.players.some((p) => p.name === 'Alice'));
    assert.ok(st.s.players.some((p) => p.name === 'Bob'));
    c2.terminate();
    await stop(s);
  } finally {
    delete process.env.DATA_FILE;
    for (const c of clients) c.terminate();
    await stop(s);
    rmSync(dir, { recursive: true, force: true });
  }
});
