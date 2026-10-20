'use strict';
/* ================================================================== chips that work
   The tiny objects from a chip (a transistor, a CMOS inverter, an SRAM cell and a flash cell) are wired up as the
   circuits they belong to when they are placed. Their atoms are the structure, and the structure has to hold: break a
   gate or its oxide and the device is dead. The current through each transistor comes from the compact model chip
   designers use (EKV: one smooth formula from off, through the subthreshold leak, to fully on), with the values of a
   transistor in a current chip (0.75 V supply, 0.25 V threshold, about 40 µA on and 0.2 nA off) at the temperature of
   its own atoms: a hot chip leaks, and a hot enough one cannot switch off. Each circuit node follows C·dV/dt = ΣI.
   The flash cell's floating gate gains and loses electrons one at a time, by Fowler–Nordheim tunnelling through its
   oxide. Chip time runs CHIP.WARP times faster than the atoms' (CHIP.FLASH_WARP while flash tunnels), so that a
   switch taking picoseconds is seen in a fraction of a second; it keeps the pace the simulation is set to even when a
   crowded box makes the atoms fall behind it. Several flash cells together are a memory (flashMemory). */
const CHIP = { VDD: 0.75, VTH: 0.25, N: 1.2, ISN: 0.615e-6, ISP: 0.45e-6, CN: 0.1e-15, CBL: 1e-15, WARP: 20, FLASH_WARP: 5e6, PULSE: 1e-5,
  ALPHA_CG: 0.6, ALPHA_D: 0.1, C_FG: 6e-18, T_TUN: 7e-9, FN_A: 1.25e-6, FN_B: 2.4e10, A_TUN: 4e-16, V_PROG: 15, V_READ: 1.5 };
/* Where each device sits among an object's atoms (the generator's order): its silicon body (cols × rows, row by row),
   its gate (gc × gr), g0 the first column under the gate, and its gate oxide. */
const chipRow = (kinds) => kinds.map((t, i) => { const b = i * 122; return { t, body: b, cols: 14, rows: 7, gate: b + 98, gc: 6, gr: 3, g0: 4, ox: b + 116 }; });
const CHIP_LAYOUT = {
  transistor: () => [{ t: 'n', body: 0, cols: 22, rows: 7, gate: 154, gc: 8, gr: 3, g0: 7, ox: 178 }],
  inverter: () => chipRow(['n', 'p']),
  sramcell: () => chipRow(['n', 'n', 'p', 'p', 'n', 'n']), // access, pull-down and pull-up of the left inverter, then the right one's, mirrored
  flashcell: () => [{ t: 'n', body: 0, cols: 22, rows: 6, gate: 132, gc: 8, gr: 3, g0: 7, ox: 180, cg: 156, ox2: 188 }], // (gate: the floating gate)
};
const CHIP_NAMES = { transistor: 'Transistor', inverter: 'NOT gate (CMOS inverter)', sramcell: 'SRAM cell', flashcell: 'Flash cell' };
/* What each device's two ends and its gate are wired to: [left end, right end, gate] (node names; a number is fixed). */
const CHIP_ENDS = {
  transistor: [['S', 'D', 'G']], flashcell: [['S', 'D', 'FG']],
  inverter: [['GND', 'OUT', 'IN'], ['OUT', 'VDD', 'IN']],
  sramcell: [['BL', 'Q', 'WL'], ['GND', 'Q', '¬Q'], ['Q', 'VDD', '¬Q'], ['VDD', '¬Q', 'Q'], ['¬Q', 'GND', 'Q'], ['¬Q', '¬BL', 'WL']],
};
/* The voltage of a named node of a chip. */
function chipNode(ch, name) {
  const v = ch.v;
  switch (name) {
    case 'GND': case 'S': return 0;
    case 'VDD': return ch.key === 'sramcell' ? v.vdd : CHIP.VDD;
    case 'G': return v.g; case 'D': return v.d; case 'IN': return v.in; case 'OUT': return v.out;
    case 'Q': return v.q; case '¬Q': return v.qb; case 'BL': return v.bl; case '¬BL': return v.blb; case 'WL': return v.wl;
    case 'FG': return flashFG(ch); case 'CG': return v.cg;
  }
  return 0;
}
function chipAdd(key, ps) {
  const L = CHIP_LAYOUT[key];
  if (!L || !ps.length) return null;
  const devs = L().map((d) => {
    const at = (i) => ps[i];
    const path = []; for (let c = 0; c < d.cols; c++) path.push(at(d.body + (d.rows - 1) * d.cols + c)); // the top row: where the channel forms
    const gate = []; for (let i = 0; i < d.gc * d.gr; i++) gate.push(at(d.gate + i));
    const ox = []; for (let i = 0; i < d.gc; i++) ox.push(at(d.ox + i));
    const dev = { t: d.t, path, gate, ox, g0: d.g0, gc: d.gc, I: 0, dots: [], acc: 0 };
    if (d.cg !== undefined) { dev.cg = []; for (let i = 0; i < d.gc * d.gr; i++) dev.cg.push(at(d.cg + i)); dev.ox2 = []; for (let i = 0; i < d.gc; i++) dev.ox2.push(at(d.ox2 + i)); }
    return dev;
  });
  const ch = { key, ps, devs, broken: false, T: W.T || 300, op: null, msg: '', id: ++W.chipSeq, hops: [] };
  ch.nb0 = chipBonds(ch); // (its crystal as made: torn apart, it stops working)
  ch.q0 = ps.map(p => p.q); // (its atoms' charges as made: ground gives back what radiation knocks out)
  Object.assign(ch, { tc: 0, inFrom: null, label: '', hit: null, hitMsg: '', flips: 0, per: 0, rise: 0, hiOut: false, Ut: PHYS.KB * 300, vth: CHIP.VTH, Tm: ch.T });
  if (key === 'transistor') ch.v = { g: 0, d: CHIP.VDD };
  else if (key === 'inverter') ch.v = { in: 0, out: CHIP.VDD };
  else if (key === 'sramcell') { ch.v = { q: 0, qb: CHIP.VDD, bl: CHIP.VDD, blb: CHIP.VDD, wl: 0, vdd: CHIP.VDD }; ch.drive = { bl: CHIP.VDD, blb: CHIP.VDD }; ch.read = null; }
  else if (key === 'flashcell') { ch.v = { cg: 0, d: 0 }; ch.nfg = 0; ch.read = null; }
  W.chips.push(ch);
  log('tool', `${CHIP_NAMES[key]} wired up: work it from the Lab tab`);
  return ch;
}
/* EKV: the current (A) flowing through the channel from terminal a (drawn at its right end) to terminal b (its left
   end), gate at vg (volts, from ground).
   An n-channel's body is at ground; a p-channel's at the supply, so it is the mirror image of an n-channel. */
