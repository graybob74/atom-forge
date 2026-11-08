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
/* ---- directional bonding (1.26): the bcc metals. The d electrons of a transition metal bond through orbitals with
   lobes, so the band's energy depends on how the neighbours are arranged around an atom, not only on how many there are
   and how near: half-filled d bands (Cr, Mo, W, and V, Nb, Ta, Fe) favour the body-centred cube. MEAM's way (Baskes 1992):
   angular partial densities ρ_l² = Σ_j Σ_k a_j a_k P_l(cos θ_jk) (l = 2, 4, 6; P_l Legendre polynomials; θ_jk the angle at
   the atom between neighbours j and k, j = k counted; a_j = e^(−β(r/r₀ − 1)) at the pair's switch), normalized by their
   radial sum (Σ a_j)², weigh the band's second moment:
     Eᵢ = Σⱼ A·e^(−p(r/r₀ − 1)) − √(ρᵢ + ρᵢᴹ·Γᵢ),   Γᵢ = Σ_l t_l·ρ_l²/(Σ a_j)²
   (ρᴹ the part of ρ from metal atoms: O and H on the metal keep 1.26's oxide terms). Γ does not change when a crystal is
   scaled evenly and stays within ±Σ|t_l|, so the band term cannot run away at short range. The l = 6 term rewards the
   cube of eight first neighbours (its ρ₆²/(Σa)² is 0.39 in bcc's first shell, 0.33 in fcc, 0.24 in hcp), l = 4 sets
   fcc against hcp and keeps the simple cube up, l = 2 (zero in a cubic crystal) gives the shear stiffness an angular
   part. Fitted per metal (tools/mbdfit.js, PERF-NOTES 1.26) on the bcc crystal:
   cohesive energy and spacing exact, bulk modulus, C′ = (C₁₁ − C₁₂)/2, C₄₄, vacancy energy, the fcc and hcp energies
   above bcc, the simple cube, simple hexagonal and diamond lattices kept above it. Neighbours count to 1.25·r₀ and fade
   out by 1.45·r₀ (bcc's second shell, at 1.155·r₀, is in; fcc's at 1.41 nearly out). [A (one atom's share, as mbParam's), ξ, p, q, r₀, β, t₂, t₄, t₆] */
const MBD_ON = 1.25, MBD_OFF = 1.45;
const MBD_FIT = { // (node tools/mbdfit.js --table; the measured values it fits to are there and in PERF-NOTES 1.26, from memory)
  74: [0.2492713, 3.174885, 12.295, 2.412, 2.741, 16.29, -0.5619, 0.4646, 0.1463], // W: bcc a 3.1650 Å; B 312, C11 429, C12 254, C44 162 GPa (measured 522, 204, 161); vacancy 3.59 eV (3.67); fcc +0.473, hcp +0.606 eV (0.48, 0.42)
  42: [0.1602227, 2.249892, 13.84198, 2.31727, 2.725, 15.86723, -0.78626, 0.65948, 0.29366], // Mo: bcc a 3.1466 Å; B 261, C11 378, C12 203, C44 110 GPa (measured 464, 158, 109); vacancy 2.89 eV (3); fcc +0.436, hcp +0.595 eV (0.42, 0.43)
  24: [0.06344874, 1.206819, 14.38009, 1.65794, 2.498, 21.29475, -0.8, 0.6024, 0.40844], // Cr: bcc a 2.8844 Å; B 153, C11 248, C12 105, C44 97 GPa (measured 340, 59, 99); vacancy 1.87 eV (2); fcc +0.341, hcp +0.444 eV (0.4, 0.37)
  23: [0.148297, 1.891528, 10.36218, 2.07833, 2.622, 16.83132, -0.25916, 0.22191, 0.2277], // V: bcc a 3.0276 Å; B 156, C11 217, C12 126, C44 43 GPa (measured 228, 119, 43); vacancy 2.05 eV (2.1); fcc +0.245, hcp +0.327 eV (0.24, 0.25)
  26: [0.1769997, 1.758622, 9.23, 2.538, 2.482, 0.92, 0, -0.8, 0.2924], // Fe: bcc a 2.8660 Å; B 163, C11 189, C12 150, C44 119 GPa (measured 231, 135, 116); vacancy 1.52 eV (1.6); fcc +0.093, hcp +0.110 eV (0.1, 0.08)
  11: [0.03096697, 0.4101311, 7.61014, 1.597, 3.659, 0.34077, -0.8, 1.23522, 0.13797], // Na: bcc a 4.2250 Å; B 7, C11 8, C12 6, C44 4 GPa (measured 7.3, 6.2, 4.2); vacancy 0.39 eV (0.42); fcc +0.003, hcp +0.033 eV (0.003, 0.003)
  41: [0.2682464, 2.916488, 9.36011, 2.29999, 2.858, 17.76515, -0.1938, 0.17705, 0.18753], // Nb: bcc a 3.3001 Å; B 173, C11 233, C12 143, C44 29 GPa (measured 246, 134, 29); vacancy 2.63 eV (2.65); fcc +0.313, hcp +0.417 eV (0.33, 0.3)
  73: [0.3036215, 3.217154, 9.47029, 2.42206, 2.86, 15.61891, -0.1992, 0.14467, 0.14714], // Ta: bcc a 3.3024 Å; B 196, C11 247, C12 171, C44 88 GPa (measured 266, 158, 87); vacancy 2.78 eV (2.9); fcc +0.268, hcp +0.359 eV (0.24, 0.27)
};
const MBD_DIR = (Z) => !!MBD_FIT[Z];
/* The fitted constants of one metal: { A, xi, p, q, r0, eps } (closed form, see above; ε = MB_K·ξ); a directional metal's
   from MBD_FIT, with its switch (on, off in r₀) and its angular constants (be: β, t: [t₂, t₄, t₆]) (1.26). */
