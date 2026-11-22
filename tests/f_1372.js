'use strict';
/* 1.37.2 (the owner, 2026-11-22: "some particles get thrown out or just don't collide … (tried with B mesons which didn't
   collide and sigma baryons got thrown at 20 TeV) … while colliding with another element (promethium)"). heavy: a B⁺
   beam meets a promethium beam and strikes its nuclei, keeping its b quark. linac: a 20 TeV Σ⁺ reaches the collision
   point at full energy on the axis. Run by t_features or alone: node tests/f_1372.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
PARTS.heavy = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build();
  const tg = X.addAtom('Pm', 0, 0, { A: 145 }); tg.ne = 0; const o = X.addExo('B+', -1, 0, 1e10, 1, 0);
  X.hadronHit(o, tg, 0.2); const made = W.exo.filter(x => !x.dead).map(x => x.sp);
  const Y = load('all', { seed: 3 }), V = Y.W; Y.PRESETS.ring.build(); Y.setupCollider('ring', 'xB+', Y.beamKey(61, 145), 1e10); V.slowHold = false; V.hold = null; V.slowmo = false; Y.settleOverlaps(); V.baseSpf = V.simPerFrame;
  const t0 = Date.now(); for (let f = 0; f < 12 && Date.now() - t0 < 120000; f++) Y.simFrame(1 / 60, 1e9);
  // (and on its way through it strikes several nucleons, as many as its path holds: the owner, "can you make the b mesons able to hit multiple nucleons?")
  const nus = []; let bk = 0;
  for (let i = 0; i < 30; i++) { W.exo.length = 0; W.parts.length = 0; const t2 = X.addAtom('Pm', 0, 0, { A: 145 }); t2.ne = 0; const o2 = X.addExo('B+', -1, 0, 1e10, 1, 0);
    const b0 = X.totalEnergy().total + W.ledger.bath - W.ledger.nuc; X.hadronHit(o2, t2, 0.05); bk = Math.max(bk, Math.abs(X.totalEnergy().total + W.ledger.bath - W.ledger.nuc - b0));
    const m = /struck (\d+) nucleons/.exec((W.log[W.log.length - 1] || {}).text || ''); nus.push(m ? +m[1] : 1); }
  const nuM = nus.reduce((a, b) => a + b, 0) / nus.length;
  check(nuM > 2.5 && nuM < 6 && bk < 1e-3, `1.37.2 a B⁺ through the middle of a promethium nucleus strikes ${nuM.toFixed(1)} nucleons on average (books within ${X.fmtE(bk)})`, `1.37.2 heavy: struck ${JSON.stringify(nus)}, books ${bk}`);
  check(made.filter(s => s === 'B+').length === 1 && V.collider.hits > 50, `1.37.2 a B⁺ striking promethium keeps its b quark (${made.length} made, one a B⁺); a B⁺ beam on a promethium beam: ${V.collider.hits} collisions (8 before)`, `1.37.2 heavy: made ${made.join(',')}, ring hits ${V.collider.hits}`);
};
PARTS.linac = async (page, check) => {
  const X = load('all', { seed: 3, patch: s => s.replace('function step(dt) {', 'function step(dt) { if (globalThis.HOOK) globalThis.HOOK();') }), W = X.W; X.PRESETS.linac.build();
  X.setupCollider('linear', 'xSig+', X.beamKey(61, 145), 2e13); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const at = []; globalThis.HOOK = () => { for (const o of W.exo) if (!o.dead && o.xb && o.beam === 'a' && !o._seen && o.x > -2) { o._seen = 1; at.push([o.KE, Math.abs(o.y)]); } };
  const t0 = Date.now(); for (let f = 0; f < 30 && at.length < 4 && Date.now() - t0 < 120000; f++) X.simFrame(1 / 60, 1e9);
  globalThis.HOOK = null;
  const lo = Math.min(...at.map(r => r[0])), wide = Math.max(...at.map(r => r[1]));
  check(at.length >= 3 && lo > 0.9 * 2e13 && wide < 3, `1.37.2 20 TeV Σ⁺ reach the collision point at full energy on the axis (${at.length}, the lowest ${X.fmtE(lo)}, within ${wide.toFixed(1)} Å; before, 2.7–20 TeV: the focusing magnet, at full strength, made them radiate it away)`, `1.37.2 linac: ${JSON.stringify(at)}`);
};
module.exports = async function f1372(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.37.2 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