function chipF(x) { const l = x > 40 ? x : Math.log1p(Math.exp(x)); return l * l; }
function chipChan(t, vg, va, vb, Ut, vth) {
  const n = CHIP.N;
  if (t === 'n') { const vp = (vg - vth) / n; return CHIP.ISN * (chipF((vp - vb) / (2 * Ut)) - chipF((vp - va) / (2 * Ut))); }
  const V = CHIP.VDD, vp = (V - vg - vth) / n; // (primed: measured down from the supply)
  return -CHIP.ISP * (chipF((vp - (V - vb)) / (2 * Ut)) - chipF((vp - (V - va)) / (2 * Ut)));
}
function chipBox(list) { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of list) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } return [x0, x1, y0, y1]; } // [x0, x1, y0, y1] of some atoms
function chipAlive(ch) { // the gates, their oxides and the channels' silicon must all be there
  for (const d of ch.devs) for (const list of [d.gate, d.ox, d.path, d.cg || [], d.ox2 || []]) for (const p of list) if (!p || p.dead) return false;
  return true;
}
/* The object's own temperature, from its atoms' motion about its centre of mass (dragged about, it is not heated),
   smoothed over half a second: a current's exponential leak is sensitive to it. (In the flat chamber an atom's mean
   kinetic energy is kT.) */
function chipTemp(ch, realDt) {
  let m = 0, px = 0, py = 0;
  for (const p of ch.ps) if (!p.dead && !p.rad) { m += p.m; px += p.m * p.vx; py += p.m * p.vy; }
  let now = W.T;
  if (m > 0) {
    const vx = px / m, vy = py / m; let ke = 0, n = 0;
    for (const p of ch.ps) if (!p.dead && !p.rad) { ke += 0.5 * p.m * ((p.vx - vx) * (p.vx - vx) + (p.vy - vy) * (p.vy - vy)); n++; }
    now = ke / (n * PHYS.KB);
  }
  return ch.T + (now - ch.T) * Math.min(1, (realDt || 0) / 0.5);
}
function chipBonds(ch) { let n = 0; for (const p of ch.ps) if (!p.dead) n += p.bonds.length; return n; }
/* Operations, run in chip time: the SRAM's write and read sequences, the flash cell's program, erase and read pulses. */
function chipOp(ch, name, arg) {
  if (ch.broken || !CHIP_LAYOUT[ch.key]) return false;
  ch.op = { name, arg, t: 0 }; ch.read = name === 'read' ? null : ch.read; ch.bitRef = undefined; // (a write is not a flip)
  return true;
}
/* Advance every chip by dt seconds of the atoms' time (realDt: the real seconds that took, for the drawing). */
function chipsTick(dt, realDt) {
  const feeds = new Set(); for (const c of W.chips) if (c.inFrom) feeds.add(c.inFrom);
  const wired = [];
  for (let i = W.chips.length - 1; i >= 0; i--) {
    const ch = W.chips[i];
    if (ch.ps.every(p => p.dead)) { W.chips.splice(i, 1); continue; }
    if (!ch.broken) { // a chip works only while its structure holds: its gates and channels there, not molten, its crystal whole
      ch.T = chipTemp(ch, realDt); ch.Tm += (ch.T - ch.Tm) * Math.min(1, (realDt || 0) / 3); // (melting needs heat that lasts: the brief spike of an ion passing through does not melt it)
      const why = !chipAlive(ch) ? 'its atoms came apart' : ch.Tm > 1687 ? 'it melted (silicon melts at 1,687 K)' : chipBonds(ch) < 0.9 * ch.nb0 ? 'its crystal was torn apart' : '';
      if (why) { ch.broken = true; ch.op = null; ch.msg = `Broken: ${why}, so it no longer works.`; for (const d of ch.devs) { d.I = 0; d.dots.length = 0; } }
    }
    if (ch.broken) continue;
    chipGround(ch);
    ch.Ut = PHYS.KB * clamp(ch.T, 50, 3000); ch.vth = Math.max(0.02, CHIP.VTH - 8e-4 * (ch.T - 300)); // (kT/q in volts: PHYS.KB is in eV/K)
    if (ch.key === 'flashcell') flashTick(ch, dt * CHIP.FLASH_WARP, ch.Ut, ch.vth);
    else if (ch.inFrom || feeds.has(ch)) wired.push(ch); // (wired output to input: stepped together below)
    else {
      const tc = dt * CHIP.WARP, nSub = Math.min(400, Math.max(1, Math.ceil(tc / 5e-14)));
      for (let k = 0; k < nSub; k++) { chipStep(ch, tc / nSub, ch.Ut, ch.vth); scopeSample(ch, W.chipT + (k + 1) * tc / nSub); }
      ch.tc += tc;
    }
    if (ch.hit && ch.tc - ch.hit.t > 1e-11) seuSettle(ch);
    if (ch.key === 'sramcell') srWatch(ch);
    chipDots(ch, realDt);
  }
  if (wired.length) chipsWired(wired, dt * CHIP.WARP);
  W.chipT = (W.chipT || 0) + dt * CHIP.WARP;
  chipsRadiation();
  memTick();
}
/* Gates wired output to input (a ring oscillator, a chain) run in lockstep, each input following the voltage on the
   output that drives it; each output's rising edges give its period (a ring's clock). */
