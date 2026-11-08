//! Experimental passes that ran on the main thread in JavaScript after the kernels (1.28 items 35 and pold): the
//! induced dipoles' force pass (pold.js pdForces, polarizability by direction, 1.27) and the off-atom charge sites'
//! pair loop (sites.js sitesForces, directional forces, 1.26). The same tests in the same order and the same
//! arithmetic (square roots, divisions, products and sums in the JavaScript's order, no exp or pow), so the forces are
//! the JavaScript's to the bit. Arrays by byte offset in a table, scalars in a f64 block, as qeq.rs. Main thread only.

#[inline(always)]
unsafe fn o<T>(t: *const i32, k: usize) -> *mut T { *t.add(k) as u32 as usize as *mut T }
#[inline(always)]
unsafe fn r<T: Copy>(p: *const T, i: usize) -> T { *p.add(i) }
#[inline(always)]
unsafe fn ad(p: *mut f64, i: usize, v: f64) { *p.add(i) += v; }
#[inline(always)]
unsafe fn sb(p: *mut f64, i: usize, v: f64) { *p.add(i) -= v; }

// pdForces: the table
pub const PD_PI: usize = 0;
pub const PD_PJ: usize = 1;
pub const PD_X: usize = 2;
pub const PD_Y: usize = 3;
pub const PD_PZ: usize = 4;
pub const PD_K: usize = 5; // (u8)
pub const PD_Z: usize = 6; // (i16)
pub const PD_DEAD: usize = 7; // (u8)
pub const PD_FAST: usize = 8; // (u8)
pub const PD_RAD: usize = 9; // (u8)
pub const PD_MOL: usize = 10; // (i32)
pub const PD_Q: usize = 11;
pub const PD_QP: usize = 12;
pub const PD_IONIC: usize = 13; // (u8)
pub const PD_CR: usize = 14; // (f64: the damping's cube root per slot)
pub const PD_ACT: usize = 15; // (u8: the slot has a live dipole)
pub const PD_DMX: usize = 16; // (f64 per slot)
pub const PD_DMY: usize = 17;
pub const PD_DMZ: usize = 18;
pub const PD_FX: usize = 19;
pub const PD_FY: usize = 20;
pub const PD_FZ: usize = 21;
pub const PD_LEN: usize = 22;
// and the scalars
pub const PDP_NP: usize = 0;
pub const PDP_D3: usize = 1;
pub const PDP_WRAP: usize = 2;
pub const PDP_BW: usize = 3;
pub const PDP_BH: usize = 4;
pub const PDP_BD: usize = 5;
pub const PDP_RC2: usize = 6;
pub const PDP_R1: usize = 7; // (RC − 1: pdSw's fade starts)
pub const PDP_S: usize = 8; // (PD_S)
pub const PDP_TH: usize = 9; // (PD_TH)
pub const PDP_KIW: usize = 10;
pub const PDP_KE: usize = 11;

