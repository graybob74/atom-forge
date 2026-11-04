//! Native check of the bond orders' pass (bo.rs) against a dump made in Node (a memory image laid out as the page lays
//! it out, taken just before a JavaScript pass, and that pass's results):
//!   cargo run --release --example bocheck -- dump.bin [more…]
use atom_forge_kernel::bo::*;
use std::fs;

fn u32_(b: &[u8], o: usize) -> usize { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as usize }
fn f64_(b: &[u8], o: usize) -> f64 { f64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

fn main() {
    let mut bad = 0;
    for path in std::env::args().skip(1) {
        let f = fs::read(&path).expect("read");
        assert_eq!(&f[0..4], b"AFB1");
        let hdr = u32_(&f, 4); let mem_len = u32_(&f, 8); let desc = u32_(&f, 12); let par = u32_(&f, 16);
        let nm = u32_(&f, 20); let n_exp = u32_(&f, 24); let hi = u32_(&f, 28); let e_exp = f64_(&f, 32);
        let mut o = hdr;
        let rd = |o: &mut usize, k: usize| -> Vec<f64> { let v = (0..k).map(|i| f64_(&f, *o + 8 * i)).collect(); *o += 8 * k; v };
        let fx_e = rd(&mut o, hi); let fy_e = rd(&mut o, hi); let pn_e = rd(&mut o, n_exp); let mq_e = rd(&mut o, nm); let po = rd(&mut o, nm); let gq_e = rd(&mut o, nm);
        o = (o + 7) & !7;
        let mut mem: Vec<u64> = vec![0; (mem_len + 7) / 8];
        let base = mem.as_mut_ptr() as usize;
        unsafe { std::ptr::copy_nonoverlapping(f[o..o + mem_len].as_ptr(), base as *mut u8, mem_len); }
        let p = (base + par) as *mut f64;
        let t0 = std::time::Instant::now();
        let (n, e) = unsafe {
            let b = bo_desc(base, (base + desc) as *const i32);
            let n = collect(&b, p);
            let e = pass1(&b, p);
            let phi = (base + *((base + desc) as *const i32).add(B_MPHI) as usize) as *mut f64;
            for m in 0..nm { *phi.add(m) += po[m]; }
            pass2(&b, p);
            (n, e)
        };
        let dt = t0.elapsed();
        let d = (base + desc) as *const i32;
        let arr = |k: usize| unsafe { (base + *d.add(k) as usize) as *const f64 };
        let (fx, fy, pn, mq, gq) = (arr(B_FX), arr(B_FY), arr(B_PN), arr(B_MQ), arr(B_MGQ));
        let mut df = 0.0f64; let mut fmax = 0.0f64;
        for i in 0..hi { unsafe { df = df.max((*fx.add(i) - fx_e[i]).abs()).max((*fy.add(i) - fy_e[i]).abs()); fmax = fmax.max(fx_e[i].abs()); } }
        let mut dn = 0.0f64; for k in 0..n_exp.min(n) { unsafe { dn = dn.max((*pn.add(k) - pn_e[k]).abs()); } }
        let mut dq = 0.0f64; for m in 0..nm { unsafe { dq = dq.max((*mq.add(m) - mq_e[m]).abs()); } }
        let mut dg = 0.0f64; for m in 0..nm { unsafe { dg = dg.max((*gq.add(m) - gq_e[m]).abs()); } }
        let st = unsafe { *p.add(P_STATUS) };
        println!("{}: members {} pairs {} ({}) | E {:.12} vs {:.12} (Δ {:.2e}) | forces Δ {:.2e} (max {:.2e}) | orders Δ {:.2e} | charges Δ {:.2e} | ∂E/∂ν Δ {:.2e} | status {} | {:.3} ms",
            path, nm, n, n_exp, e, e_exp, (e - e_exp).abs(), df, fmax, dn, dq, dg, st, dt.as_secs_f64() * 1e3);
        if n != n_exp || (e - e_exp).abs() > 1e-9 * e_exp.abs().max(1.0) || df > 1e-8 || dn > 1e-10 || dq > 1e-10 || dg > 1e-8 || st != 0.0 { bad += 1; }
    }
    if bad > 0 { eprintln!("{} dump(s) differ", bad); std::process::exit(1); }
    println!("the bond orders' pass agrees");
}
