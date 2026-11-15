use atom_forge_kernel::fastmath::{cbrt_pos, exp_fast};
#[test]
fn fast_math_accuracy() {
    let mut worst_c = 0f64; let mut worst_e = 0f64;
    let mut x = 1e-6f64; while x < 1e6 { let a = cbrt_pos(x); let b = x.cbrt(); worst_c = worst_c.max(((a - b) / b).abs()); x *= 1.0137; }
    let mut x = -60.0f64; while x < 60.0 { let a = exp_fast(x); let b = x.exp(); worst_e = worst_e.max(((a - b) / b).abs()); x += 0.00731; }
    println!("cbrt worst rel {:e}, exp worst rel {:e}", worst_c, worst_e);
    assert!(worst_c < 4e-16 && worst_e < 4e-16);
}
