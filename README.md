# Atom Forge

This project is a fun little simulator that simulates atoms and particles. It was made with Claude (mainly Opus 5.5, but I
switched to Fable for an engine rewrite so it would distribute performance better).

Everything in it follows real physics as closely as a desktop computer allows: atoms move by classical molecular
dynamics, bonds form and break by a reactive force field, light and free electrons are their own particles, and the
nuclear side uses measured data (half-lives, decay modes, cross sections). You can drop in atoms, molecules, light,
beams and placed objects and watch what happens.

## What it has

- **2-D and 3-D.** The flat world is the main game. A 3-D lab (Preview) puts the same physics in a box with depth and a
  camera you can turn.
- **Every element.** All 118, plus elements 119 and 120, each with its real mass, size, charge states and isotopes.
- **Molecules.** A library of 171 ready-made molecules and tiny objects, a molecule builder, and an "Ask Claude" box
  that turns a name, a SMILES string or a crystal lattice into atoms.
- **Chemistry.** Bonds form, break and rearrange; molecules react, burn, dissolve, crystallize and melt. Water,
  salt in water, combustion, crystal growth and many more each have a setup.
- **Light and electrons.** Atoms absorb and emit photons at their real spectral lines, glow when hot, and ionize.
  Mirrors, lenses, prisms, screens, foils, plates and slits act on the light.
- **Nuclear and particle physics.** Radioactive decay chains, fission, fusion, neutron capture, antimatter, muons,
  pions, kaons, hypernuclei, W, Z and Higgs bosons, and colliders (a ring, a linear collider, gold on gold).
- **Electronics.** Transistor circuits: a byte of flash memory, a ring oscillator, a chain of NOT gates, and what cosmic
  rays and heat do to them.
- **60 setups.** Each one starts a scene, from "Primordial soup" and "Liquid water" to "CERN LEP: the Z factory" and
  "Livermore NIF: fusion ignition". There are also challenges ("Make water", "Split uranium", "Flip a bit"…).
- **Tools and readouts.** Tools to place, heat, cool, push, measure and inspect, with graphs, an event log, a narrator
  and a tour. Saving and loading, slow motion down to attoseconds.
- **Settings for more accuracy.** Settings → Experimental has models that cost more CPU but are closer to reality:
  continuous bond orders, quantum bonds (GFN1-xTB), many-body metals, directional forces (lone pairs, σ-holes), induced
  charges and dipoles, electrons as waves, photons as waves, and an Ultra-realistic mode with true sizes and rates.

There are many other things, see for yourself.

## How to run it

- **In a browser:** play it at https://claude.ai/code/artifact/af4824ad-f59c-470a-8c2f-91fbd6fa5895 . The whole game is
  one self-contained HTML page (`dist/atom-forge.html` after a build), so you can also open your own build in a modern browser.
- **On Windows:** a desktop app (Tauri). Every push to `main` builds the Windows installer (`.msi` and `.exe`) with
  GitHub Actions; download it from the run's artifacts.

## Limitations

- Requires a beefy CPU (tested on an AMD Ryzen 9 7950X3D with an RTX 3090). 16 threads runs best, for me. The
  Experimental settings and big 3-D worlds are the heaviest.
- Not 100% accurate, as that would require a supercomputer. Bonds are a force field fitted to measured energies, not
  full quantum chemistry (unless you turn on quantum bonds, which are slow).
- Only so many particles can be simulated: 4,000 by default, and Settings can raise the limit to 20,000.
- Other inaccuracies are described in the Physics tab on the top right of the menu, and in `PERF-NOTES.md`.

## For developers

```
mkdir -p dist
node build.js                      # builds dist/atom-forge.html from src/
node tests/t_lint.js               # quick check after an edit
node tests/t_features.js           # the feature and regression checks
tools/runtests.sh                  # every test suite (about 15 minutes or more)
```

- `src/`: the game. `build.js` joins the files in order into one page; they share one scope.
  - `engine.js` is the world, its particles, forces, steps and events.
  - `hep.js` is the nuclear and particle physics.
  - `ui.js` has the tools, panels, setups and settings.
  - `render.js`, `gl.js` and `view3d.js` draw it.
- `kernel/`: the Rust force kernel, compiled to WebAssembly by GitHub Actions; it does the heavy force loops.
- `tests/`: the Node and headless-browser test suites. `tools/`: generators, fitting scripts and benchmarks.
- `desktop/`: the Windows app.
- `PERF-NOTES.md`: the change log by version, how each model works, its measured numbers and its known limits.
  `CLAUDE.md`: notes for Claude sessions working on the code.
