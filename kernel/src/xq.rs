//! Quantum bonds' dense linear algebra in the module (1.28.3, item 54, the owner's "do 1-3": the same results): the
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

/// symEig's first half: Householder to tridiagonal form (tred2) with the transformation accumulated in t (as rows of
/// the tridiagonal basis), d the diagonal, e the off-diagonal in e[1..] (e[0] = 0).
unsafe fn tridiag(t: *mut f64, d: *mut f64, e: *mut f64, n: usize) {
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
}

/// symEig(V, n, rows): V (n·n, row-major) in, its eigenvectors out (as rows when rows ≠ 0, else as columns), the
/// eigenvalues ascending into d (n); e (n) is scratch. Returns 0, or 1 when the QL iterations did not converge (the
/// JavaScript throws).
#[no_mangle]
pub unsafe extern "C" fn af_sym_eig(vp: u32, n: u32, rows: u32, dp: u32, ep: u32) -> i32 {
    let n = n as usize; let t = vp as usize as *mut f64; let d = dp as usize as *mut f64; let e = ep as usize as *mut f64;
    tridiag(t, d, e, n);
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

/// (1.29 item 62, Experimental → Quantum bonds → Faster) symEig for the orbitals that hold electrons only: the same
/// tridiagonal form and the same eigenvalues (QL without the vectors: its d and e are those of the full solver, to the
/// bit), then eigenvectors by inverse iteration on the tridiagonal matrix (LAPACK's dstein: three steps from a fixed
/// start, the clusters of close eigenvalues kept orthogonal by Gram–Schmidt) for the first k, k the orbitals up to
/// 40 kT above the highest of the nhi lowest (so every orbital with an occupation above about 10⁻¹⁷), carried back by
/// the accumulated transformation. Rows k.. of V are zeroed. Equal to the full solver to rounding, not to the bit.
/// w: scratch of 2·n·n + 8·n. Returns k, or −1 when the QL iterations did not converge.
#[no_mangle]
pub unsafe extern "C" fn af_sym_eig_k(vp: u32, n: u32, dp: u32, ep: u32, wp: u32, nhi: u32, kt: f64) -> i32 {
    let n = n as usize; let t = vp as usize as *mut f64; let d = dp as usize as *mut f64; let e = ep as usize as *mut f64; let w = wp as usize as *mut f64;
    if n == 0 { return 0; }
    tridiag(t, d, e, n);
    for i in 1..n { s(e, i - 1, g(e, i)); }
    s(e, n - 1, 0.0);
    let zb = w; let ob = w.add(n * n); let d0 = w.add(2 * n * n); let e0 = d0.add(n);
    let u1 = e0.add(n); let u2 = u1.add(n); let u3 = u2.add(n); let lm = u3.add(n); let piv = lm.add(n); let x = piv.add(n);
    for i in 0..n { s(d0, i, g(d, i)); s(e0, i, g(e, i)); }
    // eigenvalues: the QL iterations as af_sym_eig, without the vectors
    let mut f = 0.0; let mut tst1: f64 = 0.0; let eps = f64::EPSILON;
    for l in 0..n {
        let xx = g(d, l).abs() + g(e, l).abs();
        if xx > tst1 || xx.is_nan() || tst1.is_nan() { tst1 = if tst1.is_nan() { tst1 } else { xx }; }
        let mut m = l;
        while m < n { if g(e, m).abs() <= eps * tst1 { break; } m += 1; }
        if m > l {
            let mut iter = 0;
            loop {
                iter += 1; if iter > 100 { return -1; }
                let mut gg = g(d, l);
                let mut p = (g(d, l + 1) - gg) / (2.0 * g(e, l));
                let mut r = hypot2(p, 1.0);
                if p < 0.0 { r = -r; }
                s(d, l, g(e, l) / (p + r)); s(d, l + 1, g(e, l) * (p + r));
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
        if k != i { s(d, k, g(d, i)); s(d, i, p); }
    }
    let nh = (nhi as usize).clamp(1, n);
    let top = g(d, nh - 1) + 40.0 * kt;
    let mut k = nh; while k < n && g(d, k) <= top { k += 1; }
    // inverse iteration on (d0, e0)
    let mut onenrm = 0.0f64;
    for i in 0..n { let v = g(d0, i).abs() + g(e0, i).abs() + if i > 0 { g(e0, i - 1).abs() } else { 0.0 }; if v > onenrm { onenrm = v; } }
    let ortol = 1e-3 * onenrm; let pert = 10.0 * eps * onenrm.max(1e-300);
    let mut gpind = 0usize; let mut xjm = 0.0f64;
    for j in 0..k {
        let mut xj = g(d, j);
        if j > 0 { if xj - xjm < ortol { if xj - xjm < pert { xj = xjm + pert; } } else { gpind = j; } }
        // LU of T − xj·I with partial pivoting (dlagtf): u1 diagonal, u2 first and u3 second superdiagonal, lm multipliers
        s(u1, 0, g(d0, 0) - xj);
        if n > 1 { s(u2, 0, g(e0, 0)); }
        for i in 0..n.saturating_sub(1) {
            let sub = g(e0, i); let dn = g(d0, i + 1) - xj; let up = if i + 2 <= n - 1 { g(e0, i + 1) } else { 0.0 };
            if g(u1, i).abs() >= sub.abs() {
                let m = if g(u1, i) != 0.0 { sub / g(u1, i) } else { 0.0 };
                s(lm, i, m); s(piv, i, 0.0); s(u3, i, 0.0);
                s(u1, i + 1, dn - m * g(u2, i)); s(u2, i + 1, up);
            } else {
                let m = g(u1, i) / sub;
                s(lm, i, m); s(piv, i, 1.0);
                let a = g(u2, i);
                s(u1, i, sub); s(u2, i, dn); s(u3, i, up);
                s(u1, i + 1, a - m * dn); s(u2, i + 1, -m * up);
            }
        }
        let tiny = eps * onenrm.max(1e-300);
        for i in 0..n { if g(u1, i).abs() < tiny { s(u1, i, if g(u1, i) < 0.0 { -tiny } else { tiny }); } }
        for i in 0..n { s(x, i, 1.0 + 0.5 * ((1.7 * i as f64) + 0.37 * j as f64).sin()); } // (a fixed start, no random numbers)
        for _it in 0..3 {
            // solve L U y = x: the row exchanges and multipliers, then back substitution
            for i in 0..n.saturating_sub(1) {
                if g(piv, i) == 0.0 { s(x, i + 1, g(x, i + 1) - g(lm, i) * g(x, i)); }
                else { let a = g(x, i); s(x, i, g(x, i + 1)); s(x, i + 1, a - g(lm, i) * g(x, i + 1)); }
            }
            let mut i = n as isize - 1;
            while i >= 0 {
                let iu = i as usize; let mut v = g(x, iu);
                if iu + 1 < n { v -= g(u2, iu) * g(x, iu + 1); }
                if iu + 2 < n { v -= g(u3, iu) * g(x, iu + 2); }
                s(x, iu, v / g(u1, iu)); i -= 1;
            }
            for jj in gpind..j { // (Gram–Schmidt against the cluster's vectors found so far)
                let zj = zb.add(jj * n); let mut dot = 0.0; for q in 0..n { dot += g(zj, q) * g(x, q); }
                for q in 0..n { s(x, q, g(x, q) - dot * g(zj, q)); }
            }
            let mut nr = 0.0; for q in 0..n { nr += g(x, q) * g(x, q); } nr = nr.sqrt();
            if !(nr > 0.0) { return -1; }
            for q in 0..n { s(x, q, g(x, q) / nr); }
        }
        let zj = zb.add(j * n); for q in 0..n { s(zj, q, g(x, q)); }
        xjm = xj;
    }
    // back to the original basis: row j = Σ_i z_j[i] · t[i, :]
    for j in 0..k {
        let zj = zb.add(j * n); let oj = ob.add(j * n);
        for q in 0..n { s(oj, q, 0.0); }
        for i in 0..n { let c = g(zj, i); if c == 0.0 { continue; } let ti = i * n; for q in 0..n { s(oj, q, g(oj, q) + c * g(t, ti + q)); } }
    }
    for j in 0..k { for q in 0..n { s(t, j * n + q, g(ob, j * n + q)); } }
    for j in k..n { for q in 0..n { s(t, j * n + q, 0.0); } }
    k as i32
}

/// gfn1.js / gfn2.js, each SCC iteration: W = Li·H1 (its lower triangle) and A = W·Liᵀ (symmetric), the same sums in
/// the same order. Row-major nao·nao arrays by byte offset.
#[no_mangle]
pub unsafe extern "C" fn af_xq_trans(lp: u32, hp: u32, wp: u32, ap: u32, nao: u32) {
    let n = nao as usize; let li = lp as usize as *const f64; let h1 = hp as usize as *const f64; let w = wp as usize as *mut f64; let a = ap as usize as *mut f64;
    for m in 0..n {
        let wm = m * n;
        for c in 0..=m { let hn = c * n; let mut v = 0.0; for k in 0..=m { v += g(li, wm + k) * g(h1, hn + k); } s(w, wm + c, v); }
    }
    for m in 0..n { for c in 0..=m {
        let mut v = 0.0; for k in 0..=c { v += g(w, m * n + k) * g(li, c * n + k); }
        s(a, m * n + c, v); s(a, c * n + m, v);
    } }
}

/// And after the eigen-solver: C = Liᵀ·Y for the orbitals holding anything (ncol columns, the rest 0), Cf = C·f for
/// the first nk (focc > 1e-15, else 0), and the density P = Cf·Cᵀ (symmetric).
#[no_mangle]
pub unsafe extern "C" fn af_xq_dens(ltp: u32, ap: u32, cp: u32, ctp: u32, pp: u32, fp: u32, nao: u32, ncol: u32, nk: u32) {
    let n = nao as usize; let ncol = ncol as usize; let nk = nk as usize;
    let lit = ltp as usize as *const f64; let a = ap as usize as *const f64; let c = cp as usize as *mut f64; let cf = ctp as usize as *mut f64; let p = pp as usize as *mut f64; let focc = fp as usize as *const f64;
    for m in 0..n {
        let cm = m * n;
        for col in 0..ncol { let yn = col * n; let mut v = 0.0; for k in m..n { v += g(lit, cm + k) * g(a, yn + k); } s(c, cm + col, v); }
        for col in ncol..n { s(c, cm + col, 0.0); }
    }
    for m in 0..n { for k in 0..nk { let f = g(focc, k); s(cf, m * n + k, if f > 1e-15 { g(c, m * n + k) * f } else { 0.0 }); } }
    for m in 0..n {
        let pm = m * n;
        for col in m..n { let cn = col * n; let mut v = 0.0; for k in 0..nk { v += g(cf, pm + k) * g(c, cn + k); } s(p, pm + col, v); s(p, cn + m, v); }
    }
}
