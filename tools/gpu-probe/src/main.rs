//! Atom Forge native GPU probe.
//!
//! Not part of the game. It answers one question with numbers: outside a browser, how long does a graphics card take
//! to do an Atom Forge sized force pass and hand the result back, with real 64-bit floats (where the card and driver
//! offer them), with 64-bit floats emulated from integers (src/softf64.wgsl), and with 32-bit floats, against the CPU
//! on one thread and on all of them. The world and the sums are the same as in the browser probe page, so the two
//! reports can be read side by side.
//!
//! Double-click it, or run it in a terminal. It prints a report and writes it to gpu-probe-results.txt beside the program.
//!   --quick       a tenth of the atoms (for software renderers on build machines)
//!   --no-wait     do not wait for Enter at the end
//!   --adapter N   use adapter N from the printed list instead of the automatic choice
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rayon::prelude::*;
use wgpu::util::DeviceExt;

const SOFT: &str = include_str!("softf64.wgsl");

// The model: Lennard-Jones plus Coulomb inside a 6 Å cutoff, in Atom Forge's units (Å, eV).
const RC2: f64 = 36.0;
const SIG2: f64 = 9.0;
const EPS24: f64 = 0.24;
const KC: f64 = 14.3996454784;

struct World {
    n: usize,
    pos: Vec<f64>,
    q: Vec<f64>,
    start: Vec<u32>,
    nb: Vec<u32>,
}

/// The same jittered lattice and neighbour list (cutoff plus a 1 Å skin) as the browser probe, from the same seed.
fn make_world(n: usize) -> World {
    let mut s: u32 = 12345;
    let mut rnd = move || {
        s = s.wrapping_mul(1664525).wrapping_add(1013904223);
        s as f64 / 4294967296.0
    };
    let density = 20000.0 / (723.0 * 465.0);
    let nf = n as f64;
    let area = nf / density;
    let w = (area * 723.0 / 465.0).sqrt();
    let h = area / w;
    let nx = (nf * w / h).sqrt().ceil() as usize;
    let ny = (nf / nx as f64).ceil() as usize;
    let sx = w / nx as f64;
    let sy = h / ny as f64;
    let mut pos = vec![0.0f64; 2 * n];
    let mut q = vec![0.0f64; n];
    for i in 0..n {
        let ix = i % nx;
        let iy = i / nx;
        pos[2 * i] = (ix as f64 + 0.5 + (rnd() - 0.5) * 0.4) * sx;
        pos[2 * i + 1] = (iy as f64 + 0.5 + (rnd() - 0.5) * 0.4) * sy;
        q[i] = if (ix + iy) & 1 == 1 { 0.4 } else { -0.4 };
    }
    let cx = ((w / 7.0).floor() as usize).max(1);
    let cy = ((h / 7.0).floor() as usize).max(1);
    let cell_of = |i: usize| -> usize {
        let a = ((pos[2 * i] / w * cx as f64) as usize).min(cx - 1);
        let b = ((pos[2 * i + 1] / h * cy as f64) as usize).min(cy - 1);
        a + cx * b
    };
    let mut head = vec![-1i32; cx * cy];
    let mut next = vec![-1i32; n];
    for i in (0..n).rev() {
        let c = cell_of(i);
        next[i] = head[c];
        head[c] = i as i32;
    }
    let mut start = vec![0u32; n + 1];
    let mut nb: Vec<u32> = Vec::with_capacity(n * 10);
    for i in 0..n {
        start[i] = nb.len() as u32;
        let c = cell_of(i);
        let ccx = c % cx;
        let ccy = c / cx;
        let xi = pos[2 * i];
        let yi = pos[2 * i + 1];
        for gy in ccy.saturating_sub(1)..=(ccy + 1).min(cy - 1) {
            for gx in ccx.saturating_sub(1)..=(ccx + 1).min(cx - 1) {
                let mut j = head[gx + cx * gy];
                while j >= 0 {
                    let ju = j as usize;
                    if ju != i {
                        let dx = xi - pos[2 * ju];
                        let dy = yi - pos[2 * ju + 1];
                        if dx * dx + dy * dy < 49.0 {
                            nb.push(ju as u32);
                        }
                    }
                    j = next[ju];
                }
            }
        }
    }
    start[n] = nb.len() as u32;
    World { n, pos, q, start, nb }
}

