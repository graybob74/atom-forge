'use strict';
/* ============================================================================
   Atom Forge — the 3-D view (stage 2): a perspective camera on a 3-D world (W.d3), and its drawing
   The camera (R.cam3) orbits a target point (the box's centre unless panned): yaw about the vertical, pitch above or
   below the horizon, a distance and a vertical field of view. yaw = pitch = 0 looks down −z with x to the right and y
   up, as the flat view does. Each frame cam3Update turns it into a basis (C3: eye, right, up, forward), a focal length
   in pixels and the depths the box spans (for the depth buffer's range and the fade with distance).
   render() hands a 3-D world to render3d: the background and the box's far edges (with a faint grid on its far faces)
   on the canvas under the WebGL layer, the atoms, bonds and glows on the layer (gl.js: depth-tested, the atoms and the
   bonds each one draw call a pass: cores, then antialiased edges; lit as spheres and cylinders by a light fixed in the
   world, LIGHT3), and the near edges, labels, badges and rings on the canvas above. Without WebGL 2 (or with it
   switched off) everything goes on the one canvas, the atoms sorted far to near and each drawn after its half of each
   bond, shaded alike (litSprite3, cylStops3). Picking (pick3) takes the atom whose drawn disc is under the pointer that is nearest the camera.
   Tools that take a point in the chamber (stage 3) get a point in depth: the atom under the pointer's, or failing one,
   where the pointer's line of sight meets the plane through the camera's target square to the view (ptr3, s2w3); a
   drag stays on the plane square to the view through where it began (s2wPlane). The Heat and Erase brushes act on what
   is seen under them, all the way through (the cone from the eye, toolCone3).
   ========================================================================== */
const CAM3 = { yaw: 0.6, pitch: 0.4, fov: 40 * Math.PI / 180 }; // the view a 3-D world starts with (and Fit goes back to)
R.cam3 = { yaw: CAM3.yaw, pitch: CAM3.pitch, dist: 80, fov: CAM3.fov, tx: 0, ty: 0, tz: 0 };
const C3 = { ex: 0, ey: 0, ez: 80, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, F: 500, D: 80, hw: 0, hh: 0, near: 0.05, far: 200, fog0: 0, fog1: 1, fogK: 0.5, fogc: [6, 10, 16], lx: 0, ly: 0, lz: 1, L: [0, 0, 1] };
/* The key light's direction (toward the light, unit), fixed in the world: mostly from above, so the tops of the balls are
   lit from any side; from the starting view it comes from the upper left and in front, where the flat ball's highlight
   is (gl.js: LIT3, lit3). C3.lx … is it in view space (x right, y up, z toward the eye) for this frame. */
const LIGHT3 = (() => { const v = [-0.35, 0.85, 0.4], l = Math.hypot(v[0], v[1], v[2]); return v.map(c => c / l); })();
/* Settings → 3-D (display and camera only; set by applySettings in ui.js): the field of view (degrees), the projection
   (orthographic: the eye moved far back along the same line with a field of view of 1°, the distance scaled so that the
   target plane keeps its size: sizes then change less than 1% across a 30 Å box, and every path that projects, picks
   or draws in 3-D works unchanged), how strongly far things fade into the background, the box (edges and the far
   faces' grid, edges only, none), the axis marker, and labels on the front atoms only or on all. */
const V3 = { fov: 40, ortho: false, fog: 0.55, box: 'grid', axes: true, lbl: 'front' };
const ORTHO_FOV = Math.PI / 180;
const CAM3_PITCH = 1.55; // (just short of straight down or up: the basis needs a horizon)
/* The camera of this frame, from R.cam3 and the view's size. Also sets R.s to the pixels per Å at the target's depth,
   for the code that sizes things by the zoom (the scale bar, pick margins, the tools' brushes). */
