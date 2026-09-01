# Mini Golf 3D 

## Assessing Qwen3.8-Flash-Next-UD-IQ4_XS
Experiment with a self-hosted Qwen 3.8 Flash Next and OpenCode, "one-shot" build:
```
Can you build a mini golf 3d game in webgl? main phases:
- infrastructure for client/server for multiplayer support
- build for single player using the infra
- expand to support multiplayer over the internet
```

## Overview
3D mini golf in raw WebGL with an authoritative Node.js room server. Single
player and online multiplayer run through the same message protocol — solo just
swaps the WebSocket transport for an in-browser loopback.

## Run

```
pnpm install
pnpm start            # http://localhost:3000
pnpm test             # physics + room + server integration tests
```

## Play

- **Solo**: enter a name, click "Play Solo" (no server needed for logic).
- **Multiplayer**: one player clicks "Join / Create Room" with a blank code,
  shares the 4-letter room code (also in the top-left HUD, or share the URL
  `?room=CODE`). Others join with the code.

Controls: hold **left mouse** to charge, release to putt. **Right-drag** orbits,
**wheel** zooms.

## Architecture

- `shared/` — deterministic putting physics, courses, and the authoritative
  `Room` game state machine (turn order, scoring, hole progression). Pure, no
  I/O, fixed 60 Hz step.
- `server/index.js` — static file server + WebSocket server (`/ws`). Owns
  rooms, runs the sim at 60 Hz, broadcasts snapshots at 30 Hz. Clients send
  intents only (`shoot`, `restart`); the server is authoritative.
- `client/js/net.js` — transports behind one interface:
  - `SoloTransport`: drives `Room` in-browser (single player using the same infra)
  - `OnlineTransport`: WebSocket to the server (multiplayer)
- `client/js/renderer.js` — raw WebGL: striped fairway, extruded walls, sand,
  hole/flag, posts, balls, aim strip.
- Snapshots are smoothed client-side with exponential interpolation.

## Protocol (JSON)

| dir | msg |
|-----|-----|
| C→S | `{t:'join', name, room?}` `{t:'shoot', dir:[x,z], power}` `{t:'restart'}` |
| S→C | `{t:'welcome', id, room}` `{t:'state', s: snapshot}` `{t:'error', msg}` |
