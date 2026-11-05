'use strict';
/* ---- Experimental: directional forces from off-atom charge sites (1.26; Settings → Experimental). A site is a point
   that carries part of an atom's charge, placed from the atom and its bonded neighbours, so the molecule's charge has a
   shape a point charge per atom cannot give:
   - Lone pairs (SITES.lp, 3-D): an sp³ oxygen with two single bonds (water, alcohols, ethers, peroxides) puts its partial
     charge on two lone pairs at the tetrahedral directions, LP_O.d from the nucleus (as the TIP5P water model does); an
     sp³ nitrogen with three single bonds (ammonia, amines) on one, along its pyramid's axis. Hydrogen bonds then point
     where the lone pairs are: water's network comes out tetrahedral.
   - σ-holes (SITES.sh, both modes): a chlorine, bromine or iodine with one bond (to carbon or to another halogen) has a
     small positive site on the far side of its bond, with the same charge taken off the atom (its belt more negative), as
     force fields' "extra point" models do: halogen bonds C–X···N point straight along the C–X axis.
   - π clouds (SITES.pi, 3-D): an aromatic carbon puts a negative site above and below the ring (PI_S.d along the ring's
     normal), the same charge added to the carbon: benzene's quadrupole, so rings stack offset or T-shaped, not face to face.
   Between atoms of different molecules within the cutoff only (a molecule's own atoms keep their point charges): each
   pair's Coulomb energy, worked out between the two charge sets (the atom with what it keeps, and its sites), replaces
   the pair kernel's atom-to-atom one, faded back to it between RC − SW_W and RC (a smooth step on the atoms' distance,
   so nothing jumps at the cutoff; sums of charges are kept, so the shift to zero at the cutoff is the same). The same
   soft Coulomb (1/√(r² + 0.09)) and ion–molecule weight (iwK) as the kernel. A correction added after the kernels on the
   main thread (the WebAssembly kernel and the workers are untouched): sitesForces in the force pass, sitesLocal in
   localPE (events), sitesTotal in totalEnergy, sitesPairE in pairPE, and the induced charges' φ and energy change
   (qeqUpdate) see it. Off: nothing runs (SITES.any false), the game bit for bit as before. */
const SITES = { lp: 0, sh: 0, pi: 0, any: false, n: 0, rings: 0, pairs: 0, bath: 0, soft: 0.09 }; // (soft: the softening (Å²) of a site's Coulomb: a lone pair or a π cloud is a spread of charge, not a point)
const LP_O = { d: 0.70, a: 54.7356, f: 1.0, m: 0, fm: 0 }, LP_N = { d: 0.70, f: 1.0 }; // (d Å from the nucleus; f: the share of the atom's partial charge the lone pairs carry)
const LP_NS = 1.116; // (|û₁ + û₂ + û₃| for ammonia's 107°: the N site sits LP_N.d out along the axis there, nearer as the pyramid flattens)
const SH = { 17: [1.60, 0.10], 35: [1.90, 0.085], 53: [2.20, 0.08] }; // (σ-hole site: [distance from the halogen, Å, as force fields' extra points; charge, e, fitted on CH₃X···NH₃, 1.26])
const PI_S = { d: 0.70, q: 0.07 }; // (π sites: distance from the ring's plane, Å; charge of each, e)
/* π-stacking's dispersion (with SITES.pi): between ring atoms of two aromatic molecules (an aromatic carbon, a hydrogen on
   one) the pair kernel's Lennard-Jones (UFF, doubled for the flat world's cohesion, LJ_SCALE) is replaced by OPLS-AA's
   aromatic one (Jorgensen and Severance 1990: C σ 3.55 Å, ε 0.070 kcal/mol; H σ 2.42 Å, ε 0.030; geometric means), faded
   out with the sites' step before the cutoff; inside the kernel's inner wall (0.62 rm) the difference goes on straight,
   so the kernel's core is kept. PIJ: [rm Å, ε eV] by Z. */
