'use strict';
/* The checks for 1.27's feature 25, the Higgs boson (hep.js "The Higgs boson": XP.H0, hFinal, hVirt, sigZH, zhAng, H_PP;
   PERF-NOTES "1.27: feature 25"), run by t_features (one line) or alone: node tests/f_127h.js [--node] [part …]
   (parts: branch, virt, zh, hadron, books, fp, page). Every part but fp fails on v151 (no Higgs there); fp shows the
   setups unchanged, below its thresholds. (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const chg = (X) => { const W = X.W; let q = (W.ledger.qOut || 0) + (W.ledger.qWall || 0); for (const p of W.parts) if (!p.dead) q += p.q; for (const o of W.exo) if (!o.dead) q += o.q; return Math.round(q * 1e6) / 1e6; };
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'open'; W.collider = { made: {} }; };
const clear = (X) => { const W = X.W; for (const p of W.parts) X.kill(p); W.parts = []; W.exo = []; W.rays = []; X.forcesNoEvents(); };
const sig3 = (n, k) => 3 * Math.sqrt(Math.max(1, n * k * (1 - k)));

/* ---- 1. the decays' shares against the Standard Model's (LHC Higgs Cross Section Working Group, 125 GeV) */
PARTS.branch = async (page, check, say) => {
  const X = load('all', { seed: 5 }); fresh(X, false);
  const hz = X.hadronize; X.hadronize = () => null; // (jets counted, not made: fast)
  const n = 100000, c = {};
  for (let i = 0; i < n; i++) { const f = X.hFinal(X.XP.H0.m); const k = !f ? 'jets' : f.items.map(it => X.labelOf(it)).sort().join(' '); c[k] = (c[k] || 0) + 1; }
  X.hadronize = hz;
  const g = (k) => (c[k] || 0) / n, r = { jets: g('jets'), WW: g('W⁺ W⁻'), tt: g('τ⁺ τ⁻'), ZZ: g('Z⁰ Z⁰'), gg: g('γ γ'), Zg: g('Z⁰ γ'), mm: g('μ⁺ μ⁻') };
  const want = { jets: 0.693, WW: 0.214, tt: 0.063, ZZ: 0.026, gg: 0.0023, Zg: 0.0015, mm: 0.00022 };
  const bad = Object.keys(want).filter(k => Math.abs(r[k] - want[k]) > 4 * Math.sqrt(want[k] * (1 - want[k]) / n) + 1e-4);
  // real jets: hadrons, the energy and momentum kept; b hadrons in most
  let nb = 0, mis = 0, nj = 0; const B = /^(B|Bb|Bs|Bsb|Lb|Lbb)/;
  for (let i = 0; i < 400 && nj < 120; i++) { const f = X.hFinal(X.XP.H0.m); if (!f || !f.qq) continue; nj++; let E = 0, px = 0, py = 0; for (const v of f.vs) { E += v[0]; px += v[1]; py += v[2]; } mis = Math.max(mis, Math.abs(E - X.XP.H0.m), Math.hypot(px, py)); if (f.items.some(it => it.t === 'x' && B.test(it.sp))) nb++; }
  say('  1.27 (25) decays: ' + JSON.stringify({ r, nj, nb, mis }));
  check(!bad.length && nb > 0.6 * nj && mis < 1e-6, `1.27 (25): the Higgs boson decays to two jets ${(r.jets * 100).toFixed(1)}% (b b̄, c c̄, gluons: 69.3%), W W* ${(r.WW * 100).toFixed(1)}% (21.4), τ τ ${(r.tt * 100).toFixed(2)}% (6.3), Z Z* ${(r.ZZ * 100).toFixed(2)}% (2.6), γ γ ${(r.gg * 100).toFixed(3)}% (0.23), Z γ ${(r.Zg * 100).toFixed(3)}% (0.15), μ μ ${(r.mm * 100).toFixed(3)}% (0.022); b hadrons in ${nb} of ${nj} jet pairs, energy and momentum kept to ${mis.toExponential(0)} MeV`, '1.27 (25) branch: ' + JSON.stringify({ bad, r }));
};

