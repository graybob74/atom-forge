'use strict';
/* ------------------------------------------------------------------ placed objects (0.66)
   Things put in the chamber with the Objects tool, each a straight piece from (x0, y0) to (x1, y1) (W.objs):
     mirror    reflects light (R = 1); a splitter is a half-silvered one (R = 0.5: each photon goes one way or the other)
     lens      a thin lens of focal length f (Å; negative: diverging), bending each ray by h/f where it crosses
     prism     an equilateral glass prism standing on the piece, F2 flint glass (n = 1.5895 + 9400/λ², λ in nm). Light
               must meet it at a slant to come out (straight on, it is totally reflected inside, as in a real prism):
               one placed with a click is turned 24° for a beam from the left (the angle of least deviation)
     screen    a detector: stops light and fast particles and counts them, with their energy spectrum
     stop      a beam stop: stops light and fast particles
     wall      a solid wall: everything bounces off it (light is absorbed)
     foil      a thin metal foil (Z, layers): fast charged particles cross it, deflected by its nuclei (Rutherford)
     plates    two charged plates, the piece and its copy `gap` Å to its left, V volts between them: a uniform field
               inside, like the Lab's electric field but only there (its energy comes from the supply, as the Lab's does)
   Atoms meet every piece as a soft wall on their edge, as the chamber's walls (the energy is in the books: objPE);
   free electrons in the ordinary steps bounce off; fast and radiation-mode particles (and pions, muons …) cross a foil,
   bounce off a wall, and are stopped by the rest (a positron or antinucleus annihilates there). Light: X-rays and
   γ rays (124 eV and up) go straight through mirrors, lenses and prisms; glass absorbs ultraviolet below 300 nm.
   Neutrinos go through everything. Thermal light from glowing walls meets them too (0.67). */
const OBJ_KINDS = ['mirror', 'splitter', 'lens', 'prism', 'screen', 'stop', 'wall', 'foil', 'plates'];
const OBJ_NAME = { mirror: 'Mirror', splitter: 'Beam splitter', lens: 'Lens', prism: 'Prism', screen: 'Detector screen', stop: 'Beam stop', wall: 'Wall', foil: 'Foil', plates: 'Charged plates' };
const OBJ_HALF = 0.15; // Å: half the thickness of a piece, as atoms meet it
const OBJ_BINS = 24, OBJ_LO = -2; // the screen's spectrum: 24 bins of half a decade from 0.01 eV (to 10 GeV)
const PRISM_N = (nm) => 1.5895 + 9400 / (nm * nm); // (F2 flint glass: 1.648 at 400 nm, 1.609 at 700 nm)
function objMake(kind, x0, y0, x1, y1, o = {}) {
  const ob = { id: ++W.objSeq, kind, x0, y0, x1, y1 };
  if (kind === 'mirror') ob.R = 1;
  if (kind === 'splitter') ob.R = 0.5;
  if (kind === 'lens') ob.f = Number.isFinite(o.f) ? o.f : 20;
  if (kind === 'foil') { ob.Z = Number.isInteger(o.Z) ? o.Z : 79; ob.layers = Number.isFinite(o.layers) ? o.layers : 10; }
  if (kind === 'plates') { ob.V = Number.isFinite(o.V) ? o.V : 100; ob.gap = Number.isFinite(o.gap) ? o.gap : 10; }
  if (kind === 'screen') objClearHits(ob);
  return ob;
}
function objAdd(kind, x0, y0, x1, y1, o) { const ob = objMake(kind, x0, y0, x1, y1, o); W.objs.push(ob); W.dirty++; return ob; }
function objRemove(ob) { const i = W.objs.indexOf(ob); if (i >= 0) { W.objs.splice(i, 1); W.dirty++; } }
function objClearHits(ob) { ob.hits = { n: 0, light: 0, parts: 0, E: 0, bins: new Array(OBJ_BINS).fill(0) }; }
function objLen(ob) { return Math.hypot(ob.x1 - ob.x0, ob.y1 - ob.y0); }
/* Its left normal (unit): the side a prism stands on and the plates' second plate lies. */
function objNormal(ob) { const L = objLen(ob) || 1; return [-(ob.y1 - ob.y0) / L, (ob.x1 - ob.x0) / L]; }
function prismApex(ob) { const [nx, ny] = objNormal(ob), L = objLen(ob), mx = (ob.x0 + ob.x1) / 2, my = (ob.y0 + ob.y1) / 2; return [mx + nx * L * 0.8660254, my + ny * L * 0.8660254]; }
/* Its solid edges [ax, ay, bx, by]: one, a prism's three, the plates' two. */
function objEdges(ob) {
  if (ob.kind === 'prism') { const [ax, ay] = prismApex(ob); return [[ob.x0, ob.y0, ob.x1, ob.y1], [ob.x1, ob.y1, ax, ay], [ax, ay, ob.x0, ob.y0]]; }
  if (ob.kind === 'plates') { const [nx, ny] = objNormal(ob), g = ob.gap; return [[ob.x0, ob.y0, ob.x1, ob.y1], [ob.x0 + nx * g, ob.y0 + ny * g, ob.x1 + nx * g, ob.y1 + ny * g]]; }
  return [[ob.x0, ob.y0, ob.x1, ob.y1]];
}
/* Where a ray from (x, y) along (ux, uy) meets segment a–b: its distance t along the ray (> eps), or Infinity. */
function raySeg(x, y, ux, uy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, den = ux * ey - uy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const wx = ax - x, wy = ay - y, t = (wx * ey - wy * ex) / den, s = (wx * uy - wy * ux) / den;
  return t > 1e-7 && s >= 0 && s <= 1 ? t : Infinity;
}
/* Does the move from (x0, y0) to (x1, y1) cross segment a–b? The fraction of the move where it does, or -1. */
function moveSeg(x0, y0, x1, y1, ax, ay, bx, by) {
  const dx = x1 - x0, dy = y1 - y0, ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-14) return -1;
  const wx = ax - x0, wy = ay - y0, t = (wx * ey - wy * ex) / den, s = (wx * dy - wy * dx) / den;
  return t >= 0 && t <= 1 && s >= 0 && s <= 1 ? t : -1;
}
function pointInPrism(ob, x, y) {
  const E = objEdges(ob); let sg = 0;
  for (const [ax, ay, bx, by] of E) { const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); const s = c > 0 ? 1 : -1; if (sg && s !== sg) return false; sg = s; }
  return true;
}

