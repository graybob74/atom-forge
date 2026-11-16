//! The Bose–Einstein condensate lab (1.35: the owner, "do 2d and 3d in one pass now and code it in wasm"): the
//! Gross–Pitaevskii equation i∂ψ/∂t = [−½∇² + V + β|ψ|²]ψ in trap units (length √(ħ/mω₀), time 1/ω₀, energy ħω₀), on a
//! grid of 2^k points an axis (2-D: nz = 1), by the split-operator Fourier method (Strang: half a potential step, a
//! kinetic step in k-space, half a potential step; consecutive halves merged), in real time (with optional damping γ,
//! ψ's phase relaxing toward the ground state) or imaginary time (the ground state). The JavaScript (src/bec.js) keeps
//! ψ in the module's memory and draws it. Inner functions work on slices (tested natively); the exports take an i32
//! table of byte offsets (t) and an f64 table of numbers (p), as the rest of the kernel.
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

use crate::fastmath::exp_fast;
use core::f64::consts::PI;

/// sin and cos of x (|x| up to about 10⁶), by reduction to [−π/4, π/4] and their series (relative error ~10⁻¹⁴).
#[inline(always)]
pub fn sincos(x: f64) -> (f64, f64) {
    let k = (x * (2.0 / PI)).round();
    let r = (x - k * 1.570_796_326_794_896_558) - k * 6.123_233_995_736_766e-17;
    let r2 = r * r;
    let s = r + r * r2 * (-1.0 / 6.0 + r2 * (1.0 / 120.0 + r2 * (-1.0 / 5040.0 + r2 * (1.0 / 362_880.0 + r2 * (-1.0 / 39_916_800.0 + r2 * (1.0 / 6_227_020_800.0))))));
    let c = 1.0 + r2 * (-0.5 + r2 * (1.0 / 24.0 + r2 * (-1.0 / 720.0 + r2 * (1.0 / 40_320.0 + r2 * (-1.0 / 3_628_800.0 + r2 * (1.0 / 479_001_600.0 + r2 * (-1.0 / 87_178_291_200.0)))))));
    match (k as i64).rem_euclid(4) { 0 => (s, c), 1 => (c, -s), 2 => (-s, -c), _ => (-c, s) }
}

/// An in-place radix-2 FFT of n points (n a power of two ≤ the table's size m): tw holds cos and −sin of 2πk/m for
/// k < m/2 (re in twr, im in twi); inverse: the conjugate twiddles, unscaled.
pub fn fft(re: &mut [f64], im: &mut [f64], n: usize, inv: bool, twr: &[f64], twi: &[f64], m: usize) {
    if n < 2 { return; }
    let mut j = 0usize;
    for i in 1..n { let mut bit = n >> 1; while j & bit != 0 { j ^= bit; bit >>= 1; } j |= bit; if i < j { re.swap(i, j); im.swap(i, j); } }
    let mut len = 2;
    while len <= n {
        let half = len / 2; let step = m / len;
        let mut i = 0;
        while i < n {
            for k in 0..half {
                let (wr, mut wi) = (twr[k * step], twi[k * step]); if inv { wi = -wi; }
                let a = i + k; let b = a + half;
                let xr = re[b] * wr - im[b] * wi; let xi = re[b] * wi + im[b] * wr;
                re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
            }
            i += len;
        }
        len <<= 1;
    }
}

/// The same transform on n "elements" that are runs of w contiguous numbers, element j at base + j·stride (the y and z
/// axes: every butterfly works on whole rows of x at once, contiguous in memory).
pub fn fft_lines(re: &mut [f64], im: &mut [f64], base: usize, n: usize, stride: usize, w: usize, inv: bool, twr: &[f64], twi: &[f64], m: usize) {
    if n < 2 { return; }
    let mut j = 0usize;
    for i in 1..n { let mut bit = n >> 1; while j & bit != 0 { j ^= bit; bit >>= 1; } j |= bit;
        if i < j { let (a, b) = (base + i * stride, base + j * stride); for k in 0..w { re.swap(a + k, b + k); im.swap(a + k, b + k); } } }
    let mut len = 2;
    while len <= n {
        let half = len / 2; let step = m / len;
        let mut i = 0;
        while i < n {
            for k in 0..half {
                let (wr, mut wi) = (twr[k * step], twi[k * step]); if inv { wi = -wi; }
                let a = base + (i + k) * stride; let b = a + half * stride;
                let (ra, rb) = re.split_at_mut(b); let (ia, ib) = im.split_at_mut(b);
                let (ra, ia) = (&mut ra[a..a + w], &mut ia[a..a + w]); let (rb, ib) = (&mut rb[..w], &mut ib[..w]);
                for q in 0..w {
                    let xr = rb[q] * wr - ib[q] * wi; let xi = rb[q] * wi + ib[q] * wr;
                    rb[q] = ra[q] - xr; ib[q] = ia[q] - xi; ra[q] += xr; ia[q] += xi;
                }
            }
            i += len;
        }
        len <<= 1;
    }
}

