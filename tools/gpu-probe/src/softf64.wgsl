// ============================================================================
// softf64.wgsl: IEEE-754 binary64 ("double") arithmetic for WebGPU, done with
// 32-bit integer operations only. A double is carried as its bit pattern in a
// vec2<u32>(low word, high word), which is exactly how a JavaScript Float64Array
// lays it out in memory, so a Float64Array can be uploaded and read back as is.
//
// Every operation here rounds to nearest, ties to even, and handles zeros,
// subnormals, infinities and NaN, so results match a CPU's doubles bit for bit.
// No floating-point instruction is used, so a shader compiler's fast-math
// settings cannot change the answers.
// ============================================================================
// (named U64 / F64 because native wgpu has real types called u64 and f64)
alias U64 = vec2<u32>;
alias F64 = vec2<u32>;

const F64_NAN = vec2<u32>(0u, 0x7ff80000u);

// ---- 64-bit unsigned integers ----
fn u64_add(a: U64, b: U64) -> U64 { let lo = a.x + b.x; return U64(lo, a.y + b.y + u32(lo < a.x)); }
fn u64_sub(a: U64, b: U64) -> U64 { return U64(a.x - b.x, a.y - b.y - u32(a.x < b.x)); }
fn u64_lt(a: U64, b: U64) -> bool { return a.y < b.y || (a.y == b.y && a.x < b.x); }
fn u64_ge(a: U64, b: U64) -> bool { return !u64_lt(a, b); }
fn u64_nz(a: U64) -> bool { return (a.x | a.y) != 0u; }
fn u64_shl(a: U64, n: u32) -> U64 {            // 0 <= n < 64
  if (n == 0u) { return a; }
  if (n >= 32u) { return U64(0u, a.x << (n - 32u)); }
  return U64(a.x << n, (a.y << n) | (a.x >> (32u - n)));
}
fn u64_shr(a: U64, n: u32) -> U64 {            // 0 <= n < 64
  if (n == 0u) { return a; }
  if (n >= 32u) { return U64(a.y >> (n - 32u), 0u); }
  return U64((a.x >> n) | (a.y << (32u - n)), a.y >> n);
}
// the same for a fixed distance 0 < n < 32: no branches
fn u64_shlc(a: U64, n: u32) -> U64 { return U64(a.x << n, (a.y << n) | (a.x >> (32u - n))); }
fn u64_shrc(a: U64, n: u32) -> U64 { return U64((a.x >> n) | (a.y << (32u - n)), a.y >> n); }
// shift right, keeping a "sticky" 1 in the lowest bit if any 1 was shifted out (any n)
fn u64_shr_jam(a: U64, n: u32) -> U64 {
  if (n == 0u) { return a; }
  if (n >= 64u) { return U64(u32(u64_nz(a)), 0u); }
  let r = u64_shr(a, n);
  return U64(r.x | u32(u64_nz(u64_shl(a, 64u - n))), r.y);
}
fn u64_clz(a: U64) -> u32 {
  if (a.y != 0u) { return countLeadingZeros(a.y); }
  return 32u + countLeadingZeros(a.x);
}
// 32 x 32 -> 64
fn mul32(a: u32, b: u32) -> U64 {
  let al = a & 0xffffu; let ah = a >> 16u; let bl = b & 0xffffu; let bh = b >> 16u;
  let ll = al * bl; let lh = al * bh; let hl = ah * bl; let hh = ah * bh;
  let t = (ll >> 16u) + (lh & 0xffffu) + (hl & 0xffffu);
  return U64((ll & 0xffffu) | (t << 16u), hh + (lh >> 16u) + (hl >> 16u) + (t >> 16u));
}
// 64 x 64 -> 128, as four words, lowest first
fn mul64(a: U64, b: U64) -> vec4<u32> {
  let p00 = mul32(a.x, b.x); let p01 = mul32(a.x, b.y); let p10 = mul32(a.y, b.x); let p11 = mul32(a.y, b.y);
  let s1 = p00.y + p01.x; let c1 = u32(s1 < p00.y);
  let s2 = s1 + p10.x;    let c2 = u32(s2 < s1);
  let s3 = p01.y + p10.y; let c3 = u32(s3 < p01.y);
  let s4 = s3 + p11.x;    let c4 = u32(s4 < s3);
  let s5 = s4 + c1 + c2;  let c5 = u32(s5 < s4);
  return vec4<u32>(p00.x, s2, s5, p11.y + c3 + c4 + c5);
}

