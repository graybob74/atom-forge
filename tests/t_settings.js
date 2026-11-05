'use strict';
/* Settings and the main menu (1.25, asked for by the user): the main menu's first screen (2-D or 3-D) and the way to
   each mode's menu and back; Settings' preview pane (a picture and a description of the setting under the pointer, on
   keyboard focus and on a tap), every row described, every picture decoding; the 3-D settings changing the view as
   they say; all of them kept across a reload; the narrow layout; and the size the pictures add to the page.
   node tests/t_settings.js */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage, pageFile } = require('./browser');
let fails = 0;
const check = (ok, msg, info) => { if (ok) console.log('  ok   ' + msg); else { fails++; console.log('  FAIL ' + msg + (info !== undefined ? '\n       ' + JSON.stringify(info).slice(0, 900) : '')); } };

async function menus() {
  const { browser, page, errors } = await openPage({ menu: true, settle: 1000 });
  const vis = (id) => page.evaluate((i) => { const e = $(i); return !!e && !e.hidden && e.offsetParent !== null; }, id);
  const st = async () => ({ choose: await vis('mmChoose'), m2: await vis('mmBtns'), m3: await vis('mmBtns3'), d3: await page.evaluate(() => !!W.d3), v: await page.evaluate(() => MMV.v) });
  const s0 = await st();
  check(s0.choose && !s0.m2 && !s0.m3 && !s0.d3, 'the main menu opens on the choice of 2-D or 3-D, a flat world behind it', s0);
  await page.evaluate(() => $('mmMode2d').click()); await page.waitForTimeout(250);
  const s1 = await st(), m2 = await page.evaluate(() => [...document.querySelectorAll('#mmBtns .btn')].filter(b => b.offsetParent).map(b => b.textContent.trim()));
  check(!s1.choose && s1.m2 && !s1.m3 && !m2.some(t => /3-D lab/.test(t)) && m2.some(t => /Experiments/.test(t)), `2-D leads to the 2-D menu (${m2.join(', ')}), without the 3-D entry`, { s1, m2 });
  await page.evaluate(() => document.querySelector('#mmBtns .mm-back').click()); await page.waitForTimeout(250);
  check((await st()).choose, 'its back button returns to the choice');
  await page.evaluate(() => $('mmMode3d').click()); await page.waitForTimeout(400);
  const s2 = await st(), m3 = await page.evaluate(() => [...document.querySelectorAll('#mmList3 [data-mmp]')].map(b => b.dataset.mmp));
  const want3 = await page.evaluate(() => Object.keys(PRESETS).filter(k => PRESETS[k].d3));
  check(!s2.choose && s2.m3 && s2.d3 && m3.length === 6 && m3.join() === want3.join(), `3-D leads to the 3-D menu over a 3-D world, listing the six 3-D setups (${m3.join(', ')})`, { s2, m3 });
  const yaw0 = await page.evaluate(() => R.cam3.yaw); await page.waitForTimeout(800); const yaw1 = await page.evaluate(() => R.cam3.yaw);
  check(Math.abs(yaw1 - yaw0) > 0.02 || await page.evaluate(() => MMP.still), `the 3-D world behind it turns (yaw ${yaw0.toFixed(3)} → ${yaw1.toFixed(3)})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const s3 = await st();
  check(s3.choose && !s3.d3, 'Esc goes back from the 3-D menu to the choice, a flat world behind it again', s3);
  // a 3-D setup from the 3-D menu; the Esc menu's Main menu comes back to the choice, where Continue says 3-D and the 3-D menu has Continue
  await page.evaluate(() => $('mmMode3d').click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#mmList3 [data-mmp="mol3d"]').click()); await page.waitForTimeout(400);
  const g = await page.evaluate(() => ({ menu: UI.menu, d3: W.d3, preset: UI.preset, n: W.parts.length }));
  await page.evaluate(() => { autosave(); openEscMenu(); document.querySelector('[data-esc="menu"]').click(); }); await page.waitForTimeout(400);
  const s4 = await st(), cont = await page.evaluate(() => ({ c0: !$('mmCont0').hidden, where: $('mmContWhere').textContent }));
  await page.evaluate(() => $('mmMode3d').click()); await page.waitForTimeout(300);
  const c3 = await page.evaluate(() => !$('mmContinue3').hidden);
  await page.evaluate(() => $('mmContinue3').click()); await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({ menu: UI.menu, d3: W.d3, preset: UI.preset, n: W.parts.length }));
  check(!g.menu && g.d3 && g.preset === 'mol3d' && s4.choose && cont.c0 && /3-D/.test(cont.where) && c3 && !back.menu && back.d3 && back.n === g.n,
    `a 3-D setup started from the 3-D menu; Esc → Main menu shows the choice with "Continue ${cont.where}"; the 3-D menu's Continue brings the same ${back.n} particles back`, { g, s4, cont, c3, back });
  check(errors.length === 0, 'no page errors in the menus', errors);
  await browser.close();
}

/* The fast path: Settings → General → Start with "Where I left off" skips the menu and puts the kept chamber back. */
async function fastPath() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.addInitScript(() => { window.AF_NO_PAUSE = true; });
  const page = await ctx.newPage(); await page.goto('file://' + pageFile()); await page.waitForTimeout(900);
  await page.evaluate(() => { hideMainMenu(); loadPreset('water3d'); UI.started = true; setSetting('start', 'last'); autosave(); });
  await page.reload(); await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({ menu: UI.menu, d3: W.d3, preset: UI.preset }));
  check(!r.menu && r.d3 && r.preset === 'water3d', 'Start with "Where I left off" still skips the menu and opens the kept 3-D chamber', r);
  await browser.close();
}

