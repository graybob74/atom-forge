//! Quantum bonds' dense linear algebra in the module (1.28.2, item 54, the owner's "do 1-3": the same results): the
//! symmetric eigen-solver of tools/xtb/gfn1.js (symEig: Householder tridiagonalization, tred2, then QL with implicit
//! shifts, tql2, as JAMA and tblite's reference), line for line, so its eigenvalues and eigenvectors are the
//! JavaScript's to the bit (no fused multiply-adds, the same order of every sum, hypot2 as written there). Main thread.

#[inline(always)]
unsafe fn g(p: *const f64, i: usize) -> f64 { *p.add(i) }
#[inline(always)]
unsafe fn s(p: *mut f64, i: usize, v: f64) { *p.add(i) = v; }

/// gfn1.js hypot2: the hypotenuse without overflow, with its compensated sum.
fn hypot2(x: f64, y: f64) -> f64 {
    let ax = x.abs(); let ay = y.abs();
    if x.is_nan() || y.is_nan() { return if ax == f64::INFINITY || ay == f64::INFINITY { f64::INFINITY } else { f64::NAN }; }
    let mut max = 0.0;
    if ax > max { max = ax; }
    if ay > max { max = ay; }
    if max == f64::INFINITY { return f64::INFINITY; }
    if max == 0.0 { return 0.0; }
    let mut sum = 0.0; let mut comp = 0.0;
    let n0 = ax / max; let mut summand = n0 * n0 - comp; let mut prelim = sum + summand; comp = (prelim - sum) - summand; sum = prelim;
    let n1 = ay / max; summand = n1 * n1 - comp; prelim = sum + summand; sum = prelim;
    sum.sqrt() * max
}

