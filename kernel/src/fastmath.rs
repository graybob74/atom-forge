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
