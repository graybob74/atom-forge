//! Experimental → More forces (xforces.js, 1.34) and the dipoles' solve (pold.js), in the module (1.34.3: the owner,
//! "can you do a wasm pass for every major slowdown setting?"). Each function is its JavaScript twin's loops, in the same
//! order with the same arithmetic, over compact arrays the JavaScript gathers into the module's memory (an i32 table of
//! byte offsets, t, and an f64 table of numbers, p); forces are added into compact output arrays the JavaScript scatters.
//! The only differences from the JavaScript are in exp and pow (the last bit). No statics, no allocation (fixed-size
//! buffers on the stack).
#![allow(clippy::needless_range_loop)]

#[inline(always)]
unsafe fn o<T>(t: *const i32, k: usize) -> *mut T { *t.add(k) as u32 as usize as *mut T }
#[inline(always)]
unsafe fn r<T: Copy>(p: *const T, i: usize) -> T { *p.add(i) }
#[inline(always)]
unsafe fn add(p: *mut f64, i: usize, v: f64) { *p.add(i) += v; }

#[inline(always)]
fn img(mut dx: f64, mut dy: f64, mut dz: f64, wrap: bool, d3: bool, bw: f64, bh: f64, bd: f64) -> (f64, f64, f64) {
    if wrap {
        if dx > bw / 2.0 { dx -= bw; } else if dx < -bw / 2.0 { dx += bw; }
        if dy > bh / 2.0 { dy -= bh; } else if dy < -bh / 2.0 { dy += bh; }
        if d3 { if dz > bd / 2.0 { dz -= bd; } else if dz < -bd / 2.0 { dz += bd; } }
    }
    (dx, dy, dz)
}

/* ---- every pair: gravity (mode 0) or full-range partial charges (mode 1) -------------------------------------------
   t: 0 x, 1 y, 2 z, 3 w (mass or charge), 4 fl (i32: bit 0 in the long-range sum, bit 1 ionic), 5 q0 (net charge),
      6 fx, 7 fy, 8 fz (out, compact, added to)
   p: 0 n, 1 mode, 2 d3, 3 wrap, 4 bw, 5 bh, 6 bd, 7 grad, 8 G or k, 9 cutoff² (gravity), 10 1/cutoff (gravity),
      11 RC, 12 RC², 13 K_IW (1 in 3-D)                                                        returns the energy (eV) */
#[no_mangle]
pub unsafe extern "C" fn af_xf_pairs(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64;
    let x: *const f64 = o(t, 0); let y: *const f64 = o(t, 1); let z: *const f64 = o(t, 2); let w: *const f64 = o(t, 3);
    let fl: *const i32 = o(t, 4); let q0: *const f64 = o(t, 5); let fx: *mut f64 = o(t, 6); let fy: *mut f64 = o(t, 7); let fz: *mut f64 = o(t, 8);
    let n = r(p, 0) as usize; let mode = r(p, 1) as i32; let d3 = r(p, 2) != 0.0; let wrap = r(p, 3) != 0.0;
    let bw = r(p, 4); let bh = r(p, 5); let bd = r(p, 6); let grad = r(p, 7) != 0.0; let k = r(p, 8);
    let rc2g = r(p, 9); let irc = r(p, 10); let rc = r(p, 11); let rc2 = r(p, 12); let kiw = r(p, 13);
    let mut u = 0.0;
    for i in 0..n {
        let xi = r(x, i); let yi = r(y, i); let zi = if d3 { r(z, i) } else { 0.0 };
        for j in (i + 1)..n {
            let (dx, dy, dz) = img(r(x, j) - xi, r(y, j) - yi, if d3 { r(z, j) - zi } else { 0.0 }, wrap, d3, bw, bh, bd);
            let r2 = dx * dx + dy * dy + dz * dz;
            if mode == 0 {
                if r2 >= rc2g || r2 < 1e-6 { continue; }
                let rr = r2.sqrt(); let gm = k * r(w, i) * r(w, j); u -= gm * (1.0 / rr - irc);
                if !grad { continue; }
                let f = gm / (r2 * rr);
                add(fx, i, f * dx); add(fy, i, f * dy); add(fx, j, -f * dx); add(fy, j, -f * dy); if d3 { add(fz, i, f * dz); add(fz, j, -f * dz); }
            } else {
                let fi = r(fl, i); let fj = r(fl, j);
                if (fi & 1) != 0 && (fj & 1) != 0 { continue; }
                let ii = (fi & 2) != 0; let ij = (fj & 2) != 0;
                let c = (if ii != ij && (if ii { r(q0, j) == 0.0 } else { r(q0, i) == 0.0 }) { kiw } else { 1.0 }) * k * r(w, i) * r(w, j);
                if r2 <= rc2 { u += c / rc; continue; }
                let rr = r2.sqrt(); u += c / rr;
                if !grad { continue; }
                let f = c / (r2 * rr);
                add(fx, i, -f * dx); add(fy, i, -f * dy); add(fx, j, f * dx); add(fy, j, f * dy); if d3 { add(fz, i, -f * dz); add(fz, j, f * dz); }
            }
        }
    }
    u
}

