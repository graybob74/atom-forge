//! Native check of the neighbour list's walk (vl.rs, af_vl / af_vl3) and the single bonds' twist (d3.rs, af_tors1)
//! against a dump made by tools/vldump.js (1.26):
//!   cargo run --release --example vlcheck -- /tmp/water3d.vl [more dumps…]
//! The list must be the JavaScript's pair for pair; the twist's forces bit for bit.
use atom_forge_kernel::{d3, vl};
use std::fs;

fn rd_u32(b: &[u8], o: usize) -> u32 { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) }
fn rd_f64(b: &[u8], o: usize) -> f64 { f64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() { eprintln!("usage: vlcheck <dump.vl>…"); std::process::exit(2); }
    let mut bad = 0;
    for path in &args {
        let f = fs::read(path).expect("read dump");
        assert_eq!(&f[0..4], b"AFVL", "bad magic");
        let hdr = rd_u32(&f, 4) as usize; let mem_len = rd_u32(&f, 8) as usize; let d3 = rd_u32(&f, 12) != 0;
        let np = rd_u32(&f, 16) as usize; let cap = rd_u32(&f, 20) as usize; let n = rd_u32(&f, 24) as usize; let ns = rd_u32(&f, 28) as usize;
        let mut t = [0i32; vl::V_LEN]; for k in 0..vl::V_LEN { t[k] = rd_u32(&f, 32 + 4 * k) as i32; }
        let mut p = [0.0f64; vl::VP_LEN]; for k in 0..8 { p[k] = rd_f64(&f, 104 + 8 * k); }
        let desc = rd_u32(&f, 168) as usize; let sq = rd_u32(&f, 172) as usize; let sk = rd_u32(&f, 176) as usize;
        let ofx = rd_u32(&f, 180) as usize; let ofy = rd_u32(&f, 184) as usize; let ofz = rd_u32(&f, 188) as usize; let f0 = rd_f64(&f, 192);
        let mut o = hdr;
        let epi: Vec<i32> = (0..np).map(|k| rd_u32(&f, o + 4 * k) as i32).collect(); o += 4 * np;
        let epj: Vec<i32> = (0..np).map(|k| rd_u32(&f, o + 4 * k) as i32).collect(); o += 4 * np;
        let mut ef = [vec![0.0f64; n], vec![0.0f64; n], vec![0.0f64; n]];
        for a in 0..3 { for i in 0..n { ef[a][i] = rd_f64(&f, o + 8 * i); } o += 8 * n; }
        o = (o + 7) & !7;
        let mut mem: Vec<u64> = vec![0; (mem_len + 7) / 8];
        let base = mem.as_mut_ptr() as usize;
        unsafe { std::ptr::copy_nonoverlapping(f[o..o + mem_len].as_ptr(), base as *mut u8, mem_len); }
        // the whole list, then the same in three stretches (as the workers build it: 3-D by particles, 2-D by cells)
        p[vl::VP_P0] = 0.0; p[vl::VP_P1] = if d3 { f64::INFINITY } else { t[vl::V_NOCC] as f64 }; p[vl::VP_BASE] = 0.0; p[vl::VP_CAP] = cap as f64;
        let mut got = 0; let mut dt = std::time::Duration::from_secs(1000);
        for _ in 0..10 { let t0 = std::time::Instant::now(); got = unsafe { if d3 { vl::vl_pairs3(base, t.as_ptr(), p.as_ptr()) } else { vl::vl_pairs(base, t.as_ptr(), p.as_ptr()) } }; dt = dt.min(t0.elapsed()); } // (the best of ten)
        let opi = (base + t[vl::V_PI] as u32 as usize) as *const i32; let opj = (base + t[vl::V_PJ] as u32 as usize) as *const i32;
        let same = got as usize == np && (0..np).all(|k| unsafe { *opi.add(k) == epi[k] && *opj.add(k) == epj[k] });
        // stretches: three ranges, each into its own part of the arrays, joined
        let total = if d3 { 1usize << 40 } else { t[vl::V_NOCC] as usize };
        let ng = if d3 { mem_len } else { total }; let _ = ng;
        let mut joined: Vec<(i32, i32)> = Vec::new(); let mut short = false;
        let cuts: Vec<f64> = if d3 { let m = rd_u32(&f, 24) as f64; vec![0.0, (m / 3.0).floor(), (2.0 * m / 3.0).floor(), f64::INFINITY] } else { let c = total as f64; vec![0.0, (c / 3.0).floor(), (2.0 * c / 3.0).floor(), c] };
        let per = cap / 3;
        for w in 0..3 {
            p[vl::VP_P0] = cuts[w]; p[vl::VP_P1] = cuts[w + 1]; p[vl::VP_BASE] = (w * per) as f64; p[vl::VP_CAP] = per as f64;
            let c = unsafe { if d3 { vl::vl_pairs3(base, t.as_ptr(), p.as_ptr()) } else { vl::vl_pairs(base, t.as_ptr(), p.as_ptr()) } };
            if c < 0 { short = true; break; }
            for k in 0..c as usize { unsafe { joined.push((*opi.add(w * per + k), *opj.add(w * per + k))); } }
        }
        let same3 = !short && joined.len() == np && (0..np).all(|k| joined[k] == (epi[k], epj[k]));
        // the twist
        let (mut nbit, mut maxd) = (0usize, 0.0f64);
        if ns > 0 {
            let s = unsafe { atom_forge_kernel::store(base, (base + desc) as *const i32) }; let s3 = unsafe { d3::store3(base, (base + desc) as *const i32) };
            let bx = d3::Box3 { wrap: p[vl::VP_WRAP] != 0.0, bw: p[vl::VP_BW], bh: p[vl::VP_BH], bd: p[vl::VP_BD], hw: p[vl::VP_HW], hh: p[vl::VP_HH], hd: p[vl::VP_HD] };
            let (fx, fy, fz) = ((base + ofx) as *mut f64, (base + ofy) as *mut f64, (base + ofz) as *mut f64);
            unsafe { d3::tors1_range(&s, &s3, &bx, (base + sq) as *const i32, (base + sk) as *const f64, 0, ns, f0, fx, fy, fz); }
            for i in 0..n { for (a, q) in [fx, fy, fz].iter().enumerate() { let g = unsafe { *q.add(i) }; if g.to_bits() != ef[a][i].to_bits() { nbit += 1; maxd = maxd.max((g - ef[a][i]).abs()); } } }
        }
        println!("{}: {} | list {} pairs: {} (whole), {} (three stretches), {:.3} ms | single-bond dihedrals {}: {} components not bit-identical (max {:.1e})",
            path, if d3 { "3-D" } else { "flat" }, np, if same { "same" } else { "DIFFERENT" }, if same3 { "same" } else { "DIFFERENT" }, dt.as_secs_f64() * 1e3, ns, nbit, maxd);
        if !same || !same3 || nbit > 0 { bad += 1; }
    }
    if bad > 0 { eprintln!("{} dump(s) differ", bad); std::process::exit(1); }
    println!("lists and twists agree");
}
