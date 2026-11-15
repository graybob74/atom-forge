//! atan2 without the libm detour: in WebAssembly the standard library's atan2 and hypot are software routines of
//! 60–100 ns, and the angle kernel is nothing but them. This is Cephes' atan (a rational minimax on |x| ≤ 0.66 after
//! reducing by π/2 and π/4), accurate to about one unit in the last place, plus the usual quadrant logic.
use core::f64::consts::{FRAC_PI_2, FRAC_PI_4, PI};

const P: [f64; 5] = [-8.750608600031904122785E-1, -1.615753718733365076637E1, -7.500855792314704667340E1, -1.228866684490136173410E2, -6.485021904942025371773E1];
const Q: [f64; 5] = [2.485846490142306297962E1, 1.650270098316988542046E2, 4.328810604912902668951E2, 4.853903996359136964868E2, 1.945506571482613964425E2];
const MOREBITS: f64 = 6.123233995736765886130E-17; // π/2 = 1.5707963267948966 + MOREBITS
const T3P8: f64 = 2.41421356237309504880; // tan(3π/8)

#[inline(always)]
pub fn atan(x: f64) -> f64 {
    let neg = x < 0.0;
    let mut x = x.abs();
    let (mut y, flag);
    if x > T3P8 { y = FRAC_PI_2; flag = 1; x = -1.0 / x; }
    else if x <= 0.66 { y = 0.0; flag = 0; }
    else { y = FRAC_PI_4; flag = 2; x = (x - 1.0) / (x + 1.0); }
    let z = x * x;
    let p = (((P[0] * z + P[1]) * z + P[2]) * z + P[3]) * z + P[4];
    let q = ((((z + Q[0]) * z + Q[1]) * z + Q[2]) * z + Q[3]) * z + Q[4];
    let mut r = z * p / q;
    r = x * r + x;
    if flag == 2 { r += 0.5 * MOREBITS; } else if flag == 1 { r += MOREBITS; }
    y += r;
    if neg { -y } else { y }
}
/// atan2(y, x) with the usual quadrants and the axes exact (the kernel never passes NaN or infinities).
#[inline(always)]
pub fn atan2(y: f64, x: f64) -> f64 {
    if x == 0.0 {
        return if y > 0.0 { FRAC_PI_2 } else if y < 0.0 { -FRAC_PI_2 } else { 0.0 };
    }
    let z = atan(y / x);
    if x > 0.0 { z } else if y >= 0.0 { z + PI } else { z - PI }
}

/// ∛x for x > 0 (1.34.3, the three-body dispersion's damping): a first guess from the exponent bits, then Newton's steps
/// (three: to the last bit or one off). The library's cbrt is a call into compiled-in libm, several times slower here.
#[inline(always)]
pub fn cbrt_pos(x: f64) -> f64 {
    if !(x > 0.0) || !x.is_finite() { return x.cbrt(); }
    let mut y = f64::from_bits(x.to_bits() / 3 + 0x2A9F_7893_782D_A1CE);
    for _ in 0..3 { y -= (y - x / (y * y)) / 3.0; }
    y + (x / (y * y) - y) / 3.0
}
/// e^x (1.34.3, the nucleons' potential): x = k·ln 2 + r, |r| ≤ ln 2 / 2, e^r by its series to the 13th power (relative
/// error under 2·10⁻¹⁶), times 2^k by the exponent bits. For −700 < x < 700; else the library's.
#[inline(always)]
pub fn exp_fast(x: f64) -> f64 {
    if !(x > -700.0 && x < 700.0) { return x.exp(); }
    let k = (x * core::f64::consts::LOG2_E).round();
    let r = (x - k * 6.931_471_803_691_238_164_90e-1) - k * 1.908_214_929_270_587_700_02e-10;
    let mut p = 1.0 / 6_227_020_800.0;
    p = p * r + 1.0 / 479_001_600.0; p = p * r + 1.0 / 39_916_800.0; p = p * r + 1.0 / 3_628_800.0; p = p * r + 1.0 / 362_880.0;
    p = p * r + 1.0 / 40_320.0; p = p * r + 1.0 / 5_040.0; p = p * r + 1.0 / 720.0; p = p * r + 1.0 / 120.0; p = p * r + 1.0 / 24.0;
    p = p * r + 1.0 / 6.0; p = p * r + 0.5; p = p * r + 1.0; p = p * r + 1.0;
    p * f64::from_bits(((k as i64 + 1023) as u64) << 52)
}
