'use strict';
/* The real page in headless Chromium, wrapped as publishing wraps it: it must load and run without a single error
   while every preset, tool, view, tab, slider, modal and builder is used. Also times frames per preset.
   node tests/t_page.js [--shots DIR]   (screenshots of a few states for a visual check) */
const path = require('path'), fs = require('fs');
const { openPage } = require('./browser');
const shotDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let fails = 0;
const say = (...a) => console.log(...a);
(async () => {
  const { browser, page, errors } = await openPage();
  page.setDefaultTimeout(15000); // (a click waits for the page to be idle enough to take it: on a loaded 2-core box a frame-filling simulation can hold it off for seconds)
  const T0 = Date.now();
  const check = (label) => {
    if (process.argv.includes('-v')) say(`  ${((Date.now() - T0) / 1000).toFixed(1)}s ${label}`); if (errors.length) { fails++; say('FAIL', label, '\n   ' + errors.slice(0, 4).join('\n   ').slice(0, 1500)); errors.length = 0; } };
  const shot = async (name) => { if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, name + '.png') }); } };
  const box = await page.locator('#cv').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const drag = async (a, b, steps = 8, hold = 0) => { await page.mouse.move(...a); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps); if (hold) await page.waitForTimeout(hold); await page.mouse.up(); };
  const tryClick = async (loc) => { try { if (await loc.isVisible() && await loc.isEnabled()) await loc.click({ timeout: 1000 }); } catch (e) { /* re-rendered or hidden: fine */ } };
  const isOpen = (m) => page.$eval('#' + m, (el) => !el.hidden);
  const closeModals = async () => {
    for (const [m, c] of [['nucModal', 'nucClose'], ['bldModal', 'bldClose'], ['molModal', 'molClose'], ['ptModal', 'ptClose'], ['setModal', 'setClose']]) {
      if (!(await isOpen(m))) continue;
      await tryClick(page.locator('#' + c));
      if (await isOpen(m)) { fails++; say('FAIL', m, 'did not close with its Close button'); await page.keyboard.press('Escape'); }
      if (await isOpen(m)) await page.$eval('#' + m, (el) => { el.hidden = true; });
    }
  };
  const clickCanvas = async (fx, fy) => { const p = at(fx, fy); await page.mouse.click(p[0], p[1]); };
  // 1. it runs: time advances and the chamber is drawn
  const t0 = await page.evaluate(() => W.t);
  await page.waitForTimeout(700);
  const t1 = await page.evaluate(() => W.t);
  if (!(t1 > t0)) { fails++; say('FAIL time does not advance', t0, t1); }
  const drawn = await page.evaluate(() => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 64) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) n++; return n / (d.length / 64); });
  const glBalls = await page.evaluate(() => (GL.on && GL.ok ? GL.balls : -1)); // (with the WebGL layer the balls are not on #cv: its counters say what it drew)
  if (!(drawn > 0.002 || glBalls > 0)) { fails++; say('FAIL chamber looks blank', drawn, glBalls); }
  check('page load');
  // 2. every preset runs; frame cost
  const presets = await page.$$eval('#preset option', (os) => os.map(o => o.value).filter(Boolean));
  const timing = [];
  for (const k of presets) {
    await page.selectOption('#preset', k);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => new Promise((res) => {
      const t0 = performance.now(), s0 = W.t; let n = 0, worst = 0, last = t0;
      const f = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (++n < 40) requestAnimationFrame(f); else res({ ms: (t - t0) / n, worst, simfs: (W.t - s0) * 10.18 / ((t - t0) / 1000), parts: W.parts.filter(p => !p.dead).length }); };
      requestAnimationFrame(f);
    }));
    timing.push([k, r]);
    check('preset ' + k);
  }
  say('presets:', timing.map(([k, r]) => `${k} ${r.ms.toFixed(0)}ms(${r.worst.toFixed(0)}) n${r.parts}`).join(' | '));
  // 3. every tool, used on the soup and on the gallery
  const tools = await page.$$eval('.tool', (bs) => bs.map(b => b.dataset.tool));
  for (const pre of ['soup', 'salt']) {
    await page.selectOption('#preset', pre);
    for (const t of tools) {
      await page.click(`.tool[data-tool="${t}"]`, { force: true }); // (force: the actionability wait for a "stable" box flaked under load; the button is there)
      await page.waitForTimeout(40);
      await drag(at(0.45, 0.5), at(0.55, 0.45), 6, t === 'heat' || t === 'pull' ? 250 : 0);
      await clickCanvas(0.3, 0.6);
      // the tool's own options: click each button and nudge each slider
      const n = await page.$$eval('#toolopts button', (bs) => bs.length);
      for (let i = 0; i < Math.min(n, 10); i++) await tryClick(page.locator('#toolopts button').nth(i));
      for (const s of await page.$$('#toolopts input[type=range]')) await s.evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); el.value = el.min; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await drag(at(0.5, 0.5), at(0.62, 0.55), 4);
      await page.waitForTimeout(60);
      check(`tool ${t} on ${pre}`);
    }
  }
  // 4. palette: every chip, then place
  await page.click('.tool[data-tool="place"]');
  const chips = await page.$$eval('#palette .chip', (cs) => cs.length);
  for (let i = 0; i < chips; i++) { await page.locator('#palette .chip').nth(i).click(); await clickCanvas(0.2 + 0.6 * (i / chips), 0.3); }
  await page.waitForTimeout(300);
  check('palette');
  // 5. views, colours, keyboard toggles
  await page.click('.tab[data-tab="lab"]');
  for (const v of ['on', 'off', 'orb', 'nuc', 'auto']) { await page.click(`#segBohr button[data-v="${v}"]`); await page.waitForTimeout(150); if (v === 'orb') await shot('orbitals'); }
  for (const b of await page.$$('#segColor button')) { await b.click(); await page.waitForTimeout(60); }
  for (const k of ['v', 'v', 'o', 'o', ' ', ' ', 'ArrowRight']) await page.keyboard.press(k === ' ' ? 'Space' : k);
  check('views');
  // 6. lab sliders, segments and checkboxes
  await page.click('.tab[data-tab="lab"]');
  for (const id of ['tSlider', 'bSlider', 'eSlider', 'boxSlider', 'spdSlider', 'warpSlider']) {
    for (const f of [1, 0, 0.5]) await page.$eval('#' + id, (el, f) => { el.value = String(+el.min + (el.max - el.min) * f); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, f);
    await page.waitForTimeout(120);
    check('slider ' + id);
  }
  for (const seg of ['segBath', 'segEdir', 'segWall']) for (const b of await page.$$(`#${seg} button`)) { await b.click(); await page.waitForTimeout(80); }
  for (const id of ['chkDecay', 'chkSlowmo']) { await page.click('#' + id); await page.waitForTimeout(80); await page.click('#' + id); }
  for (const id of ['bSlower', 'bFaster', 'bFaster', 'bPlay', 'bStep', 'bPlay', 'zIn', 'zOut', 'zFit', 'bMagClear', 'bSrcClear']) await tryClick(page.locator('#' + id));
  check('lab controls');
  // 6b. the colliders: beams, energy, injection, refill; slow motion and the decay close-ups toggled
  for (const pre of ['ring', 'linac']) {
    await page.selectOption('#preset', pre);
    await page.click('.tab[data-tab="lab"]');
    await page.waitForTimeout(200);
    if (await page.$eval('#gCollider', (g) => g.hidden)) { fails++; say('FAIL collider panel hidden on', pre); }
    const nb = await page.locator('#segBeams button').count();
    for (let i = 0; i < nb; i++) { await tryClick(page.locator('#segBeams button').nth(i)); await page.waitForTimeout(80); }
    for (const [a, b] of [['d', 't'], ['au197', 'p'], ['e', 'p'], ['pbar', 'p']]) { await page.selectOption('#cBeamA', a); await page.selectOption('#cBeamB', b); await page.waitForTimeout(150); }
    await page.$eval('#cNSlider', (el) => { el.value = '25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await tryClick(page.locator('#segBeams button').first());
    for (const f of [1, 0, -1]) await page.$eval('#cESlider', (el, f) => { el.value = String(f < 0 ? sFromCE(1.4e7) : +el.min + (el.max - el.min) * f); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, f); // (top, bottom, then 14 MeV)
    // the note offers the next threshold (e⁺e⁻ at 14 MeV each: muon pairs from 105 MeV each)
    if (await page.$('#cGo')) { const e0 = await page.evaluate(() => W.collider.E); await page.click('#cGo'); await page.waitForTimeout(150); const e1 = await page.evaluate(() => W.collider.E); if (!(e1 > e0)) { fails++; say('FAIL the go-to-threshold button did nothing on', pre, e0, e1); } else say(`  ${pre}: threshold button took the beams from ${(e0 / 1e6).toFixed(1)} to ${(e1 / 1e6).toFixed(1)} MeV`); }
    else { fails++; say('FAIL no go-to-threshold button for e⁺e⁻ at 14 MeV on', pre); }
    // each beam its own energy, then back to matched beams; the keep-apart setting (rings)
    await page.click('#chkEach'); await page.waitForTimeout(120);
    if (await page.$eval('#cE2Wrap', (e) => e.hidden)) { fails++; say('FAIL beam 2 energy slider hidden with separate energies on', pre); }
    for (const f of [1, 0.3]) await page.$eval('#cE2Slider', (el, f) => { el.value = String(+el.min + (el.max - el.min) * f); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, f);
    const e2 = await page.evaluate(() => W.collider.E2);
    if (!(e2 > 0)) { fails++; say('FAIL beam 2 energy not set from its slider', pre, e2); }
    await page.click('#chkEach'); await page.waitForTimeout(120);
    if (pre === 'ring') for (const v of ['apart', 'together', 'auto']) { await page.click(`#segSep button[data-v="${v}"]`); await page.waitForTimeout(80); if ((await page.evaluate(() => W.collider.sepMode)) !== v) { fails++; say('FAIL beams setting', v); } }
    await tryClick(page.locator('#bInject'));
    for (let i = 0; i < 2; i++) { await page.click('#chkRefill'); await tryClick(page.locator('#bSlowmo')); await page.waitForTimeout(100); }
    await page.waitForTimeout(4000);
    let st; // (a few looks: the readout refreshes a few times a second, and a linac's beams come and go between bunches)
    for (let k = 0; k < 10; k++) {
      st = await page.evaluate(() => ({ beam: W.parts.filter(p => !p.dead && p.beam).length, hits: W.collider && W.collider.hits, E: document.getElementById('cBeamE').textContent, v: document.getElementById('cSpeed').textContent, sep: document.getElementById('cSep').textContent, B: document.getElementById('cField').textContent, slow: W.slowHold }));
      if (!st.beam || /c$/.test(st.v)) break;
      await page.waitForTimeout(300);
    }
    if (st.beam && !/c$/.test(st.v)) { fails++; say('FAIL no speed readout', pre, st.v); }
    say(`  ${pre}: ${JSON.stringify(st)}`);
    if (!st.slow) { fails++; say('FAIL slow motion off after toggling twice on', pre); }
    await shot('collider-' + pre);
    check('collider ' + pre);
  }
  for (let i = 0; i < 2; i++) { await page.keyboard.press('Backslash'); await page.waitForTimeout(60); }
  for (let i = 0; i < 2; i++) await tryClick(page.locator('input[data-view="decayCards"]'));
  check('slow motion and close-ups');
  // 7. tabs; inspect a few particles
  await page.selectOption('#preset', 'gallery');
  for (const tab of ['inspect', 'data', 'log', 'physics', 'lab']) { await page.click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(120); }
  await page.click('.tab[data-tab="inspect"]');
  const pts = await page.evaluate(() => W.parts.filter(p => !p.dead).slice(0, 12).map(p => [w2sx(p.x), w2sy(p.y)]));
  await page.click('.tool[data-tool="inspect"]');
  const cvb = await page.locator('#cv').boundingBox();
  for (const [x, y] of pts) {
    await page.mouse.click(cvb.x + x, cvb.y + y);
    await page.waitForTimeout(60);
    const nb = await page.locator('#tp-inspect button').count();
    for (let i = 0; i < nb; i++) { await tryClick(page.locator('#tp-inspect button').nth(i)); await closeModals(); }
  }
  await shot('inspect');
  for (const d of await page.$$('#tp-inspect details')) await d.evaluate((el) => { el.open = !el.open; });
  check('inspect');
  await closeModals();
  // 8. periodic table (both tabs), molecule library, molecule builder, isotope builder
  await closeModals();
  const nm0 = await page.$eval('#nucModal', (el) => ({ hidden: el.hidden, disp: getComputedStyle(el).display, vis: getComputedStyle(el).visibility, op: getComputedStyle(el).opacity, pe: getComputedStyle(el).pointerEvents }));
  if (!nm0.hidden || nm0.disp !== 'none') say('  nucModal state before the periodic table:', JSON.stringify(nm0));
  await shot('before-pt');
  await page.click('#bPT'); await page.waitForTimeout(150);
  for (const anti of ['0', '1']) {
    const t = page.locator(`#ptTabs button[data-anti="${anti}"]`); if (await t.count()) await t.click();
    const cells = page.locator('#pgrid button'); const nc = await cells.count();
    for (let i = 0; i < nc; i += 17) { await cells.nth(i).click(); await page.waitForTimeout(20); }
    const nd = await page.locator('#pdetail button').count();
    for (let i = 0; i < nd; i++) { if (!(await isOpen('ptModal'))) break; await tryClick(page.locator('#pdetail button').nth(i)); }
    if (!(await isOpen('ptModal'))) { await closeModals(); await page.click('#bPT'); }
  }
  if (await isOpen('ptModal')) await page.click('#ptClose');
  check('periodic table');
  await page.click('#bMol'); await page.waitForTimeout(150);
  await page.fill('#molSearch', 'acid'); await page.waitForTimeout(100);
  await page.fill('#molSearch', '');
  for (const b of await page.$$('#molCats button')) { await b.click(); await page.waitForTimeout(30); }
  const mols = page.locator('#mgrid button'); const nm = await mols.count();
  for (let i = 0; i < nm; i += Math.max(1, Math.floor(nm / 8))) { if (!(await isOpen('molModal'))) await page.click('#bMol'); await mols.nth(i).click().catch(() => {}); await page.waitForTimeout(40); }
  if (!(await isOpen('molModal'))) await page.click('#bMol');
  await page.click('#molBuild'); await page.waitForTimeout(200);
  const bb = await page.locator('#bldCv').boundingBox(), pal = page.locator('#bldPal button, #bldPal .chip, #bldPal [draggable], #bldPal [data-el]');
  const np = await pal.count();
  for (let i = 0; i < Math.min(np, 6); i++) { const c = await pal.nth(i).boundingBox(); if (!c) continue; await drag([c.x + c.width / 2, c.y + c.height / 2], [bb.x + bb.width * (0.3 + 0.08 * i), bb.y + bb.height * 0.5], 6); }
  await shot('builder');
  for (const id of ['bldFill', 'bldTidy', 'bldUndo', 'bldGo']) await tryClick(page.locator('#' + id));
  if (await isOpen('bldModal')) await page.click('#bldClose');
  if (await isOpen('molModal')) await page.click('#molClose');
  check('molecules and builder');
  // isotope builder: from an element's detail
  await page.click('#bPT'); await page.waitForTimeout(100);
  await page.locator('#pgrid button').nth(25).click();
  const iso = page.locator('#pdetail button', { hasText: /isotope|build/i });
  if (await iso.count()) {
    await iso.first().click(); await page.waitForTimeout(200);
    const nbn = await page.locator('#nucBins button').count();
    for (let i = 0; i < nbn; i++) await tryClick(page.locator('#nucBins button').nth(i));
    const nb = await page.locator('#nucCv').boundingBox();
    if (nb) await drag([nb.x + nb.width * 0.2, nb.y + nb.height * 0.8], [nb.x + nb.width * 0.5, nb.y + nb.height * 0.5], 5);
    await tryClick(page.locator('#nucUse'));
    if (await isOpen('nucModal')) await page.click('#nucClose');
  }
  if (await isOpen('ptModal')) await page.click('#ptClose');
  check('isotope builder');
  // 8a. saved isotopes: saved from the isotope builder, they stay in the Place tool's bar under the chamber (not the
  //     palette above it), shown while that element is being placed (not while carbon is), kept over a reload,
  //     offered to the Fire tool too, taken off in the periodic table
  await page.evaluate(() => { MYISO.length = 0; myIsoStore(); setTool('place'); selectSpec(isoSpec(6, 12, 0)); openNucBuilder({ Z: 118, N: 238, ne: 0 }); });
  await page.waitForTimeout(150);
  await page.click('#nucSave');
  const og = () => page.evaluate(() => ({ n: MYISO.length, bar: [...document.querySelectorAll('#toolopts [data-my]')].some(c => /³⁵⁶Og/.test(c.textContent)), top: [...document.querySelectorAll('#palette .chip')].some(c => /³⁵⁶Og/.test(c.textContent)), ls: localStorage.getItem('atomforge.myisos'), btn: document.getElementById('nucSave').textContent }));
  const s1 = await og();
  if (!(s1.n === 1 && !s1.bar && /\[118,356,/.test(s1.ls || '') && /Saved/.test(s1.btn))) { fails++; say('FAIL saving ³⁵⁶Og from the isotope builder (its button stays off the Place bar while carbon is placed):', JSON.stringify(s1)); }
  await page.click('#nucClose');
  await page.reload(); await page.waitForTimeout(900);
  await page.evaluate(() => { setTool('place'); selectSpec(isoSpec(118, 294, 0)); });
  const s2 = await og();
  if (!(s2.n === 1 && s2.bar && !s2.top)) { fails++; say('FAIL after a reload, with oganesson picked, the saved isotope should be in the Place bar (and not the palette above):', JSON.stringify(s2)); }
  await page.locator('#toolopts [data-my]', { hasText: '³⁵⁶Og' }).first().click();
  const sp = await page.evaluate(() => UI.spec && [UI.spec.kind, UI.spec.Z, UI.spec.A, !!UI.spec.bare].join());
  if (sp !== 'atom,118,356,true') { fails++; say('FAIL its button in the Place bar did not pick it:', sp); }
  const nFire = await page.evaluate(() => { OPT.fire.proj = 'sel'; setTool('fire'); const n = document.querySelectorAll('#toolopts [data-my]').length; setTool('place'); return n; });
  if (nFire !== 1) { fails++; say('FAIL the Fire tool (firing the picked particle) should offer the saved isotopes too:', nFire); }
  await page.click('#bPT'); await page.waitForTimeout(150);
  const face = await page.textContent('#ptSave');
  await page.click('#pdetail .isox'); await page.click('#pdetail .isox'); // (the first press arms it)
  const s3 = await og(), row = await page.$('#pdetail .isosaved');
  if (!/Saved/.test(face) || s3.n !== 0 || s3.bar || row) { fails++; say('FAIL taking it off in the periodic table:', JSON.stringify({ face, ...s3, row: !!row })); }
  await page.click('#ptClose');
  check('saved isotopes');
  // 8c. tiny objects from the molecule library: one per click, the box opening up to make room, even in a busy box
  for (const [pre, name] of [['empty', 'Graphene'], ['soup', 'Transistor']]) {
    await page.selectOption('#preset', pre); await page.waitForTimeout(250);
    await page.click('#bMol'); await page.waitForTimeout(150);
    await page.click('#molCats button[data-c="objects"]'); await page.waitForTimeout(150);
    await page.locator('#mgrid .mcard', { hasText: name }).first().click(); await page.waitForTimeout(100);
    const b0 = await page.evaluate(() => ({ n: W.parts.filter(p => !p.dead).length, k: UI.spec && UI.spec.mol, want: UI.spec && MOLECULES[UI.spec.mol] ? MOLECULES[UI.spec.mol].atoms.length : 0, tool: UI.tool }));
    await page.evaluate(() => setRunning(false)); // (measured paused: a hot soup particle may knock an atom off a moment later, which is physics, not placement)
    await clickCanvas(0.5, 0.5); await page.waitForTimeout(400);
    const b1 = await page.evaluate(() => { // (the object counted as one bonded whole)
      const mine = W.parts.filter(p => !p.dead && p.k === NUC && p.bonds.length).sort((a, b) => b.id - a.id)[0];
      return { n: W.parts.filter(p => !p.dead).length, placed: mine ? molecule(mine).length : 0, w: +W.box.w.toFixed(1), h: +W.box.h.toFixed(1), inside: W.parts.every(p => p.dead || (Math.abs(p.x) <= W.box.w / 2 + 1 && Math.abs(p.y) <= W.box.h / 2 + 1)) }; // (soft walls: a hot proton dips a fraction of an ångström in)
    });
    await page.evaluate(() => setRunning(true));
    if (b0.tool !== 'place' || b1.placed !== b0.want || !b1.inside) { fails++; say(`FAIL placing ${name} on ${pre}:`, JSON.stringify({ b0, b1 })); }
    else say(`  ${name} placed on ${pre}: ${b0.want} atoms, box ${b1.w} × ${b1.h} Å`);
  }
  check('tiny objects');
  // 8d. isotopes in the molecule builder: an oxygen with deuterium filling in is heavy water; the selected oxygen
  //     offers its isotopes; built and placed, the atoms are those isotopes, and My molecules keeps them over a reload
  await page.selectOption('#preset', 'empty'); await page.waitForTimeout(250);
  await page.click('#bMol'); await page.waitForTimeout(150);
  await page.click('#molBuild'); await page.waitForTimeout(200);
  await tryClick(page.locator('#bldClear'));
  await page.click('#bldPal [data-el="O"]'); await page.waitForTimeout(60);
  await page.selectOption('#bldHA', '2'); await page.waitForTimeout(60);
  const bi1 = await page.textContent('#bldInfo'), isoShown = await page.isVisible('#bldA');
  if (isoShown) { await page.selectOption('#bldA', '18'); await page.waitForTimeout(60); }
  const bi2 = await page.textContent('#bldInfo');
  await page.click('#bldGo'); await page.waitForTimeout(500);
  const bk = await page.evaluate(() => (UI.spec && UI.spec.kind === 'mol' ? UI.spec.mol : null));
  await clickCanvas(0.5, 0.5); await page.waitForTimeout(300);
  const bPlaced = await page.evaluate(() => W.parts.filter(p => !p.dead && p.k === NUC).map(p => p.Z + ':' + (p.Z + p.N)).sort().join(' '));
  await page.selectOption('#bldHA', '1').catch(() => {});
  await page.reload(); await page.waitForTimeout(900);
  const bKept = await page.evaluate((k) => (MOLECULES[k] ? MOLECULES[k].name + ' ' + JSON.stringify(MOLECULES[k].atoms.map(a => a[4] || 0)) : null), bk);
  if (!/D₂O/.test(bi1) || !/Heavy water/.test(bi1) || !isoShown || !/D₂¹⁸O/.test(bi2) || bPlaced !== '1:2 1:2 8:18' || bKept !== '(²H₂,¹⁸O)water [18,2,2]') {
    fails++; say('FAIL isotopes in the molecule builder:', JSON.stringify({ bi1, isoShown, bi2, bk, bPlaced, bKept }));
  } else say(`  builder isotopes: ${bi2.split('·')[0].trim()} built as ${bKept}`);
  check('builder isotopes');
  // 8e. the quick menu: a right-click on an atom opens its menu (Inspect selects it), on empty space it offers
  //     particles to place right there; a right-drag still pans without opening it; Escape closes it
  await page.selectOption('#preset', 'empty'); await page.waitForTimeout(250);
  const qa = await page.evaluate(() => { setRunning(false); const p = spawnSpec({ kind: 'atom', Z: 6, A: 12 }, 0, 0, 0)[0]; p.vx = p.vy = 0; const r = R.cv.getBoundingClientRect(); return { x: r.left + w2sx(p.x), y: r.top + w2sy(p.y), id: p.id }; });
  const qmState = () => page.evaluate(() => ({ open: !document.getElementById('qmenu').hidden, head: (document.querySelector('#qmenu .qmh .t1') || {}).textContent || '', chips: document.querySelectorAll('#qmenu .qchip').length, n: W.parts.filter(p => !p.dead).length, cx: R.cx }));
  await page.mouse.click(qa.x, qa.y, { button: 'right' }); await page.waitForTimeout(120);
  const q1 = await qmState();
  await shot('quickmenu-atom');
  if (q1.open) await page.locator('#qmenu .qmi', { hasText: 'Inspect' }).first().click();
  await page.waitForTimeout(120);
  const q2 = await page.evaluate((id) => ({ open: !document.getElementById('qmenu').hidden, sel: !!R.sel && R.sel.id === id }), qa.id);
  await page.mouse.click(qa.x, qa.y, { button: 'right' }); await page.waitForTimeout(120);
  if (await page.isVisible('#qmenu')) await page.locator('#qmenu .qmi', { hasText: 'Follow it' }).first().click();
  await page.evaluate((id) => { const p = W.parts.find(p => p.id === id); if (p) p.vx = 0.01; setRunning(true); }, qa.id);
  await page.waitForTimeout(600);
  const qf = await page.evaluate((id) => { setRunning(false); const p = W.parts.find(p => p.id === id); return { on: R.follow === p, d: p ? Math.hypot(R.cx - p.x, R.cy - p.y) : -1, x: p ? p.x : 0 }; }, qa.id);
  await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  qf.after = await page.evaluate(() => !!R.follow);
  if (!(qf.on && qf.d < 0.05 && Math.abs(qf.x) > 0.01 && !qf.after)) { fails++; say('FAIL Follow from the quick menu:', JSON.stringify(qf)); }
  await page.evaluate((id) => { const p = W.parts.find(p => p.id === id); if (p) { p.vx = p.vy = 0; } fitView(); }, qa.id);
  await page.mouse.click(qa.x + 150, qa.y + 60, { button: 'right' }); await page.waitForTimeout(120);
  const q3 = await qmState();
  await shot('quickmenu-here');
  if (q3.open) await page.locator('#qmenu .qchip').first().click();
  await page.waitForTimeout(120);
  const q4 = await qmState();
  await page.mouse.move(qa.x + 150, qa.y + 60); await page.mouse.down({ button: 'right' }); await page.mouse.move(qa.x + 230, qa.y + 90, { steps: 6 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(120);
  const q5 = await qmState();
  await page.mouse.click(qa.x + 150, qa.y + 60, { button: 'right' }); await page.waitForTimeout(80);
  await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  const q6 = await qmState();
  if (!(q1.open && /Carbon atom/.test(q1.head) && q2.sel && !q2.open && q3.open && q3.chips > 3 && !q4.open && q4.n > q3.n && !q5.open && Math.abs(q5.cx - q4.cx) > 0.1 && !q6.open)) {
    fails++; say('FAIL the quick menu:', JSON.stringify({ q1, q2, q3, q4, q5, q6 }));
  } else say(`  quick menu: "${q1.head}", ${q3.chips} particles to place on empty space`);
  await page.evaluate(() => setRunning(true));
  check('quick menu');
  // 8f. the collider's beam menus take any element and any isotope (a popular nucleus picked directly shows as its
  //     element and isotope); what nuclear events make is listed in the Data tab
  await page.selectOption('#preset', 'linac'); await page.waitForTimeout(300);
  await page.click('.tab[data-tab="lab"]');
  await page.selectOption('#cBeamA', 'u238'); await page.waitForTimeout(150);
  const popu = await page.evaluate(() => [W.collider.a, document.getElementById('cBeamA').value, document.getElementById('cIsoA').value].join());
  await page.selectOption('#cBeamA', 'Z20'); await page.waitForTimeout(150);
  await page.selectOption('#cIsoA', '48'); await page.waitForTimeout(150);
  await page.selectOption('#cBeamB', 'Z118'); await page.waitForTimeout(150);
  const isoN = await page.locator('#cIsoB option').count();
  await page.selectOption('#cIsoB', '356'); await page.waitForTimeout(150);
  const beams = await page.evaluate(() => [W.collider.a, W.collider.b].join());
  await page.evaluate(() => noteMade([{ Z: 118, N: 176 }, { Z: 0, N: 1 }, { Z: 20, N: 28 }], ['⁴⁸Ca', '³⁵⁶Og'], '⁴⁸Ca + ³⁵⁶Og → ²⁹⁴Og + n + …'));
  await page.click('.tab[data-tab="data"]'); await page.waitForTimeout(700);
  const md = await page.evaluate(() => ({ shown: !document.getElementById('dMadeSec').hidden, rows: document.querySelectorAll('#dMade tr').length, sum: document.getElementById('dMadeSum').textContent }));
  await shot('made-here');
  if (popu !== 'u238,Z92,238' || beams !== 'ca48,z118a356' || isoN < 30 || !md.shown || md.rows < 2 || !/oganesson/.test(md.sum)) { fails++; say('FAIL any-isotope beams / the made list:', JSON.stringify({ popu, beams, isoN, md })); }
  else say(`  beams ⁴⁸Ca + ³⁵⁶Og from the menus (${isoN} oganesson isotopes offered); Data tab: ${md.sum.slice(0, 70)}…`);
  check('any-isotope beams and the made list');
  // 8f2. the beam search boxes: typed text on Enter (calcium-48, ²⁴⁹Cf), a suggestion picked from the list (gold, which
  //      takes its popular isotope), and a nucleus that does not hold together is refused with the reason
  await page.click('.tab[data-tab="lab"]'); await page.waitForTimeout(150);
  await page.fill('#cFindA', 'Ca-48'); await page.press('#cFindA', 'Enter'); await page.waitForTimeout(150);
  await page.fill('#cFindB', '²⁴⁹Cf'); await page.press('#cFindB', 'Enter'); await page.waitForTimeout(150);
  const fs1 = await page.evaluate(() => [W.collider.a, W.collider.b, document.getElementById('cFindA').value].join());
  await page.fill('#cFindA', 'Au Gold (79)'); await page.waitForTimeout(150); // (as a pick from the suggestions arrives: the whole entry at once)
  const fs2 = await page.evaluate(() => W.collider.a);
  await page.fill('#cFindB', 'Ca-200'); await page.press('#cFindB', 'Enter'); await page.waitForTimeout(150);
  const fs3 = await page.evaluate(() => ({ b: W.collider.b, why: document.getElementById('cFindB').validationMessage }));
  await page.fill('#cFindB', ''); await page.keyboard.press('Escape');
  if (fs1 !== 'ca48,cf249,' || fs2 !== 'au197' || fs3.b !== 'cf249' || !/does not hold together/.test(fs3.why)) { fails++; say('FAIL the beam search boxes:', JSON.stringify({ fs1, fs2, fs3 })); }
  else say(`  beam search: Ca-48 and ²⁴⁹Cf typed, gold picked from the list; refused: “${fs3.why.slice(0, 60)}…”`);
  check('beam search');
  // 8f3. the Light tool's photons fly at c: while they are in flight time crawls (attoseconds a frame) so that they can
  //      be seen going, and once the last has landed it runs on as before
  await page.selectOption('#preset', 'flame'); await page.waitForTimeout(300);
  await page.click('.tool[data-tool="light"]'); await page.waitForTimeout(60);
  await tryClick(page.locator('#toolopts [data-g="follow"] button[data-v="true"]'));
  await page.mouse.move(...at(0.2, 0.5)); await page.mouse.down(); await page.mouse.move(...at(0.5, 0.48), { steps: 4 });
  const lt0 = await page.evaluate(() => W.t); await page.waitForTimeout(500);
  const lt1 = await page.evaluate((t0) => ({ fl: W.flights.length, as: +((W.t - t0) * PHYS.TU_S * 1e18).toFixed(1) }), lt0);
  await page.mouse.up(); await page.waitForTimeout(3000);
  const lt2 = await page.evaluate(() => W.flights.length), lt3 = await page.evaluate(async () => { const t = W.t; await new Promise(r => setTimeout(r, 300)); return (W.t - t) * PHYS.TU_S * 1e15; });
  if (!(lt1.fl >= 5 && lt1.as < 1000 && lt2 === 0 && lt3 > 5)) { fails++; say('FAIL light in flight:', JSON.stringify({ lt1, lt2, lt3 })); }
  else say(`  light at c: ${lt1.fl} photons in flight, ${lt1.as} as passed in half a second; all landed, then ${lt3.toFixed(0)} fs in 0.3 s`);
  check('light in flight');
  // 8f4. chips that work: a NOT gate placed in the chamber gets its controls in the Lab tab and inverts; an SRAM cell
  //      is written and read back from its buttons
  const chipPlace = async (key) => {
    await page.selectOption('#preset', 'empty'); await page.waitForTimeout(200);
    await page.evaluate((k) => selectSpec({ kind: 'mol', mol: k }), key);
    await clickCanvas(0.5, 0.5); await page.waitForTimeout(300);
    await page.click('.tab[data-tab="lab"]'); await page.waitForTimeout(400);
  };
  await chipPlace('inverter');
  const cp0 = await page.evaluate(() => ({ shown: !document.getElementById('gChips').hidden, text: document.getElementById('chipPanel').innerText }));
  await page.click('#chipPanel [data-k="in"] button[data-v="1"]'); await page.waitForTimeout(1200);
  const cp1 = await page.evaluate(() => document.getElementById('chipPanel').innerText);
  await chipPlace('sramcell');
  await page.click('#chipPanel [data-op="write"][data-arg="1"]');
  await page.waitForFunction(() => W.chips[0] && !W.chips[0].op, null, { timeout: 15000 });
  await page.click('#chipPanel [data-op="read"]');
  await page.waitForFunction(() => W.chips[0] && !W.chips[0].op, null, { timeout: 15000 }); await page.waitForTimeout(350);
  const cp2 = await page.evaluate(() => document.getElementById('chipPanel').innerText);
  if (!cp0.shown || !/NOT gate/.test(cp0.text) || !/Output 1/.test(cp0.text) || !/Output 0/.test(cp1) || !/Holds 1/.test(cp2) || !/last read: 1/.test(cp2)) { fails++; say('FAIL chips:', JSON.stringify({ cp0, cp1, cp2 }).slice(0, 900)); }
  else say(`  chips: NOT gate ${/Output 1/.test(cp0.text) ? '0 → 1' : ''}, then 1 → 0; SRAM written 1 and read back: “${(cp2.match(/Holds[^;]*/) || [''])[0]}”`);
  check('chips');
  // 8f5. the one-byte flash setup opens the Lab tab on a memory panel of eight bits: a character typed there is written
  //      (erase, then program the zeros) and read back, and a bit flips with a click; antineutrons come from the
  //      palette; tool radii reach 1,000 Å; the frame-rate counter shows, and hides from Settings
  await page.selectOption('#preset', 'flashbyte'); await page.waitForTimeout(700);
  const fb0 = await page.evaluate(() => ({ tab: UI.tab, bits: document.querySelectorAll('#chipPanel .mbit').length, input: !!document.getElementById('memText') }));
  await page.fill('#memText', 'K'); await page.click('#chipPanel button[data-mem="write"]');
  await page.waitForFunction(() => W.mem && W.mem.op === 'write' && W.mem.stage === 'done', null, { timeout: 60000 }); await page.waitForTimeout(500);
  const fb1 = await page.evaluate(() => ({ msg: W.mem.msg, ok: W.mem.ok, text: document.getElementById('chipPanel').innerText }));
  await page.click('#chipPanel .mbit >> nth=7'); // bit 0: “K” (01001011) becomes “J” (01001010)
  await page.waitForFunction(() => { const c = flashMemory().cells[7]; return c && !c.op; }, null, { timeout: 30000 });
  await page.click('#chipPanel button[data-mem="read"]');
  await page.waitForFunction(() => W.mem && W.mem.op === 'read' && W.mem.stage === 'done', null, { timeout: 30000 }); await page.waitForTimeout(500);
  const fb2 = await page.evaluate(() => ({ msg: W.mem.msg, text: document.getElementById('chipPanel').innerText }));
  if (!(fb0.tab === 'lab' && fb0.bits === 8 && fb0.input && fb1.ok && /“K”/.test(fb1.text) && /Read “J”/.test(fb2.msg) && /“J”/.test(fb2.text))) { fails++; say('FAIL flash byte:', JSON.stringify({ fb0, fb1, fb2 }).slice(0, 900)); }
  else say(`  flash byte: ${fb1.msg}; bit 0 flipped by a click; ${fb2.msg}`);
  await page.selectOption('#preset', 'empty'); await page.waitForTimeout(250);
  await page.click('#palette .chip[title^="Antineutron"]'); await page.evaluate(() => setTool('place'));
  await clickCanvas(0.5, 0.5); await page.waitForTimeout(200);
  const nb = await page.evaluate(() => W.parts.filter(p => !p.dead && p.k === NUC && p.Z === 0 && p.anti).length);
  const rad = await page.evaluate(() => { setTool('pull'); const r = document.getElementById('oR'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); const big = OPT.pull.R; r.value = 41; r.dispatchEvent(new Event('input', { bubbles: true })); return { big, back: OPT.pull.R, text: document.getElementById('oRV').textContent }; });
  await page.waitForTimeout(700);
  const fps0 = await page.evaluate(() => ({ text: document.getElementById('fpsBadge').textContent, shown: !document.getElementById('fpsBadge').hidden }));
  await page.click('#bSettings'); await page.waitForTimeout(150); await page.click('#setFps'); await page.waitForTimeout(100);
  const fps1 = await page.evaluate(() => !document.getElementById('fpsBadge').hidden);
  await page.click('#setFps'); await page.click('#setClose');
  if (!(nb === 1 && rad.big === 1000 && rad.back === 10 && /^\d+ fps/.test(fps0.text) && fps0.shown && !fps1)) { fails++; say('FAIL antineutron / radius / fps:', JSON.stringify({ nb, rad, fps0, fps1 })); }
  else say(`  antineutron placed from the palette; pull radius up to ${rad.big.toLocaleString('en-US')} Å; frame-rate counter “${fps0.text}”, hidden from Settings`);
  await page.evaluate(() => setTool('place'));
  check('flash byte, antineutron, radius, fps');
  // 8f6. “Remove all” in a particle's quick menu: every proton goes and the electrons stay
  await page.selectOption('#preset', 'empty'); await page.waitForTimeout(250);
  const ra = await page.evaluate(() => { setRunning(false); setBox(60, 40); const ps = []; for (let i = 0; i < 5; i++) ps.push(spawnSpec(SPEC_P, -20 + i * 8, 10, 0)[0]); for (let i = 0; i < 3; i++) spawnSpec({ kind: 'e' }, -10 + i * 8, -10, 0); for (const p of W.parts) { p.vx = 0; p.vy = 0; } fitView(); render(W.rt); const p = ps[2], r = R.cv.getBoundingClientRect(); return { x: r.left + w2sx(p.x), y: r.top + w2sy(p.y) }; });
  await page.mouse.click(ra.x, ra.y, { button: 'right' }); await page.waitForTimeout(150);
  const raBtn = page.locator('#qmenu .qmi', { hasText: 'Remove all' }).first();
  const raText = (await raBtn.count()) ? await raBtn.textContent() : '';
  if (raText) await raBtn.click();
  await page.waitForTimeout(150);
  const raLeft = await page.evaluate(() => ({ p: W.parts.filter(q => !q.dead && q.k === NUC && q.Z === 1).length, e: W.parts.filter(q => !q.dead && q.k === ELEC).length }));
  await page.evaluate(() => setRunning(true));
  if (!(/Remove all .+ \(5\)/.test(raText) && raLeft.p === 0 && raLeft.e === 3)) { fails++; say('FAIL remove all:', JSON.stringify({ raText, raLeft })); }
  else say(`  quick menu: “${raText.trim()}” removed every proton; the 3 electrons stayed`);
  check('remove all');
  // 8g. Settings: performance mode raises the particle limit (and the place tool puts down 100 at a click) and lightens
  //     the drawing; temperatures in °C; all kept over a reload; back to defaults
  await page.selectOption('#preset', 'empty'); await page.waitForTimeout(250);
  await page.click('#bSettings'); await page.waitForTimeout(200);
  const st0 = await page.evaluate(() => ({ open: !document.getElementById('setModal').hidden, max: MAX_PARTS }));
  await page.click('#segBudget button[data-v="16"]'); await page.waitForTimeout(100);
  await page.click('#setPerf'); await page.waitForTimeout(150);
  const st1 = await page.evaluate(() => ({ max: MAX_PARTS, lite: R.lite, dpr: R.dprMax, budget: UI.budget }));
  await page.click('#segTUnit button[data-v="C"]'); await page.waitForTimeout(400);
  const tC = await page.textContent('#roT');
  await page.click('#setClose');
  await page.evaluate(() => { setTool('place'); selectSpec(isoSpec(18, 40, 0)); }); await page.waitForTimeout(100);
  const n100 = await page.evaluate(() => W.parts.filter(p => !p.dead).length);
  await tryClick(page.locator('#toolopts [data-g="count"] button', { hasText: /^100$/ }));
  await clickCanvas(0.5, 0.5); await page.waitForTimeout(200);
  const n100b = await page.evaluate(() => W.parts.filter(p => !p.dead).length);
  await page.reload(); await page.waitForTimeout(900);
  const st2 = await page.evaluate(() => ({ max: MAX_PARTS, lite: R.lite, unit: T_UNIT }));
  await page.click('#bSettings'); await page.waitForTimeout(150);
  await page.click('#setPerf'); await page.waitForTimeout(150); // off again: what it replaced comes back (16 ms), even after the reload
  const st2b = await page.evaluate(() => ({ max: MAX_PARTS, lite: R.lite, budget: UI.budget, perf: document.getElementById('setPerf').checked }));
  await page.click('#setReset'); await page.waitForTimeout(150);
  const st3 = await page.evaluate(() => ({ max: MAX_PARTS, lite: R.lite, unit: T_UNIT }));
  await page.click('#setClose');
  if (!(st0.open && st0.max === 4000 && st1.max === 12000 && st1.lite && st1.dpr === 1 && st1.budget === 10 && /°C/.test(tC) && n100b - n100 >= 80 && st2.max === 12000 && st2.unit === 'C'
    && st2b.max === 4000 && !st2b.lite && st2b.budget === 16 && !st2b.perf && st3.max === 4000 && !st3.lite && st3.unit === 'K')) {
    fails++; say('FAIL settings:', JSON.stringify({ st0, st1, tC, placed: n100b - n100, st2, st2b, st3 }));
  } else say(`  settings: performance mode ${st1.max.toLocaleString('en-US')} particles, ${n100b - n100} argon atoms at a click, ${tC.split(' → ')[0]}; kept over a reload; off again puts physics back to ${st2b.budget} ms; then reset`);
  // 8g''. The hourglass follows slow motion started by an event (lit, dashed), takes it over when pressed, turns it off when
  //       pressed again; paused in slow motion, the Motion readout still says slow motion
  const smo = await page.evaluate(async () => {
    loadPreset('water'); setRunning(true); await new Promise(r => setTimeout(r, 300));
    const b = document.getElementById('bSlowmo'), st = () => ({ pressed: b.getAttribute('aria-pressed'), auto: b.classList.contains('auto'), hold: !!W.slowHold, motion: document.getElementById('spdVal').textContent });
    W.slow = { t0: W.rt, on: true, fresh: false, f: 0.05 }; fireSpec(isoSpec(2, 4, 0), 0, 0, 1, 0, 5e5, false); await new Promise(r => setTimeout(r, 400)); const a = st();
    setRunning(false); await new Promise(r => setTimeout(r, 300)); syncLabText(); const paused = st(); setRunning(true);
    b.click(); await new Promise(r => setTimeout(r, 200)); const c = st();
    b.click(); await new Promise(r => setTimeout(r, 200)); const d = st(); setRunning(false);
    return { a, paused, c, d };
  });
  if (!(smo.a.pressed === 'true' && smo.a.auto && !smo.a.hold && /slow motion/.test(smo.paused.motion) && smo.c.hold && !smo.c.auto && smo.d.pressed === 'false' && !smo.d.hold)) { fails++; say('FAIL slow motion button:', JSON.stringify(smo)); }
  else say('  slow motion: the hourglass lights for an event\'s slow motion, takes it over, turns it off; paused, the readout keeps it');
  // 8g'''. Typed values: every metric unit that fits; a value past the slider's end is kept (the slider sits at its end);
  //        past a real limit, the nearest allowed value is set and a note says why
  const tyx = await page.evaluate(async () => {
    loadPreset('water'); setRunning(false);
    const type = async (id, val, unit) => { const el = document.getElementById(id); el.click(); await new Promise(r => setTimeout(r, 50)); const inp = el.querySelector('input'), sel = el.querySelector('select');
      const units = sel ? [...sel.options].map(o => o.value).join(',') : ''; if (unit && sel) { sel.value = unit; sel.dispatchEvent(new Event('change')); }
      inp.value = String(val); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise(r => setTimeout(r, 50));
      const note = [...document.querySelectorAll('.typedNote')].map(n => n.textContent).pop() || ''; document.querySelectorAll('.typedNote').forEach(n => n.remove()); return { units, note }; };
    const a = await type("spdVal", 500, "zs"), aTu = W.simPerFrame * PHYS.TU_S, aS = document.getElementById('spdSlider').value;
    const b = await type('spdVal', 50, 'ps'), bTu = W.simPerFrame;
    const c = await type('tVal', 5, 'MK'), T = W.T;
    loadPreset('water'); setRunning(false);
    return { a, aTu, aS, b, bTu, c, T };
  });
  if (!(tyx.a.units === 'ys,zs,as,fs,ps,ns,µs,ms,s' && !tyx.a.note && Math.abs(tyx.aTu / 5e-19 - 1) < 1e-6 && tyx.aS === '0' && /Set to 10\.\d+ ps, not 50 ps/.test(tyx.b.note) && tyx.bTu === 1000 && /MK/.test(tyx.c.units) && tyx.T === 5e6)) { fails++; say('FAIL typed units and limits:', JSON.stringify(tyx)); }
  else say('  typed values: ys … s for Motion, 500 zs kept below the slider, 50 ps limited with a note, 5 MK set');
  // 8g''''. Copy and paste keep working parts: a gate copied whole pastes as a wired gate in the same state
  const cpc = await page.evaluate(async () => {
    loadPreset('ringosc'); setRunning(false); const n0 = W.chips.length;
    const g = W.chips[0]; R.msel.clear(); for (const p of g.ps) R.msel.add(p); copySelection();
    const nClip = (UI.clip.chips || []).length;
    W.box.tw = W.box.w = W.box.w * 1.6; W.box.th = W.box.h = W.box.h * 2.2; pasteClip(0, 40);
    const ch = W.chips[W.chips.length - 1]; setRunning(true); await new Promise(r => setTimeout(r, 800)); setRunning(false);
    const out = { n0, nClip, n1: W.chips.length, key: ch.key, atoms: ch.ps.length, broken: ch.broken, label: ch.label, out: ch.v.out };
    loadPreset('water'); setRunning(false); return out;
  });
  if (!(cpc.nClip === 1 && cpc.n1 === cpc.n0 + 1 && cpc.key === 'inverter' && cpc.atoms === 333 && !cpc.broken && /\(copy\)/.test(cpc.label) && cpc.out > 0.5)) { fails++; say('FAIL copy and paste a gate:', JSON.stringify(cpc)); }
  else say(`  copy and paste: a NOT gate pastes as a working gate (${cpc.label}, output ${cpc.out.toFixed(2)} V)`);
  // 8g'. Priority, smooth ↔ fast: at the fast end a frame may hold far more physics than Physics per frame gives; kept over a reload; reset puts it back
  await page.click('#bSettings'); await page.waitForTimeout(150);
  await page.evaluate(() => { const el = document.getElementById('setPrio'); el.value = '4'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await page.click('#setClose'); await page.evaluate(() => setRunning(true)); await page.waitForTimeout(600);
  const pr1 = await page.evaluate(() => ({ prio: SET.prio, budget: UI.fp.budget, cap: UI.budget, note: document.getElementById('setPrioV').textContent }));
  await page.reload(); await page.waitForTimeout(900);
  await page.click('#bSettings'); await page.waitForTimeout(150);
  const pr2 = await page.evaluate(() => ({ prio: SET.prio, val: document.getElementById('setPrio').value }));
  await page.click('#setReset'); await page.waitForTimeout(150); await page.click('#setClose');
  await page.waitForTimeout(600);
  const pr3 = await page.evaluate(() => ({ prio: SET.prio, budget: UI.fp.budget, cap: UI.budget }));
  if (!(pr1.prio === 4 && pr1.budget > pr1.cap + 5 && /20 fps/.test(pr1.note) && pr2.prio === 4 && pr2.val === '4' && pr3.prio === 0 && pr3.budget <= pr3.cap + 1e-9)) {
    fails++; say('FAIL priority:', JSON.stringify({ pr1, pr2, pr3 }));
  } else say(`  priority: the fast end lets physics take ${pr1.budget.toFixed(1)} ms of a frame (Physics per frame ${pr1.cap} ms); kept over a reload; reset back to smooth (${pr3.budget.toFixed(1)} ms)`);
  check('settings');
  // 8h. Ask Claude: hidden outside claude.ai (no `sample` capability); with a stub standing in for it, a recipe lands in
  //     the builder and builds; a known molecule is recognised; a bad recipe gets one correction round; a lattice goes
  //     straight to the library under its category and is placed whole; a name the library has needs no asking; errors are told, and a
  //     refusal hides the feature
  await page.selectOption('#preset', 'empty'); await page.waitForTimeout(250);
  await page.click('#bMol'); await page.waitForTimeout(150);
  await page.fill('#molSearch', 'test fatty acid c20'); await page.waitForTimeout(120);
  const ai0 = await page.evaluate(() => ({ btn: !!document.querySelector('#mgrid [data-ai]'), box: document.getElementById('aiBox').hidden }));
  await page.evaluate(() => {
    window.__ai = [];
    const answers = {
      'test fatty acid c20': [{ type: 'molecule', name: 'Arachidic acid', smiles: 'CCCCCCCCCCCCCCCCCCCC(=O)O', note: 'A saturated fatty acid with 20 carbons.' }],
      'test decaf': [{ type: 'molecule', name: 'Coffee stuff', smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', note: 'The stimulant in coffee.' }],
      'test fix me': [{ type: 'molecule', name: 'Broken', smiles: 'c1cccc1', note: 'x' }, { type: 'molecule', name: 'Indole', smiles: 'c1ccc2[nH]ccc2c1', note: 'Fixed.' }],
      'test kbr grain': [{ type: 'lattice', name: 'Potassium bromide', lattice: 'ionic', elements: ['K', 'Br'], size: 10, note: 'A salt.' }],
      'test busy': 'rate_limited', 'test nope': 'not_granted',
    };
    const stub = { json: async (prompt, opts) => {
      if (/^You identify molecules/.test(prompt)) { window.__idPrompt = prompt; return { names: [{ i: 0, name: 'Test peroxy radical', cat: 'bio' }, { i: 7, name: 'bogus' }] }; }
      const m = /Request: (".*")/.exec(prompt), req = m ? JSON.parse(m[1]) : '';
      window.__ai.push({ req, retry: /could not be built/.test(prompt), tier: opts && opts.modelTier, signal: !!(opts && opts.signal) });
      const a = answers[req];
      if (typeof a === 'string') throw { code: a, message: a };
      if (!a) throw { code: 'upstream_error', message: 'no answer' };
      return a[Math.min(window.__ai.filter(c => c.req === req).length, a.length) - 1];
    } };
    window.claude = { use: async (name) => (name === 'sample' ? stub : null) };
    aiInit();
  });
  await page.waitForTimeout(150);
  const aiBtn = await page.evaluate(() => !!document.querySelector('#mgrid [data-ai]'));
  const aiDone = () => page.waitForFunction(() => !AI.busy, null, { timeout: 8000 });
  await page.click('#mgrid [data-ai]'); await aiDone(); await page.waitForTimeout(100);
  const a1 = await page.evaluate(() => ({ open: !document.getElementById('bldModal').hidden, box: !document.getElementById('aiBox').hidden, heavy: MB.atoms.length, fill: MB.fill,
    name: document.getElementById('bldName').value, msg: document.getElementById('aiMsg').textContent, info: document.getElementById('bldInfo').textContent }));
  await page.click('#bldGo'); await page.waitForTimeout(400);
  const a1b = await page.evaluate(() => { const m = UI.spec && MOLECULES[UI.spec.mol]; return m ? { cat: m.cat, mine: !!m.mine, n: m.atoms.length, name: m.name, note: m.note } : null; });
  await page.click('#bMol'); await page.waitForTimeout(100); await page.click('#molBuild'); await page.waitForTimeout(150);
  await page.fill('#aiAsk', 'test decaf'); await page.click('#aiGo'); await aiDone(); await page.waitForTimeout(100);
  const a2 = await page.evaluate(() => ({ name: document.getElementById('bldName').value, msg: document.getElementById('aiMsg').textContent }));
  await page.click('#bldGo'); await page.waitForTimeout(300);
  const a2b = await page.evaluate(() => UI.spec && UI.spec.mol);
  await page.click('#bMol'); await page.waitForTimeout(100); await page.click('#molBuild'); await page.waitForTimeout(150);
  await page.fill('#aiAsk', 'test fix me'); await page.press('#aiAsk', 'Enter'); await aiDone(); await page.waitForTimeout(100);
  const a3 = await page.evaluate(() => ({ calls: window.__ai.filter(c => c.req === 'test fix me').map(c => c.retry), heavy: MB.atoms.length, info: document.getElementById('bldInfo').textContent }));
  await page.fill('#aiAsk', 'test kbr grain'); await page.click('#aiGo'); await aiDone(); await page.waitForTimeout(150);
  const a4 = await page.evaluate(() => ({ open: !document.getElementById('bldModal').hidden, spec: UI.spec && MOLECULES[UI.spec.mol] ? MOLECULES[UI.spec.mol].atoms.length : 0, whole: isObject(UI.spec), n: W.parts.filter(p => !p.dead).length }));
  await clickCanvas(0.5, 0.5); await page.waitForTimeout(250);
  const a4b = await page.evaluate(() => W.parts.filter(p => !p.dead && p.k === NUC && (p.Z === 19 || p.Z === 35)).length);
  await page.click('#bMol'); await page.waitForTimeout(100); await page.click('#molBuild'); await page.waitForTimeout(150);
  const nCalls = await page.evaluate(() => window.__ai.length);
  await page.fill('#aiAsk', 'Water'); await page.click('#aiGo'); await page.waitForTimeout(150);
  const a5 = await page.evaluate((n) => ({ calls: window.__ai.length - n, spec: UI.spec && UI.spec.mol, open: !document.getElementById('bldModal').hidden }), nCalls);
  await page.click('#bMol'); await page.waitForTimeout(100); await page.click('#molBuild'); await page.waitForTimeout(150);
  await page.fill('#aiAsk', 'test busy'); await page.click('#aiGo'); await aiDone(); await page.waitForTimeout(80);
  const a6 = await page.evaluate(() => ({ msg: document.getElementById('aiMsg').textContent, box: !document.getElementById('aiBox').hidden }));
  await page.fill('#aiAsk', 'test nope'); await page.click('#aiGo'); await aiDone(); await page.waitForTimeout(80);
  const a7 = await page.evaluate(() => ({ msg: document.getElementById('aiMsg').textContent, box: !document.getElementById('aiBox').hidden, tiers: [...new Set(window.__ai.map(c => c.tier + (c.signal ? '+stop' : '')))].join() }));
  // typed values: a click on the figure beside a slider opens a box and a unit dropdown; Enter sets it in the unit chosen,
  // changing the unit converts the number, the box survives the periodic refresh of the labels, Escape leaves the value
  const typed = await page.evaluate(async () => {
    const out = {}, sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const open = (id) => { const el = document.getElementById(id); el.click(); return { inp: el.querySelector('input'), sel: el.querySelector('select') }; };
    const enter = (inp) => inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    loadPreset('water'); setRunning(true);
    let e = open('tVal'); out.units = [...e.sel.options].map(o => o.value).join(); e.sel.value = '°C'; e.sel.dispatchEvent(new Event('change')); out.conv = e.inp.value; e.inp.value = '25'; enter(e.inp); out.T = W.T;
    e = open('boxH'); e.sel.value = 'nm'; e.sel.dispatchEvent(new Event('change')); e.inp.value = '50'; enter(e.inp); out.box = [W.box.tw, W.box.th];
    e = open('spdVal'); await sleep(600); out.stillOpen = !!document.getElementById('spdVal').querySelector('input'); e.inp.value = '10'; enter(e.inp); out.fsPerFrame = W.simPerFrame * PHYS.TU_S * 1e15;
    e = open('eVal'); e.inp.value = '0.9'; e.inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.escE = UI.E; out.closed = !document.getElementById('eVal').querySelector('input');
    out.noWarp = !document.getElementById('warpVal').classList.contains('typed'); out.ver = document.getElementById('verTag').textContent;
    setTool('fire'); e = open('oKEV'); e.sel.value = 'MeV'; e.sel.dispatchEvent(new Event('change')); e.inp.value = '2.5'; enter(e.inp); out.fireKE = fireKE(); out.fireTxt = document.getElementById('oKEV').textContent;
    setTool('heat'); e = open('oRV'); e.sel.value = 'nm'; e.sel.dispatchEvent(new Event('change')); e.inp.value = '5'; enter(e.inp); out.heatR = OPT.heat.R; setTool('place');
    setRunning(false); return out;
  });
  if (typed.units !== 'µK,mK,K,kK,MK,GK,°C,°F' || Math.abs(+typed.conv - 26.85) > 0.01 || Math.abs(typed.T - 298.15) > 1e-9 || typed.box[1] !== 500 || !typed.stillOpen || Math.abs(typed.fsPerFrame - 10) > 1e-6 || typed.escE !== 0 || !typed.closed || !typed.noWarp || !/^\d+\.\d+\.\d+$/.test(typed.ver) || Math.abs(typed.fireKE - 2.5e6) > 1 || typed.fireTxt !== '2.50 MeV' || typed.heatR !== 50) { fails++; say('FAIL typed values:', JSON.stringify(typed)); }
  else say(`  typed values: unit dropdowns (${typed.units}), 300 K shown as ${typed.conv} °C, 25 °C → ${typed.T} K, a 50 nm box height, 10 fs a frame, Escape leaves it; the tools' figures too (${typed.fireTxt}, ${typed.heatR} Å); version tag ${typed.ver}`);
  // a world saved as JSON and loaded back is the same world (particles, bonds, box, bath); the library exports and imports
  const sl = await page.evaluate(() => {
    loadPreset('water'); setRunning(false); W.T = 350;
    const d = worldToJSON(), n0 = W.parts.filter(p => !p.dead).length, b0 = W.bonds.length, E0 = totalEnergy().total;
    loadPreset('salt'); const r = worldFromJSON(JSON.parse(JSON.stringify(d))); forcesNoEvents();
    const lib = libraryToJSON();
    return { r, n0, b0, n1: W.parts.filter(p => !p.dead).length, b1: W.bonds.length, dE: Math.abs(totalEnergy().total - E0), T: W.T, box: [W.box.w, W.box.h, d.box.w, d.box.h], bad: worldFromJSON({ nope: 1 }), lib: lib.kind === 'library' && Array.isArray(lib.mymols) && libraryFromJSON(lib).nm === 0 };
  });
  if (typeof sl.r === 'string' || sl.r.n !== sl.n0 || sl.n1 !== sl.n0 || sl.b1 !== sl.b0 || sl.r.nb !== sl.b0 || sl.dE > 1e-3 || sl.T !== 350 || sl.box[0] !== sl.box[2] || sl.box[1] !== sl.box[3] || typeof sl.bad !== 'string' || !sl.lib) { fails++; say('FAIL save/load world:', JSON.stringify(sl)); }
  else say(`  save/load: a water world of ${sl.n1} particles and ${sl.b1} bonds comes back as saved (energy within ${sl.dE.toExponential(1)} eV); the library exports and imports`);
  // Identify molecules with Claude standing by: the kinds the library and formula table know are named locally, the rest
  // go to Claude as SMILES; its names tag the molecules and go to the library under the category Claude gives
  const idr = await page.evaluate(async () => {
    aiInit(); await new Promise(r => setTimeout(r, 100)); // (the refusal above hid Claude; back for this)
    loadPreset('empty'); setRunning(false);
    addMolecule('H2O', -20, 0, 0, 300); addMolecule('H2O', -10, 0, 0, 300); addMolecule('ethanol', 10, 0, 0, 300);
    const c = addNuc(6, 6, 6, 20, -30, 0, 0), o1 = addNuc(8, 8, 8, 21.4, -30, 0, 0), o2 = addNuc(8, 8, 8, 22.8, -30, 0, 0), hh = addNuc(1, 0, 1, 24, -30, 0, 0); addBond(c, o1, 1); addBond(o1, o2, 1); addBond(o2, hh, 1); W.dirty++;
    const n0 = Object.values(MOLECULES).filter(m => m.mine).length; W.log.length = 0;
    document.getElementById('bIdentify').click(); await new Promise(r => setTimeout(r, 300));
    const custom = Object.values(MOLECULES).filter(m => m.mine).slice(n0);
    render(W.rt);
    return { log: W.log.map(l => l.text), tags: R.molTags.map(t => t.text).sort().join(), prompt: window.__idPrompt || '', custom: custom.map(m => [m.name, m.atoms.length, m.bonds.length, m.radical, m.note, m.cat]), note: document.getElementById('idNote').hidden ? '' : document.getElementById('idNote').textContent };
  });
  if (!/Identified 4 molecules of 3 kinds: 2 × Water, 1 × Ethanol; unnamed: 1 × CHO₂/.test(idr.log[0]) || !/Asking Claude to name 1 kind/.test(idr.log[1]) || !/Claude named: 1 × Test peroxy radical \(CHO₂\)/.test(idr.log[2])
    || !/added to the library: Test peroxy radical \(Molecules of life\)/.test(idr.log[2]) || idr.custom[0][5] !== 'bio' || idr.tags !== 'Ethanol,Test peroxy radical,Water,Water' || !/0: \[C\]\[O\]\[OH\]/.test(idr.prompt)
    || idr.custom.length !== 1 || idr.custom[0][1] !== 4 || idr.custom[0][2] !== 3 || !idr.custom[0][3] || !/Identified by Claude/.test(idr.custom[0][4]) || !/Claude named/.test(idr.note)) { fails++; say('FAIL Identify molecules:', JSON.stringify(idr)); }
  else say('  Identify molecules: library names at once, an unknown fragment named by Claude (stubbed) from its SMILES, tagged and filed under the category Claude gave (Molecules of life)');
  // the Claude API with the viewer's own key (Settings), where the page has no Claude of its own: Ask Claude and Identify
  // go to api.anthropic.com (mocked here), a refused key is told without hiding the feature, and removing the key hides it
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const req = route.request(), h = req.headers(), body = JSON.parse(req.postData()), prompt = body.messages[0].content;
    if (h['x-api-key'] === 'sk-ant-bad') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid x-api-key' } }) });
    const reply = /^You identify molecules/.test(prompt) ? { names: [{ i: 0, name: 'Test peroxy radical' }] } : { type: 'molecule', name: 'Test decanol', smiles: 'CCCCCCCCCCO', note: 'Test.' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(reply) + '\n```' }], model: body.model, hdr: { key: h['x-api-key'], ver: h['anthropic-version'], direct: h['anthropic-dangerous-direct-browser-access'] } }) });
  });
  const apir = await page.evaluate(async () => {
    const out = {}; delete window.claude; AI.sample = null; aiSync();
    out.before = { sample: !!AI.sample, box: !document.getElementById('aiBox').hidden };
    showModal('setModal'); document.getElementById('setApiKey').value = 'sk-ant-test'; document.getElementById('setApiKey').dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 50));
    out.after = { api: !!(AI.sample && AI.sample.api), stored: JSON.parse(localStorage.getItem('atomforge.settings')).apiKey, note: document.getElementById('setApiNote').textContent.slice(0, 60) };
    hideModal('setModal'); openMolBuilder(); out.box = !document.getElementById('aiBox').hidden;
    await aiAsk('test decanol'); await new Promise(r => setTimeout(r, 100));
    out.ask = { name: document.getElementById('bldName').value, heavy: MB.atoms.length }; hideModal('bldModal');
    loadPreset('empty'); setRunning(false);
    const c = addNuc(6, 6, 6, 20, -30, 0, 0), o1 = addNuc(8, 8, 8, 21.4, -30, 0, 0), o2 = addNuc(8, 8, 8, 22.8, -30, 0, 0), hh = addNuc(1, 0, 1, 24, -30, 0, 0); addBond(c, o1, 1); addBond(o1, o2, 1); addBond(o2, hh, 1); W.dirty++;
    for (const k of Object.keys(MOLECULES)) if (MOLECULES[k].mine && MOLECULES[k].name === 'Test peroxy radical') myMolRemove(k); // (saved by the stubbed Identify above)
    W.log.length = 0; await identifyMolecules(); out.identify = W.log.map(l => l.text).join(' | ');
    SET.apiKey = 'sk-ant-bad'; aiInit(); await new Promise(r => setTimeout(r, 30)); openMolBuilder(); await aiAsk('test decanol'); await new Promise(r => setTimeout(r, 50));
    out.bad = { msg: document.getElementById('aiMsg').textContent, box: !document.getElementById('aiBox').hidden }; hideModal('bldModal');
    SET.apiKey = ''; store('settings', JSON.stringify(SET)); aiInit(); await new Promise(r => setTimeout(r, 30)); out.off = { sample: !!AI.sample, box: !document.getElementById('aiBox').hidden };
    return out;
  });
  await page.unroute('https://api.anthropic.com/v1/messages');
  for (let i = errors.length - 1; i >= 0; i--) if (/401 \(Unauthorized\)/.test(errors[i])) errors.splice(i, 1); // (the refused key's own console line)
  if (apir.before.sample || apir.before.box || !apir.after.api || apir.after.stored !== 'sk-ant-test' || !/no Claude access of its own/.test(apir.after.note) || !apir.box || apir.ask.name !== 'Test decanol' || apir.ask.heavy !== 11
    || !/Identified 1 molecule of 1 kind, unnamed: 1 × CHO₂ \| .*Asking Claude to name 1 kind … .*\| Claude named: 1 × Test peroxy radical \(CHO₂\) — added to the library: Test peroxy radical \(Alcohols/.test(apir.identify)
    || !/API key was refused/.test(apir.bad.msg) || !apir.bad.box || apir.off.sample || apir.off.box) { fails++; say('FAIL Claude API key:', JSON.stringify(apir)); }
  else say('  Claude API key (mocked api.anthropic.com): Ask Claude and Identify molecules work through it, a refused key is told, no key hides them');
  await shot('ask-claude');
  await closeModals();
  if (ai0.btn || !ai0.box || !aiBtn || !a1.open || !a1.box || a1.heavy !== 22 || !a1.fill || a1.name !== 'Arachidic acid' || !/Claude: A saturated/.test(a1.msg) || !/C₂₀H₄₀O₂/.test(a1.info)
    || !a1b || a1b.cat !== 'oxygen' || !a1b.mine || a1b.n !== 62 || !/^Designed by Claude\. A saturated/.test(a1b.note) || a2.name !== '' || !/Caffeine, already in the library/.test(a2.msg) || a2b !== 'caffeine'
    || a3.calls.join() !== 'false,true' || a3.heavy !== 9 || !/C₈H₇N/.test(a3.info) || a4.open || a4.spec !== 100 || !a4.whole || a4b !== 100
    || a5.calls !== 0 || a5.spec !== 'H2O' || a5.open || !/usage limit/.test(a6.msg) || !a6.box || a7.box || !/not allowed/.test(a7.msg) || a7.tiers !== 'default+stop') {
    fails++; say('FAIL Ask Claude:', JSON.stringify({ ai0, aiBtn, a1, a1b, a2, a2b, a3, a4, a4b, a5, a6, a7 }));
  } else say(`  Ask Claude (stubbed): ${a1b.name} built (${a1b.n} atoms), caffeine recognised, a bad recipe corrected in one round, a ${a4.spec}-ion KBr lattice placed whole; errors told, a refusal hides it`);
  await page.evaluate(() => { AI.sample = null; aiSync(); });
  check('ask claude');
  // 8b. the Inspect panel holds its scroll position while it refreshes (it used to creep up near the bottom)
  await page.selectOption('#preset', 'gallery'); await page.waitForTimeout(300);
  await page.evaluate(() => { const ps = W.parts.filter(p => !p.dead && p.k === NUC && p.Z > 0).sort((a, b) => b.Z - a.Z); R.sel = ps[0]; showTab('inspect', true); for (const d of document.querySelectorAll('#tp-inspect details')) d.open = true; });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.getElementById('tp-inspect'); b.scrollTop = b.scrollHeight; });
  await page.waitForTimeout(200);
  const sc0 = await page.evaluate(() => document.getElementById('tp-inspect').scrollTop);
  await page.waitForTimeout(2500);
  const sc1 = await page.evaluate(() => document.getElementById('tp-inspect').scrollTop);
  if (!(sc0 > 50) || Math.abs(sc1 - sc0) > 2) { fails++; say(`FAIL the Inspect panel did not hold its scroll position: ${sc0} → ${sc1}`); }
  check('inspect scroll');
  // 9. run a while after all that, reset, and on a phone-sized screen
  await page.waitForTimeout(1500);
  await page.click('#bReset'); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(400);
  await shot('phone');
  await page.setViewportSize({ width: 1360, height: 860 }); await page.waitForTimeout(200);
  check('reset and resize');
  await browser.close();
  say(fails ? `${fails} page failure(s)` : 'page test passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.log('FAIL (test crashed)', e.stack || e); process.exitCode = 1; setTimeout(() => process.exit(1), 2000).unref(); }); // (the browser is left behind on a crash: leave with the failure rather than hang on it)
