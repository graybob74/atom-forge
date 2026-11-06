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

GFN2 refit, second attempt (1.26, PERF-NOTES "### 1.26: GFN2 refit (second attempt)"): GFN2's form with spins, the
electrostatics and the water-dominated parameters frozen (found by refit2.js --sens), invariance clusters held at plain
GFN2's binding (inv.json by mkclus.js: water clusters to 20 molecules, H3O+/OH- in 8 waters, hetero and dispersion pairs;
made in two runs, the second for the dispersion pairs), vertical IPs/EAs held at GFN2's (ipea.json by mkipea.js), H3's
symmetric stretch (a hinge), S22 held out entirely. Same held-out split as fit.js.
  node refit2.js sens.json --sens                                   # the sensitivity table (each parameter, each group)
  node refit2.js out.json --freeze hub:*,g3:1,g3:8,ra:8,rz:8,shp:8:0,dlev:1 [--from f.json --iters N --invsig s ...]
  node mkaf.js out.json --out afxtb2-data.js --id 900002            # XQ.method 4, then node tools/xtb/mksrc.js
