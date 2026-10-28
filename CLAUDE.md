# Atom Forge — notes for Claude

Atom Forge is a 2-D sandbox of particles, atoms, molecules and nuclei that follows real physics: classical molecular
dynamics with a reactive force field for chemistry, free electrons and light, measured nuclear data, relativistic
collisions. It ships as one self-contained HTML page (a claude.ai artifact) and as a Windows desktop app (Tauri).
The owner tests it on Windows (Ryzen 7950X3D, 16 threads, RTX 3090) and reports bugs with screenshots and videos.

## Working with the owner

- Usage is limited: work efficiently, keep a task list for anything with stages, and say early when something turns
  out harder than planned.
- **Physics-model changes need the owner's OK** before they ship (anything that changes how matter behaves, rates,
  energies, bonding rules). Bug fixes, display fixes and text fixes do not.
- **1.00 is out; versions are now 1.xx.0.** New features are built in the main chat from the "Planned features (1.x)"
  list in PERF-NOTES.md, in its order; new requests go on that list. When the owner lists several things, collect them
  and wait for "build it" / "do all of them".
- No risky workarounds. No WebGPU port. Do not extend undo/rewind to setups with chips, beams, lasers or a ramp.
- Explain findings plainly, with before/after numbers from a measurement, not guesses.

## Who does what

- Bug fixes are done in Claude Code sessions on this repository (the `atom-forge-fixer` agent). Each fix is committed
  to `main` and pushed, with its PERF-NOTES entry and test, so the next session starts from it.
- Features, and publishing the browser version to the owner's artifact link, are done in the owner's main Claude chat,
  which pulls `main` before it starts. A bug-fix session does not publish the artifact; when the owner asks it for a
  release, it does the version bump, notes, full suite, commit, push and source zip, and says the page still has to be
  published from the main chat.

## Layout

- `src/` — the page. `build.js` concatenates, in this order: `molecules.gen.js`, `objects.gen.js`, `data.js`,
  `atomic.js`, `solver.js`, `orbitals.js`, `wasm.js`, `engine.js`, `threads.js`, `hep.js`, `props.js`, `chips.js`,
  `render.js`, `gl.js`, `builder.js`, `design.js`, `ui.js`, into `shell.html` + `body.html`. One shared scope: every
  top-level name is global across files.
  - `engine.js` — the world `W`, the particle store `S` (structure of arrays), forces, integration (RESPA inner steps
    for free leptons), events (bonds, reactions, captures, ionization), energy books, walls, neutrons, radiation.
  - `hep.js` — high-energy and nuclear physics: collisions, hadron production, decays, the collider, plasma.
  - `props.js` — placed objects (mirrors, lenses, prisms, screens, foils, plates). `chips.js` — transistor circuits.
  - `render.js` / `gl.js` — 2-D canvas and WebGL drawing. `ui.js` — tools, panels, setups (`PRESETS`), settings,
    saving, graphs, narrator, tour, Help. `builder.js` — molecule builder. `design.js` — Ask Claude (SMILES, lattices).
  - `molecules.gen.js` / `objects.gen.js` — generated libraries. Objects: `node tools/objgen.js [key …]`. Molecules:
    the original generator is not in the repo; after a force-field change re-settle with `node tools/molrelax.js [key …]`.
  - `wasm/` — the Rust kernel (`kernel/`) built by GitHub Actions (`wasm.yml`) and committed; never edit the .wasm.
- `tests/` — `load.js` (Node harness: `load('all', { seed, patch })` returns every top-level name), `browser.js`
  (headless Chromium page; `window.AF_NO_PAUSE` is set so setups do not start paused), `t_*.js` suites, `fixtures/`.
- `tools/` — benchmarks, generators, `runtests.sh`, `stage-app.js` (desktop staging).
- `desktop/` — the Tauri shell. `.github/workflows/main.yml` builds the Windows `.msi`/`.exe` on every push to `main`.
- `PERF-NOTES.md` — the change log by version, design notes, known limits, the after-1.00 list. Read it first.

