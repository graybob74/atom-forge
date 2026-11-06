'use strict';
/* The checks for 1.27's features 23 and 26–32 (PERF-NOTES, "1.27: features 23 and 26–32"), run by t_features (one line)
   or alone: node tests/f_feat1.js [--node] [part …]. Every part but fp fails on v145 (none of it is there); fp shows the
   setups unchanged with every switch off, bit for bit. Parts that need the page are skipped with --node.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const chg = (X) => { const W = X.W; let q = (W.ledger.qOut || 0) + (W.ledger.qWall || 0); for (const p of W.parts) if (!p.dead) q += p.q; for (const o of W.exo) if (!o.dead) q += o.q; return Math.round(q * 1e6) / 1e6; };
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'open'; W.collider = { made: {} }; };
const clear = (X) => { const W = X.W; for (const p of W.parts) X.kill(p); W.parts = []; W.exo = []; W.rays = []; X.forcesNoEvents(); };
const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
const sig3 = (n, k) => 3 * Math.sqrt(Math.max(1, n * k * (1 - k)));
const SUBS = (s) => s.replace('function exoEvent(o, tgs, items, moms, x, y, kind, text, sub, z = 0) {', '$& if (globalThis.__subs) globalThis.__subs.push(sub);');

/* With every switch off nothing changes: the fingerprints (tools/fingerprint.js: seed 7, 300 steps) of the setups these
   items touch equal v145's (all 60 were compared when this was built: none changed, the LEP setup included: its scan is
   a button, the beams' radiation and the W pair's angles go with Resonance widths and heavy flavour). */
const FP_V145 = { water3d: '7a2e7f5c a9f2ee3a', water: 'cac1ac32 a9f2ee3a', mucf: '26a0e3c4 f1b8b3c8', rhic: 'fb7e8382 a9f2ee3a', ring: 'bdaf576a a9f2ee3a', linac: '7c6eb010 2b70ae2c', pionbeam: 'f6ef9b3d 8c3545fe', photonuc: '9bdf9dd1 49d4aec0', muonium: '3492138b 4aad8d19', hyperfactory: '5696d14c aab7307e', annihilation: '63bcd7e3 80f2a127', dafne: '793dfacd 43026f16', lep: '0ba36a5e 8ac2be3b' };
PARTS.fp = async (page, check) => {
  const bad = [];
  for (const k of Object.keys(FP_V145)) {
    const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    const got = h(parts + '|' + exo + '|' + W.bonds.length) + ' ' + h(JSON.stringify(W.ledger));
    if (got !== FP_V145[k]) bad.push(`${k} ${got} (v145 ${FP_V145[k]})`);
  }
  check(!bad.length, `1.27 features 23, 26–32: every switch off, the setups as in v145 (fingerprints of ${Object.keys(FP_V145).join(', ')})`, 'feat1 fp: ' + JSON.stringify(bad));
};

/* 23. A K⁻ absorbed at rest (Exotic atoms on) makes Σπ two times in three, the Σ turning into a Λ on a second nucleon about
   half the time in carbon, a third in helium; books exact, flat and 3-D. */