function mbParam(Z) {
  let v = MBO.par.get(Z);
  if (v) return v;
  const D = MBD_FIT[Z];
  if (D) {
    const [Ec, , Bg, Ev0] = mbData(Z);
    v = { A: D[0], xi: D[1], p: D[2], q: D[3], r0: D[4], eps: MB_K * D[1], Ec, Ev: Ev0 || 0.33 * Ec, B: Bg, on: MBD_ON, off: MBD_OFF, be: D[5], t: [D[6], D[7], D[8]] };
    MBO.par.set(Z, v);
    return v;
  }
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
  v = { A, xi, p, q, r0, eps: MB_K * xi, Ec, Ev, B: Bg, on: MB_ON, off: MB_OFF };
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
  3080: [1.34343, 4.05278, 4.05278, 7.18502, 2.87401, 1.9896], // Cr–O: corundum, ΔHf -1139.7 kJ/mol, B 238 GPa, r₀ 1.990 Å
  3336: [0.973956, 3.07612, 3.07612, 6.7989, 2.71956, 2.1535], // Fe–O: rocksalt, ΔHf -272 kJ/mol, B 180 GPa, r₀ 2.153 Å
  3464: [1.18305, 3.30958, 3.30958, 4.08516, 1.63406, 2.13], // Co–O: rocksalt, ΔHf -237.9 kJ/mol, B 180 GPa, r₀ 2.130 Å
  3592: [1.19049, 3.28764, 3.28764, 3.11818, 1.24727, 2.0885], // Ni–O: rocksalt, ΔHf -239.7 kJ/mol, B 200 GPa, r₀ 2.089 Å, on (111) -5.5 eV
  3208: [1.0359, 3.21417, 3.21417, 6.83732, 2.73493, 2.2225], // Mn–O: rocksalt, ΔHf -385.2 kJ/mol, B 150 GPa, r₀ 2.223 Å
  1544: [0.57649, 2.91531, 2.91531, 4.55107, 1.82043, 2.106], // Mg–O: rocksalt, ΔHf -601.6 kJ/mol, B 160 GPa, r₀ 2.106 Å
  2568: [0.626238, 3.33036, 3.33036, 5.69821, 2.27928, 2.4055], // Ca–O: rocksalt, ΔHf -634.9 kJ/mol, B 112 GPa, r₀ 2.406 Å
  4872: [0.543758, 3.15305, 3.15305, 5.9575, 2.383, 2.58], // Sr–O: rocksalt, ΔHf -592 kJ/mol, B 91 GPa, r₀ 2.580 Å
  7176: [0.759029, 3.20591, 3.20591, 6.09106, 2.43643, 2.76], // Ba–O: rocksalt, ΔHf -548 kJ/mol, B 69 GPa, r₀ 2.760 Å
  392: [0.571607, 2.68564, 2.68564, 4.91917, 1.96767, 1.99662], // Li–O: antifluorite, ΔHf -597.9 kJ/mol, B 82 GPa, r₀ 1.997 Å
  1416: [0.354388, 2.01858, 2.01858, 5.96119, 2.38447, 2.40322], // Na–O: antifluorite, ΔHf -414.2 kJ/mol, B 60 GPa, r₀ 2.403 Å
  2440: [0.44284, 2.01597, 2.01597, 9, 3.6, 2.78687], // K–O: antifluorite, ΔHf -361.5 kJ/mol, B — GPa, r₀ 2.787 Å
  520: [1.22512, 4.3505, 4.3505, 3, 1.2, 1.64888], // Be–O: wurtzite, ΔHf -609.4 kJ/mol, B 212 GPa, r₀ 1.649 Å
  3848: [1.26139, 3.14407, 3.14407, 7.46137, 2.98455, 1.97809], // Zn–O: wurtzite, ΔHf -350.5 kJ/mol, B 143 GPa, r₀ 1.978 Å
  2824: [1.81535, 5.26431, 5.26431, 5.51213, 2.20485, 1.95905], // Ti–O: rutile, ΔHf -944 kJ/mol, B 211 GPa, r₀ 1.959 Å
  6408: [1.04152, 3.536, 3.536, 3, 1.2, 2.05332], // Sn–O: rutile, ΔHf -577.6 kJ/mol, B 205 GPa, r₀ 2.053 Å
  5128: [1.47028, 5.16584, 5.16584, 9, 3.6, 2.20403], // Zr–O: fluorite, ΔHf -1100.6 kJ/mol, B — GPa, r₀ 2.204 Å
  7432: [1.4138, 4.77861, 4.77861, 7.74973, 3.09989, 2.34303], // Ce–O: fluorite, ΔHf -1088.7 kJ/mol, B 230 GPa, r₀ 2.343 Å
  11784: [1.70506, 5.26921, 5.26921, 7.06775, 2.8271, 2.36858], // U–O: fluorite, ΔHf -1085 kJ/mol, B 207 GPa, r₀ 2.369 Å
  385: [0.323447, 1.40763, 1.40763, 4.06999, 1.628, 2.0415], // Li–H: rocksalt, ΔHf -90.5 kJ/mol, B 33 GPa, r₀ 2.041 Å
  1409: [0.242643, 1.1412, 1.1412, 3.87348, 1.54939, 2.44], // Na–H: rocksalt, ΔHf -56.3 kJ/mol, B 19 GPa, r₀ 2.440 Å
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
const MBA_FIT = {
  1692: [0.320445, 1.92607, 9.4181, 2.47001, 2.50022], // Ni–Al: NiAl (B2), ΔHf -117.6 kJ/mol
  2844: [0.360358, 2.08898, 10.142, 2.29361, 2.61107], // Ti–Ni: TiNi (B2), ΔHf -68 kJ/mol
  1690: [0.379115, 1.83427, 8.15177, 2.65472, 2.51927], // Fe–Al: FeAl (B2), ΔHf -56 kJ/mol
  3742: [0.15607, 0.990478, 11.9037, 2.46946, 2.55477], // Cu–Zn: CuZn (B2), ΔHf -24.6 kJ/mol
  3791: [0.342467, 1.68373, 10.7907, 3.17152, 2.65094], // Cu–Au: Cu3Au (L12), ΔHf -28.4 kJ/mol
  1686: [0.36729, 2.00202, 7.79748, 2.59504, 2.84938], // Ti–Al: TiAl (L10), ΔHf -75.2 kJ/mol
};
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
      const [A, xi, p, q, r0] = MBA_FIT[Math.min(Za, Zb) * 128 + Math.max(Za, Zb)], a = mbParam(Za), b = mbParam(Zb);
      const on = a.on === b.on ? a.on : 0.5 * (a.on + b.on), off = a.off === b.off ? a.off : 0.5 * (a.off + b.off); // (1.26: as for mixed pairs)
      v = new Float64Array([A, xi * xi, p / r0, 2 * q / r0, r0, on * r0, off * r0, xi * xi]);
    } else {
      const a = mbParam(Za), b = mbParam(Zb), r0 = 0.5 * (a.r0 + b.r0), p = 0.5 * (a.p + b.p), q = 0.5 * (a.q + b.q);
      const on = a.on === b.on ? a.on : 0.5 * (a.on + b.on), off = a.off === b.off ? a.off : 0.5 * (a.off + b.off); // (a directional metal's wider switch, 1.26: the two's mean)
      v = new Float64Array([2 * Math.sqrt(a.A * b.A), a.xi * b.xi, p / r0, 2 * q / r0, r0, on * r0, off * r0, a.xi * b.xi]);
    }
    MBO.pp.set(key, v);
  }
  return v;
}
let MB_RMAX = 0; // (the farthest any pair reaches: for the searches around a set)
function mbRmax() { if (!MB_RMAX) for (const el of ELEMENTS) if (el && el.metal) { MB_RMAX = Math.max(MB_RMAX, mbParam(el.Z).off * mbParam(el.Z).r0); for (const x of [1, 8]) MB_RMAX = Math.max(MB_RMAX, MB_OFF * mbXP(el.Z, x)[5]); } return MB_RMAX; }
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
  w: new Float64Array(64), sw: new Float64Array(64), // (w, sw: the partners' weights, by member order and by cell order, 1.26)
  tdp: new Float64Array(16), rm: new Float64Array(64), gm: new Float64Array(64), // (directional metals, 1.26: constants by type; ρᴹ and Γ by cell order)
  da: new Int32Array(256), db: new Int32Array(256), dr: new Float64Array(256), dux: new Float64Array(256), duy: new Float64Array(256), duz: new Float64Array(256),
  dsw: new Float64Array(256), dsd: new Float64Array(256), dr0: new Float64Array(256), // (their member pairs: ends, distance, direction, switch and its slope, r₀)
  cst: new Int32Array(64), cl: new Int32Array(512), ca: new Float64Array(64), cad: new Float64Array(64), ch: new Float64Array(64) }; // (each centre's arms: pair and side, a, a′, h)
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
  MBO.rx0 = 0; MBO.ndt = 0; MBO.dirR = 0;
  if (MBF.tdp.length < nt * 5) MBF.tdp = new Float64Array(nt * 10);
  for (let u = 0; u < nt; u++) { // (directional metals' β, t₂, t₄, t₆ by type, 0 for the rest; 1.26)
    const P = MB_X[tz[u]] ? null : mbParam(tz[u]), o = u * 5;
    if (P && P.be !== undefined) { MBF.tdp[o] = 1; MBF.tdp[o + 1] = P.be; MBF.tdp[o + 2] = P.t[0]; MBF.tdp[o + 3] = P.t[1]; MBF.tdp[o + 4] = P.t[2]; MBO.ndt++; MBO.dirR = Math.max(MBO.dirR, P.off * P.r0); }
    else MBF.tdp.fill(0, o, o + 5);
  }
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
  if (MBO.useWasm !== false && nxp === 0 && !(MBO.ndt > 0) && mbWasm(nm, nt, nx, ny, nz, cut2, forces, d3, wrap, bw, bh, bd)) { MBO.E += mbImage(forces, nm) + mb4Pass(forces, nm, nx, ny, nz, wrap, d3); return MBO.E; } // (the rest in the module when it can, 1.26: wasm.js; only plain metals: the module has 1.25's model, not 1.26's O/H partners or directional metals; MBO.useWasm false: the JavaScript below)
  // pairs: each cell against itself (the later member only) and its neighbouring cells of higher number, each once
  const rho = MBF.rho; rho.fill(0, 0, nm);
  const ND = MBO.ndt > 0, TD = MBF.tdp; // (directional metals present, 1.26: their member pairs listed, ρᴹ summed)
  let nd = 0;
  if (ND) { if (MBF.rm.length < nm) { MBF.rm = new Float64Array(nm * 2 + 64); MBF.gm = new Float64Array(nm * 2 + 64); } MBF.rm.fill(0, 0, nm); MBF.gm.fill(0, 0, nm); }
  const RM = MBF.rm, GMv = MBF.gm;
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
          if (ND) { const ds = TD[tro / nt * 5], dt = TD[STY[t] / nt * 5]; if ((ds || dt) && !MB_X[MBF.tz[tro / nt]] && !MB_X[MBF.tz[STY[t] / nt]]) mbDirPair(s, t, r, dx, dy, dz, sw, swd, r0, ed, kap, nd++); }
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
  if (ND) { MBO.nd = nd; mbDirGamma(nm, nd); for (let s = 0; s < nm; s++) if (GMv[s] !== 0) rho[s] += RM[s] * GMv[s]; } // (a directional centre's band: ρ + ρᴹ·Γ, 1.26; rho holds X from here)
  for (let s = 0; s < nm; s++) { const eps = EPS[STY[s] / nt], sq = Math.sqrt(rho[s] + eps * eps), w = SWt[s]; if (w === 1) { Eemb -= sq - eps; fd[s] = -0.5 / sq; } else { Eemb -= w * (sq - eps); fd[s] = -0.5 / sq; } } // (a partner's embedding at its weight, 1.26)
  MBO.np = np; MBO.E = Erep + Eemb;
  MBO.E += mbImage(forces, nm - nxp); // (ions near the metal: their image's pull, 1.26)
  MBO.E += mb4Pass(forces, nm, nx, ny, nz, wrap, d3); // (the band's shape, close-packed metals, 1.27)
  if (forces) {
    const FX = S.fx, FY = S.fy, FZ = S.fz, IM = S.im;
    let st = 0;
    for (let k = 0; k < np; k++) {
      const a = PA[k], b = PB[k], i = SS[a], j = SS[b], fsum = ND && (GMv[a] !== 0 || GMv[b] !== 0) && RM[a] + RM[b] > 0 && !MB_X[S.Z[i]] && !MB_X[S.Z[j]] ? fd[a] * (1 + GMv[a]) + KP[k] * fd[b] * (1 + GMv[b]) : fd[a] + KP[k] * fd[b]; // (KP: 1 between metals, 1.26; a directional centre's metal density weighs 1 + Γ, 1.26)
      const g = -(VR[k] + fsum * DR[k]); // (−dE/dr)
      const fx = g * UX[k], fy = g * UY[k];
      FX[j] += fx; FY[j] += fy; FX[i] -= fx; FY[i] -= fy;
      if (d3) { const fz = g * UZ[k]; FZ[j] += fz; FZ[i] -= fz; }
      const kk = PK[k] + fsum * RR[k]; // (the pair's own curvature: the repulsion's less the band's)
      if (kk > 0) { const w = kk * (IM[i] + IM[j]); if (w > st) st = w; }
    }
    if (st > _stiff) _stiff = st;
    if (ND) mbDirForces(nm, nd);
  }
  return MBO.E;
}
/* ---- directional metals in the pass (1.26): one member pair (cell-order slots s, t) with a directional end, listed;
   its metal density into ρᴹ of each end */