function chipsWired(list, tc) {
  const nSub = Math.min(800, Math.max(1, Math.ceil(tc / 2e-14))), h = tc / nSub;
  const live = list.map(c => c.inFrom && !c.inFrom.broken && W.chips.includes(c.inFrom) ? c.inFrom : null);
  for (let k = 0; k < nSub; k++) {
    list.forEach((c, j) => { if (live[j]) c.v.in = live[j].v.out; });
    for (const c of list) {
      chipStep(c, h, c.Ut, c.vth); scopeSample(c, W.chipT + (k + 1) * h);
      const hi = c.v.out > 0.5 * CHIP.VDD, t = c.tc + (k + 1) * h;
      if (hi && !c.hiOut) { if (c.rise) c.per = c.per ? 0.7 * c.per + 0.3 * (t - c.rise) : t - c.rise; c.rise = t; }
      c.hiOut = hi;
    }
  }
  for (const c of list) { c.tc += tc; if (c.rise && c.tc - c.rise > 6 * (c.per || 1e-11) + 2e-11) c.per = 0; } // (stopped ticking)
}
/* The logic analyser (Lab tab): each chip's signals sampled in chip time (W.chipT, shared by every chip so their traces
   line up), at most one sample per SCOPE_DT, the last SCOPE_N kept. It only reads the chips. */
