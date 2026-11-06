'use strict';
/* The checks for the 1.26 bug fixes "collisions at extreme energy, muonic atoms" (PERF-NOTES, 1.26), run by t_features
   (one line) or alone: node tests/f_hep126.js [--node] [part …]. Each part fails before its fix and passes after. Parts
   that need the page are skipped with --node. (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt || X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
/* A nucleus fired at another at rest, head on; steps of dt (0: the step chooser's, as at normal speed); true if they
   reacted (the target gone), with the books across the run (an event's books, and its products' first steps). */
function headOn(X, d3, proj, targ, KE, dt, x0 = -3) {
  const W = X.W;
  X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.wall = 'open'; W.decayOn = false;
  const t = X.addNuc(targ[0], targ[1], 0, 0, 0), p = X.addNuc(proj[0], proj[1], 0, x0, 0);
  X.setMotion(p, KE, 1, 0, 0, 0, 0, 0);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const E0 = books(X), n0 = W.count.nreact, met = () => W.count.nreact > n0; // (a reaction (finishReaction: "α + α → …"); a diffractive pass sends the target off too, so its leaving is no sign)
  for (let i = 0; i < 4000 && !t.dead && !p.dead && p.x < 1; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt ? Math.min(dt, X.chooseDt()) : X.chooseDt(); X.step(W.dt); }
  return { hit: met() ? 1 : 0, books: books(X) - E0 };
}

/* A. A head-on α on α at rest. (1) 35% of the nucleus–nucleus passes above 25 MeV a nucleon diffracted, by a draw at any
   distance, so a head-on 1 GeV–1 PeV α passed straight through (turned by 10⁻⁹ rad at 1 PeV) one time in three, flat and
   3-D, at any speed; now the outer 35% of the passes diffract. (2) In 3-D an α in flight moved at ½mv²'s speed, 730c at
   1 PeV, 447 Å a shortest step, and its encounters were skipped (a path longer than half the box) or never looked for
   (gone through the open wall first): it met nothing at 1× down to 1/512× and below; now it flies at its true speed. */
PARTS.headOn = async (page, check, say) => {
  const X = load('all', { seed: 3 }), r = { flat1GeV: 0, flatPeVslow: 0, d3PeVnormal: 0, d3PeVslow: 0, d3TeVnormal: 0, worstBooks1GeV: 0 };
  for (let k = 0; k < 12; k++) { for (let j = 0; j < 1 + k * 3; j++) X.rnd(); const h = headOn(X, false, [2, 2], [2, 2], 1e9, 0); r.flat1GeV += h.hit; r.worstBooks1GeV = Math.max(r.worstBooks1GeV, Math.abs(h.books)); }
  for (let k = 0; k < 2; k++) { for (let j = 0; j < 3 + k * 5; j++) X.rnd(); r.flatPeVslow += headOn(X, false, [2, 2], [2, 2], 1e15, 1e-7, -0.4).hit; }
  for (let k = 0; k < 2; k++) { for (let j = 0; j < 3 + k * 5; j++) X.rnd(); r.d3PeVnormal += headOn(X, true, [2, 2], [2, 2], 1e15, 0).hit; }
  for (let k = 0; k < 2; k++) { for (let j = 0; j < 3 + k * 5; j++) X.rnd(); r.d3PeVslow += headOn(X, true, [2, 2], [2, 2], 1e15, 3e-8, -0.4).hit; }
  for (let k = 0; k < 4; k++) { for (let j = 0; j < 4 + k * 5; j++) X.rnd(); r.d3TeVnormal += headOn(X, true, [2, 2], [2, 2], 1e13, 0).hit; }
  r.worstBooks1GeV = +r.worstBooks1GeV.toExponential(1);
  check(r.flat1GeV === 12 && r.flatPeVslow === 2 && r.d3PeVnormal === 2 && r.d3PeVslow === 2 && r.d3TeVnormal === 4 && r.worstBooks1GeV < 1e-3,
    `1.26 fix A: a head-on α on α at rest reacts every time: flat 1 GeV ${r.flat1GeV}/12 (books within ${r.worstBooks1GeV} eV), flat 1 PeV in slow-motion steps ${r.flatPeVslow}/2, 3-D 1 PeV at normal speed ${r.d3PeVnormal}/2 and in slow-motion steps ${r.d3PeVslow}/2, 3-D 10 TeV ${r.d3TeVnormal}/4`, 'hep126 headOn: ' + JSON.stringify(r));
};

/* A, momentum and books of the head-on hit itself: a 1 GeV α on α at rest (flat and 3-D), the products' total
   four-momentum against what went in, and the energy books across the event. */