function mbDirPair(s, t, r, dx, dy, dz, sw, swd, r0, ed, kap, k) {
  if (k >= MBF.da.length) { const N = k * 2 + 256, g = (a, T) => { const b = new T(N); b.set(a); return b; }; MBF.da = g(MBF.da, Int32Array); MBF.db = g(MBF.db, Int32Array); for (const n of ['dr', 'dux', 'duy', 'duz', 'dsw', 'dsd', 'dr0']) MBF[n] = g(MBF[n], Float64Array); }
  const ir = 1 / r;
  MBF.da[k] = s; MBF.db[k] = t; MBF.dr[k] = r; MBF.dux[k] = dx * ir; MBF.duy[k] = dy * ir; MBF.duz[k] = dz * ir; MBF.dsw[k] = sw; MBF.dsd[k] = swd; MBF.dr0[k] = r0;
  MBF.rm[s] += ed * sw; MBF.rm[t] += ed * kap * sw;
}
/* the Legendre sum g(c) = Σ t_l P_l(c) and its slope (into _ms) */
function mbDirG(t2, t4, t6, c) {
  const c2 = c * c;
  _ms = t2 * 3 * c + t4 * (35 * c2 - 15) * c / 2 + t6 * (1386 * c2 * c2 - 1260 * c2 + 210) * c / 16;
  return t2 * (1.5 * c2 - 0.5) + t4 * ((35 * c2 - 30) * c2 + 3) / 8 + t6 * (((231 * c2 - 315) * c2 + 105) * c2 - 5) / 16;
}
/* each directional centre's arms (its listed pairs, by slot) and Γ = (T₀Σa² + 2Σ_{j<k} a_j a_k g(c_jk)) / (Σa)², with
   h_j = Σ_k a_k g(c_jk) (k = j counted) kept for the forces */
