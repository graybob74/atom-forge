//! The neighbour (Verlet) list's pairs from the cell grid (engine.js vlPairs and vlPairs3, 1.26): the same walk over
//! the grid's hash table of occupied cells, in the same order, so the list is the JavaScript's pair for pair (integer
//! work and comparisons only; the distances are the same subtractions and products). The arrays are the grid's
//! (G.keys, head, next, px, py, pz, occ), the MD list (_mdI), the kinds (S.k) and the list's pair arrays, all in the
//! module's memory, given by byte offset (`V_*`; the exports take them as arguments); the box and the ranges `VP_*`.
//! On the main thread (vlBuild, vlBuildAll's own share) and on the workers (their stretches).

pub const V_KEYS: usize = 0;
pub const V_HEAD: usize = 1;
pub const V_NEXT: usize = 2;
pub const V_PX: usize = 3;
pub const V_PY: usize = 4;
pub const V_PZ: usize = 5;
pub const V_OCC: usize = 6;
pub const V_IDX: usize = 7; // (_mdI: grid entry → slot)
pub const V_K: usize = 8; // (S.k, u8)
pub const V_PI: usize = 9;
pub const V_PJ: usize = 10;
pub const V_COLS: usize = 11; // (the integers from here on are values, not offsets)
pub const V_ROWS: usize = 12;
pub const V_LAY: usize = 13;
pub const V_GWRAP: usize = 14;
pub const V_MASK: usize = 15;
pub const V_SHIFT: usize = 16;
pub const V_NOCC: usize = 17;
pub const V_LEN: usize = 18;

pub const VP_RL2: usize = 0;
pub const VP_WRAP: usize = 1;
pub const VP_BW: usize = 2;
pub const VP_BH: usize = 3;
pub const VP_BD: usize = 4;
pub const VP_HW: usize = 5;
pub const VP_HH: usize = 6;
pub const VP_HD: usize = 7;
pub const VP_P0: usize = 8; // (2-D: the first occupied cell; 3-D: the first grid particle in walking order)
pub const VP_P1: usize = 9; // (the end; may be +∞ in 3-D: the rest)
pub const VP_BASE: usize = 10;
pub const VP_CAP: usize = 11;
pub const VP_LEN: usize = 12;

#[inline(always)]
unsafe fn off<T>(base: usize, t: *const i32, k: usize) -> *mut T { (base + *t.add(k) as u32 as usize) as *mut T }
#[inline(always)]
unsafe fn r<T: Copy>(p: *const T, i: usize) -> T { *p.add(i) }

/// The minimum image's shift without a branch (the JavaScript's `if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw;`:
/// dx − bw, dx − (−bw) = dx + bw and dx − 0 = dx are the same numbers; a select, as random signs mispredict).
#[inline(always)]
fn wrap1(d: f64, h: f64, b: f64) -> f64 { let up = if d > h { b } else { 0.0 }; let dn = if d < -h { -b } else { 0.0 }; up + dn }
/// The hash slot of cell key k, or -1 (gridFind: Math.imul(k, 0x9E3779B1) >>> shift, then linear probing).
#[inline(always)]
unsafe fn find(keys: *const i32, k: i32, mask: u32, shift: u32) -> i32 {
    let mut s = (k as u32).wrapping_mul(0x9E37_79B1).wrapping_shr(shift);
    loop { let kk = r(keys, s as usize); if kk == k { return s as i32; } if kk == -1 { return -1; } s = (s + 1) & mask; }
}