function cam3Update() {
  const c = R.cam3;
  if (!(c.pitch >= -CAM3_PITCH)) c.pitch = -CAM3_PITCH; else if (c.pitch > CAM3_PITCH) c.pitch = CAM3_PITCH;
  if (!(c.dist > 0)) c.dist = 80;
  c.fov = V3.fov * Math.PI / 180;
  const fe = V3.ortho ? ORTHO_FOV : c.fov, D = V3.ortho ? c.dist * Math.tan(c.fov / 2) / Math.tan(fe / 2) : c.dist; // (orthographic: the eye far back, D)
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  C3.ex = c.tx + D * cp * sy; C3.ey = c.ty + D * sp; C3.ez = c.tz + D * cp * cy; C3.D = D;
  C3.fx = -cp * sy; C3.fy = -sp; C3.fz = -cp * cy;
  C3.rx = cy; C3.ry = 0; C3.rz = -sy;
  C3.ux = -sy * sp; C3.uy = cp; C3.uz = -cy * sp;
  C3.F = (R.h / 2) / Math.tan(fe / 2); C3.hw = R.w / 2; C3.hh = R.h / 2;
  R.s = C3.F / D;
  const hx = W.box.w / 2, hy = W.box.h / 2, hz = (W.box.d || W.box.h) / 2;
  let z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const z = ((k & 1 ? hx : -hx) - C3.ex) * C3.fx + ((k & 2 ? hy : -hy) - C3.ey) * C3.fy + ((k & 4 ? hz : -hz) - C3.ez) * C3.fz;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  C3.near = Math.max(0.05, 0.005 * D);
  C3.far = Math.max(z1, D) * 2 + 20; // (beyond it, depth is held at the far end: nothing is cut off)
  C3.fog0 = Math.max(C3.near, z0); C3.fog1 = Math.max(C3.fog0 + 1, z1); C3.fogK = V3.fog;
  C3.fogc = hexc(CHAMBER.bg0);
  const [Lx, Ly, Lz] = LIGHT3;
  C3.lx = Lx * C3.rx + Ly * C3.ry + Lz * C3.rz; C3.ly = Lx * C3.ux + Ly * C3.uy + Lz * C3.uz; C3.lz = -(Lx * C3.fx + Ly * C3.fy + Lz * C3.fz);
  C3.L[0] = C3.lx; C3.L[1] = C3.ly; C3.L[2] = C3.lz;
}
/* A world point on the screen: o = [x, y (CSS px), view depth (Å)]; false when it is behind the camera. */
function proj3(x, y, z, o) {
  const dx = x - C3.ex, dy = y - C3.ey, dz = z - C3.ez, zc = dx * C3.fx + dy * C3.fy + dz * C3.fz;
  o[2] = zc;
  if (!(zc > C3.near)) return false;
  o[0] = C3.hw + C3.F * (dx * C3.rx + dy * C3.ry + dz * C3.rz) / zc; o[1] = C3.hh - C3.F * (dx * C3.ux + dy * C3.uy + dz * C3.uz) / zc;
  return true;
}
/* The world point under a screen point on the plane through the camera's target square to the view. Always finite. */
function s2w3(px, py) { const c = R.cam3; return s2wPlane(px, py, [c.tx, c.ty, c.tz]); }
/* The pointer's line of sight (not normalised: its part along the view direction is 1). */
function ray3(px, py, o) {
  cam3Update(); // (the camera as it is now: it may have turned since the last frame)
  const a = (px - C3.hw) / C3.F, b = (py - C3.hh) / C3.F;
  o[0] = C3.fx + a * C3.rx - b * C3.ux; o[1] = C3.fy + a * C3.ry - b * C3.uy; o[2] = C3.fz + a * C3.rz - b * C3.uz;
  return o;
}
/* Where the pointer's line of sight meets the plane square to the view through the point P. */
function s2wPlane(px, py, P) {
  const r = ray3(px, py, [0, 0, 0]), d = Math.max(C3.near, (P[0] - C3.ex) * C3.fx + (P[1] - C3.ey) * C3.fy + (P[2] - C3.ez) * C3.fz);
  return [C3.ex + d * r[0], C3.ey + d * r[1], C3.ez + d * r[2]];
}
/* The point a tool acts at: the centre of the atom under the pointer (nearest the camera), or the target plane's. */
function ptr3(px, py) {
  const p = pick3(px, py, 0);
  return p ? [p.x, p.y, p.z || 0] : s2w3(px, py);
}
/* The Heat and Erase tools' reach: the cone from the eye through the pointer whose cross-section at the target plane is
   the brush, radius R (inTool3 in the engine takes it). */
function toolCone3(px, py, rad) {
  const r = ray3(px, py, [0, 0, 0]), L = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
  return [C3.ex, C3.ey, C3.ez, r[0] / L, r[1] / L, r[2] / L, rad / (C3.D * L)]; // (the target plane is D along the view, D·L along this line)
}
/* The camera back to its starting angles, centred on the box and far enough off to see all of it. */
function cam3Fit() {
  const c = R.cam3;
  c.yaw = CAM3.yaw; c.pitch = CAM3.pitch; c.fov = V3.fov * Math.PI / 180; c.tx = 0; c.ty = 0; c.tz = 0;
  const rb = 0.5 * Math.hypot(W.box.w, W.box.h, W.box.d || W.box.h), aspect = R.w > 0 && R.h > 0 ? R.w / R.h : 1.5;
  const half = Math.min(c.fov / 2, Math.atan(Math.tan(c.fov / 2) * aspect));
  c.dist = rb / Math.sin(half) * 0.9;
  cam3Update();
}
/* How big a particle is drawn in 3-D (Å, before the atom-size setting). A lone ion is drawn on the atoms' own scale
   (0.3 + 0.28·r) from 0.7 of its ionic radius (1.23.2, the owner: "just draw ions smaller"; display only): Cl⁻ 0.65 Å,
   a little larger than a Cl atom (0.58), not 1.09; Na⁺ 0.50, a little smaller than a Na atom (0.76), not 0.61; anions
   (0.56–0.73) still bigger than cations (0.39–0.57, Cs⁺ 0.63). In a crowd of waters an anion's ball had been two to
   three times its neighbours' and covered them. Everything else as in the flat game (p.rd); the flat game unchanged. */