function mbDirGamma(nm, nd) {
  if (MBF.cst.length < nm + 1) MBF.cst = new Int32Array(nm * 2 + 64);
  if (MBF.cl.length < 2 * nd) MBF.cl = new Int32Array(nd * 4 + 64);
  if (MBF.ca.length < 2 * nd) { MBF.ca = new Float64Array(nd * 4 + 64); MBF.cad = new Float64Array(nd * 4 + 64); MBF.ch = new Float64Array(nd * 4 + 64); }
  const st = MBF.cst, cl = MBF.cl, DA = MBF.da, DB = MBF.db, TD = MBF.tdp, STY = MBF.st, nt = MBF.tz.length, GMv = MBF.gm, A = MBF.ca, AD = MBF.cad, H = MBF.ch;
  st.fill(0, 0, nm + 1);
  for (let k = 0; k < nd; k++) { if (TD[STY[DA[k]] / nt * 5]) st[DA[k] + 1]++; if (TD[STY[DB[k]] / nt * 5]) st[DB[k] + 1]++; }
  for (let s = 0; s < nm; s++) st[s + 1] += st[s];
  const fill = MBF.fill.length >= nm ? MBF.fill : (MBF.fill = new Int32Array(nm * 2 + 64));
  fill.set(st.subarray(0, nm));
  for (let k = 0; k < nd; k++) { if (TD[STY[DA[k]] / nt * 5]) cl[fill[DA[k]]++] = 2 * k; if (TD[STY[DB[k]] / nt * 5]) cl[fill[DB[k]]++] = 2 * k + 1; } // (2k: the centre is the pair's first end, 2k + 1 its second)
  const UX = MBF.dux, UY = MBF.duy, UZ = MBF.duz, R = MBF.dr, SW = MBF.dsw, SD = MBF.dsd, R0 = MBF.dr0;
  for (let s = 0; s < nm; s++) {
    const e0 = st[s], e1 = st[s + 1];
    if (e0 === e1) continue;
    const o = STY[s] / nt * 5, be = TD[o + 1], t2 = TD[o + 2], t4 = TD[o + 3], t6 = TD[o + 4], T0 = t2 + t4 + t6;
    let Ra = 0, N = 0;
    for (let e = e0; e < e1; e++) { const k = cl[e] >> 1, x = Math.exp(-be * (R[k] / R0[k] - 1)); A[e] = x * SW[k]; AD[e] = x * (SD[k] - be / R0[k] * SW[k]); Ra += A[e]; H[e] = A[e] * T0; N += A[e] * A[e] * T0; }
    for (let e = e0; e < e1; e++) {
      const k = cl[e] >> 1, sg = cl[e] & 1 ? -1 : 1, ux = UX[k] * sg, uy = UY[k] * sg, uz = UZ[k] * sg;
      for (let f = e + 1; f < e1; f++) {
        const k2 = cl[f] >> 1, sf = cl[f] & 1 ? -1 : 1, c = (ux * UX[k2] + uy * UY[k2] + uz * UZ[k2]) * sf, g = mbDirG(t2, t4, t6, c);
        N += 2 * A[e] * A[f] * g; H[e] += A[f] * g; H[f] += A[e] * g;
      }
    }
    GMv[s] = Ra > 0 ? N / (Ra * Ra) : 0;
  }
}
/* the forces of Γ: through each arm's weight a(r) and through the angles (E = −√(ρ + ρᴹΓ + ε²) + ε; ∂Γ/∂a_j = 2(h_j − ΓΣa)/(Σa)², ∂Γ/∂c_jk = 2a_j a_k g′(c_jk)/(Σa)²) */
function mbDirForces(nm, nd) {
  const st = MBF.cst, cl = MBF.cl, TD = MBF.tdp, STY = MBF.st, nt = MBF.tz.length, GMv = MBF.gm, RM = MBF.rm, fd = MBF.fd, SS = MBF.ss, A = MBF.ca, AD = MBF.cad, H = MBF.ch;
  const UX = MBF.dux, UY = MBF.duy, UZ = MBF.duz, R = MBF.dr, DA = MBF.da, DB = MBF.db, FX = S.fx, FY = S.fy, FZ = S.fz, d3 = W.d3;
  for (let s = 0; s < nm; s++) {
    const e0 = st[s], e1 = st[s + 1];
    if (e0 === e1) continue;
    const o = STY[s] / nt * 5, t2 = TD[o + 2], t4 = TD[o + 3], t6 = TD[o + 4], i = SS[s];
    let Ra = 0; for (let e = e0; e < e1; e++) Ra += A[e];
    if (!(Ra > 0)) continue;
    const C = fd[s] * RM[s] / (Ra * Ra), G = GMv[s];
    for (let e = e0; e < e1; e++) {
      const k = cl[e] >> 1, sg = cl[e] & 1 ? -1 : 1, j = SS[cl[e] & 1 ? DA[k] : DB[k]], ux = UX[k] * sg, uy = UY[k] * sg, uz = UZ[k] * sg;
      const dEr = C * 2 * (H[e] - G * Ra) * AD[e]; // (dE/dr of the arm, through its weight)
      FX[j] -= dEr * ux; FY[j] -= dEr * uy; FX[i] += dEr * ux; FY[i] += dEr * uy; if (d3) { FZ[j] -= dEr * uz; FZ[i] += dEr * uz; }
      const re = R[k];
      for (let f = e + 1; f < e1; f++) {
        const k2 = cl[f] >> 1, sf = cl[f] & 1 ? -1 : 1, jf = SS[cl[f] & 1 ? DA[k2] : DB[k2]], vx = UX[k2] * sf, vy = UY[k2] * sf, vz = UZ[k2] * sf, c = ux * vx + uy * vy + uz * vz;
        mbDirG(t2, t4, t6, c);
        const dEc = C * 2 * A[e] * A[f] * _ms, rf = R[k2];
        const gx = dEc * (vx - c * ux) / re, gy = dEc * (vy - c * uy) / re, gz = dEc * (vz - c * uz) / re; // (∂E/∂ of arm e's end)
        const hx = dEc * (ux - c * vx) / rf, hy = dEc * (uy - c * vy) / rf, hz = dEc * (uz - c * vz) / rf; // (of arm f's end)
        FX[j] -= gx; FY[j] -= gy; FX[jf] -= hx; FY[jf] -= hy; FX[i] += gx + hx; FY[i] += gy + hy;
        if (d3) { FZ[j] -= gz; FZ[jf] -= hz; FZ[i] += gz + hz; }
      }
    }
  }
}
/* ---- the band's shape for the close-packed metals (1.27, feature 20). The second-moment band (−√ρ) cannot tell the
   close-packed crystals from the body-centred one: bcc's 14 neighbours (its second shell at 1.155 r_nn, inside the 1.15–
   1.35 r₀ switch) give it more band than fcc's 12, so in 3-D most fcc and hcp metals came out lowest as bcc (Cu −0.053 eV
   an atom, Ni −0.081; a Cu ball turned body-centred within a picosecond). 1.26 tried MEAM's angles (item 4): the
   structures came right but the liquid rose by about the latent heat (its random angles), and the metals melted 250–400
   K too high. Here the band's shape instead: with one hopping hᵢⱼ = e^(−2(r/r₀ − 1)) between member atoms of the same
   metal (its r₀ and switch; an alloy's unlike pairs keep the constants fitted to its compounds: counted, they made B2
   NiAl pay bcc's price and its refitted pair overbound L1₂ Ni₃Al by 35%), the moments μ₂ = Σⱼ hᵢⱼ² and μ₄ = (H⁴)ᵢᵢ = Σₖ (Σⱼ hᵢⱼhⱼₖ)² (closed walks of four hops), and
   s = μ₄/μ₂² (the band's kurtosis): fcc and hcp 3.750 (any single close-packed shell), bcc 4.385, the 1.25 copper liquid
   3.743 ± 0.154 (atoms' spread). So a term that grows with s above 3.75 raises bcc and leaves the close-packed crystals
   exactly as they were (s is unchanged by a uniform scaling of one shell, and changes only to second order under any
   strain, so the term is fourth order: Ec, r₀, B, C₄₄, C′ and the vacancy stay 1.25's) and the liquid nearly so (its atoms
   above 3.75 pay a little: copper +3 meV an atom against 1.26's angles' +50).
     E₄ᵢ = Cᵢ·φ(μ₂ᵢ)·g(sᵢ − 3.75),   g(Δ) = W²Δ²/(W² + Δ²) for Δ > 0, else 0 (W = 1.5: bounded),
   φ rising from 0 at μ₂ = 7 to 1 at 10 (a fcc crystal has 12): an under-coordinated atom (an adatom, s 4.8–6; an atom
   arriving at a surface, whose s grows without bound as its one weak hopping fades) pays nothing, so the flat world
   (6 neighbours) and every surface process keep 1.25's energies; a (100) face's atoms (μ₂ 8, s 3.94) pay a little.
   Cᵢ is fitted per metal to its bcc − fcc (or bcc − hcp) energy, relaxed (tools/mb4fit.js); metals without a value keep
   1.25's model exactly. fcc against hcp is left as in 1.25 (equal: their μ₂ … μ₆ are the same for one shell). Forces
   analytic: with wᵢ = ∂E₄ᵢ/∂μ₄ᵢ and vᵢ = ∂E₄ᵢ/∂μ₂ᵢ, ∂E/∂hₐᵦ = 2(wₐ + wᵦ)(H³)ₐᵦ + 2Xₐᵦ + 2Xᵦₐ + 2hₐᵦ(vₐ + vᵦ), Xₐᵦ =
   Σₖ (H²)ₐₖwₖhₖᵦ. localPE exact (mb4Local: the centres within two hops of the set, with and without it). */
