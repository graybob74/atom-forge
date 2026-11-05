'use strict';
/* The 1.23.2 checks, run by t_features (its "1.23.2" block) or alone: node tests/f_1232.js. Each fails on 1.23.1.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const path = require('path');
module.exports = async function f1232(page, check, say, openPage) {
  const SHOT_DIR = process.env.AF_SHOTS || null; // (screenshots, when a folder is given)
  // ---- Performance mode is gone (the owner: "obsolete"); the settings it set stay; old stored keys are dropped
  await page.evaluate(() => { localStorage.setItem('atomforge.settings', JSON.stringify(Object.assign({}, SET, { maxParts: 12000, res: 'standard', effects: false, budget: 10, prePerf: { maxParts: 4000, res: 'sharp', budget: 16, effects: true }, perf: true, ultra: true }))); });
  await page.reload(); await page.waitForTimeout(900);
  const pf = await page.evaluate(() => { setSetting('perf', false); const st = JSON.parse(localStorage.getItem('atomforge.settings')); return { el: !!document.getElementById('setPerf'), stray: Object.keys(SET).filter(k => !(k in SET_DEF)), stored: Object.keys(st).filter(k => !(k in SET_DEF)), max: MAX_PARTS, res: SET.res, fx: SET.effects, lite: R.lite, title: $('bSettings').title, sdesc: 'setPerf' in SDESC, fn: typeof perfOn }; });
  check(!pf.el && !pf.stray.length && !pf.stored.length && pf.max === 12000 && pf.res === 'standard' && !pf.fx && pf.lite && !/performance/i.test(pf.title) && !pf.sdesc && pf.fn === 'undefined',
    `1.23.2: Performance mode gone: no checkbox or description; a stored settings object that had it on keeps its values (12,000 particles, standard drawing, no glows) and drops prePerf/perf`, '1.23.2 performance mode: ' + JSON.stringify(pf));
  // ---- the ultra-realistic mode in the Experimental tab: back to normal at each start (it was on in the stored settings above)
  const ul = await page.evaluate(() => ({ tab: $('setUltra').closest('.spane').dataset.stab, on: SET.ultra, w: !!W.ultra, exp: SET_EXP.includes('ultra'), badge: $('ultraBadge').title, d: SDESC.setUltra[1] }));
  check(ul.tab === 'exp' && !ul.on && !ul.w && ul.exp && /Experimental/.test(ul.badge) && /starts/.test(ul.d), `1.23.2: Ultra-realistic is in Settings → Experimental and starts off (stored on before the reload)`, '1.23.2 ultra: ' + JSON.stringify(ul));
  // ---- "On hold: very large" gone from the Experimental tab
  const oh = await page.evaluate(() => /On hold|Real 3-D<\/b>: estimated/.test(document.querySelector('.spane[data-stab="exp"]').innerHTML));
  check(!oh, '1.23.2: the Experimental tab no longer lists 3-D and quantum chemistry as on hold (both done)', '1.23.2 on hold note still there');
  // ---- the 3-D bar: a Preview label, no Leave button
  const lv = await page.evaluate(() => { loadPreset('mol3d'); return { leave: !!document.getElementById('bLeave3d'), tag: !$('tag3d').hidden && /Preview/.test($('tag3d').textContent) && !/Leave/.test($('tag3d').textContent), btn: $('tag3d').tagName }; });
  check(!lv.leave && lv.tag && lv.btn !== 'BUTTON', '1.23.2: the 3-D lab\'s bar has a "3-D Preview" label and no Leave button', '1.23.2 3-D bar: ' + JSON.stringify(lv));
  // ---- flying the 3-D camera: W forward, A/D sideways, E up, Space up while flying (alone it still pauses), S/E free for flying, Spark on Z
  await page.evaluate(() => { loadPreset('water3d'); setRunning(false); setTool('inspect'); cam3Fit(); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await page.mouse.move(500, 400); await page.waitForTimeout(100);
  const c0 = await page.evaluate(() => ({ ...R.cam3 }));
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w'); await page.waitForTimeout(350);
  const c1 = await page.evaluate(() => ({ ...R.cam3, tool: UI.tool, run: UI.running }));
  await page.keyboard.down('d'); await page.waitForTimeout(300); await page.keyboard.down('Space'); await page.waitForTimeout(300); await page.keyboard.up('Space'); await page.keyboard.up('d'); await page.waitForTimeout(350);
  const c2 = await page.evaluate(() => ({ ...R.cam3, tool: UI.tool, run: UI.running }));
  await page.keyboard.press('z'); const tz = await page.evaluate(() => UI.tool); await page.keyboard.press('x'); const tx = await page.evaluate(() => UI.tool);
  await page.keyboard.press('Space'); const run = await page.evaluate(() => { const r = UI.running; setRunning(false); return r; });
  const typing = await page.evaluate(async () => { const c = { ...R.cam3 }; $('molSearch') ; const inp = document.createElement('input'); document.body.appendChild(inp); inp.focus(); return c; });
  await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w');
  const ct = await page.evaluate(() => { const c = { ...R.cam3 }; document.activeElement.remove(); return c; });
  const dist = (a, b) => Math.hypot(a.tx - b.tx, a.ty - b.ty, a.tz - b.tz);
  const cp = Math.cos(c0.pitch), fwd = [-cp * Math.sin(c0.yaw), -Math.sin(c0.pitch), -cp * Math.cos(c0.yaw)], d1 = [c1.tx - c0.tx, c1.ty - c0.ty, c1.tz - c0.tz], L1 = Math.hypot(...d1);
  const along = L1 ? (d1[0] * fwd[0] + d1[1] * fwd[1] + d1[2] * fwd[2]) / L1 : 0;
  const fly = { moved: +L1.toFixed(1), along: +along.toFixed(3), dist: +c0.dist.toFixed(1), up: +(c2.ty - c1.ty).toFixed(1), side: +dist(c2, c1).toFixed(1), tool: c1.tool, run1: c1.run, run2: c2.run, tz, tx, run, typing: +dist(ct, typing).toFixed(3), yaw: c1.yaw === c0.yaw };
  check(fly.moved > 8 && fly.along > 0.999 && fly.up > 2 && fly.side > fly.up && !fly.run1 && !fly.run2 && fly.tool === 'inspect' && tz === 'spark' && tx === 'erase' && run && fly.typing === 0 && fly.yaw,
    `1.23.2: 3-D flying: W held 0.5 s moved the camera ${fly.moved} Å straight ahead (view ${fly.dist} Å off), D + Space moved it right and ${fly.up} Å up without pausing; Space alone pauses; Spark on Z, Erase on X; nothing moves while a text field has the keys`, '1.23.2 flying: ' + JSON.stringify(fly));
  const keys = await page.evaluate(() => { openKeys(); const t = $('keysList').textContent; hideModal('keysModal'); return { t: /Fly forward/.test(t) && /Z \/ X/.test(t), help: /W<\/kbd> <kbd>A<\/kbd> <kbd>S<\/kbd> <kbd>D<\/kbd> fly/.test($('helpModal').innerHTML), set3: !!$('set3dKeys') }; });
  check(keys.t && keys.help && keys.set3, '1.23.2: the flying keys are in the shortcut list, Help and Settings → 3-D', '1.23.2 flying keys documented: ' + JSON.stringify(keys));
  // ---- the axis marker and the scale bar clear of the tool's options bar (the owner: only the tips of y and x showed)
  const ax = [];
  for (const [pre, wv] of [['mol3d', 1360], ['mol3d', 700], ['water', 1360]]) {
    await page.setViewportSize({ width: wv, height: 860 }); await page.waitForTimeout(250);
    ax.push(await page.evaluate(async ([pre]) => {
      loadPreset(pre); setRunning(false); setTool('place'); selectSpec({ kind: 'mol', mol: 'N2' }); await new Promise(r => setTimeout(r, 350)); render(W.rt);
      const c = R.cv.getBoundingClientRect(), b = $('tooloptsHS').getBoundingClientRect(), barTop = b.top - c.top, ins = chamberBottomInset();
      const axesBottom = W.d3 ? R.h - 58 - ins + 28 : -Infinity, scaleBottom = R.h - 18 - ins + 6; // (the marker reaches 28 px from its centre with its letters; the bar 4 px under its line, the text 4)
      return { pre, w: innerWidth, barTop: +barTop.toFixed(1), axesBottom: +axesBottom.toFixed(1), scaleBottom: +scaleBottom.toFixed(1), ok: axesBottom <= barTop && scaleBottom <= barTop };
    }, [pre]));
    if (SHOT_DIR) { const c = await page.evaluate(() => { const r = R.cv.getBoundingClientRect(); return { x: r.left, y: r.top + r.height - 160, width: 380, height: 160 }; }); await page.screenshot({ path: path.join(SHOT_DIR, `1232-axes-${pre}-${wv}.png`), clip: c }); }
  }
  await page.setViewportSize({ width: 1360, height: 860 }); await page.waitForTimeout(200);
  check(ax.every(a => a.ok), `1.23.2: the 3-D axis marker and the scale bar sit above the tool's options bar (${ax.map(a => `${a.pre} at ${a.w} px: bar top ${a.barTop}, marker to ${a.axesBottom}, scale to ${a.scaleBottom}`).join('; ')})`, '1.23.2 corner marks: ' + JSON.stringify(ax));
  // ---- a Settings picture enlarged: it grows out of the preview, Esc puts it back
  const lb = await page.evaluate(async () => {
    setSetting('motion', true); loadPreset('empty'); openSettings('gfx'); setPrevShow('segAtom', null); await new Promise(r => setTimeout(r, 250));
    const th = $('setPrevImg'), r0 = th.getBoundingClientRect(), nat = [th.naturalWidth, th.naturalHeight];
    th.click(); const s = $('shotBoxImg').getBoundingClientRect();
    await new Promise(r => setTimeout(r, 450)); const e = $('shotBoxImg').getBoundingClientRect();
    return { open: !$('shotBox').hidden, start: [s.left - r0.left, s.top - r0.top, s.width - r0.width, s.height - r0.height].map(v => +v.toFixed(1)), end: [e.width, e.height].map(v => +v.toFixed(0)), win: [innerWidth, innerHeight], nat, focus: document.activeElement.id };
  });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const lb2 = await page.evaluate(() => ({ hidden: $('shotBox').hidden, settings: !$('setModal').hidden, focus: document.activeElement.id }));
  await page.evaluate(() => { $('setPrevImg').focus(); }); await page.keyboard.press('Enter'); await page.waitForTimeout(50);
  const lb3 = await page.evaluate(() => { const o = !$('shotBox').hidden; $('shotBoxX').click(); return o; }); await page.waitForTimeout(300);
  await page.evaluate(() => hideModal('setModal'));
  check(lb.open && lb.start.every(v => Math.abs(v) < 1.5) && lb.end[0] > 0.9 * Math.min(lb.win[0], (lb.win[1] - 60) * 16 / 9) && lb.nat[0] === 1280 && lb.focus === 'shotBoxX' && lb2.hidden && lb2.settings && lb2.focus === 'setPrevImg' && lb3,
    `1.23.2: a Settings picture (${lb.nat.join(' × ')}) opens large on a click: it starts on the thumbnail (off by ${lb.start.join(', ')} px) and grows to ${lb.end.join(' × ')} px in a ${lb.win.join(' × ')} window; Esc closes it (Settings stays open), Enter opens it from the keyboard, × closes it`, '1.23.2 enlarged picture: ' + JSON.stringify([lb, lb2, lb3]));
  // ---- fast particles leave a closed 3-D box (Node): a 1 MeV proton, a 5 MeV α, a 50 keV electron stopped in the wall,
  //      a 100 keV uranium recoil set back at the wall's temperature, a 2 MeV neutron by the Container setting; the books exact
  const { load } = require('./load.js');
  const wall3 = (kind, opt = {}) => {
    const X = load('all', { seed: 1 }), W = X.W;
    X.PRESETS.d3empty.build(); W.gamma = 0; if (opt.nWall) W.nWall = opt.nWall; if (opt.wall) W.wall = opt.wall;
    for (let i = 0; i < 6; i++) X.addMolecule('H2O', -8 + 3.2 * i, 2, i, 300, 1.5 * i - 4); // (company, so the books include pairs)
    const p = kind === 'p' ? X.addAtom('H', 0, 0, { charge: 1 }) : kind === 'a' ? X.addNuc(2, 2, 0, 0, 0) : kind === 'n' ? X.addNuc(0, 1, 0, 0, 0) : kind === 'e' ? X.addLepton(X.ELEC, 0, -3) : X.addAtom('U', 0, -4);
    const KE = { p: 1e6, a: 5e6, n: 2e6, e: 5e4, U: 1e5 }[kind];
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    X.setMotion(p, KE, 0.6, 0.48, 0, 0, 0.64);
    const E1 = X.totalEnergy().total;
    let steps = 0;
    for (; steps < 1500 && !p.dead; steps++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); if (kind === 'U' && X.keOf(p) < 50) break; }
    return { kind, dead: p.dead, steps, ke: +X.keOf(p).toPrecision(3), esc: +W.ledger.escaped.toPrecision(7), stops: W.count.wallStop, q: W.ledger.qWall + W.ledger.qOut, z: +p.z.toFixed(2), books: +(X.totalEnergy().total - E1).toFixed(3) };
  };
  const w3 = { p: wall3('p'), a: wall3('a'), e: wall3('e'), U: wall3('U'), n: wall3('n'), nFast: wall3('n', { nWall: 'fast' }), open: wall3('p', { wall: 'open' }) };
  say('  3-D walls: ' + JSON.stringify(w3));
  const ok = (r, E, q) => r.dead && r.stops === 1 && Math.abs(r.esc - E) < 1e-3 * E && r.q === q && Math.abs(r.books) < 0.05;
  check(ok(w3.p, 1e6, 1) && ok(w3.a, 5e6, 2) && ok(w3.e, 5e4, -1) && !w3.U.dead && w3.U.ke < 50 && Math.abs(w3.U.esc - 1e5) < 200 && Math.abs(w3.U.books) < 0.05 && !w3.n.dead && Math.abs(w3.n.z) <= 15 && w3.nFast.dead && w3.nFast.esc === 2e6 && w3.open.dead && w3.open.stops === 0 && Math.abs(w3.open.books) < 0.05,
    `1.23.2: fast particles leave a closed 3-D box: a 1 MeV proton, a 5 MeV α and a 50 keV electron stopped in the wall (escaped ${w3.p.esc}, ${w3.a.esc}, ${w3.e.esc} eV, books ${w3.p.books}, ${w3.a.books}, ${w3.e.books} eV), a 100 keV U recoil set back at the wall's temperature (${w3.U.ke} eV left), a 2 MeV neutron kept by a reflecting wall (z ${w3.n.z}) and let out when the Container lets fast ones go; an open box books what leaves (1.23.1: the proton and α bounced for ever, the neutron's depth never changed, an open box lost 1 MeV from the books)`, '1.23.2 3-D walls: ' + JSON.stringify(w3));
};
if (require.main === module) (async () => {
  const { openPage } = require('./browser');
  const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, openPage);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.23.2 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
