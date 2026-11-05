/* ------------------------------------------------------------------ bond orders for metals (Experimental, 1.25)
   Settings → Experimental → Metals → Many-body: a metal atom's bonding comes from how many neighbours it has, not from a
   pair potential. The second-moment tight-binding form (Finnis & Sinclair 1984; Cleri & Rosato 1993; the embedded-atom
   method's square-root case): each member atom i holds
     Eᵢ = Σⱼ A·e^(−p(r/r₀ − 1)) − √ρᵢ,   ρᵢ = Σⱼ ξ²·e^(−2q(r/r₀ − 1))
   (a repulsion between the ion cores, and the d/s band's energy, which grows as the square root of its width's second
   moment, the sum of the hoppings squared). One bond is worth more than its share of six or twelve, so a lone pair (a
   dimer) is short and strong, a surface atom holds more per neighbour than one inside, a vacancy costs less than a
   bond count says, and clusters, surfaces, melting and alloys come out of the one formula.
   Fitted per metal (mbParam) to its measured cohesive energy, nearest-neighbour distance, bulk modulus and vacancy
   formation energy on a close-packed lattice (12 neighbours), in closed form: the vacancy energy over the cohesive energy
   fixes q/p, the bulk modulus p·q, the cohesive energy ξ, equilibrium A. Neighbours count out to 1.15·r₀ and fade out
   by 1.35·r₀ (a quintic switch; before a close-packed lattice's second shell at 1.41·r₀), so a perfect lattice has
   exactly the fitted values. Unlike metals: r₀, p, q averaged, A and ξ geometric means.
   Members: neutral atoms the classic chemistry treats as metallic (setSize's isMetal: a metal, no stored bonds; not a
   quantum-bonds member). Their mD is 0 while this is on, so the kernels' metal pair keeps only its contact core
   (metalFI/metalV with no depth) and every other pair term (electron transfer, hot collisions) is as before. An ion is
   not a member: its electrons are not the metal's (kept in, a Cu⁺Cu⁻ pair held both the metal's bonding and the
   charges' pull, and at the short distances this model gives few-neighbour atoms, 2.2 Å, a lattice turned itself into
   ions and heated to 6,000 K); ion pairs keep the classic metallic pair, an ion and a member only the contact core.
   Energy books: totalEnergy adds mbPass(false); localPE and regionE add mbLocal(set), exact for any change to the set's
   atoms (their own embedding, their neighbours' embedding less what it is without the set, the pair repulsions touching
   the set); switching the setting books the difference at the same positions to the bath (mbSet); evTransfer's quick
   estimate adds a lower bound on what the transfer costs the metal (mbXferLB). The pass runs after the kernels, on the main
   thread, in JavaScript (0.3 µs a member a step flat, 0.7 in 3-D). Flat sheets have six neighbours, not twelve: they hold
   about 0.78 of the crystal's cohesive energy and melt 1.1–1.5 times too hot (PERF-NOTES, 1.25). */
const MBO = { on: false, any: false, E: 0, bath: 0, n: 0, nx: 0, np: 0, par: new Map(), pp: new Map(), xp: new Map() };
const MB_ON = 1.15, MB_OFF = 1.35, MB_K = 0.02; // (the switch, in r₀; ε/ξ: the square root rounded off below ρ ≈ ε², so a lone atom's force stays smooth)
/* Measured values: [cohesive energy eV/atom, nearest-neighbour distance Å, bulk modulus GPa, vacancy formation energy eV
   (0: not measured; 0.33 of the cohesive energy, the measured metals' middle)]. Cohesive energies, distances and bulk moduli
   from Kittel (Introduction to Solid State Physics, 8th ed., tables 3.1, 1.3 and 3.3; actinides past Am from enthalpies of
   sublimation); vacancy energies from Ehrhart (Landolt–Börnstein III/25, 1991). Elements nothing has measured (Fr, Rf on)
   take their lighter homolog's values, their distance from the game's radius (mbData). */
