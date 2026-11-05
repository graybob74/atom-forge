"""Reference spin-polarized GFN1-xTB and GFN2-xTB numbers for checking Atom Forge's port (1.26; run by
.github/workflows/xtb-ref.yml, which installs tblite). Reads geometry files ([{name, Z, xyz Å, charge, uhf}]) and writes,
for each geometry and method, tblite's total energy (eV; GFN1 with its D3, GFN2 with its D4) with the spin-polarization
container (scaling factor 1), the gradient (eV/Å) and the Mulliken charges.
Usage: python ref3.py out.json geoms3.json [more.json ...]"""
import json, sys, numpy as np
from tblite.interface import Calculator
BOHR = 0.529177210903; EH = 27.211386245988
out = []
for f in sys.argv[2:]:
    for g in json.load(open(f)):
        for method in ('GFN1-xTB', 'GFN2-xTB'):
            Z = np.array(g['Z']); xyz = np.array(g['xyz']) / BOHR
            rec = {'name': g['name'], 'method': method}
            try:
                calc = Calculator(method, Z, xyz, charge=float(g.get('charge', 0)), uhf=int(g.get('uhf', 0)))
                calc.set('verbosity', 0)
                calc.set('accuracy', 0.01)
                calc.add('spin-polarization', 1.0)
                r = calc.singlepoint()
                rec.update({'E': float(r.get('energy')) * EH, 'grad': (np.array(r.get('gradient')) * EH / BOHR).tolist(),
                            'q': np.array(r.get('charges')).tolist()})
            except Exception as e:
                rec['error'] = str(e)
            out.append(rec)
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print(len(out), 'calculations')
