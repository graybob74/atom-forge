//! Bond orders for metals (bometal.js mbPass, 1.25; here 1.26): the many-body pass's pair loop, the embedding and the
//! forces, after the JavaScript has gathered the members, their types and the pair table and sorted them into cells.
//! The same loop in the same order (cells, then each member against its cell's later members and the neighbouring
//! cells of higher number); exp is the standard library's, so the two agree to rounding.
//! Arrays by byte offset in a table (`M_*`), scalars in a f64 block (`MP_*`, some written back). Main thread only.

pub const M_SX: usize = 0; // (the members in cell order: positions, slots, types × nt, antimatter)
pub const M_SY: usize = 1;
pub const M_SZ: usize = 2;
pub const M_SS: usize = 3;
pub const M_STY: usize = 4;
pub const M_SA: usize = 5;
pub const M_START: usize = 6; // (each cell's first member, nc + 1)
pub const M_PT: usize = 7; // (the pair table, stride 8: 2A, ξ², p/r₀, 2q/r₀, r₀, r_on, r_off, r_off²)
pub const M_EPS: usize = 8;
pub const M_RHO: usize = 9;
pub const M_FD: usize = 10;
pub const M_PA: usize = 11; // (the pairs' scratch, room for MP_CAP)
pub const M_PB: usize = 12;
pub const M_UX: usize = 13;
pub const M_UY: usize = 14;
pub const M_UZ: usize = 15;
pub const M_VR: usize = 16;
pub const M_DR: usize = 17;
pub const M_PK: usize = 18;
pub const M_RR: usize = 19;
pub const M_FX: usize = 20;
pub const M_FY: usize = 21;
pub const M_FZ: usize = 22;
pub const M_IM: usize = 23;
pub const M_LEN: usize = 24;

pub const MP_NM: usize = 0;
pub const MP_NT: usize = 1;
pub const MP_NX: usize = 2;
pub const MP_NY: usize = 3;
pub const MP_NZ: usize = 4;
pub const MP_D3: usize = 5;
pub const MP_WRAP: usize = 6;
pub const MP_BW: usize = 7;
pub const MP_BH: usize = 8;
pub const MP_BD: usize = 9;
pub const MP_HW: usize = 10;
pub const MP_HH: usize = 11;
pub const MP_HD: usize = 12;
pub const MP_CUT2: usize = 13;
pub const MP_FORCES: usize = 14;
pub const MP_CAP: usize = 15;
pub const MP_NP: usize = 16; // (out: the pairs)
pub const MP_EREP: usize = 17; // (out)
pub const MP_EEMB: usize = 18; // (out)
pub const MP_STIFF: usize = 19; // (out: the stiffest pair, 0 if none)
pub const MP_STATUS: usize = 20; // (out: 1 when the pairs would not fit in MP_CAP; nothing was applied)
pub const MP_LEN: usize = 24;

#[inline(always)]
unsafe fn o<T>(base: usize, t: *const i32, k: usize) -> *mut T { (base + *t.add(k) as u32 as usize) as *mut T }
#[inline(always)]
unsafe fn r<T: Copy>(p: *const T, i: usize) -> T { *p.add(i) }