/* ---- light */
function objLightOK(ob, E) { // does this piece do anything to light of this energy?
  if (ob.kind === 'plates') return false;
  if (E >= 124 && (ob.kind === 'mirror' || ob.kind === 'splitter' || ob.kind === 'lens' || ob.kind === 'prism')) return false; // (X-rays and γ: straight through)
  return true;
}
/* The nearest piece a ray meets before tmax: { t, ob, e } or null. */
function opticFind(x, y, ux, uy, tmax, E) {
  let best = null;
  for (const ob of W.objs) {
    if (!objLightOK(ob, E)) continue;
    const ed = objEdges(ob);
    for (let e = 0; e < ed.length; e++) { const t = raySeg(x, y, ux, uy, ...ed[e]); if (t < tmax && (!best || t < best.t)) best = { t, ob, e }; }
  }
  return best;
}
/* A ray that met a piece: where it goes on (a new emitPhoton from there, cont: not a new photon), or where it ends. */
function opticHit(h, x0, y0, ux, uy, E, opts) {
  const x = x0 + ux * h.t, y = y0 + uy * h.t, ob = h.ob, o2 = Object.assign({}, opts || {}, { cont: true, bounce: ((opts && opts.bounce) || 0) + 1, delay: ((opts && opts.delay) || 0) + (opts && opts.travel ? 0 : h.t / PHYS.C) }); // (delay: the next leg is drawn once light has come this far; light in flight is here already when this runs, as it lands, 0.91)
  const go = (vx, vy, sx, sy) => { const L = Math.hypot(vx, vy); photonOn(sx + vx / L * 1e-6, sy + vy / L * 1e-6, E, vx / L, vy / L, o2); };
  const absorb = () => { if (!o2.glow) W.ledger.escaped += E; if (ob.kind === 'screen') objRecord(ob, E, true); }; // (a glowing wall's light absorbed is the walls' own)
  return { x, y, obj: ob, after: () => {
    if (o2.bounce > 40) { absorb(); return; }
    const [ax, ay, bx, by] = objEdges(ob)[h.e], L = Math.hypot(bx - ax, by - ay) || 1, tx = (bx - ax) / L, ty = (by - ay) / L, nx = -ty, ny = tx;
    const k = ob.kind;
    if (k === 'mirror' || k === 'splitter') {
      if (rnd() < ob.R) { const d = ux * nx + uy * ny; go(ux - 2 * d * nx, uy - 2 * d * ny, x, y); } else go(ux, uy, x, y);
      return;
    }
    const nm = PHYS.HC / E;
    if ((k === 'lens' || k === 'prism') && nm < 300) { absorb(); return; } // (glass takes the ultraviolet)
    if (k === 'lens') {
      const cx = (ob.x0 + ob.x1) / 2, cy = (ob.y0 + ob.y1) / 2, hh = (x - cx) * tx + (y - cy) * ty;
      let un = ux * nx + uy * ny, sx = nx, sy = ny; if (un < 0) { un = -un; sx = -nx; sy = -ny; }
      const s1 = (ux * tx + uy * ty) / un - hh / (Math.abs(ob.f) < 1 ? Math.sign(ob.f || 1) : ob.f); // (paraxial: the slope after = the slope before − h/f)
      go(sx + s1 * tx, sy + s1 * ty, x, y);
      return;
    }
    if (k === 'prism') { prismTrace(ob, x, y, ux, uy, h.e, E, o2); return; }
    absorb(); // (screen, stop, wall, foil)
  } };
}
/* The same photon going on: thermal light from the walls as glowPhoton (its own books), any other as emitPhoton. */
function photonOn(x, y, E, ux, uy, opts) { if (opts.glow) glowPhoton(x, y, E, ux, uy, opts.bounce); else emitPhoton(x, y, E, ux, uy, opts); }
/* Through the prism: refracted in at edge e, then to the far side, out (or totally reflected inside and on). The path
   inside is drawn as rays; the light leaves from where it comes out. */