PARTS.headOnKeep = async (page, check, say) => {
  const out = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W; let worstP = 0, worstE = 0, n = 0;
    for (let k = 0; k < 6; k++) {
      X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.wall = 'reflect'; W.decayOn = false;
      for (let j = 0; j < k * 3; j++) X.rnd();
      const t = X.addNuc(2, 2, 0, 0, 0), p = X.addNuc(2, 2, 0, -2, 0); X.setMotion(p, 1e9, 1, 0, 0, 0, 0, 0);
      X.forcesNoEvents(); W.fSpawn = W.spawned;
      const P = () => { let s = d3 ? [0, 0, 0, 0] : [0, 0, 0]; for (const q of W.parts) if (!q.dead && q.k === X.NUC) s = X.add4(s, X.p4of(q, true)); for (const o of W.exo) if (!o.dead) s = X.add4(s, X.exoP4(o)); return s; };
      const P0 = P(), E0 = books(X), n0 = W.count.nreact; let met = false;
      for (let i = 0; i < 400 && !met; i++) { W.dt = X.chooseDt(); X.step(W.dt); met = W.count.nreact > n0; }
      if (!met) continue;
      n++; const P1 = P(); worstP = Math.max(worstP, Math.hypot(P1[1] - P0[1], P1[2] - P0[2], (P1[3] || 0) - (P0[3] || 0)) / Math.hypot(P0[1], P0[2], P0[3] || 0)); worstE = Math.max(worstE, Math.abs(books(X) - E0));
    }
    out[d3 ? 'd3' : 'flat'] = { hits: n, momentum: +worstP.toExponential(1), books: +worstE.toExponential(1) };
  }
  check(out.flat.hits === 6 && out.d3.hits === 6 && out.flat.momentum < 1e-6 && out.d3.momentum < 1e-6 && out.flat.books < 1e-3 && out.d3.books < 1e-3,
    `1.26 fix A: 1 GeV α + α head on, 6 of 6 react (flat ${out.flat.hits}, 3-D ${out.d3.hits}), momentum kept to ${Math.max(out.flat.momentum, out.d3.momentum)}, books to ${Math.max(out.flat.books, out.d3.books)} eV`, 'hep126 headOnKeep: ' + JSON.stringify(out));
};

/* A. An α on gold at 100 MeV (25 MeV a nucleon), head on: between 15 and 40 MeV a nucleon a fireball with no consistent
   outcome was nothing (one time in three flat, two in three in 3-D); now the compound nucleus takes it. */
PARTS.alphaGold = async (page, check, say) => {
  const X = load('all', { seed: 1 }); let flat = 0, d3 = 0;
  for (let k = 0; k < 6; k++) { for (let j = 0; j < k * 7; j++) X.rnd(); flat += headOn(X, false, [2, 2], [79, 118], 1e8, 0).hit; }
  for (let k = 0; k < 6; k++) { for (let j = 0; j < k * 7; j++) X.rnd(); d3 += headOn(X, true, [2, 2], [79, 118], 1e8, 0).hit; }
  check(flat === 6 && d3 === 6, `1.26 fix A: α on gold at 100 MeV head on reacts every time (flat ${flat}/6, 3-D ${d3}/6)`, 'hep126 alphaGold: ' + JSON.stringify({ flat, d3 }));
};

/* A. A nucleus in flight in 3-D moves at its true speed (it moved at ½mv²'s, 730c at 1 PeV), and slow motion sees it
   (with its depth: one fired along z was not slowed for). */
PARTS.fly3 = async (page, check, say) => {
  const X = load('all', { seed: 1 }), W = X.W;
  X.PRESETS.d3empty.build(); W.T = 0; W.gamma = 0; W.wall = 'open';
  const p = X.addNuc(2, 2, 0, -10, 0, 0, 0, false, 0); X.setMotion(p, 1e15, 0.6, 0, 0, 0, 0.8, 0);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const x0 = p.x, z0 = p.z, dt = 1e-5; X.step(dt);
  const c = Math.hypot(p.x - x0, p.z - z0) / dt / X.PHYS.C, hold = X.speedNow(p) / X.PHYS.C;
  check(c > 0.999 && c <= 1 + 1e-9 && hold > 0.999 && hold <= 1 + 1e-9, `1.26 fix A: a 1 PeV α in 3-D flies at ${c.toFixed(6)}c, and slow motion takes it at ${hold.toFixed(6)}c`, 'hep126 fly3: ' + JSON.stringify({ c, hold }));
};

/* B. Muonic hydrogen in a periodic box (flat and 3-D, as liquid water's) left the chamber at the first wall it reached,
   its energy escaped; now it goes across, as atoms do. */
