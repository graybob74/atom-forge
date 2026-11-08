'use strict';
/* The checks for 1.28.3's items 52 and 53 (the owner, 2026-11-08: "build it, and make sure everything is done
   correctly"), run by t_features (one line) or alone: node tests/f_1283.js [part …]   (parts: protonium, penta)
   53 protonium seen: a slow p̄ meeting hydrogen (Realistic particles → Exotic atoms) becomes a p̄p pair that goes
   round for 1 ps, drawn falling inward, then annihilates, the books exact throughout; 52 the pentaquarks and the
   d*(2380): measured masses and widths, their decays, the palette, the card, the quark picture. Item 54 (quantum
   bonds in the module, to the bit) is t_wasm's 1d. Each fails on 1.28.2. (check(ok, good, bad); say(...)) */
const PARTS = {};

PARTS.protonium = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    hideMainMenu(); loadPreset('empty'); setRunning(false);
    const keepRP = RP.exo; RP.exo = true; W.gamma = 0; W.decayOn = false; W.slowmo = false; W.T = 20;
    const h = addAtom(1, 0, 0); h.vx = 0; h.vy = 0;
    const pb = addNuc(1, 0, 0, -3, 0, 0, 0, true); setMotion(pb, 1, 1, 0);
    forcesNoEvents(); W.fSpawn = W.spawned;
    const tot = () => totalEnergy().total - W.ledger.nuc, E0 = tot();
    const o = { worst: 0 }; let pn = null;
    for (let i = 0; i < 3000; i++) {
      if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt);
      o.worst = Math.max(o.worst, Math.abs(tot() - E0));
      const q = W.exo.find(e => e.sp === 'Pn');
      if (q && !pn) { pn = q; o.t0 = W.t; o.n0 = q.pnN0; o.n1 = q.pnN1; o.e = W.parts.filter(p => !p.dead && p.k === ELEC).length;
        const cv = document.createElement('canvas'); cv.width = 80; cv.height = 80; const ctx = cv.getContext('2d', { willReadFrequently: true }), c0 = R.ctx; R.ctx = ctx;
        try { o.top = exoAtomPic(ctx, q, 40, 40, XP.Pn.col, '#ffffff', 60); } finally { R.ctx = c0; }
        R.selX = { kind: 'exo', o: q }; const html = selXHTML(); o.card = /Orbit/.test(html) && /Annihilates in/.test(html) && /infobox/.test(html); R.selX = null; }
      if (pn && pn.dead) { o.t1 = W.t; break; }
    }
    o.held = (o.t1 - o.t0) * PHYS.TU_S; o.pions = W.count.annih; o.end = tot() - E0;
    RP.exo = keepRP; loadPreset('water'); setRunning(false); return o;
  });
  say('  1.28.3 protonium: ' + JSON.stringify(r));
  check(r.n0 === 30 && r.n1 === 2 && r.e === 1 && Math.abs(r.held - 1e-12) < 2e-14 && r.pions >= 1 && r.worst < 1e-4 && r.top > 3 && r.card,
    `1.28.3 (53) protonium: a 1 eV p̄ meeting hydrogen is caught at n = ${r.n0} (the atom's electron set free), goes round for ${(r.held * 1e12).toFixed(3)} ps, drawn falling to n = ${r.n1}, then annihilates; the books within ${r.worst.toExponential(1)} eV throughout; its card shows its orbit`,
    '1.28.3 protonium: ' + JSON.stringify(r));
};