## Commands

```
node build.js                      # → dist/atom-forge.html (mkdir -p dist first in a fresh copy)
node tests/t_lint.js               # fast; run after every edit
node tests/t_features.js           # the feature/regression checks, one block per version
tools/runtests.sh [tag]            # every suite, two lanes, ~15 min; the release gate
```

Known flakes under the parallel load of `runtests.sh` (rerun alone before believing them): `t_chips` (radiation upset)
and `t_collider` (³⁵⁶Og + ²⁴⁹Cf "nothing listed as made"), `t_page` (a 15 s timeout choosing a collider beam); and when anything else runs at the same time, the
time-budgeted checks in `t_features` (the chain reaction's k readout, saves, start paused) can miss by a little.

## Engine rules that bugs usually come from

- **Energy is booked exactly.** Every event applies its consequences on trial (`snapshot`/`restoreSnap`), measures the
  exact energy change (`localPE` over whole molecules, `internalE`, kinetic), and either releases the difference
  (`dumpHeat`, photons), takes it from the collision (`kickPair`), or undoes itself. A change that alters bond
  parameters, charges or positions outside the measured set leaks energy; `t_energy` catches it.
- `ledger.bath` is outside `totalEnergy()`: drawing on the bath shows up as drift in insulated (`W.gamma = 0`) runs.
- Measuring `totalEnergy()` in the middle of a step is misleading (forces and positions are half updated). Measure
  between steps, or wrap whole event functions (see the `wrap` pattern in old analysis scripts: energy before/after
  each call).
- Randomness only from the seeded `rnd()`/`gauss()`, never `Math.random`, and in a fixed order: the threads and the
  tests depend on runs being reproducible from a seed.
- Units: length Å, time tu (10.18 fs; `PHYS.TU_S`), energy eV, mass u. `0.5·m·v²` in u·Å²/tu² is eV.
- Collisions over a step use the closest approach of the two paths; a pair still closing in at the step's end meets in
  a later step (0.93). Deep slow motion makes steps tiny: test step-size dependence with fixed-`dt` `step()` loops.
- Slow motion: `W.simPerFrame` (speed setting) against `W.baseSpf` (the setup's 1×); automatic slow motion and the
  hourglass both work against `baseSpf` so the speed buttons scale them.

## Making a fix

1. Reproduce it in the Node harness or the headless page, with a number that shows the bug.
2. Find the cause in the code; fix that, not the symptom. Keep the change small.
3. Add a check to `tests/t_features.js` (a new block tagged with the version) that fails before the fix and passes after.
4. `t_lint`, the relevant suites, then `tools/runtests.sh`. All suites must pass (flakes rerun alone).
5. Add the fix to the version's section in PERF-NOTES.md: what was wrong, why, what changed, the numbers.

## Releasing (when the owner says "release")

1. Version in four places: `src/shell.html` (line 1, the title) gets the release name `1.xx.0` (1.02.0);
   `desktop/src-tauri/Cargo.toml` (line 3), `desktop/src-tauri/tauri.conf.json` and `desktop/package.json` get the same
   number as valid semver, without the leading zero (1.2.0): Cargo refuses "1.02.0" and the Windows build fails.
2. PERF-NOTES section for the version; the full suite passes.
3. Back up the source (excluding `dist`, `tests/.tmp`, `kernel/target`, `desktop/dist-app`), commit to `main` with the
   session's trailer, push (this starts the Windows build), give the owner the source zip and the
   `gh run download <run-id> -R graybob74/atom-forge -n atom-forge-windows` command for the new run.
4. The browser version is published to the owner's existing artifact link; never overwrite another artifact link.

## Known limits (documented, not bugs to chase without a plan)

Heavily ionized water gains about 100–170 eV over a run: electrons switching between free flight and the main
integrator. Bonds are a force field (whole-number orders, measured energies), not quantum chemistry; aromatic rings are
detected and given 1.5-order parameters (0.95).
