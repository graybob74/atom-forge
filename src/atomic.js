'use strict';
/* ============================================================================
   Atom Forge — atomic & nuclear structure helpers (pure functions, cached)
   ========================================================================== */

const LN2 = Math.LN2;
const rnd = Math.random;
let _gSpare = 0, _gHas = false;
function gauss() { // Marsaglia polar method, two normals per pair of uniforms
  if (_gHas) { _gHas = false; return _gSpare; }
  let u, v, s;
  do { u = 2 * rnd() - 1; v = 2 * rnd() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  _gSpare = v * m; _gHas = true;
  return u * m;
}
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

/* ---------- Electron configurations (Aufbau / Madelung rule + known exceptions) ---------- */
const SUBSHELLS = [[1,0],[2,0],[2,1],[3,0],[3,1],[4,0],[3,2],[4,1],[5,0],[4,2],[5,1],[6,0],[4,3],[5,2],[6,1],
  [7,0],[5,3],[6,2],[7,1],[8,0]];
const LCAP = [2, 6, 10, 14];
const LLET = ['s', 'p', 'd', 'f'];
const CONFIG_EXCEPT = {
  24:{'3d':5,'4s':1}, 29:{'3d':10,'4s':1}, 41:{'4d':4,'5s':1}, 42:{'4d':5,'5s':1}, 44:{'4d':7,'5s':1},
  45:{'4d':8,'5s':1}, 46:{'4d':10,'5s':0}, 47:{'4d':10,'5s':1}, 57:{'4f':0,'5d':1}, 58:{'4f':1,'5d':1},
  64:{'4f':7,'5d':1}, 78:{'5d':9,'6s':1}, 79:{'5d':10,'6s':1}, 89:{'5f':0,'6d':1}, 90:{'5f':0,'6d':2},
  91:{'5f':2,'6d':1}, 92:{'5f':3,'6d':1}, 93:{'5f':4,'6d':1}, 96:{'5f':7,'6d':1}, 103:{'5f':14,'6d':0,'7p':1},
};
const _cfgCache = new Map();

function aufbau(count) {
  const occ = new Map();
  let left = count;
  for (const [n, l] of SUBSHELLS) {
    if (left <= 0) break;
    const c = Math.min(LCAP[l], left);
    occ.set(n + LLET[l], c); left -= c;
  }
  return occ;
}

/* Returns array of {n, l, c} sorted by n then l, for an atom/ion of nuclear charge Z with ne electrons. */
function electronConfig(Z, ne) {
  const key = Z * 512 + ne;
  let cfg = _cfgCache.get(key);
  if (cfg) return cfg;
  let occ;
  if (ne <= 0) occ = new Map();
  else if (ne >= Z) {
    occ = aufbau(Z);
    const ex = CONFIG_EXCEPT[Z];
    if (ex) for (const k in ex) occ.set(k, ex[k]);
    // anions: continue filling in Madelung order
    let extra = ne - Z;
    for (const [n, l] of SUBSHELLS) {
      if (extra <= 0) break;
      const k = n + LLET[l]; const c = occ.get(k) || 0; const room = LCAP[l] - c;
      if (room > 0) { const add = Math.min(room, extra); occ.set(k, c + add); extra -= add; }
    }
  } else {
    occ = aufbau(Z);
    const ex = CONFIG_EXCEPT[Z];
    if (ex) for (const k in ex) occ.set(k, ex[k]);
    let remove = Z - ne;
    // Cations lose their valence electrons first, highest n first (4s before 3d, 6s and 5d before 4f, 7s and 6d
    // before 5f), and only then the noble-gas core beneath (so U⁶⁺ is [Rn], not [Rn] with 6p holes and 5f left)
    let zc = 0;
    for (const [z] of NOBLE_CORES) if (z < Z) { zc = z; break; }
    const core = zc ? aufbau(zc) : new Map();
    while (remove > 0) {
      let best = null, bn = -1, bl = -1, bv = false;
      for (const [k, c] of occ) {
        if (c <= 0) continue;
        const n = +k[0], l = LLET.indexOf(k[1]), val = c > (core.get(k) || 0);
        if ((val && !bv) || (val === bv && (n > bn || (n === bn && l > bl)))) { bn = n; bl = l; best = k; bv = val; }
      }
      if (!best) break;
      occ.set(best, occ.get(best) - 1); remove--;
    }
  }
  cfg = [];
  for (const [k, c] of occ) if (c > 0) cfg.push({ n: +k[0], l: LLET.indexOf(k[1]), c });
  cfg.sort((a, b) => a.n - b.n || a.l - b.l);
  _cfgCache.set(key, cfg);
  return cfg;
}

const SUPS = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻' };
const SUBS = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉' };
function sup(s) { return String(s).split('').map(ch => SUPS[ch] || ch).join(''); }
function sub(s) { return String(s).split('').map(ch => SUBS[ch] || ch).join(''); }

const NOBLE_CORES = [[118,'Og'],[86,'Rn'],[54,'Xe'],[36,'Kr'],[18,'Ar'],[10,'Ne'],[2,'He']];
function configString(Z, ne) {
  if (ne <= 0) return 'none (bare nucleus)';
  const cfg = electronConfig(Z, ne);
  // find the largest noble-gas core whose subshells are all completely filled here
  let coreN = 0, coreSym = '';
  for (const [cz, sym] of NOBLE_CORES) {
    if (cz > ne || (cz === ne && ne === Z)) continue; // (an ion with a noble gas's electrons, as Na⁺, is written as just its core: [Ne])
    const core = electronConfig(cz, cz);
    let ok = true;
    for (const s of core) {
      const m = cfg.find(x => x.n === s.n && x.l === s.l);
      if (!m || m.c < s.c) { ok = false; break; }
    }
    if (ok) { coreN = cz; coreSym = sym; break; }
  }
  const core = coreN ? electronConfig(coreN, coreN) : [];
  const parts = [];
  for (const s of cfg) {
    const inCore = core.find(x => x.n === s.n && x.l === s.l);
    const c = s.c - (inCore ? inCore.c : 0);
    if (c > 0) parts.push(s.n + LLET[s.l] + sup(c));
  }
  return ((coreSym ? '[' + coreSym + '] ' : '') + parts.join(' ')).trim();
}

function shellCounts(Z, ne) {
  const cfg = electronConfig(Z, ne);
  const sh = [];
  for (const s of cfg) sh[s.n - 1] = (sh[s.n - 1] || 0) + s.c;
  for (let i = 0; i < sh.length; i++) sh[i] = sh[i] || 0;
  return sh;
}

/* Valence electrons (outer-shell s+p), outer shell n, unpaired electrons (Hund's rule). */
const _valCache = new Map();
function valenceInfo(Z, ne) {
  const key = Z * 512 + ne;
  let v = _valCache.get(key);
  if (v) return v;
  const cfg = electronConfig(Z, ne);
  let nmax = 0;
  for (const s of cfg) if (s.l <= 1 && s.n > nmax) nmax = s.n;
  let val = 0, unp = 0;
  for (const s of cfg) {
    if (s.n === nmax && s.l <= 1) val += s.c;
    const orb = 2 * s.l + 1;
    unp += s.c <= orb ? s.c : 2 * orb - s.c;
  }
  v = { v: val, n: nmax, unpaired: unp };
  _valCache.set(key, v);
  return v;
}

/* ---------- Ionization energies ---------- */
const NSTAR = [0, 1, 2, 3, 3.7, 4.0, 4.2, 4.3, 4.4];
const SLATER_ORDER = ['1s','2sp','3sp','3d','4sp','4d','4f','5sp','5d','5f','6sp','6d','7sp','8sp'];
function slaterGroup(n, l) { return l <= 1 ? n + 'sp' : n + LLET[l]; }

/* Slater's screening of one electron of subshell s (an entry of configuration cfg) by all the others. */
function slaterS(cfg, s) {
  const g = slaterGroup(s.n, s.l), gi = SLATER_ORDER.indexOf(g);
  let S = 0;
  for (const t of cfg) {
    const tg = slaterGroup(t.n, t.l), ti = SLATER_ORDER.indexOf(tg);
    if (tg === g) { S += (t === s ? t.c - 1 : t.c) * (s.n === 1 ? 0.30 : 0.35); continue; }
    if (ti > gi) continue;
    if (s.l <= 1) S += t.c * (t.n === s.n - 1 ? 0.85 : 1.0);
    else S += t.c * 1.0;
  }
  return S;
}
/* Slater's rules total electronic energy of a species with nuclear charge Z and k electrons (eV, negative). */
function slaterTotal(Z, k) {
  if (k <= 0) return 0;
  const cfg = electronConfig(Z, k);
  let E = 0;
  for (const s of cfg) {
    const zeff = Math.max(0.3, Z - slaterS(cfg, s)), ns = NSTAR[s.n] || 4.3;
    E -= s.c * PHYS.RY * (zeff / ns) * (zeff / ns);
  }
  return E;
}
const _ieTab = [];
/* Total binding energy of all the electrons of a neutral atom (eV): Lunney, Pearson and Thibault's fit to
   calculated total atomic energies (relativity included), good to a percent or so across the table. */
function totalBindingE(Z) { return 14.4381 * Math.pow(Z, 2.39) + 1.55468e-6 * Math.pow(Z, 5.35); }
/* Ionization energy of a one-electron ion (Dirac's formula: relativity makes uranium's last electron 132 keV
   deep, not the 115 keV of Bohr's formula). */
function ieHydrogenic(z) { const a = Math.min(0.999, z / 137.036); return PHYS.MEC2 * 1e6 * (1 - Math.sqrt(1 - a * a)); }
/* Successive ionization energies for element Z, index k = electrons present before ionizing: measured for the
   outer three, Dirac's for the last electron and a screened version for the last two, Slater's rules between,
   scaled so that they add up to the measured total binding energy of the atom's electrons. */
function ieTable(Z) {
  if (_ieTab[Z]) return _ieTab[Z];
  const el = ELEMENTS[Z], t = new Float64Array(Z + 1), est = new Uint8Array(Z + 1);
  for (let k = 1; k <= Z; k++) {
    let v;
    if (k === Z) v = el.ie1;
    else if (k === Z - 1 && el.ie2 > 0) v = el.ie2;
    else if (k === Z - 2 && IE3[Z]) v = IE3[Z];
    else if (k === 1) v = ieHydrogenic(Z);
    else if (k === 2) v = 2 * ieHydrogenic(Z - 5 / 16) - ieHydrogenic(Z); // helium-like (Hylleraas' screening)
    else { v = slaterTotal(Z, k - 1) - slaterTotal(Z, k); est[k] = 1; }
    t[k] = v;
  }
  // more highly charged ions always bind their electrons more tightly (by a clear margin for the outer few)
  const mono = () => { for (let k = Z - 1; k >= 1; k--) { const f = k >= Z - 4 ? 1.4 : 1.004; if (t[k] < t[k + 1] * f) t[k] = t[k + 1] * f + 0.5; } };
  mono();
  // Slater's rules overbind heavy atoms: scale their estimates so the whole adds up to the total binding energy
  if (Z > 3) {
    let se = 0, sf = 0;
    for (let k = 1; k <= Z; k++) { if (est[k]) se += t[k]; else sf += t[k]; }
    if (se > 0) {
      const sc = clamp((totalBindingE(Z) - sf) / se, 0.6, 1.4);
      for (let k = 1; k <= Z; k++) if (est[k]) t[k] *= sc;
      mono();
    }
  }
  return (_ieTab[Z] = t);
}
/* Total binding of a species' electrons as the tables give it (eV): the sum of its successive ionization energies. */
const _beCache = new Map();
function electronBindingE(Z, ne) {
  if (Z <= 0 || ne <= 0) return 0;
  const key = Z * 512 + ne;
  let v = _beCache.get(key);
  if (v === undefined) { v = 0; for (let k = 1; k <= ne; k++) v += ionE(Z, k); _beCache.set(key, v); }
  return v;
}

/* Energy (eV) to remove one electron from a species of nuclear charge Z carrying k electrons. */
function ionE(Z, k) {
  if (k <= 0 || Z <= 0) return Infinity;
  const el = ELEMENTS[Z];
  if (k > Z) { // anion → neutral is the electron affinity; deeper anions are unbound in vacuum, each further
    // electron pushed off by the extra ones already there (about 10 eV apiece at an ion's size)
    if (k === Z + 1) return el.ea > 0 ? el.ea : -0.5;
    return ea2(Z) - (k - Z - 2) * 10;
  }
  return ieTable(Z)[k];
}
function ea2(Z) { // second electron affinity (negative: O²⁻ is only stable inside crystals)
  const s = ELEMENTS[Z].sym;
  return s === 'O' ? -8.75 : s === 'S' ? -5.51 : s === 'Se' ? -4.2 : -10;
}
function maxExtraElectrons(Z) {
  const el = ELEMENTS[Z]; if (!el) return 0;
  const s = el.sym;
  if (s === 'O' || s === 'S' || s === 'Se') return 2;
  if (s === 'N') return 3;
  return el.ea > 0 ? 1 : 0;
}

/* ---------- Nuclear structure ---------- */
function semfB(Z, N) {
  const A = Z + N;
  if (A <= 1) return 0;
  const aV = 15.75, aS = 17.8, aC = 0.711, aA = 23.7, aP = 11.18;
  let B = aV * A - aS * Math.pow(A, 2 / 3) - aC * Z * (Z - 1) / Math.cbrt(A) - aA * (A - 2 * Z) * (A - 2 * Z) / A;
  if (Z % 2 === 0 && N % 2 === 0) B += aP / Math.sqrt(A);
  else if (Z % 2 === 1 && N % 2 === 1) B -= aP / Math.sqrt(A);
  return B;
}
function tableB(Z, N) {
  if (Z + N <= 1) return 0;
  const v = BINDING[Z + '_' + N];
  return v === undefined ? null : v;
}
/* Binding energy (MeV). Uses measured values when available, otherwise the semi-empirical mass formula. */
function bindingE(Z, N) {
  const t = tableB(Z, N);
  return t === null ? semfB(Z, N) : t;
}
/* Binding-energy difference using a consistent source (avoids mixing table and SEMF errors). */
function dB(listAfter, listBefore) {
  let allT = true;
  for (const [z, n] of listAfter.concat(listBefore)) if (z + n > 1 && tableB(z, n) === null) { allT = false; break; }
  let s = 0;
  for (const [z, n] of listAfter) s += allT ? (tableB(z, n) || 0) : (z + n <= 1 ? 0 : semfB(z, n));
  for (const [z, n] of listBefore) s -= allT ? (tableB(z, n) || 0) : (z + n <= 1 ? 0 : semfB(z, n));
  return s;
}
function isStableNuclide(Z, N) { const s = STABLE[Z]; return !!(s && s.includes(Z + N)); }

function fermiF(Q) { // phase-space integral for an allowed β decay of end-point energy Q (MeV), no Coulomb correction
  if (Q <= 0) return 0;
  const W0 = 1 + Q / PHYS.MEC2, p0 = Math.sqrt(W0 * W0 - 1);
  return (2 * W0 ** 4 - 9 * W0 * W0 - 8) * p0 / 60 + W0 * Math.log(W0 + p0) / 4;
}
function betaHalfLife(Q, logft) { const f = fermiF(Q); return f > 0 ? Math.pow(10, logft) / f : Infinity; }
function ecHalfLife(Q, Z) { // K-capture estimate
  if (Q <= 0) return Infinity;
  const fec = 2 * Math.PI * Math.pow(Z / 137.036, 3) * Math.pow(Q / PHYS.MEC2 + 1, 2) + 1e-12;
  return Math.pow(10, 5.5) / fec;
}
function alphaHalfLife(Z, N, Q) { // Viola–Seaborg systematics
  if (Q <= 0.5) return Infinity;
  const a = 1.66175, b = -8.5166, c = -0.20228, d = -33.9069;
  let h = 0;
  if (Z % 2 && N % 2) h = 1.114; else if (Z % 2) h = 0.772; else if (N % 2) h = 1.066;
  const lg = (a * Z + b) / Math.sqrt(Q) + (c * Z + d) + h;
  return Math.pow(10, clamp(lg, -22, 40));
}

const _nucCache = new Map();
/* Nuclide information: stability, half-life and decay modes. */
function nuclideInfo(Z, N) {
  const key = Z + '_' + N;
  let inf = _nucCache.get(key);
  if (inf) return inf;
  const A = Z + N;
  inf = { Z, N, A, stable: false, unbound: false, t12: Infinity, modes: [], estimated: false };
  if (A <= 0) { inf.stable = true; }
  else if (Z === 1 && N === 0) inf.stable = true;
  else if (DECAY[key]) {
    const d = DECAY[key];
    inf.t12 = d[0];
    // the table lists Q_EC for β⁺ emitters (atomic masses); a positron's kinetic energy is two electron masses
    // less (the positron itself and the electron the daughter atom no longer needs)
    const kin = (m, q) => (m === 'b+' ? Math.max(0.001, q - 2 * PHYS.MEC2) : q);
    if (Array.isArray(d[1])) inf.modes = d[1].map(([m, br, q]) => ({ mode: m, br, Q: kin(m, q) }));
    else inf.modes = [{ mode: d[1], br: 1, Q: kin(d[1], d[2]) }];
  } else if (isStableNuclide(Z, N)) inf.stable = true;
  else if (Z === 0) { inf.unbound = true; inf.t12 = 1e-22; inf.modes = [{ mode: 'n', br: 1, Q: 0.1 }]; }
  else if (A < 12 && tableB(Z, N) === null) {
    inf.unbound = true; inf.t12 = 1e-21;
    inf.modes = [{ mode: N >= Z ? 'n' : 'p', br: 1, Q: 0.5 }];
  } else {
    const B0 = bindingE(Z, N);
    const Sn = N > 0 ? dB([[Z, N]], [[Z, N - 1]]) : Infinity;
    const Sp = Z > 0 ? dB([[Z, N]], [[Z - 1, N]]) : Infinity;
    const S2n = N > 1 ? dB([[Z, N]], [[Z, N - 2]]) : Infinity;
    const S2p = Z > 1 ? dB([[Z, N]], [[Z - 2, N]]) : Infinity;
    const QaL = (A < 20 && Z > 2 && N >= 2) ? dB([[Z - 2, N - 2], [2, 2]], [[Z, N]]) : -1;
    if (Sn < 0) { inf.unbound = true; inf.t12 = 1e-21; inf.modes = [{ mode: 'n', br: 1, Q: -Sn }]; }
    else if (Sp < 0) { inf.unbound = true; inf.t12 = 1e-20; inf.modes = [{ mode: 'p', br: 1, Q: -Sp }]; }
    else if (S2p < 0) { inf.unbound = true; inf.t12 = 1e-20; inf.modes = [{ mode: '2p', br: 1, Q: -S2p }]; }
    else if (S2n < 0) { inf.unbound = true; inf.t12 = 1e-21; inf.modes = [{ mode: '2n', br: 1, Q: -S2n }]; }
    else if (QaL > 0) { inf.unbound = true; inf.t12 = 1e-20; inf.modes = [{ mode: 'a', br: 1, Q: QaL }]; }
    else {
      inf.estimated = true;
      const cand = [];
      if (N > 0 && Z < Z_MAX) { const Q = PHYS.DM_NH + dB([[Z + 1, N - 1]], [[Z, N]]); if (Q > 0) cand.push({ mode: 'b-', Q, t: betaHalfLife(Q, 6.0) }); } // (no β⁻ past the last element)
      if (Z > 1) {
        const Qec = -PHYS.DM_NH + dB([[Z - 1, N + 1]], [[Z, N]]);
        if (Qec > 0) {
          const tb = Qec > 1.022 ? betaHalfLife(Qec - 1.022, 5.8) : Infinity, te = ecHalfLife(Qec, Z);
          if (tb < te) cand.push({ mode: 'b+', Q: Qec - 1.022, t: 1 / (1 / tb + 1 / te) });
          else cand.push({ mode: 'ec', Q: Qec, t: 1 / (1 / tb + 1 / te) });
        }
      }
      if (Z > 2 && N > 2 && A > 100) {
        const Qa = dB([[Z - 2, N - 2], [2, 2]], [[Z, N]]);
        if (Qa > 0) cand.push({ mode: 'a', Q: Qa, t: alphaHalfLife(Z, N, Qa) });
      }
      if (Z >= 98) {
        const x = Z * Z / A;
        cand.push({ mode: 'sf', Q: 200, t: Math.pow(10, clamp(9.4 - 3.5 * (x - 37), -20, 30)) });
      }
      if (Z * Z / A > 47) cand.push({ mode: 'sf', Q: 200, t: 1e-20 });
      if (!cand.length) inf.stable = true;
      else {
        cand.sort((a, b) => a.t - b.t);
        const lam = cand.reduce((s, c) => s + 1 / c.t, 0);
        inf.t12 = 1 / lam;
        inf.modes = cand.filter(c => (1 / c.t) / lam > 0.01).map(c => ({ mode: c.mode, br: (1 / c.t) / lam, Q: c.Q }));
      }
    }
  }
  _nucCache.set(key, inf);
  return inf;
}

const ISO_NAMES = { '1_0':'protium', '1_1':'deuterium', '1_2':'tritium', '2_2':'helium-4' };
function nucSym(Z, N) {
  if (Z === 0 && N === 1) return 'n';
  if (Z === 0) return sup(N) + 'n';
  const el = ELEMENTS[Z];
  return sup(Z + N) + (el ? el.sym : '?');
}
/* Antimatter carries a bar over the whole symbol, so every letter gets one: H̄, F̄ē, ²³⁸Ū. */
function barSym(sym) { return String(sym).replace(/./gu, '$&\u0304'); }
function nucSymA(Z, N, anti) {
  if (!anti) return nucSym(Z, N);
  if (Z === 0) return (N === 1 ? '' : sup(N)) + 'n\u0304';
  return sup(Z + N) + barSym(ELEMENTS[Z] ? ELEMENTS[Z].sym : '?');
}
function nucName(Z, N) {
  if (Z === 0) return N === 1 ? 'Neutron' : N + '-neutron cluster';
  const el = ELEMENTS[Z];
  return (el ? el.name : 'Element ' + Z) + '-' + (Z + N);
}
function modeLabel(m) {
  return { 'b-':'β⁻ decay', 'b+':'β⁺ decay', ec:'Electron capture', a:'α decay', p:'Proton emission',
    n:'Neutron emission', '2p':'Two-proton emission', '2n':'Two-neutron emission', sf:'Spontaneous fission' }[m] || m;
}
/* How each mode moves a nuclide (ΔZ, ΔN); fission ends a chain. */
const DECAY_STEP = { a: [-2, -2], 'b-': [1, -1], 'b+': [-1, 1], ec: [-1, 1], p: [-1, 0], n: [0, -1], '2p': [-2, 0], '2n': [0, -2] };
const MODE_SHORT = { a: 'α', 'b-': 'β⁻', 'b+': 'β⁺', ec: 'EC', p: 'p', n: 'n', '2p': '2p', '2n': '2n', sf: 'fission' };
/* The chain a nuclide decays down, by its likeliest mode at each step, to a stable nuclide or to fission:
   [{ Z, N, t12, stable, est, mode, br, alt: [{ mode, br }] }]. */
function decayChain(Z, N, maxSteps) {
  const out = [], seen = new Set();
  for (let k = 0; k <= (maxSteps || 30); k++) {
    const inf = nuclideInfo(Z, N), key = Z + '_' + N;
    const node = { Z, N, t12: inf.t12, stable: inf.stable || !inf.modes.length, est: inf.estimated, mode: null, br: 1, alt: [] };
    out.push(node);
    if (node.stable || seen.has(key) || Z + N <= 0) break;
    seen.add(key);
    const ms = inf.modes.slice().sort((a, b) => b.br - a.br);
    node.mode = ms[0].mode; node.br = ms[0].br; node.alt = ms.slice(1).map(m => ({ mode: m.mode, br: m.br }));
    const d = DECAY_STEP[node.mode];
    if (!d) break;
    Z += d[0]; N += d[1];
  }
  return out;
}

/* Isotopes worth listing for an element: stable ones plus radioactive ones in the decay table. */
function isotopeList(Z) {
  const set = new Set(STABLE[Z] || []);
  for (const k in DECAY) { const [z, n] = k.split('_').map(Number); if (z === Z) set.add(z + n); }
  if (!set.size) set.add(COMMON_A[Z]);
  return [...set].sort((a, b) => a - b);
}

/* ---------- Chemistry helpers ---------- */
function bondKey(a, b) { return a.Z <= b.Z ? a.sym + '-' + b.sym : b.sym + '-' + a.sym; }
const _homoE = {};
function homoE(el) { // A–A single bond energy (kJ/mol) for Pauling's estimate
  if (_homoE[el.sym] !== undefined) return _homoE[el.sym];
  const t = BONDS[el.sym + '-' + el.sym];
  const v = t ? t.e[0] : (el.metal ? 80 : el.cat === 'ng' ? 20 : 160);
  return (_homoE[el.sym] = v);
}
const MULT = [1, 1.75, 2.35];
/* Bond dissociation energy (eV) for elements a, b and bond order. */
function bondEnergy(a, b, order) {
  const t = BONDS[bondKey(a, b)];
  let kj;
  if (t && t.e[order - 1]) kj = t.e[order - 1];
  else {
    const base = t ? t.e[0] : 0.5 * (homoE(a) + homoE(b)) + 96.5 * Math.pow((a.en || 2.5) - (b.en || 2.5), 2);
    kj = base * MULT[Math.min(order, 3) - 1];
  }
  return kj / PHYS.KJMOL;
}
/* Bond length (Å): table, else Schomaker–Stevenson with multiple-bond contraction. */
function bondLength(a, b, order) {
  const t = BONDS[bondKey(a, b)];
  if (t && t.l[order - 1]) return t.l[order - 1];
  const base = t && t.l[0] ? t.l[0] : a.rc + b.rc - 0.09 * Math.abs((a.en || 2.5) - (b.en || 2.5));
  return base * [1, 0.87, 0.78][Math.min(order, 3) - 1];
}
function morseA(a, b, order) {
  const t = BONDS[bondKey(a, b)];
  if (t && t.a && t.a[order - 1]) return t.a[order - 1];
  return 1.9 * Math.pow(order, 0.25);
}
function ionicRadius(el, q) {
  const r = IONIC_R[el.sym + ':' + q];
  if (r) return r;
  if (q > 0) return Math.max(0.3, el.rc * (1 - 0.15 * q));
  return el.rc * (1 + 0.55 * Math.abs(q));
}

/* ---------- Light: wavelength → colour, blackbody colour ---------- */
function wavelengthRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm >= 440 && nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm >= 490 && nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm >= 510 && nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm >= 580 && nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm >= 645 && nm <= 780) { r = 1; }
  let f = 1;
  if (nm >= 380 && nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
  else if (nm > 700 && nm <= 780) f = 0.3 + 0.7 * (780 - nm) / 80;
  if (nm < 380) return [190, 150, 255]; // ultraviolet (drawn as pale violet)
  if (nm > 780) return [120, 30, 30];   // infrared (drawn as dim red)
  const gm = 0.8;
  return [Math.round(255 * Math.pow(r * f, gm)), Math.round(255 * Math.pow(g * f, gm)), Math.round(255 * Math.pow(b * f, gm))];
}
function photonColor(E) { // E in eV
  if (E >= 1e5) return [235, 225, 255];      // gamma
  if (E >= 124) return [200, 190, 255];      // X-ray
  return wavelengthRGB(PHYS.HC / E);
}
function blackbodyRGB(T) { // Tanner Helland approximation, T in kelvin
  const t = clamp(T, 800, 40000) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  return [clamp(Math.round(r), 0, 255), clamp(Math.round(g), 0, 255), clamp(Math.round(b), 0, 255)];
}

