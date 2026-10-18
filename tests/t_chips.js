'use strict';
/* Chips that work (chips.js): the transistor switches (off is a leak of a fraction of a nanoampere, on tens of
   microamperes, and heat makes it leak more), the NOT gate inverts, the SRAM cell is written, read without losing its
   bit, forgets with the power off and wakes in a random state, the flash cell is programmed and erased one electron at
   a time and keeps its electrons; a chip whose gate is destroyed stops working. Node only. */
const { load } = require('./load');
const X = load(undefined, { seed: 11 });
const { W } = X;
let fails = 0;
const bad = (m) => { fails++; console.log('FAIL', m); };
const info = (m) => console.log('  ' + m);
const run = (n) => { for (let f = 0; f < n; f++) X.simFrame(1 / 60, 40); };
const until = (ch, max = 4000) => { let f = 0; while (ch.op && f < max) { run(1); f++; } return f; };
function world(key) {
  X.clearWorld(); W.box.w = W.box.tw = 260; W.box.h = W.box.th = 80; W.T = 300; W.gamma = 1; W.wall = 'reflect'; W.decayOn = false;
  X.addMolecule(key, 0, 0, 0, 300); X.forcesNoEvents(); W.fSpawn = W.spawned;
  return W.chips[W.chips.length - 1];
}
const t0 = Date.now();
// the layouts: gates are silicon, gate oxides oxygen, channels the bodies' silicon (or a dopant)
for (const key of Object.keys(X.CHIP_LAYOUT)) {
  const ch = world(key);
  if (!ch) { bad(`${key}: not wired up when placed`); continue; }
  const okGate = ch.devs.every(d => d.gate.every(p => p.Z === 14) && d.ox.every(p => p.Z === 8) && d.path.every(p => [14, 15, 5].includes(p.Z)) && (!d.cg || d.cg.every(p => p.Z === 14)));
  if (!okGate) bad(`${key}: its gates, oxides or channels are not where the layout says`);
}
// the transistor's curve, and its leak when hot
{
  const ch = world('transistor'), Ut = X.PHYS.KB * 300, I = (vg, T = 300) => X.chipChan('n', vg, 0.75, 0, X.PHYS.KB * T, Math.max(0.02, 0.25 - 8e-4 * (T - 300)));
  const off = I(0), on = I(0.75), mid = I(0.4), hot = I(0, 600), curve = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(v => I(v));
  ch.v.g = 0.75; run(5);
  info(`transistor: off ${X.fmtCurrent(off)}, at 0.4 V ${X.fmtCurrent(mid)}, on ${X.fmtCurrent(on)}; off at 600 K ${X.fmtCurrent(hot)}; placed and switched on: ${X.fmtCurrent(ch.devs[0].I)}`);
  if (!(off < 1e-9 && on > 25e-6 && on < 60e-6 && hot > 30 * off && curve.every((c, i) => !i || c > curve[i - 1]) && ch.devs[0].I > 20e-6 && Ut > 0.025)) bad('the transistor curve is off');
  if (Math.abs(X.chipChan('p', 0, 0.75, 0, Ut, 0.25)) < 20e-6 || Math.abs(X.chipChan('p', 0.75, 0.75, 0, Ut, 0.25)) > 1e-9) bad('the p-channel transistor should be on with its gate low and off with it high');
}
// the NOT gate
{
  const ch = world('inverter');
  run(20); const o0 = ch.v.out;
  ch.v.in = X.CHIP.VDD; let f = 0; while (ch.v.out > 0.375 && f < 400) { run(1); f++; } run(20); const o1 = ch.v.out;
  ch.v.in = 0; run(40); const o2 = ch.v.out;
  info(`NOT gate: in 0 → ${o0.toFixed(2)} V; in 1 → ${o1.toFixed(2)} V (past half in ${f} frames); in 0 again → ${o2.toFixed(2)} V`);
  if (!(o0 > 0.7 && o1 < 0.05 && o2 > 0.7 && f < 200)) bad('the NOT gate does not invert');
}
// the SRAM cell
{
  const ch = world('sramcell');
  run(10);
  X.chipOp(ch, 'write', 1); const fw = until(ch); const w1 = [ch.v.q, ch.v.qb];
  X.chipOp(ch, 'read'); until(ch); const r1 = ch.read, after = ch.v.q;
  X.chipOp(ch, 'write', 0); until(ch); X.chipOp(ch, 'read'); until(ch); const r0 = ch.read;
  X.chipOp(ch, 'power', 0); run(300); const off = [ch.v.q, ch.v.qb];
  X.chipOp(ch, 'power', 1); run(300); const on = [ch.v.q, ch.v.qb];
  info(`SRAM: write 1 → Q ${w1[0].toFixed(2)} V, ¬Q ${w1[1].toFixed(2)} V in ${fw} frames; read ${r1} (Q still ${after.toFixed(2)} V); write 0, read ${r0}; power off → ${off.map(v => v.toFixed(2)).join(' / ')} V; on again → ${on.map(v => v.toFixed(2)).join(' / ')} V`);
  if (!(w1[0] > 0.7 && w1[1] < 0.05 && r1 === 1 && after > 0.7 && r0 === 0 && off[0] < 0.1 && off[1] < 0.1 && Math.abs(on[0] - on[1]) > 0.6)) bad('the SRAM cell does not write, read, forget and wake as it should');
}
// the flash cell
{
  const ch = world('flashcell');
  X.chipOp(ch, 'read'); until(ch); const rf = ch.read;
  X.chipOp(ch, 'program'); until(ch); const np = ch.nfg, vt = X.flashVth(ch, 0.25);
  X.chipOp(ch, 'read'); until(ch); const rp = ch.read;
  run(300); const kept = ch.nfg;
  X.chipOp(ch, 'erase'); until(ch); const ne = ch.nfg;
  X.chipOp(ch, 'read'); until(ch); const re = ch.read;
  info(`flash: fresh read ${rf}; programmed: ${np} electrons on the floating gate, threshold ${vt.toFixed(2)} V, read ${rp}, ${kept} kept after a while; erased: ${ne} left, read ${re}`);
  if (!(rf === 1 && np >= 35 && np <= 80 && vt > X.CHIP.V_READ && rp === 0 && kept === np && ne === 0 && re === 1)) bad('the flash cell does not program, keep, erase and read as it should');
}
// a destroyed gate stops a chip; a chip whose atoms are all gone is dropped
{
  const ch = world('inverter');
  ch.v.in = X.CHIP.VDD; run(5);
  for (const p of ch.devs[0].gate.slice(0, 3)) X.kill(p);
  run(3);
  const broken = ch.broken && ch.devs.every(d => d.I === 0) && !X.chipOp(ch, 'read');
  for (const p of ch.ps) if (!p.dead) X.kill(p);
  run(2);
  info(`a broken gate: ${ch.broken ? 'stopped' : 'still running'} (“${ch.msg}”); all its atoms gone: ${W.chips.includes(ch) ? 'still listed' : 'dropped'}`);
  if (!broken || W.chips.includes(ch)) bad('a destroyed chip should stop, and be dropped once its atoms are gone');
}
// the Grab tool drags a whole chip along, the cursor far ahead, without flinging it (never faster than GRAB_V) or heating
// it (it used to reach tens of km/s and read as millions of kelvin); a chip heated past silicon's melting point breaks
{
  const ch = world('flashcell');
  run(5);
  const ps = ch.ps, com = () => { let m = 0, x = 0, vx = 0, vy = 0; for (const p of ps) { m += p.m; x += p.m * p.x; vx += p.m * p.vx; vy += p.m * p.vy; } return { x: x / m, v: Math.hypot(vx, vy) / m }; };
  const c0 = com();
  W.grab = { p: ps[0], x: ps[0].x + 80, y: ps[0].y, mol: X.molecule(ps[0]) };
  let vmax = 0, Tmax = 0; for (let f = 0; f < 120; f++) { run(1); vmax = Math.max(vmax, com().v); Tmax = Math.max(Tmax, ch.T); }
  const moved = com().x - c0.x, whole = !ch.broken; W.grab = null;
  W.gamma = 2; W.T = 4000; let fm = 0; while (!ch.broken && fm < 900) { run(1); fm++; } // (held hot: melting needs heat that lasts)
  info(`grabbed with the cursor 80 Å ahead: dragged ${moved.toFixed(0)} Å, at most ${vmax.toFixed(2)} Å/tu, chip at most ${Tmax.toFixed(0)} K, ${whole ? 'still working' : 'broken'}; held at 4,000 K, after ${fm} frames: “${ch.msg}”`);
  if (!(vmax < X.GRAB_V * 1.1 && moved > 5 && Tmax < 500 && whole && ch.broken && /melted|torn/.test(ch.msg))) bad('grabbing a chip should drag it gently, and overheating it should break it');
}
// wired gates: three NOT gates in a loop tick on their own (a ring oscillator) and four in a row pass a change along,
// gate by gate; radiation: a slow proton through the cell's Q pull-down changes nothing, an iron nucleus flips it
{
  const box = (w, h, wall) => { X.clearWorld(); W.box.w = W.box.tw = w; W.box.h = W.box.th = h; W.T = 300; W.gamma = wall === 'open' ? 2 : 1; W.wall = wall; W.decayOn = false; };
  const gates = (xs) => xs.map(x => { X.addMolecule('inverter', x, 0, 0, 300); return W.chips[W.chips.length - 1]; });
  box(300, 100, 'reflect');
  const g = gates([-85, 0, 85]); g.forEach((c, i) => { c.inFrom = g[(i + 2) % 3]; }); X.forcesNoEvents(); W.fSpawn = W.spawned;
  let tog = 0, was = g[0].v.out > 0.375; for (let f = 0; f < 200; f++) { run(1); const hi = g[0].v.out > 0.375; if (hi !== was) tog++; was = hi; }
  const ghz = g[0].per ? 1e-9 / g[0].per : 0;
  box(360, 100, 'reflect');
  const c = gates([-135, -45, 45, 135]); for (let i = 1; i < 4; i++) c[i].inFrom = c[i - 1]; X.forcesNoEvents(); W.fSpawn = W.spawned;
  run(25); const before = c.map(q => (q.v.out > 0.375 ? 1 : 0)).join('');
  c[0].v.in = X.CHIP.VDD; let fc = 0; while (c[3].v.out < 0.375 && fc < 300) { run(1); fc++; }
  const after = c.map(q => (q.v.out > 0.375 ? 1 : 0)).join('');
  box(260, 140, 'open');
  X.addMolecule('sramcell', 0, -12, 0, 300); const s = W.chips[0]; X.forcesNoEvents(); W.fSpawn = W.spawned; run(5);
  X.chipOp(s, 'write', 1); until(s);
  const dv = s.devs[1], bx = X.chipBox(dv.path.concat(dv.gate)), xm = (bx[0] + bx[1]) / 2;
  X.fireSpec({ kind: 'atom', Z: 1, A: 1, bare: true }, xm, 66, 0, -1, 2e6, true); run(40); const afterP = X.srBit(s), msgP = s.msg;
  X.fireSpec({ kind: 'atom', Z: 26, A: 56, bare: true }, xm, 66, 0, -1, 1e8, true); let msgO = ''; for (let f = 0; f < 40; f++) { run(1); if (/Bit flipped/.test(s.msg)) msgO = s.msg; } const afterO = X.srBit(s);
  info(`ring oscillator: gate 1 flipped ${tog} times in 200 frames, ${ghz.toFixed(0)} GHz; chain ${before} → input 1 → ${after}, the last gate following in ${fc} frames`);
  info(`radiation: after a 2 MeV proton the cell holds ${afterP} (“${msgP.slice(0, 70)}”); after a 100 MeV iron nucleus ${afterO} (“${msgO.slice(0, 70)}”), ${s.broken ? 'broken' : 'still working'}`);
  if (!(tog >= 6 && ghz > 20 && ghz < 300 && before === '1010' && after === '0101' && fc > 5 && fc < 120 && afterP === 1 && afterO === 0 && /Bit flipped/.test(msgO) && s.flips === 1 && !s.broken)) bad('wired gates or radiation upsets do not behave');
}
// eight flash cells in two rows are a byte: read top row first, left to right; a character is written (erase all, then
// program the zeros), read back, a bit flipped by hand; chip time keeps its pace though the crowded box lags
{
  X.clearWorld(); W.box.w = W.box.tw = 250; W.box.h = W.box.th = 96; W.T = 300; W.gamma = 0.5; W.wall = 'reflect'; W.decayOn = false;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) X.addMolecule('flashcell', -90 + 60 * c, 21 - 42 * r, 0, 300);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const M = X.flashMemory(), at = M.cells.map(c => X.chipAt(c));
  const order = at.every((p, i) => !i || (i % 4 ? p[0] > at[i - 1][0] + 40 && Math.abs(p[1] - at[i - 1][1]) < 5 : p[1] < at[i - 1][1] - 30));
  const refused = [X.memWrite(''), X.memWrite('é'), X.memWrite('AB')];
  const go = () => { let f = 0; while (X.memBusy() && f < 2000) { X.simFrame(1 / 60, 3); f++; } return f; };
  X.memWrite('A'); const fw = go(), wrote = W.mem.ok, el = M.cells.map(c => c.nfg);
  X.memRead(); go(); const r1 = W.mem.bytes[0].ch;
  X.memFlip(M.cells[7]); let f = 0; while (M.cells[7].op && f < 2000) { X.simFrame(1 / 60, 3); f++; }
  X.memRead(); go(); const r2 = W.mem.bytes[0].ch;
  X.memWrite('z'); go(); X.memRead(); go(); const r3 = W.mem.bytes[0].ch;
  info(`flash byte: ${M.cells.length} cells, ${M.bytes} byte, ${order ? 'in reading order' : 'out of order'}; refused: ${refused.map(s => `“${s}”`).join(', ')}`);
  info(`  wrote “A” in ${fw} frames (electrons ${el.join(' ')}), read “${r1}”; bit 0 flipped: “${r2}”; then “z”: “${r3}”`);
  if (!(M.bytes === 1 && order && refused.every(s => typeof s === 'string' && s.length > 5) && wrote && r1 === 'A' && el.filter(n => n > 30).length === 6 && r2 === '@' && r3 === 'z' && fw < 400)) bad('eight flash cells should store and read back a character');
}
console.log(`  chips checked in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(fails ? `${fails} chip failure(s)` : 'chip checks passed');
process.exitCode = fails ? 1 : 0;
