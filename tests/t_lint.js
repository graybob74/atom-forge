'use strict';
/* Static checks of the bundled page script with ESLint's recommended rules (preinstalled ESLint): undefined names,
   duplicate keys, unreachable code, self-assignment, constant conditions, … Each problem is reported at its source
   file and line. Node only. */
const fs = require('fs'), path = require('path');
const NM = '/opt/node-tools/node_modules';
const { Linter } = require(NM + '/eslint/lib/api.js');
const { builtinRules } = require(NM + '/eslint/lib/unsupported-api.js');
const ROOT = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'dist', 'bundle-check.js'), 'utf8');
const globals = {};
for (const g of JSON.parse(fs.readFileSync(path.join(__dirname, 'browser-globals.json'), 'utf8'))) globals[g] = 'readonly';
const rules = {};
for (const [name, r] of builtinRules) if (r.meta && r.meta.docs && r.meta.docs.recommended) rules[name] = 'error';
Object.assign(rules, {
  'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }], 'no-useless-assignment': 'warn', 'no-control-regex': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-cond-assign': ['error', 'except-parens'],
  'no-self-compare': 'error', 'no-unmodified-loop-condition': 'error', 'no-unreachable-loop': 'error',
  'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
  'no-shadow-restricted-names': 'error', 'array-callback-return': 'error', 'no-constructor-return': 'error',
  'no-promise-executor-return': 'error', 'no-template-curly-in-string': 'warn', 'eqeqeq': ['warn', 'smart'],
});
const linter = new Linter({ configType: 'flat' });
const msgs = linter.verify(code, [{ languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals }, rules, linterOptions: { reportUnusedDisableDirectives: 'off' } }]);
// map bundle lines back to source files
const lines = code.split('\n'), starts = [];
lines.forEach((l, i) => { const m = /^\/\* ---- (\S+) ---- \*\/$/.exec(l); if (m) starts.push([i + 1, m[1]]); });
const where = (ln) => { let f = '?', s = 0; for (const [i, n] of starts) if (i <= ln) { f = n; s = i; } return `${f}:${ln - s + 1}`; };
let errors = 0, warns = 0;
for (const m of msgs) {
  const lvl = m.severity === 2 ? 'ERROR' : 'warn';
  if (m.severity === 2) errors++; else warns++;
  if (m.severity === 2 || process.argv.includes('-w')) console.log(`${lvl} ${where(m.line)} ${m.ruleId}: ${m.message}  | ${(lines[m.line - 1] || '').trim().slice(0, 110)}`);
}
console.log(`lint: ${errors} error(s), ${warns} warning(s) in ${code.length} chars (${Object.keys(rules).length} rules)`);
process.exitCode = errors ? 1 : 0;