/* ---- the three-body dispersion (D3's Axilrod–Teller–Muto) over every triple within the cutoff ----------------------
   t: 0 x, 1 y, 2 z, 3 sp (i32 species), 4 c6 (ns×ns, Hartree·Bohr⁶), 5 r0 (ns×ns, Bohr), 6 head (i32, cells),
      7 next (i32, n), 8 fx, 9 fy, 10 fz (out)
   p: 0 n, 1 ns, 2 d3, 3 wrap, 4 bw, 5 bh, 6 bd, 7 grad, 8 cutoff (5 Å), 9 taper start (4 Å), 10 C9 unit, 11 Bohr³,
      12 cells (the head array's length)                                                       returns the energy (eV) */
const NB_MAX: usize = 768;
#[inline(always)]
fn sw(rr: f64, t0: f64, tr: f64) -> (f64, f64) {
    if rr <= t0 { return (1.0, 0.0); }
    if rr >= tr { return (0.0, 0.0); }
    let t = (rr - t0) / (tr - t0); (1.0 - t * t * (3.0 - 2.0 * t), -6.0 * t * (1.0 - t) / (tr - t0))
}
#[inline(always)]
fn atm_e(c6ab: f64, c6bc: f64, c6ca: f64, r0ab: f64, r0bc: f64, r0ca: f64, a: f64, b: f64, c: f64, grad: bool, c9u: f64, b3: f64, t0: f64, tr: f64, g: &mut [f64; 3]) -> f64 {
    let c9 = (c6ab * c6bc * c6ca).abs().sqrt() * c9u; let r0 = r0ab * r0bc * r0ca * b3;
    let a2 = a * a; let b2 = b * b; let c2 = c * c; let xx = a2 + b2 - c2; let yy = a2 - b2 + c2; let zq = -a2 + b2 + c2; let nn = xx * yy * zq;
    let pp = a * b * c; let p3 = pp * pp * pp; let p5 = p3 * pp * pp;
    let ang = 0.375 * nn / p5 + 1.0 / p3; let tq = r0 / pp; let t2 = tq * tq; let q = 6.0 * t2 * t2 * tq * tq.cbrt(); let fd = 1.0 / (1.0 + q); // ((r0/P)^(16/3) as t⁵·∛t: far cheaper than pow)
    let (sa, da) = sw(a, t0, tr); let (sb, db) = sw(b, t0, tr); let (sc, dc) = sw(c, t0, tr);
    let s = sa * sb * sc; let e = c9 * ang * fd * s;
    if grad {
        let dadp = -5.0 * 0.375 * nn / (p5 * pp) - 3.0 / (p3 * pp); let dfdp = (16.0 / 3.0) * q / pp * fd * fd; let base = c9 * s;
        let dedp = base * (dadp * fd + ang * dfdp); let k1 = base * fd * 0.375 / p5; let k2 = c9 * ang * fd;
        g[0] = k1 * 2.0 * a * (yy * zq + xx * zq - xx * yy) + dedp * pp / a + k2 * da * sb * sc;
        g[1] = k1 * 2.0 * b * (yy * zq - xx * zq + xx * yy) + dedp * pp / b + k2 * sa * db * sc;
        g[2] = k1 * 2.0 * c * (-yy * zq + xx * zq + xx * yy) + dedp * pp / c + k2 * sa * sb * dc;
    }
    e
}
#[no_mangle]
pub unsafe extern "C" fn af_xf_atm(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64;
    let x: *const f64 = o(t, 0); let y: *const f64 = o(t, 1); let z: *const f64 = o(t, 2); let sp: *const i32 = o(t, 3);
    let c6t: *const f64 = o(t, 4); let r0t: *const f64 = o(t, 5); let head: *mut i32 = o(t, 6); let next: *mut i32 = o(t, 7);
    let fx: *mut f64 = o(t, 8); let fy: *mut f64 = o(t, 9); let fz: *mut f64 = o(t, 10);
    let n = r(p, 0) as usize; let ns = r(p, 1) as usize; let d3 = r(p, 2) != 0.0; let wrap = r(p, 3) != 0.0;
    let bw = r(p, 4); let bh = r(p, 5); let bd = r(p, 6); let grad = r(p, 7) != 0.0; let tr = r(p, 8); let t0 = r(p, 9);
    let c9u = r(p, 10); let b3 = r(p, 11); let ncap = r(p, 12) as usize; let tr2 = tr * tr;
    // cells at least the cutoff across (wrapping walls: at least three a side, or every pair is looked at)
    let mut nx = ((bw / tr).floor() as usize).max(1); let mut ny = ((bh / tr).floor() as usize).max(1); let mut nz = if d3 { ((bd / tr).floor() as usize).max(1) } else { 1 };
    while nx * ny * nz > ncap { if nx >= ny && nx >= nz { nx = (nx / 2).max(1); } else if ny >= nz { ny = (ny / 2).max(1); } else { nz = (nz / 2).max(1); } }
    let cells = !(wrap && (nx < 3 || ny < 3 || (d3 && nz < 3)));
    let cx = |v: f64, l: f64, m: usize| -> usize { let k = ((v + l / 2.0) / l * m as f64).floor(); if k < 0.0 { 0 } else if k as usize >= m { m - 1 } else { k as usize } };
    if cells {
        for c in 0..nx * ny * nz { *head.add(c) = -1; }
        for i in (0..n).rev() { let c = cx(r(x, i), bw, nx) + nx * (cx(r(y, i), bh, ny) + ny * if d3 { cx(r(z, i), bd, nz) } else { 0 }); *next.add(i) = *head.add(c); *head.add(c) = i as i32; }
    }
    let mut lj = [0u32; NB_MAX]; let mut lr = [0f64; NB_MAX]; let mut lux = [0f64; NB_MAX]; let mut luy = [0f64; NB_MAX]; let mut luz = [0f64; NB_MAX];
    let mut g = [0f64; 3]; let mut u = 0.0;
    for a in 0..n {
        let xa = r(x, a); let ya = r(y, a); let za = if d3 { r(z, a) } else { 0.0 };
        let mut m = 0usize;
        let mut take = |j: usize, m: &mut usize| {
            if j <= a || *m >= NB_MAX { return; }
            let (dx, dy, dz) = img(r(x, j) - xa, r(y, j) - ya, if d3 { r(z, j) - za } else { 0.0 }, wrap, d3, bw, bh, bd);
            let r2 = dx * dx + dy * dy + dz * dz; if r2 >= tr2 || r2 < 1e-8 { return; }
            let rr = r2.sqrt(); lj[*m] = j as u32; lr[*m] = rr; lux[*m] = dx / rr; luy[*m] = dy / rr; luz[*m] = dz / rr; *m += 1;
        };
        if cells {
            let ia = cx(xa, bw, nx) as i64; let ja = cx(ya, bh, ny) as i64; let ka = if d3 { cx(za, bd, nz) as i64 } else { 0 };
            let (kz0, kz1) = if d3 { (-1i64, 1i64) } else { (0, 0) };
            for dk in kz0..=kz1 { for dj in -1i64..=1 { for di in -1i64..=1 {
                let (mut ci, mut cj, mut ck) = (ia + di, ja + dj, ka + dk);
                if wrap { ci = ci.rem_euclid(nx as i64); cj = cj.rem_euclid(ny as i64); ck = ck.rem_euclid(nz as i64); }
                else if ci < 0 || cj < 0 || ck < 0 || ci >= nx as i64 || cj >= ny as i64 || ck >= nz as i64 { continue; }
                let mut q = *head.add(ci as usize + nx * (cj as usize + ny * ck as usize));
                while q >= 0 { take(q as usize, &mut m); q = *next.add(q as usize); }
            } } }
        } else {
            for j in (a + 1)..n { take(j, &mut m); }
        }
        // (the list in index order, as the JavaScript's: so every triple's arithmetic is the same)
        for s in 1..m { let mut q = s; while q > 0 && lj[q - 1] > lj[q] { lj.swap(q - 1, q); lr.swap(q - 1, q); lux.swap(q - 1, q); luy.swap(q - 1, q); luz.swap(q - 1, q); q -= 1; } }
        let sa = r(sp, a) as usize;
        for jx in 0..m {
            let b = lj[jx] as usize; let sb = r(sp, b) as usize; let xb = r(x, b); let yb = r(y, b); let zb = if d3 { r(z, b) } else { 0.0 };
            let c6ab = r(c6t, sa * ns + sb); let r0ab = r(r0t, sa * ns + sb);
            for kx in (jx + 1)..m {
                let c = lj[kx] as usize; let sc = r(sp, c) as usize;
                let (dx, dy, dz) = img(r(x, c) - xb, r(y, c) - yb, if d3 { r(z, c) - zb } else { 0.0 }, wrap, d3, bw, bh, bd);
                let r2 = dx * dx + dy * dy + dz * dz; if r2 >= tr2 || r2 < 1e-8 { continue; }
                let rbc = r2.sqrt();
                let e = atm_e(c6ab, r(c6t, sb * ns + sc), r(c6t, sa * ns + sc), r0ab, r(r0t, sb * ns + sc), r(r0t, sa * ns + sc), lr[jx], rbc, lr[kx], grad, c9u, b3, t0, tr, &mut g);
                u += e;
                if !grad || e == 0.0 { continue; }
                let (ux, uy, uz) = (dx / rbc, dy / rbc, dz / rbc);
                add(fx, a, g[0] * lux[jx] + g[2] * lux[kx]); add(fy, a, g[0] * luy[jx] + g[2] * luy[kx]);
                add(fx, b, -g[0] * lux[jx] + g[1] * ux); add(fy, b, -g[0] * luy[jx] + g[1] * uy);
                add(fx, c, -g[1] * ux - g[2] * lux[kx]); add(fy, c, -g[1] * uy - g[2] * luy[kx]);
                if d3 { add(fz, a, g[0] * luz[jx] + g[2] * luz[kx]); add(fz, b, -g[0] * luz[jx] + g[1] * uz); add(fz, c, -g[1] * uz - g[2] * luz[kx]); }
            }
        }
    }
    u
}