/* ---------- Formatting ---------- */
/* Energy in the unit that suits its size: meV, eV, keV, MeV, GeV, TeV (1000 MeV is 1.00 GeV). digits: significant
   figures (3 by default). */
let E_UNIT = 'eV'; // Settings → General: chemistry-sized energies (under 1 keV) in kJ/mol or kcal/mol instead
const E_MOL = { kJ: [96.4853321, ' kJ/mol'], kcal: [23.0605478, ' kcal/mol'] };
function fmtE(eV, digits) { // in the unit that suits the size: 999 keV, then 1.00 MeV (also when 999.7 keV rounds up)
  const a = Math.abs(eV), d = digits || 3, k = 1 - 0.5 * Math.pow(10, -d);
  if (E_UNIT !== 'eV' && a < 999.5) { const [f, u] = E_MOL[E_UNIT], v = eV * f; return eV === 0 ? '0' + u : (Math.abs(v) >= Math.pow(10, d) ? Math.round(v).toLocaleString('en-US') : Math.abs(v) < 1e-3 ? fmtSci(v, 2) : v.toPrecision(d)) + u; }
  for (const [s, u] of [[1e15, ' PeV'], [1e12, ' TeV'], [1e9, ' GeV'], [1e6, ' MeV'], [1e3, ' keV'], [1, ' eV'], [1e-3, ' meV']]) {
    if (a < s * k) continue;
    const v = eV / s;
    return (Math.abs(v) >= Math.pow(10, d) ? v.toFixed(0) : v.toPrecision(d)) + u;
  }
  return eV === 0 ? '0 eV' : fmtSci(eV, 2) + ' eV';
}
/* d significant figures, never in exponent form (300, not 3.0e+2). */
function fmtPrec(v, d) { const r = Number(v.toPrecision(d)); return Math.abs(r) >= Math.pow(10, d) ? String(Math.round(r)) : v.toPrecision(d); }
/* A power of ten, for the truly tiny or vast only: 5.0×10⁻⁴, 2.0×10¹⁸. */
function fmtSci(x, d = 2) {
  if (!x) return '0';
  let e = Math.floor(Math.log10(Math.abs(x))), m = x / Math.pow(10, e);
  if (Math.abs(Number(m.toPrecision(d))) >= 10) { m /= 10; e++; }
  return `${m.toPrecision(d)}×10${sup(e)}`;
}
/* A big number without powers of ten: 12,400, 3.40 million, 6.0 trillion (d significant figures). */
function fmtBig(x, d = 3) {
  const r = Number(x.toPrecision(d)), a = Math.abs(r); // (rounded first: 999,999 is 1.00 million)
  if (a < 1e6) return r.toLocaleString('en-US', { maximumFractionDigits: 3 });
  for (const [s, w] of [[1e12, ' trillion'], [1e9, ' billion'], [1e6, ' million']]) if (a >= s) return fmtPrec(r / s, d) + w;
  return fmtPrec(r, d);
}
/* A speed-up factor: ×1, ×60, ×25,000, ×4.5 million, ×60 trillion, and only past that ×6×10¹⁸. */
function fmtFactor(x) {
  if (!(x > 0) || !isFinite(x)) return '×—';
  if (x < 1e15 * (1 - 0.05)) return '×' + fmtBig(x, 2);
  let e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
  if (m >= 9.95) { m = 1; e++; }
  const ms = Number(m.toPrecision(2)).toString();
  return '×' + (ms === '1' ? '' : ms + '×') + '10' + sup(e);
}
function fmtTime(s) {
  if (!isFinite(s)) return '∞';
  const a = Math.abs(s);
  if (a < 1e-24) return fmtSci(s, 2) + ' s';
  if (a < 1e-21) return (s * 1e24).toPrecision(3) + ' ys';
  if (a < 1e-18) return (s * 1e21).toPrecision(3) + ' zs';
  if (a < 1e-15) return (s * 1e18).toPrecision(3) + ' as';
  if (a < 1e-12) return (s * 1e15).toPrecision(3) + ' fs';
  if (a < 1e-9) return (s * 1e12).toPrecision(3) + ' ps';
  if (a < 1e-6) return (s * 1e9).toPrecision(3) + ' ns';
  if (a < 1e-3) return (s * 1e6).toPrecision(3) + ' µs';
  if (a < 1) return (s * 1e3).toPrecision(3) + ' ms';
  if (a < 120) return s.toPrecision(3) + ' s';
  if (a < 7200) return (s / 60).toPrecision(3) + ' min';
  if (a < 2 * 86400) return (s / 3600).toPrecision(3) + ' h';
  if (a < 2 * PHYS.YEAR) return (s / 86400).toPrecision(3) + ' days';
  const y = s / PHYS.YEAR;
  if (y < 1e3) return y.toPrecision(3) + ' years';
  if (y < 1e4) return Math.round(Number(y.toPrecision(3))).toLocaleString('en-US') + ' years';
  if (y < 1e6) return (y / 1e3).toPrecision(3) + ' thousand years';
  if (y < 1e9) return (y / 1e6).toPrecision(3) + ' million years';
  if (y < 1e12) return (y / 1e9).toPrecision(3) + ' billion years';
  if (y < 1e15) return (y / 1e12).toPrecision(3) + ' trillion years';
  return fmtSci(y, 2) + ' years'; // (far longer than the age of the universe)
}
let T_UNIT = 'K'; // the temperature unit shown (Settings): 'K', 'C' (Celsius) or 'F' (Fahrenheit)
function fmtT(K) {
  if (T_UNIT !== 'K') {
    const v = T_UNIT === 'C' ? K - 273.15 : (K - 273.15) * 1.8 + 32, a = Math.abs(v), u = T_UNIT === 'C' ? ' °C' : ' °F';
    return (a >= 1e6 ? fmtBig(v, 3) : a >= 100 ? Math.round(v).toLocaleString('en-US') : v.toPrecision(3)) + u;
  }
  if (K >= 1e6) return (K / 1e6).toPrecision(3) + ' MK';
  if (K >= 1e4) { const r = Math.round(K); return Math.floor(r / 1000) + ',' + String(r % 1000).padStart(3, '0') + ' K'; }
  if (K >= 100) return Math.round(K) + ' K';
  return K.toPrecision(3) + ' K';
}
function fmtNum(x, d = 3) { // (thousands and millions written out: 12,400, 3.40 million; a power of ten only when tiny or vast)
  if (!isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e15)) return fmtSci(x, d);
  if (a >= 1000) return fmtBig(x, d);
  return Number(x.toPrecision(d)).toString();
}
