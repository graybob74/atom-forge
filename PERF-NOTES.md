# Atom Forge V22–V27 — engine performance notes

The physics is unchanged: the same potentials, events, step-size rules and energy bookkeeping. What changed is how the
engine stores and visits particles.

## Particle store (struct of arrays) — `engine.js`, top
- `S` holds the hot per-particle data in typed arrays indexed by a particle's slot `p.i`: `x y vx vy fx fy gx gy ox oy m im q qp`
  (Float64), `k dead fast rad fresh ballistic inMD nearIon ionic isMetal anti xferD xferA` (Uint8), `Z ne cap used` (Int16),
  `mol id hit` (Int32), plus `ljR ljS ionR sEN elrc` (Float64) for the pair loop. `S.obj[i]` is the particle object.
- Particle objects are now instances of `class Part`: those fields are accessors onto the store, every other field is an
  ordinary property. All existing code (`p.x`, `p.dead = true`, `p.q + p.qp` …) works unchanged; the hot loops read the
  arrays directly.
- Slots are reused. A dead particle keeps its slot until `step()` drops it from `W.parts`; `freeSlot` then detaches the
  handle (its last values become plain properties, `dead` stays true), so stale references in the UI remain harmless.
  `clearWorld` and the builder's private world (`mbRelax`) give their slots back the same way (`dropParts`).
- `_PI` mirrors `W.parts` as slots (`partsSync()`); `pushPart` and the compaction keep it current, any other replacement of
  `W.parts` is caught and rebuilt.

## Neighbour lists
- `VL`: Verlet list of nucleus–nucleus pairs within `RC + SKIN` (SKIN = 1 Å), built from the cell grid, kept while the set
  of MD particles (`_mdGen`) and the box are unchanged and no nucleus has moved more than SKIN/2. Each pair carries an
  exclusion mark (`vlExclusions`, recomputed on `W.topo`/`W.dirty` changes): 1 = same molecule and excluded (skipped),
  2 = same molecule and interacting (no Set lookup needed), 0 = different molecules.
- `FL`: the free leptons' list — lepton–atom and lepton–lepton pairs within `RC + SKIN_F` (SKIN_F = 2 Å) — used by the inner
  (RESPA) steps and by `computeForces` for every pair with a free lepton. Rebuilt when the MD set changes or anything
  has moved more than SKIN_F/2 (a lepton moves at most 0.2 Å per inner step). It replaces the per-inner-step cell sorts.
- The cell grid (`G`) is still rebuilt at every `computeForces` (cells ≥ 8 Å), so `nearby()`, `localPE` and the event code
  see exactly what they saw before.
- The angle (VSEPR) centres, their neighbours and target angles are cached (`AC`) and refreshed on `W.topo`/`W.dirty`
  changes; two-bond centres take a sort-free path; bond directions give sin/cos without trig calls.

## Pair kernel and worker threads (V23)
- The nucleus pair physics (atom–atom, bare nuclei, antimatter), the Morse bonds and the angle terms are *kernels* between
  the `PAIR KERNEL BEGIN/END` markers in `engine.js`: they read the store `S`, the bond arrays `BD` and the angle centres
  `AC` only — never a particle object — and write forces into whatever output arrays they are given. Where the old code
  queued an event, a kernel notes a *candidate* `(kind, i, j)`; `evalCandidates` turns candidates into events on the main
  thread, in the order noted, with the chemistry that needs the objects (`reaction`, `covalentOK` …). One thread or
  many therefore queue the same events in the same order.
- `threads.js` runs the kernels in Web Workers over the shared store (`SharedArrayBuffer`): `build.js` embeds the kernel
  text as `PAIR_KERNEL_SRC`, and `workerSource()` adds the constants and zbl helpers from the live code. Each force
  pass: the main thread hands every worker a range of pairs, bonds and centres (shared control words, `Atomics.wait`
  in the workers, a spin on the main thread), computes its own ranges into `S.fx/fy`, then every slot's forces are
  summed over the workers' buffers in a fixed order (the reduction is shared out too) and the candidates evaluated in
  list order. Deterministic for a given thread count; equal to one thread to rounding (`t_threads`).
- Needs a cross-origin isolated page (COOP `same-origin` + COEP `require-corp`): the desktop app serves it so
  (`desktop/src-tauri/tauri.conf.json` → `app.security.headers`); a plain page keeps one thread. Settings → Threads
  (auto = all but one), Settings → Run benchmark. Worlds under ~1,500 pairs a thread stay on one thread.