/// Forces on atoms i0.. (as many as `out` holds), the sums in the order every other version here uses.
fn cpu_forces_range(w: &World, i0: usize, out: &mut [f64]) {
    for (k, f_out) in out.chunks_exact_mut(2).enumerate() {
        let i = i0 + k;
        let xi = w.pos[2 * i];
        let yi = w.pos[2 * i + 1];
        let qi = w.q[i];
        let mut fx = 0.0f64;
        let mut fy = 0.0f64;
        for &j in &w.nb[w.start[i] as usize..w.start[i + 1] as usize] {
            let j = j as usize;
            let dx = xi - w.pos[2 * j];
            let dy = yi - w.pos[2 * j + 1];
            let r2 = dx * dx + dy * dy;
            if r2 < RC2 {
                let inv = 1.0 / r2;
                let s2 = SIG2 * inv;
                let s6 = s2 * s2 * s2;
                let flj = EPS24 * (2.0 * s6 * s6 - s6) * inv;
                let r = r2.sqrt();
                let fc = KC * qi * w.q[j] * inv * inv * r;
                let f = flj + fc;
                fx = fx + f * dx;
                fy = fy + f * dy;
            }
        }
        f_out[0] = fx;
        f_out[1] = fy;
    }
}

fn cpu_forces_par(w: &World, out: &mut [f64], chunk: usize) {
    out.par_chunks_mut(2 * chunk)
        .enumerate()
        .for_each(|(c, o)| cpu_forces_range(w, c * chunk, o));
}

fn ms_since(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

/// Mean time of `f` in ms: at least three calls, and for about 0.4 s.
fn time_ms(mut f: impl FnMut()) -> f64 {
    f();
    let t0 = Instant::now();
    let mut n = 0u32;
    loop {
        f();
        n += 1;
        if n >= 3 && (ms_since(t0) > 400.0 || n >= 20000) {
            break;
        }
    }
    ms_since(t0) / n as f64
}

fn fmt_ms(x: f64) -> String {
    if x >= 100.0 {
        format!("{x:.0}")
    } else if x >= 10.0 {
        format!("{x:.1}")
    } else if x >= 1.0 {
        format!("{x:.2}")
    } else {
        format!("{x:.3}")
    }
}

#[derive(Default)]
struct Report {
    text: String,
    failed: bool,
    /// Where the report is saved, line by line, so a crash inside a graphics driver still leaves what was measured.
    file: Option<std::path::PathBuf>,
}
impl Report {
    fn line(&mut self, s: impl AsRef<str>) {
        println!("{}", s.as_ref());
        self.text.push_str(s.as_ref());
        self.text.push('\n');
        if let Some(f) = &self.file {
            let _ = std::fs::write(f, &self.text);
        }
    }
}

struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    errors: Arc<Mutex<Vec<String>>>,
}

fn short(s: &str) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    one.chars().take(500).collect()
}

fn take_errors(gpu: &Gpu) -> Option<String> {
    let mut e = gpu.errors.lock().unwrap();
    if e.is_empty() {
        None
    } else {
        let first = short(&e[0]);
        e.clear();
        Some(first)
    }
}

fn make_pipeline(gpu: &Gpu, code: &str) -> Result<(wgpu::ComputePipeline, f64), String> {
    let t0 = Instant::now();
    let s_val = gpu.device.push_error_scope(wgpu::ErrorFilter::Validation);
    let s_int = gpu.device.push_error_scope(wgpu::ErrorFilter::Internal);
    let module = gpu.device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: None,
        source: wgpu::ShaderSource::Wgsl(code.into()),
    });
    let pipe = gpu.device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: None,
        layout: None,
        module: &module,
        entry_point: Some("main"),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });
    let e_int = pollster::block_on(s_int.pop());
    let e_val = pollster::block_on(s_val.pop());
    if let Some(e) = e_val.or(e_int) {
        return Err(format!("shader did not compile: {}", short(&e.to_string())));
    }
    Ok((pipe, ms_since(t0)))
}

fn entry(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry { binding, resource: buffer.as_entire_binding() }
}