PARTS.muWrap = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 2 }), W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.wall = 'wrap'; W.decayOn = false; W.T = 300;
    const o = X.addExo('muP', 5, 0, 0.5, 1, 0, undefined, 0, 0);
    go(X, 3000);
    r[d3 ? 'd3' : 'flat'] = { alive: !o.dead, inside: Math.abs(o.x) <= W.box.w / 2 && Math.abs(o.y) <= W.box.h / 2, ps: +(W.t * X.PHYS.TU_S * 1e12).toFixed(2) };
  }
  check(r.flat.alive && r.d3.alive && r.flat.inside && r.d3.inside, `1.26 fix B: muonic hydrogen in a periodic box stays (flat ${r.flat.ps} ps, 3-D ${r.d3.ps} ps)`, 'hep126 muWrap: ' + JSON.stringify(r));
};

/* B (the owner: "you also can't erase muonic atoms"). Muonic hydrogen lives in W.exo, which the Erase tool's brush did
   not look at (flat or 3-D); a muonic heavier atom (an atom with muB) showed in Inspect as a plain atom; saves and undo
   (worldToJSON) dropped both. Through the page's own tools: a click with Erase on the μp, Inspect on a muonic carbon, a
   save read back. */
PARTS.muTools = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) {
    const scr = await page.evaluate((d3) => {
      document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
      loadPreset(d3 ? 'd3empty' : 'empty'); setRunning(false); W.decayOn = false;
      placeFly({ kind: 'exo', sp: 'muP' }, 2, 1, 1, 0);
      const c = addAtom('C', -4, -2); c.vx = c.vy = c.vz = 0; forcesNoEvents(); W.fSpawn = W.spawned; muStop(addExo('mu-', c.x + 0.5, c.y, 1000, -1, 0, undefined, c.z, 0));
      if (!d3) fitView();
      const o = W.exo.find(q => !q.dead && q.sp === 'muP'), cv = $('cv').getBoundingClientRect(), v = [0, 0, 0];
      if (d3) { cam3Update(); proj3(o.x, o.y, o.z, v); } else { v[0] = w2sx(o.x); v[1] = w2sy(o.y); }
      // Inspect on the muonic carbon, and a save read back (a copy of the world: the μp itself stays to be erased)
      R.sel = c; R.selX = null; renderInspect(); const ins = /muonic atom/.test($('tp-inspect').textContent);
      const d = JSON.parse(JSON.stringify(worldToJSON())), xa = Array.isArray(d.xa) ? d.xa.filter(q => q[0] === 'muP').length : 0, muC = d.parts.filter(q => q[1] === 6 && (q[4] & 4)).length;
      const kept = { muP: xa, muC };
      setTool('erase');
      return { x: cv.left + v[0], y: cv.top + v[1], ins, kept, had: !!c.muB };
    }, d3);
    await page.mouse.click(scr.x, scr.y); await page.waitForTimeout(60);
    const left = await page.evaluate(() => W.exo.filter(q => !q.dead && q.sp === 'muP').length);
    r[d3 ? 'd3' : 'flat'] = { inspect: scr.ins, saved: scr.kept, erasedByClick: left === 0 };
  }
  await page.evaluate(() => setTool('inspect'));
  const ok = (s) => s.inspect && s.saved.muP === 1 && s.saved.muC === 1 && s.erasedByClick;
  check(ok(r.flat) && ok(r.d3), `1.26 fix B: muonic atoms: Erase takes muonic hydrogen (flat and 3-D), Inspect shows a muonic carbon's muon, saves and undo keep both`, 'hep126 muTools: ' + JSON.stringify(r));
};
PARTS.muTools.page = true;

/* Muonium (the owner: "it still says 'inside its nucleus, a proton'"): its nucleus is a μ⁺, a lepton with no quarks.
   1.12 made muonium an atom (p.mu) and named it in Inspect, but the "Inside" section (qSubject, 0.50), the shell
   diagram and the particle view took Z = 1, N = 0 for hydrogen's proton (uud quarks, a proton bead), and the inspector
   offered to keep it as the isotope hydrogen-1. */
PARTS.muonium = async (page, check, say) => {
  const r = await page.evaluate(() => {
    loadPreset('empty'); setRunning(false);
    const m = addMuonium(0, 0, 0.03, 1, 0, 1); R.sel = m; R.selX = null; renderInspect();
    const t = $('tp-inspect').textContent, sub = qSubject(m);
    return { proton: /Inside its nucleus, a proton|quarks and gluons/.test(t), muonInside: /positive muon/.test(t), lepton: !!(sub && sub.lepton), keep: !!$('tp-inspect').querySelector('[data-act="save"]') };
  });
  check(!r.proton && r.muonInside && r.lepton && !r.keep, `1.26 fix: Inspect on muonium shows its nucleus as a μ⁺ (a lepton, nothing inside), not a proton`, 'hep126 muonium: ' + JSON.stringify(r));
};
PARTS.muonium.page = true;

module.exports = async function fhep126(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (hep126 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `hep126 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.26 hep bug-fix checks passed');
  process.exitCode = fails ? 1 : 0;
})();