PARTS.kaon = async (page, check) => {
  const r = {}; let ok = true;
  for (const d3 of [false, true]) for (const el of ['C', 'He']) {
    globalThis.__subs = [];
    const X = load('all', { seed: 4, patch: SUBS }), W = X.W; X.RP.exo = true; fresh(X, d3);
    let worst = 0, n = 0, qbad = 0;
    for (let i = 0; i < 400; i++) {
      clear(X);
      const c = X.addAtom(el, 0, 0); c.vx = c.vy = 0; if (d3) c.vz = 0; X.forcesNoEvents();
      const o = X.addExo('K-', 0.3, 0, 0.01, 1, 0, undefined, 0, 0), E0 = books(X), Q0 = chg(X);
      if (X.kStop(o, c)) { n++; worst = Math.max(worst, Math.abs(books(X) - E0)); if (chg(X) !== Q0) qbad++; }
    }
    const s = globalThis.__subs, cnt = (re) => s.filter(t => re.test(t)).length, sig = cnt(/→ Σ/), conv = cnt(/turned into a Λ/);
    const k = (d3 ? '3d' : 'flat') + el, cv = 1 - Math.exp(-0.29 * Math.cbrt(el === 'C' ? 11 : 3));
    r[k] = { n, sig, conv, s0: cnt(/Σ⁰ → Λγ/), hyp: cnt(/hypernucleus/), books: +worst.toExponential(1), qbad };
    // (the conversion's odds: Σ⁰ always can, Σ⁺ needs a neutron and Σ⁻ a proton left, which they have here; its draw only when it can)
    if (n < 390 || Math.abs(sig - n * 2 / 3) > sig3(n, 2 / 3) + 1 || Math.abs(conv - sig * cv) > sig3(sig, cv) + 1 || worst > 1e-3 || qbad) ok = false;
    globalThis.__subs = null;
  }
  check(ok, `1.27 feature 23: stopped K⁻ make Σπ in ${r.flatC.sig} of ${r.flatC.n} on carbon (2/3 expected), the Σ turned into a Λ in ${r.flatC.conv} (carbon ~0.48 of them), on helium ${r.flatHe.conv} of ${r.flatHe.sig} (~0.35); 3-D ${r['3dC'].sig}/${r['3dC'].n}, ${r['3dC'].conv}; books within ${Math.max(...Object.values(r).map(v => v.books))} eV, charge kept`, 'feat1 kaon: ' + JSON.stringify(r));
};

/* 27. Photon polarization on: π⁰ → γγ and η → γγ give the two photons perpendicular polarizations; ⁶⁰Ni's 1,173 → 1,332
   keV cascade has W(θ) = 1 + 0.102 P₂ + 0.0091 P₄ (3-D: ⟨P₂(cos θ)⟩ = A₂/5 = 0.0204; flat, in the plane: ⟨cos²θ⟩ from W). */
PARTS.pol = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W; fresh(X, d3); X.RP.pol = true;
    let worst = 0, n = 0, none = 0;
    for (const sp of ['pi0', 'eta']) for (let i = 0; i < 100; i++) {
      clear(X); const o = X.addExo(sp, 0, 0, 1e7 * (i % 3), 1, 0, undefined, 0, d3 ? 0.3 : 0);
      if (d3) X.decayExo3(o); else X.decayExo(o);
      const R = W.rays.filter(q => !q.nu); if (R.length !== 2) continue;
      if (!R[0].pol || !R[1].pol) { none++; continue; }
      n++; const dot = Math.abs(R[0].pol[0] * R[1].pol[0] + R[0].pol[1] * R[1].pol[1] + R[0].pol[2] * R[1].pol[2]);
      if (i % 3 === 0) worst = Math.max(worst, dot); // (at rest, back to back: exactly at right angles)
    }
    r[d3 ? 'pi3' : 'pi'] = { n, none, worst: +worst.toExponential(1) };
    // the ⁶⁰Ni cascade
    const p = X.addAtom('Ni', 0, 0, { A: 60 }); let P2 = 0, C2 = 0; const N = 40000;
    for (let i = 0; i < N; i++) { p.vx = p.vy = 0; if (d3) p.vz = 0; const R = X.glPrep(p, [1173.228, 1332.492]); const c = R[0][1] * R[1][1] + R[0][2] * R[1][2] + (d3 ? R[0][3] * R[1][3] : 0); P2 += 1.5 * c * c - 0.5; C2 += c * c; }
    r[d3 ? 'co3' : 'co'] = { P2: +(P2 / N).toFixed(4), C2: +(C2 / N).toFixed(4) };
  }
  // flat: ⟨cos²θ⟩ over the circle with W(θ) as the odds
  let a = 0, b = 0; for (let i = 0; i < 3600; i++) { const c = Math.cos(2 * Math.PI * (i + 0.5) / 3600), c2 = c * c, w = 1 + 0.102 * (1.5 * c2 - 0.5) + 0.0091 * (35 * c2 * c2 - 30 * c2 + 3) / 8; a += w * c2; b += w; }
  r.flatWant = +(a / b).toFixed(4);
  const ok = r.pi.n >= 120 && r.pi3.n >= 120 && !r.pi.none && !r.pi3.none && r.pi.worst < 1e-9 && r.pi3.worst < 1e-9 && Math.abs(r.co3.P2 - 0.0204) < 0.008 && Math.abs(r.co.C2 - r.flatWant) < 0.006;
  check(ok, `1.27 feature 27: π⁰ and η → γγ polarized at right angles (${r.pi.n} flat, ${r.pi3.n} in 3-D; at rest |ε₁·ε₂| ≤ ${Math.max(r.pi.worst, r.pi3.worst)}); ⁶⁰Ni's cascade ⟨P₂⟩ ${r.co3.P2} in 3-D (A₂/5 = 0.0204), flat ⟨cos²θ⟩ ${r.co.C2} (W's ${r.flatWant}; unpolarized 0.5)`, 'feat1 pol: ' + JSON.stringify(r));
};