const MB4_Q = 2, MB4_S0 = 3.75, MB4_W2 = 2.25, MB4_NLO = 7, MB4_NHI = 10;
const MB4_C = { 4: 0.4612, 12: 0.1492, 13: 0.3789, 20: 0.1531, 21: 0.48, 22: 0.5607, 27: 0.4357, 28: 0.4719, 29: 0.2731, 30: 0.1217, 38: 0.1131, 39: 0.6392, 40: 0.5946, 44: 1.5369, 45: 0.9115, 46: 0.3129, 47: 0.1553, 48: 0.0661, 72: 0.8122, 75: 0.902, 76: 1.753, 77: 1.1389, 78: 0.2696, 79: 0.0792, 82: 0.0852 }; // (C by Z, eV: node tools/mb4fit.js --write; each metal's bcc its measured ΔE above its close-packed crystal, relaxed)
let _m4a = 0, _m4b = 0;
/* one centre's E₄ from its moments (∂E/∂μ₂ into _m4a, ∂E/∂μ₄ into _m4b) */
function mb4F(m2, m4, C) {
  _m4a = 0; _m4b = 0;
  if (!(C > 0) || m2 <= MB4_NLO) return 0;
  const m22 = m2 * m2, D = m4 / m22 - MB4_S0;
  if (D <= 0) return 0;
  let ph = 1, phd = 0;
  if (m2 < MB4_NHI) { const w = MB4_NHI - MB4_NLO, t = (m2 - MB4_NLO) / w; ph = t * t * t * (10 - t * (15 - 6 * t)); phd = 30 * t * t * (1 - t) * (1 - t) / w; }
  const D2 = D * D, den = MB4_W2 + D2, g = MB4_W2 * D2 / den, gd = 2 * MB4_W2 * MB4_W2 * D / (den * den);
  _m4b = C * ph * gd / m22; _m4a = C * (phd * g - ph * gd * 2 * m4 / (m22 * m2));
  return C * ph * g;
}
const MB4F = { pa: new Int32Array(0), off: new Int32Array(64), nb: new Int32Array(256), h: new Float64Array(256), hd: new Float64Array(256), ux: new Float64Array(256), uy: new Float64Array(256), uz: new Float64Array(256),
  row: new Float64Array(64), tl: new Int32Array(64), w: new Float64Array(64), v: new Float64Array(64), c: new Float64Array(16) };
