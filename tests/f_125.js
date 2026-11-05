'use strict';
/* The 1.25 checks, run by t_features (its "1.25" block) or alone: node tests/f_125.js [part …]
   (parts: hexazine, settings, bo6, bo3d). (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const TABS = ['perf', 'gfx', 'disp', 'ctl', 'gen', 'd3', 'ai', 'exp'];

/* ---- 1. hexazine with quantum bonds (an investigation; nothing in the physics changed): GFN1-xTB's own barrier on the
   in-plane N₆ → 3 N₂ path (D₃h, single points at the scan's relaxed geometries), and the ring breaking in the game's
   quantum bonds once hot. A record of what was found: it passes on 1.24 too. */
PARTS.hexazine = async (page, check, say) => {
  const X = load('all', { seed: 1 }), Z6 = [7, 7, 7, 7, 7, 7];
  const ring = (s, l) => { // a hexagon of alternating sides s, l, all angles 120° (D₃h)
    let lo = 0.01, hi = 59.99; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (Math.sin(m * Math.PI / 180) / Math.sin((60 - m) * Math.PI / 180) < s / l) lo = m; else hi = m; }
    const h = (lo + hi) / 2, R = s / (2 * Math.sin(h * Math.PI / 180)), out = [];
    for (let i = 0; i < 3; i++) for (const sg of [-1, 1]) { const t = (120 * i + sg * h) * Math.PI / 180; out.push([R * Math.cos(t), R * Math.sin(t), 0]); }
    return out;
  };
  const E = (g) => X.XTB.gfn1Energy(Z6, g, 0, 0, {}).E + X.XTB.d3Disp(Z6, g, {}).E;
  const e6 = E(ring(1.296, 1.296)), ets = E(ring(1.170, 1.60)), e3 = E(ring(1.0985, 4.0));
  const barrier = +(ets - e6).toFixed(3), release = +(e6 - e3).toFixed(3);
  // the game: six N atoms in the ring, quantum bonds, insulated from 3,000 K: three N₂ within 0.1 ps
  const G = load('all', { seed: 1 }), W = G.W; G.PRESETS.empty.build(); G.setBox(30, 30);
  for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; G.addAtom('N', 1.296 * Math.cos(t), 1.296 * Math.sin(t), { T: 3000 }); }
  W.gamma = 0; G.forcesNoEvents(); G.boSet(2); G.forcesNoEvents(); W.fSpawn = W.spawned;
  let broke = -1; for (let i = 0; i < 400 && broke < 0; i++) { W.dt = G.chooseDt(); G.step(W.dt); const pq = G.XQ.pq; if (pq.filter(q => q.n > 1.5).length === 3 && pq.filter(q => q.n > 0.5).length === 3) broke = W.t * G.PHYS.TU_S * 1e12; }
  check(barrier > 0.45 && barrier < 0.6 && release > 1.5 && release < 1.9 && broke > 0 && broke < 0.1,
    `1.25: hexazine with quantum bonds: GFN1-xTB itself gives the flat ring a barrier of ${barrier} eV on the way to 3 N₂ (D₃h, long N···N 1.60 Å) and releases only ${release} eV (real: about 9–10 eV), so it holds at room temperature; from 3,000 K it falls apart into three N₂ in ${broke.toFixed(3)} ps`,
    '1.25 hexazine: ' + JSON.stringify({ barrier, release, broke }));
};

/* ---- 2. Settings: a setting's description in the side pane only (the owner: "it repeats the description in the settings
   menu, but it's supposed to be in the sidebar only"); live readouts stay under their rows; on a narrow screen (the pane a
   short strip on top) the descriptions stay in the list, which no longer runs off the right edge */
PARTS.settings = async (page, check, say, openPage) => {
  const look = (pg) => pg.evaluate(async (TABS) => {
    const out = { tabs: {} };
    for (const t of TABS) {
      openSettings(t); await new Promise(r => setTimeout(r, 60));
      const b = document.querySelector('#setModal .sbox'), vis = (n) => !!n.offsetParent && n.textContent.trim() !== '';
      const notes = [...document.querySelectorAll('#setModal .spane:not([hidden]) > p.note')];
      out.tabs[t] = { desc: notes.filter(n => vis(n) && !n.hasAttribute('aria-live') && !['expReset', 'set3dNote', 'set3dKeys'].includes(n.id)).length, over: b.scrollWidth - b.clientWidth };
    }
    openSettings('exp'); setPrevShow('segBo', '1'); await new Promise(r => setTimeout(r, 60));
    const pn = $('setPrevD').querySelector('.sprev-notes');
    out.paneNotes = pn ? [...pn.querySelectorAll('p.note')].length : 0; out.paneShown = !!(pn && pn.offsetParent);
    openSettings('perf'); setPrevShow('segThreads', null); await new Promise(r => setTimeout(r, 60));
    out.live = ['setPrioV', 'setThreads'].map(id => !!$(id).offsetParent && $(id).textContent.trim() !== '');
    out.liveInPane = /Threads|thread/.test($('setPrevD').querySelector('.sprev-notes') ? $('setPrevD').querySelector('.sprev-notes').textContent : '');
    $('setModal').hidden = true; return out;
  }, TABS);
  const wide = await look(page);
  const { browser, page: narrowPage } = await openPage({ viewport: { width: 390, height: 844 }, settle: 600 });
  const narrow = await look(narrowPage); await browser.close();
  say('  settings: ' + JSON.stringify({ wide, narrow }));
  const sum = (o, k) => TABS.reduce((s, t) => s + o.tabs[t][k], 0), worst = (o) => Math.max(...TABS.map(t => o.tabs[t].over));
  check(sum(wide, 'desc') === 0 && wide.paneNotes >= 2 && wide.paneShown && wide.live.every(Boolean) && !wide.liveInPane && sum(narrow, 'desc') >= 10 && !narrow.paneShown && worst(narrow) <= 1,
    `1.25: Settings at 1360 px: no description under any setting in the 8 tabs, the side pane shows them (bond orders: ${wide.paneNotes} notes), live readouts (priority, threads) stay under their rows; at 390 px (the pane a short strip) the ${sum(narrow, 'desc')} descriptions stay in the list and none runs off its right edge (worst ${worst(narrow)} px)`,
    '1.25 settings: ' + JSON.stringify({ wide, narrow }));
};

module.exports = async function f125(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.25 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.25 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
