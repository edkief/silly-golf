// Deterministic 2D (XZ plane) putting physics. Used by server (authoritative)
// and browser (solo loopback) so both behave identically.

export const PHYS = {
  ballR: 0.15,
  friction: 2.6,        // deceleration on grass (u/s^2)
  sandFriction: 9.0,    // deceleration in sand
  restitution: 0.78,    // wall bounce
  stopSpeed: 0.08,      // below this the ball is considered stopped
  maxPower: 16.5,       // launch speed at power = 1
  captureSpeed: 4.2,    // max speed at which the hole captures the ball
};

export function inSand(b, level) {
  for (const s of level.sand) {
    const dx = (b.x - s.x) / s.rx;
    const dz = (b.z - s.z) / s.rz;
    if (dx * dx + dz * dz <= 1) return true;
  }
  return false;
}

function closestOnSeg(px, pz, w) {
  const abx = w.bx - w.ax, abz = w.bz - w.az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - w.ax) * abx + (pz - w.az) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [w.ax + abx * t, w.az + abz * t];
}

function collideWalls(b, level) {
  const R = PHYS.ballR;
  for (const w of level.walls) {
    const [cx, cz] = closestOnSeg(b.x, b.z, w);
    let nx = b.x - cx, nz = b.z - cz;
    const d = Math.hypot(nx, nz);
    if (d >= R) continue;
    if (d < 1e-9) { nx = 0; nz = -1; } else { nx /= d; nz /= d; }
    b.x = cx + nx * R;
    b.z = cz + nz * R;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= (1 + PHYS.restitution) * vn * nx;
      b.vz -= (1 + PHYS.restitution) * vn * nz;
    }
  }
}

function collidePosts(b, level) {
  const R = PHYS.ballR;
  for (const p of level.posts) {
    let nx = b.x - p.x, nz = b.z - p.z;
    const d = Math.hypot(nx, nz);
    const min = p.r + R;
    if (d >= min) continue;
    if (d < 1e-9) { nx = 0; nz = -1; } else { nx /= d; nz /= d; }
    b.x = p.x + nx * min;
    b.z = p.z + nz * min;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= (1 + PHYS.restitution) * vn * nx;
      b.vz -= (1 + PHYS.restitution) * vn * nz;
    }
  }
}

// Advances one ball by dt. Returns true if the ball was holed.
export function stepBall(b, level, dt) {
  const sub = 4;
  const h = dt / sub;
  const H = level.hole;
  for (let i = 0; i < sub; i++) {
    const f = inSand(b, level) ? PHYS.sandFriction : PHYS.friction;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const nf = sp - f * h;
      if (nf < PHYS.stopSpeed) { b.vx = 0; b.vz = 0; }
      else { const k = nf / sp; b.vx *= k; b.vz *= k; }
    }
    // hole lip attraction
    let dx = H.x - b.x, dz = H.z - b.z;
    let d = Math.hypot(dx, dz);
    const pull = H.r * 1.7;
    if (d < pull && d > 1e-9) {
      const g = (1 - d / pull) * 7.5;
      b.vx += (dx / d) * g * h;
      b.vz += (dz / d) * g * h;
    }
    b.x += b.vx * h;
    b.z += b.vz * h;
    collideWalls(b, level);
    collidePosts(b, level);
    dx = H.x - b.x; dz = H.z - b.z;
    d = Math.hypot(dx, dz);
    const sp2 = Math.hypot(b.vx, b.vz);
    if (d < H.r * 0.9 && sp2 < PHYS.captureSpeed) {
      b.x = H.x; b.z = H.z; b.vx = 0; b.vz = 0;
      return true;
    }
    if (sp2 < PHYS.stopSpeed && d < H.r * 1.05) {
      b.x = H.x; b.z = H.z; b.vx = 0; b.vz = 0;
      return true;
    }
  }
  return false;
}

export function atRest(b) {
  return Math.hypot(b.vx, b.vz) < 1e-9;
}
