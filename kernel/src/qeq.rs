//! Induced charges (engine.js qeqUpdate, Experimental, 1.12; here 1.26): the pairs whose energy depends on the charges
//! of the molecules being updated, from the neighbour list, each with its coefficient c (the pair's energy is c·qa·qb:
//! engine.js qeqC) and its product of charges now. The same tests in the same order and the same arithmetic (square
//! roots and divisions only), so the list is the JavaScript's to the bit. Arrays by byte offset in a table (`Q_*`),
//! scalars in a f64 block (`QP_*`). Main thread only.

pub const Q_PI: usize = 0;
pub const Q_PJ: usize = 1;
pub const Q_MARK: usize = 2; // (u8: the atom's molecule is updated)
pub const Q_K: usize = 3; // (u8)
pub const Q_Z: usize = 4; // (i16)
pub const Q_DEAD: usize = 5; // (u8)
pub const Q_FAST: usize = 6; // (u8)
pub const Q_RAD: usize = 7; // (u8)
pub const Q_MOL: usize = 8; // (i32)
pub const Q_ID: usize = 9; // (i32)
pub const Q_X: usize = 10;
pub const Q_Y: usize = 11;
pub const Q_PZ: usize = 12;
pub const Q_Q: usize = 13;
pub const Q_QP: usize = 14;
pub const Q_NE: usize = 15; // (i16)
pub const Q_ANTI: usize = 16; // (u8)
pub const Q_IONIC: usize = 17; // (u8)
pub const Q_EXL: usize = 18; // (i32: each slot's excluded ids, EXW apart)
pub const Q_EXN: usize = 19; // (u8)
pub const Q_PA: usize = 20; // (out)
pub const Q_PB: usize = 21;
pub const Q_PC: usize = 22;
pub const Q_Q0: usize = 23;
pub const Q_LEN: usize = 24;

pub const QP_NP: usize = 0; // (the list's pairs)
pub const QP_WRAP: usize = 1;
pub const QP_BW: usize = 2;
pub const QP_BH: usize = 3;
pub const QP_BD: usize = 4;
pub const QP_D3: usize = 5;
pub const QP_LR: usize = 6; // (_lrOn)
pub const QP_RC: usize = 7;
pub const QP_RC2: usize = 8;
pub const QP_KE: usize = 9;
pub const QP_KIW: usize = 10;
pub const QP_SMEAR: usize = 11; // (BARE_SMEAR)
pub const QP_EXW: usize = 12;
pub const QP_CAP: usize = 13;
pub const QP_OUT: usize = 14; // (out: the pairs pushed)
pub const QP_LEN: usize = 16;

#[inline(always)]
unsafe fn o<T>(t: &[usize], k: usize) -> *mut T { t[k] as *mut T }
#[inline(always)]
unsafe fn r<T: Copy>(p: *const T, i: usize) -> T { *p.add(i) }

