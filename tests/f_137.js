'use strict';
/* 1.37 (item 100, the owner's notes on the colliders, 2026-11-20). ring3d: unstable particles as a 3-D ring's beams go
   round through its magnets and collide (they flew straight on, and met nothing). linac: a 1 TeV linear collider keeps
   its beams on the axis (a slow particle's long first step in the 12.5 GV/Å field threw half of them out, "bouncing
   back") and muons at 1 TeV collide. made: the Made list counts γ rays and neutrinos and shows every kind, by group.
   qgp3: the 3-D plasma is a body in space. picker: the Select particles window. Run by t_features or alone:
   node tests/f_137.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
function run(preset, kind, a, b, E, frames, ms, seed = 3, fast = false) {
  const X = load('all', { seed }), W = X.W; X.PRESETS[preset].build(); X.setupCollider(kind, a, b, E); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  if (fast) { W.slowHold = false; W.hold = null; W.slowmo = false; } // (not held to the beams' pace: the ring's ramp in a few frames)
  const C = W.collider, t0 = Date.now(); let f = 0;
  for (; f < frames && Date.now() - t0 < ms && (C.hits || 0) < 40; f++) X.simFrame(1 / 60, 1e9);
  return { X, W, C, f };
}
PARTS.ring3d = async (page, check) => {
  const r = run('ring3d', 'ring', 'xmu-', 'xmu+', 1e9, 300, 120000, 3, true);
  const out = r.W.exo.filter(o => !o.dead && o.xb && o.beam && Math.hypot(o.x, o.y) > 70).length;
  check(r.C.hits > 0 && out === 0, `1.37 a 3-D ring of 1 GeV muons: they go round through the magnets and collide (${r.C.hits} collisions, last ${r.C.last})`, `1.37 3-D muon ring: hits ${r.C.hits}, beam particles outside the ring ${out}, frames ${r.f}`);
};
PARTS.linac = async (page, check) => {
  const X = load('all', { seed: 3, patch: s => s.replace('function step(dt) {', 'function step(dt) { if (globalThis.HOOK) globalThis.HOOK();') }), W = X.W;
  X.PRESETS.linac.build(); X.setupCollider('linear', 'p', 'pbar', 1e12); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const seen = new Map(); let wide = 0;
  globalThis.HOOK = () => { for (const p of W.parts) if (!p.dead && p.beam && p.rad) { let r = seen.get(p); if (!r) seen.set(p, r = { ux: Math.sign(p.ux), rev: false }); if (Math.sign(p.ux) !== r.ux && Math.abs(p.ux) > 0.1 && Math.abs(p.x) > 30 && Math.abs(p.x) < 100) r.rev = true; if (Math.abs(p.x) < 100 && Math.abs(p.y) > 6) wide++; } };
  const t0 = Date.now(); for (let f = 0; f < 300 && Date.now() - t0 < 90000 && (W.collider.hits || 0) < 30; f++) X.simFrame(1 / 60, 1e9);
  globalThis.HOOK = null;
  const rev = [...seen.values()].filter(r => r.rev).length;
  const m = run('linac', 'linear', 'xmu-', 'xmu+', 1e12, 300, 90000);
  check(rev === 0 && wide === 0 && W.collider.hits > 0 && m.C.hits >= 10, `1.37 a 1 TeV linear collider keeps its beams on the axis: none of ${seen.size} protons and antiprotons turned back or thrown out of the linac, ${W.collider.hits} collisions; 1 TeV muons: ${m.C.hits} collisions`,
    `1.37 linac: turned back ${rev}, off the axis ${wide} steps, of ${seen.size}; p p̄ hits ${W.collider.hits}; muon hits ${m.C.hits}`);
};
PARTS.made = async (page, check) => {
  const r = run('linac', 'linear', 'pos', 'e', 1e11, 400, 90000);
  const M = r.C.made || {}, K = r.C.madeK || {}, has = (l) => (M[l] || 0) > 0, nus = Object.keys(M).filter(l => /^ν/.test(l));
  check(has('γ') && nus.length > 0 && (has('W⁺') || has('Z⁰')) && K['γ'] === 'Bosons' && K[nus[0]] === 'Neutrinos' && K['π⁺'] === 'Mesons', `1.37 Made lists γ rays (${M['γ']}), neutrinos (${nus.map(l => `${l}×${M[l]}`).join(', ')}) and the W and Z bosons (${M['W⁺'] || 0} W⁺, ${M['Z⁰'] || 0} Z⁰), each in its group`,
    `1.37 made: ${JSON.stringify(M)} kinds ${JSON.stringify(K)}`);
};
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  // the plasma in 3-D: its partons and its hot matter fill a ball (z spread like x and y), and turning the view moves them apart differently
  const q = await page.evaluate(() => {
    loadPreset('rhic3d'); setRunning(false);
    W.qgp = [{ x: 0, y: 0, z: 0, n: 900, sNN: 2e5, t0: 1, age: 0 }]; const g = W.qgp[0];
    while (g.age < 0.6) { g.age += 0.03; render3d(W.rt); }
    const sd = (k) => Math.sqrt(g.pp.reduce((s, p) => s + p[k] * p[k], 0) / g.pp.length);
    const shot = () => { const o = [0, 0, 0]; return g.pp.map(p => { proj3(p.x * 4, p.y * 4, p.z * 4, o); return o[0]; }); };
    R.cam3.yaw = 0.3; render3d(W.rt); const s1 = shot(); R.cam3.yaw = 1.8; render3d(W.rt); const s2 = shot();
    let ch = 0; for (let i = 0; i < s1.length; i++) for (let j = i + 1; j < s1.length; j++) if ((s1[i] - s1[j]) * (s2[i] - s2[j]) < 0) ch++;
    return { d3: !!g.d3, med: (g.med || []).length, sx: sd('x'), sz: sd('z'), swapped: ch };
  });
  check(q.d3 && q.med >= 100 && q.sz > 0.6 * q.sx && q.swapped > 20, `1.37 the 3-D plasma is a ball: ${q.med} points of hot matter, its partons spread in depth as across (σz ${q.sz.toFixed(2)}, σx ${q.sx.toFixed(2)}); turning the view reorders ${q.swapped} pairs of them`, `1.37 qgp3: ${JSON.stringify(q)}`);
  // the particle window
  await page.evaluate(() => { loadPreset('ring'); }); await page.waitForTimeout(400);
  await page.click('#cPickBtn'); await page.waitForTimeout(200);
  const c = await page.evaluate(() => ({ open: !$('bpModal').hidden, cats: [...document.querySelectorAll('#bpBody .bpcat h3')].map(h => h.firstChild.textContent), n: document.querySelectorAll('#bpBody .bpp').length, off: document.querySelectorAll('#bpBody .bpp:disabled').length }));
  await page.click('#bpBody button[data-k="xmu-"]'); await page.waitForTimeout(300);
  await page.click('#bpWhich button[data-w="b"]'); await page.fill('#bpFind', 'calcium'); await page.waitForTimeout(150);
  await page.click('#bpBody button[data-el="20"]'); await page.click('#bpBody .bpiso button[data-a="48"]'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ a: W.collider.a, b: W.collider.b })); await page.keyboard.press('Escape');
  const shut = await page.evaluate(() => $('bpModal').hidden);
  const want = ['Leptons', 'Neutrinos', 'Bosons', 'Mesons', 'Baryons', 'Multiquarks', 'Light nuclei and antinuclei', 'Heavy ions', 'Actinides', 'Exotic atoms and nuclei', 'Every element'];
  check(c.open && want.every(w => c.cats.includes(w)) && c.off > 20 && r.a === 'xmu-' && r.b === 'ca48' && shut, `1.37 Select particles: ${c.n} buttons in ${c.cats.length} groups (${c.off} greyed: no machine can take them), μ⁻ picked for beam 1 and ⁴⁸Ca for beam 2, Esc closes it`, `1.37 picker: ${JSON.stringify({ c, r, shut })}`);
  if (own) { if (own.errors.length) check(false, '', '1.37 page errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
module.exports = async function f137(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.37 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
