// Raw WebGL renderer: striped grass, extruded walls, sand, hole+flag, balls, aim strip.

import { m4perspective, m4lookAt, m4mul, m4trs, m4invert, m4xformVec4, v3sub, v3norm, v3scale, v3add } from './math.js';
import { PHYS } from '../../shared/physics.js';

const VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
uniform mat4 uVP;
uniform mat4 uM;
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
void main() {
  vec4 w = uM * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uM) * aNrm;
  vCol = aCol;
  gl_Position = uVP * w;
}`;

const FS = `
precision mediump float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
uniform vec3 uColor;
uniform float uStripe;
void main() {
  vec3 n = normalize(vN);
  vec3 l = normalize(vec3(0.45, 0.9, 0.35));
  float lam = max(dot(n, l), 0.0);
  float s = 1.0;
  if (uStripe > 0.5) {
    float c = mod(floor(vW.x * 0.5) + floor(vW.z * 0.5), 2.0);
    s = mix(0.88, 1.08, c);
  }
  vec3 col = vCol * uColor * s * (0.5 + 0.6 * lam);
  float d = length(vW.xz) * 0.008;
  col = mix(col, vec3(0.62, 0.76, 0.86), clamp(d * d, 0.0, 0.45));
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

class Batch {
  constructor() { this.v = []; }
  tri(a, b, c, n, col) {
    for (const p of [a, b, c]) this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  }
  quad(a, b, c, d, n, col) { this.tri(a, b, c, n, col); this.tri(a, c, d, n, col); }
  fan(center, segs, fn, n, col) {
    for (let i = 0; i < segs; i++) {
      this.tri(center, fn(i), fn(i + 1), n, col);
    }
  }
}

function upload(gl, batch) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.v), gl.STATIC_DRAW);
  return { buf, count: batch.v.length / 9 };
}