/* 28. Resonance widths on: central Au + Au at 200 GeV a nucleon pair (RHIC) makes charm and bottom by its binary
   collisions (~1,150 × 0.0143 ≈ 16 cc̄ pairs over all angles, about 33 hadrons); books and charge exact; off, none.
   (Central Pb + Pb at 2.76 TeV makes ~130 pairs, but its products pass the 1,500 unstable particles the box holds, and
   those carried off take their charge out of the count: v145's limit, PERF-NOTES.) */
PARTS.aa = async (page, check) => {
  const r = {}; let ok = true;
  const HF = /^(Dc|Ds|Lc|Jpsi|B|Bb|Bs|Lb|Ups)/;
  for (const [d3, res] of [[false, true], [true, true], [false, false]]) {
    const X = load('all', { seed: 4 }), W = X.W; fresh(X, d3); X.RP.res = res;
    let ev = 0, hf = 0, worst = 0, qbad = 0;
    for (let k = 0; k < 2; k++) {
      clear(X);
      const a = X.addNuc(79, 118, 0, -0.01, 0, 0, 0, false), b = X.addNuc(79, 118, 0, 0.01, 0, 0, 0, false), K = 197 * 2e11 / 2;
      X.setMotion(a, K, 1, 0); X.setMotion(b, K, -1, 0); X.forcesNoEvents();
      const E0 = books(X), Q0 = chg(X);
      if (!X.nuclearEncounter(a, b, 0.05, 0, 0, 0)) continue;
      ev++; hf += W.exo.filter(o => !o.dead && HF.test(o.sp)).length;
      if (chg(X) !== Q0) qbad++;
      worst = Math.max(worst, Math.abs(books(X) - E0) / (197 * 2e11));
    }
    r[(d3 ? '3d' : 'flat') + (res ? '' : 'Off')] = { ev, hf, books: +worst.toExponential(1), qbad };
    if (ev < 2 || worst > 1e-12 || qbad || (res ? hf < ev * 15 || hf > ev * 80 : hf !== 0)) ok = false;
  }
  check(ok, `1.27 feature 28: central Au + Au at 200 GeV makes ${r.flat.hf / r.flat.ev} charm and bottom hadrons a collision (3-D ${r['3d'].hf / r['3d'].ev}; ~16 pairs expected), none with the switch off; books within ${Math.max(r.flat.books, r['3d'].books)}, charge kept`, 'feat1 aa: ' + JSON.stringify(r));
};

/* 29. Resonance widths on: the Z peak with the beams' own radiation 30.6 nb (hadrons; Born 41.5), its high side raised
   (94 GeV 8.8 against 6.9), most Zs made with a photon along a beam, books exact; e⁺e⁻ → W⁺W⁻ at 200 GeV with the W⁻
   forward along the e⁻ (3-D: 0.77 of them forward; off 0.5). */
