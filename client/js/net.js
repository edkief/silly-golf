// Transport layer. Single player = Room running in-browser behind the exact
// same message protocol as the online WebSocket transport.

import { Room } from '../../shared/room.js';

class Transport {
  constructor() {
    this.onWelcome = null; // {id, room}
    this.onState = null;   // snapshot
    this.onError = null;   // string
    this.onClose = null;
  }
  send(_msg) {}
  tick(_dt) {}
  close() {}
}

export class SoloTransport extends Transport {
  constructor(name) {
    super();
    this.room = new Room();
    this.id = this.room.addPlayer(name);
    this.acc = 0;
    queueMicrotask(() => {
      this.onWelcome?.({ id: this.id, room: null });
      this.onState?.(this.room.snapshot());
    });
  }
  send(msg) {
    this.room.input(this.id, msg);
    this.onState?.(this.room.snapshot());
  }
  tick(dt) {
    this.acc += Math.min(dt, 0.1);
    let changed = false;
    while (this.acc >= 1 / 60) {
      this.room.step(1 / 60);
      this.acc -= 1 / 60;
      changed = true;
    }
    if (changed) this.onState?.(this.room.snapshot());
  }
}

export class OnlineTransport extends Transport {
  constructor(name, roomCode) {
    super();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') { this.id = m.id; this.onWelcome?.(m); }
      else if (m.t === 'state') this.onState?.(m.s);
      else if (m.t === 'error') this.onError?.(m.msg);
    };
    this.ws.onclose = () => this.onClose?.();
    this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'join', name, room: roomCode }));
  }
  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  close() { this.ws.close(); }
}