const MB_DATA = {
  3: [1.63, 3.04, 11.6, 0.48], 4: [3.32, 2.23, 100.3, 1.0], 11: [1.113, 3.66, 6.8, 0.42], 12: [1.51, 3.20, 35.4, 0.79],
  13: [3.39, 2.86, 72.2, 0.67], 19: [0.934, 4.53, 3.2, 0.39], 20: [1.84, 3.95, 15.2, 0], 21: [3.90, 3.25, 43.5, 0],
  22: [4.85, 2.89, 105.1, 1.55], 23: [5.31, 2.62, 161.9, 2.1], 24: [4.10, 2.50, 190.1, 2.0], 25: [2.92, 2.24, 59.6, 0],
  26: [4.28, 2.48, 168.3, 1.6], 27: [4.39, 2.50, 191.4, 1.34], 28: [4.44, 2.49, 186.0, 1.79], 29: [3.49, 2.56, 137.0, 1.28],
  30: [1.35, 2.66, 59.8, 0.54], 31: [2.81, 2.44, 56.9, 0], 37: [0.852, 4.84, 3.1, 0.30], 38: [1.72, 4.30, 11.6, 0],
  39: [4.37, 3.55, 36.6, 0], 40: [6.25, 3.17, 83.3, 1.7], 41: [7.57, 2.86, 170.2, 2.65], 42: [6.82, 2.72, 272.5, 3.0],
  43: [6.85, 2.71, 297, 0], 44: [6.74, 2.65, 320.8, 0], 45: [5.75, 2.69, 270.4, 1.71], 46: [3.89, 2.75, 180.8, 1.5],
  47: [2.95, 2.89, 100.7, 1.11], 48: [1.16, 2.98, 46.7, 0.46], 49: [2.52, 3.25, 41.1, 0.55], 50: [3.14, 3.02, 58.2, 0.51],
  55: [0.804, 5.24, 2.0, 0.28], 56: [1.90, 4.35, 10.3, 0], 57: [4.47, 3.73, 24.3, 0], 58: [4.32, 3.65, 23.9, 0],
  59: [3.70, 3.63, 30.6, 0], 60: [3.40, 3.66, 32.7, 0], 61: [3.6, 3.62, 35, 0], 62: [2.14, 3.59, 29.4, 0],
  63: [1.86, 3.96, 14.7, 0], 64: [4.14, 3.58, 38.3, 0], 65: [4.05, 3.52, 39.9, 0], 66: [3.04, 3.51, 38.4, 0],
  67: [3.14, 3.49, 39.7, 0], 68: [3.29, 3.47, 41.1, 0], 69: [2.42, 3.54, 39.7, 0], 70: [1.60, 3.88, 13.3, 0],
  71: [4.43, 3.43, 41.1, 0], 72: [6.44, 3.13, 109, 0], 73: [8.10, 2.86, 200, 2.9], 74: [8.90, 2.74, 323.2, 3.67],
  75: [8.03, 2.74, 372, 0], 76: [8.17, 2.68, 418, 0], 77: [6.94, 2.71, 355, 1.97], 78: [5.84, 2.77, 278.3, 1.35],
  79: [3.81, 2.88, 173.2, 0.93], 80: [0.67, 3.01, 38.2, 0], 81: [1.88, 3.46, 35.9, 0], 82: [2.03, 3.50, 43.0, 0.58],
  83: [2.18, 3.07, 31.5, 0], 84: [1.50, 3.34, 26, 0], 88: [1.66, 4.46, 13, 0], 89: [4.25, 3.76, 25, 0],
  90: [6.20, 3.60, 54.3, 1.28], 91: [5.9, 3.21, 157, 0], 92: [5.55, 2.75, 98.7, 1.2], 93: [4.73, 2.62, 68, 0],
  94: [3.60, 3.10, 54, 0], 95: [2.73, 3.61, 30, 0], 96: [4.0, 3.50, 37, 0], 97: [3.2, 3.40, 35, 0], 98: [2.03, 3.39, 30, 0],
  99: [1.38, 3.7, 15, 0], 100: [1.35, 3.7, 15, 0], 101: [1.3, 3.7, 15, 0], 102: [1.3, 3.7, 15, 0], 103: [3.3, 3.4, 35, 0],
};
function mbData(Z) {
  let d = MB_DATA[Z];
  if (d) return d;
  const el = ELEMENTS[Z]; // (nothing measured: the homolog one period up, its distance scaled by the game's radii)
  for (let h = Z - 32; h > 0 && !d; h -= 32) d = MB_DATA[h];
  if (!d && (Z === 87 || Z === 119)) d = MB_DATA[55];
  if (!d && Z === 120) d = MB_DATA[88];
  if (!d) d = MB_DATA[29];
  const hZ = Object.keys(MB_DATA).find(k => MB_DATA[k] === d), he = ELEMENTS[+hZ];
  return [d[0], d[1] * (el && he ? el.rc / he.rc : 1), d[2], d[3]];
}
/* The fitted constants of one metal: { A, xi, p, q, r0, eps } (closed form, see above; ε = MB_K·ξ). */
function mbParam(Z) {
  let v = MBO.par.get(Z);
  if (v) return v;
  const [Ec, r0, Bg, Ev0] = mbData(Z), Ev = Ev0 || 0.33 * Ec, k2 = MB_K * MB_K;
  const S = Math.sqrt(12 + k2), S11 = Math.sqrt(11 + k2);
  // per unit ξ, with a = A/ξ = t/S at equilibrium (t = q/p): E₀ = 12t/S − (S − κ), Ev = 12(S − S11 − t/S)
  const ratio = (t) => 12 * (S - S11 - t / S) / (S - MB_K - 12 * t / S);
  let lo = 0.15, hi = 0.45; // (q/p kept to the range published fits have, 0.2–0.4: a ratio past it would make the band term barely decay)
  const target = Ev / Ec;
  if (ratio(lo) <= target) hi = lo; else if (ratio(hi) >= target) lo = hi;
  else for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (ratio(m) > target) lo = m; else hi = m; }
  const t = 0.5 * (lo + hi), xi = Ec / (S - MB_K - 12 * t / S), A = xi * t / S;
  // B = E_xx/(9Ω), Ω = r₀³/√2; E_xx/ξ = p²·[12t/S − t²(24/S − 144/S³)]
  const Om = r0 * r0 * r0 / Math.SQRT2, Bev = Bg / 160.2177, c = 12 * t / S - t * t * (24 / S - 144 / (S * S * S));
  const p = Math.sqrt(9 * Om * Bev / (xi * c)), q = t * p;
  v = { A, xi, p, q, r0, eps: MB_K * xi, Ec, Ev, B: Bg };
  MBO.par.set(Z, v);
  return v;
}
/* ---- metal oxides and hydrides (1.26): O and H atoms with a free valence ("partners") bond to the member metals through
   the same second-moment form, with constants of their own for each metal and partner (an alloy of the metal with O or
   H, in Cleri and Rosato's way): the pair's repulsion V = A·e^(−p(r/r₀ − 1)) at the partner's weight, the hopping
   squared ξ²·e^(−2q(r/r₀ − 1)) in both atoms' densities, the partner's own embedding −√ρ at its weight. A metal atom's
   density then holds its O and H neighbours too, so its bonds to the other metal atoms weaken as it oxidizes. Fitted
   (tools/mbfit.js) on each reference compound's crystal, unrelaxed, with every other term the game has there (the
   metal–metal pairs, the partners' Lennard-Jones between each other): measured heat of formation from the bulk metal and
   the game's O₂ or H₂, measured metal–O or metal–H distance at equilibrium, measured bulk modulus where known; q/p = MBX_T. */
