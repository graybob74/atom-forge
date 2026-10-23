'use strict';
/* Test loader: evaluates source files exactly as the page bundles them, in one module scope, and returns a proxy
   that reads (and writes) any top-level name: X.W, X.step(dt), X._stiff = 0 … Node only, no page.
   load()                    engine files (data, atomic, orbitals, engine)
   load('all')               every file, with small browser stand-ins; the page's init() is not run
   opts.seed                 a seeded Math.random (mulberry32) for reproducible runs
   opts.patch(src)           edits the source text before it runs (instrumentation)
   opts.wasm                 false: without the WebAssembly kernel (the JavaScript kernels alone); 'plain': the module on an ordinary memory */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ENGINE = ['molecules.gen.js', 'objects.gen.js', 'data.js', 'atomic.js', 'solver.js', 'orbitals.js', 'wasm.js', 'engine.js', 'threads.js', 'hep.js', 'props.js', 'chips.js'];
const ALL = ['molecules.gen.js', 'objects.gen.js', 'data.js', 'atomic.js', 'solver.js', 'orbitals.js', 'wasm.js', 'engine.js', 'threads.js', 'hep.js', 'props.js', 'chips.js', 'render.js', 'gl.js', 'builder.js', 'design.js', 'ui.js'];
const strip = (s) => s.replace(/^'use strict';\s*/m, '').replace(/if \(typeof module !== 'undefined'\) module\.exports = [\s\S]*?;\s*$/m, '');
const STUB = `const document = { readyState: 'complete', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, getContext: () => null, classList: { add() {}, remove() {}, toggle() {} } }), addEventListener() {} };
const window = { matchMedia: () => ({ matches: false, addEventListener() {} }), devicePixelRatio: 1, addEventListener() {} };
const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const location = { hash: '' };
const requestAnimationFrame = () => 0, cancelAnimationFrame = () => {};
const ResizeObserver = class { observe() {} disconnect() {} };
`;
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let _n = 0;
function load(files, opts = {}) {
  if (files === 'all') files = ALL;
  if (!files) files = ENGINE;
  if (opts.seed !== undefined) Math.random = seeded(opts.seed);
  const ui = files.some(f => ['render.js', 'gl.js', 'builder.js', 'design.js', 'ui.js'].includes(f));
  // the WebAssembly kernel, as build.js embeds it (opts.wasm === false leaves it out: the JavaScript kernels alone)
  const wasmFile = path.join(ROOT, 'src', 'wasm', 'kernel.wasm'), plainFile = path.join(ROOT, 'src', 'wasm', 'kernel-plain.wasm');
  const wasmConst = `const KERNEL_WASM_B64 = ${opts.wasm !== false && fs.existsSync(wasmFile) ? JSON.stringify(fs.readFileSync(wasmFile).toString('base64')) : 'null'};\n` +
    `const KERNEL_PLAIN_WASM_B64 = ${opts.wasm !== false && fs.existsSync(plainFile) ? JSON.stringify(fs.readFileSync(plainFile).toString('base64')) : 'null'};\nglobalThis.WK_FORCE_PLAIN = ${opts.wasm === 'plain'};\n`; // (opts.wasm === 'plain': the module on an ordinary memory, as a page without shared memory gets it)
  let src = wasmConst + files.map(f => strip(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))).join('\n');
  if (files.includes('ui.js')) src = src.replace(/^if \(document\.readyState === 'loading'\).*$/m, '');
  if (opts.patch) { const s2 = opts.patch(src); if (s2 === src) throw new Error('patch changed nothing'); src = s2; }
  const dir = path.join(ROOT, 'tests', '.tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `load_${process.pid}_${_n++}.js`);
  fs.writeFileSync(file, "'use strict';\n" + (ui ? STUB : '') + src + "\nmodule.exports = { get: (n) => eval(n), set: (n, v) => eval(n + ' = v') };\n");
  let mod;
  try { mod = require(file); } finally { fs.unlinkSync(file); }
  return new Proxy({}, {
    get: (_, k) => (typeof k === 'string' ? mod.get(k) : undefined),
    set: (_, k, v) => { mod.set(k, v); return true; },
  });
}
module.exports = { load, seeded, ENGINE, ALL, ROOT };