// ---- taking a double apart and putting it together ----
fn f64_sign(a: F64) -> u32 { return a.y >> 31u; }
fn f64_exp(a: F64) -> i32 { return i32((a.y >> 20u) & 0x7ffu); }
fn f64_frac(a: F64) -> U64 { return U64(a.x, a.y & 0xfffffu); }
fn f64_is_nan(a: F64) -> bool { return (a.y & 0x7ff00000u) == 0x7ff00000u && ((a.y & 0xfffffu) | a.x) != 0u; }
fn f64_pack(sign: u32, e: i32, sig: U64) -> F64 { return u64_add(U64(0u, (sign << 31u) | (u32(e) << 20u)), sig); }
fn f64_inf(sign: u32) -> F64 { return F64(0u, (sign << 31u) | 0x7ff00000u); }
fn f64_zero(sign: u32) -> F64 { return F64(0u, sign << 31u); }
fn f64_neg(a: F64) -> F64 { return F64(a.x, a.y ^ 0x80000000u); }
fn f64_abs(a: F64) -> F64 { return F64(a.x, a.y & 0x7fffffffu); }

// sig holds the value with its leading 1 at bit 62 and ten rounding bits at the bottom;
// e is one less than the exponent field of the result (the leading 1 carries into it).
fn f64_round_pack(sign: u32, e_in: i32, sig_in: U64) -> F64 {
  var e = e_in; var sig = sig_in;
  if (e >= 0x7fd) {
    if (e > 0x7fd || (u64_add(sig, U64(0x200u, 0u)).y & 0x80000000u) != 0u) { return f64_inf(sign); }
  }
  if (e < 0) { sig = u64_shr_jam(sig, u32(-e)); e = 0; }
  let round_bits = sig.x & 0x3ffu;
  sig = u64_shrc(u64_add(sig, U64(0x200u, 0u)), 10u);
  if (round_bits == 0x200u) { sig.x = sig.x & 0xfffffffeu; }   // a tie goes to the even neighbour
  if (!u64_nz(sig)) { e = 0; }
  return f64_pack(sign, e, sig);
}
fn f64_norm_round_pack(sign: u32, e: i32, sig: U64) -> F64 {
  let s = u64_clz(sig) - 1u;
  return f64_round_pack(sign, e - i32(s), u64_shl(sig, s));
}