/// The 2-D or 3-D transform of ψ (x fastest): x line by line, y and z as whole rows (fft_lines).
pub fn fft_nd(re: &mut [f64], im: &mut [f64], nx: usize, ny: usize, nz: usize, inv: bool, twr: &[f64], twi: &[f64], m: usize, _lr: &mut [f64], _li: &mut [f64]) {
    for row in 0..ny * nz { let o = row * nx; fft(&mut re[o..o + nx], &mut im[o..o + nx], nx, inv, twr, twi, m); }
    if ny > 1 { for k in 0..nz { fft_lines(re, im, k * nx * ny, ny, nx, nx, inv, twr, twi, m); } }
    if nz > 1 { fft_lines(re, im, 0, nz, nx * ny, nx * ny, inv, twr, twi, m); }
}

#[inline(always)]
fn kof(i: usize, n: usize, d: f64) -> f64 { let ii = if i < n / 2 { i as f64 } else { i as f64 - n as f64 }; 2.0 * PI * ii / (n as f64 * d) }

/// The kinetic step's factors (1/n folded in; the spectrum's top half cut): real time e^{−i k²/2·dt(1 − iγ)}, imaginary time e^{−k²/2·dt}.
pub fn kin(kr: &mut [f64], ki: &mut [f64], nx: usize, ny: usize, nz: usize, dx: f64, dy: f64, dz: f64, dt: f64, gamma: f64, imag: bool) {
    let inv = 1.0 / (nx * ny * nz) as f64;
    for k in 0..nz { let kz = if nz > 1 { kof(k, nz, dz) } else { 0.0 };
        for j in 0..ny { let ky = if ny > 1 { kof(j, ny, dy) } else { 0.0 };
            for i in 0..nx { let kx = kof(i, nx, dx); let a = 0.5 * (kx * kx + ky * ky + kz * kz) * dt; let q = i + nx * (j + ny * k);
                // the top of the spectrum filtered out (beyond half the grid's k_max, by ellipse): it is where the split-step
                // method with a nonlinearity goes unstable (k²dt/2 near π/2) and where aliasing lives; the condensate needs
                // nothing there (its healing length is resolved well inside)
                let s2 = (kx * dx / PI).powi(2) + if ny > 1 { (ky * dy / PI).powi(2) } else { 0.0 } + if nz > 1 { (kz * dz / PI).powi(2) } else { 0.0 };
                if s2 > 0.25 { kr[q] = 0.0; ki[q] = 0.0; continue; }
                if imag { kr[q] = exp_fast(-a) * inv; ki[q] = 0.0; }
                else { let mg = exp_fast(-gamma * a) * inv; let (s, c) = sincos(a); kr[q] = mg * c; ki[q] = -mg * s; }
            } } }
}

pub struct Pot { pub nx: usize, pub ny: usize, pub nz: usize, pub dx: f64, pub dy: f64, pub dz: f64, pub cx: f64, pub cy: f64, pub cz: f64, pub trap: f64,
    pub beta: f64, pub eps: f64, pub om: f64, pub bar_a: f64, pub bar_w: f64, pub absorb: f64, pub gamma: f64, pub imag: bool, pub k3: f64, pub mu: f64, pub sp_a: f64, pub sp_x: f64, pub sp_y: f64, pub sp_w: f64, pub rot: f64 }