const SCOPE_N = 4096, SCOPE_DT = 5e-14;
const SCOPE_SIG = { transistor: ['G', 'D'], inverter: ['IN', 'OUT'], sramcell: ['WL', 'Q', '¬Q'] };
function scopeSample(ch, t) {
  const sig = SCOPE_SIG[ch.key]; if (!sig) return;
  let sc = ch.scope;
  if (!sc) sc = ch.scope = { t: new Float64Array(SCOPE_N), v: sig.map(() => new Float32Array(SCOPE_N)), n: 0, last: -Infinity };
  if (t - sc.last < SCOPE_DT) return;
  const k = sc.n % SCOPE_N; sc.t[k] = t; sc.last = t;
  for (let i = 0; i < sig.length; i++) sc.v[i][k] = chipNode(ch, sig[i]);
  sc.n++;
}
function chipStep(ch, h, Ut, vth) {
  const v = ch.v, D = ch.devs;
  if (ch.key === 'transistor') { D[0].I = chipChan('n', v.g, v.d, 0, Ut, vth); return; }
  if (ch.key === 'inverter') {
    const In = chipChan('n', v.in, v.out, 0, Ut, vth), Ip = chipChan('p', v.in, CHIP.VDD, v.out, Ut, vth);
    D[0].I = In; D[1].I = Ip;
    v.out = clamp(v.out + h * (Ip - In) / CHIP.CN, -0.05, CHIP.VDD + 0.05);
    return;
  }
  // the SRAM cell: the sequence first, then the six transistors
  const op = ch.op;
  if (op) {
    op.t += h;
    const ps = 1e-12;
    if (op.name === 'write') {
      ch.drive.bl = op.arg ? v.vdd : 0; ch.drive.blb = op.arg ? 0 : v.vdd;
      v.wl = op.t > 1 * ps && op.t < 9 * ps ? v.vdd : 0;
      ch.msg = op.t < 1 * ps ? `Writing ${op.arg}: the bit lines are set` : op.t < 9 * ps ? `Writing ${op.arg}: the word line is on, so the bit lines push the cell over` : `Written: the cell holds ${op.arg}`;
      if (op.t > 10 * ps) { ch.op = null; ch.drive.bl = ch.drive.blb = v.vdd; }
    } else if (op.name === 'read') {
      if (op.t < 1.5 * ps) { ch.drive.bl = ch.drive.blb = v.vdd; v.wl = 0; ch.msg = 'Reading: both bit lines charged up'; }
      else if (!op.done) {
        ch.drive.bl = ch.drive.blb = null; v.wl = v.vdd;
        const dv = v.bl - v.blb;
        ch.msg = `Reading: the word line is on; the side holding 0 drains its bit line (${(Math.abs(dv) * 1000).toFixed(0)} mV apart)`;
        if (Math.abs(dv) > 0.06 || op.t > 60 * ps) { op.done = op.t; ch.read = Math.abs(dv) > 0.06 ? (dv > 0 ? 1 : 0) : null; }
      } else {
        v.wl = 0; ch.drive.bl = ch.drive.blb = v.vdd;
        ch.msg = ch.read === null ? 'Read failed: the bit lines did not part (is the power on?)' : `Read: ${ch.read} (the sense amplifier saw which bit line fell)`;
        if (op.t > op.done + 1.5 * ps) ch.op = null;
      }
    } else if (op.name === 'power') {
      v.vdd = op.arg ? CHIP.VDD : 0;
      if (op.arg) { v.q += (rnd() - 0.5) * 0.01; v.qb += (rnd() - 0.5) * 0.01; } // (switched on, a tiny mismatch decides which way it falls)
      ch.drive.bl = ch.drive.blb = v.vdd; ch.op = null;
      ch.msg = op.arg ? 'Power on: the cell falls into a random state, 0 or 1' : 'Power off: the stored bit leaks away';
    }
  }
  if (ch.drive.bl !== null) v.bl = ch.drive.bl;
  if (ch.drive.blb !== null) v.blb = ch.drive.blb;
  // (each device's ends, left | right, as CHIP_ENDS names them; I is the current from its right end to its left)
  const [aL, dL, uL, uR, dR, aR] = D;
  aL.I = chipChan('n', v.wl, v.q, v.bl, Ut, vth); // Q → bit line
  dL.I = chipChan('n', v.qb, v.q, 0, Ut, vth); // Q → ground
  uL.I = chipChan('p', v.qb, v.vdd, v.q, Ut, vth); // supply → Q
  uR.I = chipChan('p', v.q, v.qb, v.vdd, Ut, vth); // Q̄ → supply (negative: the supply feeds Q̄)
  dR.I = chipChan('n', v.q, 0, v.qb, Ut, vth); // ground → Q̄ (negative: Q̄ drains to ground)
  aR.I = chipChan('n', v.wl, v.blb, v.qb, Ut, vth); // bit line → Q̄
  const leak = v.vdd < 0.05 ? 1 / 8e-12 : 0; // (unpowered, the nodes drain away: here in picoseconds, in a real cell far slower)
  v.q = clamp(v.q + h * ((uL.I - aL.I - dL.I) / CHIP.CN - leak * v.q), -0.05, CHIP.VDD + 0.05);
  v.qb = clamp(v.qb + h * ((aR.I + dR.I - uR.I) / CHIP.CN - leak * v.qb), -0.05, CHIP.VDD + 0.05);
  if (ch.drive.bl === null) v.bl = clamp(v.bl + h * aL.I / CHIP.CBL, -0.05, CHIP.VDD + 0.05);
  if (ch.drive.blb === null) v.blb = clamp(v.blb - h * aR.I / CHIP.CBL, -0.05, CHIP.VDD + 0.05);
}
/* The flash cell: the floating gate's voltage is set by the control gate (through the coupling ratio), the drain, and
   the electrons stored on it. Programming puts 15 V on the control gate, and the field across the tunnel oxide
   (Fowler–Nordheim: J = A·E²·e^(−B/E)) pulls electrons up from the channel one by one until the stored charge has
   weakened it; erasing puts −15 V there and drives them back down. Reading puts 1.5 V on the control gate: an erased
   cell conducts (1), a programmed one, its threshold raised by the stored electrons, does not (0). */
