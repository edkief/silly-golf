// Pointer controls: left = aim/charge/shoot, right-drag = orbit, wheel = zoom.

export function createInput(canvas, opts) {
  const state = {
    aiming: false,
    dirX: 0, dirZ: 1,
    power: 0,
    yaw: Math.PI,       // camera behind ball looking +z
    pitch: 0.55,
    dist: 9,
  };
  let chargeT = 0;
  let orbiting = false;
  let lastX = 0, lastY = 0;
  let hover = { x: 0, y: 0 };

  function canAim() { return opts.canAim(); }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 0) {
      if (!canAim()) return;
      state.aiming = true;
      chargeT = 0;
      state.power = 0;
      updateDir(e);
    } else if (e.button === 2) {
      orbiting = true;
      lastX = e.clientX; lastY = e.clientY;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (orbiting) {
      state.yaw -= (e.clientX - lastX) * 0.006;
      state.pitch = Math.min(1.35, Math.max(0.15, state.pitch + (e.clientY - lastY) * 0.005));
      lastX = e.clientX; lastY = e.clientY;
    }
    if (state.aiming) updateDir(e);
    const r = canvas.getBoundingClientRect();
    hover.x = e.clientX - r.left;
    hover.y = e.clientY - r.top;
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 0 && state.aiming) {
      state.aiming = false;
      const power = state.power;
      state.power = 0;
      if (power > 0.06 && opts.onShoot) {
        opts.onShoot([state.dirX, state.dirZ], power);
      }
    } else if (e.button === 2) {
      orbiting = false;
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.dist = Math.min(22, Math.max(4, state.dist * (1 + Math.sign(e.deltaY) * 0.1)));
  }, { passive: false });

  function updateDir(e) {
    const r = canvas.getBoundingClientRect();
    const g = opts.rayGround(e.clientX - r.left, e.clientY - r.top);
    if (!g) return;
    const b = opts.ballPos();
    if (!b) return;
    let dx = g[0] - b.x, dz = g[2] - b.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      state.dirX = dx / d;
      state.dirZ = dz / d;
    }
  }

  function update(dt) {
    if (state.aiming) {
      chargeT += dt;
      const cyc = (chargeT % 1.4) / 0.7; // ping-pong over 1.4s
      state.power = cyc <= 1 ? cyc : 2 - cyc;
    }
  }

  return { state, update };
}