const PIJ = { 6: [3.985, 1.4 * 0.070 / 23.0605], 1: [2.716, 0.030 / 23.0605] }; // (the carbons' ε 1.4 times OPLS's: fitted with the π sites' charge on the benzene dimer's three shapes, 1.26)
const SW_W = 1.0, SOFT_S = 0.09; // (the fade's width before the cutoff, Å; the kernel's softening, Å²)
function sitesSet(kind, on) {
  const was = SITES.lp + ',' + SITES.sh + ',' + SITES.pi, live = W.parts && W.parts.length;
  const Eb = live && SITES.any ? sitesTotal() : 0;
  if (typeof kind === 'number') { SITES.lp = kind ? 1 : 0; SITES.sh = kind ? 1 : 0; SITES.pi = kind ? 1 : 0; } // (tests: all three)
  else SITES[kind] = on ? 1 : 0;
  SITES.any = !!(SITES.lp || SITES.sh || SITES.pi); SD.key = '';
  if (!live || was === SITES.lp + ',' + SITES.sh + ',' + SITES.pi) return;
  const Ea = SITES.any ? sitesTotal() : 0;
  W.ledger.bath += Eb - Ea; SITES.bath += Eb - Ea; // (switched with molecules in the box: the energy difference is booked to the heat bath, as the other Experimental models do)
  W.fSpawn = -1; // (the forces again before the next step)
}
/* An atom's sites now (live: from its bonds and its neighbours' positions), into out: ns sites at offsets o (from the
   atom), charges sq (each = w·qa + b), the atom keeping aq; with w and b for the induced charges' φ. 0 if it has none. */
const _sg = { ns: 0, o: new Float64Array(9), sq: new Float64Array(3), w: new Float64Array(3), b: new Float64Array(3), aq: 0, aw: 1, ab: 0, kind: 0 };
function siteKind(p) {
  if (p.k !== NUC || p.Z === 0 || p.ne === 0 || p.dead || p.fast || p.rad || p.anti || p.bom || p.q !== 0) return 0;
  const n = p.bonds.length, Z = p.Z;
  if (SITES.lp && W.d3 && (Z === 8 || Z === 7)) {
    if (n !== (Z === 8 ? 2 : 3)) return 0;
    for (const bd of p.bonds) if (bd.order !== 1 || bd.arom) return 0;
    return Z === 8 ? 1 : 2;
  }
  if (SITES.sh && SH[Z] && n === 1) {
    const bd = p.bonds[0], o = other(bd, p);
    if (bd.order !== 1 || bd.arom || !(o.Z === 6 || SH[o.Z] || o.Z === 9)) return 0;
    return 3;
  }
  if (SITES.pi && W.d3 && Z === 6 && n === 3) { for (const bd of p.bonds) if (bd.arom) return 4; }
  return 0;
}
const _sv = new Float64Array(9), _su = new Float64Array(9), _sr = new Float64Array(3);
function siteVecs(p, n) { // bond vectors to the neighbours (minimum image), their lengths and unit vectors
  for (let k = 0; k < n; k++) {
    const o = other(p.bonds[k], p);
    let dx = o.x - p.x, dy = o.y - p.y, dz = W.d3 ? o.z - p.z : 0;
    if (W.wall === 'wrap') { const bw = W.box.w, bh = W.box.h; if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; if (W.d3) { const bd = W.box.d; if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; } }
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    _sv[3 * k] = dx; _sv[3 * k + 1] = dy; _sv[3 * k + 2] = dz; _sr[k] = r; _su[3 * k] = dx / r; _su[3 * k + 1] = dy / r; _su[3 * k + 2] = dz / r;
  }
}
function siteGeom(p, out) {
  const kind = siteKind(p); out.kind = kind; out.ns = 0;
  if (!kind) return 0;
  const qa = p.q + p.qp, o = out.o;
  if (kind === 1) { // O: two lone pairs, d(cos α b̂ ± sin α n̂), b̂ = −(û₁+û₂)/|…|, n̂ = û₁×û₂/|…|
    siteVecs(p, 2);
    const sx = _su[0] + _su[3], sy = _su[1] + _su[4], sz = _su[2] + _su[5], sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1e-9;
    const cx = _su[1] * _su[5] - _su[2] * _su[4], cy = _su[2] * _su[3] - _su[0] * _su[5], cz = _su[0] * _su[4] - _su[1] * _su[3], cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1e-9;
    const ca = Math.cos(LP_O.a * Math.PI / 180), sa = Math.sin(LP_O.a * Math.PI / 180), a = -LP_O.d * ca / sl, b = LP_O.d * sa / cl, m = LP_O.m / sl;
    o[0] = a * sx + b * cx; o[1] = a * sy + b * cy; o[2] = a * sz + b * cz;
    o[3] = a * sx - b * cx; o[4] = a * sy - b * cy; o[5] = a * sz - b * cz;
    o[6] = m * sx; o[7] = m * sy; o[8] = m * sz; // (M: toward the hydrogens, as TIP4P's; it keeps the molecule's dipole)
    out.ns = LP_O.fm ? 3 : 2; const w = LP_O.f / 2; out.w[0] = out.w[1] = w; out.w[2] = LP_O.fm; out.b[0] = out.b[1] = out.b[2] = 0; out.aw = 1 - LP_O.f - LP_O.fm; out.ab = 0;
  } else if (kind === 2) { // N: one lone pair, −(d/LP_NS)(û₁+û₂+û₃)
    siteVecs(p, 3);
    const k = -LP_N.d / LP_NS;
    o[0] = k * (_su[0] + _su[3] + _su[6]); o[1] = k * (_su[1] + _su[4] + _su[7]); o[2] = k * (_su[2] + _su[5] + _su[8]);
    out.ns = 1; out.w[0] = LP_N.f; out.b[0] = 0; out.aw = 1 - LP_N.f; out.ab = 0;
  } else if (kind === 3) { // halogen: +q at d beyond the atom, along the bond
    siteVecs(p, 1);
    const s = SH[p.Z];
    o[0] = -s[0] * _su[0]; o[1] = -s[0] * _su[1]; o[2] = -s[0] * _su[2];
    out.ns = 1; out.w[0] = 0; out.b[0] = s[1]; out.aw = 1; out.ab = -s[1];
  } else { // aromatic carbon: −q at ±d along the normal n = v₁×v₂ + v₂×v₃ + v₃×v₁
    siteVecs(p, 3);
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { const a = 3 * k, b = 3 * ((k + 1) % 3); nx += _su[a + 1] * _su[b + 2] - _su[a + 2] * _su[b + 1]; ny += _su[a + 2] * _su[b] - _su[a] * _su[b + 2]; nz += _su[a] * _su[b + 1] - _su[a + 1] * _su[b]; }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-9, s = PI_S.d / nl;
    o[0] = s * nx; o[1] = s * ny; o[2] = s * nz; o[3] = -o[0]; o[4] = -o[1]; o[5] = -o[2];
    out.ns = 2; out.w[0] = out.w[1] = 0; out.b[0] = out.b[1] = -PI_S.q; out.aw = 1; out.ab = 2 * PI_S.q;
  }
  for (let m = 0; m < out.ns; m++) out.sq[m] = out.w[m] * qa + out.b[m];
  out.aq = out.aw * qa + out.ab;
  return out.ns;
}
/* The gradient on the offsets (g, per site, eV/Å) carried back to the atom and its neighbours as forces: an offset
   depends only on the bond vectors v = r(neighbour) − r(atom), so −∂E/∂v goes to the neighbour and +∂E/∂v to the atom. */
