'use strict';
/* 1.39 (item 103, the owner, 2026-11-22: "add strange matter or dark matter or stuff like that based off of what's been
   found about it"; all four kinds chosen). found: X(3872), Tcc⁺, ⁶ΛΛHe and antihyperhydrogen-4 decay as listed, the
   books exact. wimp: recoils off nuclei at the coherent A² rate (xenon, not hydrogen), none in ultra-realistic. axion:
   turns into a photon in a magnetic field as sin²(gBL/2). slet: a strangelet swallows neutrons. mono: a monopole ionizes
   (68.5 β) and, in 3-D, a field along its axis speeds it up, the books kept. hypo: the others, and the labels.
   Run by t_features or alone: node tests/f_139.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
const big = (W) => { for (const k of ['w', 'tw']) W.box[k] = 120; for (const k of ['h', 'th']) W.box[k] = 70; if (W.d3) for (const k of ['d', 'td']) W.box[k] = 70; };
const BK = (X, W) => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc;
const QB = (X, W) => { let q = 0, b = 0; for (const o of W.exo) if (!o.dead) { q += o.q; b += X.XP[o.sp].B || 0; } for (const p of W.parts) if (!p.dead && p.k === X.NUC) { const s = p.anti ? -1 : 1; q += s * p.Z - (p.ne || 0) * 0; b += s * (p.Z + p.N); } else if (!p.dead) q += p.k === X.ELEC ? -1 : 1; return [q, b]; };
PARTS.found = async (page, check) => {
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 4 }), W = X.W; (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); big(W);
    W.decayOn = false; W.gamma = 0;
    const res = {}; let bk = 0, cons = true;
    for (const sp of ['X3872', 'Tcc', 'Tccb', 'LL6He', 'ahy1_2', 'Ap']) {
      const seen = new Set();
      for (let i = 0; i < 30; i++) {
        W.exo.length = 0; W.parts.length = 0;
        const o = X.addExo(sp, 0, 0, 2e8, 1, 0, X.XP[sp].m, 0, 0);
        const [q0, b0] = QB(X, W), e0 = BK(X, W);
        if (d3) X.decayExo3(o); else X.decayExo(o);
        const [q1, b1] = QB(X, W); bk = Math.max(bk, Math.abs(BK(X, W) - e0)); if (q1 !== q0 || b1 !== b0) cons = false;
        seen.add(/→ (.*)$/.exec(o.fate || '') ? /→ (.*)$/.exec(o.fate)[1] : o.fate);
      }
      res[sp] = seen.size;
    }
    check(Object.values(res).every(n => n >= 1) && res.X3872 >= 3 && res.Tcc >= 2 && cons && bk < 1e-3, `1.39 ${d3 ? '3-D' : 'flat'}: X(3872), Tcc⁺, T̄cc⁻, ⁶ΛΛHe, anti-⁴ΛH and the X17 decay as listed (${Object.entries(res).map(([k, n]) => `${k} ${n} kinds`).join(', ')}), charge and baryon number kept, books to ${bk.toExponential(1)} eV`,
      `1.39 ${d3 ? '3-D' : 'flat'} decays: ${JSON.stringify(res)} kept ${cons} books ${bk}`);
  }
};
PARTS.wimp = async (page, check) => {
  // single passes through one nucleus: the chance per pass, and the recoil's books (a keV xenon ion then crashing through
  // a gas is the engine's ordinary ion physics, measured elsewhere)
  const pass = (el, A, ultra, boost, n) => {
    const X = load('all', { seed: 2 }), W = X.W; X.PRESETS.empty.build(); big(W); W.decayOn = false; W.gamma = 0; W.ultra = ultra; if (boost) X.DKM.boost = boost;
    let hits = 0, bk = 0, Tmax = 0;
    for (let k = 0; k < n; k++) {
      X.PRESETS.empty.build(); W.decayOn = false; W.gamma = 0; W.ultra = ultra;
      const tg = X.addAtom(el, 0, 0, { A }); tg.vx = tg.vy = 0; X.step(1e-9);
      const o = X.addExo('wimp', 3, 0.2, 1e4, 1, 0), e0 = BK(X, W), c0 = W.count.wimp || 0;
      X.wimpStep(o, -3, 0.2, 0);
      if ((W.count.wimp || 0) > c0) { hits++; Tmax = Math.max(Tmax, 0.5 * tg.m * (tg.vx * tg.vx + tg.vy * tg.vy)); }
      bk = Math.max(bk, Math.abs(BK(X, W) - e0));
    }
    const mA = X.nucMeV(54, 77), mu = 4e4 * mA / (4e4 + mA);
    return { f: hits / n, bk, Tmax, Tkin: 4 * mu * mu / (4e4 * mA) * 1e4 };
  };
  const mn = 938.92, mun = 4e4 * mn / (4e4 + mn), mA = 122000, mu = 4e4 * mA / (4e4 + mA);
  const Pxe = 2.2e-48 * 1e16 * 131 * 131 * (mu / mun) ** 2 * 1e23 / (Math.PI * 1.4 * 1.4);
  const xe = pass('Xe', 131, false, 0, 4000), h = pass('H', 1, false, 0, 4000), u = pass('Xe', 131, true, 0, 4000), all = pass('Xe', 131, false, 1e40, 60);
  check(Math.abs(xe.f - Pxe) < 4 * Math.sqrt(Pxe / 4000) && h.f === 0 && u.f === 0 && all.f === 1 && all.bk < 1e-6 && all.Tmax <= all.Tkin * 1.0001 && all.Tmax > 0.5 * all.Tkin,
    `1.39 a WIMP at LZ's limit (shown ×10²³) strikes a xenon nucleus it passes ${(100 * xe.f).toFixed(2)}% of the time (σ_A/πR²: ${(100 * Pxe).toFixed(2)}%), hydrogen ${h.f} (the coherent A²(μ_A/μ_n)²: 10⁷ times rarer), none in ultra-realistic; recoils up to ${(all.Tmax / 1e3).toFixed(2)} keV (kinematic limit ${(all.Tkin / 1e3).toFixed(2)} keV for 10 keV), books to ${all.bk.toExponential(1)} eV`,
    `1.39 wimp: Xe ${xe.f} vs ${Pxe}, H ${h.f}, ultra ${u.f}, forced ${all.f} bk ${all.bk} T ${all.Tmax}/${all.Tkin}`);
};
PARTS.axion = async (page, check) => {
  const X = load('all', { seed: 6 }), W = X.W; X.PRESETS.empty.build(); big(W); W.decayOn = false; W.gamma = 0;
  const B = 40, L = 60; W.Bz = B; let conv = 0, bk = 0; const N = 300, xs = [];
  for (let k = 0; k < N; k++) {
    W.exo.length = 0; const o = X.addExo('axion', -L / 2, 0, 1e4, 1, 0); const e0 = BK(X, W);
    for (let s = 0; s < 400 && !o.dead && o.x < L / 2; s++) X.step(0.002);
    if (o.dead && /photon/.test(o.fate || '')) { conv++; xs.push(o.x); }
    bk = Math.max(bk, Math.abs(BK(X, W) - e0));
  }
  const a = X.DKM.gAg * X.DKM.axBoost * B * L * X.DKM.axK, P = Math.sin(a) ** 2, f = conv / N;
  check(Math.abs(f - P) < 4 * Math.sqrt(P * (1 - P) / N) + 0.02 && bk < 1e-3, `1.39 an axion across ${L} Å of ${B} T turns into a photon ${(100 * f).toFixed(0)}% of the time, sin²(gBL/2) = ${(100 * P).toFixed(0)}% (g shown 10¹⁷× CAST's limit); books to ${bk.toExponential(1)} eV`,
    `1.39 axion: ${f} vs ${P} books ${bk}`);
};
PARTS.slet = async (page, check) => {
  const X = load('all', { seed: 8 }), W = X.W; X.PRESETS.empty.build(); big(W); W.decayOn = false; W.gamma = 0;
  for (let x = -20; x <= 20; x += 4) { const n = X.addNuc(0, 1, 0, x, 0, 0, 0); n.vx = n.vy = 0; }
  const o0 = X.addExo('slet', -25, 0, 1e8, 1, 0); const e0 = BK(X, W);
  for (let s = 0; s < 4000 && W.exo.some(o => !o.dead && o.sp === 'slet' && o.x < 24); s++) X.step(0.002);
  const sl = W.exo.find(o => !o.dead && o.sp === 'slet'), nLeft = W.parts.filter(p => !p.dead && p.Z === 0 && p.N === 1).length, bk = Math.abs(BK(X, W) - e0);
  check(sl && sl.A >= 25 && sl.q === 2 && W.count.slet >= 5 && bk < 1e-3, `1.39 a strangelet (A = 20) flies through a row of 11 neutrons and swallows ${W.count.slet}: A = ${sl && sl.A}, charge kept +${sl && sl.q}, ${nLeft} left; books to ${bk.toExponential(1)} eV`,
    `1.39 slet: A ${sl && sl.A} q ${sl && sl.q} eaten ${W.count.slet} books ${bk} (${o0.fate})`);
};
PARTS.mono = async (page, check) => {
  const X = load('all', { seed: 9 }), W = X.W; X.PRESETS.empty.build(); big(W); W.decayOn = false; W.gamma = 0;
  for (let x = -20; x <= 20; x += 4) for (let y = -4; y <= 4; y += 4) { const p = X.addAtom('Si', x, y); p.vx = p.vy = 0; }
  const o = X.addExo('mono', -25, 0, 5e9, 1, 0), K0 = o.KE, e0 = BK(X, W);
  for (let s = 0; s < 400 && !o.dead && o.x < 24; s++) X.step(0.05);
  const lost = K0 - o.KE, bk = Math.abs(BK(X, W) - e0), ion = W.count.ionize;
  // 3-D: along the field
  const Y = load('all', { seed: 9 }), V = Y.W; Y.PRESETS.d3empty.build(); big(V); let gain = 0, bk3 = 0, want = 0;
  if (V.d3) { V.decayOn = false; V.gamma = 0; V.Bz = 100; V.Bax3 = 'z'; const m = Y.addExo('mono', 0, 0, 1e6, 0, 0, undefined, -20, 1); const k0 = m.KE, z0 = m.z, b0 = BK(Y, V);
    for (let s = 0; s < 200 && !m.dead && m.z < 20; s++) Y.step(0.05);
    gain = m.KE - k0; want = 2.054 * 100 * (m.z - z0); bk3 = Math.abs(BK(Y, V) - b0); }
  check(lost > 500 && ion >= 5 && bk < 0.05 && (!V.d3 || (Math.abs(gain / want - 1) < 0.02 && bk3 < 0.05)), `1.39 a 5 GeV monopole through 40 Å of silicon loses ${X.fmtE(lost)} and frees ${ion} electrons (as a charge of 68.5β); in 3-D a 100 T field along its path gives ${Y.fmtE(gain)} over ${(want / 205.4).toFixed(1)} Å (gcB: ${Y.fmtE(want)}); books to ${Math.max(bk, bk3).toExponential(1)} eV`,
    `1.39 mono: lost ${lost} ion ${ion} bk ${bk}; 3-D gain ${gain} want ${want} bk ${bk3}`);
};
PARTS.hypo = async (page, check) => {
  const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.empty.build(); big(W); W.decayOn = true; W.gamma = 0; W.warp = 1e9;
  for (let x = -20; x <= 20; x += 2.5) for (let y = -4; y <= 4; y += 2.5) { const p = X.addAtom('Pb', x, y); p.vx = p.vy = 0; p.fixed = true; }
  const s = X.addExo('Sx', -25, 0, 1e9, 1, 0);
  for (let k = 0; k < 400 && !s.dead && s.x < 24; k++) X.step(0.05);
  const grp = X.PCATS.find(g => g[0] === 'Hypothetical'), sps = grp ? grp[1].map(e => e.sp) : [];
  const names = sps.every(sp => /hypothetical/.test(X.XP_NAME[sp] || '')), kinds = sps.every(sp => X.madeKind({ t: 'x', sp }) === 'Hypothetical');
  const multi = ['X3872', 'Tcc'].every(sp => X.PCATS.find(g => g[0] === 'Multiquarks')[1].some(e => e.sp === sp));
  check(s.fate === 'left the chamber' && s.KE === 1e9 && sps.length === 7 && names && kinds && multi, `1.39 the sexaquark crosses 40 Å of lead untouched and leaves, stable; the Hypothetical menu holds 7, each named "hypothetical" and listed so in Made here; the tetraquarks are under Multiquarks`,
    `1.39 hypo: Sx dead ${s.dead} KE ${s.KE}, ${sps}, names ${names} kinds ${kinds} multi ${multi}`);
};
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms)), o = { cards: {} };
    loadPreset('empty'); setRunning(false);
    for (const sp of ['X3872', 'Tcc', 'LL6He', 'ahy1_2', 'wimp', 'axion', 'slet', 'mono', 'Sx', 'Ap']) {
      const x = fireSpec({ kind: 'exo', sp }, 0, 0, 1, 0, 1e6, false); if (!x) { o.cards[sp] = null; continue; }
      R.sel = null; R.selX = { kind: 'exo', o: x, t0: W.rt }; renderInspect(); await w(20);
      o.cards[sp] = $('tp-inspect').textContent; x.dead = true;
    }
    o.groups = PCATS.map(g => g[0]); o.bp = bpCats().map(c => [c[0], c[2].map(e => e.lab).join(' ')]);
    o.urls = ['wimp', 'axion', 'slet', 'mono', 'X3872', 'Ap'].map(sp => specWebURL({ kind: 'exo', sp }));
    return o;
  });
  const hyp = ['wimp', 'axion', 'slet', 'mono', 'Sx', 'Ap'].every(sp => r.cards[sp] && /hypothetical/.test(r.cards[sp]));
  const found = ['X3872', 'Tcc', 'LL6He', 'ahy1_2'].every(sp => r.cards[sp] && !/hypothetical/.test(r.cards[sp]));
  const rows = /LZ 2024/.test(r.cards.wimp) && /CAST 2024/.test(r.cards.axion) && /Baryon number A/.test(r.cards.slet) && /68\.5 e/.test(r.cards.mono) && /Both Λ bound by/.test(r.cards.LL6He);
  const bpH = r.bp.find(c => c[0] === 'Hypothetical'), urls = r.urls.every(u => /wikipedia\.org\/wiki\//.test(u || ''));
  check(hyp && found && rows && r.groups.includes('Hypothetical') && bpH && /strangelet/.test(bpH[1]) && urls, `1.39 page: each card says hypothetical or not as it is (WIMP, axion, strangelet, monopole, sexaquark, X17 / X(3872), Tcc⁺, ⁶ΛΛHe, anti-⁴ΛH), with its limit rows; a Hypothetical menu and picker group; i opens Wikipedia (${r.urls.map(u => decodeURIComponent(u.split('/wiki/')[1] || u)).join(', ')})`,
    `1.39 page: hyp ${hyp} found ${found} rows ${rows} groups ${r.groups} bp ${JSON.stringify(bpH)} urls ${r.urls} cards ${JSON.stringify(r.cards).slice(0, 600)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39 page errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
module.exports = async function f139(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.39 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
