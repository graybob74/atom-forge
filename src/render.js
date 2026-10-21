'use strict';
/* ============================================================================
   Atom Forge — canvas renderer
   ========================================================================== */

const R = {
  cv: null, ctx: null, dpr: 1, w: 0, h: 0, cvbg: null, ctxbg: null, // cvbg: the canvas under the WebGL layer (gl.js), when that is in use
  s: 12, cx: 0, cy: 0,             // px per Å, world point at screen centre
  sprites: new Map(),
  view: { bohr: 'auto', labels: true, tracks: true, rays: true, hbonds: true, color: 'element', grid: true, decayCards: true },
  hover: null, sel: null, overlay: null, ghost: null, molTags: [], time: 0, // molTags: names from Identify molecules, shown for a while follow: null, // follow: a particle the view stays centred on
  msel: new Set(), // the Select tool's selection
  dprMax: 2, lite: false, // (Settings: drawing resolution, and lite: no glows, halos or flashes)
  as: 1, cvd: false, lblMode: 'always', badges: 'always', flashK: 1, // (Settings → Graphics: atom size, colour-blind palette, labels and charge badges always or on hover, flashes toned down)
};
const CHAMBER = { bg0: '#060a10', bg1: '#0b121b', grid: 'rgba(130,170,210,0.055)', box: 'rgba(150,185,220,0.35)',
  text: '#d6e2ee', dim: 'rgba(200,220,240,0.55)' };

