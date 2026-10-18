//! Native check of the kernels against a dump made by tools/kdump.js:
//!   cargo run --release --example check -- /tmp/kstate.bin [more dumps…]
//! The dump holds a memory image (the store, lists, descriptor and zeroed output arrays laid out as the page lays them
//! out) and the JS kernels' results for it; this runs the Rust kernels on the image and compares.
use atom_forge_kernel::*;
use std::fs;

fn rd_u32(b: &[u8], o: usize) -> u32 { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) }
fn rd_f64(b: &[u8], o: usize) -> f64 { f64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() { eprintln!("usage: check <dump.bin>…"); std::process::exit(2); }
    let mut bad = 0;
    for path in &args {
        let f = fs::read(path).expect("read dump");
        // header: magic 'AFK1', then u32: hdrLen, memLen, n, np, nb, na, wrap, descOff, fxoOff, fyoOff, cqOff, ksOff, nc; f64: bw, bh, hw, hh, step, ks; then expected fx[n], fy[n], cq[nc] (i32), then the memory image
        assert_eq!(&f[0..4], b"AFK1", "bad magic");
        let hdr = rd_u32(&f, 4) as usize; let mem_len = rd_u32(&f, 8) as usize;
        let n = rd_u32(&f, 12) as usize; let np = rd_u32(&f, 16) as usize; let nb = rd_u32(&f, 20) as usize; let na = rd_u32(&f, 24) as usize;
        let wrap = rd_u32(&f, 28) != 0; let desc_off = rd_u32(&f, 32) as usize; let fxo = rd_u32(&f, 36) as usize; let fyo = rd_u32(&f, 40) as usize;
        let cq_off = rd_u32(&f, 44) as usize; let ks_off = rd_u32(&f, 48) as usize; let nc_exp = rd_u32(&f, 52) as usize;
        let bw = rd_f64(&f, 56); let bh = rd_f64(&f, 64); let hw = rd_f64(&f, 72); let hh = rd_f64(&f, 80); let step = rd_f64(&f, 88) as i64; let ks_exp = rd_f64(&f, 96);
        let mut o = hdr;
        let fx_exp: Vec<f64> = (0..n).map(|i| rd_f64(&f, o + 8 * i)).collect(); o += 8 * n;
        let fy_exp: Vec<f64> = (0..n).map(|i| rd_f64(&f, o + 8 * i)).collect(); o += 8 * n;
        let cq_exp: Vec<i32> = (0..nc_exp).map(|i| rd_u32(&f, o + 4 * i) as i32).collect(); o += 4 * nc_exp;
        o = (o + 7) & !7;
        // the memory image, 8-aligned
        let mut mem: Vec<u64> = vec![0; (mem_len + 7) / 8];
        let base = mem.as_mut_ptr() as usize;
        unsafe { std::ptr::copy_nonoverlapping(f[o..o + mem_len].as_ptr(), base as *mut u8, mem_len); }
        let t0 = std::time::Instant::now();
        let mut ks = 0.0f64;
        let nc = unsafe { forces(base, (base + desc_off) as *const i32, 0, np, 0, nb, 0, na, (base + fxo) as *mut f64, (base + fyo) as *mut f64, (base + cq_off) as *mut i32, wrap, bw, bh, hw, hh, step, &mut ks) };
        let dt = t0.elapsed();
        let _ = ks_off;
        let mut maxd = 0.0f64; let mut maxrel = 0.0f64; let mut ndiff = 0usize;
        for i in 0..n {
            let fx = unsafe { *((base + fxo) as *const f64).add(i) }; let fy = unsafe { *((base + fyo) as *const f64).add(i) };
            let d = (fx - fx_exp[i]).abs().max((fy - fy_exp[i]).abs());
            let scale = fx_exp[i].abs().max(fy_exp[i].abs()).max(1e-6);
            if d > maxd { maxd = d; }
            if d / scale > maxrel { maxrel = d / scale; }
            if d > 1e-9 * scale { ndiff += 1; }
        }
        let cq_ok = nc == nc_exp && (0..nc).all(|k| unsafe { *((base + cq_off) as *const i32).add(k) } == cq_exp[k]);
        let ks_ok = (ks - ks_exp).abs() <= 1e-9 * ks_exp.abs().max(1e-300);
        println!("{}: n {} pairs {} bonds {} centres {} | forces: max |Δ| {:.3e}, max rel {:.3e}, {} slots off by > 1e-9 | candidates {} ({}) {} | kstiff {} {:.6e} vs {:.6e} | {:.3} ms",
            path, n, np, nb, na, maxd, maxrel, ndiff, nc / 3, nc_exp / 3, if cq_ok { "same" } else { "DIFFERENT" }, if ks_ok { "same" } else { "DIFFERENT" }, ks, ks_exp, dt.as_secs_f64() * 1e3);
        if !cq_ok || !ks_ok || ndiff > 0 { bad += 1; }
    }
    if bad > 0 { eprintln!("{} dump(s) differ", bad); std::process::exit(1); }
    println!("kernels agree");
}