fn f64_add_sigs(a: F64, b: F64, sign: u32) -> F64 {
  var a_sig = u64_shlc(f64_frac(a), 9u); var b_sig = u64_shlc(f64_frac(b), 9u);
  let a_exp = f64_exp(a); let b_exp = f64_exp(b);
  var d = a_exp - b_exp; var z_exp: i32; var z: U64;
  let top = U64(0u, 0x20000000u);
  if (d > 0) {
    if (a_exp == 0x7ff) { if (u64_nz(a_sig)) { return F64_NAN; } return a; }
    if (b_exp == 0) { d -= 1; } else { b_sig = u64_add(b_sig, top); }
    b_sig = u64_shr_jam(b_sig, u32(d)); z_exp = a_exp;
  } else if (d < 0) {
    if (b_exp == 0x7ff) { if (u64_nz(b_sig)) { return F64_NAN; } return f64_inf(sign); }
    if (a_exp == 0) { d += 1; } else { a_sig = u64_add(a_sig, top); }
    a_sig = u64_shr_jam(a_sig, u32(-d)); z_exp = b_exp;
  } else {
    if (a_exp == 0x7ff) { if (u64_nz(a_sig) || u64_nz(b_sig)) { return F64_NAN; } return a; }
    if (a_exp == 0) { return f64_pack(sign, 0, u64_shrc(u64_add(a_sig, b_sig), 9u)); }
    z = u64_add(u64_add(a_sig, b_sig), U64(0u, 0x40000000u));
    return f64_round_pack(sign, a_exp, z);
  }
  a_sig = u64_add(a_sig, top);
  let s = u64_add(a_sig, b_sig);
  z = u64_shlc(s, 1u); z_exp -= 1;
  if ((z.y & 0x80000000u) != 0u) { z = s; z_exp += 1; }
  return f64_round_pack(sign, z_exp, z);
}
fn f64_sub_sigs(a: F64, b: F64, sign_in: u32) -> F64 {
  var sign = sign_in;
  var a_sig = u64_shlc(f64_frac(a), 10u); var b_sig = u64_shlc(f64_frac(b), 10u);
  var a_exp = f64_exp(a); var b_exp = f64_exp(b);
  var d = a_exp - b_exp;
  let top = U64(0u, 0x40000000u);
  var z: U64; var z_exp: i32;
  if (d > 0) {
    if (a_exp == 0x7ff) { if (u64_nz(a_sig)) { return F64_NAN; } return a; }
    if (b_exp == 0) { d -= 1; } else { b_sig = u64_add(b_sig, top); }
    b_sig = u64_shr_jam(b_sig, u32(d)); a_sig = u64_add(a_sig, top);
    z = u64_sub(a_sig, b_sig); z_exp = a_exp;
  } else if (d < 0) {
    if (b_exp == 0x7ff) { if (u64_nz(b_sig)) { return F64_NAN; } return f64_inf(sign ^ 1u); }
    if (a_exp == 0) { d += 1; } else { a_sig = u64_add(a_sig, top); }
    a_sig = u64_shr_jam(a_sig, u32(-d)); b_sig = u64_add(b_sig, top);
    z = u64_sub(b_sig, a_sig); z_exp = b_exp; sign = sign ^ 1u;
  } else {
    if (a_exp == 0x7ff) { return F64_NAN; }            // NaN, or infinity minus infinity
    if (a_exp == 0) { a_exp = 1; b_exp = 1; }
    if (u64_lt(b_sig, a_sig)) { z = u64_sub(a_sig, b_sig); z_exp = a_exp; }
    else if (u64_lt(a_sig, b_sig)) { z = u64_sub(b_sig, a_sig); z_exp = b_exp; sign = sign ^ 1u; }
    else { return f64_zero(0u); }
  }
  return f64_norm_round_pack(sign, z_exp - 1, z);
}
fn f64_add(a: F64, b: F64) -> F64 {
  let sa = f64_sign(a);
  if (sa == f64_sign(b)) { return f64_add_sigs(a, b, sa); }
  return f64_sub_sigs(a, b, sa);
}
fn f64_sub(a: F64, b: F64) -> F64 { return f64_add(a, f64_neg(b)); }

fn f64_mul(a: F64, b: F64) -> F64 {
  var a_sig = f64_frac(a); var b_sig = f64_frac(b);
  var a_exp = f64_exp(a); var b_exp = f64_exp(b);
  let sign = f64_sign(a) ^ f64_sign(b);
  if (a_exp == 0x7ff) {
    if (u64_nz(a_sig) || (b_exp == 0x7ff && u64_nz(b_sig))) { return F64_NAN; }
    if (b_exp == 0 && !u64_nz(b_sig)) { return F64_NAN; }
    return f64_inf(sign);
  }
  if (b_exp == 0x7ff) {
    if (u64_nz(b_sig)) { return F64_NAN; }
    if (a_exp == 0 && !u64_nz(a_sig)) { return F64_NAN; }
    return f64_inf(sign);
  }
  if (a_exp == 0) {
    if (!u64_nz(a_sig)) { return f64_zero(sign); }
    let s = u64_clz(a_sig) - 11u; a_sig = u64_shl(a_sig, s); a_exp = 1 - i32(s);
  }
  if (b_exp == 0) {
    if (!u64_nz(b_sig)) { return f64_zero(sign); }
    let s = u64_clz(b_sig) - 11u; b_sig = u64_shl(b_sig, s); b_exp = 1 - i32(s);
  }
  var z_exp = a_exp + b_exp - 0x3ff;
  a_sig = u64_shlc(U64(a_sig.x, a_sig.y | 0x100000u), 10u);
  b_sig = u64_shlc(U64(b_sig.x, b_sig.y | 0x100000u), 11u);
  let p = mul64(a_sig, b_sig);
  var z = U64(p.z | u32((p.x | p.y) != 0u), p.w);
  if ((z.y & 0x40000000u) == 0u) { z = u64_shlc(z, 1u); z_exp -= 1; }
  return f64_round_pack(sign, z_exp, z);
}