/// ψ ← e^{−i(V + β|ψ|² − μ − iW − ik₃|ψ|⁴)τ(1 − iγ)}ψ (k₃: three-body loss) (imaginary time: e^{−(V + β|ψ|²)τ}) at time t (the stirrer's angle Ω t); W the
/// absorbing edge (its last tenth of each axis, rising as the square).
pub fn pot(re: &mut [f64], im: &mut [f64], q: &Pot, tau: f64, t: f64) {
    let (sn, cs) = sincos(q.om * t);
    let hx = 0.5 * q.nx as f64; let hy = 0.5 * q.ny as f64; let hz = 0.5 * q.nz as f64;
    let edge = |i: usize, n: usize| -> f64 { if n < 2 { return 0.0; } let f = (i as f64 + 0.5) / n as f64; let d = (f.min(1.0 - f)) / 0.1; if d >= 1.0 { 0.0 } else { (1.0 - d) * (1.0 - d) } };
    for k in 0..q.nz { let z = if q.nz > 1 { (k as f64 - hz) * q.dz } else { 0.0 }; let ez = edge(k, q.nz);
        for j in 0..q.ny { let y = (j as f64 - hy) * q.dy; let ey = edge(j, q.ny);
            for i in 0..q.nx { let x = (i as f64 - hx) * q.dx; let ix = i + q.nx * (j + q.ny * k);
                let rho = re[ix] * re[ix] + im[ix] * im[ix];
                let mut v = q.trap * (q.cx * x * x + q.cy * y * y + q.cz * z * z) + q.beta * rho;
                if q.rot != 0.0 { v -= 0.5 * q.rot * q.rot * (x * x + y * y); } // (K − ΩL_z = ½(p − Ω×r)² − ½Ω²r²: the rest is in kin_rot)
                if q.eps != 0.0 { let u = x * cs + y * sn; let w = -x * sn + y * cs; v += q.eps * 0.5 * (u * u - w * w); }
                if q.bar_a != 0.0 { v += q.bar_a * exp_fast(-x * x / (2.0 * q.bar_w * q.bar_w)); }
                if q.sp_a != 0.0 { let (u, w) = (x - q.sp_x, y - q.sp_y); v += q.sp_a * exp_fast(-(u * u + w * w) / (2.0 * q.sp_w * q.sp_w)); }
                v -= q.mu;
                let (mg, ph) = if q.imag { (exp_fast(-v * tau), 0.0) } else {
                    let wabs = if q.absorb > 0.0 { q.absorb * (edge(i, q.nx) + ey + ez) } else { 0.0 };
                    (exp_fast(-tau * (q.gamma * v + wabs + q.k3 * rho * rho)), -tau * v) };
                let (s, c) = if ph != 0.0 { sincos(ph) } else { (0.0, 1.0) };
                let a = re[ix]; let b = im[ix];
                re[ix] = mg * (a * c - b * s); im[ix] = mg * (a * s + b * c);
            } } }
}

/// The kinetic step in a frame turning at Ω about z (Bao & Wang's alternating directions): K − ΩL_z = ½(p_x + Ωy)² +
/// ½(p_y − Ωx)² + ½p_z² − ½Ω²r², the first two each a shift in k along one axis that depends on the other coordinate:
/// x lines transformed and multiplied by f(k_x + Ωy), then y lines by f(k_y − Ωx), then z (f the free step's factor;
/// each axis's top half of k filtered, as kin).
pub fn kin_rot(re: &mut [f64], im: &mut [f64], q: &Pot, dt: f64, twr: &[f64], twi: &[f64], m: usize) {
    let (nx, ny, nz) = (q.nx, q.ny, q.nz); let hx = 0.5 * nx as f64; let hy = 0.5 * ny as f64;
    let f = |k: f64, cut: bool| -> (f64, f64) { if cut { return (0.0, 0.0); } let a = 0.5 * k * k * dt;
        if q.imag { (exp_fast(-a), 0.0) } else { let mg = exp_fast(-q.gamma * a); let (s, c) = sincos(a); (mg * c, -mg * s) } };
    let mul = |re: &mut [f64], im: &mut [f64], i: usize, fr: f64, fi: f64, sc: f64| { let a = re[i]; let b = im[i]; re[i] = (a * fr - b * fi) * sc; im[i] = (a * fi + b * fr) * sc; };
    let cutk = |i: usize, n: usize| -> bool { let ii = if i < n / 2 { i } else { n - i }; ii as f64 > 0.25 * n as f64 };
    for k in 0..nz { for j in 0..ny { let y = (j as f64 - hy) * q.dy; let o = nx * (j + ny * k);
        fft(&mut re[o..o + nx], &mut im[o..o + nx], nx, false, twr, twi, m);
        for i in 0..nx { let (fr, fi) = f(kof(i, nx, q.dx) + q.rot * y, cutk(i, nx)); mul(re, im, o + i, fr, fi, 1.0 / nx as f64); }
        fft(&mut re[o..o + nx], &mut im[o..o + nx], nx, true, twr, twi, m);
    } }
    for k in 0..nz { let base = k * nx * ny;
        fft_lines(re, im, base, ny, nx, nx, false, twr, twi, m);
        for j in 0..ny { let ky = kof(j, ny, q.dy); let c = cutk(j, ny); for i in 0..nx { let x = (i as f64 - hx) * q.dx; let (fr, fi) = f(ky - q.rot * x, c); mul(re, im, base + i + nx * j, fr, fi, 1.0 / ny as f64); } }
        fft_lines(re, im, base, ny, nx, nx, true, twr, twi, m);
    }
    if nz > 1 {
        fft_lines(re, im, 0, nz, nx * ny, nx * ny, false, twr, twi, m);
        for k in 0..nz { let (fr, fi) = f(kof(k, nz, q.dz), cutk(k, nz)); for i in 0..nx * ny { mul(re, im, i + nx * ny * k, fr, fi, 1.0 / nz as f64); } }
        fft_lines(re, im, 0, nz, nx * ny, nx * ny, true, twr, twi, m);
    }
}

