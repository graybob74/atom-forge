//! The 3-D force kernels (engine.js pairKernel3, bondKernel3, angleKernel3 / angle3CentreK / triple3K, inside the PAIR
//! KERNEL markers): the same physics as the flat kernels with distances and forces in three directions, the same
//! arithmetic in the same order as the JavaScript. The pair and bond kernels agree with it to the bit (exp and pow as
//! in the flat kernels); the angle terms take atan2 (fastmath, as the flat angle kernel) and sin/cos from the standard
//! library, so they agree to rounding.
//!
//! The descriptor is the flat one (`D_*`, entries 0–39, unchanged) with six more entries (`D3_*`, 40–45): the z
//! positions and velocities, and the per-centre targets and dihedral list of engine.js's AC3.
use super::*;

pub const D3_PZ: usize = 40; // S.z (positions; D_Z is the atomic number)
pub const D3_VZ: usize = 41; // S.vz
pub const D3_AMODE: usize = 42; // AC3.mode (u8)
pub const D3_AT0: usize = 43; // AC3.t0 (f64)
pub const D3_AFLAT: usize = 44; // AC3.flat (u8)
pub const D3_TQ: usize = 45; // AC3.tq (i32, four slots per dihedral)
pub const D3_LEN: usize = 46;

pub const K_OOP: f64 = 2.0;
pub const K_TOR: f64 = 1.2;
pub const K3_DIV: [f64; 7] = [1.0, 1.0, 1.0, 2.0, 1.5, 2.0, 2.0];

#[derive(Clone, Copy)]
pub struct St3 { pub pz: *const f64, pub vz: *const f64, pub amode: *const u8, pub at0: *const f64, pub aflat: *const u8, pub tq: *const i32 }

pub unsafe fn store3(base: usize, desc: *const i32) -> St3 {
    St3 { pz: at(base, desc, D3_PZ), vz: at(base, desc, D3_VZ), amode: at(base, desc, D3_AMODE), at0: at(base, desc, D3_AT0), aflat: at(base, desc, D3_AFLAT), tq: at(base, desc, D3_TQ) }
}

/// The periodic box in three directions (wrap, the sides and their halves).
#[derive(Clone, Copy)]
pub struct Box3 { pub wrap: bool, pub bw: f64, pub bh: f64, pub bd: f64, pub hw: f64, pub hh: f64, pub hd: f64 }

#[inline(always)]
fn min_image3(dx: &mut f64, dy: &mut f64, dz: &mut f64, b: &Box3) {
    if b.wrap {
        if *dx > b.hw { *dx -= b.bw; } else if *dx < -b.hw { *dx += b.bw; }
        if *dy > b.hh { *dy -= b.bh; } else if *dy < -b.hh { *dy += b.bh; }
        if *dz > b.hd { *dz -= b.bd; } else if *dz < -b.hd { *dz += b.bd; }
    }
}