/* ---- 2. W W* and Z Z*: one real, one virtual (its mass from dΓ/dm²), and each then decays as a W or Z of its mass */
PARTS.virt = async (page, check, say) => {
  const X = load('all', { seed: 6 }); fresh(X, false);
  const w = [], z = [], won = [];
  for (let i = 0; i < 4000; i++) { const m1 = X.bwMassRel('W+', X.XP.H0.m - 1001), m = X.hVirt(X.XP.H0.m, m1, 'W+'); w.push(m / 1000); won.push(m1 / 1000); }
  for (let i = 0; i < 4000; i++) { const m1 = X.bwMassRel('Z0', X.XP.H0.m - 1001), m = X.hVirt(X.XP.H0.m, m1, 'Z0'); z.push(m / 1000); }
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; }, max = (a) => Math.max(...a), min = (a) => Math.min(...a);
  const r = { Wstar: +med(w).toFixed(1), Zstar: +med(z).toFixed(1), Wmax: +max(w).toFixed(1), Zmin: +min(z).toFixed(1), Won: +med(won).toFixed(2), sumMax: +Math.max(...w.map((m, k) => m + won[k])).toFixed(2) };
  // a placed Higgs that went to Z Z*: its two Zs, then their four products
  let four = 0, tries = 0; const hz = X.pickBr;
  for (let k = 0; k < 40 && four < 5; k++) {
    clear(X); X.pickBr = (L) => (L.some(e => e[1] === 'ZZ') ? 'ZZ' : hz(L)); // (the Z Z* channel forced, for the test)
    const o = X.addExo('H0', 0, 0, 0, 1, 0, X.resPlaceMass('H0')); X.moveExos(1e-9); X.pickBr = hz; X.moveExos(1e-9); tries++;
    if (/2Z⁰ \(one of them virtual/.test(o.fate || '') && !X.W.exo.some(e => e.sp === 'Z0' && !e.dead)) four++; // (the dead leave the list: the Higgs's fate names the pair, and no Z is left)
  }
  say('  1.27 (25) virtual: ' + JSON.stringify({ r, four, tries }));
  check(r.Won > 79.5 && r.Won < 81.2 && r.Wstar > 20 && r.Wstar < 42 && r.Zstar > 15 && r.Zstar < 35 && r.sumMax < 125.2 && four === 5,
    `1.27 (25): H → W W*: the real W ${r.Won} GeV, the virtual one ${r.Wstar} GeV (median; up to ${r.Wmax}); H → Z Z*: the virtual Z ${r.Zstar} GeV (median), the two never past 125.2 GeV; a Higgs forced to Z Z* leaves two Zs that both decay (5 of 5)`,
    '1.27 (25) virt: ' + JSON.stringify({ r, four }));
};

/* ---- 3. e⁺e⁻ → Z H: its cross section (Born) against √s, a collision at 250 GeV makes a Z and a Higgs, books exact */
function eePair(X, rs, d3) {
  clear(X);
  const e = X.addLepton(X.ELEC, -0.01, 0), p = X.addLepton(X.POS, 0.01, 0), K = rs / 2 * 1e9 - 0.51099895e6;
  if (d3) { X.setMotion(e, K, 0.6, 0, 0, 0, 0.8); X.setMotion(p, K, -0.6, 0, 0, 0, -0.8); } else { X.setMotion(e, K, 1, 0); X.setMotion(p, K, -1, 0); }
  X.forcesNoEvents();
  const E0 = books(X), Q0 = chg(X);
  X.eeEvent(e, p, 0, 0);
  const made = X.W.exo.filter(o => !o.dead).map(o => o.sp);
  X.moveExos(1e-9);
  return { made, d: Math.abs(books(X) - E0) / (rs * 1e9), q: chg(X) === Q0 };
}
PARTS.zh = async (page, check, say) => {
  const X = load('all', { seed: 8 }); fresh(X, false);
  const sig = { 210: X.sigZH(210 * 210) * 1000, 216: X.sigZH(216 * 216) * 1000, 240: X.sigZH(240 * 240) * 1000, 250: X.sigZH(250 * 250) * 1000, 500: X.sigZH(500 * 500) * 1000 };
  const share = X.ewEE(250 * 250).ZH / (X.ewEE(250 * 250).WW + X.ewEE(250 * 250).ZZ + X.ewEE(250 * 250).ZH);
  // collisions at 250 GeV with every channel but ZH taken out: the Z and the Higgs, their angles, the books
  let zh = 0, worst = 0, qbad = 0, n = 0; const keep = X.ewEE;
  for (const d3 of [false, true]) { fresh(X, d3); X.ewEE = (s) => { const r = keep(s); return { Z: 0, WW: 0, ZZ: 0, ZH: r.ZH }; };
    const sg = X.sigGG, sl = X.sigLL, hp = X.hadronParts; X.sigGG = () => 0; X.sigLL = () => 0; X.hadronParts = () => ({ rho: 0, omega: 0, phi: 0, cont: 0, cc: 0, bb: 0 });
    for (let i = 0; i < 30; i++) { const q = eePair(X, 250, d3); n++; if (q.made.includes('Z0') && q.made.includes('H0')) zh++; worst = Math.max(worst, q.d); if (!q.q) qbad++; }
    X.sigGG = sg; X.sigLL = sl; X.hadronParts = hp; X.ewEE = keep; }
  // the Z's angle: λ sin²θ + 8M_Z²/s (at 250 GeV, ⟨cos²θ⟩ of that law)
  const acc = X.zhAng(250 * 250); let a = 0, b = 0; for (let k = 0; k <= 2000; k++) { const c = -1 + k / 1000; a += acc(c) * c * c; b += acc(c); }
  const law = a / b; let c2 = 0, m = 0; X.W.d3 = true; for (let k = 0; k < 20000; k++) { const u = X.ewDir([0, 0, 1], acc); c2 += u[2] * u[2]; m++; } X.W.d3 = false;
  const r = { sig: Object.fromEntries(Object.entries(sig).map(([k, v]) => [k, +v.toFixed(4)])), share: +share.toFixed(4), zh, n, books: +worst.toExponential(1), qbad, cos2: +(c2 / m).toFixed(3), law: +law.toFixed(3) };
  say('  1.27 (25) e⁺e⁻ → Z H: ' + JSON.stringify(r));
  check(sig[210] === 0 && sig[216] === 0 && Math.abs(sig[250] - 0.2377) < 0.001 && sig[500] < sig[250] && zh === n && worst < 1e-12 && !qbad && Math.abs(r.cos2 - law) < 0.01,
    `1.27 (25): e⁺e⁻ → Z H: none below 216.4 GeV, ${r.sig[240]} pb at 240 GeV, ${r.sig[250]} at 250 (Born, about 0.24), ${r.sig[500]} at 500; ${(share * 100).toFixed(1)}% of the W, Z and Higgs pairs at 250 GeV; ${zh} of ${n} such collisions (flat and 3-D) made a Z and a Higgs, books within ${r.books} of √s, charge kept; the Z's angle ⟨cos²θ⟩ ${r.cos2} (λ sin²θ + 8M_Z²/s: ${r.law})`,
    '1.27 (25) zh: ' + JSON.stringify(r));
};