/* ---- the induced dipoles' solve (pold.js pdUpdate: μ = α(E + E_dipoles), iterated from the old ones, mixed 0.3/0.7) --
   t: 0 pa, 1 pb (i32 store indices), 2 pg (f64, 8 a pair), 3 sl (i32 slot by store index, −1 none), 4 e, 5 et, 6 m (f64,
      3 a slot), 7 al (f64, 6 a slot)
   p: 0 np, 1 ns, 2 d3, 3 maxit, 4 tol                                                      returns the iterations taken */
#[no_mangle]
pub unsafe extern "C" fn af_pd_iter(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64;
    let pa: *const i32 = o(t, 0); let pb: *const i32 = o(t, 1); let pg: *const f64 = o(t, 2); let sl: *const i32 = o(t, 3);
    let e: *const f64 = o(t, 4); let et: *mut f64 = o(t, 5); let mm: *mut f64 = o(t, 6); let al: *const f64 = o(t, 7);
    let np = r(p, 0) as usize; let ns = r(p, 1) as usize; let d3 = r(p, 2) != 0.0; let maxit = r(p, 3) as usize; let tol = r(p, 4);
    let mut it = 0usize; let mut err = f64::INFINITY;
    while it < maxit && err > tol {
        for k in 0..3 * ns { *et.add(k) = r(e, k); }
        for k in 0..np {
            let sa = r(sl, r(pa, k) as usize); let sb = r(sl, r(pb, k) as usize); if sa < 0 || sb < 0 { continue; }
            let (sa, sb) = (sa as usize, sb as usize);
            let g = 8 * k; let dx = r(pg, g); let dy = r(pg, g + 1); let dz = r(pg, g + 2); let f1 = r(pg, g + 5); let f2 = r(pg, g + 6);
            let bd = r(mm, 3 * sb) * dx + r(mm, 3 * sb + 1) * dy + r(mm, 3 * sb + 2) * dz; let ad = r(mm, 3 * sa) * dx + r(mm, 3 * sa + 1) * dy + r(mm, 3 * sa + 2) * dz;
            add(et, 3 * sa, 2.0 * f1 * r(mm, 3 * sb) + 4.0 * f2 * bd * dx); add(et, 3 * sa + 1, 2.0 * f1 * r(mm, 3 * sb + 1) + 4.0 * f2 * bd * dy); add(et, 3 * sa + 2, 2.0 * f1 * r(mm, 3 * sb + 2) + 4.0 * f2 * bd * dz);
            add(et, 3 * sb, 2.0 * f1 * r(mm, 3 * sa) + 4.0 * f2 * ad * dx); add(et, 3 * sb + 1, 2.0 * f1 * r(mm, 3 * sa + 1) + 4.0 * f2 * ad * dy); add(et, 3 * sb + 2, 2.0 * f1 * r(mm, 3 * sa + 2) + 4.0 * f2 * ad * dz);
        }
        err = 0.0;
        for k in 0..ns {
            let a = 6 * k; let x = r(et, 3 * k); let y = r(et, 3 * k + 1); let zz = if d3 { r(et, 3 * k + 2) } else { 0.0 };
            let mx = r(al, a) * x + r(al, a + 1) * y + r(al, a + 2) * zz; let my = r(al, a + 1) * x + r(al, a + 3) * y + r(al, a + 4) * zz;
            let mz = if d3 { r(al, a + 2) * x + r(al, a + 4) * y + r(al, a + 5) * zz } else { 0.0 };
            let nx = 0.3 * r(mm, 3 * k) + 0.7 * mx; let ny = 0.3 * r(mm, 3 * k + 1) + 0.7 * my; let nz = 0.3 * r(mm, 3 * k + 2) + 0.7 * mz;
            let d = (nx - r(mm, 3 * k)).abs().max((ny - r(mm, 3 * k + 1)).abs()).max((nz - r(mm, 3 * k + 2)).abs()); if d > err { err = d; }
            *mm.add(3 * k) = nx; *mm.add(3 * k + 1) = ny; *mm.add(3 * k + 2) = nz;
        }
        it += 1;
    }
    it as f64
}