/// pair_kernel with z (engine.js pairKernel3).
pub unsafe fn pair_kernel3(c: &mut Ctx, s: &St, s3: &St3, q0: usize, q1: usize, fxo: *mut f64, fyo: *mut f64, fzo: *mut f64, cq: *mut i32, nc0: usize,
    b: &Box3, step: i64) -> usize {
    let mut nc = nc0;
    for q in q0..q1 {
        if rd(s.ex, q) == 1 { continue; }
        let i = rd(s.pi, q) as usize; let j = rd(s.pj, q) as usize;
        let mut dx = rd(s.x, j) - rd(s.x, i); let mut dy = rd(s.y, j) - rd(s.y, i); let mut dz = rd(s3.pz, j) - rd(s3.pz, i);
        min_image3(&mut dx, &mut dy, &mut dz, b);
        let r2 = dx * dx + dy * dy + dz * dz;
        if !(r2 < RC2 && r2 > 1e-10) { continue; }
        let zi = rd(s.z, i); let zj = rd(s.z, j);
        if zi == 0 || zj == 0 { continue; } // neutrons fly straight
        let r = r2.sqrt(); let ni = rd(s.ne, i); let nj = rd(s.ne, j);
        let mut f = 0.0;
        if rd(s.anti, i) != rd(s.anti, j) { f = anti_pair_i(c, s, i, j, r, cq, &mut nc); }
        else if ni > 0 && nj > 0 { // two atoms or ions (atomAtom)
            let qi = rd(s.q, i); let qj = rd(s.q, j); let qa = qi + rd(s.qp, i); let qb = qj + rd(s.qp, j);
            if qa != 0.0 && qb != 0.0 { let s2 = r * r + 0.09; f += K_COUL * qa * qb * r / (s2 * s2.sqrt()); } // (no K_IW in 3-D: an ion has its real shell of six waters there, engine.js iwK, 1.27 bug 1)
            if rd(s.ismetal, i) == 1 && rd(s.ismetal, j) == 1 { f += metal_fi(c, s, i, j, r); }
            else {
                f += lj_fi(c, s, i, j, r, qa, qb);
                let fa = rd(s.cap, i) as i32 - rd(s.used, i) as i32; let fb = rd(s.cap, j) as i32 - rd(s.used, j) as i32;
                if fa > 0 && fb > 0 { if r < 3.6 { cand(cq, &mut nc, CAND_BOND, i as i32, j as i32); } }
                else if (fa > 0) != (fb > 0) && r < 3.6 {
                    let (a, bb) = if fa > 0 { (i, j) } else { (j, i) };
                    cand(cq, &mut nc, CAND_REACT, a as i32, bb as i32);
                }
            }
            if ((rd(s.xferd, i) == 1 && rd(s.xfera, j) == 1) || (rd(s.xferd, j) == 1 && rd(s.xfera, i) == 1)) && (qi <= 0.0 || qj <= 0.0) && r < 5.5
                && (step + rd(s.id, i) as i64 + rd(s.id, j) as i64) % 8 == 0 { cand(cq, &mut nc, CAND_XFER, i as i32, j as i32); }
            let contact = 0.42 * (rd(s.ljr, i) + rd(s.ljr, j));
            if r < contact {
                let dvx = rd(s.vx, j) - rd(s.vx, i); let dvy = rd(s.vy, j) - rd(s.vy, i); let dvz = rd(s3.vz, j) - rd(s3.vz, i);
                let v2 = dvx * dvx + dvy * dvy + dvz * dvz;
                let mi = rd(s.m, i); let mj = rd(s.m, j);
                let mu = mi * mj / (mi + mj);
                if 0.5 * mu * v2 > 1.4 { cand(cq, &mut nc, CAND_HOT, i as i32, j as i32); }
            }
        } else { // a bare nucleus meeting an atom, ion or another bare nucleus (bareInteract)
            let (bare, o) = if ni == 0 { (i, j) } else { (j, i) };
            let qa = rd(s.q, i) + rd(s.qp, i); let qb = rd(s.q, j) + rd(s.qp, j);
            if qa != 0.0 && qb != 0.0 {
                if ni == 0 && nj == 0 {
                    let soft = 0.0016; let s2 = r * r + soft; f += K_COUL * qa * qb * r / (s2 * s2.sqrt());
                    if r < 3.0 && qa * qb < 0.0 { kstiff(c, s, K_COUL * (qa * qb).abs() * ((soft - 2.0 * r * r).abs() + s2) / (s2 * s2 * s2.sqrt()), i, j); }
                } else {
                    f += K_COUL * qa * qb * (if r >= BARE_SMEAR { 1.0 / (r * r) } else { r / (BARE_SMEAR * BARE_SMEAR * BARE_SMEAR) });
                    if r < 3.0 && qa * qb < 0.0 { kstiff(c, s, K_COUL * (qa * qb).abs() * (if r >= BARE_SMEAR { 2.0 / (r * r * r) } else { 1.0 / (BARE_SMEAR * BARE_SMEAR * BARE_SMEAR) }), i, j); }
                }
            }
            if rd(s.ne, o) > 0 {
                let rc = rd(s.elrc, o); let rw = 0.55 * rc + 0.25;
                if r < rw { f += 8.0 * (rw - r) / rw + core_fi(c, s, i, j, r, rw); }
                if r < rc + 0.5 {
                    if rd(s.z, bare) == 1 && rd(s.lp, o) > 0 && rd(s.metal, o) == 0 { cand(cq, &mut nc, CAND_DATIVE, bare as i32, o as i32); }
                    else if (step + rd(s.id, i) as i64 + rd(s.id, j) as i64) % 3 == 0 { cand(cq, &mut nc, CAND_XFERB, o as i32, bare as i32); }
                }
            }
        }
        if f > FCAP { f = FCAP; } else if f < -FCAP { f = -FCAP; }
        let fx = f * dx / r; let fy = f * dy / r; let fz = f * dz / r;
        add(fxo, j, fx); add(fyo, j, fy); add(fzo, j, fz); add(fxo, i, -fx); add(fyo, i, -fy); add(fzo, i, -fz);
    }
    nc
}

