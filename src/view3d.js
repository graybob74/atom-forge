'use strict';
/* ============================================================================
   Atom Forge — the 3-D view (stage 2): a perspective camera on a 3-D world (W.d3), and its drawing
   The camera (R.cam3) orbits a target point (the box's centre unless panned): yaw about the vertical, pitch above or
   below the horizon, a distance and a vertical field of view. yaw = pitch = 0 looks down −z with x to the right and y
   up, as the flat view does. Each frame cam3Update turns it into a basis (C3: eye, right, up, forward), a focal length
   in pixels and the depths the box spans (for the depth buffer's range and the fade with distance).
   render() hands a 3-D world to render3d: the background and the box's far edges (with a faint grid on its far faces)
   on the canvas under the WebGL layer, the atoms, bonds and glows on the layer (gl.js: depth-tested, one draw call for
   the atoms and one for the bonds), and the near edges, labels, badges and rings on the canvas above. Without WebGL 2
   (or with it switched off) everything goes on the one canvas, the atoms sorted far to near and each drawn after its
   half of each bond. Picking (pick3) takes the atom whose drawn disc is under the pointer that is nearest the camera.
   Tools that take a point in the chamber get the point where the pointer's line of sight meets the box's middle plane
   (z = 0; s2w3), so what they place lands under the pointer; stage 3 gives the tools depth.
   ========================================================================== */
const CAM3 = { yaw: 0.6, pitch: 0.4, fov: 40 * Math.PI / 180 }; // the view a 3-D world starts with (and Fit goes back to)
R.cam3 = { yaw: CAM3.yaw, pitch: CAM3.pitch, dist: 80, fov: CAM3.fov, tx: 0, ty: 0, tz: 0 };
const C3 = { ex: 0, ey: 0, ez: 80, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, F: 500, hw: 0, hh: 0, near: 0.05, far: 200, fog0: 0, fog1: 1, fogK: 0.5, fogc: [6, 10, 16] };
const CAM3_PITCH = 1.55; // (just short of straight down or up: the basis needs a horizon)
/* The camera of this frame, from R.cam3 and the view's size. Also sets R.s to the pixels per Å at the target's depth,
   for the code that sizes things by the zoom (the scale bar, pick margins, the tools' brushes). */
function cam3Update() {
  const c = R.cam3;
  if (!(c.pitch >= -CAM3_PITCH)) c.pitch = -CAM3_PITCH; else if (c.pitch > CAM3_PITCH) c.pitch = CAM3_PITCH;
  if (!(c.dist > 0)) c.dist = 80;
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  C3.ex = c.tx + c.dist * cp * sy; C3.ey = c.ty + c.dist * sp; C3.ez = c.tz + c.dist * cp * cy;
  C3.fx = -cp * sy; C3.fy = -sp; C3.fz = -cp * cy;
  C3.rx = cy; C3.ry = 0; C3.rz = -sy;
  C3.ux = -sy * sp; C3.uy = cp; C3.uz = -cy * sp;
  C3.F = (R.h / 2) / Math.tan(c.fov / 2); C3.hw = R.w / 2; C3.hh = R.h / 2;
  R.s = C3.F / c.dist;
  const hx = W.box.w / 2, hy = W.box.h / 2, hz = (W.box.d || W.box.h) / 2;
  let z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const z = ((k & 1 ? hx : -hx) - C3.ex) * C3.fx + ((k & 2 ? hy : -hy) - C3.ey) * C3.fy + ((k & 4 ? hz : -hz) - C3.ez) * C3.fz;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  C3.near = Math.max(0.05, 0.005 * c.dist);
  C3.far = Math.max(z1, c.dist) * 2 + 20; // (beyond it, depth is held at the far end: nothing is cut off)
  C3.fog0 = Math.max(C3.near, z0); C3.fog1 = Math.max(C3.fog0 + 1, z1); C3.fogK = 0.55;
  C3.fogc = hexc(CHAMBER.bg0);
}
/* A world point on the screen: o = [x, y (CSS px), view depth (Å)]; false when it is behind the camera. */
function proj3(x, y, z, o) {
  const dx = x - C3.ex, dy = y - C3.ey, dz = z - C3.ez, zc = dx * C3.fx + dy * C3.fy + dz * C3.fz;
  o[2] = zc;
  if (!(zc > C3.near)) return false;
  o[0] = C3.hw + C3.F * (dx * C3.rx + dy * C3.ry + dz * C3.rz) / zc; o[1] = C3.hh - C3.F * (dx * C3.ux + dy * C3.uy + dz * C3.uz) / zc;
  return true;
}
/* The world point under a screen point: where its line of sight meets the plane z = 0 (the box's middle), or, seen
   too nearly edge-on, the plane through the target square to the view. Always finite. */