function rd3(p) { return p.ionic && p.ionR > 0 ? 0.3 + 0.2 * p.ionR : p.rd; }
function cam3Orbit(dpx, dpy) { const c = R.cam3; c.yaw -= dpx * 0.008; c.pitch = clamp(c.pitch + dpy * 0.008, -CAM3_PITCH, CAM3_PITCH); }
function cam3Pan(dpx, dpy) {
  const c = R.cam3, k = (C3.D || c.dist) / (C3.F || 500);
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
    const sc = C3.F / o[2], r = p.k === NUC ? Math.max(p.Z === 0 ? 2.2 : 2.4, Math.max(rd3(p), 0.2) * sc) : Math.max(1.8, 0.15 * sc);
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
  if (V3.box === 'off') return; // (Settings → 3-D: no box drawn)
  ctx.save();
  if (!front && R.view.grid && V3.box === 'grid') { // the grid on the far faces
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
  const x0 = 34, y0 = R.h - 58 - chamberBottomInset(), L = 20; // (above the tool's options bar, 1.23.2)
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
function fog3(z) { return clamp((z - C3.fog0) / Math.max(1e-3, C3.fog1 - C3.fog0), 0, 1) * C3.fogK; }
/* Canvas 2D's lit balls: one sprite a colour for the light as it falls this frame (the view-space light rounded to
   1/40, so a turning camera remakes them every few degrees), shaded pixel by pixel as gl.js's ball shader shades. */
const LIT_R = 32; // (the sprite's radius, CSS px; drawn scaled to each ball)
const _lit3 = { key: '', dpr: 0, by: new Map() };
function litSprite3(col) {
  const L = C3.L, q = [Math.round(L[0] * 40), Math.round(L[1] * 40), Math.round(L[2] * 40)], key = q.join(',');
  if (_lit3.key !== key || _lit3.dpr !== R.dpr) { _lit3.by.clear(); _lit3.key = key; _lit3.dpr = R.dpr; }
  let sp = _lit3.by.get(col); if (sp) return sp;
  const dpr = R.dpr, size = Math.ceil((2 * LIT_R + 4) * dpr), c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), im = g.createImageData(size, size), D = im.data, mid = size / 2, rp = LIT_R * dpr;
  const ql = Math.hypot(q[0], q[1], q[2]) || 1, Lq = [q[0] / ql, q[1] / ql, q[2] / ql], [cr, cg, cb] = hexc(col), o = [0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const qx = x + 0.5 - mid, qy = y + 0.5 - mid, d = Math.sqrt(qx * qx + qy * qy), a = clamp(rp + 0.5 - d, 0, 1);
    if (a <= 0) continue;
    const m = Math.max(d, rp), sx = qx / m, sy = qy / m;
    lit3(sx, -sy, Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy)), Lq, cr / 255, cg / 255, cb / 255, o);
    const k = 4 * (y * size + x); D[k] = Math.round(o[0] * 255); D[k + 1] = Math.round(o[1] * 255); D[k + 2] = Math.round(o[2] * 255); D[k + 3] = Math.round(a * 255);
  }
  g.putImageData(im, 0, 0);
  sp = { c, size: size / dpr };
  _lit3.by.set(col, sp);
  return sp;
}
/* Canvas 2D's bonds: a lane's colours across its width (CYL_S: −1 one edge, 1 the other), as gl.js's bond shader shades
   the cylinder: (dx, dy, dz) the bond in the world, (nx, ny) the screen's direction square to it, f the depth fade;
   mid: only the middle one (CYL_S[3]), for a lane too thin to show the shading across it. */
