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
  // ---- separate libraries: the 2-D one without the 3-D builds, the 3-D one without the flat objects; a molecule made for
  //      one mode only in that one; one kept before 1.23.2 (no mode) in both; the mode kept over a reload
  const lib = await page.evaluate(() => {
    const cards = () => [...document.querySelectorAll('#mgrid .mcard')].map(b => b.dataset.m);
    myMolAdd({ k: 'my1232a', n: 'Test for 3-D', r: 0, a: [['O', 0, 0], ['H', 0.76, 0.59], ['H', -0.76, 0.59]], b: [[0, 1, 1], [0, 2, 1]], m: '3d' });
    myMolAdd({ k: 'my1232b', n: 'Test for 2-D', r: 0, a: [['O', 0, 0], ['H', 0.76, 0.59], ['H', -0.76, 0.59]], b: [[0, 1, 1], [0, 2, 1]], m: '2d' });
    myMolAdd({ k: 'my1232c', n: 'Test kept before', r: 0, a: [['O', 0, 0], ['H', 0.76, 0.59], ['H', -0.76, 0.59]], b: [[0, 1, 1], [0, 2, 1]] });
    myMolsSave();
    loadPreset('empty'); MOL_UI.q = ''; MOL_UI.cat = ''; openMol(); const c2 = cards(); hideModal('molModal');
    loadPreset('mol3d'); openMol(); const c3 = cards(); const tag3 = !$('molTitle3').hidden; hideModal('molModal');
    const pal3 = selectSpec({ kind: 'mol', mol: 'transistor' }) === undefined && !(UI.spec && UI.spec.mol === 'transistor');
    loadPreset('empty'); selectSpec({ kind: 'mol', mol: 'goldnano3' }); const pal2 = !(UI.spec && UI.spec.mol === 'goldnano3');
    return { c2: c2.length, c3: c3.length, flatIn3: c3.filter(k => MOLECULES[k].cat === 'objects' && !MOLECULES[k].z), d3In2: c2.filter(k => MOLECULES[k].z), obj3: c3.filter(k => MOLECULES[k].z), mine2: ['my1232a', 'my1232b', 'my1232c'].filter(k => c2.includes(k)), mine3: ['my1232a', 'my1232b', 'my1232c'].filter(k => c3.includes(k)), plain: ['H2O', 'CH4', 'benzene', 'caffeine'].every(k => c2.includes(k) && c3.includes(k)), tag3, pal3, pal2, stored: JSON.parse(store('mymols')).filter(m => /^my1232/.test(m.k)).map(m => m.m || '-').join(','), aiMode: !!$('aiMode') };
  });
  await page.reload(); await page.waitForTimeout(900);
  lib.reload = await page.evaluate(() => { const o = ['my1232a', 'my1232b', 'my1232c'].map(k => MOLECULES[k] ? MOLECULES[k].mode || '-' : 'gone').join(','); openMolBuilder(); const am = $('aiMode').value; hideModal('bldModal'); loadPreset('mol3d'); openMolBuilder(); const am3 = $('aiMode').value; hideModal('bldModal'); for (const k of ['my1232a', 'my1232b', 'my1232c']) myMolRemove(k); loadPreset('empty'); return o + ' ' + am + am3; });
  check(!lib.flatIn3.length && !lib.d3In2.length && lib.obj3.length >= 5 && lib.mine2.join() === 'my1232b,my1232c' && lib.mine3.join() === 'my1232a,my1232c' && lib.plain && lib.tag3 && lib.pal3 && lib.pal2 && lib.stored === '3d,2d,-' && lib.aiMode && lib.reload === '3d,2d,- 2d3d',
    `1.23.2: separate libraries: 2-D ${lib.c2} entries (no 3-D builds), 3-D ${lib.c3} (no flat objects; ${lib.obj3.length} 3-D objects); molecules made for one mode only there, older ones in both, the mode kept over a reload; Ask Claude's 2-D / 3-D choice starts at the open mode`, '1.23.2 libraries: ' + JSON.stringify(lib));
  // ---- 3-D tiny objects: each goes into the empty 3-D box whole, as built, and holds at room temperature
  const o3 = await page.evaluate(async () => {
    const out = {};
    for (const k of Object.keys(MOLECULES).filter(k => MOLECULES[k].z)) {
      loadPreset('d3empty'); setRunning(false); const ps = placeSpec({ kind: 'mol', mol: k }, 0, 0, 1, 0);
      const nb = W.bonds.length; let zr = 0; for (const p of ps) zr = Math.max(zr, Math.abs(p.z));
      for (let i = 0; i < 150; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
      out[k] = { n: ps.length, want: MOLECULES[k].atoms.length, kept: W.parts.filter(p => !p.dead).length, bonds: [nb, W.bonds.length], depth: +zr.toFixed(1), T: Math.round(measure().T) };
    }
    loadPreset('water3d'); setRunning(false); const n0 = W.parts.length, ps = placeSpec({ kind: 'mol', mol: 'saltcrystal3' }, 0, 0, 1, 0); out.full = { placed: ps.length, same: W.parts.filter(p => !p.dead).length === n0 };
    return out;
  });
  const o3k = Object.keys(o3).filter(k => k !== 'full');
  check(o3k.length >= 5 && o3k.every(k => o3[k].n === o3[k].want && o3[k].kept === o3[k].want && o3[k].bonds[0] === o3[k].bonds[1] && o3[k].T < 600) && o3k.some(k => o3[k].depth > 5) && o3.full.placed === 0 && o3.full.same,
    `1.23.2: 3-D tiny objects (${o3k.map(k => `${k} ${o3[k].n} atoms, ${o3[k].depth} Å deep`).join('; ')}) go into the 3-D box whole and hold for 150 steps; into a full box (liquid water) none goes`, '1.23.2 3-D objects: ' + JSON.stringify(o3));
  // ---- the main menu's buttons keep still under the pointer: presses near their edges land (the owner: "take a few clicks")
  const mm = await (async () => {
    const m = await openPage({ settle: 1200, menu: true }), pg = m.page, out = {};
    await pg.evaluate(() => { window.__clk = []; document.addEventListener('click', (e) => { const b = e.target.closest('button'); window.__clk.push(b ? b.id : ''); }, true); mmAction = () => {}; });
    for (const [sel, side] of [['#mmMode2d', 'L'], ['#mmMode3d', 'R']]) {
      let ok = 0;
      for (let t = 0; t < 6; t++) {
        await pg.mouse.move(5, 5); await pg.waitForTimeout(120);
        const r = await pg.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }, sel);
        await pg.mouse.move(side === 'L' ? r[0] + 3 + t % 3 : r[0] + r[2] - 3 - t % 3, r[1] + r[3] / 2, { steps: 4 }); await pg.waitForTimeout(400);
        await pg.evaluate(() => { window.__clk = []; }); await pg.mouse.down(); await pg.waitForTimeout(90); await pg.mouse.up(); await pg.waitForTimeout(50);
        if ((await pg.evaluate(() => window.__clk)).includes(sel.slice(1))) ok++;
      }
      out[sel.slice(1)] = ok;
    }
    await m.browser.close(); return out;
  })();
  check(mm.mmMode2d === 6 && mm.mmMode3d === 6, `1.23.2: the main menu's 2-D and 3-D buttons take every press 3–5 px inside their edges (${mm.mmMode2d}/6, ${mm.mmMode3d}/6; 1.23.1: 7/12 and 0/12, the card sliding away from the pointer)`, '1.23.2 main menu presses: ' + JSON.stringify(mm));
  // ---- the chamber never scrolls (it could, by the WebGL canvas's 64 px margin, when something in it was scrolled into
  //      view: the chamber then sat 66 px off where the pointer is read, and a right-click on an atom missed it)
  const scr = await page.evaluate(() => { const st = document.querySelector('.stage'), l0 = R.cv.getBoundingClientRect().left; st.scrollLeft = 200; st.scrollTop = 200; const r = { sl: st.scrollLeft, st: st.scrollTop, moved: R.cv.getBoundingClientRect().left - l0 }; st.scrollLeft = 0; st.scrollTop = 0; return r; });
  check(!scr.sl && !scr.st && !scr.moved, '1.23.2: the chamber cannot be scrolled out from under the pointer (1.23.1: by 66 px)', '1.23.2 chamber scroll: ' + JSON.stringify(scr));
  // ---- the Gallery (and the other small dialogs) stack from the top: no rows spread over the window (1024 × 800)
  await page.setViewportSize({ width: 1024, height: 800 }); await page.waitForTimeout(250);
  const dl = {};
  for (const [id, open] of [['galModal', "$('bGallery').click()"], ['mineModal', 'openMine()'], ['askModal', "showModal('askModal')"]]) { // (Ask: its empty text box is a gap of its own; its height is checked)
    dl[id] = await page.evaluate(([id, f]) => { new Function(f)(); const d = $(id).querySelector('.dialog'), kids = [...d.querySelectorAll(':scope > header, :scope > section > *, :scope > :not(header):not(section)')].filter(e => e.offsetHeight && (e.textContent.trim() && e.tagName !== 'TEXTAREA') || e.querySelector('input,button'));
      const rs = kids.map(k => { const rg = document.createRange(); rg.selectNodeContents(k); return rg.getBoundingClientRect(); }); let gap = 0; for (let i = 1; i < rs.length; i++) gap = Math.max(gap, rs[i].top - rs[i - 1].bottom);
      return { h: Math.round(d.getBoundingClientRect().height), gap: Math.round(gap) }; }, [id, open]);
    if (SHOT_DIR && id === 'galModal') { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOT_DIR, '1232-gallery-1024.png') }); }
    await page.evaluate((id) => hideModal(id), id);
  }
  const sd = await page.evaluate(() => { openSettings(); const h = document.querySelector('#setModal .sdialog').getBoundingClientRect().height; hideModal('setModal'); return Math.round(h); });
  await page.setViewportSize({ width: 1360, height: 860 }); await page.waitForTimeout(200);
  check(dl.galModal.gap < 32 && dl.galModal.h < 400 && dl.mineModal.gap < 32 && dl.askModal.h < 500 && sd > 700,
    `1.23.2: the Gallery stacks from the top (${dl.galModal.h} px tall, rows at most ${dl.galModal.gap} px apart; 1.23.1: 804 px, 256 apart), and My experiments and Ask Claude for a setup too; Settings keeps its tall window (${sd} px)`, '1.23.2 dialogs: ' + JSON.stringify([dl, sd]));
  // ---- 3-D: lone ions drawn on the atoms' scale (the owner: "just draw ions smaller"; display only, the flat game as it was)
  const ion = await page.evaluate(() => {
    loadPreset('brine3d'); setRunning(false); render(W.rt);
    const cl = W.parts.find(p => p.Z === 17 && p.q < 0), na = W.parts.find(p => p.Z === 11 && p.q > 0), o = W.parts.find(p => p.Z === 8);
    const sty = (p) => +(GL_T.styA[4 * p.i] / R.as).toFixed(3);
    const out = { cl3: +rd3(cl).toFixed(2), na3: +rd3(na).toFixed(2), clAtom: +(0.3 + 0.28 * cl.el.rc).toFixed(2), naAtom: +(0.3 + 0.28 * na.el.rc).toFixed(2), o: +rd3(o).toFixed(2), gl: R.gl ? [sty(cl), sty(na)] : null };
    loadPreset('brine'); setRunning(false); render(W.rt); const cl2 = W.parts.find(p => p.Z === 17 && p.q < 0); out.cl2 = +cl2.rd.toFixed(2); out.gl2 = R.gl ? +(GL_T.styA[4 * cl2.i] / R.as).toFixed(3) : null;
    return out;
  });
  check(ion.cl3 > ion.clAtom && ion.cl3 < 0.72 && ion.na3 < ion.naAtom && ion.na3 < ion.cl3 && ion.cl2 === 1.09 && (!ion.gl || (Math.abs(ion.gl[0] - ion.cl3) < 0.01 && Math.abs(ion.gl[1] - ion.na3) < 0.01)) && (ion.gl2 === null || Math.abs(ion.gl2 - 1.09) < 0.01),
    `1.23.2: 3-D lone ions drawn on the atoms' scale: Cl⁻ ${ion.cl3} Å (a Cl atom ${ion.clAtom}; was 1.09), Na⁺ ${ion.na3} (a Na atom ${ion.naAtom}; was 0.61), the GL balls the same; the flat game's Cl⁻ still ${ion.cl2}`, '1.23.2 ion size: ' + JSON.stringify(ion));
  // ---- fast particles leave a closed 3-D box (Node): a 1 MeV proton, a 5 MeV α, a 50 keV electron stopped in the wall,
  //      a 100 keV uranium recoil set back at the wall's temperature, a 2 MeV neutron by the Container setting; the books exact
  const { load } = require('./load.js');
  const wall3 = (kind, opt = {}) => {
    const X = load('all', { seed: 1 }), W = X.W;
    X.PRESETS.d3empty.build(); W.gamma = 0; if (opt.nWall) W.nWall = opt.nWall; if (opt.wall) W.wall = opt.wall;
    if (!opt.alone) for (let i = 0; i < 6; i++) X.addMolecule('H2O', -8 + 3.2 * i, 2, i, 300, 1.5 * i - 4); // (company, so the books include pairs; the recoil and the neutrons alone: their collisions with water in 3-D keep the books to ~1 eV and ~50 eV, before and after 1.23.2)
    const p = kind === 'p' ? X.addAtom('H', 0, 0, { charge: 1 }) : kind === 'a' ? X.addNuc(2, 2, 0, 0, 0) : kind === 'n' ? X.addNuc(0, 1, 0, 0, 0) : kind === 'e' ? X.addLepton(X.ELEC, 0, -3) : X.addAtom('U', 0, -4);
    const KE = { p: 1e6, a: 5e6, n: 2e6, e: 5e4, U: 1e5 }[kind];
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    X.setMotion(p, KE, 0.6, 0.48, 0, 0, 0.64);
    const E1 = X.totalEnergy().total;
    let steps = 0;
    for (; steps < 1500 && !p.dead; steps++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); if (kind === 'U' && X.keOf(p) < 50) break; }
    return { kind, dead: p.dead, steps, ke: +X.keOf(p).toPrecision(3), esc: +W.ledger.escaped.toPrecision(7), stops: W.count.wallStop, q: W.ledger.qWall + W.ledger.qOut, z: +p.z.toFixed(2), books: +(X.totalEnergy().total - E1).toFixed(3) };
  };
  const w3 = { p: wall3('p'), a: wall3('a'), e: wall3('e'), U: wall3('U', { alone: true }), n: wall3('n', { alone: true }), nFast: wall3('n', { nWall: 'fast', alone: true }), open: wall3('p', { wall: 'open' }) };
  say('  3-D walls: ' + JSON.stringify(w3));
  const ok = (r, E, q) => r.dead && r.stops === 1 && Math.abs(r.esc - E) < 1e-3 * E && r.q === q && Math.abs(r.books) < 0.1;
  check(ok(w3.p, 1e6, 1) && ok(w3.a, 5e6, 2) && ok(w3.e, 5e4, -1) && !w3.U.dead && w3.U.ke < 50 && Math.abs(w3.U.esc - 1e5) < 200 && Math.abs(w3.U.books) < 0.05 && !w3.n.dead && Math.abs(w3.n.z) <= 15 && w3.nFast.dead && w3.nFast.esc === 2e6 && w3.open.dead && w3.open.stops === 0 && Math.abs(w3.open.books) < 0.1,
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