pub unsafe fn mb_pass(base: usize, t: *const i32, p: *mut f64) {
    let sx: *const f64 = o(base, t, M_SX); let sy: *const f64 = o(base, t, M_SY); let sz: *const f64 = o(base, t, M_SZ);
    let ss: *const i32 = o(base, t, M_SS); let sty: *const i32 = o(base, t, M_STY); let sa: *const i32 = o(base, t, M_SA); let start: *const i32 = o(base, t, M_START);
    let pt: *const f64 = o(base, t, M_PT); let epsv: *const f64 = o(base, t, M_EPS); let rho: *mut f64 = o(base, t, M_RHO); let fd: *mut f64 = o(base, t, M_FD);
    let pa: *mut i32 = o(base, t, M_PA); let pb: *mut i32 = o(base, t, M_PB); let ux: *mut f64 = o(base, t, M_UX); let uy: *mut f64 = o(base, t, M_UY); let uz: *mut f64 = o(base, t, M_UZ);
    let vr: *mut f64 = o(base, t, M_VR); let dr: *mut f64 = o(base, t, M_DR); let pk: *mut f64 = o(base, t, M_PK); let rr: *mut f64 = o(base, t, M_RR);
    let nm = r(p, MP_NM) as usize; let nt = r(p, MP_NT) as i32; let nx = r(p, MP_NX) as i32; let ny = r(p, MP_NY) as i32; let nz = r(p, MP_NZ) as i32;
    let d3 = r(p, MP_D3) != 0.0; let wrap = r(p, MP_WRAP) != 0.0;
    let bw = r(p, MP_BW); let bh = r(p, MP_BH); let bd = r(p, MP_BD); let hw = r(p, MP_HW); let hh = r(p, MP_HH); let hd = r(p, MP_HD);
    let cut2 = r(p, MP_CUT2); let forces = r(p, MP_FORCES) != 0.0; let cap = r(p, MP_CAP) as usize;
    let nc = nx * ny * nz;
    for s in 0..nm { *rho.add(s) = 0.0; }
    let mut np = 0usize; let mut erep = 0.0f64; let mut full = false;
    let mut nb = [0i32; 27];
    for c in 0..nc {
        let s0 = r(start, c as usize) as usize; let s1 = r(start, c as usize + 1) as usize;
        if s0 == s1 { continue; }
        let cx = c % nx; let cy = (c / nx) % ny; let cz = c / (nx * ny);
        let mut nn = 0usize;
        let (z0, z1) = if d3 { (-1, 1) } else { (0, 0) };
        for dzc in z0..=z1 {
            let mut kz = cz + dzc; if kz < 0 || kz >= nz { if !wrap { continue; } kz = (kz + nz) % nz; }
            for dyc in -1..=1i32 {
                let mut ky = cy + dyc; if ky < 0 || ky >= ny { if !wrap { continue; } ky = (ky + ny) % ny; }
                for dxc in -1..=1i32 {
                    let mut kx = cx + dxc; if kx < 0 || kx >= nx { if !wrap { continue; } kx = (kx + nx) % nx; }
                    let k = (kz * ny + ky) * nx + kx;
                    if k < c { continue; }
                    let mut dup = false; for u in 0..nn { if nb[u] == k { dup = true; break; } }
                    if !dup { nb[nn] = k; nn += 1; }
                }
            }
        }
        for s in s0..s1 {
            let xi = r(sx, s); let yi = r(sy, s); let zi = r(sz, s); let tro = r(sty, s); let ai = r(sa, s);
            for u in 0..nn {
                let k = nb[u] as usize; let e = r(start, k + 1) as usize;
                let t0 = if k == c as usize { s + 1 } else { r(start, k) as usize };
                for tt in t0..e {
                    let mut dx = r(sx, tt) - xi; let mut dy = r(sy, tt) - yi; let mut dz = r(sz, tt) - zi;
                    if wrap { if dx > hw { dx -= bw; } else if dx < -hw { dx += bw; } if dy > hh { dy -= bh; } else if dy < -hh { dy += bh; } if d3 { if dz > hd { dz -= bd; } else if dz < -hd { dz += bd; } } }
                    let r2 = dx * dx + dy * dy + dz * dz;
                    if r2 >= cut2 { continue; }
                    let ob = ((tro + r(sty, tt) / nt) * 8) as usize;
                    if r2 >= r(pt, ob + 7) || r2 < 1e-12 || r(sa, tt) != ai { continue; } // (matter and antimatter: the kernel's annihilation pair)
                    let rd = r2.sqrt(); let r0 = r(pt, ob + 4); let on = r(pt, ob + 5);
                    let (mut sw, mut swd) = (1.0f64, 0.0f64);
                    if rd > on { let w = r(pt, ob + 6) - on; let q = (rd - on) / w; sw = 1.0 - q * q * q * (10.0 - q * (15.0 - 6.0 * q)); swd = -30.0 * q * q * (1.0 - q) * (1.0 - q) / w; }
                    let pr = r(pt, ob + 2); let qr = r(pt, ob + 3); let er = r(pt, ob) * (pr * (r0 - rd)).exp(); let ed = r(pt, ob + 1) * (qr * (r0 - rd)).exp();
                    erep += er * sw; *rho.add(s) += ed * sw; *rho.add(tt) += ed * sw;
                    if forces {
                        if np >= cap { full = true; } else {
                            let ir = 1.0 / rd;
                            *pa.add(np) = s as i32; *pb.add(np) = tt as i32; *ux.add(np) = dx * ir; *uy.add(np) = dy * ir; *uz.add(np) = dz * ir;
                            *vr.add(np) = er * (swd - pr * sw); *dr.add(np) = ed * (swd - qr * sw);
                            *pk.add(np) = er * pr * pr * sw; *rr.add(np) = ed * qr * qr * sw;
                        }
                    }
                    np += 1;
                }
            }
        }
    }
    *p.add(MP_NP) = np as f64; *p.add(MP_EREP) = erep; *p.add(MP_STATUS) = if full { 1.0 } else { 0.0 }; *p.add(MP_STIFF) = 0.0;
    if full { return; }
    let mut eemb = 0.0f64;
    for s in 0..nm { let eps = r(epsv, (r(sty, s) / nt) as usize); let sq = (r(rho, s) + eps * eps).sqrt(); eemb -= sq - eps; *fd.add(s) = -0.5 / sq; }
    *p.add(MP_EEMB) = eemb;
    if !forces { return; }
    let fx: *mut f64 = o(base, t, M_FX); let fy: *mut f64 = o(base, t, M_FY); let fz: *mut f64 = o(base, t, M_FZ); let im: *const f64 = o(base, t, M_IM);
    let mut st = 0.0f64;
    for k in 0..np {
        let a = r(pa, k) as usize; let b = r(pb, k) as usize; let i = r(ss, a) as usize; let j = r(ss, b) as usize; let fsum = r(fd, a) + r(fd, b);
        let g = -(r(vr, k) + fsum * r(dr, k)); // (−dE/dr)
        let fxv = g * r(ux, k); let fyv = g * r(uy, k);
        *fx.add(j) += fxv; *fy.add(j) += fyv; *fx.add(i) -= fxv; *fy.add(i) -= fyv;
        if d3 { let fzv = g * r(uz, k); *fz.add(j) += fzv; *fz.add(i) -= fzv; }
        let kk = r(pk, k) + fsum * r(rr, k);
        if kk > 0.0 { let w = kk * (r(im, i) + r(im, j)); if w > st { st = w; } }
    }
    *p.add(MP_STIFF) = st;
}

#[no_mangle]
pub unsafe extern "C" fn af_mb(t: u32, p: u32) { mb_pass(0, t as usize as *const i32, p as usize as *mut f64) }