/// steps of dt from t0: V(dt/2) [K V(dt)]… K V(dt/2); then, with renorm, ψ scaled to ∫|ψ|² = 1. Returns ∫|ψ|² before.
pub fn step(re: &mut [f64], im: &mut [f64], kr: &[f64], ki: &[f64], q: &Pot, dt: f64, steps: usize, t0: f64, renorm: bool,
            twr: &[f64], twi: &[f64], m: usize, lr: &mut [f64], li: &mut [f64]) -> f64 {
    let n = q.nx * q.ny * q.nz;
    let dv = q.dx * q.dy * (if q.nz > 1 { q.dz } else { 1.0 });
    if q.imag { // imaginary time: each step whole and ψ renormalized after it (else β|ψ|² fades as ψ decays)
        let mut nrm = 1.0;
        for _ in 0..steps {
            pot(re, im, q, 0.5 * dt, t0);
            if q.rot != 0.0 { kin_rot(re, im, q, dt, twr, twi, m); } else {
                fft_nd(re, im, q.nx, q.ny, q.nz, false, twr, twi, m, lr, li);
                for i in 0..n { let a = re[i]; let b = im[i]; re[i] = a * kr[i] - b * ki[i]; im[i] = a * ki[i] + b * kr[i]; }
                fft_nd(re, im, q.nx, q.ny, q.nz, true, twr, twi, m, lr, li);
            }
            pot(re, im, q, 0.5 * dt, t0);
            nrm = 0.0; for i in 0..n { nrm += re[i] * re[i] + im[i] * im[i]; } nrm *= dv;
            if nrm > 0.0 { let f = 1.0 / nrm.sqrt(); for i in 0..n { re[i] *= f; im[i] *= f; } }
        }
        return nrm;
    }
    pot(re, im, q, 0.5 * dt, t0);
    for s in 0..steps {
        if q.rot != 0.0 { kin_rot(re, im, q, dt, twr, twi, m); } else {
            fft_nd(re, im, q.nx, q.ny, q.nz, false, twr, twi, m, lr, li);
            for i in 0..n { let a = re[i]; let b = im[i]; re[i] = a * kr[i] - b * ki[i]; im[i] = a * ki[i] + b * kr[i]; }
            fft_nd(re, im, q.nx, q.ny, q.nz, true, twr, twi, m, lr, li);
        }
        pot(re, im, q, if s + 1 == steps { 0.5 * dt } else { dt }, t0 + (s as f64 + 1.0) * dt);
    }
    let mut nrm = 0.0; for i in 0..n { nrm += re[i] * re[i] + im[i] * im[i]; } nrm *= dv;
    if renorm && nrm > 0.0 { let f = 1.0 / nrm.sqrt(); for i in 0..n { re[i] *= f; im[i] *= f; } }
    nrm
}

/// What is measured (per atom, trap units): 0 ∫|ψ|², 1 trap energy, 2 interaction ½β∫|ψ|⁴, 3 kinetic ½∫|∇ψ|² (central
/// differences), 4–6 ⟨x²⟩ ⟨y²⟩ ⟨z²⟩, 7 the peak |ψ|², 8 ⟨L_z⟩ (−i(x∂_y − y∂_x)).
pub fn obs(re: &[f64], im: &[f64], q: &Pot, out: &mut [f64]) {
    for o in out.iter_mut().take(9) { *o = 0.0; }
    let hx = 0.5 * q.nx as f64; let hy = 0.5 * q.ny as f64; let hz = 0.5 * q.nz as f64;
    let dv = q.dx * q.dy * (if q.nz > 1 { q.dz } else { 1.0 });
    let at = |i: isize, j: isize, k: isize| -> usize { let i = i.rem_euclid(q.nx as isize) as usize; let j = j.rem_euclid(q.ny as isize) as usize; let k = k.rem_euclid(q.nz as isize) as usize; i + q.nx * (j + q.ny * k) };
    for k in 0..q.nz { let z = if q.nz > 1 { (k as f64 - hz) * q.dz } else { 0.0 };
        for j in 0..q.ny { let y = (j as f64 - hy) * q.dy;
            for i in 0..q.nx { let x = (i as f64 - hx) * q.dx; let ix = i + q.nx * (j + q.ny * k);
                let rho = re[ix] * re[ix] + im[ix] * im[ix];
                out[0] += rho; out[1] += (q.cx * x * x + q.cy * y * y + q.cz * z * z) * rho; out[2] += 0.5 * q.beta * rho * rho;
                out[4] += x * x * rho; out[5] += y * y * rho; out[6] += z * z * rho; if rho > out[7] { out[7] = rho; }
                let (ii, jj, kk) = (i as isize, j as isize, k as isize);
                // fourth-order central differences: (−f₂ + 8f₁ − 8f₋₁ + f₋₂)/12h
                let d4 = |p2: usize, p1: usize, m1: usize, m2: usize, h: f64| -> (f64, f64) {
                    ((-re[p2] + 8.0 * re[p1] - 8.0 * re[m1] + re[m2]) / (12.0 * h), (-im[p2] + 8.0 * im[p1] - 8.0 * im[m1] + im[m2]) / (12.0 * h)) };
                let (dxr, dxi) = d4(at(ii + 2, jj, kk), at(ii + 1, jj, kk), at(ii - 1, jj, kk), at(ii - 2, jj, kk), q.dx);
                let (dyr, dyi) = if q.ny > 1 { d4(at(ii, jj + 2, kk), at(ii, jj + 1, kk), at(ii, jj - 1, kk), at(ii, jj - 2, kk), q.dy) } else { (0.0, 0.0) };
                let (dzr, dzi) = if q.nz > 1 { d4(at(ii, jj, kk + 2), at(ii, jj, kk + 1), at(ii, jj, kk - 1), at(ii, jj, kk - 2), q.dz) } else { (0.0, 0.0) };
                out[3] += 0.5 * (dxr * dxr + dxi * dxi + dyr * dyr + dyi * dyi + dzr * dzr + dzi * dzi);
                // ψ*(−i)(x∂y − y∂x)ψ, its real part: x(re ∂y im − im ∂y re) − y(re ∂x im − im ∂x re)
                out[8] += x * (re[ix] * dyi - im[ix] * dyr) - y * (re[ix] * dxi - im[ix] * dxr);
            } } }
    for o in [0usize, 1, 2, 3, 4, 5, 6, 8] { out[o] *= dv; }
}

