'use strict';
/* The checks for 1.28.1's items 45–51 (the owner, 2026-11-08: "build 45-51"), run by t_features (one line) or alone:
   node tests/f_1281.js [part …]   (parts: info, grab, exodraw, muscat, muview)
   45–46 info boxes with Read more; 47 and 49 exotic particles grabbed and drawn at a size, muonic hydrogen off any
   nucleus; 48 positronium's pair going round on the watching clock; 50 throwing; 51 the muon of a muonic atom in the
   particle view, flat and 3-D. Each fails on 1.28.0. (check(ok, good, bad); say(...)) */
const PARTS = {};
const WIKI_OK = /^https:\/\/en\.wikipedia\.org\/wiki\/[A-Za-z0-9_()\-.,%']+$/; // (the desktop shell's open_wiki opens only these)

PARTS.info = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms));
    hideMainMenu(); loadPreset('empty'); setRunning(false);
    const o = { el: EL_INFO.filter(Boolean).length, short: EL_INFO.filter(t => t && t.length > 260).length };
    o.noKey = Object.keys(XP).filter(sp => !infoKeyX(sp));
    o.links = Object.values(P_INFO).map(e => wikiURL(e[1])).concat(ELEMENTS.slice(1, 119).map((e, Z) => wikiURL(elWiki(Z + 1))));
    openPT({ Z: 26, A: 56, q: 0, bare: false, anti: false }); await w(80);
    o.btn = !!$('ptInfo'); UI.ptInfo = false; renderPTDetail(); $('ptInfo').click(); await w(50);
    const box = $('pdetail').querySelector('.infobox'); o.card = box ? box.textContent : ''; o.href = box && box.querySelector('a.readmore') ? box.querySelector('a.readmore').href : '';
    hideModal('ptModal');
    const mu = addExo('muP', 0, 0, 0.03, 1, 0); R.selX = { kind: 'exo', o: mu }; R.sel = null;
    const B = addExo('B+', 2, 2, 1e6, 1, 0); o.exoBox = !!selXHTML().match(/class="infobox"/); R.selX = { kind: 'exo', o: B }; o.bAbout = selXHTML();
    o.bWrong = /A neutral meson; it decays almost at once/.test(o.bAbout); o.bInfo = /bottom quark/.test(o.bAbout);
    R.selX = null; mu.dead = true; B.dead = true; loadPreset('water'); setRunning(false); return o;
  });
  const badLinks = r.links.filter(u => !WIKI_OK.test(u));
  say('  1.28.1 info: ' + JSON.stringify({ ...r, links: r.links.length, bAbout: undefined, badLinks }));
  check(r.el === 118 && r.short === 0 && r.noKey.length === 0 && !badLinks.length && r.btn && /steel/.test(r.card) && /wikipedia\.org\/wiki\/Iron$/.test(r.href) && r.exoBox && r.bInfo && !r.bWrong,
    `1.28.1 (45–46) info: all 118 elements and every one of the ${Object.keys({}).length || 'unstable'} particles' kinds have a few words; the element card's ⓘ About opens iron's with Read more (${r.href}); the card of muonic hydrogen and of a B⁺ have theirs (a B⁺ no longer called "a neutral meson"); ${r.links.length} links, all of the form the desktop app opens`,
    '1.28.1 info: ' + JSON.stringify({ ...r, bAbout: undefined, badLinks }));
};

PARTS.grab = async (page, check, say) => {
  // with the real pointer: an argon atom thrown, a muonic hydrogen held and thrown
  const set = await page.evaluate(() => {
    hideMainMenu(); loadPreset('empty'); setRunning(false); W.T = 0;
    const a = addAtom(18, -15, 0, 0); a.vx = 0; a.vy = 0; const mu = addExo('muP', 15, 0, 0, 1, 0);
    R.s = 12; R.cx = 0; R.cy = 0; setTool('grab'); OPT.grab.s = 'strong'; setRunning(true);
    const cv = $('cv').getBoundingClientRect();
    return { ax: cv.left + w2sx(a.x), ay: cv.top + w2sy(a.y), mx: cv.left + w2sx(mu.x), my: cv.top + w2sy(mu.y), id: a.id, mid: mu.id };
  });
  const fling = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(x + i * 6, y + i * 2); await page.waitForTimeout(16); } await page.mouse.up(); await page.waitForTimeout(60); };
  await fling(set.ax, set.ay);
  const a1 = await page.evaluate((id) => { const a = W.parts.find(p => p.id === id); return { v: Math.hypot(a.vx, a.vy), vx: a.vx }; }, set.id);
  await page.mouse.move(set.mx, set.my); await page.mouse.down(); await page.waitForTimeout(80);
  const held = await page.evaluate(() => ({ exo: !!(W.grab && W.grab.exo), sp: W.grab && W.grab.exo ? W.grab.exo.sp : null }));
  for (let i = 1; i <= 10; i++) { await page.mouse.move(set.mx + i * 5, set.my - i * 3); await page.waitForTimeout(16); }
  const follow = await page.evaluate((id) => { const o = W.exo.find(q => q.id === id); return { x: o.x, KE: o.KE }; }, set.mid);
  await page.mouse.up(); await page.waitForTimeout(40);
  const after = await page.evaluate((id) => { const o = W.exo.find(q => q.id === id); const r = { KE: o.KE, ux: o.ux, uy: o.uy, v: o.v, grab: !!W.grab }; setRunning(false); setTool('inspect'); loadPreset('water'); setRunning(false); return r; }, set.mid);
  const r = { a1, held, follow, after };
  say('  1.28.1 grab: ' + JSON.stringify(r));
  check(a1.v > 0.01 && a1.vx > 0 && held.exo && held.sp === 'muP' && follow.x > 16 && follow.KE === 0 && after.KE > 0 && after.ux > 0 && after.uy > 0 && !after.grab,
    `1.28.1 (50, 47, 49) Grab: an argon atom thrown flies on at ${(a1.v * 10).toFixed(1)} km/s (it stopped where let go); muonic hydrogen can be grabbed (held at rest, it follows the pointer) and is thrown the way the pointer went (${after.KE.toExponential(2)} eV)`,
    '1.28.1 grab: ' + JSON.stringify(r));
};