/// pold.js pdForces, line for line.
#[no_mangle]
pub unsafe extern "C" fn af_pd_forces(t: u32, p: u32) {
    let t = t as usize as *const i32; let p = p as usize as *const f64;
    let pi: *const i32 = o(t, PD_PI); let pj: *const i32 = o(t, PD_PJ); let x: *const f64 = o(t, PD_X); let y: *const f64 = o(t, PD_Y); let zp: *const f64 = o(t, PD_PZ);
    let kk: *const u8 = o(t, PD_K); let zs: *const i16 = o(t, PD_Z); let dead: *const u8 = o(t, PD_DEAD); let fast: *const u8 = o(t, PD_FAST); let rad: *const u8 = o(t, PD_RAD);
    let mol: *const i32 = o(t, PD_MOL); let q: *const f64 = o(t, PD_Q); let qp: *const f64 = o(t, PD_QP); let ionic: *const u8 = o(t, PD_IONIC); let cr: *const f64 = o(t, PD_CR);
    let act: *const u8 = o(t, PD_ACT); let dmx: *const f64 = o(t, PD_DMX); let dmy: *const f64 = o(t, PD_DMY); let dmz: *const f64 = o(t, PD_DMZ);
    let fxo: *mut f64 = o(t, PD_FX); let fyo: *mut f64 = o(t, PD_FY); let fzo: *mut f64 = o(t, PD_FZ);
    let np = r(p, PDP_NP) as usize; let d3 = r(p, PDP_D3) != 0.0; let wrap = r(p, PDP_WRAP) != 0.0; let bw = r(p, PDP_BW); let bh = r(p, PDP_BH); let bd = r(p, PDP_BD);
    let hw = bw / 2.0; let hh = bh / 2.0; let hd = bd / 2.0; let rc2 = r(p, PDP_RC2); let r1 = r(p, PDP_R1); let pds = r(p, PDP_S); let pdth = r(p, PDP_TH); let kiw = r(p, PDP_KIW); let ke = r(p, PDP_KE);
    for k in 0..np {
        let i = r(pi, k) as usize; let j = r(pj, k) as usize; let ai = r(act, i) != 0; let aj = r(act, j) != 0;
        if !ai && !aj { continue; }
        if r(kk, i) != 0 || r(kk, j) != 0 || r(zs, i) == 0 || r(zs, j) == 0 || r(dead, i) != 0 || r(dead, j) != 0 || r(fast, i) != 0 || r(fast, j) != 0 || r(rad, i) != 0 || r(rad, j) != 0 { continue; }
        let mi = r(mol, i); if mi != 0 && mi == r(mol, j) { continue; }
        let mut dx = r(x, j) - r(x, i); let mut dy = r(y, j) - r(y, i); let mut dz = if d3 { r(zp, j) - r(zp, i) } else { 0.0 };
        if wrap { if dx > hw { dx -= bw; } else if dx < -hw { dx += bw; } if dy > hh { dy -= bh; } else if dy < -hh { dy += bh; } if d3 { if dz > hd { dz -= bd; } else if dz < -hd { dz += bd; } } }
        let u = dx * dx + dy * dy + dz * dz; if u >= rc2 { continue; }
        // pdRad(u, PD_S + PD_TH·cr_i·cr_j)
        let tt = u + (pds + pdth * r(cr, i) * r(cr, j)); let g = 1.0 / tt.sqrt(); let it = 1.0 / tt; let g1 = -0.5 * g * it; let g2 = -1.5 * g1 * it; let g3 = -2.5 * g2 * it;
        // pdSw(u)
        let (sw, dsw) = if u <= r1 * r1 { (1.0, 0.0) } else { let rr = u.sqrt(); let xx = rr - r1; (1.0 - xx * xx * xx * (10.0 - 15.0 * xx + 6.0 * xx * xx), -30.0 * xx * xx * (1.0 - xx) * (1.0 - xx) / rr) };
        let qa = r(q, i) + r(qp, i); let qb = r(q, j) + r(qp, j);
        let ii = r(ionic, i); let ij = r(ionic, j);
        let w = if ii != ij && (if ii == 1 { r(q, j) == 0.0 } else { r(q, i) == 0.0 }) && !d3 { kiw } else { 1.0 };
        let (ax, ay, az) = if ai { (r(dmx, i), r(dmy, i), r(dmz, i)) } else { (0.0, 0.0, 0.0) };
        let (bx, by, bz) = if aj { (r(dmx, j), r(dmy, j), r(dmz, j)) } else { (0.0, 0.0, 0.0) };
        let a_ = ax * dx + ay * dy + az * dz; let b_ = bx * dx + by * dy + bz * dz; let c_ = ax * bx + ay * by + az * bz;
        let mut pp = 2.0 * g1 * w * (qa * b_ - qb * a_); let mut s1 = 4.0 * g2 * w * (qa * b_ - qb * a_); let mut c2 = 0.0; let c1 = 2.0 * g1 * w;
        if ai && aj { pp -= 2.0 * g1 * c_ + 4.0 * g2 * a_ * b_; s1 -= 4.0 * g2 * c_ + 8.0 * g3 * a_ * b_; c2 = 4.0 * g2; }
        s1 = sw * s1 + pp * dsw;
        let gx = s1 * dx + sw * (c1 * (qa * bx - qb * ax) - c2 * (b_ * ax + a_ * bx)); let gy = s1 * dy + sw * (c1 * (qa * by - qb * ay) - c2 * (b_ * ay + a_ * by)); let gz = s1 * dz + sw * (c1 * (qa * bz - qb * az) - c2 * (b_ * az + a_ * bz));
        ad(fxo, i, ke * gx); ad(fyo, i, ke * gy); sb(fxo, j, ke * gx); sb(fyo, j, ke * gy);
        if d3 { ad(fzo, i, ke * gz); sb(fzo, j, ke * gz); }
    }
}