/// The bonds b0 ≤ k < b1 (Morse) in 3-D (engine.js bondKernel3).
pub unsafe fn bond_kernel3(s: &St, s3: &St3, b0: usize, b1: usize, fxo: *mut f64, fyo: *mut f64, fzo: *mut f64, cq: *mut i32, nc0: usize, b: &Box3) -> usize {
    let mut nc = nc0;
    for k in b0..b1 {
        let i = rd(s.ba, k) as usize; let j = rd(s.bb, k) as usize;
        let mut dx = rd(s.x, j) - rd(s.x, i); let mut dy = rd(s.y, j) - rd(s.y, i); let mut dz = rd(s3.pz, j) - rd(s3.pz, i);
        min_image3(&mut dx, &mut dy, &mut dz, b);
        let mut r = (dx * dx + dy * dy + dz * dz).sqrt(); if r == 0.0 { r = 1e-6; } // (JS: || 1e-6)
        let d = r - rd(s.br0, k); let al = rd(s.bal, k);
        let e = (-al * (if d < -0.6 { -0.6 } else { d })).exp();
        let mut f = -2.0 * rd(s.bd, k) * al * (1.0 - e) * e;
        if f > FCAP { f = FCAP; } else if f < -FCAP { f = -FCAP; }
        let fx = f * dx / r; let fy = f * dy / r; let fz = f * dz / r;
        add(fxo, j, fx); add(fyo, j, fy); add(fzo, j, fz); add(fxo, i, -fx); add(fyo, i, -fy); add(fzo, i, -fz);
        if d > rd(s.brb, k) { cand(cq, &mut nc, CAND_BREAK, k as i32, 0); }
    }
    nc
}

/// The vector from slot i to slot j, minimum image (engine.js kvec3: the comparisons against bw / 2, as it has them).
#[inline(always)]
unsafe fn vec3(s: &St, s3: &St3, b: &Box3, i: usize, j: usize) -> (f64, f64, f64) {
    let mut dx = rd(s.x, j) - rd(s.x, i); let mut dy = rd(s.y, j) - rd(s.y, i); let mut dz = rd(s3.pz, j) - rd(s3.pz, i);
    if b.wrap {
        let bw = b.bw; let bh = b.bh; let bd = b.bd;
        if dx > bw / 2.0 { dx -= bw; } else if dx < -bw / 2.0 { dx += bw; }
        if dy > bh / 2.0 { dy -= bh; } else if dy < -bh / 2.0 { dy += bh; }
        if dz > bd / 2.0 { dz -= bd; } else if dz < -bd / 2.0 { dz += bd; }
    }
    (dx, dy, dz)
}

/// vec3 on bare position arrays (1.26: the single bonds' twist and the bond orders' 3-D pass): the same arithmetic.
#[inline(always)]
pub(crate) unsafe fn vec3p(px: *const f64, py: *const f64, pz: *const f64, b: &Box3, i: usize, j: usize) -> (f64, f64, f64) {
    let mut dx = rd(px, j) - rd(px, i); let mut dy = rd(py, j) - rd(py, i); let mut dz = rd(pz, j) - rd(pz, i);
    if b.wrap {
        let bw = b.bw; let bh = b.bh; let bd = b.bd;
        if dx > bw / 2.0 { dx -= bw; } else if dx < -bw / 2.0 { dx += bw; }
        if dy > bh / 2.0 { dy -= bh; } else if dy < -bh / 2.0 { dy += bh; }
        if dz > bd / 2.0 { dz -= bd; } else if dz < -bd / 2.0 { dz += bd; }
    }
    (dx, dy, dz)
}

/// sin and cos of a target angle, worked out once per call (the JavaScript takes them per pair: the same values).
#[derive(Clone, Copy)]
pub(crate) struct Tg { t: f64, st: f64, ct: f64 }
impl Tg { pub(crate) fn new(t: f64) -> Tg { Tg { t, st: t.sin(), ct: t.cos() } } }