const MB_X = new Uint8Array(130); MB_X[1] = 1; MB_X[8] = 1;
const MB_XEPS = 0.05; // (the partners' ε, eV: their square root rounded below ρ ≈ ε²)
const MBX_T = 0.4;
/* fitted constants [A eV, ξ into the metal's density eV, ξ into the partner's, p, q, r₀ Å] by metal * 128 + partner (written by tools/mbfit.js; the data it fits to there) */
const MBX_FIT = {
  3720: [2.4214, 4.14104, 4.14104, 3, 1.2, 1.84879], // Cu–O: cuprite, ΔHf -168.6 kJ/mol, B 112 GPa, r₀ 1.849 Å, on (111) -4.8 eV
  6024: [1.41642, 2.75382, 2.75382, 5.99269, 2.39708, 2.04382], // Ag–O: cuprite, ΔHf -31.1 kJ/mol, B 70 GPa, r₀ 2.044 Å, on (111) -3.6 eV
  1672: [0.989435, 4.21957, 4.21957, 5.40186, 2.16074, 1.9132], // Al–O: corundum, ΔHf -1675.7 kJ/mol, B 252 GPa, r₀ 1.913 Å, on (111) -7.4 eV
  3080: [1.31326, 4.02793, 4.02793, 7.00003, 2.80001, 1.9896], // Cr–O: corundum, ΔHf -1139.7 kJ/mol, B 238 GPa, r₀ 1.990 Å
  3336: [1.29265, 3.50257, 3.50257, 5.03434, 2.01373, 2.1535], // Fe–O: rocksalt, ΔHf -272 kJ/mol, B 180 GPa, r₀ 2.153 Å
  3464: [1.18305, 3.30958, 3.30958, 4.08516, 1.63406, 2.13], // Co–O: rocksalt, ΔHf -237.9 kJ/mol, B 180 GPa, r₀ 2.130 Å
  3592: [1.19049, 3.28764, 3.28764, 3.11818, 1.24727, 2.0885], // Ni–O: rocksalt, ΔHf -239.7 kJ/mol, B 200 GPa, r₀ 2.089 Å, on (111) -5.5 eV
  3208: [1.0359, 3.21417, 3.21417, 6.83732, 2.73493, 2.2225], // Mn–O: rocksalt, ΔHf -385.2 kJ/mol, B 150 GPa, r₀ 2.223 Å
  1544: [0.57649, 2.91531, 2.91531, 4.55107, 1.82043, 2.106], // Mg–O: rocksalt, ΔHf -601.6 kJ/mol, B 160 GPa, r₀ 2.106 Å
  2568: [0.626238, 3.33036, 3.33036, 5.69821, 2.27928, 2.4055], // Ca–O: rocksalt, ΔHf -634.9 kJ/mol, B 112 GPa, r₀ 2.406 Å
  4872: [0.543758, 3.15305, 3.15305, 5.9575, 2.383, 2.58], // Sr–O: rocksalt, ΔHf -592 kJ/mol, B 91 GPa, r₀ 2.580 Å
  7176: [0.759029, 3.20591, 3.20591, 6.09106, 2.43643, 2.76], // Ba–O: rocksalt, ΔHf -548 kJ/mol, B 69 GPa, r₀ 2.760 Å
  392: [0.571607, 2.68564, 2.68564, 4.91917, 1.96767, 1.99662], // Li–O: antifluorite, ΔHf -597.9 kJ/mol, B 82 GPa, r₀ 1.997 Å
  1416: [0.491035, 2.10876, 2.10876, 6.91549, 2.7662, 2.40322], // Na–O: antifluorite, ΔHf -414.2 kJ/mol, B 60 GPa, r₀ 2.403 Å
  2440: [0.44284, 2.01597, 2.01597, 9, 3.6, 2.78687], // K–O: antifluorite, ΔHf -361.5 kJ/mol, B — GPa, r₀ 2.787 Å
  520: [1.22512, 4.3505, 4.3505, 3, 1.2, 1.64888], // Be–O: wurtzite, ΔHf -609.4 kJ/mol, B 212 GPa, r₀ 1.649 Å
  3848: [1.26139, 3.14407, 3.14407, 7.46137, 2.98455, 1.97809], // Zn–O: wurtzite, ΔHf -350.5 kJ/mol, B 143 GPa, r₀ 1.978 Å
  2824: [1.81535, 5.26431, 5.26431, 5.51213, 2.20485, 1.95905], // Ti–O: rutile, ΔHf -944 kJ/mol, B 211 GPa, r₀ 1.959 Å
  6408: [1.04152, 3.536, 3.536, 3, 1.2, 2.05332], // Sn–O: rutile, ΔHf -577.6 kJ/mol, B 205 GPa, r₀ 2.053 Å
  5128: [1.47028, 5.16584, 5.16584, 9, 3.6, 2.20403], // Zr–O: fluorite, ΔHf -1100.6 kJ/mol, B — GPa, r₀ 2.204 Å
  7432: [1.4138, 4.77861, 4.77861, 7.74973, 3.09989, 2.34303], // Ce–O: fluorite, ΔHf -1088.7 kJ/mol, B 230 GPa, r₀ 2.343 Å
  11784: [1.70506, 5.26921, 5.26921, 7.06775, 2.8271, 2.36858], // U–O: fluorite, ΔHf -1085 kJ/mol, B 207 GPa, r₀ 2.369 Å
  385: [0.323447, 1.40763, 1.40763, 4.06999, 1.628, 2.0415], // Li–H: rocksalt, ΔHf -90.5 kJ/mol, B 33 GPa, r₀ 2.041 Å
  1409: [0.286586, 1.18306, 1.18306, 4.4702, 1.78808, 2.44], // Na–H: rocksalt, ΔHf -56.3 kJ/mol, B 19 GPa, r₀ 2.440 Å
  2433: [0.25895, 1.1364, 1.1364, 4.54365, 1.81746, 2.85], // K–H: rocksalt, ΔHf -57.7 kJ/mol, B 16 GPa, r₀ 2.850 Å
  1537: [0.658329, 1.81501, 1.81501, 4.47802, 1.79121, 1.95528], // Mg–H: rutile, ΔHf -75.3 kJ/mol, B 45 GPa, r₀ 1.955 Å
  2817: [0.630517, 2.2138, 2.2138, 9, 3.6, 1.92864], // Ti–H: fluorite, ΔHf -144.3 kJ/mol, B — GPa, r₀ 1.929 Å
  5121: [0.6876, 2.40278, 2.40278, 9, 3.6, 2.0698], // Zr–H: fluorite, ΔHf -169 kJ/mol, B — GPa, r₀ 2.070 Å
  5889: [0.436464, 1.54598, 1.54598, 9, 3.6, 2.015], // Pd–H: rocksalt, ΔHf -19 kJ/mol, B — GPa, r₀ 2.015 Å, on (111) -2.9 eV
  3713: [0.713786, 1.83216, 1.83216, 9, 3.6, 1.75785], // Cu–H: wurtzite, ΔHf 27.5 kJ/mol, B — GPa, r₀ 1.758 Å, on (111) -2.4 eV
  1665: [1.11649, 2.60993, 2.60993, 9, 3.6, 1.72], // Al–H: rerevo3, ΔHf -46 kJ/mol, B — GPa, r₀ 1.720 Å
};
/* ---- alloys (1.26): pairs of metals with constants of their own, [A (the pair's whole repulsion) eV, ξ eV, p, q, r₀ Å] by
   smaller Z * 128 + larger, fitted (tools/mbfit.js --alloys) to a strongly bound compound's measured heat of formation at
   its measured lattice (p, q the two metals' means, r₀ its a–b distance); other pairs mix the two metals' constants. */
const MBA_FIT = {};
function mbXP(Zm, Zx) {
  const key = Zm * 128 + Zx;
  let v = MBO.xp.get(key);
  if (v) return v;
  v = MBX_FIT[key];
  if (!v) { // (no compound fitted: the homolog's, nearest in its group, its distance scaled by the game's radii; else copper's)
    let h = 0;
    for (const dz of [-18, 18, -32, 32, -8, 8, -50, 50]) if (MBX_FIT[(Zm + dz) * 128 + Zx]) { h = Zm + dz; break; }
    if (!h) for (let dz = 1; dz < 40 && !h; dz++) for (const z of [Zm - dz, Zm + dz]) if (!h && MBX_FIT[z * 128 + Zx] && ELEMENTS[z] && ELEMENTS[z].metal) h = z;
    const b = MBX_FIT[(h || 29) * 128 + Zx] || [0, 0, 0, 10, 4, 2], em = ELEMENTS[Zm], eh = ELEMENTS[h || 29];
    v = [b[0], b[1], b[2], b[3], b[4], b[5] * (em && eh ? (em.rc + ELEMENTS[Zx].rc) / (eh.rc + ELEMENTS[Zx].rc) : 1)];
  }
  MBO.xp.set(key, v);
  return v;
}
/* A pair's constants by element pair: [2A (both atoms' share of the repulsion), ξ² (into a's density), p/r₀, 2q/r₀, r₀, r_on, r_off,
   ξ² into b's] (the two ξ² differ for a metal and its partner, 1.26) */