/// engine.js vlPairs (2-D): the pairs within √RL2 among the occupied cells o0 ≤ oc < o1, appended at pi[base …] up to
/// base + cap; the number of pairs, or -1 when they would not fit.
pub unsafe fn vl_pairs(mb: usize, t: *const i32, p: *const f64) -> i32 {
    let keys: *const i32 = off(mb, t, V_KEYS); let head: *const i32 = off(mb, t, V_HEAD); let next: *const i32 = off(mb, t, V_NEXT);
    let px: *const f64 = off(mb, t, V_PX); let py: *const f64 = off(mb, t, V_PY); let occ: *const i32 = off(mb, t, V_OCC);
    let idx: *const i32 = off(mb, t, V_IDX); let kk: *const u8 = off(mb, t, V_K); let pi: *mut i32 = off(mb, t, V_PI); let pj: *mut i32 = off(mb, t, V_PJ);
    let cols = r(t, V_COLS); let rows = r(t, V_ROWS); let gwrap = r(t, V_GWRAP) != 0; let mask = r(t, V_MASK) as u32; let shift = r(t, V_SHIFT) as u32;
    let rl2 = r(p, VP_RL2); let wrap = r(p, VP_WRAP) != 0.0; let bw = r(p, VP_BW); let bh = r(p, VP_BH); let hw = r(p, VP_HW); let hh = r(p, VP_HH);
    let o0 = r(p, VP_P0) as usize; let o1 = r(p, VP_P1) as usize; let base = r(p, VP_BASE) as usize; let end = base + r(p, VP_CAP) as usize;
    let mut f = [0i32; 8];
    let mut np = base;
    for oc in o0..o1 {
        let c = r(occ, oc) as usize; let key = r(keys, c); let cx = key % cols; let cy = key / cols;
        let mut nf = 0usize;
        for oy in -1..=1i32 { for ox in -1..=1i32 {
            let mut x = cx + ox; let mut y = cy + oy;
            if gwrap { x = (x + cols) % cols; y = (y + rows) % rows; } else if x < 0 || y < 0 || x >= cols || y >= rows { continue; }
            let k = y * cols + x;
            if k <= key { continue; }
            let s = find(keys, k, mask, shift);
            if s == -1 { continue; }
            let mut dup = false; for q in 0..nf { if f[q] == s { dup = true; break; } }
            if !dup { f[nf] = s; nf += 1; }
        } }
        let mut i = r(head, c);
        while i != -1 {
            let iu = i as usize; let si = r(idx, iu);
            if r(kk, si as usize) == 0 { // (NUC = 0)
                let ax = r(px, iu); let ay = r(py, iu);
                let mut j = r(next, iu);
                while j != -1 { // same cell
                    let ju = j as usize; let sj = r(idx, ju);
                    if r(kk, sj as usize) == 0 {
                        let mut dx = r(px, ju) - ax; let mut dy = r(py, ju) - ay;
                        if wrap { dx -= wrap1(dx, hw, bw); dy -= wrap1(dy, hh, bh); }
                        if dx * dx + dy * dy < rl2 { if np >= end { return -1; } *pi.add(np) = si; *pj.add(np) = sj; np += 1; }
                    }
                    j = r(next, ju);
                }
                for q in 0..nf { // neighbour cells with a greater key
                    let mut j = r(head, f[q] as usize);
                    while j != -1 {
                        let ju = j as usize; let sj = r(idx, ju);
                        if r(kk, sj as usize) == 0 {
                            let mut dx = r(px, ju) - ax; let mut dy = r(py, ju) - ay;
                            if wrap { dx -= wrap1(dx, hw, bw); dy -= wrap1(dy, hh, bh); }
                            if dx * dx + dy * dy < rl2 { if np >= end { return -1; } *pi.add(np) = si; *pj.add(np) = sj; np += 1; }
                        }
                        j = r(next, ju);
                    }
                }
            }
            i = r(next, iu);
        }
    }
    (np - base) as i32
}