/// One pair's term at angle th (cos th = c) for the target (engine.js pairAngE): (energy, g), g the factor of the forces.
#[inline(always)]
pub(crate) fn pair_ang(k: f64, th: f64, c: f64, tg: &Tg) -> (f64, f64) {
    if tg.t > 3.14159 {
        let d = th - PI; let s = th.sin();
        let g = if s > 1e-9 { 2.0 * k * d / s } else { -2.0 * k };
        return (k * d * d, g);
    }
    let kc = k / (tg.st * tg.st); let dc = c - tg.ct;
    (kc * dc * dc, -2.0 * kc * dc)
}
pub(crate) const PI: f64 = core::f64::consts::PI;

/// engine.js transPair: bonds 0 and m trans, the other two trans.
#[inline(always)]
pub(crate) fn trans_pair(k: usize, l: usize, m: usize) -> bool { (k == 0 && l == m) || (k != 0 && l != m && k != m) }

/// E = Kt·(û₁·û₂×û₃)² over b_m = x[e[2m+1]] − x[e[2m]]: the forces (engine.js triple3K).
#[inline(always)]
unsafe fn triple3(s: &St, s3: &St3, bx: &Box3, ends: [usize; 6], kt: f64, fx: *mut f64, fy: *mut f64, fz: *mut f64) {
    let mut b = [0.0f64; 9]; let mut l3 = [0.0f64; 3];
    for m in 0..3 {
        let (vx, vy, vz) = vec3(s, s3, bx, ends[2 * m], ends[2 * m + 1]);
        let mut l = (vx * vx + vy * vy + vz * vz).sqrt(); if l == 0.0 { l = 1e-9; }
        b[3 * m] = vx / l; b[3 * m + 1] = vy / l; b[3 * m + 2] = vz / l; l3[m] = l;
    }
    let g1x = b[4] * b[8] - b[5] * b[7]; let g1y = b[5] * b[6] - b[3] * b[8]; let g1z = b[3] * b[7] - b[4] * b[6];
    let t = b[0] * g1x + b[1] * g1y + b[2] * g1z;
    let g2x = b[7] * b[2] - b[8] * b[1]; let g2y = b[8] * b[0] - b[6] * b[2]; let g2z = b[6] * b[1] - b[7] * b[0];
    let g3x = b[1] * b[5] - b[2] * b[4]; let g3y = b[2] * b[3] - b[0] * b[5]; let g3z = b[0] * b[4] - b[1] * b[3];
    let gx = [g1x, g2x, g3x]; let gy = [g1y, g2y, g3y]; let gz = [g1z, g2z, g3z]; let w = 2.0 * kt * t;
    for m in 0..3 {
        let a = w / l3[m];
        let ggx = a * (gx[m] - t * b[3 * m]); let ggy = a * (gy[m] - t * b[3 * m + 1]); let ggz = a * (gz[m] - t * b[3 * m + 2]);
        let n0 = ends[2 * m]; let n1 = ends[2 * m + 1];
        add(fx, n1, -ggx); add(fy, n1, -ggy); add(fz, n1, -ggz); add(fx, n0, ggx); add(fy, n0, ggy); add(fz, n0, ggz);
    }
}

