I'm attaching atomforge-source.zip: the full source and tests of Atom Forge, my 2-D particle/atom/molecule physics sandbox, as of V21. It's published as a claude.ai artifact at https://claude.ai/artifact/NePFVLzTJ6HXiz4DjEvP8G (title "Atom Forge V21"). I want much better performance in big worlds without changing the physics. Do it in two phases, and stop after phase 1 to show me the before/after numbers before starting phase 2.

How the project works
- build.js concatenates src/*.js (order in its FILES list) plus shell.html/body.html into dist/atom-forge.html. Engine: data, atomic, solver, orbitals, engine, hep, chips. UI: render, builder, design, ui.
- Units: Å, u, eV, tu (1 tu = 1.018e-14 s). Energy invariant: totalEnergy().total − W.ledger.nuc.
- Tests: node tests/t_*.js, 12 suites (t_lint t_data t_nuclear t_energy t_physics t_collider t_molecules t_design t_chips | t_page t_hep t_fuzz). tests/load.js loads the sources in Node; t_page drives the built page in headless Chromium (Playwright). Run the suites on a snapshot copy of the repo (editing src during a run contaminates it), in two parallel lanes.
- Particles are plain JS objects (newPart in engine.js), read and changed directly by chemistry, ionization, chips, the collider and the UI. Free electrons run on inner RESPA steps (innerSteps/computeFast). Events are queued from the force loop and handled in processEvents.

Phase 1: faster on one core (target 2–3× on big worlds)
1. Measure before changing anything, and again after. For each benchmark record ms per step, steps per frame and simulation speed versus target:
   a) 12,000 atoms of water (about 4,000 H2O) in a 560×360 Å box at 300 K, performance mode on.
   b) The "Liquid water" preset with 40 of its molecules ionized (40 free electrons).
   c) The "Flash memory: one byte" preset (2,112 atoms).
   d) Every preset's frame time, as t_page prints it.
   Profile with node --cpu-prof and go after the real hot spots.
2. Move the hot per-particle data (x, y, vx, vy, fx, fy, gx, gy, m, im, q, kind/flags) into struct-of-arrays typed arrays inside the engine. Keep the particle objects as handles onto them so chemistry, chips, the collider and the UI keep working, or migrate them carefully.
3. Reuse neighbour lists across steps (Verlet lists with a skin, rebuilt only when something has moved more than half the skin). Remove per-step allocations (closures, arrays, Sets, string keys) from the force loop, the inner steps and the drawing.
4. Keep 64-bit precision and exact energy bookkeeping. The physics must not change: every suite passes, and every preset's energy drift stays within t_energy's limits.

Phase 2 (only after I approve it from the phase-1 numbers): multiple cores in a desktop shell
- Wrap the page in Tauri (smaller than Electron) and serve it with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp, so it's cross-origin isolated and SharedArrayBuffer works.
- Split the non-bonded force calculation (and the electron inner steps, if worthwhile) across Web Workers over shared typed arrays. The main thread keeps events, chemistry and bookkeeping. Results must be deterministic for a given seed (fixed reduction order) and match the single-thread path within float rounding.
- The browser artifact keeps working single-threaded (feature-detect crossOriginIsolated).
- Build a Windows installer for me to test. I'm on Windows with a 16-core Ryzen 7950X3D and an RTX 3090, and you can't run Windows builds, so give me a short test checklist and an in-app benchmark that reports ms per step.

Ground rules
- My usage is limited: work efficiently, keep the task list updated, and tell me early if something turns out harder than planned.
- Publish browser releases to the same artifact URL as "Atom Forge V22", V23, and so on. Only real changes count as versions; name-only changes don't. Don't overwrite any other artifact link without asking.
- Back up the source before each release, and give me an updated source zip at the end.
- Don't attempt a GPU (WebGPU) port: it's 32-bit only and can't be tested in your environment.