function mbPP(Za, Zb) {
  const key = Za * 128 + Zb;
  let v = MBO.pp.get(key);
  if (!v) {
    const xa = MB_X[Za], xb = MB_X[Zb];
    if (xa && xb) v = new Float64Array(8); // (two partners, O or H: no many-body pair; theirs is the classic chemistry's, 1.26)
    else if (xa || xb) { const c = mbXP(xa ? Zb : Za, xa ? Za : Zb), r0 = c[5], gm = c[1] * c[1], gx = c[2] * c[2]; v = new Float64Array([c[0], xa ? gx : gm, c[3] / r0, 2 * c[4] / r0, r0, MB_ON * r0, MB_OFF * r0, xa ? gm : gx]); } // (a metal and O or H: the fitted cross constants, 1.26)
    else if (Za !== Zb && MBA_FIT[Math.min(Za, Zb) * 128 + Math.max(Za, Zb)]) { // (an alloy with constants of its own, fitted to a compound, 1.26)
      const [A, xi, p, q, r0] = MBA_FIT[Math.min(Za, Zb) * 128 + Math.max(Za, Zb)];
      v = new Float64Array([A, xi * xi, p / r0, 2 * q / r0, r0, MB_ON * r0, MB_OFF * r0, xi * xi]);
    } else {
      const a = mbParam(Za), b = mbParam(Zb), r0 = 0.5 * (a.r0 + b.r0), p = 0.5 * (a.p + b.p), q = 0.5 * (a.q + b.q);
      v = new Float64Array([2 * Math.sqrt(a.A * b.A), a.xi * b.xi, p / r0, 2 * q / r0, r0, MB_ON * r0, MB_OFF * r0, a.xi * b.xi]);
    }
    MBO.pp.set(key, v);
  }
  return v;
}
let MB_RMAX = 0; // (the farthest any pair reaches: for the searches around a set)
function mbRmax() { if (!MB_RMAX) for (const el of ELEMENTS) if (el && el.metal) { MB_RMAX = Math.max(MB_RMAX, MB_OFF * mbParam(el.Z).r0); for (const x of [1, 8]) MB_RMAX = Math.max(MB_RMAX, MB_OFF * mbXP(el.Z, x)[5]); } return MB_RMAX; }
/* the switch: 1 inside r_on, 0 past r_off, quintic between (value into _ms, slope into _msd) */
let _ms = 1, _msd = 0;
function mbSw(r, on, off) {
  if (r <= on) { _ms = 1; _msd = 0; return; }
  const w = off - on, t = (r - on) / w;
  _ms = 1 - t * t * t * (10 - t * (15 - 6 * t)); _msd = -30 * t * t * (1 - t) * (1 - t) / w;
}
/* Is slot i a member? (the kernels' metal pair has no depth for it: setSize) */
function mbIs(i) {
  return S.isMetal[i] === 1 && S.mD[i] === 0 && S.k[i] === NUC && S.ne[i] > 0 && S.dead[i] === 0 && S.fast[i] === 0 && S.rad[i] === 0 && !S.obj[i].bom;
}
/* Is slot i a partner (1.26): a neutral O or H atom with a free valence (an O atom, an O with one single bond, an H
   atom), which the many-body model bonds to member metals; its weight w is the share of its valence left free (O 1 or
   ½, H 1), and an O or H whose valence is used up (O₂, water) meets the metal as before. */
function mbIsX(i) {
  const Z = S.Z[i];
  if (!MB_X[Z] || S.k[i] !== NUC || S.ne[i] !== Z || S.dead[i] !== 0 || S.fast[i] !== 0 || S.rad[i] !== 0) return false;
  const o = S.obj[i]; return !o.bom && !o.mu && S.cap[i] - S.used[i] >= 1;
}
const mbW = (i) => (S.cap[i] - S.used[i]) / S.cap[i];
/* a pair the many-body model holds in full (a member and a partner): the kernels and the energy sums skip it (engine.js) */
function mbEx(a, b) { return S.anti[a.i] === S.anti[b.i] && ((mbIs(a.i) && mbIsX(b.i)) || (mbIsX(a.i) && mbIs(b.i))); }
/* the pairs of the neighbour list a member and a partner make: marked skipped (ex = 1) for the kernels (vlExclusions) */
let _mbRole = new Uint8Array(64);
function mbExMark(np, pi, pj, ex) {
  const hi = S.hi;
  if (_mbRole.length < hi) _mbRole = new Uint8Array(hi * 2 + 64);
  const ro = _mbRole; let n1 = 0, n2 = 0;
  for (let i = 0; i < hi; i++) { const v = mbIs(i) ? 1 : mbIsX(i) ? 2 : 0; ro[i] = v; if (v === 1) n1++; else if (v === 2) n2++; }
  if (!n1 || !n2) return;
  const AN = S.anti;
  for (let q = 0; q < np; q++) { const i = pi[q], j = pj[q]; if (ro[i] + ro[j] === 3 && AN[i] === AN[j]) ex[q] = 1; }
}
/* the embedding energy and its slope: F(ρ) = −(√(ρ + ε²) − ε) */
const mbF = (rho, eps) => -(Math.sqrt(rho + eps * eps) - eps);
/* ---- the pass over every member: energy, and with forces true their forces (into S.fx …) and the step's stiffness */
const MBF = { m: new Int32Array(64), ty: new Int32Array(64), rho: new Float64Array(64), fd: new Float64Array(64), // (rho, fd: by cell order)
  cell: new Int32Array(64), ord: new Int32Array(64), start: new Int32Array(64), fill: new Int32Array(64),
  pa: new Int32Array(256), pb: new Int32Array(256), pux: new Float64Array(256), puy: new Float64Array(256), puz: new Float64Array(256),
  pvr: new Float64Array(256), pdr: new Float64Array(256), pk: new Float64Array(256), prr: new Float64Array(256), pkp: new Float64Array(256),
  zt: new Int32Array(Z_MAX + 2), tz: [], pt: new Float64Array(64), eps: new Float64Array(8),
  sx: new Float64Array(64), sy: new Float64Array(64), sz: new Float64Array(64), ss: new Int32Array(64), st: new Int32Array(64), sa: new Int32Array(64), nb: new Int32Array(27),
  w: new Float64Array(64), sw: new Float64Array(64) }; // (w, sw: the partners' weights, by member order and by cell order, 1.26)