/// engine.js vlPairs3: the pairs of the grid's particles p0 ≤ ord < p1, in the order the occupied cells and their
/// particles are walked (the 26 cells around each, those with a greater key; the same cell from the next particle on).
pub unsafe fn vl_pairs3(mb: usize, t: *const i32, p: *const f64) -> i32 {
    let keys: *const i32 = off(mb, t, V_KEYS); let head: *const i32 = off(mb, t, V_HEAD); let next: *const i32 = off(mb, t, V_NEXT);
    let px: *const f64 = off(mb, t, V_PX); let py: *const f64 = off(mb, t, V_PY); let pz: *const f64 = off(mb, t, V_PZ); let occ: *const i32 = off(mb, t, V_OCC);
    let idx: *const i32 = off(mb, t, V_IDX); let kk: *const u8 = off(mb, t, V_K); let pi: *mut i32 = off(mb, t, V_PI); let pj: *mut i32 = off(mb, t, V_PJ);
    let cols = r(t, V_COLS); let rows = r(t, V_ROWS); let lay = r(t, V_LAY); let gwrap = r(t, V_GWRAP) != 0; let mask = r(t, V_MASK) as u32; let shift = r(t, V_SHIFT) as u32; let nocc = r(t, V_NOCC) as usize;
    let rl2 = r(p, VP_RL2); let wrap = r(p, VP_WRAP) != 0.0; let bw = r(p, VP_BW); let bh = r(p, VP_BH); let bd = r(p, VP_BD); let hw = r(p, VP_HW); let hh = r(p, VP_HH); let hd = r(p, VP_HD);
    let p0 = r(p, VP_P0) as i64; let p1 = r(p, VP_P1) as i64; // (+∞ saturates: every particle from p0 on)
    let base = r(p, VP_BASE) as usize; let end = base + r(p, VP_CAP) as usize;
    let mut f = [0i32; 27];
    let mut np = base; let mut ord: i64 = 0;
    let mut oc = 0usize;
    while oc < nocc && ord < p1 {
        let c = r(occ, oc) as usize;
        let mut nf: i32 = -1;
        let mut i = r(head, c);
        while i != -1 {
            let iu = i as usize;
            if ord < p0 { i = r(next, iu); ord += 1; continue; }
            if ord >= p1 { break; }
            if nf < 0 {
                let key = r(keys, c); let cx = key % cols; let cy = (key / cols) % rows; let cz = key / (cols * rows);
                nf = 0;
                for oz in -1..=1i32 { for oy in -1..=1i32 { for ox in -1..=1i32 {
                    let mut x = cx + ox; let mut y = cy + oy; let mut z = cz + oz;
                    if gwrap { x = (x + cols) % cols; y = (y + rows) % rows; z = (z + lay) % lay; } else if x < 0 || y < 0 || z < 0 || x >= cols || y >= rows || z >= lay { continue; }
                    let k = (z * rows + y) * cols + x;
                    if k <= key { continue; }
                    let s = find(keys, k, mask, shift);
                    if s == -1 { continue; }
                    let mut dup = false; for q in 0..nf as usize { if f[q] == s { dup = true; break; } }
                    if !dup { f[nf as usize] = s; nf += 1; }
                } } }
            }
            let si = r(idx, iu);
            if r(kk, si as usize) == 0 { // (NUC = 0)
                let ax = r(px, iu); let ay = r(py, iu); let az = r(pz, iu);
                for q in -1..nf { // (q = −1: the same cell, from the next particle on)
                    let mut j = if q < 0 { r(next, iu) } else { r(head, f[q as usize] as usize) };
                    while j != -1 {
                        let ju = j as usize; let sj = r(idx, ju);
                        if r(kk, sj as usize) == 0 {
                            let mut dx = r(px, ju) - ax; let mut dy = r(py, ju) - ay; let mut dz = r(pz, ju) - az;
                            if wrap { dx -= wrap1(dx, hw, bw); dy -= wrap1(dy, hh, bh); dz -= wrap1(dz, hd, bd); }
                            if dx * dx + dy * dy + dz * dz < rl2 { if np >= end { return -1; } *pi.add(np) = si; *pj.add(np) = sj; np += 1; }
                        }
                        j = r(next, ju);
                    }
                }
            }
            i = r(next, iu); ord += 1;
        }
        oc += 1;
    }
    (np - base) as i32
}

/// The exports take everything as arguments (no table in memory: the workers call them at the same time, each with its
/// own stretch): offsets of keys, head, next, px, py, pz, occ, idx, k, pi, pj; then cols, rows, lay, gwrap, mask, shift,
/// nocc; then RL2, wrap, bw, bh, bd, hw, hh, hd, p0, p1, base, cap.
unsafe fn tables(a: [u32; 18], b: [f64; 12]) -> ([i32; V_LEN], [f64; VP_LEN]) {
    let mut t = [0i32; V_LEN]; let mut p = [0.0f64; VP_LEN];
    for k in 0..V_LEN { t[k] = a[k] as i32; }
    for k in 0..VP_LEN { p[k] = b[k]; }
    (t, p)
}
#[no_mangle]
pub unsafe extern "C" fn af_vl(keys: u32, head: u32, next: u32, px: u32, py: u32, pz: u32, occ: u32, idx: u32, k: u32, pi: u32, pj: u32,
    cols: u32, rows: u32, lay: u32, gwrap: u32, mask: u32, shift: u32, nocc: u32,
    rl2: f64, wrap: f64, bw: f64, bh: f64, bd: f64, hw: f64, hh: f64, hd: f64, p0: f64, p1: f64, base: f64, cap: f64) -> i32 {
    let (t, p) = tables([keys, head, next, px, py, pz, occ, idx, k, pi, pj, cols, rows, lay, gwrap, mask, shift, nocc], [rl2, wrap, bw, bh, bd, hw, hh, hd, p0, p1, base, cap]);
    vl_pairs(0, t.as_ptr(), p.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn af_vl3(keys: u32, head: u32, next: u32, px: u32, py: u32, pz: u32, occ: u32, idx: u32, k: u32, pi: u32, pj: u32,
    cols: u32, rows: u32, lay: u32, gwrap: u32, mask: u32, shift: u32, nocc: u32,
    rl2: f64, wrap: f64, bw: f64, bh: f64, bd: f64, hw: f64, hh: f64, hd: f64, p0: f64, p1: f64, base: f64, cap: f64) -> i32 {
    let (t, p) = tables([keys, head, next, px, py, pz, occ, idx, k, pi, pj, cols, rows, lay, gwrap, mask, shift, nocc], [rl2, wrap, bw, bh, bd, hw, hh, hd, p0, p1, base, cap]);
    vl_pairs3(0, t.as_ptr(), p.as_ptr())
}
