'use strict';
/* The checks for 1.33.0 (the owner, 2026-11-14: "the 3d molecule builder isn't 3d"; the far-face grid in a big 3-D box).
   Run by t_features (one line) or alone: node tests/f_133.js. Each fails on 1.32.0. */
module.exports = async function f133(page, check) {
  { // 1.33.2: DNA as a double helix in the 3-D library, and Ask Claude's flat DNA turned into it in 3-D
    const { load } = require(require('path').join(__dirname, 'load.js'));
    const X = load('all', { seed: 4 }), W = X.W, M = X.MOLECULES.dna3;
    let tw = [], ext = 0;
    if (M) {
      const nb = M.atoms.map(() => []); for (const [i, j] of M.bonds) { nb[i].push(M.atoms[j][0]); nb[j].push(M.atoms[i][0]); }
      const c1 = M.atoms.map((a, i) => i).filter(i => M.atoms[i][0] === 'C' && ['N', 'O', 'C', 'H'].every(e => nb[i].includes(e)));
      const P = c1.map(i => [M.atoms[i][1], M.atoms[i][2], M.z[i]]); // (aligned: the helix's axis is its long one, x)
      const ord = P.map((p, i) => [p[0], i]).sort((a, b) => a[0] - b[0]).map(x => x[1]), pr = [];
      for (let i = 0; i + 1 < ord.length; i += 2) pr.push([P[ord[i]], P[ord[i + 1]]]);
      for (let k = 0; k + 1 < pr.length; k++) { const a = [pr[k][1][1] - pr[k][0][1], pr[k][1][2] - pr[k][0][2]], b = [pr[k + 1][1][1] - pr[k + 1][0][1], pr[k + 1][1][2] - pr[k + 1][0][2]]; let g = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / Math.hypot(...a) / Math.hypot(...b)))) * 180 / Math.PI; if (g > 90) g = 180 - g; tw.push(g); }
      ext = Math.max(...M.z) - Math.min(...M.z);
    }
    const mean = tw.reduce((u, v) => u + v, 0) / (tw.length || 1);
    check(!!M && X.molFits(M, true) && !X.molFits(M, false) && Math.abs(mean - 36) < 4 && ext > 15,
      `1.33.2 DNA double helix (3-D): ${M && M.atoms.length} atoms, the base pairs turned ${tw.map(v => v.toFixed(0)).join('/')}° a step (B-DNA 36°), ${ext.toFixed(1)} Å across, in the 3-D library only`, '1.33.2 dna3: ' + JSON.stringify({ has: !!M, tw, ext }));
  }
  { // continuous bond orders: a member removed and its slot given to a plain atom must not stay on the members' map
    const { load } = require(require('path').join(__dirname, 'load.js'));
    const X = load('all', { seed: 2 }), W = X.W;
    X.PRESETS.empty.build(); W.gamma = 0; X.boSet(true);
    for (let i = 0; i < 6; i++) X.addMolecule('H2O', -12 + 4 * i, 0, 0, 0);
    X.boSync(); X.forcesNoEvents();
    const v = X.BF.mem.slice(-3); X.dropParts(v); W.parts = W.parts.filter(p => !v.includes(p)); X.addAtom('Ne', 0, 0.5);
    X.boSync(); X.forcesNoEvents();
    let bad = 0; for (let k = 0; k < X.BO.np; k++) { const q = X.boPairQ(k); if (!q.a || !q.b || !q.a.bom || !q.b.bom) bad++; }
    check(bad === 0, `1.33 bond orders: a member's slot reused by a plain atom leaves no pair pointing past the members (0 of ${X.BO.np}; 9 before)`, '1.33 bond-order slot map: ' + bad + ' bad pairs');
  }
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  await page.setViewportSize({ width: 1400, height: 900 });
  const r = await page.evaluate(async () => { try {
    const raf = () => new Promise(res => requestAnimationFrame(res)), sleep = (ms) => new Promise(res => setTimeout(res, ms)), out = {};
    const ang = (A, B, C) => { const u = [A.x - B.x, A.y - B.y, (A.z || 0) - (B.z || 0)], v = [C.x - B.x, C.y - B.y, (C.z || 0) - (B.z || 0)]; return Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI; };
    // the builder in the 3-D lab: a chain drawn in space, hydrogens round each carbon, settled and kept in 3-D
    loadPreset('d3empty'); await raf(); openMolBuilder(); await sleep(60); mbClear(); MB.undo.length = 0;
    out.title = $('bldTitle').textContent;
    for (const el of ['C', 'C', 'C', 'O']) mbTapChip({ t: 'el', el });
    out.drawn = { ang: ang(MB.atoms[0], MB.atoms[1], MB.atoms[2]), zr: Math.max(...MB.atoms.map(a => a.z)) - Math.min(...MB.atoms.map(a => a.z)) };
    const mol = mbAssemble(), c0 = mol.atoms[0], hs = mol.bonds.filter(b => b[0] === 0 && mol.atoms[b[1]].el === 'H').map(b => mol.atoms[b[1]]);
    out.hAng = hs.length === 3 ? ang(hs[0], c0, hs[1]) : 0;
    mbTidy(); out.tidy = ang(MB.atoms[0], MB.atoms[1], MB.atoms[2]);
    const t0 = MB.R.slice(); const cv = $('bldCv').getBoundingClientRect();
    out.turnDrag = [cv.left + 30, cv.top + cv.height - 60];
    $('bldName').value = 'f133 propanol'; mbBuild(); await sleep(80);
    const M = Object.values(MOLECULES).find(m => m.name === 'f133 propanol');
    out.mol = M ? { mode: M.mode, n: M.atoms.length, zr: Math.max(...M.z) - Math.min(...M.z) } : null;
    out.saved = JSON.parse(store('mymols') || '[]').some(m => m.n === 'f133 propanol' && Array.isArray(m.z) && m.z.length === m.a.length);
    if (M) { const ats = addMolecule(M.key, 0, 0, 0, 0, 0); out.placed = Math.max(...ats.map(p => p.z)) - Math.min(...ats.map(p => p.z)); myMolRemove(M.key); }
    out.t0 = t0;
    // the far faces' grid in a 20 000 Å box, close in
    loadPreset('d3empty'); W.box.w = W.box.h = W.box.d = W.box.tw = W.box.th = W.box.td = 20000; R.view.grid = true; R.cam3.dist = 30; R.cam3.tx = R.cam3.ty = R.cam3.tz = 0; cam3Update();
    for (let i = 0; i < 4; i++) await raf();
    const c = $('cv'), t2 = document.createElement('canvas'); t2.width = c.width; t2.height = c.height; const x = t2.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); layersInto(x, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; out.grid = sum / (d.length / 4) / 3;
    return out;
  } catch (e) { return { err: e.message + ' ' + (e.stack || '').split('\n')[1] }; } });
  if (r.err) { check(false, '', '1.33 page: ' + r.err); if (own) await own.browser.close(); return; }
  // a drag on empty space turns the view
  await page.mouse.move(r.turnDrag[0], r.turnDrag[1]); await page.evaluate(() => { openMolBuilder(); mbTapChip({ t: 'el', el: 'C' }); });
  const cvr = await page.evaluate(() => { const b = $('bldCv').getBoundingClientRect(); return [b.left + 40, b.top + b.height / 2]; });
  const R0 = await page.evaluate(() => MB.R.slice());
  await page.mouse.move(cvr[0], cvr[1]); await page.mouse.down(); await page.mouse.move(cvr[0] + 60, cvr[1] + 20, { steps: 4 }); await page.mouse.up();
  const R1 = await page.evaluate(() => { const o = MB.R.slice(); mbClear(); $('bldClose').click(); return o; });
  const turned = R0.some((v, i) => Math.abs(v - R1[i]) > 0.05);
  // 1.33.1 (items 85–87): the hover label's distance, the placing plane's distance, Plane / Sphere placing
  const q = await page.evaluate(async () => { try {
    const raf = () => new Promise(res => requestAnimationFrame(res)), out = {};
    loadPreset('d3empty'); await raf(); setTool('place'); selectSpec({ kind: 'atom', Z: 18, A: 40, charge: 0 }); await raf();
    buildToolOpts(); out.opts = !!document.querySelector('#toolopts [data-g="shape"]');
    const spread = (shape) => { OPT.place.shape = shape; const ps = placeSpec({ kind: 'atom', Z: 18, A: 40, charge: 0 }, 0, 0, 20, 0); cam3Update();
      let dmin = Infinity, dmax = -Infinity; for (const p of ps) { const d = (p.x - C3.ex) * C3.fx + (p.y - C3.ey) * C3.fy + (p.z - C3.ez) * C3.fz; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
      for (const p of ps) kill(p); W.parts = W.parts.filter(p => !p.dead); return { n: ps.length, depth: dmax - dmin }; };
    out.plane = spread('plane'); out.sphere = spread('sphere'); OPT.place.shape = 'plane';
    const a = addAtom('Ar', 0, 0, { z: 0 }); a.vx = a.vy = a.vz = 0; cam3Update(); const v = [0, 0, 0]; proj3(a.x, a.y, a.z, v);
    updateHover(v[0], v[1]); out.tip = $('tip').textContent; out.want = Math.hypot(a.x - C3.ex, a.y - C3.ey, a.z - C3.ez);
    SET.dist3 = false; updateHover(v[0], v[1]); out.tipOff = $('tip').textContent; SET.dist3 = true; hideTip();
    loadPreset('d3empty'); openMolBuilder(); UI.spec = null; aiApply({ type: 'object', key: 'dna', note: '' }); out.dna = UI.spec && UI.spec.mol; out.bldOpen = !$('bldModal').hidden;
    let txt = ''; const c = document.createElement('canvas').getContext('2d'), ft = c.fillText; c.fillText = function (t) { txt += t + '|'; return ft.apply(this, arguments); }; drawPlaneDist3(c); out.plText = txt;
    return out;
  } catch (e) { return { err: e.message }; } });
  // 1.33.2 item 88: the enlarged decay chart fills its window, points and clicks; Settings' tabs in the header with arrows
  const g = await page.evaluate(async () => { try {
    const sleep = (ms) => new Promise(res => setTimeout(res, ms)), out = {};
    loadPreset('chain'); W.simPerFrame *= 20; setRunning(true); for (let i = 0; i < 800 && !(W.chain && W.chain.fis.length >= 3); i++) await sleep(25); setRunning(false);
    showTab('data', true); await sleep(150); UI.mapView = 'chart'; UI.mapKey = null; drawChainMap();
    if (!UI.mapPos) return { err: `no map: ${W.chain ? W.chain.fis.length : 'no chain'} fissions, section ${$('dMapSec').hidden ? 'hidden' : 'shown'}, ${$('dMapSec').offsetParent ? 'on screen' : 'off screen'}` };
    const small = UI.mapPos && UI.mapPos.L.cs; chartOpen($('chMap')); await sleep(200);
    const L = UI.mapPos.L, cv = $('chBig'), rr = cv.getBoundingClientRect(), o = UI.mapPos.off, [kk, v] = [...L.nodes][0], b = L.band(v.Z);
    out.fill = { cs: L.cs, small, h: L.h, H: cv.clientHeight, centred: o[0] > 0 || o[1] > 0 };
    const x = rr.left + o[0] + b.ox + v.N * L.cs + L.cs / 2, y = rr.top + o[1] + b.top + (b.z1 - v.Z) * L.cs + L.cs / 2;
    $('chartBody').dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true })); await sleep(30);
    out.hov = UI.mapHov && UI.mapHov.k === kk; out.note = $('chBigNote').textContent.length > 20 && !$('chBigNote').hidden;
    chartZoom(2, rr.width / 2, rr.height / 2); out.sharp = cv.style.transform === '' && UI.big.z === 2;
    UI.big.z = 1; UI.big.x = 0; UI.big.y = 0; chartTf();
    const L2 = UI.mapPos.L, o2 = UI.mapPos.off, b2 = L2.band(v.Z), x2 = rr.left + o2[0] + b2.ox + v.N * L2.cs + L2.cs / 2, y2 = rr.top + o2[1] + b2.top + (b2.z1 - v.Z) * L2.cs + L2.cs / 2;
    $('chartBody').dispatchEvent(new MouseEvent('click', { clientX: x2, clientY: y2, bubbles: true })); await sleep(80);
    out.opened = !$('ptModal').hidden && UI.ptSel && UI.ptSel.Z === v.Z && UI.ptSel.A === v.Z + v.N; hideModal('ptModal');
    // the Made here window's search
    const mr = W.made && [...W.made.nuc.values()].find(r => !r.anti && r.Z > 30);
    out.madeHas = !!mr;
    if (mr) { $('dMade').querySelector('button[data-more]') ? $('dMade').querySelector('button[data-more]').click() : (UI.madeAllHTML = null, showModal('madeModal'), renderMade()); await sleep(80);
      const all = [...$('dMadeAll').querySelectorAll('tr:not(.elh)')].length, f = $('madeFind'); f.value = ELEMENTS[mr.Z].name; f.dispatchEvent(new Event('input')); await sleep(30);
      const vis = [...$('dMadeAll').querySelectorAll('tr:not(.elh)')].filter(t => !t.hidden);
      out.made = { all, shown: vis.length, ok: vis.length > 0 && vis.length < all && vis.every(t => (t.textContent + (t.previousElementSibling ? '' : '')).length > 0), n: $('madeFindN').textContent };
      f.value = ''; f.dispatchEvent(new Event('input')); out.made.back = [...$('dMadeAll').querySelectorAll('tr:not(.elh)')].every(t => !t.hidden); hideModal('madeModal'); }
    // event captions hidden by the setting
    setSetting('caps', 'off'); out.capsOff = captionBox(document.createElement('canvas').getContext('2d'), { text: 'x', t0: W.rt }, 10, 10, 100, []) === null; setSetting('caps', 'on');
    // Explain what's happening empties when the setup is loaded again
    $('dExplain').hidden = false; $('dExplain').textContent = 'old explanation'; loadPreset(UI.preset); out.explainReset = $('dExplain').hidden && !$('dExplain').textContent;
    // Claude's answers read leniently (Identify molecules): the page's JSON reading refuses, the plain text is cut off
    { const keep = AI.sample; const f = async () => ({ text: 'Sure! ```json\n{"names":[{"i":0,"name":"Ethyl radical","cat":"organic"},{"i":1,"name":"Prop' }); f.json = async () => { throw { code: 'invalid_json' }; };
      AI.sample = f; try { const r = await aiJSON('x', {}); out.loose = r && r.names && r.names.length === 1 && r.names[0].name === 'Ethyl radical'; } catch (e) { out.loose = 'threw ' + (e && e.code); } AI.sample = keep; }
    $('bSettings').click(); await sleep(150);
    const h = document.querySelector('#setModal header').getBoundingClientRect(), t = document.querySelector('#setModal .stabs').getBoundingClientRect();
    out.tabs = { inHeader: t.top >= h.top && t.bottom <= h.bottom, arrows: document.querySelectorAll('#setTabsHs .hs-arrow').length === 2 };
    $('setClose').click();
    return out;
  } catch (e) { return { err: e.message }; } });
  check(!g.err && g.fill.cs > g.fill.small && g.fill.centred && g.hov && g.note && g.sharp && g.opened,
    `1.33.2 (88) the enlarged decay chart fills its window (cells ${g.fill && g.fill.cs.toFixed(0)} px, ${g.fill && g.fill.small.toFixed(0)} in the panel), centred; pointing tells a nuclide's story under it, zooming redraws sharp, a click opens it in the Elements window`, '1.33.2 chart: ' + JSON.stringify(g));
  check(!g.err && (!g.madeHas || (g.made.ok && g.made.back)) && g.capsOff && g.explainReset, `1.33.2 the Made here window has a search (${g.made ? g.made.shown + ' of ' + g.made.all + ' rows for an element' : 'nothing made'}); Display → Event captions: Hidden takes the event boxes off; Explain what's happening empties when the setup is loaded again`, '1.33.2 made/caps/explain: ' + JSON.stringify(g));
  check(!g.err && g.loose === true, '1.33.2 Claude\'s answers read leniently: refused as JSON, asked again as text, words and fences round it and a cut-off end forgiven (the whole entries kept)', '1.33.2 loose JSON: ' + JSON.stringify(g.loose));
  check(!g.err && g.tabs.inHeader && g.tabs.arrows, '1.33.2 Settings: the tabs in the header beside the search box, with side arrows', '1.33.2 tabs: ' + JSON.stringify(g));
  if (own) await own.browser.close();
  const m = /([\d.,]+) Å from the camera/.exec(q.tip || ''), pm = /Placing plane ([\d.,]+) Å from the camera/.exec(q.plText || '');
  check(!q.err && m && Math.abs(parseFloat(m[1].replace(/,/g, '')) - q.want) < 0.05 && !/from the camera/.test(q.tipOff), `1.33.1 (85) hovering an atom in 3-D tells its distance from the camera ("${m && m[0]}"), off with the setting`, '1.33.1 hover distance: ' + JSON.stringify(q));
  check(!q.err && !!pm, `1.33.1 (86) with the Place tool, the placing plane's distance from the camera shows bottom left ("${pm && pm[0]}")`, '1.33.1 plane distance: ' + JSON.stringify(q));
  check(!q.err && q.dna === 'dna3' && !q.bldOpen, '1.33.2 Ask Claude answering with the flat DNA object in the 3-D lab gives the double helix (dna3), ready to place', '1.33.2 Claude dna: ' + JSON.stringify(q));
  check(!q.err && q.opts && q.plane.n === 20 && q.sphere.n === 20 && q.plane.depth < 0.5 && q.sphere.depth > 4, `1.33.1 (87) Place → Spread: 20 argon on the plane span ${q.plane && q.plane.depth.toFixed(2)} Å in depth, through a sphere ${q.sphere && q.sphere.depth.toFixed(1)} Å`, '1.33.1 sphere placing: ' + JSON.stringify(q));
  check(/3-D/.test(r.title) && Math.abs(r.drawn.ang - 109.5) < 4 && r.drawn.zr > 0.5 && Math.abs(r.hAng - 109.5) < 4 && turned,
    `1.33 the molecule builder in the 3-D lab works in space: a drawn chain bends at ${r.drawn.ang.toFixed(1)}° with ${r.drawn.zr.toFixed(2)} Å of depth, a CH₃'s hydrogens ${r.hAng.toFixed(1)}° apart; dragging empty space turns it`, '1.33 builder 3-D: ' + JSON.stringify({ r, turned }));
  check(r.mol && r.mol.mode === '3d' && r.mol.zr > 1 && r.saved && r.placed > 1 && Math.abs(r.tidy - 112) < 6,
    `1.33 Tidy and Build settle it in 3-D (C–C–C ${r.tidy.toFixed(1)}°); it is kept with its depths (${r.mol && r.mol.zr.toFixed(2)} Å), in the 3-D library, and put down as built`, '1.33 build 3-D: ' + JSON.stringify(r));
  check(r.grid < 40, `1.33 the far faces' grid in a 20 000 Å box seen close in stays faint (mean brightness ${r.grid.toFixed(1)}; 87 in 1.32)`, '1.33 grid: ' + r.grid);
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check);
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