function s2w3(px, py) {
  if (!C3.F || C3.hw !== R.w / 2) cam3Update();
  const a = (px - C3.hw) / C3.F, b = (py - C3.hh) / C3.F;
  const dx = C3.fx + a * C3.rx - b * C3.ux, dy = C3.fy + a * C3.ry - b * C3.uy, dz = C3.fz + a * C3.rz - b * C3.uz;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz), t = dz !== 0 ? -C3.ez / dz : -1;
  if (Math.abs(dz) / L > 0.2 && t > 0 && t < 40 * R.cam3.dist) return [C3.ex + t * dx, C3.ey + t * dy, 0];
  const d = R.cam3.dist; // (forward has unit length and so does its part of the ray: the target plane is d along)
  return [C3.ex + d * dx, C3.ey + d * dy, C3.ez + d * dz];
}
/* The camera back to its starting angles, centred on the box and far enough off to see all of it. */
function cam3Fit() {
  const c = R.cam3;
  c.yaw = CAM3.yaw; c.pitch = CAM3.pitch; c.fov = CAM3.fov; c.tx = 0; c.ty = 0; c.tz = 0;
  const rb = 0.5 * Math.hypot(W.box.w, W.box.h, W.box.d || W.box.h), aspect = R.w > 0 && R.h > 0 ? R.w / R.h : 1.5;
  const half = Math.min(c.fov / 2, Math.atan(Math.tan(c.fov / 2) * aspect));
  c.dist = rb / Math.sin(half) * 0.9;
  cam3Update();
}
function cam3Orbit(dpx, dpy) { const c = R.cam3; c.yaw -= dpx * 0.008; c.pitch = clamp(c.pitch + dpy * 0.008, -CAM3_PITCH, CAM3_PITCH); }
function cam3Pan(dpx, dpy) {
  const c = R.cam3, k = c.dist / (C3.F || 500);
  c.tx += (-dpx * C3.rx + dpy * C3.ux) * k; c.ty += (-dpx * C3.ry + dpy * C3.uy) * k; c.tz += (-dpx * C3.rz + dpy * C3.uz) * k;
}
function cam3Zoom(f) { const c = R.cam3; if (f > 0) c.dist = clamp(c.dist / f, 0.5, 1e6); cam3Update(); }
function cam3Follow(p) { const c = R.cam3; c.tx = p.x; c.ty = p.y; c.tz = p.z || 0; }

/* ---------- picking */
/* The particle whose drawn disc is under (px, py), the nearest the camera; failing that, the one whose disc's edge is
   nearest, within extra pixels. */
function pick3(px, py, extra = 6) {
  cam3Update();
  const o = [0, 0, 0];
  let hit = null, hz = Infinity, near = null, nd = Infinity;
  for (const p of W.parts) {
    if (p.dead || !proj3(p.x, p.y, p.z, o)) continue;
    const sc = C3.F / o[2], r = p.k === NUC ? Math.max(p.Z === 0 ? 2.2 : 2.4, Math.max(p.rd, 0.2) * sc) : Math.max(1.8, 0.15 * sc);
    const d = Math.hypot(o[0] - px, o[1] - py);
    if (d <= r) { if (o[2] < hz) { hz = o[2]; hit = p; } }
    else if (d - r < extra && d - r < nd) { nd = d - r; near = p; }
  }
  return hit || near;
}