const BINDINGS_TAIL: &str = "
@group(0) @binding(2) var<storage, read> START: array<u32>;
@group(0) @binding(3) var<storage, read> NB: array<u32>;
@group(0) @binding(5) var<uniform> U: vec4<u32>;
";

fn code_f32() -> String {
    format!(
        "@group(0) @binding(0) var<storage, read> POS: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> Q: array<f32>;
@group(0) @binding(4) var<storage, read_write> F: array<vec2<f32>>;
{BINDINGS_TAIL}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3<u32>) {{
  let i = g.x; if (i >= U.x) {{ return; }}
  let pi = POS[i]; let qi = Q[i]; var f = vec2<f32>(0.0, 0.0);
  let k1 = START[i + 1u];
  for (var k = START[i]; k < k1; k++) {{
    let j = NB[k]; let d = pi - POS[j]; let r2 = dot(d, d);
    if (r2 < 36.0) {{
      let inv = 1.0 / r2; let s2 = 9.0 * inv; let s6 = s2 * s2 * s2;
      let flj = 0.24 * (2.0 * s6 * s6 - s6) * inv; let fc = 14.3996454784 * qi * Q[j] * inv * inv * sqrt(r2);
      f += (flj + fc) * d;
    }}
  }}
  F[i] = f;
}}"
    )
}

/// Real 64-bit floats: wgpu's own extension to the shader language (the f64 type, literals ending in lf), Vulkan only.
fn code_real() -> String {
    format!(
        "@group(0) @binding(0) var<storage, read> POS: array<f64>;
@group(0) @binding(1) var<storage, read> Q: array<f64>;
@group(0) @binding(4) var<storage, read_write> F: array<f64>;
{BINDINGS_TAIL}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3<u32>) {{
  let i = g.x; if (i >= U.x) {{ return; }}
  let xi = POS[2u * i]; let yi = POS[2u * i + 1u]; let qi = Q[i];
  var fx = 0.0lf; var fy = 0.0lf;
  let k1 = START[i + 1u];
  for (var k = START[i]; k < k1; k++) {{
    let j = NB[k]; let dx = xi - POS[2u * j]; let dy = yi - POS[2u * j + 1u]; let r2 = dx * dx + dy * dy;
    if (r2 < 36.0lf) {{
      let inv = 1.0lf / r2; let s2 = 9.0lf * inv; let s6 = s2 * s2 * s2;
      let flj = 0.24lf * (2.0lf * s6 * s6 - s6) * inv; let r = sqrt(r2); let fc = 14.3996454784lf * qi * Q[j] * inv * inv * r;
      let f = flj + fc;
      fx = fx + f * dx; fy = fy + f * dy;
    }}
  }}
  F[2u * i] = fx; F[2u * i + 1u] = fy;
}}"
    )
}

fn lit64(x: f64) -> String {
    let b = x.to_bits();
    format!("vec2<u32>({}u, {}u)", b as u32, (b >> 32) as u32)
}

fn code_soft() -> String {
    format!(
        "{SOFT}
@group(0) @binding(0) var<storage, read> POS: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> Q: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read_write> F: array<vec4<u32>>;
{BINDINGS_TAIL}
const C_RC2 = {rc2}; const C_ONE = {one}; const C_TWO = {two}; const C_SIG2 = {sig2}; const C_EPS24 = {eps24}; const C_KC = {kc};
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3<u32>) {{
  let i = g.x; if (i >= U.x) {{ return; }}
  let pi = POS[i]; let qi = Q[i]; var fx = vec2<u32>(0u, 0u); var fy = vec2<u32>(0u, 0u);
  let k1 = START[i + 1u];
  for (var k = START[i]; k < k1; k++) {{
    let j = NB[k]; let pj = POS[j];
    let dx = f64_sub(pi.xy, pj.xy); let dy = f64_sub(pi.zw, pj.zw);
    let r2 = f64_add(f64_mul(dx, dx), f64_mul(dy, dy));
    if (f64_lt(r2, C_RC2)) {{
      let inv = f64_div(C_ONE, r2); let s2 = f64_mul(C_SIG2, inv); let s6 = f64_mul(f64_mul(s2, s2), s2);
      let flj = f64_mul(f64_mul(C_EPS24, f64_sub(f64_mul(f64_mul(C_TWO, s6), s6), s6)), inv);
      let fc = f64_mul(f64_mul(f64_mul(f64_mul(f64_mul(C_KC, qi), Q[j]), inv), inv), f64_sqrt(r2));
      let f = f64_add(flj, fc);
      fx = f64_add(fx, f64_mul(f, dx)); fy = f64_add(fy, f64_mul(f, dy));
    }}
  }}
  F[i] = vec4<u32>(fx, fy);
}}",
        rc2 = lit64(RC2),
        one = lit64(1.0),
        two = lit64(2.0),
        sig2 = lit64(SIG2),
        eps24 = lit64(EPS24),
        kc = lit64(KC)
    )
}

