'use strict';
/* 1.37.1 (item 101, the owner, 2026-11-22). clear: a collider fires again only with its magnets and cavities clear (the
   linac's focusing magnets caught slow pions for good). qgp: the plasma's size in ångström, scaled by the zoom (true size
   in ultra-realistic mode). made: Made here lists e⁻, e⁺ and γ rays. page: no hourglass, one colour for the speed, the
   Made here buttons (a web page; find or put one in the box). Run by t_features or alone: node tests/f_1371.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
PARTS.clear = async (page, check) => {
  const X = load('all', { seed: 3, patch: s => s.replace('function refillSources(C) {', 'function refillSources(C) { if (globalThis.ONREFILL) globalThis.ONREFILL();').replace('C.clearT0 = null; return true; // (waited long enough)', 'C.clearT0 = null; globalThis.TIMED = true; return true; // (waited long enough)') }), W = X.W;
  X.PRESETS.linac.build(); X.setupCollider('linear', 'p', 'pbar', 1e11); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const Z = W.zones.filter(z => ['dipole', 'quad', 'cavity', 'kicker', 'sep'].includes(z.kind));
  const busy = () => { let n = 0; for (const p of W.parts) if (!p.dead && p.rad && !p.beam && !p.tgt && Z.some(q => X.zoneLocal(q, p.x, p.y))) n++; for (const o of W.exo) if (!o.dead && !o.xb && o.v > 0 && Z.some(q => X.zoneLocal(q, o.x, o.y))) n++; return n; };
  const at = []; globalThis.ONREFILL = () => { at.push(globalThis.TIMED ? 'waited 3 s' : busy()); globalThis.TIMED = false; };
  const t0 = Date.now(); for (let f = 0; f < 600 && Date.now() - t0 < 120000 && at.length < 4; f++) X.simFrame(1 / 60, 1e9);
  globalThis.ONREFILL = null;
  // (each fill with nothing left in the magnets and cavities, or after the longest wait, 3 s: slow pions the linac's
  // focusing magnets catch can stay; the owner kept the magnets acting on everything, 2026-11-22)
  check(at.length >= 2 && at.every(n => n === 0 || n === 'waited 3 s') && W.collider.hits > 0, `1.37.1 a 100 GeV linear collider fires again only once its magnets and cavities are clear, or after 3 s (fills: ${at.join(', ')}; ${W.collider.hits} collisions)`, `1.37.1 clear: products in the machine at each fill ${JSON.stringify(at)}, hits ${W.collider.hits}`);
};
PARTS.qgp = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W, R = X.R; X.PRESETS.empty.build();
  const g = { x: 0, y: 0, n: 900, sNN: 2e5, Bp: 394, age: 1.4 };
  const flat = X.qgpRadius(g), r1 = X.qgpDisc(g)[2]; R.s *= 2; const r2 = X.qgpDisc(g)[2];
  W.ultra = true; const u = X.qgpRadius(g); W.ultra = false; W.d3 = true; const d3 = X.qgpRadius(g); W.d3 = false;
  check(Math.abs(flat - 20) < 1e-9 && Math.abs(r2 / r1 - 2) < 1e-9 && Math.abs(d3 - 5) < 1e-9 && Math.abs(u - 2 * 1.2e-5 * Math.cbrt(394)) < 1e-12, `1.37.1 the plasma's size scales with the zoom (twice the zoom, twice as big): ${flat} Å in the flat game, ${d3} Å in 3-D, its true ${(u * 2e5).toFixed(1)} fm across in ultra-realistic mode`, `1.37.1 qgp: flat ${flat}, zoom ×2 → ${r2 / r1}, 3-D ${d3}, ultra ${u}`);
};
PARTS.made = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.lep.build(); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const t0 = Date.now(); for (let f = 0; f < 120 && Date.now() - t0 < 90000 && !(W.made && W.made.lep && W.made.lep.get('g') && W.made.lep.get('e-')); f++) X.simFrame(1 / 60, 1e9);
  const L = W.made && W.made.lep ? Object.fromEntries([...W.made.lep.values()].map(r => [r.lab, r.n])) : {};
  check(L['γ'] > 0 && (L['e⁻'] > 0 || L['e⁺'] > 0), `1.37.1 Made here counts electrons, positrons and γ rays: ${JSON.stringify(L)}`, `1.37.1 made: ${JSON.stringify(L)}`);
};
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1280, height: 860 }, settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms)), o = {};
    o.noGlass = !document.getElementById('bSlowmo');
    loadPreset('chain'); setRunning(true); await w(300); toggleSlowmo(); await w(400);
    const v = $('speedVal'); o.slow = !!W.slowSet; o.cls = [...v.classList].join(' '); toggleSlowmo(); await w(100);
    loadPreset('empty'); setRunning(false);
    W.made = { nuc: new Map([['20_28', { Z: 20, N: 28, anti: false, lab: '⁴⁸Ca', n: 1, how: 'test', t: 0 }]]), part: new Map([['mu-', { sp: 'mu-', lab: 'μ⁻', n: 2, how: 'test', t: 0 }]]), lep: new Map([['g', { key: 'g', lab: 'γ', n: 3, how: 'test', t: 0 }]]) };
    renderMade(); await w(50);
    const opened = []; const wo = window.open; window.open = (u) => { opened.push(u); return null; };
    const rows = [...$('dMade').querySelectorAll('button[data-card]')];
    for (const b of rows) b.click();
    window.open = wo;
    o.urls = opened; o.finds = $('dMade').querySelectorAll('button[data-find]').length; o.photons = /Photons/.test($('dMade').textContent);
    const n0 = W.exo.filter(x => !x.dead && x.sp === 'mu-').length;
    $('dMade').querySelector('button[data-find]:not([data-find="0"])') && [...$('dMade').querySelectorAll('button[data-find]')].find(b => UI.madeCards[+b.dataset.find].sp === 'mu-').click(); await w(100);
    o.muPlaced = W.exo.filter(x => !x.dead && x.sp === 'mu-').length - n0; o.follow = !!R.follow;
    return o;
  });
  const urlsOK = r.urls.some(u => /wikipedia\.org\/wiki\/Muon/.test(u)) && r.urls.some(u => /google\.com\/search\?q=calcium-48\+isotope/.test(u)) && r.urls.some(u => /wiki\/Calcium/.test(u)) && r.urls.some(u => /wiki\/Gamma_ray/.test(u));
  check(r.noGlass && r.slow && !/\b(cap|slow)\b/.test(r.cls) && urlsOK && r.finds >= 3 && r.photons && r.muPlaced === 1 && r.follow, `1.37.1 no hourglass, slow motion by \\ with the speed in one colour; Made here: i opens the web (${r.urls.length} pages: Muon, Calcium, a search for calcium-48, Gamma ray …), ⌖ put a μ⁻ in the box and the view follows it`, `1.37.1 page: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.37.1 page errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
module.exports = async function f1371(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.37.1 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
