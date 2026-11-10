'use strict';
/* The checks for 1.31.0 (the owner, 2026-11-09, "build it"): planned items 70–75. Run by t_features (one line) or alone:
   node tests/f_131.js [part …]. Each part fails on 1.30.2. (check(ok, good, bad); say(...)) */
const PARTS = {};

PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  await page.setViewportSize({ width: 1600, height: 1000 });
  const r = await page.evaluate(async () => { try {
    const out = {}, raf = () => new Promise(res => requestAnimationFrame(res)), sleep = (ms) => new Promise(res => setTimeout(res, ms));
    const rowOf = (id) => { const i = $(id); return i && i.closest('label, .srow'); };
    const shown = (id) => { const r = rowOf(id); return !!r && !r.classList.contains('smode-hide'); };
    // 71: flat-game-only rows hidden in the 3-D lab, tagged "2-D exclusive" in the flat game
    loadPreset('empty'); $('bSettings').click(); setTabS('exp'); await sleep(150);
    out.s2 = { inc: shown('setInc'), pw: shown('setRpPwave'), tag: /2-D exclusive/.test(rowOf('setRpPwave').textContent) };
    // 75: All on / All off (flat game)
    $('rpAllOn').click(); out.on2 = ['rpPs', 'rpCpm', 'rpPwave', 'rpAq'].map(k => SET[k]); out.cost2 = $('rpAllCost').textContent;
    $('rpAllOff').click(); out.off2 = ['rpPs', 'rpCpm', 'rpPwave', 'rpAq'].map(k => SET[k]); $('setClose').click();
    loadPreset('d3empty'); $('bSettings').click(); setTabS('exp'); await sleep(150);
    out.s3 = { inc: shown('setInc'), pw: shown('setRpPwave'), zoom: shown('segZoomTo') };
    $('rpAllOn').click(); out.on3 = ['rpPs', 'rpPwave'].map(k => SET[k]); out.cost3 = $('rpAllCost').textContent; $('rpAllOff').click(); $('setClose').click();
    // 74: the box down to 5 Å, in 2-D and 3-D; a wrapping box too small for it turns solid and says why
    for (const k of ['empty', 'd3empty', 'water3d']) { loadPreset(k); const sl = $('boxSlider'); sl.value = 0; sl.oninput({ target: sl }); out['box_' + k] = [+W.box.tw.toFixed(2), W.d3 ? +W.box.td.toFixed(2) : 0, W.wall]; }
    out.boxLog = W.log.slice(-2).map(l => l.text).join(' ').slice(0, 120);
    // 73: Made here short; Show all opens the whole list in a window
    loadPreset('isolde'); for (let f = 0; f < 500; f++) simFrame(1 / 60, 20); showTab('data'); renderMade(); await raf();
    const nucRows = $('dMade').querySelectorAll('tr:not(.elh):not(.more)').length, btn = $('dMade').querySelector('[data-more]');
    btn.click(); await raf(); out.made = [nucRows, !!btn, !$('madeModal').hidden, $('dMadeAll').querySelectorAll('tr:not(.elh)').length];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.made.push($('madeModal').hidden);
    // 72: a chart opens larger, drawn at that size, zooms, closes
    const cv = [...document.querySelectorAll('canvas.chart.zoomable')].find(c => c.offsetParent && c.id === 'chSpec') || [...document.querySelectorAll('canvas.chart.zoomable')].find(c => c.offsetParent);
    cv.click(); await raf(); await raf(); await sleep(100);
    const big = $('chBig'), g = big.getContext('2d'), d = g.getImageData(0, 0, big.width, big.height).data; let ink = 0; for (let k = 3; k < d.length; k += 4) if (d[k]) ink++;
    const rb = $('chartBody').getBoundingClientRect(); $('chartBody').dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: rb.left + 100, clientY: rb.top + 100, bubbles: true, cancelable: true }));
    out.chart = [cv.id, !$('chartModal').hidden, big.width > cv.width, ink > 500, $('chBig').style.transform];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.chart.push($('chartModal').hidden);
    // 70: near the camera, a nucleus and an atom's cloud are seen as the camera turns (the flat pictures did not change)
    loadPreset('d3empty'); setRunning(false); W.parts.forEach(p => kill(p));
    placeSpec({ kind: 'atom', Z: 26, A: 56, bare: true }, 0, 0, 1); for (const p of W.parts) { p.z = 0; }
    const look = (v, yaw, pit) => { setAtomView(v); const c = R.cam3; c.tx = 0; c.ty = 0; c.tz = 0; c.dist = 4; c.yaw = yaw; c.pitch = pit; cam3Update(); R.orbBudget = 1e9; render(W.rt);
      const k = R.cv.width / R.cv.clientWidth, x = Math.round(R.cv.width / 2 - 40 * k), y = Math.round(R.cv.height / 2 - 40 * k), n = Math.round(80 * k);
      const cx = document.createElement('canvas'); cx.width = cx.height = n; cx.getContext('2d').drawImage(R.cv, x, y, n, n, 0, 0, n, n); return cx.getContext('2d').getImageData(0, 0, n, n).data; };
    const diff = (a, b) => { let s = 0; for (let k = 0; k < a.length; k += 4) s += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]); return s / (a.length / 4); };
    out.nuc3 = +diff(look('nuc', 0, 0.2), look('nuc', 1.2, 0.2)).toFixed(1);
    W.parts.forEach(p => kill(p)); placeSpec({ kind: 'atom', Z: 6, A: 12 }, 0, 0, 1); for (const p of W.parts) { p.z = 0; }
    out.orb3 = +diff(look('orb', 0, 0), look('orb', 0, 1.3)).toFixed(1);
    out.ring3 = +diff(look('on', 0, 0.1), look('on', 1.0, 0.1)).toFixed(1);
    return out; } catch (e) { return { err: e.stack.split('\n').slice(0, 3).join(' | ') }; } });
  if (own) await own.browser.close();
  if (r.err) { check(false, '', '1.31 page: ' + r.err); return; }
  check(r.s2.inc && r.s2.pw && r.s2.tag && !r.s3.inc && !r.s3.pw && !r.s3.zoom, '1.31 (71) flat-game-only settings hidden in the 3-D lab (detailed nuclear collisions, photons as waves, zoom toward), tagged "2-D exclusive" in the flat game', '1.31 settings by mode: ' + JSON.stringify([r.s2, r.s3]));
  check(r.on2.every(Boolean) && r.off2.every(v => !v) && /Charged particles in matter ×1–1\.3/.test(r.cost2) && r.on3[0] && !r.on3[1] && /Photon polarization/.test(r.cost3),
    `1.31 (75) Realistic particles: All on and All off set every switch shown (in 3-D not photons as waves); the cost of All on named ("${r.cost2.slice(0, 60)}")`, '1.31 all on/off: ' + JSON.stringify([r.on2, r.off2, r.cost2, r.on3, r.cost3]));
  check(r.box_empty[0] === 5 && r.box_d3empty[0] === 5 && r.box_d3empty[1] === 5 && r.box_water3d[2] === 'reflect' && /Walls made solid/.test(r.boxLog), '1.31 (74) the box down to 5 Å in the flat game and the 3-D lab; a wrapping box made too small for it turns solid and says why', '1.31 box: ' + JSON.stringify([r.box_empty, r.box_d3empty, r.box_water3d, r.boxLog]));
  check(r.made[0] <= 18 && r.made[1] && r.made[2] && r.made[3] > 100 && r.made[4], `1.31 (73) Made here: ${r.made[0]} rows in the panel (at most 12 nuclides and 6 kinds of particle), Show all opens all ${r.made[3]} rows in a window, Esc closes it`, '1.31 made here: ' + JSON.stringify(r.made));
  check(r.chart[1] && r.chart[2] && r.chart[3] && /scale\(1\.[0-9]/.test(r.chart[4]) && r.chart[5], `1.31 (72) a chart (${r.chart[0]}) opens larger in a window, drawn again at that size, zooms with the wheel, Esc closes it`, '1.31 chart window: ' + JSON.stringify(r.chart));
  check(r.nuc3 > 10 && r.orb3 > 10 && r.ring3 > 10, /* (1.30.2: 0.5, 1.1, 3.5) */ `1.31 (70) near the camera, atoms are drawn in 3-D: turning the camera changes a nucleus (${r.nuc3}), a cloud (${r.orb3}) and the shells (${r.ring3}) (mean colour change a pixel)`, '1.31 3-D atoms: ' + JSON.stringify([r.nuc3, r.orb3, r.ring3]));
};

module.exports = async function f131(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.31 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(null, check, say, null, process.argv.slice(2));
  say(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