fn decode_f32(bytes: &[u8], n: usize) -> Vec<f64> {
    bytes[..8 * n].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f64).collect()
}
fn decode_f64(bytes: &[u8], n: usize) -> Vec<f64> {
    bytes[..16 * n]
        .chunks_exact(8)
        .map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]))
        .collect()
}

struct Variant {
    key: &'static str,
    name: &'static str,
    code: String,
    pos: Vec<u8>,
    q: Vec<u8>,
    out_bytes_per_atom: usize,
    decode: fn(&[u8], usize) -> Vec<f64>,
}

fn variant(key: &'static str, w: &World) -> Variant {
    let f64_bytes = |v: &[f64]| -> Vec<u8> { bytemuck::cast_slice::<f64, u8>(v).to_vec() };
    let f32_bytes = |v: &[f64]| -> Vec<u8> {
        let a: Vec<f32> = v.iter().map(|&x| x as f32).collect();
        bytemuck::cast_slice::<f32, u8>(&a).to_vec()
    };
    match key {
        "f32" => Variant { key, name: "GPU, 32-bit floats", code: code_f32(), pos: f32_bytes(&w.pos), q: f32_bytes(&w.q), out_bytes_per_atom: 8, decode: decode_f32 },
        "real" => Variant { key, name: "GPU, real doubles", code: code_real(), pos: f64_bytes(&w.pos), q: f64_bytes(&w.q), out_bytes_per_atom: 16, decode: decode_f64 },
        _ => Variant { key, name: "GPU, emulated doubles", code: code_soft(), pos: f64_bytes(&w.pos), q: f64_bytes(&w.q), out_bytes_per_atom: 16, decode: decode_f64 },
    }
}

struct KernelResult {
    forces: Vec<f64>,
    per_step: f64,
    work_only: f64,
    compile_ms: f64,
}

struct Runner<'a> {
    gpu: &'a Gpu,
    pipe: wgpu::ComputePipeline,
    bind: wgpu::BindGroup,
    b_pos: wgpu::Buffer,
    b_f: wgpu::Buffer,
    b_r: wgpu::Buffer,
    pos: &'a [u8],
    out_bytes: u64,
    groups: u32,
}
impl Runner<'_> {
    /// One step as a game would do it: send positions, compute, bring the forces back. Or `passes` steps before one read-back.
    fn step(&self, passes: u32) -> Result<Vec<u8>, String> {
        let g = self.gpu;
        g.queue.write_buffer(&self.b_pos, 0, self.pos);
        let mut enc = g.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        for _ in 0..passes {
            let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor { label: None, timestamp_writes: None });
            pass.set_pipeline(&self.pipe);
            pass.set_bind_group(0, &self.bind, &[]);
            pass.dispatch_workgroups(self.groups, 1, 1);
        }
        enc.copy_buffer_to_buffer(&self.b_f, 0, &self.b_r, 0, self.out_bytes);
        g.queue.submit([enc.finish()]);
        let slice = self.b_r.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        g.device.poll(wgpu::PollType::wait_indefinitely()).map_err(|e| format!("waiting for the GPU failed: {e:?}"))?;
        let data = {
            let view = slice.get_mapped_range().map_err(|e| format!("reading the result failed: {e:?}"))?;
            view.to_vec()
        };
        self.b_r.unmap();
        Ok(data)
    }
}