/* the pass over the members in cell order (mbPass's slots and cells): E₄ and, with forces, its forces */
function mb4Pass(forces, nm, nx, ny, nz, wrap, d3) {
  const tz = MBF.tz, nt = tz.length, C4 = MB4F.c.length >= nt ? MB4F.c : (MB4F.c = new Float64Array(nt * 2));
  let any = false;
  for (let u = 0; u < nt; u++) { C4[u] = MB_X[tz[u]] ? 0 : (MB4_C[tz[u]] || 0); if (C4[u] > 0) any = true; }
  MBO.e4 = 0;
  if (!any) return 0;
  const F = MB4F, start = MBF.start, SX = MBF.sx, SY = MBF.sy, SZ = MBF.sz, STY = MBF.st, SA = MBF.sa, PT = MBF.pt, bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  if (F.off.length < nm + 1) { F.off = new Int32Array(nm * 2 + 64); F.row = new Float64Array(nm * 2 + 64); F.tl = new Int32Array(nm * 2 + 64); F.w = new Float64Array(nm * 2 + 64); F.v = new Float64Array(nm * 2 + 64); }
  // every member metal's member-metal neighbours: each pair once (a cell against itself, later slots only, and its
  // neighbouring cells of higher number, as mbPass), then both directions by slot (CSR): h, its slope, the direction
  let np = 0;
  const nc = nx * ny * nz, seen = MBF.nb, deg = F.off;
  deg.fill(0, 0, nm + 1);
  if (F.pa.length < 64) { F.pa = new Int32Array(256); F.pb = new Int32Array(256); F.ph = new Float64Array(256); F.phd = new Float64Array(256); F.pux = new Float64Array(256); F.puy = new Float64Array(256); F.puz = new Float64Array(256); }
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
          let dup = false; for (let u = 0; u < nn; u++) if (seen[u] === k) { dup = true; break; }
          if (!dup) seen[nn++] = k;
        }
      }
    }
    for (let s = s0; s < s1; s++) {
      const ts = STY[s] / nt;
      if (MB_X[tz[ts]]) continue;
      const xi = SX[s], yi = SY[s], zi = SZ[s], ai = SA[s];
      for (let u = 0; u < nn; u++) {
        const k = seen[u];
        for (let t = k === c ? s + 1 : start[k], e = start[k + 1]; t < e; t++) {
          if (STY[t] !== STY[s] || SA[t] !== ai) continue; // (the element's own neighbours only: an alloy's unlike pairs keep their fitted constants)
          let dx = SX[t] - xi, dy = SY[t] - yi, dz = SZ[t] - zi;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
          const r2 = dx * dx + dy * dy + dz * dz, o = (ts * nt + ts) * 9;
          if (r2 >= PT[o + 7] || r2 < 1e-12) continue;
          if (np >= F.pa.length) { const N = np * 2 + 256, g = (a, T) => { const b = new T(N); b.set(a); return b; }; F.pa = g(F.pa, Int32Array); F.pb = g(F.pb, Int32Array); for (const n of ['ph', 'phd', 'pux', 'puy', 'puz']) F[n] = g(F[n], Float64Array); }
          const r = Math.sqrt(r2), r0 = PT[o + 4], on = PT[o + 5], x = Math.exp(MB4_Q * (1 - r / r0));
          let sw = 1, swd = 0;
          if (r > on) { const w = PT[o + 6] - on, q = (r - on) / w; sw = 1 - q * q * q * (10 - q * (15 - 6 * q)); swd = -30 * q * q * (1 - q) * (1 - q) / w; }
          F.pa[np] = s; F.pb[np] = t; F.ph[np] = x * sw; F.phd[np] = x * (swd - MB4_Q / r0 * sw); F.pux[np] = dx / r; F.puy[np] = dy / r; F.puz[np] = dz / r; np++;
          deg[s + 1]++; deg[t + 1]++;
        }
      }
    }
  }
  for (let s = 0; s < nm; s++) deg[s + 1] += deg[s];
  const ne = deg[nm];
  if (ne > F.nb.length) { const N = ne * 2 + 256; F.nb = new Int32Array(N); for (const n of ['h', 'hd', 'ux', 'uy', 'uz']) F[n] = new Float64Array(N); }
  { const fill = F.tl; fill.set(deg.subarray(0, nm)); const PA = F.pa, PB = F.pb, PH = F.ph, PD = F.phd, PX = F.pux, PY = F.puy, PZ = F.puz, NB = F.nb, H = F.h, HD = F.hd, UX = F.ux, UY = F.uy, UZ = F.uz;
    for (let q = 0; q < np; q++) { const a = PA[q], b = PB[q], h = PH[q], hd = PD[q];
      let e = fill[a]++; NB[e] = b; H[e] = h; HD[e] = hd; UX[e] = PX[q]; UY[e] = PY[q]; UZ[e] = PZ[q];
      e = fill[b]++; NB[e] = a; H[e] = h; HD[e] = hd; UX[e] = -PX[q]; UY[e] = -PY[q]; UZ[e] = -PZ[q]; } }
  const off = F.off, NB = F.nb, H = F.h, row = F.row, tl = F.tl, Wv = F.w, Vv = F.v;
  row.fill(0, 0, nm);
  const rowOf = (a) => { // ((H²)ₐ· into row; the touched slots in tl; returns their count)
    let nt2 = 0;
    for (let e = off[a]; e < off[a + 1]; e++) { const j = NB[e], hj = H[e]; for (let f = off[j]; f < off[j + 1]; f++) { const k = NB[f]; if (row[k] === 0) tl[nt2++] = k; row[k] += hj * H[f]; } }
    return nt2;
  };
  let E = 0;
  for (let s = 0; s < nm; s++) {
    Wv[s] = 0; Vv[s] = 0;
    const C = C4[STY[s] / nt];
    if (!(C > 0) || off[s + 1] === off[s]) continue;
    let m2 = 0; for (let e = off[s]; e < off[s + 1]; e++) m2 += H[e] * H[e];
    if (m2 <= MB4_NLO) continue;
    const n2 = rowOf(s); let m4 = 0;
    for (let u = 0; u < n2; u++) { const k = tl[u]; m4 += row[k] * row[k]; row[k] = 0; }
    E += mb4F(m2, m4, C); Wv[s] = _m4b; Vv[s] = _m4a;
  }
  MBO.e4 = E;
  if (!forces || E === 0) return E;
  const FX = S.fx, FY = S.fy, FZ = S.fz, SS = MBF.ss, HD = F.hd, UX = F.ux, UY = F.uy, UZ = F.uz;
  for (let a = 0; a < nm; a++) {
    if (off[a + 1] === off[a]) continue;
    const n2 = rowOf(a), wa = Wv[a], va = Vv[a], i = SS[a];
    for (let e = off[a]; e < off[a + 1]; e++) {
      const b = NB[e], wb = Wv[b];
      let h3 = 0, xx = 0;
      for (let f = off[b]; f < off[b + 1]; f++) { const k = NB[f], rk = row[k]; if (rk === 0) continue; const t = rk * H[f]; h3 += t; xx += t * Wv[k]; }
      const dEdh = (wa + wb) * h3 + 2 * xx + 2 * H[e] * va;
      if (dEdh === 0) continue;
      const g = -dEdh * HD[e], j = SS[b]; // (−dE/dr from this ordered pair's share)
      FX[j] += g * UX[e]; FY[j] += g * UY[e]; FX[i] -= g * UX[e]; FY[i] -= g * UY[e];
      if (d3) { FZ[j] += g * UZ[e]; FZ[i] -= g * UZ[e]; }
    }
    for (let u = 0; u < n2; u++) row[tl[u]] = 0;
  }
  return E;
}
/* E₄ that a change to the atoms in set T can alter (for mbLocal): T's centres' E₄, and every other centre within two
   hops of T its E₄ less its E₄ without T (which no position of T's atoms changes): exact as a before/after difference. */