/* ---- 4. hadron collisions: the Higgs beside the W and Z, at σ/σ_inel (the W and Z taken out and ×10⁸ for the test: at
   real rates one pp collision in 1.4 billion at 13 TeV), books and charge kept */
PARTS.hadron = async (page, check, say) => {
  const r = {}; let ok = true;
  for (const [kind, rs, n, d3] of [['pp', 13000, 300, false], ['pp', 13000, 200, true], ['pp', 100, 200, false]]) {
    const X = load('all', { seed: 9 }), W = X.W; fresh(X, d3); X.RP.ewX = 1e8; const sp = X.ewSigPP; X.ewSigPP = (tab, g, thr, nn) => (tab === X.H_PP ? sp(tab, g, thr, nn) : 0); // (the W and Z out)
    let h = 0, ev = 0, worst = 0, qbad = 0;
    for (let k = 0; k < n; k++) {
      clear(X);
      const a = X.addNuc(1, 0, 0, -0.01, 0, 0, 0, false), b = X.addNuc(1, 0, 0, 0.01, 0, 0, 0, false), K = (rs / 2 * 1000 - 938.272) * 1e6;
      if (d3) { X.setMotion(a, K, 0, 0.6, 0, 0, 0.8); X.setMotion(b, K, 0, -0.6, 0, 0, -0.8); } else { X.setMotion(a, K, 1, 0); X.setMotion(b, K, -1, 0); }
      X.forcesNoEvents();
      const E0 = books(X), Q0 = chg(X), P = X.add4(X.p4of(a, true), X.p4of(b, true));
      if (!X.nnInelastic(a, b, 0, 0, P, X.mass4(P))) continue;
      ev++; if (W.exo.some(o => o.sp === 'H0')) h++;
      X.moveExos(1e-9);
      worst = Math.max(worst, Math.abs(books(X) - E0) / (rs * 1e9)); if (chg(X) !== Q0) qbad++;
    }
    X.ewSigPP = sp; const inel = X.hfLog(X.HF_INEL, Math.max(5, rs)) * 1e6, kH = Math.min(1, X.ewSigPP(X.H_PP, rs, 125.2, 16) / inel * 1e8);
    r[rs + (d3 ? '3d' : '')] = { ev, h, eH: +(ev * kH).toFixed(1), books: +worst.toExponential(1), qbad };
    if (rs < 200) { if (h) ok = false; } else if (Math.abs(h - ev * kH) > sig3(ev, kH) + 1 || worst > 1e-12 || qbad || ev < 0.9 * n) ok = false;
  }
  say('  1.27 (25) hadron collisions: ' + JSON.stringify(r));
  check(ok, `1.27 (25): pp at 13 TeV (×10⁸, the W and Z out) makes a Higgs in ${r['13000'].h} of ${r['13000'].ev} collisions (expected ${r['13000'].eH}), in 3-D ${r['130003d'].h} of ${r['130003d'].ev} (${r['130003d'].eH}); none at 100 GeV; books within ${Math.max(r['13000'].books, r['130003d'].books)} of √s, charge kept`, '1.27 (25) hadron: ' + JSON.stringify(r));
};