function prismTrace(ob, x, y, ux, uy, e, E, opts) {
  const n = PRISM_N(PHYS.HC / E), ed = objEdges(ob);
  const refr = (vx, vy, nx, ny, n1, n2) => { // Snell, n pointing against the ray: the new direction, or null (total reflection)
    let c = -(vx * nx + vy * ny); if (c < 0) { nx = -nx; ny = -ny; c = -c; }
    const r = n1 / n2, k = 1 - r * r * (1 - c * c);
    if (k < 0) return null;
    const f = r * c - Math.sqrt(k);
    return [r * vx + f * nx, r * vy + f * ny];
  };
  const nrm = (i) => { const [ax, ay, bx, by] = ed[i], L = Math.hypot(bx - ax, by - ay) || 1; return [-(by - ay) / L, (bx - ax) / L]; };
  let [nx, ny] = nrm(e), d = refr(ux, uy, nx, ny, 1, n);
  if (!d) { const c = ux * nx + uy * ny; photonOn(x, y, E, ux - 2 * c * nx, uy - 2 * c * ny, opts); return; }
  let px = x, py = y, vx = d[0], vy = d[1], from = e;
  for (let k = 0; k < 12; k++) {
    let bt = Infinity, bi = -1;
    for (let i = 0; i < 3; i++) { if (i === from) continue; const t = raySeg(px, py, vx, vy, ...ed[i]); if (t < bt) { bt = t; bi = i; } }
    if (bi < 0) break;
    const qx = px + vx * bt, qy = py + vy * bt;
    W.rays.push({ x0: px, y0: py, x1: qx, y1: qy, E, c: photonColor(E), t0: W.rt, ts: W.t + (opts.delay || 0), len: bt, nu: false });
    opts.delay = (opts.delay || 0) + bt / PHYS.C;
    [nx, ny] = nrm(bi);
    const out = refr(vx, vy, nx, ny, n, 1);
    if (out) { const L = Math.hypot(out[0], out[1]); photonOn(qx + out[0] / L * 1e-6, qy + out[1] / L * 1e-6, E, out[0] / L, out[1] / L, opts); return; }
    const c = vx * nx + vy * ny; vx -= 2 * c * nx; vy -= 2 * c * ny; px = qx; py = qy; from = bi; // (totally reflected inside)
  }
  if (!opts.glow) W.ledger.escaped += E; // (trapped: lost in the glass)
}

/* ---- the detector screen's record */
function objRecord(ob, E, light) {
  const H = ob.hits || (objClearHits(ob), ob.hits);
  H.n++; if (light) H.light++; else H.parts++; H.E += E;
  const b = Math.floor((Math.log10(Math.max(1e-3, E)) - OBJ_LO) * 2);
  H.bins[clamp(b, 0, OBJ_BINS - 1)]++;
}

