//! Native check of induced charges' pairs (qeq.rs, af_qeq) against a dump made by tools/qeqdump.js (1.26): the same
//! pairs in the same order with the same coefficients and charge products, to the bit.
//!   cargo run --release --example qeqcheck -- dump.bin [more…]
use atom_forge_kernel::qeq::*;
use std::fs;

fn u32_(b: &[u8], o: usize) -> usize { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as usize }

fn main() {
    let mut bad = 0;
    for path in std::env::args().skip(1) {
        let f = fs::read(&path).expect("read");
        assert_eq!(&f[0..4], b"AFQE");
        let hdr = u32_(&f, 4); let mem_len = u32_(&f, 8); let toff = u32_(&f, 12); let poff = u32_(&f, 16); let n_exp = u32_(&f, 20);
        let ex: Vec<(i32, i32, u64, u64)> = (0..n_exp).map(|k| { let o = hdr + 24 * k; (i32::from_le_bytes(f[o..o + 4].try_into().unwrap()), i32::from_le_bytes(f[o + 4..o + 8].try_into().unwrap()), u64::from_le_bytes(f[o + 8..o + 16].try_into().unwrap()), u64::from_le_bytes(f[o + 16..o + 24].try_into().unwrap())) }).collect();
        let o = hdr + 24 * n_exp;
        let mut mem: Vec<u64> = vec![0; (mem_len + 7) / 8];
        let base = mem.as_mut_ptr() as usize;
        unsafe { std::ptr::copy_nonoverlapping(f[o..o + mem_len].as_ptr(), base as *mut u8, mem_len); }
        // the table holds offsets: make them addresses in this copy
        let t: Vec<i32> = (0..Q_LEN).map(|k| unsafe { *((base + toff) as *const i32).add(k) }).collect();
        let ta: Vec<usize> = t.iter().map(|&v| base + v as u32 as usize).collect();
        let p = (base + poff) as *mut f64;
        let t0 = std::time::Instant::now();
        unsafe { qeq_pairs_at(&ta, p); }
        let dt = t0.elapsed();
        let np = unsafe { *p.add(QP_OUT) } as usize;
        let same = np == n_exp && (0..np).all(|k| unsafe {
            let (i, j, c, q0) = ex[k];
            *(ta[Q_PA] as *const i32).add(k) == i && *(ta[Q_PB] as *const i32).add(k) == j && (*(ta[Q_PC] as *const f64).add(k)).to_bits() == c && (*(ta[Q_Q0] as *const f64).add(k)).to_bits() == q0 });
        println!("{}: {} pairs ({}) {} | {:.3} ms", path, np, n_exp, if same { "the same, to the bit" } else { "DIFFERENT" }, dt.as_secs_f64() * 1e3);
        if !same { bad += 1; }
    }
    if bad > 0 { eprintln!("{} dump(s) differ", bad); std::process::exit(1); }
    println!("induced charges' pairs agree");
}
