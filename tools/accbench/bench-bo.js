'use strict';
/* What the continuous bond-order chemistry (tools/bo-proto.js, model A) would cost per step: its self-consistent order
   solve alone (40 sweeps over the pairs within 3.2 Å), the forces through it not counted. node bench-bo.js <water|water4k> */
const { orders, X } = require('../bo-proto.js');
const { W } = X; X.setMaxParts(12000);
const scen = process.argv[2] || 'water';
if (scen === 'water4k') { X.baseWorld(300, 200, 300, 0.05); for (let i = 0; i < 60; i++) for (let j = 0; j < 22; j++) X.addMolecule('H2O', -150 + (i + 0.5) * 5, -100 + (j + 0.5) * 200 / 22, X.rnd() * 6, 300); }
else X.PRESETS.water.build();
X.settleOverlaps();
const A = W.parts.filter(p => !p.dead && p.k === X.NUC && p.ne > 0), n = A.length;
// orders() checks every pair (fine for one molecule): here, by cells, the same work as the game's neighbour lists would give
const xy = new Float64Array(2 * n); A.forEach((p, k) => { xy[2 * k] = p.x; xy[2 * k + 1] = p.y; });
const cell = 3.2, grid = new Map(), key = (i, j) => i * 100003 + j; A.forEach((p, k) => { const g = key(Math.floor(p.x / cell), Math.floor(p.y / cell)); (grid.get(g) || grid.set(g, []).get(g)).push(k); });
// split into the cells' neighbourhoods would be the real thing; the solve's cost is per pair, so time it on blocks of ~60 atoms
const blocks = []; for (const [, ks] of grid) if (ks.length) blocks.push(ks);
let pairs = 0; const t0 = performance.now();
const REP = 3;
for (let r = 0; r < REP; r++) { const big = []; for (const ks of blocks) { big.push(...ks); if (big.length >= 60) { const sub = big.map(k => A[k]), z = new Float64Array(2 * sub.length); big.forEach((k, i) => { z[2 * i] = xy[2 * k]; z[2 * i + 1] = xy[2 * k + 1]; }); pairs += orders(sub, z).length; big.length = 0; } } }
const ms = (performance.now() - t0) / REP;
console.log(JSON.stringify({ scen, atoms: n, pairsPerSolve: Math.round(pairs / REP), msOrderSolve: +ms.toFixed(1) }));