function mb4Local(set) {
  let any = false; for (const z in MB4_C) if (MB4_C[z] > 0) { any = true; break; }
  if (!any) return 0;
  const T = []; for (const p of set) if (!p.dead && p.k === NUC && mbIs(p.i) && !MB_X[p.Z]) T.push(p);
  if (!T.length) return 0;
  const R = mbRmax(), d3 = W.d3, lists = new Map(); // (member metal → [[o, h], …])
  const nbOf = (p) => {
    let L = lists.get(p); if (L) return L;
    L = []; const seen = new Set();
    const v = (o, dx, dy, r2) => {
      if (o === p || seen.has(o) || o.dead || o.k !== NUC || o.anti !== p.anti || o.Z !== p.Z || !mbIs(o.i)) return; seen.add(o);
      const P = mbPP(p.Z, o.Z), r = Math.sqrt(r2); if (r >= P[6] || r < 1e-6) return;
      mbSw(r, P[5], P[6]); L.push([o, Math.exp(MB4_Q * (1 - r / P[4])) * _ms]);
    };
    nearby(p.x, p.y, R, v, p.z);
    for (const o of _late) { if (o.dead) continue; const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, d3 ? o.z - p.z : 0), r2 = dx * dx + dy * dy + dz * dz; if (r2 <= R * R) v(o, dx, dy, r2); }
    lists.set(p, L); return L;
  };
  const inT = new Set(T), cen = new Set(T);
  for (const p of T) for (const [j] of nbOf(p)) { cen.add(j); for (const [k] of nbOf(j)) cen.add(k); }
  const e4 = (i, skip) => { // (centre i's E₄, the atoms of skip left out)
    const C = MB4_C[i.Z] || 0; if (!(C > 0)) return 0;
    let m2 = 0; const row = new Map();
    for (const [j, hj] of nbOf(i)) { if (skip && skip.has(j)) continue; m2 += hj * hj; for (const [k, hk] of nbOf(j)) { if (skip && skip.has(k)) continue; row.set(k, (row.get(k) || 0) + hj * hk); } }
    if (m2 <= MB4_NLO) return 0;
    let m4 = 0; for (const x of row.values()) m4 += x * x;
    return mb4F(m2, m4, C);
  };
  let E = 0;
  for (const i of cen) E += inT.has(i) ? e4(i, null) : e4(i, null) - e4(i, inT);
  return E;
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
  return Ei + mbLocalMB(set) + mb4Local(set); // (the band's shape, 1.27)
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
    E += wp * mbF(MB_X[p.Z] || !MBD_DIR(p.Z) ? rho : mbDirX(p, null), MB_X[p.Z] ? MB_XEPS : mbParam(p.Z).eps); // (a directional metal: its ρ + ρᴹΓ, 1.26)
  }
  for (const [o, dT] of near) {
    let rho = 0;
    around(o, (u, r) => { const P = mbPP(o.Z, u.Z); if (r >= P[6]) return; mbSw(r, P[5], P[6]); rho += P[1] * Math.exp(-P[3] * P[4] * (r / P[4] - 1)) * _ms * wOf(u); });
    const eps = MB_X[o.Z] ? MB_XEPS : mbParam(o.Z).eps;
    if (!MB_X[o.Z] && MBD_DIR(o.Z)) { E += mbF(mbDirX(o, null), eps) - mbF(mbDirX(o, inT), eps); continue; } // (a directional neighbour: its band with and without T's atoms, whose angles count too, 1.26)
    E += wOf(o) * (mbF(rho, eps) - mbF(Math.max(0, rho - dT), eps));
  }
  return E;
}
/* a directional member's band argument X = ρ + ρᴹΓ from its surroundings (1.26; as mbPass has it), the atoms in skip left
   out (mbLocal: what it is without a set) */