PARTS.isr = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W; fresh(X, true); X.RP.res = true;
  const r = { pk: +(X.eeISR(91.1876 ** 2).Z * 0.69911).toFixed(2), r94: +(X.eeISR(94 * 94).Z * 0.69911).toFixed(2), b94: +(X.ewEE(94 * 94).Z * 0.69911).toFixed(2) };
  const pair = (rs) => {
    clear(X);
    const e = X.addLepton(X.ELEC, -0.01, 0), p = X.addLepton(X.POS, 0.01, 0), K = rs / 2 * 1e9 - 0.51099895e6;
    X.setMotion(e, K, 0.6, 0, 0, 0, 0.8); X.setMotion(p, K, -0.6, 0, 0, 0, -0.8); X.forcesNoEvents();
    const E0 = books(X); X.eeEvent(e, p, 0, 0);
    return { xs: W.exo.filter(o => !o.dead), g: W.rays.filter(q => !q.nu && q.E > 1e6).length, d: Math.abs(books(X) - E0) / (rs * 1e9) };
  };
  let z = 0, zg = 0, mz = 0, worst = 0;
  for (let i = 0; i < 200; i++) { const q = pair(91.1876); worst = Math.max(worst, q.d); const Z = q.xs.find(o => o.sp === 'Z0'); if (!Z) continue; z++; mz += Z.m; if (q.g) zg++; }
  r.z = z; r.withG = zg; r.mz = +(mz / z / 1000).toFixed(3); r.books = +worst.toExponential(1);
  let F = 0, n = 0;
  for (let i = 0; i < 1500; i++) { const q = pair(200); const w = q.xs.find(o => o.sp === 'W-'); if (!w) continue; n++; if (w.ux * 0.6 + w.uz * 0.8 > 0) F++; }
  r.ww = { n, F: +(F / n).toFixed(3) };
  const ok = Math.abs(r.pk - 30.6) < 0.3 && r.r94 > r.b94 + 1 && z > 150 && zg > 0.5 * z && r.mz < 91.18 && r.books < 1e-12 && n > 100 && r.ww.F > 0.68;
  check(ok, `1.27 feature 29: the Z peak with the beams' radiation ${r.pk} nb (Born 41.5; LEP 30.5), at 94 GeV ${r.r94} (Born ${r.b94}); ${zg} of ${z} Zs made with a photon along a beam, their mass ${r.mz} GeV on average; books within ${r.books}; W⁻ forward along the e⁻ in ${r.ww.F} of ${n} W pairs at 200 GeV (3-D)`, 'feat1 isr: ' + JSON.stringify(r));
};

/* 30. Exotic atoms on: a slow μ⁻ beside a water molecule ends on its hydrogens 0.4% of the time (Fermi–Teller's Z law: 20%),
   beside methane 1.7% (40%), beside ethane 1.2%; a free H atom beside an O atom keeps the Z law (1/9). */