function mbGrowM(n) {
  if (MBF.m.length >= n) return;
  const N = n * 2 + 64;
  for (const k of ['m', 'ty', 'cell', 'ord']) MBF[k] = new Int32Array(N);
  MBF.w = new Float64Array(N);
}
function mbGrowP(n) {
  if (MBF.pa.length >= n) return;
  const N = n * 2 + 256, g = (a, T) => { const b = new T(N); b.set(a); return b; };
  MBF.pa = g(MBF.pa, Int32Array); MBF.pb = g(MBF.pb, Int32Array);
  for (const k of ['pux', 'puy', 'puz', 'pvr', 'pdr', 'pk', 'prr', 'pkp']) MBF[k] = g(MBF[k], Float64Array);
}
/* the members' elements as types 0 … nt−1 and their pair table (stride 9: 2A, ξ², p/r₀, 2q/r₀, r₀, r_on, r_off, r_off², κ: ξ² into the second over into the first) */
function mbTypes(nm) {
  const m = MBF.m, ty = MBF.ty, zt = MBF.zt, tz = MBF.tz, ZZ = S.Z;
  for (const z of tz) zt[z] = 0;
  tz.length = 0;
  for (let a = 0; a < nm; a++) { const z = ZZ[m[a]]; if (!zt[z]) { tz.push(z); zt[z] = tz.length; } ty[a] = zt[z] - 1; }
  const nt = tz.length;
  if (MBF.pt.length < nt * nt * 9) MBF.pt = new Float64Array(nt * nt * 18);
  if (MBF.eps.length < nt) MBF.eps = new Float64Array(nt * 2);
  let cs = 0;
  MBO.rx0 = 0;
  for (let u = 0; u < nt; u++) {
    if (!u) MBO.r0max = 0;
    if (MB_X[tz[u]]) MBF.eps[u] = MB_XEPS; else { MBF.eps[u] = mbParam(tz[u]).eps; MBO.r0max = Math.max(MBO.r0max, mbParam(tz[u]).r0); }
    for (let v = 0; v < nt; v++) { const P = mbPP(tz[u], tz[v]), o = (u * nt + v) * 9; for (let k = 0; k < 7; k++) MBF.pt[o + k] = P[k]; MBF.pt[o + 7] = P[6] * P[6]; MBF.pt[o + 8] = P[1] ? P[7] / P[1] : 1; if (P[6] > cs) cs = P[6]; if (P[6] && MB_X[tz[u]] + MB_X[tz[v]]) MBO.rx0 = Math.max(MBO.rx0, P[4]); }
  }
  return cs;
}
function mbPass(forces) {
  if (!MBO.on) { MBO.any = false; MBO.E = 0; return 0; }
  // the members: from the force pass's MD list, or from every particle (totalEnergy)
  let nm = 0, nxp = 0;
  if (forces) { mbGrowM(_nmd); for (let q = 0; q < _nmd; q++) { const i = _mdI[q]; if (mbIs(i)) MBF.m[nm++] = i; } }
  else { mbGrowM(W.parts.length); for (const p of W.parts) if (!p.dead && mbIs(p.i)) MBF.m[nm++] = p.i; }
  MBO.n = nm; MBO.any = nm > 0; MBO.nx = 0;
  if (nm === 0) { MBO.E = 0; MBO.np = 0; return 0; }
  for (let a = 0; a < nm; a++) MBF.w[a] = 1;
  if (forces) { for (let q = 0; q < _nmd; q++) { const i = _mdI[q]; if (mbIsX(i)) { MBF.w[nm + nxp] = mbW(i); MBF.m[nm + nxp++] = i; } } } // (the partners, O and H, after the members, 1.26)
  else for (const p of W.parts) if (!p.dead && mbIsX(p.i)) { MBF.w[nm + nxp] = mbW(p.i); MBF.m[nm + nxp++] = p.i; }
  MBO.nx = nxp; nm += nxp;
  const m = MBF.m, ty = MBF.ty, X = S.x, Y = S.y, Zp = S.z, AN = S.anti, d3 = W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  // cells at least the farthest reach wide (a counting sort of the members by cell)
  let cs = mbTypes(nm);
  const PT = MBF.pt, nt = MBF.tz.length, cut2 = cs * cs;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  if (wrap) { x0 = -hw; x1 = hw; y0 = -hh; y1 = hh; z0 = -hd; z1 = hd; }
  else for (let a = 0; a < nm; a++) { const i = m[a]; const x = X[i], y = Y[i], z = d3 ? Zp[i] : 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  let nx, ny, nz;
  for (;;) {
    nx = Math.max(1, Math.floor((x1 - x0) / cs) + (wrap ? 0 : 1)); ny = Math.max(1, Math.floor((y1 - y0) / cs) + (wrap ? 0 : 1)); nz = d3 ? Math.max(1, Math.floor((z1 - z0) / cs) + (wrap ? 0 : 1)) : 1;
    if (nx * ny * nz <= 4 * nm + 64) break;
    cs *= 1.5; // (a few members far apart: wider cells, the same pairs)
  }
  const cwx = wrap ? bw / nx : cs, cwy = wrap ? bh / ny : cs, cwz = wrap && d3 ? bd / nz : cs, nc = nx * ny * nz;
  if (MBF.start.length < nc + 1) MBF.start = new Int32Array(nc * 2 + 64);
  const cell = MBF.cell, ord = MBF.ord, start = MBF.start;
  start.fill(0, 0, nc + 1);
  for (let a = 0; a < nm; a++) {
    const i = m[a];
    let cx = Math.floor((X[i] - x0) / cwx), cy = Math.floor((Y[i] - y0) / cwy), cz = d3 ? Math.floor((Zp[i] - z0) / cwz) : 0;
    cx = cx < 0 ? 0 : cx >= nx ? nx - 1 : cx; cy = cy < 0 ? 0 : cy >= ny ? ny - 1 : cy; cz = cz < 0 ? 0 : cz >= nz ? nz - 1 : cz;
    const c = (cz * ny + cy) * nx + cx; cell[a] = c; start[c + 1]++;
  }
  for (let c = 0; c < nc; c++) start[c + 1] += start[c];
  if (MBF.fill.length < nc) MBF.fill = new Int32Array(nc * 2 + 64);
  const fill = MBF.fill; fill.set(start.subarray(0, nc));
  for (let a = 0; a < nm; a++) ord[fill[cell[a]]++] = a;
  // the members in cell order, positions and types side by side (the pair loop then reads memory in order)
  if (MBF.sx.length < nm) { for (const k of ['sx', 'sy', 'sz', 'rho', 'fd', 'sw']) MBF[k] = new Float64Array(nm * 2 + 64); for (const k of ['ss', 'st', 'sa']) MBF[k] = new Int32Array(nm * 2 + 64); }
  const SX = MBF.sx, SY = MBF.sy, SZ = MBF.sz, SS = MBF.ss, STY = MBF.st, SA = MBF.sa;
  if (MBF.sw.length < nm) MBF.sw = new Float64Array(nm * 2 + 64);
  const SWt = MBF.sw, Wm = MBF.w;
  for (let s = 0; s < nm; s++) { const a = ord[s], i = m[a]; SX[s] = X[i]; SY[s] = Y[i]; SZ[s] = d3 ? Zp[i] : 0; SS[s] = i; STY[s] = ty[a] * nt; SA[s] = AN[i]; SWt[s] = Wm[a]; }
  // pairs: each cell against itself (the later member only) and its neighbouring cells of higher number, each once
  const rho = MBF.rho; rho.fill(0, 0, nm);
  let np = 0, Erep = 0;
  if (forces) mbGrowP(nm * (d3 ? 24 : 10) + 64);
  let PA = MBF.pa, PB = MBF.pb, UX = MBF.pux, UY = MBF.puy, UZ = MBF.puz, VR = MBF.pvr, DR = MBF.pdr, PK = MBF.pk, RR = MBF.prr, KP = MBF.pkp, cap = PA.length;
  const nb = MBF.nb;
  for (let c = 0; c < nc; c++) {
    const s0 = start[c], s1 = start[c + 1];
    if (s0 === s1) continue;
    const cx = c % nx, cy = Math.floor(c / nx) % ny, cz = Math.floor(c / (nx * ny));
    let nn = 0;
    for (let dzc = d3 ? -1 : 0; dzc <= (d3 ? 1 : 0); dzc++) {
      let kz = cz + dzc; if (kz < 0 || kz >= nz) { if (!wrap) continue; kz = (kz + nz) % nz; }
      for (let dyc = -1; dyc <= 1; dyc++) {
        let ky = cy + dyc; if (ky < 0 || ky >= ny) { if (!wrap) continue; ky = (ky + ny) % ny; }
        for (let dxc = -1; dxc <= 1; dxc++) {
          let kx = cx + dxc; if (kx < 0 || kx >= nx) { if (!wrap) continue; kx = (kx + nx) % nx; }
          const k = (kz * ny + ky) * nx + kx;
          if (k < c) continue;
          let dup = false; for (let u = 0; u < nn; u++) if (nb[u] === k) { dup = true; break; } // (a box two cells wide: −1 and +1 are one cell)
          if (!dup) nb[nn++] = k;
        }
      }
    }
    for (let s = s0; s < s1; s++) {
      const xi = SX[s], yi = SY[s], zi = SZ[s], tro = STY[s], ai = SA[s];
      for (let u = 0; u < nn; u++) {
        const k = nb[u], e = start[k + 1];
        for (let t = k === c ? s + 1 : start[k]; t < e; t++) {
          let dx = SX[t] - xi, dy = SY[t] - yi, dz = SZ[t] - zi;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= cut2) continue;
          const o = (tro + STY[t] / nt) * 9;
          if (r2 >= PT[o + 7] || r2 < 1e-12 || SA[t] !== ai) continue; // (matter and antimatter: the kernel's annihilation pair)
          const r = Math.sqrt(r2), r0 = PT[o + 4], on = PT[o + 5];
          let sw = 1, swd = 0;
          if (r > on) { const w = PT[o + 6] - on, q = (r - on) / w; sw = 1 - q * q * q * (10 - q * (15 - 6 * q)); swd = -30 * q * q * (1 - q) * (1 - q) / w; }
          const pr = PT[o + 2], qr = PT[o + 3], ws = SWt[s], wt = SWt[t], er = PT[o] * Math.exp(pr * (r0 - r)) * ws * wt, ed = PT[o + 1] * Math.exp(qr * (r0 - r)); // (ws, wt: a partner's weight, 1 for a member, 1.26)
          const kap = PT[o + 8]; // (1 between metals; a metal and its partner: the partner's ξ² over the metal's, or the inverse, 1.26)
          Erep += er * sw; rho[s] += ed * sw * wt; rho[t] += ed * kap * sw * ws; // (a member's density takes a partner's share at its weight; a partner's, every member's in full)
          if (forces) {
            if (np >= cap) { mbGrowP(np + 1); PA = MBF.pa; PB = MBF.pb; UX = MBF.pux; UY = MBF.puy; UZ = MBF.puz; VR = MBF.pvr; DR = MBF.pdr; PK = MBF.pk; RR = MBF.prr; KP = MBF.pkp; cap = PA.length; }
            const ir = 1 / r;
            PA[np] = s; PB[np] = t; UX[np] = dx * ir; UY[np] = dy * ir; UZ[np] = dz * ir;
            VR[np] = er * (swd - pr * sw); DR[np] = ed * (swd - qr * sw); // (the slopes of the repulsion and of the pair's density)
            PK[np] = er * pr * pr * sw; RR[np] = ed * qr * qr * sw; // (their curvatures, for the step's stiffness)
            if (wt !== ws) { DR[np] *= ws * wt; RR[np] *= ws * wt; } // (a member and a partner: the density's slope at the partner's weight, both ends' embedding slopes then whole, 1.26)
            KP[np] = kap;
          }
          np++;
        }
      }
    }
  }
  let Eemb = 0;
  const fd = MBF.fd, EPS = MBF.eps;
  for (let s = 0; s < nm; s++) { const eps = EPS[STY[s] / nt], sq = Math.sqrt(rho[s] + eps * eps), w = SWt[s]; if (w === 1) { Eemb -= sq - eps; fd[s] = -0.5 / sq; } else { Eemb -= w * (sq - eps); fd[s] = -0.5 / sq; } } // (a partner's embedding at its weight, 1.26)
  MBO.np = np; MBO.E = Erep + Eemb;
  MBO.E += mbImage(forces, nm - nxp); // (ions near the metal: their image's pull, 1.26)
  if (forces) {
    const FX = S.fx, FY = S.fy, FZ = S.fz, IM = S.im;
    let st = 0;
    for (let k = 0; k < np; k++) {
      const a = PA[k], b = PB[k], i = SS[a], j = SS[b], fsum = fd[a] + KP[k] * fd[b]; // (KP: 1 between metals, 1.26)
      const g = -(VR[k] + fsum * DR[k]); // (−dE/dr)
      const fx = g * UX[k], fy = g * UY[k];
      FX[j] += fx; FY[j] += fy; FX[i] -= fx; FY[i] -= fy;
      if (d3) { const fz = g * UZ[k]; FZ[j] += fz; FZ[i] -= fz; }
      const kk = PK[k] + fsum * RR[k]; // (the pair's own curvature: the repulsion's less the band's)
      if (kk > 0) { const w = kk * (IM[i] + IM[j]); if (w > st) st = w; }
    }
    if (st > _stiff) _stiff = st;
  }
  return MBO.E;
}
/* ---- an ion near the metal (1.26): the metal's electrons draw back from its charge, and the ion feels the pull of that
   "image" (−k·q²/4z over a flat conductor). Here as a pair term between the ion and each member, φ = −c·q²/(r² + a²)²
   (each metal atom polarized by the ion's field), with c = k/(4π·n) for the metal's atom density n, so that summed over a
   half-space of atoms it gives the conductor's −k·q²/4z far from the surface; a = r₀/2 softens it at contact; out to
   6 Å (switched off from 5). Pairwise, so localPE holds it exactly; ions are not members (their electrons are their own). Ions of
   non-metals only (Cl⁻, F⁻, NH₄⁺'s N …): inside a metal the term would pay a metal atom for becoming an ion. */
