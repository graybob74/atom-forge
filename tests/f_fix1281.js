'use strict';
/* 1.28.1 bug: loading a save made the speed it was saved at the new 1× (src/ui.js worldToJSON / worldFromJSON /
   speedNormal). A world opened by the player starts at the setup's normal speed; undo keeps the speed and its 1×.
   Run by t_features, or alone: node tests/f_fix1281.js. Fails on 1.28.0: the base became 4× the setup's. */
module.exports = async function ffix1281(page, check, say) {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise(res => setTimeout(res, ms));
    hideMainMenu(); loadPreset('water'); setRunning(false); await w(50);
    const B = W.baseSpf, o = { B };
    setSpeed(B * 4); await w(30); o.before = $('speedVal').textContent;
    store('autosave', JSON.stringify(worldToJSON())); loadPreset('salt'); setRunning(false); restoreAutosave(); await w(50);
    o.load = { base: W.baseSpf / B, spf: W.simPerFrame / B, shown: $('speedVal').textContent };
    setSpeed(B * 4); undoMark('a test'); setSpeed(B / 2); undoRestore(UNDO.back[UNDO.back.length - 1]); await w(30);
    o.undo = { base: W.baseSpf / B, spf: W.simPerFrame / B, shown: $('speedVal').textContent };
    loadPreset('water'); setRunning(false); return o;
  });
  say('  1.28.1 speed after loading: ' + JSON.stringify(r));
  check(r.load.base === 1 && r.load.spf === 1 && r.undo.base === 1 && r.undo.spf === 4,
    `1.28.1 a save made at ${r.before} opens at the setup's normal speed (${r.load.shown}), its 1× the setup's; undo keeps the speed it had (${r.undo.shown}) against the same 1×`,
    '1.28.1 speed after loading: ' + JSON.stringify(r));
};
if (require.main === module) (async () => {
  const { openPage } = require('./browser');
  const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  await browser.close(); say(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