/// The kinetic energy ½∫|∇ψ|², exactly (in k-space, Parseval): sr, si full-size scratch.
pub fn kin_e(re: &[f64], im: &[f64], q: &Pot, sr: &mut [f64], si: &mut [f64], twr: &[f64], twi: &[f64], m: usize, lr: &mut [f64], li: &mut [f64]) -> f64 {
    let n = q.nx * q.ny * q.nz; sr[..n].copy_from_slice(&re[..n]); si[..n].copy_from_slice(&im[..n]);
    fft_nd(sr, si, q.nx, q.ny, q.nz, false, twr, twi, m, lr, li);
    let mut e = 0.0;
    for k in 0..q.nz { let kz = if q.nz > 1 { kof(k, q.nz, q.dz) } else { 0.0 };
        for j in 0..q.ny { let ky = if q.ny > 1 { kof(j, q.ny, q.dy) } else { 0.0 };
            for i in 0..q.nx { let kx = kof(i, q.nx, q.dx); let ix = i + q.nx * (j + q.ny * k); e += 0.5 * (kx * kx + ky * ky + kz * kz) * (sr[ix] * sr[ix] + si[ix] * si[ix]); } } }
    e * q.dx * q.dy * (if q.nz > 1 { q.dz } else { 1.0 }) / n as f64
}

/// The column density: |ψ|² summed along z (axis 2: an nx×ny picture) or along y (axis 1: nx×nz, from the side).
pub fn column(re: &[f64], im: &[f64], nx: usize, ny: usize, nz: usize, axis: usize, d: f64, out: &mut [f64]) {
    if axis == 1 { for v in out.iter_mut().take(nx * nz) { *v = 0.0; } } else { for v in out.iter_mut().take(nx * ny) { *v = 0.0; } }
    for k in 0..nz { for j in 0..ny { for i in 0..nx { let q = i + nx * (j + ny * k); let rho = re[q] * re[q] + im[q] * im[q];
        if axis == 1 { out[i + nx * k] += rho * d; } else { out[i + nx * j] += rho * d; } } } }
}

/* ---- the exports ------------------------------------------------------------------------------------------------ */
#[inline(always)]
unsafe fn sl<'a>(t: *const i32, k: usize, n: usize) -> &'a mut [f64] { core::slice::from_raw_parts_mut(*t.add(k) as u32 as usize as *mut f64, n) }
unsafe fn potp(p: *const f64) -> Pot {
    let r = |i: usize| *p.add(i);
    Pot { nx: r(0) as usize, ny: r(1) as usize, nz: r(2) as usize, dx: r(3), dy: r(4), dz: r(5), cx: r(8), cy: r(9), cz: r(10), trap: r(11),
          beta: r(12), eps: r(13), om: r(14), bar_a: r(16), bar_w: r(17), absorb: r(18), gamma: r(6), imag: r(7) != 0.0, k3: r(25), mu: r(26), sp_a: r(27), sp_x: r(28), sp_y: r(29), sp_w: r(30), rot: r(31) }
}
/* t: 0 re, 1 im, 2 kr, 3 ki, 4 lr, 5 li, 6 twr, 7 twi, 8 out
   9, 10 full-size scratch (af_bec_obs: the exact kinetic energy; 0 = differences)
   p: 0 nx, 1 ny, 2 nz, 3 dx, 4 dy, 5 dz, 6 γ, 7 imag, 8 cx, 9 cy, 10 cz, 11 trap (0/1), 12 β, 13 stirrer ε, 14 its Ω,
      15 t0, 16 barrier height, 17 its width, 18 absorbing strength, 19 dt, 20 steps, 21 renorm, 22 the twiddles' size m,
      23 column axis (af_bec_column), 24 its cell size, 25 three-body loss k₃, 26 μ (subtracted from V: the damping drains only H − μ),
      27–30 a laser spoon (a column along z): height, x, y, width, 31 the frame's rotation Ω (about z; 0: the lab's)                                                                  */