function flashFG(ch) { return CHIP.ALPHA_CG * ch.v.cg + CHIP.ALPHA_D * ch.v.d - ch.nfg * 1.602e-19 / CHIP.C_FG; }
function flashVth(ch, vth) { return (vth - CHIP.ALPHA_D * ch.v.d + ch.nfg * 1.602e-19 / CHIP.C_FG) / CHIP.ALPHA_CG; } // as the control gate sees it
function flashTick(ch, tc, Ut, vth) {
  const op = ch.op, v = ch.v, D = ch.devs[0];
  if (op) {
    op.t += tc;
    const us = 1e-6;
    if (op.name === 'program' || op.name === 'erase') {
      const sign = op.name === 'program' ? 1 : -1, len = CHIP.PULSE;
      v.cg = op.t < len ? sign * CHIP.V_PROG : 0; v.d = 0;
      const E = Math.abs(flashFG(ch)) / CHIP.T_TUN, dir = Math.sign(flashFG(ch)); // field across the tunnel oxide; electrons go towards +
      const J = E > 1e8 ? CHIP.FN_A * E * E * Math.exp(-CHIP.FN_B / E) : 0, rate = J * CHIP.A_TUN / 1.602e-19; // electrons per second
      let k = poissonDraw(rate * Math.min(tc, Math.max(0, len - (op.t - tc))));
      while (k-- > 0) {
        if (dir > 0) { ch.nfg++; ch.hops.push({ up: true, t: 0 }); }
        else if (ch.nfg > 0) { ch.nfg--; ch.hops.push({ up: false, t: 0 }); }
      }
      if (ch.hops.length > 40) ch.hops.splice(0, ch.hops.length - 40);
      ch.msg = op.t < len ? `${op.name === 'program' ? 'Programming' : 'Erasing'}: ${sign > 0 ? '+' : '−'}15 V on the control gate pulls electrons ${sign > 0 ? 'up through the oxide onto' : 'down off'} the floating gate (${(op.t / us).toFixed(1)} µs)`
        : `${op.name === 'program' ? 'Programmed' : 'Erased'}: ${ch.nfg} electron${ch.nfg === 1 ? '' : 's'} on the floating gate`;
      if (op.t > len) ch.op = null;
    } else if (op.name === 'read') {
      v.cg = CHIP.V_READ; v.d = 0.5;
      D.I = chipChan('n', flashFG(ch), v.d, 0, Ut, vth);
      if (ch.read === null) ch.read = Math.abs(D.I) > 1e-6 ? 1 : 0;
      ch.msg = ch.read === null ? 'Reading: 1.5 V on the control gate' : `Read: ${ch.read} (${ch.read ? 'it conducts: erased' : 'no current: programmed'}; ${fmtCurrent(D.I)})`;
      if (op.t > 0.15 * us) { ch.op = null; v.cg = 0; v.d = 0; }
    }
  }
  D.I = chipChan('n', flashFG(ch), v.d, 0, Ut, vth);
  for (const h of ch.hops) h.t += 1; // (frames; drawn rising or falling through the oxide)
  ch.hops = ch.hops.filter(h => h.t < 30);
}
function poissonDraw(m) {
  if (!(m > 0)) return 0;
  if (m > 30) return Math.max(0, Math.round(m + Math.sqrt(m) * gauss()));
  let k = 0, p = Math.exp(-m), s = p; const u = rnd();
  while (u > s && k < 200) { k++; p *= m / k; s += p; }
  return k;
}
function fmtCurrent(I) { const a = Math.abs(I); return a < 1e-9 ? (a * 1e12).toFixed(a < 1e-11 ? 2 : 1) + ' pA' : a < 1e-6 ? (a * 1e9).toFixed(1) + ' nA' : (a * 1e6).toFixed(1) + ' µA'; }
/* The drawing's carriers: dots run along each channel as fast as a few a second for a transistor fully on (more
   current, more dots; electrons in an n-channel, holes in a p-channel), the way the current goes. */
function chipDots(ch, realDt) {
  for (const d of ch.devs) {
    const f = Math.min(1.5, Math.abs(d.I) / 40e-6), dir = Math.sign(d.I) * (d.t === 'n' ? 1 : -1); // (current flows from the right end to the left when I > 0: electrons the other way, holes with it)
    if (f > 0.002) { d.acc += 14 * f * (realDt || 0); for (; d.acc >= 1; d.acc -= 1) d.dots.push({ s: dir > 0 ? 0 : 1, dir, j: (rnd() - 0.5) }); }
    else d.acc = 0;
    for (const o of d.dots) o.s += o.dir * (realDt || 0) / 0.7;
    d.dots = d.dots.filter(o => o.s >= 0 && o.s <= 1);
    if (d.dots.length > 60) d.dots.splice(0, d.dots.length - 60);
  }
}
/* ------------------------------------------------------------------ flash memory
   The flash cells in the chamber, together, are a memory: taken in reading order (rows from the top, each left to
   right), eight cells to a byte, each byte's first cell its highest bit. As a real flash chip does, writing erases the
   whole block first (every cell back to 1) and then programs only the cells whose bits are 0; a read senses every cell
   at once. W.mem is the operation under way (or the last one, done). */
function flashStored(ch) { return flashVth(ch, Math.max(0.02, CHIP.VTH - 8e-4 * (ch.T - 300))) > CHIP.V_READ ? 0 : 1; } // (what a read would give)
function chipAt(ch) { // where a chip is: the middle of its (floating) gate, or of whatever is left of it
  let l = ch.devs[0].gate.filter(p => p && !p.dead); if (!l.length) l = ch.ps.filter(p => !p.dead);
  let x = 0, y = 0; for (const p of l) { x += p.x; y += p.y; }
  return l.length ? [x / l.length, y / l.length] : [0, 0];
}
/* The reading order is kept once found (W.memOrder) while the same cells are still near where they were when it was
   found: cells drift and jiggle with heat, and two in neighbouring rows or columns swapping places between a write and a
   read showed as bits flipping. The order is found afresh when a cell has moved MEM_DRIFT or more, or cells came or went. */