/* ---------- drawing */
let _pv = new Float32Array(0); // per slot this frame: screen x, y, view depth, radius in px (−1: not drawn)
const _p3a = [0, 0, 0], _p3b = [0, 0, 0];
/* A segment between two world points, cut where it passes behind the camera; false when none of it is in front. */
function seg3(ax, ay, az, bx, by, bz, A, B) {
  const za = (ax - C3.ex) * C3.fx + (ay - C3.ey) * C3.fy + (az - C3.ez) * C3.fz, zb = (bx - C3.ex) * C3.fx + (by - C3.ey) * C3.fy + (bz - C3.ez) * C3.fz, n = C3.near * 1.01;
  if (za < n && zb < n) return false;
  if (za < n) { const t = (n - za) / (zb - za); ax += (bx - ax) * t; ay += (by - ay) * t; az += (bz - az) * t; }
  else if (zb < n) { const t = (n - zb) / (za - zb); bx += (ax - bx) * t; by += (ay - by) * t; bz += (az - bz) * t; }
  return proj3(ax, ay, az, A) && proj3(bx, by, bz, B);
}
/* The box: an edge is near (drawn over the atoms) when either face it bounds faces the camera, else far (under them);
   the far faces carry a faint grid when the grid is on. */
function drawBox3(ctx, front) {
  const hx = W.box.w / 2, hy = W.box.h / 2, hz = W.box.d / 2, H = [hx, hy, hz], E = [C3.ex, C3.ey, C3.ez];
  const faces = (ax, s) => s * E[ax] > H[ax]; // (the face of axis ax on side s faces the camera)
  const A = _p3a, B = _p3b, P = [0, 0, 0], Q = [0, 0, 0];
  ctx.save();
  if (!front && R.view.grid) { // the grid on the far faces
    let step = 10; while (step * R.s < 36) step *= 2; while (step * R.s > 160 && step > 0.5) step /= 2;
    ctx.strokeStyle = 'rgba(130,170,210,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
      if (faces(ax, s)) continue;
      const u = (ax + 1) % 3, v = (ax + 2) % 3;
      for (const [a, b] of [[u, v], [v, u]]) for (let t = Math.ceil(-H[a] / step) * step; t <= H[a] + 1e-9; t += step) {
        if (Math.abs(Math.abs(t) - H[a]) < 1e-6) continue; // (the edges themselves are drawn as edges)
        P[ax] = s * H[ax]; Q[ax] = s * H[ax]; P[a] = t; Q[a] = t; P[b] = -H[b]; Q[b] = H[b];
        if (seg3(P[0], P[1], P[2], Q[0], Q[1], Q[2], A, B)) { ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); }
      }
    }
    ctx.stroke();
  }
  ctx.strokeStyle = front ? CHAMBER.box : 'rgba(150,185,220,0.22)'; ctx.lineWidth = W.wall === 'reflect' ? 1.5 : 1;
  if (W.wall === 'wrap') ctx.setLineDash([6, 5]); else if (W.wall === 'open') ctx.setLineDash([2, 6]);
  ctx.beginPath();
  for (let ax = 0; ax < 3; ax++) { // the four edges along each axis
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      if ((faces(u, su) || faces(v, sv)) !== front) continue;
      P[ax] = -H[ax]; Q[ax] = H[ax]; P[u] = Q[u] = su * H[u]; P[v] = Q[v] = sv * H[v];
      if (seg3(P[0], P[1], P[2], Q[0], Q[1], Q[2], A, B)) { ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); }
    }
  }
  ctx.stroke();
  ctx.restore();
}
/* The world's axes, small, in a corner (which way x, y and z point from here). */
function drawAxes3(ctx) {
  const x0 = 34, y0 = R.h - 58, L = 20;
  ctx.save(); ctx.lineWidth = 1.5; ctx.font = '600 10px "Azeret Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ax = [['x', 1, 0, 0, '#ff7a6b'], ['y', 0, 1, 0, '#7ee08a'], ['z', 0, 0, 1, '#6ba8ff']];
  ax.sort((a, b) => (a[1] * C3.fx + a[2] * C3.fy + a[3] * C3.fz) < (b[1] * C3.fx + b[2] * C3.fy + b[3] * C3.fz) ? 1 : -1); // (the one pointing away first)
  for (const [n, x, y, z, c] of ax) {
    const sx = x * C3.rx + y * C3.ry + z * C3.rz, sy = -(x * C3.ux + y * C3.uy + z * C3.uz);
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + sx * L, y0 + sy * L); ctx.stroke();
    ctx.fillText(n, x0 + sx * (L + 8), y0 + sy * (L + 8));
  }
  ctx.restore();
}
const _fogHex = new Map();
function fogHex(col, f) { const q = Math.round(f * 12), k = col + q; let h = _fogHex.get(k); if (!h) { if (_fogHex.size > 512) _fogHex.clear(); h = mixHex(col, CHAMBER.bg0, q / 12); _fogHex.set(k, h); } return h; }
function fog3(z) { return clamp((z - C3.fog0) / Math.max(1e-3, C3.fog1 - C3.fog0), 0, 1) * C3.fogK; }
const ELEM_SYM = (p) => (p.mu ? 'Mu' : p.anti ? barSym(p.el.sym) : p.el.sym);