- Store and list arrays that grow bump `_sharedGen`; the workers are rebound before the next pass (`threadsBind`).

## V24: the serial parts
- The grid's object list `G.list` is built only when something asks for it (`nearby`, `localPE` …); the force passes use
  slot indices. `_md` is gone (`_mdI` slots; `_mdL`, `_charged`, `_fastNuc` keep objects).
- Flag changes (`dead`, `fast`, `rad`) bump `_flagGen`; `listsStale`, the fast-lepton pass and the dead-particle
  compaction run only when something changed (`_nDead`, `_flagGen !== _flagGenForces`).
- With threads, the plain integration (no B field, no MD leptons, ≥ 2,000 slots) is shared out as well (`integrateA` →
  `integrateSlots` in the workers), the workers are woken at the start of the step (`threadsPrewake`), and the main
  thread takes half a worker's share of the pairs so it is free to drive the pass.

## V25: the force kernels in WebAssembly (`kernel/`, `src/wasm.js`)
- The pair, bond and angle kernels exist twice: the JavaScript ones (engine.js, PAIR KERNEL block) and a Rust port
  (`kernel/src/lib.rs`), the same arithmetic in the same order; they agree to rounding (`tests/t_wasm.js`, and
  `kernel/examples/check.rs` against a dump from `tools/kdump.js`). The only differences are exp/pow (the two libms) and
  atan2 (Cephes' rational approximation in `kernel/src/fastmath.rs`, ~1 ulp; the libm one was most of the angle kernel's
  time in WebAssembly). Both angle kernels use √(dx²+dy²) rather than hypot now.
- GitHub Actions builds the module (`.github/workflows/wasm.yml`: nightly Rust, std rebuilt with atomics, memory imported
  and shared, `__stack_pointer` and `__heap_base` exported) and commits it back as `src/wasm/kernel.wasm`; `build.js`
  embeds it as `KERNEL_WASM_B64`. Without the file the page is as before.
- Memory: when the module and shared memory are there (Node; a cross-origin isolated page), `shArray` carves every
  shared array — the store, the neighbour list, bonds, angle centres, force buffers, candidate queues — out of one shared
  `WebAssembly.Memory` with a bump allocator (`wasmArray`; 16 MB to start, grown as needed; growing keeps every view
  valid). A descriptor of byte offsets (`wasmDesc`) tells the kernel where the arrays are; it is filled before each pass.
  The main thread compiles the module in the background (synchronously in Node) and runs `af_forces` for its share; each
  worker instantiates the same module on the same memory with a stack of its own (`__stack_pointer`), and sums the force
  buffers with `af_sum`. A page without shared memory keeps plain typed arrays and the JavaScript kernels.
- Node, one thread: the kernels 2.5× faster (water 1.5 → 0.9 ms, flash byte 1.6 → 0.8), the step 4.3 → 3.6 ms (water)
  and 2.3 → 1.5 ms (flash byte). `node tools/kdump.js <scenario> out.bin` + `cargo run --release --example check -- out.bin`
  checks and times the native build; Settings shows the kernel in use.