async function pane() {
  const { browser, page, errors } = await openPage({ settle: 900 });
  await page.evaluate(() => openSettings('gfx')); await page.waitForTimeout(200);
  const tab = await page.evaluate(() => ({ t: $('setPrevT').textContent, img: !$('setPrevImg').hidden }));
  check(tab.t === 'Graphics' && !tab.img, 'a tab opens on its overview in the preview pane (no picture)', tab);
  const show = () => page.evaluate(() => ({ t: $('setPrevT').textContent, d: $('setPrevD').textContent.trim(), src: $('setPrevImg').hidden ? '' : $('setPrevImg').src, ph: getComputedStyle($('setPrevPh')).display !== 'none', on: (document.querySelector('#setModal .sprev-on') || {}).dataset ? document.querySelector('#setModal .sprev-on').dataset.sk : null }));
  await page.hover('#segAtom', { position: { x: 5, y: 5 } }); await page.waitForTimeout(100);
  const h = await show(), want = await page.evaluate(() => SETSHOTS.segAtom);
  check(h.t === 'Atom size' && h.d.length > 40 && h.src === want && !h.ph && h.on === 'segAtom', `hovering Atom size shows its picture and "${h.d.slice(0, 60)}…", the placeholder gone, the row marked`, { ph: h.ph, t: h.t, d: h.d.slice(0, 80), src: h.src.slice(0, 40), on: h.on });
  // keyboard: focus moves to a checkbox
  await page.evaluate(() => $('setCvd').focus()); await page.waitForTimeout(50);
  const k = await show();
  check(k.t === 'Colour-blind friendly colours' && k.src === await page.evaluate(() => SETSHOTS.setCvd), 'keyboard focus on a setting shows it too', { t: k.t });
  await page.keyboard.press('Tab'); await page.waitForTimeout(50);
  const k2 = await show();
  check(k2.t === 'Particle trails', `Tab to the next setting shows it ("${k2.t}")`, k2.t);
  // a setting with nothing to show: the placeholder; one choice's own picture; the Experimental cost tags
  await page.evaluate(() => setTabS('gen')); await page.hover('#setAutosave'); await page.waitForTimeout(80);
  const n = await show();
  check(n.ph && !n.src && /kept/.test(n.d), 'a setting with nothing to see (autosave) shows the placeholder and its description', n);
  await page.evaluate(() => setTabS('exp')); await page.hover('#segBo [data-v="2"]'); await page.waitForTimeout(80);
  const bo = await page.evaluate(() => ({ src: $('setPrevImg').src, own: SETSHOTS['segBo:2'], costs: [...$('setPrevD').querySelectorAll('.oc')].map(e => e.textContent), note: $('setPrevD').querySelectorAll('p.note').length }));
  check(bo.src === bo.own && bo.costs.length === 3 && bo.costs.includes('×1000+') && bo.note >= 1, `pointing at Quantum shows its own picture; the description carries the cost tags (${bo.costs.join(', ')}) and the notes under the row`, bo);
  // every row has a description, every picture's key is a row, a row's choice or the menu's, and every picture decodes
  const all = await page.evaluate(async () => {
    const rows = setRows(), out = { rows: rows.length, missing: [], tabs: [], bad: [], keys: Object.keys(SETSHOTS) };
    for (const r of rows) { const k = setRowKey(r); const D = SDESC[k]; if (!D || !D[0] || D[1].length < 20) out.missing.push(k); }
    for (const b of document.querySelectorAll('.stabs [data-stab]')) if (!STAB_DESC[b.dataset.stab]) out.tabs.push(b.dataset.stab);
    const rowKeys = new Set(rows.map(setRowKey));
    for (const k of out.keys) {
      const [id, v] = k.split(':');
      if (!(rowKeys.has(id) && (v === undefined || $(id).querySelector(`[data-v="${v}"]`))) && !/^menu[23]d$/.test(k)) out.bad.push(k + ' (no such row)');
      const im = new Image(); im.src = SETSHOTS[k];
      try { await im.decode(); if (im.naturalWidth !== 640 || im.naturalHeight !== 360) out.bad.push(k + ` ${im.naturalWidth}×${im.naturalHeight}`); } catch (e) { out.bad.push(k + ' does not decode'); }
    }
    return out;
  });
  check(all.rows > 60 && !all.missing.length && !all.tabs.length, `every one of the ${all.rows} setting rows has a description, every tab an overview`, all);
  check(all.keys.length >= 25 && !all.bad.length, `all ${all.keys.length} pictures belong to a setting (or the menu) and decode at 640 × 360`, all.bad);
  check(errors.length === 0, 'no page errors in Settings', errors);
  await browser.close();
}