/// The angle terms of centres c0 ≤ c < c1 and the dihedrals t0 ≤ t < t1 (engine.js angleKernel3 / angle3CentreK).
pub unsafe fn angle_kernel3(s: &St, s3: &St3, c0: usize, c1: usize, t0: usize, t1: usize, fx: *mut f64, fy: *mut f64, fz: *mut f64, bx: &Box3) {
    let a90 = Tg::new(PI / 2.0); let a120 = Tg::new(2.0 * PI / 3.0); let a180 = Tg { t: PI, st: 0.0, ct: 0.0 };
    let mut ux = [0.0f64; 6]; let mut uy = [0.0f64; 6]; let mut uz = [0.0f64; 6]; let mut rr = [0.0f64; 6]; let mut nb = [0usize; 6];
    let mut pc_ = [0.0f64; 15]; let mut pt = [0.0f64; 15]; let mut pe = [0.0f64; 45]; let mut tg = [0u8; 15];
    for c in c0..c1 {
        let pc = rd(s.acc, c) as usize; let n = rd(s.accnt, c) as usize; let b0 = c * 6;
        let mode = rd(s3.amode, c); let tz = Tg::new(rd(s3.at0, c)); let flat = rd(s3.aflat, c);
        let k = ANGLE_K / K3_DIV[n];
        for kk in 0..n {
            let o = rd(s.acnb, b0 + kk) as usize; nb[kk] = o;
            let (vx, vy, vz) = vec3(s, s3, bx, pc, o);
            let mut r = (vx * vx + vy * vy + vz * vz).sqrt(); if r == 0.0 { r = 1e-9; }
            ux[kk] = vx / r; uy[kk] = vy / r; uz[kk] = vz / r; rr[kk] = r;
        }
        // every pair's cos θ and θ
        let mut np = 0usize;
        for kk in 0..n { for l in kk + 1..n {
            let cc = ux[kk] * ux[l] + uy[kk] * uy[l] + uz[kk] * uz[l];
            let cx = uy[kk] * uz[l] - uz[kk] * uy[l]; let cy = uz[kk] * ux[l] - ux[kk] * uz[l]; let cz = ux[kk] * uy[l] - uy[kk] * ux[l];
            pc_[np] = cc; pt[np] = fastmath::atan2((cx * cx + cy * cy + cz * cz).sqrt(), cc); np += 1;
        } }
        // each pair's target: 0 → t0, 1 → 90°, 2 → 120°, 3 → 180°
        if mode == 0 { for q in 0..np { tg[q] = 0; } }
        else if mode == 2 { for q in 0..np { tg[q] = if pair_ang(k, pt[q], pc_[q], &a180).0 <= pair_ang(k, pt[q], pc_[q], &a90).0 { 3 } else { 1 }; } }
        else {
            for q in 0..np { pe[3 * q] = pair_ang(k, pt[q], pc_[q], &a90).0; pe[3 * q + 1] = pair_ang(k, pt[q], pc_[q], &a120).0; pe[3 * q + 2] = pair_ang(k, pt[q], pc_[q], &a180).0; }
            let mut best = f64::INFINITY; let mut bk = 0usize; let mut bl = 0usize;
            if mode == 3 {
                for a in 0..n { for b2 in a + 1..n {
                    let mut e = 0.0; let mut q = 0usize;
                    for kk in 0..n { for l in kk + 1..n {
                        let ax = (if kk == a || kk == b2 { 1 } else { 0 }) + (if l == a || l == b2 { 1 } else { 0 });
                        e += pe[3 * q + (if ax == 2 { 2 } else if ax == 1 { 0 } else { 1 })]; q += 1;
                    } }
                    if e < best { best = e; bk = a; bl = b2; }
                } }
                let mut q = 0usize;
                for kk in 0..n { for l in kk + 1..n {
                    let ax = (if kk == bk || kk == bl { 1 } else { 0 }) + (if l == bk || l == bl { 1 } else { 0 });
                    tg[q] = if ax == 2 { 3 } else if ax == 1 { 1 } else { 2 }; q += 1;
                } }
            } else { // (n = 4) partner of bond 0: 1, 2 or 3
                for m in 1..4 {
                    let mut e = 0.0; let mut q = 0usize;
                    for kk in 0..4 { for l in kk + 1..4 { e += pe[3 * q + (if trans_pair(kk, l, m) { 2 } else { 0 })]; q += 1; } }
                    if e < best { best = e; bk = m; }
                }
                let mut q = 0usize;
                for kk in 0..4 { for l in kk + 1..4 { tg[q] = if trans_pair(kk, l, bk) { 3 } else { 1 }; q += 1; } }
            }
        }
        let mut cfx = 0.0; let mut cfy = 0.0; let mut cfz = 0.0; let mut q = 0usize;
        for kk in 0..n { for l in kk + 1..n {
            let cc = pc_[q]; let t = tg[q];
            let g = pair_ang(k, pt[q], cc, if t == 0 { &tz } else if t == 1 { &a90 } else if t == 2 { &a120 } else { &a180 }).1;
            if g != 0.0 {
                let ak = g / rr[kk]; let al = g / rr[l];
                let fkx = ak * (ux[l] - cc * ux[kk]); let fky = ak * (uy[l] - cc * uy[kk]); let fkz = ak * (uz[l] - cc * uz[kk]);
                let flx = al * (ux[kk] - cc * ux[l]); let fly = al * (uy[kk] - cc * uy[l]); let flz = al * (uz[kk] - cc * uz[l]);
                let ok = nb[kk]; let ol = nb[l];
                add(fx, ok, fkx); add(fy, ok, fky); add(fz, ok, fkz); add(fx, ol, flx); add(fy, ol, fly); add(fz, ol, flz);
                cfx += fkx + flx; cfy += fky + fly; cfz += fkz + flz;
            }
            q += 1;
        } }
        add(fx, pc, -cfx); add(fy, pc, -cfy); add(fz, pc, -cfz);
        if flat != 0 && n == 3 { triple3(s, s3, bx, [pc, nb[0], pc, nb[1], pc, nb[2]], K_OOP, fx, fy, fz); }
    }
    for t in t0..t1 {
        let xx = rd(s3.tq, 4 * t) as usize; let a = rd(s3.tq, 4 * t + 1) as usize; let bb = rd(s3.tq, 4 * t + 2) as usize; let y = rd(s3.tq, 4 * t + 3) as usize;
        triple3(s, s3, bx, [xx, a, a, bb, bb, y], K_TOR, fx, fy, fz);
    }
}