/* ---- atoms: a soft wall on their edge, both sides of every edge (rounded at the ends) */
function objForces(mdI, nmd) {
  const K = S.k, X = S.x, Y = S.y, FX = S.fx, FY = S.fy, FAST = S.fast, RAD = S.rad, DEAD = S.dead, OBJ = S.obj, M = S.m;
  for (const ob of W.objs) for (const [ax, ay, bx, by] of objEdges(ob)) {
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1e-12, pad = 3;
    const xl = Math.min(ax, bx) - pad, xh = Math.max(ax, bx) + pad, yl = Math.min(ay, by) - pad, yh = Math.max(ay, by) + pad;
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q], x = X[i], y = Y[i];
      if (x < xl || x > xh || y < yl || y > yh || K[i] !== NUC || DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
      const t = clamp(((x - ax) * ex + (y - ay) * ey) / L2, 0, 1), dx = x - (ax + t * ex), dy = y - (ay + t * ey), d = Math.hypot(dx, dy);
      const r = wallIn(OBJ[i]) + OBJ_HALF;
      if (d >= r) continue;
      const k = 30 * Math.min(1, M[i]), f = k * (r - d);
      const [ux, uy] = d > 1e-9 ? [dx / d, dy / d] : [-ey / Math.sqrt(L2), ex / Math.sqrt(L2)];
      FX[i] += f * ux; FY[i] += f * uy;
    }
  }
}
function objPE(p) {
  if (!W.objs.length || p.k !== NUC || p.fast || p.rad) return 0;
  let V = 0;
  const r = wallIn(p) + OBJ_HALF, k = 30 * Math.min(1, p.m);
  for (const ob of W.objs) for (const [ax, ay, bx, by] of objEdges(ob)) {
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1e-12;
    const t = clamp(((p.x - ax) * ex + (p.y - ay) * ey) / L2, 0, 1), d = Math.hypot(p.x - (ax + t * ex), p.y - (ay + t * ey));
    if (d < r) V += 0.5 * k * (r - d) * (r - d);
  }
  return V;
}
/* The first edge the move (x0, y0) → (x1, y1) crosses: { f (fraction of the move), ob, e } or null. */
function objCross(x0, y0, x1, y1) {
  let best = null;
  for (const ob of W.objs) { const ed = objEdges(ob); for (let e = 0; e < ed.length; e++) { const f = moveSeg(x0, y0, x1, y1, ...ed[e]); if (f >= 0 && (!best || f < best.f)) best = { f, ob, e }; } }
  return best;
}
/* Mirror the end of a move across edge e: the position and the velocity's normal part. */
function objBounce(p, h, x0, y0) {
  const [ax, ay, bx, by] = objEdges(h.ob)[h.e], L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
  const d1 = (p.x - ax) * nx + (p.y - ay) * ny, d0 = (x0 - ax) * nx + (y0 - ay) * ny;
  const side = d0 >= 0 ? 1 : -1, back = d1 * side < 0 ? d1 : 0; // (how far past the line it got)
  p.x -= 2 * back * nx + side * nx * 1e-6; p.y -= 2 * back * ny + side * ny * 1e-6;
  if (p.rad) { const c = p.ux * nx + p.uy * ny; p.ux -= 2 * c * nx; p.uy -= 2 * c * ny; p.vx = p.sp * p.ux; p.vy = p.sp * p.uy; }
  else { const c = p.vx * nx + p.vy * ny; p.vx -= 2 * c * nx; p.vy -= 2 * c * ny; }
}
/* A free electron (or positron) in the ordinary steps: bounces off every piece. */
function objLepton(p, x0, y0) {
  const h = objCross(x0, y0, p.x, p.y);
  if (h) objBounce(p, h, x0, y0);
}
/* A fast or radiation-mode particle that moved from (x0, y0) to where it is: crosses, bounces, or is stopped.
   Returns true when it is gone. */
function objPath(p, x0, y0) {
  const h = objCross(x0, y0, p.x, p.y); if (!h) return false;
  const ob = h.ob, k = ob.kind, cx = x0 + (p.x - x0) * h.f, cy = y0 + (p.y - y0) * h.f, neutron = p.k === NUC && p.Z === 0;
  if (k === 'wall') { objBounce(p, h, x0, y0); return false; }
  if (neutron && k !== 'stop' && k !== 'screen') return false; // (neutrons go through glass, metal foil and plates)
  if (k === 'foil') return foilCross(p, ob, cx, cy, x0, y0);
  return objStop(p, ob, cx, cy);
}
/* Stopped in a piece: its kinetic energy goes into it (out of the books, as at an absorbing wall); antimatter
   annihilates there. A screen counts it first. */