/* The 3-D settings change the view as they say. */
async function view3d() {
  const { browser, page, errors } = await openPage({ settle: 900 });
  await page.addStyleTag({ content: '#fpsBadge, #hint { visibility: hidden !important; }' });
  // field of view: at the same distance, a pair of atoms spans more of the screen through a narrower lens
  const fov = await page.evaluate(() => {
    baseWorld(30, 30, 300, 0); world3d(30); mode3dSync(); setRunning(false);
    const a = addAtom('Ar', -5, 0, { z: 0, T: 0 }), b = addAtom('Ar', 5, 0, { z: 0, T: 0 }); fitView();
    const span = () => { cam3Update(); const A = [0, 0, 0], B = [0, 0, 0]; proj3(a.x, a.y, a.z, A); proj3(b.x, b.y, b.z, B); return Math.hypot(A[0] - B[0], A[1] - B[1]); };
    const out = {}; for (const f of [30, 40, 70]) { setSetting('fov3', f); out[f] = span(); }
    out.expect = Math.tan(35 * Math.PI / 180) / Math.tan(15 * Math.PI / 180); setSetting('fov3', 40); return out;
  });
  check(fov[30] > fov[40] && fov[40] > fov[70] && Math.abs(fov[30] / fov[70] / fov.expect - 1) < 0.02, `field of view: two atoms 10 Å apart span ${fov[30].toFixed(0)} px at 30°, ${fov[40].toFixed(0)} at 40°, ${fov[70].toFixed(0)} at 70° (ratio ${(fov[30] / fov[70]).toFixed(2)}, tan ratio ${fov.expect.toFixed(2)})`, fov);
  // orthographic: the same offset at two depths lands at the same screen distance; perspective: not
  const orth = await page.evaluate(() => {
    const c = R.cam3; Object.assign(c, { yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0 });
    const off = (z) => { cam3Update(); const A = [0, 0, 0], B = [0, 0, 0]; proj3(0, 0, z, A); proj3(4, 0, z, B); return B[0] - A[0]; };
    const p = [off(10), off(-10)], s0 = R.s; setSetting('proj3', 'ortho'); const o = [off(10), off(-10)], s1 = R.s; const pick = pick3(R.w / 2 + 4 * R.s, R.h / 2); setSetting('proj3', 'persp');
    return { p, o, s0, s1 };
  });
  check(orth.p[0] / orth.p[1] > 1.2 && Math.abs(orth.o[0] / orth.o[1] - 1) < 0.02 && Math.abs(orth.s1 / orth.s0 - 1) < 1e-9, `orthographic: 4 Å drawn ${orth.o[0].toFixed(1)} px in front and ${orth.o[1].toFixed(1)} px behind (perspective ${orth.p[0].toFixed(1)} and ${orth.p[1].toFixed(1)}), the scale at the target unchanged`, orth);
  // fog, box, axes: what the view uses; the box and the axis marker gone from the picture when off (Canvas 2D: one canvas)
  const lit = async () => page.evaluate(() => { GL.on = false; render(W.rt); const c = R.cv, g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) n++; return n; });
  await page.evaluate(() => { cam3Fit(); });
  const L0 = await lit(); await page.evaluate(() => setSetting('box3', 'off')); const L1 = await lit(); await page.evaluate(() => { setSetting('box3', 'grid'); setSetting('axes3', false); }); const L2 = await lit();
  const fog = await page.evaluate(() => { const o = {}; for (const f of ['off', 'low', 'normal', 'high']) { setSetting('fog3', f); cam3Update(); o[f] = C3.fogK; } setSetting('fog3', 'normal'); setSetting('axes3', true); GL.on = true; return o; });
  check(L1 < L0 - 200 && L2 < L0 && fog.off === 0 && fog.low < fog.normal && fog.normal < fog.high, `box hidden: ${L0 - L1} fewer bright pixels; axis marker off: ${L0 - L2} fewer; depth fog off/low/normal/high = ${Object.values(fog).join('/')}`, { L0, L1, L2, fog });
  // labels: front atoms only, or all (three atoms on one line of sight)
  const lbl = await page.evaluate(() => {
    baseWorld(16, 16, 300, 0); world3d(16); mode3dSync(); setRunning(false); for (const z of [3, 0, -3]) addAtom('Ar', 0, 0, { z, T: 0 });
    Object.assign(R.cam3, { yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0, dist: 14 }); R.view.labels = true; GL.on = true;
    const real = labelOne3; let n = 0; labelOne3 = function (...a) { n++; return real.apply(this, a); };
    const count = () => { n = 0; render(W.rt); return n; };
    const front = count(); setSetting('lbl3', 'all'); const all = count(); setSetting('lbl3', 'front'); labelOne3 = real;
    return { front, all, gl: R.gl };
  });
  check(!lbl.gl || (lbl.front === 1 && lbl.all === 3), `labels: front atoms only labels ${lbl.front} of three atoms in a line, all atoms ${lbl.all}`, lbl);
  // turntable: the yaw turns by itself at the set rate; a drag is scaled by Orbit speed and turned round by Invert
  await page.evaluate(() => { setSetting('spin3', 18); }); const y0 = await page.evaluate(() => [R.cam3.yaw, performance.now()]);
  await page.waitForTimeout(1000); const y1 = await page.evaluate(() => [R.cam3.yaw, performance.now()]); await page.evaluate(() => setSetting('spin3', 0));
  const rate = (y1[0] - y0[0]) / ((y1[1] - y0[1]) / 1000) * 180 / Math.PI;
  check(rate > 12 && rate < 19, `turntable "faster": ${rate.toFixed(1)}° a second (set 18; frames headless can be late)`, { y0, y1 });
  const clip = await page.evaluate(() => { const b = $('cv').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const drag = async () => { const a = await page.evaluate(() => R.cam3.yaw); await page.mouse.move(clip.x, clip.y); await page.mouse.down({ button: 'right' }); for (let i = 1; i <= 5; i++) await page.mouse.move(clip.x + i * 20, clip.y); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(60); return await page.evaluate(() => R.cam3.yaw) - a; };
  const d1 = await drag(); await page.evaluate(() => setSetting('orbit3', 2)); const d2 = await drag(); await page.evaluate(() => setSetting('orbitInv', true)); const d3 = await drag(); await page.evaluate(() => { setSetting('orbit3', 1); setSetting('orbitInv', false); });
  check(d1 < 0 && Math.abs(d2 / d1 - 2) < 0.01 && Math.abs(d3 / d1 + 2) < 0.01 && !await page.evaluate(() => !$('qmenu').hidden), `a 100 px right-drag turns the yaw ${d1.toFixed(3)} rad; Orbit speed fast ${d2.toFixed(3)}; inverted ${d3.toFixed(3)}`, { d1, d2, d3 });
  // the flat game is not touched: a 2-D frame with every 3-D setting changed is the same picture
  const flat = await page.evaluate(() => {
    loadPreset('water'); setRunning(false); R.view.hbonds = false; render(W.rt); const snap = () => R.cv.toDataURL();
    const a = snap(); for (const [k, v] of [['fov3', 70], ['proj3', 'ortho'], ['fog3', 'off'], ['box3', 'off'], ['axes3', false], ['lbl3', 'all']]) setSetting(k, v); render(W.rt); const b = snap();
    for (const [k, v] of [['fov3', 40], ['proj3', 'persp'], ['fog3', 'normal'], ['box3', 'grid'], ['axes3', true], ['lbl3', 'front']]) setSetting(k, v); R.view.hbonds = true; return a === b;
  });
  check(flat, 'the 3-D settings leave a 2-D frame unchanged');
  check(errors.filter(e => !/willReadFrequently/.test(e)).length === 0, 'no page errors in the 3-D settings', errors); // (the warning about reading pixels back is this test's own)
  await browser.close();
}

/* Kept across a reload, as every setting is. */
async function persist() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.addInitScript(() => { window.AF_NO_MENU = true; window.AF_NO_PAUSE = true; });
  const page = await ctx.newPage(); await page.goto('file://' + pageFile()); await page.waitForTimeout(800);
  const want = { fov3: 55, proj3: 'ortho', fog3: 'high', box3: 'edges', axes3: false, lbl3: 'all', orbit3: 2, orbitInv: true, spin3: 6, atomScale: 0.7 };
  await page.evaluate(async (w) => { openSettings('d3'); for (const [k, v] of Object.entries(w)) { const seg = { fov3: 'segFov3', proj3: 'segProj3', fog3: 'segFog3', box3: 'segBox3', lbl3: 'segLbl3', orbit3: 'segOrbit3', spin3: 'segSpin3', atomScale: 'segAtom' }[k]; if (seg) $(seg).querySelector(`[data-v="${v}"]`).click(); } $('setAxes3').click(); $('setOrbitInv').click(); }, want);
  await page.reload(); await page.waitForTimeout(900);
  const got = await page.evaluate((w) => { const o = {}; for (const k in w) o[k] = SET[k]; o.V3 = Object.assign({}, V3); openSettings('d3'); o.pressed = [...document.querySelectorAll('[data-stab="d3"] .seg [aria-pressed="true"]')].map(b => b.dataset.v); o.axes = $('setAxes3').checked; o.inv = $('setOrbitInv').checked; return o; }, want);
  const same = Object.keys(want).every(k => got[k] === want[k]);
  check(same && got.V3.fov === 55 && got.V3.ortho && got.V3.fog === 0.8 && got.V3.box === 'edges' && !got.V3.axes && got.V3.lbl === 'all' && !got.axes && got.inv && got.pressed.join() === '55,ortho,high,edges,all,2,6',
    'the 3-D settings (and the others) are kept across a reload, applied to the view and shown in Settings', got);
  await browser.close();
}