const _gu = new Float64Array(9);
function siteBack(p, kind, g, FX, FY, FZ) {
  const n = kind === 1 ? 2 : kind === 3 ? 1 : 3;
  siteVecs(p, n);
  _gu.fill(0);
  if (kind === 1) {
    const sx = _su[0] + _su[3], sy = _su[1] + _su[4], sz = _su[2] + _su[5], sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1e-9;
    const cx = _su[1] * _su[5] - _su[2] * _su[4], cy = _su[2] * _su[3] - _su[0] * _su[5], cz = _su[0] * _su[4] - _su[1] * _su[3], cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1e-9;
    // o± = −d·ca·ŝ ± d·sa·ĉ: gradients on ŝ and ĉ
    const ca = Math.cos(LP_O.a * Math.PI / 180), sa = Math.sin(LP_O.a * Math.PI / 180), dc = -LP_O.d * ca, ds = LP_O.d * sa, m = LP_O.fm ? LP_O.m : 0;
    const gsx = dc * (g[0] + g[3]) + m * g[6], gsy = dc * (g[1] + g[4]) + m * g[7], gsz = dc * (g[2] + g[5]) + m * g[8];
    const gcx = ds * (g[0] - g[3]), gcy = ds * (g[1] - g[4]), gcz = ds * (g[2] - g[5]);
    // unit vectors: g_raw = (g − û(û·g))/|raw|
    const hx = sx / sl, hy = sy / sl, hz = sz / sl, dd = hx * gsx + hy * gsy + hz * gsz;
    const Gsx = (gsx - hx * dd) / sl, Gsy = (gsy - hy * dd) / sl, Gsz = (gsz - hz * dd) / sl; // (on s = û₁ + û₂)
    const kx = cx / cl, ky = cy / cl, kz = cz / cl, de = kx * gcx + ky * gcy + kz * gcz;
    const Gcx = (gcx - kx * de) / cl, Gcy = (gcy - ky * de) / cl, Gcz = (gcz - kz * de) / cl; // (on c = û₁ × û₂)
    // c = û₁ × û₂: ∂/∂û₁ = û₂ × G, ∂/∂û₂ = G × û₁
    _gu[0] = Gsx + (_su[4] * Gcz - _su[5] * Gcy); _gu[1] = Gsy + (_su[5] * Gcx - _su[3] * Gcz); _gu[2] = Gsz + (_su[3] * Gcy - _su[4] * Gcx);
    _gu[3] = Gsx + (Gcy * _su[2] - Gcz * _su[1]); _gu[4] = Gsy + (Gcz * _su[0] - Gcx * _su[2]); _gu[5] = Gsz + (Gcx * _su[1] - Gcy * _su[0]);
  } else if (kind === 2) {
    const k = -LP_N.d / LP_NS; for (let m = 0; m < 3; m++) { _gu[3 * m] = k * g[0]; _gu[3 * m + 1] = k * g[1]; _gu[3 * m + 2] = k * g[2]; }
  } else if (kind === 3) {
    const d = -SH[p.Z][0]; _gu[0] = d * g[0]; _gu[1] = d * g[1]; _gu[2] = d * g[2];
  } else {
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { const a = 3 * k, b = 3 * ((k + 1) % 3); nx += _su[a + 1] * _su[b + 2] - _su[a + 2] * _su[b + 1]; ny += _su[a + 2] * _su[b] - _su[a] * _su[b + 2]; nz += _su[a] * _su[b + 1] - _su[a + 1] * _su[b]; }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-9, hx = nx / nl, hy = ny / nl, hz = nz / nl;
    const gx = PI_S.d * (g[0] - g[3]), gy = PI_S.d * (g[1] - g[4]), gz = PI_S.d * (g[2] - g[5]), dn = hx * gx + hy * gy + hz * gz;
    const Gx = (gx - hx * dn) / nl, Gy = (gy - hy * dn) / nl, Gz = (gz - hz * dn) / nl; // (on n)
    for (let k = 0; k < 3; k++) { // n = Σ ûₐ × û_b over (1,2), (2,3), (3,1): ∂/∂ûₐ += û_b × G, ∂/∂û_b += G × ûₐ
      const a = 3 * k, b = 3 * ((k + 1) % 3);
      _gu[a] += _su[b + 1] * Gz - _su[b + 2] * Gy; _gu[a + 1] += _su[b + 2] * Gx - _su[b] * Gz; _gu[a + 2] += _su[b] * Gy - _su[b + 1] * Gx;
      _gu[b] += Gy * _su[a + 2] - Gz * _su[a + 1]; _gu[b + 1] += Gz * _su[a] - Gx * _su[a + 2]; _gu[b + 2] += Gx * _su[a + 1] - Gy * _su[a];
    }
  }
  const i = p.i;
  for (let k = 0; k < n; k++) { // û = v/r: ∂/∂v = (g − û(û·g))/r; v = r(o) − r(p)
    const a = 3 * k, r = _sr[k], ux = _su[a], uy = _su[a + 1], uz = _su[a + 2], gx = _gu[a], gy = _gu[a + 1], gz = _gu[a + 2], d = ux * gx + uy * gy + uz * gz;
    const vx = (gx - ux * d) / r, vy = (gy - uy * d) / r, vz = (gz - uz * d) / r, j = other(p.bonds[k], p).i;
    FX[j] -= vx; FY[j] -= vy; FX[i] += vx; FY[i] += vy; if (FZ) { FZ[j] -= vz; FZ[i] += vz; }
  }
}
/* One pair's energy correction: a's charge set against b's (sa, sb: the two atoms' _sg-like site data, ns 0 for a plain
   atom), d = r(b) − r(a). With grad, the gradients: on the two atoms (ga, gb: 3 each) and on each site's offset (goa,
   gob). With dq, ∂E/∂qa of each atom (into _pdq). */