PARTS.exodraw = async (page, check, say) => {
  const r = await page.evaluate(() => {
    hideMainMenu(); loadPreset('empty'); setRunning(false); R.view.bohr = 'off';
    const out = {}, cv = document.createElement('canvas'); cv.width = 120; cv.height = 120; const ctx = cv.getContext('2d', { willReadFrequently: true }), ctx0 = R.ctx; R.ctx = ctx; // (drawSprite draws on R.ctx)
    const ink = () => { const d = ctx.getImageData(0, 0, 120, 120).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; };
    for (const sp of ['muP', 'muHe', 'hy2_2', 'oPs']) {
      const o = addExo(sp, 0, 0, 0.03, 1, 0), c = XP[sp].col, hx = '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
      ctx.clearRect(0, 0, 120, 120); out[sp] = { top: exoAtomPic(ctx, o, 60, 60, c, hx, 20), ink: ink() }; o.dead = true;
    }
    // positronium's pair moves on the watching clock (W.rt), and stands still when it does not move
    const ps = addExo('pPs', 0, 0, 0.03, 1, 0), c = XP.pPs.col, hx = '#ffffff', at0 = W.at;
    const pic = () => { ctx.clearRect(0, 0, 120, 120); exoAtomPic(ctx, ps, 60, 60, c, hx, 40); return ctx.getImageData(0, 0, 120, 120).data.join(','); };
    const rt0 = W.rt, a = pic(); W.rt = rt0 + 0.2; const b = pic(); const b2 = pic(); W.rt = rt0; W.at = at0; ps.dead = true;
    out.psMoves = a !== b; out.psStill = b === b2; R.ctx = ctx0;
    loadPreset('water'); setRunning(false); return out;
  });
  say('  1.28.1 exotic atoms drawn: ' + JSON.stringify(r));
  check(r.muP.top > 4 && r.muP.ink > 60 && r.muHe.top > 4 && r.hy2_2.top > 4 && r.oPs.top >= 8 && r.oPs.ink > 40 && r.psMoves && r.psStill,
    `1.28.1 (47, 48) muonic hydrogen, (μα)⁺ and a hypernucleus are drawn as a nucleus a few pixels or more across (μp ${r.muP.ink} pixels at 20 px/Å, it was a 2.6 px ring) with the muon's ring; positronium's electron and positron go round on the watching clock`,
    '1.28.1 exotic atoms drawn: ' + JSON.stringify(r));
};

PARTS.muscat = async (page, check, say) => {
  const r = await page.evaluate(() => {
    const o = {};
    for (const [lab, Z] of [['oxygen', 8], ['hydrogen', 1]]) {
      hideMainMenu(); loadPreset('empty'); setRunning(false); W.T = 0; W.decayOn = false;
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) addAtom(Z, -20 + 5 * i, -20 + 5 * j, 0);
      for (const p of W.parts) { p.vx = 0; p.vy = 0; }
      W.count.muScat = 0; let n = 0;
      for (let k = 0; k < 12; k++) addExo('muP', -24, -20 + 3.6 * k + 0.13, 2, 1, 0.003);
      for (let s = 0; s < 400; s++) { step(0.05); }
      o[lab] = W.count.muScat || 0;
    }
    loadPreset('water'); setRunning(false); return o;
  });
  say('  1.28.1 muonic hydrogen scattering: ' + JSON.stringify(r));
  check(r.oxygen > 0 && r.hydrogen > 0, `1.28.1 (47) muonic hydrogen bounces off the nuclei it passes in oxygen too (${r.oxygen} bounces; ${r.hydrogen} in hydrogen), not only off hydrogen's`, '1.28.1 muonic hydrogen scattering: ' + JSON.stringify(r));
};

PARTS.muview = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms));
    const o = {};
    for (const [lab, preset] of [['flat', 'empty'], ['3-D', 'empty3d']]) {
      hideMainMenu(); loadPreset(PRESETS[preset] ? preset : 'empty'); if (lab === '3-D' && !W.d3) world3d(40); setRunning(false);
      const c = addAtom(6, 0, 0, 0); c.ne = 0; c.q = 6; c.muB = { m: 105.66e6 * 0.999, zx: 1 }; // (a bare carbon nucleus with a muon bound: as muStop leaves one)
      R.view.bohr = 'nuc'; let n = 0; const keep = window.muOrbit; window.muOrbit = function () { n++; return keep.apply(this, arguments); };
      try { R.dirtyAll = true; render(performance.now() / 1000); await w(30); render(performance.now() / 1000); } finally { window.muOrbit = keep; }
      o[lab] = n; R.view.bohr = 'off';
    }
    loadPreset('water'); setRunning(false); return o;
  });
  say('  1.28.1 the muon in the particle view: ' + JSON.stringify(r));
  check(r.flat > 0 && r['3-D'] > 0, '1.28.1 (51) the particle view draws the muon of a bare muonic nucleus, flat and in 3-D (it was missing in 3-D)', '1.28.1 the muon in the particle view: ' + JSON.stringify(r));
};

module.exports = async function f1281(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.28.1 ${k}: ${e.message.split('\n')[0]}`); }
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
