'use strict';
/* Runs every test suite on a snapshot copy of the repository, in parallel lanes, then reruns alone whatever failed.
   usage (from the repository root):  node tools/runtests.js [tag] [lanes]      (tools/runtests.sh passes its arguments on)
   - Jobs: each t_*.js suite, and t_features' separate files (its `alone('f_….js')` lines) as jobs of their own, so the
     slowest suite no longer holds one lane for half the run (t_features runs its own checks with AF_ALONE_SKIP=1).
   - Lanes: default the number of cores, at most 12 and at most one per 3.5 GB of memory (t_features takes up to 3 GB);
     the longest jobs start first (durations from the last run, tests/.tmp/durations.json).
   - Then every failed job runs again with nothing else running: a check that passes alone was missed under load (the
     timing checks: the slow-motion button, start paused, speed ratios …), and is reported as such. The run passes when
     every job passed, at once or alone.
   - A line is printed as each job ends; the logs are in the snapshot's out/ folder. */
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execFileSync } = require('child_process');
const REPO = path.join(__dirname, '..'), TAG = process.argv[2] || 'run';
const CPUS = os.cpus().length, MEM = os.totalmem() / 2 ** 30;
const LANES = Math.max(1, +(process.argv[3] || 0) || Math.min(CPUS, 12, Math.floor(MEM / 3.5)));
const SNAP = path.join(process.env.TMPDIR || os.tmpdir(), `atomforge-snap-${TAG}-${process.pid}`), OUT = path.join(SNAP, 'out');
const DUR = path.join(REPO, 'tests', '.tmp', 'durations.json');

// the snapshot: the repository as it is now, so edits during the run do not change it
fs.rmSync(SNAP, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
for (const d of ['src', 'tests', 'tools']) fs.cpSync(path.join(REPO, d), path.join(SNAP, d), { recursive: true, filter: (s) => !s.includes(`${path.sep}.tmp`) });
fs.copyFileSync(path.join(REPO, 'build.js'), path.join(SNAP, 'build.js')); fs.mkdirSync(path.join(SNAP, 'dist'));
try { execFileSync(process.execPath, ['build.js'], { cwd: SNAP, stdio: 'ignore' }); } catch (e) { console.log('BUILD FAILED'); process.exit(1); }
const env = { ...process.env };
if (fs.existsSync(path.join(REPO, 'node_modules'))) env.AF_NODE_MODULES = path.join(REPO, 'node_modules'); // (a PC: the test tools installed in the repository)

// the jobs
const suites = fs.readdirSync(path.join(SNAP, 'tests')).filter(f => /^t_\w+\.js$/.test(f)).sort();
const tf = fs.readFileSync(path.join(SNAP, 'tests', 't_features.js'), 'utf8');
const aloneFiles = [...tf.matchAll(/await alone\('(f_\w+\.js)'\)/g)].map(m => m[1]);
const jobs = [
  ...suites.map(f => ({ name: f.replace(/\.js$/, ''), file: f, env: f === 't_features.js' ? { AF_ALONE_SKIP: '1' } : {} })),
  ...aloneFiles.map(f => ({ name: f.replace(/\.js$/, ''), file: f, env: {}, alone: true })),
];
let dur = {}; try { dur = JSON.parse(fs.readFileSync(DUR, 'utf8')); } catch (e) { /* (first run) */ }
const guess = (j) => dur[j.name] || (j.name === 't_features' ? 900 : j.name === 't_page' ? 400 : 60);
jobs.sort((a, b) => guess(b) - guess(a));

const t0 = Date.now(), results = {};
const passedLine = (out) => { const ls = out.split('\n').filter(l => l.trim()); return ls.length ? ls[ls.length - 1] : ''; };
function run(j, tagLog) {
  return new Promise((res) => {
    const ts = Date.now(), log = path.join(OUT, `${j.name}${tagLog || ''}.log`);
    const cp = spawn(process.execPath, ['--max-old-space-size=3072', path.join('tests', j.file)], { cwd: SNAP, env: { ...env, ...j.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; cp.stdout.on('data', d => { out += d; }); cp.stderr.on('data', d => { out += d; });
    cp.on('close', (rc) => {
      fs.writeFileSync(log, out);
      const last = passedLine(out), ok = rc === 0 && (!j.alone || /passed/.test(last)), s = Math.round((Date.now() - ts) / 1000);
      res({ ok, rc, s, last, fails: out.split('\n').filter(l => l.startsWith('FAIL ')) });
    });
  });
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
(async () => {
  console.log(`${jobs.length} jobs (${suites.length} suites, ${aloneFiles.length} of t_features' files on their own) in ${LANES} lanes; ${CPUS} cores, ${MEM.toFixed(0)} GB; logs in ${OUT}`);
  let next = 0, done = 0;
  const lane = async () => { while (next < jobs.length) { const j = jobs[next++]; const r = await run(j); results[j.name] = r; dur[j.name] = r.s; done++;
    console.log(`[${fmt(Math.round((Date.now() - t0) / 1000))}] ${String(done).padStart(2)}/${jobs.length} ${r.ok ? 'ok  ' : 'FAIL'} ${j.name.padEnd(12)} ${String(r.s).padStart(4)}s  ${r.last.slice(0, 90)}`); } };
  await Promise.all(Array.from({ length: LANES }, lane));
  const failed = jobs.filter(j => !results[j.name].ok);
  if (failed.length) console.log(`\n${failed.length} failed; running them again alone, one at a time:`);
  for (const j of failed) {
    const r = await run(j, '.alone'); results[j.name].again = r;
    console.log(`[${fmt(Math.round((Date.now() - t0) / 1000))}] ${r.ok ? 'ok   (missed under load only)' : 'FAIL again'} ${j.name}  ${r.s}s  ${r.last.slice(0, 80)}`);
  }
  try { fs.mkdirSync(path.dirname(DUR), { recursive: true }); fs.writeFileSync(DUR, JSON.stringify(dur, null, 1)); } catch (e) { /* (read-only) */ }
  const flaky = failed.filter(j => results[j.name].again.ok), real = failed.filter(j => !results[j.name].again.ok);
  console.log(`\n${jobs.length - failed.length} of ${jobs.length} passed at once${flaky.length ? `, ${flaky.length} more alone (${flaky.map(j => j.name).join(', ')})` : ''}; ${fmt(Math.round((Date.now() - t0) / 1000))} in all`);
  for (const j of flaky) for (const l of results[j.name].fails) console.log(`  under load only, ${j.name}: ${l.slice(0, 200)}`);
  for (const j of real) { console.log(`FAILED ${j.name}: ${results[j.name].again.last.slice(0, 120)}`); for (const l of results[j.name].again.fails) console.log(`  ${l.slice(0, 220)}`); }
  console.log(`logs in ${OUT}`);
  console.log(real.length ? 'SOME SUITES FAILED' : 'ALL SUITES PASSED');
  process.exitCode = real.length ? 1 : 0;
})();