/// One single-bond dihedral's twist (engine.js tors1K, 1.25; here 1.26): E = F·Σkₙ cos nφ as a polynomial in u·v and
/// |u|²|v|² (u = b̂₁×b̂₂, v = b̂₂×b̂₃), over f0 = sin⁶(109.47°) (the JavaScript's Math.pow(8/9, 3), passed in). Returns E;
/// adds the forces when fx is not null. The same arithmetic in the same order: no transcendental functions, so the
/// two agree to the bit.
pub unsafe fn tors1(px: *const f64, py: *const f64, pz: *const f64, bx: &Box3, x: usize, a: usize, b: usize, y: usize, k: [f64; 4], f0: f64, fx: *mut f64, fy: *mut f64, fz: *mut f64) -> f64 {
    let ends = [x, a, a, b, b, y]; let mut e = [0.0f64; 9]; let mut l3 = [0.0f64; 3];
    for m in 0..3 {
        let (vx, vy, vz) = vec3p(px, py, pz, bx, ends[2 * m], ends[2 * m + 1]);
        let mut l = (vx * vx + vy * vy + vz * vz).sqrt(); if l == 0.0 || l.is_nan() { l = 1e-9; } // (JS: || 1e-9)
        e[3 * m] = vx / l; e[3 * m + 1] = vy / l; e[3 * m + 2] = vz / l; l3[m] = l;
    }
    let (k0, k1, k2, k3) = (k[0], k[1], k[2], k[3]);
    let ux = e[1] * e[5] - e[2] * e[4]; let uy = e[2] * e[3] - e[0] * e[5]; let uz = e[0] * e[4] - e[1] * e[3];
    let vx = e[4] * e[8] - e[5] * e[7]; let vy = e[5] * e[6] - e[3] * e[8]; let vz = e[3] * e[7] - e[4] * e[6];
    let uu = ux * ux + uy * uy + uz * uz; let vv = vx * vx + vy * vy + vz * vz; let p = uu * vv; let rr = p.sqrt(); let c = ux * vx + uy * vy + uz * vz;
    let en = (k0 * p * rr + k1 * c * p + k2 * (2.0 * c * c - p) * rr + k3 * (4.0 * c * c * c - 3.0 * c * p)) / f0;
    if fx.is_null() { return en; }
    let dc = (k1 * p + 4.0 * k2 * c * rr + k3 * (12.0 * c * c - 3.0 * p)) / f0;
    let dp = if rr > 1e-12 { (1.5 * k0 * rr + k1 * c + k2 * (-rr + (2.0 * c * c - p) / (2.0 * rr)) - 3.0 * k3 * c) / f0 } else { 0.0 };
    let gux = dc * vx + dp * 2.0 * ux * vv; let guy = dc * vy + dp * 2.0 * uy * vv; let guz = dc * vz + dp * 2.0 * uz * vv;
    let gvx = dc * ux + dp * 2.0 * vx * uu; let gvy = dc * uy + dp * 2.0 * vy * uu; let gvz = dc * uz + dp * 2.0 * vz * uu;
    let g = [e[4] * guz - e[5] * guy, e[5] * gux - e[3] * guz, e[3] * guy - e[4] * gux,
        guy * e[2] - guz * e[1] + e[7] * gvz - e[8] * gvy, guz * e[0] - gux * e[2] + e[8] * gvx - e[6] * gvz, gux * e[1] - guy * e[0] + e[6] * gvy - e[7] * gvx,
        gvy * e[5] - gvz * e[4], gvz * e[3] - gvx * e[5], gvx * e[4] - gvy * e[3]];
    for m in 0..3 {
        let gx = g[3 * m]; let gy = g[3 * m + 1]; let gz = g[3 * m + 2]; let d = gx * e[3 * m] + gy * e[3 * m + 1] + gz * e[3 * m + 2]; let il = 1.0 / l3[m];
        let ggx = (gx - d * e[3 * m]) * il; let ggy = (gy - d * e[3 * m + 1]) * il; let ggz = (gz - d * e[3 * m + 2]) * il;
        let n0 = ends[2 * m]; let n1 = ends[2 * m + 1];
        add(fx, n1, -ggx); add(fy, n1, -ggy); add(fz, n1, -ggz); add(fx, n0, ggx); add(fy, n0, ggy); add(fz, n0, ggz);
    }
    en
}
/// The single-bond dihedrals t0 ≤ t < t1 of AC3.sq (four slots each) with their k's in AC3.sk (engine.js tors1Forces3).
pub unsafe fn tors1_range(s: &St, s3: &St3, bx: &Box3, sq: *const i32, sk: *const f64, t0: usize, t1: usize, f0: f64, fx: *mut f64, fy: *mut f64, fz: *mut f64) {
    for t in t0..t1 {
        let o = 4 * t;
        tors1(s.x, s.y, s3.pz, bx, rd(sq, o) as usize, rd(sq, o + 1) as usize, rd(sq, o + 2) as usize, rd(sq, o + 3) as usize,
            [rd(sk, o), rd(sk, o + 1), rd(sk, o + 2), rd(sk, o + 3)], f0, fx, fy, fz);
    }
}
#[no_mangle]
pub unsafe extern "C" fn af_tors1(desc: u32, sq: u32, sk: u32, t0: u32, t1: u32, fx: u32, fy: u32, fz: u32, wrap: u32, bw: f64, bh: f64, bd: f64, f0: f64) {
    let s = store(0, desc as usize as *const i32); let s3 = store3(0, desc as usize as *const i32);
    let bx = Box3 { wrap: wrap != 0, bw, bh, bd, hw: bw / 2.0, hh: bh / 2.0, hd: bd / 2.0 };
    tors1_range(&s, &s3, &bx, sq as usize as *const i32, sk as usize as *const f64, t0 as usize, t1 as usize, f0, fx as usize as *mut f64, fy as usize as *mut f64, fz as usize as *mut f64);
}

