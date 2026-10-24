'use strict';
/* Random worlds: random mixtures of atoms of every element (ions, bare nuclei, antimatter), free electrons and
   positrons, neutrons, antiprotons and library molecules, at random temperatures, in random fields and walls,
   with decay on or off; then random colliders. Each must run without an exception and keep its invariants: finite numbers, everything
   inside a closed box, no atom holding more electrons than any ion of its element can, consistent bonds within
   each atom's capacity. node tests/t_fuzz.js [seeds] [frames] [colliders] */
const { load } = require('./load');
const SEEDS = +(process.argv[2] || 24), FRAMES = +(process.argv[3] || 240);
let fails = 0;
const bad = (seed, m) => { fails++; console.log(`FAIL seed ${seed}: ${m}`); };
const t0 = Date.now();
for (let seed = 1; seed <= SEEDS; seed++) {
  const X = load('all', { seed: 1000 + seed });
  const { W, NUC } = X;
  const R = Math.random;
  const pick = (a) => a[Math.floor(R() * a.length)];
  let stage = 'setup';
  try {
    X.PRESETS.empty.build();
    W.box.w = W.box.tw = Math.round(30 + R() * 70); W.box.h = W.box.th = Math.round(25 + R() * 45);
    W.wall = R() < 0.7 ? 'reflect' : R() < 0.5 ? 'wrap' : 'open';
    W.T = Math.exp(Math.log(5) + R() * (Math.log(3e5) - Math.log(5)));
    if (R() < 0.3) { W.Ex = (R() - 0.5) * 2; W.Ey = (R() - 0.5) * 2; }
    if (R() < 0.3) W.Bz = (R() - 0.5) * 4000;
    if (R() < 0.25) W.magnets.push({ x: (R() - 0.5) * W.box.w * 0.6, y: (R() - 0.5) * W.box.h * 0.6, R: 2 + R() * 6, B: (R() - 0.5) * 2e4 });
    W.decayOn = R() < 0.5;
    const molKeys = Object.keys(X.MOLECULES).filter(k => X.MOLECULES[k].cat !== 'objects'); // (tiny objects: the Place tool makes room for them; t_page and t_molecules cover them)
    const n = 15 + Math.floor(R() * 60), T = W.T;
    for (let i = 0; i < n; i++) {
      const x = (R() - 0.5) * (W.box.w - 4), y = (R() - 0.5) * (W.box.h - 4), u = R();
      let spec;
      if (u < 0.45) {
        const Z = R() < 0.7 ? 1 + Math.floor(R() * 20) : 1 + Math.floor(R() * 118);
        const iso = X.isotopeList(Z), A = iso && iso.length ? pick(iso) : Math.round(X.ELEMENTS[Z].mass);
        const lo = -X.maxExtraElectrons(Z), hi = Math.min(Z, 3);
        spec = { kind: 'atom', Z, A: typeof A === 'object' ? A.A : A, charge: R() < 0.7 ? 0 : lo + Math.floor(R() * (hi - lo + 1)), bare: R() < 0.05, anti: R() < 0.06 };
      } else if (u < 0.6) spec = { kind: 'e' };
      else if (u < 0.65) spec = { kind: 'pos' };
      else if (u < 0.7) spec = { kind: 'n' };
      else if (u < 0.72) spec = { kind: 'pbar' };
      else spec = { kind: 'mol', mol: pick(molKeys) };
      X.spawnSpec(spec, x, y, T);
    }
    X.settleOverlaps();
    W.slowmo = false;
    // placed objects (0.66) and a slowed or sped-up pace (0.69)
    const nObj = R() < 0.4 ? 1 + Math.floor(R() * 4) : 0;
    for (let i = 0; i < nObj; i++) { const cx = (R() - 0.5) * W.box.w * 0.7, cy = (R() - 0.5) * W.box.h * 0.7, a = R() * Math.PI, L = 3 + R() * 20;
      X.objAdd(pick(X.OBJ_KINDS), cx - Math.cos(a) * L / 2, cy - Math.sin(a) * L / 2, cx + Math.cos(a) * L / 2, cy + Math.sin(a) * L / 2, { f: (R() - 0.5) * 60 || 10, V: (R() - 0.5) * 400, gap: 2 + R() * 10 }); }
    const pace = R() < 0.3 ? pick([1 / 512, 1 / 16, 4]) : 1; W.simPerFrame *= pace;
    const desc = `${W.parts.filter(p => !p.dead).length} particles, ${W.wall}, ${W.T.toFixed(0)} K${W.Ex || W.Ey ? ', E' : ''}${W.Bz ? ', B' : ''}${W.magnets.length ? ', magnet' : ''}${W.decayOn ? ', decay' : ''}${nObj ? `, ${nObj} objects` : ''}${pace !== 1 ? `, pace ×${pace}` : ''}`;
    stage = 'run';
    let issues = 0;
    for (let f = 0; f < FRAMES && issues < 3; f++) {
      X.simFrame(1 / 60, 40);
      if (f % 30 !== 29 && f !== FRAMES - 1) continue;
      const hw = W.box.w / 2 + 2.5, hh = W.box.h / 2 + 2.5;
      for (const p of W.parts) {
        if (p.dead) continue;
        const nums = [p.x, p.y, p.vx, p.vy, p.m].concat(p.rad ? [p.KE] : []);
        if (!nums.every(Number.isFinite)) { bad(seed, `${desc}: frame ${f}: ${X.speciesLabel(p)} has a non-finite value ${JSON.stringify(nums)}`); issues++; break; }
        if (W.wall === 'reflect' && (Math.abs(p.x) > hw || Math.abs(p.y) > hh)) { bad(seed, `${desc}: frame ${f}: ${X.speciesLabel(p)}${p.rad ? ' (radiation)' : p.fast ? ' (fast)' : ''} outside the box at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`); issues++; break; }
        if (p.k === NUC && p.Z > 0) {
          if (p.ne < 0 || p.ne > p.Z + X.maxExtraElectrons(p.Z)) { bad(seed, `${desc}: frame ${f}: ${X.speciesLabel(p)} holds ${p.ne} electrons`); issues++; break; }
          let used = 0;
          for (const bd of p.bonds) {
            const o = bd.a === p ? bd.b : bd.a;
            if (o.dead || !o.bonds.includes(bd) || !W.bonds.includes(bd)) { bad(seed, `${desc}: frame ${f}: a broken bond record on ${X.speciesLabel(p)}`); issues++; break; }
            if (!(bd.order >= 1 && bd.order <= 3)) { bad(seed, `${desc}: frame ${f}: bond order ${bd.order}`); issues++; break; }
            used += bd.order;
          }
          const lim = Math.max(p.cap, X.hyperCap ? X.hyperCap(p) : p.cap);
          if (used > lim + 0.01 && used > 4) { bad(seed, `${desc}: frame ${f}: ${X.speciesLabel(p)} has ${used} bonds (capacity ${lim})`); issues++; break; }
        }
      }
      if (W.parts.length > X.MAX_PARTS + 50) { bad(seed, `${desc}: ${W.parts.length} particles`); issues++; }
      const E = X.totalEnergy().total;
      if (!Number.isFinite(E)) { bad(seed, `${desc}: frame ${f}: total energy ${E}`); issues++; }
    }
    // multiply charged atomic anions alone in space must have shed their electrons by now
    for (const p of W.parts) if (!p.dead && p.k === NUC && p.Z > 0 && X.holdsTooMany(p) && p.ne > p.Z + 1) bad(seed, `${desc}: ${X.speciesLabel(p)} kept electrons it cannot hold`);
    if (process.argv.includes('-v')) console.log(`seed ${seed}: ${desc}: ok, ${W.parts.filter(p => !p.dead).length} now, ${JSON.stringify(W.count)}`);
  } catch (e) {
    bad(seed, `exception during ${stage}: ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
  }
}
// accelerators: random collider, beams, energy and speed, with stray atoms in the beamline and slow motion on or off
const NC = +(process.argv[4] || Math.max(4, Math.round(SEEDS / 4)));
for (let seed = 1; seed <= NC; seed++) {
  const X = load('all', { seed: 5000 + seed });
  const { W } = X;
  const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)];
  let desc = '';
  try {
    const kind = R() < 0.6 ? 'ring' : 'linear', sp = Object.keys(X.BEAM_SPECIES), E = Math.pow(10, 4.3 + 5.7 * R());
    const anyIso = () => { const Z = 1 + Math.floor(R() * 118); return X.beamKey(Z, pick(X.beamIsotopes(Z))); }; // (any element, any isotope)
    const a = R() < 0.3 ? anyIso() : pick(sp), b = R() < 0.3 ? a : R() < 0.3 ? anyIso() : pick(sp);
    X.PRESETS[kind === 'ring' ? 'ring' : 'linac'].build(); X.setupCollider(kind, a, b, E);
    W.collider.bunch = 1 + Math.floor(R() * 30);
    for (let i = 0, n = Math.floor(R() * 6); i < n; i++) X.spawnSpec({ kind: 'atom', Z: 1 + Math.floor(R() * 30) }, (R() - 0.5) * 100, (R() - 0.5) * 50, 300);
    X.settleOverlaps();
    W.baseSpf = W.simPerFrame; W.simPerFrame *= Math.pow(2, Math.floor(R() * 7) - 3);
    if (R() < 0.3) W.slowHold = false;
    desc = `${kind} (${W.collider.layout}) ${a} + ${b} ${X.fmtE(E)}${W.slowHold ? '' : ', no slow motion'}, speed ×${(W.simPerFrame / W.baseSpf).toFixed(3)}`;
    for (let f = 0; f < Math.max(60, FRAMES / 2); f++) {
      X.simFrame(1 / 60, 30);
      if (R() < 0.005) X.setColliderEnergy(Math.pow(10, 4.3 + 3.7 * R()));
      for (const p of W.parts) {
        if (p.dead) continue;
        const nums = [p.x, p.y, p.vx, p.vy].concat(p.rad ? [p.KE] : []);
        if (!nums.every(Number.isFinite)) throw new Error(`frame ${f}: ${X.speciesLabel(p)} has a non-finite value ${JSON.stringify(nums)}`);
      }
      if (!Number.isFinite(W.zones.reduce((a, z) => a + (z.B || 0) + (z.E || 0) + (z.G || 0), 0))) throw new Error(`frame ${f}: a non-finite field`);
    }
    if (process.argv.includes('-v')) console.log(`collider ${seed}: ${desc}: ok, ${W.collider.hits} collisions`);
  } catch (e) {
    bad('c' + seed, `${desc}: ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
  }
}
console.log(`${SEEDS} random worlds × ${FRAMES} frames and ${NC} random colliders in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(fails ? `${fails} fuzz failure(s)` : 'fuzz test passed');
process.exitCode = fails ? 1 : 0;
