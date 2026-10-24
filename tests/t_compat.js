'use strict';
/* Old saves load (0.69): worlds saved by earlier versions (tests/fixtures/worlds-<version>.json, each the version's own
   worldToJSON of a few setups after 20 frames) open in this one, in the page, with every particle, bond and magnet, and
   run on with finite energy; a share code (the same world, deflated) round-trips. node tests/t_compat.js */
const fs = require('fs'), path = require('path');
const { openPage } = require('./browser');
let fails = 0;
const say = (...a) => console.log(...a);
const dir = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(dir).filter(f => /^worlds-[\d.]+\.json$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
(async () => {
  const { browser, page, errors } = await openPage();
  await page.evaluate(() => setRunning(false));
  for (const f of files) {
    const v = f.slice(7, -5), all = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const res = await page.evaluate((all) => {
      const out = [];
      for (const [k, o] of Object.entries(all)) {
        if (o.err) continue;
        const r = worldFromJSON(o.d); setRunning(false);
        if (typeof r === 'string') { out.push({ k, err: r }); continue; }
        const n = W.parts.filter(p => !p.dead).length, nb = W.bonds.length, nm = W.magnets.length;
        forcesNoEvents(); W.fSpawn = W.spawned;
        const E0 = totalEnergy().total; for (let i = 0; i < 20; i++) simFrame(1 / 60, 1e9); const E1 = totalEnergy().total;
        const finite = W.parts.every(p => p.dead || (Number.isFinite(p.x) && Number.isFinite(p.vx)));
        out.push({ k, ok: n === o.n && nb === o.nb && nm === o.nm && Number.isFinite(E0) && Number.isFinite(E1) && finite, n, nb, nm, want: [o.n, o.nb, o.nm] });
      }
      return out;
    }, all);
    for (const r of res) if (r.err || !r.ok) { fails++; say(`FAIL ${v} ${r.k}: ${r.err || JSON.stringify(r)}`); }
    say(`  ${v}: ${res.map(r => `${r.k} ${r.n}`).join(', ')}`);
  }
  const sc = await page.evaluate(async () => {
    loadPreset('water'); setRunning(false); objAdd('mirror', 0, -5, 0, 5);
    const d = worldToJSON(), code = await shareEncode(d), back = await shareDecode(code);
    return { len: code.length, pre: code.slice(0, 4), same: typeof back === 'object' && back.parts.length === d.parts.length && back.bonds.length === d.bonds.length && back.objs.length === 1, n: d.parts.length };
  });
  if (!sc.same || sc.pre !== 'AF1:') { fails++; say('FAIL share code round trip', JSON.stringify(sc)); }
  else say(`  share code: ${sc.len.toLocaleString('en-US')} characters for ${sc.n} particles and a mirror, back intact`);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 600)); }
  await browser.close();
  console.log(fails ? `${fails} compatibility failure(s)` : 'compatibility checks passed');
  process.exitCode = fails ? 1 : 0;
})();