function mbDirX(p, skip) {
  const P0 = mbParam(p.Z), be = P0.be, [t2, t4, t6] = P0.t, T0 = t2 + t4 + t6, d3 = W.d3, R = mbRmax(), seen = new Set();
  let rho = 0, rm = 0; const a = [], ux = [], uy = [], uz = [];
  const v = (o, dx, dy, r2, dz) => {
    if (o === p || seen.has(o) || o.dead || o.k !== NUC || o.anti !== p.anti || (skip && skip.has(o))) return; seen.add(o);
    const mem = mbIs(o.i); if (!mem && !mbIsX(o.i)) return;
    const P = mbPP(p.Z, o.Z), r = Math.sqrt(r2); if (r >= P[6] || r < 1e-6) return;
    mbSw(r, P[5], P[6]);
    const ed = P[1] * Math.exp(-P[3] * P[4] * (r / P[4] - 1)) * _ms;
    rho += ed * (mem ? 1 : mbW(o.i));
    if (!mem) return;
    rm += ed; a.push(Math.exp(-be * (r / P[4] - 1)) * _ms); ux.push(dx / r); uy.push(dy / r); uz.push((dz || 0) / r);
  };
  nearby(p.x, p.y, R, v, p.z);
  for (const o of _late) { if (o.dead) continue; const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, d3 ? o.z - p.z : 0); v(o, dx, dy, dx * dx + dy * dy + dz * dz, dz); }
  let Ra = 0, N = 0;
  for (let e = 0; e < a.length; e++) { Ra += a[e]; N += a[e] * a[e] * T0; for (let f = e + 1; f < a.length; f++) N += 2 * a[e] * a[f] * mbDirG(t2, t4, t6, ux[e] * ux[f] + uy[e] * uy[f] + uz[e] * uz[f]); }
  return Ra > 0 ? rho + rm * (N / (Ra * Ra)) : rho;
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
    const R = Math.max(MB_OFF * Math.max(mbParam(p.Z).r0, MBO.r0max || 0, MBO.rx0 || 0), MBO.dirR || 0); // (the members' widest reach at the last pass, and the partners' (1.26): an estimate needs no more; a directional metal's wider switch, 1.26)
    let rho = 0;
    nearby(p.x, p.y, R, (o, dx, dy, r2) => {
      if (o === p || o.dead || o.k !== NUC || o.anti !== p.anti) return;
      const w = mbIs(o.i) ? 1 : mbIsX(o.i) ? mbW(o.i) : 0; if (!w) return; // (a partner at its weight, 1.26)
      const P = mbPP(p.Z, o.Z), r = Math.sqrt(r2); if (r >= P[6]) return;
      mbSw(r, P[5], P[6]);
      rho += P[1] * Math.exp(P[3] * (P[4] - r)) * _ms * w;
      if (!(L.length === 2 && o === (p === d ? acc : d) && p === acc)) E -= P[0] * Math.exp(P[2] * (P[4] - r)) * _ms * w; // (the pair of the two counted once)
    }, p.z);
    E -= mbF(MBD_DIR(p.Z) ? mbDirX(p, null) : rho, mbParam(p.Z).eps); // (a directional metal's own band with its angles, 1.26: neighbours' angles can go either way, so here the bound is an estimate; the trial decides)
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
