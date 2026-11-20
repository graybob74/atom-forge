'use strict';
/* 1.36.2 (the owner, 2026-11-19: "fix collision between Einsteinium and Calcium for some reason they dont collide they
   only knock electrons and make it able to choose isotope on syncrotron and and also add a spread and thickness option
   in syncrotron"). heavy: ⁴⁸Ca on einsteinium above the barrier reacts (quasi-fission, now and then a compound nucleus),
   flat and 3-D, with the energy booked; below the barrier it does not. target: the target block's isotope, thickness
   and the beam's spread on it. page: the panel's controls. Run by t_features or alone: node tests/f_1362.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
const BK = 'totalEnergy().total + W.ledger.bath - W.ledger.nuc';
function caOnEs(d3, E, ions, seed = 3) {
  const X = load('all', { seed, patch: s => s
    .replace('function heavyCapture(a, b, Ecm, bd, x, y, z) {', `function heavyCapture(a, b, Ecm, bd, x, y, z) { const _b0 = ${BK}, _r = heavyCapture0(a, b, Ecm, bd, x, y, z); if (_r) (globalThis.QD = globalThis.QD || []).push(${BK} - _b0); return _r; }\nfunction heavyCapture0(a, b, Ecm, bd, x, y, z) {`)
    .replace('  const out = finishReaction(a, b, items, moms, x, y, kind, sub);', '  if (a.Z * b.Z > 1000) { const _k = /quasi-fission/.test(sub || "") ? "qf" : kind; (globalThis.RK = globalThis.RK || {})[_k] = (globalThis.RK[_k] || 0) + 1; }\n  const out = finishReaction(a, b, items, moms, x, y, kind, sub);') });
  globalThis.QD = []; globalThis.RK = {};
  const W = X.W; X.PRESETS[d3 ? 'fixed3d' : 'fixedt'].build();
  const k = X.beamKey(20, 48); X.setupCollider('fixed', k, k, E);
  const C = W.collider; X.setTarget(C, 'Es', false); X.settleOverlaps(); W.baseSpf = W.simPerFrame; W.slowHold = false; W.hold = null; W.slowmo = false;
  const t0 = Date.now(); for (let f = 0; f < 600 && Date.now() - t0 < 90000 && (C.sent || 0) < ions; f++) X.simFrame(1 / 60, 1e9);
  return { X, C, rk: { ...globalThis.RK }, qd: globalThis.QD.slice() };
}
PARTS.heavy = async (page, check) => {
  for (const d3 of [false, true]) {
    const r = caOnEs(d3, 3e8, 40), n = (r.rk.qf || 0) + (r.rk.fusion || 0), worst = Math.max(0, ...r.qd.map(Math.abs));
    check(n >= 5 && worst < 1e3, `1.36.2 ${d3 ? '3-D' : 'flat'}: ⁴⁸Ca at 300 MeV on einsteinium reacts: ${r.rk.qf || 0} quasi-fissions, ${r.rk.fusion || 0} compound nuclei from ${r.C.sent} ions, each booked to ${r.X.fmtE(worst)}`,
      `1.36.2 ${d3 ? '3-D' : 'flat'} Ca + Es: reactions ${JSON.stringify(r.rk)}, sent ${r.C.sent}, worst books ${worst} eV`);
  }
  const lo = caOnEs(false, 2.4e8, 30); // (202 MeV in their own frame, under the 211 MeV barrier)
  check(!Object.keys(lo.rk).length, `1.36.2 below the barrier (240 MeV): no touching reactions from ${lo.C.sent} ions`, `1.36.2 below the barrier: ${JSON.stringify(lo.rk)}`);
};
PARTS.target = async (page, check) => {
  const bad = [];
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 4 }), W = X.W; X.PRESETS[d3 ? 'fixed3d' : 'fixedt'].build();
    W.collider.tgtN = 6; W.collider.spread = 16; const k = X.beamKey(20, 48); X.setupCollider('fixed', k, k, 3e8);
    const C = W.collider; X.setTarget(C, 'Es', false, 254); X.settleOverlaps(); W.baseSpf = W.simPerFrame; W.slowHold = false; W.hold = null; W.slowmo = false;
    const T = C.target, ats = W.parts.filter(p => !p.dead && p.tgt), layers = new Set(ats.map(p => Math.round(((p.x - T.x) * T.ux + (p.y - T.y) * T.uy) / T.a0 * 2)));
    if (T.n !== 6 || layers.size !== 6 || ats.some(p => p.Z + p.N !== 254)) bad.push(`${d3 ? '3-D' : 'flat'}: layers ${T.n}/${layers.size}, isotopes ${[...new Set(ats.map(p => p.Z + p.N))]}`);
    X.setTarget(C, 'U', false); if (C.target.A !== 238) bad.push(`new element keeps A ${C.target.A}`); X.setTarget(C, 'Es', false, 254);
    const hits = [], seen = new Set(), bk = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc; let drift = 0;
    const t0 = Date.now(); for (let f = 0; f < 600 && hits.length < 8 && Date.now() - t0 < 150000; f++) {
      const pre = W.parts.filter(p => !p.dead && p.beam === 'a' && p.rad), b0 = bk(); X.extractBeam(C); drift = Math.max(drift, Math.abs(bk() - b0));
      for (const p of pre) if (p.extr && !seen.has(p)) { seen.add(p); const fx = T.x - T.ux * T.depth / 2, fy = T.y - T.uy * T.depth / 2, s = ((fx - p.x) * T.ux + (fy - p.y) * T.uy) / (p.ux * T.ux + p.uy * T.uy); hits.push([(p.x + s * p.ux - T.x) * -T.uy + (p.y + s * p.uy - T.y) * T.ux, d3 ? p.z + s * p.uz : 0]); }
      X.simFrame(1 / 60, 1e9);
    }
    const r = hits.map(h => Math.hypot(h[0], h[1])), wide = Math.max(...r);
    if (hits.length < 5 || wide > 8.05 || wide < 3 || drift > 1e-6) bad.push(`${d3 ? '3-D' : 'flat'} spread: ${hits.length} aimed, widest ${wide}, books ${drift}`);
  }
  check(!bad.length, '1.36.2 the target: ²⁵⁴Es picked, 6 layers deep, flat and 3-D; a new element takes its common isotope; a 16 Å beam spread lands across 16 Å of the face (a disc in 3-D) with no energy changed', `1.36.2 target: ${bad.join(' | ')}`);
};
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1360, height: 860 }, settle: 800 }); page = own.page; }
  await page.evaluate(() => { loadPreset('fixedt'); setRunning(true); }); await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const ch = (id, v) => { const e = $(id); e.value = String(v); e.dispatchEvent(new Event('change')); e.dispatchEvent(new Event('input')); };
    ch('cTgt', 'Es'); ch('cTgtIso', 253); ch('cTgtN', 5); ch('cSpread', 12);
    const C = W.collider, T = C.target;
    return { shown: !$('cTgtWrap').hidden && !$('cTgtIso').hidden, A: T.A, n: T.n, spread: C.spread, el: T.el, isoOpts: $('cTgtIso').options.length, label: $('cTgtVal').textContent, atoms: W.parts.filter(p => !p.dead && p.tgt && p.Z + p.N === 253).length };
  });
  check(r.shown && r.el === 'Es' && r.A === 253 && r.n === 5 && r.spread === 12 && r.atoms > 20, `1.36.2 the synchrotron panel: target isotope (${r.isoOpts} of einsteinium), thickness and beam spread work (${r.label})`, `1.36.2 page: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.36.2 page errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
module.exports = async function f1362(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.36.2 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
