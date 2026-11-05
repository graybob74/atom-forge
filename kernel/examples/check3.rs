//! Native check of the 3-D kernels (d3.rs, af_forces3) against a dump made by tools/k3dump.js:
//!   cargo run --release --example check3 -- /tmp/water3d.bin [more dumps…]
//! The dump holds the WebAssembly memory as the page lays it out (store, lists, AC3, descriptor, zeroed outputs) and the
//! JavaScript 3-D kernels' results for it; this runs the Rust kernel on a copy of the image and compares: the forces
//! (bit for bit where they are, else the largest difference relative to the slot's force), the candidates in order and
//! the stiffness.
use atom_forge_kernel::d3::*;
use std::fs;

fn rd_u32(b: &[u8], o: usize) -> u32 { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) }
fn rd_f64(b: &[u8], o: usize) -> f64 { f64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() { eprintln!("usage: check3 <dump.bin>…"); std::process::exit(2); }
    let mut bad = 0;
    for path in &args {
        let f = fs::read(path).expect("read dump");
        assert_eq!(&f[0..4], b"AFK3", "bad magic");
        let hdr = rd_u32(&f, 4) as usize; let mem_len = rd_u32(&f, 8) as usize;
        let n = rd_u32(&f, 12) as usize; let np = rd_u32(&f, 16) as usize; let nb = rd_u32(&f, 20) as usize; let na = rd_u32(&f, 24) as usize; let nt = rd_u32(&f, 28) as usize;
        let wrap = rd_u32(&f, 32) != 0; let desc_off = rd_u32(&f, 36) as usize;
        let fxo = rd_u32(&f, 40) as usize; let fyo = rd_u32(&f, 44) as usize; let fzo = rd_u32(&f, 48) as usize; let cq_off = rd_u32(&f, 52) as usize; let nc_exp = rd_u32(&f, 56) as usize;
        let bx = Box3 { wrap, bw: rd_f64(&f, 64), bh: rd_f64(&f, 72), bd: rd_f64(&f, 80), hw: rd_f64(&f, 88), hh: rd_f64(&f, 96), hd: rd_f64(&f, 104) };
        let step = rd_f64(&f, 112) as i64; let ks_exp = rd_f64(&f, 120);
        let mut o = hdr;
        let mut exp = [vec![0.0f64; n], vec![0.0f64; n], vec![0.0f64; n]];
        for a in 0..3 { for i in 0..n { exp[a][i] = rd_f64(&f, o + 8 * i); } o += 8 * n; }
        let cq_exp: Vec<i32> = (0..nc_exp).map(|i| rd_u32(&f, o + 4 * i) as i32).collect(); o += 4 * nc_exp;
        o = (o + 7) & !7;
        let mut mem: Vec<u64> = vec![0; (mem_len + 7) / 8];
        let base = mem.as_mut_ptr() as usize;
        unsafe { std::ptr::copy_nonoverlapping(f[o..o + mem_len].as_ptr(), base as *mut u8, mem_len); }
        let mut ks = 0.0f64;
        let t0 = std::time::Instant::now();
        let nc = unsafe { forces3(base, (base + desc_off) as *const i32, 0, np, 0, nb, 0, na, 0, nt, (base + fxo) as *mut f64, (base + fyo) as *mut f64, (base + fzo) as *mut f64,
            (base + cq_off) as *mut i32, &bx, step, &mut ks) };
        let dt = t0.elapsed();
        let outs = [fxo, fyo, fzo];
        let (mut maxrel, mut nbit, mut nrel) = (0.0f64, 0usize, 0usize);
        for i in 0..n {
            let got: Vec<f64> = (0..3).map(|a| unsafe { *((base + outs[a]) as *const f64).add(i) }).collect();
            let scale = (0..3).map(|a| exp[a][i].abs()).fold(1e-6f64, f64::max);
            let mut d = 0.0f64; let mut same = true;
            for a in 0..3 { if got[a].to_bits() != exp[a][i].to_bits() { same = false; } d = d.max((got[a] - exp[a][i]).abs()); }
            if !same { nbit += 1; if std::env::var("CHECK3_LIST").is_ok() { println!("  slot {} rel {:.2e}", i, d / scale); } }
            if d / scale > maxrel { maxrel = d / scale; }
            if d > 1e-12 * scale { nrel += 1; }
        }
        let cq_ok = nc == nc_exp && (0..nc).all(|k| unsafe { *((base + cq_off) as *const i32).add(k) } == cq_exp[k]);
        let ks_ok = ks == ks_exp;
        println!("{}: {} slots, {} pairs, {} bonds, {} centres, {} dihedrals | forces: {} slots not bit-identical, max rel {:.2e}, {} beyond 1e-12 | candidates {} {} | stiffness {} | {:.3} ms",
            path, n, np, nb, na, nt, nbit, maxrel, nrel, nc / 3, if cq_ok { "same" } else { "DIFFERENT" }, if ks_ok { "same" } else { "DIFFERENT" }, dt.as_secs_f64() * 1e3);
        if !cq_ok || !ks_ok || maxrel > 1e-10 { bad += 1; }
    }
    if bad > 0 { eprintln!("{} dump(s) differ", bad); std::process::exit(1); }
    println!("3-D kernels agree");
}