const MB_IMG_ON = 5, MB_IMG_OFF = 6;
const mbIon = (i) => S.k[i] === NUC && S.q[i] !== 0 && S.ne[i] > 0 && S.metal[i] === 0 && S.dead[i] === 0 && S.fast[i] === 0 && S.rad[i] === 0 && !S.obj[i].bom; // (not a metal's ion: Cu⁺ among Cu atoms pulled by its image made a lump ionize itself (the transfer trials ×5); a metal ion keeps 1.25's contact core)
function mbImgC(Z) { const r0 = mbParam(Z).r0; return [PHYS.KE * r0 * r0 * r0 / (4 * Math.PI * Math.SQRT2), 0.25 * r0 * r0]; } // ([c, a²])
/* the image term between ion p and member o at distance r (energy, and its slope into _ms) */
function mbImgV(q, Zm, r) {
  const [c, a2] = mbImgC(Zm), d = r * r + a2, v = -c * q * q / (d * d);
  if (r <= MB_IMG_ON) { _ms = -4 * r * v / d; return v; }
  mbSw(r, MB_IMG_ON, MB_IMG_OFF); const s = _ms, sd = _msd;
  _ms = -4 * r * v / d * s + v * sd; return v * s;
}
function mbImage(forces, nmem) {
  const m = MBF.m, ions = [];
  if (forces) { for (let q = 0; q < _nmd; q++) { const i = _mdI[q]; if (mbIon(i) && !mbIs(i)) ions.push(i); } }
  else for (const p of W.parts) if (!p.dead && mbIon(p.i) && !mbIs(p.i)) ions.push(p.i);
  if (!ions.length) return 0;
  const X = S.x, Y = S.y, Zp = S.z, d3 = W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, R2 = MB_IMG_OFF * MB_IMG_OFF, AN = S.anti;
  let E = 0;
  for (const i of ions) {
    const qi = S.q[i];
    for (let a = 0; a < nmem; a++) {
      const j = m[a];
      if (AN[j] !== AN[i]) continue;
      let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
      if (wrap) { if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; if (d3) { if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; } }
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= R2 || r2 < 1e-12) continue;
      const r = Math.sqrt(r2), v = mbImgV(qi, S.Z[j], r);
      E += v;
      if (forces) { const g = -_ms / r; S.fx[j] += g * dx; S.fy[j] += g * dy; S.fx[i] -= g * dx; S.fy[i] -= g * dy; if (d3) { S.fz[j] += g * dz; S.fz[i] -= g * dz; } }
    }
  }
  return E;
}
/* the image terms touching set (for mbLocal): its ions with every member, its members with every ion outside it */
function mbImgLocal(set) {
  let E = 0;
  for (const p of set) {
    if (p.dead || p.k !== NUC) continue;
    const ion = mbIon(p.i) && !mbIs(p.i), mem = mbIs(p.i);
    if (!ion && !mem) continue;
    const seen = new Set();
    const v = (o, dx, dy, r2) => {
      if (o === p || seen.has(o) || o.dead || o.k !== NUC || o.anti !== p.anti || r2 >= MB_IMG_OFF * MB_IMG_OFF) return; seen.add(o);
      if (ion && mbIs(o.i)) E += mbImgV(p.q, o.Z, Math.sqrt(r2));
      else if (mem && !set.has(o) && mbIon(o.i) && !mbIs(o.i)) E += mbImgV(o.q, p.Z, Math.sqrt(r2));
    };
    if (!ion && _charged.length < 64) { // (a member: only ions can pair with it, and every ion is in _charged (refresh); few of them: those, not the grid)
      for (const o of _charged) { if (o.dead || o.k !== NUC) continue; const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, W.d3 ? o.z - p.z : 0); v(o, dx, dy, dx * dx + dy * dy + dz * dz); }
      continue;
    }
    nearby(p.x, p.y, MB_IMG_OFF, v, p.z);
    for (const o of _late) { if (o.dead) continue; const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, W.d3 ? o.z - p.z : 0), r2 = dx * dx + dy * dy + dz * dz; v(o, dx, dy, r2); }
  }
  return E;
}
/* The many-body energy a change to the atoms in set can alter (for localPE and regionE): the members of set T keep their
   embedding F(ρ), the other members N within reach of them F(ρ) − F(ρ without T) (what T adds to theirs), and every
   repulsion touching T. The rest of the total does not depend on T's atoms, so a before/after difference is exact, even
   when an atom of T stops or starts being a member, or moves out of reach. */