const _pdq = [0, 0];
function sitePairE(a, b, sa, sb, dx, dy, dz, grad, ga, gb, goa, gob, dq) {
  const r2 = dx * dx + dy * dy + dz * dz;
  if (r2 >= RC2) return 0;
  const r = Math.sqrt(r2), qa = a.q + a.qp, qb = b.q + b.qp;
  const k = PHYS.KE * ((a.ionic !== b.ionic && (a.ionic ? b.q === 0 : a.q === 0)) ? K_IW : 1);
  const r1 = RC - SW_W; let sw = 1, dsw = 0;
  if (r > r1) { const x = (r - r1) / SW_W; sw = 1 - x * x * x * (10 - 15 * x + 6 * x * x); dsw = -30 * x * x * (1 - x) * (1 - x) / SW_W; }
  const na = sa.ns, nb = sb.ns;
  // the atom-to-atom term the kernel has
  const s0 = r2 + SOFT_S, g0 = 1 / Math.sqrt(s0);
  let E = -qa * qb * g0;
  if (grad) { const f = qa * qb * g0 / s0 * k * sw; ga[0] -= f * dx; ga[1] -= f * dy; ga[2] -= f * dz; gb[0] += f * dx; gb[1] += f * dy; gb[2] += f * dz; } // (∂(−qq·g)/∂r_b = +qq·g³·d)
  if (dq) { _pdq[0] = -qb * g0; _pdq[1] = -qa * g0; }
  for (let m = -1; m < na; m++) {
    const Qa = m < 0 ? (na ? sa.aq : qa) : sa.sq[m], oax = m < 0 ? 0 : sa.o[3 * m], oay = m < 0 ? 0 : sa.o[3 * m + 1], oaz = m < 0 ? 0 : sa.o[3 * m + 2];
    const wa = m < 0 ? (na ? sa.aw : 1) : sa.w[m];
    for (let l = -1; l < nb; l++) {
      const Qb = l < 0 ? (nb ? sb.aq : qb) : sb.sq[l], obx = l < 0 ? 0 : sb.o[3 * l], oby = l < 0 ? 0 : sb.o[3 * l + 1], obz = l < 0 ? 0 : sb.o[3 * l + 2];
      const ex = dx + obx - oax, ey = dy + oby - oay, ez = dz + obz - oaz, s = ex * ex + ey * ey + ez * ez + (m < 0 && l < 0 ? SOFT_S : SITES.soft), g = 1 / Math.sqrt(s);
      E += Qa * Qb * g;
      if (dq) { const wb = l < 0 ? (nb ? sb.aw : 1) : sb.w[l]; _pdq[0] += wa * Qb * g; _pdq[1] += wb * Qa * g; }
      if (grad && (Qa !== 0 && Qb !== 0)) {
        const f = Qa * Qb * g / s * k * sw, fx = f * ex, fy = f * ey, fz = f * ez; // (∂(QQ·g)/∂r_b = −QQ·g³·e)
        gb[0] -= fx; gb[1] -= fy; gb[2] -= fz; ga[0] += fx; ga[1] += fy; ga[2] += fz;
        if (l >= 0) { gob[3 * l] -= fx; gob[3 * l + 1] -= fy; gob[3 * l + 2] -= fz; }
        if (m >= 0) { goa[3 * m] += fx; goa[3 * m + 1] += fy; goa[3 * m + 2] += fz; }
      }
    }
  }
  if (grad && dsw) { const f = k * E * dsw / r; ga[0] -= f * dx; ga[1] -= f * dy; ga[2] -= f * dz; gb[0] += f * dx; gb[1] += f * dy; gb[2] += f * dz; }
  if (dq) { _pdq[0] *= k * sw; _pdq[1] *= k * sw; }
  return k * sw * E;
}
/* ---- the force pass: the site atoms' list (kept while bonding, species and the switches are the same), their sites at
   the positions now, every pair of the neighbour list between different molecules with a site atom in it. */