// sitesForces: the table
pub const SF_PI: usize = 0;
pub const SF_PJ: usize = 1;
pub const SF_EX: usize = 2; // (u8: the list's exclusion marks)
pub const SF_X: usize = 3;
pub const SF_Y: usize = 4;
pub const SF_PZ: usize = 5;
pub const SF_NE: usize = 6; // (i16)
pub const SF_Z: usize = 7; // (i16)
pub const SF_K: usize = 8; // (u8)
pub const SF_ANTI: usize = 9; // (u8)
pub const SF_IDX: usize = 10; // (i32: the slot's site atom, −1 none)
pub const SF_Q: usize = 11;
pub const SF_QP: usize = 12;
pub const SF_IONIC: usize = 13; // (u8)
pub const SF_N: usize = 14; // (i32 per site atom: 1 + its sites)
pub const SF_QS: usize = 15; // (f64, 4 per site atom)
pub const SF_OS: usize = 16; // (f64, 12 per site atom)
pub const SF_GO: usize = 17; // (f64, 12 per site atom: the offsets' gradients, added to)
pub const SF_FX: usize = 18;
pub const SF_FY: usize = 19;
pub const SF_FZ: usize = 20;
pub const SF_LEN: usize = 21;
pub const SFP_NP: usize = 0;
pub const SFP_D3: usize = 1;
pub const SFP_WRAP: usize = 2;
pub const SFP_BW: usize = 3;
pub const SFP_BH: usize = 4;
pub const SFP_BD: usize = 5;
pub const SFP_RC2: usize = 6;
pub const SFP_R1: usize = 7; // (RC − SW_W)
pub const SFP_SWW: usize = 8; // (SW_W)
pub const SFP_SOFT0: usize = 9; // (SOFT_S, the kernel's softening)
pub const SFP_SOFT: usize = 10; // (SITES.soft)
pub const SFP_KC: usize = 11; // (K_COUL)
pub const SFP_KIW: usize = 12;
pub const SFP_OUT: usize = 13; // (out: the pairs counted, SITES.pairs)