PARTS.mucap = async (page, check) => {
  const X = load('all', { seed: 6 }), W = X.W; X.RP.exo = true; fresh(X, false);
  const r = {}; let ok = true;
  for (const [k, build, want] of [['H2O', () => X.addMolecule('H2O', 0, 0), 0.004], ['CH4', () => X.addMolecule('CH4', 0, 0), 0.017], ['C2H6', () => X.addMolecule('C2H6', 0, 0), 0.012], ['H+O', () => { X.addAtom('H', 0.5, 0); X.addAtom('O', -0.5, 0); }, 1 / 9]]) {
    clear(X); build(); X.forcesNoEvents();
    const all = W.parts.filter(p => !p.dead && p.k === X.NUC);
    let cx = 0, cy = 0; for (const p of all) { cx += p.x; cy += p.y; } cx /= all.length; cy /= all.length;
    const o = X.addExo('mu-', cx, cy, 10, 1, 0);
    const inReach = all.filter(p => (p.x - cx) ** 2 + (p.y - cy) ** 2 < 1.5 * 1.5), zH = inReach.filter(p => p.Z === 1).length, zA = inReach.reduce((t, p) => t + p.Z, 0);
    let nH = 0; const N = 20000; for (let i = 0; i < N; i++) { const t = X.xaTarget(o); if (t && t.Z === 1) nH++; }
    const wantHere = inReach.length === all.length ? want : null; // (the share holds for the whole molecule in reach)
    r[k] = { H: +(nH / N).toFixed(4), want: wantHere, zLaw: +(zH / zA).toFixed(3), atoms: `${inReach.length}/${all.length}` };
    if (wantHere !== null && Math.abs(nH - N * wantHere) > sig3(N, wantHere) + 1) ok = false;
  }
  if (r.H2O.want === null || r.CH4.want === null || r['H+O'].want === null) ok = false;
  check(ok, `1.27 feature 30: μ⁻ caught on the hydrogens of water ${r.H2O.H} (measured 0.004; Z law ${r.H2O.zLaw}), methane ${r.CH4.H} (0.017; ${r.CH4.zLaw}), ethane ${r.C2H6.H}${r.C2H6.want ? '' : ' (part of it in reach)'}; a free H by an O ${r['H+O'].H} (Z law 1/9)`, 'feat1 mucap: ' + JSON.stringify(r));
};

/* 31. The LEP energy scan (Node): 7 beam energies, 30 collisions each, the measured σ(Z → hadrons) in 1 GeV bins of √s
   follows the model's line shape (Born here), its highest bin between 90 and 92.5 GeV at 30–55 nb. */
PARTS.scan = async (page, check) => {
  const X = load('all', { seed: 7 }), W = X.W; X.PRESETS.lep.build(); X.zscanStart();
  let n = 0; while (W.zscan.run && n < 40000) { W.dt = X.chooseDt(); X.step(W.dt); n++; if (n % 10 === 0) X.zscanTick(); }
  const pts = X.zscanPoints(W.zscan), pk = pts.reduce((m, p) => (p[1] > m[1] ? p : m), [0, 0]);
  let far = 0; for (const p of pts) if (Math.abs(p[1] - X.zscanModel(p[0])) > 3 * p[2] + 1) far++;
  const r = { steps: n, rec: W.zscan.rec.length, done: !W.zscan.run, bins: pts.length, lo: +pts[0][0].toFixed(2), hi: +pts[pts.length - 1][0].toFixed(2), pk: [+pk[0].toFixed(2), +pk[1].toFixed(1)], far };
  const ok = r.done && r.rec >= 210 && r.bins >= 6 && r.lo < 88.5 && r.hi > 93.5 && pk[0] > 90 && pk[0] < 92.5 && pk[1] > 30 && pk[1] < 55 && far <= 1;
  check(ok, `1.27 feature 31: the LEP scan steps the beams through 7 energies (${r.rec} collisions, ${n} steps); ${r.bins} bins from ${r.lo} to ${r.hi} GeV, the highest ${r.pk[1]} nb at ${r.pk[0]} GeV, ${far} bin(s) off the model by over 3σ`, 'feat1 scan: ' + JSON.stringify(r));
};

