'use strict';
/* The checks for 1.27.1's Settings layout, asked for by the owner (src/ui.js depSync, setModeSync, expResetAll; body.html
   data-dep; shell.html label.check.rpl), run by t_features (one line) or alone: node tests/f_set1271.js [part …]
   (parts: deps, switches, mode, reset). Each fails on 1.27.0 (v157): there sub-options always show, Electrons as waves,
   resonance and following are an On/Off group and plain checkboxes, the switches sit just after their names, the flat
   game lists the 3-D lab's settings dimmed, and Experimental has no reset. (check(ok, good, bad); say(...)) */
const PARTS = {};

/* ---- 1. A sub-option shows only while its option is on (Quantum method under Bond orders → Quantum; polarizability
   under Induced charges; matter depth under Charged particles in matter; the rewind's options under Rewind). */
PARTS.deps = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms));
    hideModal('setModal'); hideMainMenu(); loadPreset('water'); setRunning(false); openSettings('exp'); await w(80);
    const vis = (id) => { const e = $(id), row = e && (e.closest('.srow') || e.closest('label')); return !!row && !!row.offsetParent; };
    const o = {};
    o.normal = ['segXq', 'segXqs', 'segPold', 'segCpmX'].map(vis);
    const bo = $('segBo').querySelector('[data-v="2"]'); o.boQ = !!bo;
    if (bo) { bo.click(); await w(50); o.quantum = ['segXq', 'segXqs'].map(vis); $('segBo').querySelector('[data-v="0"]').click(); await w(50); }
    const q = [...$('segQeq').querySelectorAll('button')].find(b => b.dataset.v !== '0'); q.click(); await w(50); o.qeq = vis('segPold');
    $('segQeq').querySelector('[data-v="0"]').click(); await w(50); o.qeqOff = vis('segPold');
    $('setRpCpm').click(); await w(50); o.cpm = vis('segCpmX'); $('setRpCpm').click(); await w(50); o.cpmOff = vis('segCpmX');
    o.left = Object.keys(expOn());
    hideModal('setModal'); return o;
  });
  say('  1.27.1 deps: ' + JSON.stringify(r));
  check(r.normal.join() === 'false,false,false,false' && r.boQ && r.quantum.join() === 'true,true' && r.qeq && !r.qeqOff && r.cpm && !r.cpmOff && r.left.length === 0,
    '1.27.1 Settings: a sub-option shows only while its option is on (quantum method and spins under Bond orders → Quantum, polarizability under Induced charges, matter depth under Charged particles in matter)',
    '1.27.1 deps: ' + JSON.stringify(r));
};

/* ---- 2. The Experimental switches: Electrons as waves, resonance in any ring and following a nucleon are switches, and
   every switch of the tab sits at the same right edge; a long name wraps rather than widening the list. */
PARTS.switches = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms));
    hideModal('setModal'); hideMainMenu(); loadPreset('water'); setRunning(false); openSettings('exp'); await w(80);
    const o = { kind: ['setWave', 'setResBig', 'setInc'].map(id => !!$(id) && $(id).type === 'checkbox' && $(id).classList.contains('sw')) };
    const sw = [...document.querySelectorAll('#setModal .spane[data-stab="exp"] > label.check input.sw')].filter(e => e.offsetParent);
    const rights = sw.map(e => Math.round(e.getBoundingClientRect().right)); o.n = sw.length; o.spread = Math.max(...rights) - Math.min(...rights);
    const p = document.querySelector('#setModal .spane[data-stab="exp"]'); o.over = p.scrollWidth - p.clientWidth;
    $('setWave').click(); $('setResBig').click(); $('setInc').click(); o.on = [SET.wave, SET.resBig, SET.inc];
    $('setWave').click(); $('setResBig').click(); $('setInc').click(); o.off = [SET.wave, SET.resBig, SET.inc];
    hideModal('setModal'); return o;
  });
  say('  1.27.1 switches: ' + JSON.stringify(r));
  check(r.kind.every(Boolean) && r.n >= 12 && r.spread <= 1 && r.over <= 10 && r.on.join() === '1,true,true' && r.off.join() === '0,false,false',
    `1.27.1 Settings: Electrons as waves, resonance in any ring and following a nucleon are switches, and all ${r.n} switches of Experimental line up at the right (spread ${r.spread} px)`,
    '1.27.1 switches: ' + JSON.stringify(r));
};

