// HTTP static server + authoritative WebSocket room server.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from '../shared/room.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');
const SHARED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shared');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function safeJoin(root, urlPath) {
  const p = path.normalize(path.join(root, decodeURIComponent(urlPath)));
  if (!p.startsWith(root)) return null;
  return p;
}

async function serveStatic(req, res) {
  let urlPath = new URL(req.url, 'http://x').pathname;
  if (urlPath === '/') urlPath = '/index.html';
  const root = urlPath.startsWith('/shared/') ? path.dirname(SHARED) : ROOT;
  const file = safeJoin(root, urlPath);
  if (!file) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const st = await stat(file);
    if (st.isDirectory()) throw new Error('dir');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

function makeRoomCode(rooms) {
  for (let tries = 0; tries < 200; tries++) {
    const code = Array.from({ length: 4 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
    ).join('');
    if (!rooms.has(code)) return code;
  }
  return 'ROOM' + Date.now().toString(36).toUpperCase();
}

export function startServer(port = Number(process.env.PORT || 3000)) {
  const rooms = new Map(); // code -> { room, clients: Map(playerId -> ws) }
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(entry, str) {
    for (const ws of entry.clients.values()) {
      if (ws.readyState === ws.OPEN) ws.send(str);
    }
  }

  wss.on('connection', (ws) => {
    let entry = null;
    let playerId = null;

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (!entry) {
        if (msg.t !== 'join') { ws.close(); return; }
        let code = String(msg.room || '').toUpperCase().trim();
        if (code) {
          entry = rooms.get(code);
          if (!entry) {
            ws.send(JSON.stringify({ t: 'error', msg: 'Room ' + code + ' not found' }));
            ws.close();
            return;
          }
        } else {
          code = makeRoomCode(rooms);
          entry = { room: new Room(), clients: new Map() };
          rooms.set(code, entry);
        }
        playerId = entry.room.addPlayer(msg.name);
        if (!playerId) {
          ws.send(JSON.stringify({ t: 'error', msg: 'Room is full' }));
          ws.close();
          return;
        }
        entry.clients.set(playerId, ws);
        ws.__room = code;
        ws.send(JSON.stringify({ t: 'welcome', id: playerId, room: code }));
        broadcast(entry, JSON.stringify({ t: 'state', s: entry.room.snapshot() }));
        return;
      }
      entry.room.input(playerId, msg);
    });

    const cleanup = () => {
      if (!entry || !playerId) return;
      entry.room.removePlayer(playerId);
      entry.clients.delete(playerId);
      const rc = rooms.get(ws.__room);
      if (rc && rc.clients.size === 0) rooms.delete(ws.__room);
      else if (rc) broadcast(rc, JSON.stringify({ t: 'state', s: rc.room.snapshot() }));
      entry = null;
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  // fixed-step sim at 60Hz, snapshot broadcast at 30Hz
  let last = Date.now();
  let acc = 0;
  let flip = false;
  const timer = setInterval(() => {
    const now = Date.now();
    acc += (now - last) / 1000;
    last = now;
    if (acc > 0.25) acc = 0.25;
    while (acc >= 1 / 60) {
      for (const e of rooms.values()) e.room.step(1 / 60);
      acc -= 1 / 60;
    }
    flip = !flip;
    if (flip) {
      for (const [code, e] of rooms) {
        broadcast(e, JSON.stringify({ t: 'state', s: e.room.snapshot() }));
        if (e.clients.size === 0) rooms.delete(code);
      }
    }
  }, 1000 / 60);
  timer.unref?.();

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        server,
        wss,
        rooms,
        port: server.address().port,
        stop: () => new Promise((r) => { clearInterval(timer); wss.close(); server.close(r); }),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().then((s) => {
    console.log(`mini golf: http://localhost:${s.port}`);
  });
}