/// sites.js sitesForces' pair loop, line for line, for a world with no π-stacking ring pairs (sitesForces keeps those,
/// and the offsets' gradients carried back, siteBack, in JavaScript).
#[no_mangle]
pub unsafe extern "C" fn af_sites_forces(t: u32, p: u32) {
    let t = t as usize as *const i32; let p = p as usize as *mut f64;
    let pi: *const i32 = o(t, SF_PI); let pj: *const i32 = o(t, SF_PJ); let exm: *const u8 = o(t, SF_EX); let x: *const f64 = o(t, SF_X); let y: *const f64 = o(t, SF_Y); let zp: *const f64 = o(t, SF_PZ);
    let ne: *const i16 = o(t, SF_NE); let zs: *const i16 = o(t, SF_Z); let kk: *const u8 = o(t, SF_K); let anti: *const u8 = o(t, SF_ANTI); let idx: *const i32 = o(t, SF_IDX);
    let q: *const f64 = o(t, SF_Q); let qp: *const f64 = o(t, SF_QP); let ionic: *const u8 = o(t, SF_IONIC); let nn: *const i32 = o(t, SF_N); let qs: *const f64 = o(t, SF_QS); let os: *const f64 = o(t, SF_OS);
    let go: *mut f64 = o(t, SF_GO); let fxo: *mut f64 = o(t, SF_FX); let fyo: *mut f64 = o(t, SF_FY); let fzo: *mut f64 = o(t, SF_FZ);
    let np = r(p, SFP_NP) as usize; let d3 = r(p, SFP_D3) != 0.0; let wrap = r(p, SFP_WRAP) != 0.0; let bw = r(p, SFP_BW); let bh = r(p, SFP_BH); let bd = r(p, SFP_BD);
    let hw = bw / 2.0; let hh = bh / 2.0; let hd = bd / 2.0; let rc2 = r(p, SFP_RC2); let r1 = r(p, SFP_R1); let sww = r(p, SFP_SWW); let soft0 = r(p, SFP_SOFT0); let soft = r(p, SFP_SOFT);
    let kc = r(p, SFP_KC); let kiw = r(p, SFP_KIW);
    let mut npairs = 0usize;
    for k in 0..np {
        let i = r(pi, k) as usize; let j = r(pj, k) as usize; let ki = r(idx, i); let kj = r(idx, j);
        if ki < 0 && kj < 0 { continue; }
        if r(exm, k) != 0 || r(kk, i) != 0 || r(kk, j) != 0 || r(zs, i) == 0 || r(zs, j) == 0 || r(ne, i) == 0 || r(ne, j) == 0 || r(anti, i) != r(anti, j) { continue; }
        let mut dx = r(x, j) - r(x, i); let mut dy = r(y, j) - r(y, i); let mut dz = if d3 { r(zp, j) - r(zp, i) } else { 0.0 };
        if wrap { if dx > hw { dx -= bw; } else if dx < -hw { dx += bw; } if dy > hh { dy -= bh; } else if dy < -hh { dy += bh; } if d3 { if dz > hd { dz -= bd; } else if dz < -hd { dz += bd; } } }
        let r2 = dx * dx + dy * dy + dz * dz;
        if r2 >= rc2 { continue; }
        npairs += 1;
        let qa = r(q, i) + r(qp, i); let qb = r(q, j) + r(qp, j);
        let ii = r(ionic, i); let ij = r(ionic, j);
        let kq = kc * (if ii != ij && (if ii == 1 { r(q, j) == 0.0 } else { r(q, i) == 0.0 }) && !d3 { kiw } else { 1.0 });
        let rr = r2.sqrt(); let mut sw = 1.0; let mut dsw = 0.0;
        if rr > r1 { let xx = (rr - r1) / sww; sw = 1.0 - xx * xx * xx * (10.0 - 15.0 * xx + 6.0 * xx * xx); dsw = -30.0 * xx * xx * (1.0 - xx) * (1.0 - xx) / sww; }
        let ks = kq * sw; let s0 = r2 + soft0; let g0 = 1.0 / s0.sqrt();
        let mut e = -qa * qb * g0; let mut fax = 0.0; let mut fay = 0.0; let mut faz = 0.0;
        { let f = qa * qb * g0 / s0 * ks; fax += f * dx; fay += f * dy; faz += f * dz; }
        let na = if ki >= 0 { r(nn, ki as usize) as usize } else { 1 }; let nb = if kj >= 0 { r(nn, kj as usize) as usize } else { 1 };
        let ba = if ki >= 0 { 4 * ki as usize } else { 0 }; let bb = if kj >= 0 { 4 * kj as usize } else { 0 };
        let oa = if ki >= 0 { 12 * ki as usize } else { 0 }; let ob = if kj >= 0 { 12 * kj as usize } else { 0 };
        for m in 0..na {
            let qa_ = if ki >= 0 { r(qs, ba + m) } else { qa }; if qa_ == 0.0 { continue; }
            let (oax, oay, oaz) = if m != 0 { (r(os, oa + 3 * m), r(os, oa + 3 * m + 1), r(os, oa + 3 * m + 2)) } else { (0.0, 0.0, 0.0) };
            for l in 0..nb {
                let qb_ = if kj >= 0 { r(qs, bb + l) } else { qb }; if qb_ == 0.0 { continue; }
                let (obx, oby, obz) = if l != 0 { (r(os, ob + 3 * l), r(os, ob + 3 * l + 1), r(os, ob + 3 * l + 2)) } else { (0.0, 0.0, 0.0) };
                let ex = dx + obx - oax; let ey = dy + oby - oay; let ez = dz + obz - oaz;
                let s = ex * ex + ey * ey + ez * ez + (if m == 0 && l == 0 { soft0 } else { soft }); let g = 1.0 / s.sqrt(); let qq = qa_ * qb_;
                e += qq * g;
                let f = qq * g / s * ks; let fx = f * ex; let fy = f * ey; let fz = f * ez;
                fax -= fx; fay -= fy; faz -= fz;
                if l != 0 { sb(go, ob + 3 * l, fx); sb(go, ob + 3 * l + 1, fy); sb(go, ob + 3 * l + 2, fz); }
                if m != 0 { ad(go, oa + 3 * m, fx); ad(go, oa + 3 * m + 1, fy); ad(go, oa + 3 * m + 2, fz); }
            }
        }
        if dsw != 0.0 { let f = kq * e * dsw / rr; fax += f * dx; fay += f * dy; faz += f * dz; }
        ad(fxo, i, fax); ad(fyo, i, fay); sb(fxo, j, fax); sb(fyo, j, fay);
        if d3 { ad(fzo, i, faz); sb(fzo, j, faz); }
    }
    *p.add(SFP_OUT) = npairs as f64;
}