fn run_kernel(gpu: &Gpu, w: &World, v: &Variant) -> Result<KernelResult, String> {
    let (pipe, compile_ms) = make_pipeline(gpu, &v.code)?;
    let d = &gpu.device;
    let init = |contents: &[u8], usage: wgpu::BufferUsages| d.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents, usage });
    let out_bytes = (w.n * v.out_bytes_per_atom) as u64;
    let s_val = d.push_error_scope(wgpu::ErrorFilter::Validation);
    let b_pos = init(&v.pos, wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST);
    let b_q = init(&v.q, wgpu::BufferUsages::STORAGE);
    let b_s = init(bytemuck::cast_slice(&w.start), wgpu::BufferUsages::STORAGE);
    let b_n = init(bytemuck::cast_slice(&w.nb), wgpu::BufferUsages::STORAGE);
    let b_f = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: out_bytes, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false });
    let b_r = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: out_bytes, usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
    let uni: [u32; 4] = [w.n as u32, 0x3f80_0000, 0, 0];
    let b_u = init(bytemuck::cast_slice(&uni), wgpu::BufferUsages::UNIFORM);
    let layout = pipe.get_bind_group_layout(0);
    let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &layout,
        entries: &[entry(0, &b_pos), entry(1, &b_q), entry(2, &b_s), entry(3, &b_n), entry(4, &b_f), entry(5, &b_u)],
    });
    if let Some(e) = pollster::block_on(s_val.pop()) {
        return Err(format!("could not set up the buffers: {}", short(&e.to_string())));
    }
    let r = Runner { gpu, pipe, bind, b_pos, b_f, b_r, pos: &v.pos, out_bytes, groups: (w.n as u32).div_ceil(64) };
    let forces = (v.decode)(&r.step(1)?, w.n);
    // read back every step
    let t0 = Instant::now();
    let mut n = 0u32;
    loop {
        r.step(1)?;
        n += 1;
        if n >= 3 && (ms_since(t0) > 500.0 || n >= 5000) {
            break;
        }
    }
    let per_step = ms_since(t0) / n as f64;
    // many steps, one read-back: what the GPU's own work costs
    let m = ((400.0 / per_step.max(0.05)).round() as u32).clamp(2, 200);
    let t1 = Instant::now();
    r.step(m)?;
    let t_many = ms_since(t1);
    let work_only = ((t_many - per_step) / (m - 1) as f64).max(0.0);
    if let Some(e) = take_errors(gpu) {
        return Err(e);
    }
    Ok(KernelResult { forces, per_step, work_only, compile_ms })
}

fn latency(gpu: &Gpu) -> Result<f64, String> {
    let (pipe, _) = make_pipeline(
        gpu,
        "@group(0) @binding(0) var<storage, read_write> O: array<u32>;
@compute @workgroup_size(1) fn main() { O[0] = O[0] + 1u; }",
    )?;
    let d = &gpu.device;
    let b_o = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: 16, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false });
    let b_r = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: 16, usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
    let layout = pipe.get_bind_group_layout(0);
    let bind = d.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &layout, entries: &[entry(0, &b_o)] });
    let one = || -> Result<(), String> {
        let mut enc = d.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        {
            let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor { label: None, timestamp_writes: None });
            pass.set_pipeline(&pipe);
            pass.set_bind_group(0, &bind, &[]);
            pass.dispatch_workgroups(1, 1, 1);
        }
        enc.copy_buffer_to_buffer(&b_o, 0, &b_r, 0, 16u64);
        gpu.queue.submit([enc.finish()]);
        let slice = b_r.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        d.poll(wgpu::PollType::wait_indefinitely()).map_err(|e| format!("waiting for the GPU failed: {e:?}"))?;
        {
            let view = slice.get_mapped_range().map_err(|e| format!("reading the result failed: {e:?}"))?;
            std::hint::black_box(view[0]);
        }
        b_r.unmap();
        Ok(())
    };
    for _ in 0..10 {
        one()?;
    }
    let mut ts = Vec::with_capacity(300);
    for _ in 0..300 {
        let t = Instant::now();
        one()?;
        ts.push(ms_since(t));
    }
    ts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Ok(ts[ts.len() / 2])
}

struct Cmp {
    same: usize,
    total: usize,
    typ: f64,
    worst: f64,
}