fn f64_div(a: F64, b: F64) -> F64 {
  var a_sig = f64_frac(a); var b_sig = f64_frac(b);
  var a_exp = f64_exp(a); var b_exp = f64_exp(b);
  let sign = f64_sign(a) ^ f64_sign(b);
  if (a_exp == 0x7ff) {
    if (u64_nz(a_sig) || b_exp == 0x7ff) { return F64_NAN; }
    return f64_inf(sign);
  }
  if (b_exp == 0x7ff) { if (u64_nz(b_sig)) { return F64_NAN; } return f64_zero(sign); }
  if (b_exp == 0) {
    if (!u64_nz(b_sig)) { if (a_exp == 0 && !u64_nz(a_sig)) { return F64_NAN; } return f64_inf(sign); }
    let s = u64_clz(b_sig) - 11u; b_sig = u64_shl(b_sig, s); b_exp = 1 - i32(s);
  }
  if (a_exp == 0) {
    if (!u64_nz(a_sig)) { return f64_zero(sign); }
    let s = u64_clz(a_sig) - 11u; a_sig = u64_shl(a_sig, s); a_exp = 1 - i32(s);
  }
  var z_exp = a_exp - b_exp + 0x3fd;
  var rem = U64(a_sig.x, a_sig.y | 0x100000u);
  let den = U64(b_sig.x, b_sig.y | 0x100000u);
  if (u64_ge(rem, den)) { z_exp += 1; } else { rem = u64_shlc(rem, 1u); }
  // long division, nine bits a turn. The quotient's leading bit is always 1; each further digit is guessed from the
  // top words (the divisor's rounded up, so the guess is never too big and at most one too small) and then corrected.
  rem = u64_sub(rem, den);
  var q = U64(1u, 0u);
  let dh = den.y + 1u;
  for (var i = 0; i < 6; i++) {
    rem = u64_shlc(rem, 9u);
    var d = rem.y / dh;
    let pl = mul32(d, den.x);
    rem = u64_sub(rem, U64(pl.x, pl.y + d * den.y));
    if (u64_ge(rem, den)) { rem = u64_sub(rem, den); d += 1u; }
    if (u64_ge(rem, den)) { rem = u64_sub(rem, den); d += 1u; }
    q = u64_shlc(q, 9u); q.x = q.x | d;
  }
  q = u64_shlc(q, 8u);
  q.x = q.x | u32(u64_nz(rem));
  return f64_round_pack(sign, z_exp, q);
}

fn f64_sqrt(a: F64) -> F64 {
  var a_sig = f64_frac(a); var a_exp = f64_exp(a);
  let sign = f64_sign(a);
  if (a_exp == 0x7ff) { if (u64_nz(a_sig) || sign == 1u) { return F64_NAN; } return a; }
  if (sign == 1u) { if (a_exp == 0 && !u64_nz(a_sig)) { return a; } return F64_NAN; }
  if (a_exp == 0) {
    if (!u64_nz(a_sig)) { return a; }
    let s = u64_clz(a_sig) - 11u; a_sig = u64_shl(a_sig, s); a_exp = 1 - i32(s);
  }
  let z_exp = ((a_exp - 0x3ff) >> 1u) + 0x3fe;
  var m = U64(a_sig.x, a_sig.y | 0x100000u);
  if ((a_exp & 1) == 0) { m = u64_shlc(m, 1u); }       // an odd power of two: fold one factor of 2 into the digits
  // square root digit by digit: two bits of the number in, one bit of the root out
  var q = U64(0u, 0u); var rem = U64(0u, 0u);
  var mm = u64_shlc(m, 10u);                          // the 54 bits at the top: each turn takes the top two
  for (var i = 0; i < 55; i++) {
    rem = u64_shlc(rem, 2u); rem.x = rem.x | (mm.y >> 30u);
    mm = u64_shlc(mm, 2u);
    var t = u64_shlc(q, 2u); t.x = t.x | 1u;
    q = u64_shlc(q, 1u);
    if (u64_ge(rem, t)) { rem = u64_sub(rem, t); q.x = q.x | 1u; }
  }
  q = u64_shlc(q, 8u);
  q.x = q.x | u32(u64_nz(rem));
  return f64_round_pack(0u, z_exp, q);
}

