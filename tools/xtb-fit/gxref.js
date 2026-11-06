// g-xTB reference points for the fit (scratchpad only; the owner's g-xTB build through xtb --gxtb): hexazine's D3h path
// (flat, short sides s(L) from the ring's 1.308 Å to N2's 1.089 Å), N2, a proton between two waters (O-O 2.7, 2.8 Å)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const XTB = (process.env.AF_REF || __dirname + '/.ref') + '/xtb-6.7.1/bin/xtb', EH = 27.211386245988;
const SYM = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O'];
let k = 0;
function gx(Z, xyz, charge = 0, uhf = 0) {
  const dir = path.join(__dirname, 'w', 'g' + process.pid + '_' + (k++)); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'm.xyz'), Z.length + '\n\n' + Z.map((z, i) => SYM[z] + ' ' + xyz[i].map(v => v.toFixed(8)).join(' ')).join('\n') + '\n');
  let out = ''; try { out = execFileSync(XTB, ['m.xyz', '--gxtb', '--chrg', String(charge), '--uhf', String(uhf)], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '1' } }); } catch (e) { out = e.stdout + e.stderr; }
  fs.rmSync(dir, { recursive: true, force: true });
  return +(out.match(/TOTAL ENERGY\s+(-?[\d.]+)/) || [])[1] * EH;
}
const ring = (s, l) => { let lo = 0.01, hi = 59.99; for (let q = 0; q < 80; q++) { const mm = (lo + hi) / 2; if (Math.sin(mm * Math.PI / 180) / Math.sin((60 - mm) * Math.PI / 180) < s / l) lo = mm; else hi = mm; }
  const h = (lo + hi) / 2, R = s / (2 * Math.sin(h * Math.PI / 180)), o = []; for (let i = 0; i < 3; i++) for (const sg of [-1, 1]) { const t = (120 * i + sg * h) * Math.PI / 180; o.push([R * Math.cos(t), R * Math.sin(t), 0]); } return o; };
const out = { n6: [], pt: [] };
const Z6 = [7, 7, 7, 7, 7, 7];
for (const L of [1.308, 1.40, 1.50, 1.60, 1.70, 1.80, 1.95, 2.10, 2.30, 2.60]) { const s = 1.308 + (1.089 - 1.308) * Math.min(1, (L - 1.308) / (2.6 - 1.308)); const x = ring(s, L); out.n6.push({ L, s: +s.toFixed(4), Z: Z6, xyz: x, E: gx(Z6, x) }); }
out.n2 = { Z: [7, 7], xyz: [[0, 0, 0], [1.0891, 0, 0]], E: gx([7, 7], [[0, 0, 0], [1.0891, 0, 0]]) };
const Zp = [8, 1, 1, 1, 8, 1, 1], geo = (R, x) => [[0, 0, 0], [-0.4, 0.88, 0], [-0.4, -0.88, 0], [x, 0, 0], [R, 0, 0], [R + 0.4, 0.88, 0], [R + 0.4, -0.88, 0]];
for (const R of [2.7, 2.8]) for (let x = 1.0; x <= R / 2 + 1e-9; x += 0.05) { const xx = +x.toFixed(3); out.pt.push({ R, x: xx, Z: Zp, xyz: geo(R, xx), charge: 1, E: gx(Zp, geo(R, xx), 1) }); }
fs.writeFileSync(path.join(__dirname, 'gxref.json'), JSON.stringify(out));
console.log('n6', out.n6.map(p => (p.E - out.n6[0].E).toFixed(2)).join(' '), 'release', (out.n6[0].E - 3 * out.n2.E).toFixed(2));
console.log('pt', out.pt.map(p => p.R + '/' + p.x + ':' + (p.E).toFixed(3)).join(' '));
