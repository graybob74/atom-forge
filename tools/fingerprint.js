'use strict';
/* Fingerprints of the setups: build each (seed 7), settle, 300 steps, and hash every particle's state. Used by bug-fix
   sessions to show the flat game (and the 3-D setups) unchanged, bit for bit, except where a fix means to change it.
   node tools/fingerprint.js [key …]        (no keys: every setup; one line "key hash" each)
   node tools/fingerprint.js --list         (the keys) */
const { load } = require('../tests/load.js');
const args = process.argv.slice(2), STEPS = +(process.env.FP_STEPS || 300);
if (args[0] === '--list') { const X = load('all', { seed: 7 }); console.log(Object.keys(X.PRESETS).join('\n')); process.exit(0); }
const keys = args.length ? args : Object.keys(load('all', { seed: 7 }).PRESETS);
const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
for (const k of keys) {
  const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
  try {
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < STEPS; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    console.log(k.padEnd(14), h(parts + '|' + exo + '|' + W.bonds.length), 'books', h(JSON.stringify(W.ledger)), W.parts.filter(p => !p.dead).length); // (the state, then the energy books apart)
  } catch (e) { console.log(k.padEnd(14), 'ERROR', String(e.message || e).slice(0, 80)); }
}