/* Narrow windows and touch: the preview stacked above the settings; a tap on a row shows it. */
async function narrow() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.addInitScript(() => { window.AF_NO_MENU = true; window.AF_NO_PAUSE = true; });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + pageFile()); await page.waitForTimeout(900);
  await page.evaluate(() => openSettings('d3')); await page.waitForTimeout(250);
  const lay = await page.evaluate(() => { const a = $('setPrev').getBoundingClientRect(), b = document.querySelector('#setModal .sbox').getBoundingClientRect(), d = document.querySelector('#setModal .sdialog').getBoundingClientRect(); return { prevBottom: a.bottom, boxTop: b.top, prevH: a.height, boxH: b.height, dialogW: d.width, scrollW: document.documentElement.scrollWidth }; });
  check(lay.prevBottom <= lay.boxTop + 1 && lay.prevH < 140 && lay.boxH > 400 && lay.scrollW <= 390, `at 390 px the preview (${lay.prevH.toFixed(0)} px tall) sits above the settings (${lay.boxH.toFixed(0)} px), no sideways scroll`, lay);
  const row = await page.$('#segFog3'); const b = await row.boundingBox();
  await page.touchscreen.tap(b.x + 4, b.y + b.height / 2); await page.waitForTimeout(150);
  const t = await page.evaluate(() => ({ t: $('setPrevT').textContent, src: !$('setPrevImg').hidden && $('setPrevImg').src === SETSHOTS.segFog3 }));
  check(t.t === 'Depth fog' && t.src && !errors.length, `a tap on a row shows its preview ("${t.t}")`, { t, errors });
  await page.screenshot({ path: path.join(__dirname, '.tmp', 'settings-narrow.png') });
  await browser.close();
}

function size() {
  const gen = fs.statSync(path.join(__dirname, '..', 'src', 'setshots.gen.js')).size, page = fs.statSync(path.join(__dirname, '..', 'dist', 'atom-forge.html')).size;
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'setshots.gen.js'), 'utf8'), n = (src.match(/data:image\/webp/g) || []).length;
  console.log(`  pictures: ${n} WebP, ${(gen / 1024).toFixed(0)} KB added to the page (${(page / 1048576).toFixed(2)} MB in all)`);
  check(gen < 600 * 1024, `the pictures add ${(gen / 1024).toFixed(0)} KB, under 600 KB`);
}

(async () => {
  const t0 = Date.now();
  await menus();
  await fastPath();
  await pane();
  await view3d();
  await persist();
  await narrow();
  size();
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(fails ? `${fails} settings failure(s)` : 'settings checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
