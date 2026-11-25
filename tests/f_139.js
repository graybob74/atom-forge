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
  W.wall = 'open'; const s = X.addExo('Sx', -25, 0, 1e9, 1, 0); // (open walls: it leaves, 1.39.1)
  for (let k = 0; k < 400 && !s.dead && s.x < 24; k++) X.step(0.05);
  const grp = X.PCATS.find(g => g[0] === 'Hypothetical'), sps = grp ? grp[1].map(e => e.sp) : [];
  const names = sps.every(sp => /hypothetical/.test(X.XP_NAME[sp] || '')), kinds = sps.every(sp => X.madeKind({ t: 'x', sp }) === 'Hypothetical');
  const multi = ['X3872', 'Tcc'].every(sp => X.PCATS.find(g => g[0] === 'Multiquarks')[1].some(e => e.sp === sp));
  check(s.fate === 'left the chamber' && s.KE === 1e9 && sps.length === 17 && names && kinds && multi, `1.39 the sexaquark crosses 40 Å of lead untouched and leaves, stable; the Hypothetical menu holds 16 (7 in 1.39.0), each named "hypothetical" and listed so in Made here; the tetraquarks are under Multiquarks`,
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
PARTS.menu = async (page, check) => { // (1.39.1: long labels ran over the names)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(() => ['Hypothetical', 'Multiquarks', 'Exotic', 'Leptons'].map(cat => {
    const ci = PCATS.findIndex(g => g[0] === cat); pmenuOpen(ci, document.querySelector(`[data-ci="${ci}"]`) || document.body); const m = $('pmenu');
    const rows = [...m.querySelectorAll('.pm-i:not(.more)')].map(b => { const l = b.querySelector('b').getBoundingClientRect(), n = b.querySelector('span:last-child').getBoundingClientRect(); return [l.right <= n.left + 0.5, Math.round(n.left), Math.round(l.height)]; });
    pmenuClose(); return [cat, rows.every(x => x[0]), new Set(rows.map(x => x[1])).size, Math.max(...rows.map(x => x[2]))];
  }));
  check(r.every(x => x[1] && x[2] === 1 && x[3] < 24), `1.39.1 in the particle menus (${r.map(x => x[0]).join(', ')}) no label runs into its name or wraps, and the names line up`, `1.39.1 menu: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.1 menu errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.walls = async (page, check) => { // (1.39.1: the soft walls' quick test uses the largest drawn radius, not a tenth of the box)
  // the same pushes as the old test gives (every atom within a tenth of the box looked up), force for force and in
  // sum, flat and in 3-D, with small and big atoms and ions at and past every wall; and no nucleus is drawn larger than
  // the radius the test relies on, in any of the setups
  const res = [];
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 11 }), W = X.W, S = X.S; (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build();
    for (const k of ['w', 'tw']) W.box[k] = 80; for (const k of ['h', 'th']) W.box[k] = 50; if (d3) for (const k of ['d', 'td']) W.box[k] = 44;
    const hw = 40, hh = 25, hd = 22, syms = ['H', 'He', 'O', 'Ar', 'Cs', 'Xe', 'Na', 'Cl', 'Fr', 'U'];
    for (let i = 0; i < 400; i++) { // (a third well inside, the rest in a band from 3 Å inside the wall line to 1.5 Å past it)
      const edge = () => (Math.random() < 0.5 ? -1 : 1), band = (h) => edge() * (h - 3 + 4.5 * Math.random()), inside = (h) => (Math.random() - 0.5) * 1.6 * h, pick = (h) => (Math.random() < 0.6 ? band(h) : inside(h));
      const o = { T: 300 }; if (i % 7 === 0) o.charge = i % 14 === 0 ? 1 : -1; if (d3) o.z = pick(hd);
      X.addAtom(syms[i % syms.length], pick(hw), pick(hh), o);
    }
    X.forcesNoEvents(); // (the lists the walls walk)
    const mdI = X._mdI, nmd = X._nmd, n = S.hi, rdMax = Math.max(...W.parts.map((p) => p.rd));
    const old = () => { // (the test as it was before 1.39.1)
      const R0 = 0.1 * (d3 ? Math.min(W.box.w, W.box.h, W.box.d) : Math.min(W.box.w, W.box.h)); let fs = 0, slow = 0;
      for (let q = 0; q < nmd; q++) {
        const i = mdI[q], x = S.x[i], y = S.y[i], z = d3 ? S.z[i] : 0;
        if (x <= hw - R0 && x >= R0 - hw && y <= hh - R0 && y >= R0 - hh && (!d3 || (z <= hd - R0 && z >= R0 - hd))) continue;
        if (S.k[i] !== X.NUC) continue;
        slow++;
        const k = 30 * Math.min(1, S.m[i]), r = X.wallIn(S.obj[i]), w = hw - r, h = hh - r, dd = hd - r;
        if (!d3 && x <= w && x >= -w && y <= h && y >= -h) continue;
        if (x > w) { S.fx[i] -= k * (x - w); fs += k * (x - w); } else if (x < -w) { S.fx[i] += k * (-w - x); fs += k * (-w - x); }
        if (y > h) { S.fy[i] -= k * (y - h); fs += k * (y - h); } else if (y < -h) { S.fy[i] += k * (-h - y); fs += k * (-h - y); }
        if (d3) { if (z > dd) { S.fz[i] -= k * (z - dd); fs += k * (z - dd); } else if (z < -dd) { S.fz[i] += k * (-dd - z); fs += k * (-dd - z); } }
      }
      return { fs, slow };
    };
    const zero = () => { S.fx.fill(0, 0, n); S.fy.fill(0, 0, n); if (d3) S.fz.fill(0, 0, n); }, copy = () => [S.fx.slice(0, n), S.fy.slice(0, n), d3 ? S.fz.slice(0, n) : null];
    zero(); const o = old(), A = copy();
    zero(); if (d3) X.softWalls3(mdI, nmd, hw, hh, hd); else X.softWalls(mdI, nmd, hw, hh); const B = copy(), fsNew = X._wallFs;
    let same = true, pushed = 0; for (let i = 0; i < n; i++) { if (!Object.is(A[0][i], B[0][i]) || !Object.is(A[1][i], B[1][i]) || (d3 && !Object.is(A[2][i], B[2][i]))) same = false; if (B[0][i] !== 0 || B[1][i] !== 0 || (d3 && B[2][i] !== 0)) pushed++; }
    res.push({ d3, same, sum: Object.is(o.fs, fsNew), pushed, slow: o.slow, rdMax, bound: X._rdMax });
  }
  let over = ''; { const X = load('all', { seed: 5 }); for (const k of Object.keys(X.PRESETS)) { try { X.PRESETS[k].build(); } catch (e) { continue; } for (const p of X.W.parts) if (p.k === X.NUC && p.rd > X._rdMax) over += ` ${k}:${p.Z}`; } }
  check(res.every((r) => r.same && r.sum && r.pushed > 100 && r.bound >= r.rdMax && r.bound < 3) && !over,
    `1.39.1 soft walls: the quick test on the largest drawn radius (${res[0].bound.toFixed(2)} Å here) pushes the same ${res[0].pushed} flat and ${res[1].pushed} 3-D atoms with the same forces and sum as looking up all ${res[0].slow} and ${res[1].slow} near the walls; no nucleus in any setup is drawn larger`,
    `1.39.1 soft walls: ${JSON.stringify(res)} larger than the bound:${over || ' none'}`);
};
PARTS.seed = async (page, check) => { // (1.39.1: the benchmark's worlds are the same in every run)
  // rndUse puts the benchmark's seeded source under the engine's random numbers; with the bath's seed, the step size and
  // the clock's carry set as the benchmark sets them, the same world built three times on one engine (another world run
  // in between) steps to the same positions and velocities, to the bit: salt, liquid water, and water with 40 molecules
  // ionized. Without rndUse the engine keeps the source it had when it loaded.
  const { seeded } = require(path.join(__dirname, 'load.js'));
  const X = load('all', { seed: 3 }), S = X.S;
  const hash = () => { let h = 0x811c9dc5; for (const a of [S.x, S.y, S.vx, S.vy]) { const u = new Uint32Array(a.buffer, a.byteOffset, 2 * S.hi); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); } } return (h >>> 0).toString(16); };
  const world = (which, steps) => {
    const g = seeded(12), realR = Math.random; Math.random = g; const was = X.rndUse(g);
    if (which === 'ion') { X.PRESETS.water.build(); X.settleOverlaps(); const Os = X.W.parts.filter((p) => p.Z === 8); for (let i = 0; i < 40; i++) X.userIonize(Os[i]); } else { X.PRESETS[which].build(); X.settleOverlaps(); }
    const W = X.W; W.decayOn = false; W.bathSeed = 0x5eed1234; W.dt = 0; W.vmax = 0; W.amax = 0; W.tc = 0;
    for (let i = 0; i < steps; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const h = hash(); X.rndUse(was); Math.random = realR; return h;
  };
  const out = {};
  for (const which of ['salt', 'water', 'ion']) {
    const a = world(which, 60); X.PRESETS.argon.build(); for (let i = 0; i < 23; i++) { X.W.dt = X.chooseDt(); X.step(X.W.dt); }
    out[which] = [a, world(which, 60), world(which, 60)];
  }
  const u1 = X.rnd(), g2 = seeded(77), was = X.rndUse(g2), v = X.rnd(), w = seeded(77)(); X.rndUse(was); const u2 = X.rnd();
  check(Object.values(out).every((h) => h[0] === h[1] && h[1] === h[2]) && v === w && u1 !== u2,
    `1.39.1 the benchmark's seeding: salt, water and ionized water built three times on one engine step to the same state (${Object.values(out).map((h) => h[0]).join(', ')}); the engine draws from the source rndUse gives it and goes back to its own`,
    `1.39.1 seeding: ${JSON.stringify(out)} rnd ${v} ${w}`);
};
PARTS.layout = async (page, check) => { // (1.39.1: the big shared arrays no longer all start at the same place in a page)
  // every Float64 array of the store starts on a cache-line boundary and at its own offset within a 4 KB page (they all
  // sat at one offset, the same cache set for one atom's entries in every array), still after the store has grown to
  // 32,768 slots; the kernels are still in use (the memory did not fill) and a small array is not padded
  const X = load('all', { seed: 4 }), S = X.S, F = ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'gx', 'gy', 'ox', 'oy', 'm', 'im', 'q', 'qp', 'ljR', 'ljS'];
  const where = () => F.map((k) => S[k].byteOffset & 4095);
  const top0 = X.WK.top; X.shArray(Float64Array, 16); const small = X.WK.top - top0;
  X.storeGrow(32768);
  const w = where(), distinct = new Set(w).size, lined = w.every((v) => v % 64 === 0);
  X.PRESETS.water.build(); for (let i = 0; i < 20; i++) { X.W.dt = X.chooseDt(); X.step(X.W.dt); }
  check(X.WK.on && lined && distinct === F.length && small === 128 && S.size === 32768 && X.wasmReady(),
    `1.39.1 layout: the store's ${F.length} hottest arrays start at ${distinct} different places in a page, each on a cache line; a 16-number array takes its 128 bytes; the WebAssembly kernels run`,
    `1.39.1 layout: ${JSON.stringify({ w, distinct, lined, small, on: X.WK.on, size: S.size })}`);
};
PARTS.leppairs = async (page, check) => { // (1.39.1: the free leptons' pairs found through cells, not every pair)
  // flLepPairs must give the list the plain way gave, pair for pair in the same order: flat and 3-D; closed, open and
  // periodic walls; a few leptons (the plain way still) and many (cells), in a clump, spread out, all at one place and
  // over a box so wide the cells are capped; some of them fast (not in the list).
  const X = load('all', { seed: 5 }), S = X.S, out = [];
  let allOk = true, pairs = 0;
  for (const [d3, wall, n, bw, clump] of [[false, 'reflect', 40, 200, 30], [false, 'reflect', 900, 300, 20], [true, 'reflect', 900, 240, 24], [false, 'wrap', 500, 120, 30], [true, 'wrap', 300, 80, 20], [true, 'open', 700, 200, 0.001], [false, 'reflect', 800, 6000, 400], [true, 'reflect', 800, 5000, 30]]) {
    (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); const W = X.W;
    for (const k of ['w', 'tw']) W.box[k] = bw; for (const k of ['h', 'th']) W.box[k] = bw * 0.7; if (d3) for (const k of ['d', 'td']) W.box[k] = bw * 0.6;
    W.wall = wall; W.gamma = 0;
    const bh = W.box.h, bd = d3 ? W.box.d : 0;
    for (let i = 0; i < 20; i++) X.addAtom('Ar', (X.rnd() - 0.5) * bw * 0.8, (X.rnd() - 0.5) * bh * 0.8, d3 ? { T: 300, z: (X.rnd() - 0.5) * bd * 0.8 } : { T: 300 });
    const made = [];
    for (let i = 0; i < n; i++) { const mid = i % 2 === 0, sp = (v) => (X.rnd() - 0.5) * (mid ? clump : v * 0.9);
      made.push(d3 ? X.addLepton(i % 7 ? X.ELEC : X.POS, sp(bw), sp(bh), 0.01 * X.rnd(), 0.01 * X.rnd(), sp(bd), 0) : X.addLepton(i % 7 ? X.ELEC : X.POS, sp(bw), sp(bh), 0.01 * X.rnd(), 0.01 * X.rnd())); }
    X.forcesNoEvents();
    for (let i = 0; i < made.length; i += 13) if (made[i] && !made[i].dead) made[i].fast = true; // (turned fast since the lists were made: isLepMD leaves them out)
    X.flBuild();
    const FL = X.FL, got = []; for (let k = 0; k < FL.nl; k++) got.push(FL.li[k] * 65536 + FL.lj[k]);
    const idx = X._mdLI, nL = X._nmdL, want = [], md = (i) => S.dead[i] === 0 && S.fast[i] === 0 && S.rad[i] === 0, wrap = wall === 'wrap', hw = bw / 2, hh = bh / 2, hd = bd / 2, R2 = X.RLF2;
    for (let q = 0; q < nL; q++) { const L = idx[q]; if (!md(L)) continue;
      for (let q2 = q + 1; q2 < nL; q2++) { const M = idx[q2]; if (!md(M)) continue;
        let dx = S.x[M] - S.x[L], dy = S.y[M] - S.y[L], dz = d3 ? S.z[M] - S.z[L] : 0;
        if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
        if ((d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy) < R2) want.push(L * 65536 + M); } }
    const same = got.length === want.length && got.every((v, k) => v === want[k]);
    if (!same || !want.length) allOk = false; pairs += want.length;
    out.push(`${d3 ? '3-D' : 'flat'} ${wall} ${nL} leptons: ${want.length} pairs${same ? '' : ' DIFFERENT (' + got.length + ')'}`);
  }
  check(allOk, `1.39.1 the free leptons' pair list through cells is the plain way's list, pair for pair in its order: ${out.join('; ')}`, `1.39.1 lepton pairs: ${out.join('; ')}`);
};
PARTS.localphi = async (page, check) => { // (1.39.1: lepLocalPhi from the store's arrays)
  // the same number to the bit as the sum through the particles' getters and minImg, for every free electron against
  // some atom: flat and 3-D, closed and periodic, with antimatter, the dead and a nucleus in radiation flight among them
  const X = load('all', { seed: 6 }), out = []; let ok = true, n = 0, nonzero = 0;
  const old = (L, A) => { let u = 0; const W = X.W, d3 = W.d3;
    for (const p of W.parts) { if (p.dead || p === L || p === A || p.rad) continue;
      const q = p.k === X.NUC ? (p.anti ? -p.q : p.q) : p.q; if (!q) continue;
      const m = X.minImg(p.x - L.x, p.y - L.y, d3 ? p.z - L.z : 0), dx = m[0], dy = m[1], dz = d3 ? m[2] : 0, r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > 64) continue;
      u += X.PHYS.KE * L.q * q / Math.sqrt(r2 + (p.k === X.NUC ? p.sEN || 0 : 0.0016)); }
    return Math.min(0, u); };
  for (const [d3, wall] of [[false, 'reflect'], [true, 'reflect'], [false, 'wrap'], [true, 'wrap']]) {
    (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); const W = X.W;
    for (const k of ['w', 'tw']) W.box[k] = 40; for (const k of ['h', 'th']) W.box[k] = 30; if (d3) for (const k of ['d', 'td']) W.box[k] = 30;
    W.wall = wall; W.gamma = 0;
    const at = (v) => (X.rnd() - 0.5) * v, atoms = [];
    for (let i = 0; i < 60; i++) atoms.push(X.addAtom(['O', 'Na', 'Ar', 'C'][i % 4], at(36), at(26), d3 ? { T: 300, z: at(26) } : { T: 300 }));
    for (let i = 0; i < 30; i++) X.userIonize(atoms[i]);
    for (let i = 0; i < 80; i++) { if (d3) X.addLepton(i % 5 ? X.ELEC : X.POS, at(36), at(26), 0.01, 0, at(26), 0); else X.addLepton(i % 5 ? X.ELEC : X.POS, at(36), at(26), 0.01, 0); }
    atoms[31].anti = true; atoms[32].rad = true; atoms[33].dead = true;
    const leps = W.parts.filter((p) => !p.dead && p.k !== X.NUC);
    for (let i = 0; i < leps.length; i++) { const A = atoms[(i * 7) % 30], a = X.lepLocalPhi(leps[i], A), b = old(leps[i], A); n++; if (a !== 0) nonzero++; if (!Object.is(a, b)) ok = false; }
    out.push(`${d3 ? '3-D' : 'flat'} ${wall}`);
  }
  check(ok && nonzero > 40, `1.39.1 lepLocalPhi from the store is the old sum to the bit: ${n} leptons (${nonzero} in a well) in ${out.join(', ')}`, `1.39.1 lepLocalPhi differs from the old sum (${n} tried, ${nonzero} nonzero)`);
};
PARTS.segturned = async (page, check) => { // (1.39.1: segTargets3 after a flag change uses the grid, not every particle)
  // 3-D, 300 atoms. After the lists are made some nuclei turn fast and are carried far from their cells, one dies and
  // one is made: every particle used to be tested then. The grid (built again because a flag changed) with the side
  // lists must find what testing every particle finds, for segments through the box and through the moved nuclei's new
  // places. It fails if the grid stops being rebuilt on a flag change.
  const X = load('all', { seed: 7 }), S = X.S; X.PRESETS.d3empty.build(); const W = X.W;
  for (const k of ['w', 'tw']) W.box[k] = 90; for (const k of ['h', 'th']) W.box[k] = 80; for (const k of ['d', 'td']) W.box[k] = 80; W.gamma = 0;
  const at = (v) => (X.rnd() - 0.5) * v, atoms = [];
  for (let i = 0; i < 300; i++) atoms.push(X.addAtom(['O', 'Ar', 'C'][i % 3], at(80), at(70), { T: 300, z: at(70) }));
  X.forcesNoEvents();
  const g0 = X._flagGen === X._flagGenForces;
  const late = X.addAtom('Ne', 3, 3, { T: 300, z: 3 });
  X.gridEnsure(); // (the grid as it stands when the nuclei turn: they stay in their old cells)
  const moved = []; for (let i = 0; i < 300; i += 11) { const p = atoms[i]; p.fast = true; p.x = at(80); p.y = at(70); p.z = at(70); moved.push(p); }
  atoms[5].dead = true;
  const brute = (x0, y0, z0, x1, y1, z1, R) => { const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L2 = dx * dx + dy * dy + dz * dz, h = [];
    for (const p of W.parts) { if (p.dead || p.k !== X.NUC) continue; const px = p.x - x0, py = p.y - y0, pz = p.z - z0, t = (px * dx + py * dy + pz * dz) / L2; if (t < 0 || t >= 1) continue;
      const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz, b2 = ex * ex + ey * ey + ez * ez; if (b2 < R * R) h.push([t, p.id, Math.sqrt(b2)]); }
    return h.sort((a, b) => a[0] - b[0] || a[1] - b[1]); };
  let ok = true, hits = 0, onMoved = 0, n = 0;
  const tryIt = (x0, y0, z0, x1, y1, z1, R) => { const got = X.segTargets3(x0, y0, z0, x1, y1, z1, R, (t) => t.k === X.NUC).map((h) => [h[0], h[1].id, h[2]]), want = brute(x0, y0, z0, x1, y1, z1, R); n++; hits += want.length;
    if (got.length !== want.length || !got.every((h, k) => h[0] === want[k][0] && h[1] === want[k][1] && h[2] === want[k][2])) ok = false;
    return want; };
  for (let i = 0; i < 300; i++) tryIt(at(80), at(70), at(70), at(80), at(70), at(70), 1 + 2 * X.rnd());
  for (const p of moved.concat([late])) { const w = tryIt(p.x - 4, p.y - 0.2, p.z + 0.1, p.x + 4, p.y + 0.2, p.z - 0.1, 1.5); if (w.some((h) => h[1] === p.id)) onMoved++; }
  check(g0 && X._flagGen !== X._flagGenForces && ok && onMoved === moved.length + 1 && hits > 100,
    `1.39.1 segTargets3 after nuclei turned fast, one died and one was made: the grid and the side lists find what every particle tested finds (${n} segments, ${hits} hits, all ${onMoved} moved or new nuclei found at their new places)`,
    `1.39.1 segTargets3 after a flag change: same ${ok}, moved found ${onMoved} of ${moved.length + 1}, hits ${hits}, flags ${g0}`);
};
PARTS.benchids = async (page, check) => { // (1.39.1: a benchmark world's ids start at the same place in the 360 cycle)
  // the crowd built and stepped after two different pasts (the count of ids 1 and somewhere odd) is the same world to the
  // bit with benchIds, no id is given twice (the count only goes up), and it starts at 1 over a multiple of 360
  const { seeded } = require(path.join(__dirname, 'load.js'));
  const X = load('all', { seed: 8 }), S = X.S, starts = [], hs = [];
  const hash = () => { let h = 0x811c9dc5; const f = new Float64Array(1), u = new Uint32Array(f.buffer); for (const p of X.W.parts) { if (p.dead) continue; for (const v of [p.x, p.y, p.vx, p.vy]) { f[0] = v; h = Math.imul(h ^ u[0], 16777619); h = Math.imul(h ^ u[1], 16777619); } } return (h >>> 0).toString(16) + '/' + X.W.parts.length; };
  let up = true;
  for (const past of [0, 1, 2]) {
    if (past) { X.PRESETS.water.build(); for (let i = 0; i < 7 * past; i++) X.addAtom('Ar', i, 0, { T: 300 }); for (let i = 0; i < 9; i++) { X.W.dt = X.chooseDt(); X.step(X.W.dt); } }
    const before = X.W.nextId, g = seeded(12), realR = Math.random; Math.random = g; const was = X.rndUse(g);
    X.benchIds(); starts.push(X.W.nextId); if (X.W.nextId < before) up = false;
    X.benchDebris(false, 400); const W = X.W; W.decayOn = false; W.bathSeed = 0x5eed1234; W.dt = 0; W.vmax = 0; W.amax = 0; W.tc = 0;
    for (let i = 0; i < 25; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    hs.push(hash()); X.rndUse(was); Math.random = realR;
  }
  check(up && starts.every((s) => s % 360 === 1) && starts[1] > starts[0] && starts[2] > starts[1] && hs[0] === hs[1] && hs[1] === hs[2],
    `1.39.1 the benchmark's crowd is the same world after any past: ids from ${starts.join(', ')} (never one given twice), 25 steps to ${hs[0]} each time`,
    `1.39.1 benchmark ids: starts ${starts.join(', ')}, hashes ${hs.join(', ')}, count only up ${up}`);
};
PARTS.cliplines = async (page, check) => { // (1.39.1: dashed lines cut to the view before they are drawn)
  // clipLine: a line wholly in view comes back as it is; one wholly outside gives false; one through the view comes
  // back as a piece of the same line, inside the view and its 16 px margin (and up to one round of dashes before it),
  // starting a whole number of dash rounds from the true start; a million-pixel line comes back no longer than the
  // view's diagonal and a little. Then the 3-D view itself: 60 dashed rays through a box seen from inside it, and the
  // dashed lines handed to the canvas in one frame add up to less than 40 screens' width, not millions of pixels.
  const X = load('all', { seed: 9 }), R = X.R; R.w = 1600; R.h = 900;
  const C = X._cl; let ok = true, n = 0, kept = 0, out = 0, longest = 0; const why = [];
  const bad = (m) => { ok = false; if (why.length < 3) why.push(m); };
  if (!X.clipLine(10, 10, 500, 400, 10) || C[0] !== 10 || C[1] !== 10 || C[2] !== 500 || C[3] !== 400) bad('a line in view changed');
  if (X.clipLine(-500, -50, 3000, -40, 10) || X.clipLine(5000, 0, 6000, 900, 0) || X.clipLine(NaN, 0, 5, 5, 0) || X.clipLine(0, 0, Infinity, 5, 6)) bad('a line out of view, or not a number, was kept');
  for (let i = 0; i < 4000; i++) {
    const big = i % 2 ? 2e6 : 5000, x0 = (X.rnd() - 0.5) * big, y0 = (X.rnd() - 0.5) * big, x1 = (X.rnd() - 0.5) * big, y1 = (X.rnd() - 0.5) * big, per = [0, 6, 10, 11][i % 4];
    n++;
    if (!X.clipLine(x0, y0, x1, y1, per)) { out++; continue; }
    kept++;
    const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len, a = (C[0] - x0) * ux + (C[1] - y0) * uy, b = (C[2] - x0) * ux + (C[3] - y0) * uy, tol = 1e-6 * (1 + len);
    const off = (px, py) => Math.abs((px - x0) * uy - (py - y0) * ux); // distance from the true line
    if (off(C[0], C[1]) > tol || off(C[2], C[3]) > tol) bad('off the line');
    if (a < -tol || b > len + tol || a > b + tol) bad('outside the true ends');
    const m = 16 + (per || 0) + 1e-3 * (1 + len / 1e4);
    for (const [px, py] of [[C[0], C[1]], [C[2], C[3]]]) if (px < -m || px > R.w + m || py < -m || py > R.h + m) bad(`outside the view: ${px.toFixed(1)}, ${py.toFixed(1)}`);
    if (per && a > tol) { const k = a / per; if (Math.abs(k - Math.round(k)) > 1e-4 * (1 + len / 1e4)) bad(`dash phase: ${a} of ${per}`); }
    longest = Math.max(longest, b - a);
  }
  // the 3-D view: what one frame hands to the canvas with a dash set
  X.PRESETS.d3empty.build(); const W = X.W; for (const k of ['w', 'tw']) W.box[k] = 360; for (const k of ['h', 'th', 'd', 'td']) W.box[k] = 240; W.wall = 'open';
  for (let i = 0; i < 60; i++) { const th = X.rnd() * 6.283, ph = (X.rnd() - 0.5) * 2; W.rays.push({ x0: (X.rnd() - 0.5) * 20, y0: (X.rnd() - 0.5) * 20, z0: (X.rnd() - 0.5) * 20, x1: 170 * Math.cos(th), y1: 110 * Math.sin(th), z1: 110 * ph, c: [255, 255, 255], E: 511000, nu: true, landed: true }); } // (neutrinos' rays: dashed, and no glow sprite, which needs a real canvas)
  X.cam3Fit(); const d0 = R.cam3.dist; R.cam3.dist = d0 * 0.06; X.cam3Update();
  let dashed = 0, dashOn = false, lx = 0, ly = 0, lines = 0;
  const ctx = new Proxy({}, { get: (t, k) => k === 'setLineDash' ? (d) => { dashOn = d.length > 0; } : k === 'moveTo' ? (x, y) => { lx = x; ly = y; } : k === 'lineTo' ? (x, y) => { if (dashOn) { dashed += Math.hypot(x - lx, y - ly); lines++; } lx = x; ly = y; } : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  let drew = true; try { X.drawBox3(ctx, false); X.drawBox3(ctx, true); X.drawLight3(ctx, 0); } catch (e) { drew = false; why.push('drawing threw: ' + e.message); }
  check(ok && drew && kept > 300 && out > 300 && longest < Math.hypot(R.w, R.h) + 60 && lines >= 40 && dashed < 40 * R.w,
    `1.39.1 dashed lines are cut to the view: ${kept} of ${n} random lines kept, on their line, in the view, in step with their dashes, none longer than ${longest.toFixed(0)} px; 60 dashed rays and the box's edges from inside an open 3-D box: ${lines} dashed lines, ${Math.round(dashed).toLocaleString('en-US')} px in all`,
    `1.39.1 clipLine: ${why.join('; ') || 'counts'} (kept ${kept}, out ${out}, longest ${longest.toFixed(0)}, 3-D dashed lines ${lines}, ${Math.round(dashed)} px, drew ${drew})`);
};
PARTS.tile = async (page, check) => { // (1.39.1: "monopole" ran far out of the card's symbol tile)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => {
    loadPreset('empty'); setRunning(false); showTab('inspect'); const out = [];
    for (const sp of ['mono', 'slet', 'LL6He', 'Ap', 'Tcc', 'Sxb', 'X3872', 'Pcs4338', 'wimp']) {
      const x = fireSpec({ kind: 'exo', sp }, 0, 0, 1, 0, 1e6, false); R.sel = null; R.selX = { kind: 'exo', o: x, t0: W.rt }; renderInspect();
      await new Promise(res => setTimeout(res, 30));
      const t = document.querySelector('#tp-inspect .tilebox'), sEl = t && t.querySelector('.s');
      out.push([sp, sEl ? sEl.scrollWidth <= t.clientWidth : false, sEl ? parseFloat(getComputedStyle(sEl).fontSize) : 0]); x.dead = true;
    }
    return out;
  });
  check(r.every(x => x[1] && x[2] >= 9) && r.find(x => x[0] === 'wimp')[2] === 30, `1.39.1 every card's symbol fits its tile (${r.map(x => `${x[0]} ${x[2]} px`).join(', ')}); short ones keep 30 px`, `1.39.1 tile: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.1 tile errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.kept = async (page, check) => { // (1.39.1 item 105: kept in the box unless its walls are open)
  const res = {};
  for (const d3 of [false, true]) for (const wall of ['reflect', 'wrap', 'open']) {
    const X = load('all', { seed: 3 }), W = X.W; (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); W.decayOn = false; W.gamma = 0; W.wall = wall;
    const os = ['axion', 'wimp', 'slet', 'mono', 'Sx'].map(sp => X.addExo(sp, 0, 0, 1e6, 0.6, 0.8, undefined, 0, 0));
    let inside = true, maxDt = 0; const t0 = W.t, r0 = Date.now();
    for (let f = 0; f < 120; f++) { X.simFrame(1 / 60, 50); maxDt = Math.max(maxDt, W.dt);
      for (const o of os) if (!o.dead && (Math.abs(o.x) > W.box.w / 2 + 1e-6 || Math.abs(o.y) > W.box.h / 2 + 1e-6 || (d3 && Math.abs(o.z) > W.box.d / 2 + 1e-6))) inside = false; }
    res[(d3 ? '3-D ' : '') + wall] = { alive: os.filter(o => !o.dead).length, inside, tu: +(W.t - t0).toFixed(1), ms: Date.now() - r0 };
  }
  const closed = Object.entries(res).filter(([k]) => !/open/.test(k)), open = Object.entries(res).filter(([k]) => /open/.test(k));
  check(closed.every(([, r]) => r.alive === 5 && r.inside && r.tu > 170) && open.every(([, r]) => r.alive === 0), `1.39.1 an axion, a WIMP, a strangelet, a monopole and a sexaquark stay in a reflecting or wrapping box, flat and 3-D, for 2 s, and the world runs at full speed (${closed.map(([k, r]) => `${k} ${r.tu} tu, ${r.ms} ms`).join('; ')}); with open walls all leave`,
    `1.39.1 kept: ${JSON.stringify(res)}`);
  // the axion's conversion along its zigzag: the same sin²(gBL/2), L its whole path
  const X = load('all', { seed: 6 }), W = X.W; X.PRESETS.empty.build(); W.decayOn = false; W.gamma = 0; W.Bz = 0.5; W.wall = 'reflect';
  let conv = 0, Ls = []; const N = 200;
  for (let k = 0; k < N; k++) { W.exo.length = 0; const o = X.addExo('axion', 0, 0, 1e4, 0.6, 0.8); for (let s = 0; s < 20 && !o.dead; s++) X.step(0.01); if (o.dead) conv++; }
  const L = 20 * 0.01 * X.PHYS.C, a = X.DKM.gAg * X.DKM.axBoost * 0.5 * L * X.DKM.axK, P = Math.sin(a) ** 2;
  check(Math.abs(conv / N - P) < 4 * Math.sqrt(P * (1 - P) / N) + 0.02, `1.39.1 an axion bouncing in a 0.5 T box for ${L.toFixed(0)} Å of path turns into a photon ${(100 * conv / N).toFixed(0)}% of the time (sin²(gBL/2): ${(100 * P).toFixed(0)}%)`, `1.39.1 kept axion: ${conv / N} vs ${P}`);
};
PARTS.inside = async (page, check) => { // (1.39.1 item 104: a particle view and an Inside close-up for the new particles)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => {
    loadPreset('empty'); setRunning(false); showTab('inspect'); if (R.view.bohr !== 'nuc') toggleParticleView(); R.s = 200;
    const out = {}, cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    for (const sp of ['slet', 'Sx', 'X3872', 'Tcc', 'Pc4312', 'dstar', 'LL6He', 'ahy1_2', 'mono', 'wimp', 'axion', 'Ap']) {
      W.exo.length = 0; const o = fireSpec({ kind: 'exo', sp }, 0, 0, 1, 0, 1e-3, false); o.KE = 0; o.v = 0; o.stop = true;
      R.sel = null; R.selX = { kind: 'exo', o, t0: W.rt }; renderInspect(); await new Promise(res => setTimeout(res, 30));
      const h = [...document.querySelectorAll('#tp-inspect section')].find(e => /^Inside/.test((e.querySelector('h3') || {}).textContent || ''));
      out[sp] = { view: exoInside(ctx, o, 50, 50, XP[sp].col, '#ffffff'), head: h ? h.querySelector('h3').textContent : '', note: h ? h.textContent : '', n: QV.qs ? QV.qs.length : 0,
        cols: QV.qs ? [0, 1, 2].map(c => QV.qs.filter(q => !q.anti && q.col === c).length - QV.qs.filter(q => q.anti && q.col === c).length) : [] };
      if (h) out[sp].n = QV.qs.length;
    }
    return out;
  });
  const lep = Object.entries(r).filter(([, v]) => /lepton/.test(v.note)).map(([k]) => k), noView = Object.entries(r).filter(([, v]) => !(v.view > 0)).map(([k]) => k);
  const quark = ['slet', 'Sx', 'X3872', 'Tcc', 'Pc4312', 'dstar'].every(k => /quarks and gluons/.test(r[k].head) && !/a quark and an antiquark/.test(r[k].note));
  const neutral = ['Sx', 'X3872', 'Tcc', 'Pc4312', 'dstar'].every(k => r[k].cols.every((c, i, a) => c === a[0])); // (colourless: as many of each colour, net of anticolours)
  const sl = r.slet.n === 60 && /22 up, 19 down, 19 strange/.test(r.slet.note), fund = ['mono', 'wimp', 'axion', 'Ap'].every(k => /Hypothetical/.test(r[k].note)) && /’t Hooft/.test(r.mono.note);
  const hyN = !r.LL6He.head && !r.ahy1_2.head;
  check(!lep.length && !noView.length && quark && neutral && sl && fund && hyN, `1.39.1 the particle view draws every new particle (a strangelet's 60 quarks, the compact sexaquark, the tetraquarks as two mesons, ⁶ΛΛHe's two Λ, the antihypernucleus, the monopole's field lines); Inside shows the strangelet's 22 u, 19 d, 19 s, multiquarks as tetra-/penta-/hexaquarks, colourless (no longer "a quark and an antiquark"), and notes for the WIMP, axion, dark photon and monopole (none called a lepton)`,
    `1.39.1 inside: lepton ${lep} noView ${noView} quark ${quark} neutral ${neutral} slet ${sl} fund ${fund} hyN ${hyN} ${JSON.stringify(r).slice(0, 900)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.1 inside errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.wrapskip = async (page, check) => { // (1.39.1: slow atoms inside a periodic box skip the walls pass, as in a closed box)
  // The same periodic worlds stepped on two engines, this one and one with the skip taken back out (every atom through
  // walls() and updateFast() each step, as to 1.39.0), must be the same to the bit: flat and 3-D, hot enough that atoms
  // leave by one side and come in at the other, with a fast atom and free electrons among them.
  const A = load('all', { seed: 11 }), B = load('all', { seed: 11, patch: (src) => src.replace("else if (k === NUC) { // an atom inside the box, going at an atom's pace", "else if (k === NUC && !wrap) { // an atom inside the box, going at an atom's pace") });
  const out = []; let ok = true;
  for (const d3 of [false, true]) {
    const res = [];
    for (const X of [A, B]) {
      (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); const W = X.W;
      for (const k of ['w', 'tw']) W.box[k] = 44; for (const k of ['h', 'th']) W.box[k] = 36; if (d3) for (const k of ['d', 'td']) W.box[k] = 36;
      W.wall = 'wrap'; W.T = 2500; W.gamma = 0.05; W.bathSeed = 0x5eed1234; W.decayOn = false;
      const at = (v) => (X.rnd() - 0.5) * v, atoms = [];
      for (let i = 0; i < 150; i++) atoms.push(X.addAtom(['Ar', 'Ne', 'He', 'O'][i % 4], at(42), at(34), d3 ? { T: 2500, z: at(34) } : { T: 2500 }));
      atoms[0].vx = 30; X.updateFast(atoms[0]); // (a fast atom)
      for (let i = 0; i < 6; i++) X.userIonize(atoms[10 + i]);
      let crossed = 0; const lastX = new Map();
      for (let s = 0; s < 400; s++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt);
        for (const p of W.parts) { if (p.dead || p.k !== X.NUC) continue; const x0 = lastX.get(p.id); if (x0 !== undefined && Math.abs(p.x - x0) > 20) crossed++; lastX.set(p.id, p.x); } }
      let h = 0x811c9dc5, outside = 0; const f = new Float64Array(1), u = new Uint32Array(f.buffer);
      for (const p of W.parts) { if (p.dead) continue; for (const v of [p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0]) { f[0] = v; h = Math.imul(h ^ u[0], 16777619); h = Math.imul(h ^ u[1], 16777619); } if (p.k === X.NUC && !p.fast && (Math.abs(p.x) > 22.5 || Math.abs(p.y) > 18.5)) outside++; }
      res.push({ h: (h >>> 0).toString(16), n: W.parts.length, t: W.t, crossed, outside });
    }
    if (res[0].h !== res[1].h || res[0].n !== res[1].n || res[0].t !== res[1].t || res[0].crossed < 5 || res[0].outside) ok = false;
    out.push(`${d3 ? '3-D' : 'flat'}: ${res[0].h} and ${res[1].h}, ${res[0].n} particles, ${res[0].crossed} crossings`);
  }
  check(ok, `1.39.1 atoms inside a periodic box skip the walls pass and nothing changes: 400 steps with and without the skip, ${out.join('; ')}`, `1.39.1 periodic box, walls pass skipped for atoms inside: ${out.join('; ')}`);
};
PARTS.pick = async (page, check) => { // (1.39.1 item 109: a J/ψ over two nuclei could not be clicked)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const res = [];
  for (const d3 of [false, true]) {
    const at = await page.evaluate(async (d3) => {
      loadPreset(d3 ? 'd3empty' : 'empty'); setRunning(false); setTool('inspect'); if (R.view.bohr !== 'nuc') toggleParticleView();
      const a = addNuc(82, 126, 0, -0.3, 0, 0, 0), b = addNuc(82, 126, 0, 0.35, 0.1, 0, 0); a.vx = a.vy = b.vx = b.vy = 0;
      const j = addExo('Jpsi', 0.05, 0.05, 0, 1, 0, XP.Jpsi.m, 0, 0); j.KE = 0; j.v = 0; j.stop = true; j.wait = true; W.decayOn = false;
      if (!d3) { R.s = 120; R.cx = 0; R.cy = 0; } else { R.cam3.dist = 6; }
      await new Promise(r => setTimeout(r, 200));
      let sx, sy; if (d3) { cam3Update(); const P = [0, 0, 0]; proj3(j.x, j.y, j.z, P); sx = P[0]; sy = P[1]; } else { sx = w2sx(j.x); sy = w2sy(j.y); }
      const r = R.cv.getBoundingClientRect(), k = r.width / R.w; window._pk = { a, b, j };
      return { x: r.left + sx * k, y: r.top + sy * k };
    }, d3);
    const seq = [];
    for (let i = 0; i < 4; i++) { await page.mouse.click(at.x, at.y); await new Promise(r => setTimeout(r, 120));
      seq.push(await page.evaluate(() => { const { a, b, j } = window._pk; return R.selX && R.selX.o === j ? 'J/ψ' : R.sel === a ? 'Pb a' : R.sel === b ? 'Pb b' : R.sel ? 'other' : 'none'; })); }
    const note = await page.evaluate(() => $('tip').hidden ? '' : $('tip').textContent);
    res.push([d3 ? '3-D' : 'flat', seq, note]);
  }
  const ok = res.every(([, s]) => s[0] === 'J/ψ' && s.includes('Pb a') && s.includes('Pb b') && s[3] === 'J/ψ');
  check(ok && res.every(r => /of 3 here/.test(r[2])), `1.39.1 a J/ψ drawn over two lead nuclei is picked first, and clicking again goes through what is under it and round (${res.map(r => `${r[0]}: ${r[1].join(' → ')}`).join('; ')}), saying "${res[0][2]}"`,
    `1.39.1 pick: ${JSON.stringify(res)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.1 pick errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.bar = async (page, check) => { // (1.39.1 item 107: six menus on the bar, the old thirteen in them)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => {
    loadPreset('empty'); const cats = [...document.querySelectorAll('#palette .cat:not(.find)')], names = cats.map(b => b.textContent.replace(' ▾', ''));
    const seen = new Set(), heads = {};
    for (const b of cats) { b.click(); const m = $('pmenu');
      const grab = () => { for (const it of m.querySelectorAll('.pm-i[data-k]')) seen.add(it.textContent.trim()); };
      const subs = [...m.querySelectorAll('[data-sub]')];
      heads[b.textContent.replace(' ▾', '')] = [...m.querySelectorAll('.pm-h')].map(h => h.textContent).join('/') + (subs.length ? ` [${subs.length} lists]` : '');
      if (subs.length) for (let i = 0; i < subs.length; i++) { m.querySelectorAll('[data-sub]')[i].click(); grab(); const back = m.querySelector('[data-back]'); if (!back) return { err: 'no back' }; back.click(); }
      else grab();
      pmenuClose(); }
    const all = new Set(); for (const [, l] of pcats()) for (const sp of l) if (sp !== 'pt') all.add(1);
    const want = pcats().reduce((a, [, l]) => a + l.filter(x => x !== 'pt').length, 0);
    let got = 0; for (const [, l] of pcats()) for (const sp of l) if (sp !== 'pt') got++;
    // every particle of the old menus is in a new one: by its label and name
    const miss = []; for (const [n, l] of pcats()) for (const sp of l) if (sp !== 'pt' && ![...seen].some(t => t.includes(specLabel(sp)) && t.includes(specName(sp)))) miss.push(n + ':' + specLabel(sp));
    return { names, heads, miss };
  });
  check(!r.err && r.names.join('|') === 'Leptons|Hadrons|Nuclei|Bosons|Light|Antimatter & hypothetical' && !r.miss.length && /\[5 lists\]/.test(r.heads.Hadrons),
    `1.39.1 the bar holds six menus (${r.names.join(', ')}) instead of thirteen; every particle of the old menus is in one (Hadrons and Nuclei open a list of their groups, each with a way back; the others show their groups headed: ${Object.entries(r.heads).map(([k, v]) => `${k}: ${v}`).join('; ')})`,
    `1.39.1 bar: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.1 bar errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.mass = async (page, check) => { // (1.39.1 item 106: masses in u, MeV/c², or as fits)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => { loadPreset('empty'); setRunning(false); showTab('inspect'); const out = {};
    const a = addAtom('C', 0, 0), o = addExo('Jpsi', 3, 0, 0, 1, 0); o.wait = true;
    for (const v of ['auto', 'u', 'MeV']) { document.querySelector(`#segMUnit [data-v="${v}"]`).click();
      R.selX = null; R.sel = a; renderInspect(); const t1 = ($('tp-inspect').textContent.match(/Mass\s*([\d.,]+ (?:u|[MGT]eV\/c²))/) || [])[1];
      R.sel = null; R.selX = { kind: 'exo', o, t0: W.rt }; renderInspect(); const t2 = ($('tp-inspect').textContent.match(/Rest mass\s*([\d.,]+ (?:u|[MGT]eV\/c²))/) || [])[1];
      out[v] = [String(t1).trim(), String(t2).trim()]; }
    document.querySelector('#segMUnit [data-v="auto"]').click(); return out; });
  const ok = /^12 u/.test(r.auto[0]) && /3,097 MeV\/c²/.test(r.auto[1]) && /^12 u/.test(r.u[0]) && /3\.32\d* u/.test(r.u[1]) && /11\.17\d* GeV\/c²/.test(r.MeV[0]) && /3,097 MeV\/c²/.test(r.MeV[1]);
  check(ok, `1.39.1 Settings → masses in: as fits (carbon ${r.auto[0]}, J/ψ ${r.auto[1]}), u (${r.u[0]}, ${r.u[1]}), MeV/c² (${r.MeV[0]}, ${r.MeV[1]})`, `1.39.1 mass: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.1 mass errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.more = async (page, check) => { // (1.39.1 item 108: more hypothetical particles)
  const res = {}; let bk = 0, chg = true;
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W, BKx = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc;
    for (const sp of ['nuS', 'HNL', 'G2370', 'Rg', 'Rgb', 'Zp', 'BH']) {
      let n = 0, fate = '';
      for (let i = 0; i < 4; i++) {
        (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); W.decayOn = false; W.gamma = 0;
        const o = X.addExo(sp, 0, 0, 1e6, 1, 0, X.XP[sp].res ? X.XP[sp].m : undefined, 0, 0), e0 = BKx();
        const Q = () => { let q = 0; for (const e of W.exo) if (!e.dead) q += e.q; for (const p of W.parts) if (!p.dead) q += p.k === X.NUC ? (p.anti ? -1 : 1) * p.Z - (p.ne || 0) : p.k === X.ELEC ? -1 : 1; return q; };
        const q0 = Q(); if (d3) X.decayExo3(o); else X.decayExo(o);
        if (Math.abs(Q() - q0) > 1e-9) chg = false; bk = Math.max(bk, Math.abs(BKx() - e0) / (X.XP[sp].m * 1e6)); n += W.exo.filter(e => !e.dead).length; fate = o.fate || '';
      }
      if (!d3) res[sp] = [Math.round(n / 4), fate.replace('decayed: ', '').slice(0, 50)];
    }
  }
  // the neutralino recoils as a WIMP; a millicharged particle barely ionizes (10⁻⁶ of a proton's loss at the same speed)
  const X = load('all', { seed: 2 }), W = X.W; let hit = 0;
  for (let k = 0; k < 40; k++) { X.PRESETS.empty.build(); W.decayOn = false; W.gamma = 0; X.DKM.boost = 1e40; const t = X.addAtom('Xe', 0, 0, { A: 131 }); t.vx = t.vy = 0; X.step(1e-9);
    const o = X.addExo('neut', 3, 0.2, 1e4, 1, 0), c0 = W.count.wimp || 0; X.wimpStep(o, -3, 0.2, 0); if ((W.count.wimp || 0) > c0) hit++; }
  const loss = (sp) => { const Y = load('all', { seed: 3 }), V = Y.W; Y.PRESETS.empty.build(); V.decayOn = false; V.gamma = 0;
    for (let x = -16; x <= 16; x += 4) for (let y = -2; y <= 2; y += 2) { const p = Y.addAtom('Si', x, y); p.vx = p.vy = 0; }
    V.wall = 'open'; Y.forcesNoEvents(); V.fSpawn = V.spawned; Y.step(1e-9); const o = Y.addExo(sp, -19, 0, 2e5, 1, 0), K0 = o.KE; for (let s = 0; s < 400 && !o.dead && o.x < 18; s++) Y.step(0.002); return K0 - o.KE; };
  const lm = loss('mCP'), lp = loss('pi+');
  const Y = load('all', { seed: 1 }), grp = Y.PCATS.find(g => g[0] === 'Hypothetical')[1].map(e => e.sp), kinds = ['Zp', 'BH', 'nuS'].every(sp => Y.madeKind({ t: 'x', sp }) === 'Hypothetical');
  check(chg && bk < 1e-12 && hit === 40 && lp > 0 && lm <= lp * 1e-4 && grp.length === 17 && kinds,
    `1.39.1 more hypothetical particles, each decaying with charge kept and the books exact (to ${bk.toExponential(0)} of its mass), flat and 3-D: ${Object.entries(res).map(([k, v]) => `${k} → ${v[1]}${v[0] > 3 ? ` (${v[0]} made)` : ''}`).join('; ')}; the neutralino recoils off xenon as a WIMP; a millicharged particle loses ${lm < 1e-3 ? "nothing measurable" : X.fmtE(lm)} where a pion loses ${X.fmtE(lp)}; Hypothetical holds 16, listed so in Made here (the Z′ too)`,
    `1.39.1 more: charge ${chg} books ${bk} hit ${hit} loss ${lm}/${lp} grp ${grp.length} kinds ${kinds} ${JSON.stringify(res)}`);
};
PARTS.anim = async (page, check) => { // (1.39.2: the new navigation animated)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => {
    loadPreset('empty'); const m = $('pmenu'), w = (ms) => new Promise(res => setTimeout(res, ms)), out = [];
    const had = [...document.querySelectorAll('#palette .cat')].find(b => /Hadrons/.test(b.textContent));
    const step = (what) => { const first = m.firstElementChild; out.push([what, [...m.classList].filter(c => c.startsWith('pm-')).join(), getComputedStyle(m).animationName, first ? getComputedStyle(first).animationName : '', getComputedStyle(had.querySelector('.chev')).transform !== 'none']); };
    had.click(); await w(40); step('open');
    m.querySelector('[data-sub]').click(); await w(40); step('group');
    m.querySelector('[data-back]').click(); await w(40); step('back');
    await w(300); const settled = getComputedStyle(m).opacity;
    pmenuClose(); await w(250); const chevClosed = getComputedStyle(had.querySelector('.chev')).transform;
    return { out, settled, chevClosed };
  });
  const [o, g, b] = r.out;
  const ok = o[2] === 'moPop' && o[4] && g[3] === 'pmFwd' && b[3] === 'pmBack' && r.settled === '1' && (r.chevClosed === 'none' || /matrix\(1, 0, 0, 1/.test(r.chevClosed));
  check(ok, `1.39.2 the particle menus move: Hadrons drops in (${o[2]}), its ▾ turns over while open and back when closed, a group slides in from the right (${g[3]}), ‹ back slides the groups in from the left (${b[3]}), all settled after 0.3 s`, `1.39.2 anim: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.2 anim errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.cards = async (page, check) => { // (1.39.2: "some of these panels on certain particles look very messy")
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 1400 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => { loadPreset('empty'); setRunning(false); showTab('inspect'); const out = {};
    for (const sp of ['Zp', 'slet', 'Jpsi', 'W+', 'Rg', 'BH', 'wimp', 'Pc4312']) {
      W.exo.length = 0; const o = fireSpec({ kind: 'exo', sp }, 0, 0, 1, 0, 1e6, false); o.wait = true; R.sel = null; R.selX = { kind: 'exo', o, t0: W.rt }; renderInspect(); await new Promise(res => setTimeout(res, 40));
      const box = $('tp-inspect'), dds = [...box.querySelectorAll('.kv dd')];
      out[sp] = { tall: dds.filter(d => d.getBoundingClientRect().height > 40 && !d.classList.contains('w')).map(d => d.textContent.slice(0, 30)),
        odd: /∞|— km|electron masses\)|drawn from its width|Put it back/.test(box.textContent), items: box.querySelectorAll('.kvl li').length, note: (box.textContent.match(/A charmonium[^.]*/) || [''])[0] };
    }
    return out; });
  const tall = Object.entries(r).filter(([, v]) => v.tall.length).map(([k, v]) => k + ': ' + v.tall.join('|')), odd = Object.entries(r).filter(([, v]) => v.odd).map(([k]) => k);
  check(!tall.length && !odd.length && r.Zp.items === 9 && r.Jpsi.items === 9 && r.slet.items === 0 && /charmonium/.test(r.Jpsi.note),
    `1.39.2 the cards are tidy: no short-row value wraps (Z′, strangelet, J/ψ, W⁺, R-hadron, black hole, WIMP, Pc⁺), decays one a line with their shares (Z′ 9, J/ψ 9), a stable particle says "stable" (no ∞ or "— km"), a resonance's table mass and width get their own rows; the J/ψ's close-up says "${r.Jpsi.note}"`,
    `1.39.2 cards: tall ${tall} odd ${odd} ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.2 cards errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.anti = async (page, check) => { // (1.39.2: "anti-elements get drawn WAY bigger than they should be")
  const X = load('all', { seed: 1 }); X.PRESETS.empty.build(); const out = [];
  for (const [el, k] of [['Cu', 15], ['Fe', 3], ['O', 2], ['Yb', 10]]) {
    const a = X.addAtom(el, 0, 0, { anti: true }), b = X.addAtom(el, 9, 0); a.ne = a.Z - k; a.q = -k; X.setSize(a); b.ne = b.Z - k; b.q = k; X.setSize(b);
    out.push([el, k, +a.rd.toFixed(3), +b.rd.toFixed(3), +a.ljR.toFixed(3), +b.ljR.toFixed(3)]);
  }
  check(out.every(r => r[2] === r[3] && r[4] === r[5]), `1.39.2 an antimatter ion is the size of its matter twin (anti-Cu missing 15 positrons: ${out[0][2]} Å, as Cu¹⁵⁺; it was 7.33 Å, sized as a −15 anion), drawn and in its forces: ${out.map(r => `${r[0]} ±${r[1]} ${r[2]} Å`).join(', ')}`,
    `1.39.2 anti: ${JSON.stringify(out)}`);
};
PARTS.grabsel = async (page, check) => { // (1.39.2: "when you select some stuff when you use grab it should group the selected items together")
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const res = {};
  for (const sel of [true, false]) {
    const at = await page.evaluate((sel) => { loadPreset('empty'); setRunning(true); W.gamma = 0; W.T = 0;
      const a = addAtom('Ar', -6, 0), b = addAtom('Ar', 0, 6), c = addAtom('Ar', 6, -4), d = addAtom('Ar', 8, 8); for (const p of [a, b, c, d]) { p.vx = p.vy = 0; }
      R.msel.clear(); if (sel) { R.msel.add(a); R.msel.add(b); R.msel.add(c); } selChanged(); setTool('grab'); R.s = 20; R.cx = 0; R.cy = 0;
      window._g = { a, b, c, d, p0: [a, b, c, d].map(p => [p.x, p.y]) };
      const r = R.cv.getBoundingClientRect(), k = r.width / R.w; return { x: r.left + w2sx(a.x) * k, y: r.top + w2sy(a.y) * k, k };
    }, sel);
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(at.x, at.y - i * 6); await new Promise(r => setTimeout(r, 30)); }
    await new Promise(r => setTimeout(r, 400)); await page.mouse.up();
    res[sel ? 'selected' : 'alone'] = await page.evaluate(() => { const { a, b, c, d, p0 } = window._g; return [a, b, c, d].map((p, i) => +Math.hypot(p.x - p0[i][0], p.y - p0[i][1]).toFixed(1)); });
  }
  const S = res.selected, A = res.alone;
  check(S[0] > 2 && S[1] > 0.6 * S[0] && S[2] > 0.6 * S[0] && S[3] < 0.5 && A[0] > 2 && A[1] < 0.5 && A[2] < 0.5,
    `1.39.2 Grab on a selected atom carries the whole selection (three selected argon atoms moved ${S.slice(0, 3).join(', ')} Å, the unselected one ${S[3]} Å); with nothing selected it takes the one atom (${A[0]} Å; the others ${A.slice(1).join(', ')})`,
    `1.39.2 grabsel: ${JSON.stringify(res)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.2 grabsel errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.ptable = async (page, check) => { // (1.39.2: "more like a real periodic table, with the info in the space between Be and B"; the About as a drop-down; a back button in the isotope builder)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => { const w = (ms) => new Promise(res => setTimeout(res, ms));
    openPT({ Z: 29, A: 63, q: 0, bare: false, anti: false }); UI.ptInfo = false; renderPTDetail(); await w(100);
    const key = $('ptKey'), kr = key.getBoundingClientRect(), be = document.querySelector('.pcell[data-z="4"]').getBoundingClientRect(), b5 = document.querySelector('.pcell[data-z="5"]').getBoundingClientRect(), sc = document.querySelector('.pcell[data-z="21"]').getBoundingClientRect();
    const inGap = kr.left >= be.right - 1 && kr.right <= b5.left + 1 && kr.bottom <= sc.top + 1, keyTxt = key.textContent.replace(/\s+/g, ' ');
    const cell = document.querySelector('.pcell[data-z="29"]').textContent;
    const dlg = document.querySelector('#ptModal .dialog'), h0 = dlg.scrollHeight;
    $('ptInfo').click(); await w(250); const box = $('pdetail').querySelector('.infobox'), h1 = dlg.scrollHeight, drop = box && getComputedStyle(box).position === 'absolute', pop = box && box.classList.contains('pop');
    $('ptInfo').click(); await w(50);
    $('pdetail').querySelector('#ptBuild').click(); await w(150); const inB = !$('nucModal').hidden; NB.N += 1; nbChanged(); $('nucBack').click(); await w(150);
    const back = !$('ptModal').hidden && $('nucModal').hidden, A = UI.ptSel.A;
    setPTAnti(true); await w(100); const c1 = document.querySelector('.pcell[data-z="1"]'), kz = $('ptKey').querySelector('.pk-tile .z'), kov = $('ptKey').querySelector('.pk-tile .ov');
    const clear = c1.querySelector('.s').getBoundingClientRect().top >= c1.querySelector('.z').getBoundingClientRect().bottom - 0.5 && kov.getBoundingClientRect().top >= kz.getBoundingClientRect().bottom - 0.5; setPTAnti(false);
    return { inGap, keyTxt: keyTxt.slice(0, 80), cell, h0, h1, drop, pop, inB, back, A, clear };
  });
  check(r.inGap && /Copper/.test(r.keyTxt) && /electronegativity/.test(r.keyTxt) && /Copper/.test(r.cell) && /63\.5/.test(r.cell) && r.drop && r.pop && r.h1 === r.h0 && r.inB && r.back && r.A === 64 && r.clear,
    `1.39.2 the periodic table: each cell has its name and mass ("${r.cell}"), the chosen element large in the gap between Be and B with its facts ("${r.keyTxt.slice(0, 40)}…"); About drops down over the window (its height ${r.h0} px before and after); the isotope builder's "‹ Periodic table" goes back to the table at what was built (⁶⁴Cu); an anti-element's bar sits over its symbol, clear of the atomic number (cells and the big tile)`,
    `1.39.2 ptable: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.39.2 ptable errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
PARTS.lq = async (page, check) => { // (1.39.2 item 110: leptoquarks, made and decaying as pairs)
  const res = []; let ok = true;
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 4 }), W = X.W;
    for (let k = 0; k < 3; k++) {
      (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); W.decayOn = false; W.gamma = 0;
      const BK = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, Q = () => { let q = 0; for (const e of W.exo) if (!e.dead) q += e.q; for (const p of W.parts) if (!p.dead) q += p.k === X.NUC ? (p.anti ? -1 : 1) * p.Z - (p.ne || 0) : p.k === X.ELEC ? -1 : 1; return q; };
      const a = X.fireSpec({ kind: 'exo', sp: 'LQ' }, 0, 0, 1, 0, 1e6, false, 0, 0), live = W.exo.filter(e => !e.dead), pair = live.length === 2 && live[1].sp === 'LQb' && a.pair === live[1] && Math.abs(live[0].q + live[1].q) < 1e-12;
      const e0 = BK(), q0 = Q(); if (d3) X.decayExo3(a); else X.decayExo(a);
      const leps = W.parts.filter(p => !p.dead && (p.k === X.ELEC || p.k === X.POS)).length + W.exo.filter(e => !e.dead && /^e[+-]$/.test(e.sp)).length;
      const r = { pair, dq: Math.abs(Q() - q0), bk: Math.abs(BK() - e0) / 4e12, made: W.exo.filter(e => !e.dead).length, both: a.dead && a.pair.dead };
      if (!(r.pair && r.dq < 1e-9 && r.bk < 1e-13 && r.made > 20 && r.both)) ok = false; res.push(r);
    }
  }
  const Y = load('all', { seed: 1 }), card = Y.fmtQ(-1 / 3);
  check(ok && card === '−⅓', `1.39.2 a leptoquark (2 TeV, charge ${card}) is placed with its antiparticle, flying apart; the two decay together to e⁻ e⁺ and two jets (${res.map(r => r.made).join(', ')} hadrons), charge kept and the books to ${Math.max(...res.map(r => r.bk)).toExponential(0)} of their energy, flat and 3-D`,
    `1.39.2 lq: ${JSON.stringify(res)} card ${card}`);
};
PARTS.exo3 = async (page, check) => { // (1.39.3 items 111, 118, 119: a single leptoquark; pionium, true muonium, p̄He⁺; Ωccc, Pcs(4459))
  const res = {}; let ok = true;
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 3 }), W = X.W;
    for (const sp of ['LQs', 'pHe', 'A2pi', 'TMp', 'TMo', 'Omccc', 'Omcccb', 'Pcs4459']) {
      (d3 ? X.PRESETS.d3empty : X.PRESETS.empty).build(); W.decayOn = false; W.gamma = 0;
      const BK = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc;
      const Q = () => { let q = 0; for (const e of W.exo) if (!e.dead) q += e.q; for (const p of W.parts) if (!p.dead) q += p.k === X.NUC ? (p.anti ? -1 : 1) * p.Z - (p.ne || 0) : p.k === X.ELEC ? -1 : 1; return q; };
      const B = () => { let b = 0; for (const e of W.exo) if (!e.dead) b += X.XP[e.sp].B || 0; for (const p of W.parts) if (!p.dead && p.k === X.NUC) b += (p.anti ? -1 : 1) * (p.Z + p.N); return b; };
      const a = X.fireSpec({ kind: 'exo', sp }, 0, 0, 1, 0, 50, false, 0, 0);
      const rem = sp === 'LQs' ? a.rem && a.rem.lq === a && a.rem.sp === 'qRem' : true;
      const e0 = BK(), q0 = Q(), b0 = B(); if (d3) X.decayExo3(a); else X.decayExo(a);
      const r = [+(BK() - e0).toExponential(1), +(Q() - q0).toFixed(9), +(B() - b0).toFixed(9), a.dead, rem];
      if (!(Math.abs(r[0]) < 1e-2 && r[1] === 0 && r[2] === 0 && r[3] && r[4])) ok = false;
      res[(d3 ? '3' : '2') + sp] = r;
    }
  }
  const Y = load('all', { seed: 1 }), grp = Y.PCATS.flatMap(c => c[1]).map(x => x && x.sp || x), seen = ['A2pi', 'TMp', 'TMo', 'pHe', 'Pcs4459', 'LQs', 'Omccc'].every(k => grp.includes(k)) && Y.XP.Omccc.unseen && Y.XP.TMp.unseen && !Y.XP.A2pi.unseen;
  const keys = ['Omccc', 'A2pi', 'TMp', 'pHe', 'qRem', 'LQs'].map(Y.infoKeyX);
  check(ok && seen && keys.every(Boolean), `1.39.3 a single leptoquark (with the proton's remnant), pionium, true muonium (predicted), antiprotonic helium, Ωccc (predicted) and Pcs(4459) decay keeping charge, baryon number and the energy books, flat and 3-D (${Object.keys(res).length} decays)`,
    `1.39.3 exo3: ${JSON.stringify(res)} palette ${seen} keys ${keys}`);
};
PARTS.bsmc = async (page, check) => { // (1.39.3 item 112: hypothetical particles made in the colliders)
  const books = (X) => X.totalEnergy().total - X.W.ledger.nuc + X.W.ledger.bath;
  const chg = (X) => { const W = X.W; let q = (W.ledger.qOut || 0) + (W.ledger.qWall || 0); for (const p of W.parts) if (!p.dead) q += p.q; for (const o of W.exo) if (!o.dead) q += o.q; return Math.round(q * 1e6) / 1e6; };
  const bar = (X) => { let b = 0; for (const p of X.W.parts) if (!p.dead && p.k === X.NUC) b += (p.anti ? -1 : 1) * (p.Z + p.N); for (const o of X.W.exo) if (!o.dead) b += X.XP[o.sp].B || 0; return Math.round(b * 1e6) / 1e6; };
  const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'open'; W.collider = { made: {} }; };
  const clear = (X) => { const W = X.W; for (const p of W.parts) X.kill(p); W.parts = []; W.exo = []; W.rays = []; X.forcesNoEvents(); };
  const r = {}; let ok = true;
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W; fresh(X, d3); X.RP.bsm = true; X.BSM.boost = 1e15; // (for the test: about half the collisions)
    const got = {}; let worst = 0, bad = 0, linked = 0, want = 0;
    for (let k = 0; k < 80; k++) {
      clear(X);
      const a = X.addNuc(1, 0, 0, -0.01, 0, 0, 0, false), b = X.addNuc(1, 0, 0, 0.01, 0, 0, 0, false), K = (100e6 / 2 - 938.272) * 1e6;
      if (d3) { X.setMotion(a, K, 0, 0.6, 0, 0, 0.8); X.setMotion(b, K, 0, -0.6, 0, 0, -0.8); } else { X.setMotion(a, K, 1, 0); X.setMotion(b, K, -1, 0); }
      X.forcesNoEvents(); const E0 = books(X), Q0 = chg(X), B0 = bar(X), P = X.add4(X.p4of(a, true), X.p4of(b, true)), c0 = W.count.bsm || 0;
      if (!X.nnInelastic(a, b, 0, 0, P, X.mass4(P))) continue;
      if ((W.count.bsm || 0) > c0) {
        const xs = W.exo.filter(o => !o.dead), h = xs.find(o => ['Zp', 'LQ', 'LQs', 'BH'].includes(o.sp)); got[h ? h.sp : '?'] = (got[h ? h.sp : '?'] || 0) + 1;
        if (h && (h.sp === 'LQ' || h.sp === 'LQs')) { want++; if (h.sp === 'LQ' ? h.pair && h.pair.pair === h : h.rem && h.rem.lq === h) linked++; }
        for (const o of xs) if (!o.dead && ['Zp', 'LQ', 'LQb', 'LQs', 'BH'].includes(o.sp)) { if (d3) X.decayExo3(o); else X.decayExo(o); }
      }
      worst = Math.max(worst, Math.abs(books(X) - E0) / 1e14); if (chg(X) !== Q0 || bar(X) !== B0) bad++;
    }
    let zp = 0; // (e⁺e⁻ at the Z′'s 6 TeV: its real rate wins)
    for (let k = 0; k < 20; k++) {
      clear(X);
      const e = X.addLepton(X.ELEC, -0.01, 0), p = X.addLepton(X.POS, 0.01, 0), K = 3000 * 1e9 - 0.51099895e6;
      if (d3) { X.setMotion(e, K, 0.6, 0, 0, 0, 0.8); X.setMotion(p, K, -0.6, 0, 0, 0, -0.8); } else { X.setMotion(e, K, 1, 0); X.setMotion(p, K, -1, 0); }
      X.forcesNoEvents(); const E0 = books(X), Q0 = chg(X);
      X.eeEvent(e, p, 0, 0); if (W.exo.some(o => !o.dead && o.sp === 'Zp')) zp++;
      X.moveExos(1e-9); worst = Math.max(worst, Math.abs(books(X) - E0) / 6e12); if (chg(X) !== Q0) bad++;
    }
    r[d3 ? '3D' : 'flat'] = { got, linked, want, worst: +worst.toExponential(1), bad, zp };
    if (!(Object.keys(got).length >= 2 && linked === want && worst < 1e-12 && bad === 0 && zp >= 15)) ok = false;
  }
  const Y = load('all', { seed: 1 }); // (the real rates at 13 TeV, and nothing drawn with the switch off)
  const s13 = ['Zp', 'LQ', 'LQs'].map(k => +Y.bsmSig(k, 1.3e7).toFixed(3)), off = Y.bsmDraw(1.4e7, 1e7) === null && !Y.RP.bsm && !Y.SET_DEF.rpBsm && !!Y.SDESC.setRpBsm && !!Y.SDESC3.setRpBsm;
  check(ok && s13.join() === '0.15,0.04,0.6' && off, `1.39.3 TeV proton collisions make a Z′, leptoquarks (pairs and single, linked) and black holes (boosted for the test), an e⁺e⁻ collider at 6 TeV the Z′ (${r.flat.zp} of 20), charge, baryon number and books exact, flat and 3-D; off by default (${JSON.stringify(r.flat.got)})`,
    `1.39.3 bsmc: ${JSON.stringify(r)} σ13 ${s13} off ${off}`);
};
PARTS.labs = async (page, check) => { // (1.39.3 items 113, 114: LZ and CAST, Real labs)
  const X = load('all', { seed: 4 }), W = X.W; X.PRESETS.lz.build();
  let f = 0; while (W.t < 200 && f < 12000) { X.simFrame(1 / 60, 1e6); f++; }
  const n = W.count.wimp || 0, x = W.count.wimpX || 0, kr = W.dark.kr0 - W.parts.filter(p => !p.dead && p.Z === 36).length, lzOk = W.dark.kind === 'wimp' && x > 2 && Math.abs(n - x) < 3 * Math.sqrt(x) + 1 && W.parts.length >= 390;
  const Y = load('all', { seed: 4 }), V = Y.W; Y.PRESETS.cast.build();
  for (let i = 0; i < 20000; i++) Y.step(1e-5);
  const scr = V.objs.find(o => o.kind === 'screen'), N = V.count.axion + V.count.axOut, P = Math.sin(Y.DKM.gAg * Y.DKM.axBoost * 9 * 200 * Y.DKM.axK) ** 2, fr = scr.hits.light / N;
  const castOk = V.dark.kind === 'axion' && N > 200 && Math.abs(fr - P) < 4 * Math.sqrt(P * (1 - P) / N) && scr.hits.parts === 0;
  check(lzOk && castOk && Y.PRESETS.lz.group === 'Real labs' && Y.PRESETS.cast.group === 'Real labs', `1.39.3 LZ: ${n} xenon recoils against ${x.toFixed(1)} expected in ${W.t.toFixed(0)} tu (${kr} ⁸⁵Kr decays); CAST: ${(100 * fr).toFixed(0)} % of ${N} axions caught as photons against sin²(gBL/2) = ${(100 * P).toFixed(0)} %, the screen blind to the axions`,
    `1.39.3 labs: lz ${n} vs ${x} kr ${kr} parts ${W.parts.length}; cast ${scr.hits.light}/${N} = ${fr} vs ${P}, parts on screen ${scr.hits.parts}`);
};
PARTS.labsPage = async (page, check) => { // (1.39.3: the readout in the Data tab)
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms)), o = {};
    for (const k of ['lz', 'cast']) { loadPreset(k); setRunning(true); showTab('data', true); await w(2500); renderData(); o[k] = [$('dDarkSec').hidden, $('dDarkH').textContent, $('dDarkBig').textContent, $('dDarkVal').textContent]; }
    loadPreset('empty'); renderData(); o.gone = $('dDarkSec').hidden; return o;
  });
  if (own) { if (own.errors.length) check(false, '', '1.39.3 labs page errors: ' + own.errors.join(' | ')); await own.browser.close(); }
  check(!r.lz[0] && /Dark-matter/.test(r.lz[1]) && /expected/.test(r.lz[3]) && !r.cast[0] && /helioscope/.test(r.cast[1]) && /sin²/.test(r.cast[3]) && r.gone,
    `1.39.3 the Data tab's readout: LZ "${r.lz[2]}, ${r.lz[3]}"; CAST "${r.cast[2]}, ${r.cast[3]}"; gone in other setups`, `1.39.3 labsPage: ${JSON.stringify(r)}`);
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