function mbLocal(set) {
  if (!MBO.on) return 0;
  const Ei = mbImgLocal(set); // (ions and the metal's image, 1.26)
  return Ei + mbLocalMB(set);
}
function mbLocalMB(set) {
  const T = [], wt = new Map(); // (wt: a partner's weight, 1.26)
  for (const p of set) if (!p.dead && p.k === NUC) { if (mbIs(p.i)) T.push(p); else if (mbIsX(p.i)) { T.push(p); wt.set(p, mbW(p.i)); } }
  if (!T.length) return 0;
  const R = mbRmax(), d3 = W.d3, inT = new Set(T), near = new Map(); // (member or partner → its density from T's atoms)
  const wOf = (o) => { let w = wt.get(o); if (w === undefined) { w = mbIs(o.i) ? 1 : mbW(o.i); wt.set(o, w); } return w; };
  const around = (p, cb) => { // (members and partners within R of p, as nearby() and the atoms made since the grid was built)
    const seen = new Set();
    const v = (o, dx, dy, r2, dz) => { if (o === p || seen.has(o) || o.dead || o.k !== NUC || o.anti !== p.anti || !(mbIs(o.i) || mbIsX(o.i))) return; seen.add(o); cb(o, Math.sqrt(r2)); };
    nearby(p.x, p.y, R, v, p.z);
    for (const o of _late) { if (o.dead) continue; const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, d3 ? o.z - p.z : 0), r2 = dx * dx + dy * dy + dz * dz; if (r2 <= R * R) v(o, dx, dy, r2, dz); }
  };
  let E = 0;
  for (const p of T) {
    let rho = 0;
    const wp = wOf(p);
    around(p, (o, r) => {
      const P = mbPP(p.Z, o.Z); if (r >= P[6]) return;
      const x = r / P[4] - 1; mbSw(r, P[5], P[6]);
      const ed = P[1] * Math.exp(-P[3] * P[4] * x) * _ms, wo = wOf(o);
      rho += ed * wo;
      if (!inT.has(o)) { E += P[0] * Math.exp(-P[2] * P[4] * x) * _ms * wp * wo; near.set(o, (near.get(o) || 0) + (P[7] === P[1] ? ed : P[7] * Math.exp(-P[3] * P[4] * x) * _ms) * wp); } // (into o: its own ξ², 1.26)
      else if (p.id < o.id) E += P[0] * Math.exp(-P[2] * P[4] * x) * _ms * wp * wo;
    });
    E += wp * mbF(rho, MB_X[p.Z] ? MB_XEPS : mbParam(p.Z).eps);
  }
  for (const [o, dT] of near) {
    let rho = 0;
    around(o, (u, r) => { const P = mbPP(o.Z, u.Z); if (r >= P[6]) return; mbSw(r, P[5], P[6]); rho += P[1] * Math.exp(-P[3] * P[4] * (r / P[4] - 1)) * _ms * wOf(u); });
    const eps = MB_X[o.Z] ? MB_XEPS : mbParam(o.Z).eps;
    E += wOf(o) * (mbF(rho, eps) - mbF(Math.max(0, rho - dT), eps));
  }
  return E;
}
/* A lower bound on the many-body energy an electron's move from d to acc costs (for evTransfer's quick estimate, which
   otherwise sends nearly every pair of neighbours in a metal to the exact trial): the members it makes ions lose their
   own embedding and gain back the repulsions they had; their neighbours' embedding only rises as they go (F falls with
   ρ). 0 when the move makes an atom a member (it would gain). */
function mbXferLB(d, acc) {
  const joins = (p, dq) => p.el && (p.el.metal || MB_X[p.Z]) && (!p.bonds.length || MB_X[p.Z]) && p.q + dq === 0; // (or a partner, O or H, 1.26)
  if (joins(d, 1) || joins(acc, -1)) return 0;
  let E = 0;
  for (const [p, dq] of [[d, 1], [acc, -1]]) { // (the image's pull the two gain or lose as ions near the metal, 1.26: the bound counts its change)
    if (p.k !== NUC || p.dead) continue;
    const q0 = mbIon(p.i) && !mbIs(p.i) ? p.q : 0, q1 = p.q + dq;
    if (q0 * q0 === q1 * q1) continue;
    nearby(p.x, p.y, MB_IMG_OFF, (o, dx, dy, r2) => { if (o === p || o === d || o === acc || o.dead || o.k !== NUC || o.anti !== p.anti || !mbIs(o.i)) return; const r = Math.sqrt(r2); E += mbImgV(q1, o.Z, r) - (q0 ? mbImgV(q0, o.Z, r) : 0); }, p.z);
  }
  const L = [d, acc].filter(p => p.k === NUC && !p.dead && mbIs(p.i));
  if (!L.length) return Math.min(0, E);
  for (const p of L) {
    const R = MB_OFF * Math.max(mbParam(p.Z).r0, MBO.r0max || 0, MBO.rx0 || 0); // (the members' widest reach at the last pass, and the partners' (1.26): an estimate needs no more)
    let rho = 0;
    nearby(p.x, p.y, R, (o, dx, dy, r2) => {
      if (o === p || o.dead || o.k !== NUC || o.anti !== p.anti) return;
      const w = mbIs(o.i) ? 1 : mbIsX(o.i) ? mbW(o.i) : 0; if (!w) return; // (a partner at its weight, 1.26)
      const P = mbPP(p.Z, o.Z), r = Math.sqrt(r2); if (r >= P[6]) return;
      mbSw(r, P[5], P[6]);
      rho += P[1] * Math.exp(P[3] * (P[4] - r)) * _ms * w;
      if (!(L.length === 2 && o === (p === d ? acc : d) && p === acc)) E -= P[0] * Math.exp(P[2] * (P[4] - r)) * _ms * w; // (the pair of the two counted once)
    }, p.z);
    E -= mbF(rho, mbParam(p.Z).eps);
  }
  return E;
}
/* The setting (on or off): members' mD follows it (setSize), and the change of energy at the same positions goes to the
   bath, as for the bond orders. */