const MEM_DRIFT = 12;
function flashMemory() {
  const cs = W.chips.filter(c => c.key === 'flashcell').map(c => ({ c, at: chipAt(c) }));
  const O = W.memOrder;
  if (O && O.cells.length === cs.length) {
    let same = true;
    for (const e of cs) { const was = O.at.get(e.c); if (!was || Math.abs(was[0] - e.at[0]) >= MEM_DRIFT || Math.abs(was[1] - e.at[1]) >= MEM_DRIFT) { same = false; break; } }
    if (same) return { cells: O.cells, bytes: Math.floor(O.cells.length / 8) };
  }
  cs.sort((a, b) => b.at[1] - a.at[1]); // (top first: y is up)
  const rows = [];
  for (const e of cs) { const r = rows[rows.length - 1]; if (r && r.y - e.at[1] < 15) r.list.push(e); else rows.push({ y: e.at[1], list: [e] }); } // (a cell is 31 Å tall)
  const cells = [], at = new Map();
  for (const r of rows) { r.list.sort((a, b) => a.at[0] - b.at[0]); for (const e of r.list) { cells.push(e.c); at.set(e.c, e.at); } }
  W.memOrder = { cells, at };
  return { cells, bytes: Math.floor(cells.length / 8) };
}
/* Bits (1, 0, or null for a cell that could not be read) to bytes: their binary, code and character (null when it is
   not a printable one). */
function memDecode(bits) {
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const b = bits.slice(i, i + 8), ok = b.every(v => v === 0 || v === 1), code = ok ? parseInt(b.join(''), 2) : null;
    out.push({ bin: b.map(v => (v === 0 || v === 1 ? v : '?')).join(''), code, ch: code !== null && code >= 32 && code <= 126 ? String.fromCharCode(code) : null });
  }
  return out;
}
const memBusy = () => !!(W.mem && W.mem.stage !== 'done');
/* Write text (plain ASCII, one character a byte; the rest padded with spaces). Returns why it cannot, or null. */
function memWrite(text) {
  if (memBusy()) return 'The memory is busy.';
  const M = flashMemory();
  if (!M.bytes) return `Eight flash cells make a byte: place ${8 - M.cells.length} more to store a character.`;
  const codes = Array.from(String(text || ''), c => c.codePointAt(0));
  if (!codes.length) return 'Type a character to store.';
  if (codes.some(c => c < 32 || c > 126)) return 'Only plain ASCII fits in a byte here: letters, digits, spaces and symbols (codes 32–126).';
  if (codes.length > M.bytes) return `${M.cells.length} cells hold ${M.bytes} character${M.bytes > 1 ? 's' : ''}.`;
  while (codes.length < M.bytes) codes.push(32);
  const cells = M.cells.slice(0, 8 * M.bytes);
  if (cells.some(c => c.broken)) return 'A cell is broken, so the memory cannot be written.';
  W.mem = { op: 'write', stage: 'erase', cells, act: cells, bits: cells.map((_, i) => (codes[i >> 3] >> (7 - (i & 7))) & 1), text: String.fromCharCode(...codes), msg: '' };
  for (const c of cells) chipOp(c, 'erase');
  memTick();
  return null;
}
function memRead() {
  if (memBusy()) return 'The memory is busy.';
  const cells = flashMemory().cells, act = cells.filter(c => !c.broken);
  if (!act.length) return 'There is no working flash cell to read.';
  W.mem = { op: 'read', stage: 'read', cells, act, msg: '' };
  for (const c of act) chipOp(c, 'read');
  memTick();
  return null;
}
/* One cell flipped by hand: programmed if it stores 1, erased if it stores 0. */
function memFlip(ch) {
  if (!ch || ch.key !== 'flashcell' || ch.broken || ch.op || memBusy()) return false;
  return chipOp(ch, flashStored(ch) ? 'program' : 'erase');
}
function memTick() {
  const m = W.mem;
  if (!m || m.stage === 'done') return;
  if (m.act.some(c => c.broken || !W.chips.includes(c))) { m.stage = 'done'; m.msg = 'Stopped: a cell came apart.'; for (const c of m.act) c.op = null; return; }
  const n = m.act.length;
  if (m.act.some(c => c.op)) {
    m.msg = m.stage === 'erase' ? `Writing “${m.text}”: first erasing all ${n} cells (−15 V on every control gate drives the stored electrons off, and an erased cell reads 1)`
      : m.stage === 'program' ? `Writing “${m.text}”: programming the ${m.nProg} cell${m.nProg === 1 ? '' : 's'} whose bits are 0 (+15 V pulls electrons up through the oxide onto the floating gates)`
        : m.stage === 'verify' ? `Writing “${m.text}”: reading it back to check` : `Reading all ${n} cells at once (1.5 V on every control gate: an erased cell conducts, a programmed one does not)`;
    return;
  }
  if (m.stage === 'erase') {
    const z = m.act.filter((c, i) => !m.bits[i]);
    m.stage = 'program'; m.nProg = z.length;
    if (z.length) { for (const c of z) chipOp(c, 'program'); memTick(); return; }
  }
  if (m.stage === 'program') { m.stage = 'verify'; for (const c of m.act) chipOp(c, 'read'); memTick(); return; }
  m.got = m.cells.map(c => (m.act.includes(c) ? c.read : null));
  m.bytes = memDecode(m.got); m.stage = 'done';
  const txt = m.bytes.map(b => (b.ch === null ? '?' : b.ch)).join('');
  if (m.op === 'write') {
    m.ok = m.act.every((c, i) => c.read === m.bits[i]);
    m.msg = m.ok ? `Wrote “${m.text}” and read it back` : `Wrote “${m.text}”, but it reads back as “${txt}”: a cell did not take its bit`;
  } else m.msg = m.bytes.length ? `Read “${txt}”` : `Read ${m.got.map(v => (v === null ? '×' : v)).join('')}`;
}
/* ------------------------------------------------------------------ radiation: single-event upsets
   A fast charged particle crossing a device frees charge along its track, one electron–hole pair for every 3.6 eV it
   loses in the silicon (Bethe's formula), and the device's node collects it: the drain of an n-channel loses voltage,
   a p-channel's gains. In a memory cell that can flip the stored bit, the soft error radiation causes in real chips
   (in space, from cosmic-ray nuclei). These cells are only a few nanometres across, so a proton or an α particle
   frees too little to flip one; an oxygen nucleus frees about enough, an iron nucleus far more. */