/* ---- nucleons inside nuclei (xforces.js xnForces and its steps: the Pandharipande medium potential, MeV, fm) -------- */
#[inline(always)]
fn xn_v(pi: bool, pj: bool, r: f64) -> (f64, f64) {
    let (mut v, mut f);
    if pi != pj {
        let er = (-1.7468 * r).exp(); let ea = (-1.6 * r).exp();
        v = 3088.118 * (er / r - 0.0000148706) - 2666.647 * (ea / r - 0.0000325516);
        f = 3088.118 * er * (1.7468 * r + 1.0) / (r * r) - 2666.647 * ea * (1.6 * r + 1.0) / (r * r);
    } else {
        let e0 = (-1.5468 * r).exp(); v = 373.118 * (e0 / r - 0.0000429836); f = 373.118 * e0 * (1.5468 * r + 1.0) / (r * r);
    }
    let pp = pi && pj;
    if pp { v += 1.44 / r; f += 1.44 / (r * r); }
    if r < 5.4 { (v, f / r) } else if pp { (1.44 / r, 1.44 / (r * r * r)) } else { (0.0, 0.0) }
}
unsafe fn xn_forces(n: usize, pr: *const i32, x: *const f64, f: *mut f64) -> f64 {
    for k in 0..3 * n { *f.add(k) = 0.0; }
    let mut u = 0.0;
    for i in 0..n { for j in (i + 1)..n {
        let dx = r(x, 3 * j) - r(x, 3 * i); let dy = r(x, 3 * j + 1) - r(x, 3 * i + 1); let dz = r(x, 3 * j + 2) - r(x, 3 * i + 2);
        let mut rr = (dx * dx + dy * dy + dz * dz).sqrt(); if rr == 0.0 { rr = 1e-6; }
        let pi = r(pr, i) != 0; let pj = r(pr, j) != 0;
        if rr >= 5.4 && !(pi && pj) { continue; }
        let (v, ff) = xn_v(pi, pj, rr.max(0.2)); u += v;
        add(f, 3 * i, -ff * dx); add(f, 3 * i + 1, -ff * dy); add(f, 3 * i + 2, -ff * dz); add(f, 3 * j, ff * dx); add(f, 3 * j + 1, ff * dy); add(f, 3 * j + 2, ff * dz);
    } }
    u
}
/* t: 0 pr (i32), 1 x, 2 v, 3 f (f64, 3 a nucleon)   p: 0 n, 1 steps, 2 dt, 3 mass, 4 mode (0: the forces only; 1: velocity
   Verlet steps; 2: cooling steps, v ← 0.92(v + dt·f/m), x += dt·v)                       returns the last potential energy */
#[no_mangle]
pub unsafe extern "C" fn af_xn_steps(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64;
    let pr: *const i32 = o(t, 0); let x: *mut f64 = o(t, 1); let v: *mut f64 = o(t, 2); let f: *mut f64 = o(t, 3);
    let n = r(p, 0) as usize; let steps = r(p, 1) as usize; let dt = r(p, 2); let m = r(p, 3); let mode = r(p, 4) as i32;
    if mode == 0 { return xn_forces(n, pr, x, f); }
    let mut u = 0.0;
    for _ in 0..steps {
        if mode == 1 {
            for i in 0..3 * n { *v.add(i) += 0.5 * dt * r(f, i) / m; *x.add(i) += dt * r(v, i); }
            u = xn_forces(n, pr, x, f);
            for i in 0..3 * n { *v.add(i) += 0.5 * dt * r(f, i) / m; }
        } else {
            for i in 0..3 * n { *v.add(i) = 0.92 * (r(v, i) + dt * r(f, i) / m); *x.add(i) += dt * r(v, i); }
            u = xn_forces(n, pr, x, f);
        }
    }
    u
}