const CYL_S = [-1, -0.7, -0.35, 0, 0.35, 0.7, 1];
const _cyl = [[0, 0, 0], CYL_S.map(() => '')];
function cylStops3(col, dx, dy, dz, nx, ny, f, mid) {
  let ax = dx * C3.rx + dy * C3.ry + dz * C3.rz, ay = dx * C3.ux + dy * C3.uy + dz * C3.uz, az = -(dx * C3.fx + dy * C3.fy + dz * C3.fz);
  const la = Math.hypot(ax, ay, az) || 1; ax /= la; ay /= la; az /= la;
  let vx = -az * ax, vy = -az * ay, vz = 1 - az * az; const lv = Math.hypot(vx, vy, vz);
  if (lv > 1e-4) { vx /= lv; vy /= lv; vz /= lv; } else { vx = 0; vy = 0; vz = 1; }
  const [cr, cg, cb] = hexc(col), fc = C3.fogc, o = _cyl[0], out = _cyl[1];
  for (let j = mid ? 3 : 0; j < (mid ? 4 : CYL_S.length); j++) {
    const s = CYL_S[j], h = Math.sqrt(Math.max(0, 1 - s * s));
    let px = s * nx + h * vx, py = -s * ny + h * vy, pz = h * vz; const l = Math.hypot(px, py, pz) || 1;
    lit3(px / l, py / l, pz / l, C3.L, cr / 255, cg / 255, cb / 255, o);
    out[j] = `rgb(${Math.round(o[0] * 255 * (1 - f) + fc[0] * f)},${Math.round(o[1] * 255 * (1 - f) + fc[1] * f)},${Math.round(o[2] * 255 * (1 - f) + fc[2] * f)})`;
  }
  return out;
}
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
    const r = p.k !== NUC ? Math.max(1.8, 0.12 * sc) : p.Z === 0 ? Math.max(2.2, 0.2 * sc) : p.ne === 0 ? Math.max(2.6, p.rd * as * sc) : Math.max(2.4, rd3(p) * as * sc);
    V[b] = o[0]; V[b + 1] = o[1]; V[b + 2] = o[2]; V[b + 3] = r;
    vis.push(p);
  }
  const eCol = hexc(E_COL), pCol = hexc(POS_COL), wrap = W.wall === 'wrap', hbw = W.box.w / 2, hbh = W.box.h / 2, hbd = W.box.d / 2;
  // glows: hot atoms and light given off (as in the flat view), and the free leptons' and bare nuclei's
  const glowsOf = (p, b, put) => {
    if (p.k === NUC && p.ne > 0 && !(p.tLocal > 900) && !(p.glow > 0.02)) return; // (most atoms: none)
    const sc = F / V[b + 2];
    if (p.k === NUC && p.ne > 0 && p.tLocal > 900 && !p.fast) put(clamp(rd3(p) * as * sc * 3.2, 6, 48), blackbodyRGB(p.tLocal), clamp((p.tLocal - 900) / 4000, 0, 0.7));
    if (p.glow > 0.02 && p.glowC) put(clamp(rd3(p) * as * sc * 5, 10, 32), p.glowC, p.glow);
    if (p.k !== NUC) put(clamp(V[b + 3] * 4.5, 7, 28), p.k === ELEC ? eCol : pCol, p.rad ? 1 : 0.55);
    else if (p.ne === 0 && p.Z > 0) put(V[b + 3] * 3.2, p.anti ? [190, 120, 255] : [255, 110, 90], 0.35);
  };
  const ballCol = (p) => (p.k === ELEC ? E_COL : p.k !== NUC ? POS_COL : p.Z === 0 ? N_COL : p.ne === 0 ? (p.anti ? '#be78ff' : '#ff6e5a') : atomColor(p));
  if (gl) {
    glBegin3();
    glBondsBuild(W.bonds, W.topo);
    for (const p of vis) {
      const b = 4 * p.i;
      if (!lite && (p.k !== NUC || p.ne === 0 || p.tLocal > 900 || p.glow > 0.02)) glowsOf(p, b, (r, c, a) => glGlow3(V[b], V[b + 1], V[b + 2], r, c, a));
      if (p.k !== NUC) glBall3(V[b], V[b + 1], V[b + 2], lite ? V[b + 3] * 1.2 : V[b + 3], p.k === ELEC ? eCol : pCol);
      else if (p.Z > 0 && p.ne === 0) glBall3(V[b], V[b + 1], V[b + 2], V[b + 3], hexc(ballCol(p)));
    }
    glFlush3(C3, hi, [0.065, 0.11, 0.7, 2, wrap]); glEnd3(); // (atoms and neutrons from the slot textures, bonds, these balls; then glows)
    ctx.restore();
    R.ctx = ctx = R.cv.getContext('2d'); ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, R.w, R.h);
    drawBox3(ctx, true);
    _occ3.vis = vis; _occ3.built = false;
    drawUnder3(ctx, rt);
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
        const thin = hw * wm < 1.5, stops = cylStops3(atomColor(p), dx, dy, dz, nx, ny, fog3(zm), thin); // (thin: one colour, the middle's)
        for (let k = 0; k < n; k++) {
          const of = (k - (n - 1) / 2) * off, wq = ar && k === 1 ? 0.7 * clamp((bd.fo || 1.5) - 1, 0.1, 1) : wm, w = hw * wq;
          if (thin) ctx.strokeStyle = stops[3];
          else { // (across the lane: a cylinder's shading)
            const gr = ctx.createLinearGradient(x + nx * (of - w), y + ny * (of - w), x + nx * (of + w), y + ny * (of + w));
            for (let j = 0; j < CYL_S.length; j++) gr.addColorStop((CYL_S[j] + 1) / 2, stops[j]);
            ctx.strokeStyle = gr;
          }
          ctx.globalAlpha = al; ctx.lineWidth = 2 * w;
          ctx.beginPath(); ctx.moveTo(x + nx * of, y + ny * of); ctx.lineTo(mx + nx * of, my + ny * of); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      const rr = p.k !== NUC && lite ? r * 1.2 : r, sp = litSprite3(col), k = rr / LIT_R; // (one sprite a colour, scaled)
      ctx.drawImage(sp.c, x - sp.size * k / 2, y - sp.size * k / 2, sp.size * k, sp.size * k);
      const f = fog3(z);
      if (f > 0.02) { ctx.globalAlpha = f; ctx.fillStyle = fc; ctx.beginPath(); ctx.arc(x, y, rr + 0.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      if (p.k === NUC && p.ne > 0) labelOne3(ctx, p, x, y, r, col);
    }
    drawBox3(ctx, true);
    _occ3.vis = vis; _occ3.built = false;
    drawUnder3(ctx, rt);
  }
  drawMeasure3(ctx);
  drawFlashes3(ctx, rt);
  drawEvents3(ctx, rt);
  drawMarks3(ctx);
  drawOverlay3(ctx);
  if (V3.axes && !R.menu) drawAxes3(ctx); // (not behind the main menu)
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
    if (l && V3.lbl !== 'all') for (const q of l) { if (q === p) continue; const c = 4 * q.i; if (V[c + 2] < z && Math.hypot(V[c] - x, V[c + 1] - y) < V[c + 3] * 0.8) { hidden = true; break; } }
    if (!hidden) labelOne3(ctx, p, x, y, V[b + 3], atomColor(p));
  }
}
/* Selection, hover and the names from Identify molecules, at the projected places. */
function drawMarks3(ctx) {
  const o = _p3a, F = C3.F;
  const ring = (p) => (proj3(p.x, p.y, p.z, o) ? Math.max(6, (p.k === NUC ? rd3(p) : 0.15) * F / o[2]) : -1);
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
/* What the tools show while used (a brush, the Grab tool's line, an aim, a selection box), where the tools act. */
function drawOverlay3(ctx) {
  const A = _p3a, B = _p3b, F = C3.F, g = W.grab;
  ctx.save();
  if (g && g.p && !g.p.dead && proj3(g.p.x, g.p.y, g.p.z, A)) {
    const rr = Math.max(7, (g.p.k === NUC ? rd3(g.p) : 0.15) * F / A[2] + 5);
    ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(A[0], A[1], rr, 0, Math.PI * 2); ctx.stroke();
    if (proj3(g.x, g.y, g.z === undefined ? g.p.z : g.z, B)) { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]); }
  }
  const o = R.overlay;
  if (o) {
    ctx.strokeStyle = o.color || 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    if (o.brush && proj3(o.x, o.y, o.z || 0, A)) { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(A[0], A[1], Math.max(3, o.brush * F / A[2]), 0, Math.PI * 2); ctx.stroke(); }
    if (o.aim && seg3(o.aim.x0, o.aim.y0, o.aim.z0 || 0, o.aim.x1, o.aim.y1, o.aim.z1 || 0, A, B)) {
      ctx.setLineDash([]); ctx.strokeStyle = o.aim.color || 'rgba(255,209,102,0.85)'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L; // (an arrowhead, and what is fired)
      ctx.beginPath(); ctx.moveTo(B[0] + ux * 8, B[1] + uy * 8); ctx.lineTo(B[0] - uy * 5, B[1] + ux * 5); ctx.lineTo(B[0] + uy * 5, B[1] - ux * 5); ctx.fill();
      if (o.aim.text) { ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(o.aim.text, A[0] + 10, A[1] - 8); }
    }
    if (o.box3) { // the Select tool's box, on the screen (it takes the atoms drawn inside it)
      const [x0, y0, x1, y1] = o.box3;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.fillStyle = 'rgba(255,209,102,0.08)'; ctx.beginPath(); ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.fill(); ctx.stroke();
    } else if (o.box) {
      const [x0, y0, x1, y1] = o.box, pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.fillStyle = 'rgba(255,209,102,0.08)'; ctx.beginPath();
      let ok = true; pts.forEach(([x, y], k) => { if (!proj3(x, y, 0, A)) ok = false; else if (k) ctx.lineTo(A[0], A[1]); else ctx.moveTo(A[0], A[1]); });
      if (ok) { ctx.closePath(); ctx.fill(); ctx.stroke(); }
    }
  }
  ctx.restore();
}
/* ---------- overlays (stage 3): trails, hydrogen bonds and ionic contacts, the Measure tool, flashes and events */
/* Under the labels: particle trails (with each point's depth), hydrogen bonds and ionic contacts, faded with depth. */
function drawUnder3(ctx, rt) {
  if (R.view.tracks && W.tracks.length) drawTracks3(ctx, rt);
  if (R.view.hbonds) drawHBonds3(ctx);
  if (R.view.ionic) drawIonic3(ctx);
}
const _p3c = [0, 0, 0], _p3d = [0, 0, 0];
function drawTracks3(ctx, rt) {
  const win = trailWindow(), simClock = trailSim(), now = simClock ? W.t : rt, A = _p3c, B = _p3d;
  const hbw = W.box.w / 2, hbh = W.box.h / 2, hbd = W.box.d / 2;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = W.tracks.length - 1; i >= 0; i--) {
    const t = W.tracks[i], T = simClock ? t.tt : t.ts;
    const idle = T && T.length ? now - T[T.length - 1] : rt - t.upd;
    if (idle > (T ? win : Math.min(win, 1.6))) { W.tracks.splice(i, 1); continue; }
    if (T) { let k = 0; while (k < T.length - 2 && now - T[k] > win) k++; if (k) trkDrop(t, k); }
    const pts = t.pts, pz = t.pz; if (pts.length < 4) continue;
    ctx.strokeStyle = rgba(t.c, clamp(1 - idle / win, 0, 1) * 0.85); ctx.lineWidth = t.w; ctx.setLineDash(t.dash ? [3, 4] : []);
    ctx.beginPath();
    for (let k = 2; k < pts.length; k += 2) {
      const x0 = pts[k - 2], y0 = pts[k - 1], x1 = pts[k], y1 = pts[k + 1], z0 = pz ? pz[(k >> 1) - 1] || 0 : 0, z1 = pz ? pz[k >> 1] || 0 : 0;
      if (Math.abs(x1 - x0) > hbw || Math.abs(y1 - y0) > hbh || Math.abs(z1 - z0) > hbd) continue; // (a jump through a periodic wall)
      if (seg3(x0, y0, z0, x1, y1, z1, A, B)) { ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); }
    }
    ctx.stroke();
  }
  ctx.restore();
}
/* A hydrogen bond (as the flat view draws one): a polar H 1.5–2.3 Å from an N, O or F with a lone pair, not its own
   partner; found through a coarse grid of the acceptors, so a box of liquid costs little. */