/* ---- 5. placed Higgs bosons decay where they are, books exact, flat and 3-D (moving ones too) */
PARTS.books = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 10 }); fresh(X, d3);
    let worst = 0, n = 0, alive = 0, qbad = 0;
    for (let i = 0; i < 60; i++) {
      clear(X); const o = X.addExo('H0', 0, 0, 1e9 * (i % 3), 1, 0, X.resPlaceMass('H0'), 0, d3 ? 0.3 : 0);
      const E1 = books(X), Q1 = chg(X); X.moveExos(1e-9); X.moveExos(1e-9); // (the virtual W or Z it leaves decays next)
      worst = Math.max(worst, Math.abs(books(X) - E1) / (o.m * 1e6 + o.KE)); n++; if (!o.dead) alive++; if (chg(X) !== Q1) qbad++;
    }
    r[d3 ? 'd3' : 'flat'] = { n, worst: +worst.toExponential(1), alive, qbad };
  }
  check(r.flat.worst < 1e-12 && r.d3.worst < 1e-12 && !r.flat.alive && !r.d3.alive && !r.flat.qbad && !r.d3.qbad, `1.27 (25): ${r.flat.n} placed Higgs bosons decay at once (flat and 3-D), the books within ${Math.max(r.flat.worst, r.d3.worst)} of their energy, charge kept`, '1.27 (25) books: ' + JSON.stringify(r));
};

/* ---- 6. below its thresholds nothing changes: setups with collisions, beams, decays, LEP (tools/fingerprint.js) */
const FP = { lep: '0ba36a5e books 8ac2be3b 5', rhic: 'fb7e8382 books a9f2ee3a 20', linac: '7c6eb010 books 2b70ae2c 20', dafne: '793dfacd books 43026f16 20', annihilation: '63bcd7e3 books 80f2a127 162', water: 'cac1ac32 books a9f2ee3a 240', water3d: '7a2e7f5c books a9f2ee3a 1029' }; // (v151, tools/fingerprint.js)
PARTS.fp = async (page, check, say) => {
  const want = FP;
  const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'tools', 'fingerprint.js'), ...Object.keys(want)], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const bad = [];
  for (const line of out.split('\n')) { const m = line.trim().split(/\s+/); if (m.length < 2 || !(m[0] in want)) continue; const got = m.slice(1).join(' '); if (got !== want[m[0]]) bad.push(`${m[0]} ${got} (before ${want[m[0]]})`); }
  check(!bad.length, `1.27 (25): below the Higgs boson's thresholds the setups as before (fingerprints of ${Object.keys(want).join(', ')}; all 60 checked when it was built)`, '1.27 (25) fp: ' + JSON.stringify(bad));
};

/* ---- 7. the page: the palette's Higgs, Inspect (its name, decays, nothing inside), the Physics tab's line */
PARTS.page = async (page, check, say) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    loadPreset('empty'); setRunning(false);
    const o = addExo('H0', 0, 0, 0, 1, 0, resPlaceMass('H0'));
    R.selX = { kind: 'exo', o }; showTab('inspect', true); renderInspect();
    const out = { ins: $('tp-inspect').textContent, cat: PCATS.some(([n, l]) => n === 'W, Z and Higgs bosons' && l.length === 4), m: o.m };
    out.help = [...document.querySelectorAll('section.card')].map(s => s.textContent).join(' ');
    return out;
  });
  const ok = /Higgs boson/.test(r.ins) && /b b̄/.test(r.ins) && /Nothing: the Higgs boson is fundamental/.test(r.ins) && r.cat && /Higgs-strahlung/.test(r.help) && /125\.2 GeV/.test(r.help);
  say('  1.27 (25) page: ' + JSON.stringify({ m: r.m, cat: r.cat, ins: r.ins.slice(0, 200) }));
  check(ok, `1.27 (25): the palette lists the Higgs boson with the W and Z; Inspect shows a placed one (${(r.m / 1000).toFixed(3)} GeV, its decays, nothing inside); the Physics tab says how it is made and decays`, '1.27 (25) page: ' + JSON.stringify({ ins: r.ins.slice(0, 400), cat: r.cat }));
};
PARTS.page.page = true;

module.exports = async function f127h(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (1.27 (25) ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.27 (25) ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node'), parts = args.filter(a => a !== '--node');
  const needPage = !noPage && (!parts.length || parts.includes('page'));
  let browser = null, page = null, errors = [];
  if (needPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, parts);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.27 feature 25 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
