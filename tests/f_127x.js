'use strict';
/* The checks for 1.27's feature 24, unstable particles meeting each other (Settings → Experimental → Realistic particles
   → Unstable particles meet each other; RP.exm; hep.js exoMark, exoMeet, exmHit; PERF-NOTES "1.27: feature 24"), run by
   t_features (one line) or alone: node tests/f_127x.js [--node] [part …]  (parts: pairs, scatter, event, ultra, fp,
   settings). Every part but fp fails on v152; fp shows the setups unchanged with the switch off. */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (d3, seed = 3) => { const X = load('all', { seed }), W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'open'; return X; };
/* Two unstable particles head-on (offset off, Å, across), KE each (eV), until one is gone or they are past each other. */
function headOn(d3, A, B, KE, on, off = 0.05) {
  const X = fresh(d3), W = X.W; X.RP.exm = on;
  const a = X.addExo(A, -3, off, KE, 1, 0), b = X.addExo(B, 3, 0, KE, -1, 0);
  X.forcesNoEvents(); const E0 = books(X), E = a.KE + b.KE + (a.m + b.m) * 1e6, uy0 = a.uy;
  for (let st = 0; st < 400 && !a.dead && !b.dead && Math.abs(a.x) < 15; st++) { W.dt = X.chooseDt(); X.step(W.dt); }
  const left = /left the chamber/.test(a.fate || '');
  return { fate: a.dead && !left ? a.fate || 'gone' : 'passed', books: Math.abs(books(X) - E0) / E, turn: a.dead ? 0 : Math.abs(Math.atan2(a.uy, a.ux) - Math.atan2(uy0, 1)) * 180 / Math.PI, n: X.EXM.n };
}

/* ---- 1. pairs head-on, flat and 3-D: off they pass through; on, π⁺π⁻ and K⁺K⁻ annihilate into mesons, μ⁺μ⁻ as e⁺e⁻,
   π⁺K⁻ and π⁺p̄… collide (new hadrons between them); the books close */
PARTS.pairs = async (page, check, say) => {
  const r = {}; let ok = true;
  for (const d3 of [false, true]) for (const [A, B, KE, want] of [['pi+', 'pi-', 2e9, /collided: π⁺ \+ π⁻ →/], ['K+', 'K-', 2e9, /collided: K⁺ \+ K⁻ →/], ['mu+', 'mu-', 5e9, /collided: μ⁻ \+ μ⁺ →/], ['pi+', 'K-', 3e9, /collided: π⁺ \+ K⁻ →/]]) {
    const off = headOn(d3, A, B, KE, false), on = headOn(d3, A, B, KE, true), k = (d3 ? '3D ' : '') + A + B;
    r[k] = { off: off.fate, on: on.fate.slice(0, 60), books: +on.books.toExponential(1) };
    if (off.fate !== 'passed' || !want.test(on.fate) || on.books > 1e-12) ok = false;
  }
  say('  1.27 (24) pairs: ' + JSON.stringify(r));
  check(ok, `1.27 (24): unstable particles meet head-on (flat and 3-D): π⁺π⁻ and K⁺K⁻ annihilate (e.g. ${r['pi+pi-'].on}), μ⁺μ⁻ as e⁺e⁻ (${r['mu+mu-'].on}), π⁺K⁻ collide with new hadrons; with the switch off each pair passes through; the books within ${Math.max(...Object.values(r).map(v => v.books)).toExponential(0)} of the energy`,
    '1.27 (24) pairs: ' + JSON.stringify(r));
};

/* ---- 2. two like charges: no reaction, their charges turn them (flat); nothing in 3-D, as the beams */
PARTS.scatter = async (page, check, say) => {
  const flat = headOn(false, 'pi+', 'pi+', 5e6, true, 0.1), flatOff = headOn(false, 'pi+', 'pi+', 5e6, false, 0.1), d3 = headOn(true, 'pi+', 'pi+', 5e6, true, 0.1);
  const r = { flat: flat.turn, off: flatOff.turn, d3: d3.turn, fates: [flat.fate, d3.fate], books: flat.books };
  say('  1.27 (24) scatter: ' + JSON.stringify(r));
  check(flat.fate === 'passed' && flat.turn > 1 && flatOff.turn < 1e-9 && d3.fate === 'passed' && flat.books < 1e-12,
    `1.27 (24): two π⁺ at 5 MeV passing 0.1 Å apart turn each other by ${flat.turn.toFixed(1)}° in the flat game (off: ${flatOff.turn.toFixed(0)}°), no reaction, books kept; in 3-D they pass (the charges' turn is flat-only, as a collider's)`,
    '1.27 (24) scatter: ' + JSON.stringify(r));
};

/* ---- 3. two products of one event never meet each other (a ρ⁰'s pions, a φ's kaons), while products of different
   decays nearby do */