function objStop(p, ob, cx, cy) {
  const KE = p.rad ? p.KE : keOf(p);
  if (ob.kind === 'screen') objRecord(ob, KE, false);
  p.x = cx; p.y = cy;
  if (p.trk) extendTrack(p);
  if (p.k === POS || p.anti) { annihilateAtWall(p); return true; }
  W.ledger.escaped += KE; W.count.wallStop++;
  kill(p); return true;
}
/* Through a foil of `layers` atomic layers of element Z, 2.9 Å apart: at each layer the particle passes some nucleus
   at an impact parameter b anywhere up to half the spacing, and is turned by 2·atan(d/2b), d = k·z·Z/E (Rutherford,
   on a nucleus far heavier than it: its energy is kept). A particle so slow that every nucleus turns it hard
   (d > half the spacing) is stopped in the foil. */
function foilCross(p, ob, cx, cy, x0, y0) {
  const z = p.k === NUC ? (p.rad ? Math.max(p.Z - p.ne, 0) || p.Z : p.Z - p.ne) : 1;
  if (!z) return p.k === NUC && p.Z === 0 ? false : objStop(p, ob, cx, cy); // (a neutral atom flying into metal stops in it)
  const KE = p.rad ? p.KE : keOf(p), a = 2.9, d = PHYS.KE * Math.abs(z) * ob.Z / Math.max(KE, 1e-6);
  if (d > a / 2) return objStop(p, ob, cx, cy);
  let th = 0;
  for (let i = 0; i < ob.layers; i++) { const b = Math.max(1e-6, rnd() * a / 2); th += 2 * Math.atan(d / (2 * b)) * (rnd() < 0.5 ? 1 : -1); }
  if (Math.abs(th) < 1e-9) return false;
  const c = Math.cos(th), s = Math.sin(th), rest = Math.hypot(p.x - cx, p.y - cy);
  if (p.rad) { const ux = p.ux * c - p.uy * s, uy = p.ux * s + p.uy * c; p.ux = ux; p.uy = uy; p.vx = p.sp * ux; p.vy = p.sp * uy; p.x = cx + ux * rest; p.y = cy + uy * rest; }
  else { const vx = p.vx * c - p.vy * s, vy = p.vx * s + p.vy * c, v = Math.hypot(vx, vy) || 1; p.vx = vx; p.vy = vy; p.x = cx + vx / v * rest; p.y = cy + vy / v * rest; }
  if (p.trk) { const pts = p.trk.pts; pts.push(cx, cy); if (p.trk.ts) p.trk.ts.push(W.rt); if (p.trk.tt) p.trk.tt.push(W.t); }
  return false;
}
/* A pion, muon, kaon … in flight (hep.js): a wall turns it back, a foil lets it through, anything else stops it. */
function objExo(o, x0, y0) {
  const h = objCross(x0, y0, o.x, o.y); if (!h) return false;
  const k = h.ob.kind;
  if (k === 'foil') return false;
  if (k === 'wall') { const [ax, ay, bx, by] = objEdges(h.ob)[h.e], L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L; const c = o.ux * nx + o.uy * ny; o.ux -= 2 * c * nx; o.uy -= 2 * c * ny; o.x = x0 + (o.x - x0) * h.f; o.y = y0 + (o.y - y0) * h.f; return false; }
  o.x = x0 + (o.x - x0) * h.f; o.y = y0 + (o.y - y0) * h.f;
  if (k === 'screen') objRecord(h.ob, o.KE || 0, false);
  exoLeaves(o); return true;
}

/* ---- the plates' field */
function platesField(x, y, E) {
  for (const ob of W.objs) {
    if (ob.kind !== 'plates' || !(ob.gap > 0)) continue;
    const [nx, ny] = objNormal(ob), L = objLen(ob), tx = (ob.x1 - ob.x0) / (L || 1), ty = (ob.y1 - ob.y0) / (L || 1);
    const s = (x - ob.x0) * tx + (y - ob.y0) * ty, u = (x - ob.x0) * nx + (y - ob.y0) * ny;
    if (s < 0 || s > L || u <= 0 || u >= ob.gap) continue;
    const Ef = ob.V / ob.gap; // V/Å, from the first plate (at V) to the second (at 0)
    E[0] += Ef * nx; E[1] += Ef * ny;
  }
}
function hasPlates() { for (const ob of W.objs) if (ob.kind === 'plates' && ob.V) return true; return false; }