/// t: the arrays' addresses (`Q_*`)
pub unsafe fn qeq_pairs_at(t: &[usize], p: *mut f64) {
    let pi: *const i32 = o(t, Q_PI); let pj: *const i32 = o(t, Q_PJ); let mark: *const u8 = o(t, Q_MARK); let kk: *const u8 = o(t, Q_K); let zs: *const i16 = o(t, Q_Z);
    let dead: *const u8 = o(t, Q_DEAD); let fast: *const u8 = o(t, Q_FAST); let rad: *const u8 = o(t, Q_RAD); let mol: *const i32 = o(t, Q_MOL); let id: *const i32 = o(t, Q_ID);
    let x: *const f64 = o(t, Q_X); let y: *const f64 = o(t, Q_Y); let pz: *const f64 = o(t, Q_PZ); let q: *const f64 = o(t, Q_Q); let qp: *const f64 = o(t, Q_QP);
    let ne: *const i16 = o(t, Q_NE); let anti: *const u8 = o(t, Q_ANTI); let ionic: *const u8 = o(t, Q_IONIC); let exl: *const i32 = o(t, Q_EXL); let exn: *const u8 = o(t, Q_EXN);
    let pa: *mut i32 = o(t, Q_PA); let pb: *mut i32 = o(t, Q_PB); let pc: *mut f64 = o(t, Q_PC); let q0: *mut f64 = o(t, Q_Q0);
    let n = r(p, QP_NP) as usize; let wrap = r(p, QP_WRAP) != 0.0; let bw = r(p, QP_BW); let bh = r(p, QP_BH); let bd = r(p, QP_BD); let hw = bw / 2.0; let hh = bh / 2.0;
    let d3 = r(p, QP_D3) != 0.0; let lr = r(p, QP_LR) != 0.0; let rc = r(p, QP_RC); let rc2 = r(p, QP_RC2); let ke = r(p, QP_KE); let kiw = r(p, QP_KIW); let sa = r(p, QP_SMEAR);
    let exw = r(p, QP_EXW) as usize; let cap = r(p, QP_CAP) as usize;
    let islr = |i: usize| r(q, i).abs() >= 1.0; // (isLR: a nucleus with a net charge of at least 1; only nuclei here)
    let (c009, c0016, c004, irc) = (1.0 / (rc2 + 0.09).sqrt(), 1.0 / (rc2 + 0.0016).sqrt(), 1.0 / (rc2 + 0.04).sqrt(), 1.0 / rc); // (csh's 1/√(RC² + s) for its three softenings, worked out once: the same numbers)
    let csh = |i: usize, j: usize, c0: f64| c0 - (if lr && islr(i) && islr(j) { irc } else { 0.0 });
    let mut np = 0usize;
    for k in 0..n {
        let i = r(pi, k) as usize; let j = r(pj, k) as usize; if r(mark, i) == 0 && r(mark, j) == 0 { continue; }
        if (r(kk, i) | r(kk, j) | r(dead, i) | r(dead, j) | r(fast, i) | r(fast, j) | r(rad, i) | r(rad, j)) != 0 || r(zs, i) == 0 || r(zs, j) == 0 { continue; } // (flags 0 or 1: one test)
        let mut dx = r(x, j) - r(x, i); let mut dy = r(y, j) - r(y, i); let mut dz = if d3 { r(pz, j) - r(pz, i) } else { 0.0 };
        if wrap { if dx > hw { dx -= bw; } else if dx < -hw { dx += bw; } if dy > hh { dy -= bh; } else if dy < -hh { dy += bh; } if d3 { if dz > bd / 2.0 { dz -= bd; } else if dz < -bd / 2.0 { dz += bd; } } }
        let r2 = if d3 { dx * dx + dy * dy + dz * dz } else { dx * dx + dy * dy }; if r2 >= rc2 { continue; }
        let mi = r(mol, i);
        if mi != 0 && mi == r(mol, j) { // (one molecule: excluded pairs (the atom's excl) carry no charge energy)
            let idj = r(id, j); let b0 = i * exw; let mut ex = false;
            for u in 0..r(exn, i) as usize { if r(exl, b0 + u) == idj { ex = true; break; } }
            if ex { continue; }
        }
        // qeqC
        let (nei, nej) = (r(ne, i), r(ne, j));
        let c = if r(anti, i) != r(anti, j) { let (sf, c0) = if nei > 0 && nej > 0 { (0.09, c009) } else if nei == 0 && nej == 0 { (0.0016, c0016) } else { (0.04, c004) }; ke * (1.0 / (r2 + sf).sqrt() - csh(i, j, c0)) }
            else if nei > 0 && nej > 0 { let ii = r(ionic, i); let ij = r(ionic, j); let iw = if ii != ij && (if ii != 0 { r(q, j) == 0.0 } else { r(q, i) == 0.0 }) { kiw } else { 1.0 }; iw * ke * (1.0 / (r2 + 0.09).sqrt() - csh(i, j, c009)) }
            else if nei == 0 && nej == 0 { ke * (1.0 / (r2 + 0.0016).sqrt() - csh(i, j, c0016)) }
            else { let rr = r2.sqrt(); let sv = if rr >= sa { 1.0 / rr } else { (3.0 * sa * sa - rr * rr) / (2.0 * sa * sa * sa) }; ke * (sv - (if lr && islr(i) && islr(j) { 0.0 } else { irc })) };
        if c == 0.0 || c.is_nan() { continue; } // (JS: if (c) push)
        if np < cap { *pa.add(np) = i as i32; *pb.add(np) = j as i32; *pc.add(np) = c; *q0.add(np) = (r(q, i) + r(qp, i)) * (r(q, j) + r(qp, j)); }
        np += 1;
    }
    *p.add(QP_OUT) = np as f64;
}

#[no_mangle]
pub unsafe extern "C" fn af_qeq(t: u32, p: u32) {
    let tb = t as usize as *const i32; let mut ta = [0usize; Q_LEN];
    for k in 0..Q_LEN { ta[k] = *tb.add(k) as u32 as usize; }
    qeq_pairs_at(&ta, p as usize as *mut f64)
}