function sphereMesh(gl, segs = 18, rings = 12) {
  const b = new Batch();
  const pt = (i, j) => {
    const th = (i / segs) * Math.PI * 2;
    const ph = (j / rings) * Math.PI;
    return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = pt(i, j), bb = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      b.tri(a, bb, c, a, [1, 1, 1]);
      const n2 = v3norm(v3add(v3add(a, bb), c));
      b.tri(a, c, d, n2, [1, 1, 1]);
    }
  }
  return upload(gl, b);
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true });
  if (!gl) throw new Error('WebGL not supported');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const loc = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aNrm: gl.getAttribLocation(prog, 'aNrm'),
    aCol: gl.getAttribLocation(prog, 'aCol'),
    uVP: gl.getUniformLocation(prog, 'uVP'),
    uM: gl.getUniformLocation(prog, 'uM'),
    uColor: gl.getUniformLocation(prog, 'uColor'),
    uStripe: gl.getUniformLocation(prog, 'uStripe'),
  };
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  const ball = sphereMesh(gl);
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const aimBuf = gl.createBuffer();
  let aimCount = 0;

  let statics = [];

  function bindMesh(m) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.enableVertexAttribArray(loc.aPos);
    gl.enableVertexAttribArray(loc.aNrm);
    gl.enableVertexAttribArray(loc.aCol);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 36, 0);
    gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 36, 12);
    gl.vertexAttribPointer(loc.aCol, 3, gl.FLOAT, false, 36, 24);
  }

  function drawMesh(m, model, color, stripe) {
    bindMesh(m);
    gl.uniformMatrix4fv(loc.uM, false, model || identity);
    gl.uniform3fv(loc.uColor, color);
    gl.uniform1f(loc.uStripe, stripe ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  function buildLevel(level) {
    statics.forEach((s) => gl.deleteBuffer(s.buf));
    statics = [];
    const b = new Batch();
    const bg = new Batch();
    const [x0, z0, x1, z1] = level.bounds;
    const grass = [0.24, 0.6, 0.31];
    const rough = [0.16, 0.44, 0.23];

    // rough surround + fairway (drawn with mowing stripes)
    const m = 2.2;
    bg.quad([x0 - m, 0, z0 - m], [x0 - m, 0, z1 + m], [x1 + m, 0, z1 + m], [x1 + m, 0, z0 - m], [0, 1, 0], rough);
    bg.quad([x0, 0.005, z0], [x0, 0.005, z1], [x1, 0.005, z1], [x1, 0.005, z0], [0, 1, 0], grass);

    // walls extruded
    const H = 0.65;
    const wallCol = [0.55, 0.42, 0.32];
    for (const w of level.walls) {
      const dx = w.bx - w.ax, dz = w.bz - w.az;
      const len = Math.hypot(dx, dz);
      const nx = dz / len, nz = -dx / len;
      const a = [w.ax, w.az], c = [w.bx, w.bz];
      const t = 0.14;
      // inside face
      b.quad([a[0], 0, a[1]], [a[0] + nx * t, H, a[1] + nz * t], [c[0] + nx * t, H, c[1] + nz * t], [c[0], 0, c[1]], [-nx, 0, -nz], wallCol);
      // top
      b.quad([a[0] + nx * t, H, a[1] + nz * t], [a[0] + nx * 2 * t, H, a[1] + nz * 2 * t], [c[0] + nx * 2 * t, H, c[1] + nz * 2 * t], [c[0] + nx * t, H, c[1] + nz * t], [0, 1, 0], [0.44, 0.33, 0.25]);
    }

    // sand
    const sandCol = [0.85, 0.75, 0.5];
    for (const s of level.sand) {
      b.fan([s.x, 0.018, s.z], 24, (i) => {
        const a = (i / 24) * Math.PI * 2;
        return [s.x + Math.cos(a) * s.rx, 0.018, s.z + Math.sin(a) * s.rz];
      }, [0, 1, 0], sandCol);
    }

    // hole rim + dark center
    const H2 = level.hole;
    b.fan([H2.x, 0.022, H2.z], 24, (i) => {
      const a = (i / 24) * Math.PI * 2;
      return [H2.x + Math.cos(a) * H2.r * 1.4, 0.022, H2.z + Math.sin(a) * H2.r * 1.4];
    }, [0, 1, 0], [0.15, 0.16, 0.15]);
    b.fan([H2.x, 0.03, H2.z], 24, (i) => {
      const a = (i / 24) * Math.PI * 2;
      return [H2.x + Math.cos(a) * H2.r * 0.95, 0.03, H2.z + Math.sin(a) * H2.r * 0.95];
    }, [0, 1, 0], [0.03, 0.03, 0.04]);

    // flag pole + cloth
    const px = H2.x, pz = H2.z;
    const pole = [0.85, 0.85, 0.85];
    const t2 = 0.03;
    b.quad([px - t2, 0, pz], [px - t2, 1.5, pz], [px + t2, 1.5, pz], [px + t2, 0, pz], [0, 0, -1], pole);
    b.quad([px - t2, 0, pz], [px - t2, 1.5, pz], [px - t2, 1.5, pz + 2 * t2], [px - t2, 0, pz + 2 * t2], [-1, 0, 0], pole);
    b.quad([px, 1.1, pz], [px, 1.44, pz], [px + 0.55, 1.32, pz], [px + 0.55, 1.18, pz], [0, 0, 1], [0.85, 0.15, 0.12]);

    // posts
    const postCol = [0.72, 0.5, 0.25];
    for (const p of level.posts) {
      const segs = 12;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const n0 = [Math.cos(a0), 0, Math.sin(a0)];
        const n1 = [Math.cos(a1), 0, Math.sin(a1)];
        b.quad(
          [p.x + Math.cos(a0) * p.r, 0, p.z + Math.sin(a0) * p.r],
          [p.x + Math.cos(a0) * p.r, 0.9, p.z + Math.sin(a0) * p.r],
          [p.x + Math.cos(a1) * p.r, 0.9, p.z + Math.sin(a1) * p.r],
          [p.x + Math.cos(a1) * p.r, 0, p.z + Math.sin(a1) * p.r],
          [(n0[0] + n1[0]) / 2, 0, (n0[2] + n1[2]) / 2], postCol
        );
      }
    }
    statics.push({ ...upload(gl, bg), stripe: true });
    statics.push({ ...upload(gl, b), stripe: false });
  }

  let vpInv = null;

  function frame({ cam, players, aim }) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.clearColor(0.62, 0.76, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    const proj = m4perspective(0.9, w / Math.max(1, h), 0.1, 200);
    const view = m4lookAt(cam.pos, cam.target, [0, 1, 0]);
    const vp = m4mul(proj, view);
    vpInv = m4invert(vp);
    gl.uniformMatrix4fv(loc.uVP, false, vp);

    for (const s of statics) drawMesh(s, null, [1, 1, 1], s.stripe);
    // balls
    const R = PHYS.ballR;
    for (const p of players) {
      if (p.holed) continue;
      drawMesh(ball, m4trs(p.x, R, p.z, R), hex(p.color), false);
    }
    // aim strip
    if (aim) {
      const { x, z, dx, dz, power } = aim;
      const len = 0.5 + 3.5 * power;
      const nx = -dz, nz = dx;
      const ww = 0.07, wt = 0.021;
      const c = [1 - 0.7 * power, 0.8 - 0.5 * power, 0.2];
      const tipX = x + dx * len, tipZ = z + dz * len;
      const p = [];
      const push = (px, pz) => p.push(px, 0.04, pz, 0, 1, 0, c[0], c[1], c[2]);
      push(x - nx * ww, z - nz * ww);
      push(tipX - nx * wt, tipZ - nz * wt);
      push(tipX + nx * wt, tipZ + nz * wt);
      push(x - nx * ww, z - nz * ww);
      push(tipX + nx * wt, tipZ + nz * wt);
      push(x + nx * ww, z + nz * ww);
      gl.bindBuffer(gl.ARRAY_BUFFER, aimBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc.aPos);
      gl.enableVertexAttribArray(loc.aNrm);
      gl.enableVertexAttribArray(loc.aCol);
      gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 36, 12);
      gl.vertexAttribPointer(loc.aCol, 3, gl.FLOAT, false, 36, 24);
      gl.uniformMatrix4fv(loc.uM, false, identity);
      gl.uniform3fv(loc.uColor, [1, 1, 1]);
      gl.uniform1f(loc.uStripe, 0);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.CULL_FACE);
    }
  }

  // screen px -> ground plane (y=0) intersection, or null
  function rayGround(mx, my) {
    if (!vpInv) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const nx = (mx / w) * 2 - 1;
    const ny = 1 - (my / h) * 2;
    let a = m4xformVec4(vpInv, [nx, ny, -1, 1]);
    let bb = m4xformVec4(vpInv, [nx, ny, 1, 1]);
    const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    const f = [bb[0] / bb[3], bb[1] / bb[3], bb[2] / bb[3]];
    const d = v3norm(v3sub(f, o));
    if (Math.abs(d[1]) < 1e-6) return null;
    const t = -o[1] / d[1];
    if (t < 0) return null;
    return v3add(o, v3scale(d, t));
  }

  return { buildLevel, frame, rayGround, gl };
}
