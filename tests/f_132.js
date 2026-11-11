'use strict';
/* The checks for 1.32.0 (the owner, 2026-11-10, "build it"): planned items 76–84. Run by t_features (one line) or alone:
   node tests/f_132.js [part …]. Each part fails on 1.31.0. (check(ok, good, bad); say(...)) */
const path = require('path');
const PARTS = {};

/* 76: electrons as full waves (harness): a free wave keeps its energy exactly; one through two Na⁺ keeps the world's
   books (the wave's energy, the ions', and the point it becomes) to a few hundredths of an eV; it is made and found. */
PARTS.waves = async (page, check) => {
  const { load } = require(path.join(__dirname, 'load.js'));
  const run = (ions, KE, steps) => {
    const X = load('all', { seed: 3 }), W = X.W;
    X.PRESETS.empty.build(); W.gamma = 0; W.Ex = 0; W.Ey = 0; W.decayOn = false;
    if (ions) for (const y of [-1.6, 1.9]) { const A = X.addAtom('Na', 0, y, { charge: 1 }); A.vx = 0; A.vy = 0; }
    X.addLepton(X.ELEC, -8, 0.3, Math.sqrt(2 * KE / X.PHYS.ME_SIM), 0);
    X.forcesNoEvents(); W.fSpawn = W.spawned; X.FW.on = true;
    const tot = () => X.totalEnergy().total + W.ledger.bath, E0 = tot(); let n = 0, worst = 0;
    for (let s = 0; s < steps; s++) { X.step(0.04); n = Math.max(n, X.FW.n); worst = Math.max(worst, Math.abs(tot() - E0)); }
    return { d: tot() - E0, worst, n, made: X.FW.made, meas: X.FW.meas, why: X.FW.why, pts: X.W.parts.filter(p => !p.dead && p.k === X.ELEC).length };
  };
  const free = run(false, 5, 3), ions = run(true, 6, 8);
  check(free.n === 1 && Math.abs(free.d) < 1e-6, `1.32 (76) a full wave in free flight keeps its energy exactly (${free.d.toExponential(1)} eV over 3 steps)`, '1.32 free wave: ' + JSON.stringify(free));
  check(ions.made === 1 && ions.meas === 1 && ions.pts === 1 && Math.abs(ions.d) < 0.05 && ions.worst < 0.1,
    `1.32 (76) an electron as a full wave past two Na⁺: made, found (${Object.keys(ions.why).join(', ')}) and a point again, the books kept to ${ions.d.toFixed(3)} eV (worst ${ions.worst.toFixed(3)})`, '1.32 wave past ions: ' + JSON.stringify(ions));
};

PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  await page.setViewportSize({ width: 1600, height: 1000 });
  const r = await page.evaluate(async () => { try {
    const out = {}, raf = () => new Promise(res => requestAnimationFrame(res)), sleep = (ms) => new Promise(res => setTimeout(res, ms));
    const key = (o) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...o }));
    loadPreset('water'); await raf();
    // 77, 78: the Elements window: saved isotopes only for the chosen element; the highlight slides to the new cell
    MYISO.length = 0; MYISO.push({ Z: 26, A: 56, q: 0 }, { Z: 92, A: 235, q: 0 });
    openPT(); await sleep(50);
    const pick = async (Z) => { const c = $('pgrid').querySelector(`[data-z="${Z}"]`); c.click(); await sleep(220); const h = $('pgrid').querySelector('.pt-hl'), hr = h.getBoundingClientRect(), cr = $('pgrid').querySelector(`[data-z="${Z}"]`).getBoundingClientRect(); return { saved: document.querySelectorAll('#ptModal .isosaved').length, at: Math.abs(hr.left - cr.left) < 2 && Math.abs(hr.top - cr.top) < 2, tr: getComputedStyle(h).transitionProperty }; };
    out.fe = await pick(26); out.o = await pick(8); out.u = await pick(92);
    hideModal('ptModal'); MYISO.length = 0;
    // 79: the setups menu's search
    $('presetDD').click(); await sleep(80);
    const sb = document.querySelector('.ddpop .ddsearch'); out.search = !!sb;
    if (sb) { sb.value = 'gold'; sb.dispatchEvent(new Event('input')); await sleep(30); out.first = (document.querySelector('.ddpop .ddo.hi') || {}).textContent || ''; sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(80); out.loaded = UI.preset; }
    // 80, 84: Settings: search, and each tab back to its defaults
    loadPreset('water'); $('bSettings').click(); await sleep(100);
    const f = $('setFind'); f.value = 'walls'; f.dispatchEvent(new Event('input')); await sleep(30);
    const vis = [...document.querySelectorAll('#setModal .spane:not([hidden]) .srow:not(.sf-hide), #setModal .spane:not([hidden]) label.check:not(.sf-hide)')].filter(e => e.offsetParent && !e.closest('.sf-hide'));
    out.find = { n: $('setFindN').textContent, vis: vis.length, tabsHidden: getComputedStyle(document.querySelector('#setModal .stabs')).display === 'none' };
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(30);
    out.find.back = !f.value && !document.querySelector('#setModal .sf-hide') && getComputedStyle(document.querySelector('#setModal .stabs')).display !== 'none';
    setTabS('disp'); const keys = setTabKeys(), k = keys.disp[0], v0 = SET[k]; SET[k] = typeof v0 === 'boolean' ? !v0 : v0; SET.maxParts = 8000;
    document.querySelector('#setModal .spane[data-stab="disp"] .sdef button').click();
    out.def = { k, back: SET[k] === SET_DEF[k], kept: SET.maxParts === 8000 };
    document.querySelector('#setModal .spane[data-stab="disp"] .sdefn button').click(); out.def.undo = SET[k] === (typeof v0 === 'boolean' ? !v0 : v0);
    SET.maxParts = SET_DEF.maxParts; SET[k] = v0; $('setClose').click();
    // 81: a picture of the chamber at full resolution, with and without labels
    const fs = fileSave, got = []; window.fileSave = async (n, b) => { got.push([n, b.size, b.type]); return true; };
    const a = await shotSave(false), b = await shotSave(true); window.fileSave = fs;
    out.shot = { a, b, cv: [$('cv').width, $('cv').height], got: got.length, labels: R.view.labels, bare: !!R.bare, btn: !!$('bShot') };
    // 82: pinned Inspect cards
    const ps = W.parts.filter(p => !p.dead && p.k === NUC && p.Z === 8).slice(0, 4); showTab('inspect', true);
    for (const p of ps) { R.sel = p; renderInspect(); document.querySelector('#tp-inspect [data-act="pin"]').click(); }
    const n3 = document.querySelectorAll('#tp-inspect .ins-pin').length; document.querySelector('#tp-inspect .ins-pin .pin-x').click();
    out.pins = [n3, document.querySelectorAll('#tp-inspect .ins-pin').length, PINS.includes(ps[0])]; PINS.length = 0; renderInspect();
    // 83: 3-D camera views: kept, flown back to, saved with the world
    loadPreset('mol3d'); for (let i = 0; i < 3; i++) await raf();
    const c0 = { ...R.cam3 }; key({ key: '!', code: 'Digit2', shiftKey: true }); R.cam3.yaw += 2; R.cam3.dist *= 3; R.cam3.tx += 4; cam3Update();
    key({ key: '2', code: 'Digit2' }); for (let i = 0; i < 70; i++) await raf();
    out.view3 = { back: ['tx', 'dist', 'yaw', 'pitch'].every(q => Math.abs(R.cam3[q] - c0[q]) < 1e-6 * (1 + Math.abs(c0[q]))), saved: !!(worldExtrasJSON().views3 || {})[2] };
    // 76: the setting, the flat game only
    loadPreset('empty'); $('bSettings').click(); setTabS('exp'); await sleep(60);
    const row = $('segWaveF').closest('.srow'); out.wf2 = !row.classList.contains('smode-hide'); $('setClose').click();
    loadPreset('d3empty'); $('bSettings').click(); setTabS('exp'); await sleep(60); out.wf3 = !$('segWaveF').closest('.srow').classList.contains('smode-hide'); $('setClose').click();
    return out;
  } catch (e) { return { err: e.message + ' ' + (e.stack || '').split('\n')[1] }; } });
  if (own) await own.browser.close();
  if (r.err) { check(false, '', '1.32 page: ' + r.err); return; }
  check(r.fe.saved && !r.o.saved && r.u.saved, '1.32 (77) the Elements window lists saved isotopes only for the chosen element (Fe, U yes; O none)', '1.32 saved isotopes: ' + JSON.stringify([r.fe, r.o, r.u]));
  check(r.fe.at && r.o.at && r.u.at && /transform/.test(r.fe.tr), '1.32 (78) the chosen element\'s highlight slides to each new cell (transform transition)', '1.32 highlight: ' + JSON.stringify([r.fe, r.o, r.u]));
  check(r.search && /gold/i.test(r.first) && r.loaded === 'rutherford', `1.32 (79) the setups menu has a search box: "gold" finds Rutherford's gold foil first, Enter opens it`, '1.32 setups search: ' + JSON.stringify([r.search, r.first, r.loaded]));
  check(/^\d+ setting/.test(r.find.n) && parseInt(r.find.n, 10) === r.find.vis && r.find.vis > 0 && r.find.tabsHidden && r.find.back, `1.32 (80) Settings search: "walls" shows ${r.find.n} from every tab, the tabs hidden; Esc puts them back`, '1.32 settings search: ' + JSON.stringify(r.find));
  check(r.def.back && r.def.kept && r.def.undo, `1.32 (84) Display → Back to defaults resets that tab only (${r.def.k}), Performance kept; Undo restores`, '1.32 tab defaults: ' + JSON.stringify(r.def));
  check(r.shot.btn && r.shot.got === 2 && r.shot.a.w === r.shot.cv[0] && r.shot.a.h === r.shot.cv[1] && r.shot.b.bare && r.shot.a.size !== r.shot.b.size && r.shot.labels && !r.shot.bare,
    `1.32 (81) a PNG of the chamber at ${r.shot.a.w} × ${r.shot.a.h} (its canvas's pixels), with and without labels (${r.shot.a.size} / ${r.shot.b.size} bytes)`, '1.32 screenshot: ' + JSON.stringify(r.shot));
  check(r.pins[0] === 3 && r.pins[1] === 2 && !r.pins[2], '1.32 (82) pinned Inspect cards: up to three kept above the card, the oldest dropped for a fourth, × closes one', '1.32 pins: ' + JSON.stringify(r.pins));
  check(r.view3.back && r.view3.saved, '1.32 (83) 3-D lab: Shift+2 keeps the camera, 2 flies back to it, and it is kept with the save', '1.32 3-D views: ' + JSON.stringify(r.view3));
  check(r.wf2 && !r.wf3, '1.32 (76) Electrons as waves → Blobs (eFF) / Full waves, shown in the flat game only', '1.32 full waves row: ' + JSON.stringify([r.wf2, r.wf3]));
};

module.exports = async function f132(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.32 ${k}: ${e.message.split('\n')[0]}`); }
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