const SEU_PAIRS = 10 * Math.round(CHIP.CN * CHIP.VDD / 1.602e-19 / 10); // (the struck node must be emptied before the other side can win: ~470 pairs, measured)
function letSi(p) { // eV per Å lost in silicon by a fast charged particle
  const mc2 = p.m * 931.494e6, KE = p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
  const g = 1 + KE / mc2, b2 = Math.max(1e-6, 1 - 1 / (g * g));
  const z = p.k === NUC ? p.Z * (1 - Math.exp(-125 * Math.sqrt(b2) / Math.pow(p.Z, 2 / 3))) : 1; // (an ion's effective charge: stripped when fast)
  return 0.003566 * z * z / b2 * Math.max(1, Math.log(1.022e6 * b2 * g * g / 173) - b2);
}
function segBox(x0, y0, x1, y1, b) { // length of the segment inside the box [x0, x1, y0, y1]
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0, P = [-dx, dx, -dy, dy], Q = [x0 - b[0], b[1] - x0, y0 - b[2], b[3] - y0];
  for (let k = 0; k < 4; k++) {
    if (P[k] === 0) { if (Q[k] < 0) return 0; continue; }
    const r = Q[k] / P[k];
    if (P[k] < 0) { if (r > t1) return 0; if (r > t0) t0 = r; } else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dy) : 0;
}
const _seuAt = new Map(); // a fast particle without a track: where it was last seen, and what it has given up so far
function chipsRadiation() {
  if (!W.chips.length) { if (_seuAt.size) _seuAt.clear(); return; }
  let boxes = null;
  const devBoxes = () => {
    boxes = [];
    for (const ch of W.chips) if (!ch.broken && (ch.key === 'sramcell' || ch.key === 'inverter')) ch.devs.forEach((d, i) => { const b = chipBox(d.path.concat(d.gate)); boxes.push([ch, i, d, [b[0] - 1.2, b[1] + 1.2, b[2] - 1.2, b[3] + 1.2]]); });
    return boxes;
  };
  // the tracks first: every point added since the last look (a fast ion can cross a chip, and leave, within one frame)
  for (const t of W.tracks) {
    const p = t.p;
    if (!p || (p.k === NUC && p.Z === 0) || t.pts.length - 2 <= t.seuI) continue;
    if (!t.seuE0) t.seuE0 = keOfFast(p);
    if ((boxes || devBoxes()).length) t.seuDep += strikeAlong(p, t.pts, t.seuI, boxes, t.seuE0 - t.seuDep);
    t.seuI = t.pts.length - 2;
  }
  // then fast particles that leave no track: from where they were last seen
  const now = new Map();
  for (const p of W.parts) {
    if (p.dead || p.trk || !(p.rad || p.fast) || (p.k === NUC && p.Z === 0)) continue;
    const was = _seuAt.get(p.id), E0 = was ? was[2] : keOfFast(p);
    let dep = was ? was[3] : 0;
    if (was && (boxes || devBoxes()).length) dep += strikeAlong(p, [was[0], was[1], p.x, p.y], 0, boxes, E0 - dep);
    now.set(p.id, [p.x, p.y, E0, dep]);
  }
  _seuAt.clear(); for (const [k, v] of now) _seuAt.set(k, v);
}
function keOfFast(p) { return p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy); }
/* Strikes along a path (coordinates from index i0): returns the energy given up to the chips, never more than left. */
function strikeAlong(p, pts, i0, boxes, left) {
  const wrap = W.wall === 'wrap', hw = 0.5 * W.box.w, hh = 0.5 * W.box.h; // (a segment across the box is a wrap-around, not a path)
  let given = 0, let0 = 0;
  for (const [ch, i, d, b] of boxes) {
    if (ch.broken || left - given <= 0) continue;
    let L = 0;
    for (let k = i0; k + 3 < pts.length; k += 2) if (!wrap || (Math.abs(pts[k + 2] - pts[k]) < hw && Math.abs(pts[k + 3] - pts[k + 1]) < hh)) L += segBox(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], b);
    if (L <= 0) continue;
    if (!let0) let0 = letSi(p);
    const E = Math.min(let0 * L, left - given); // (a particle cannot free more than it has: Bethe's formula fails for slow ones)
    if (E >= 3.6) { chipStrike(ch, i, d, p, E); given += E; }
  }
  return given;
}
/* A chip's silicon is wired to ground, which within picoseconds gives back the electrons radiation knocks out of its
   atoms (or takes extra ones away): left charged, the ions along a heavy nucleus's track would push each other
   apart and melt so small a chip. The energy goes to the circuit. */
