"""Reference GFN2-xTB numbers for checking Atom Forge's port (1.26; run by .github/workflows/xtb-ref.yml, which installs
tblite). Reads one or more geometry files ([{name, Z, xyz Å, charge, uhf}]) and writes, for each geometry, tblite's total
GFN2-xTB energy (eV, its self-consistent D4 dispersion included), gradient (eV/Å) and Mulliken charges.
Usage: python ref2.py out.json geoms.json [geoms2.json ...]"""
import json, sys, numpy as np
from tblite.interface import Calculator
BOHR = 0.529177210903; EH = 27.211386245988
out = []
for f in sys.argv[2:]:
    for g in json.load(open(f)):
        Z = np.array(g['Z']); xyz = np.array(g['xyz']) / BOHR
        try:
            calc = Calculator('GFN2-xTB', Z, xyz, charge=float(g.get('charge', 0)), uhf=int(g.get('uhf', 0)))
            calc.set('verbosity', 0)
            calc.set('accuracy', 0.01)
            r = calc.singlepoint()
            out.append({'name': g['name'], 'E': float(r.get('energy')) * EH, 'grad': (np.array(r.get('gradient')) * EH / BOHR).tolist(),
                        'q': np.array(r.get('charges')).tolist()})
        except Exception as e:
            out.append({'name': g['name'], 'error': str(e)})
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print(len(out), 'geometries')