#[no_mangle]
pub unsafe extern "C" fn af_bec_kin(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64; let q = potp(p); let n = q.nx * q.ny * q.nz;
    kin(sl(t, 2, n), sl(t, 3, n), q.nx, q.ny, q.nz, q.dx, q.dy, q.dz, *p.add(19), q.gamma, q.imag); 0.0
}
#[no_mangle]
pub unsafe extern "C" fn af_bec_step(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64; let q = potp(p); let n = q.nx * q.ny * q.nz; let m = *p.add(22) as usize;
    let mx = q.nx.max(q.ny).max(q.nz);
    step(sl(t, 0, n), sl(t, 1, n), sl(t, 2, n), sl(t, 3, n), &q, *p.add(19), *p.add(20) as usize, *p.add(15), *p.add(21) != 0.0,
         sl(t, 6, m / 2), sl(t, 7, m / 2), m, sl(t, 4, mx), sl(t, 5, mx))
}
#[no_mangle]
pub unsafe extern "C" fn af_bec_obs(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64; let q = potp(p); let n = q.nx * q.ny * q.nz;
    let out = sl(t, 8, 9); obs(sl(t, 0, n), sl(t, 1, n), &q, out);
    if *t.add(9) != 0 { let m = *p.add(22) as usize; let mx = q.nx.max(q.ny).max(q.nz);
        out[3] = kin_e(sl(t, 0, n), sl(t, 1, n), &q, sl(t, 9, n), sl(t, 10, n), sl(t, 6, m / 2), sl(t, 7, m / 2), m, sl(t, 4, mx), sl(t, 5, mx)); }
    0.0
}
#[no_mangle]
pub unsafe extern "C" fn af_bec_column(t: u32, p: u32) -> f64 {
    let t = t as usize as *const i32; let p = p as usize as *const f64; let q = potp(p); let n = q.nx * q.ny * q.nz; let ax = *p.add(23) as usize;
    let len = if ax == 1 { q.nx * q.nz } else { q.nx * q.ny };
    column(sl(t, 0, n), sl(t, 1, n), q.nx, q.ny, q.nz, ax, *p.add(24), sl(t, 8, len)); 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tw(m: usize) -> (Vec<f64>, Vec<f64>) { ((0..m / 2).map(|k| (2.0 * PI * k as f64 / m as f64).cos()).collect(), (0..m / 2).map(|k| -(2.0 * PI * k as f64 / m as f64).sin()).collect()) }
    #[test]
    fn sincos_ok() { let mut w = 0f64; let mut x = -50.0; while x < 50.0 { let (s, c) = sincos(x); w = w.max((s - x.sin()).abs()).max((c - x.cos()).abs()); x += 0.0137; } assert!(w < 1e-13, "{}", w); }
    #[test]
    fn fft_roundtrip_and_ground_states() {
        let (twr, twi) = tw(64);
        let (nx, ny, nz) = (64, 64, 1); let n = nx * ny;
        let mut re: Vec<f64> = (0..n).map(|i| ((i * 7919) % 101) as f64 / 101.0).collect(); let mut im = vec![0.0; n]; let orig = re.clone();
        let mut lr = vec![0.0; 64]; let mut li = vec![0.0; 64];
        fft_nd(&mut re, &mut im, nx, ny, nz, false, &twr, &twi, 64, &mut lr, &mut li); fft_nd(&mut re, &mut im, nx, ny, nz, true, &twr, &twi, 64, &mut lr, &mut li);
        let err = re.iter().zip(&orig).map(|(a, b)| (a / n as f64 - b).abs()).fold(0.0, f64::max); assert!(err < 1e-12);
        // the harmonic oscillator's ground state (β = 0): μ = (λx + λy)/2 = 1 in 2-D, 1.5 in 3-D; with β the Thomas–Fermi μ
        for (nz, want, beta) in [(1usize, 1.0f64, 0.0f64), (32, 1.5, 0.0), (1, (200.0f64 / PI).sqrt(), 200.0)] {
            let (nx, ny) = if nz > 1 { (32, 32) } else { (64, 64) }; let n = nx * ny * nz; let l = if beta > 0.0 { 24.0 } else { 16.0 };
            let q = Pot { nx, ny, nz, dx: l / nx as f64, dy: l / ny as f64, dz: l / nz.max(2) as f64, cx: 0.5, cy: 0.5, cz: 0.5, trap: 1.0, beta, eps: 0.0, om: 0.0, bar_a: 0.0, bar_w: 1.0, absorb: 0.0, gamma: 0.0, imag: true, k3: 0.0, mu: 0.0, sp_a: 0.0, sp_x: 0.0, sp_y: 0.0, sp_w: 1.0, rot: 0.0 };
            let mut re: Vec<f64> = (0..n).map(|i| { let x = (i % nx) as f64 - nx as f64 / 2.0; (-0.02 * x * x).exp() }).collect(); let mut im = vec![0.0; n];
            let mut kr = vec![0.0; n]; let mut ki = vec![0.0; n]; let dt = 0.01;
            kin(&mut kr, &mut ki, nx, ny, nz, q.dx, q.dy, q.dz, dt, 0.0, true);
            let (twr, twi) = tw(64); let mut lr = vec![0.0; 64]; let mut li = vec![0.0; 64];
            for _ in 0..40 { step(&mut re, &mut im, &kr, &ki, &q, dt, 50, 0.0, true, &twr, &twi, 64, &mut lr, &mut li); }
            let mut o = [0.0; 9]; obs(&re, &im, &q, &mut o);
            let (mut sr, mut si) = (vec![0.0; n], vec![0.0; n]); o[3] = kin_e(&re, &im, &q, &mut sr, &mut si, &twr, &twi, 64, &mut lr, &mut li);
            let mu = o[3] + o[1] + 2.0 * o[2];
            println!("nz {} beta {}: mu {} (want ~{}), o {:?}", nz, beta, mu, want, o);
            assert!((mu - want).abs() < if beta > 0.0 { 0.12 * want } else { 0.01 }, "mu {} want {}", mu, want);
        }
    }
    #[test]
    fn real_time_keeps_norm_and_energy() {
        let (twr, twi) = tw(64); let mut lr = vec![0.0; 64]; let mut li = vec![0.0; 64];
        let (nx, ny, nz) = (64, 64, 64); let n = nx * ny * nz; let l = 16.0;
        let mut q = Pot { nx, ny, nz, dx: l / 64.0, dy: l / 64.0, dz: l / 64.0, cx: 0.5, cy: 0.5, cz: 0.5, trap: 1.0, beta: 100.0, eps: 0.0, om: 0.0, bar_a: 0.0, bar_w: 1.0, absorb: 0.0, gamma: 0.0, imag: true, k3: 0.0, mu: 0.0, sp_a: 0.0, sp_x: 0.0, sp_y: 0.0, sp_w: 1.0, rot: 0.0 };
        let mut re: Vec<f64> = (0..n).map(|i| { let x = (i % nx) as f64 - 30.0; let y = ((i / nx) % ny) as f64 - 32.0; let z = (i / nx / ny) as f64 - 32.0; (-0.03 * (x * x + y * y + z * z)).exp() }).collect(); let mut im = vec![0.0; n];
        let (mut kr, mut ki) = (vec![0.0; n], vec![0.0; n]); let (mut sr, mut si) = (vec![0.0; n], vec![0.0; n]);
        kin(&mut kr, &mut ki, nx, ny, nz, q.dx, q.dy, q.dz, 0.01, 0.0, true);
        let t = std::time::Instant::now();
        step(&mut re, &mut im, &kr, &ki, &q, 0.01, 100, 0.0, true, &twr, &twi, 64, &mut lr, &mut li);
        println!("64³ imaginary: {:.1} ms a step", t.elapsed().as_secs_f64() * 10.0);
        let en = |re: &Vec<f64>, im: &Vec<f64>, q: &Pot, sr: &mut Vec<f64>, si: &mut Vec<f64>, lr: &mut Vec<f64>, li: &mut Vec<f64>| { let mut o = [0.0; 9]; obs(re, im, q, &mut o); (o[0], o[1] + o[2] + kin_e(re, im, q, sr, si, &twr, &twi, 64, lr, li)) };
        // shake it: the trap made stiffer along x (a breathing mode), real time
        q.imag = false; q.cx = 0.8;
        kin(&mut kr, &mut ki, nx, ny, nz, q.dx, q.dy, q.dz, 0.005, 0.0, false);
        let (n0, e0) = en(&re, &im, &q, &mut sr, &mut si, &mut lr, &mut li);
        let t = std::time::Instant::now();
        let mut tt = 0.0; for _ in 0..4 { step(&mut re, &mut im, &kr, &ki, &q, 0.005, 50, tt, false, &twr, &twi, 64, &mut lr, &mut li); tt += 0.25; }
        println!("64³ real: {:.1} ms a step", t.elapsed().as_secs_f64() * 5.0);
        let (n1, e1) = en(&re, &im, &q, &mut sr, &mut si, &mut lr, &mut li);
        println!("norm {} -> {}, E {} -> {}", n0, n1, e0, e1);
        assert!((n1 - n0).abs() < 1e-6 && (e1 - e0).abs() < 2e-3 * e0.abs());
    }
    #[test]
    fn flat_big_cloud_stays_stable() {
        let n = 256; let l = 22.16; let dx = l / n as f64; let (twr, twi) = tw(n); let mut lr = vec![0.0; n]; let mut li = vec![0.0; n];
        let mut q = Pot { nx: n, ny: n, nz: 1, dx, dy: dx, dz: 1.0, cx: 0.5, cy: 0.5, cz: 0.0, trap: 1.0, beta: 3080.0, eps: 0.0, om: 0.0, bar_a: 0.0, bar_w: 1.0, absorb: 0.0, gamma: 0.0, imag: true, k3: 0.0, mu: 0.0, sp_a: 0.0, sp_x: 0.0, sp_y: 0.0, sp_w: 1.0, rot: 0.0 };
        let nn = n * n; let mu = (3080.0f64 / PI).sqrt();
        let mut re: Vec<f64> = (0..nn).map(|i| { let x = ((i % n) as f64 - 128.0) * dx; let y = ((i / n) as f64 - 128.0) * dx; (mu - 0.5 * (x * x + y * y)).max(0.0).sqrt() }).collect(); let mut im = vec![0.0; nn];
        let (mut kr, mut ki) = (vec![0.0; nn], vec![0.0; nn]); let (mut sr, mut si) = (vec![0.0; nn], vec![0.0; nn]);
        kin(&mut kr, &mut ki, n, n, 1, dx, dx, 1.0, 0.005, 0.0, true);
        step(&mut re, &mut im, &kr, &ki, &q, 0.005, 400, 0.0, true, &twr, &twi, n, &mut lr, &mut li);
        q.imag = false; let dt = std::env::var("BEC_DT").ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.8) * dx * dx;
        kin(&mut kr, &mut ki, n, n, 1, dx, dx, 1.0, dt, 0.0, false);
        let en = |re: &Vec<f64>, im: &Vec<f64>, sr: &mut Vec<f64>, si: &mut Vec<f64>, lr: &mut Vec<f64>, li: &mut Vec<f64>| { let mut o = [0.0; 9]; obs(re, im, &q, &mut o); (o[1] + o[2] + kin_e(re, im, &q, sr, si, &twr, &twi, n, lr, li), o[7]) };
        let (e0, p0) = en(&re, &im, &mut sr, &mut si, &mut lr, &mut li);
        let mut t = 0.0; let nb = (18.0 / (100.0 * dt)) as usize; for b in 0..nb { step(&mut re, &mut im, &kr, &ki, &q, dt, 100, t, false, &twr, &twi, n, &mut lr, &mut li); t += 100.0 * dt;
            if b % (nb / 6).max(1) == 0 { let (e, p) = en(&re, &im, &mut sr, &mut si, &mut lr, &mut li); println!("  t {:.2} E {:.4} peak {:.5}", t, e, p); } }
        let (e1, p1) = en(&re, &im, &mut sr, &mut si, &mut lr, &mut li);
        println!("flat: dt {} over {}: E {} -> {}, peak {} -> {}", dt, t, e0, e1, p0, p1);
        assert!((e1 - e0).abs() < 1e-3 * e0 && (p1 - p0).abs() < 0.02 * p0);
    }
    #[test]
    fn rotating_ground_state_has_a_lattice() {
        let n = 128; let l = 20.0; let dx = l / n as f64; let (twr, twi) = tw(n); let mut lr = vec![0.0; n]; let mut li = vec![0.0; n];
        let q = Pot { nx: n, ny: n, nz: 1, dx, dy: dx, dz: 1.0, cx: 0.5, cy: 0.5, cz: 0.0, trap: 1.0, beta: 1000.0, eps: 0.0, om: 0.0, bar_a: 0.0, bar_w: 1.0, absorb: 0.0, gamma: 0.0, imag: true, k3: 0.0, mu: 0.0, sp_a: 0.0, sp_x: 0.0, sp_y: 0.0, sp_w: 1.0, rot: 0.8 };
        let nn = n * n; let mut seed = 7u64; let mut rnd = || { seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (seed >> 11) as f64 / (1u64 << 53) as f64 };
        let mut re: Vec<f64> = vec![0.0; nn]; let mut im = vec![0.0; nn];
        for i in 0..nn { let x = ((i % n) as f64 - 64.0) * dx; let y = ((i / n) as f64 - 64.0) * dx; let a = (-(x * x + y * y) / 30.0).exp(); let ph = 6.0 * rnd(); re[i] = a * ph.cos(); im[i] = a * ph.sin(); }
        let (kr, ki) = (vec![0.0; nn], vec![0.0; nn]);
        step(&mut re, &mut im, &kr, &ki, &q, 0.01, 1500, 0.0, true, &twr, &twi, n, &mut lr, &mut li);
        let mut o = [0.0; 9]; obs(&re, &im, &q, &mut o);
        println!("rotating: <Lz> {} norm {}", o[8], o[0]);
        assert!(o[8] > 3.0);
    }
}