/* The page: 26, the Matter depth line in Realistic particles (after Charged particles in matter, three choices with cost
   tags, ×1 "realistic", its side-pane text, sets RP.cpmX, saved, normal at start); 31, the LEP setup's Scan button and
   the Data tab's card; 32, positronium on the particle menu: off, placing it is refused with the reason; on, it is made. */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    const o = {};
    loadPreset('empty'); openSettings('exp');
    const pane = document.querySelector('section[data-stab="exp"]'), lines = [...pane.querySelectorAll('.rpl')], ids = lines.map(l => (l.querySelector('[id]') || {}).id);
    o.ids = ids.join(','); o.start = [SET.cpmX, RP.cpmX].join();
    const seg = $('segCpmX'); o.btns = seg ? [...seg.querySelectorAll('button')].map(b => b.dataset.v + ':' + ((b.querySelector('.oc') || {}).textContent || '') + ':' + (b.querySelector('.rl') ? 'real' : '')).join(' ') : '';
    o.h = seg ? Math.round(seg.closest('.srow').getBoundingClientRect().height) : 0; o.hWave = Math.round($('segWave').closest('.srow').getBoundingClientRect().height);
    setPrevShow('segCpmX', null); o.pane = $('setPrevT').textContent + ' | ' + $('setPrevD').textContent;
    if (seg) { seg.querySelector('[data-v="1000"]').click(); o.set = [SET.cpmX, RP.cpmX, JSON.parse(store('settings')).cpmX].join(); o.sum = expSummary(); seg.querySelector('[data-v="1"]').click(); o.back = RP.cpmX; }
    o.exp = SET_EXP.includes('cpmX');
    hideModal('setModal');
    // 31
    loadPreset('lep'); setRunning(false); showTab('lab', true); syncCollider();
    const b = $('cScan'); o.scanBtn = b ? b.textContent : '';
    if (b) b.click();
    o.scanRun = !!(W.zscan && W.zscan.run);
    for (let i = 0; i < 4000 && W.zscan && W.zscan.run; i++) { W.dt = chooseDt(); step(W.dt); if (i % 10 === 0) zscanTick(); }
    showTab('data', true); renderData(); o.card = !$('dZsSec').hidden; o.note = $('dZsNote').textContent.slice(0, 160);
    if (W.zscan) W.zscan.run = false;
    // 32
    loadPreset('empty'); setRunning(false);
    o.menu = PCATS.some(([n, l]) => n === 'Exotic atoms and nuclei' && l.some(s => s.sp === 'pPs') && l.some(s => s.sp === 'oPs'));
    UI.spec = { kind: 'exo', sp: 'oPs' }; setTool('place'); o.help = $('toolopts').textContent;
    placeFly({ kind: 'exo', sp: 'oPs' }, 0, 0, 1); o.offMade = W.exo.filter(q => !q.dead && XP[q.sp].ps).length; o.offLog = W.log.length ? W.log[W.log.length - 1].text : '';
    RP.ps = true; placeFly({ kind: 'exo', sp: 'pPs' }, 0, 0, 1); placeFly({ kind: 'exo', sp: 'oPs' }, 2, 0, 1); o.onMade = W.exo.filter(q => !q.dead && XP[q.sp].ps).map(q => q.sp).join(); RP.ps = !!SET.rpPs;
    setTool('inspect');
    return o;
  });
  const ids = r.ids.split(','), iC = ids.indexOf('setRpCpm'), iX = ids.indexOf('segCpmX');
  const ok = iC >= 0 && iX === iC + 1 && r.start === '1,1' && /^1:×1:real 1000:×1:? 1000000:×1:?$/.test(r.btns) && r.h <= r.hWave + 2 && /^Matter depth \| /.test(r.pane) && /only those rare processes/.test(r.pane) && /critical energy/.test(r.pane)
    && r.set === '1000,1000,1000' && /matter depth ×1,000/.test(r.sum) && r.back === 1 && r.exp
    && r.scanBtn === 'Scan the Z peak' && r.scanRun && r.card && /σ\(e⁺e⁻ → Z → hadrons\)/.test(r.note)
    && r.menu && /Positronium switch/.test(r.help) && r.offMade === 0 && /Positronium switch/.test(r.offLog) && r.onMade === 'pPs,oPs';
  check(ok, `1.27 features 26, 31, 32 on the page: Matter depth after Charged particles in matter (${r.btns}), its side pane, sets RP.cpmX, normal at start; the LEP setup's "${r.scanBtn}" runs and the Data tab draws the line shape; positronium on the particle menu, refused with the reason with its switch off, placed with it on`, 'feat1 page: ' + JSON.stringify(Object.assign({}, r, { pane: r.pane.slice(0, 120) })));
};
PARTS.page.page = true;

module.exports = async function feat1(page, check, say, openPage, only) {
  if (!openPage) openPage = require('./browser').openPage;
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (feat1 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `feat1 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 feature 23 and 26–32 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
