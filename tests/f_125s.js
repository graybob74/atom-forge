'use strict';
/* The 1.25 checks for Settings by mode (the owner: "since the numbers for 3d are very different, the settings menu should
   change based on which mode you're in ... There should also be 3d pictures in 3d mode"), run by t_features (its 1.25
   area) or alone: node tests/f_125s.js [part …] (parts: settings3d). Each fails on 1.24.0 and on v128 before this item
   (no mode in Settings: one set of costs, words and pictures). (page: the t_features page; check(ok, good, bad); say(...)) */
const PARTS = {};
const TABS = ['perf', 'gfx', 'disp', 'ctl', 'gen', 'd3', 'ai', 'exp'];

PARTS.settings3d = async (page, check, say, openPage) => {
  const look = (pg) => pg.evaluate(async (TABS) => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const tagsOf = (id) => [...$(id).querySelectorAll('button')].map(b => (b.querySelector('.oc') || {}).textContent || '');
    const one = () => {
      const o = { mode: ($('setMode') || {}).textContent || '', tags: {}, only: {}, pics: [], bad: [], notes: {} };
      for (const id of ['segBo', 'segRc', 'segPi', 'segQeq', 'segDtMax', 'segWave', 'segMetal']) o.tags[id] = tagsOf(id).join(' ');
      for (const id of ['setInc', 'segZoomTo', 'segFov3', 'setAxes3']) { const r = document.querySelector(`#setModal [data-sk="${id}"]`); const t = r && r.querySelector('.smo'); o.only[id] = (t ? t.textContent : '') + (r && r.classList.contains('smode-off') ? ' dim' : ''); }
      for (const m of ['2d', '3d']) o.notes[m] = [...document.querySelectorAll(`#setModal [data-m="${m}"]`)].filter(n => !n.hidden).length;
      const D = {}; for (const k of ['segBo', 'segPi', 'segWheel', 'exp']) { setPrevShow(k, null); D[k] = $('setPrevT').textContent + ' | ' + $('setPrevD').textContent; } o.desc = D;
      // every row and every choice of every tab: which picture the pane shows (its key) and whether it is marked as the flat game's
      for (const t of TABS) {
        openSettings(t);
        for (const r of document.querySelectorAll(`#setModal .spane[data-stab="${t}"] > .srow, #setModal .spane[data-stab="${t}"] > label.check`)) {
          const k = setRowKey(r), opts = [null, ...[...r.querySelectorAll('.seg button')].map(b => b.dataset.v)];
          for (const v of opts) {
            setPrevShow(k, v); const img = $('setPrevImg');
            if (!img.hidden) { o.pics.push([k, v, img.dataset.key, !$('setPrevCap').hidden]); if (Object.entries(SETSHOTS).find(([kk, u]) => u === img.src && kk !== img.dataset.key)) o.bad.push(k); }
          }
        }
      }
      // the enlarged view shows the pane's picture
      openSettings('gfx'); setPrevShow('segAtom', null); shotOpen(); o.big = Object.keys(SETSHOTS).find(kk => SETSHOTS[kk] === $('shotBoxImg').src) || ''; shotClose();
      return o;
    };
    const out = {};
    hideModal('setModal'); loadPreset('water'); setRunning(false); openSettings('exp'); await wait(80); out.d2 = one();
    // the mode switches while Settings is open (a 3-D setup chosen), without a reload
    openSettings('exp'); setPrevShow('segBo', '1'); const p0 = $('setPrevD').textContent, t0 = tagsOf('segBo').join(' ');
    loadPreset('water3d'); setRunning(false); await wait(80);
    out.live = { open: !$('setModal').hidden, mode: ($('setMode') || {}).textContent || '', paneChanged: $('setPrevD').textContent !== p0, tagsChanged: tagsOf('segBo').join(' ') !== t0, pic: $('setPrevImg').dataset.key || '' };
    out.d3 = one();
    // through the main menu: 3-D → Settings, then back to 2-D → Settings
    showMainMenu(); await wait(60); mmAction('mode3d'); await wait(60); mmAction('settings3'); await wait(80);
    out.menu3 = { d3: !!W.d3, mode: ($('setMode') || {}).textContent || '', bo: tagsOf('segBo').join(' ') };
    hideModal('setModal'); mmAction('choose'); await wait(60); mmAction('mode2d'); await wait(60); mmAction('settings'); await wait(80);
    out.menu2 = { d3: !!W.d3, mode: ($('setMode') || {}).textContent || '', bo: tagsOf('segBo').join(' ') };
    hideModal('setModal'); hideMainMenu(); loadPreset('water'); setRunning(false);
    out.k3 = Object.keys(SETSHOTS).filter(k => k.endsWith('@3d'));
    out.kb3 = Math.round(out.k3.reduce((t, k) => t + SETSHOTS[k].length, 0) / 1024);
    out.rows = [...document.querySelectorAll('#setModal [data-sk]')].map(r => r.dataset.sk);
    return out;
  }, TABS);
  const r = await look(page);
  const { d2, d3 } = r;
  check(d2.mode === '2-D game' && d3.mode === '3-D lab',
    `1.25 Settings by mode: the title says which (${d2.mode} / ${d3.mode})`, '1.25 settings3d mode tag: ' + JSON.stringify([d2.mode, d3.mode]));
  const tagDiff = ['segBo', 'segRc', 'segPi', 'segQeq', 'segDtMax'].filter(id => d2.tags[id] !== d3.tags[id]);
  check(tagDiff.length === 5 && /×(18|7–14)/.test(d3.tags.segBo) && /×6–15/.test(d2.tags.segBo) && /×7–17/.test(d3.tags.segRc),
    `1.25 Settings by mode: the cost tags are this mode's: bond orders ${d2.tags.segBo} / ${d3.tags.segBo}, force reach ${d2.tags.segRc} / ${d3.tags.segRc}, quantum nuclei ${d2.tags.segPi} / ${d3.tags.segPi}`,
    '1.25 settings3d tags: ' + JSON.stringify({ d2: d2.tags, d3: d3.tags }));
  check(/twist/.test(d3.desc.segBo) && !/twist/.test(d2.desc.segBo) && /drawn in depth/.test(d3.desc.segPi) && /camera/.test(d3.desc.segWheel) && /3-D lab/.test(d3.desc.exp) && d2.desc.exp !== d3.desc.exp
    && d2.notes['3d'] === 0 && d3.notes['2d'] === 0 && d2.notes['2d'] > 5 && d3.notes['3d'] > 5,
    `1.25 Settings by mode: descriptions and notes follow the mode (3-D: the twist in bond orders, quantum nuclei's beads drawn in depth (bug fix 8 after 1.25), the wheel moving the camera; notes ${d2.notes['2d']} flat / ${d3.notes['3d']} 3-D, none of the other mode's shown)`,
    '1.25 settings3d words: ' + JSON.stringify({ notes2: d2.notes, notes3: d3.notes, bo3: d3.desc.segBo.slice(0, 160), pi3: d3.desc.segPi.slice(0, 160) }));
  check(d3.only.setInc === '2-D only dim' && d3.only.segZoomTo === '2-D only dim' && d3.only.segFov3 === '' && d2.only.segFov3 === '3-D only dim' && d2.only.setAxes3 === '3-D only dim' && d2.only.setInc === '',
    '1.25 Settings by mode: one-mode settings dimmed with a tag in the other (3-D: detailed nuclear collisions and zoom toward "2-D only"; flat: the 3-D tab "3-D only")', '1.25 settings3d only: ' + JSON.stringify({ d2: d2.only, d3: d3.only }));
  const in2 = d2.pics.filter(p => /@3d$/.test(p[2])), marked2 = d2.pics.filter(p => p[3]);
  const has3 = r.k3.map(k => k.replace(/@3d$/, '')), exp3 = ([k, v]) => (v !== null && has3.includes(k + ':' + v) ? k + ':' + v + '@3d' : has3.includes(k) ? k + '@3d' : null);
  const want3 = d3.pics.filter(p => exp3(p)), wrong3 = want3.filter(p => p[2] !== exp3(p)), flat3 = d3.pics.filter(p => p[3]).map(p => p[0]);
  const orphans = has3.filter(k => !r.rows.includes(k.split(':')[0]));
  check(d2.pics.length > 40 && in2.length === 0 && marked2.length === 0 && !/@3d$/.test(d2.big) && d2.bad.length === 0,
    `1.25 Settings by mode: in the flat game every picture shown is a flat one (${d2.pics.length} rows and choices, the enlarged view too: ${d2.big}), none marked`,
    '1.25 settings3d flat pictures: ' + JSON.stringify({ n: d2.pics.length, in2, marked2: marked2.slice(0, 5), big: d2.big, bad: d2.bad }));
  check(r.k3.length >= 8 && want3.length >= r.k3.length && wrong3.length === 0 && /@3d$/.test(d3.big) && orphans.length === 0 && flat3.includes('segPi') && !flat3.includes('segFov3') && d3.bad.length === 0,
    `1.25 Settings by mode: in 3-D the ${r.k3.length} settings with a 3-D picture show it (${want3.length} rows and choices; enlarged: ${d3.big}), the rest the flat one marked "Picture from the flat game" (${flat3.length}, e.g. quantum nuclei); 3-D pictures ${r.kb3} KB`,
    '1.25 settings3d 3-D pictures: ' + JSON.stringify({ k3: r.k3, wrong3, big: d3.big, orphans, flat3 }));
  check(r.live.open && r.live.mode === '3-D lab' && r.live.paneChanged && r.live.tagsChanged && /@3d$/.test(r.live.pic)
    && r.menu3.d3 && r.menu3.mode === '3-D lab' && /×(18|7–14)/.test(r.menu3.bo) && !r.menu2.d3 && r.menu2.mode === '2-D game' && /×6–15/.test(r.menu2.bo),
    '1.25 Settings by mode: it switches with the mode without a reload (a 3-D setup chosen with Settings open; main menu → 3-D → Settings, and back to 2-D → Settings)',
    '1.25 settings3d switching: ' + JSON.stringify({ live: r.live, menu3: r.menu3, menu2: r.menu2 }));
  // narrow: 390 px wide, both modes: the notes of the other mode are not shown in the list, and nothing runs off the edge
  if (openPage) {
    const n = await openPage({ viewport: { width: 390, height: 844 }, settle: 600 });
    const narrow = await n.page.evaluate(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms)), out = {};
      for (const k of ['water', 'water3d']) {
        hideModal('setModal'); loadPreset(k); setRunning(false); openSettings('exp'); await wait(120);
        const box = document.querySelector('#setModal .sbox').getBoundingClientRect(), m = W.d3 ? '2d' : '3d';
        const shown = [...document.querySelectorAll(`#setModal [data-m="${m}"]`)].filter(e => e.offsetParent).length;
        const over = Math.max(0, ...[...document.querySelectorAll('#setModal .spane:not([hidden]) > *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().right - box.right));
        out[k] = { mode: ($('setMode') || {}).textContent || '', otherShown: shown, over: Math.round(over) };
      }
      return out;
    });
    await n.browser.close();
    check(narrow.water.mode === '2-D game' && narrow.water3d.mode === '3-D lab' && narrow.water.otherShown === 0 && narrow.water3d.otherShown === 0 && narrow.water.over <= 1 && narrow.water3d.over <= 1,
      `1.25 Settings by mode at 390 px: each mode's notes only, nothing past the edge (${narrow.water.over} / ${narrow.water3d.over} px)`, '1.25 settings3d narrow: ' + JSON.stringify(narrow));
  }
};