/// Each value against the larger of itself and a typical force: how many are bit-identical, the typical and the worst error.
fn compare(reference: &[f64], got: &[f64]) -> Cmp {
    let total = reference.len();
    let rms = (reference.iter().map(|v| v * v).sum::<f64>() / (total as f64 / 2.0)).sqrt();
    let mut same = 0;
    let mut e: Vec<f64> = Vec::with_capacity(total);
    for (a, b) in reference.iter().zip(got) {
        if a.to_bits() == b.to_bits() {
            same += 1;
        }
        let d = (a - b).abs() / a.abs().max(rms);
        e.push(if d.is_nan() { f64::INFINITY } else { d });
    }
    e.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Cmp { same, total, typ: e[total / 2], worst: e[total - 1] }
}

fn cmp_text(c: &Cmp) -> String {
    format!("{}/{} identical, rel err typical {:.1e} worst {:.1e}", c.same, c.total, c.typ, c.worst)
}

/// One size: the CPU on one thread and on all, then each GPU method. Returns the methods too slow to repeat at ten times the size.
fn bench(rep: &mut Report, gpu: Option<&Gpu>, has_f64: bool, soft_ok: bool, n: usize, skip: &[&'static str]) -> Vec<&'static str> {
    let w = make_world(n);
    rep.line(format!("{} atoms, {} neighbour entries:", n, w.nb.len()));
    let mut reference = vec![0.0f64; 2 * n];
    let cpu1 = time_ms(|| cpu_forces_range(&w, 0, &mut reference));
    rep.line(format!("  CPU, native doubles (1 thread): {} ms/step, reference", fmt_ms(cpu1)));
    let threads = rayon::current_num_threads();
    let chunk = (n / (threads * 8)).max(64);
    let mut par = vec![0.0f64; 2 * n];
    let cpu_n = time_ms(|| cpu_forces_par(&w, &mut par, chunk));
    rep.line(format!("  CPU, native doubles ({} threads): {} ms/step, {}", threads, fmt_ms(cpu_n), cmp_text(&compare(&reference, &par))));
    let mut slow = Vec::new();
    let Some(gpu) = gpu else {
        return slow;
    };
    for key in ["f32", "real", "soft"] {
        let v = variant(key, &w);
        if key == "real" && !has_f64 {
            rep.line(format!("  {}: not offered by this adapter", v.name));
            continue;
        }
        if key == "soft" && !soft_ok {
            // seen on the build machine: Direct3D's shader compiler corrupts the heap on this shader and takes the program down
            rep.line(format!("  {}: skipped on Direct3D (its shader compiler crashes on this shader); the Vulkan adapter runs it", v.name));
            continue;
        }
        if skip.contains(&key) {
            rep.line(format!("  {}: skipped, too slow on this machine to time safely", v.name));
            slow.push(key);
            continue;
        }
        println!("  ({} is running...)", v.name);
        match run_kernel(gpu, &w, &v) {
            Ok(k) => {
                let c = compare(&reference, &k.forces);
                rep.line(format!(
                    "  {}: {} ms/step read back, {} ms/step work only, {}, compile {:.0} ms",
                    v.name,
                    fmt_ms(k.per_step),
                    fmt_ms(k.work_only),
                    cmp_text(&c),
                    k.compile_ms
                ));
                if v.key == "soft" && c.same != c.total {
                    rep.failed = true;
                }
                if k.per_step > 150.0 {
                    slow.push(key);
                }
            }
            Err(e) => {
                rep.line(format!("  {}: FAILED {}", v.name, e));
                rep.failed = true;
                slow.push(key);
            }
        }
    }
    slow
}

fn run(rep: &mut Report, quick: bool, pick: Option<usize>) {
    rep.line(format!("Atom Forge native GPU probe {}", env!("CARGO_PKG_VERSION")));
    rep.line(format!("system: {} {}, {} CPU threads", std::env::consts::OS, std::env::consts::ARCH, rayon::current_num_threads()));
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let mut adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::PRIMARY));
    if adapters.is_empty() {
        adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    }
    let score = |a: &wgpu::Adapter| -> i32 {
        let kind = match a.get_info().device_type {
            wgpu::DeviceType::DiscreteGpu => 20,
            wgpu::DeviceType::IntegratedGpu => 3,
            wgpu::DeviceType::VirtualGpu => 2,
            wgpu::DeviceType::Cpu => 0,
            _ => 1,
        };
        kind + if a.features().contains(wgpu::Features::SHADER_F64) { 10 } else { 0 }
    };
    let mut best: Option<usize> = None;
    for (i, a) in adapters.iter().enumerate() {
        let info = a.get_info();
        let f64_here = a.features().contains(wgpu::Features::SHADER_F64);
        rep.line(format!(
            "adapter {}: {} [{:?}, {:?}, driver {} {}], real doubles: {}",
            i,
            info.name,
            info.backend,
            info.device_type,
            info.driver,
            info.driver_info,
            if f64_here { "yes" } else { "no" }
        ));
        if best.map_or(true, |b| score(a) > score(&adapters[b])) {
            best = Some(i);
        }
    }
    let chosen = match pick {
        Some(i) if i < adapters.len() => Some(i),
        _ => best,
    };
    let sizes: [usize; 2] = if quick { [2000, 20000] } else { [20000, 200000] };
    let Some(ci) = chosen else {
        rep.line("no graphics adapter found: CPU numbers only");
        rep.failed = true;
        for n in sizes {
            bench(rep, None, false, false, n, &[]);
        }
        return;
    };
    let adapter = adapters.swap_remove(ci);
    let has_f64 = adapter.features().contains(wgpu::Features::SHADER_F64);
    rep.line(format!("using adapter {}: {}", ci, adapter.get_info().name));
    let soft_ok = adapter.get_info().backend != wgpu::Backend::Dx12;
    let req = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: None,
        required_features: if has_f64 { wgpu::Features::SHADER_F64 } else { wgpu::Features::empty() },
        required_limits: wgpu::Limits::default(),
        experimental_features: wgpu::ExperimentalFeatures::disabled(),
        memory_hints: wgpu::MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    }));
    let (device, queue) = match req {
        Ok(dq) => dq,
        Err(e) => {
            rep.line(format!("could not open the adapter: {e:?}"));
            rep.failed = true;
            for n in sizes {
                bench(rep, None, false, false, n, &[]);
            }
            return;
        }
    };
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = errors.clone();
    device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
        sink.lock().unwrap().push(e.to_string());
    }));
    let gpu = Gpu { device, queue, errors };
    match latency(&gpu) {
        Ok(l) => rep.line(format!("round trip floor: {} ms", fmt_ms(l))),
        Err(e) => {
            rep.line(format!("round trip floor: FAILED {e}"));
            rep.failed = true;
        }
    }
    let slow = bench(rep, Some(&gpu), has_f64, soft_ok, sizes[0], &[]);
    bench(rep, Some(&gpu), has_f64, soft_ok, sizes[1], &slow);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let quick = args.iter().any(|a| a == "--quick");
    let no_wait = args.iter().any(|a| a == "--no-wait");
    let pick = args.iter().position(|a| a == "--adapter").and_then(|i| args.get(i + 1)).and_then(|s| s.parse::<usize>().ok());
    // Everything runs on a thread with a large stack: shader compilers recurse deeply on the emulated-doubles shader,
    // and Windows gives the main thread only 1 MB.
    let file = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("gpu-probe-results.txt"))).unwrap_or_else(|| "gpu-probe-results.txt".into());
    let file_for_worker = file.clone();
    let worker = std::thread::Builder::new().stack_size(512 << 20).spawn(move || {
        let mut rep = Report { file: Some(file_for_worker), ..Report::default() };
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&mut rep, quick, pick)));
        if let Err(p) = outcome {
            let msg = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "unknown error".to_string());
            rep.line(format!("STOPPED: {}", short(&msg)));
            rep.failed = true;
        }
        rep
    });
    let rep = match worker.map(|h| h.join()) {
        Ok(Ok(rep)) => rep,
        _ => {
            let mut rep = Report::default();
            rep.line("STOPPED: the test thread could not run to the end");
            rep.failed = true;
            rep
        }
    };
    match std::fs::write(&file, &rep.text) {
        Ok(()) => println!("\nSaved to {}", file.display()),
        Err(e) => println!("\nCould not save the report ({e}); copy it from this window."),
    }
    if !no_wait {
        println!("Press Enter to close.");
        let mut s = String::new();
        let _ = std::io::stdin().read_line(&mut s);
    }
    if rep.failed {
        std::process::exit(1);
    }
}