function render3d(rt) {
  R.time = rt;
  const dpr = R.dpr;
  R.gl = !!R.cvbg && typeof glReady === 'function' && glReady();
  _colFrame++;
  if (typeof glShow === 'function') glShow(R.gl);
  cam3Update();
  const gl = R.gl, hi = S.hi;
  if (gl) { glBegin(); glSlotsPrepare(); glSlotPositions3(hi); }
  let ctx = gl ? R.ctxbg : R.ctx;
  R.ctx = ctx;
  ctx.save(); // (each canvas is left as found: the flat drawing counts on state carried from frame to frame)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createRadialGradient(R.w / 2, R.h / 2, 0, R.w / 2, R.h / 2, Math.max(R.w, R.h) * 0.75);
  bg.addColorStop(0, CHAMBER.bg1); bg.addColorStop(1, CHAMBER.bg0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, R.w, R.h);
  drawBox3(ctx, false);
  // every particle projected once: where it is on the screen, how deep, how big
  if (_pv.length < hi * 4) _pv = new Float32Array(Math.max(hi, 1024) * 4);
  const V = _pv, o = _p3a, parts = W.parts, F = C3.F, pad = 60, as = R.as, lite = R.lite;
  const vis = [];
  for (let j = 0; j < parts.length; j++) {
    const p = parts[j], i = p.i, b = 4 * i;
    V[b + 3] = -1;
    if (p.dead || !proj3(p.x, p.y, p.z, o)) continue;
    if (o[0] < -pad || o[1] < -pad || o[0] > R.w + pad || o[1] > R.h + pad) continue;
    const sc = F / o[2];
    const r = p.k !== NUC ? Math.max(1.8, 0.12 * sc) : p.Z === 0 ? Math.max(2.2, 0.2 * sc) : p.ne === 0 ? Math.max(2.6, p.rd * as * sc) : Math.max(2.4, p.rd * as * sc);
    V[b] = o[0]; V[b + 1] = o[1]; V[b + 2] = o[2]; V[b + 3] = r;
    vis.push(p);
  }
  const eCol = hexc(E_COL), pCol = hexc(POS_COL), wrap = W.wall === 'wrap', hbw = W.box.w / 2, hbh = W.box.h / 2, hbd = W.box.d / 2;
  // glows: hot atoms and light given off (as in the flat view), and the free leptons' and bare nuclei's
  const glowsOf = (p, b, put) => {
    if (p.k === NUC && p.ne > 0 && !(p.tLocal > 900) && !(p.glow > 0.02)) return; // (most atoms: none)
    const sc = F / V[b + 2];
    if (p.k === NUC && p.ne > 0 && p.tLocal > 900 && !p.fast) put(clamp(p.rd * as * sc * 3.2, 6, 48), blackbodyRGB(p.tLocal), clamp((p.tLocal - 900) / 4000, 0, 0.7));
    if (p.glow > 0.02 && p.glowC) put(clamp(p.rd * as * sc * 5, 10, 32), p.glowC, p.glow);
    if (p.k !== NUC) put(clamp(V[b + 3] * 4.5, 7, 28), p.k === ELEC ? eCol : pCol, p.rad ? 1 : 0.55);
    else if (p.ne === 0 && p.Z > 0) put(V[b + 3] * 3.2, p.anti ? [190, 120, 255] : [255, 110, 90], 0.35);
  };
  const ballCol = (p) => (p.k === ELEC ? E_COL : p.k !== NUC ? POS_COL : p.Z === 0 ? N_COL : p.ne === 0 ? (p.anti ? '#be78ff' : '#ff6e5a') : atomColor(p));
  if (gl) {
    glBegin3();
    glDrawSlots3(hi, C3); // atoms and neutrons: one draw call from the slot textures
    glBondsBuild(W.bonds, W.topo); glDrawBonds3(C3, 0.065, 0.11, 0.7, 2, wrap);
    for (const p of vis) {
      const b = 4 * p.i;
      if (!lite && (p.k !== NUC || p.ne === 0 || p.tLocal > 900 || p.glow > 0.02)) glowsOf(p, b, (r, c, a) => glGlow3(V[b], V[b + 1], V[b + 2], r, c, a));
      if (p.k !== NUC) glBall3(V[b], V[b + 1], V[b + 2], lite ? V[b + 3] * 1.2 : V[b + 3], p.k === ELEC ? eCol : pCol);
      else if (p.Z > 0 && p.ne === 0) glBall3(V[b], V[b + 1], V[b + 2], V[b + 3], hexc(ballCol(p)));
    }
    glFlush3(C3); glEnd3();
    ctx.restore();
    R.ctx = ctx = R.cv.getContext('2d'); ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, R.w, R.h);
    drawBox3(ctx, true);
    drawLabels3(ctx, vis);
  } else {
    // Canvas 2D: far to near, each atom after its halves of its bonds, so nearer things cover farther ones
    vis.sort((a, b) => V[4 * b.i + 2] - V[4 * a.i + 2]);
    if (!lite) { ctx.globalCompositeOperation = 'lighter'; for (const p of vis) { const b = 4 * p.i; glowsOf(p, b, (r, c, a) => drawSprite(glowSprite(c, r), V[b], V[b + 1], a)); } ctx.globalCompositeOperation = 'source-over'; }
    const fc = CHAMBER.bg0;
    ctx.lineCap = 'round';
    for (const p of vis) {
      const b = 4 * p.i, x = V[b], y = V[b + 1], z = V[b + 2], r = V[b + 3], col = ballCol(p);
      if (p.k === NUC && p.bonds.length) for (const bd of p.bonds) { // this atom's half of each bond
        const q = bd.a === p ? bd.b : bd.a, c = 4 * q.i;
        if (q.dead) continue;
        const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
        if (wrap && (Math.abs(dx) > hbw || Math.abs(dy) > hbh || Math.abs(dz) > hbd)) continue;
        let qx, qy, qz;
        if (V[c + 3] >= 0) { qx = V[c]; qy = V[c + 1]; qz = V[c + 2]; } else if (proj3(q.x, q.y, q.z, _p3b)) { qx = _p3b[0]; qy = _p3b[1]; qz = _p3b[2]; } else continue;
        const mx = (x + qx) / 2, my = (y + qy) / 2, zm = 0.75 * z + 0.25 * qz, sc = F / zm;
        const L = Math.hypot(mx - x, my - y) || 1, nx = -(my - y) / L, ny = (mx - x) / L;
        const ar = !!bd.arom, n = ar ? 2 : bd.order, wm = n > 1 ? 0.7 : 1, hw = Math.max(0.7, 0.065 * sc), off = Math.max(2, 0.11 * sc);
        const stretch = clamp((Math.sqrt(dx * dx + dy * dy + dz * dz) - bd.r0) / (bd.rb || 1.5), 0, 1), al = 0.95 - stretch * 0.6;
        ctx.strokeStyle = fogHex(atomColor(p), fog3(zm));
        for (let k = 0; k < n; k++) {
          const of = (k - (n - 1) / 2) * off, wq = ar && k === 1 ? 0.7 * clamp((bd.fo || 1.5) - 1, 0.1, 1) : wm;
          ctx.globalAlpha = al; ctx.lineWidth = 2 * hw * wq;
          ctx.beginPath(); ctx.moveTo(x + nx * of, y + ny * of); ctx.lineTo(mx + nx * of, my + ny * of); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      const rr = p.k !== NUC && lite ? r * 1.2 : r, sp = ballSprite(col, 24), k = rr / 24; // (one sprite a colour, scaled)
      ctx.drawImage(sp.c, x - sp.size * k / 2, y - sp.size * k / 2, sp.size * k, sp.size * k);
      const f = fog3(z);
      if (f > 0.02) { ctx.globalAlpha = f; ctx.fillStyle = fc; ctx.beginPath(); ctx.arc(x, y, rr + 0.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      if (p.k === NUC && p.ne > 0) labelOne3(ctx, p, x, y, r, col);
    }
    drawBox3(ctx, true);
  }
  drawMarks3(ctx);
  drawOverlay3(ctx);
  drawAxes3(ctx);
  drawScaleBar();
  ctx.restore();
}
/* An atom's symbol and charge badge, as the flat view draws them. */
function labelOne3(ctx, p, x, y, r, col) {
  if (lblOn(p) && r >= 8.5) label(ctx, ELEM_SYM(p), x, y, r, luminance(col) > 150 ? '#16202b' : '#f1f5f9');
  if (p.q !== 0 && r >= 5 && badgeOn(p)) chargeBadge(ctx, p.q, x + r * 0.78, y - r * 0.78, r);
}
/* Labels over the WebGL layer: only for atoms whose centre no nearer atom covers (found through a coarse grid of the
   drawn discs), far ones first so the nearer go on top. */
function drawLabels3(ctx, vis) {
  const V = _pv, cand = [];
  for (const p of vis) { if (p.k !== NUC || p.ne === 0) continue; const r = V[4 * p.i + 3]; if ((r >= 8.5 && lblOn(p)) || (p.q !== 0 && r >= 5 && badgeOn(p))) cand.push(p); }
  if (!cand.length) return;
  const CS = 48, gw = Math.ceil((R.w + 120) / CS) + 1, gh = Math.ceil((R.h + 120) / CS) + 1, grid = new Map();
  for (const q of vis) {
    const b = 4 * q.i, r = V[b + 3]; if (r < 3) continue;
    const c0 = Math.max(0, Math.floor((V[b] - r + 60) / CS)), c1 = Math.min(gw - 1, Math.floor((V[b] + r + 60) / CS)), r0 = Math.max(0, Math.floor((V[b + 1] - r + 60) / CS)), r1 = Math.min(gh - 1, Math.floor((V[b + 1] + r + 60) / CS));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const k = cy * gw + cx; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(q); }
  }
  cand.sort((a, b) => V[4 * b.i + 2] - V[4 * a.i + 2]);
  for (const p of cand) {
    const b = 4 * p.i, x = V[b], y = V[b + 1], z = V[b + 2];
    const l = grid.get(Math.floor((y + 60) / CS) * gw + Math.floor((x + 60) / CS));
    let hidden = false;
    if (l) for (const q of l) { if (q === p) continue; const c = 4 * q.i; if (V[c + 2] < z && Math.hypot(V[c] - x, V[c + 1] - y) < V[c + 3] * 0.8) { hidden = true; break; } }
    if (!hidden) labelOne3(ctx, p, x, y, V[b + 3], atomColor(p));
  }
}
/* Selection, hover and the names from Identify molecules, at the projected places. */
function drawMarks3(ctx) {
  const o = _p3a, F = C3.F;
  const ring = (p) => (proj3(p.x, p.y, p.z, o) ? Math.max(6, (p.k === NUC ? p.rd : 0.15) * F / o[2]) : -1);
  if (R.msel.size) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,209,102,0.85)'; ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.lineWidth = 1.5;
    const many = R.msel.size > 2500;
    ctx.beginPath();
    for (const p of R.msel) { if (p.dead) continue; const r = ring(p); if (r < 0) continue; const rr = Math.max(4, r - 2) + (many ? 1 : 3); ctx.moveTo(o[0] + rr, o[1]); ctx.arc(o[0], o[1], rr, 0, Math.PI * 2); }
    if (many) ctx.fill(); else ctx.stroke();
    ctx.restore();
  }
  if (R.molTags.length) {
    const now = W.rt; let live = 0;
    ctx.save(); ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of R.molTags) {
      const left = t.until - now; if (left <= 0 || t.p.dead) continue; live++;
      const r = ring(t.p); if (r < 0) continue;
      const x = o[0], y = o[1] - r - 10;
      ctx.globalAlpha = Math.min(1, left / 1.5); const w = ctx.measureText(t.text).width + 10;
      ctx.fillStyle = 'rgba(16,27,36,0.78)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 4); ctx.fill();
      ctx.fillStyle = '#ffd166'; ctx.fillText(t.text, x, y);
    }
    ctx.restore();
    if (!live) R.molTags.length = 0;
  }
  for (const p of [R.sel, R.hover]) {
    if (!p || p.dead) continue;
    const r = ring(p); if (r < 0) continue;
    ctx.save(); ctx.strokeStyle = p === R.sel ? '#ffd166' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = p === R.sel ? 2 : 1;
    ctx.setLineDash(p === R.sel ? [] : [3, 3]);
    ctx.beginPath(); ctx.arc(o[0], o[1], r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}
/* What the tools show while used (a brush, the Grab tool's line, an aim, a selection box), on the middle plane. */
function drawOverlay3(ctx) {
  const A = _p3a, B = _p3b, F = C3.F, g = W.grab;
  ctx.save();
  if (g && g.p && !g.p.dead && proj3(g.p.x, g.p.y, g.p.z, A)) {
    const rr = Math.max(7, (g.p.k === NUC ? g.p.rd : 0.15) * F / A[2] + 5);
    ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(A[0], A[1], rr, 0, Math.PI * 2); ctx.stroke();
    if (proj3(g.x, g.y, g.p.z, B)) { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]); }
  }
  const o = R.overlay;
  if (o) {
    ctx.strokeStyle = o.color || 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    if (o.brush && proj3(o.x, o.y, 0, A)) { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(A[0], A[1], Math.max(3, o.brush * F / A[2]), 0, Math.PI * 2); ctx.stroke(); }
    if (o.aim && seg3(o.aim.x0, o.aim.y0, 0, o.aim.x1, o.aim.y1, 0, A, B)) { ctx.setLineDash([]); ctx.strokeStyle = o.aim.color || 'rgba(255,209,102,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); }
    if (o.box) {
      const [x0, y0, x1, y1] = o.box, pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.fillStyle = 'rgba(255,209,102,0.08)'; ctx.beginPath();
      let ok = true; pts.forEach(([x, y], k) => { if (!proj3(x, y, 0, A)) ok = false; else if (k) ctx.lineTo(A[0], A[1]); else ctx.moveTo(A[0], A[1]); });
      if (ok) { ctx.closePath(); ctx.fill(); ctx.stroke(); }
    }
  }
  ctx.restore();
}
if (typeof module !== 'undefined') module.exports = { render3d, cam3Update, cam3Fit, pick3, s2w3 };