function mbSet(v) {
  const on = !!v;
  if (on === MBO.on) return;
  const mets = new Set(); for (const p of W.parts) if (!p.dead && p.k === NUC && p.el && p.el.metal && p.ne > 0) mets.add(p);
  const Eb = mets.size ? localPE(mets) : 0;
  MBO.on = on;
  for (const p of mets) setSize(p);
  W.dirty++; vlInvalidate();
  if (mets.size) { const Ea = localPE(mets); W.ledger.bath += Eb - Ea; MBO.bath += Eb - Ea; }
  MBO.any = on && [...mets].some(p => mbIs(p.i));
}
/* ---- molecules splitting on the metal (1.26): a bond between two partners' elements (O=O, H–H, O–H, O–O) whose atom
   meets a member is tried broken, each freed piece moved (as evBond's snapTogether moves molecules to a bond's length)
   toward its nearest member, up to 1.2 Å, to the pair's r₀ (tried from 0.6 Å past the pair's reach): a molecule held off by its Lennard-Jones wall would otherwise
   never be near enough for its atoms' bonds to the metal to pay for the bond. Done as evReact does a reaction: on
   trial, the energy measured exactly (localPE over the molecule, the many-body part with it, at the moved positions),
   and kept when the meeting's energy along the line of centres reaches an activation energy
   from the reaction's own heat (Evans–Polanyi, as reaction(): max(0.05, 0.5 + 0.25·ΔH) downhill, 0.5 + 0.75·ΔH uphill),
   the heat released (dumpHeat) or, uphill, taken from the meeting (kickPair); undone otherwise. The reverse (two
   partners bonding, a molecule leaving) is the classic evBond, measured the same way. Every fourth step. */
const _mbTried = new Map(), MBX_MEET = 0.6; // (Å past the pair's reach: where the molecule's Lennard-Jones wall holds it, about 3 Å from a metal atom)
function mbEvents() {
  if ((W.step & 3) !== 0 || !MBO.n) return;
  const R = mbRmax() + MBX_MEET;
  for (const bd of W.bonds.slice()) {
    const a = bd.a, b = bd.b;
    if (!MB_X[a.Z] || !MB_X[b.Z] || a.bom || b.bom || a.dead || b.dead || a.k !== NUC || b.k !== NUC || a.fast || b.fast || a.rad || b.rad || a.mu || b.mu) continue;
    if (W.bonds.indexOf(bd) < 0) continue;
    // the member nearest either atom, within its pair's reach
    let Mt = null, Xa = null, best = Infinity;
    for (const x of [a, b]) nearby(x.x, x.y, R, (o, dx, dy, r2) => {
      if (o.dead || o.k !== NUC || o.anti !== x.anti || !mbIs(o.i)) return;
      const P = mbPP(o.Z, x.Z), rt = P[6] + MBX_MEET; if (r2 >= rt * rt || r2 >= best) return;
      best = r2; Mt = o; Xa = x;
    }, x.z);
    if (!Mt) continue;
    const key = a.id * 131072 + b.id, last = _mbTried.get(key);
    if (last !== undefined && W.step - last < 30) continue; // (one try per meeting)
    const [dx, dy, dz] = minImg(Xa.x - Mt.x, Xa.y - Mt.y, Xa.z - Mt.z), rr = hyp3(dx, dy, dz) || 1e-6;
    const vn = ((Xa.vx - Mt.vx) * dx + (Xa.vy - Mt.vy) * dy + (Xa.vz - Mt.vz) * dz) / rr;
    if (vn >= 0) continue; // (moving apart)
    _mbTried.set(key, W.step); if (_mbTried.size > 50000) _mbTried.clear();
    const lab0 = hill(molecule(a)), set = setOf(molecule(a)), sn = snapshot(set);
    const E0 = localPE(set);
    removeBond(bd);
    { // (the two pieces out of each other's repulsive core, half each way along the bond, as separate() would one of them)
      const [ex, ey, ez] = minImg(b.x - a.x, b.y - a.y, b.z - a.z), r = hyp3(ex, ey, ez) || 1e-6, sh = 0.5 * Math.max(0, 0.85 * 0.5 * (a.ljR + b.ljR) - r) / r;
      if (sh > 0) { for (const q of molecule(a)) { q.x -= ex * sh; q.y -= ey * sh; if (W.d3) q.z -= ez * sh; } for (const q of molecule(b)) { q.x += ex * sh; q.y += ey * sh; if (W.d3) q.z += ez * sh; } W.dirty++; }
    }
    for (const x of [a, b]) { // (each freed piece toward its nearest member)
      if (!mbIsX(x.i)) continue;
      let N = null, nb = Infinity;
      nearby(x.x, x.y, R, (o, ex, ey, r2) => { if (r2 < nb && !o.dead && o.k === NUC && o.anti === x.anti && mbIs(o.i)) { nb = r2; N = o; } }, x.z);
      if (!N) continue;
      const r0 = mbPP(N.Z, x.Z)[4], [ux, uy, uz] = minImg(N.x - x.x, N.y - x.y, N.z - x.z), r = Math.sqrt(nb), sh = Math.min(1.2, r - r0) / r;
      if (sh <= 0) continue;
      for (const q of molecule(x)) { q.x += ux * sh; q.y += uy * sh; if (W.d3) q.z += uz * sh; }
      W.dirty++;
    }
    closeSet(set);
    const heat = E0 - localPE(set), dH = -heat;
    const Ea = dH < 0 ? Math.max(0.05, 0.5 + 0.25 * dH) : 0.5 + 0.75 * dH;
    const mu = Xa.m * Mt.m / (Xa.m + Mt.m), En = 0.5 * mu * vn * vn;
    if (En < Ea) { restoreSnap(sn); continue; }
    if (heat >= 0) dumpHeat(heat, Xa, Mt);
    else if (-kickPair(Xa, Mt, heat, dx / rr, dy / rr, dz / rr) < -heat - 1e-6) { restoreSnap(sn); continue; }
    W.count.react++;
    log('chem', `On the metal: ${lab0} → ${hill(molecule(a))} + ${hill(molecule(b))}, on the ${Mt.el.name.toLowerCase()} (${heat >= 0 ? fmtE(heat) + ' released' : fmtE(-heat) + ' absorbed'})`);
  }
}