function drawHBonds3(ctx) {
  if (R.s < 3) return;
  const H = [], cs = 2.4, grid = new Map(), key = (i, j, k) => (i * 4096 + j) * 4096 + k;
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC) continue;
    if (p.polarH) H.push(p);
    else if ((p.Z === 7 || p.Z === 8 || p.Z === 9) && p.ne > 0 && p.lp > 0) { const k = key(Math.floor(p.x / cs) + 2048, Math.floor(p.y / cs) + 2048, Math.floor(p.z / cs) + 2048); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(p); }
  }
  if (!H.length || !grid.size) return;
  ctx.save(); ctx.strokeStyle = 'rgba(140,200,255,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath();
  for (const h of H) {
    const d = h.bonds[0] ? other(h.bonds[0], h) : null, ci = Math.floor(h.x / cs) + 2048, cj = Math.floor(h.y / cs) + 2048, ck = Math.floor(h.z / cs) + 2048;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (let k = ck - 1; k <= ck + 1; k++) {
      const l = grid.get(key(i, j, k)); if (!l) continue;
      for (const a of l) {
        if (a === d) continue;
        const dx = a.x - h.x, dy = a.y - h.y, dz = a.z - h.z, r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1.5 * 1.5 || r2 > 2.3 * 2.3) continue;
        occLine3(ctx, h.x, h.y, h.z, a.x, a.y, a.z);
      }
    }
  }
  ctx.stroke(); ctx.restore();
}
/* Lines drawn on the overlay after the atoms (hydrogen bonds, ionic contacts) hidden where a ball is in front of them
   (1.23.1+: they were drawn over every atom). The line is followed in pieces about 2 px long; a piece shows where no
   ball's front surface is nearer than the line there (the ends lie inside their own atoms, so they start at the balls'
   edges as a bond does). The balls drawn this frame are binned on the screen once, when a line first asks. */