// ---- comparisons (false if either side is NaN) ----
fn f64_eq(a: F64, b: F64) -> bool {
  if (f64_is_nan(a) || f64_is_nan(b)) { return false; }
  return (a.x == b.x && a.y == b.y) || ((((a.y | b.y) << 1u) | a.x | b.x) == 0u);
}
fn f64_lt(a: F64, b: F64) -> bool {
  if (f64_is_nan(a) || f64_is_nan(b)) { return false; }
  let sa = f64_sign(a); let sb = f64_sign(b);
  if (sa != sb) { return sa == 1u && ((((a.y | b.y) << 1u) | a.x | b.x) != 0u); }
  if (a.x == b.x && a.y == b.y) { return false; }
  return (sa == 1u) != u64_lt(a, b);
}
fn f64_le(a: F64, b: F64) -> bool { return f64_lt(a, b) || f64_eq(a, b); }

// ---- to and from the GPU's own 32-bit floats and integers ----
fn f64_from_f32_bits(v: u32) -> F64 {
  let sign = v >> 31u; var e = i32((v >> 23u) & 0xffu); var frac = v & 0x7fffffu;
  if (e == 0xff) { if (frac != 0u) { return F64_NAN; } return f64_inf(sign); }
  if (e == 0) {
    if (frac == 0u) { return f64_zero(sign); }
    let s = countLeadingZeros(frac) - 8u; frac = (frac << s) & 0x7fffffu; e = 1 - i32(s);
  }
  return f64_pack(sign, e + 0x380, u64_shlc(U64(frac, 0u), 29u));
}
fn f64_from_f32(x: f32) -> F64 { return f64_from_f32_bits(bitcast<u32>(x)); }
fn f64_to_f32_bits(a: F64) -> u32 {
  let sign = f64_sign(a); var e = f64_exp(a); let frac = f64_frac(a);
  if (e == 0x7ff) { if (u64_nz(frac)) { return 0x7fc00000u; } return (sign << 31u) | 0x7f800000u; }
  var sig = u64_shr_jam(frac, 22u).x;
  if (e != 0 || sig != 0u) { sig = sig | 0x40000000u; e -= 0x381; }
  if (e >= 0xfd) {
    if (e > 0xfd || ((sig + 0x40u) & 0x80000000u) != 0u) { return (sign << 31u) | 0x7f800000u; }
  }
  if (e < 0) {
    let n = u32(-e);
    if (n >= 32u) { sig = u32(sig != 0u); } else { sig = (sig >> n) | u32((sig << (32u - n)) != 0u); }
    e = 0;
  }
  let round_bits = sig & 0x7fu;
  sig = (sig + 0x40u) >> 7u;
  if (round_bits == 0x40u) { sig = sig & 0xfffffffeu; }
  if (sig == 0u) { e = 0; }
  return (sign << 31u) + (u32(e) << 23u) + sig;
}
fn f64_to_f32(a: F64) -> f32 { return bitcast<f32>(f64_to_f32_bits(a)); }
fn f64_from_i32(v: i32) -> F64 {
  if (v == 0) { return f64_zero(0u); }
  let sign = u32(v < 0);
  var m = u32(v); if (v < 0) { m = ~m + 1u; }
  let s = countLeadingZeros(m);                       // leading 1 to bit 31, then to bit 52 of the 64
  return f64_pack(sign, 0x3ff + 31 - i32(s), u64_shlc(U64((m << s) & 0x7fffffffu, 0u), 21u));
}
