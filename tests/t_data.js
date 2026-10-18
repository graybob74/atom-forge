'use strict';
/* Data consistency: molecule-name keys must be in the Hill order the lookup builds; every tabulated decay's
   Q-value must agree with the binding-energy table; branchings add to 1; stable nuclides are not in the decay
   table; a few element constants against reference values. Node only. */
const { load } = require('./load');
const X = load();
let fails = 0;
const bad = (msg) => { fails++; console.log('FAIL', msg); };

// 1. molecule names: keys in Hill order (C, H, then alphabetical; otherwise alphabetical), as hill() builds them
{
  let n = 0;
  for (const k of Object.keys(X.MOLECULE_NAMES)) {
    n++;
    const m = k.match(/^((?:[A-Z][a-z]?\d*)+)([+-]\d*|\d*[+-])?$/);
    if (!m) { bad(`molecule key ${k} does not parse`); continue; }
    const atoms = [];
    for (const [, s, c] of m[1].matchAll(/([A-Z][a-z]?)(\d*)/g)) {
      const Z = X.SYM2Z[s];
      if (!Z) { bad(`molecule key ${k}: no element ${s}`); continue; }
      for (let i = 0; i < (+c || 1); i++) atoms.push({ el: X.ELEMENTS[Z], q: 0 });
    }
    if (m[2]) { const t = m[2].replace(/[+-]/, ''); atoms[0].q = (+t || 1) * (m[2].includes('-') ? -1 : 1); }
    const h = X.hill(atoms, true);
    if (h !== k) bad(`molecule key ${k} is never looked up (Hill order is ${h})`);
  }
  console.log(`${n} molecule names checked`);
}

// 2. decays: Q from the binding-energy table (MeV; atomic-mass Q-values, as the table lists them)
{
  const MNP = 0.782347; // (m_n − m_p − m_e)c², MeV
  const B = (z, n) => (z + n <= 1 ? 0 : X.tableB(z, n));
  let n = 0, cmp = 0, worst = 0;
  for (const [key, d] of Object.entries(X.DECAY)) {
    n++;
    const [Z, N] = key.split('_').map(Number);
    if (!(d[0] > 0) || !isFinite(d[0])) bad(`${key}: half-life ${d[0]}`);
    if (X.isStableNuclide(Z, N)) bad(`${key}: listed as stable and as decaying`);
    const modes = Array.isArray(d[1]) ? d[1] : [[d[1], 1, d[2]]];
    const sum = modes.reduce((s, m) => s + m[1], 0);
    if (Math.abs(sum - 1) > 0.011) bad(`${key}: branchings add to ${sum}`);
    for (const [mode, br, Q] of modes) {
      if (!(Q > 0)) bad(`${key} ${mode}: Q = ${Q}`);
      const b0 = B(Z, N);
      let q = null;
      if (b0 === null) continue;
      if (mode === 'a') { const b1 = B(Z - 2, N - 2), ba = B(2, 2); if (b1 !== null) q = b1 + ba - b0; }
      else if (mode === 'b-') { const b1 = B(Z + 1, N - 1); if (b1 !== null) q = MNP + b1 - b0; }
      else if (mode === 'b+' || mode === 'ec') { const b1 = B(Z - 1, N + 1); if (b1 !== null) q = -MNP + b1 - b0; }
      else if (mode === 'p') { const b1 = B(Z - 1, N); if (b1 !== null) q = b1 - b0; }
      else if (mode === 'n') { const b1 = B(Z, N - 1); if (b1 !== null) q = b1 - b0; }
      if (q === null) continue;
      cmp++;
      const diff = Q - q;
      worst = Math.max(worst, Math.abs(diff));
      if (Math.abs(diff) > Math.max(0.03, 0.01 * Math.abs(q))) bad(`${key} ${X.nucSym(Z, N)} ${mode} (br ${br}): table Q ${Q} MeV, binding energies give ${q.toFixed(4)} MeV (off by ${diff.toFixed(4)})`);
    }
  }
  console.log(`${n} decay entries, ${cmp} Q-values compared with the binding energies (worst difference ${worst.toFixed(4)} MeV)`);
}

// 3. element constants against reference values (standard atomic weight, Pauling electronegativity, first IE)
{
  const REF = { // Z: [mass u, EN, IE1 eV]
    1: [1.008, 2.20, 13.598], 2: [4.0026, null, 24.587], 6: [12.011, 2.55, 11.260], 7: [14.007, 3.04, 14.534],
    8: [15.999, 3.44, 13.618], 9: [18.998, 3.98, 17.423], 11: [22.990, 0.93, 5.139], 17: [35.45, 3.16, 12.968],
    26: [55.845, 1.83, 7.902], 29: [63.546, 1.90, 7.726], 47: [107.87, 1.93, 7.576], 55: [132.91, 0.79, 3.894],
    79: [196.97, 2.54, 9.226], 82: [207.2, 2.33, 7.417], 92: [238.03, 1.38, 6.194],
  };
  for (const [z, [m, en, ie]] of Object.entries(REF)) {
    const E = X.ELEMENTS[+z];
    if (Math.abs(E.mass - m) > 0.01 * m * 0.1 + 0.002) bad(`${E.sym} mass ${E.mass} (reference ${m})`);
    if (en !== null && E.en && Math.abs(E.en - en) > 0.02) bad(`${E.sym} electronegativity ${E.en} (reference ${en})`);
    const ie1 = X.ionE(+z, +z);
    if (Math.abs(ie1 - ie) > 0.02) bad(`${E.sym} first ionization energy ${ie1} (reference ${ie})`);
  }
  console.log(`${Object.keys(REF).length} elements checked against reference constants`);
}

console.log(fails ? `${fails} data failure(s)` : 'data checks passed');
process.exitCode = fails ? 1 : 0;