const _occ3 = { vis: null, built: false, cell: 32, map: new Map() }, _p3e = [0, 0, 0];
function occBuild3() {
  const o = _occ3, V = _pv, cs = o.cell; o.map.clear(); o.built = true;
  if (!o.vis) return;
  for (const p of o.vis) {
    const b = 4 * p.i, r = V[b + 3]; if (r < 0) continue;
    const i0 = Math.floor((V[b] - r) / cs), i1 = Math.floor((V[b] + r) / cs), j0 = Math.floor((V[b + 1] - r) / cs), j1 = Math.floor((V[b + 1] + r) / cs);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) continue; // (a ball filling the screen: the camera is inside the crowd)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 65536 + j; let l = o.map.get(k); if (!l) o.map.set(k, l = []); l.push(b); }
  }
}
function occHidden3(x, y, d) {
  const o = _occ3, l = o.map.get(Math.floor(x / o.cell) * 65536 + Math.floor(y / o.cell)); if (!l) return false;
  const V = _pv, F = C3.F;
  for (const b of l) {
    const r = V[b + 3], dx = x - V[b], dy = y - V[b + 1], q = (dx * dx + dy * dy) / (r * r);
    if (q >= 1) continue;
    if (d > V[b + 2] - (r * V[b + 2] / F) * Math.sqrt(1 - q)) return true; // (the sphere's front surface there, in Å of depth)
  }
  return false;
}
/* Adds the visible pieces of the line a–b to the current path. */
function occLine3(ctx, ax, ay, az, bx, by, bz) {
  if (!_occ3.built) occBuild3();
  const A = _p3c, B = _p3d, P = _p3e;
  if (!seg3(ax, ay, az, bx, by, bz, A, B)) return;
  const n = Math.min(400, Math.max(2, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 2)));
  let open = false;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const ok = proj3(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, P) && !occHidden3(P[0], P[1], P[2]);
    if (ok) { if (open) ctx.lineTo(P[0], P[1]); else { ctx.moveTo(P[0], P[1]); open = true; } } else open = false;
  }
}
/* Ionic contacts (as drawIonic): a cation and an anion (lone ions or charged molecules) whose closest atoms touch. */
function drawIonic3(ctx) {
  const at = [], seen = new Set();
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.ne <= 0 || p.q === 0 || seen.has(p)) continue;
    const g = linked(p) ? molecule(p) : [p];
    let Q = 0; for (const a of g) { seen.add(a); Q += a.q; }
    if (Math.abs(Q) < 1) continue;
    for (const a of g) at.push({ p: a, g, Q });
  }
  if (at.length < 2) return;
  at.sort((a, b) => a.p.x - b.p.x);
  const best = new Map();
  for (let i = 0; i < at.length; i++) {
    const A = at[i], a = A.p, ra = 0.5 * a.ljR;
    for (let j = i + 1; j < at.length; j++) {
      const Bq = at[j], b = Bq.p, dx = b.x - a.x;
      if (dx > 8) break;
      if (A.Q * Bq.Q >= 0) continue;
      const r = Math.hypot(dx, b.y - a.y, b.z - a.z), reach = 1.3 * (ra + 0.5 * b.ljR);
      if (r > reach || r < 0.3) continue;
      const key = A.Q > 0 ? A.g[0].id + ':' + Bq.g[0].id : Bq.g[0].id + ':' + A.g[0].id, o = best.get(key);
      if (!o || r < o.r) best.set(key, { r, a, b, qq: Math.abs(A.Q * Bq.Q) });
    }
  }
  if (!best.size) return;
  ctx.save(); ctx.strokeStyle = R.cvd ? 'rgba(240,228,66,0.6)' : 'rgba(255,196,120,0.6)'; ctx.setLineDash([1.5, 3.5]); ctx.lineCap = 'round';
  for (const { a, b, qq } of best.values()) {
    ctx.lineWidth = clamp(0.8 + 0.35 * Math.sqrt(qq), 1, 2.6); ctx.beginPath(); occLine3(ctx, a.x, a.y, a.z, b.x, b.y, b.z); ctx.stroke();
  }
  ctx.restore();
}
/* The Measure tool's marks (as drawMeasure): the lines between the atoms picked, each with its length in space, and the
   angle in space at the middle atom of three (its arc drawn between the two lines as they appear). */