function chipGround(ch) {
  for (let j = 0; j < ch.ps.length; j++) {
    const p = ch.ps[j];
    if (p.dead || p.k !== NUC || p.anti || p.q === ch.q0[j]) continue;
    const ne = p.ne + (p.q - ch.q0[j]);
    if (ne < 0 || ne > p.Z + maxExtraElectrons(p.Z)) continue;
    p.ne = ne; refresh(p); enforceValence(p, null); relink([p]);
  }
}
function srBit(ch) { return ch.v.vdd < 0.3 ? null : ch.v.q > ch.v.qb ? 1 : 0; }
function chipStrike(ch, i, d, p, E) {
  const pairs = Math.round(E / 3.6), dv = pairs * 1.602e-19 / CHIP.CN, s = d.t === 'n' ? -1 : 1;
  const who = p.k === NUC ? speciesLabel(p) : p.k === ELEC ? 'an electron' : 'a positron';
  if (ch.key === 'sramcell') {
    const node = i < 3 ? 'q' : 'qb', toward = (ch.v[node] > 0.5 * ch.v.vdd) === (s < 0), bit0 = srBit(ch); // (does it push the node away from where it sits?)
    ch.v[node] = clamp(ch.v[node] + s * dv, -0.05, ch.v.vdd + 0.05);
    if (pairs < SEU_PAIRS / 4) return; // (the trickle from slow secondary electrons is felt, not reported)
    if (!ch.hit) ch.hit = { t: ch.tc, bit: bit0, who, pairs: 0, most: 0, eff: 0 };
    ch.hit.pairs += pairs; ch.hit.t = ch.tc; if (toward) ch.hit.eff += pairs;
    if (pairs > ch.hit.most) { ch.hit.most = pairs; ch.hit.who = who; } // (credited to the biggest strike)
    if (!(ch.msgHold > W.rt)) ch.msg = `Struck by ${who}: ${pairs.toLocaleString('en-US')} electron–hole pairs freed in its ${node === 'q' ? 'Q' : '¬Q'} side`;
  } else if (ch.key === 'inverter') {
    ch.v.out = clamp(ch.v.out + s * dv, -0.05, CHIP.VDD + 0.05);
    if (pairs >= SEU_PAIRS / 4) ch.hitMsg = `Glitch: struck by ${who}, ${pairs.toLocaleString('en-US')} electron–hole pairs freed at its output`;
  }
}
function seuSettle(ch) { // ten picoseconds after a strike: did the bit flip?
  const h = ch.hit, now = srBit(ch); ch.hit = null; ch.bitRef = now;
  if (h.bit === null || now === null) return;
  const n = h.pairs.toLocaleString('en-US');
  if (now !== h.bit) { ch.flips++; ch.msgHold = W.rt + 4; ch.msg = `Bit flipped, ${h.bit} → ${now}: ${h.who} freed ${n} electron–hole pairs, and about ${SEU_PAIRS} tip this cell over. A single-event upset: in space, cosmic-ray nuclei do this.`; }
  else if (ch.msgHold > W.rt) return; // (a flip just reported stays up a while)
  else if (h.eff < SEU_PAIRS / 4) ch.msg = `Hit by ${h.who} (${n} electron–hole pairs), but on the side already at that level, so nothing changed: a struck n-channel pulls its node down, a p-channel up. It still holds ${now}.`;
  else ch.msg = `Hit by ${h.who}: ${n} electron–hole pairs freed, ${h.eff < SEU_PAIRS ? `too few to flip it (about ${SEU_PAIRS} are needed)` : 'but the cell pulled itself back'}. It still holds ${now}.`;
}
/* Any other change of the stored bit, outside a write or a strike being watched, is reported too. */
function srWatch(ch) {
  if (ch.op || ch.hit) return;
  const now = srBit(ch);
  if (now !== null && ch.bitRef !== null && ch.bitRef !== undefined && now !== ch.bitRef) { ch.flips++; ch.msgHold = W.rt + 4; ch.msg = `Bit flipped, ${ch.bitRef} → ${now}, with no single strike to blame: stray charge from the slow electrons around it, or heat (the cell is at ${Math.round(ch.T).toLocaleString('en-US')} K).`; }
  ch.bitRef = now;
}
