Atom Forge xTB (1.26): the fit and the comparison, as run for PERF-NOTES "### 1.26: Atom Forge xTB".
Outside data (not in the repository): AF_REF=<dir> holding GMTKN55/ (W4-11, BH76, WATER27 from the GMTKN55 repository
on GitHub) and xtb-6.7.1/bin/xtb (the owner's g-xTB build, grimme-lab/g-xtb releases; used only by gxref.js to make
reference points, never shipped). Outputs (fitdata.json, gxref.json, fit*.json, cmp-*.json, opt-*.json) land here.
  node fitdata.js                        # the GMTKN55 reactions of H/C/N/O species -> fitdata.json
  node gxref.js                          # g-xTB points: hexazine's D3h path, N2, a proton between waters -> gxref.json
  node fit.js 1|2 out.json --spin [--iters N --step S --geosig s --reg r --fdh h --geor r --geoa a --from f.json] [--eval]
  node cmp.js gfn1|gfn2|gfn1s|gfn2s      # the comparison table for a method; or: node cmp.js name --par out.json
  node mkaf.js out.json                  # writes tools/xtb/afxtb-data.js (then node tools/xtb/mksrc.js)
xm.js: the method variants, the game-like lowest spin state, BFGS with restraints.
The shipped-parameter candidate (not offered in Settings, 1.26) came from:
  node fit.js 1 a.json --spin --iters 30 --step 3 --geosig 0.04 --reg 1                       (then, each --from the last)
  ... --step 2 --fdh 3e-3 ; ... --geor 0.002 --geoa 0.25 ; ... --wsig 0.015