/* ---- 3. The 3-D lab's own settings are not shown in the flat game (rows, their notes, the 3-D tab) and carry a
   "3-D exclusive" tag in the 3-D lab. */
PARTS.mode = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms));
    const one = () => {
      const row = (id) => document.querySelector(`#setModal [data-sk="${id}"]`);
      const note = (id) => { const n = row(id).nextElementSibling; return !!n && n.matches('p.note') && !n.classList.contains('smode-hide'); }; // (its note: hidden with it; in the wide layout a description shows in the side pane)
      return { lps: !!row('segLps').offsetParent, pis: !!row('segPis').offsetParent, lpsNote: note('segLps'), tag: ((row('segLps').querySelector('.smo') || {}).textContent || ''),
        tab3: !document.querySelector('#setModal .stabs [data-stab="d3"]').hidden, sigh: !!row('segSigh').offsetParent };
    };
    const o = {};
    hideModal('setModal'); hideMainMenu(); loadPreset('water'); setRunning(false); openSettings('exp'); await w(80); o.d2 = one();
    hideModal('setModal'); loadPreset('water3d'); setRunning(false); openSettings('exp'); await w(80); o.d3 = one();
    hideModal('setModal'); loadPreset('water'); setRunning(false); return o;
  });
  say('  1.27.1 mode: ' + JSON.stringify(r));
  check(!r.d2.lps && !r.d2.pis && !r.d2.lpsNote && !r.d2.tab3 && r.d2.sigh && r.d3.lps && r.d3.pis && r.d3.lpsNote && r.d3.tab3 && r.d3.tag === '3-D exclusive',
    '1.27.1 Settings: the 3-D lab\'s settings (lone pairs, π-stacking, the 3-D tab) are not shown in the flat game, and are tagged "3-D exclusive" in the 3-D lab',
    '1.27.1 mode: ' + JSON.stringify(r));
};

/* ---- 4. Experimental → Reset to normal: every Experimental setting back to normal at once, the others kept. */
PARTS.reset = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms));
    hideModal('setModal'); hideMainMenu(); loadPreset('water'); setRunning(false); openSettings('exp'); await w(80);
    const o = { dis0: $('setExpReset').disabled, theme: SET.theme };
    $('setWave').click(); $('setRpExo').click(); $('segRc').querySelector('button:last-child').click(); $('segSigh').querySelector('[data-v="1"]').click(); await w(50);
    o.on = Object.keys(expOn()).sort().join(); o.dis1 = $('setExpReset').disabled; o.tot1 = $('expTotal').querySelector('.big').textContent;
    $('setExpReset').click(); await w(80);
    o.after = Object.keys(expOn()).length; o.dis2 = $('setExpReset').disabled; o.tot2 = $('expTotal').querySelector('.big').textContent;
    o.ui = [$('setWave').checked, $('setRpExo').checked, $('segRc').querySelector('[aria-pressed="true"]').dataset.v === String(SET_DEF.rc)];
    const st = JSON.parse(store('settings') || '{}'); o.stored = SET_EXP.filter(k => k in st && st[k] !== SET_DEF[k]).length; o.theme2 = SET.theme;
    hideModal('setModal'); return o;
  });
  say('  1.27.1 reset: ' + JSON.stringify(r));
  check(r.dis0 && r.on === 'rc,rpExo,sigh,wave' && !r.dis1 && r.tot1 !== '×1' && r.after === 0 && r.dis2 && r.tot2 === '×1' && r.ui.join() === 'false,false,true' && r.stored === 0 && r.theme2 === r.theme,
    '1.27.1 Settings: Experimental → Reset to normal puts every Experimental setting back to normal at once (greyed when all is normal; the total back to ×1; other settings kept)',
    '1.27.1 reset: ' + JSON.stringify(r));
};

module.exports = async function fset1271(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.27.1 ${k}: ${e.message.split('\n')[0]}`); }
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
  say(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