function drawMeasure3(ctx) {
  const m = (R.measure || []).filter(p => !p.dead); if (!m.length) return;
  const P = []; for (const p of m) { const o = [0, 0, 0]; if (!proj3(p.x, p.y, p.z || 0, o)) return; P.push(o); }
  const acc = cssVar('--accent') || '#6aa6ff';
  ctx.save(); ctx.lineWidth = 1.6; ctx.strokeStyle = acc; ctx.fillStyle = acc; ctx.setLineDash([5, 3]);
  ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
  for (const [x, y, z] of P) { ctx.beginPath(); ctx.arc(x, y, Math.max(6, Math.min(18, 0.45 * C3.F / z)), 0, Math.PI * 2); ctx.stroke(); }
  const tag = (t, x, y) => { ctx.font = '600 12px ' + (cssVar('--font-data') || 'monospace'); const w = ctx.measureText(t).width + 10; ctx.fillStyle = 'rgba(8,14,22,0.82)'; ctx.fillRect(x - w / 2, y - 10, w, 20); ctx.fillStyle = '#eaf2ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y + 0.5); };
  for (let i = 0; i + 1 < m.length; i++) tag(fmtA(measureDist(m[i], m[i + 1])), (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2 - 14);
  if (m.length >= 3) {
    const [bx, by] = P[1], a1 = Math.atan2(P[0][1] - by, P[0][0] - bx), a2 = Math.atan2(P[2][1] - by, P[2][0] - bx), r = 28;
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    ctx.strokeStyle = acc; ctx.beginPath(); ctx.arc(bx, by, r, a1, a1 + d, d < 0); ctx.stroke();
    const am = a1 + d / 2; tag(measureAngle(m[0], m[1], m[2]).toFixed(1) + '°', bx + Math.cos(am) * (r + 22), by + Math.sin(am) * (r + 22));
  }
  ctx.restore();
}
/* Flashes (sparks, captures, light given off) at their place in depth, sized for their distance. */
function drawFlashes3(ctx, rt) {
  if (R.lite) { W.flashes.length = 0; return; }
  const o = _p3c;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = W.flashes.length - 1; i >= 0; i--) {
    const f = W.flashes[i], age = rt - f.t0;
    if (age > f.life) { W.flashes.splice(i, 1); continue; }
    if (!proj3(f.x, f.y, f.z || 0, o)) continue;
    const k = age / f.life, r = Math.min(Math.max(10, f.s * (C3.F / o[2]) * (0.6 + 1.6 * k)), 70 + 14 * f.s);
    drawSprite(glowSprite(f.c, r * (R.flashK < 1 ? 0.6 : 1)), o[0], o[1], (1 - k) * 0.9 * R.flashK);
  }
  ctx.restore();
}
/* Events with a caption (as drawEvents, more simply): two rings where it happened, and the newest few captions. */
function drawEvents3(ctx, rt) {
  const evs = W.events; if (!evs.length) return;
  for (let i = evs.length - 1; i >= 0; i--) if (rt - evs[i].t0 > EV_LIFE || rt < evs[i].t0 - 0.5) evs.splice(i, 1);
  const o = _p3c;
  ctx.save();
  for (const e of evs.slice(-4)) {
    if (!proj3(e.x, e.y, e.z || 0, o)) continue;
    const age = Math.max(0, rt - e.t0), c = EV_STYLE[e.kind] || EV_STYLE.decay;
    for (const d of [0, 0.3]) { const k = clamp((age - d) / 1.0, 0, 1); if (k <= 0 || k >= 1) continue; ctx.strokeStyle = rgba(c, (1 - k) * 0.85); ctx.lineWidth = 2.2 * (1 - k) + 0.6; ctx.beginPath(); ctx.arc(o[0], o[1], 5 + k * 46, 0, Math.PI * 2); ctx.stroke(); }
    const a = Math.min(1, age / 0.15) * clamp((EV_LIFE - age) / 1.2, 0, 1); if (a <= 0.01) continue;
    ctx.globalAlpha = a; ctx.font = '600 12.5px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(e.text).width + 16, bx = clamp(o[0] + 18, 8, R.w - w - 8), by = clamp(o[1] - 40, 8, R.h - 34);
    ctx.fillStyle = 'rgba(7,11,17,0.88)'; ctx.fillRect(bx, by, w, 26); ctx.fillStyle = rgba(c, 1); ctx.fillRect(bx, by + 5, 3, 16);
    ctx.fillStyle = '#eef3f8'; ctx.fillText(e.text, bx + 9, by + 13); ctx.globalAlpha = 1;
  }
  ctx.restore();
}
if (typeof module !== 'undefined') module.exports = { render3d, cam3Update, cam3Fit, pick3, s2w3 };
