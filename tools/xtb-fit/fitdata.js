// The benchmark reactions for the fit (1.26): GMTKN55's W4-11 (atomization), BH76 (barriers), WATER27 (water clusters),
// species of H, C, N, O only; written to fitdata.json as { species: {key: {Z, xyz, charge, uhf}}, rx: [{set, name, sp: [[key, coef]], ref eV}] }
const fs = require('fs'), path = require('path');
const GM = (process.env.AF_REF || __dirname + '/.ref') + '/GMTKN55';
const SYM = { h: 1, c: 6, n: 7, o: 8 }, KCAL = 23.060547830619;
const species = {}, rx = [];
const readSp = (set, name) => {
  const dir = path.join(GM, set, name), key = set + '/' + name;
  if (species[key]) return key;
  const f = path.join(dir, 'struc.xyz'); if (!fs.existsSync(f)) return null;
  const L = fs.readFileSync(f, 'utf8').trim().split('\n').slice(2).filter(l => l.trim());
  const Z = L.map(l => SYM[l.trim().split(/\s+/)[0].toLowerCase()]); if (Z.some(z => !z)) return null;
  const xyz = L.map(l => l.trim().split(/\s+/).slice(1, 4).map(Number));
  const rd = (n) => { try { return +fs.readFileSync(path.join(dir, n), 'utf8').trim(); } catch (e) { return 0; } };
  species[key] = { Z, xyz, charge: rd('.CHRG'), uhf: rd('.UHF') };
  return key;
};
for (const set of ['W4-11', 'BH76', 'WATER27']) {
  for (const l of fs.readFileSync(path.join(GM, set, '.res'), 'utf8').split('\n')) {
    const m = l.match(/^\$tmer\s+(.*?)\s+x\s+(.*?)\s+\$w\s+(-?[\d.]+)/); if (!m) continue;
    let names = []; const body = m[1];
    const br = body.match(/^\{([^}]*)\}\/\$f$/);
    if (br) names = br[1].split(','); else names = body.split(/\s+/).map(s => s.replace(/\/\$f$/, ''));
    const coef = m[2].trim().split(/\s+/).map(Number);
    if (coef.length !== names.length) continue;
    const keys = names.map(n => readSp(set, n));
    if (keys.some(k => !k)) continue;
    rx.push({ set, name: names.join(' '), sp: keys.map((k, i) => [k, coef[i]]), ref: +m[3] / KCAL });
  }
}
fs.writeFileSync(path.join(__dirname, 'fitdata.json'), JSON.stringify({ species, rx }));
const by = {}; for (const r of rx) by[r.set] = (by[r.set] || 0) + 1;
console.log(Object.keys(species).length, 'species,', rx.length, 'reactions', JSON.stringify(by));