const SD = { idx: new Int32Array(0), rg: new Uint8Array(0), at: [], dat: [], key: '', n: new Int32Array(0), q: new Float64Array(0), o: new Float64Array(0), go: new Float64Array(0) };
const _nos = { ns: 0 };
function sitesPrep() {
  const key = W.topo + ':' + W.dirty + ':' + W.parts.length + ':' + W.spawned + ':' + W.deaths + ':' + _flagGen + ':' + SITES.lp + SITES.sh + SITES.pi + ':' + (W.d3 ? 1 : 0) + ':' + BO.any;
  if (SD.idx.length < S.size) { SD.idx = new Int32Array(S.size * 2).fill(-1); SD.key = ''; }
  if (key !== SD.key) {
    for (const p of SD.at) if (p.i >= 0 && p.i < SD.idx.length) SD.idx[p.i] = -1;
    SD.at = []; for (const p of W.parts) if (siteKind(p)) { SD.idx[p.i] = SD.at.length; SD.at.push(p); }
    if (SD.rg.length < S.size) SD.rg = new Uint8Array(S.size * 2); else SD.rg.fill(0); SITES.rings = 0;
    if (SITES.pi) for (const p of W.parts) if (!p.dead && ringType(p)) { SD.rg[p.i] = 1; SITES.rings++; }
    while (SD.dat.length < SD.at.length) SD.dat.push({ ns: 0, o: new Float64Array(9), sq: new Float64Array(3), w: new Float64Array(3), b: new Float64Array(3), aq: 0, aw: 1, ab: 0, kind: 0 });
    const m = SD.at.length; if (SD.n.length < m) { SD.n = new Int32Array(m * 2 + 16); SD.q = new Float64Array(4 * (m * 2 + 16)); SD.o = new Float64Array(12 * (m * 2 + 16)); SD.go = new Float64Array(12 * (m * 2 + 16)); }
    SD.key = key; SITES.n = SD.at.length;
  }
  // flat copies for the force loop: per site atom 1 + ns charges (the atom's own first, at offset 0) and their offsets
  const N = SD.n, Qs = SD.q, Os = SD.o;
  for (let k = 0; k < SD.at.length; k++) {
    const d = SD.dat[k], ns = siteGeom(SD.at[k], d); N[k] = ns + 1; Qs[4 * k] = d.aq; Os[12 * k] = Os[12 * k + 1] = Os[12 * k + 2] = 0;
    for (let m = 0; m < ns; m++) { Qs[4 * k + 1 + m] = d.sq[m]; Os[12 * k + 3 + 3 * m] = d.o[3 * m]; Os[12 * k + 4 + 3 * m] = d.o[3 * m + 1]; Os[12 * k + 5 + 3 * m] = d.o[3 * m + 2]; }
  }
  SD.go.fill(0, 0, 12 * SD.at.length);
}
const _gq = new Float64Array(9);
function sitesForces(FX, FY, FZ) {
  sitesPrep();
  const nat = SD.at.length; if (!nat && !SITES.rings) return;
  const pi = VL.pi, pj = VL.pj, ex = VL.ex, np = VL.np, X = S.x, Y = S.y, Zp = S.z, NE = S.ne, Z = S.Z, K = S.k, ANTI = S.anti, idx = SD.idx, Q = S.q, QP = S.qp, IONIC = S.ionic, RG = SD.rg, OBJ = S.obj;
  const N = SD.n, Qs = SD.q, Os = SD.o, GO = SD.go, soft = SITES.soft, r1 = RC - SW_W;
  const d3 = W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  let npairs = 0;
  for (let q = 0; q < np; q++) {
    const i = pi[q], j = pj[q], ki = idx[i], kj = idx[j], ring = RG[i] === 1 && RG[j] === 1;
    if (ki < 0 && kj < 0 && !ring) continue;
    if (ex[q] !== 0 || K[i] !== NUC || K[j] !== NUC || Z[i] === 0 || Z[j] === 0 || NE[i] === 0 || NE[j] === 0 || ANTI[i] !== ANTI[j]) continue;
    let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= RC2) continue;
    npairs++;
    if (ring) { const r = Math.sqrt(r2); piLJ(OBJ[i], OBJ[j], r); const f = _pl[1] / r; FX[i] += f * dx; FY[i] += f * dy; FX[j] -= f * dx; FY[j] -= f * dy; if (d3) { FZ[i] += f * dz; FZ[j] -= f * dz; } if (ki < 0 && kj < 0) continue; }
    const qa = Q[i] + QP[i], qb = Q[j] + QP[j], k = K_COUL * ((IONIC[i] !== IONIC[j] && (IONIC[i] === 1 ? Q[j] === 0 : Q[i] === 0)) ? K_IW : 1);
    const r = Math.sqrt(r2); let sw = 1, dsw = 0;
    if (r > r1) { const x = (r - r1) / SW_W; sw = 1 - x * x * x * (10 - 15 * x + 6 * x * x); dsw = -30 * x * x * (1 - x) * (1 - x) / SW_W; }
    const ks = k * sw, s0 = r2 + SOFT_S, g0 = 1 / Math.sqrt(s0);
    let E = -qa * qb * g0, fax = 0, fay = 0, faz = 0; // (fa: −∂E/∂r_a for the pair's atom-position terms; r_b gets the opposite)
    { const f = qa * qb * g0 / s0 * ks; fax += f * dx; fay += f * dy; faz += f * dz; }
    const na = ki >= 0 ? N[ki] : 1, nb = kj >= 0 ? N[kj] : 1, ba = 4 * ki, bb = 4 * kj, oa = 12 * ki, ob = 12 * kj;
    for (let m = 0; m < na; m++) {
      const Qa = ki >= 0 ? Qs[ba + m] : qa; if (Qa === 0) continue;
      const oax = m ? Os[oa + 3 * m] : 0, oay = m ? Os[oa + 3 * m + 1] : 0, oaz = m ? Os[oa + 3 * m + 2] : 0;
      for (let l = 0; l < nb; l++) {
        const Qb = kj >= 0 ? Qs[bb + l] : qb; if (Qb === 0) continue;
        const ex_ = dx + (l ? Os[ob + 3 * l] : 0) - oax, ey = dy + (l ? Os[ob + 3 * l + 1] : 0) - oay, ez = dz + (l ? Os[ob + 3 * l + 2] : 0) - oaz;
        const s = ex_ * ex_ + ey * ey + ez * ez + (m === 0 && l === 0 ? SOFT_S : soft), g = 1 / Math.sqrt(s), qq = Qa * Qb;
        E += qq * g;
        const f = qq * g / s * ks, fx = f * ex_, fy = f * ey, fz = f * ez; // (∂(QQ·g)/∂r_b = −QQ·g³·e)
        fax -= fx; fay -= fy; faz -= fz;
        if (l) { GO[ob + 3 * l] -= fx; GO[ob + 3 * l + 1] -= fy; GO[ob + 3 * l + 2] -= fz; }
        if (m) { GO[oa + 3 * m] += fx; GO[oa + 3 * m + 1] += fy; GO[oa + 3 * m + 2] += fz; }
      }
    }
    if (dsw) { const f = k * E * dsw / r; fax += f * dx; fay += f * dy; faz += f * dz; }
    FX[i] += fax; FY[i] += fay; FX[j] -= fax; FY[j] -= fay;
    if (d3) { FZ[i] += faz; FZ[j] -= faz; }
  }
  for (let k = 0; k < nat; k++) {
    const b = 12 * k; let any = false; for (let m = 0; m < 9; m++) { _gq[m] = GO[b + 3 + m]; if (_gq[m]) any = true; }
    if (any) siteBack(SD.at[k], SD.dat[k].kind, _gq, FX, FY, d3 ? FZ : null);
  }
  SITES.pairs = npairs;
}
/* The correction between two atoms as the energy books see it (pairPE, sitesLocal, sitesTotal): live sites. */
const _sga = { ns: 0, o: new Float64Array(9), sq: new Float64Array(3), w: new Float64Array(3), b: new Float64Array(3), aq: 0, aw: 1, ab: 0, kind: 0 };
const _sgb = { ns: 0, o: new Float64Array(9), sq: new Float64Array(3), w: new Float64Array(3), b: new Float64Array(3), aq: 0, aw: 1, ab: 0, kind: 0 };
function sitesPairOK(a, b) {
  return a !== b && a.k === NUC && b.k === NUC && a.Z > 0 && b.Z > 0 && a.ne > 0 && b.ne > 0 && !a.dead && !b.dead && !a.fast && !b.fast && !a.rad && !b.rad &&
    !a.anti === !b.anti && !(a.mol !== 0 && a.mol === b.mol) && !(a.bom && b.bom);
}
function ringType(p) { // 1: an aromatic carbon (three bonds), 2: a hydrogen on one; 0 otherwise (π-stacking's dispersion)
  if (!SITES.pi || !W.d3 || p.k !== NUC || p.ne === 0 || p.bom) return 0;
  if (p.Z === 6) { if (p.bonds.length !== 3) return 0; for (const bd of p.bonds) if (bd.arom) return 1; return 0; }
  if (p.Z === 1 && p.bonds.length === 1) { const c = other(p.bonds[0], p); return ringType(c) === 1 ? 2 : 0; }
  return 0;
}
/* The ring pair's dispersion difference at r (eV) and its slope (eV/Å), into _pl. */
const _pl = [0, 0];
function piLJ(a, b, r) {
  const pa = PIJ[a.Z], pb = PIJ[b.Z], rm = Math.sqrt(pa[0] * pb[0]), eps = Math.sqrt(pa[1] * pb[1]);
  const [rmo, epo] = ljPair(a, b), c = 0.62 * rmo, x = r < c ? c : r;
  const r1 = RC - SW_W; let sw = 1, dsw = 0;
  if (x > r1) { const t = (x - r1) / SW_W; sw = 1 - t * t * t * (10 - 15 * t + 6 * t * t); dsw = -30 * t * t * (1 - t) * (1 - t) / SW_W; }
  const s6 = Math.pow(rm / x, 6), En = eps * (s6 * s6 - 2 * s6), dEn = -12 * eps * (s6 * s6 - s6) / x;
  const o6 = Math.pow(rmo / x, 6), Eo = epo > 0 && x <= 2.6 * rmo ? epo * (o6 * o6 - 2 * o6 + LJ_VCUT) : 0, dEo = epo > 0 && x <= 2.6 * rmo ? -12 * epo * (o6 * o6 - o6) / x : 0;
  const E = (En - Eo) * sw, dE = (dEn - dEo) * sw + (En - Eo) * dsw;
  _pl[0] = r < c ? E + dE * (r - c) : E; _pl[1] = dE;
  return _pl[0];
}
function sitesPairE(a, b) {
  if (!SITES.any || !sitesPairOK(a, b)) return 0;
  const na = siteGeom(a, _sga), nb = siteGeom(b, _sgb), rg = SITES.pi && ringType(a) && ringType(b);
  if (!na && !nb && !rg) return 0;
  const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z), d2 = dx * dx + dy * dy + (W.d3 ? dz * dz : 0);
  if (d2 >= RC2) return 0;
  return (na || nb ? sitePairE(a, b, _sga, _sgb, dx, dy, W.d3 ? dz : 0, false, null, null, null, null, false) : 0) + (rg ? piLJ(a, b, Math.sqrt(d2)) : 0);
}
function sitesLocal(set, skip) {
  let V = 0;
  for (const p of set) {
    if (p.k !== NUC || p.Z === 0 || p.ne === 0 || p.fast || p.rad || p.dead) continue;
    const visit = (o) => {
      if (o === p || o === skip || (set.has(o) && o.id < p.id)) return;
      V += sitesPairE(p, o);
    };
    nearby(p.x, p.y, RC, visit, p.z);
    for (const o of _late) if (!o.dead) { const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, o.z - p.z); if (dx * dx + dy * dy + dz * dz < RC2) visit(o); }
  }
  return V;
}
function sitesTotal() {
  const md = W.parts.filter(p => p.k === NUC && p.Z > 0 && p.ne > 0 && !p.dead && !p.fast && !p.rad);
  const g = md.map(p => { const o = { ns: 0, o: new Float64Array(9), sq: new Float64Array(3), w: new Float64Array(3), b: new Float64Array(3), aq: 0, aw: 1, ab: 0, kind: 0 }; siteGeom(p, o); return o; });
  const rg = md.map(p => ringType(p));
  let V = 0;
  for (let i = 0; i < md.length; i++) {
    const a = md[i], ga = g[i];
    for (let j = i + 1; j < md.length; j++) {
      const b = md[j], gb = g[j], ring = rg[i] && rg[j]; if (!ga.ns && !gb.ns && !ring) continue;
      if (!sitesPairOK(a, b)) continue;
      const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z), d2 = dx * dx + dy * dy + (W.d3 ? dz * dz : 0);
      if (d2 >= RC2) continue;
      if (ga.ns || gb.ns) V += sitePairE(a, b, ga, gb, dx, dy, W.d3 ? dz : 0, false, null, null, null, null, false);
      if (ring) V += piLJ(a, b, Math.sqrt(d2));
    }
  }
  return V;
}
/* The induced charges (qeqUpdate): ∂E/∂qa at the marked atoms, from the neighbour list's pairs, and the whole correction
   (to measure its change when the charges change). */
function sitesQeq(mark, phi) {
  sitesPrep();
  const pi = VL.pi, pj = VL.pj, ex = VL.ex, np = VL.np, OBJ = S.obj, idx = SD.idx;
  let V = 0;
  for (let q = 0; q < np; q++) {
    const i = pi[q], j = pj[q], ki = idx[i], kj = idx[j];
    if ((ki < 0 && kj < 0) || ex[q] !== 0) continue;
    const a = OBJ[i], b = OBJ[j]; if (!sitesPairOK(a, b)) continue;
    const sa = ki >= 0 ? SD.dat[ki] : _nos, sb = kj >= 0 ? SD.dat[kj] : _nos;
    const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z);
    V += sitePairE(a, b, sa, sb, dx, dy, W.d3 ? dz : 0, false, null, null, null, null, !!phi);
    if (phi) { if (mark[i]) phi[i] += _pdq[0]; if (mark[j]) phi[j] += _pdq[1]; }
  }
  return V;
}
function sitesQeqE() { SD.key = ''; return sitesQeq(null, null); } // (after the charges changed: the sites' charges again)
