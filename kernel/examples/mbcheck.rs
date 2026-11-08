//! Native check of the many-body metals' pass (mb.rs, af_mb) against a dump made by tools/mbdump.js (1.26):
//!   cargo run --release --example mbcheck -- dump.bin [more…]
use atom_forge_kernel::mb::*;
use std::fs;

fn u32_(b: &[u8], o: usize) -> usize { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as usize }
fn f64_(b: &[u8], o: usize) -> f64 { f64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

fn main() {
    let mut bad = 0;
    for path in std::env::args().skip(1) {
        let f = fs::read(&path).expect("read");
        assert_eq!(&f[0..4], b"AFMB");
        let hdr = u32_(&f, 4); let mem_len = u32_(&f, 8); let toff = u32_(&f, 12); let poff = u32_(&f, 16); let hi = u32_(&f, 20);
        let e_exp = f64_(&f, 24); let st_exp = f64_(&f, 32); let np_exp = u32_(&f, 40);
        let mut o = hdr; let mut exp = [vec![0.0; hi], vec![0.0; hi], vec![0.0; hi]];
        for a in 0..3 { for i in 0..hi { exp[a][i] = f64_(&f, o + 8 * i); } o += 8 * hi; }
        o = (o + 7) & !7;
        let mut mem: Vec<u64> = vec![0; (mem_len + 7) / 8];
        let base = mem.as_mut_ptr() as usize;
        unsafe { std::ptr::copy_nonoverlapping(f[o..o + mem_len].as_ptr(), base as *mut u8, mem_len); }
        let t = (base + toff) as *const i32; let p = (base + poff) as *mut f64;
        let t0 = std::time::Instant::now();
        unsafe { mb_pass(base, t, p); }
        let dt = t0.elapsed();
        let (e, st, np, status) = unsafe { (*p.add(MP_EREP) + *p.add(MP_EEMB), *p.add(MP_STIFF), *p.add(MP_NP) as usize, *p.add(MP_STATUS)) };
        let fp = |k: usize| unsafe { (base + *t.add(k) as u32 as usize) as *const f64 };
        let (mut df, mut fmax, mut nbit) = (0.0f64, 0.0f64, 0usize);
        for (a, k) in [M_FX, M_FY, M_FZ].iter().enumerate() { for i in 0..hi { let g = unsafe { *fp(*k).add(i) }; df = df.max((g - exp[a][i]).abs()); fmax = fmax.max(exp[a][i].abs()); if g.to_bits() != exp[a][i].to_bits() { nbit += 1; } } }
        println!("{}: pairs {} ({}) | E {:.12} vs {:.12} (Δ {:.1e}) | forces Δ {:.1e} (max {:.1e}; {} components not bit-identical) | stiffness {:.6e} vs {:.6e} | status {} | {:.3} ms",
            path, np, np_exp, e, e_exp, (e - e_exp).abs(), df, fmax, nbit, st, st_exp, status, dt.as_secs_f64() * 1e3);
        if np != np_exp || (e - e_exp).abs() > 1e-9 * e_exp.abs().max(1.0) || df > 1e-9 * fmax.max(1.0) || (st - st_exp).abs() > 1e-9 * st_exp.abs().max(1.0) || status != 0.0 { bad += 1; }
    }
    if bad > 0 { eprintln!("{} dump(s) differ", bad); std::process::exit(1); }
    println!("the many-body metals' pass agrees");
}