/// One 3-D force pass over the given ranges: pairs, bonds, angle centres and dihedrals (in that order, as the JavaScript).
pub unsafe fn forces3(base: usize, desc: *const i32, q0: usize, q1: usize, b0: usize, b1: usize, c0: usize, c1: usize, t0: usize, t1: usize,
    fxo: *mut f64, fyo: *mut f64, fzo: *mut f64, cq: *mut i32, bx: &Box3, step: i64, kstiff_out: *mut f64) -> usize {
    let s = store(base, desc); let s3 = store3(base, desc);
    let mut c = Ctx { kstiff: 0.0 };
    let mut nc = pair_kernel3(&mut c, &s, &s3, q0, q1, fxo, fyo, fzo, cq, 0, bx, step);
    nc = bond_kernel3(&s, &s3, b0, b1, fxo, fyo, fzo, cq, nc, bx);
    angle_kernel3(&s, &s3, c0, c1, t0, t1, fxo, fyo, fzo, bx);
    *kstiff_out = c.kstiff;
    nc
}

#[no_mangle]
pub unsafe extern "C" fn af_forces3(desc: u32, q0: u32, q1: u32, b0: u32, b1: u32, c0: u32, c1: u32, t0: u32, t1: u32, fxo: u32, fyo: u32, fzo: u32, cq: u32,
    wrap: u32, bw: f64, bh: f64, bd: f64, hw: f64, hh: f64, hd: f64, step: f64, kstiff_out: u32) -> u32 {
    let bx = Box3 { wrap: wrap != 0, bw, bh, bd, hw, hh, hd };
    forces3(0, desc as usize as *const i32, q0 as usize, q1 as usize, b0 as usize, b1 as usize, c0 as usize, c1 as usize, t0 as usize, t1 as usize,
        fxo as usize as *mut f64, fyo as usize as *mut f64, fzo as usize as *mut f64, cq as usize as *mut i32, &bx, step as i64, kstiff_out as usize as *mut f64) as u32
}
