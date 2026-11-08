'use strict';
/* The checks for 1.27's feature 19, photons as waves (Settings → Experimental → Realistic particles → Photons as waves;
   RP.pwave; props.js slits and waveSlit, pold.js waveBraggTry; PERF-NOTES "1.27: feature 19"), run by t_features (one
   line) or alone: node tests/f_127w.js [--node] [part …]  (parts: pattern, screen, visible, bragg, books, save, fp,
   settings). Every part but fp fails on v153; fp shows the setups unchanged with the switch off. */
const { load } = require('./load');
const PARTS = {};
const fresh = (seed = 4) => { const X = load('all', { seed }), W = X.W; X.PRESETS.empty.build(); W.box.w = W.box.h = 120; W.T = 0; W.gamma = 0; return X; };
const peaksOf = (H, min) => { const pk = []; for (let k = 1; k < H.length - 1; k++) if (H[k] > H[k - 1] && H[k] >= H[k + 1] && H[k] > min) pk.push(k); return pk; };

/* ---- 1. the slits' pattern: bright at sin θ = mλ/d (double slit and a grating of five), the single slit's envelope */
PARTS.pattern = async (page, check, say) => {
  const X = fresh(), E = 10 * X.PHYS.HC / 2, r = {}; X.RP.pwave = true; // (λ = 2 Å)
  for (const ns of [2, 5]) {
    const ob = X.objMake('slits', 0, -20, 0, 20, { ns, sd: 10, sa: 2 }), H = new Array(100).fill(0), n = 40000;
    for (let i = 0; i < n; i++) { const v = X.waveSlit(ob, 1, 0, E, 0, 1, -1, 0); H[Math.min(99, Math.floor((v[1] + 1) * 50))]++; }
    r[ns] = peaksOf(H, n / 400).map(k => +((k + 0.5) / 50 - 1).toFixed(2));
  }
  const want = [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8], near = (L) => want.every(w => L.some(x => Math.abs(x - w) <= 0.035));
  // one slit 4 Å wide: dark at sin θ = ±λ/a = ±0.5, a centre twice as wide as the side lobes
  const one = X.objMake('slits', 0, -20, 0, 20, { ns: 1, sa: 4 }), H1 = new Array(100).fill(0); for (let i = 0; i < 40000; i++) { const v = X.waveSlit(one, 1, 0, E, 0, 1, -1, 0); H1[Math.min(99, Math.floor((v[1] + 1) * 50))]++; }
  const zero = (H1[24] + H1[25] + H1[74] + H1[75]) / 4, mid = H1[50];
  say('  1.27 (19) slits: ' + JSON.stringify({ double: r[2], grating: r[5], singleZero: zero, singleMid: mid }));
  check(near(r[2]) && near(r[5]) && zero < 0.01 * mid, `1.27 (19): through two slits 10 Å apart (λ = 2 Å) photons land brightest at sin θ = ${r[2].join(', ')} (mλ/d: 0, ±0.2, ±0.4 …), through a grating of five the same; one slit 4 Å wide is dark at sin θ = ±0.5 (λ/a: ${zero.toFixed(0)} against ${mid} in the middle)`, '1.27 (19) pattern: ' + JSON.stringify({ r, zero, mid }));
};

/* ---- 2. the experiment: X-rays through a double slit onto a detector screen 40 Å behind, photon by photon: fringes;
   off, two bright lines behind the openings */
