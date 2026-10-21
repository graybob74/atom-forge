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

## 0.53.0: display settings, as in a game
- Settings → Display: Window (Windowed / Borderless full screen, F11; the desktop app keeps the choice for its next start: a borderless window over its monitor, not exclusive, so Alt+Tab, the Windows key and other monitors work as usual; a browser uses its own full screen, which a frame may refuse); Chamber only (B, the header button; Esc leaves): no toolbar or panels; Hide the resting cursor: Never / Chamber only / Always (over the chamber only).
- The three are independent (0.52's display mode did all three at once). ui.js: setWindowMode, setChamberOnly, dmPoke; SET.win, SET.cursor.
- t_features: the cursor setting's Always and Never hold; Settings has the window choice.

## 0.52.0: display mode; quarks pulled out for real; fixes
- Display mode (B, F11, or the header button; Esc, B or F11 to leave): the chamber alone, edge to edge; the cursor hides after 2 s at rest and comes back on any move, with a small button to leave that fades in with it. The desktop app also goes borderless full screen (Tauri setFullscreen; tauri.conf withGlobalTauri, capability core:window:allow-set-fullscreen); a browser asks for full screen and, where a frame forbids it, the chamber fills the page. Keys and tools work as before.
- Pulling a quark out (Inspect tab) now happens in the chamber (hep.js quarkRip): the string snaps with 0.9 GeV put in by the hand; the meson flies off, the hadron left takes the new quark. A nucleon in a nucleus changes in place, the nucleus left with up to 15 MeV of hole excitation it sheds (Fermi break-up, evaporation, γ); a hyperon flies off; a Δ goes at once to a nucleon and a pion; a pion, kaon or hyperon in flight splits in two. Exact masses and momenta; books close exactly (the 900 MeV added like the Spark tool's energy). New species for it: Σ⁺, Σ⁻, Ξ⁰, Ξ⁻, Ω⁻ and their antiparticles, with their real masses, lives and decays.
- A lone nucleon (a bare proton, H⁺) was drawn 0.65 of its radius off its place (nucleusBeads' spiral started off-centre); now centred.
- The Inspect panel no longer creeps up when scrolled to the bottom: the quark card's note was filled a frame after each refresh, so every refresh came out shorter and clamped the view; it is now in the HTML, and a clamped restore is retried next frame.
- The Quantum solver card stays collapsed when collapsed (it reopened on every refresh once solved).
- Zoom goes to 4,000 px/Å (was 400): about 0.25 Å across the view, inside one atom.
- t_features: 52 quark pulls (nucleons, nuclei, antiprotons, hyperons) with charge, baryon number and energy exact; the lone proton centred; display mode fills the window and hides the cursor at rest. The share-code check allows an atom a hair past a soft wall to come back on it.

## 0.51.0: strings (jets), the quark–gluon plasma, muons in matter; energies to 1 PeV
- String model (hep.js jetMomenta): in e⁺e⁻ annihilation above √s = 2.5 GeV the hadrons (still chosen by hadronize) come out as two back-to-back jets at 1 + cos²θ to the beams; in nucleon–nucleon collisions above √s = 5 GeV, and in nuclear fireballs above 2 GeV per participant, along the beams with the baryons leading. Hadrons sit in rank order on a rapidity plateau with ~0.35 GeV transverse momentum; the plateau's width is solved from the energy, then momenta are balanced and scaled so that total momentum is zero and the energy is exactly M (checked to 10⁻¹⁵). A breaking string is drawn for about a second (W.strings).
- Quark–gluon plasma (qgpHadrons): when the participants' fireball has ≥ 3 GeV per nucleon of motion (√s_NN ≳ 7.9 GeV, about where experiments first see it) and ≥ 30 participants, it freezes out at T = 156 MeV: mostly pions, ~13% in kaon pairs, ~3% η, Λ with a kaon in ~12% of baryons, antibaryon pairs suppressed by e^(−μ_B/T) with μ_B = 1.31 GeV/(1 + 0.273 √s_NN/GeV) (Cleymans), baryon number and charge conserved exactly; the number from the energy with a Landau rapidity width (σ² = ln(√s_NN/2m_p)); thermal transverse momenta with flow. Central Au+Au at 17 GeV gives ~1,900 hadrons, at 200 GeV ~1,500–7,000 by centrality (the real figures are ~2,400 and ~7,500 for central). Beyond the chamber's limits (1,500 unstable particles, the particle limit) the rest leave with their energy counted. Drawn as a swelling, cooling drop with quarks and gluons milling inside (W.qgp), caption "quark–gluon plasma: N nucleons melted at √s_NN = …, froze out into M hadrons".
- Energies: the Fire tool to 1 PeV (was 200 MeV), the collider's beam energy to 1 PeV (was 10 GeV; a lead ion at the LHC carries 574 TeV); fmtE shows PeV. The collider panel says when jets and a plasma form, and offers the beam energy for a plasma (3 GeV per nucleon each). Its pion threshold for nuclei now uses the energy per nucleon pair (it mixed per-nucleon energies with whole-nucleus masses).
- New setup: Gold on gold: quark–gluon plasma (RHIC, 100 GeV per nucleon). Narrator captions for the plasma, strings and jets.
- Muons in matter (hep.js): a charged unstable particle in flight (muon, pion, kaon) now ionizes the atoms it passes with the same Bethe-like loss fast nuclei and electrons have (exoIonize), so it slows. A μ⁻ below 2 keV is caught by the nearest atom within 4 Å: on hydrogen it becomes muonic hydrogen (μp, μd, μt: new neutral XP species, mass less the 2.5–2.7 keV binding, which leaves as X-rays; the atom's electron goes free); on anything heavier it stays bound (atom.muB; 1s binding 2.53 keV·Z² eased for the nucleus's size: 0.80 MeV in argon, 10.5 MeV in lead), and on the nuclear clock decays in orbit (2.2 µs) or is captured by the nucleus, μ⁻ + p → n + ν at 32·Z_eff⁴ per second (carbon mostly decays, iron and lead mostly capture), the nucleus one charge down, 8–20 MeV hot, boiling off neutrons.
- Muon-catalysed fusion: muonic hydrogen moves its muon to a heavier isotope it meets within 2.5 Å (μp → μd at 1.5×10¹⁰/s, μd → μt at 2.8×10⁸/s, rates for liquid hydrogen), and dμt fuses (10⁸/s) into ⁴He + n + 17.6 MeV; dμd (³He + n or t + p, 5×10⁶/s) and tμt (⁴He + 2n, 2×10⁶/s) more slowly. The muon is set free (sticking to the α 0.85% of the time, to ³He 12%, ending its chain as (μα)⁺) to be caught again; the log counts each muon's fusions. Simplifications, said in the code and setup: the freed muon leaves with ~1 keV rather than ~10 keV (in real liquid D–T it slows within a micrometre, far beyond the chamber); a slow μ⁻ or muonic atom reaching a reflecting wall stays in; the electrons of a heavier muonic atom still see the whole nuclear charge.
- Every muon event's books close exactly (exoEvent, closeEvent; checked: 0.0000 eV for capture, transfer, fusion, decay in orbit and nuclear capture). The Fire tool fires μ⁻; new setup Muon-catalysed fusion (cold D₂ + T₂ at 30 K, decay sped ×30,000: ~8–10 fusions per muon in a minute or two).
- Collider slider: 1,000 steps over 20 keV–1 PeV.
- t_features: kinematics, a 10 GeV e⁺e⁻ jet, gold-on-gold plasma, the 1 PeV reach; a muon slowing and caught in argon, a catalysed chain with exact books. t_energy skips the gold-on-gold setup (its injectors add energy) and allows the muon setup 10 eV. t_page sets the collider to 14 MeV explicitly for its threshold-button check.

## 0.50.0: inside a hadron (Inspect tab)
- Inspecting a proton, a neutron, any atom or nucleus (one of its nucleons; A proton / A neutron to choose), an antinucleon, or a pion, kaon, η or Λ in flight shows its quarks and gluons: valence quarks (u, d, s and antiquarks) with their charges, jiggling in a bag about 1.7 fm across; colour charges (red, green, blue; anticolours for antiquarks) swapped by gluons travelling between them, so the whole stays colourless; flux tubes (a Y for a baryon, a line for a meson); virtual quark–antiquark pairs flickering in the sea. The note gives the content, the charges adding up, and that ~99% of a proton's mass is field and motion energy. Leptons (muons, τ) say they have no parts.
- Drag a quark out: the tube stretches (the string's energy shown at ≈ 0.9 GeV per fm) until about 1.35 fm, then snaps: its energy makes a u ū, d d̄ or (12%) s s̄ pair; the pulled quark leaves with the new antiquark as a meson and the new quark stays — pull a u out of a proton and a π⁺ flies off and a neutron is left. Put it back resets it.
- It is a picture: the simulation does not model quarks and nothing in the world changes (QV in ui.js). The leftover drawing branch for "pion streaks" (r.pion, never set) is gone.
- t_features: a proton's u u d, pulling a u out gives a pion and leaves u d d, put back, a muon has no quarks.

## 0.49.0: Inspect picks photons, neutrinos and unstable particles in flight
- The Inspect tool picks, after any atom or electron under the cursor, the nearest photon (Light tool photons in flight, W.flights; any other light, W.rays, while it is still travelling), neutrino (W.rays, nu) or unstable particle (W.exo: muons, pions, kaons, η, Λ, τ) within 12 px of where it is now (pickLight, lightHead). R.selX holds it; a ring follows it while it flies.
- Its card: a photon's energy, wavelength, frequency, momentum, the element whose line it is, and what it is heading for (rays now keep hitP, the species they will meet); a neutrino's energy, flavour (electron for β decays, captures and fusion; otherwise just "neutrino"), speed (c to within m²/2E² for m < 0.8 eV) and what made it (rays keep anti and how); an unstable particle's charge, mass, quarks, kinetic and total energy, speed, γ, mean life at rest and moving (γτ), mean distance before decaying (βγcτ), decay modes with branching ratios, and when it is gone whether it decayed (into what) or left the chamber (o.fate). Bookkeeping only.
- t_features: a pion, a muon, a photon and a neutrino picked and described.

## 0.48.0: light in flight follows the speed and slow motion
- Before, while the Light tool's photons were in flight time slowed so that light crossed the box in about 70 frames whatever the speed or slow motion was set to: at 1/64× in slow motion it looked the same as at 1×. Now lightSlow is taken against the setup's normal speed and multiplied by any slow motion (slowFactor), so the speed buttons and the hourglass scale light as they scale everything: about 70 frames to cross at 1×, 18 at 4×, 280 at ¼×, ~500 in slow motion. It is still exactly c on the simulation's clock. t_features checks it: 95 frames at 1×, 24 at 4×, 377 at ¼×, 753 in slow motion (the empty chamber, 25 ms frames), at c each time.
- To let it go that slow, while light is in flight a frame's step may be shorter than the usual shortest step (DT_MIN, 0.2 fs ⇒ now down to 10⁻⁹ tu). A shorter step only integrates the same forces more finely; at other times nothing changes.

## 0.47.0: Ask Claude for a setup, challenges, wiring, chain-reaction k, gallery, lasers, slow bath changes, cloud chamber, narrator, wall pressure
- Ask Claude for a setup (✦ beside the setup list, where Claude is connected): a description in, a JSON recipe out — box, walls, temperature, bath, fields, glowing walls, and items: library molecules by key (the whole library is in the prompt), elements and ions (charge, isotope), particles, small lattices (designLattice), ready-made objects, projectiles fired in from a side. askBuild checks it first (keys, symbols, at most 2,500 atoms and particles) and sends one follow-up with what was wrong; the setup becomes "✦ <name>" in a Claude group of the setup list, so Restart rebuilds it.
- Challenges (a new group in the setup list): Make water, Make salt, Make a plasma, Fuse deuterium, Split uranium, Make antihydrogen, Ultraviolet glow, Build a clock, Flip a bit, Write a letter, Melt a chip. Each has a goal and a hint at how; checked with the readouts; done ones get a ✓ (kept in this browser).
- Wiring (Lab → Chips): each NOT gate has "Input wired to" any gate's output (its own included); unlabelled gates are named Gate 1, 2 … when wired. Three wired in a loop oscillate, as the ring-oscillator setup does.
- Chain reaction (Data tab, once neutrons have ended): k = neutrons born per neutron ended over the last 300 ends (kill → kEnd: fission with its ν, capture, escape through open walls, other), ± its standard error, supercritical / about critical / subcritical, where they went (bar), the generation reached, fissile nuclei left, and a tip. Bookkeeping only; in fission() the ν draw now comes before the two kill() calls, which use no random numbers, so the sequence is unchanged.
- Gallery (Lab → Sample): worlds kept in this browser's storage as share codes with a 240 px picture (at most 40); Open, Delete; storage that is full or off is said so.
- Lasers: the Light tool's Mode "Leave on (laser)" sets a source down where you aim (at most 12): it shines at its wavelength and intensity until erased (Erase tool, Remove beam sources, or the tool's Turn off). Bug fixed: the Light tool's presets were a few nm off their lines (the "Na 589 nm" preset gave 593 nm and missed sodium's resonance); now 589, 121.6 and 10,000 nm exactly, and the default is 589 nm. With it, sodium vapour scatters a 589 nm laser (resonance fluorescence).
- Slow bath changes (Lab → Heat bath): "Change slowly to … over …": the bath moves evenly on a log scale over the seconds of running; moving the slider stops it. New setup: Growing a crystal (liquid argon at 160 K cooled to 40 K over a minute, in a wrapping box; its order ψ₆ goes from 0.02 to 0.85).
- Cloud chamber (Real labs): open walls, 100,000 T out of the screen, sources of 5.5 MeV α particles, and 60 keV electrons and positrons; Motion 4 attoseconds a frame so a near-light electron crosses in about a second. W.cloud draws each charged track as droplets (cloudTrack: thicker and denser for an α, deterministic scatter so they do not flicker), lingering 3 s; neutral tracks leave none.
- Narrator (Data → Explain → Narrate events as they happen, off by default): a caption under the chamber for notable events in the log (fission, fusion, captures, α/β decays, pair production, annihilation, decay in flight, photoelectric effect, impact/thermal/field ionization, recombination, ionic bonds, reactions with exo/endothermic, bonds, photodissociation, bit flips), the most important of the last 120 entries first, each shown ≥ 5 s, the same kind not again within 12 s.
- Wall pressure (Data tab tiles, reflecting walls): the walls' push (softWalls now sums its force, read only) in 0.5 ps blocks, averaged since the box, walls, bath or number of free movers last changed, as N/m (2-D pressure is force per length), and Z = P / (n k T) over the free movers (molecules and unbonded atoms) with its standard error ("averaging …" until it is within ±0.15). Argon gas at 300 K: Z ≈ 1.
- Not done, and why: a phase diagram (the 2-D model's freezing and boiling points are not water's or argon's, so a real-world diagram would mislead); the radiation-hardening game (shielding a few nanometres thick cannot stop MeV particles, so placing shields would not work as a game; real hardening is done in the circuit design); electrochemistry (electrodes that take and give electrons under a voltage would be a change to the chemistry — I did not want to make that unasked).
- Bugs fixed on the way: the Cloud chamber first switched off slow motion for events and it stayed off in every setup after it (found by t_page); glowing walls' photons had a label each, which buried the view.
- Tests: t_chips's radiation check flaked again under load (passes alone); t_features waits for enough neutrons and fissions rather than a fixed number of frames, and measures pressure at 1,000 K, where argon cannot form droplets.
- Decisions made while you were away: Ask Claude builds only from the library (no new molecules from SMILES in a setup — Molecules… → Ask Claude does that); challenges live in the setup list rather than a new panel; wiring is in the Lab panel rather than a new canvas tool; the crystal setup has no seed (a seed in the melt melted).
- t_features: all of the above.

## 0.46.0: share codes, Explain, glowing walls, video
- Share code… (Lab → Sample): the saved world (worldToJSON, without its title and date) deflated (CompressionStream 'deflate-raw') and base64url'd after "AF1:" — water is about 7 KB of text, the flash byte 67 KB. Copy, and Open (replaces the world) in the same dialog; damaged or foreign codes are refused with a reason. A page opened with #AF1:… after its address loads that world. Chips go as plain atoms, as in a saved file. (A link to the claude.ai page itself cannot carry a world: the page cannot see the address it was opened from, so it is a code to paste.)
- Explain (Data tab, top): with Claude (claude.ai's sample capability the page already has, or an API key in Settings), a ~160-word plain-language explanation of what the chamber is doing, streamed, from a digest of what the panels show (setup and its notes, box, bath, fields, motion, temperature, species, Made here, counts, spectrum, chips, the last 15 events, and the selected particle's inspector text). Without Claude: the setup's own notes and the latest events. apiSampler is now callable like claude.ai's sample (text), with .json as before.
- Glowing walls (Lab → Heat bath, off by default): reflecting walls at the bath temperature give off black-body light into the box (glowTick, per frame of watching): photon energies from Planck's law (planckX: k ∝ 1/k³, then Gamma(3)/k; mean 2.701 kT), Lambert directions, a show rate of 150 photons/s per 400 Å of rim at 5,800 K going as T⁴ (at most 600/s; real thermal light at the atoms' pace would be ~10⁻⁹ of that). Each photon meets atoms as any light does (rayInteract: photoionization, resonant scattering, dissociation …); what is absorbed the bath pays (ledger.bath). The walls are drawn in the black body's colour above 700 K. Saved with the world. New setup: Glowing oven (Electrons & light).
- Spectrum: the walls' light marked as theirs, with Planck's curve dashed over the bars and Wien's peak in the note; wider bins when thermal light dominates. Clear now keeps counting from that moment (button turns into "Last 10 s" to go back).
- Record video (Lab → Sample): the chamber's three canvases composited at up to 1280 px wide, one frame per 1/30 s of watching × the speed-up (real time, 4×, 16×) while running, kept as JPEGs (at most 3,600 = 2 minutes of video); on Stop they are played once through a MediaRecorder at 30 fps (WebM VP9/VP8, or MP4 where that is what the browser makes) and saved through the same path as world files. A red REC badge shows the length.
- Decisions made while you were away: share is a code rather than a link (see above); Explain uses the default model tier and never caches (the state changes); glowing walls are a show rate, said so in the checkbox's tooltip; video recording skips frames while paused.
- t_features: share round trip exact, junk refused; Explain's fallback and its question; Planck sampling and the oven's wall light at 2.7 kT, off by default, saved, none with periodic walls; a 4× video made.

## 0.45.0: spectroscope and logic analyser
- Spectroscope (Data tab → Spectrum, shown once any light has been made): emitPhoton records every photon's wavelength, real time and source element in W.spec (a ring of 8,192; specRecord). The chart counts the last 10 s of watching (or since Clear): Visible (380–780 nm over its colours, with dashed markers for the known lines of the four elements that gave off the most light, and hydrogen's Balmer lines) or Everything (γ to far infrared, log scale). Read-only: nothing in the physics changes.
- Logic analyser (Lab tab, under Chips): each transistor, gate and SRAM cell's signals sampled in chip time (W.chipT, shared so traces line up; at most one sample per 0.05 ps, the last 4,096 kept; scopeSample in chips.js, read-only). Lanes: transistor G/D, gate IN/OUT (an input wired to another gate's output is not repeated), SRAM WL/Q/¬Q; up to 12 lanes. Views: Voltage or Logic (1 above 60 % of the supply, 0 below 40 %, in between shaded as undecided); 20/50/200 ps; Hold freezes it. The note gives each ring's period and frequency. Flash cells are left out (their own time scale, and the memory panel shows them).
- Decisions made while you were away: Spectrum counts real seconds of watching (so a slow-motion event does not swamp it); the line markers show only elements that actually made light; the analyser leaves flash cells out.
- t_features (new page suite, lane A): neon's visible light all falls on neon's lines, Clear empties the chart, a new world hides it; the analyser's trace of a ring oscillator gives the same period (within 10 %) as the gates measure.

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
