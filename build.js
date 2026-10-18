// Bundles the sources into one self-contained page body for publishing.
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const strip = (s) => s.replace(/^'use strict';\s*/m, '').replace(/if \(typeof module !== 'undefined'\) module\.exports = [\s\S]*?;\s*$/m, '');
const FILES = ['molecules.gen.js', 'objects.gen.js', 'data.js', 'atomic.js', 'solver.js', 'orbitals.js', 'wasm.js', 'engine.js', 'threads.js', 'hep.js', 'chips.js', 'render.js', 'builder.js', 'design.js', 'ui.js'];
// the WebAssembly kernel (kernel/, built by GitHub Actions into src/wasm/kernel.wasm) is embedded first, for wasm.js
const wasmFile = path.join(__dirname, 'src', 'wasm', 'kernel.wasm');
const wasmConst = `/* ---- kernel.wasm ---- */\nconst KERNEL_WASM_B64 = ${fs.existsSync(wasmFile) ? JSON.stringify(fs.readFileSync(wasmFile).toString('base64')) : 'null'};`;
// the pair kernel's text (engine.js, between the markers) is embedded for the worker threads (threads.js)
const eng = src('engine.js'), k0 = eng.indexOf('/* ======================================================================== PAIR KERNEL BEGIN'), k1 = eng.indexOf('/* ======================================================================== PAIR KERNEL END */');
if (k0 < 0 || k1 < 0) throw new Error('pair kernel markers not found in engine.js');
const kernel = `/* ---- pair kernel for the workers ---- */\nconst PAIR_KERNEL_SRC = ${JSON.stringify(eng.slice(k0, k1))};`;
const js = wasmConst + '\n' + FILES.map(f => `/* ---- ${f} ---- */\n` + strip(src(f))).join('\n') + '\n' + kernel;
const out = src('shell.html') + '\n' + src('body.html') + '\n<script>\n\'use strict\';\n' + js + '\n</script>\n';
fs.writeFileSync(path.join(__dirname, 'dist', 'atom-forge.html'), out);
fs.writeFileSync(path.join(__dirname, 'dist', 'bundle-check.js'), '\'use strict\';\n' + js);
console.log('wrote', out.length, 'bytes');