/// symEig(V, n, rows): V (n·n, row-major) in, its eigenvectors out (as rows when rows ≠ 0, else as columns), the
/// eigenvalues ascending into d (n); e (n) is scratch. Returns 0, or 1 when the QL iterations did not converge (the
/// JavaScript throws).
#[no_mangle]
pub unsafe extern "C" fn af_sym_eig(vp: u32, n: u32, rows: u32, dp: u32, ep: u32) -> i32 {
    let n = n as usize; let t = vp as usize as *mut f64; let d = dp as usize as *mut f64; let e = ep as usize as *mut f64;
    for i in 0..n { s(d, i, 0.0); s(e, i, 0.0); }
    for i in 0..n { for j in 0..i { let tt = g(t, i * n + j); s(t, i * n + j, g(t, j * n + i)); s(t, j * n + i, tt); } }
    for j in 0..n { s(d, j, g(t, j * n + n - 1)); }
    let mut i = n - 1;
    while i > 0 {
        let mut scale = 0.0; let mut h = 0.0;
        for k in 0..i { scale += g(d, k).abs(); }
        if scale == 0.0 {
            s(e, i, g(d, i - 1));
            for j in 0..i { s(d, j, g(t, j * n + i - 1)); s(t, j * n + i, 0.0); s(t, i * n + j, 0.0); }
        } else {
            for k in 0..i { s(d, k, g(d, k) / scale); h += g(d, k) * g(d, k); }
            let mut f = g(d, i - 1); let mut gg = h.sqrt();
            if f > 0.0 { gg = -gg; }
            s(e, i, scale * gg); h -= f * gg; s(d, i - 1, f - gg);
            for j in 0..i { s(e, j, 0.0); }
            for j in 0..i {
                let tj = j * n;
                f = g(d, j); s(t, i * n + j, f); gg = g(e, j) + g(t, tj + j) * f;
                let mut k = j + 1;
                while k <= i - 1 { let tt = g(t, tj + k); gg += tt * g(d, k); s(e, k, g(e, k) + tt * f); k += 1; }
                s(e, j, gg);
            }
            f = 0.0;
            for j in 0..i { s(e, j, g(e, j) / h); f += g(e, j) * g(d, j); }
            let hh = f / (h + h);
            for j in 0..i { s(e, j, g(e, j) - hh * g(d, j)); }
            for j in 0..i {
                let tj = j * n;
                f = g(d, j); gg = g(e, j);
                for k in j..i { s(t, tj + k, g(t, tj + k) - (f * g(e, k) + gg * g(d, k))); }
                s(d, j, g(t, tj + i - 1)); s(t, tj + i, 0.0);
            }
        }
        s(d, i, h);
        i -= 1;
    }
    for i in 0..n.saturating_sub(1) {
        s(t, i * n + n - 1, g(t, i * n + i)); s(t, i * n + i, 1.0);
        let h = g(d, i + 1); let ti1 = (i + 1) * n;
        if h != 0.0 {
            for k in 0..=i { s(d, k, g(t, ti1 + k) / h); }
            for j in 0..=i {
                let tj = j * n;
                let mut gg = 0.0;
                for k in 0..=i { gg += g(t, ti1 + k) * g(t, tj + k); }
                for k in 0..=i { s(t, tj + k, g(t, tj + k) - gg * g(d, k)); }
            }
        }
        for k in 0..=i { s(t, ti1 + k, 0.0); }
    }
    for j in 0..n { s(d, j, g(t, j * n + n - 1)); s(t, j * n + n - 1, 0.0); }
    s(t, (n - 1) * n + n - 1, 1.0);
    s(e, 0, 0.0);
    let vt = t;
    for i in 1..n { s(e, i - 1, g(e, i)); }
    s(e, n - 1, 0.0);
    let mut f = 0.0; let mut tst1: f64 = 0.0;
    let eps = f64::EPSILON; // (2⁻⁵²)
    for l in 0..n {
        let x = g(d, l).abs() + g(e, l).abs();
        if x > tst1 || x.is_nan() || tst1.is_nan() { tst1 = if tst1.is_nan() { tst1 } else { x }; } // (Math.max)
        let mut m = l;
        while m < n { if g(e, m).abs() <= eps * tst1 { break; } m += 1; }
        if m > l {
            let mut iter = 0;
            loop {
                iter += 1; if iter > 100 { return 1; }
                let mut gg = g(d, l);
                let mut p = (g(d, l + 1) - gg) / (2.0 * g(e, l));
                let mut r = hypot2(p, 1.0);
                if p < 0.0 { r = -r; }
                s(d, l, g(e, l) / (p + r));
                s(d, l + 1, g(e, l) * (p + r));
                let dl1 = g(d, l + 1);
                let mut h = gg - g(d, l);
                for i in l + 2..n { s(d, i, g(d, i) - h); }
                f += h;
                p = g(d, m);
                let mut c = 1.0; let mut c2 = c; let mut c3 = c; let mut sn = 0.0; let mut s2 = 0.0;
                let el1 = g(e, l + 1);
                let mut i = m as isize - 1;
                while i >= l as isize {
                    let iu = i as usize;
                    c3 = c2; c2 = c; s2 = sn;
                    gg = c * g(e, iu); h = c * p;
                    r = hypot2(p, g(e, iu));
                    s(e, iu + 1, sn * r); sn = g(e, iu) / r; c = p / r;
                    p = c * g(d, iu) - sn * gg;
                    s(d, iu + 1, h + sn * (c * gg + sn * g(d, iu)));
                    let r0 = iu * n; let r1 = r0 + n;
                    for k in 0..n {
                        h = g(vt, r1 + k);
                        s(vt, r1 + k, sn * g(vt, r0 + k) + c * h);
                        s(vt, r0 + k, c * g(vt, r0 + k) - sn * h);
                    }
                    i -= 1;
                }
                p = -sn * s2 * c3 * el1 * g(e, l) / dl1;
                s(e, l, sn * p); s(d, l, c * p);
                if !(g(e, l).abs() > eps * tst1) { break; }
            }
        }
        s(d, l, g(d, l) + f); s(e, l, 0.0);
    }
    for i in 0..n.saturating_sub(1) {
        let mut k = i; let mut p = g(d, i);
        for j in i + 1..n { if g(d, j) < p { k = j; p = g(d, j); } }
        if k != i {
            s(d, k, g(d, i)); s(d, i, p);
            for j in 0..n { let tt = g(vt, i * n + j); s(vt, i * n + j, g(vt, k * n + j)); s(vt, k * n + j, tt); }
        }
    }
    if rows == 0 { for i in 0..n { for j in 0..i { let tt = g(t, i * n + j); s(t, i * n + j, g(t, j * n + i)); s(t, j * n + i, tt); } } }
    0
}