PARTS.screen = async (page, check, say) => {
  const run = (on) => {
    const X = fresh(), W = X.W; X.RP.pwave = on;
    X.objAdd('slits', 0, -30, 0, 30, { ns: 2, sd: 10, sa: 1.5 }); const sc = X.objAdd('screen', 40, -40, 40, 40);
    const E = 10 * X.PHYS.HC / 2;
    for (let i = 0; i < 6000; i++) { const y = (X.rnd() - 0.5) * 14; X.emitPhoton(-20, y, E, 1, 0, {}); if (W.rays.length > 300) W.rays.length = 0; }
    return sc.hits;
  };
  const on = run(true), off = run(false), pon = peaksOf(on.posL, on.light / 200), lit = (H) => H.posL.filter(c => c > 0).length;
  const cen = pon.map(k => (k + 0.5) * 2 - 40); // (Å along the screen from its middle)
  const gaps = cen.slice(1).map((c, i) => c - cen[i]).filter(g => Math.abs(g) < 20);
  const gap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
  say('  1.27 (19) screen: ' + JSON.stringify({ on: on.posL.join(','), off: off.posL.join(','), peaks: cen, gap }));
  check(pon.length >= 5 && gap > 6.5 && gap < 10.5 && lit(off) <= 4 && lit(on) >= 20 && on.light > 1000,
    `1.27 (19): 6,000 X-rays (λ 2 Å) through a double slit 10 Å apart, a screen 40 Å behind: ${pon.length} bright fringes ${gap.toFixed(1)} Å apart (40 Å × λ/d ≈ 8 Å, wider off the axis), over ${lit(on)} of its 40 strips; with the switch off, light on ${lit(off)} strips only (the two openings' shadows)`,
    '1.27 (19) screen: ' + JSON.stringify({ peaks: cen, gap, on: on.posL, off: off.posL }));
};

/* ---- 3. visible light (500 nm) through slits a few Å wide spreads over the whole half-plane, no fringes */
PARTS.visible = async (page, check, say) => {
  const X = fresh(); X.RP.pwave = true;
  const ob = X.objMake('slits', 0, -20, 0, 20, { ns: 2, sd: 10, sa: 2 }), E = X.PHYS.HC / 500, H = new Array(20).fill(0), n = 20000;
  for (let i = 0; i < n; i++) { const v = X.waveSlit(ob, 1, 0, E, 0, 1, -1, 0); H[Math.min(19, Math.floor((Math.asin(v[1]) / Math.PI + 0.5) * 20))]++; }
  const want = H.map((_, k) => { const th = ((k + 0.5) / 20 - 0.5) * Math.PI; return ((1 + Math.cos(th)) / 2) ** 2; }), sw = want.reduce((t, x) => t + x, 0), dev = Math.max(...H.map((c, k) => Math.abs(c / n - want[k] / sw) / (want[k] / sw)));
  check(dev < 0.15, `1.27 (19): visible light (500 nm) through a double slit 10 Å apart spreads over the whole half-plane without fringes: by angle it follows the obliquity factor ((1 + cos θ)/2)² alone, to ${(dev * 100).toFixed(1)}% (20 bins, 20,000 photons), as a wave 500 times the slits' size does`, '1.27 (19) visible: ' + JSON.stringify(H));
};

/* ---- 4. X-ray diffraction: a square lattice 3 Å apart, λ 1.2 Å: at the Bragg angle the scattered light leaves at 2θ
   (23.1°), and the rate falls off the angle; a gas scatters at the random-phase rate */