## V32: typed values with units, the tools' figures, walls that keep everything in, a version tag
- The typed editors (V30) take a unit from a dropdown beside the box (`attachTyped`, unit tables `U_TEMP`, `U_B`, `U_E`,
  `U_LEN`, `U_TIME`, `U_ENERGY`, `U_LIGHT`); changing the unit converts the number; the box size has a width and a
  height field; the decay speed has no editor; the periodic label refreshes leave an open editor alone (`setTxt`), which
  was why the Motion box closed itself. The tool options' figures (radius, energy, temperature, field, wavelength or
  photon energy, intensity) are editors too (`toolTyped`, made with each build of the bar); a typed value is kept as typed
  (the slider's log position is not rounded to its steps).
- Closed walls now reflect everything that reaches them except light, neutrinos and the mesons of annihilations
  (`wallOrEscape`): α particles, protons, fast neutrons and electrons used to pass out through the walls as radiation;
  recoiling atoms still thermalise on the wall, antimatter still annihilates there; Open walls still let everything go.
- A small version tag beside the name (from the page's title).
- Save world… / Load world… (Lab → Sample, and the right-click menu) write and read the chamber as JSON (`worldToJSON`,
  `worldFromJSON`: box, bath, fields, pace, every nucleus, atom, ion and free lepton with its velocity, bonds, magnets;
  radiation in flight, beams, colliders and chips' circuits are not kept). Settings → Export… / Import… carry My molecules
  and saved isotopes between browsers and the desktop app (`libraryToJSON`, `libraryFromJSON`, merged by name). Saving
  uses the artifact page's `downloads` capability where it has one (declared at publish, beside `sample`), else a
  download link; loading is a file picker.
- Light always travels: the Light tool's Instant mode is gone, and the slow motion that lets light (and an event's
  products) be watched is reckoned against the speed as set, not the setup's normal speed — sped-up motion used to make
  light cross the box within a frame. Identify molecules is also in the right-click menu.
- The user's V31 benchmark at 20,000 atoms on 16 threads: 1.96 ms a step (V30: 3.00): forces 1.29 (kernels 0.30, wait
  0.15), bath 0.12 (was 1.04), integration 0.23, rest 0.28; 4.5 steps a frame on a 9 ms budget (was 3.5). The serial part
  of the forces (~0.85 ms: MD bookkeeping, grid build, reduction, candidates) is what is left for a session 4.

## V31: session 3 — the step on all threads
- Of a 3.0 ms step at 20,000 atoms on 16 threads (the user's V30 benchmark), the kernels took 0.29 ms; the bath 1.04 ms,
  the list rebuilds ~0.8 ms amortised (5 ms + 2 ms of exclusions every 9 steps) and the integration 0.3 ms ran on the
  main thread alone.
- The heat bath runs on all threads (`bathSlots`, order TH_BATH) in the plain case (no magnetic field, no heat tool;
  engine.js's `outerB` keeps the rest). Its noise is counter-based (`bathNoise`: murmur3's finaliser over (seed, step,
  slot), Box–Muller), so the result does not depend on how the slots are shared out: sixteen threads give the one-thread
  simulation to the bit (t_threads checks). `W.bathSeed` is fixed per world without drawing from `rnd`, so the seeded
  test worlds are unchanged (two energy-test worlds, chain and antihydrogen, are chaotic enough that a shifted random
  stream changes their drift: a fragility to look at some time).
- The neighbour list is built on all threads (`vlPairs` over ranges of the grid's occupied cells, order TH_VL): each
  thread writes its own stretch of the shared pair arrays, which are then closed up in cell order, so the list is the
  one-thread list pair for pair. The grid's arrays and `_mdI` live in shared memory for it (rebinding on growth); a
  stretch running out of room grows the arrays and falls back to one thread for that build.
- The exclusion marks come from arrays (`exclLists`: each slot's excluded ids, up to EXW = 24, made again only when
  bonding or species change) and are marked on all threads (`exRange`, order TH_EX); a slot with more exclusions (a
  lattice atom) sends the marking back to the Set path.
- A rebind race fixed: a bind posted while a worker was still inside its previous bind handler had its wake-up flag
  overwritten by the handler's own idle store, and the worker slept on a stale generation ("starting" for ever, one
  thread doing the work). The wanted generation is now in a control slot of its own, and the handler returns to the
  event loop when it differs from the one it just bound.
- On the 2-core test box, 12,000 atoms: 2.53 → 2.20 ms a step. On 16 threads the bath and the rebuilds should shrink
  about tenfold; what remains serial is the grid build (0.3 ms at 20k), the MD bookkeeping in `computeForces` and the
  event candidates.

## V30: precise paste, typed values, Identify molecules, the Claude API key, pions in flight, flash order
- Paste (Ctrl+V, the Paste button) picks the copy up: `armPaste` sets `UI.pasting` and a ghost (`R.ghost`, drawn in
  render.js) follows the pointer; the next click on the chamber pastes there (Shift keeps it for another), Escape or a
  change of tool puts it away. The right-click menu's "Paste here" still pastes at once.
- Typed values: the figures beside the sliders are buttons (`TYPED` in ui.js, `bindTyped`): a click turns them into an
  input; the text is read with its unit (`parseTyped`: K/°C/°F, T/mT/G, V/Å / V/nm, Å/nm/µm, fs/ps, eV…TeV, ×) and set
  through the same code the slider uses, clamped to the slider's range.
- Identify molecules (Sample section, design.js): `chamberKinds` groups the bonded molecules by name or SMILES
  (`smilesWrite`: bracket atoms with hydrogens folded in, ring closures numbered; every library molecule reads back),
  `moleculeName` names what the library or the formula table knows, the rest go to Claude as SMILES (`idPrompt`), names
  are tagged over the molecules (`R.molTags`, 12 s) and kinds the library lacks are saved to My molecules as placed
  (`idToLibrary`, with the radical flag from the engine's own valence count).
- The Claude API key (Settings): where the page has no Claude of its own (the desktop app, a saved copy), `apiSampler`
  stands in for the `sample` capability — a fetch to api.anthropic.com with the key, the browser-access header and the
  chosen model; its JSON is read out of the reply (code fences tolerated). Errors map to the same codes the page
  already explains, plus bad_key / bad_model / no_credit; an API error never hides the feature. The key lives in
  SET.apiKey in this browser's storage only.
- Pions, kaons and muons from an annihilation were born and gone within one step: a particle born in a step now flies
  from the next (`moveExos(dt, id0)`), `chooseDt` keeps a step under 4% of the box for anything in `W.exo`, slow motion's
  speed scan includes the exotics (and a second event while slowed also ends the frame and restarts the window), and
  the slow-motion floor is 1/50,000 instead of 1/5,000 so near-c products in a small box still take dozens of frames.
- Flash memory: the reading order of the cells is kept (`W.memOrder`) while they stay within 12 Å of where it was
  found; cells drifting with heat could swap places in the order between a write and a read, which read as bits
  flipping. The worst-frame badge's GC note (V29) remains the tool for the random stutters.

## V29: the grid in a huge box
- The user's 20,000-atom drop of water in a 20,000 × 14,000 Å box ran at 47–50 fps with 22–27 ms of simulation a frame and
  130 ms spikes, while the same atoms in a 723 × 465 Å box left room for 72 fps. Cause: the grid was an array over the
  whole box capped at 100,000 cells, so in that box the cells were 54 Å wide, every cell of the drop held ~170 atoms, and
  each neighbour-list rebuild compared ~45× more pairs (40 ms for 5,000 atoms; ~160 ms for 20,000).
- The grid is now a hash table of the occupied cells (`buildGrid`, `gridFind`, `gridHead`, `gridForward`, `gridWalk`):
  cells are the cutoff wide in any box (`CELL_KEYS = 2^28` is the only bound on their number), the table has twice as many
  slots as particles, and a cell pair is visited once from the lower key (works for periodic boxes, including ones a cell
  or two across, where neighbours repeat). A query covering more cells than are occupied walks the occupied cells
  instead. Rebuild steps in the reproduced world: 46 → 9–12 ms (grid + list 40 → 3.6 ms); small boxes unchanged.
- The worst-frame note in the fps badge adds "memory cleanup freed N MB" when the JavaScript heap shrank by megabytes in
  that frame (Chromium's `performance.memory`), to tell a garbage-collection pause from a stall elsewhere.

## V28: the benchmark under the user's settings
- `benchStart` runs the four worlds with the current settings (particle limit, drawing, physics budget, threads, kernel):
  a liquid of MAX_PARTS atoms of water, the same number put down with the Place tool, ionized water, the flash byte; each
  reports ms a step with the profile breakdown, list rebuilds a step, and about a second of real frames (adaptive budget
  and drawing) as "sim + draw ms, room for N fps".

## V27: WebGL layer and the adaptive frame budget (`src/gl.js`)
- The atoms (balls), their glows and the bonds are drawn with WebGL 2 on a canvas of its own (#cvgl) between two
  Canvas 2D canvases: #cvbg under it (background, grid, fields, box, tracks, chip packages) and #cv above it
  (everything else, transparent where nothing is drawn). The browser composites the three; nothing is copied back.
  Balls and glows are point sprites (gl_PointSize; the canvas reaches 64 px beyond the view so sprites whose centre is
  just outside still show), bonds four-vertex quads with a shared index buffer — not instancing, which software GL
  (SwiftShader, as in headless Chromium) runs at ~30 µs an instance. The ball's fragment shader evaluates Canvas 2D's
  radial gradient (the largest root of |P − C(t)| = r(t)), so the two renderings agree pixel for pixel but for edge
  anti-aliasing (`tests/t_gl.js`). An atom's colour is found once a frame per slot (`slotColor`). Labels, badges, the
  Bohr/orbital/nucleus views, antimatter halos and leptons in those views stay Canvas 2D on #cv; with the layer on,
  plain atoms too small for a label or badge are skipped by the 2D pass altogether.
- Settings → Drawing: WebGL / Canvas 2D (`SET.gl`); the Threads note says which is in use; the benchmark reports the
  drawing time of each world both ways. Without WebGL 2 everything is as before, on one canvas.
- The simulation's budget per frame is now adaptive: Settings' figure at most, less when the previous frames' drawing,
  panels and step length would not leave a 60 fps frame (`FRAME_AIM_MS`, `FP.budget`). The fps badge shows the smoothed
  sim and draw milliseconds a frame.
- Headless Chromium (software GL), JavaScript time of a frame's drawing: 12,000 atoms of water 98 → 9 ms, the page's
  frame 96 → 2 ms of drawing; the Flash byte 27 → 1.3 ms.

## V26: collider RF, frame diagnostics, Select tool
- Rings lost particles at full energy (D + T at 10 GeV, kept apart: deuterons and tritons thrown out one by one at
  0.98c). The ramp's voltage — 12% of the energy a turn, from one cavity in the two-ring layout — kept kicking the held
  bunch by a tenth of its energy; with dispersion at the cavities every kick also grows the betatron amplitude, until
  the aperture (±8 Å) is reached. Now: four RF cavities per ring (two-ring layout: after cells 2, 3, 6, 7; single ring:
  left, right and beside the upper separators), so each kick is a quarter the size, and at full energy the voltage comes
  down adiabatically (`holdVoltage`, RF_HOLD_*) to what makes a bucket 8% of the energy high. Energy swings during the
  ramp fall from ±10% to ±3%, at full energy to ±2%; no losses in any of the sweep's cases.
- The fps badge shows the worst frame of each half second with where its time went (sim, draw, panels, or a gap between
  frames: the browser, GC) when it is over 40 ms — for chasing stutters.
- Select tool (T): a box picks particles (whole molecules by default; Shift adds or toggles), the selection can be
  dragged, Ctrl+C / Ctrl+V copy and paste (with bonds, at the pointer, only where there is room), Delete, Ctrl+A;
  also in the right-click menu. `tests/t_select.js`.

## V24: collider fix
- Beam particles scattered in a ring's detector (same-charge beams: e⁻ on e⁻, p on p …) are stopped by the detector
  (`detectorStop`, `p.caught`) instead of flying out through the magnets to the wall, which lost whole bunches as soon as
  the beams were brought together. The RF's synchronous phase while ramping is 49° (`RF_S0 = 0.75`, was 30°): the same
  gain per turn with a gentler kick, which roughly halves the energy excursions of a bunch during the ramp.

## Loops
`computeForces`, `chooseDt`, `outerA`, `innerSteps`, `outerB`, `computeFast`, `innerDt`, `leptonExtras`, `listsStale`,
`localTemps`, `moveFastLeptons` and the per-step loops in `step()` run over slots and typed arrays. `rotateB` returns into a
scratch pair, `hasEfield`/`hasBfield` allocate nothing, the bond loop reads slots. The drawing keeps ball sprites per colour
and radius without string keys and strokes bonds in batches (one path per colour, width class and opacity step).

## Measuring
- `node tools/bench.js [scenario|all] [steps]` (Node, deterministic): ms per step for the three benchmark worlds.
- `node tools/bench-page.js [steps]` (headless Chromium): the same inside the real page, plus simulation and drawing time per frame.
- `node tools/bench-frozen.js [scenario]`: ms per call of computeForces / computeFast / chooseDt / outerB on one frozen state (for A/B comparisons of versions, which otherwise diverge chaotically within a few dozen steps).
- `VL.builds / VL.checks` and `FL.builds / FL.checks` count list rebuilds against validity checks.
- `node tests/t_threads.js`: the worker threads in headless Chromium behind a COOP/COEP server (determinism, equality with one
  thread, events, energy, the plain page's fallback, the in-app benchmark).

## Desktop app (`desktop/`)
Tauri 2 shell around `dist/atom-forge.html` (staged to `desktop/dist-app/index.html` by `tools/stage-app.js`), with the
isolation headers in `tauri.conf.json`. `.github/workflows/desktop.yml` builds the Windows `.msi` and NSIS `.exe` on
GitHub's Windows runners (push to `main`, or run by hand; a `v*` tag makes a release). Locally on Windows: install Rust
(rustup) and run `cd desktop && npm install && npm run build`; the installers land in
`desktop/src-tauri/target/release/bundle/`.
