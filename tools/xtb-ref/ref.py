"""Reference GFN1-xTB numbers for checking Atom Forge's port (run by .github/workflows/xtb-ref.yml, which installs tblite).
Reads geoms.json ([{name, Z: [...], xyz: [[x,y,z] Å], charge, uhf}]) and writes ref.json with, for each geometry, the total
energy (eV), the gradient (eV/Å), the Mulliken charges and, where tblite reports it, the energy's parts."""
import json, sys, numpy as np
from tblite.interface import Calculator
BOHR = 0.529177210903; EH = 27.211386245988
geoms = json.load(open(sys.argv[1]))
out = []
for g in geoms:
    Z = np.array(g['Z']); xyz = np.array(g['xyz']) / BOHR
    calc = Calculator('GFN1-xTB', Z, xyz, charge=float(g.get('charge', 0)), uhf=int(g.get('uhf', 0)))
    calc.set('verbosity', 0)
    try:
        r = calc.singlepoint()
        out.append({'name': g['name'], 'E': float(r.get('energy')) * EH, 'grad': (np.array(r.get('gradient')) * EH / BOHR).tolist(), 'q': np.array(r.get('charges')).tolist()})
    except Exception as e:
        out.append({'name': g['name'], 'error': str(e)})
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print(len(out), 'geometries')