/* ---- the 3-D tab's Labels row with Off and On hover (the owner: "add a setting to remove labels in 3d because ... 10
   bajillion letters is overstimulating"): one switch with Graphics → Labels and the view menu's Labels, kept across a
   reload; drawn labels counted by wrapping label() through a render of the molecules in space */
PARTS.labels3d = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise(res => setTimeout(res, ms)), out = {};
    hideModal('setModal'); loadPreset('mol3d'); setRunning(false); setSetting('axes3', true); cam3Fit(); R.cam3.dist *= 0.5; cam3Update();
    const lab0 = window.label; let n = 0, who = new Set(); window.label = function (ctx, txt, x, y) { n++; who.add(txt + '@' + Math.round(x) + ',' + Math.round(y)); return lab0.apply(this, arguments); };
    const count = () => { n = 0; who = new Set(); render(W.rt); return n; };
    openSettings('d3'); await wait(50);
    out.choices = [...$('segLbl3').querySelectorAll('button')].map(b => b.dataset.v).join(' ');
    const click = (v) => { const b = $('segLbl3').querySelector(`[data-v="${v}"]`); if (b) b.click(); };
    click('all'); out.all = count(); out.allSet = [SET.labels, SET.lbl3, R.view.labels, $('segLabels').querySelector('[aria-pressed="true"]').dataset.v].join(' ');
    click('front'); out.front = count();
    click('off'); out.off = count(); const vc = document.querySelector('[data-view="labels"]'); out.offSet = [R.view.labels, vc ? vc.checked : null, $('segLabels').querySelector('[aria-pressed="true"]').dataset.v].join(' ');
    out.kept = JSON.parse(store('viewflags') || '{}').labels;
    click('hover'); R.hover = W.parts.find(p => p.Z === 8 && !p.dead); R.sel = null; out.hover = count(); out.hoverSet = [SET.labels, R.view.labels, $('segLabels').querySelector('[aria-pressed="true"]').dataset.v].join(' ');
    R.hover = null; out.hoverNone = count();
    // Graphics → Labels → Never shows as Off in the 3-D row, and Always as the 3-D row's own choice (front, chosen last)
    $('segLabels').querySelector('[data-v="never"]').click(); syncSettings(); out.fromGfx = $('segLbl3').querySelector('[aria-pressed="true"]').dataset.v;
    $('segLabels').querySelector('[data-v="always"]').click(); syncSettings(); out.fromGfx2 = $('segLbl3').querySelector('[aria-pressed="true"]').dataset.v;
    window.label = lab0; click('front'); hideModal('setModal'); loadPreset('water'); setRunning(false);
    return out;
  });
  check(r.choices === 'off hover front all' && r.all > r.front && r.front > 3 && r.off === 0 && r.hover === 1 && r.hoverNone === 0
    && r.allSet === 'always all true always' && r.offSet === 'false false never' && r.kept === false && r.hoverSet === 'hover true hover' && r.fromGfx === 'off' && r.fromGfx2 === 'front',
    `1.25 3-D labels: the 3-D tab's Labels row offers Off, On hover, Front atoms only and All atoms (labels drawn: all ${r.all}, front ${r.front}, off ${r.off}, hover ${r.hover} on the hovered atom, ${r.hoverNone} with none), one switch with Graphics → Labels and the view menu's checkbox, kept`,
    '1.25 labels3d: ' + JSON.stringify(r));
};

module.exports = async function f125s(page, check, say, openPage, only) {
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
  say(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
