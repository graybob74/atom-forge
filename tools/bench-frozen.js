'use strict';
/* Cost of the engine's passes on one frozen state (no motion, so two versions are compared on identical worlds):
   node tools/bench-frozen.js [repo-root] [waterion|water12k|flashbyte]  — ms per call of computeForces, computeFast, chooseDt, outerB. */
const path = require('path');
const args = process.argv.slice(2);
const root = args.find(a => /[\/\\]|^\.\.?$/.test(a)) ? path.resolve(args.find(a => /[\/\\]|^\.\.?$/.test(a))) : path.join(__dirname, '..');
const { load } = require(path.join(root, 'tests/load.js'));
const X=load('all',{seed:12}); X.setMaxParts(12000); const W=X.W;
const scen = args.find(a => /^(waterion|water12k|flashbyte)$/.test(a)) || 'waterion';
if(scen==='waterion'){ X.PRESETS.water.build(); X.settleOverlaps(); const Os=W.parts.filter(p=>p.Z===8); for(let i=0;i<40;i++) X.userIonize(Os[i]); }
else if(scen==='flashbyte'){ X.PRESETS.flashbyte.build(); X.settleOverlaps(); }
else { X.baseWorld(560,360,300,0.05); const nx=80,ny=50,dx=560/nx,dy=360/ny; for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){ if(W.parts.length+3>12000)break; X.addMolecule('H2O',-280+(i+0.5)*dx+(X.rnd()-0.5)*0.4,-180+(j+0.5)*dy+(X.rnd()-0.5)*0.4,X.rnd()*6,300);} X.settleOverlaps(); }
W.decayOn=false;
for(let i=0;i<60;i++){ if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt=X.chooseDt(); X.step(W.dt);} 
X.forcesNoEvents();
const time=(fn,n)=>{ let best=1e9; for(let r=0;r<3;r++){ const t0=performance.now(); for(let i=0;i<n;i++) fn(); best=Math.min(best,(performance.now()-t0)/n);} return best; };
X._noEv = true; // no events queued (they would pile up)
const cf = time(()=>X.computeForces(), scen==='waterion'?300:60);
const out={scenario:scen, computeForcesMs:+cf.toFixed(4)};
if(scen==='waterion'){ out.computeFastMs=+time(()=>X.computeFast(), 3000).toFixed(4); out.innerDtMs=+time(()=>X.innerDt(),3000).toFixed(4); }
out.chooseDtMs=+time(()=>X.chooseDt(),300).toFixed(4);
out.outerBMs=+time(()=>X.outerB(0),300).toFixed(4);
console.log(JSON.stringify(out));