function rInit(canvas, bg) {
  R.cv = canvas; R.ctx = canvas.getContext('2d');
  if (bg) { R.cvbg = bg; R.ctxbg = bg.getContext('2d'); }
}
function rResize(w, h) {
  R.dpr = Math.min(R.dprMax || 2, window.devicePixelRatio || 1);
  R.w = w; R.h = h;
  for (const cv of [R.cv, R.cvbg]) { if (!cv) continue; cv.width = Math.round(w * R.dpr); cv.height = Math.round(h * R.dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
}
const ZOOM_MAX = 4000; // px per Å: about 0.25 Å across the view, well inside one atom
function fitView(margin = 28) {
  const bw = W.box.tw, bh = W.box.th;
  R.s = Math.min((R.w - margin * 2) / bw, (R.h - margin * 2) / bh);
  R.s = clamp(R.s, 0.01, 400);
  R.cx = 0; R.cy = 0; R.follow = null;
}
function w2sx(x) { return (x - R.cx) * R.s + R.w / 2; }
function w2sy(y) { return (R.cy - y) * R.s + R.h / 2; }
function s2w(px, py) { return [(px - R.w / 2) / R.s + R.cx, R.cy - (py - R.h / 2) / R.s]; }
function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const _hexCache = {};
function hexc(h) { return _hexCache[h] || (_hexCache[h] = hexRGB(h)); }

/* ---------- sprites ---------- */
/* Ball sprites are kept per colour, by radius in half pixels, so finding one costs no string (the drawing asks for
   one per atom per frame). The cache is emptied when the pixel density changes, or when it has grown large. */
const _balls = { by: Object.create(null), n: 0, dpr: 0 };
function ballSprite(col, rpx) {
  if (_balls.dpr !== R.dpr || _balls.n > 600) { _balls.by = Object.create(null); _balls.n = 0; _balls.dpr = R.dpr; }
  let rq2 = Math.round(rpx * 2); if (rq2 < 2) rq2 = 2; // (radius in half pixels, at least 1 px)
  let m = _balls.by[col];
  if (m === undefined) m = _balls.by[col] = [];
  let sp = m[rq2];
  if (sp !== undefined) return sp;
  _balls.n++;
  const rq = rq2 / 2;
  const size = Math.ceil(rq * 2 + 4) * R.dpr;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rq * R.dpr, mid = size / 2;
  const [cr, cg, cb] = hexc(col);
  const grd = g.createRadialGradient(mid - r * 0.35, mid - r * 0.4, r * 0.08, mid, mid, r);
  grd.addColorStop(0, `rgb(${Math.min(255, cr + 90)},${Math.min(255, cg + 90)},${Math.min(255, cb + 90)})`);
  grd.addColorStop(0.45, `rgb(${cr},${cg},${cb})`);
  grd.addColorStop(1, `rgb(${Math.round(cr * 0.45)},${Math.round(cg * 0.45)},${Math.round(cb * 0.45)})`);
  g.fillStyle = grd; g.beginPath(); g.arc(mid, mid, r, 0, Math.PI * 2); g.fill();
  sp = { c, size: size / R.dpr };
  m[rq2] = sp;
  return sp;
}
function glowSprite(rgb, rpx) {
  const rq = Math.max(2, Math.round(rpx));
  const key = 'g' + rgb.join(',') + '|' + rq;
  let sp = R.sprites.get(key);
  if (sp) return sp;
  const size = Math.ceil(rq * 2) * R.dpr;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), m = size / 2;
  const grd = g.createRadialGradient(m, m, 0, m, m, m);
  grd.addColorStop(0, rgba(rgb, 0.9)); grd.addColorStop(0.25, rgba(rgb, 0.45)); grd.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  sp = { c, size: size / R.dpr };
  R.sprites.set(key, sp);
  return sp;
}
function drawSprite(sp, x, y, alpha) {
  const ctx = R.ctx;
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.drawImage(sp.c, x - sp.size / 2, y - sp.size / 2, sp.size, sp.size);
  if (alpha !== undefined) ctx.globalAlpha = 1;
}

/* ---------- colours ---------- */
const P_COL = '#ff5a4e', N_COL = '#a9b4c2', E_COL = '#4da8ff', POS_COL = '#ff6fc8';
const PBAR_COL = '#b56dff', NBAR_COL = '#66738a', ANTI_TINT = '#b56dff';
/* Colour-blind friendly palette (Settings → Graphics): the common elements on the Okabe–Ito colours, which stay apart
   for red–green and blue–yellow colour blindness; charges orange (+) and blue (−) instead of red and blue. */
const CVD_COL = { 1: '#f2f2f2', 6: '#5a5a5a', 7: '#0072b2', 8: '#d55e00', 9: '#7fdcc5', 11: '#cc79a7', 12: '#b39ddb', 15: '#e69f00', 16: '#f0e442',
  17: '#009e73', 19: '#a16fae', 20: '#8f8f8f', 26: '#e69f00', 29: '#c0784a', 35: '#7a3b12', 53: '#6a3d9a', 92: '#56b4e9' };
const Q_POS = () => (R.cvd ? '#e69f00' : '#ff5a4e'), Q_NEG = () => (R.cvd ? '#0072b2' : '#4d8dff');
function baseElColor(Z) { return (R.cvd && CVD_COL[Z]) || ELEMENTS[Z].color; }
function elColorsReset() { _elCol.length = 0; _elColAnti.length = 0; _stySig = ''; R.sprites.clear(); }
const lblOn = (p) => R.view.labels && !R.menu && (R.lblMode !== 'hover' || p === R.hover || p === R.sel); // (R.menu: behind the main menu, the chamber without words)
const badgeOn = (p) => R.badges === 'always' || (R.badges === 'hover' && (p === R.hover || p === R.sel));
function atomColor(p) {
  if (R.view.color === 'charge') {
    const q = p.q + p.qp;
    if (Math.abs(q) < 0.05) return '#8a96a3';
    const t = clamp(Math.abs(q) / 1.2, 0, 1);
    return q > 0 ? mixHex('#8a96a3', Q_POS(), t) : mixHex('#8a96a3', Q_NEG(), t);
  }
  if (R.view.color === 'heat') {
    const T = p.tLocal || 0;
    const t = clamp(Math.log10(Math.max(T, 10)) / 5, 0, 1);
    return heatHex(t);
  }
  if (p.anti && p.el) return mixHex(baseElColor(p.Z), ANTI_TINT, 0.5);
  return p.el ? baseElColor(p.Z) : '#cccccc';
}
function mixHex(a, b, t) {
  const A = hexc(a), B = hexc(b);
  const c = [0, 1, 2].map(i => Math.round(A[i] + (B[i] - A[i]) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
function heatHex(t) {
  const stops = [[0, '#2b3a8f'], [0.35, '#2fb8c8'], [0.55, '#f0e14a'], [0.75, '#ff7a2a'], [1, '#ffffff']];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
    return mixHex(c0, c1, (t - t0) / (t1 - t0));
  }
  return '#ffffff';
}
function luminance(hex) { const [r, g, b] = hexc(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

/* ---------- main draw ---------- */
function render(rt) {
  R.time = rt;
  const dpr = R.dpr;
  // the WebGL layer (gl.js) takes the balls, glows and bonds when it can: the background goes on the canvas under it and
  // the rest on the transparent one above; without it everything is drawn on the one canvas
  R.gl = !!R.cvbg && typeof glReady === 'function' && glReady();
  _colFrame++;
  if (typeof glShow === 'function') glShow(R.gl);
  if (R.gl) { glBegin(); glSlotsPrepare(); }
  const ctx = R.gl ? R.ctxbg : R.ctx;
  R.ctx = ctx; // (the drawing below the particles goes here)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // chamber background
  const bg = ctx.createRadialGradient(R.w / 2, R.h / 2, 0, R.w / 2, R.h / 2, Math.max(R.w, R.h) * 0.75);
  bg.addColorStop(0, CHAMBER.bg1); bg.addColorStop(1, CHAMBER.bg0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, R.w, R.h);
  drawGrid();
  drawFields();
  drawBox();
  if (R.view.tracks) drawTracks(rt);
  if (R.gl) { drawChipsUnder(); drawBonds(rt); } // (on the WebGL layer; the chip packages under it)
  // from here on, the canvas above the WebGL layer
  if (R.gl) { R.ctx = R.cv.getContext('2d'); R.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); R.ctx.clearRect(0, 0, R.w, R.h); }
  if (!R.gl) drawBonds(rt);
  if (R.view.hbonds) drawHBonds();
  if (!R.gl) drawChipsUnder();
  drawParticles(rt);
  drawChips(rt);
  drawExos(); drawStrings(rt);
  drawFlashes(rt);
  if (R.view.rays) { drawRays(rt); drawFlights(); drawPhotonLabels(rt); }
  drawEvents(rt);
  drawZones();
  drawSources();
  drawOverlay();
  drawScaleBar();
}

function drawGrid() {
  if (!R.view.grid) return;
  const ctx = R.ctx;
  let step = 10;
  while (step * R.s < 36) step *= 2;
  while (step * R.s > 160 && step > 0.5) step /= 2;
  const [x0, y1] = s2w(0, 0), [x1, y0] = s2w(R.w, R.h);
  ctx.strokeStyle = CHAMBER.grid; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const sx = Math.round(w2sx(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, R.h); }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const sy = Math.round(w2sy(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(R.w, sy); }
  ctx.stroke();
}
function drawBox() {
  const ctx = R.ctx;
  const x0 = w2sx(-W.box.w / 2), y0 = w2sy(W.box.h / 2), w = W.box.w * R.s, h = W.box.h * R.s;
  ctx.save();
  ctx.strokeStyle = CHAMBER.box; ctx.lineWidth = W.wall === 'reflect' ? 1.5 : 1;
  if (W.wall === 'wrap') ctx.setLineDash([6, 5]); else if (W.wall === 'open') ctx.setLineDash([2, 6]);
  ctx.strokeRect(x0, y0, w, h);
  if (W.glow && W.wall === 'reflect' && W.T > 700) { // glowing walls: the colour of a black body at the bath temperature
    const c = blackbodyRGB(W.T), a = clamp((W.T - 700) / 1500, 0, 1);
    ctx.setLineDash([]); ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`; ctx.lineWidth = 3; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12 * a;
    ctx.strokeRect(x0, y0, w, h); ctx.shadowBlur = 0;
  }
  if (W.box.tw !== W.box.w || W.box.th !== W.box.h) {
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,200,120,0.5)';
    ctx.strokeRect(w2sx(-W.box.tw / 2), w2sy(W.box.th / 2), W.box.tw * R.s, W.box.th * R.s);
  }
  ctx.restore();
}
function drawFields() {
  const ctx = R.ctx;
  // magnets
  for (const m of W.magnets) {
    const x = w2sx(m.x), y = w2sy(m.y), r = m.R * R.s;
    const col = m.B >= 0 ? [255, 96, 86] : [86, 140, 255];
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.8);
    g.addColorStop(0, rgba(col, 0.20)); g.addColorStop(0.55, rgba(col, 0.10)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // field symbols: ⊙ out of screen (north facing you), ⊗ into screen
    const sp = Math.max(18, r / 3);
    ctx.strokeStyle = rgba(col, 0.45); ctx.fillStyle = rgba(col, 0.45); ctx.lineWidth = 1;
    for (let yy = -r; yy <= r; yy += sp) for (let xx = -r; xx <= r; xx += sp) {
      if (xx * xx + yy * yy > r * r * 0.8) continue;
      const px = x + xx, py = y + yy;
      ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.stroke();
      if (m.B >= 0) { ctx.beginPath(); ctx.arc(px, py, 1, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(px - 2.4, py - 2.4); ctx.lineTo(px + 2.4, py + 2.4); ctx.moveTo(px + 2.4, py - 2.4); ctx.lineTo(px - 2.4, py + 2.4); ctx.stroke(); }
    }
    ctx.font = '600 12px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = rgba(col, 0.9); ctx.textAlign = 'center';
    ctx.fillText((m.B >= 0 ? 'N ' : 'S ') + fmtTesla(Math.abs(m.B)), x, y - r - 8);
  }
  // uniform B field indicator & E-field arrows
  const ctx2 = ctx;
  if (W.Bz) {
    const col = W.Bz > 0 ? [255, 120, 110] : [110, 150, 255];
    ctx2.fillStyle = rgba(col, 0.06); ctx2.fillRect(w2sx(-W.box.w / 2), w2sy(W.box.h / 2), W.box.w * R.s, W.box.h * R.s);
  }
  const E = Math.hypot(W.Ex, W.Ey);
  if (E > 0) {
    const ux = W.Ex / E, uy = W.Ey / E, a = clamp(0.08 + E * 0.12, 0.08, 0.35);
    ctx.strokeStyle = `rgba(255,214,120,${a})`; ctx.lineWidth = 1.2;
    const sp = 70;
    ctx.beginPath();
    for (let y = sp / 2; y < R.h; y += sp) for (let x = sp / 2; x < R.w; x += sp) {
      const L = 16, x1 = x + ux * L, y1 = y - uy * L;
      ctx.moveTo(x - ux * L, y + uy * L); ctx.lineTo(x1, y1);
      const ax = -ux, ay = uy;
      ctx.moveTo(x1, y1); ctx.lineTo(x1 + (ax * 0.8 - ay * 0.5) * 7, y1 + (ay * 0.8 + ax * 0.5) * 7);
      ctx.moveTo(x1, y1); ctx.lineTo(x1 + (ax * 0.8 + ay * 0.5) * 7, y1 + (ay * 0.8 - ax * 0.5) * 7);
    }
    ctx.stroke();
  }
}
/* 750 kT, 1.2 MT, 800 kV: SI prefixes, never an exponent (and 999.7 kT rounds up to 1.0 MT). */
function fmtSI(v, unit, d) {
  const a = Math.abs(v), k = 1 - 0.5 * Math.pow(10, -d);
  for (const [s, pre] of [[1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, '']]) {
    if (a < s * k && s > 1) continue;
    const x = v / s;
    return (Math.abs(Number(x.toPrecision(d))) >= Math.pow(10, d) ? x.toFixed(0) : x.toPrecision(d)) + ' ' + pre + unit; // (99.97 → 100, not 1.0e+2)
  }
  return '';
}
function fmtTesla(B) { return fmtSI(B, 'T', 2); }

/* Cloud-chamber look (W.cloud): a track as a line of droplets, condensed where the particle ionized the vapour —
   white, a little scattered, thicker for a heavily ionizing particle (an α) than a light one (an electron), lingering. */
function cloudTrack(ctx, t, a) {
  const pts = t.pts, heavy = t.w > 2, step = heavy ? 0.45 : 0.9, rad = clamp(Math.sqrt(R.s) * (heavy ? 0.9 : 0.55), heavy ? 1.3 : 0.8, heavy ? 3.2 : 2), jit = heavy ? 0.35 : 0.25;
  ctx.fillStyle = `rgba(235,240,245,${(0.75 * a).toFixed(3)})`;
  ctx.beginPath();
  for (let k = 2; k < pts.length; k += 2) {
    const x0 = pts[k - 2], y0 = pts[k - 1]; let h = (((x0 * 977) | 0) ^ ((y0 * 1489) | 0) * 31) & 0x7fffffff; // (each stretch's droplets stay put as the track ages)
    const dx = pts[k] - x0, dy = pts[k + 1] - y0, L = Math.hypot(dx, dy), n = Math.min(60, Math.ceil(L / step));
    for (let j = 0; j < n; j++) {
      h = (h * 1103515245 + 12345) & 0x7fffffff; const jx = ((h & 0xffff) / 65536 - 0.5) * jit, jy = (((h >> 16) & 0x7fff) / 32768 - 0.5) * jit;
      const x = w2sx(x0 + dx * j / n + jx), y = w2sy(y0 + dy * j / n + jy);
      ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, 2 * Math.PI);
    }
  }
  ctx.fill();
}
function drawTracks(rt) {
  const ctx = R.ctx;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // a trail shows the last TRAIL_S[Settings] seconds of a path: of real time (the same length whatever the speed), or of
  // simulated time (that many seconds' worth at the setup's normal speed: longer when sped up, shorter in slow motion)
  const cloud = !!W.cloud, win = cloud ? Math.max(3, trailWindow()) : trailWindow(), simClock = !cloud && trailSim(), now = simClock ? W.t : rt;
  for (let i = W.tracks.length - 1; i >= 0; i--) {
    const t = W.tracks[i], T = simClock ? t.tt : t.ts;
    const idle = T && T.length ? now - T[T.length - 1] : rt - t.upd; // (since its particle last moved on)
    if (idle > (T ? win : Math.min(win, 1.6))) { W.tracks.splice(i, 1); continue; }
    if (T) { let k = 0; while (k < T.length - 2 && now - T[k] > win) k++; if (k) trkDrop(t, k); }
    const a = clamp(1 - idle / win, 0, 1) * 0.85;
    const pts = t.pts;
    if (pts.length < 4) continue;
    if (cloud) { if (!t.dash) cloudTrack(ctx, t, a); continue; } // (neutral particles leave no trail of ions to condense on)
    ctx.strokeStyle = rgba(t.c, a);
    ctx.lineWidth = t.w;
    if (t.dash) ctx.setLineDash([3, 4]); else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(w2sx(pts[0]), w2sy(pts[1]));
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(w2sx(pts[k]), w2sy(pts[k + 1]));
    ctx.stroke();
  }
  ctx.restore();
}

/* Bonds are gathered into one path per colour, line width and (finely quantized) opacity, and each path stroked once:
   a large world has thousands of bonds, and a stroke call for each half-bond cost more than the lines themselves. */
const _bondPaths = new Map(); // colour → Path2D[] by width class (0: single, 1: multiple) × 64 opacity steps
function bondPath(col, cls, aq) {
  let arr = _bondPaths.get(col);
  if (!arr) { arr = new Array(128).fill(null); _bondPaths.set(col, arr); }
  return arr[cls * 64 + aq] || (arr[cls * 64 + aq] = new Path2D());
}
function drawBonds(rt) {
  if (R.view.bohr === 'nuc') { drawBondPairs(rt); return; }
  if (R.gl) { drawBondsGL(); return; }
  const ctx = R.ctx, s = R.s, orb = R.view.bohr === 'orb';
  const lw = orb ? Math.max(1, 0.05 * s) : Math.max(1.4, 0.13 * s);
  const off = Math.max(2, 0.11 * s), aMul = orb ? 0.45 : 1;
  const X = S.x, Y = S.y, wrap = W.wall === 'wrap', hbw = W.box.w / 2, hbh = W.box.h / 2, cx = R.cx, cy = R.cy, hw = R.w / 2, hh = R.h / 2, Rw = R.w, Rh = R.h;
  const bonds = W.bonds, nb = bonds.length;
  for (let k = 0; k < nb; k++) {
    const bd = bonds[k], a = bd.a, b = bd.b, ia = a.i, ib = b.i;
    const ax = X[ia], ay = Y[ia], bx = X[ib], by = Y[ib];
    if (wrap && (Math.abs(bx - ax) > hbw || Math.abs(by - ay) > hbh)) continue;
    const x0 = (ax - cx) * s + hw, y0 = (cy - ay) * s + hh, x1 = (bx - cx) * s + hw, y1 = (cy - by) * s + hh;
    if ((x0 < -40 && x1 < -40) || (x0 > Rw + 40 && x1 > Rw + 40) || (y0 < -40 && y1 < -40) || (y0 > Rh + 40 && y1 > Rh + 40)) continue;
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    const n = bd.order, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const ca = atomColor(a), cb = atomColor(b);
    const stretch = clamp((L / s - bd.r0) / (bd.rb || 1.5), 0, 1);
    const aq = Math.round((0.95 - stretch * 0.6) * aMul * 64) & 63, cls = n > 1 ? 1 : 0;
    const pa = bondPath(ca, cls, aq), pb = ca === cb ? pa : bondPath(cb, cls, aq);
    for (let q = 0; q < n; q++) {
      const o = (q - (n - 1) / 2) * off, ox = nx * o, oy = ny * o;
      pa.moveTo(x0 + ox, y0 + oy); pa.lineTo(mx + ox, my + oy);
      pb.moveTo(mx + ox, my + oy); pb.lineTo(x1 + ox, y1 + oy);
    }
  }
  ctx.save(); ctx.lineCap = 'round';
  for (const [col, arr] of _bondPaths) {
    ctx.strokeStyle = col;
    for (let idx = 0; idx < 128; idx++) {
      const path = arr[idx];
      if (!path) continue;
      ctx.lineWidth = idx >= 64 ? lw * 0.7 : lw;
      ctx.globalAlpha = (idx & 63) / 64;
      ctx.stroke(path);
      arr[idx] = null;
    }
  }
  ctx.restore();
  if (_bondPaths.size > 64) _bondPaths.clear(); // (colours come and go with the view settings)
}
/* An atom's colour as [r, g, b], found once a frame per slot (the bonds ask for each atom's colour several times). */
let _colGen = new Int32Array(0), _colRGB = [], _colFrame = 0;
function slotColor(i, p) {
  if (_colGen.length < S.size) { const g = new Int32Array(S.size); g.set(_colGen); _colGen = g; _colRGB.length = S.size; }
  if (_colGen[i] === _colFrame) return _colRGB[i];
  const c = hexc(atomColor(p || S.obj[i])); _colRGB[i] = c; _colGen[i] = _colFrame;
  return c;
}
/* The same bonds on the WebGL layer, drawn by the GPU from the slot textures (gl.js): the vertex buffer is rebuilt only
   when the bonding changes; each frame costs one draw call and no JavaScript per bond. */
function drawBondsGL() {
  const s = R.s, orb = R.view.bohr === 'orb';
  const hw = (orb ? Math.max(1, 0.05 * s) : Math.max(1.4, 0.13 * s)) / 2;
  const off = Math.max(2, 0.11 * s), aMul = orb ? 0.45 : 1;
  glBondsBuild(W.bonds, W.topo);
  glDrawBonds(hw, off, aMul, W.wall === 'wrap', W.box.w / 2, W.box.h / 2);
}
/* The slot textures for this frame: positions always; the balls' colours and styles when they may have changed (per
   frame when the colour follows charge or heat; else when a count changed, and every eighth frame anyway, since an ion
   forming changes a radius without any count changing). Leptons and bare nuclei are left out (drawn by other means). */
const _elCol = [], _elColAnti = [];
function elColor(Z, anti) { const T = anti ? _elColAnti : _elCol; let c = T[Z]; if (!c) { c = T[Z] = hexc(anti ? mixHex(baseElColor(Z), ANTI_TINT, 0.5) : baseElColor(Z)); } return c; }
let _stySig = '', _styFrame = 0;
function glSlotsPrepare() {
  const hi = S.hi;
  glSlotPositions(hi);
  const mode = R.view.color, bohr = R.view.bohr, perFrame = mode !== 'element';
  const sig = `${W.topo}|${W.dirty}|${W.spawned}|${W.deaths}|${mode}|${bohr}|${hi}|${R.as}|${R.cvd}`;
  if (!perFrame && sig === _stySig && (++_styFrame & 7)) return;
  _stySig = sig; _styFrame = 0;
  const C = GL_T.colA, Y = GL_T.styA, DEAD = S.dead, K = S.k, Z = S.Z, NE = S.ne, ANTI = S.anti, OBJ = S.obj;
  const maxAtom = bohr === 'auto' ? 30 : 1e9, nCol = hexc(N_COL); // (an atom drawn 30 px or bigger gets the Bohr picture instead)
  for (let i = 0; i < hi; i++) {
    const c4 = 4 * i;
    if (DEAD[i] === 1 || K[i] !== NUC || (Z[i] > 0 && NE[i] === 0)) { C[c4 + 3] = 0; continue; }
    if (Z[i] === 0) { Y[c4] = 0.2; Y[c4 + 1] = 2.2; Y[c4 + 2] = 1e9; C[c4] = nCol[0]; C[c4 + 1] = nCol[1]; C[c4 + 2] = nCol[2]; C[c4 + 3] = 255; continue; }
    const p = OBJ[i], col = mode === 'element' ? elColor(Z[i], ANTI[i] === 1) : hexc(atomColor(p));
    Y[c4] = p.rd * R.as; Y[c4 + 1] = 2.4; Y[c4 + 2] = maxAtom; C[c4] = col[0]; C[c4 + 1] = col[1]; C[c4 + 2] = col[2]; C[c4 + 3] = 255;
  }
  glSlotStyle(hi);
}
/* Particle view: a bond is its shared electrons, one pair per bond order, swirling between the two nuclei and
   sitting nearer the more electronegative atom. */
function drawBondPairs(rt) {
  const ctx = R.ctx, s = R.s, er = electronR(), sep = Math.max(1.6, 0.1 * s), off = Math.max(3, 0.24 * s);
  ctx.save();
  for (const bd of W.bonds) {
    const a = bd.a, b = bd.b;
    if (W.wall === 'wrap' && (Math.abs(b.x - a.x) > W.box.w / 2 || Math.abs(b.y - a.y) > W.box.h / 2)) continue;
    const x0 = w2sx(a.x), y0 = w2sy(a.y), x1 = w2sx(b.x), y1 = w2sy(b.y);
    if ((x0 < -40 && x1 < -40) || (x0 > R.w + 40 && x1 > R.w + 40) || (y0 < -40 && y1 < -40) || (y0 > R.h + 40 && y1 > R.h + 40)) continue;
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux;
    // between the edges of the two (enlarged) nuclei, nearer the more electronegative atom
    const ra = nucleonR() * rnUnit(a.Z + a.N), rb = nucleonR() * rnUnit(b.Z + b.N);
    const hg = Math.max(0, (L - ra - rb) / 2), t = hg > 0 ? ra + hg : L / 2;
    const pull = clamp(0.15 * (((b.el && b.el.en) || 2.5) - ((a.el && a.el.en) || 2.5)), -0.35, 0.35) * (hg > 0 ? hg : L / 2);
    const mx = x0 + ux * (t + pull), my = y0 + uy * (t + pull);
    const sp = ballSprite(a.anti ? POS_COL : E_COL, er), n = bd.order;
    for (let k = 0; k < n; k++) {
      const o = (k - (n - 1) / 2) * off, cx = mx + nx * o, cy = my + ny * o;
      const ph = rt * 2.4 + (a.id * 7 + b.id * 13 + k * 2.1) % 6.283;
      const c = Math.cos(ph) * sep, sn = Math.sin(ph) * sep * 0.55; // the pair swirls in a flat ellipse along the bond
      const dx = ux * c + nx * sn, dy = uy * c + ny * sn;
      drawSprite(sp, cx + dx, cy + dy); drawSprite(sp, cx - dx, cy - dy);
    }
  }
  ctx.restore();
}
function drawHBonds() {
  if (R.s < 6) return;
  const ctx = R.ctx;
  const H = [], acc = [];
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC) continue;
    if (p.polarH) H.push(p);
    else if ((p.Z === 7 || p.Z === 8 || p.Z === 9) && p.ne > 0 && p.lp > 0) acc.push(p);
  }
  if (!H.length || !acc.length || H.length * acc.length > 120000) return;
  ctx.save(); ctx.strokeStyle = 'rgba(140,200,255,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
  ctx.beginPath();
  for (const h of H) {
    const d = h.bonds[0] ? other(h.bonds[0], h) : null;
    for (const a of acc) {
      if (a === d) continue;
      const dx = a.x - h.x, dy = a.y - h.y, r2 = dx * dx + dy * dy;
      if (r2 < 1.5 * 1.5 || r2 > 2.3 * 2.3) continue;
      ctx.moveTo(w2sx(h.x), w2sy(h.y)); ctx.lineTo(w2sx(a.x), w2sy(a.y));
    }
  }
  ctx.stroke(); ctx.restore();
}

function nucleusBeads(ctx, x, y, rn, Z, N, alpha, anti) {
  const A = Z + N;
  if (A <= 0) return;
  const pc = anti ? PBAR_COL : P_COL, nc = anti ? NBAR_COL : N_COL;
  if (A > 70 || rn < 3) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = A > 70 ? '#e8796f' : pc;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, rn), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const br = Math.max(0.8, rn / Math.sqrt(A) * 1.05);
  // deterministic interleave of protons and neutrons
  let pz = 0;
  for (let k = 0; k < A; k++) {
    const rr = A === 1 ? 0 : rn * Math.sqrt((k + 0.5) / A) * 0.92, th = k * 2.39996; // (a lone nucleon sits at the centre)
    const isP = (pz + 0.5) / Z <= (k + 1) / A && pz < Z;
    if (isP) pz++;
    const bx = x + rr * Math.cos(th), by = y + rr * Math.sin(th);
    ctx.globalAlpha = alpha;
    drawSprite(ballSprite(isP ? pc : nc, br), bx, by);
  }
  ctx.globalAlpha = 1;
}

function drawParticles(rt) {
  const ctx = R.ctx, s = R.s;
  const bohrMode = R.view.bohr;
  const pad = 40;
  R.orbBudget = 2.5e5; // pixels of new orbital pictures per frame (a few ms)
  ctx.save();
  // incandescent halos & excitation glow (additive)
  ctx.globalCompositeOperation = 'lighter';
  const parts = W.parts, np = parts.length, PI = partsSync(), X = S.x, Y = S.y, DEAD = S.dead, K = S.k, NE = S.ne;
  const cx = R.cx, cy = R.cy, hw = R.w / 2, hh = R.h / 2, xMax = R.w + pad, yMax = R.h + pad;
  const gl = R.gl, Z = S.Z;
  if (!R.lite) for (let j = 0; j < np; j++) {
    const i = PI[j];
    if (DEAD[i] === 1) continue;
    const x = (X[i] - cx) * s + hw, y = (cy - Y[i]) * s + hh;
    if (x < -pad || y < -pad || x > xMax || y > yMax) continue;
    const p = parts[j];
    if (K[i] === NUC && NE[i] > 0 && p.tLocal > 900 && !p.fast) {
      const a = clamp((p.tLocal - 900) / 4000, 0, 0.7), rg = clamp(p.rd * R.as * s * 3.2, 6, 48); // (capped: zoomed in, a halo, not a blob)
      if (gl) glGlow(x, y, rg, blackbodyRGB(p.tLocal), a); else drawSprite(glowSprite(blackbodyRGB(p.tLocal), rg), x, y, a);
    }
    if (p.glow > 0.02 && p.glowC) { const rg = clamp(p.rd * R.as * s * 5, 10, 32); if (gl) glGlow(x, y, rg, p.glowC, p.glow); else drawSprite(glowSprite(p.glowC, rg), x, y, p.glow); } // (light given off: a glint, however far zoomed in)
  }
  ctx.globalCompositeOperation = 'source-over';
  // the WebGL layer: the plain balls (atoms, ions, neutrons, free leptons with their glows) in one draw call each,
  // laid down here; the 2D pass below then adds what goes on top of them and draws whatever is not a plain ball
  const glBalls = gl && (bohrMode === 'auto' || bohrMode === 'on');
  if (glBalls) {
    const lite = R.lite, rl = Math.max(1.8, 0.12 * s), rlg = clamp(rl * 4.5, 7, 28), eCol = hexc(E_COL), pCol = hexc(POS_COL);
    const bohrAll = bohrMode === 'on';
    if (!bohrAll) glDrawSlots(S.hi); // atoms and neutrons: one draw call from the slot textures
    for (let j = 0; j < np; j++) { // free leptons, with their glows, by item (few)
      const i = PI[j];
      if (DEAD[i] === 1 || K[i] === NUC) continue;
      const x = (X[i] - cx) * s + hw, y = (cy - Y[i]) * s + hh;
      if (x < -pad || y < -pad || x > xMax || y > yMax) continue;
      const p = parts[j], c = K[i] === ELEC ? eCol : pCol; if (!lite) glGlow(x, y, rlg, c, p.rad ? 1 : 0.55); glBall(x, y, lite ? rl * 1.2 : rl, c);
    }
    glFlush();
  }
  // with the balls on the WebGL layer, a plain atom too small for a label or a charge badge needs nothing more here
  const ANTI = S.anti, plainSkip = glBalls && s * 1.6 < 5;
  const lateLeptons = bohrMode === 'orb' ? [] : null; // over the orbital clouds, free electrons go on top
  for (let j = 0; j < np; j++) {
    const i = PI[j];
    if (DEAD[i] === 1) continue;
    if (glBalls && K[i] !== NUC) continue; // (free leptons: on the WebGL layer)
    if (plainSkip && NE[i] > 0 && ANTI[i] === 0 && Z[i] > 0) continue;
    const x = (X[i] - cx) * s + hw, y = (cy - Y[i]) * s + hh;
    if (x < -pad || y < -pad || x > xMax || y > yMax) continue;
    const p = parts[j];
    if (K[i] !== NUC) {
      if (lateLeptons) lateLeptons.push(p); else drawLepton(ctx, p, x, y, bohrMode);
      continue;
    }
    if (p.Z === 0) { // neutron
      if (bohrMode === 'nuc') { // a single nucleon, the same size as those in nuclei, with a faint halo
        const rb = 1.12 * nucleonR();
        if (!R.lite) { ctx.globalCompositeOperation = 'lighter'; drawSprite(glowSprite([150, 165, 185], Math.max(6, rb * 4)), x, y, 0.3); }
        ctx.globalCompositeOperation = 'source-over'; drawSprite(nucleusSprite(0, 1, nucleonR(), p.anti), x, y);
        continue;
      }
      const r = Math.max(2.2, 0.2 * s);
      if (!glBalls) drawSprite(ballSprite(N_COL, r), x, y);
      if (r > 9 && bohrMode !== 'nuc') label(ctx, 'n', x, y, r, '#1b2430');
      continue;
    }
    if (p.ne === 0 && bohrMode === 'nuc') { // bare nucleus, every nucleon shown
      const nsp = nucleusSprite(p.Z, p.N, nucleonR(), p.anti);
      ctx.globalCompositeOperation = 'lighter'; // true size, so a halo marks it out
      if (!R.lite) drawSprite(glowSprite(p.anti ? [190, 120, 255] : [255, 110, 90], Math.max(7, nsp.rn * 3.2)), x, y, 0.4);
      ctx.globalCompositeOperation = 'source-over';
      drawSprite(nsp, x, y);
      continue;
    }
    if (p.ne === 0) { // bare nucleus
      const rn = Math.max(2.6, p.rd * R.as * s);
      ctx.globalCompositeOperation = 'lighter';
      if (!R.lite) drawSprite(glowSprite(p.anti ? [190, 120, 255] : [255, 110, 90], rn * 3.2), x, y, 0.35);
      ctx.globalCompositeOperation = 'source-over';
      nucleusBeads(ctx, x, y, rn, p.Z, p.N, 1, p.anti);
      if (rn > 7 && lblOn(p) && bohrMode !== 'nuc') smallTag(ctx, speciesLabel(p), x, y + rn + 9);
      continue;
    }
    const r = Math.max(2.4, p.rd * R.as * s);
    if (bohrMode === 'nuc') { drawNucView(p, x, y, r, rt); continue; }
    if (bohrMode === 'orb') {
      const rv = drawOrbitalAtom(ctx, p, x, y);
      if (lblOn(p) && rv >= 12) {
        ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = CHAMBER.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(speciesLabel(p), x, y + rv + 9);
      }
      if (p.anti) {
        ctx.save(); ctx.strokeStyle = 'rgba(190,130,255,0.85)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, rv + 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (p.q !== 0 && rv >= 5 && badgeOn(p)) chargeBadge(ctx, p.q, x + rv * 0.78, y - rv * 0.78, Math.min(rv, 20));
      continue;
    }
    const col = atomColor(p);
    const bohr = bohrMode === 'on' || (bohrMode === 'auto' && r >= 30);
    if (bohr) drawBohr(ctx, p, x, y, r, rt, col);
    else {
      if (!glBalls) drawSprite(ballSprite(col, r), x, y);
      if (lblOn(p) && r >= 8.5) label(ctx, p.anti ? barSym(p.el.sym) : p.el.sym, x, y, r, luminance(col) > 150 ? '#16202b' : '#f1f5f9');
    }
    if (p.anti) { // antimatter: a dashed violet halo
      ctx.save(); ctx.strokeStyle = 'rgba(190,130,255,0.85)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (p.q !== 0 && r >= 5 && badgeOn(p)) chargeBadge(ctx, p.q, x + r * 0.78, y - r * 0.78, r);
  }
  if (lateLeptons) for (const p of lateLeptons) drawLepton(ctx, p, w2sx(p.x), w2sy(p.y), bohrMode);
  ctx.restore();
  // the Select tool's selection: a ring round each (a tint only, when there are thousands)
  if (R.msel.size) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,209,102,0.85)'; ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.lineWidth = 1.5;
    const many = R.msel.size > 2500;
    ctx.beginPath();
    for (const p of R.msel) {
      if (p.dead) continue;
      const x = w2sx(p.x), y = w2sy(p.y); if (x < -20 || y < -20 || x > R.w + 20 || y > R.h + 20) continue;
      const r = Math.max(4, (p.k === NUC ? p.rd : 0.15) * s) + (many ? 1 : 3);
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    if (many) ctx.fill(); else ctx.stroke();
    ctx.restore();
  }
  if (R.molTags.length) { // names from Identify molecules, over each molecule for a while, fading at the end
    const now = W.rt; let live = 0;
    ctx.save(); ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of R.molTags) {
      const left = t.until - now; if (left <= 0 || t.p.dead) continue; live++;
      const x = w2sx(t.p.x), y = w2sy(t.p.y) - Math.max(6, t.p.rd * s) - 10; if (x < -80 || y < -20 || x > R.w + 80 || y > R.h + 20) continue;
      ctx.globalAlpha = Math.min(1, left / 1.5); const w = ctx.measureText(t.text).width + 10;
      ctx.fillStyle = 'rgba(16,27,36,0.78)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 4); ctx.fill();
      ctx.fillStyle = '#ffd166'; ctx.fillText(t.text, x, y);
    }
    ctx.restore();
    if (!live) R.molTags.length = 0;
  }
  // selection / hover rings (a photon, neutrino or unstable particle in flight: a ring where it is now)
  if (R.selX) { const h = selXHead(); if (h) { ctx.save(); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w2sx(h[0]), w2sy(h[1]), 9, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } }
  for (const p of [R.sel, R.hover]) {
    if (!p || p.dead) continue;
    const x = w2sx(p.x), y = w2sy(p.y), r = Math.max(6, (p.k === NUC ? p.rd : 0.15) * s) + 5;
    ctx.save(); ctx.strokeStyle = p === R.sel ? '#ffd166' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = p === R.sel ? 2 : 1;
    ctx.setLineDash(p === R.sel ? [] : [3, 3]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}
/* Unstable particles in flight (muons, pions, kaons…): a glowing point in the particle's colour with its symbol;
   neutral ones, which leave no track in a real detector, a ring and a dotted path. */
const _xpHex = {};
/* Strings breaking (W.strings): a colour string stretching out both ways from a hard collision, then snapping into
   pieces, each piece the seed of a hadron (shown in real time, about a second; the real thing takes 10⁻²³ s). And a
   quark–gluon plasma (W.qgp): a hot drop of free quarks and gluons that swells, cools from white to red and freezes
   out into hadrons. Pictures of what happened: the products themselves are already flying. */
function drawStrings(rt) {
  const ctx = R.ctx;
  if (W.strings && W.strings.length) {
    ctx.save(); ctx.lineCap = 'round';
    for (let i = W.strings.length - 1; i >= 0; i--) {
      const s = W.strings[i], age = rt - s.t0;
      if (age > 1.4 || age < 0) { W.strings.splice(i, 1); continue; }
      const grow = Math.min(1, age / 0.35), Lpx = Math.max(60, 12 * R.s) * grow, a = age < 0.9 ? 1 : 1 - (age - 0.9) / 0.5; // (its length on screen, in pixels)
      const x = w2sx(s.x), y = w2sy(s.y), ux = s.ax, uy = -s.ay, n = s.n, broken = age > 0.35;
      ctx.lineWidth = 3; ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 10;
      for (const sg of [1, -1]) for (let k = 0; k < n / 2; k++) {
        const t0 = k / (n / 2), t1 = (k + 1) / (n / 2), gap = broken ? 0.12 : 0, L0 = Lpx * (t0 + gap / 2), L1 = Lpx * (t1 - gap / 2);
        ctx.strokeStyle = `rgba(255,${180 - 60 * (k % 2)},${90 + 80 * (k % 3 === 0)},${(0.85 * a).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x + sg * ux * L0, y + sg * uy * L0); ctx.lineTo(x + sg * ux * L1, y + sg * uy * L1); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
  if (W.qgp && W.qgp.length) {
    ctx.save();
    for (let i = W.qgp.length - 1; i >= 0; i--) {
      const g = W.qgp[i], age = rt - g.t0;
      if (age > 2.2 || age < 0) { W.qgp.splice(i, 1); continue; }
      const x = w2sx(g.x), y = w2sy(g.y), r = (14 + 40 * Math.min(1, age / 1.4)) * Math.max(0.6, Math.min(2, R.s / 6)), heat = Math.max(0, 1 - age / 1.4), a = age < 1.4 ? 1 : 1 - (age - 1.4) / 0.8;
      const core = `rgba(255,${Math.round(150 + 105 * heat)},${Math.round(80 + 175 * heat * heat)},${(0.75 * a).toFixed(3)})`;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, core); gr.addColorStop(0.6, `rgba(255,110,40,${(0.35 * a).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
      // free quarks and gluons milling about inside, in their colours
      const cols = ['255,90,90', '90,220,120', '100,150,255'];
      for (let k = 0; k < 36; k++) { const ph = k * 2.399 + age * (1.5 + (k % 5) * 0.4), rr = r * 0.75 * Math.sqrt(((k * 0.618) % 1)), qx = x + rr * Math.cos(ph), qy = y + rr * Math.sin(ph);
        ctx.fillStyle = k % 4 === 3 ? `rgba(255,255,255,${(0.6 * a * heat + 0.2 * a).toFixed(3)})` : `rgba(${cols[k % 3]},${(0.8 * a).toFixed(3)})`; ctx.beginPath(); ctx.arc(qx, qy, k % 4 === 3 ? 1.6 : 2.4, 0, 2 * Math.PI); ctx.fill(); }
      if (R.view.labels !== false) { ctx.font = '11px ' + (typeof cssVar === 'function' ? cssVar('--font-data') : 'monospace'); ctx.fillStyle = `rgba(255,220,190,${a.toFixed(3)})`; ctx.textAlign = 'center';
        ctx.fillText(age < 1.2 ? 'quark–gluon plasma' : `→ ${g.n.toLocaleString('en-US')} hadrons`, x, y - r - 6); ctx.textAlign = 'left'; }
    }
    ctx.restore();
  }
}
function drawExos() {
  if (!W.exo.length) return;
  const ctx = R.ctx;
  ctx.save();
  ctx.font = '600 10px "Azeret Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  for (const o of W.exo) {
    if (o.dead) continue;
    const x = w2sx(o.x), y = w2sy(o.y);
    if (x < -30 || y < -30 || x > R.w + 30 || y > R.h + 30) continue;
    const c = XP[o.sp].col, hx = _xpHex[o.sp] || (_xpHex[o.sp] = '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''));
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(glowSprite(c, 10), x, y, o.q ? 0.95 : 0.55);
    ctx.globalCompositeOperation = 'source-over';
    if (o.q) drawSprite(ballSprite(hx, 2.3), x, y);
    else { ctx.strokeStyle = rgba(c, 0.95); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = rgba(c, 0.95);
    ctx.fillText(o.lab, x, y - 5);
  }
  ctx.restore();
}
/* A free electron or positron: a glowing point (classical: it has a position and a path). */
function drawLepton(ctx, p, x, y, bohrMode) {
  const col = p.k === ELEC ? E_COL : POS_COL;
  const r = bohrMode === 'nuc' ? electronR() : Math.max(1.8, 0.12 * R.s);
  if (!R.lite) {
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(glowSprite(hexc(col), clamp(r * 4.5, 7, 28)), x, y, p.rad ? 1 : 0.55);
    ctx.globalCompositeOperation = 'source-over';
  }
  drawSprite(ballSprite(col, R.lite ? r * 1.2 : r), x, y);
}
function label(ctx, text, x, y, r, col) {
  ctx.fillStyle = col;
  ctx.font = `600 ${Math.round(clamp(r * 0.95, 8, 30))}px "Hanken Grotesk", system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}
function smallTag(ctx, text, x, y) {
  ctx.font = '500 10px "Azeret Mono", ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = CHAMBER.dim;
  ctx.fillText(text, x, y);
}
function chargeBadge(ctx, q, x, y, r) {
  const t = (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '−');
  const fs = Math.round(clamp(r * 0.55, 8, 15));
  ctx.font = `700 ${fs}px "Azeret Mono", ui-monospace, monospace`;
  const w = ctx.measureText(t).width + 6;
  ctx.fillStyle = R.cvd ? (q > 0 ? 'rgba(230,159,0,0.95)' : 'rgba(0,114,178,0.95)') : q > 0 ? 'rgba(255,90,78,0.92)' : 'rgba(77,141,255,0.92)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - fs / 2 - 2, w, fs + 4, (fs + 4) / 2) : ctx.rect(x - w / 2, y - fs / 2 - 2, w, fs + 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y + 0.5);
}
function drawBohr(ctx, p, x, y, r, rt, col) {
  const sh = shellCounts(p.Z, p.ne);
  const nS = sh.length;
  // electron cloud
  const [cr, cg, cb] = hexc(col);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.25);
  g.addColorStop(0, `rgba(${cr},${cg},${cb},0.30)`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, Math.PI * 2); ctx.fill();
  const rn = clamp(r * 0.2, 3, 22);
  for (let i = 0; i < nS; i++) {
    const R0 = rn + 4 + (r * 1.12 - rn - 4) * (i + 1) / nS;
    ctx.strokeStyle = 'rgba(160,200,240,0.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, R0, 0, Math.PI * 2); ctx.stroke();
    const ne = sh[i];
    const w = (0.8 / (i + 1)) * (p.id % 2 ? 1 : -1);
    const er = clamp(r * 0.045, 1.6, 4);
    for (let k = 0; k < ne; k++) {
      const th = rt * w + k * 2 * Math.PI / ne + i * 0.7;
      drawSprite(ballSprite(p.anti ? POS_COL : E_COL, er), x + R0 * Math.cos(th), y + R0 * Math.sin(th));
    }
  }
  nucleusBeads(ctx, x, y, rn, p.Z, p.N, 1, p.anti);
  if (R.view.labels) {
    ctx.font = '600 12px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = CHAMBER.text; ctx.textAlign = 'center';
    ctx.fillText(nucSymA(p.Z, p.N, p.anti) + (p.q ? sup((Math.abs(p.q) > 1 ? Math.abs(p.q) : '') + (p.q > 0 ? '+' : '-')) : ''), x, y + r * 1.25 + 12);
  }
}

/* Orbitals view: each atom's electron density computed from its orbitals (orbitals.js), drawn as light, so where
   clouds overlap (a bond, a metal) they glow brighter. Pictures are made per species and size, a few per frame. */
const _orbSpr = new Map();
let _orbPx = 0;
function orbSprite(Z, ne, D, force) { // D: diameter in device pixels
  const N = clamp(1 << Math.ceil(Math.log2(Math.max(16, D))), 16, 512), key = Z * 512 + ne;
  let c = _orbSpr.get(key + ':' + N);
  if (c) return c;
  if (!force && !(R.orbBudget > 0)) { // made enough this frame: any size already made will do for now
    for (let n = 512; n >= 16; n >>= 1) { const o = _orbSpr.get(key + ':' + n); if (o) return o; }
    return null;
  }
  R.orbBudget -= N * N;
  c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  if (img && img.data) { img.data.set(orbitalPixels(orbitalSet(Z, ne), N)); g.putImageData(img, 0, 0); }
  if (_orbPx > 8e6) for (const [k, v] of _orbSpr) { _orbPx -= v.width * v.height; _orbSpr.delete(k); if (_orbPx < 4e6) break; }
  _orbPx += N * N;
  _orbSpr.set(key + ':' + N, c);
  return c;
}
/* Draws atom p's cloud at (x, y) with its nucleus; returns the radius of the visible cloud in pixels. */
function drawOrbitalAtom(ctx, p, x, y) {
  const O = orbitalSet(p.Z, p.ne), D = 2 * O.rmax * R.s, rv = Math.max(4, O.rvis * R.s);
  const sp = orbSprite(p.Z, p.ne, D * R.dpr);
  ctx.globalCompositeOperation = 'screen'; // overlapping clouds brighten without burning out
  if (sp) ctx.drawImage(sp, x - D / 2, y - D / 2, D, D);
  else drawSprite(glowSprite([88, 196, 255], rv), x, y, 0.5);
  ctx.globalCompositeOperation = 'source-over';
  drawSprite(ballSprite(p.anti ? PBAR_COL : P_COL, clamp(0.05 * R.s, 1.2, 4)), x, y);
  return rv;
}

/* Particle view: every nucleon of a nucleus, its Z protons and N neutrons, packed in a sunflower spiral and drawn at
   one common size, so a nucleus's area grows with its mass number (uranium-238 really is bigger than carbon-12).
   Each nuclide is drawn once per size and cached as a sprite. */
const _rnU = [];
function rnUnit(A) { // outer radius of the packed cluster, for a nucleon radius of 1
  if (_rnU[A] === undefined) _rnU[A] = A <= 1 ? 1.12 : Math.sqrt((A - 0.5) / 0.82) + 1.12;
  return _rnU[A];
}
function nucleonR() { return clamp(0.045 * R.s, 0.75, 8); } // one size for every nucleon, bound or free
function electronR() { return clamp(0.035 * R.s, 1.0, 3.0); }
function nucleusSprite(Z, N, b, anti) {
  const A = Z + N, bq = b < 2 ? Math.round(b * 10) / 10 : Math.round(b * 4) / 4;
  const key = `nuc|${Z}|${N}|${bq}|${anti ? 1 : 0}`;
  let sp = R.sprites.get(key);
  if (sp) return sp;
  if (R.sprites.size > 600) R.sprites.clear();
  const d = R.dpr, rn = bq * rnUnit(A), size = Math.ceil((2 * rn + 2) * d);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), m = size / 2, cs = bq / Math.sqrt(0.82) * d, br = bq * 1.12 * d;
  const pc = hexc(anti ? PBAR_COL : P_COL), nc = hexc(anti ? NBAR_COL : N_COL);
  // exactly Z of the places are protons, chosen by a fixed shuffle so they mix irregularly with the neutrons
  const order = [];
  for (let k = 0; k < A; k++) { const h = Math.sin((k + 1) * 12.9898 + Z * 78.233 + N * 37.719) * 43758.5453; order.push([h - Math.floor(h), k]); }
  order.sort((u, v) => u[0] - v[0]);
  const prot = new Uint8Array(A);
  for (let j = 0; j < Math.min(Z, A); j++) prot[order[j][1]] = 1;
  const pos = [];
  let pz = 0;
  for (let k = 0; k < A; k++) {
    const isP = prot[k] === 1;
    if (isP) pz++;
    const rr = A === 1 ? 0 : cs * Math.sqrt(k + 0.5), th = k * 2.39996;
    pos.push([m + rr * Math.cos(th), m + rr * Math.sin(th), isP]);
  }
  for (let k = A - 1; k >= 0; k--) { // rim first, so the middle sits on top like the near side of a ball
    const [bx, by, isP] = pos[k], col = isP ? pc : nc;
    if (br >= 1.6) {
      const grd = g.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
      grd.addColorStop(0, `rgb(${Math.min(255, col[0] + 80)},${Math.min(255, col[1] + 80)},${Math.min(255, col[2] + 80)})`);
      grd.addColorStop(0.5, `rgb(${col[0]},${col[1]},${col[2]})`);
      grd.addColorStop(1, `rgb(${Math.round(col[0] * 0.5)},${Math.round(col[1] * 0.5)},${Math.round(col[2] * 0.5)})`);
      g.fillStyle = grd;
    } else g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
  }
  sp = { c, size: size / d, rn, Z: pz, N: A - pz };
  R.sprites.set(key, sp);
  return sp;
}
/* Particle view: an atom is only its nucleus and the electrons it keeps to itself, circling in their shells
   (the innermost shell just outside the nucleus); electrons shared in bonds are drawn on the bonds. No colours,
   rings or labels. */
function drawNucView(p, x, y, r, rt) {
  const nsp = nucleusSprite(p.Z, p.N, nucleonR(), p.anti), rn = nsp.rn;
  const own = Math.max(0, p.ne - p.used);
  if (own > 0) {
    const sh = shellCounts(p.Z, own), er = electronR();
    const nF = Math.max(sh.length, shellCounts(p.Z, Math.max(p.Z, p.ne)).length); // the neutral atom's shells
    const rIn = rn + 1.5 * er + 1, rOut = Math.max(r * 1.05, rIn + (nF - 1) * 2.2 * er);
    const sp = ballSprite(p.anti ? POS_COL : E_COL, er);
    for (let i = 0; i < sh.length; i++) {
      const ne = sh[i]; if (!ne) continue;
      const R0 = nF === 1 ? rOut : rIn + (rOut - rIn) * i / (nF - 1), w = (1.1 / (i + 1)) * (p.id % 2 ? 1 : -1);
      for (let k = 0; k < ne; k++) {
        const th = rt * w + k * 2 * Math.PI / ne + i * 0.7 + p.id;
        drawSprite(sp, x + R0 * Math.cos(th), y + R0 * Math.sin(th));
      }
    }
  }
  drawSprite(nsp, x, y);
}
function drawFlashes(rt) {
  if (R.lite) { W.flashes.length = 0; return; }
  const ctx = R.ctx;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = W.flashes.length - 1; i >= 0; i--) {
    const f = W.flashes[i], age = rt - f.t0;
    if (age > f.life) { W.flashes.splice(i, 1); continue; }
    const k = age / f.life;
    const r = Math.min(Math.max(10, f.s * R.s * (0.6 + 1.6 * k)), 70 + 14 * f.s); // (no bigger than so much screen, zoomed in)
    drawSprite(glowSprite(f.c, r * (R.flashK < 1 ? 0.6 : 1)), w2sx(f.x), w2sy(f.y), (1 - k) * 0.9 * R.flashK);
  }
  ctx.restore();
}
function drawRays(rt) {
  const ctx = R.ctx;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const life = 0.45;
  for (let i = W.rays.length - 1; i >= 0; i--) {
    const r = W.rays[i];
    // its light goes at c on the simulation's clock: at normal speed it is across within the frame, and whenever time
    // is slowed it is seen going, as fast as the Light tool's photons; it fades once it has arrived
    const m = rayFrac(r);
    if (m >= 1 && r.ta === undefined) r.ta = rt;
    const k = r.ta === undefined ? 0 : (rt - r.ta) / life;
    if (k > 1 || rt - r.t0 > 30) { W.rays.splice(i, 1); continue; }
    const a = (1 - k) * (r.nu ? 0.35 : 0.85);
    const x0 = w2sx(r.x0), y0 = w2sy(r.y0), x1 = w2sx(r.x1), y1 = w2sy(r.y1);
    const hx = x0 + (x1 - x0) * m, hy = y0 + (y1 - y0) * m;
    r.hx = hx; r.hy = hy; r.alpha = a; // (where its label goes)
    ctx.strokeStyle = rgba(r.c, a * 0.5); ctx.lineWidth = r.E >= 1e5 ? 1.2 : 1.6;
    if (r.nu) ctx.setLineDash([1, 5]); else if (r.E >= 1e5) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(hx, hy); ctx.stroke();
    if (!r.nu) { ctx.setLineDash([]); drawSprite(glowSprite(r.c, 7), hx, hy, a); }
  }
  ctx.restore();
}
/* Chips at work (chips.js): each gate glows by its voltage (warm for high, a cool blue for low), carriers run along
   the channels that conduct (electrons blue, holes pink), the flash cell's trapped electrons sit on its floating gate,
   and the circuit's nodes are labelled with their logic level. */
function chipPathAt(path, s) {
  const f = clamp(s, 0, 1) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), t = f - i, a = path[i], b = path[i + 1];
  return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
}
function chipLabel(ctx, x, y, text, col, align) {
  const fs = clamp(R.s * 0.5, 10, 14);
  ctx.font = `700 ${fs}px ${CH_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 8, h = fs + 6;
  if (align === 'left') x += w / 2;
  ctx.fillStyle = 'rgba(8,14,22,0.78)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = col; ctx.fillText(text, x, y + 0.5);
}
/* Where a gate's output (between its two transistors) or input (above its gates) is drawn, in world coordinates. */
function chipPort(ch, which) {
  const [n, p] = ch.devs;
  if (which === 'out') { const a = n.path[n.path.length - 1], b = p.path[0]; return [(a.x + b.x) / 2, Math.max(a.y, b.y) + 3.2]; }
  let x = 0, k = 0, top = -Infinity; for (const d of ch.devs) for (const q of d.gate) { x += q.x; k++; top = Math.max(top, q.y); }
  return [x / k, top + 2.6];
}
function chipLevelCol(v) { return v > 0.6 * CHIP.VDD ? '#ffb347' : v < 0.4 * CHIP.VDD ? '#7fb6ff' : '#e6e6e6'; }
/* Under the atoms: each gate's block lit by its voltage (amber high, blue low or negative), and a channel that conducts
   glowing along the silicon's top row, brighter the more current it carries. */
function drawChipsUnder() {
  if (!W.chips.length || R.s < 2) return;
  const ctx = R.ctx;
  ctx.save();
  const block = (list, v, vmax) => {
    const [x0, x1, y0, y1] = chipBox(list), k = clamp(Math.abs(v) / vmax, 0, 1), m = 1.1;
    ctx.fillStyle = v >= 0 ? `rgba(255,165,60,${0.08 + 0.4 * k})` : `rgba(80,180,255,${0.08 + 0.4 * k})`;
    const X0 = w2sx(x0 - m), Y0 = w2sy(y1 + m), Wd = (x1 - x0 + 2 * m) * R.s, Hd = (y1 - y0 + 2 * m) * R.s;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(X0, Y0, Wd, Hd, Math.min(10, 0.6 * R.s)); else ctx.rect(X0, Y0, Wd, Hd); ctx.fill();
  };
  for (const ch of W.chips) {
    if (ch.broken) continue;
    const ends = CHIP_ENDS[ch.key] || [];
    ch.devs.forEach((d, i) => {
      block(d.gate, chipNode(ch, ends[i] ? ends[i][2] : 'G'), ch.key === 'flashcell' ? 9 : CHIP.VDD);
      if (d.cg) block(d.cg, ch.v.cg, CHIP.V_PROG);
      const I = Math.abs(d.I);
      if (I > 1e-9) {
        const k = clamp(Math.log10(I / 1e-9) / Math.log10(4e4), 0.05, 1);
        ctx.strokeStyle = d.t === 'n' ? `rgba(77,168,255,${0.55 * k})` : `rgba(255,111,200,${0.55 * k})`;
        ctx.lineWidth = Math.max(3, 1.4 * R.s); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); d.path.forEach((p, j) => { const x = w2sx(p.x), y = w2sy(p.y + 0.4); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      }
    });
  }
  ctx.restore();
}
function drawChips(rt) {
  if (!W.chips.length || R.s < 2) return;
  const ctx = R.ctx, er = clamp(0.22 * R.s, 3, 7);
  let mem = null; // two or more flash cells: each labelled with its place in the memory and the bit it stores
  if (W.chips.length > 1) { const M = flashMemory(); if (M.cells.length > 1) { mem = new Map(); M.cells.forEach((c, i) => mem.set(c, i < 8 * M.bytes ? `bit ${7 - (i % 8)}${M.bytes > 1 ? ` · byte ${(i >> 3) + 1}` : ''}` : `cell ${i + 1}`)); } }
  ctx.save();
  for (const ch of W.chips) { // wires: an output driving another gate's input, coloured by the level it carries
    const src = ch.inFrom;
    if (!src || ch.broken || src.broken || !W.chips.includes(src)) continue;
    const a = chipPort(src, 'out'), b = chipPort(ch, 'in'), ax = w2sx(a[0]), ay = w2sy(a[1]), bx = w2sx(b[0]), by = w2sy(b[1]);
    ctx.strokeStyle = chipLevelCol(src.v.out); ctx.globalAlpha = 0.85; ctx.lineWidth = clamp(0.3 * R.s, 1.5, 4); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - 14 - 0.18 * Math.abs(bx - ax), bx, by); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const ch of W.chips) {
    const ends = CHIP_ENDS[ch.key] || [];
    if (ch.broken) {
      let x = 0, y = 0, n = 0; for (const p of ch.ps) if (!p.dead) { x += p.x; y += p.y; n++; }
      if (n) chipLabel(ctx, w2sx(x / n), w2sy(y / n), 'broken', '#ff8a7f');
      continue;
    }
    for (const d of ch.devs) {
      const ball = ballSprite(d.t === 'n' ? E_COL : POS_COL, er);
      for (const o of d.dots) { const [x, y] = chipPathAt(d.path, o.s); drawSprite(ball, w2sx(x), w2sy(y + 0.9 + o.j * 0.5), 1); }
    }
    if (ch.key === 'flashcell') { // the stored electrons, and those tunnelling through the oxide now
      const d = ch.devs[0], ball = ballSprite(E_COL, er * 0.85), n = Math.max(0, ch.nfg);
      for (let k = 0; k < n; k++) {
        const p = d.gate[k % d.gate.length], ring = Math.floor(k / d.gate.length), th = k * 2.39996 + rt * 0.7;
        drawSprite(ball, w2sx(p.x + (0.45 + 0.25 * ring) * Math.cos(th)), w2sy(p.y + (0.45 + 0.25 * ring) * Math.sin(th)), 0.95);
      }
      for (const h of ch.hops) {
        const j = (h.t * 7 + (h.up ? 0 : 3)) % d.gc, from = d.path[d.g0 + j], to = d.gate[j], f = h.up ? h.t / 30 : 1 - h.t / 30;
        if (from && to) drawSprite(ball, w2sx(from.x + (to.x - from.x) * f), w2sy(from.y + (to.y - from.y) * f), 1);
      }
    }
    // the nodes, each labelled once, where its device ends are
    const spots = new Map();
    ch.devs.forEach((d, i) => {
      const e = ends[i]; if (!e) return;
      const add = (name, p, dy) => { if (!p || /^\d/.test(name)) return; const s0 = spots.get(name) || { x: 0, y: 0, n: 0 }; s0.x += p.x; s0.y += p.y + dy; s0.n++; spots.set(name, s0); };
      add(e[0], d.path[0], 3.2); add(e[1], d.path[d.path.length - 1], 3.2);
      let top = -Infinity, gx = 0; for (const p of (d.cg || d.gate)) { top = Math.max(top, p.y); gx += p.x; }
      add('gate' + i + ':' + (e[2] === 'FG' ? 'CG' : e[2]), { x: gx / (d.cg || d.gate).length, y: top }, 2.6);
    });
    for (const [key, s0] of spots) {
      const name = key.replace(/^gate\d+:/, ''), v = chipNode(ch, name), txt = name === 'CG' ? `CG ${v.toFixed(1)} V` : ch.key === 'transistor' ? `${name} ${v.toFixed(2)} V` : `${name} ${v > 0.6 * CHIP.VDD ? 1 : v < 0.4 * CHIP.VDD ? 0 : '½'}`;
      chipLabel(ctx, w2sx(s0.x / s0.n), w2sy(s0.y / s0.n), txt, name === 'CG' ? '#e6e6e6' : chipLevelCol(v));
    }
    if (ch.key === 'flashcell') {
      const [, x1, y0, y1] = chipBox(ch.devs[0].gate); chipLabel(ctx, w2sx(x1 + 1.6), w2sy((y0 + y1) / 2), `floating gate: ${ch.nfg} e⁻`, '#9fd0ff', 'left');
      if (mem && mem.has(ch)) { const b = chipBox(ch.ps.filter(p => !p.dead)), v = flashStored(ch); chipLabel(ctx, w2sx((b[0] + b[1]) / 2), w2sy(b[2] - 2.4), `${mem.get(ch)} = ${v}`, v ? '#ffb347' : '#7fb6ff'); }
    }
    if (ch.key === 'transistor') { const d = ch.devs[0], p = d.path[Math.floor(d.path.length / 2)]; chipLabel(ctx, w2sx(p.x), w2sy(p.y - 4), fmtCurrent(d.I), '#9fd0ff'); }
  }
  ctx.restore();
}
/* Photons in flight (W.flights): a short streak behind a bright head, where light at c has got to by now. */
function drawFlights() {
  if (!W.flights.length) return;
  const ctx = R.ctx;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const f of W.flights) {
    const d = Math.min(f.len, (W.t - f.t0) * PHYS.C), L = f.len || 1, d0 = Math.max(0, d - 4);
    const hx = w2sx(f.x0 + (f.x1 - f.x0) * d / L), hy = w2sy(f.y0 + (f.y1 - f.y0) * d / L);
    const tx = w2sx(f.x0 + (f.x1 - f.x0) * d0 / L), ty = w2sy(f.y0 + (f.y1 - f.y0) * d0 / L);
    const g = ctx.createLinearGradient(tx, ty, hx, hy);
    g.addColorStop(0, rgba(f.c, 0)); g.addColorStop(1, rgba(f.c, 0.9));
    ctx.strokeStyle = g; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    drawSprite(glowSprite(f.c, 9), hx, hy, 1);
  }
  ctx.restore();
}
/* Each photon's label (photonLabel) by its head: the ones in flight first, then the newest rays; no more than two
   dozen, none on top of another. With the Labels view. */
const LAB_W = new Map(); // label text → its width on screen (measuring text every frame is slow)
function drawPhotonLabels(rt) {
  if (!R.view.labels || R.menu || (!W.flights.length && !W.rays.length)) return;
  const heads = [];
  for (const f of W.flights) { if (!f.lab) continue; const d = Math.min(f.len, (W.t - f.t0) * PHYS.C), L = f.len || 1; heads.push([w2sx(f.x0 + (f.x1 - f.x0) * d / L), w2sy(f.y0 + (f.y1 - f.y0) * d / L), f.lab, f.c, 1]); }
  for (let i = W.rays.length - 1; i >= 0; i--) { const r = W.rays[i]; if (r.lab && r.hx !== undefined && r.alpha > 0.02) heads.push([r.hx, r.hy, r.lab, r.c, Math.min(1, r.alpha * 1.1)]); }
  if (!heads.length) return;
  const ctx = R.ctx, boxes = []; let n = 0;
  ctx.save(); ctx.font = `600 10px ${CH_FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,10,16,0.85)';
  if (LAB_W.size > 600) LAB_W.clear();
  for (const [x, y, lab, c, a] of heads) {
    if (n >= 24) break;
    if (x < -20 || y < -20 || x > R.w + 20 || y > R.h + 20) continue;
    let w = LAB_W.get(lab); if (w === undefined) { w = ctx.measureText(lab).width + 5; LAB_W.set(lab, w); }
    const tx = x + 7, ty = y - 8;
    if (boxes.some(b => tx < b[0] + b[2] && tx + w > b[0] && Math.abs(ty - b[1]) < 13)) continue; // never on top of another label
    boxes.push([tx, ty, w]); n++;
    ctx.globalAlpha = a; ctx.strokeText(lab, tx, ty);
    ctx.fillStyle = rgba(c.map(v => Math.round(v + (255 - v) * 0.35)), 1); ctx.fillText(lab, tx, ty); // (lightened: deep red and violet light stay readable)
  }
  ctx.restore();
}
/* ---------- a decay seen up close: the parent nucleus, then what leaves it and what it becomes ----------
   α: a cluster of two protons and two neutrons flies off and the daughter recoils. β⁻: a neutron turns into a
   proton (the flash) as an electron and an antineutrino leave; β⁺ the reverse, with a positron and a neutrino.
   Electron capture: an inner electron falls in, a proton becomes a neutron, a neutrino and an X-ray leave.
   Proton or neutron emission: the nucleon simply drips off. Antinuclei decay as the mirror image. */
function drawDecayInset(ctx, e, cx, cy, Rr, age, c) {
  const n = e.nuc, A0 = n.Z0 + n.N0, t0 = 0.5, t1 = 2.9;
  const k = clamp((age - t0) / (t1 - t0), 0, 1), ease = 1 - (1 - k) * (1 - k), before = age < t0;
  const Z = before ? n.Z0 : n.Z1, N = before ? n.N0 : n.N1, A = Z + N;
  const b = clamp(0.44 * Rr / rnUnit(Math.max(A0, 1)), 0.8, 4), rn = b * rnUnit(Math.max(A0, 1)), eb = Math.max(b * 1.25, 2.3);
  const trail = (x, y, col) => { // from the nucleus to what left it
    const g = ctx.createLinearGradient(cx + ux * rn, cy + uy * rn, x, y);
    g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, 0.75));
    ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cx + ux * rn, cy + uy * rn); ctx.lineTo(x, y); ctx.stroke();
  };
  const ux = Math.cos(n.th || 0.6), uy = -Math.sin(n.th || 0.6);
  const anti = !!n.anti, pc = anti ? PBAR_COL : P_COL, ncol = anti ? NBAR_COL : N_COL;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, Rr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2,5,9,0.95)'; ctx.fill(); ctx.strokeStyle = rgba(c, 0.45); ctx.lineWidth = 1; ctx.stroke();
  ctx.clip();
  const heavy = n.mode === 'a' || n.mode === 'p' || n.mode === 'n' || n.mode === '2p' || n.mode === '2n';
  const rec = !before && heavy ? Math.min(Rr * 0.12, 30 * (n.mode === 'a' ? 4 : 1) / Math.max(A0, 1) * Rr * 0.12) * ease : 0;
  const nx = cx - ux * rec, ny = cy - uy * rec;
  if (before) { // the parent, about to go
    const pulse = 0.5 + 0.5 * Math.sin(age * 22);
    drawSprite(glowSprite(c, rn * 2.2), cx, cy, 0.25 + 0.25 * pulse);
  }
  if (A > 0) drawSprite(nucleusSprite(Z, N, b, anti), nx, ny);
  const lab = (t, x, y, col) => { ctx.font = '600 10px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y); };
  const ball = (x, y, col, r) => drawSprite(ballSprite(col, r), x, y);
  if (!before && k < 1) {
    const d = rn + k * (Rr + 8 - rn), ex = cx + ux * d, ey = cy + uy * d;
    if (n.mode === 'a' || n.mode === 'p' || n.mode === 'n' || n.mode === '2p' || n.mode === '2n') {
      const parts = n.mode === 'a' ? [[pc, -0.55, -0.55], [ncol, 0.55, -0.55], [ncol, -0.55, 0.55], [pc, 0.55, 0.55]]
        : n.mode === 'p' ? [[pc, 0, 0]] : n.mode === 'n' ? [[ncol, 0, 0]] : n.mode === '2p' ? [[pc, -0.6, 0], [pc, 0.6, 0]] : [[ncol, -0.6, 0], [ncol, 0.6, 0]];
      const sep = n.mode[0] === '2' ? 1 + 2 * ease : 1; // two nucleons drift apart as they go
      trail(ex, ey, [255, 210, 140]);
      drawSprite(glowSprite([255, 220, 150], eb * 4), ex, ey, 0.6);
      for (const [col, ox, oy] of parts) ball(ex + (ox * uy * sep + oy * ux) * eb * 1.15, ey + (-ox * ux * sep + oy * uy) * eb * 1.15, col, eb);
      lab(n.mode === 'a' ? (anti ? 'ᾱ' : 'α') : n.mode.replace('2', '2 ').replace('p', anti ? 'p̄' : 'p').replace('n', anti ? 'n̄' : 'n'), ex + uy * 10, ey - ux * 10, '#ffe2a8');
    } else if (n.mode === 'b-' || n.mode === 'b+') {
      const elec = (n.mode === 'b-') !== anti, lc = elec ? E_COL : POS_COL;
      if (k < 0.35) { // the nucleon that changes
        const fx = cx + rn * 0.35 * Math.cos(n.th * 3.1), fy = cy + rn * 0.35 * Math.sin(n.th * 3.1);
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k / 0.35).toFixed(3)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(fx, fy, b * (1.5 + 6 * k), 0, Math.PI * 2); ctx.stroke();
      }
      const de = rn + Math.min(1, k * 1.25) * (Rr + 8 - rn), lx = cx + ux * de, ly = cy + uy * de;
      trail(lx, ly, hexc(lc));
      drawSprite(glowSprite(hexc(lc), 9), lx, ly, 0.9); ball(lx, ly, lc, 2.2);
      lab(elec ? 'e⁻' : 'e⁺', lx + uy * 10, ly - ux * 10, elec ? '#9fd0ff' : '#ffb3e6');
      const vt = (n.th || 0) + 2.5, vx = Math.cos(vt), vy = -Math.sin(vt), dn = rn + Math.min(1, k * 1.6) * (Rr + 6 - rn); // the (anti)neutrino: a faint dashed trail
      ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(220,220,235,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx + vx * rn, cy + vy * rn); ctx.lineTo(cx + vx * dn, cy + vy * dn); ctx.stroke(); ctx.setLineDash([]);
      lab((n.mode === 'b-') !== anti ? 'ν̄' : 'ν', cx + vx * Math.min(dn, Rr - 9), cy + vy * Math.min(dn, Rr - 9) - 8, 'rgba(225,225,240,0.85)');
    } else if (n.mode === 'ec') {
      const orb = Rr * 0.78, lc = anti ? POS_COL : E_COL;
      ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(120,180,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, orb, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (k < 0.5) { // the inner electron spirals in
        const q = k / 0.5, a = (n.th || 0) + q * 5, r = orb * (1 - q) + rn * 0.4 * q;
        drawSprite(glowSprite(hexc(lc), 9), cx + r * Math.cos(a), cy + r * Math.sin(a), 0.9); ball(cx + r * Math.cos(a), cy + r * Math.sin(a), lc, 2.2);
      } else { // a neutrino and an X-ray leave
        const q = (k - 0.5) / 0.5, dn = rn + q * (Rr + 6 - rn);
        ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(220,220,235,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx + ux * rn, cy + uy * rn); ctx.lineTo(cx + ux * dn, cy + uy * dn); ctx.stroke(); ctx.setLineDash([]);
        lab(anti ? 'ν̄' : 'ν', cx + ux * Math.min(dn, Rr - 9) + uy * 9, cy + uy * Math.min(dn, Rr - 9) - ux * 9, 'rgba(225,225,240,0.85)');
        const wx = -ux, wy = -uy, px = -wy, py = wx; // the X-ray: a wave packet going the other way
        ctx.strokeStyle = 'rgba(200,170,255,0.9)'; ctx.lineWidth = 1.3; ctx.beginPath();
        for (let j = 0; j <= 16; j++) { const s = dn - 14 + j, w = Math.sin(j * 1.6) * 2.5; const x = cx + wx * s + px * w, y = cy + wy * s + py * w; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
/* ---------- nuclear events: shock rings, ghosts of what vanished, and a short caption ---------- */
const EV_STYLE = {
  alpha: [255, 205, 110], decay: [255, 205, 110], beta: [110, 190, 255], betap: [255, 125, 205], ec: [120, 220, 200],
  fission: [255, 150, 80], fusion: [255, 236, 170], capture: [170, 205, 255], reaction: [255, 190, 150],
  annih: [205, 150, 255], pair: [210, 190, 255], prod: [255, 175, 95], pdecay: [140, 240, 205], qgp: [255, 120, 70],
};
const EV_LIFE = 4.5;
function drawEvents(rt) {
  const evs = W.events;
  if (!evs.length) return;
  for (let i = evs.length - 1; i >= 0; i--) if (rt - evs[i].t0 > EV_LIFE || rt < evs[i].t0 - 0.5) evs.splice(i, 1);
  const ctx = R.ctx;
  ctx.save();
  for (const e of evs) {
    const age = Math.max(0, rt - e.t0), c = EV_STYLE[e.kind] || EV_STYLE.decay;
    const x = w2sx(e.x), y = w2sy(e.y);
    if (age < 1.3) { // two expanding rings mark where it happened
      for (const d of [0, 0.3]) {
        const k = clamp((age - d) / 1.0, 0, 1); if (k <= 0 || k >= 1) continue;
        ctx.strokeStyle = rgba(c, (1 - k) * 0.85); ctx.lineWidth = 2.2 * (1 - k) + 0.6;
        ctx.beginPath(); ctx.arc(x, y, 5 + k * Math.max(46, 7 * R.s), 0, Math.PI * 2); ctx.stroke();
      }
    }
    const kg = clamp(age / 2.2, 0, 1); // ghosts of the particles that vanished or changed identity
    if (kg < 1) for (const g of e.ghosts) {
      const gx = w2sx(g.x), gy = w2sy(g.y), r0 = Math.max(5, (g.k === NUC ? Math.max(g.rd, 0.25) : 0.15) * R.s), rr = r0 * (1 + 0.7 * kg);
      ctx.globalAlpha = (1 - kg) * 0.95;
      ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(c, 1); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gx, gy, rr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = rgba(c, 1); ctx.fillText(g.lbl, gx, gy - rr - 3);
      ctx.globalAlpha = 1;
    }
  }
  // captions for the newest few, kept clear of each other and of the chamber edges
  const placed = [], shown = evs.slice(-4);
  for (let i = shown.length - 1; i >= 0; i--) {
    const e = shown[i], age = Math.max(0, rt - e.t0), c = EV_STYLE[e.kind] || EV_STYLE.decay;
    const a = Math.min(1, age / 0.15) * clamp((EV_LIFE - age) / 1.2, 0, 1);
    if (a <= 0.01) continue;
    const x = w2sx(e.x), y = w2sy(e.y);
    ctx.font = '600 12.5px "Hanken Grotesk", system-ui, sans-serif';
    const w1 = ctx.measureText(e.text).width;
    ctx.font = '500 11px "Azeret Mono", ui-monospace, monospace';
    const w2 = e.sub ? ctx.measureText(e.sub).width : 0;
    const ins = e.nuc && R.view.decayCards && R.w > 360 ? 58 : 0; // a decay gets a close-up of its nucleus beside the words
    const bw = Math.min(R.w - 16, Math.max(w1, w2) + 22 + ins), bh = ins ? 58 : e.sub ? 40 : 26;
    let bx = x + 18, by = y - 30 - bh;
    if (bx + bw > R.w - 8) bx = x - 18 - bw;
    bx = clamp(bx, 8, R.w - bw - 8);
    if (by < 50) by = y + 30;
    for (let k = 0; k < 6; k++) {
      const hit = placed.find(q => bx < q[2] + 6 && bx + bw + 6 > q[0] && by < q[3] + 6 && by + bh + 6 > q[1]);
      if (!hit) break;
      by = hit[3] + 6;
    }
    by = clamp(by, 8, R.h - bh - 8);
    placed.push([bx, by, bx + bw, by + bh]);
    ctx.globalAlpha = a;
    const ax = clamp(x, bx, bx + bw), ay = y < by ? by : by + bh;
    ctx.strokeStyle = rgba(c, 0.7); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.fillStyle = 'rgba(7,11,17,0.88)'; ctx.strokeStyle = rgba(c, 0.55);
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 7); else ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(c, 1); ctx.fillRect(bx, by + 6, 3, bh - 12);
    if (ins) drawDecayInset(ctx, e, bx + 6 + ins / 2, by + bh / 2, ins / 2 - 3, age, c);
    const tx = bx + 10 + ins, ty = ins ? by + bh / 2 - 7 : by + (e.sub ? 14 : bh / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 12.5px "Hanken Grotesk", system-ui, sans-serif'; ctx.fillStyle = '#eef3f8';
    ctx.fillText(e.text, tx, ty, bw - 18 - ins);
    if (e.sub) { ctx.font = '500 11px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = rgba(c, 1); ctx.fillText(e.sub, tx, ty + 15, bw - 18 - ins); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
/* Accelerator parts: the beam pipe (the design orbit) and injection lines, bending magnets (bands, ⊙/⊗ for the
   field's direction), quadrupoles (the field rising across the beamline; F focuses across the ring, D along the
   height), RF cavities (their oscillating field as an arrow that swings with it), kicker magnets, separator plates
   and the detectors. */
function drawZones() {
  if (!W.zones.length) return;
  const ctx = R.ctx, s = R.s, C = W.collider, small = s >= 3;
  ctx.save();
  ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // the beam pipes and injection lines
  if (C && C.pipes && C.pipes.length) {
    ctx.strokeStyle = 'rgba(190,205,225,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const g of C.pipes) {
      if (g.arc) { const X = w2sx(g.cx), Y = w2sy(g.cy); ctx.moveTo(X + g.r * s * Math.cos(-g.a0), Y + g.r * s * Math.sin(-g.a0)); ctx.arc(X, Y, g.r * s, -g.a0, -g.a1, g.a1 > g.a0); }
      else { ctx.moveTo(w2sx(g.x0), w2sy(g.y0)); ctx.lineTo(w2sx(g.x1), w2sy(g.y1)); }
    }
    ctx.stroke();
  }
  if (C && C.injLines) {
    ctx.strokeStyle = 'rgba(190,205,225,0.3)'; ctx.setLineDash([3, 4]);
    for (const l of C.injLines) { ctx.beginPath(); ctx.moveTo(w2sx(l[0]), w2sy(l[1])); ctx.lineTo(w2sx(l[2]), w2sy(l[3])); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  // the middle of each ring (for its legend and to put labels outside it)
  const mids = {};
  for (const z of W.zones) if (z.kind === 'dipole' && z.ring && z.ahalf !== undefined) { const k = z.beam || '-', m = mids[k] || (mids[k] = { x: 0, y: 0, n: 0, B: 0 }); m.x += z.cx; m.y += z.cy; m.n++; m.B = z.B; }
  const ctr = (z) => { const m = mids[z.beam || '-'] || mids['-'] || Object.values(mids)[0]; return m ? [m.x / m.n, m.y / m.n] : [0, 0]; };
  const outLabel = (z, txt, col, r) => { // a label just outside the ring, clear of the part (radius r on screen)
    const [mx, my] = ctr(z), dx = z.cx - mx, dy = z.cy - my, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = -dy / L;
    const tw = ctx.measureText(txt).width, d = r + 4 + Math.abs(ux) * tw / 2 + Math.abs(uy) * 6, X0 = w2sx(z.cx), Y0 = w2sy(z.cy);
    let X = X0 + ux * d, Y = Y0 + uy * d;
    if (X - tw / 2 < 4 || X + tw / 2 > R.w - 52 || Y < 10 || Y > R.h - 10) { X = X0 - ux * d; Y = Y0 - uy * d; } // (no room outside on screen: inside instead, clear of the zoom buttons)
    ctx.fillStyle = col; ctx.fillText(txt, clamp(X, tw / 2 + 4, R.w - tw / 2 - 4), clamp(Y, 10, R.h - 10));
  };
  for (const z of W.zones) {
    if (z.kind === 'dipole' && z.ring) {
      const x = w2sx(z.cx), y = w2sy(z.cy), col = z.B >= 0 ? [255, 110, 100] : [100, 145, 255];
      let a0, a1; // (screen angles)
      if (z.ahalf !== undefined) { a0 = -(z.amid + z.ahalf); a1 = -(z.amid - z.ahalf); }
      else { a0 = z.half === 1 ? Math.PI : 0; a1 = z.half ? a0 + Math.PI : 2 * Math.PI; }
      ctx.fillStyle = rgba(col, 0.1); ctx.beginPath(); ctx.arc(x, y, z.r1 * s, a0, a1); ctx.arc(x, y, z.r0 * s, a1, a0, true); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(col, 0.42); ctx.lineWidth = 1; ctx.stroke();
      const rm = 0.5 * (z.r0 + z.r1) * s, n = Math.max(1, Math.round((a1 - a0) * rm / 46));
      ctx.strokeStyle = rgba(col, 0.55); ctx.fillStyle = rgba(col, 0.55);
      for (let k = 0; k < n; k++) {
        const a = a0 + (k + 0.5) * (a1 - a0) / n, px = x + rm * Math.cos(a), py = y + rm * Math.sin(a);
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.stroke();
        if (z.B >= 0) { ctx.beginPath(); ctx.arc(px, py, 1, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(px - 2.4, py - 2.4); ctx.lineTo(px + 2.4, py + 2.4); ctx.moveTo(px + 2.4, py - 2.4); ctx.lineTo(px - 2.4, py + 2.4); ctx.stroke(); }
      }
      if (z.ahalf === undefined) { ctx.fillStyle = rgba(col, 0.9); ctx.fillText(`bending magnets  ${z.B >= 0 ? '⊙' : '⊗'} ${fmtTesla(Math.abs(z.B))}`, x, y + z.r1 * s + 14); }
      continue;
    }
    const x = w2sx(z.cx), y = w2sy(z.cy), w = z.w * s, h = z.h * s;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-(z.ang || 0));
    if (z.kind === 'cavity') {
      const rf = z.Vamp !== undefined || z.rfS !== undefined, on = z.E !== 0;
      ctx.fillStyle = 'rgba(255,200,90,0.07)'; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = 'rgba(255,200,90,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(-w / 2, -h / 2, w, h);
      const cells = Math.max(2, Math.round(w / 26));
      for (let k = 1; k < cells; k++) { const cx = -w / 2 + k * w / cells; ctx.beginPath(); ctx.moveTo(cx, -h / 2); ctx.lineTo(cx, -h / 4); ctx.moveTo(cx, h / 4); ctx.lineTo(cx, h / 2); ctx.stroke(); }
      if (on) { // the push it gives a positive charge (an RF cavity's swings as its field oscillates)
        const L = Math.min(w * 0.4, 26), f = rf && z.Vamp > 0 ? clamp(z.E * z.w / z.Vamp, -1, 1) : Math.sign(z.E), d = Math.sign(f), Lf = L * Math.abs(f);
        if (Lf > 2) {
          ctx.strokeStyle = 'rgba(255,214,120,0.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-d * Lf, 0); ctx.lineTo(d * Lf, 0);
          const hd = Math.min(6, Lf); ctx.moveTo(d * Lf, 0); ctx.lineTo(d * (Lf - hd), -4); ctx.moveTo(d * Lf, 0); ctx.lineTo(d * (Lf - hd), 4); ctx.stroke();
        }
      }
      ctx.restore();
      if (rf) { if (small) outLabel(z, z.Vamp > 0 && on ? `RF  ${fmtVolt(z.Vamp)}` : 'RF (off)', 'rgba(255,214,140,0.85)', Math.max(w, h) / 2); }
      else { ctx.fillStyle = 'rgba(255,214,140,0.85)'; ctx.fillText(`${z.label || 'cavity'}  ${fmtVolt(Math.abs(z.E) * z.w)}`, x, y - h / 2 - 9); }
      continue;
    }
    if (z.kind === 'quad') {
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2), col = z.K < 0 ? [110, 160, 255] : [160, 120, 255];
      g.addColorStop(0, rgba(col, 0.24)); g.addColorStop(0.5, rgba(col, 0.02)); g.addColorStop(1, rgba(col, 0.24));
      ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = 1; ctx.strokeRect(-w / 2, -h / 2, w, h);
      if (z.K !== undefined && small && w >= 10) { ctx.fillStyle = rgba(col, 0.9); ctx.font = '600 9px "Azeret Mono", ui-monospace, monospace'; ctx.fillText(z.K < 0 ? 'D' : 'F', 0, -h / 2 + 8); ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace'; }
      ctx.restore();
      if (z.K === undefined) { ctx.fillStyle = 'rgba(190,170,255,0.9)'; ctx.fillText('focusing', x, y + h / 2 + 10); }
      continue;
    }
    if (z.kind === 'kicker') {
      const col = [90, 220, 190];
      ctx.fillStyle = rgba(col, 0.12); ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = 1; ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      if (small) outLabel(z, 'kicker', rgba(col, 0.9), Math.max(w, h) / 2);
      continue;
    }
    if (z.kind === 'sep') { // two plates along the beam; + and − once they are charged
      const col = [120, 210, 255], on = z.Es !== 0, pw = w * 0.9;
      ctx.strokeStyle = rgba(col, on ? 0.75 : 0.35); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-pw / 2, -h / 2); ctx.lineTo(pw / 2, -h / 2); ctx.moveTo(-pw / 2, h / 2); ctx.lineTo(pw / 2, h / 2); ctx.stroke();
      if (on && small) { // the field points from + to −: Es > 0 points to the left of the heading (the plate at −h/2 on screen)
        ctx.fillStyle = rgba(col, 0.9); ctx.font = '600 10px "Azeret Mono", ui-monospace, monospace';
        ctx.fillText(z.Es > 0 ? '−' : '+', 0, -h / 2 + 7); ctx.fillText(z.Es > 0 ? '+' : '−', 0, h / 2 - 7);
        ctx.font = '600 11px "Azeret Mono", ui-monospace, monospace';
      }
      ctx.restore();
      if (small) outLabel(z, 'separator', rgba(col, 0.8), Math.max(w, h) / 2);
      continue;
    }
    if (z.kind === 'dipole') {
      const col = z.B >= 0 ? [255, 110, 100] : [100, 145, 255];
      ctx.fillStyle = rgba(col, 0.1); ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = rgba(col, 0.45); ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      continue;
    }
    ctx.restore();
  }
  // each ring's bending field, written in its middle
  for (const m of Object.values(mids)) {
    const col = m.B >= 0 ? [255, 110, 100] : [100, 145, 255];
    ctx.fillStyle = rgba(col, 0.85);
    ctx.fillText(`bending magnets ${m.B >= 0 ? '⊙' : '⊗'} ${fmtTesla(Math.abs(m.B))}`, w2sx(m.x / m.n), w2sy(m.y / m.n) - 24); // (above the middle, clear of labels brought inside)
  }
  for (const d of (C && C.dets) || []) { // the detectors
    ctx.strokeStyle = 'rgba(235,242,250,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.fillStyle = 'rgba(235,242,250,0.7)';
    if (d.box) {
      const X0 = w2sx(d.box[0]), X1 = w2sx(d.box[1]), Y0 = w2sy(d.box[3]), Y1 = w2sy(d.box[2]);
      ctx.strokeRect(Math.min(X0, X1), Math.min(Y0, Y1), Math.abs(X1 - X0), Math.abs(Y1 - Y0)); ctx.setLineDash([]);
      ctx.fillText('detector', (X0 + X1) / 2, Math.min(Y0, Y1) - 9);
    } else {
      const x = w2sx(d.x), y = w2sy(d.y), r = Math.max(8, d.r * s);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const m = Object.values(mids)[0], up = !m || d.y >= m.y / m.n; // (labels outside the ring)
      ctx.fillText(C.kind === 'ring' ? 'detector' : 'collision point', x, up ? y - r - 9 : y + r + 9);
    }
  }
  ctx.restore();
}
function fmtVolt(V) { return fmtSI(V, 'V', 3); }
function drawSources() {
  const ctx = R.ctx;
  for (const L of W.lasers || []) { // a laser: its housing, and its beam faintly along the way it points
    const x = w2sx(L.x0), y = w2sy(L.y0), c = photonColor(L.E), t = rayExit(L.x0, L.y0, L.ux, L.uy);
    ctx.save();
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.22)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(w2sx(L.x0 + L.ux * t), w2sy(L.y0 + L.uy * t)); ctx.stroke();
    ctx.translate(x, y); ctx.rotate(-Math.atan2(L.uy, L.ux));
    ctx.fillStyle = 'rgba(70,80,95,0.9)'; ctx.fillRect(-16, -5, 16, 10);
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(-2, -3, 3, 6);
    ctx.restore();
  }
  for (const src of W.sources || []) {
    const x = w2sx(src.x), y = w2sy(src.y);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.atan2(src.uy, src.ux));
    ctx.fillStyle = 'rgba(200,215,235,0.75)'; ctx.fillRect(-14, -5, 14, 10);
    ctx.fillStyle = 'rgba(255,200,120,0.9)'; ctx.fillRect(-2, -3, 4, 6);
    ctx.restore();
  }
}
function drawOverlay() {
  const ctx = R.ctx;
  const g = W.grab;
  if (g && g.p && !g.p.dead) {
    const x0 = w2sx(g.p.x), y0 = w2sy(g.p.y), x1 = w2sx(g.x), y1 = w2sy(g.y);
    const rr = Math.max(7, (g.p.k === NUC ? g.p.rd : 0.15) * R.s + 5);
    ctx.save(); ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x0, y0, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,209,102,0.9)'; ctx.beginPath(); ctx.arc(x1, y1, 3.5, 0, Math.PI * 2); ctx.fill();
    if (g.mol) for (const a of g.mol) { if (a === g.p || a.dead) continue; ctx.beginPath(); ctx.arc(w2sx(a.x), w2sy(a.y), Math.max(5, a.rd * R.s + 3), 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  if (R.ghost) { // a paste picked up: the copy, faint, where the pointer is
    const g = R.ghost, s = R.s, x0 = w2sx(g.x), y0 = w2sy(g.y);
    ctx.save(); ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,209,102,0.9)';
    if (g.clip.bonds.length && s > 2) { ctx.beginPath(); for (const [i, j] of g.clip.bonds) { const a = g.clip.parts[i], b = g.clip.parts[j]; ctx.moveTo(x0 + a.dx * s, y0 - a.dy * s); ctx.lineTo(x0 + b.dx * s, y0 - b.dy * s); } ctx.stroke(); }
    const many = g.clip.parts.length > 3000;
    ctx.beginPath();
    for (const q of g.clip.parts) { const x = x0 + q.dx * s, y = y0 - q.dy * s; if (x < -20 || y < -20 || x > R.w + 20 || y > R.h + 20) continue; const r = Math.max(many ? 1.5 : 3, q.rd * s); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
    ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fill(); if (!many) ctx.stroke();
    ctx.restore();
  }
  const o = R.overlay;
  if (!o) return;
  ctx.save();
  if (o.brush) {
    ctx.strokeStyle = o.color || 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(w2sx(o.x), w2sy(o.y), Math.max(3, o.brush * R.s), 0, Math.PI * 2); ctx.stroke();
  }
  if (o.aim) {
    const x0 = w2sx(o.aim.x0), y0 = w2sy(o.aim.y0), x1 = w2sx(o.aim.x1), y1 = w2sy(o.aim.y1);
    ctx.setLineDash([]); ctx.strokeStyle = o.aim.color || 'rgba(255,209,102,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 11 * Math.cos(a - 0.4), y1 - 11 * Math.sin(a - 0.4));
    ctx.moveTo(x1, y1); ctx.lineTo(x1 - 11 * Math.cos(a + 0.4), y1 - 11 * Math.sin(a + 0.4)); ctx.stroke();
    if (o.aim.text) {
      ctx.font = '600 12px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left';
      ctx.fillText(o.aim.text, x0 + 10, y0 - 10);
    }
  }
  if (o.box) {
    const x0 = w2sx(o.box[0]), y0 = w2sy(o.box[1]), x1 = w2sx(o.box[2]), y1 = w2sy(o.box[3]);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,209,102,0.08)';
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  if (o.ghostMagnet) {
    const col = o.ghostMagnet.B >= 0 ? 'rgba(255,96,86,0.6)' : 'rgba(86,140,255,0.6)';
    ctx.strokeStyle = col; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(w2sx(o.x), w2sy(o.y), o.ghostMagnet.R * R.s, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
function drawScaleBar() {
  const ctx = R.ctx;
  const targetPx = 110;
  const raw = targetPx / R.s;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let len = pow; for (const m of [1, 2, 5, 10]) if (m * pow <= raw) len = m * pow;
  const px = len * R.s;
  const x = 16, y = R.h - 18;
  ctx.save();
  ctx.strokeStyle = CHAMBER.text; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
  ctx.font = '500 11px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = CHAMBER.text; ctx.textAlign = 'left';
  const lbl = len >= 10 ? fmtNum(len / 10, 3) + ' nm' : len >= 1 ? len + ' Å' : +(len * 100).toPrecision(3) + ' pm';
  ctx.fillText(lbl, x + px + 8, y + 4);
  ctx.restore();
}

/* Particle under a screen point (within a few pixels). */
/* Where a photon or neutrino in flight (W.flights, W.rays) or an unstable particle (W.exo) is now, in world units. */
function lightHead(o, kind) {
  if (kind === 'exo') return o.dead ? null : [o.x, o.y];
  if (kind === 'flight') { const d = Math.min(o.len, (W.t - o.t0) * PHYS.C), L = o.len || 1; return [o.x0 + (o.x1 - o.x0) * d / L, o.y0 + (o.y1 - o.y0) * d / L]; }
  const m = rayFrac(o); return [o.x0 + (o.x1 - o.x0) * m, o.y0 + (o.y1 - o.y0) * m];
}
/* The nearest photon, neutrino or unstable particle to a point on the screen, within extra pixels (for the Inspect tool). */
function pickLight(px, py, extra = 10) {
  const [wx, wy] = s2w(px, py); let best = null, bd = extra * extra;
  const consider = (o, kind) => { const h = lightHead(o, kind); if (!h) return; const dx = (h[0] - wx) * R.s, dy = (h[1] - wy) * R.s, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = { kind, o }; } };
  for (const o of W.exo) if (!o.dead) consider(o, 'exo');
  for (const f of W.flights) consider(f, 'flight');
  for (const r of W.rays) if (!r.landed) consider(r, 'ray');
  return best;
}
function pickAt(px, py, extra = 6) {
  const [wx, wy] = s2w(px, py);
  let best = null, bd = Infinity;
  for (const p of W.parts) {
    if (p.dead) continue;
    const rr = (p.k === NUC ? Math.max(p.rd, 0.2) : 0.15) * R.s + extra;
    const dx = (p.x - wx) * R.s, dy = (p.y - wy) * R.s, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 < bd) { bd = d2; best = p; }
  }
  return best;
}