PARTS.bragg = async (page, check, say) => {
  const X = fresh(); X.RP.pwave = true; const W = X.W;
  const a = 3.0, at = []; for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) at.push(X.addAtom('Ar', i * a, j * a, { T: 0 }));
  for (const p of at) { p.vx = p.vy = 0; } X.gridTouch(); X.forcesNoEvents();
  const lam = 1.2, E = 10 * X.PHYS.HC / lam, thB = Math.asin(lam / (2 * a));
  const run = (inc, P) => { const ux = Math.sin(inc), uy = Math.cos(inc); let acc = 0; const dev = [];
    for (let i = 0; i < 2000; i++) { const r = X.waveBraggTry(P, E, ux, uy, null); if (r) { acc++; dev.push(Math.acos(Math.max(-1, Math.min(1, r[0] * ux + r[1] * uy))) * 180 / Math.PI); } }
    dev.sort((x, y) => x - y); return { kept: acc / 2000, med: dev.length ? dev[dev.length >> 1] : 0 }; };
  const on = run(thB, at[84]), off4 = run(thB + 4 * Math.PI / 180, at[84]), off10 = run(thB + 10 * Math.PI / 180, at[84]);
  const Y = fresh(5); Y.RP.pwave = true; const g = []; for (let i = 0; i < 169; i++) g.push(Y.addAtom('Ar', (Y.rnd() - 0.5) * 38, (Y.rnd() - 0.5) * 38, { T: 0 })); Y.gridTouch(); Y.forcesNoEvents();
  let gk = 0; for (let i = 0; i < 2000; i++) if (Y.waveBraggTry(g[0], E, 0, 1, null)) gk++;
  const r = { twoTheta: +(2 * thB * 180 / Math.PI).toFixed(2), on: { kept: +on.kept.toFixed(3), med: +on.med.toFixed(1) }, off4: +off4.kept.toFixed(3), off10: +off10.kept.toFixed(3), gas: +(gk / 2000).toFixed(3) };
  say('  1.27 (19) Bragg: ' + JSON.stringify(r));
  check(Math.abs(on.med - 2 * thB * 180 / Math.PI) < 1.5 && on.kept > 2 * off4.kept && off4.kept > off10.kept && on.kept > 2 * r.gas && r.gas > 0.01 && r.gas < 0.06 && W.parts.length > 100,
    `1.27 (19): X-rays (1.2 Å) on a square lattice 3 Å apart at the Bragg angle (11.5°) leave at ${r.on.med}° (2θ = ${r.twoTheta}°), scattering in ${(r.on.kept * 100).toFixed(1)}% of tries; 4° off ${(r.off4 * 100).toFixed(1)}%, 10° off ${(r.off10 * 100).toFixed(1)}%; the same atoms as a gas ${(r.gas * 100).toFixed(1)}% (random phases: 1 in 25)`,
    '1.27 (19) bragg: ' + JSON.stringify(r));
};

/* ---- 5. the books: X-rays through slits and a salt crystal, the energy all accounted (the photons keep theirs) */
PARTS.books = async (page, check, say) => {
  const X = load('all', { seed: 6 }), W = X.W; X.PRESETS.salt.build(); X.settleOverlaps(); W.gamma = 0; X.forcesNoEvents(); X.RP.pwave = true;
  X.objAdd('slits', -W.box.w / 2 + 6, -4, -W.box.w / 2 + 6, 4, { ns: 2, sd: 6, sa: 2 });
  const tot = () => X.totalEnergy().total - W.ledger.nuc - W.ledger.escaped, E0 = tot(), esc0 = W.ledger.escaped, n0 = X.WVB.n, E = 10 * X.PHYS.HC / 1.5;
  const ions = W.parts.filter(p => !p.dead && p.Z > 10), cy = ions.reduce((t, p) => t + p.y, 0) / ions.length;
  let fired = 0; for (let i = 0; i < 2000; i++) { X.emitPhoton(-W.box.w / 2 + 1, i < 300 ? (X.rnd() - 0.5) * 6 : cy + (X.rnd() - 0.5) * 10, E, 1, 0, {}); fired++; if (W.rays.length > 300) W.rays.length = 0; } // (300 through the slits, the rest past them straight into the crystal)
  const out = (W.ledger.escaped - esc0) / (fired * E), d = tot() - E0;
  check(Math.abs(d) < 1e-6 && out > 0.98 && X.WVB.n - n0 > 5, `1.27 (19): 2,000 X-rays (300 through slits) into a salt crystal (${X.WVB.n - n0} scattered by it): the rest of the books move ${d.toExponential(0)} eV, ${(out * 100).toFixed(1)}% of the light's energy leaves or is absorbed where it lands`, '1.27 (19) books: ' + JSON.stringify({ d, out, n: X.WVB.n - n0 }));
};