PARTS.event = async (page, check, say) => {
  const X = fresh(false), W = X.W; X.RP.exm = true; W.decayOn = true;
  let made = 0, same = 0, other = 0; const hit = X.exmHit; X.exmHit = (a, b, ...rest) => { if (a.ev && a.ev === b.ev) same++; else other++; return hit(a, b, ...rest); };
  for (let k = 0; k < 30; k++) { const o = X.addExo(k % 2 ? 'rho0' : 'phi', (k % 6) - 3, ((k / 6) | 0) - 2, 0, 1, 0, X.resPlaceMass(k % 2 ? 'rho0' : 'phi')); void o; }
  for (let st = 0; st < 60; st++) { W.dt = X.chooseDt(); X.step(W.dt); made = Math.max(made, W.exo.filter(o => !o.dead).length); }
  X.exmHit = hit;
  check(same === 0 && other > 0 && made > 20, `1.27 (24): 30 ρ⁰ and φ decaying a few ångström apart (${made} pions and kaons in flight): ${other} close passes between products of different decays met, none between two products of one decay`, '1.27 (24) event: ' + JSON.stringify({ same, other, made }));
};

/* ---- 4. ultra-realistic: true sizes, so a pair 0.05 Å apart passes through */
PARTS.ultra = async (page, check, say) => {
  const X = fresh(false), W = X.W; X.RP.exm = true; W.ultra = true;
  const a = X.addExo('pi+', -3, 0.05, 2e9, 1, 0), b = X.addExo('pi-', 3, 0, 2e9, -1, 0);
  for (let st = 0; st < 400 && !a.dead && Math.abs(a.x) < 15; st++) { W.dt = X.chooseDt(); X.step(W.dt); }
  check(!a.dead && !b.dead && X.EXM.n === 0, '1.27 (24): with ultra-realistic mode, a π⁺ and a π⁻ 0.05 Å apart pass through each other (true sizes: about a femtometre)', '1.27 (24) ultra: ' + JSON.stringify({ a: a.fate, n: X.EXM.n }));
};

/* ---- 5. switch off: setups with unstable particles as before, bit for bit (tools/fingerprint.js) */
const FP = { pionbeam: null, hyperfactory: null, annihilation: 'e383fd2d books 98779ad4 180', dafne: '793dfacd books 43026f16 20', muonium: null, photonuc: '82991d34 books a4742e49 84' };
PARTS.fp = async (page, check, say) => {
  const keys = Object.keys(FP).filter(k => FP[k]);
  const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'tools', 'fingerprint.js'), ...keys], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const bad = [];
  for (const line of out.split('\n')) { const m = line.trim().split(/\s+/); if (m.length < 2 || !FP[m[0]]) continue; const got = m.slice(1).join(' '); if (got !== FP[m[0]]) bad.push(`${m[0]} ${got} (before ${FP[m[0]]})`); }
  check(!bad.length, `1.27 (24): switch off, the setups with unstable particles as before (fingerprints of ${keys.join(', ')}; all 60 checked when it was built)`, '1.27 (24) fp: ' + JSON.stringify(bad));
};

/* ---- 6. Settings: the line in Realistic particles, off at start, its tag and pane, saved */
PARTS.settings = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const o = { start: [SET.rpExm, RP.exm].join() };
    openSettings('exp'); await new Promise(res => setTimeout(res, 60));
    const ids = [...document.querySelectorAll('#setModal .rpl input')].map(e => e.id); o.after = ids.indexOf('setRpExm') === ids.indexOf('setRpRay') + 1;
    const line = $('setRpExm').closest('.rpl'); o.tag = !!line.querySelector('.cost-k'); o.h = Math.round(line.getBoundingClientRect().height);
    setPrevShow('setRpExm', null); o.pane = $('setPrevT').textContent; o.desc = !!SDESC.setRpExm && !!SDESC3.setRpExm;
    $('setRpExm').click(); o.on = [SET.rpExm, RP.exm].join(); o.saved = String(JSON.parse(store('settings')).rpExm); o.exp = SET_EXP.includes('rpExm') && String(expSummary()).includes('unstable particles meeting');
    $('setRpExm').click(); o.off = [SET.rpExm, RP.exm].join();
    hideModal('setModal'); return o;
  });
  say('  1.27 (24) settings: ' + JSON.stringify(r));
  check(r.start === 'false,false' && r.after && r.tag && r.h < 34 && r.pane === 'Unstable particles meet each other' && r.desc && r.on === 'true,true' && r.saved === 'true' && r.exp && r.off === 'false,false',
    '1.27 (24): Settings → Experimental → Realistic particles → Unstable particles meet each other: after Rayleigh scattering, off at start, its tag, the side pane in both modes, saved, named in the Speed test\'s line',
    '1.27 (24) settings: ' + JSON.stringify(r));
};
PARTS.settings.page = true;

module.exports = async function f127x(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (1.27 (24) ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.27 (24) ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node'), parts = args.filter(a => a !== '--node');
  const needPage = !noPage && (!parts.length || parts.includes('settings'));
  let browser = null, page = null, errors = [];
  if (needPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, parts);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.27 feature 24 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
