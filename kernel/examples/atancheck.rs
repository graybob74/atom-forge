use atom_forge_kernel::fastmath;
fn main() {
    let mut s = 0x9E3779B97F4A7C15u64; let mut rnd = || { s ^= s << 13; s ^= s >> 7; s ^= s << 17; (s >> 11) as f64 / (1u64 << 53) as f64 };
    let (mut maxulp, mut worst) = (0.0f64, (0.0, 0.0));
    for _ in 0..5_000_000 {
        let r = 0.3 + 5.0 * rnd(); let th = (rnd() * 2.0 - 1.0) * std::f64::consts::PI; let (y, x) = (r * th.sin(), r * th.cos());
        let a = fastmath::atan2(y, x); let b = y.atan2(x);
        let ulp = ((a - b).abs() / f64::EPSILON / b.abs().max(1e-300)).min(1e9);
        if ulp > maxulp { maxulp = ulp; worst = (y, x); }
    }
    println!("fast atan2 vs std over 5e6 random angles: max {:.2} ulp (worst at y {} x {})", maxulp, worst.0, worst.1);
    let n = 10_000_000; let t0 = std::time::Instant::now(); let mut acc = 0.0; for i in 0..n { let t = i as f64 * 1e-6 - 5.0; acc += fastmath::atan2(t, 1.3); } let d1 = t0.elapsed();
    let t0 = std::time::Instant::now(); let mut acc2 = 0.0; for i in 0..n { let t = i as f64 * 1e-6 - 5.0; acc2 += t.atan2(1.3); } let d2 = t0.elapsed();
    println!("native: fast {:.1} ns, std {:.1} ns ({} {})", d1.as_nanos() as f64 / n as f64, d2.as_nanos() as f64 / n as f64, acc, acc2);
}