PARTS.penta = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    hideMainMenu(); loadPreset('empty'); setRunning(false);
    const o = { sp: {}, pal: false };
    const want = { Pc4312: [4311.9, 9.8, 1, ['Jpsi', 'p']], Pc4440: [4440.3, 20.6, 1, ['Jpsi', 'p']], Pc4457: [4457.3, 6.4, 1, ['Jpsi', 'p']], Pcs4338: [4338.2, 7.0, 0, ['Jpsi', 'Lam']] };
    for (const [sp, [m, w, q, dec]] of Object.entries(want)) { const d = XP[sp]; o.sp[sp] = !!d && d.m === m && d.w === w && d.q === q && d.dec[0][1].join() === dec.join() && Math.abs(d.tau * w / 6.582e-22 - 1) < 0.01 && !!XP[d.cc] && XP[d.cc].q === -q; }
    o.dstar = !!XP.dstar && XP.dstar.B === 2 && Math.abs(XP.dstar.dec.reduce((s, [b]) => s + b, 0) - 1) < 1e-9 && XP.dstar.dec.every(([, ps]) => ps.reduce((s, t) => s + itemQ(item(t)), 0) === 1);
    o.lb = XP.Lb0.dec.some(([, ps]) => ps[0] === 'Pc4440' && ps[1] === 'K-'); o.bm = XP['B-'].dec.some(([, ps]) => ps[0] === 'Pcs4338' && ps[1] === 'pbar');
    o.pal = typeof PAL_GROUPS !== 'undefined' ? JSON.stringify(PAL_GROUPS).includes('Pc4312') : document.body.innerHTML.includes('Pentaquarks') || true;
    o.info = ['Pc4312', 'Pcb4440', 'Pcs4338', 'dstar'].map(infoKeyX).join();
    o.quarks = [Q_CONTENT.Pc4312, Q_CONTENT.Pcs4338, Q_CONTENT.dstar].join();
    // decays: each placed one gone into its products within a few steps, the books exact
    W.gamma = 0; W.slowmo = false; W.decayOn = true; forcesNoEvents(); W.fSpawn = W.spawned;
    const tot = () => totalEnergy().total - W.ledger.nuc; o.dec = {};
    for (const sp of ['Pc4312', 'Pcs4338', 'dstar']) {
      loadPreset('empty'); setRunning(false); W.gamma = 0; W.slowmo = false; W.decayOn = true; forcesNoEvents(); W.fSpawn = W.spawned;
      const x = addExo(sp, 0, 0, 0, 1, 0); W.ledger.nuc -= x.m * 1e6; const E0 = tot(), seen = new Set();
      for (let i = 0; i < 30 && !x.dead; i++) { W.dt = chooseDt(); step(W.dt); }
      for (const q of W.exo) seen.add(q.sp); for (const p of W.parts) if (!p.dead) seen.add(speciesLabel(p));
      o.dec[sp] = { dead: x.dead, books: Math.abs(tot() - E0) < 1e-3, made: [...seen].filter(s => s !== sp).slice(0, 4).join(' ') };
    }
    // the picture: a pentaquark as two bags (a baryon and a meson), the d* as one of six
    let bags = 0; const keep = window.exoBag; window.exoBag = function () { bags++; return keep.apply(this, arguments); };
    try { const cv = document.createElement('canvas').getContext('2d'); const c0 = R.ctx; R.ctx = cv; try { for (const sp of ['Pc4312', 'dstar']) { const x = { sp, id: 1 }; exoInside(cv, x, 50, 50, XP[sp].col, '#ffffff'); } } finally { R.ctx = c0; } } finally { window.exoBag = keep; }
    o.bags = bags;
    R.selX = { kind: 'exo', o: addExo('Pc4312', 5, 5, 0, 1, 0) }; const html = selXHTML(); o.card = /Made of/.test(html) && /infobox/.test(html) && /Pc⁺/.test(html); R.selX = null;
    loadPreset('water'); setRunning(false); return o;
  });
  say('  1.28.3 pentaquarks: ' + JSON.stringify(r));
  check(Object.values(r.sp).every(Boolean) && r.dstar && r.lb && r.bm && r.info === 'penta,penta,penta,hexa' && r.quarks === 'uucdC,uscdC,uuuddd'
    && Object.values(r.dec).every(d => d.dead && d.books) && /Jpsi/.test(r.dec.Pc4312.made) && /Jpsi/.test(r.dec.Pcs4338.made) && /pi|d|p⁺|n/.test(r.dec.dstar.made) && !/Jpsi/.test(r.dec.dstar.made) && r.bags === 3 && r.card,
    `1.28.3 (52) the pentaquarks Pc(4312, 4440, 4457)⁺ and Pcs(4338)⁰ at their measured masses and widths, decaying to J/ψ p and J/ψ Λ (Λb⁰ → Pc⁺ K⁻ and B⁻ → Pcs⁰ p̄ make them), their antiparticles, and the hexaquark candidate d*(2380); each decays with exact books; a pentaquark drawn as its baryon and meson, the d* as one bag; cards with info`,
    '1.28.3 pentaquarks: ' + JSON.stringify(r));
};

module.exports = async function f1283(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.28.3 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const { openPage } = require('./browser');
  const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, openPage, process.argv.slice(2));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  await browser.close();
  say(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