/* ---- saving */
function objToJSON(ob) {
  const o = { k: ob.kind, x0: ob.x0, y0: ob.y0, x1: ob.x1, y1: ob.y1 };
  for (const q of ['f', 'Z', 'layers', 'V', 'gap']) if (ob[q] !== undefined) o[q] = ob[q];
  return o;
}
function objFromJSON(o) {
  if (!o || !OBJ_KINDS.includes(o.k) || ![o.x0, o.y0, o.x1, o.y1].every(Number.isFinite)) return null;
  const n = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);
  return objMake(o.k, o.x0, o.y0, o.x1, o.y1, { f: n(o.f, -1e4, 1e4, 20), Z: Number.isInteger(o.Z) && o.Z >= 1 && o.Z <= 100 ? o.Z : 79, layers: n(o.layers, 1, 1000, 10), V: n(o.V, -1e6, 1e6, 100), gap: n(o.gap, 1, 1000, 10) });
}

/* Its short description: a label, the quick menu's title. */
function objText(ob) {
  const k = ob.kind;
  if (k === 'lens') return `${ob.f >= 0 ? 'Converging' : 'Diverging'} lens, f = ${+Math.abs(ob.f).toFixed(1)} Å`;
  if (k === 'foil') return `${ELEMENTS[ob.Z].name} foil, ${ob.layers} atomic layer${ob.layers > 1 ? 's' : ''}`;
  if (k === 'plates') return `Charged plates, ${Math.abs(ob.V).toLocaleString('en-US')} V across ${+ob.gap.toFixed(1)} Å`;
  if (k === 'screen') { const H = ob.hits; return `Detector screen: ${H ? H.n.toLocaleString('en-US') : 0} hits (${H ? H.light : 0} light, ${H ? H.parts : 0} particles)`; }
  return OBJ_NAME[k];
}

/* ---- for the Objects tool (ui.js) */
const OBJ_HELP = {
  mirror: 'Reflects light (not X-rays or γ rays). Atoms bounce off it; fast particles stop in it.',
  splitter: 'A half-silvered mirror: each photon is reflected or goes through, at random, half and half.',
  lens: 'A thin glass lens: light through it is bent toward (positive focal length) or away from its focus. Glass takes the ultraviolet below 300 nm.',
  prism: 'Flint glass: it bends violet more than red, so white light fans out into colours. Light must meet it at a slant (a click places one turned for light from the left).',
  screen: 'A detector: it stops light and fast particles and counts them, with their energy spectrum drawn along it.',
  stop: 'A beam stop: it stops light and fast particles (antimatter annihilates in it). Atoms bounce off.',
  wall: 'A solid wall: atoms, electrons and fast particles bounce off it; light is absorbed.',
  foil: 'A thin metal foil: fast charged particles go through, most nearly straight, a few turned sharply by a nucleus (Rutherford). Slow ones stop in it.',
  plates: 'Two charged plates: a uniform electric field between them steers charged particles (energy from the supply, as with the Lab field). The second plate is drawn to the left of your drag.',
};
function objV() { return Math.pow(10, (OPT.objects.Vs || 0) / 100); }
function objVText(V) { const a = Math.abs(V); return a >= 1000 ? `${+(a / 1000).toPrecision(3)} kV` : `${+a.toPrecision(3)} V`; }
function objFText(f) { return f === 0 ? '—' : `${f > 0 ? '+' : '−'}${Math.abs(f)} Å (${f > 0 ? 'converging' : 'diverging'})`; }
function objDist(ob, x, y) { // from (x, y) to the nearest of its edges, Å
  let best = Infinity;
  for (const [ax, ay, bx, by] of objEdges(ob)) {
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1e-12, t = clamp(((x - ax) * ex + (y - ay) * ey) / L2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - t * ex, y - ay - t * ey));
  }
  if (ob.kind === 'prism' && pointInPrism(ob, x, y)) best = 0;
  return best;
}
function objAtPx(px, py) { // the object under a screen point (within 8 px), the last placed first
  const [x, y] = s2w(px, py);
  for (let i = W.objs.length - 1; i >= 0; i--) if (objDist(W.objs[i], x, y) * R.s < 8) return W.objs[i];
  return null;
}