/* ---- 6. a saved slits piece comes back as it was */
PARTS.save = async (page, check, say) => {
  const X = fresh(); const ob = X.objMake('slits', 1, 2, 3, 40, { ns: 5, sd: 7, sa: 1.5 }), j = X.objToJSON(ob), b = X.objFromJSON(JSON.parse(JSON.stringify(j)));
  check(b && b.kind === 'slits' && b.ns === 5 && b.sd === 7 && b.sa === 1.5 && b.y1 === 40, '1.27 (19): a slits piece is saved and loaded with its openings (5, 7 Å apart, 1.5 Å wide)', '1.27 (19) save: ' + JSON.stringify({ j, b }));
};

/* ---- 7. switch off: setups as before, bit for bit (tools/fingerprint.js) */
const FP = { prism: '4ffe98af books a9f2ee3a 0', flame: '35e1ec46 books 357b2f4f 48', neon: '8b728a7d books eca8b1e2 84', photonuc: '82991d34 books a4742e49 84', salt: null };
PARTS.fp = async (page, check, say) => {
  const keys = Object.keys(FP).filter(k => FP[k]);
  const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'tools', 'fingerprint.js'), ...keys], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const bad = [];
  for (const line of out.split('\n')) { const m = line.trim().split(/\s+/); if (m.length < 2 || !FP[m[0]]) continue; const got = m.slice(1).join(' '); if (got !== FP[m[0]]) bad.push(`${m[0]} ${got} (before ${FP[m[0]]})`); }
  check(!bad.length, `1.27 (19): switch off, the setups with light as before (fingerprints of ${keys.join(', ')}; all 60 checked when it was built)`, '1.27 (19) fp: ' + JSON.stringify(bad));
};

/* ---- 8. Settings and the Objects tool: the line, off at start; Slits offered only with it on */
PARTS.settings = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); loadPreset('empty'); setRunning(false);
    const o = { start: [SET.rpPwave, RP.pwave].join() };
    setTool('objects'); o.offList = [...document.querySelectorAll('[data-g="kind"] [data-v]')].map(b => b.dataset.v).includes('slits');
    openSettings('exp'); await new Promise(res => setTimeout(res, 60));
    const line = $('setRpPwave').closest('.rpl'); o.tag = !!line.querySelector('.cost-k'); o.h = Math.round(line.getBoundingClientRect().height);
    setPrevShow('setRpPwave', null); o.pane = $('setPrevT').textContent; o.desc = !!SDESC.setRpPwave && !!SDESC3.setRpPwave;
    $('setRpPwave').click(); o.on = [SET.rpPwave, RP.pwave].join(); o.saved = String(JSON.parse(store('settings')).rpPwave); hideModal('setModal');
    o.onList = [...document.querySelectorAll('[data-g="kind"] [data-v]')].map(b => b.dataset.v).includes('slits');
    OPT.objects.kind = 'slits'; buildToolOpts(); o.opts = $('toolopts').textContent.slice(0, 160);
    openSettings('exp'); await new Promise(res => setTimeout(res, 60)); $('setRpPwave').click(); o.off = [SET.rpPwave, RP.pwave].join(); hideModal('setModal');
    return o;
  });
  say('  1.27 (19) settings: ' + JSON.stringify(r));
  check(r.start === 'false,false' && !r.offList && r.tag && r.h < 34 && r.pane === 'Photons as waves' && r.desc && r.on === 'true,true' && r.saved === 'true' && r.onList && /Slits/.test(r.opts) && r.off === 'false,false',
    '1.27 (19): Settings → Experimental → Realistic particles → Photons as waves: off at start, its tag and pane, saved; the Objects tool offers Slits only with it on (count, width, spacing)', '1.27 (19) settings: ' + JSON.stringify(r));
};
PARTS.settings.page = true;

module.exports = async function f127w(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (1.27 (19) ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.27 (19) ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 feature 19 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
