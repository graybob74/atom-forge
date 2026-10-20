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

## 0.44.0: bugs found by a test sweep
Method (af-src/hunt): every setup run 300–400 frames in the page (exceptions, NaN, particles outside reflecting walls, frame spikes, save/load round trip); every tool with real mouse input on every setup; monkey tests (random clicks, sliders, junk in typed values, keys) in the plain page, the isolated (threaded) page, Canvas 2D, and a phone-sized dark screen; extreme cases (box squeezed to 20 Å, a billion K then 1 K, 50 V/Å, 10⁵ T, the Motion limits, wrap and open walls, 11,000 particles, a 30,000 K chip, uranium at 5 MK, antimatter in water). No exceptions or NaNs anywhere. Fixed:
- Save/load dropped particles in radiation flight (fission fragments, fast electrons): saved now with their energy (a tenth entry). Load clamped the electric field to ±3 V/Å and Motion to the slider's range (now ±50 V/Å and DT_MIN…1000 tu) and did not set the Lab's field figure (UI.E, UI.Eang).
- Turning the bath down on a hot plasma declared most of it radiation at once (radThreshold followed the bath setting), which the walls then stopped: 156 of 240 nuclei lost. radThreshold now uses _Tb, the bath temperature the matter has had time to follow (rises at once, falls at 2γ). (Tried and dropped: the matter's mean or median kinetic temperature — fission fragments in small boxes fed back into it, ISOLDE ran away to 1,700 particles.)
- A bond stretched far past where it holds (Si–H at 6 Å, 4× its rest length) could not break: removing it cost 6–18 eV of model energy (angle targets switched from four bonds to three; repulsion from atoms one bond away switched back on), so the H hung on by its angle terms and the break was re-tried, over the whole chip, every step (the melted-chip lag). Now, with a heat bath, a bond past min(2.5 r0, RC) breaks and the bath pays the shortfall (W.ledger.bath); without one, as before.
- Typed editors open in the unit their figure is shown in (the light tool's short wavelengths opened in MeV); the light tool's list has fm, pm, Å, nm, µm, mm and the energies.
- Neutrinos in "Made here" (emitNeutrino records ν / ν̄, count, energy carried off, first process); near-light speeds read with enough digits and their share of c (299,792 km/s no longer rounds to 300,000).
- Particle trails: trimmed to the last 0.5 / 1.5 / 4 s (Settings → Particle trails, default 0.5 s) of real time — the same whatever the speed — or of simulated time (Trails timed by); a long trail is thinned (every other point of its older half) instead of cut at 200 points, which had made trails shorter the faster the simulation ran.
- t_regress (page): all of the above, in about 35 s.

## 0.43.0: slow-motion button, units and limits, paste keeps working parts, cheaper stray electrons
- Hourglass: lit (dashed) while an event's slow motion runs (W.slow.on); pressed then it takes over (W.slowHold, W.slow cleared); pressed again, both off. Paused in slow motion, the Motion readout keeps "slow motion".
- Typed values: every metric prefix that fits (Motion ys…s, temperature µK…GK, fields µT…MT/G/kG and V/m…GV/m, lengths fm…mm, energies meV…PeV); values past a slider's end are kept (the slider sits at its end; tool ranges widened to physical bounds); past a real limit the nearest allowed value is set and a note (typedNote) says why.
- Copy/paste: chips whose atoms are all selected are copied with their state (v, nfg, drive, label, broken, nb0, q0) and wiring between copied gates; paste wires them up on the new atoms (chipAdd). Partly selected ones paste as plain atoms (said in the log).
- Collider "vanishing": e⁺e⁻ → γγ annihilation in flight (already flashed, carded, logged); light crosses the box within a frame.
- Inner steps: atoms beyond every free lepton's reach (not in _gxL) drift once by the time gone when anything needs them (lazyCatch: a pair-list check past the bound _lzD + _lzV·t, a rebuild, any non-lepton event or a lepton event that goes beyond the two particles — lzNeed in evLepton —, a force pass, the step's end). Rounding differs from per-step drifts only (t_physics: 0 Å after 25 steps in its worlds).
- Not done: capture by an ion in a chip over a neighbourhood — the charge spreads beyond two bonds in silicon, so it always fell back (reverted); a failing bond attempt against a chip still sums the chip (snapTogether moves both molecules).

## 0.42.0: walls stop fast charged particles; real-time speed; cheaper melted chips
- Walls (reflect): a charged particle in radiation flight (p.rad, past radThreshold: 1–2 keV or 30 kT) that reaches a wall is stopped in it and leaves the simulation, its energy counted as escaped and in W.count.wallStop ("Stopped in the walls", Data tab). Neutrons still bounce (the U-235 chain needs its fast neutrons back: 66 fissions as before; absorbing them gave 2–4). Since V32 every fast product bounced for ever: SNS, NIF, D–T and fission filled with beam protons, alphas and keV electrons (SNS: 1,110 particles after 400 frames, now 72, and 3.5× the simulated time).
- Tracks end where the path meets the wall (wallCross; extendTrack ran before the fold, so a 1 GeV proton's track jumped up to 1,000 Å outside the box).
- simFrame keeps to real time: W.simPerFrame per 1/60 s, a frame advances by realDt·60 of it (clamped 0.1–3); the Motion readout says "per 1/60 s". t_physics checks 60/120/30 Hz and a stall.
- Free-electron inner steps: kicks and computeFast's clearing visit only the slots whose fast force can be non-zero (_gxL: leptons, pair-list atoms, charged), and the pair list's check comes from the move loop (bit for bit: t_physics, _gxUse).
- Bond-break attempts in big molecules (> LOCAL_MOL) take the energy over the two atoms' two-bond neighbourhood with a fingerprint fallback (breakCost; t_chips: 0.0 eV from the whole-chip sum). A melted chip's strained spot made two such attempts a step at ~1.5 ms each.
- Left: a failing bond attempt in a big molecule still sums the whole chip (snapTogether moves both molecules, so the shortcut does not apply exactly); each free electron still moves every atom on each inner step.

## 0.41.0: the force pass's clearing and list check moved into the threaded integrator
- integrateSlots, having used each slot's forces for the half-kick, clears fx, fy, gx, gy and nearIon over its slot range, and returns the largest squared move of the neighbour list's atoms from where the list saw them (per-slot copies: S.vlx/vly, marked by S.vlin, written by vlBuild). integrateA hands both to the force pass that follows at once (_intTok, taken by computeForces1): its fills are skipped and vlValid uses the move instead of its own loop. Nothing moves or writes forces between the two.
- Exact: t_threads runs 120 steps of a seeded world with and without (_intUse) and compares bit for bit.
- Versions are now numbered 0.40.0, 0.41.0 … (title and tag).

## V40: workers' force buffers cleared and summed only where they were written
- Each worker's share of the pairs (a stretch of the list, which runs cell by cell) and of the bonds and angles touches a narrow band of slots: about 8–10% of them each with 16 threads in a 20k water world. bufSpans finds the band (two intervals: pairs; bonds and angles) as the worker starts; bufZero clears last pass's intervals (a buffer bound afresh is cleared whole once); bufSum adds the buffers onto the store's forces in buffer order within their intervals only — on the workers and the main thread, in JavaScript (af_sum is no longer used).
- Exact: a buffer is zero outside its intervals (t_threads checks every slot of every buffer), so the sums are the full sums value for value (adding 0 is skipped). Two threads twice: identical to the bit.
- Before: every worker cleared its whole buffer and the sum read 15 buffers × every slot, almost all zeros, across both of the CPU's core groups.
- Also V40: molecules Claude designs or identifies are filed under their library category (Claude's choice, or molCatGuess from the atoms); the user's own builds stay in My molecules; all of them stay the user's (mine: kept, exported, removable).

## V39: three more single-thread loops made cheap, exactly
- Soft walls: the push past the walls moved out of computeForces into its own small function (softWalls), position test first. In the long force-pass body V8 ran the 20k-atom loop about 3× slower; "after" was almost all this loop (page, 2 cores: 0.18 → 0.06 ms a step).
- Housekeeping: the track recount only while tracks may exist (_trkN > 0); the bond-order loop only when a read-only scan (bondsCanRise) finds a bond that could rise — the loop changes nothing before it finds one, so skipping it when there is none is exact; the stabilize scan on the store's arrays.
- Local temperature in the store (S.tLocal, Float64), localTemps on typed arrays (same arithmetic).
- Workers clear their force buffers only up to S.hi (the sum reads no further) instead of the arrays' whole capacity (32,768 slots for 20,000).

## V38: the step's single-thread passes skipped when idle; the benchmark's "rest" named
- The benchmark splits "rest" into start, outer, events, neutrons, walls, exotics, housekeeping, drop (the largest shown), gives chooseDt its own "timestep" figure (it used to be added to integration while left out of the step's total), and shows the list-validity check inside "lists".
- Neutron/light pass: skipped when the last walls pass counted none and no particle was made (W.nextId), no flag changed (_flagGen) and no charge number or kind changed (_zGen, new: the Z and k setters count) since.
- Walls pass: the bath pass (threaded bathSlots, or the one-thread loop in the plain case) counts the particles it would have to look at — anything but an atom inside the box at an atom's pace; when none, no neutron or light, no track (_trkN: startTrack counts up, housekeeping recounts), nothing moved, made or changed since, no exotics, no collider, walls still, it is skipped. Exact: t_physics runs water, soup and flame bit for bit the same with `_skipOk` false; t_threads checks the threaded count equals the one-thread count.
- 2-core box, 20k water: rest 0.54 → 0.13 ms a step. Hot worlds (atoms over V_FAST_ON) still run the pass.

## V37: Priority, smooth ↔ fast
- Settings → Priority, five steps: the frame rate the budget aims for, 60/50/40/30/20 fps (`PRIO_FPS`, `frameAim()`).
- Past the smooth end the physics may take what that longer frame leaves (`frameCap`), beyond Physics per frame; frames stretch only while the simulation is behind its set speed, since a frame ends once it has done its share.
- Smooth is exactly the old behaviour. The benchmark uses the same aim and names it in its line.

## V36: the free leptons' forces in WebAssembly, chooseDt on the threads, threaded phases measured
- `af_fast` (kernel/src/lib.rs): computeFast's three loops — lepton–atom pairs, lepton–lepton pairs, the exact Coulomb
  pull of net charges beyond the cutoff — in the same arithmetic order as the JavaScript, writing the fast forces,
  near-ion flags and hit marks, and candidates (EV.LEPTON, EV.ANNIH) in loop order, which JavaScript queues. Its own
  offset table (an older module has no af_fast: the JavaScript runs). The lists it reads (FL.la/lb/li/lj, _mdLI, _chI)
  live in the module's memory. t_wasm: bit for bit the JavaScript's forces, flags and events in ionized water,
  antihydrogen and the soup. A computeFast call in ionized water: 73 → 41 µs (the kernel 36, half of it the
  long-range sum); the ionized-water step in the page 8.4 → 5.7 ms.
- Found, not fixed: each inner (lepton) step loops over every atom in MD — two kicks, the drift, the list's validity
  check — so a big world with even a few free electrons pays ~50 × N atom updates a step. Exact fix: kick only the
  atoms near leptons (the only ones with fast forces), drift the rest lazily with a catch-up before events and list
  checks, and bound the list's validity by the slowest-moving atoms' speed. Not needed for neutral liquids.
- chooseDt's maxima (speed, acceleration of atoms in MD, speed of fast nuclei) are taken on all threads (`dtSlots`,
  TH_DT): a maximum is the same however the slots are shared out.
- The benchmark line shows each threaded phase as main thread's own share / wait for the workers (TH_PH): on the
  2-core test box the waits are as long as the shares or longer — the workers share two cores with the browser — so
  the next step needs the line from a 16-thread machine.

## V35: the bath's noise, kept force lists, a stall when ions cross a chip, steadier tests
- The heat bath's normals come from a fixed table of 65,536 (made once, the same in every thread, centred and scaled to
  unit variance exactly), picked by the slot hash (`bathTableMake`, `bathNoise`): the noise went from about 1.1 ms to
  0.03 ms per 20,000 atoms, and the bath from 1.5 to 0.9 ms single-threaded in the page; mean, variance (1.001), kurtosis
  (2.99), x–y and step-to-step correlation all as for true normals. Threads still give the one-thread result to the bit.
- The force pass keeps its particle lists (MD set, leptons, charged, fast nuclei) from the last pass when nothing that
  defines them changed (W.spawned, W.deaths, W.dirty, W.topo, _flagGen, the particle count, no field on fast particles)
  and clears the force arrays with one fill each (`_clsOk`, `_clsKey`…): in the page at 20,000 atoms the force pass's
  own cost halved (2.5 → 1.2 ms on the test box). t_physics runs a flame and the soup (charge transfers, recombination,
  new bonds, reactions) for 1,500 steps with and without the kept lists: bit for bit the same.
- A heavy ion through a chip stalled the page for seconds: each electron it knocked out summed the energy of the whole
  chip (a thousand bonded atoms) twice, and `closeSet` walked the whole chip once per atom in it. `closeSet` now walks
  each molecule once, and `localDelta` sums an ionization's energy change over the ion and what lies within two bonds of
  it in molecules over 150 atoms (exact: the sum covers every term with a changed atom; when anything further away
  changed, the change is undone from the snapshot and redone over the whole molecule — about one ionization in five).
  Local and whole-molecule sums agree to 1e-11 eV on the same change. A 100 MeV iron nucleus through an SRAM cell: 1.7 s
  → about 0.3 s a step for the few frames after. Still whole-molecule: `enforceValence`'s reconciliation and electron
  recapture (about 150 sums of 5 ms over those frames) — a next step if heavy ions in chips matter.
- Tests: t_chips waits for the cell's verdict on an upset (it comes after 10 ps of chip time, some thirty frames, more
  on a loaded machine) instead of a fixed 40 frames — the flake of the last releases. t_energy judges the fission chain
  by the median of three seeds when the first is over its limit, and antihydrogen's limit is 15 eV: its drift ranges
  −3 to +10 eV across seeds with no annihilation at all, which wants a look at the light leptons' integration.

## V34: the kernels without shared memory
- A page that is not cross-origin isolated (the artifact on claude.ai) has no SharedArrayBuffer: no worker threads, and
  until now no WebAssembly kernel either, since the module was built for a shared memory. The kernel is now built twice
  (.github/workflows/wasm.yml): `kernel.wasm` as before and `kernel-plain.wasm` without atomics or shared memory, embedded
  as KERNEL_PLAIN_WASM_B64. Without shared memory, wasm.js instantiates the plain module on an ordinary
  WebAssembly.Memory made its full size at once (WK.PLAIN_PAGES = 2048 pages, 128 MB; 12,000 atoms use 17.5 MB), because
  an ordinary memory cannot grow without detaching every view of it. Should the arena ever fill, `wasmArray` hands the new
  array out as a plain typed array and gives the kernels up for the rest of the session (WK.on/ready/use false: the
  JavaScript kernels take over; every view already made stays valid). t_wasm checks the plain build gives the shared
  build's forces to the bit and that a filled arena hands over cleanly; t_threads checks a plain page runs it.
- The single-thread 20,000-atom step in the artifact (user's V33 line: 3.67 ms, kernels 1.23 in JavaScript) should drop
  by roughly half a millisecond; the bath (1.0 ms single-threaded) is the next item there.

## V33: session 4 — drawing from the store, the grid on demand
- The WebGL layer draws the atoms and bonds from slot textures (gl.js `GL_T`): each frame the store's x/y arrays are
  copied into an RG32F texture (one `texSubImage2D`), and the balls are one `drawArrays(POINTS, 0, S.hi)` whose vertex
  shader fetches position, colour and style (radius in Å, smallest and largest pixel radius) by `gl_VertexID`; dead
  slots, leptons and bare nuclei carry alpha 0 and atoms that would be 30 px or more leave the layer for the Bohr picture
  as before. Colours and styles are refilled only when a count changed (and every eighth frame, since an ion forming
  changes a radius without any count changing) — per frame when the colour follows charge or heat. The bonds are a
  static vertex buffer (`glBondsBuild`, rebuilt when W.topo changes: two slots, half, corner, lane, rest length per
  vertex) whose vertex shader fetches both ends and the half's atom colour from the textures; each half is capped round
  at its atom and cut flat at the middle. Free leptons and their glows still go by item (few). At 20,000 atoms the
  drawing's JavaScript fell from ~7.3 to ~2.3 ms on the 2-core test box (SwiftShader doing the GPU's work); on a GPU the
  remaining cost is the three O(N) scans of the 2D pass. t_gl compares the frames with Canvas 2D pixel for pixel, now
  also in heat colouring and zoomed in.
- The grid is built on demand (`gridEnsure`, `gridTouch`): only a neighbour-list rebuild, a search near a point or along
  a line, the lepton list or far-metal pairs ask for it, so most steps build none (3 builds in 90 steps of liquid water;
  0.34 → 0.05 ms a step single-threaded at 20k). Everything that used `G.n` as "is there a grid" now asks `_nmd`.
- The benchmark line splits the forces further: bookkeeping (the MD classification), grid, lists (validity, rebuilds,
  exclusions) and after (walls, fields, tools).
- Workers spin 2.5 ms (was 1) before sleeping on their word: within a frame the steps come every couple of
  milliseconds, and a sleeping worker costs tens of microseconds to wake at each of the four barriers of a step.
- Left: the classification loop (~0.4 ms single-threaded at 20k: eight typed-array writes a particle), the per-step
  validity scan of the list, and the O(N) scans in the rest of the step.

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
