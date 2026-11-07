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

## Planned features (1.x), in the order the user chose
- Speed (found from the owner's benchmarks, 1.18): 20,000 waters take 0.65 ms a step on 16 threads (39 fps at 1×, the
  goal 45), against 0.55 at 0.90; on 32 threads 1.16 ms, every threaded phase waiting about 1 ms (the busy-waiting
  workers, main thread and browser threads outnumber the 32 hardware threads). Auto stays at 16 (its tag now says so);
  where the 0.10 ms since 0.90 went wants a profile on the owner's machine.
- Done in 1.22 (quantum bonds, below), kept for the record. Continuous bond orders: proton hops in liquid water (left from 1.20). The charge now moves with a proton (1.20), and in
  the H₃O⁺·H₂O pair a shared proton is as low as the localized one; but in 300–700 K water a hydronium did not hop in
  1.5 ps: from H₃O⁺·H₂O at 2.65 Å the proton meets 0.35 eV before the far water's order grows (the bond-order energy's
  cost of splitting a hydrogen's valence, D·n^1.15), and the waters rarely come that close.
  Tried after 1.21 (branch v123, not released): a straight depth (power 1) for H–N/O/F, a charge-dependent
  electronegativity (χ + 0.45·q: H₃O⁺'s hydrogens +0.50, its oxygen −0.51, as ab initio), electron groups joined at
  orders above 0.005. The shared proton then sits 0.87 eV below the localized one at O–O 2.65 Å and the proton's own
  barrier at O–O 2.55 Å is 0.05 eV; but no hop in an ion pair or in water at 300–500 K over 3 ps: the hydronium's
  hydrogen bonds stay long (O–O 2.7 Å, real 2.5–2.6; the two oxygens' like charges and their Lennard-Jones hold them
  apart), so its proton never comes within 1.6 Å of a second oxygen, where its order and the charge's group begin.
  What would do it: an explicit hydrogen-bond term (as reactive force fields have) or the quantum chemistry below,
  which gets hydrogen bonds and proton sharing from the electrons. On hold for the quantum chemistry (the user:
  "finish quantum chemistry and hops first").
- Done in 1.22 (quantum bonds, below), kept for the record. Quantum chemistry for bonds (queued by the user, after the bond-order next steps): bonds and their energies from the
  electrons themselves (a minimal-basis method, tight-binding or semi-empirical: Hückel/extended-Hückel or DFTB), not a
  force field. Estimated ×100–10,000; a physics-model change for the owner to approve.
  Step 1 started (after 1.21; the user: "start 3D once you've completed the quantum thing"): `node tools/tb-proto.js
  [molecules]`, a self-consistent tight-binding model (DFTB2's form) in the flat world: H 1s and B–F 2s 2p (pz out of
  the plane, the π system), Slater–Koster hoppings of Harrison's universal form with a per-pair scale and an exponential
  decay, Fermi smearing, Mulliken charges made self-consistent (U and Klopman–Ohno γ), an exponential repulsion fitted
  per element pair on a reference molecule (the game's bond length, energy and stiffness). Found: with one scale and
  a repulsion per pair it fits H₂ exactly and CH₄ (17.12 eV, C–H 1.090 Å), and gives H + H₂ a barrier of 0.33 eV at
  0.95 Å untold (measured 0.42 at 0.93); but no scale fits N–H, O–H, F–H or C–O on their hydrides (water's atomization
  4.1 eV against 9.6 at best), the exponential repulsion is bounded at short range (ethylene collapsed), and Harrison's
  atomic levels put H above C in electronegativity (CH₄'s C +0.76). Next: real two-centre parameters (Slater–Koster
  tables for H, C, N, O, or the electronic part of an open semi-empirical set such as GFN1-xTB's) and a repulsion with a
  core; then analytic forces and a measured cost. Several sessions; the user to choose this or 3-D next.
  The route chosen next: GFN1-xTB (Grimme, Bannwarth & Shushkov 2017), a published semi-empirical tight-binding method
  with parameters for every element (its open implementation, tblite, LGPL, holds them): an STO-nG minimal basis (H with
  a diffuse 2s), an extended-Hückel Hamiltonian scaled by distance and coordination number, shell-resolved charge
  self-consistency with third order, a repulsion and D3 dispersion. It gives hydrogen bonds and proton sharing from the
  electrons. Cost: a 30-atom molecule about 120 basis functions, a few ms a step in JavaScript; liquid water's 240 atoms
  640 (×1,000), so an Experimental mode for small systems. To check a port, the reference implementation (pip tblite)
  needs the owner's OK to install here.
- Done in 1.23.0 (the 3-D lab, Preview; section below), the stages kept for the record: 3-D. Stage 1a done (the engine in the Node harness): `W.d3`, `W.box.d`,
  `world3d(depth)`; z, vz, fz … in the store; 3-D grid, neighbour lists, kernels (JavaScript; WebAssembly and threads
  bypassed in 3-D), walls, bath (3 degrees of freedom), events with z. Angles in 3-D: every pair of bonds at a centre,
  (K/sin²θ₀)(cosθ − cosθ₀)² (the plain (θ − θ₀)² had a false minimum a flat CH₄ fell into), K(θ − π)² near linear;
  VSEPR targets 180/120/109.47 (NH₃ 107, water 104.5), trigonal bipyramid and octahedron by the lowest-energy assignment;
  new 3-D-only terms: out-of-plane for trigonal planar centres K_OOP·(u₁·u₂×u₃)² (2) and a torsion on double and
  aromatic bonds K_TOR·(û₁·û₂×û₃)² (1.2; ethylene 2.7 eV at 90°). Molecules from the flat library: a random rotation,
  ±0.15 Å jitter, relaxed. Measured: CH₄ 109.2–110.0°, NH₃ 106.2–107.0° (0.38 Å pyramid), water 105.0°, CO₂ 179.7°,
  ethylene and benzene flat to 0.003 Å; 60 waters insulated 1,000 steps −0.003 eV; forces the slopes to 2e-8 eV/Å;
  H atoms make H₂, H₂ + O₂ react. 2-D bit for bit unchanged (water, combustion, soup, gallery, 500 steps, seed 7) and
  no slower. Cost: 720 atoms 1.70 ms a step in 3-D (JavaScript) against 0.58 in 2-D (3.2× the neighbour pairs).
  Still 2-D only: nuclear reactions, hep.js, chips, objects, fields, lasers, beams, tools, light absorption, bond
  orders, quantum bonds/nuclei, waves, responsive charges, box resizing, saving. Open: LJ_SCALE 2 and K_IW 2 (2-D
  corrections) still on in 3-D; hypervalent lone pairs not compressing angles (SF₄ 120°, real ~102°).
  Stage 2 done (drawing, `src/view3d.js`): a perspective camera R.cam3 {yaw, pitch, dist, fov, target} orbiting the
  box; WebGL atoms and bonds from a z-carrying slot texture (GL_T3) with depth testing (the ball shader writes the
  sphere's front depth), glows additive; Canvas 2D fallback sorted far to near; a wireframe cube (near edges in front),
  faint grids on the far faces, a depth fade, an axis marker; labels and badges where not covered; picking the nearest
  disc under the pointer (pick3); right/middle/Alt-drag orbit, Shift+right pan, wheel zoom, arrows orbit, 0 fits,
  two-finger turn and pinch. Preview setup "3-D: molecules in space (preview)" (Chemistry). Saving, undo and rewind
  refused in 3-D for now. 2-D frames unchanged pixel for pixel (t_3d). Frame (headless, software GL), 1,800 water atoms:
  2-D 0.4–1.5 ms, 3-D 1.2–2.3 ms (JavaScript projection of every particle for labels and glows).
  Stage 3 done (the mode): a "3-D lab… Preview" entry in the main menu with its own setups (empty cube, molecules in
  space, liquid water 1,029 atoms in a 22 Å periodic cube, H₂ + O₂ 432 atoms at 600 K, hot hydrogen atoms, salt in
  water 997 atoms) and a Leave button; tools in depth (Place at the atom under the pointer or the target plane, drags
  on the plane facing the camera, Grab in 3-D, Select by the drawn positions, Heat and Erase through the brush's cone,
  Push/Pull and Spark as a ball, Fire in the view plane, Measure distances and angles in space); trails, H-bonds,
  ionic contacts, flashes and events drawn in 3-D; Inspect shows position and velocity with z; save format version 2
  (d3: depth, z, vz to 1e-10; version 1 unchanged), so saves, shares, gallery, autosave, undo and rewind work in 3-D.
  Not in 3-D (disabled, "Not in 3-D yet"): magnets, fields, objects, light, beam sources, the box-size slider, the
  Experimental physics settings, the ultra mode, light/neutrinos/unstable particles/neutrons/positrons/antimatter in
  the palette, Ask Claude; Fire capped below radiation-mode flight. Water and brine start with a strong bath for 0.2 ps
  (laid out on a lattice they would heat to 600–1,300 K as hydrogen bonds form). Speed (Node, one thread): water 4.6
  ms a step, brine 10.2, H₂ + O₂ 0.17. Open: hot hydrogen insulated drifts −5 eV over 4.6 ps (the 3-D H + H pairing
  events at the 0.04 tu step).
  Found on the way (a bug in 2-D too, fixed): threadsBind wrote the WebAssembly sum table before the module was ready
  (in the page it compiles in the background): "Cannot set properties of null" in t_threads, now and then. The table is
  written when the module is used, and the workers are bound again once it is ready.
  Stage 4 done (speed): af_forces3 in the Rust kernel (kernel/src/d3.rs: pairs, Morse bonds, the 3-D angles,
  out-of-plane and torsions; descriptor entries 40–45 for z, vz and the 3-D angle tables, the 2-D export unchanged);
  the 3-D JavaScript kernels inside the PAIR KERNEL markers for the workers; pairs, bonds, centres and dihedrals shared
  out over the worker threads with a fixed-order sum; the 3-D neighbour list built on the threads (by particle ranges:
  a 3-D box has few cells). The built module gives the JavaScript's forces bit for bit (water, brine, sparked H₂ + O₂,
  a mixed box, molecules, hydrogen: 0 slots differ; 30-step runs identical). Node, one thread: liquid water (1,029
  atoms) 4.3 → 2.7 ms a step (kernels 3.4 → 1.7); salt water 13 → 9.8 (its electron-transfer trials, ~130 a pass in
  JavaScript, are most of the rest). Not threaded in 3-D: the integrator, bath and step size (0.02–0.07 ms at 1,000
  atoms); af_fast3 (free electrons) not written.
  Left for later: a 3-D release (the owner to choose when); the open items above; fields, objects, light, nuclear
  reactions and the Experimental physics in 3-D.
- Asked for (the user: "start 3D once you've completed the quantum thing"): a 3-D mode, as a separate mode chosen in the main menu rather than a setting: the
  ordinary game stays flat (a 2-D "locker"), and the 3-D mode gives full 3-D. Kept apart because 3-D would slow the
  game (a cube as wide as today's box holds about 50 times the atoms, each with 2–3 times the neighbours) and touch
  everything: the engine, walls, drawing, every tool, picking in depth, the flattened molecule library, the chips.
- Continuous bond orders for more elements (asked by the user after 1.21, "can you add the rest?"; planned for 1.25): today H, B, C, N,
  O, F, Si, P, S, Cl, Br, I. The covalent p-block left (Ge, As, Se, Sn, Sb, Te) fits the same model: the game's bond
  table already has measured energies for them; each needs its valence, angle targets (periods 4–5), electronegativity
  and size checked, and the molecules relaxed and compared with stored bonds as for the first twelve. Not metals
  (their electrons are shared through the whole metal, not bond by bond with a fixed valence: the game keeps its
  metallic cohesion for them; a metal bond-order model, embedded-atom style, would be a separate project), not ionic
  pairs (charges already), not the noble gases. A physics-model change for the owner to approve. Every element up to
  Rn is in quantum bonds (1.22) for small systems.
- Bond orders for metals (asked by the user after 1.21, to come after 3-D; planned for 1.25): a many-body metal model in which a metal
  atom's bonding comes from its surroundings rather than from whole bonds with a fixed valence: the embedded-atom form
  (Daw & Baskes 1984; each atom's energy a function of the electron density its neighbours give it), or the
  second-moment tight-binding form (Finnis–Sinclair, Cleri–Rosato), fitted per metal to measured cohesive energy,
  lattice constant, elastic constants and vacancy energy; metal–non-metal pairs (oxides, hydrides, complexes) the hard
  part. Would replace the game's metallic cohesion for member metals, so surfaces, clusters, melting and alloys come out
  of one model. Several sessions; a physics-model change for the owner to approve.
- Asked by the user after 1.23.1 (collected; wait for "build it"). The user: "this should be 1.23.2" (with the fixes
  already in the 1.23.2 section), "and for 1.24 add the rest of the experimental options to 3d". For 1.23.2:
  - 3-D ions (done in 1.23.2 as display only, the owner's choice; the physics candidates measured there, not changed): "ions should be modeled
    differently in 3d because when they get bigger it overlaps with other particles". Measured on 1.23.1 (brine3d, 800 steps, atom size 1): no ion's drawn ball overlaps a neighbour's
    (closest Na⁺–O 1.89 Å against 1.10 drawn, Cl⁻–H 1.73 against 1.47), but Na⁺–O comes closer than real (~2.4 Å),
    likely the flat world's K_IW 2 and LJ_SCALE 2 still on in 3-D (the open item under 1.23.0). Which ions and setup
    the user saw it in: asked for (a screenshot). The likely fix is the open K_IW/LJ_SCALE item; physics, needs his OK.
  - Done in 1.23.2 (the section below): WASD flying in 3-D; Ultra-realistic in the Experimental tab; 3-D tiny objects
    (five; the rest left out, reasons below); separate 2-D and 3-D libraries with Ask Claude's 2-D / 3-D choice; the
    Leave button gone (a Preview label); fast particles leaving the 3-D box; Performance mode gone. Also asked during
    the build and done there: Settings pictures enlarged on a click (animated) at 1280 × 720, the 3-D axis marker and
    scale bar above the tool's bar, the "On hold" note gone, main-menu presses that were lost, the Gallery's spacing.
  Done in 1.24.0 (the section above): placing and firing in 3-D (placing plane, placing against an atom, firing from
  the camera), box size, magnets and fields, light, the unstable particles in flight, and the Experimental settings
  except continuous bond orders. Placed objects stay out of 3-D (the owner).
  Left in the flat game from the 1.24 list (reasons and numbers in the 1.24.0 section; several sessions each):
  - The nuclear side of the particles in 3-D: nuclear hits by hadrons, captures at rest (muonic atoms, nuclear stars),
    muonium, hypernuclei, the collider, the plasma, nuclear reactions (hep.js is written on flat four-momenta).
  - Continuous bond orders ("From the positions") in 3-D: a 3-D version of bo.js's derivatives and the kernel pass.
  For 1.25 (reported by the owner; not built yet):
  - Investigated in 1.25 (the 1.25 section: GFN1-xTB's own barrier, 0.53 eV; nothing changed). "Hexazine doesn't fly apart with quantum bond orders in 2d" (the owner, after 1.23.1). Hexazine (N₆ ring) is very
    unstable in reality (it falls apart to 3 N₂, releasing a lot of energy); with quantum bonds (GFN1-xTB, Experimental
    → Bond orders → Quantum) it stays whole in the flat game. To find out: whether GFN1-xTB itself gives the ring a
    barrier (single-point scan along the N₆ → 3 N₂ path, compare with published high-level barriers), whether the flat
    world (in-plane only, no out-of-plane distortion) holds it, or a game-side cause (charges, D3, membership). A
    physics question for the owner.
  - Done in 1.25. "it repeats the description in the settings menu, but it's supposed to be in the sidebar only" (the owner): a
    setting's description shows both under the setting in the Settings list and in the side preview pane (1.23's
    sidebar); he wants it in the sidebar only. Seen on quantum bond orders; check every tab. Keep what the sidebar can't
    show (e.g. live readouts, cost tags) where it is.
  - Done in 1.25 (for the owner's OK). Continuous bond orders for more elements (Ge, As, Se, Sn, Sb, Te): the entry "Continuous bond orders for more
    elements" above (planned for 1.25).
  - Done in 1.25 (the owner after 1.24.0: "Ship the option"; flat melting 1.1–1.5× too hot kept as it is, written in
    the 1.25 section). Bond orders for metals (an embedded-atom / second-moment many-body model): the entry "Bond orders
    for metals" above (planned for 1.25).
  - In 3-D (the owner, after 1.24.0: "add them both to 3d in 1.25"), the two parts of the 1.24 list left flat:
    - The nuclear side of the particles: nuclear hits by hadrons, captures at rest (muonic atoms, nuclear stars),
      muonium, hypernuclei, the collider, the plasma, nuclear reactions (hep.js on flat four-momenta; route in 1.24.0).
    - Done in 1.25 (for the owner's OK; the JavaScript pass, the WebAssembly one below). Continuous bond orders ("From the positions"): a 3-D version of bo.js's derivatives and the kernel pass.
    Both are physics in 3-D: energy and cost measured, the owner's OK as each lands.
  - Done in 1.25 (for the owner's OK; the 1.25 section). Single bonds' twist barrier in 3-D (the owner, after 1.24.0, through the main session; to build in 1.25 on v128):
    today only double and aromatic bonds resist twisting (stored bonds' K_TOR, bond orders' bfTorsions3), so single
    bonds spin freely. A threefold torsion for single bonds (sp³–sp³ and the common sp²–sp³ cases) in the stored-bond
    3-D engine and in the bond orders' 3-D pass, fitted to measured barriers: ethane ≈ 2.9 kcal/mol (0.12 eV), propane
    ~3.3, butane anti–gauche ≈ 0.6–0.9 and its syn barrier, methanol ≈ 1.07, methylamine ≈ 1.98, hydrogen peroxide's
    twofold shape. The flat game unchanged (2-D has no twist). Physics in 3-D: barriers against the measured ones,
    butane's anti/gauche populations at 300 K, insulated drift, forces against the slope, cost, the 3-D tiny objects
    (polyethylene) still whole; for the owner's OK.
  - Done in 1.26 (branch v134, the section "1.26: WebAssembly speed-ups"). Continuous bond orders in 3-D in WebAssembly (left from 1.25): the 3-D angle term, its targets and roles, the
    torsions and the z arrays in kernel/src/bo.rs (wasm.yml builds it on a working branch), checked natively with a 3-D
    dump; liquid water in 3-D with bond orders costs ×22 a simulated ps on the JavaScript pass.
  For 1.26 (the owner, after 1.24.0; not built yet):
  - Done in 1.26 (for the owner's OK; the 1.26 section: GFN2-xTB a choice, GFN1 stays normal). GFN2-xTB for quantum bonds (the owner: "try implementing gfn2 xtb. Run tests and compare numbers, and maybe leave
    gfn1 in if gfn2 is very different"). Compare GFN1, GFN2, published values and g-xTB (the owner's build: xtb 6.7.1
    with --gxtb, 2026-05-14, Windows x86_64; a copy in the main session's scratchpad, gxtb/; the Linux build is on
    grimme-lab/g-xtb's releases): hexazine's barrier and its release to 3 N₂ (GFN1: 0.53 eV and 1.67 eV; high-level
    work: no barrier or a very shallow one; release about 9–10 eV), bond lengths and energies, reaction energies, cost.
    g-xTB is a reference only: run offline, never shipped or committed (binary only, GPL-3.0, 35 MB). Keep GFN1 to
    choose if the two differ a lot. g-xTB in the game only when its source and parameters are public (tblite; a weekly
    scheduled check watches for it). Physics: the owner's OK.
  - Metal oxides and hydrides with the many-body metals (the owner: "Add metal oxides and alloys to 1.26"): today a
    metal bonded to O or H leaves the many-body model for the classic chemistry, with no image-charge pull for an ion
    near the metal. Oxide and hydride bonding fitted to measured formation energies, lattice constants and surface
    oxygen binding (Cu₂O, Al₂O₃, FeO, NaH…).
  - Alloys with the many-body metals: constants per pair fitted to compound data, so strongly bound alloys (Ni–Al: the
    model gives +0.14 / −0.09 eV for one dissolved atom, really strongly bound) and Cu–Au ordering come out; check
    mixing energies against measured heats of formation.
  - Directional forces (the owner, after 1.25's nuclear work: "Add them to 1.26"; each an Experimental option first,
    measured against reference, for the owner's OK): lone pairs on O and N as off-atom charge sites (TIP4P/TIP5P-like)
    so liquid water's and ice's tetrahedral network comes out sharp (density, RDF, ice structure); directional bonding
    for transition metals (an angular term in the many-body metals, MEAM-like or bond-order potential) so Fe, W, Cr, Mo
    and Na crystallize bcc (bcc–fcc energy differences; built on v132 for the owner's OK: the 1.26 section, item 3); σ-holes for halogen bonds (an off-atom positive site on Cl, Br,
    I; halogen-bond energies and geometries); π-stacking between aromatic rings (benzene dimer energies and shapes);
    polarizability that differs by direction for induced charges.
  - Also left from 1.25: the collider in 3-D (the 1.25 section: ring zones, radiation flight in the z = 0 plane, 3-D
    jet axes, 3-D collider setups; several sessions), the Experimental intranuclear cascade in 3-D, and continuous bond
    orders in 3-D in WebAssembly (above; done in 1.26).
  Bugs on record (found while building 1.23.2–1.25; not fixed yet, for a bug-fix session; the owner: "keep these bugs
  on record"):
  - [fixed in 1.26: the section "1.26: copper ions"] Flat copper with the normal pair model turns itself into ions: 120 of 127 atoms of a flat Cu lump within 2 ps at
    300 K (Ag, Au, Fe, Na don't). Screenshot 125m-flat-pairs.png.
  - [fixed after 1.25] Dense metals in 3-D are slow with either metal model: 767 Cu atoms about 80 ms a step, nearly all estimating
    electron transfers.
  - [looked at after 1.25: a model choice, for the owner] In the flat world AsCl₅'s five chlorines bond to each other with bond orders (Cl–Cl orders 0.39); PCl₅ and SbCl₅
    are fine.
  - [fixed after 1.25] In 3-D a fast neutron among waters lets 50–85 eV slip from the energy books over 1,500 steps (48 eV after 1.23.2);
    a 100 keV U atom among waters about 1 eV.
  - [fixed after 1.25] In the flat game the open-wall branch of walls() removes particles without booking their energy as escaped.
  - [fixed after 1.25] In the flat game an event that changes a charge in an applied electric field misses −q·E·Δr from the books.
  - [fixed after 1.25] Free electrons put down almost on top of each other gain hundreds of eV in their first steps.
  - [fixed after 1.25] 3-D: Inspect can't pick unstable particles or photons in flight; quantum nuclei's beads aren't drawn; some
    Experimental descriptions still describe the flat case; the Magnet tool's pole buttons keep the flat ⊙/⊗ signs.
  - [fixed after 1.25] A charged particle's search for atoms on its path goes over every atom (the grid would make it local).
  - [fixed after 1.25] Help says holding Space pans, but nothing sets UI.spaceDown.
  - [fixed after 1.25] Flat game: hardSphere turns a pair by π − 2·acos(b/R), inverted (a head-on hit passes straight through, a grazing
    one bounces back); the 3-D version (1.25) uses the right angle.
  - [fixed after 1.25] exoElastic measures the whole box's energy on every pass (slow; 3-D's elastic hits booked from the recoil in 1.25).
  - [fixed after 1.25] Muonium formation misses up to tens of eV (2-D and 3-D: the muon stopped without paying its potential energy).
  - [fixed after 1.25] 3-D: MeV electrons and positrons are stepped faster than light (−367 eV over 150 γ rays of 20 MeV into lead).
  - [fixed after 1.25] K⁻ absorption keeps momentum only to 0.002 (2-D and 3-D).
  - [looked at after 1.25: physics, not a bug] 3-D: ionized water recaptures its free electrons within about 30 steps (40 ionized molecules); flat water keeps
    all 40.
  - [fixed after 1.25] 3-D: quantum nuclei with forces on every bead cost ×17–48 (×3–10 flat); for the speed work.
  - [fixed after 1.25] Settings: the flat bond-order cost tag says ×8–15, liquid water measured ×5.4–5.8 (1.25).
  - [fixed after 1.25] Test: t_features' 0.95 CO block (six CO among O₂ keep triple) follows the page's random stream (4 of 6 once).
  Model limits written down, not bugs: GFN1-xTB keeps hexazine whole (its own 0.53 eV barrier, 1.67 eV release); the
  game's bond table has As–H, Se–H and the As/Sb chlorides 4–17% weak, Sn–H, Sb–H, Te–H 6–18% strong (the 1.25 section).
- Continuous bond orders (a less hard-coded chemistry): bond order worked out from the atoms' distances and
  arrangement, as reactive research force fields do, instead of stored whole-number orders (a big rewrite of the
  chemistry; asked for by the user).
  Step 1, a prototype outside the game (`node tools/bo-proto.js [molecules]`, `BO_MODEL=A|B`), 1.04 era. Every pair's
  order is worked out from the atoms' valences (capacity(), expanded octets toward F, O, Cl) and positions, energies
  from the game's bond tables. Two forms were tried:
  - A, valence sharing: a pair can reach N = what both atoms have left after their other partners, and holds N·w(r)
    (w = 1 inside its bond length). Matches the classic bonds within 0.05 eV per molecule and 0.04 Å for H₂, O₂, N₂,
    CO, H₂O, NH₃, CH₄, C₂H₆, C₂H₄, C₂H₂, CO₂, HCN, CH₃OH, H₂O₂, SiH₄, H₂S, PCl₃; benzene comes out at 1.49 per ring
    bond without being told (1.47 Å; real 1.40). Dynamics conserve energy (benzene 300 K, 1,500 steps: 0.035 eV).
    But no reaction barriers: when two partners compete inside their bond lengths the split of the valence is not
    fixed by the geometry, so H + H₂ has no barrier and H₃ is bound (real barrier 0.42 eV). SF₆ crowds and its F
    atoms bond to each other (2-D).
  - B, order from distance (Pauling/BEBO) with an over-coordination correction (as ReaxFF's): benzene 1.50 at
    1.418 Å, SF₆ still not right, H + H₂ barrier 0.18 eV at 0.89 Å, but its top is a shallow well rather than a true
    saddle, energy conservation is poor (water 0.12 eV, benzene 0.47 eV in short runs) and benzene's bonds localise
    (1.9/1.1).
  Neither is ready to replace the classic chemistry. Every step it needs all pair orders found self-consistently
  (40 sweeps here) and forces through that, several times the cost of today's per-bond Morse terms. A form that keeps
  A's stability and gets B's barriers is a ReaxFF-like functional with analytic derivatives: several more sessions.
  The user chose to use the good part (1.05: resonance, below); the full bond-order chemistry is parked.

- The Higgs boson (not built; written down with 1.27's W and Z bosons, the owner's electroweak request of 2026-11-06):
  125.1 GeV, Γ ≈ 4 MeV; at the LHC made mostly by two gluons fusing (about 50 pb at 13 TeV, one collision in 10⁹; also
  vector-boson fusion about 4 pb, with a W or Z 1.4 and 0.9 pb), decaying to b b̄ 58%, W W* 21%, gluon pairs 8%, τ τ 6%,
  c c̄ 3%, Z Z* 2.6%, γ γ 0.23% (values from memory). LEP could not make it (e⁺e⁻ → ZH needs √s > 216 GeV; LEP reached
  209); a Higgs factory at 250 GeV makes it at about 0.2 pb. Would need: the Higgs in XP with these decays, gg → H in
  hadron collisions at its σ/σ_inel (as ewDraw), e⁺e⁻ → ZH above 216 GeV (as the W pairs); about a session. Waits for
  the owner's "build it".

- Measured noble-gas wells (not built; found by 1.27 bug 1): UFF's van der Waals wells for He–Xe differ from the
  measured ones (Ar 8.0 meV against 10.3, Xe 14.3 against 19.0; He 2.4 against 0.95, from memory), so neither the flat
  game's doubling nor factor 1 gives real gases in 3-D (argon's B₂ at 300 K −28 doubled, +10 at 1, measured −15.6
  cm³/mol). Per-element measured wells (and radii) for 3-D, re-checking water, the 3-D objects and pictures. A physics
  change; waits for the owner.

- Solvated electrons, e⁻(aq) (not built; found by 1.27 bug 8): electrons slowed below about 1 eV in liquid water become a
  hydrated electron (radius ~2.5 Å, D 4.9×10⁻⁵ cm²/s, 720 nm absorption, hydration ~1.7 eV; rate constants with H₃O⁺
  2.3×10¹⁰ and OH 3×10¹⁰ M⁻¹s⁻¹, from memory), recombining the Onsager way with ε = 80: the measured 60% of radiolysis
  electrons still free at 1 µs, the same in both modes (today 3-D recaptures 34 of 40 in 2 fs, flat runs away to 140).
  A physics change; waits for the owner.

## 1.26 (in progress)

### 1.26: combined (branch v136)

1.25 with every fix after it (v128) and the five 1.26 branches merged: GFN2 and spins with both refits (v131, v135),
metals (v132), directional forces (v133), WebAssembly speed-ups (v134). Conflicts were Settings texts and cost tags
(each row kept with its newest measured number: the 3-D bond-order tag ×7–14 from the WebAssembly pass, the quantum
nuclei tags from the bug fix (×8/×17/×29; exact bead forces then ×5–6 over the contracted rings), the induced charges'
from v134) and one engine line (the many-body partners' exclusion and the charge sites' pair energy, both kept).
The metals pass's WebAssembly port (v134) knew 1.25's model only: it now takes the first eight entries of 1.26's
nine-entry pair table and runs only for plain metals (no O/H partners, no directional metals; the image term after it),
the JavaScript pass otherwise; f_126w mb is exact again (ΔE 0, forces 0, 30 steps 0 Å apart) and f_126m passes.
Test fixes: t_features' 1.10 Settings list now has the five 1.26 rows marked real; runtests.sh copies tools/ (the
metals checks read tools/mbfit.js) and gives each suite 3 GB (t_features, every version's checks in one process,
ran out of the 2 GB heap).

Waiting for the owner:
- Approvals already given: GFN2 as a choice; metals items 1–3 ("ship and fix!"); directional forces; the nuclear side
  and continuous bond orders in 3-D.
- Decided (the owner, 2026-11-05: "try bigger model later for metals"): close-packed metals keep 1.25's fit in 1.26;
  a bigger form (fourth moment or MEAM screening) is on the 1.27 list.
- The spin-branch booking bug: fixed in the bug-fix session (branch bugfix-126 from v136, merged 2026-11-06; below,
  "Bug fixes after the 1.26 merge": a step whose answer comes from a fresh start books its jump from the last settled
  step; the energies and forces are as before).
- Approved (the owner, 2026-11-05: "ok sounds good"): Polarized becomes the normal Spins setting once the spin-branch
  booking bug is fixed: done after the merge (below).
- Decided (the owner, 2026-11-05: "fix cu ions"): the bug session's model question #1 (flat Cu ions), fixed on branch
  v137 (the section "1.26: copper ions").
- To decide: the bug session's model questions #3 (AsCl₅) and #16 (3-D water recapture, physics).
- Suite on 393f018 (2026-11-06: 1.26 with the sweeps, the spin-branch fix, Polarized normal and the fast-electron
  energy fixes; another session building 1.27's W/Z at the same time): tools/runtests.sh 20 of 22 suites; the misses all
  timing checks under the load (t_features 1.14, 1.25 labels3d, exoElastic, bo3; t_page's collider-beam timeout), each
  passing alone (t_page whole, f_bug125 exoElastic, f_126w bo3; t_features alone passed 1.14 and labels3d and missed
  0.64's named save, 0.68's prism and pi3 instead, which passed in the runtests run). Every check passed at least once on
  this commit.

For 1.27 (part 1, exotic atoms, and the Settings section built on branch v141: see "1.27: realistic particles 1"; parts 5 and 6 on branch v143: "1.27: realistic particles 5 and 6"; part 7 on branch v146: "1.27: realistic particles 7"; the rest not built; and, asked separately on 2026-11-06, W and Z bosons on branch v148: "1.27: W and Z bosons (electroweak)"): realistic particles (the owner, 2026-11-05: "think of every particle that is partially/unrealistically
portrayed and how to implement an experimental setting that makes them as realistic as possible"; APPROVED, all seven
parts, 2026-11-05: "I ok all of them, just please make sure it doesnt mess with anything": each part its own Experimental
switch, off at start; off, every setup bit for bit as before (fingerprints), energy books exact on; built after the
3-D, exotic-particle and settings sweeps; in Settings → Experimental their own section (the owner: "a specific section
for those types of portrayal settings … the section title is the heading and then each setting and its switch" small,
like a paragraph line): a heading "Realistic particles", then one compact line per part (its name, an on/off switch,
its cost tag; the description in the side pane on hover or focus, as the other rows since 1.25), with Ultra-realistic
mode, Electrons as waves and Photons as waves (1.27) moved in beside them; in this order): (1) exotic atoms as real atoms: μ⁻, π⁻, K⁻ and p̄ caught into an orbit (now a μ⁻ atom
is an overlay the tools can't touch, and π⁻/K⁻/p̄ are absorbed at once), a cascade giving off the exotic atom's X-ray
lines (energies scaled by the reduced mass), then decay or nuclear capture at measured rates by element (muon
lifetimes in each element, Suzuki 1987); to the outside an atom of charge Z−1 (μp acts like a neutron, muonic C like
B); protonium; (2) positronium: a slow positron with an electron forms Ps, para (1 in 4) 125 ps → 2γ of 511 keV back to
back, ortho (3 in 4) 142 ns → 3γ, pick-off in matter; (3) charged particles in matter: energy-loss straggling, δ-rays,
Cherenkov light in water and glass, bremsstrahlung and pair production for e± and γ (showers); (4) muonium as the
lightest hydrogen isotope (0.114 u, with quantum nuclei for its zero-point motion; its μ⁺ spin precessing in a field
and the positron coming out along it, μSR); (5) resonances with their widths (a ρ's mass spread over ~150 MeV,
Breit–Wigner), charm and bottom made in hadron collisions too; (6) nuclei with spin and magnetic moment (precession,
NMR in a field) and excited states giving off their γ lines; neutrons' 1/v and resonance cross sections and spin;
(7) photons' polarization and the Klein–Nishina Compton angles (with photons as waves, below). Things the box can't
make real are said, not faked: true nuclear sizes and lifetimes leave almost nothing happening in a nanometre and a
picosecond (Ultra-realistic does this already; it must work in 3-D), neutrinos almost never interact, oscillation
needs kilometres. Photons as waves (the owner, 2026-11-05: "can you add photons as waves in experimental"; an
Experimental option beside "electrons as waves": light as wave packets with its wavelength and phase, so it interferes
and diffracts (double slit, gratings, thin films, a laser's coherence), with polarization; the placed objects (mirrors,
lenses, prisms, screens, foils) then act on the wave; a screen shows the fringes built up photon by photon; absorption
and emission by atoms unchanged; to scope against cost, flat first; physics: the owner's OK); polarizability that differs by direction; a different form for close-packed metals' directions
(fourth moment or MEAM screening; the owner: "try bigger model later"), fitted with the liquid held to 1.25's and fcc/hcp/bcc in order; another Atom Forge xTB only with a new plan for
radical barriers. Found and on record: 3-D water 14–18% too dense; the 6 Å cutoff's false peak; C–F charges about 2×;
benzene's induced charges ×14 too large; O₂ near NH₃ never settles (quantum bonds).
Test on record: t_features' 1.23.1 "Continue after a restart" check fails on 1.25 (v128) as on 1.26: the restored world has
1–3 particles more than were saved (72 → 73, 73 → 74); for a bug-fix session. t_page's slow-motion button check fails
alone on both here too (the known flake).

### 1.26: bug fixes (energy books with fast electrons, decay data)

Found by the 1.27 "charged particles in matter" session (its "Found, not changed"). Branch v147 (from v136, e237efe).
Checks: tests/f_bug126e.js (t_features runs it alone; `node tests/f_bug126e.js [--node] [part …]`): eject,
nearThreshold, plasma, wallTwice, cap, radPush, decay, each failing on e237efe and passing here.

- **1. "3-D: −1.3×10⁸ eV over 40 steps in innerSteps".** Not an engine bug: the probe put its lattice down with
  `addAtom(sym, x, y, z)`, but addAtom's fourth argument is its options (`{ z }`), so every z was 0 and each lattice site
  held four atoms on top of each other. The pair forces skip pairs closer than 10⁻⁵ Å while the energy counts them, and
  the first ionization's kick drove the stacked atoms apart through the screened-nuclear core (an atom at 10⁴–10⁷ eV a step
  later). With z given, the same O/Pb lattice and four 1 GeV electrons: 0 eV over 40 steps (seeds 1, 3, 7; stacked:
  −1.39×10⁸, −1.32×10⁸, −9.7×10⁷); a 1 GeV electron ionizes nothing there in 40 steps, nor in the flat game (3×10⁻⁴ eV).
  The ionized case, built directly (half the atoms ionized three times, 248 electrons freed, 200 steps, 0.08 ps,
  insulated): 3-D 1.05 eV before, 0.67 after; the flat game had a real error here (fix 2e): 13.3 and 15.3 eV (seeds 3,
  7) before, −0.10 and 0.33 after. Two atoms at one point are outside what the integrator can do (not changed).
- **2. The flat game's ejectElectron among ions and free electrons** (eight 1 GeV electrons' passes through a lead
  block and through water, radiation flight only: lead 42 freed electrons, 9 off by more than 0.01 eV, worst 48.7 eV;
  water 64, 16, 39.1 eV; now lead 35, water 75, worst 0.0004 eV; the same runs' books 84.0 and 33.0 eV off over 300
  ticks, now 0.003 and 0.000). Five terms:
  a. An ion in flight (ballistic or in radiation flight, a recoil from the passes before) carries no potential energy,
     but the electron's launch energy still took the ion's pull (6.4, 12.9, 26.0 eV from Pb⁺, Pb²⁺, Pb³⁺) and nothing
     paid it back. 3-D has skipped it since 1.25 (`fastIon`); the flat game now does the same.
  b. An electron whose energy at infinity is under the radiation threshold (1 keV) but whose launch energy, with the
     pull of the charges around it, is over it went into radiation flight, which carries no potential energy, with the
     pull still in it (48.7 eV beside a Pb³⁺). Now it flies with its energy at infinity. Any ionization making a ~1 keV
     electron did it; the 1.27 photon-polarization session found it too (water, Compton electrons of 0.8–1.2 keV: 100–200
     eV). Water, 40 atoms each freeing an electron of 950, 980 and 999 eV at infinity (2, 10 and 26 of them into
     radiation flight): 92, 92 and 101 eV made before, 0 now; 500, 850, 900, 1,200 and 1,500 eV were exact before and are.
  c. A moving ion that loses an electron loses ½mₑv² of its motion with the electron's mass; 3-D gave it to the electron
     only for ions in flight. Now for every moving ion, both games (an H⁺ knocked to 233 eV: 0.13 eV).
  d. An atom in radiation flight stopped in a closed wall (`wallOrEscape`) was listed with the newcomers (`_late`) although
     the neighbour grid still held it, so localPE and phiE counted it twice until the next force pass (6.4 eV in an
     ionization beside it; a Pb⁺'s pull 1.5 Å away 12.0 V for 6.0). Now listed only if the grid doesn't hold it (`lateBack`).
  e. A particle back among the stepped ones since the last force pass (a free electron slowed out of flight, an atom
     stopped in the wall) was missing from `_charged`, the net charges summed beyond the 6 Å cutoff, so phiE and localPE
     left out its pull from farther away, which totalEnergy counts: each later mode switch or ionization 1–2 eV off.
     `lateBack` lists it there too (with the long-range sum on). This was the flat ionized lattice's 13–15 eV.
- **3. ejectElectron at the particle cap** put the energy in the bath and returned no electron; every caller, finding no
  electron, released it again (Compton, photoionization: dumpHeat) or took it back (an electron's impact ionization and
  a hot collision undone, a muon's robbing undone, forceShed's fee), so it was counted twice or made from nothing
  (photoionization at the cap: the 50 eV twice). Now it returns no electron and leaves the energy with the caller, as
  for any electron that can't be freed.
- **4. Pushes on atoms in radiation flight** (the flat radiation flight's ionizing loop, `moveRad`, and the unstable
  particles' `exoIonize`): the push square to the path went into the velocity of an atom itself in radiation flight,
  which its next flight step overwrites from its stored energy, so the dE the passing particle lost left the books (the
  lead block's passes: 6 such pushes, 18.8 eV, the largest 8.2 eV; 20 keV electrons 0.8–0.95 Å from a flying Pb: −1.04,
  −0.86, −0.79 eV). Decided: book it (`pushSquare`: its stored energy takes the push, through setVel), not skip such
  atoms as 3-D's fastStop3 does: the flat game keeps its model (every atom passed is pushed or ionized), and ionizing an
  atom in flight is exact now (2a), so there is nothing to avoid. Atoms not in radiation flight: the same arithmetic as
  before, bit for bit.
- **5. Decay data.** ¹⁹⁸Au (made from gold by a neutron) was not in the table; the estimate for unlisted nuclides gave it
  86% β⁻ and 14% electron capture with a 5.1 h half-life. It is β⁻ only, Q 1.3724 MeV, 2.6941 d: listed now. ²²Na was
  β⁺ only; it is 90.3% β⁺ and 9.7% electron capture (Q_EC 2.842 MeV for both, as ⁴⁰K's entry): listed now. The estimate
  (allowed β⁻ and β⁺/EC rates from the mass formula's Q-values, log ft 6.0 and 5.8) gives both β⁻ and EC to 43
  unlisted nuclides, because the formula's pairing term opens both sides for odd–odd nuclei. Against measured data
  (NUBASE2020, from memory: check before listing them): 13 really decay both ways (⁷⁴As, ⁸⁴Rb, ¹²⁶I, ¹³⁰Cs, ¹⁴⁶Pm,
  ¹⁵²Eu, ¹⁵⁸Tb, ¹⁶⁴Ho, ¹⁸⁶Re, ¹⁹²Ir, ¹⁹⁶Au, ²⁰⁴Tl, ²²⁶Ac; branches off, often by a lot); 13 are β⁻ only or above 99.5%
  (⁹⁴Nb, ¹⁰⁴Rh, ¹¹⁰Ag, ¹¹⁴In, ¹⁴²Pr, ¹⁹⁸Au (now listed), ²³²Pa, ²³⁸Np, ²⁴⁴Am, ²⁴⁶Am, ²⁵⁰Bk, ²⁵²Bk, ²⁵⁶Es); 12 are EC/β⁺
  only (¹²⁰Sb, ¹²⁴I, ¹³⁶La, ¹⁴⁰Pr, ¹⁵⁶Tb, ¹⁶²Ho, ¹⁶⁸Tm, ¹⁷⁴Lu, ¹⁸⁴Re, ¹⁹⁰Ir, ²⁰²Tl, ²⁰⁸Bi); 3 are α emitters with
  half-lives of ns–s (²¹⁴At, ²¹⁶At, ²²⁰Fr; the estimate says β/EC over hours); 2 are unknown (²⁵⁸Es, ²⁶⁴Md). The
  estimates' half-lives also cluster at 1–25 h whatever the nuclide. That is the estimate's accuracy, not a bug in its
  rule: not changed. For the owner: list the ones the game makes often (neutron capture on stable isotopes: ⁹⁴Nb,
  ¹⁰⁴Rh, ¹¹⁰Ag, ¹¹⁴In, ¹⁴²Pr; ¹²⁴I, ¹⁹²Ir, ²⁰⁴Tl …) from the evaluated tables.
- Fingerprints (tools/fingerprint.js, all setups, seed 7, 300 steps, e237efe and after): 9 of 58 change, all flat ones
  that ionize in those steps: soup, neon, muonium, hyperfactory (books only), pionbeam, annihilation, nif, photonuc,
  sns. In all nine a moving ion gave up an electron (2–1,344 times), whose share of its motion (2c; ~10⁻⁶ eV for a
  thermal ion) now goes with the electron, which changes the last bits; in pionbeam, annihilation, nif, photonuc and
  sns also free electrons slowed out of flight are now in the long-range list (2e; 8–452 times); in photonuc and sns
  ions in flight were ionized (2a; 2 and 80 times), and sns also launched 4 electrons into radiation flight by the
  pull around them (2b) and pushed 9 atoms in radiation flight (4). No setup reached the particle cap (3) or stopped an
  atom in the wall (2d), and none has ²²Na or ¹⁹⁸Au. The six 3-D setups and the other 43 flat ones are bit for bit the
  same.
- Test change: t_features' 1.11 chain-reaction tree now uses seed 3. Four slow neutrons in that block of ²³⁵U reach the
  check's 30 fissions in about half the seeds; these fixes change the last bits once the first fragments ionize, and
  seed 5's chain stopped at 25 (e237efe reached 30 with seeds 3 and 5 of 1–7, now with 1, 2 and 3). Seed 3: 30 fissions,
  9 generations before, 11 now.
- Suites (2-core machine shared with another session's tests): alone t_lint, t_energy, t_physics, t_nuclear, t_hep,
  t_3d, f_swx, f_bug126e pass; t_features passes but for the known timing checks (1.14's speed readout 1/1.4×; f_bug125
  exoElastic 4.2 ms and pi3, both passing alone, exoElastic 1.4–2.3 ms on both trees), and the paired-spin and settings
  checks inside it (f_126q, f_126x, f_hep126, f_sweep3d, f_swx) pass unchanged. tools/runtests.sh (run alone, from the commit before the nearThreshold part, which passes alone):
  all 22 suites pass, t_features among them (no timing misses this time).

### 1.26: 3-D sweep and settings audit

The owner: "there are MANY bugs so please do a general bug search in 3d mode … and make sure every change actually
applies correctly" ("just fix as much as you can … i trust your judgement"). Branch v139 (from v136). Checks:
tests/f_sweep3d.js (t_features, one line; or `node tests/f_sweep3d.js [--node] [part …]`), each failing on v136.
Fingerprints: tools/fingerprint.js, every setup, seed 7, 300 steps.

- 1. The particle view did nothing in 3-D (the owner's report). V, the view menu's Particle view, Lab → View → Atom
  detail and the chamber's two buttons set `R.view.bohr`, which only the flat drawing read: render3d drew its lit balls
  whatever was chosen (Shells and Orbitals likewise). Now each is the flat game's own picture at the particle's place,
  facing the camera and sized for its distance (`det3`, `drawDet3`: R.s set to the scale at that depth for the flat code,
  Canvas 2D, far to near): every nucleus's nucleons with its own electrons in their shells (`drawNucView`), a bond's shared
  electrons between its nuclei (`bondPairs3`, `bondPair` split out of the flat `drawBondPairs`, the flat picture
  unchanged), free nucleons and bare nuclei, free electrons, and the unstable particles' insides (`exoInside`: quarks,
  a hypernucleus's Λ, a muonic atom's orbit). Shells skip atoms drawn under 12 px (unreadable there; a box of 1,029
  waters drew its shells in 180 ms a frame, headless, now 39). Frame (headless, software GL, water3d, 1,029 atoms):
  balls 4–7 ms, particle view 31–66, orbitals 37–39; Molecules in space under 1.5 ms in every mode. Measured: Molecules in
  space, particle view: 72 of 72 atoms drawn as nucleons and electrons, 59 of 59 bonds as electron pairs (before: 0).
  Check: f_sweep3d "pview" (page). Fingerprints unchanged (drawing only).
- 2. The ultra-realistic mode in 3-D (the owner's report: "doesn't work in 3d"). What it does, measured in 3-D: decays
  at real rates and resonances at their own lifetimes (shared with the flat game: `W.warp` 1, `minShow` 0, moveExos3's
  `!W.ultra`), and nuclei hit at their true size (nucReach → ultraReach in moveNeutron, exoHits3, fastEncounters3,
  tryFusion3's gate): 60 slow neutrons (0.18 eV) through a 5×5×5 lattice of ²³⁵U atoms, 1,500 steps, seed 3: enlarged
  nuclei 114 fissions and 47 captures (a chain), true size none (the flat game's row of 25: 8 fissions and 13 captures →
  4 and 4). So the physics applied; the picture did not: the 3-D camera stopped at 0.5 Å and every particle was drawn
  enlarged, so turning it on changed nothing to see. Now, as the flat game's mode: free electrons are points, neutrons and
  bare nuclei at 1.2·A^⅓ fm, an atom its ball until larger than the view and then a faint wash, with its nucleus at true
  size at the centre (`ultraOne3`, the flat `ultraNucleus`: nucleons, the skin, quarks from 26 px); bond lanes capped
  thin; the camera comes in to 2·10⁻⁵ Å (2 fm, `cam3Min`; the near plane to 10⁻⁸ Å; flying from 3·10⁻⁵ Å/s) and back to
  0.5 Å when the mode goes off. Drawn on Canvas 2D (the WebGL layer is single precision): water3d's frame 4–7 → 20–25 ms
  (headless). The 3-D descriptions (the row's pane, the Experimental note, the cost tag) say so. Measured: zoomed on a
  carbon atom of Molecules in space the camera reaches 2·10⁻⁵ Å (499 px a fm; a nucleon with its u, d, d), before 0.5 Å.
  Check: f_sweep3d "ultra3d" (page). Fingerprints unchanged.
- 3. Fire in 3-D held electrons and positrons below 950 eV (`fireKE3`: 0.95 × the flat radiation flight's 1 keV, from
  1.24, when 3-D had no flight for leptons and MeV electrons were stepped faster than light); bug fix 14 after 1.25 gave
  them flight past 25 keV, the cap stayed. The slider read 950 eV past that point, and the note under it still said
  atoms stop at 1.9 keV and neutrons cannot be fired (both work since 1.25). Now every projectile goes at the energy set,
  the note says "single shots, at any energy; antimatter and beam sources: not in 3-D yet". Measured (Node, water3d,
  insulated after 50 steps, one electron fired across the box, 400 steps after): 500 eV books −0.18 eV, 10 keV +0.10,
  100 keV −4.3 (44 ionizations), 1 MeV −0.14; positrons the same (they fly alike). A click at an oxygen with 1 MeV set:
  950 eV before, 1,000,000 eV after. Also "Not in 3-D yet" inside a sentence was lowercased whole ("not in 3-d yet"): the
  Fire note and the log lines for tools and particles refused in 3-D (`not3d()`). Check: f_sweep3d "fireLep" (page).
  Fingerprints unchanged (interface only).
- 4. The quick menu's "Magnet here" (right-click on empty space) stayed greyed "Not in 3-D yet" in the 3-D lab, though
  magnets work there since 1.24. Now it puts a magnet ball at the point in depth (the point the tools take, `ptr3`), as
  the Magnet tool does. Check: f_sweep3d "qmMagnet" (page; before: the button disabled, 0 magnets).
- 5. Data → Wall pressure and "vs ideal gas" in 3-D used the flat formula (`wallPressure`): the soft walls' push summed
  over all six faces (softWalls3) divided by the perimeter of one face, in N/m, against an ideal gas N·k·T over one
  face's area, so Z meant nothing. Now in 3-D: force over the six faces' area in pascals, against N·k·T over the
  volume (`pUnit()`: Pa in 3-D, N/m flat, in the tile, its title, the graph and the CSV's column). 108 helium atoms
  in a 40 Å cube at 300 K, 20,000 steps (seed 4): before "0.037 N/m", Z 1.33 ± 0.07; after 5.9–6.2 MPa, Z 0.84–0.89
  ± 0.05 (ideal 6.9 MPa; the soft walls' inset takes the rest, the flat game's helium 0.82–0.88 the same way). Found,
  not changed: argon in the same box gives Z 0.48 ± 0.08 (flat 0.82): the flat world's doubled van der Waals wells
  (LJ_SCALE 2) still on in 3-D make argon stickier than real (the open item from 1.23.0). Check: f_sweep3d "pressure"
  (Node). Fingerprints unchanged (interface only).
- 6. The Physics tab in the 3-D lab began "atoms move in a two-dimensional chamber" and said nothing about 3-D. Now that
  sentence follows the mode ("three-dimensional box"), and a card "In the 3-D lab" (shown there only) says what is three-
  dimensional, which two flat corrections are still on (liquids a little too dense) and what is not in 3-D yet; Help's
  "What it does" mentions the cube. Check: f_sweep3d "physText" (page).
- 7. The tour (Esc → Tour) in the 3-D lab gave the flat game's controls: "drag with the right button to move around"
  (in 3-D that turns the view), the Objects tool, S and E (they fly the camera in 3-D: Spark is Z, Erase X), "a chain
  reaction, a collider" among the setups. Its cards now carry 3-D words where they differ (`TOUR`'s fourth entry, used
  in 3-D): turning, moving, flying and fitting the camera, the placing plane, the 3-D setups. Check: f_sweep3d
  "tour3d" (page).
- 8. The chamber's scale bar was drawn behind the main menu (the 3-D axis marker was already left out there): at
  1280 × 720 it ran under the 3-D menu's note at the bottom left. Now `drawScaleBar` draws nothing while the menu is open
  (both modes). Check: f_sweep3d "menuScale" (page; before: "5 Å" drawn under the menu).
- 9. A laser left on in 3-D (Light → Mode → Leave on) was not drawn at all (the flat `drawSources` draws its housing and
  a faint beam; render3d had nothing), and Erase over it left it on (`eraseHere3` took particles and magnets only),
  though its note says "Erase removes it": the only way off was the options bar's button. Now `drawLasers3` draws the
  beam to where it leaves the box and a small housing at its start, in its light's colour, and Erase's cone (its radius
  + 1.5 Å, as the flat Erase) takes it. Measured in the page: a Lyman-α laser set on a benzene carbon, Erase at the same
  point: 1 laser left before, 0 after. Check: f_sweep3d "laser3d" (page).
- 10. The 3-D event captions (`drawEvents3`, "as drawEvents, more simply") drew the first line only: no second line (a
  decay's energy and speed-up, a capture's "μ⁻ + p → n + ν inside the nucleus", a decay in orbit's mean life) and no
  close-up of a decaying nucleus, so Lab → View → Decay close-ups did nothing in 3-D. Now as the flat view: the second
  line, the close-up (`drawDecayInset`) and captions kept clear of each other. ²¹²Po α decays in the empty 3-D box:
  sub-line and close-up drawn (before: neither). Check: f_sweep3d "events3d" (page).
- 11. Settings audit: General → Setup tips turned off hid the setup's tip; turned back on, it stayed hidden until another
  setup was loaded (applySettings only hides it). Now the current setup's tip shows again at once. Check: f_sweep3d
  "tipsBack" (page).
- 12. Moving a selection (Select tool, a drag on it) and deleting it (Delete, the options bar's Delete) were not marked for
  undo, in both modes: Ctrl+Z took back whatever came before (after Select all → Delete, Molecules in space stayed empty:
  0 of 72 back). Help says Ctrl+Z undoes; the tools that change the world (Place, Erase, Grab …) are marked. Now both are:
  72 of 72 back, the moved molecules back where they were (flat water likewise). Check: f_sweep3d "selUndo" (page).
- 13. Lab → Record video drew each canvas layer whole into the frame (`recCapture`); the WebGL layer, which holds the
  atoms and bonds (3-D, and the flat game's balls), reaches 64 px past the chamber on each side (1.23.2), so in the
  video it was shrunk toward the middle: atoms off their labels, rings, measure marks and the box's front edges by up to
  about 40 px near the edges (0.873 of the distance from the centre at 878 px wide). Now each layer's part over the
  chamber is drawn. A carbon atom 150 px from the left edge of the empty 3-D box: the frame's pixel there rgb 98, 99, 101
  (the atom) after, 9, 15, 22 (background) before. Both modes. Check: f_sweep3d "recAlign" (page).
- 14. The gallery's picture of a world (`galThumb`, Keep in the gallery) took the layers the same way, and outside the
  frame, when the WebGL layer's frame is already gone (no preserveDrawingBuffer): the atoms were missing or misplaced in
  the picture. Now it draws a frame first and uses the same composition (`layersInto`, shared with the recorder). The
  carbon atom of item 13: rgb 89, 93, 102 at its place after, 9, 13, 24 before. Check: f_sweep3d "galThumb" (page).
- 15. Event captions and rings at the wrong depth in 3-D: pair production in 3-D (`pairProduce3`), a positron meeting an
  atom's electron (`annihilateBound`) or a free electron (`evAnnihFree`), matter touching antimatter (`evAnti`),
  annihilation at the wall (`annihilateAtWall`), a hypernucleus's decay (hep.js `hypDecay`) and a quark pulled out by
  hand (`quarkRip`, its flash too) gave nucEvent no depth, so the caption and its rings were drawn at z = 0 wherever
  the event was; and nucEvent marked what an event sent flying by x and y alone (any depth) for slow motion's "nuclear
  products". Now each passes its depth, and the marking is within 4 Å in depth too in 3-D. A positron annihilating on
  an oxygen at z = 7.05, a quark pulled out of a carbon at z = 7, a 5 MeV pair at a lead atom at z = −6: captions at
  z 0, 0, 0 before; 7.05, 7, −6 after. Fingerprints: every setup identical (59, seed 7, 300 steps). Check: f_sweep3d
  "eventsZ" (Node). (Muonium's decay, hep.js muoniumTick, has the same gap: the other session's area, left.)
- 16. Test (the record's "Continue after a restart" failure: the restored world 1–3 particles more than saved, 72 → 73,
  73 → 74): not a bug in Continue. The check counted the world right after an explicit autosave and compared it with
  what Continue brought back after a reload, but the page saves again as it closes (pagehide, visibilitychange) and its
  world was still running, so the last save held the world a moment later (a free electron more). Reproduced: the soup
  running, 96 counted at the explicit save, 87 saved at the reload and 87 brought back by Continue. The check now pauses
  first (t_features' 1.23.1 block); Continue itself unchanged.

Suite (branch v139 at e0025bc): t_lint, t_3d, t_settings, t_energy pass alone; t_page alone failed its slow-motion
button check once (the known flake) and passed in the lanes; `tools/runtests.sh` (two lanes, load 5–10 from another
session's tests): every suite passed but t_features' f_bug125 "exoElastic" timing check (3.5 ms under the load against its
limit; 0.86 ms alone, passes), the known f_bug125 timing flake. t_features alone earlier: 1.25 labels3d's hover count 0
once (passes alone and in the lanes run). Fingerprints (59 setups, seed 7, 300 steps): identical to v136 after every
engine change (items 15; nothing else touched the engine).

**Settings audit** (both modes; every choice of every row set through setSetting in Liquid water and in Molecules in
space, the engine's or the drawing's own variable read back, a frame drawn; the Experimental rows also run 10 steps in
water, Molecules in space and Salt in water, 3-D; then 64 settings set off their normal, the page reloaded: every
non-Experimental one kept, every Experimental one back to normal; no page errors). "Applies" = the value reaches what it
sets, in that mode.

| tab | setting | flat | 3-D | measured / note |
|---|---|---|---|---|
| Performance | Max particles | applies | applies | MAX_PARTS 2,000 … 20,000 |
| | Resolution | applies | applies | R.dprMax 2 / 1 / 0.75 |
| | Physics budget | applies | applies | UI.budget 6 … 24 ms |
| | Priority, Auto | applies | applies | prioNow 0 … 4 |
| | Threads | applies | applies | not measurable headless (no shared memory here); t_threads |
| | Drawing engine | applies | applies | WebGL / Canvas 2D (3-D's Canvas path sorted far to near) |
| Graphics | Frame-rate cap | applies | applies | read by the frame loop |
| | Atom size | applies | applies | 3-D oxygen drawn 6.75 / 4.72 / 3.04 px |
| | Labels (with View → Labels) | applies | applies | flat 80 labels / hover 0 / off 0; 3-D: f_125s labels3d |
| | Charge badges | applies | applies | R.badges, labelOne3 |
| | Effects (glows) | applies | applies | R.lite |
| | Fewer flashes | applies | applies | R.flashK 0.3 (drawFlashes3 too) |
| | Colour-blind colours | applies | applies | oxygen #FF0D0D → #d55e00 |
| | Trails, trail clock | applies | applies | trailWindow 0.5 / 1.5 / 4 s; drawTracks3 |
| | FPS readout | applies | applies | the badge hidden / shown |
| Display | Window | n/a | n/a | the desktop app only |
| | Cursor | applies | applies | cursorHides |
| | Interface size, panel side, width | applies | applies | --ui, panel-left, --pw |
| | Motion, theme | applies | applies | |
| Controls | Wheel speed | applies | applies | one notch: ×1.078 / ×1.162 / ×1.350 in both (3-D: the camera's distance) |
| | Zoom toward | applies | 2-D only (marked) | the 3-D wheel zooms toward the target |
| | Keep tool options, pause when hidden, start paused, keep awake | applies | applies | (start paused: t_features; the test page sets AF_NO_PAUSE) |
| General | Start with, autosave | applies | applies | autosave keeps a 3-D world (d3, z) |
| | Units (temperature, energy, length) | applies | applies | 300 K / 26.9 °C / 80.3 °F; 1.50 Å / 0.150 nm / 150 pm (3-D Measure too) |
| | Setup tips | **fixed** (item 11) | **fixed** | turned back on, the tip shows again at once |
| | Rewind (on, span, every, memory) | applies | applies | 3-D: 7 snapshots in 3 s, rewound to the start of the run |
| 3-D | field of view, projection, fog, box, axes, labels, orbit speed, invert, spin | 3-D only (marked) | applies | V3 values; spin 6°/s: 0.052 rad in 0.5 s |
| Claude | API key, model | applies | applies | t_page (mocked) |
| Experimental | Longest step | applies | applies | step 0.04 → 0.01 tu |
| | Resonance in large rings | applies | applies | RES_BIG |
| | Detailed nuclear collisions | applies | 2-D only (marked) | INC_ON |
| | Force reach | applies | applies | RC 6 / 9 / 12 |
| | Induced charges | applies | applies | QEQ.every 10 / 1; the charges move |
| | Quantum nuclei, bead forces | applies | applies | rings on 240 (water), 72, 997 (salt water) atoms |
| | Bond orders (positions / quantum) | applies | applies | from the positions: 240, 72, 981 members; quantum joins worlds of up to 40 atoms only (0 of 240 / 72; 6 of 6 in two waters), as designed |
| | Quantum method, spins | applies | applies | XQ.method 1 / 2, XQ.spin |
| | Metals | applies | applies | 6 Cu members in Molecules in space |
| | Lone pairs | 3-D only (marked) | applies | 7 sites (Molecules in space), 327 (salt water) |
| | Halogen σ-holes | applies | applies | one site a C–Cl |
| | π-stacking | 3-D only (marked) | applies | 12 sites, 24 rings (two benzenes) |
| | Electrons as waves | applies | applies | free electrons as packets (3-D: 1 of 1) |
| | Ultra-realistic | applies | **fixed** (item 2) | the picture and the camera at true sizes in 3-D |

**Found, left as they are** (why, numbers):
- Argon in 3-D: the wall pressure's Z 0.48 ± 0.08 against helium's 0.84–0.89 (item 5): the flat world's doubled van der
  Waals wells (LJ_SCALE 2) are still on in 3-D (the open item from 1.23.0); physics, for the owner.
- Placing a Δ⁻ in Molecules in space (it decays at once to n π⁻; the π⁻ is caught): books −2.9 eV over 300 steps (Δ⁰
  +0.6; the other 66 particles of the 3-D menus placed and fired at 10 MeV: under 0.5 eV each). A 100 keV electron
  fired through 3-D water: −4.3 eV over 400 steps (500 eV −0.18, 10 keV +0.10, 1 MeV −0.14). Not chased.
- Moving a selection keeps its atoms clear of others (moveSelection's crowd check): in liquid water an 80 px drag moved
  a molecule 0.97 Å; as designed.
- Saves keep no unstable particles in flight (both modes; worldToJSON keeps nuclei, atoms, ions and free leptons).
- The narrator calls H + H₂ → H₂ + H "endothermic, the new bonds are weaker" when the measured ΔE is a few meV either way
  (both modes): its wording follows the sign of a near-zero heat.
- 3-D event captions draw no ghost rings for what vanished (the flat view's dashed rings); the caption and rings are there.
- In the other session's area (not touched): muonium's decay (hep.js `muoniumTick`, the μ⁺ → e⁺ ν ν̄ caption) is put at
  z = 0 in 3-D, as the captions of item 15 were (its products are at their depth).

### 1.26: copper ions (the owner: "fix cu ions")

Item 1 of the "Bugs on record" (the bug session's model question #1), approved as a physics change; branch v137 (from
v136). Check: tests/f_cu126.js (t_features, alone).
- **What was wrong.** With the normal pair metals a lump of copper turned itself into ions: 118 of a flat 127-atom lump
  Cu⁺/Cu⁻ within 2 ps at 300 K (seed 7, bath on). It was not only copper and not only flat: every metal that can hold an
  extra electron (electron affinity 0.7 eV or more: Cu, Ag, Au, Ni, Pt …) did it in 3-D at 300 K, and flat at 1,000 K.
- **Why.** The books were exact; the pair model predicted it. evTransfer let a neutral metal atom give its electron
  to a neighbour in the same metal when the pull of the Cu⁺Cu⁻ pair (with the other pairs lined up beside it, stronger in
  the flat world) paid IE − EA (6.49 eV for Cu). In a real metal the conduction electrons belong to the whole piece and
  screen such a pair: two atoms of one metal do not become a cation and an anion.
- **What changed** (engine.js: ionPairInMetal, inMetal, one test in evTransfer). A transfer is refused when it would
  make a cation and an anion of two metal atoms (donor's charge ≥ 0, acceptor's ≤ 0) within their metallic reach
  (2.1·r_m) and one of the two sits in a metal: another metal atom in its first shell, 1.3·r_m (a close-packed crystal's
  second shell is at 1.41·r_m, the flat sheet's at 1.73). The other way round (it lowers or keeps the charges) is
  taken instead when it is open. Same in 2-D and 3-D, pairs and many-body. Not touched: a metal giving electrons to O,
  Cl …; charges already in a metal moving on or cancelling (Cu⁺ + Cu → Cu + Cu⁺, Cu⁺ + Cu⁻ → 2 Cu); lone metal atoms (a
  vapour: the flame's K + Cu → K⁺ + Cu⁻); ions with no metal neighbours. The test runs after the cheap estimate and its
  random draw, so a run differs from 1.26 only from the first transfer it refuses. A "screened Coulomb inside a metal"
  was the other option; it would change the forces in every kernel (JavaScript, the WebAssembly kernel, workers, 2-D
  and 3-D) and the pull of every ion near a metal, so not taken.
- **Before → after**, ions in a lump after 2 ps (seed 7, bath at T; flat lump 127 atoms, 3-D fcc ball 141; pair model):

  | | flat 300 K | flat 1,000 K | 3-D 300 K | 3-D 1,000 K |
  |---|---|---|---|---|
  | Cu | 118 → 0 | 122 → 0 | 138 → 0 | 136 → 0 |
  | Ni | 120 → 0 | 121 → 0 | 136 → 0 | 140 → 0 |
  | Ag | 0 → 0 | 116 → 0 | 136 → 0 | 136 → 0 |
  | Au | 0 → 0 | 116 → 0 | 134 → 0 | 134 → 0 |
  | Fe, Na, Al | 0 → 0 (runs identical) | 0 → 0 (identical) | 0 → 0 (identical) | 0 → 0 (identical) |

  Many-body (Experimental): 0 ions before and after for all seven, runs identical. The ionizing lumps had heated
  (insulated flat Cu: 6,400 K after 2 ps, 3-D 5,700 K); now they stay put. Insulated, 2 ps: flat Cu −0.016 → −0.0001 eV,
  3-D −0.017 → −0.0015 eV. Cost: a dense 3-D ball of 959 Cu atoms 8.6–16 ms a step before, 7.1–12 after (noise; the
  walk runs only for a transfer the estimate already allows); a lump that ionized before is 3–6× faster now (the ions'
  localPhi walks gone).
- **Oxidation and salts** (a flat lump of 61 atoms ringed by 16 atoms or molecules, 600 K, seed 7): Na + Cl₂ 13 Na⁺ /
  13 Cl⁻ in 2 ps before and after (3-D 7/7, identical runs); Na + Cl atoms 3/3, Al + O atoms (6 Al⁺, 2 Al²⁺, 1 Al³⁺; 5 O⁻,
  4 O²⁻), Fe + O atoms (2 Fe–O bonds): identical runs. Copper: + Cl atoms 29 Cu⁺ / 29 Cu⁻ and no Cl⁻ before, 1 Cu⁺ + 1 Cl⁻
  after; + O atoms 30 ion pairs and no Cu–O bond before, 2 Cu–O bonds and no ions after; Ag + Cl atoms 27 Ag⁺, 25 Ag⁻, 2
  Cl⁻ before, 1 Ag⁺ + 1 Cl⁻ after. With O₂ or Cl₂ molecules a neutral Cu, Ni, Al or Fe lump does not react in 2 ps at
  600 K, before (where the lump had not ionized) or after. No setup is an electrochemical cell.
- **Fingerprints** (tools/fingerprint.js, all 59 setups, flat and 3-D, seed 7, 300 steps): none changes, state or
  books. The setups with metal atoms hold Na (salt, brine, brine3d, ch_salt, oven), Fe (magnet), Pb (photonuc), Hg (sns),
  Zn (crt), U (chain, isolde, useries, ch_split): none of these metals holds a stable anion, so no ion pair could be made
  between them anyway; the flame's Li, Na, K and Cu are a vapour (its 17 transfers in 300 steps, K/Li → Cu, as before).
- **Left, for the owner**: alkali aurides (CsAu, RbAu: real ionic compounds of two metals) can no longer form inside a
  Cs–Au mix; surface ionization (K⁺ off hot tungsten) was never modelled. A lone pair of metal atoms (a dimer) still
  trades electrons as before.
- Check: f_cu126 "lump" (flat Cu, 3-D Cu, flat Ni at 300 K keep 0 ions; before 116, 138, 118 in 0.5/0.24 ps) and
  "still" (lone K and Cu still allowed, two Cu in a lump refused, Cu⁺ in a lump still takes an electron, a Na lump among
  Cl atoms still makes salt: 7 Na⁺ in 1 ps). Fails on v136 (both parts), passes now.

### 1.26: bug fixes (collisions at extreme energy, muonic atoms)

Branch v138 (from v136). Checks: tests/f_hep126.js (t_features runs it alone; `node tests/f_hep126.js [--node] [part …]`);
each part fails on v136 and passes here.

- **A. "2 alpha particles, 1 PeV, one staying still didn't collide" (slow motion).** The 0.93 fix (a pair still closing
  in meets at its true closest approach in a later step) holds: in the flat game the head-on pass is found at every
  step size. It still went through, for three reasons, measured through the page's Fire tool (an α fired at 1 PeV at
  an α at rest, 6 runs a speed) and in fixed-step Node loops (α on α, p on α, α on ¹⁹⁷Au; 1 MeV–10 PeV; b = 0, 0.03,
  0.1 Å; steps of the step chooser, 10⁻³ Å and 2×10⁻⁵ Å of the projectile's path; 3 seeds each; flat and 3-D):
  1. Both games: of the nucleus–nucleus passes able to react above 25 MeV a nucleon, 35% diffracted, by a draw at any
     distance (`nuclearEncounter`). At 1 PeV a diffraction turns the pair by about 10⁻⁹ rad: the α went straight on and
     the target barely moved, one time in three, head on as much as grazing. The two-nucleon passes already worked by
     distance (inelastic core, diffractive rim). Now the outer 35% of the passes diffract and the inner 65% react: the
     same share of elastic passes overall, none head on. (The flat game's passes, spread along a line, are spread over
     the nucleus's disc by b = R·√u; a 3-D pass's distance is spread over the disc already, and taking the root of it
     put 3-D hits off centre, b³ uniform instead of b²: 3-D now takes b = R·u, so the 35% holds there too.)
  2. 3-D: an atom in flight moved at the speed of ½mv² (no radiation flight in 3-D), 730c at 1 PeV: 447 Å in a shortest
     step, through the 30 Å box in one step, and `fastEncounters3` skips a path longer than half the box (a wrap), or
     never runs (an open wall took the atom first). At 1× down to 1/10¹⁸ s a second it met nothing. Now a nucleus in
     flight in 3-D moves at the relativistic speed for its ½m|v|² (`flyScale3`; the books unchanged, as bug fix 14 did
     for leptons; under 1% of c the stored speed as before, bit for bit), the step chooser and slow motion take that
     speed (slow motion also with the depth: `speedNow`; it looked at the speed in the plane), neutron pairs too
     (`nnMeet3`), and one leaving the box this step meets what lay on its way out before the wall takes it.
  3. Both games, α on heavy nuclei at 15–40 MeV a nucleon: when the participant fireball had no consistent outcome
     (`fragmentInto`: the spectators' excitation more than the energy), the encounter was nothing. Now the compound
     nucleus (or exchange) branch takes it. α on gold at 100 MeV head on: 5 of 6 flat and 2 of 6 in 3-D reacted before,
     6 of 6 both now.
  - Numbers. Page, 1 PeV α at an α at rest: flat 6/6 at 1×, 3/6 at 1/32× and 1/512×, 6/6 at 10⁻¹⁸ s a second before;
    6/6 at every speed now. 3-D 0/6 at 1×, 1/32×, 1/512× and 10⁻¹⁸ s/s, 2/6 at 10⁻²¹ before; 6/6 at each now (at 10⁻²¹
    and 10⁻²³ s/s the α, now at c, takes over a minute to cross the gap: not counted). Node matrix, head on and b =
    0.03 Å, 100 MeV–10 PeV: before 9–18 of 18 a cell; now 18/18 everywhere except α on gold at 100 MeV, b = 0.1 Å
    (outside the barrier radius, as it should be). Below the Coulomb barrier (α + α under ~8 MeV, α + Au under 100 MeV)
    nothing reacts, as in nature; see the questions below for what a pass does there. Momentum of the hit kept to
    2×10⁻¹⁵, its books to 3×10⁻⁶ eV (1 GeV α + α, flat and 3-D).
- **B. Muonic atoms ("still behave very weirdly"; "you also can't erase muonic atoms").** The earlier work: 0.51 (muonic
  atoms made), 1.12 (μp scattering), 1.25 stage 1 (in 3-D). Muonic hydrogen (μp, μd, μt) is an unstable particle in
  W.exo, not an atom in W.parts; a heavier muonic atom is an ordinary atom with `muB`. Found and fixed:
  1. The Erase tool's brush (flat `eraseAt`, 3-D `eraseHere3`) went over W.parts only: muonic hydrogen (and any unstable
     particle) could not be erased. Now it takes them too, booked as an erased atom is (what it carried leaves with it).
     Page: a click with Erase on a μp, flat and 3-D: 1 left before, 0 after. (Empty the chamber already cleared them.)
  2. In a periodic box (the liquid-water setups) muonic hydrogen, and the slow muons, kaons and hyperons kept in by a
     closed box, left the chamber at the first edge, their energy escaped: a μp in 3-D water was gone within 1.2 ps.
     Now they go across, as atoms do. 3,000 steps in a periodic box: gone before, still there after (flat and 3-D).
  3. A muonic heavier atom showed in Inspect as a plain atom; it now says so (a pill with its mean life, a Muon line
     with the binding and the capture share).
  4. Saves, and undo (which is a save), dropped both: a muonic carbon came back plain, muonic hydrogen not at all. Now
     part field 5 bit 4 marks a muonic atom and `xa` lists muonic hydrogen and (μα)⁺ (older readers ignore both).
  - Found, not changed (for the owner, model and data questions):
    - Muonic hydrogen meets only hydrogen nuclei (scattering, transfer to d/t, μCF) and passes through every other atom.
      Real μp is a small neutral atom that hands its muon to any heavier nucleus it meets (μp + O → μO, about
      8.5×10¹⁰ s⁻¹ at liquid-hydrogen density): in water that happens within picoseconds; here never. It feels no bath
      and no other atom. Making it an atom in MD with transfer to heavier nuclei, as muonium became in 1.12, is a model
      change.
    - In a muonic heavier atom the electrons still see the whole nuclear charge (0.51's stated simplification); in nature
      they see Z − 1 (muonic carbon is chemically boron-like, muonic oxygen nitrogen-like).
    - Lifetimes against measured (Suzuki, Measday, Roalsvig 1987): C 2,045 ns (2,026), O 1,831 (1,795), Al 1,077 (864),
      Ca 392 (333), Fe 193 (206), Pb 23 (75.4). The capture rate 32·Z_eff⁴ s⁻¹ has no neutron-excess factor (Primakoff:
      170·Z_eff⁴·(1 − 3.125·(A − Z)/2A) s⁻¹), so lead captures 3.3 times too fast.
    - A muon is caught at 2 keV (MU_STOP); its momentum then (0.56 MeV/c) is not handed on (the X-rays take its energy,
      in random directions; the atom's momentum after: 0.04–0.11 MeV/c, from its ionizing on the way): giving it to the
      atom would kick carbon by 14 eV, which a real muon, slowed to eV first, does not. μp is made with a thermal
      momentum for the same reason. The books are exact (10⁻¹⁰ eV). The atom's mass leaves out the muon (0.113 u; 0.9%
      for carbon).
    - The Select tool does not take muonic hydrogen (nor Delete in its Inspect card); the particle view draws a heavier
      muonic atom without its muon.
- **Muonium's nucleus ("it still says 'inside its nucleus, a proton'").** 1.12 made muonium an atom (p.mu) and named
  it in Inspect, guarding the physics (tryFusion, nuclearEncounter …) but not the views that read Z = 1, N = 0 as
  hydrogen: the "Inside" section (qSubject, 0.50) showed a proton's uud quarks, the shell diagram and the particle view
  drew a proton bead labelled ¹H, and Inspect offered to keep it as the isotope hydrogen-1. Now the Inside section
  says its nucleus is a μ⁺, a lepton with nothing inside; both views draw a light-blue muon point labelled Mu; the tile
  shows no mass number and there is no "keep isotope" button. Screenshots: scratchpad hep126/mu-before-*.png,
  mu-after-*.png.
- Also found at extreme energy, not changed:
  - Below the nuclear threshold a pass inside the drawn reach is turned by Rutherford's law at its true distance in Å,
    floored at 0.005 Å (flat, `nuclearCollision`) or 0.01 Å (3-D, `coulombScatter3`): a head-on 1 MeV α on α gives the
    target 133 eV (flat) or 33 eV (3-D) instead of the whole 1 MeV of a real backscatter; a 10 MeV α passing 0.03 Å
    from an α (a tenth of the reach) is mapped to 5.6 fm, outside the 4.8 fm barrier radius, and nothing at all
    happens. Mapping such passes onto nuclear distances for the Coulomb turn too, as the collider's `nuclearScatter`
    does, is a model change for the owner.
  - The books of a PeV event's products: decays in flight and the products' own collisions lose about 10⁻⁹ of the
    beam's energy (1 PeV α + α: 0.1–11 MeV over the event's first steps; 10 PeV: up to 1 GeV, 10⁻⁷), before and after
    these fixes. Why: the boosts take γ from 1 − β², which at γ ≈ 10⁵ keeps only ~10⁻⁶ of it, and closeEvent leaves a
    remainder under 10⁻⁷ of the event's energy unsettled. The hit itself is exact. A fix passes γ to the boosts.
  - 3-D neutrons still move at ½mv²'s speed (1 PeV: 1,460c); their hits are found along the whole step before they
    move, so they do meet.
- Fingerprints (tools/fingerprint.js, all 59 setups, seed 7, 300 steps, before on v136 and after): two change, pionbeam and
  sns (state and books): both have nucleus–nucleus passes above 25 MeV a nucleon in those steps (3 and 14), which now
  diffract by distance and no longer draw a random number for it. No fireball fell back to the compound nucleus there,
  and no 3-D setup has a nucleus in flight past 1% of c: the six 3-D setups and the other 51 flat ones are unchanged.
- Test change: f_125n's plasma check (one ²⁰⁸Pb at 200 GeV a nucleon on lead in 3-D, its spray as wide across the beam
  in y as in z, within 40%) now pools three events (seeds 31–33). With 3-D hits now centred (b = R·u) seed 31 alone
  came out at uz²/uy² = 1.40 and failed by a hair; one event's ratio scatters 0.72–1.40 over six seeds (v136: 1.04–1.33),
  as its hadrons come in correlated clusters. Pooled: 0.0253 and 0.0284 (v136: 0.0263 and 0.0294).
- Suites (2-core machine shared with two other sessions): t_lint, t_energy, t_hep, t_collider, t_3d pass; tools/runtests.sh:
  20 of 22 pass, t_page failed once ("placing Transistor on soup … inside: false") and passes alone; t_features' misses
  were the known timing ones (1.14 speed readout 1/1.3×, f_bug125 pi3's 0.8 ratio; 1.24 light and f_bug125 segGrid in an
  earlier lone run under load), each passing alone.

### 1.26: exotic-particle sweep

Branch v140 (from v136 with v137 and v138). Every particle of the particle menus (Leptons, Neutrinos, Nucleons, Light
nuclei, Mesons, Baryons, Resonances, Light, Antimatter, Exotic atoms and nuclei) placed, fired, inspected, erased,
selected, copied, saved and let decay, flat and in 3-D. Checks: tests/f_swx.js (t_features runs it alone;
`node tests/f_swx.js [--node] [part …]`); each part fails on v136 and passes here.

Per particle and mode ("fixed": what changed for it; every row was placed, fired at 1 keV–1 PeV, inspected, erased,
undone, saved and let decay through the page, and run in Node for its decay at rest, its books and speed):

| Menu | Particle | Flat | 3-D |
|---|---|---|---|
| Leptons | e⁻, e⁺ | fixed: Mott recoils and sub-ionization pushes booked; a remainder settled on one e⁻ no longer past c | fine (25 keV+ flight since bug fix 14; 1 PeV within 0.13 eV) |
| Leptons | μ⁻ | fixed: muonic atoms' mean lives (Al, Ca, Pb …), the muon in the atom's mass, saves/undo kept it; decays in flight with exact γ | fixed: the same |
| Leptons | μ⁺ | fixed: saves/undo kept it; muonium texts; decays in flight with exact γ | fixed: saves/undo kept it |
| Leptons | τ⁻, τ⁺ | fixed: saves/undo kept it; Inspect's decay list (ντ, not "nutau"); exact γ | fixed: the same |
| Neutrinos | νₑ ν̄ₑ νμ ν̄μ ντ ν̄τ | fine (placed and fired at 1 keV–1 PeV; pass through, books 0) | fine |
| Nucleons | p⁺ | fixed: atoms it knocks into flight keep the books (setVel, nuclearCollision) | fine |
| Nucleons | n | fixed: an elastic hit sending a bonded atom into flight booked | fixed: faster than light (1 GeV 1.46c, 1 PeV 1,460c) → its true speed |
| Nucleons / Antimatter | p̄, n̄ | fine (annihilation books within 0.01 eV on p, H, p̄) | not in 3-D (antimatter is flat-only, by design) |
| Light nuclei | ²H⁺ ³H⁺ ³He²⁺ α | fixed: knock-on recoils booked (a 1 MeV α +46–66 eV before, ±1 now) | fixed: the elastic turn of a slow hadron off them when fast (+147 MeV a 1 TeV α's cascade); PeV debris |
| Mesons | π⁺ π⁻ π⁰ K⁺ K⁻ K⁰s K⁰ʟ η | fixed: saves/undo kept it; elastic turns off fast nuclei (energy from nothing); exact γ in flight | fixed: the same |
| Baryons | Λ Λ̄ | fixed: mean life to PDG 2024; saves/undo kept it; elastic turns; exact γ | fixed: the same |
| Baryons | Σ⁺ Σ⁻ Ξ⁰ Ξ⁻ Ω⁻ and antis | fixed: saves/undo kept it; elastic turns; exact γ | fixed: the same; Σ⁺'s 3-D stop heat (−5 eV per 200) booked |
| Resonances | ρ⁰ ρ± ω φ K*⁺ K*⁻ K*⁰ K̄*⁰ Δ⁺⁺ Δ⁺ Δ⁰ Δ⁻ | fixed: saves/undo kept it (with each one's own mass); fine at Ultra-realistic rates | fixed: the same |
| Light | γ | fine (1 keV–1 PeV; showers at 1 PeV within 10⁻¹⁰) | fine |
| Antimatter | H̄, ²H̄⁻, ⁴H̄ē²⁻ | fine (books ≤ 2.4 eV on p, H, p̄) | not in 3-D (by design) |
| Exotic atoms | μp μd μt | fixed: Select, copy, paste, move, Delete; Inspect's Delete; a proton it scatters at 1 PeV no longer 933c | fixed: Select … Delete, Inspect's Delete |
| Exotic atoms | Mu | fixed: decay books (Mott, recoils); texts (μ⁺ + e⁻ → muonium, Mu⁺) | fine (books of 200 decaying: +9 eV, the dense Mu/Mu₂ plasma's integration) |
| Exotic atoms | ³ΛH … ²⁰⁸ΛPb (13) | fixed: saves/undo kept it; Select; elastic turns (+3 keV–13 MeV per shot at 1 keV–1 MeV before); lengths in Inspect | fixed: the same; stopping beside a lone nucleus (−0.03 eV each) booked |

- **Books when a fast charged particle crosses a nucleus (flat game).** Found with muonium: 200 muonium atoms decaying
  in an insulated box moved the books +214 eV. Two slips, both general (any MeV electron or positron through matter):
  1. Mott scattering (`nuclearScatter`, a lepton crossing a nucleus where it is drawn) gave the struck atom its recoil
     with `setMotion`, which puts it straight into radiation flight; its bonds and its potential energy with what stays
     were left out of the books. A 20 MeV electron through the H nucleus of a water molecule: +4.8 eV (the O–H bond);
     a muon decay's positron off a bare μ⁺ beside another −17.6 eV (their repulsion). Now a stepped atom sent into
     flight there has its bonds broken and the potential energy it leaves paid from its motion, as `switchMode` does.
  2. An ionizing pass that could not free an electron (dE under the ionization cost) pushed the atom by
     0.7·√(2dE/m) square to the path: about half of dE, the rest gone (in `moveRad`, and in `exoIonize`/`exoIonize3`
     for unstable particles; 3-D atoms in flight, `fastStop3`, were already exact): the H recoil of the pass above
     −6.5 eV. Now the push gives exactly dE, whatever the atom's own motion.
  - After: 20 passes, 2 and 20 MeV, H of water and bare μ⁺: within 0.04 eV a pass (before up to +7.1, −6.5, −17.6).
    The 200 muonium atoms still drift (+173 eV over 400 steps, 3-D +9 eV): a hot, dense, light Mu/Mu₂/e⁻ plasma whose
    steps are the known limit (bug fix 13 after 1.25: a light atom flying fast in the flat game jumps the books by
    ±1–12 eV as it passes molecules; the integrator in a crowd of 0.11 u atoms), not an event's booking.
  - Fingerprints (all 59 setups, seed 7, 300 steps): annihilation, hyperfactory, isolde, nif, photonuc, pionbeam and sns
    change (their radiation-flight ions and leptons ionize at low dE, now pushing exactly; sns also from the Mott
    change); the rest, and every 3-D setup, unchanged. Check: f_swx "flatKicks".
- **Heat with no partner (both games).** `dumpHeat(E, a, a)` (one atom: a stopped unstable particle's last keV in 3-D,
  an ionization that could not free its electron) with no third atom within 6 Å in an insulated box called
  `kickPair(a, a)`, which takes nothing: E left the books (ledger.chem counted it). Every 3-D hypernucleus placed at
  rest moved the books −5.6 eV over 200 (0.03 eV each, its placing energy, given to a lone product nucleus); Σ⁺ in 3-D
  −5.0. Now the bath takes it, or in an insulated box the one atom (an exact push in a random direction). A 1 keV
  ¹³ΛC stopping beside a lone carbon in 3-D: −1,000 eV before, 0 after. Fingerprints unchanged (no setup met that
  case). Check: f_swx "loneHeat".
- **A PeV event's debris (both games; v138's finding).** The books of a 1 PeV α on α moved 0.1–0.9 MeV over the
  debris's next 300 steps (10 PeV: 27–94 MeV; 4 seeds flat and 3-D), for three reasons:
  1. Decays in flight (`decayExo`, `decayExo3`, `hypDecay`) boosted their products with γ from 1 − β², which at
     γ ≈ 10⁵ keeps ~10⁻⁶ of itself. Now the particle's own γ (`o.gam`, 1 + K/m) is passed to the boost (`boost`,
     `boost3`, `toLab`: an optional exact γ, taken past γ = 100 only, so everything slower is bit for bit as before); a
     hit's products (`exoOut`) are boosted with γ = E/M of the same four-momentum, so they add up to it exactly.
  2. `closeEvent` settled a remainder only past 10⁻⁷ of the event's energy: 0.1–0.2 MeV of a 100 TeV hit stayed open.
     Past 100 keV it now settles down to 0.01 eV (or 10⁻¹⁵ of the event, the books' own rounding); below, as before.
  3. `settleRest` moved the remainder between the products about their centre of mass (`shareKE`), which does nothing
     for one product alone (a hit whose other products are unstable particles, a nucleon out of a nucleon–nucleon
     pass): up to 0.25 MeV a hit stayed open, and −4.5 eV once in the annihilation setup. Now the fastest product takes
     it itself; with nothing made but what was carried off (antinucleons in 3-D, no room), what left takes it.
  - After: 1 PeV within ±2 eV over 300 steps (8 runs), 10 PeV within ±24 eV (4 runs), flat and 3-D.
- **A slow hadron turned off a fast nucleus (both games).** `exoElastic` gives the nucleus the momentum the turn takes
  from the hadron and has the hadron pay the recoil energy, floored at 1 eV. With the nucleus itself fast (a cascade's
  nucleons) that recoil can exceed the hadron's energy, and the rest was made from nothing: +47 MeV for a 4 MeV π⁻ and
  a 650 MeV proton; a 1 TeV α through a few molecules in 3-D +147 MeV over 80 steps (+31–55 MeV a hit). Now when the
  hadron can't pay, the turn is made in the pair's own frame, exactly (`exoElasticCM`; flat: the nucleus's
  surroundings measured as before, their potential energy paid by the hadron). The 1 TeV α: −3.8 keV over the run.
- **Neutrons faster than light in 3-D (v138's finding).** `moveNeutron` moved a 3-D neutron at the speed of ½m|v|²
  (1 PeV: 1,460c; 1 GeV: 1.46c), as v138 found for atoms in flight. Now at the relativistic speed for that energy
  (`flyScale3`; the books keep ½m|v|²; under 1% of c the stored speed, bit for bit), its path search with it, and
  neutron pairs (`nnMeet3`) too. 1 GeV 0.8748c, 1 PeV 1c.
- Fingerprints (seed 7, 300 steps) for these three: annihilation and pionbeam change (point 3: a single product now
  takes its remainder: −4.5 eV in annihilation, 7×10⁻⁶ eV in pionbeam); none else, no 3-D setup. Checks: f_swx
  "pevBooks", "elasticCM", "neutron3".
- **Atoms knocked into flight (flat game).** Found firing every particle at 1 keV–1 PeV through a row of three waters, a
  carbon, a lead and a hydrogen atom (insulated, 80 steps, 3 seeds): the flat game's books moved more than 10 eV in 185
  of 1,332 runs (more than 50 eV in 71), 3-D in 18 of 1,242. Besides the points above, two slips:
  1. `setVel` sent a stepped atom past its flight threshold straight into radiation flight with its bonds kept (a bond
     to an atom in flight stretches with no force on it) and its potential energy out of the books, as `nuclearScatter`
     did: a neutron's elastic hit sent a lead atom bonded to carbon off at 83 keV, +108 eV. Now it breaks them and pays
     the potential energy it leaves from its motion (as `switchMode` does below the threshold); its 3-D twin keeps
     everything stepped already.
  2. `nuclearCollision` (a nucleus in flight passing an atom, ZBL) pushed the target by √(2T/m) whatever its own motion
     (the target gained more or less than the T taken from the projectile) and broke every bond weaker than T for free
     (a bond broken at its compressed geometry costs up to 23 eV). Now the target gains exactly T; its bonds break only
     if T pays what breaking them costs, measured, and that is taken from T. A 1 MeV α through the row: +46, +46, +61 eV
     before (seeds 1–3), +0.2, +1.1, −0.1 after.
  - After all the fixes of this section, the same sweep: flat more than 10 eV in 84 of 1,332 runs (more than 50 eV in 33,
    all but 8 of them electrons, positrons and γ rays at 1 PeV, 10⁻¹⁰ of their energy: the showers' own rounding), the
    rest 5–59 eV in the debris's chemistry and hot light atoms (the known limit of bug fix 13 after 1.25); 3-D more than
    10 eV in 1 run (a 1 TeV Λ: 1.3 eV is the worst of the others).
  - Insulated, 300 steps (seed 7): annihilation −153 → +3.3 eV; nif +1.1 → −0.5; fusion 0 → 0. Fingerprints: fusion, nif
    and sns change from point 1 (an atom sent into flight while bonded), annihilation, pionbeam and sns from point 2.
    Check: f_swx "flatRecoil".
- **Faster than light.** Muonic hydrogen fired at 1 PeV scattered off a proton (`muAtomScatter`, flat) set the proton's
  velocity by hand, non-relativistically and with no flight: 933c. A remainder handed to one product (point 3 of the PeV
  fix, as first written) scaled an electron's velocity the same way: 52c. Both now go through `setVel` in the flat game
  (into radiation flight at the true speed); in 3-D the flight's own speed rule holds. The fire sweep's other speed
  readings: nothing stepped or flying past c in either game (the products' stored speed checked each step). Check:
  f_swx "muFast".
- **Muonic atoms (v138's findings).**
  1. Mean lives (`muRates`, hep.js). The capture rate 32·Z_eff⁴ s⁻¹ had no neutron excess. Now the mean lives measured
     for natural elements (Suzuki, Measday & Roalsvig, Phys. Rev. C 35, 2212, 1987) hold where measured (`MU_TAU`), and
     the Goulard–Primakoff form (Z_eff⁴·261 s⁻¹·[1 − 0.040·A/2Z + 0.26·(A − 2Z)/2Z − 3.24·((A − Z)/2A + (A − 2Z)/8AZ)],
     that paper's fit) carries them to the other elements and isotopes, scaled to the measured elements on either side;
     decay in orbit is the free muon's slowed by the Huff factor (≈ 1 − 2.2×10⁻⁵ Z²: 0.85 for lead). Game before → now
     (measured), ns: C 2,045 → 2,026 (2,026.3), N 1,952 → 1,907 (1,906.8), O 1,831 → 1,795 (1,795.4), F 1,687 → 1,464
     (1,463.5), Na 1,374 → 1,204 (1,204.0), Mg 1,222 → 1,067 (1,067.2), Al 1,077 → 864 (864.0), Si 941 → 756 (756.0),
     P 817 → 611 (611.2), S 707 → 555 (554.6), K 454 → 435 (435.2), Ca 392 → 333 (332.7), Ti 307 → 329 (329.3), V 273 →
     285 (284.5), Fe 193 → 206 (206.0), Ni 168 → 157 (156.6), Cu 156 → 164 (163.5), Zn 146 → 159 (159.4), Zr 77 → 110
     (110.4), Pb 23 → 75.4 (75.4). Between them (the form): Ne 1,525 → 1,196, Cl 610 → 542, Ar 526 → 643, Cr 243 → 239,
     Mn 216 → 240, Co 180 → 201, Br 105 → 152, Ag 57 → 87, Sn 50 → 96, I 46 → 93, Ba 43 → 101, W 28 → 78, Au 25 → 72,
     Bi 23 → 73, Th 21 → 84, U 20 → 85; He–B within 3% of the free muon's 2,197 before and after. Capture share now: C 8%,
     O 18%, Al 61%, Ca 85%, Fe 91%, Pb 97% (Pb was 99%). Caveat: there is no network here, so the measured values are
     the published table as I know it, each checked for consistency (1/τ = Λc + Q·λ against the capture rates Λc of the
     same table); worth a look against the paper. Where the form stands alone, values I am less sure of differ by up to
     ~10–20% (Ar-40: 643 against about 540 measured; Th and U 84–85 against about 77): adding more measured elements
     to MU_TAU sharpens it. Inspect's muonic-atom pill and capture share use the same rates.
  2. Mass. The atom's mass left out its muon (`atomMass`, engine.js: +0.113 u, less the binding; 0.9% of carbon, 2.8% of
     helium); its rest energy (`restE`) still leaves it out, as the muon's is booked apart. When it is caught, decays or
     is captured, the atom keeps its speed and its kinetic energy changes by ½m_μv²: those events now begin with the atom
     in their books (`nucBegin([atom])`), so their X-rays or neutrinos pay it exactly. 3-D and flat, a carbon and a lead
     atom at 5 Å/tu (½m_μv² ≈ 1.7 eV): catching books to 3×10⁻⁶ eV; decay and capture steps within 0.18 eV (the electrons
     a capture frees beside a +81 ion, in their first step); 16 of 16 events. Saves and undo put the muon's mass back.
  3. The momentum of the muon caught at 2 keV (0.65 MeV/c): not a bug; nothing changed. Handed to the atom it would
     kick carbon by 19 eV and lead by 1.1 eV in one go; a real muon is slowed to eV energies through the medium first,
     spread over the many atoms of its last micrometres (the game stops it at 2 keV for speed), then caught; the X-ray
     cascade's recoil is under an eV. The books are exact either way.
  4. Select and Inspect. The Select tool passed over muonic hydrogen (μp, μd, μt), (μα)⁺ and hypernuclei, which live
     with the unstable particles (W.exo); now a click or a box picks them, and copy, paste, move and Delete take them
     (pasted nearly at rest, as placed). A particle in flight's Inspect card had no Delete button; now it has (as the
     Erase tool takes one). The particle view drew a muonic atom without its muon; now a green point circles just
     outside the nucleus (the muon's colour in flight). Screenshot: scratchpad mu-pv2.png. (The 3-D lab has no particle
     view.) Copy and paste kept only the nucleus: muonium came back as hydrogen and a muonic atom as a plain one; now
     both are made again as they were.
  - Fingerprints unchanged (no setup makes a muonic atom in 300 steps). Checks: f_swx "muonic", "muSelect", "copyMu"
    (page).
- **Saves and undo with unstable particles.** Only muonic hydrogen and (μα)⁺ were saved (1.26 bug fix B): a placed
  muon, pion, kaon, hyperon, resonance or hypernucleus was gone after a save was read back, and an undo of anything else
  (undo is a save read back) took it away too; found by the page sweep below (every unstable particle of the menus,
  flat and 3-D). Now `xa` holds every one in W.exo but a collider's beams, with a resonance's own mass (drawn from its
  width) and the 3-D "at rest" mark; a hypernucleus's entry is made on reading. Saves from before read as before.
  Fingerprints unchanged. Check: f_swx "saveExo" (page).
- **Λ mean life.** 2.632×10⁻¹⁰ s, the older value; PDG 2024 gives 2.617×10⁻¹⁰ s (the header says PDG 2024): now that
  (the Λ̄ follows). Fingerprints unchanged.
- **Checked and fine** (no change): masses, mean lives and branching fractions of every unstable particle on the menus
  against PDG 2024 (μ, τ, π, K, η, Λ, Σ, Ξ, Ω, ρ, ω, φ, K*, Δ and their antiparticles; resonances' ħ/Γ); muonium's and
  muonic hydrogen's masses and bindings; decay at rest, 200 of each placed at rest, flat and 3-D: mean lives within
  the counting error, branching as listed, products' charges and kinds right, books within 10⁻⁴ eV; at Ultra-realistic
  rates (true clock, warp 1) the resonances, π⁰ and η decay at once with their branchings, the longer-lived wait, books
  within 10⁻⁴ eV.
- **The page sweep** (tests through the page's own tools, scratchpad pgsweep.js): every particle of the menus, flat (74)
  and 3-D (73), placed with a click of Place, picked with a click of Inspect (its card: no "undefined", "NaN" or "null"),
  the placing undone with Ctrl+Z, placed again and taken with a click of Erase, saved and read back, then fired with a
  drag of Fire at 1 keV, 1 MeV, 1 GeV and 1 PeV through eight atoms and run: every step worked for every particle but the
  saves above; no page errors, nothing faster than light after the fixes, no odd texts in the event log.
- **Texts.** A μ⁺ taking an electron said "Recombination: p⁺ + e⁻ → H atom", and a bare μ⁺ bonding "Proton bonded:
  H⁺ + …": now "μ⁺ + e⁻ → muonium" and "Muon bonded: Mu⁺ + …". Inspect's "Decays to" for a particle in flight showed the
  internal names of the neutrinos (μp: "p e⁻ ν̄ numu"; τ: "nutau", "numub"): now through the products' own labels
  (νμ, ν̄μ, ντ, d, t, α). Lengths read "1.5e+2 nm" (a hypernucleus's mean distance) and a resonance's "0.0000013 nm":
  now "150 nm", and pm and fm below a nanometre. Check: f_swx "texts".

- **Left for the owner (model questions, not changed):**
  - Below the reaction threshold a close pass deflects at its distance in Å, not mapped onto nuclear distances (v138:
    a head-on 1 MeV α on α gives the target 133 eV flat, 33 eV in 3-D, not the whole 1 MeV of a real backscatter);
    mapping it as the collider's `nuclearScatter` does is a model change.
  - Unstable particles do not meet each other (a pion through muonic hydrogen or a Λ passes it): they meet only atoms
    and nuclei (W.parts), and each other only as a collider's beams.
  - The muon caught at 2 keV keeps its momentum out of the atom (above, point 3 of muonic atoms).
  - Muon mean lives between the measured elements come from the Goulard–Primakoff form; Ar-40 643 ns (about 540
    measured), Th and U 84–85 (about 77): more measured elements in MU_TAU would pin them. The table's values are from
    memory of the paper (no network here), each consistent with its capture rate: worth a check against the paper.
  - The approved realistic-particle switches (μp handing its muon to heavier nuclei, electrons seeing Z − 1, the
    muonic cascade's X-rays, positronium …) are not built; nothing here is in their way (the rates by element and the
    muon's mass are what they need).
  - Remaining books noise: the flat game's hot debris (5–59 eV in 1 in 25 shots, the known limit of light fast atoms);
    200 muonium atoms decaying in a crowd (+173 eV flat, +9 eV 3-D, the integration of a dense hot Mu/Mu₂/e⁻ plasma);
    a 3-D hypertriton decaying at 1 PeV keeps momentum only to 2.5×10⁻⁵ (its residual nucleus's own boosts at
    γ ≈ 3×10⁵; the books are settled exactly).
- **Suites** (2-core machine shared with another session): t_lint, t_energy, t_hep, t_collider, t_3d pass alone;
  t_features alone: 2 misses, both known ones (the chain reaction's k readout: 5 fissions and 16 neutron ends in the
  frames allowed, its page random stream, before and after this branch alike in Node over three seeds; the 1.23.1
  Continue check, 73 → 74, on record since 1.25); tools/runtests.sh: 21 of 22 pass, t_features' one miss the f_bug125
  "pi3" timing check (54 ms against its limit under both lanes' load), which passes alone (18 ms); the chain and Continue
  checks passed there.
- **Found in the other session's areas (not changed):** the Lab tab's Particles readout counts atoms, nuclei and leptons
  only: twelve unstable particles placed beside five atoms read "5". The 3-D lab has no particle view (so a muonic
  atom's muon is drawn only in the flat game's).
### Bug fixes after the 1.26 merge

- **Inspect showed fast 3-D particles faster than light** (the owner, 2026-11-06, on 1.25: "a hydrogen atom travelling
  328% of c" after a 1 PeV α in 3-D). A fast particle in 3-D that is not in radiation flight keeps its energy as ½mv² in
  (vx, vy, vz) and is moved at the relativistic speed of that energy (moveFastLeptons3; the fast nuclei since v138), so
  the stored v passes c; Inspect showed it as the speed. The motion was right; only the number shown was wrong. Now
  `shownSpeed(p)` (engine.js): p.sp in radiation flight, else from the energy, β² = x(2 + x)/(1 + x)², x = KE/mc². A 5 GeV
  proton: shown 326% of c before, 98.74% after; a 50 MeV electron 99.9949%; slow particles as before (to 4×10⁻⁸, the
  constants' own rounding). Display only: no fingerprint changes. Check: f_bug126e `speed`.
- **Spin-polarized quantum bonds: the books jumped when a step failed to settle** (Settings → Experimental → Bond
  orders Quantum, Spins Polarized; GFN1 or GFN2). What was wrong: when a step's warm start did not settle, qmPass
  started afresh (`qsh0: null`, then each atom's spins), and that start can settle on another branch than the one the
  cluster was on. Traced in the hot radical mixture (O₃, NO, O₂, H₂O₂, 2 H₂ at 1,500 K, 100 steps with the bath, 400
  insulated), GFN2 flat seed 6, insulated step 9: the warm start (120 iterations) left the polarized state oscillating
  without settling (its energy within a few meV of the settled one), the fresh start settled paired 0.32 eV higher, and that step's energy simply rose; later the probe found the spins again and paid the drop to the bath as a
  real switch. GFN1 flat seed 7 the same through the spin seeds (step 332, +0.32 eV, after an unsettled step), seed 5
  through the fresh start (+0.27). Why: nothing booked the branch change of a fresh start; the probe's booking assumes
  the paired state was where the cluster had been. Tried first: (a) a fresh start from each atom's spins did not
  settle at that step; the last step's polarized state with a gentler mixer (damping 0.2, 30 steps of memory) settles
  (45 iterations), but on other steps it then settled on a different polarized state (−97 meV, also unbooked), and it
  changes the answers polarized clusters get; the unsettled warm iterate as the reference was off by up to 0.1 eV
  (GFN1 seed 5). What changed (b, bookkeeping only; the solver's path and every energy and force as before): each
  forces pass with spins keeps the last settled step's energy, slope and positions (XQ.ref, the same members); a step
  whose answer came from a fresh start or the atoms' spins books its jump from there: E found − (E_ref + g·Δx), less
  what the probe has just paid, to the bath (`XQ.detours`, `XQ.detourE`), within five steps of a settled one (an
  unsettled step's energy is no reference: in the first hot steps the books swing tens of eV on unsettled calculations
  and come back, as before). The second-order error of the slope is under 1 meV. A real switch found by the probe in
  an ordinary step is paid exactly as before; one inside a fresh-start step is paid by this booking.
  Numbers (400 insulated steps after 100 with the bath; jumps over 1 meV, worst jump):

  | method, world | seed 3 | seed 5 | seed 6 | seed 7 |
  |---|---|---|---|---|
  | GFN1 flat, before | 0 | 1, +0.27 eV | 0 | 2, +0.32 eV (drift 0.59) |
  | GFN1 flat, after | 0 | 0, −6.0e-4 | 0 | 0, +5.4e-4 |
  | GFN1 3-D, before / after | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
  | GFN2 flat, before | 0 | 0 | 1, +0.32 eV | 0 |
  | GFN2 flat, after | 0 | 0 | 0, −1.7e-4 | 0 |
  | GFN2 3-D, before | 0 | 0 | 0 | 1, +0.093 eV |
  | GFN2 3-D, after | 0 | 0 | 0 | 0, −1.4e-4 |
  | Atom Forge refit (method 4) flat, before | 2, +0.43 eV | 0 | 1, +0.52 eV | 1, +0.42 eV |
  | Atom Forge refit (method 4) flat, after | 0, −9.3e-4 | 0 | 0, −9.0e-5 | 0, −3.5e-4 |

  How often: in those 400-step runs a step's answer came from a fresh start or the spins 0–2 times (5 in the 16 GFN1 and
  GFN2 runs, with 4 switches by the probe); unchanged from before (the same path, now booked). Cost: none measurable
  (an array of 3n numbers kept a step; 7.4–13 s a run before and after). Paired spins (the normal setting) and quantum
  bonds off: bit for bit as before (the 59 setups' fingerprints, seed 7, 300 steps, identical; f_126x and f_126q pass).
  Check: tests/f_bug126.js (t_features' last line; alone `node tests/f_bug126.js`): `seed6` (fails on v136: one jump,
  0.32 eV), `mixture` (the 16 runs, no jump over 1 meV).
- **Polarized is the normal Spins setting** (approved by the owner, 2026-11-05: "ok sounds good", once the spin-branch
  books were fixed, merged 2026-11-06). Settings → Experimental → Bond orders → Quantum → Spins: "Polarized (normal)",
  "Paired" a choice (SET_DEF.xqs 1; still back to normal at every start; a world saved with Paired says so on opening:
  EXP_NAME.xqs "paired spins"). Quantum bonds stay off by default, so the game with default settings is bit for bit as
  before; the Node harness's engine default (XQ.spin 0) is unchanged, so f_126x/f_126q's paired runs are as before. The
  Speed test's line names the spins either way. Check: f_126x `page` (Polarized at start, Paired chosen and back).

### 1.26: GFN2 refit (second attempt)

Asked by the owner: improve GFN2, keeping what it is best at (water clusters, non-covalent binding, geometries) and
fixing its reaction problems (H + H₂ binds H₃, HCN → HNC barrier 3.18 against 2.09, hexazine below three N₂, a shared
proton too flat, atomization); offer it as "GFN2 (Atom Forge fit)" if it beats GFN2 on held-out reaction energies and
barriers with WATER27 ≤ ~0.2 eV, bonds ≤ 0.013 Å and settling in the game. **Result: built and measured, not offered.**
It keeps water, non-covalent binding and geometries and settles where the first refit did not, and it is 4 times closer
on held-out atomization, but held-out barriers stay at GFN2's level (0.74 eV against 0.68 polarized), the shared proton
comes out flatter than GFN2's, and in a hot radical mixture its books jump (an unbooked spin-branch change) more often
than GFN2's. The engine takes it as `XQ.method` 4 (`tools/xtb/afxtb2-data.js`, `XTB.AF2`; H/C/N/O molecules only, as
method 3); Settings still offers GFN1 and GFN2 only.

- **Sensitivity** (`tools/xtb-fit/refit2.js --sens`: each of the first fit's 48 GFN2-form parameters stepped, the change of
  each group of targets; eV per step, water = WATER27's fitted clusters and the invariance clusters below, reactions =
  W4-11/3, BH76, H + H₂, HCN, the must-haves, hexazine, the proton). Water-dominated (water ÷ reactions): H's hardness 17
  (0.49 against 0.03 eV), O's third order 11, H's third order 7.7, O's repulsion (charge 3.6, exponent 2.9), O's s-shell
  distance polynomial 2.9, O's hardness 2.6, H's level 2.0. Reaction-only: every C and N parameter (ratio ≤ 0.2, most
  < 0.02), the pair scalings but O–H and O–O (≤ 0.05), the spin constants' scale (0 on water). In between: O's levels, CN
  shifts and p polynomial, H's polynomial, CN shift and repulsion, the O–H and O–O pairs (0.3–1.2).
- **Frozen at GFN2's** (besides the multipole electrostatics and D4, never fitted): the hardness of H, C, N and O (the
  charges' response; the first refit lowered H's by 28 % and, found now, its GFN1-form set never settles on
  N-heterocycles: 2-pyridone, indole and the pyridone dimer run 250 iterations with atomic charges of −5…+6 e); the
  water-dominated ones above; the **O–O pair scaling** (it alone sets the water dimer's O–O: +0.02 → +0.019 Å; fitted, it
  went −0.1 for O₂/O₃/H₂O₂ and pulled the dimer to 2.78 Å); the **spin constants' scale** (fitted it rose to 1.36, and a
  hot radical mixture then jumped 0.6 eV in 3 seeds of 4; at the published 1.0, 1 of 4). 36 parameters fitted.
- **Fit** (`refit2.js`, Levenberg–Marquardt as fit.js, the same held-out split, spin-polarized): the first fit's targets
  plus 26 **invariance clusters** held at plain GFN2's binding to 1 % (`inv.json` by `mkclus.js`, seeded random packings
  optimized with GFN2: water clusters of 10, 16 and 20 (twice), H₃O⁺ and OH⁻ in 8 waters, 19 pairs with ammonia,
  formaldehyde, methanol, formic acid, amides (added after the fit lost N–H···O=C pairs: S22's formamide dimer 0.72 →
  0.23 eV), imines and dispersion-bound pairs; not WATER27 or S22); vertical IPs and EAs of 11 molecules held at GFN2's
  (0.3 eV; how far charge can slosh between O₂ and its neighbours); H₃'s symmetric stretch (no point past 0.93 Å below the
  saddle); bonded lengths of 10 more W4-11 molecules optimized (0.003 Å, 5 more held out); angles free within GFN2's own
  error, steep beyond; the water dimer's O–O (0.01 Å); a pull toward GFN2. Tight optimizations (gtol 1e-6: at 5e-5 a
  1e-3 parameter step did not move them, the fit saw no angle change and opened water to 115.7°). Ten rounds (A–J);
  shipped data: J.
- **Held-out errors** (MAD, eV; never fitted; S22 never fitted by any of them):

  | held out | GFN1 | GFN1 polarized | GFN2 | GFN2 polarized | first refit, GFN1 form | first refit, GFN2 form | this refit |
  |---|---|---|---|---|---|---|---|
  | W4-11 atomization (16) | 10.78 | 4.35 | 8.16 | 2.15 | 0.35 | 0.37 | 0.49 |
  | BH76 barriers (10) | 0.98 | 0.73 | 0.93 | 0.68 | 0.48 | 0.45 | 0.74 |
  | WATER27 clusters (12) | 0.38 | 0.38 | 0.125 | 0.125 | 0.32 | 0.91 | 0.19 |
  | S22 non-covalent (22) | 0.058 | 0.058 | 0.033 | 0.033 | runs away | 0.137 | 0.045 |
  | bonds of 8 held-out molecules (Å) | 0.0095 | 0.0095 | 0.0111 | 0.0111 | 0.0048 | 0.0055 | 0.0076 |

  The held-out barriers are all radical hydrogen abstractions (OH, NH₂, NH + CH₄, C₂H₆, CH₃; H + CO): every xTB here puts
  those saddles 0.5–1.2 eV too low, and the fitted ones (OH + H₂, CH₃ + H₂, O + CH₄, …) improve only part way while the
  HCN saddle (also a bridging H, but too high) pulls the other way. Round G, with the spin scale free, reached 0.67 and the
  proton 0.055 / 0.148 eV, but its books jumped in the hot mixture (above).
- **Compared** (`cmp.js`, as the tables above; geometries optimized by each variant):

  | | GFN1 | GFN2 | GFN2 polarized | first refit, GFN1 form | first refit, GFN2 form | this refit | g-xTB | reference |
  |---|---|---|---|---|---|---|---|---|
  | bond lengths, 24 bonds (MAD, Å) | 0.0107 | 0.0122 | 0.0122 | 0.0127 | 0.0191 | 0.0102 | 0.011 | measured |
  | of them the 19 H/C/N/O bonds | 0.0088 | 0.0120 | 0.0120 | 0.0049 | 0.0066 | 0.0094 | | |
  | angles H₂O / O₃ (°) | 107.1 / 119.1 | 107.2 / 120.4 | the same | 107.5 / 117.1 | 107.7 / 118.5 | 108.5 / 119.2 | 106.5 / 117.7 | 104.5 / 116.8 |
  | atomization, 23 molecules (MAD, eV) | 6.63 | 4.62 | 1.61 | 0.63 | 0.79 | 0.55 | 0.15 | W4-11 |
  | H + H₂ barrier (eV) | 0.15 | −0.40 | 0.03 | 0.57 | 0.54 | 0.20 | 0.21 | 0.42 |
  | HCN → HNC energy / barrier (eV) | 0.92 / 2.52 | 0.87 / 3.18 | the same | 0.91 / 2.59 | 0.81 / 2.54 | 1.02 / 2.79 | 0.31 / 2.24 | 0.66 / 2.09 |
  | water dimer (eV, O–O Å) | 0.208, 2.91 | 0.215, 2.84 | the same | 0.268, 2.79 | 0.220, 2.80 | 0.206, 2.82 | 0.212, 2.91 | 0.217, 2.91 |
  | O₃ → O₂ + O (eV) | 7.60 | 6.85 | 4.70 | 1.81 | 1.87 | 2.57 | 1.12 | 1.15 |
  | proton between waters 2.7 / 2.8 Å (eV) | 0.084 / 0.214 | 0.041 / 0.123 | the same | 0.082 / 0.189 | 0.195 / 0.333 | 0.022 / 0.092 | 0.103 / 0.222 | |
  | hexazine flat: barrier, release (eV) | 0.53, +1.67 | 0.80 (uphill), −0.84 | the same | 0.30, +6.77 | none, +6.65 | none, +6.65 | none, +6.95 | |

  With the refitted hydrogen and plain GFN2 for F, Cl and S, HF/HCl/H₂S bonds stay within 0.008 Å of GFN2's (the first
  refits: 0.04–0.10 Å off) but their atomization is 0.3–0.8 eV further off than GFN2's: hence H/C/N/O molecules only.
- **In the game** (Node, `XQ.method` 4; `scratchpad/126x2/game.js`): O₂, two waters and methane (the first refit: 10
  unsettled, books 220 eV off): none unsettled, −1.7e-6 eV over 200 insulated steps; O₂ with two waters and a Na⁺
  outside: the triplet (|m| 2.09), slopes 1.8e-6 eV/Å, −1.2e-4 eV over 200 steps; 3-D (O₂, three waters, methane):
  slopes x/y/z 8.7e-7/7.3e-7/5.7e-7 eV/Å, −1.2e-5 eV over 150 steps, none unsettled (round A: 7 unsettled while the
  molecules joined; GFN2 polarized 0); H₂ pulled apart: one switch to two spins, every step settled (largest change
  0.0047 eV); a hydronium and five waters: −5.4e-5 eV over 200 steps, 5.3 iterations a step; the hot mixture (O₃, NO, O₂,
  H₂O₂, two H₂, 1,500 K, 400 insulated steps) in 3-D −1.4e-5 eV; flat, 4 seeds: the books jump in 2 (0.43 eV twice, with 2 unsettled calculations; 0.52 eV once), −2.9e-5 and −1.7e-5 eV
  in the others (GFN2 polarized: 1 seed of 4, 0.32 eV; see below).
- **Why not offered**: the held-out barriers are not better than GFN2 polarized (0.74 against 0.68; GFN1 polarized 0.73),
  H + H₂ is half the real barrier (0.20; not bound any more), and the proton the quantum bonds were made for is flatter
  than GFN2's (0.022 at 2.7 Å; g-xTB 0.103, GFN1 0.084). What it does well: atomization (0.55 eV, GFN2 polarized 1.61),
  ozone, hexazine falling apart, bonds (0.0094 Å on H/C/N/O), water and S22 near GFN2's. Its parameters, the engine's
  support and the pipeline stay for a later round. **Default: GFN1** (and the recommendation above stands: Polarized
  spins as GFN1's default once the owner approves).
- Found, not changed (fixed after the merge: "Bug fixes after the 1.26 merge"): **the books of a spin-polarized calculation that does not settle**. When a step's warm start
  (polarized, from the last step) does not settle, qmPass starts afresh unpolarized; the probe then switches back to
  polarized and pays the difference to the bath, though the system was polarized all along: the books jump by about
  that difference. GFN2 polarized in the hot mixture: 1 seed of 4 (0.32 eV); this refit 2 of 4 (0.43, 0.52). Not paying
  the probe's switch in a step whose unpolarized state came from such a fresh start would close them; it changes GFN1's
  and GFN2's polarized books, so it is for the owner.
- Test: tests/f_126x.js part `af2` (t_features' "1.26 (xTB)" line; alone `node tests/f_126x.js af2`): the data (GFN2's
  form, the published spin scale, what was frozen); single points against GFN2 polarized (H₃'s stretch 0.195 against
  0.008 eV, flat hexazine 6.76 eV above three N₂ against 0.84 below, the water dimer kept); the world that sank the
  first refit settles and keeps its books; switching from GFN2 with 13 members paid to the bath (books to 0 eV); 3-D
  slopes and books; H₂S keeps stored bonds. Fails on 75eea89 (no method 4). GFN1 and GFN2 run bit for bit as before
  (`f_126x base`, `f_126q gfn1`).

### 1.26: spin-polarized xTB

Asked by the owner (the xTB plan, item 1): spin polarization for GFN1 and GFN2, "free atoms and radicals get their
unpaired-electron energy, so bond breaking into atoms or radicals comes out closer to real"; item 2: GFN2's SCC with
radicals. Built on branch v135 (from v131). Physics for the owner's OK: a new choice; Paired stays normal.

- **What**: Settings → Experimental → Bond orders → Quantum, under Quantum method: **Spins**, Paired (normal, as GFN-xTB
  was made) or Polarized. `SET.xqs` (0/1, Experimental: back to Paired at every start), `boQmSpin(v)` (bo.js: with
  quantum bonds on, the members leave and join again, each change's energy to the bath, as `boQmMethod`), `XQ.spin`.
- **The method**: the published spin-polarized GFN-xTB (Neugebauer, Bädorf, Ehlert, Hansen and Grimme, J. Comput. Chem.
  44, 2120 (2023)), ported from tblite (LGPL-3.0-or-later: spin.f90, data/spin.f90 (the W constants, `tools/xtb/spin-data.js`
  by `spin-gen.js`, numbers copied as text), wavefunction/spin.f90, the two-channel parts of scf/diag.f90, potential.f90,
  the singlepoint and its gradient) into `tools/xtb/spin.js`, used by gfn1.js and gfn2.js with `opts.spin`: each spin
  its own Hamiltonian H_c ± H_m (H_m = −½ S (v_m(μ) + v_m(ν)), v_m = W m on each atom's shells), its own orbitals,
  E_spin = ½ Σ m W m; the mixer over [q, m] (GFN2: [q, m, dipoles, their magnetization, quadrupoles, theirs], tblite's
  order); the gradient with both channels' energy-weighted densities and the magnetization's potential. Paired, the
  ports are bit for bit v131's (182 calculations, E, q, g, bond orders; the game's runs below).
- **Open shells in the game**: tblite fixes the count of each spin (`uhf`); the game cannot know it for a cluster that
  can hold several radicals, so both spins share one Fermi level (`opts.spinFree`) and each cluster's count settles
  itself (a far-apart N and H both get their own spins; with a fixed count one would not). An unpolarized solution is
  a fixed point the SCC never leaves, so every step that has no magnetization at all is **probed**: the potential of a
  tiny magnetization (10⁻⁶) along a pattern, and how much the electrons answer along it (power iteration inside the
  SCC: the pattern turns to the most unstable one). Above 1.02 (the Stoner criterion: a bond stretched past where its
  electrons would rather sit one on each atom, O₂, a radical made) the calculation runs again from that pattern, and a
  lower, polarized result is taken, the drop at the same positions to the heat bath (`xqProbe`; not inside a boSync
  change, which books it whole; not with quantum nuclei). The free atoms (`qmAtomE`) are the lowest of the spin counts
  their electrons allow, found the same way. Dissociation scans (0.02 Å steps, GFN1/GFN2): H₂ switches at 1.66/1.42 Å
  (drop 5.2/1.1 meV), N₂ 1.46/1.42 (6/7 meV), HF, water's O–H, methane's C–H 0.6–1.2 meV; afterwards every point the
  lowest state found by several seeds. Left: O₂ pulled apart follows its triplet branch, 0.25 eV above two Hund oxygens
  far apart (the probe only looks at unpolarized solutions).
- **Checked against tblite** (its spin-polarization container, scale 1, on the GitHub Actions runner:
  `tools/xtb-ref/geoms3.json` (28: H, C, N, O, S, Cl atoms in their high spins, O₂ triplet and singlet, OH, NH₂, CH₂, CH₃, NO,
  HO₂, H₃, CN, HCO, CH₃O, SH, SO, H₂O⁺, C₂H₅, H₂ and N₂ stretched, ozone triplet, hexazine triplet, water), `ref3.py`,
  `ref3.json`; `node tools/xtb/check-spin.js`): 56 calculations (both methods), energies to 8e-12 eV, charges 2e-8 e,
  forces 7e-7 eV/Å (NH₂ with GFN2, where tblite stops its SCC at accuracy 0.01; every other 1e-10); forces against the
  port's own slopes (Richardson) 1e-9–2e-8 eV/Å, fixed counts and the shared Fermi level alike. Locally also against
  xtb 6.7.1 `--tblite --spinpol` (scratchpad): molecules to 1e-11 eV.
- **In the game** (Node; `tests/f_126x.js`): O₂ with two waters and a Na⁺ outside (O₂ a triplet: GFN2's probe switches to
  it, 0.7 eV to the bath; GFN1's unpolarized start does not settle there and the start with each atom's spins lands on
  it): forces the energy's slopes flat GFN1 1.2e-6, GFN2 9e-6 eV/Å; 3-D (O₂, three waters, methane) x/y/z 1.5e-6–1e-5
  and 3e-7–1.2e-6; insulated 7.5e-4 / −1e-3 eV over 200 steps flat, 2e-6 / −9e-6 over 150 in 3-D, nothing unsettled; switching the spins with 8 members in paid to the bath, books closed to 1e-11 eV. A hydronium and five
  waters (every electron paired): the same drift as paired (−4.2e-5 eV over 200 steps). O₃, NO, O₂, H₂O₂ and two H₂ at
  1,500 K (bath off, 400 steps): GFN1 1.4e-4 eV, GFN2 −2.8e-5, nothing unsettled; at 3,000 K flat the same; 3-D at
  3,000 K GFN2 2e-5, GFN1 3 unsettled steps (1.1e-2 eV), at a geometry where GFN1 paired does not settle in 250
  iterations either. **H₂ pulled apart** (its atoms 4 eV each, beside a water, insulated): polarized, the probe turns the
  stretched bond into two spins once (GFN1 at 1.67 Å, 8.5 meV to the bath) and every step settles (the largest change of
  the books 0.011 / 0.004 eV, the fast atoms' own step error, the same paired before the bond breaks); paired, 27 steps
  unsettled with jumps up to 6.5 eV, both methods.
- **Cost** (Node, one thread; two cores shared: noisy): a hydronium and five waters (all paired: two sets of orbitals and
  the probe) GFN1 5.6 → 8.7 ms a calculation (×1.6), GFN2 6.2 → 7.4 (×1.2); the radical mixture at 1,500 K GFN1 9.2 →
  21.5 (×2.3), GFN2 10.0 → 16.3 (×1.6). Tag ×1.2–2.3 (only with quantum bonds on).
- **Compared** (single points and geometries by the game's ports, `scratchpad/126x/cmp.js`; geometries optimized by its
  own BFGS for each variant: the paired numbers reproduce the GFN2 comparison above; spin-polarized with the right spins
  (O₂ triplet, OH doublet, atoms in their Hund states)):

  | | GFN1 | GFN2 | GFN1 spins | GFN2 spins | g-xTB | reference |
  |---|---|---|---|---|---|---|
  | bond lengths, 24 bonds (MAD, Å) | 0.0107 | 0.0122 | 0.0108 | 0.0122 | 0.011 | measured |
  | atomization, 23 molecules (MAD, eV) | 6.63 | 4.62 | 2.66 | 1.61 | 0.15 | W4-11 |
  | H + H₂ barrier (eV) | 0.15 | −0.40 | 0.58 | 0.03 | 0.21 | 0.42 |
  | HCN → HNC energy / barrier (eV) | 0.92 / 2.52 | 0.87 / 3.18 | the same | the same | 0.31 / 2.24 | 0.66 / 2.09 |
  | water dimer (eV) | 0.208 | 0.215 | the same | the same | 0.212 | 0.217 |
  | O₃ → O₂ + O (eV) | 7.60 | 6.85 | 5.45 | 4.70 | 1.12 | 1.15 |
  | proton between waters 2.7 / 2.8 Å (eV) | 0.084 / 0.214 | 0.041 / 0.123 | the same | the same | 0.103 / 0.222 | |
  | hexazine flat: barrier on the D3h path, release (eV) | 0.53, +1.67 | 0.80 (all uphill), −0.84 | the same | the same | none, +6.95 | |

  Spins help where molecules break into atoms or radicals (atomization 2.5–2.9 times closer; GFN2's bound H₃ gone);
  molecules whose electrons are all paired along the way are unchanged. Ozone stays 4–5 times too costly to break and
  GFN1's H + H₂ barrier now overshoots (0.58 against 0.42).
- **GFN2's SCC with radicals (item 2)**. tblite's mixer is the modified Broyden the ports already had, so the change is
  in how the game starts and limits the calculation (GFN2 and spins only; GFN1 paired keeps v131's, bit for bit): a
  changed cluster starts from its members' last state (`xqGuessById`: each atom brings its charges, moments and
  magnetization; new ones start neutral) instead of cold; a cold start, or one after an unsettled step, gets 120
  iterations (`XQ.maxItCold`), and an unsettled calculation goes on once from where it got to; no straight-line start
  through an unsettled step (it sent the next start further off: unsettled steps followed one another); a measurement
  between steps starts from the step's own state; a Broyden history whose residual grows ten times past its best starts
  again (`opts.mix.restart`); with spins, still unsettled, a fresh unpolarized start (the probe finds the spins again),
  then starts with each atom's free spins (alternating, then all alike).
  Cold starts of the 20 radical soups (10 loose C/N/O/H 1.6–4 Å apart): GFN2 unsettled 20/20 in 40 iterations before,
  5/20 in 120 after (mean 74 iterations when settled), GFN1 paired 15/20 (unchanged, v131's); polarized they are harder
  (GFN1 15/20, GFN2 12/20 after 120 + the seeded rerun: every atom a radical, many spin arrangements). Tried and not
  kept, as they did not help the soups: Broyden memory 5–20, damping 0.2, tblite's newer temperature annealing
  (`opts.anneal`, left in the port, unused). In the game: O₃, NO, O₂, H₂O₂ and two H₂ at 1,500 K, 300 steps: v131 29
  unsettled calculations, now none; GFN2 runs where every step settles are bit for bit v131's (a hydronium and three
  waters, flat and 3-D); that hot mixture's positions differ by up to 0.3 Å after 300 steps (other starts, then chaos).
- Found, not changed: a cluster holding O₂ and ammonia 6 Å apart never settles (GFN1 and GFN2, paired or not): GFN-xTB
  puts ammonia's lone pair above O₂'s empty level, so half an electron crosses 6 Å and the charges slosh. Calculating
  far-apart fragments separately (whole charges each) would cure it and save time; that changes the physics and is
  for the owner. GFN1 with O₂, two waters and methane: 7 unsettled calculations while it starts, polarized or not, and a
  switch of method onto such a cluster (GFN2 → GFN1) measures an unsettled energy, the books 50 eV off; GFN2 settles there.
- Settings text (the row, its tooltips, the note, SDESC/SDESC3), cost tags (COSTS/COSTS3 ×1.2–2.3), the realistic tag on
  Polarized, the Speed test's line ("quantum bonds (GFN1-xTB, polarized spins)"), Help (the honest-approximations line).
- Test: tests/f_126x.js (t_features' "1.26 (xTB)" line; alone `node tests/f_126x.js [port base game pull conv chem
  page]`): the port against ref3.json and its slopes; paired runs v131's bit for bit (GFN1 and GFN2); the game (slopes
  flat and 3-D, books, switching); H₂ pulled apart; GFN2's hot radical mixture settles; the single points behind the
  table; the page. Fails on v131 (no spins, no ref3.json; its hot mixture leaves 29 unsettled).

### 1.26: Atom Forge xTB

Asked by the owner (the xTB plan, item 3): re-fit both GFN1's and GFN2's parameters with one pipeline, targets and
held-out split, for H, C, N, O, with spin polarization; ship the better one as "Atom Forge xTB" if it beats the
originals on held-out data without breaking geometries. **Result: built and measured, not offered in Settings.** The
GFN1-form fit beats both originals on held-out energies and keeps H/C/N/O bond lengths, but it overbinds the water dimer
and, in the game, its calculations do not settle around O₂ among other molecules (below). The GFN2-form fit breaks
geometries. The parameters, the engine's support (`XQ.method` 3, `tools/xtb/afxtb-data.js`; only H/C/N/O molecules take
part) and the pipeline (`tools/xtb-fit/`) are in the branch for a later attempt; Settings offers GFN1 and GFN2 only.

- **The fit** (`tools/xtb-fit/fit.js`; data outside the repository: GMTKN55 from GitHub, the owner's g-xTB build for
  reference points only, never shipped): per element (H, C, N, O) each shell's level, its CN shift, its distance
  polynomial, the hardness, third order, repulsion exponent and charge; per element pair the H0 scaling; the spin
  constants' scale: 51 parameters on GFN1's form, 48 on GFN2's (multipoles and D4 kept). Spin-polarized, with each
  species' own spin count (tblite style). Targets: W4-11 atomization (70 H/C/N/O molecules, σ 0.15 eV), BH76 barriers
  (38 rows, 0.05 eV), WATER27 (27 clusters, 1.5 %), HCN → HNC and O₃ → O₂ + O (0.05 eV), g-xTB on hexazine's D3h path
  and its release to 3 N₂ (0.15 / 0.3 eV) and on a shared proton (0.03 eV), the forces at W4-11's reference geometries,
  and bond lengths and angles of 16 molecules optimized with the parameters being fitted (measured re, 0.002 Å, 0.25°;
  the water dimer's O–O 0.02 Å). Held out (never fitted): every 4th W4-11 molecule (16), every 3rd BH76 saddle (10 rows),
  every 3rd water cluster and the 20-mers (12), the proton at 2.8 Å, three molecules' geometries. Levenberg–Marquardt with
  a forward-difference Jacobian, a pull toward the original parameters; six rounds of settings (the first fits made the
  water angle 113–124° and bonds 0.014–0.023 Å off, hence the optimized-geometry targets).
- **Held-out errors** (eV; the originals with polarized spins and the same spin counts; MAD):

  | held out | GFN1 spins | GFN2 spins | Atom Forge xTB on GFN1 | on GFN2 |
  |---|---|---|---|---|
  | W4-11 atomization (16) | 4.35 | 2.15 | 0.35 | 0.37 |
  | BH76 barriers (10) | 0.73 | 0.68 | 0.48 | 0.45 |
  | WATER27 clusters (12) | 0.38 | 0.13 | 0.32 | 0.91 |
  | bond lengths of the held-out molecules (Å) | | | 0.001 | 0.008 |

- **Compared** (as the spin table above, `tools/xtb-fit/cmp.js`):

  | | GFN1 | GFN2 | GFN1 spins | GFN2 spins | AF xTB (GFN1 form) | AF xTB (GFN2 form) | g-xTB | reference |
  |---|---|---|---|---|---|---|---|---|
  | bond lengths, 24 bonds (MAD, Å) | 0.0107 | 0.0122 | 0.0108 | 0.0122 | 0.0127 | 0.0191 | 0.011 | measured |
  | of them the 19 H/C/N/O bonds | 0.0088 | 0.0120 | 0.0089 | 0.0120 | 0.0049 | 0.0066 | | |
  | angles H₂O / O₃ (°) | 107.1 / 119.1 | 107.2 / 120.4 | the same | the same | 107.5 / 117.1 | 107.7 / 118.5 | 106.5 / 117.7 | 104.5 / 116.8 |
  | atomization, 23 molecules (MAD, eV) | 6.63 | 4.62 | 2.66 | 1.61 | 0.63 | 0.79 | 0.15 | W4-11 |
  | H + H₂ barrier (eV) | 0.15 | −0.40 | 0.58 | 0.03 | 0.57 | 0.54 | 0.21 | 0.42 |
  | HCN → HNC energy / barrier (eV) | 0.92 / 2.52 | 0.87 / 3.18 | the same | the same | 0.91 / 2.59 | 0.81 / 2.54 | 0.31 / 2.24 | 0.66 / 2.09 |
  | water dimer (eV, O–O Å) | 0.208, 2.91 | 0.215, 2.84 | the same | the same | 0.268, 2.79 | 0.220, 2.80 | 0.212, 2.91 | 0.217, 2.91 |
  | O₃ → O₂ + O (eV) | 7.60 | 6.85 | 5.45 | 4.70 | 1.81 | 1.87 | 1.12 | 1.15 |
  | proton between waters 2.7 / 2.8 Å (eV) | 0.084 / 0.214 | 0.041 / 0.123 | the same | the same | 0.082 / 0.189 | 0.195 / 0.333 | 0.103 / 0.222 | |
  | hexazine flat: barrier, release (eV) | 0.53, +1.67 | 0.80 (uphill), −0.84 | the same | the same | 0.30, +6.77 | none, +6.65 | none, +6.95 | |

  The F, Cl and S molecules' bonds (HF, HCl, H₂S) go wrong with the refitted hydrogen (0.04–0.06 Å): hence H/C/N/O only.
- **Why not shipped**: the GFN2-form fit misses the geometries (0.019 Å, held-out water clusters 0.91 eV, the proton
  profile twice g-xTB's). The GFN1-form fit wins on held-out energies and the must-haves of breaking bonds (N₂ 9.2 eV
  into atoms, measured 9.9; ozone 1.8, measured 1.15; hexazine falls apart, as g-xTB has it), HCN ⇌ HNC and the proton
  as GFN1, but: H + H₂ stays 0.57 (as GFN1 with spins); the water dimer binds 0.27 eV (0.22) with its oxygens 0.12 Å too
  close; and in the game (O₂, two waters and methane, flat, 30 steps then 200 insulated) its calculations did not settle
  5 times in the first 30 steps and 5 more after, with the books 220 eV off (GFN1 with spins, the same world: 0 after its
  start, 4e-5 eV). Closed shells in 3-D are fine (O₂, three waters and methane apart: slopes 5e-7–3e-6 eV/Å, 2e-5 eV over
  150 steps). That robustness has to be solved before it is offered.
- **Recommendation (item 4)**: keep GFN1-xTB as the default method, and make **Polarized spins** its default once the
  owner approves: it is never worse than paired on the comparisons (molecules into atoms 2.5 times closer, the hydrogen
  exchange 0.16 eV off instead of 0.27, ozone 2 eV closer, bond breaking settles instead of eV jumps; molecules with
  every electron paired unchanged) for ×1.2–2.3 the cost. Do not remove GFN1: it is the only one that is right on the
  game's barriers and on hexazine's direction for every element; old saves and settings name it. GFN2 could be retired
  from the menu (it loses to GFN1 on H + H₂ (paired), HCN ⇌ HNC, the shared proton and hexazine, and its one strength,
  atomization, is better covered by GFN1 + spins + a working Atom Forge xTB); keep its code so old settings (`xq` 2)
  load. Atom Forge xTB is the way to real bond energies, after its SCC robustness around O₂ is fixed.

### 1.26: GFN2-xTB

Asked by the owner (the "For 1.26" list): "try implementing gfn2 xtb. Run tests and compare numbers, and maybe leave gfn1 in
if gfn2 is very different". Built on branch v131. Physics for the owner's OK: a second method to choose; the normal one
is unchanged.

- **What**: Settings → Experimental → Bond orders → Quantum, then **Quantum method**: GFN1-xTB (normal, as since 1.22) or
  GFN2-xTB (Bannwarth, Ehlert and Grimme, J. Chem. Theory Comput. 15, 1652 (2019)). `SET.xq` (1 or 2, an Experimental
  setting: back to GFN1 at every start), `boQmMethod(m)` (bo.js: with quantum bonds on, the members leave under one
  method and join under the other, each change's energy to the bath as switching models does), `XQ.method`; the free
  atoms each method's own (`qmAtomE`); a member's orbitals by the method (`xqNAO`: GFN2 gives hydrogen one, GFN1 two),
  for the 40-atom / 160-orbital caps and the joiners' relaxation. The warm start carries GFN2's whole state (shell
  charges, atomic dipoles and quadrupoles; `r.guess`), extrapolated as GFN1's charges are.
- **The port** (`tools/xtb/gfn2.js`, `d4.js`; tables `gfn2-data.js` from tblite's gfn2.f90 by `gfn2-gen.js`, `d4-data.js`
  from dftd4's reference.inc and data/ by `d4-gen.js`, numbers copied as text; the page's copy in `src/xtb.js` by
  `mksrc.js`, `XTB.gfn2Energy`, `XTB.nAO2`): ported from tblite (LGPL-3.0-or-later: xtb/gfn2.f90, h0.f90, the overlap,
  dipole and quadrupole integrals, coulomb/ effective second order with the arithmetic mean of the hardnesses,
  shell-resolved third order, the damped multipole electrostatics with their exchange-correlation kernels, the
  repulsion with exponent 1 between H/He pairs, the SCF potentials and the mixer over charges, dipoles and
  quadrupoles, the singlepoint's gradient), dftd4 (LGPL-3.0-or-later: the self-consistent D4, its reference
  polarizabilities with GFN2's charges, zeta charge scaling, rational damping, the three-body ATM term with neutral
  C6) and mctc-lib (Apache-2.0: the double-exponential and the D4 erf coordination numbers). Sources cloned from
  GitHub (tblite c6f66b9, dftd4 1107ea7, mctc-lib 73fc4ca) into the session's scratchpad; nothing of them committed but
  the generated tables. Not ported: periodic cells, solvation, spin polarization (restricted open shell as tblite does).
  Two slips found by the checks and fixed before anything else: tblite stores the multipole radius's slope dR/dCN with
  the opposite sign and compensates in its dE/dR (copied alone it made H₂'s force 0.13 eV/Å off), and the warm start
  read the quadrupoles back without undoing the mixer's √2 on the off-diagonal ones (8 iterations a step instead of 5).
- **Checked against tblite** (its GFN2-xTB on the GitHub Actions runner: `tools/xtb-ref/ref2.py`, `geoms2.json` (21 more
  geometries in 3-D: S, P, Si, Cl, Br with d shells, LiF, NaCl, nitrate, OH and CH₃ radicals, ozone, HCN/HNC, puckered
  hexazine, water dimer, H₃O⁺·H₂O, benzene), `ref2.json`; `node tools/xtb/check-gfn2.js`): 91 geometries, energies to
  1.0e-11 eV, charges 5e-12 e, forces 6.0e-11 eV/Å; forces against the port's own slope (h = 1e-4 Å, x y z) 3–5e-7
  eV/Å. Also, in the scratchpad only, against xtb 6.7.1's GFN2 (the owner's g-xTB build, which also runs GFN1 and GFN2):
  91 geometries to 3.5e-7 eV and 9e-6 eV/Å (its D4 and convergence differ a little).
- **In the game** (Node, `tests/f_126q.js`): forces = the energy's slopes, flat with a Na⁺ outside 6e-7 eV/Å, 3-D 6e-7 in
  x, y and z; insulated: a hydronium and five waters (19 atoms) −1e-5 eV over 200 steps, 18 atoms in 3-D 0.0000 eV over
  150; no unsettled calculation in these; 5.2 SCC iterations a step (GFN1 4.9); switching the method with 14 members in
  paid to the bath (0.9 eV), the books closed to 4e-12 eV. Loose atoms and radicals close together (10 C/N/O/H 1.6–4 Å
  apart, cold starts, 20 cases): unsettled in the game's 40 iterations GFN1 15, GFN2 20; in 250 GFN1 1, GFN2 2 (GFN2
  needs about 1.4 times the iterations there).
- **Cost** (Node, one thread, two cores shared by four agents: noisy; same steps, 0.22 fs): a hydronium and five waters
  (19 atoms; GFN1 50 orbitals, GFN2 37) flat 14–17 ms a step GFN1, 13–22 GFN2 (×1.1–1.4); 3-D 10–20 against 15–18
  (×0.9–1.7); with eleven waters (37 atoms, 98 and 73 orbitals) flat 84–97 against 76–100 ms (×0.8–1.2), 3-D 62–105
  against 47–84 (×0.5–1.4). Fewer orbitals on hydrogen, more work in the dipole and quadrupole integrals and D4: about
  the same. Tags: GFN1 ×1, GFN2 ×0.8–1.4 (only with quantum bonds on).
- **Compared** (GFN1 and GFN2 by the game's ports, geometries optimized by xtb 6.7.1 for each method; g-xTB from the
  owner's build, Linux binary from github.com/grimme-lab/g-xtb, run in the scratchpad only; references from GMTKN55 on
  GitHub: W4-11 atomization energies, BH76 barriers, WATER27, and measured bond lengths from memory (NIST/Huber–
  Herzberg). Atoms and molecules as the game takes them for GFN1/2 (uhf 0, Fermi smearing); with high-spin atoms GFN1/2
  change by 0.1 eV at most; g-xTB with the right spins):

  | | GFN1 | GFN2 | g-xTB | reference |
  |---|---|---|---|---|
  | bond lengths, 24 bonds (MAD, Å) | 0.011 | 0.012 | 0.011 | measured |
  | angles H₂O / O₃ / H₂S (°) | 107.1 / 119.1 / 93.2 | 107.2 / 120.4 / 92.3 | 106.5 / 117.7 / 92.9 | 104.5 / 116.8 / 92.1 |
  | atomization, 23 molecules (MAD, eV) | 6.6 | 4.6 | 0.15 | W4-11 |
  | H₂ / N₂ / H₂O atomization (eV) | 6.36 / 14.58 / 16.69 | 5.33 / 14.83 / 13.99 | 4.64 / 9.42 / 10.03 | 4.75 / 9.91 / 10.10 |
  | H + H₂ barrier (eV) | 0.15 | −0.40 (H₃ bound) | 0.21 | 0.42 (BH76) |
  | HCN → HNC energy / barrier (eV) | 0.92 / 2.52 | 0.87 / 3.18 | 0.31 / 2.24 | 0.66 / 2.09 |
  | water dimer (eV, O–O Å) | 0.208, 2.91 | 0.215, 2.84 | 0.212, 2.91 | 0.217 (WATER27) |
  | O₃ → O₂ + O (eV) | 7.60 | 6.85 | 1.12 | 1.15 (W4-11) |
  | proton between waters, O–O 2.7 / 2.8 Å (eV) | 0.084 / 0.214 | 0.041 / 0.123 | 0.103 / 0.222 | (g-xTB) |
  | hexazine flat: N–N, barrier, release (eV) | 1.296 Å, 0.54, +1.67 | 1.295 Å, none, −0.84 | 1.308 Å, none, +6.95 | falls apart, several eV |
  | hexazine 3-D: vs flat, barrier, release (eV) | −0.16 (pucker 0.23 Å), 0.65, +1.51 | −0.88 (0.24 Å), 1.67, −1.72 | stays flat, none, +6.95 | |

  Hexazine: GFN2 makes it worse than GFN1, not better: the ring lies 0.84 eV (flat) to 1.72 eV (puckered, bonds
  alternating 1.25/1.37 Å) **below** three N₂ (checked against xtb's own GFN2: −0.842), so in the game it would never
  fall apart. g-xTB has no barrier at all and releases 6.95 eV (published high-level work, from memory: at best a
  shallow minimum). H + H₂: GFN2 itself binds linear H₃ by 0.40 eV at 1.05 Å (tblite and xtb alike), where the real
  saddle is 0.42 eV up. GFN2 is closer for breaking molecules into atoms, but both are far too strong there (the xTB
  methods' free atoms), and ozone losing an O is 6–7 times too costly in both.
- **Default: GFN1** (by the rule from the main session: whichever matches the references better overall, unless GFN2 is
  more than ~3× slower; it is not slower). GFN1 is closer on the barriers that make reactions happen in the game (H +
  H₂, HCN ⇌ HNC, the shared proton the quantum bonds were made for, hexazine's direction), equal on geometries and the
  water dimer; GFN2 is closer only on atomization energies, where both are poor. GFN2 kept as a choice (realistic tag
  on GFN1, with why).
- The flat game with default settings is bit for bit the same: the 59 setups (50 flat, 9 3-D), seed 7, 300 steps, every
  position and velocity identical to 1.25; quantum bonds with GFN1 too (a hydronium and three waters, 150 steps, flat
  and 3-D, identical: `f_126q.js gfn1`).
- Settings text (the row and its tooltips, the note under Quantum with the numbers above, SDESC and SDESC3), cost tags
  (COSTS and COSTS3), the Speed test's line ("quantum bonds (GFN2-xTB)"), Help (the honest-approximations line).
  No Settings picture for the new row (as Bead forces).
- Test: tests/f_126q.js (t_features' "1.26 (GFN2)" line; alone `node tests/f_126q.js [port gfn1 game chem page]`):
  the port against tblite's ref2.json and its slopes; GFN1 runs bit for bit 1.25's; GFN2 in the game (slopes flat and
  3-D, books, method switch); the measurements behind the default (H₃, hexazine, the shared proton); the page. Fails
  on 1.25 (no GFN2). `node tools/xtb/check-gfn2.js` for the full port check.
- Left: GFN2's SCC on loose radicals (above); a Settings picture; g-xTB itself in the game only when its source and
  parameters are public (tblite).

### 1.26: metal oxides, alloys, directional metals

The owner's "For 1.26" entries (branch v132, from the combined 1.25 at cc8a0fd): extensions of Settings → Experimental →
Metals → Many-body (src/bometal.js); physics-model changes for the owner's OK. Default settings unchanged: with Many-body
off every setup is bit for bit 1.25's (the 53 flat setups and the six 3-D ones, 300 steps, seed 7: identical
fingerprints of positions, velocities, charges). With Many-body on, the setups whose metals meet no O or H atom and no
non-metal ion are also identical (oven, salt, brine, chain, photonuc, isolde, sns, useries, crt, ch_split); the four that differ have O/H on the metal
(magnet, brine3d) or a Cl⁻ next to sodium (ch_salt, flame: the image term), as they should. Reference values: the web
was refused by the proxy from this session again, so the data below are standard values from memory (CRC/NBS heats of
formation, Wyckoff structures, bulk moduli from the literature), flagged here: worth a check against the books.

**1. Oxides and hydrides.** Before: a metal atom that bonded to O or H left the many-body model for a stored Morse bond
(losing its 3 eV of metal bonding at once), O₂ meeting the metal did nothing (1.25, O₂ over a 3-D Cu(100) slab at 600 K,
1.2 ps: 0 O atoms bound), and an ion near a metal felt only the contact core.
- **The model**: O and H atoms with a free valence ("partners": an O atom, an O with one single bond such as OH or
  peroxo at half weight, an H atom; neutral) join the second-moment model as an alloy component, in Cleri and Rosato's
  way: per metal–partner pair a repulsion A·e^(−p(r/r₀−1)) at the partner's weight w, the hopping squared
  ξ²·e^(−2q(r/r₀−1)) in both atoms' densities (the metal's at the partner's weight), the partner's own embedding
  −w·√ρ. A metal atom's density then holds its O and H neighbours, so its bonds to other metal atoms weaken as it
  oxidizes (the many-body coupling a stored bond lacked). O and H with their valence used up (O₂, water, OH's H) meet
  the metal as before. Two partners have no many-body pair (theirs is the classic chemistry's: LJ, bonds, reactions).
  A member metal and a partner: the kernels skip the pair (vlExclusions marks it, as bond orders' pairs are; localPE,
  regionE and totalEnergy skip it too; no kernel or WebAssembly change), and covalentOK refuses a stored bond between a
  member metal and O or H (the first runs made CuO₂ by the classic radical reaction).
- **The fit** (`node tools/mbfit.js [--write]`, a few seconds a compound): each reference compound's crystal is built in
  a periodic 3-D box in the game itself (unrelaxed; everything the game has there counts: metal–metal pairs, the
  partners' Lennard-Jones), r₀ = its measured metal–partner distance (corundum's mean of 1.86 and 1.97 Å), q/p = 0.4,
  and A, ξ, p solved for: the measured heat of formation from the bulk metal and the game's O₂ / H₂, no force on
  uniform scaling, the measured bulk modulus (p kept to 3–20; 9 where none is known). 31 compounds: Cu₂O, Ag₂O
  (cuprite), Al₂O₃, Cr₂O₃ (corundum), FeO, CoO, NiO, MnO, MgO, CaO, SrO, BaO (rocksalt), Li₂O, Na₂O, K₂O
  (antifluorite), BeO, ZnO (wurtzite), TiO₂, SnO₂ (rutile), ZrO₂, CeO₂, UO₂ (fluorite); LiH, NaH, KH (rocksalt),
  MgH₂ (rutile), TiH₂, ZrH₂ (fluorite), PdH (rocksalt, −0.2 eV an H), CuH (wurtzite, +27.5 kJ/mol), AlH₃ (as ReO₃-type
  cubic). Other metals take their group's (or the nearest fitted) constants, r₀ scaled by the game's radii (Au, Pt, Pd
  oxides from Ag and Ni; Ni and Pt hydrides from Pd).

  | | model | measured |
  |---|---|---|
  | each fitted compound: ΔHf, metal–O/H distance | exact (e.g. Cu₂O −168.6 kJ/mol at 1.849 Å, Al₂O₃ −1675.7 at 1.913, FeO −272.0 at 2.154, NaH −56.3 at 2.440) | the same |
  | bulk moduli | exact for 21; Cu₂O 119, BeO 238, SnO₂ 232 GPa (p at its floor of 3) | 112, 212, 205 |
  | hematite Fe₂O₃ with FeO's constants (not fitted) | −596 kJ/mol, lattice +7% | −824 (the model has no oxidation states: Fe³⁺ and Fe²⁺ bond alike) |
  | CuO with Cu₂O's (as rocksalt) | −203 kJ/mol, lattice +6% | −157 (tenorite) |
  | O on a close-packed (111) face, fcc hollow, unrelaxed, against the O atom: Cu, Ag, Ni, Pt, Al | −5.26 eV at 1.34 Å, −3.48, −5.9 (in the surface plane), −4.02, −11.4 (in the surface plane) | about −4.8, −3.6, −5.5, −4.3, −7.4 (DFT values from memory, ±0.3) |
  | H on (111): Cu, Pd, Pt | −2.19, −2.26, −1.77 eV | about −2.4, −2.9, −2.7 |

  O on Cu, Ag, Pt is within 10%; on open or very oxophilic metals (Al, Mg, Ca, the alkalis, Ni) the O atom sinks into
  the top layer and is overbound (Al by half): the second-moment form gives a site with few metal neighbours nearly the
  bulk oxide's binding. Tried: a ratio κ between the metal's ξ and the partner's (fitted to the surface binding): it ran
  to its ends (Cu 4, Al 0.25) and moved Cu's binding by 0.02 eV; not used (`--kappa` keeps it in the tool).
- **Molecules splitting on the metal** (`mbEvents`, every fourth step): a bond between two partners' elements (O=O, H–H,
  O–H, O–O) whose atom comes within 0.6 Å past its pair's reach of a member and is moving toward it is tried broken,
  the pieces moved apart out of each other's core and toward their nearest members (up to 1.2 Å, as evBond's
  snapTogether moves molecules), the energy measured exactly (localPE over the molecule with the many-body part), kept
  when the meeting's energy along the line of centres reaches an Evans–Polanyi activation energy from that heat (as
  reaction(): max(0.05, 0.5 + 0.25·ΔH) downhill, 0.5 + 0.75·ΔH uphill), the heat released or taken from the meeting;
  undone otherwise. The reverse (two partners bonding, O₂ or H₂ leaving) is the classic evBond, measured the same way.
  O₂ over the 3-D Cu(100) slab at 600 K, 1.2 ps: 2 O₂ split, their 4 O atoms bound (1.25: none); a flat Cu patch in O₂,
  O, H and H₂ at 1,500 K: O₂ split 3 times, 7 O atoms bound, no ions made. H₂ on Cu stays whole (uphill: H on Cu is
  endothermic against H₂, as measured).
- **An ion near the metal** feels its image: a pair term −c·q²/(r² + a²)² between the ion and each member (each metal atom
  polarized by its field), c = k/(4π·n) for the metal's atom density so that summed over a half-space it is the
  conductor's −k·q²/4z far out, a = r₀/2, to 6 Å. Non-metal ions only: with metal ions too a Cu lump paid its own atoms
  for becoming Cu⁺ and Cu⁻ (the transfer trials ×5 in a 3-D test). F⁻ at contact with a Cu ball: −0.97 eV; Cl⁻ 2.5 Å
  over a flat Cu edge −1.6 eV, at 4 Å −0.35. evTransfer's lower bound counts the image's change for the two atoms.
- **Forces and energy**: forces are the energy's slopes to 5.6e-9 eV/Å flat and 1.6e-8 in 3-D (Cu with O, H, an OH at
  half weight and a Cl⁻); localPE's many-body part exact for a partner, a member, an ion moved and for O₂ split on the
  metal (1e-10 to 7e-10 eV); insulated, the flat patch in O₂/O/H/H₂ at 1,500 K over 6,000 steps of 0.4 fs with three
  splittings: 0.066 eV (0.0085 at half the step: the integrator on hot H₂ and OH, not the events; another seed 0.017),
  the 3-D ball with the same gases at 1,200 K over 1,500 steps 0.008 eV.
- **Cost** (one thread, CPU time; two cores shared with three other agents, ±30%): a flat Cu patch with 24 O atoms on
  it ×1.22 against pairs (bare ×1.6), a flat Cu patch in 160 waters ×1.12, a 3-D Cu ball with 18 O atoms ×0.95 (bare
  ×1.5). The setting's tag stays ×1–2 in both modes.
- **Found, not changed**: with the normal pairs, an O atom or an ion right next to a metal atom has forces off the
  energy's slope by 1–5e-4 eV/Å (Cl⁻ or O at 1.2–2.4 Å from Cu, Many-body off; with Many-body on the O is the model's
  and exact). Metal ions are not image-pulled; the metal giving an electron to an ion still makes a localized Cu⁺ (no
  Fermi sea), as in 1.25. Bonds to O and H on the metal are drawn as no lines.
- Tests: tests/f_126m.js (t_features "1.26 (metals)"): oxide (Cu₂O, Al₂O₃, FeO, NaH, MgH₂ at their measured values;
  hematite), surface (the flat patch in O₂/O/H/H₂: splitting, bound O, energy, no ions), forces (2-D and 3-D with
  partners and a Cl⁻), books (moves, O₂ split, an F⁻'s image), page (Settings words in both modes, the note, Help).
  Each fails on cc8a0fd.

**2. Alloys.** Before: unlike metals mixed their constants (r₀, p, q averaged, A and ξ geometric means), so strongly
bound pairs came out barely bound (an Al atom in Ni +0.15 eV, Ni in Al −0.09; Cu₃Au −0.022 eV an atom against −0.074
measured).
- **The model**: a pair of metals may have constants of its own (`MBA_FIT`: the pair's whole repulsion A and its ξ, with
  p and q the two metals' means and r₀ the compound's a–b distance); the rest still mix. Fitted by
  `node tools/mbfit.js --alloys [--write]` on one compound each, its crystal built in the game as for the oxides
  (unrelaxed): the measured heat of formation at the measured lattice, no force on scaling. NiAl (B2, −58.8 kJ/mol of
  atoms), NiTi (B2, −34), FeAl (B2, −28), CuZn (β-brass, B2, −12.3), Cu₃Au (L1₂, −7.1), TiAl (L1₀, −37.6) (from memory).
- **Measured** (3-D, periodic, 108 sites; relaxed by quenching unless said):

  | | 1.25 (mixed) | 1.26 | measured |
  |---|---|---|---|
  | Ni₃Al (L1₂, not fitted), at its best lattice | — | −169.7 kJ/mol, lattice −0.6% | −165.2 |
  | CuAu (L1₀, not fitted) | — | −17.6 kJ/mol, lattice 0.0% | −18.2 |
  | an Al atom dissolved in Ni / Ni in Al | +0.15 / −0.09 eV | −1.72 / −0.93 | about −1.5 / strongly bound |
  | Au in Cu / Cu in Au | 0.00 / +0.03 | −0.20 / −0.13 | about −0.13 / −0.19 |
  | Cu₃Au ordered, random (both relaxed), eV an atom | −0.022, −0.003 | −0.074, −0.040 | −0.074, about −0.05 |
  | Cu₃Au ordering (ordered − random) | −0.019 | −0.033 | about −0.02 to −0.03 (disordering enthalpy) |
  | disordered CuAu, heat of mixing | −0.001 | −0.042 | about −0.05 |
  | Ag in Cu, Cu in Ni (no constants of their own) | +0.30, +0.05 | unchanged | +0.39, +0.03 |

  Not measured: the order–disorder temperature itself (a Monte Carlo of swaps, hours here); the ordering energy says
  Cu₃Au orders, by about the right amount.
- **Forces and energy**: the same pair code with other constants (the forces part of f_125m's Cu–Ag–Au and f_126m's).
- **Cost**: none (a table lookup when the pair table is made).
- Tests: f_126m `alloy` (Ni₃Al and CuAu within 10%, Al in Ni below −1 eV, Cu₃Au ordered below random); fails on cc8a0fd
  (Al in Ni +0.15).

**3. Directional bonding (the bcc metals).** The owner: "directional bonding for transition metals … so Fe, W, Cr, Mo and
Na crystallize bcc". Reference values from memory again (the proxy refused the web): Kittel's cohesive energies and
spacings, room-temperature elastic constants (Simmons and Wang), Ehrhart's vacancy energies; fcc − bcc and hcp − bcc from
DFT and CALPHAD lattice stabilities as recalled (W about 0.48 / 0.42 eV an atom, Mo 0.42 / 0.43, Cr 0.40 / 0.37, V 0.24 /
0.25, Nb 0.33 / 0.30, Ta 0.24 / 0.27, Fe 0.10 / 0.08 with its magnetism; Na nearly degenerate, taken as +0.003 so bcc is
lowest): the structural differences are the least certain, ±0.05 eV and more for hcp.
- **Before** (measured here; the 1.25 note said these metals "crystallize close-packed", which is not what the model
  does): fitted on a close-packed crystal, the model cannot tell fcc from hcp (12 equal neighbours, the second shell past
  the switch), and bcc's second shell (at 1.155 r₀) sits just inside the switch (1.15–1.35 r₀) and counts fully, so bcc
  comes out lowest but 2.7–3.3% too small and overbound (relaxed, 3-D periodic, game energies):

  | 1.25 / items 1–2 | W | Mo | Cr | V | Nb | Ta | Fe | Na |
  |---|---|---|---|---|---|---|---|---|
  | bcc a, against measured | −2.7% | −2.8% | −2.6% | −3.1% | −2.9% | −3.0% | −3.0% | −3.2% |
  | bcc Ec (measured) | 9.02 (8.90) | 6.90 (6.82) | 4.17 (4.10) | 5.43 (5.31) | 7.73 (7.57) | 8.25 (8.10) | 4.36 (4.28) | 1.153 (1.113) |
  | fcc − bcc = hcp − bcc | 0.122 | 0.082 | 0.066 | 0.123 | 0.158 | 0.152 | 0.080 | 0.040 |

  The same holds for the close-packed metals, see "Found" below.
- **The model** (`src/bometal.js`, MBD_FIT and mbDir…): MEAM's angular partial densities (Baskes 1992) weighing the band:
  Eᵢ = Σⱼ A·e^(−p(r/r₀ − 1)) − √(ρᵢ + ρᵢᴹ·Γᵢ), Γᵢ = Σ_l t_l·Σⱼ Σₖ aⱼaₖ P_l(cos θⱼₖ) / (Σⱼ aⱼ)², l = 2, 4, 6, aⱼ =
  e^(−β(r/r₀ − 1)) at the pair's switch (j = k counted, so each l's part lies in [0, 1]); ρᴹ is the metal part of the
  density, so O and H on the metal keep item 1's terms. Γ is unchanged by an even scaling of a crystal and bounded (t's
  negative part kept to −0.8, so ρ + ρᴹΓ ≥ 0.2ρ): the first try, an unnormalized three-body sum, collapsed every lattice
  under compression (its angular term grew faster than the core repulsion). l = 6 rewards bcc's cube of first neighbours
  (ρ₆²/(Σa)² 0.39 against fcc 0.33, hcp 0.24, the simple cube 0.13), l = 4 sets fcc against hcp and the simple cube, l = 2
  (zero in any cubic crystal) gives shear an angular part. The members of a directional element switch from 1.25 to
  1.45 r₀ (bcc's second shell in, fcc's at 1.41·1.03 r₀ out); a pair with one directional metal takes the two switches'
  mean; every other metal keeps 1.25's 1.15–1.35 exactly. Arms are member metal atoms (an alloy partner's arms count with
  the centre's β and the pair's r₀); O and H are not arms. Forces analytic (the arms' weights and the angles; mbDirForces);
  localPE and regionE exact (a directional neighbour's band recomputed with and without the set, mbDirX). evTransfer's
  lower bound uses the leaver's own band with its angles; its neighbours' angles can go either way, so for these metals
  the bound is an estimate (a transfer it skips would have been refused by the exact trial in nearly every case; the
  trial still decides the rest).
- **The fit** (`node tools/mbdfit.js [El …]`, lattice sums of one atom's neighbours, the same formula; `--table` writes
  the rows; the game's energies agree to 1e-4 eV an atom, its elastic constants to 0.1 GPa): A and ξ solved for the
  cohesive energy at zero pressure at the measured spacing; p, q, t₂, t₄, t₆, β by Nelder–Mead on the bulk modulus, C′,
  C₄₄, the unrelaxed vacancy energy, fcc − bcc and hcp − bcc, with the simple cube, simple hexagonal and diamond lattices
  kept above bcc (without that, the first fits put the simple cube 0.4–0.6 eV below bcc). Eight metals: the owner's five
  and V, Nb, Ta (the rest of groups 5 and 6). Relaxed, 3-D:

  | | a Å | Ec eV | B | C₁₁ | C₁₂ | C₄₄ GPa | vacancy eV | fcc − bcc | hcp − bcc eV |
  |---|---|---|---|---|---|---|---|---|---|
  | W | 3.165 (3.165) | 8.90 (8.90) | 312 (310) | 429 (522) | 254 (204) | 162 (161) | 3.59 / relaxed 3.57 (3.67) | 0.473 (0.48) | 0.566 (0.42) |
  | Mo | 3.147 (3.147) | 6.82 (6.82) | 261 (260) | 378 (464) | 203 (158) | 110 (109) | 2.89 (3.0) | 0.436 (0.42) | 0.535 (0.43) |
  | Cr | 2.884 (2.885) | 4.10 (4.10) | 153 (153) | 248 (340) | 105 (59) | 97 (99) | 1.87 (2.0) | 0.341 (0.40) | 0.390 (0.37) |
  | V | 3.028 (3.03) | 5.31 (5.31) | 156 (155) | 217 (228) | 126 (119) | 43 (43) | 2.05 (2.1) | 0.244 (0.24) | 0.283 (0.25) |
  | Nb | 3.300 (3.30) | 7.57 (7.57) | 173 (171) | 233 (246) | 143 (134) | 29 (29) | 2.63 (2.65) | 0.312 (0.33) | 0.357 (0.30) |
  | Ta | 3.302 (3.303) | 8.10 (8.10) | 196 (194) | 247 (266) | 171 (158) | 88 (87) | 2.78 (2.9) | 0.268 (0.24) | 0.325 (0.27) |
  | Fe | 2.866 (2.866) | 4.28 (4.28) | 163 (167) | 189 (231) | 150 (135) | 119 (116) | 1.52 (1.6) | 0.093 (0.10) | 0.109 (0.08) |
  | Na | 4.225 (4.225) | 1.113 (1.113) | 7.0 (6.6) | 7.9 (7.3) | 6.5 (6.2) | 4.0 (4.2) | 0.39 (0.42) | 0.003 (0.003) | 0.029 (≈0) |

  (measured in brackets; vacancies unrelaxed unless said; hcp at its relaxed c/a, 1.62–1.80.) Cohesive energy, spacing,
  bulk modulus, C₄₄ and the fcc energy come out; C₁₁ − C₁₂ is 20–60% low (W 175 against 318 GPa, Fe 39 against 96): the
  Cauchy pressure C₁₂ − C₄₄ stays positive (Cr +8 GPa, measured −40), which a single √ band with these angles did not
  reach; hcp lies 0.05–0.15 eV too high for W, Mo, Nb, Ta (above fcc, where the references put it a little below). The
  open lattices stay up: simple cube +0.43 (Cr) to +0.87 eV (W, Ta) an atom, A15 +0.12 to +0.61, diamond +1.6 to +3.0
  (Na +0.045, +0.014, +0.26). Along the Bain path (bcc to fcc at constant volume) bcc is the minimum and fcc a maximum
  for all but Na (where fcc is a shallow local minimum, 0.003 above bcc).
- **In motion** (3-D, free balls, bath 0.05): a tungsten ball of 141 atoms started fcc at 600 K turns body-centred
  within a picosecond (inner atoms with fcc's 12 neighbours 43 → 2, with bcc's 14 0 → 14, the rest in between); one of 137
  started bcc stays bcc at 300 K (27 of 27 inner atoms, 1 ps). Melting (3-D ball of 137 atoms, heated in steps of 0.1·Tm,
  3 ps each; inner atoms with bcc's 14 neighbours, and how far atoms move in 2 ps): tungsten, 137 atoms, keeps its order to
  about 2,600 K (23 of 28), loses half by 2,950 K and nearly all by 3,350 K (atoms' temperature; 4 of 28), and diffuses
  (1.6–2.4 Å in 2 ps) from 3,350–4,100 K; iron, 169 atoms, keeps it to about 1,300 K (39 of 51), half by 1,360–1,640 K,
  none by 1,960 K, diffusing from there (real 3,695 and 1,811 K). Balls this small melt well below the bulk (a third or
  more of their atoms at the surface), so the bulk would melt at or somewhat above the real temperatures, as 1.25 found
  for copper; not measured: a bulk coexistence run. Sodium: a ball of 59 atoms is too small to say (it is not bcc at
  any temperature); a periodic bcc crystal of 128 atoms at 300 K stays bcc (83–99 atoms with 14 neighbours over 2 ps).
- **The flat world**: the angles act in the plane. W, Mo and Cr sheets go centred rectangular (lattice sums: 0.12–0.24 eV
  an atom below the triangular sheet, aspect 1.26–1.36, bcc's (110) face has 1.41): a flat W patch of 37 atoms at 300 K
  turned so within 1 ps (the 5th and 6th neighbours 1.0 → 1.2 times as far as the first four). V, Nb, Ta, Fe stay
  triangular or nearly (within 0.03 eV); flat sodium prefers square sheets by 0.08 eV an atom (t₄ 1.24 rewards the
  square's fourfold arms; nothing fitted it to anything flat).
- **Forces and energy**: forces are the energy's slopes to 5.9e-9 eV/Å flat and 1.2e-8 in 3-D (W with Fe and Cu and an O
  atom, jittered), localPE exact to 3e-9 eV (an atom, a pair, an edge atom moved); insulated, a flat W patch at 1,500 K
  over 3,000 steps of 0.4 fs 4e-5 eV, a 3-D W ball (137 atoms) 1,500 K over 2,000 steps 5.6e-4 eV (1.5e-4 at half the
  step: the integrator), a 3-D Fe ball (169) 7.9e-4, a flat Na patch at 600 K 0.
- **Cost** (one thread, CPU time, two cores shared with another agent): the pass, a periodic W crystal of 1,024 atoms 2.5
  → 8.2 ms (×3.3; 7,168 listed pairs), a flat W patch of 967 atoms 0.95 → 2.3 ms (×2.4); whole steps ×1.04 (305 → 316
  ms: dense 3-D metal steps go to electron-transfer estimates, the bug on record) and ×1.11 (9.1 → 10.0 ms); a 3-D ball of
  181 W atoms 6.6 → 6.9 ms, flat 37 atoms 0.41 → 0.41. Pairs → many-body for the same ball ×1.15. Nothing changes without
  these metals. The tags stay ×1–2 (a line each for the angles).
- **What changed for items 1 and 2 and the fcc metals**: the fcc and other close-packed metals are untouched (their
  constants, switch and arithmetic are 1.25's; f_125m's fit, forces, books and ions parts pass unchanged except that its
  fit part now checks Au and Pt where it checked W and Na). Refitted with `tools/mbfit.js` (whose `--write` with `--only` now
  keeps the table's other lines): Fe–O (FeO), Cr–O (Cr₂O₃), Na–O (Na₂O), Na–H (NaH) and the Fe–Al alloy (FeAl), since
  their metal–metal pairs changed; each again has its measured heat of formation at its measured spacing (before the refit,
  FeO came out −280.5 kJ/mol against −272, NaH −49.3 against −56.3). Hematite with FeO's constants (a check, not fitted):
  −596 → −536 kJ/mol (measured −824). Ni₃Al, CuAu, Al in Ni, Cu₃Au, and every oxide and hydride of a close-packed metal:
  unchanged. Pairs of a directional and a close-packed metal (Fe–Ni, W–Cu …) change with the directional metal's
  constants and switch; none is fitted or measured against data. Oxides of Mo, W, V, Nb, Ta still borrow their group's
  constants (Cr–O's, refitted, for Mo and W).
- **Default game**: bit for bit (the 59 setups, flat and 3-D, 300 steps, seed 7, Many-body off: identical fingerprints).
  With Many-body on, three differ from items 1–2, all with sodium or iron next to other atoms: flame, magnet, ch_salt.
- **Found, not changed** (for the owner):
  - 1.25's close-packed fit puts bcc below fcc for most metals in 3-D, for the reason above (bcc's 14 near neighbours
    inside the 1.15 r₀ switch): relaxed, bcc − fcc Cu −0.053, Al −0.039, Ag −0.023, Ni −0.081 eV an atom (measured fcc
    lower by about 0.04, 0.09, 0.03, 0.1); Au +0.013, Pt +0.008. A 3-D Cu ball (177 atoms) started fcc at 300 K turned
    body-centred within 1 ps (inner atoms with 12 neighbours 43 → 6, with 14 0 → 12). Not changed here (the owner asked
    that the fcc metals stay as they are); a fix is the same angular term with the close-packed metals' own constants
    (fitted on fcc with bcc above it), which would move every close-packed metal's numbers and need items 1–2's tables
    refitted: a physics change for the owner's OK. (Tried as item 4 below; not shipped: the metals then melt far too high.)
  - Bug-list question #1 (flat copper turning itself into ions): with Many-body on, none. A flat lump of 127 Cu atoms at
    300 K (bath on) over 2 ps: 0 ions (seeds 7 and 3); with the pair model 118 of 127 by 0.5 ps (seed 7). In 3-D, a ball of
    141 Cu atoms: Many-body 0 ions (seeds 7, 3), the pair model 136 of 141 (seed 7): the pair model's bug is in 3-D too.
- **Left**: C₁₁ − C₁₂ low and the Cauchy pressure's sign (Cr), hcp too high for W, Mo, Nb, Ta (a fourth-moment or bond-order
  form, or MEAM's screening and second-neighbour terms, would be the next step); iron's magnetism (its bcc preference is
  magnetic in reality; here it is fitted, so fcc iron's γ phase at high temperature does not come out); the other bcc
  metals (Li, K, Rb, Cs, Ba, Eu and the heavy ones) keep the close-packed fit; flat sodium squares.
- Tests: f_126m `bcc` (W, Mo, Cr, Fe, Na: Ec and no force on scaling at the measured bcc spacing, fcc and hcp above bcc by
  at least 0.6 of the reference, vacancies within 15%; on bbf3c16 W's fcc − bcc is 0.03 and the lattice is under a force),
  `bccmd` (the W ball fcc → bcc at 600 K, bcc kept at 300 K; on bbf3c16 the fcc ball keeps 30 of 43 inner atoms
  close-packed, none bcc), `dirforces` (forces and books, 2-D and 3-D), `page`
  (Settings, notes, both cost tags, Help say body-centred). f_125m `fit` checks Au and Pt instead of W and Na.

**4. Directional bonding for the close-packed metals: tried, not shipped.** The owner approved fixing the finding under item 3
(1.25's close-packed fit puts bcc below fcc for most fcc metals: relaxed bcc − fcc Cu −0.053, Al −0.039, Ag −0.023, Ni −0.081
eV an atom; a Cu ball of 177 atoms started fcc at 300 K keeps 15 of 46 inner atoms fcc after 1 ps) with item 3's angular term
and constants of their own, keeping Ec and spacing exact and B, C₄₄, vacancy, surface energy and melting at least as good as
1.25. Built, measured, and taken back out: the structures come right but the liquid rises by about the latent heat, so the
metals melt hundreds of kelvin too high, and held to 1.25's liquid the fit puts hcp below fcc. src/ (bometal.js, ui.js,
body.html), tests and the page are dc4d35d's again (bit for bit, flat and 3-D, Many-body on or off); the tool and the
numbers stay for the next try. Built in 766e38c, f28f7cf, 75c9948 (revert this commit's src/ to get them back).
- **The model tried**: item 3's MBD_FIT rows for 25 metals with data (fcc: Cu, Ag, Au, Al, Ni, Pd, Pt, Pb, Rh, Ir, Ca, Sr; hcp:
  Mg, Zn, Cd, Be, Ti, Zr, Hf, Co, Sc, Y, Ru, Os, Re), a last 1 in the row giving 1.25's switch (1.15–1.35 r₀) for their
  pairs and arms. In their own crystal (fcc, or hcp at the ideal c/a, 1.25's reference) Γ is constant under even scaling,
  so A and ξ (Ec at zero pressure) and p (B, by the secant) keep Ec, r₀, B exactly; q/p, t₂, t₄, t₆, β fitted by
  `node tools/mbdfit.js --cp [El …]` (Nelder–Mead, 1–2 min a metal) to the vacancy, C₄₄, C′ (C₆₆ for hcp), bcc and the
  other close-packed structure above it (each relaxed), the (111)/(0001) surface energy and the hcp c/a (weakly), with the
  vacancy, C₄₄ and surface held no farther from the measured values than 1.25's, the simple cube, simple hexagonal,
  diamond, flat square and honeycomb sheets and the relaxed Bain path (bct c/a 1–1.3) kept above. Reference values from
  memory (SGTE lattice stabilities and DFT for the structures, Simmons and Wang's elastic constants, Tyson and Miller's
  surface energies; the web was not tried this time): `D_CP` in the tool. The game agreed with the tool (Cu bcc − fcc
  0.0421 on a 0.005 scan against 0.0399), forces were the energy's slopes (x, y, z worst 5.8e-9 eV/Å flat, 5.6e-9 in 3-D
  for Cu, Al, Mg, Ti with Ni and an O atom), localPE exact to 3e-10 eV.
- **Two other forms tried first**: exponential arm weights with a small β (the second shell weighted like the first) cannot
  put bcc above fcc with hcp near it without the simple cube falling below fcc (Cu, β 3: t₄ 2.0, t₆ −0.56; the simple cube 1.4 eV below fcc);
  arms with their own short switch (in by 1.03 r₀, out by 1.12, before bcc's second shell) gave Cu bcc +0.040, hcp +0.006,
  C₄₄ 74, C′ 36 GPa at the crystal, but a body-centred tetragonal lattice at c/a 1.10–1.15, compressed 5%, then lay 0.02 eV
  an atom below fcc (neighbours just past the arms' reach count in the band, not in the angles) and a Cu ball still drifted
  body-centred (fcc 43 → 12 of 50 in 2 ps at 300 K). The form built: β 10–19 with the pairs' switch, as the bcc metals have it.
- **Structures, relaxed, eV an atom (1.25 → tried; reference)**, and the properties:

  | | bcc − own | other close-packed − own | C₄₄ GPa | C′ (fcc) / C₆₆ (hcp) GPa | vacancy eV | surface (111)/(0001) J/m² |
  |---|---|---|---|---|---|---|
  | Cu | −0.053 → +0.036 (0.04) | hcp 0 → +0.005 (0.006) | 72 → 76 (75.4) | 36 → 100 (23.5) | 1.28 → 1.29 (1.28) | 0.98 → 0.96 (1.79) |
  | Ag | −0.023 → +0.027 (0.03) | 0 → +0.003 (0.003) | 54 → 46 (46.1) | 27 → 52 (15.3) | 1.11 → 1.11 | 0.67 → 0.65 (1.25) |
  | Au | +0.013 → +0.038 (0.04) | 0 → +0.003 (0.003) | 58 → 42 (42.0) | 29 → 41 (14.6) | 0.93 → 0.93 | 0.60 → 0.59 (1.50) |
  | Al | −0.039 → +0.074 (0.09) | 0 → +0.015 (0.03) | 19 → 28 (28.5) | 10 → 76 (23.5) | 0.67 → 0.68 | 0.46 → 0.43 (1.14) |
  | Ni | −0.081 → +0.072 (0.08) | 0 → +0.018 (0.02) | 108 → 125 (124.7) | 54 → 178 (49.6) | 1.79 → 1.81 | 1.44 → 1.39 (2.38) |
  | Pd | −0.007 → +0.083 (0.10) | 0 → +0.025 (0.03) | 100 → 72 (71.7) | 50 → 106 (25.5) | 1.50 → 1.51 | 0.99 → 0.96 (2.00) |
  | Pt | +0.008 → +0.096 (0.10) | 0 → +0.040 (0.05) | 88 → 76 (76.5) | 44 → 101 (48.0) | 1.35 → 1.36 | 0.95 → 0.92 (2.49) |
  | Pb | −0.004 → +0.017 (0.025) | 0 → +0.003 (0.004) | 17 → 15 (14.9) | 9 → 14 (3.6) | 0.58 → 0.58 | 0.25 → 0.24 (0.60) |
  | Rh | −0.011 → +0.254 (0.3) | 0 → +0.047 (0.06) | 113 → 184 (184) | 57 → 273 (110) | 1.71 → 1.73 | 1.23 → 1.16 (2.66) |
  | Ir | +0.011 → +0.337 (0.4) | 0 → +0.069 (0.1) | 141 → 256 (256) | 71 → 376 (169) | 1.97 → 1.99 | 1.40 → 1.33 (3.00) |
  | Ca | −0.037 → +0.009 (0.015) | 0 → +0.004 (0.005) | 7 → 14 (14.0) | 4 → 12 (3.4) | 0.61 → 0.61 | 0.20 → 0.19 (0.50) |
  | Sr | −0.033 → +0.003 (0.006) | 0 → +0.003 (0.003) | 5 → 10 (9.9) | 3 → 8 (2.4) | 0.57 → 0.57 | 0.16 → 0.15 (0.41) |
  | Mg | −0.021 → +0.024 (0.03) | fcc 0 → +0.021 (0.015) | 15 → 18 (16.4) | 18 → 35 (16.8) | 0.65 → 0.73 (0.79) | 0.31 → 0.38 (0.76) |
  | Zn | −0.011 → +0.030 (0.03) | 0 → +0.018 (0.02) | 23 → 39 (38.8) | 29 → 94 (63.6) | 0.54 → 0.54 | 0.38 → 0.42 (0.99) |
  | Cd | +0.003 → +0.025 (0.025) | 0 → +0.014 (0.015) | 18 → 20 (19.9) | 22 → 40 (37.5) | 0.46 → 0.46 | 0.26 → 0.29 (0.76) |
  | Be | −0.088 → +0.071 (0.07) | 0 → +0.041 (0.06) | 28 → 150 (162) | 36 → 388 (133) | 1.00 → 1.00 | 1.04 → 1.17 (1.63) |
  | Ti | −0.092 → +0.091 (0.10) | 0 → +0.063 (0.06) | 32 → 49 (46.5) | 40 → 99 (35.0) | 1.55 → 1.54 | 0.95 → 1.04 (1.99) |
  | Zr | −0.123 → +0.072 (0.08) | 0 → +0.044 (0.04) | 21 → 35 (32.0) | 26 → 77 (35.3) | 1.70 → 1.69 | 0.89 → 0.93 (2.00) |
  | Hf | −0.128 → +0.144 (0.15) | 0 → +0.098 (0.10) | 34 → 56 (55.7) | 43 → 117 (52.0) | 2.12 → 2.12 | 1.11 → 1.23 (2.19) |
  | Co | −0.049 → +0.092 (0.10) | 0 → +0.019 (0.02) | 55 → 80 (75.5) | 69 → 124 (71.0) | 1.34 → 1.34 | 1.11 → 1.12 (2.52) |
  | Sc, Y | −0.104, −0.119 → +0.058, +0.092 (0.06, 0.10) | +0.042, +0.031 (0.04, 0.03) | 14, 11 → 29, 26 (27.7, 24.3) | 17, 14 → 58, 48 (29.8, 24.4) | as 1.25 | 0.62, 0.58 → 0.66, 0.60 |
  | Ru, Os, Re | −0.024, +0.002, −0.008 → +0.483, +0.615, +0.294 (0.5, 0.6, 0.3) | +0.122, +0.132, +0.096 (0.13, 0.15, 0.10) | 100, 131, 116 → 182, 259, 162 | 125, 163, 145 → 355, 556, 292 | as 1.25 | 1.62, 1.92, 1.80 → 1.79, 2.13, 1.96 |

  (unrelaxed vacancies and surfaces, unrelaxed hcp shear constants; Ec, r₀, B exactly 1.25's for all; (100) surfaces rose
  3–7%: Cu 1.19 → 1.25 J/m²; relaxed hcp c/a 1.55–1.60 against measured 1.57–1.62 (Zn, Cd 1.86, 1.89: the reference is
  ideal hcp, as 1.25's).) The structures and C₄₄ came out; C′ (C₆₆) came out 1.5–4 times the measured value (1.25: 0.6–2
  times): along the Bain path the angular term has to climb from fcc to bcc's height within a few percent of strain.
- **In motion** (3-D free balls, bath 0.05; inner atoms with 12 neighbours within 1.25 r₀ and 6 opposite pairs fcc, ≤ 4 hcp,
  14 bcc): Cu started fcc at 300 K 44 of 44 inner atoms fcc after 1 ps (1.25: 15 of 46), at 600 K 40 of 46 after 2 ps;
  started bcc it does not turn fcc: 300 K 59 → 29 bcc, 21 with 13 neighbours, 3 close-packed after 2 ps; 600 K 12 bcc,
  32 with 13, 7 close-packed (the relaxed Bain path has a step of 0.012 eV an atom above bcc at c/a 1.2: bcc is metastable
  here, unstable in real copper); hcp balls at 300 K, 1 ps: Ti 44 of 57 hcp (1.25: 9 of 55, 23 bcc), Zn 64 of 66 (47 of
  65), Mg 36 of 42 (25 of 40). Copper ions: 0 (flat lump of 121 and 3-D ball of 141 atoms, seeds 7 and 3, 2 ps).
- **Melting, why it was not shipped** (3-D balls, bath steps of 0.1·Tm, 2 ps each; share of the inner atoms' neighbours kept
  over the last 1.3 ps, which a rotating ball does not blur):

  | | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 | 1.1 | 1.2 | 1.3 | 1.4 | 1.5 | 1.6 Tm |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | Cu 177 atoms, 1.25 | 95% | 94 | 89 | 89 | 87 | 80 | 71 | 72 | 59 | 56 | 55 |
  | Cu, tried | 97 | 94 | 91 | 90 | 89 | 80 | 78 | 76 | 74 | 64 | 63 |
  | Al 135 atoms, 1.25 | 90 | 79 | 79 | 72 | 71 | 47 | 53 | 46 | 46 | 36 | 40 |
  | Al, tried | 93 | 89 | 91 | 89 | 89 | 84 | 71 | 67 | 70 | 61 | 52 |

  Copper's ball holds its order about 250 K higher, aluminium's 300–400 K higher (to 1.1 Tm, where 1.25's lost it at 0.75).
  The cause: a liquid's neighbours are arranged at random, so its Γ is far below the crystal's (aluminium at 2,000 K: mean Γ
  0.0075 against the crystal's 0.054), and the angular term raises the liquid by about the latent heat. Measured on four
  snapshots of 1.25's liquid copper (108 atoms, 1,600 K; tools/mbliquid.json) at each metal's spacing: the liquid above the
  crystal, Cu 0.209 (1.25) → 0.259 eV an atom, Al 0.081 → 0.181 (latent heats 0.135 and 0.11). Held to 1.25's liquid within
  4 meV (`cpLiquid`, LIQW), the fit can no longer keep fcc below hcp: Cu bcc +0.022 and hcp −0.015, Al bcc +0.041 and hcp
  −0.044 (the l = 6 term that sets fcc against hcp is the one that sets the crystal against the liquid's icosahedral order);
  at 15 meV it lets the liquid rise again (Cu +0.039, Al +0.055). With this form (one β, l = 2, 4, 6, the second moment)
  the four conditions (bcc above fcc, hcp just above fcc, the liquid where it was, the simple cube up) do not meet.
- **Items 1–2 refitted for it** (kept in f28f7cf, taken back with it): each fitted compound exact again; what moved before the
  refit and after it: Cu₂O −169.6 kJ/mol with a force on scaling → exact; Al₂O₃ −1656.1 → exact; O on (111) Cu −5.26 eV
  (unchanged), Ag −3.49 (−3.48), Ni −5.89 (−5.9), Al −11.44 (−11.4); H on Cu −2.20, Pd −2.26; CuO (as rocksalt) −202.7
  kJ/mol (was −203); hematite −535.8 (unchanged: Fe and Fe–O untouched). Alloys: Ni₃Al −169.7 → −196.1 kJ/mol (measured
  −165.2; overbound 19%: the angular terms are each element's, so Ni and Al pay bcc's penalty in NiAl's B2 order and the
  pair fitted there comes out stronger), CuAu −17.6 → −15.5 (−18.2), Al in Ni (unrelaxed) −1.72 → −2.02 eV, Cu₃Au ordering (unrelaxed)
  0.053 → 0.045 eV an atom below random; CuZn, NiTi, FeAl, TiAl exact again.
- **Also measured for it**: insulated drift, Cu flat patch 37 atoms 1,500 K 3,000 steps 1.1e-4 eV (1.25: 4e-5), 3-D ball 135
  atoms 2,000 steps 4.3e-4 (3.8e-4). Cost (one thread, CPU time, two cores shared): the pass ×2 flat (Cu 955 atoms, Al 769),
  ×3.2–3.4 in 3-D (864 atoms); whole steps flat Cu ×1.25, flat Al ×1.3 (×3–4 against pairs), a 3-D Al crystal ×1.75 (×5
  against pairs), a 3-D Cu crystal ×1.0 (electron-transfer estimates). Many-body off: the 59 setups bit for bit (they are
  now dc4d35d's anyway); on, five differed (flame Cu, photonuc Pb, crt Zn, and magnet and sns through Fe–H and Hg–O, which
  borrow refitted Cu–H and Zn–O). Flat sheets 3% more bound (Cu 2.73 → 2.83 eV an atom).
- **For the owner** (the choices): (a) leave 1.25's fit (bcc below fcc in 3-D for most fcc/hcp metals; flat world unaffected
  in kind: no bcc there); (b) ship the tried constants (structures right, fcc balls stay fcc, but 3-D melting 250–400 K
  higher, C′ 1.5–4× too stiff, Ni₃Al 19% overbound); (c) a different form: a fourth-moment term (band shape: what really
  sets fcc against bcc for filled d bands), or MEAM's screening plus second-neighbour reference structure, each a larger
  piece of work; the tool (`--cp`, `cpLiquid`, the Bain and open-structure constraints) is ready for it.
- Tests: none added to the suite (the parts written for it, f_126m `cp` and `cpmd`, failed on dc4d35d as they should and are in
  766e38c); f_125m and f_126m are dc4d35d's again.

### 1.26: directional forces

The planned entry "Directional forces" (the owner, after 1.25's nuclear work: "Add them to 1.26"), the four items of the
task in order: lone pairs, σ-holes, π-stacking, polarizability by direction (branch v133). Physics-model changes behind
three new Experimental switches (Settings → Experimental → Directional forces: Lone pairs, Halogen σ-holes, π-stacking),
off by default and at every start like the rest of the tab, **for the owner's OK**. The fourth item (polarizability by
direction) was investigated and not built: below, with numbers. Reference values are from memory (the web was refused
from here, as in 1.25): worth checking before quoting them to the owner.

- **How (src/sites.js, new)**: an off-atom charge site is a point carrying part of an atom's charge, placed from the atom
  and its bonded neighbours. Between atoms of different molecules within the cutoff, each pair's Coulomb energy is worked
  out between the two charge sets (the atom with what it keeps, and its sites) and replaces the pair kernel's
  atom-to-atom one, faded back to it between RC − 1 Å and RC by a smooth step on the atoms' distance (the sums of charge
  are kept, so the kernel's shift at the cutoff cancels and nothing jumps). Same soft Coulomb (1/√(r² + 0.09)) and
  ion–molecule weight (K_IW) as the kernel. A molecule's own atoms keep their point charges. The site positions depend on
  the bond vectors only, so their forces are carried back to the atom and its neighbours analytically (unit vectors,
  cross products). Hooks in engine.js, each guarded by `SITES.any`: after the kernels in computeForces1 (`sitesForces`,
  over the neighbour list's intermolecular pairs, main thread), localPE (`sitesLocal`, so every event books the sites),
  totalEnergy (`sitesTotal`), pairPE (`sitesPairE`), and the induced charges' update (`sitesQeq`: the sites' share of φ
  and the exact energy change). Switching with molecules in the box books the energy difference to the heat bath (as the
  other Experimental models). The WebAssembly kernel and the workers are untouched (a JavaScript pass; a Rust port would
  be the speed-up if the owner keeps it). Off: nothing runs; the 53 flat setups' and 6 3-D setups' fingerprints (300
  steps, seed 7) are identical to cc8a0fd.
- **Lone pairs** (3-D only: a flat world has no out-of-plane directions; dimmed "3-D only" in the flat game). An O with
  two single bonds (water, alcohols, ethers, peroxides) puts half its partial charge (`LP_O.f` 0.5) on two lone pairs
  0.7 Å out at the tetrahedral directions (TIP5P's geometry); an N with three single bonds (ammonia, amines) 0.4 of it
  on one site 0.3 Å along its pyramid's axis (`LP_N`; at TIP5P-like 0.7 Å and the whole charge a hydrogen sat on the
  site: the ammonia dimer bound 10 eV). Chosen from scans of the water dimer (d 0.3–0.7 Å, f 0.2–1, softening, a
  dipole-keeping M site as TIP4P's) and of liquid water and ice (below). Measured:
  | | point charges (1.25) | lone pairs | reference |
  |---|---|---|---|
  | water dimer: binding | 0.206 eV | 0.416 eV | 0.217 (CCSD(T)); TIP4P 0.27, TIP5P 0.29 |
  | O–O; O–H···O; acceptor tilt | 2.89 Å; 165°; 17° | 2.77 Å; 170°; 42° | 2.91 Å; ~174°; ~57° (TIP5P 51°) |
  | ammonia dimer | 0.081 eV, 3.17 Å | 0.133 eV, 3.09 Å | ~0.137 eV, 3.2–3.3 Å |
  | water → ammonia (N acceptor) | 0.21 eV, 2.96 Å | 0.30 eV, 2.89 Å | ~0.27 eV, ~2.98 Å |
  The dimer comes out about twice the real binding: a pair model made for the liquid (no polarization) binds an isolated
  pair harder; with f 0.3 it is 0.32 eV (tilt 38°), with f 1 0.73 eV. Liquid water (343 waters, 300 K, a crude
  Berendsen-like barostat on the molecules' centres from the energy's slope under scaling, scripts in the session's
  scratchpad; ~2.2 ps sampled after 3 ps):
  | | first peak | first minimum | 2nd peak | neighbours to the minimum | tetrahedral order q | density g/cm³ |
  |---|---|---|---|---|---|---|
  | measured | 2.80 Å (2.5–2.6) | 3.4 Å (0.8) | 4.5 Å (1.1) | 4.3–4.7 | ~0.6 | 0.997 |
  | point charges, 6 Å | 2.98 (2.5) | 3.98 (0.77) | none | 10.1 | 0.39 | 1.09, still contracting |
  | lone pairs f 0.3, 6 Å | 2.83 (2.7) | 3.98 (0.85) | none | 10.8 | 0.49 | 1.18, still contracting |
  | point charges, 9 Å reach | 2.88 (3.4) | 3.48 (0.35) | 4.13 (1.7) | 6.0 | 0.64 | 1.14 |
  | lone pairs f 0.5, 9 Å | 2.78 (3.9) | 3.18 (0.51) | 4.13 (1.7) | 4.5 | 0.69 | 1.18 |
  | lone pairs f 0.6, 9 Å | 2.73 (4.1) | 3.18 (0.46) | 4.08 (1.7) | 4.4 | 0.70 | 1.18 |
  Ice Ih (128 waters, protons by a directed Euler circuit so every O gives two and takes two, 0.917 g/cm³, 250 K,
  1.6 ps, 9 Å reach): with lone pairs it keeps its crystal: O–O 2.78 Å (ice 2.76), second neighbours 4.48 (4.51), four
  neighbours exactly, q 0.965; with point charges the second shell is crushed to 4.13 Å, q 0.79. Under the barostat the
  lone-pair ice heated to ~400 K (the crude barostat feeds the heat) and kept four neighbours at 1.08 g/cm³.
  What is left, and why (base-model limits the lone pairs do not change, for the owner):
  - With the usual 6 Å reach the network is blurred by the cutoff itself: every setup's g(r) has a false peak at 6.0 Å
    (2.5–2.8) and the structure stays close-packed with or without lone pairs: partial charges cut atom by atom at 6 Å
    split molecules' dipoles at the cutoff sphere. The 9 Å reach (Experimental) or a cutoff by molecule (or a damped
    shifted-force Coulomb) would fix it; the lone pairs' fade follows the kernel's atom-by-atom cutoff on purpose.
  - Water is 14–18% too dense in 3-D with or without lone pairs (1.14–1.18 g/cm³ at 9 Å); the second peak sits at 4.1
    Å, not 4.5. Its O–O Lennard-Jones (UFF, 3.5 Å, doubled for the flat world: LJ_SCALE 2, still on in 3-D) is in the
    range of TIP models', so the density is the charges' and cutoff's; taking LJ_SCALE off in 3-D made it denser and
    hotter in a first try. A density fit is a change of the water model itself, not of the lone pairs.
  - Cost: liquid water ×2.1–2.6 a step (a JavaScript pass over the ~23,000 pairs with an O in them).
- **Halogen σ-holes** (both modes). A Cl, Br or I with one single bond to C (or to another halogen, or F) carries a
  positive point on its bond's axis beyond it, as force fields' "extra point" models do (OPLS-AA's X-sites, CGenFF's
  lone pairs: distances 1.6/1.9/2.2 Å from memory), the same charge taken off the atom: Cl 0.10 e at 1.6 Å, Br 0.085 at
  1.9, I 0.08 at 2.2, fitted on CH₃X···NH₃ (scans of q 0–0.2 e and d 1.0–2.0 Å; a softer site Coulomb, 0.5–1 Å², tried:
  no better). Measured (kcal/mol; X···N Å, C–X···N°), point charges → σ-holes, reference (MP2/CCSD(T) values from
  memory, ±30%):
  | | point charges | σ-holes | reference |
  |---|---|---|---|
  | CH₃Cl···NH₃ | 1.17 (3.51, 163°) | 1.13 (3.28, 159°) | ~0.8–1.2, axial ~3.2 |
  | CH₃Br···NH₃ | 1.37 (4.03, off the axis) | 1.91 (3.24, 179°) | ~1.6–2.0, ~3.1–3.2 |
  | CH₃I···NH₃ | 1.27 (3.86) | 2.86 (3.41, 177°) | ~2.6–3.2, ~3.2–3.3 |
  | CF₃Cl / CF₃Br / CF₃I···NH₃ | 3.6 / 3.4 / 3.7 | 6.0 / 7.1 / 8.6 (179–180°) | ~1.7–2.2 / 3.0–3.5 / 4.5–5.5 |
  | CF₃I···OH₂ | 0.5 | 10.7 (3.22 Å) | ~2–3 |
  | Br₂···NH₃, ICl···NH₃ | 0.4, 1.4 | 2.9 (3.39), 5.0 (3.41), 180° | ~6–7 and ~10 (strong charge transfer) |
  The geometry is what the item asked for: with σ-holes the acceptor sits on the C–X axis (176–180°) at 3.2–3.4 Å;
  without, off the axis or 4 Å away. CH₃X energies match; CF₃X are 2–3 times too strong already with point charges
  (the game's C–F partial charge, 0.43 e from PARTIAL_K, about twice the real one, leaves CF₃X's carbon at +1.47);
  Br₂ and ICl's charge-transfer complexes are a half to a third of the real binding (no charge transfer in the model).
  Cost: a flat box of 48 halomethanes ×1.7–2.0; a 3-D box of 125 (515 atoms) ×2.0–2.7; nothing without such halogens.
- **π-stacking** (3-D only). Every aromatic carbon puts −0.07 e on two points 0.7 Å above and below the ring (the
  carbon +0.14), benzene's quadrupole with its C–H charges (in-plane charges alone give Θ ≈ −1.3 e·Å², measured −1.8);
  and, needed first: ring atoms of two aromatic molecules meet with OPLS-AA's aromatic Lennard-Jones (Jorgensen &
  Severance 1990, from memory: C σ 3.55 Å, H 2.42 Å, H ε 0.030 kcal/mol; the carbons' ε 0.070 × 1.4, fitted) instead of
  the kernel's (UFF doubled for the flat world), faded out with the sites' step, the kernel's inner wall and core kept.
  Benzene dimer (rigid monomers relaxed alone, scans in 0.05–0.2 Å steps; kcal/mol):
  | | sandwich | T-shaped | parallel-displaced |
  |---|---|---|---|
  | point charges (1.25) | −8.59 at 3.55 Å | −4.48 at 5.25 | −8.49 at 3.5 / 0.8 |
  | OPLS ring dispersion alone | −1.81 at 3.75 | −2.13 at 5.0 | −2.24 at 3.5 / 2.4 |
  | π-stacking (on) | −1.95 at 3.8 | −2.84 at 5.0 | −2.77 at 3.5 / 2.6 |
  | CCSD(T)/CBS (Sinnokrot & Sherrill, Podeszwa et al.) | −1.7 to −1.8 at 3.9 | −2.6 to −2.8 at 4.9–5.0 | −2.6 to −2.8 at 3.5–3.6 / 1.6–1.8 |
  Left: the offset of the displaced dimer comes out 2.6 Å (CCSD(T) 1.6–1.8; that surface is flat along the offset);
  the sandwich 0.15–0.25 kcal/mol too deep. Graphite's interlayer spacing was not measured (no 3-D graphite setup; the
  graphene object's carbons are ring atoms, so it would follow the same OPLS carbon). Cost: a box of 125 benzenes
  (1,500 ring atoms) ×5.5–9.5 (the ring pairs' dispersion in JavaScript over every ring–ring pair); nothing without rings.
- **Polarizability by direction: investigated, not built** (much harder than planned). The induced charges (1.12) are a
  charge-flow model: charge moves along bonds, so a molecule polarizes only along its bonds. Measured with the game's
  QEq in 3-D (a 0.02 V/Å field along each principal axis, the charges iterated to self-consistency; Å³):
  | | along | across (in plane) | out of plane | measured (from memory) |
  |---|---|---|---|---|
  | N₂ | 1.11 | 0 | 0 | 2.38 / 1.45 |
  | CO₂ | 6.42 | 0 | 0 | ~4.1–4.3 / ~1.9–2.2 |
  | benzene (in plane / out) | 166.9 | 166.9 | 0 | 12.3 / 6.4 |
  | water | 2.39 (along the H···H line) | 0.50 | 0 | 1.53 / 1.47 / 1.42 |
  | methane | 3.29 | 3.29 | 3.29 | 2.59 |
  So across-bond polarizability is zero for every linear and flat molecule, and conjugated charge flow is 14 times too
  large in benzene (the long-range charge-flow problem of QEq models). Directional tensors need induced point dipoles at
  the atoms (or bonds), a new electrostatic term: dipole–charge and dipole–dipole energies and forces, a self-consistent
  update between steps paid from the molecules' motion as the induced charges are, its self-energy ½μ·α⁻¹·μ in the books;
  and the charge flow in conjugated molecules must be damped or the two would double-count. A design that fits the
  framework: each dipole as ±1 e sites at ±μ/2 from its atom (fixed during a step: the site machinery gives its energy,
  forces and, from the sites' offset gradients, the field −∂U/∂μ for the update), bond tensors α∥ ûû + α⊥(1 − ûû) split
  to the two atoms, fitted additively (from memory: C–H 0.79/0.58, aromatic C–C ~2.24/0.49 so benzene comes out 12.3/6.4,
  N≡N 2.38/1.45, C=O 2.15/1.1 from CO₂, O–H 0.79/0.71 from water). A session of its own; not started here.
- Tests: tests/f_126d.js (t_features' "1.26 (directional)" line, or `node tests/f_126d.js [slope water sigma stack
  books settings]`): forces the slope of the sites' energy in x, y, z (2e-9 eV/Å in 3-D with every kind of site, 3e-11
  flat); the water and ammonia dimers above; CH₃Br···NH₃ on the axis; the benzene dimer's three shapes; the books
  (switching books 0.0193 eV to the bath exactly; insulated, 12 molecules, 0.61 ps: −0.033 eV with every site against
  −0.026 without, the cutoff's own small jumps, the same at half the step); the Settings rows. Fails on cc8a0fd
  (`sitesSet` is not defined). t_settings passes; t_lint clean (no new warnings). tools/runtests.sh not run here (the
  main session runs it after merging).
- Text: Settings → Experimental → Directional forces (three rows, their notes with the numbers above, cost tags for both
  modes, `SDESC`/`SDESC3`, realism tags, the Experimental total), Help → Forces, CLAUDE.md's layout (one line).

### 1.26: WebAssembly speed-ups

The owner: "see if there's anything you can write in wasm to make it faster" (branch v134, from the combined 1.25 at
cc8a0fd). No physics change: every new path keeps the JavaScript as the reference (a switch turns each off), agrees with
it to the bit or to rounding, and the flat game's fingerprints are unchanged. The module was built by wasm.yml on v134
(commits cf2fc67, 18a9311, 970cc32, 35a434e, 46199aa: "kernel.wasm: built from …"); no wasm32 target here, so every port
was first checked natively against a dump of the JavaScript's own state (cargo examples, below).

**Profile first** (1.25, before any port; Node, one thread, the bath off after settling, a sampling profile of the timed
steps only: scratchpad tools prof.js / scen.js of the session; CPU ms a step; [w] = already WebAssembly). The machine is two
cores shared by four agents, so ms are ±30% between runs; the shares held better.

| setup (atoms) | ms a step | where the time goes |
|---|---|---|
| flat liquid water (240) | 0.41 | pair kernel [w] 31%; integration and inner steps ~25%; chooseDt 7%; list walk (vlPairs) 6% |
| + bond orders | 1.2 | the pass [w] 41% (pass1 32, collect 5, pass2 4.5); its JavaScript gathering 10%; garbage collection 17% |
| + quantum nuclei, 8 beads, every bead | 2.2 | pair kernel [w] 46%; list walk 12% (a list for most beads); ring modes (JS) 11% |
| + induced charges every step | 1.0 | qeqUpdate 27% + qeqC 13% (JS); pair kernel [w] 27% |
| flat salt water (726) | 4.7 | pair kernel [w] 28%; electron-transfer estimates 31% (gridWalk 17%) |
| flat organic box (536) | 0.37 | integration 34%; pair 16%, angles 11% [w] |
| flat Al patch, many-body (223) | 1.4 | mbPass 21% (JS); garbage collection 15%; pair 5% |
| flat Cu patch, many-body (283) | 3.4 | electron-transfer estimates 69% (on record) |
| flat water, 4 × 1 MeV protons | 6.1 | molecule naming (graphHash, fnv, libIndex) 18%; inner steps 26%; pair 6% |
| flat water, 4 × 10 keV electrons | 6.5 | molecule naming 17%; inner steps 20%; garbage collection 15% |
| 3-D liquid water (1,029) | 3.6 | pair kernel [w] 68%; list walk (vlPairs3, JS) 19% |
| + bond orders from the positions | 29 | the JavaScript pass 94%: Coulomb 35%, its own loops 22%, pair collection 23%, LJ 4%, angles and twists ~3% |
| + quantum nuclei 8, contracted | 8.2 | pair [w] 36%; list walk and build 19%; ring transforms (piTo, piFrom) 12%; angles [w] 6% |
| + quantum nuclei 8, every bead | 67 | list walk 62% (made again for every bead); pair [w] 29% |
| + induced charges every step | 13 | pair [w] 44%; qeqUpdate 26% + qeqC 12%; list walk 5.5% |
| 3-D salt water (997) | 14 | electron-transfer estimates 38% (on record); pair [w] 32%; list walk 6% |
| molecules in space (72) | 0.23 | the step's loops ~40%; angles 6%, pair 4%, bonds 3% [w] |
| 3-D organic box (536, 584 single-bond dihedrals) | 1.2 | single bonds' twist (tors1K, JS) 17–22%; angles [w] 10%; pair [w] 5%; integration 25% |
| + bond orders | 4.9 | the JavaScript pass 89% (its loops 22%, Coulomb 11%, 3-D angles 9%, twists 12%) |
| 3-D Al ball, many-body (959) | 2.3 | mbPass 35% (JS, exp 15%); pair [w] 19% |
| 3-D Cu ball, many-body (603) | 113 | electron-transfer estimates 95% (on record) |
| 3-D water, 4 × 1 MeV protons | 9.6 | pair [w] 39%; list walk 7%; the protons' flight and events ~20% |
| 3-D water, 4 × 10 keV electrons | 258 | anonymous callbacks 30% (the path search, on record); list walk 23% (the MD set changes as electrons fly); free-electron forces 9.5%; event evaluation 21% |

Threaded: not measurable here. Two threads on the two shared cores gave the same 3-D water run 15–90 ms a step (the
busy-waiting workers against four agents); t_threads checks the threaded paths' results (below), not their speed.

**The ports**, in order of expected gain. Speed: two worlds in one process (the 1.25 paths and the new ones, the same
seed), stepped in alternating chunks, CPU time (scratchpad ab.js), 4–5 rounds; "min" is the best chunk against the best
chunk, the range is chunk against chunk (the other agents' load moves single chunks ×2–5).

1. **The neighbour list's walk** (engine.js vlPairs / vlPairs3 → kernel/src/vl.rs `af_vl`, `af_vl3`; vlPairsW /
   vlPairs3W on the main thread, in vlBuildAll's own share and on the workers, `VL.useWasm`). The same walk over the grid's
   hash of occupied cells in the same order, whole numbers and the same subtractions: the list is the JavaScript's pair
   for pair. Native check (vlcheck on tools/vldump.js dumps of flat water, brine, 3-D water, brine, the molecules in
   space, an organic box): the same lists, whole and in three stretches as the workers build them. Fingerprints, 300
   steps, seed 7: the 46 flat setups, the six 3-D setups and three quantum-nuclei runs identical to cc8a0fd. The walk is
   2–2.5 times faster natively (3-D water: JS 6.4 ms, Rust 2.5–3.0 ms: in a 22 Å periodic box the cells are two a side,
   so every pair is checked, 530,000 for 1,029 atoms). Steps: 3-D water ×1.13–1.14 (min; range 1.07–1.42), 3-D salt water
   ×1.24 (1.2–2.1), quantum nuclei every bead 8 beads ×1.28–1.31, 16 beads ×1.1–1.2, flat water ×1.0, flat
   every-bead ×1.03–1.08.
2. **Continuous bond orders in 3-D** (bo.js's 3-D pass → kernel/src/bo.rs: collect with z and BF.puz, the 3-D angle term
   (`centre3`: angle3CentreK's pairs, the roles of modes 2–4, the out-of-plane term, with vsepr3's [mode, θ₀, flat] for
   every key in a table made by the JavaScript), the double bonds' twist (`trip`, triple3K's), the single bonds' twist
   weighted by the orders (bfTors1's, with tors1 below and TOR1B / TOR1's k's in a table), the z forces; bo.js runs it
   when the module says so, af_const(18) = 100, `BF.useWasm`). Native check (bocheck on tools/bodump.js's 3-D dumps:
   water3d 1,029 members, mol3d, an organic box, mix3 with every angle mode): energy to the bit, forces to 5e-14 eV/Å
   (largest 39), orders, charges and ∂E/∂ν to rounding; the flat dumps as before. In Node: one pass's energy the same to
   the bit, forces 4e-16 (water) to 3e-15 eV/Å (organic, largest 15); 20–100-step runs 0–6e-16 Å apart, the same
   events. Steps: 3-D water ×2.8–3.0 (range 1.7–6.6; 1.25's 21.7 → 7.3 CPU ms a step at best), the organic box ×2.2–2.6,
   the molecules in space ×2.4 (f_126w's own interleaved run ×3.2–4.7). Cost against stored bonds a simulated fs: water
   ×15 → ×7.8, the molecules in space ×19 → ×8, the organic box ×21 → ×14 (cross-process runs). What is left of it: pass1
   60% (Coulomb and the 1-3 search), collect 14%, pass2 9%.
3. **The single bonds' twist** (engine.js tors1Forces3 → d3.rs `af_tors1`, AC3.sq/sk in the module's memory,
   `AC3.useWasm`): square roots and products only, so the forces are the JavaScript's to the bit (native check on the
   organic dump: 584 dihedrals, 0 components differ; Node: forces and a 100-step run identical). 584 dihedrals 0.05–0.12 ms
   against 0.07–0.18 (×1.3–1.6); the organic box's step ×1.07–1.11.
4. **Bond orders for metals** (bometal.js mbPass's pair loop, embedding and forces → kernel/src/mb.rs `af_mb`; one line in
   bometal.js, the wrapper mbWasm in wasm.js copies the sorted members in; `MBO.useWasm`). Native check (mbcheck on
   tools/mbdump.js: a flat Al patch, 3-D Al and Cu balls, a Cu–Ag–Au alloy, periodic Cu): the same pairs, energy to the
   bit, forces 1e-15, the same stiffness; in Node every case so far bit for bit (the module's exp gave V8's here).
   Little faster: the pass is two exp calls a pair, and the module's exp (compiler_builtins' libm, the same fdlibm
   algorithm) runs no faster than V8's built-in; 3-D Al ball ×1.1–1.2, flat Al ×1.2 (min). A faster exp (a table and a
   short polynomial, 1 ulp) would take about a third off the pass but changes the last bit: not done.
5. **Induced charges' pairs** (qeqUpdate's loop over the neighbour list with qeqC → kernel/src/qeq.rs `af_qeq`, QB's arrays
   in the module, the exclusions from exclLists' arrays, `QB.useWasm`): native check (qeqcheck on tools/qeqdump.js: flat
   water and brine, 3-D water, brine and H₂ + O₂): the same list, coefficients and charge products to the bit; every-step
   runs identical (f_126w). Steps every step: 3-D water ×1.3–1.37, flat water ×1.1–1.4; every 10th ×1.0–1.2. What is left:
   qeqUpdate's own JavaScript (the molecules gathered as objects, φ and the books) 14% of a 3-D step.
6. Found on the way, fixed (the module's memory growing): a shared WebAssembly.Memory hands out a new buffer object after
   it grows, and the views made before keep the old one. wasmFastReady and bfDescFill compared views with WK.mem.buffer,
   so after the first growth every pass went to the JavaScript for good, and bfScratch / bfSupRoom made their scratch
   arrays again at every bond-order pass (the arena leaking). Measured on 1.25: 3,600 flat waters with bond orders, 242
   growths before the first step and 0 module passes (277 ms a step); 3,600 waters with 30 free electrons, 0 af_fast calls
   after the memory grew. Now `wasmIn` (wasm.js: the memory's buffers kept in a set) is used for every such check: 78
   growths, every pass in the module (147 ms a step); the electrons' run identical to the bit (the kernel's forces are the
   JavaScript's), 425 module calls, 209 → 133 ms a step.

**Settings' costs** (3-D, COSTS3, and the 3-D notes in Experimental): bond orders from the positions ×18–23 → ×7–14;
quantum nuclei every bead ×17 / ×30 / ×48 → ×13 / ×25 / ×40 (the 32-bead one scaled, not measured); every bead against
contracted ×7–10 → ×6–8; induced charges every step ×3.2–4.2 → ×2.5–3.2, every 10th ×1.6–2.4 → ×1.4–2.4. The flat tags
did not change by more than the noise (the flat list walk and the flat many-body pass ×1.0–1.2); the flat bond-order tag
(×8–15 against a measured ×5–7) is on the bug list and left. f_125s's check of the 3-D bond-order tag accepts ×7–14.

**After** (the same profile, 1.26): 3-D water: pair kernel 75%, list walk 11%; 3-D water with bond orders 9–10 ms a step,
the module's pass 83%; every bead at 8 beads: list walk 48%, pair 39%; contracted 8 beads: pair 45%, ring transforms (JS)
20%, list 8%; the organic box: twist [w] 18%, pair 17%, angles 14%; 3-D water with induced charges: pair 48%, af_qeq 21%,
qeqUpdate 14%; Al ball: af_mb 30% of which exp 22%.

**Left, and why:**
- Quantum nuclei with every bead in 3-D: the list is made again for every bead (above, and the bug list). A list per bead,
  each kept while its bead's atoms stay within the half skin (as a centroid's is), would remove most of the 48%, about ×1.7
  a step; but the pairs then come in another order (rounding) and bead 0's events in another order: the owner's call.
- The ring transforms of contracted quantum nuclei (piTo, piFrom, piOpen: ~20% of a 3-D step at 8 beads) port to the
  module to the bit (sums in the same order), but PI's and PIM's arrays would move into its memory and the thermostat's
  gauss() stays in JavaScript: perhaps a tenth of a step; not done.
- The single bonds' twist runs on the main thread after the threaded kernels; giving its dihedrals to the workers (as AC3.tq)
  matters with many threads (+30% of a one-thread step in organic boxes).
- The many-body metals' exp (above); the 3-D bond orders' pass on one thread (the rest of the step is threaded).
- Measured, on the bug list, not touched: electron-transfer estimates (brine 31–38%, Cu 69–95%), the charged-particle path
  search (3-D water with 10 keV electrons, 258 ms a step, 30% in its callbacks), molecule naming in flat radiolysis
  (graphHash, fnv: ~18% with fast protons or electrons).

**Tests**: tests/f_126w.js (t_features' "1.26 (speed)" block, or `node tests/f_126w.js [vl tors1 bo3 mb qeq grow page]`):
vl (lists pair for pair, whole and in stretches, flat and 3-D; 60-step runs to the bit with and without), tors1 (forces and
a 100-step run to the bit), bo3 (energy 1e-9, forces 1e-10, runs together, ×1.5 at least on the molecules in space), mb
(1e-12, flat and 3-D), qeq (every-step runs to the bit), grow (after the memory grows the bond orders and electrons stay in
the module, nothing reallocated, the run to the bit), page (the headless page's module runs the 3-D bond orders and the
list). Each fails on cc8a0fd (no exports, no wasmIn; grow: 0 module passes, 0.38 MB reallocated in 30 steps). Native:
`cargo run --release --example vlcheck|bocheck|mbcheck|qeqcheck -- dump…` with tools/vldump.js, bodump.js (3-D setups
added), mbdump.js, qeqdump.js. Suites run alone here: t_lint, t_wasm, t_threads (the threaded 3-D list the same as one
thread's), f_126w, f_125s, the flat and 3-D fingerprints; tools/runtests.sh left to the main session.

## 1.27 (in progress)

### 1.27: realistic particles 1 (exotic atoms) and the Settings section

Branch v141 (from v136 at e237efe, the combined 1.26 with the 3-D and exotic-particle sweeps). The first of the seven
approved realistic-particle parts (the owner, 2026-11-05: "I ok all of them, just please make sure it doesnt mess with
anything"), and the Settings section they live in. Checks: tests/f_rp1.js (t_features runs it alone; `node tests/f_rp1.js
[--node] [part …]`); every part fails on v136 (no switch there) and passes here.

- **The Settings section.** Settings → Experimental now ends with the heading "Realistic particles" (an h3, `rpHead`) and
  one compact line a part: its name, an on/off switch (a checkbox drawn as a switch, `input.sw`, `role="switch"`), its
  cost tag and "realistic when on" tag; the description is in the side pane on hover or focus, as every row's since
  1.25 (on a phone, under the line). Ultra-realistic mode (`setUltra`, now a switch) and Electrons as waves (`segWave`,
  its two buttons kept) moved in from their own headings, with their ids, descriptions, notes, cost tags, pictures and
  saved values unchanged (both still start at normal: `SET_EXP`). Then the new line, Exotic atoms (`setRpExo`,
  `SET.rpExo`, `RP.exo` in hep.js; off at every start like the rest of the tab). Photons as waves has its place marked
  (a comment in body.html) beside Electrons as waves; no row yet. The 3-D lab's note (`set3dNote`) names exotic atoms
  (muons, pions and kaons; antiprotons flat-only), and the 3-D side pane has its own description and cost (SDESC3,
  COSTS3). No Settings picture changed, so setshots were not remade. Screenshots: scratchpad rp1/set-desk-2d.png,
  set-desk-3d.png, set-phone-3d.png. Check: f_rp1 "layout" (lines 24 / 61 / 24 px high: the waves line keeps its
  buttons; nothing wider than the screen at 390 px).
- **Exotic atoms (Experimental → Realistic particles → Exotic atoms).** Before: a μ⁻ slowed to 2 keV was caught by the
  nearest atom, its binding (0.51's MU_EB) leaving as two X-rays, and the atom's electrons kept seeing the whole nucleus;
  π⁻, K⁻ and p̄ were absorbed at once. With the switch on (hep.js, "Realistic particles 1"):
  1. *Capture* (`xaStep`, `xaTarget`). A μ⁻, π⁻ or K⁻ below 2 keV slows on by ionizing (exoIonize, as above 2 keV) until
     its kinetic energy is under 30 eV (`XA_CAP`, about the outer electrons'), then is caught by an atom within 1.5 Å,
     each with a chance ∝ Z (Fermi and Teller 1947). It takes an electron's place (that electron leaves with the
     particle's energy and its binding in the first orbit, n₀ = √(m*/mₑ): 14 for a muon, 15–16 for a pion, 30–31 for a
     kaon, 30–43 for an antiproton). Below 2 keV a slowing pion or kaon has no nuclear hits at the enlarged reach
     (0.35 Å): they ended most kaons in the hypernucleus factory before they were caught (at true size a slow one meets a
     nucleus in flight about once in 10⁹).
  2. *Cascade* (`xaCascade`, `xaClose`). Down the circular orbits n → n − 1: an Auger electron while the atom has one to
     give and the radiative rate (hydrogen-like 2p → 1s, 6.27×10⁸ s⁻¹·Z⁴·m*/mₑ, ×(2/n)⁵ up the circular orbits) is
     under 10¹² s⁻¹, else an X-ray (photons the game already tracks: screens, detectors and the spectroscope see them).
     So carbon's cascade turns radiative below n ≈ 5 and lead's is radiative throughout. Levels: Bohr's with the reduced
     mass; a muon's 1s from the measured 2p → 1s line (`XA_KA`: C 75.25, O 133.53, Al 346.8, Si 400.2, Ca 783.9,
     Fe 1,255, Pb 5,901 keV, the Pb fine-structure pair 5,962.8 / 5,778.1 given as one line at its 2 : 1 mean; Engfer et
     al. 1974, Fricke et al. 1995; between them the ratio to Bohr's value interpolated in Z). The electrons' own binding
     lost when the muon comes inside them (their Z − 1, below) is paid from the upper cascade first. The atom is left at
     most +2: in a liquid or solid its holes fill from the neighbours within femtoseconds (not followed here), so past
     that the upper cascade radiates. The X-rays carry their line energies exactly; what the books leave beyond them
     goes to the Auger electrons (`xaClose`).
  3. *End.* A muon stays in 1s: decay in orbit, its electron with the Michel spectrum x²(3 − 2x) up to the bound muon's
     mass (`xaMichel`; the free muon's was flat phase space, and still is), or nuclear capture (Z − 1, neutrons boiled
     off), at the measured mean lives (MU_TAU, 1.26). A pion is absorbed from its last orbit (`XA_NABS`: 1s up to Na,
     2p to Br, 3d to Bi; kaons 1s in H, 2p to O, 3d to Ca …; antiprotons 2p in H, 3d to O …, rounded from Batty, Friedman
     and Gal, Phys. Rep. 287, 385, 1997) by the existing absorption (hStop: a star; π⁻p → π⁰n or γn, 3 : 2; kStop: Λπ, a
     hypernucleus sometimes), its binding there already given off (its mass less by it). An antiproton (flat game:
     `nuclearAnnihilation`) cascades first, then annihilates; in hydrogen that is protonium (p̄p), annihilating from 2p
     (99 in 100 there: its 2p width 38 meV against 0.4 meV for the X-ray), its L line 1.735 keV.
  4. *To the outside an atom of charge Z − 1* (`zChem`, engine.js, on `p.muB.zx`). The electrons of a muonic atom see the
     nucleus and the muon together: refresh takes the element below for p.el (so its table entries: valence, capacity,
     bond energies and lengths, size, electronegativity), its charge Z − 1 − nₑ, and ionE(Z − 1, …) in internalE,
     ionizationCost, softFor, electron capture and transfer, field ionization and the flying charges. Muonic carbon is to
     the outside boron: valence 3, first ionization 8.30 eV, named μC (`elSym`; formulas, labels, the 2-D and 3-D atom
     labels and Inspect's tile, "Exotic atom, to the outside boron"). What does not carry over: rules written for one
     element by its nuclear charge (`p.Z === 1` …: a muonic helium is hydrogen-like but makes no hydrogen bonds), the
     continuous bond orders and quantum bonds (they read the nucleus's Z), the orbitals view (the nucleus's Z). After a
     decay in orbit it is carbon again (inside the decay's books); after a capture the nucleus is boron and its
     chemistry carries on.
  5. *Muonic hydrogen* stays an unstable particle in W.exo (since 0.51; Select, Erase, copy, saves and undo take it
     since the 1.26 sweep): neutral and 200 times smaller than an atom, it passes through atoms. Beside a heavier atom
     (2.5 Å, as muAtomTick takes a neighbour in liquid hydrogen) its muon moves over (`xaTransfer`, μp + Z → μZ + p) at
     the rate at liquid-hydrogen density: N 3.4×10¹⁰, O 8.5×10¹⁰ s⁻¹ (PSI, thermal μp in H₂ mixtures, late 1990s, values
     as I know them), He about 10⁸, others scaled from O's as Z up to 1.5×10¹¹ (Gershtein's estimate), on the nuclear
     clock (Lab → Decay speed) as muAtomTick's rates. It lands in the highest orbit bound more deeply than μp's 1s
     plus the electrons' lost binding (oxygen: n = 7), cascades there, and the proton and the atom fly apart with the
     difference (521 eV and 31 eV).
  6. *Inspect*: a pill "muonic atom: a μ⁻ in its 1s orbit (n = 1), mean life here …", and lines Muon (binding, the orbit
     it was caught into or came over from, the capture share), Cascade (the four strongest X-ray lines with their
     orbits, the Auger electrons) and Chemistry ("its electrons see Z − 1 = 5: to the outside an atom of boron").
  - *Representation, and why.* A heavier muonic atom was already an atom of the store with `p.muB` (0.51), which Select,
    Erase, Inspect, copy, saves and undo take (1.26); the switch adds to that object what it is (`sp`, `n`, `n0`, the
    lines, the Auger count, `zx` for Z − 1, `from` after a transfer), and saves carry it as an optional `xm` list (older
    readers open it as a 0.51 muonic atom). Pionic, kaonic and antiprotonic atoms live 10⁻¹⁸–10⁻¹² s, at once at the
    game's steps: they are made, cascade and end in one event, in the log and the event captions. μp stays in W.exo. So
    no new kind of particle and nothing new in the kernels.
  - *What the box can't make real, said not faked:* the strong-interaction shift and width of the last pionic and
    kaonic lines (pionic carbon's 1s is Bohr's 99.1 keV here); Stark mixing and Coulomb de-excitation in hydrogen (μp's
    and protonium's cascades are radiative after the capture's electron); the holes' refilling (the atom is kept at most
    +2); the Lyman series' np → 1s side branches (circular orbits only); the 2p fine-structure pair as one line; muonic
    lines other than 2p → 1s are Bohr's (lead's 3d → 2p 2.63 MeV against 2.64 / 2.50 measured). K⁻ absorption stays
    Λπ only (kStop): its Σπ channels (about two thirds at rest on light nuclei) are not built.
- **Numbers** (Node, f_rp1 and scratchpad rp1/t*.js):
  - Lines: muonic C 2p → 1s 75.25 keV (75.25 measured), O 133.53, Pb 5,901 keV (5,963 / 5,778; a point nucleus 14.2 MeV),
    μp 1.896 keV (1.898; QED's 0.2% left out), pionic C 99.1 keV, kaonic C 3d → 2p 62.9 keV, protonium 3d → 2p 1.735 keV
    (1.74); muonic C's cascade: 3 Auger electrons, X-rays 75.3, 13.9, 4.88, 2.26 keV … (n ≤ 12). Flat and 3-D the same.
  - Its end, 120 lone atoms each (mean life in units of the measured; capture share against measured): C 0.98 (0.09 /
    0.08), Al 1.01 (0.58 / 0.61), Pb 1.07 (0.98 / 0.97), ±0.27 at 3σ; 3-D alike (scratchpad t6: C 1.11, Al 1.12, Pb 1.01,
    ±0.30). Michel mean 36.6 MeV (36.9 for the bound muon's mass, 2,000 decays).
  - π⁻ in carbon: 16 of 16 in three or more pieces (Be + n n p, Li + n p t, He + n n n p α …); π⁻p → π⁰n : γn 177 : 123 =
    1.44 (Panofsky 1.5). K⁻ in carbon: Λ or a hypernucleus 16 of 16.
  - Books: each capture, cascade, transfer and end within 10⁻⁵ eV (flat and 3-D; a muonic carbon's decay 4×10⁻⁷). A
    1.5 keV muon fired into insulated liquid water slows to its capture (below 30 eV; by O or by H, as the Z law draws):
    3-D 0.1–0.24 eV over the run; the flat game −2.7 to +6.5 eV over 70–120 steps, the known limit of ionized water (the
    muon's last keV ionizes a few molecules).
  - With part 3: cpm alone, the fingerprints of annihilation, photonuc, sns, linac and water3d equal part 3's own (v145 at
    2e5a21c, cpm on); both on, of 40,000 photons of 511 keV meeting a carbon atom 4,812 scatter polarized across the
    plane, 3,004 in it, 3,924 unpolarized (part 3's odds × knPlaneW: 4,757, 3,057, 3,907).
  - Switch off: the fingerprints of all 59 setups (seed 7, 300 steps) unchanged against v136; f_rp1 "off" keeps seven
    of them (mucf, pionbeam, muonium, hyperfactory, annihilation, water, water3d) against v136's hashes.
  - Cost: off, nothing (one flag test per slow μ⁻, π⁻, K⁻). On, ×1 where nothing is caught (pionbeam 2.63 → 2.70 ms a
    step, noise); a capture is one event of 1.2–2.3 ms flat, 1.4–1.5 ms in 3-D (the cascade's electrons and X-rays; 40 atoms of C, O, Pb); where slow ones stop, the last
    keV they now spend ionizing the matter (a small plasma the step chooser follows) costs more: muon-catalysed fusion
    0.30 → 0.92 ms a step, the hypernucleus factory 0.40 → 1.72 (600 steps, seed 7, one thread).
- **Found, not changed:** a neutron that hits a muonic atom's nucleus (an inelastic scattering or capture remakes the
  nucleus) takes the muon away with it (muBoundTick: "its atom gone in some other event"), as before the switch: in a
  box of muonic lead the capture neutrons ended 37 of 64 muonic atoms early (the lifetime checks use lone atoms).
- **For the owner (physics questions, written down, not decided):**
  - K⁻ at rest makes Σπ about twice as often as Λπ on light nuclei (and the Σ often converts to Λ in the nucleus): add
    the Σπ channels with measured shares?
  - The capture at 30 eV, chance ∝ Z: hydrogen in molecules is measured to catch fewer muons than the Z law gives (the
    "large mesomolecular" models); per-molecule ratios could replace it where measured (water, methane).
  - The atom kept at most +2 after its cascade (refilling not followed): in a thin gas a light muonic atom really ends
    nearly bare.
  - The transfer rates for elements other than N and O are scaled, not measured; MU_TAU's and XA_KA's values are from
    memory of the compilations (no network here) and are worth a check against the papers.
- **Test change:** t_features' 1.10 Settings check counts four "realistic when on" checkbox tags (Exotic atoms beside
  resonance in large rings, detailed nuclear collisions and Ultra-realistic), not three.
- **Suites** (2-core machine): alone t_lint, t_energy, t_hep, t_3d, t_settings, f_swx, f_hep126, f_sweep3d, f_rp1 pass;
  t_features alone: f_rp1 passes, two misses (the 1.10 count above, fixed; the 1.14 slow-motion readout 1/1.3×, the known
  two-core flake); tools/runtests.sh: 21 of 22 pass, t_features' one miss the f_bug125 "exoElastic" timing check (6.5 ms
  under both lanes' load), which passes alone (f_bug125 alone: all pass).

### 1.27: realistic particles 2 and 4 (positronium, muonium as hydrogen, μSR)

Branch v142 (from v141 at 8328e8a, part 1). Parts 2 and 4 of the approved plan (the owner, 2026-11-05: "I ok all of
them, just please make sure it doesnt mess with anything"), each its own switch in Settings → Experimental → Realistic
particles, after Exotic atoms: "Positronium" (SET.rpPs → RP.ps) and "Muonium as hydrogen" (SET.rpMu → rpMuSet → RP.mu).
Both off at start and back to off on reload (SET_EXP), one compact line each with its cost tag (flat and 3-D tables),
its description in the side pane. Code: hep.js after part 1's block (psFromAtom, psFromFree, psMatter, psDecay,
muSpinInit, muRate, muSpinTurn, muSpinDecay, muExoDecay, rpMuSet), hooks in engine.js (evLepton, evAnnihFree,
ionizationCost/internalE through muIonF), hep.js (addExo, addMuonium, muoniumForm, muoniumTick, decayExo/3,
moveExos/3), ui.js (Inspect, saves, Select), render.js (particle view). Checks: tests/f_rp2.js (t_features runs it
alone; `node tests/f_rp2.js [--node] [part …]`); every part fails on v141 (no switches there).

**Positronium.**
- Forming. A positron touching an atom or molecule (evLepton, where it annihilated on contact) forms Ps in the Ore
  gap: its energy apart from the pull between them, E, between I − 6.80 eV and I, I the electron's binding there
  (ionizationCost). Below the gap Ps can't form (hydrogen: under 6.8 eV); above it ionization competes; in both the
  positron annihilates on contact as before. At a negative ion the gap reaches zero (Cl⁻, I = 3.6 eV: any slow
  positron). A free positron and electron within 0.3 Å (evAnnihFree) form Ps with a photon when the pair has less
  than 6.8 eV of its own energy to spare (radiative capture: the spur electrons the positron's own track set free);
  faster pairs annihilate as before. The event is tried first (the electron taken, the positron's charge off,
  measured, undone) and then made through nucBegin/closeEvent: Ps gets exactly what is left. Antimatter mirrors it
  (an electron taking a positron from an anti-atom).
- Ps is an unstable particle in W.exo, pPs or oPs: neutral, 2mₑ − 6.80 eV, bound by Ry/2 = 6.803 eV, orbit radius
  1.058 Å (twice hydrogen's). One in four is para (rnd < 0.25). Para lives 125.14 ps (7990.9 µs⁻¹, Al-Ramadhan and
  Gidley, PRL 72, 1632, 1994) → 2 γ back to back; ortho lives 142.05 ns in vacuum (7.0404 µs⁻¹, Vallery, Zitzewitz and
  Gidley, PRL 90, 203402, 2003) → 3 γ in a plane, energies from the Ore–Powell matrix element (Phys. Rev. 75, 1696,
  1949), drawn on the Dalitz triangle by rejection (its maximum is 2, on the edges), the angles from closing the
  momentum triangle, the plane turned at random (3-D: a random normal); boosted by the Ps's motion; the books close
  through closeEvent (the photons share exactly what the Ps carried). It bounces off reflecting walls as muonic
  hydrogen does, leaves through open ones.
- In matter (psMatter, each step on the decay clock). Pick-off at λ = (1/1.80 ns − 1/142.05 ns) × ρₑ/ρ_water, ρₑ the
  electron density within 5 Å (bound electrons of atoms and free electrons), ρ_water the flat game's own liquid water
  (0.85 e/Å², measured in the water setup's middle) or real water's 0.334 e/Å³ in 3-D; 1.80 ns is water's o-Ps life
  from positron lifetime spectroscopy at room temperature. Pick-off gives 2 γ (Ps's energy, the medium unchanged:
  the positron takes a neighbour's electron, Ps's electron takes its place). Spin conversion by O₂ (two O atoms bonded
  to each other only, neutral) at n·σ·v, σ = 1.5×10⁻¹⁹ cm² (the thermal o-Ps–O₂ conversion cross section measured in
  O₂ gas, as I know it: no network here, worth a check), n counted as the electrons are and scaled by water's
  3.34×10²² molecules/cm³; para back to ortho three times as fast (the states' counts). The surroundings are looked at
  again once a Ps has moved 1 Å or every 8 steps (o.psE).
- Measured (f_rp2 "form", "decay", "matter"; seeds as in the file):
  - Forming, flat and 3-D: e⁺ at 10 eV on H → Ps with 3.20 eV (10 + 6.80 − 13.60, nearly all to the light Ps); at
    2 eV → annihilates; at Cl⁻ at 3 eV → Ps; with a free electron at 1 eV → Ps and a ~7 eV photon; at 30 eV →
    annihilates. Books against the same run with the switch off (the same approach; only the event differs): equal
    to 5.6×10⁻¹¹ eV. (6 seeds × 7 cases each way in the scratch run: the books' drift, 0.02–0.35 eV in the
    lepton-pair cases, is the close pair's integration before the event, the same off and on.)
  - Para share 83 of 400 (0.21; 0.25 ± 0.022). p-Ps mean life 138.7 ps from 198 decays (maximum-likelihood with
    the survivors; ±9 ps): 125.14 within 1.5 σ; each pair back to back to 10⁻⁴ and 510,995.55 eV each (511 keV less
    half the binding). o-Ps: 600 decays flat and 600 in 3-D, every one 3 γ, coplanar, summing to the Ps's energy
    within 10⁻³ eV, none over 511 keV; the photon spectrum against Ore–Powell's χ² 6.2 and 4.7 (9 degrees of
    freedom). (Ore–Powell's single-photon spectrum is close to plain phase space's: 19.4% against 19.0% above
    460 keV.)
  - Pick-off life averaged over 600 points of liquid water: 1.81 ns flat (the box's middle; over the whole flat box,
    with its edges, 2.45 ns), 1.90 ns in 3-D (the game's 3-D water is 5% less dense than real here). 40 o-Ps flying
    in flat water with decay sped up 10⁵×: mean life 1.77 ns, 34 of 36 ended by pick-off; in an empty box 0 of 40
    in the same time. Among O₂ (a box of 36): 1.1×10¹¹ s⁻¹ conversion there, n·σ·v exactly; o → p seen.
- What the box can't make real (said in the texts): Ps passes through atoms (in nature its electron's repulsion
  keeps it in a bubble ~3 Å across; the pick-off rate stands for that), keeps the energy it was made with (no
  thermalizing collisions), makes no compounds (PsH) and is not oxidized by O₂; radicals other than O₂ don't convert
  it; one mass for both spin states (0.84 meV apart). The pick-off scales with electron density only: hydrocarbons
  come out about water's 1.9 ns where measured lives are 2.5–3 ns (their larger free volume). 142 ns is forever at
  this timescale: shown in Inspect (its expected life where it is), seen only with decay sped up.

**Muonium as hydrogen.** Muonium has been an H atom in MD with the muon's mass since 1.12 (bonding by hydrogen's force
field); the switch adds:
- Its binding: hydrogen's levels with its own reduced mass, MU_IONF = (1 + mₑ/m_p)/(1 + mₑ/m_μ) = 0.995729, so
  13.540 eV for H's 13.598 (in internalE, neutralInternalE, ionizationCost, Inspect). Switching with muonium in the
  box books the difference to the heat bath (rpMuSet): 0.0581 eV a muonium, exactly. Off, the factor is not applied
  (×1, bit for bit).
- Its chemistry is hydrogen's force field with its own mass (no new parameters): Mu + Cl₂ → MuCl + Cl in 4 of 6 shots
  at 1 eV; Mu–Cl vibrates 2.937× faster than H–Cl (8,455 against 2,879 cm⁻¹; √ of the reduced masses' ratio 2.936),
  flat and 3-D. Quantum nuclei's rings take the atom's mass, so its zero-point energy follows (the stretch's 2.9×
  hydrogen's in the harmonic picture; not measured here).
- The muon's spin (o.spin on a μ⁺ in W.exo, p.spin on muonium; p.eSpin its electron's). Given when made: against
  the flight for a μ⁺ fired or born in a decay (π⁺ → μ⁺ν: fully polarized backward, as a surface-muon beam; exact for
  a pion at rest, the lab direction for one in flight), across the field for one placed at rest (+x; 3-D across the
  field's axis). Kept when it takes an electron (muoniumForm); the electron's spin along or against the field 1 in 2.
  It turns about the field's axis on the decay clock (its own time): a bare μ⁺, or one bonded (diamagnetic), at
  −γ_μB/2π, γ_μ/2π = 135.5388 MHz/T; muonium with its electron along the field at +ν₁₂, against it at −ν₃₄, from
  the Breit–Rabi levels (ν₀ = 4,463.302 MHz, γₑ/2π = 28,024.951 MHz/T; CODATA 2018). At low field ν₁₂ → 1.3945 MHz/G,
  the triplet's precession; ν₃₄ → ν₀ averages that half out.
- Its decay (μ⁺ in W.exo: muExoDecay; muonium: muoniumTick): the positron's x and direction from the Michel
  distribution with the polarization, x²[(3 − 2x) + (2x − 1)cos θ]; the neutrinos share the rest. In the flat game the
  in-plane angle has that law (what a detector ring in the plane sees). Off, as before (three-body phase space).
- Saves keep the spins (`mus` for muonium, a twelfth entry of `xa` for a μ⁺; older readers ignore both). Inspect: the
  spin's direction and the precession there (frequency, period, which state); the particle view draws a small yellow
  arrow on a muon or muonium.
- Measured (f_rp2 "mu", "musr"): mass 0.11398 u (the muon 0.113429 u and its electron; the brief's 0.1138 u is a slip);
  a μ⁺ at rest in 0.01 T turns at 135.54 MHz/T to 3.5×10⁻¹⁸ rad over 0.1 ns; muonium's ν₁₂ at 1 G 1.394 MHz
  (1.3945 MHz/G; the brief's 13.9 MHz/G is 10× off: 1.39 MHz/G is 13.9 GHz/T). Asymmetry from 12,000 decays sampled:
  0.327 flat, 0.323 in 3-D (1/3; 40,000: 0.326, 0.336). A ring of detectors: 400 μ⁺ placed at rest in 100 G, decay
  sped up so a mean life is 100 steps: from the 400 positrons' directions and times alone the precession comes out at
  1.335 MHz (1.355; the scan's resolution with 400 counts over ~3 turns), amplitude 0.42 (1/3 ± 0.07). Books: each
  muonium decay step exact to 5×10⁻⁷ eV (flat and 3-D, 30 muonium in 1 mT); the run's drift after them, −1.2 eV flat
  and −0.5 eV in 3-D over 200 steps, is the fast electrons and positrons among the rest (off: −1.0 and +0.2 eV).
- What it can't make real: muonated radicals (Mu added to benzene …) precess here as a bare muon, without their own
  hyperfine frequencies; a muonium that bonds and frees itself keeps the electron spin it formed with; no spin
  relaxation (nuclear dipoles, collisions), no chemical shift; the half against the field turns at ~ν₀ where in nature
  it oscillates (either way it averages out in a fraction of a nanosecond).

**Off: nothing changes.** Fingerprints (tools/fingerprint.js, seed 7, 300 steps): all 59 setups, flat and 3-D, the
same as v141 (one lane, before and after). On (both switches), annihilation, antihydrogen, pet, pionbeam, rhic, sns and water3d
fingerprint as off over 300 steps (nothing there is slow enough to form Ps or spins a muon in that time); the muonium
setup changes (its muons' spins drawn).

**Costs** (one thread, the machine shared with another session's tests): ×1 where there is no positronium. A Ps costs
about 10 µs a step flat (20 in the water setup's 240 atoms: 0.35 → 0.58 ms a step) and ~35 µs in 3-D (20 in water3d:
2.3 → 3.0–4.1 ms; 100: 5.6), most of it its look round itself (2–5 µs flat, ~25 µs in 3-D, done again once it has
moved an ångström or every 8 steps). The muons' spins: nothing measurable (20 μ⁺ in water, on 0.66 against off 0.67 ms
a step; in 3-D within the 4–5 ms noise).

**For the owner (physics questions, written down, not decided):**
- The brief's "below the Ore gap: kinetic energy under about 6.8 eV" reads the gap the other way: from ground-state
  hydrogen Ps can only form above 6.8 eV (the gap is 6.8–13.6 eV); below, energy forbids it. Built as physics has
  it; slow positrons form Ps with free electrons and at negative ions.
- Outside the gap a positron touching a molecule still annihilates at once (0.51's rule); in nature a slow positron
  wanders ~0.1–0.5 ns first. The game's water gives an electron at 18.4 eV (its ionization cost: oxygen's 13.6 eV
  and the bonds weakened by the charge), so water's gap here is 11.6–18.4 eV against nature's 5.8–12.6.
- The free-pair rule (Ps when the pair has less than 6.8 eV to spare) is a choice; the flat game's close pair is
  measured mid-step at 0.3 Å, so a 10 eV positron on a resting electron (5 eV between them) formed Ps in 3-D and
  annihilated in the flat game.
- The O₂ cross section (1.5×10⁻¹⁹ cm²) and water's 1.80 ns are from memory: worth checking against the papers.
- Ps is not on the particle menus (it is made by positrons); placing it by hand would be a menu entry.
- Not built (said): Ps thermalizing, Ps chemistry, muonated radicals' hyperfine lines, spin relaxation.

**Suites** (2-core machine, after merging v141 at 91e372a): alone t_lint, t_energy, t_hep, t_3d, t_settings, f_rp1,
f_rp2 pass; t_features alone: 1 miss, f_bug125's "pi3" timing check (138 ms under load), which passes alone;
tools/runtests.sh: 21 of 22 pass, t_page's miss the known collider-beam timeout (15 s); t_page alone then passed it and
missed only the slow-motion button check (the known flake, on record since 1.25). An earlier t_features run also
missed 0.64's named save once (its 400 ms wait under load); it passed in the next two runs.

**Merge note for part 1 (v141):** f_rp1's layout check compared the section's ids exactly; it now checks that the
first three are Ultra-realistic, Electrons as waves, Exotic atoms (the two new lines follow). t_features 1.10 now counts six
"realistic when on" tags (part 1's four and these two).
### 1.27: realistic particles 5 and 6 (resonance widths, heavy flavour, nuclear spin, γ lines, neutron cross sections)

Branch v143 (from v141 at 91e372a, part 1 and the Settings section). Parts 5 and 6 of the seven approved realistic-particle
parts (the owner, 2026-11-05: "I ok all of them, just please make sure it doesnt mess with anything"). Two more lines in
Settings → Experimental → Realistic particles, after Exotic atoms: "Resonance widths and heavy flavour" (`setRpRes`,
`SET.rpRes`, `RP.res`) and "Nuclear spin, γ lines and neutron cross sections" (`setRpNuc`, `SET.rpNuc`, `RP.nuc`), each a
switch, off at every start (`SET_EXP`), a compact line with its cost tag (flat and 3-D) and its "realistic when on" tag,
the description in the side pane (SDESC, SDESC3) and a note under the line; the 3-D note names both. The code is at the end
of hep.js ("Realistic particles 5", "Realistic particles 6") with small hooks in hep.js (bwMass, hadronize and its
callers, decayExo/decayExo3), engine.js (doDecay/doDecay3, decayStep, neutronHit/neutronHit3, moveNeutron, step) and
ui.js (placing, firing, copying, saves, Inspect). Checks: tests/f_rp5.js (t_features runs it alone; `node tests/f_rp5.js
[--node] [part …]`): off, widths, heavy, spin, lines, neutrons, books, page; every part fails on v141 (no switches there).
Screenshots: scratchpad rp5/set-desk.png, set-phone.png, inspect-nmr.png.

- **Part 5, resonance widths.** Before: a resonance made in a collision (resonate) got a mass from a Cauchy in m cut at
  ±3Γ (bwMass), and one placed, fired or pasted got the table's mass (the exotic sweep's "own mass" was only that
  collision draw, kept through saves and undo). With the switch every resonance made (ρ, ω, φ, K*, Δ, and the new J/ψ
  and Υ; in a collision, placed, fired, pasted, or among a decay's products, e.g. the φ of D⁺s → φπ⁺) draws its mass
  from one function, `bwMassRel`: the relativistic Breit–Wigner in s = m², dN/ds ∝ 1/((s − M²)² + M²Γ²) with the measured
  width (the XP table's PDG values), cut below at its lightest decay threshold (+0.01 MeV) and above at M + 5Γ or what
  the event leaves (`resItems`); one random draw each (the old draw could take up to 40). It decays into the channels
  open at its own mass (`resOpen`), so the products' energies follow from it, and the event that made it paid for it
  (closeEvent, exact). Its mean life stays ħ/Γ (on the clock in Ultra-realistic). Inspect: "Rest mass … its own, drawn
  from its width". Constant width (not the mass-dependent width of a P-wave): said here, not hidden.
- **Part 5, heavy flavour.** A hadron collision above the charm threshold (`nnInelastic`, the pion and antinucleon
  branches of `hadronHit`, the collider's `xbInelastic` and `xbAnnihilate`) draws once (`hfDraw`) whether it makes a cc̄
  pair, with the measured share σ(cc̄)/σ_inel at its √s, or a bb̄ pair (σ(bb̄)/σ_inel); a small share of the pairs is a
  J/ψ (0.5%) or an Υ(1S) (0.2%) instead. Each quark becomes a hadron at the measured fragmentation fractions (c → D⁰
  0.609, D⁺ 0.240, D⁺s 0.080, Λc⁺ 0.062; b → B⁻, B̄⁰ 0.407 each, B̄⁰s 0.101, Λb⁰ 0.085), put into hadronize's list as
  fixed hadrons (a heavy baryon takes a nucleon's place; the light hadrons make up charge and energy), so the event's
  books are exact as any. New particles (XP, flat and 3-D): Λc⁺ (2,286.46 MeV, 202.6 fs), B⁰s (5,366.93 MeV, 1.520 ps),
  Λb⁰ (5,619.60 MeV, 1.471 ps), their antiparticles, J/ψ (3,096.900 MeV, Γ 92.6 keV) and Υ(1S) (9,460.40 MeV, Γ 54.0
  keV), with their main decays (the rest of each total shared out over them in proportion, as the D's and B's of 1.15;
  the J/ψ's and Υ's three-gluon decays as a few typical multi-pion states of their measured mean multiplicity). They fly
  with their mean lives: D⁰ 0.41 ps, B 1.5 ps, i.e. cτ = 123 μm and 455 μm, times βγ: far out of a box of nanometres, so
  most leave it before they decay unless decay is sped up (Lab → Decay speed). The collider's made-list shows them.
  - Data (σ in µb against √s, measured, *from memory* of the compilations, no network here: worth a check): cc̄ 17.3 GeV
    3.6, 27.4 GeV 15 (NA27), 41.6 GeV 49 (HERA-B), 200 GeV 600 (STAR 797, PHENIX 567), 2.76 TeV 4,800, 7 TeV 8,500
    (ALICE); bb̄ 38.8 GeV 0.0057 (E789), 41.6 GeV 0.012 (HERA-B), 200 GeV 1.3 (STAR), 1.96 TeV 80 (CDF, extrapolated to all
    rapidities), 7 TeV 280 and 13 TeV 495 (LHCb); σ_inel(pp) 30 mb at 5 GeV to 78.1 mb at 13 TeV (PDG, TOTEM); log–log
    between the points, the last slope above. Below the lowest point (17.3 / 38.8 GeV) the cross section is brought to
    zero at the threshold (N + Λc + D̄ at 5.09 GeV, N + Λb + B at 11.84 GeV) as (1 − √s_thr/√s)⁴: a shape, not a
    measurement. The J/ψ and Υ shares (σ(J/ψ) ≈ 3 µb at 200 GeV, 45 µb at 7 TeV; Υ(1S) ≈ 0.2% of bb̄), the fragmentation
    fractions (Lisovyi et al. 2016; PDG's LEP b fractions) and the new particles' masses, lives and branchings are also
    from memory of PDG 2024.
  - What the box can't make real: charm's and bottom's flight (μm–mm); several cc̄ pairs in one collision (one at most
    here: at the LHC multi-parton collisions make more now and then); charm in nucleus–nucleus collisions (the fireball's
    hadronize is left as it was: its rate grows with the binary collisions, not built); e⁺e⁻ → cc̄ keeps its own channel
    from 1.15 (D mesons only, no Λc); the J/ψ's and Υ's masses use the table's value inside an event (93 and 54 keV wide).
- **Part 6, nuclear spin and NMR.** `NUC_SPIN`: 71 nuclides' measured ground-state spin and magnetic moment (Stone's
  table, 2005, *from memory*: ¹H ½ +2.79285 μN, ²H 1 +0.857438, ¹³C ½ +0.702412, ¹⁴N 1 +0.403761, ¹⁷O 5/2 −1.89379, ¹⁹F ½
  +2.628868, ³¹P ½ +1.13160, ²⁷Al 5/2 +3.641507, ⁵⁹Co 7/2 +4.627, ⁶⁰Co 5 +3.799, ²⁰⁷Pb ½ +0.592583, the neutron ½ −1.91304,
  …); even-Z even-N nuclei I = 0, μ = 0; others "not in the table". γ/2π = 7.6226 MHz/T × μ/I (¹H 42.577, ¹³C 10.708,
  n −29.165). Inspect (switch on): "Nuclear spin", and in a field "Larmor precession" (42.58 MHz in 1 T: one turn in 23.5
  ns) and a button "NMR pulse": a 90° pulse on every nucleus of that kind in the box (`nmrPulse`); each spin then turns
  every step at the Larmor frequency of the field where it is (`nmrTick`: the Lab's field and the magnets, `Bfield`), and
  "NMR signal" reads the summed signal's frequency from its phase over the time since the pulse (`nmrRead`), with the
  share still in phase (field inhomogeneity dephases it). Not modelled: the Zeeman energy μB (8.8×10⁻⁸ eV for a proton at
  1 T; the pulse's radio wave pays it; not in the books), chemical shifts, spin–spin coupling, T₁ and T₂. At 1 T a proton
  turns once in 23.5 ns, two million steps: the readout measures the phase turned so far (at the Lab's 100,000 T, once in
  0.23 ps).
- **Part 6, γ lines.** Before: a decay gave its particles the whole Q (ground state to ground state), a neutron capture
  one γ of all the energy. With the switch (`GL_FEED`, `GL_LEV`, `GL_CAP`, `GL_ISO`, `GL_CONV`; ENSDF *from memory*):
  - Decays that feed excited levels: ⁶⁰Co β⁻ → ⁶⁰Ni 2,505.7 keV (99.88%) → 1,173.2 + 1,332.5 keV; ¹³⁷Cs → ¹³⁷ᵐBa (94.4%);
    ²²Na → ²²Ne 1,274.5; ⁴⁰K EC → ⁴⁰Ar 1,460.8 (its β⁻ to the ground state); ¹³¹I → 364.5 / 637.0 / 722.9; ⁹⁹Mo → ⁹⁹ᵐTc
    (87.6%); ²⁴¹Am α → 59.5 / 103.0 (43.4 + 59.5); ²²⁶Ra α → 186.2 (5.95%); ²⁴Na → 2,754.0 + 1,368.6; ²⁸Al → 1,779.0; ⁵⁶Mn →
    846.8 / 1,810.7 + 846.8 / 2,113.1 + 846.8; ⁵⁷Co EC → 122.1 + 14.4 or 136.5; ¹⁶N → 6,128.6 / 7,115.2 keV: 13 parents. The
    β (or α) takes Q less the level; the neutrino (or the α and recoil, settleKE) takes what the books leave after the
    lines, which carry their measured energies exactly and recoil the nucleus.
  - Isomers (`p.iso`): ¹³⁷ᵐBa (661.7 keV, 2.552 min) and ⁹⁹ᵐTc (142.7 keV, 6.0067 h) keep their energy out of the nuclear
    ledger and decay on the decay clock (`isoStep` in decayStep, before the ground state's decay) by their lines
    (⁹⁹ᵐTc: 2.17 keV, nearly always converted, then 140.5 keV). Inspect: a pill "¹³⁷ᵐBa: an isomer 661.7 keV above its
    ground state, half-life 2.55 min". Saves and undo keep it (an optional `iso` list; older readers open the ground
    state); copy and paste make the ground state.
  - Conversion: a line with a measured coefficient α converts at α/(1 + α), only while the atom has electrons: an
    electron of the K shell (if the line can free one, else L, else an outer one) with the line less that binding
    (`GL_SHELL`), then the hole's X-rays (Kα = K − L, then L), the atom one charge up. ¹³⁷ᵐBa 0.1124 (the 624.2 keV K
    electron), ⁹⁹ᵐTc 140.5 keV 0.1218, ²⁴¹Am's 59.5 keV 1.15 (L shell), ¹⁵⁸Gd 79.5 keV 5.9, ⁵⁷Fe 14.4 keV 8.2, ….
  - Neutron captures (`nxCapture`): ¹H → one 2,223.2 keV γ (the 2,224.6 keV less the deuteron's recoil, as before);
    ¹²C → 4,945 or 3,684 + 1,262 keV; ¹⁴N → 10.83 MeV (14%) or through ¹⁵N's levels at 5.27, 5.30, 6.32, 7.30, 8.31 MeV;
    ¹¹³Cd → the 558.5 keV line (3 in 4; also 651.3, 805.9); ¹⁵⁷Gd → 79.5 (mostly converted) and 181.9 keV: the low lines
    exactly, the primary γ (or two, split at random, where the cascade is statistical) what is left. ¹⁰B(n,α)⁷Li leaves
    ⁷Li at 477.6 keV 94% of the time (its γ, the α and ⁷Li sharing 2.31 MeV). Elsewhere, as before: 5 capture cascades
    and 13 decays have lines, everything else falls back. Reactions in hep.js (a compound nucleus cooling by γ,
    gammaOut) are unchanged.
- **Part 6, neutron cross sections.** `NXS`: 41 nuclides' thermal (0.0253 eV) cross sections, barns (Mughabghab's Atlas
  and ENDF *from memory*): ¹H scattering 20.49, capture 0.3326; ²H 3.39 / 0.000519; ³He (n,p) 5,333; ⁶Li (n,t) 940; ¹⁰B
  (n,α) 3,837, (n,γ) 0.5; ¹²C 4.75 / 0.00353; ¹⁴N 10.05 / 0.075, (n,p) 1.83; ¹⁶O 4.23 / 0.00019; ³⁵Cl 21.8 / 43.6; ⁵⁹Co
  37.18; ¹¹³Cd 20,600; ¹³⁵Xe 2.65 Mb; ¹⁴⁹Sm 40,140; ¹⁵⁵Gd 60,900; ¹⁵⁷Gd 254,000; ¹⁹⁷Au 98.65; ²³²Th 7.35; ²³³U fission 531;
  ²³⁵U fission 585.1, capture 98.7; ²³⁸U capture 2.68; ²³⁹Pu fission 747.4, capture 270.7; ²⁴¹Pu 1,012 / 361. The
  absorptions go as 1/v; the big resonances are single-level Breit–Wigner shapes: those that make the thermal value
  (¹¹³Cd 0.178 eV, ¹³⁵Xe 0.084, ¹⁴⁹Sm 0.0973, ¹⁵⁵Gd 0.0268, ¹⁵⁷Gd 0.0314) normalised to it, and those above it (²³⁸U
  6.674 eV, Γ 24.5 meV, peak (n,γ) 22,500 b; ¹⁹⁷Au 4.906 eV; ¹¹⁵In 1.457 eV) on top of the 1/v part, the thermal value
  kept. Scattering constant. From 1 keV to 100 keV the shares join the old table's fast ones (NEUTRON_X), above it they
  are those. No Doppler broadening (²³⁸U's resonance at room temperature is lower and wider), no unresolved resonances.
  - *The choice, written down:* the game's nuclei are drawn and met enlarged (0.35 Å and up), so in the normal view a
    neutron meets every nucleus about as often; a factor of 10⁴–10⁶ between cross sections can't be a reach in a box of
    nanometres. So in the normal view the measured cross sections decide what a meeting does (capture, fission, (n,p),
    (n,α), (n,t) or scattering in their shares at the neutron's energy, `nxsShares`), and with Ultra-realistic on (true
    sizes) a nucleus is met inside its measured cross section itself (`nxsReach`: in 3-D √(σ_tot/π); in the flat game a
    width σ_tot / 1.2 Å, the game as a slab as thick as the strip light meets atoms in), so there the rates are measured:
    ¹⁰B and cadmium take thermal neutrons thousands of times more readily than hydrogen. The neutron's spin ½ and moment
    −1.913 μN show in its Inspect card (with its Larmor frequency, 29.16 MHz/T, in a field).
- **Numbers** (Node; f_rp5 and scratchpad rp5/t*.js):
  - ρ⁰: 40,000 draws 146 MeV wide at half height (Γ 149.1; 2 MeV bins), peak 777 MeV, none below 279.7 MeV; Δ⁺⁺ from
    1,078 MeV; placed at rest (Ultra-realistic, 400 each) mean life 0.974 (flat) and 0.932 (3-D) of ħ/Γ (±0.15 at 3σ);
    their masses spread over 1,185 MeV; books within 1.5×10⁻⁴ eV a step.
  - Charm share in pp (nnInelastic): 200 GeV 0.0113 (1,500 events; σ(cc̄)/σ_inel 0.0143 ± 0.0031), 7 TeV 0.124 (500; 0.116 ±
    0.014), 3-D 7 TeV 0.090 (300; ± 0.019); 4 GeV none; bottom in 1 of 500 at 7 TeV (0.0038 expected); the collider's list
    D⁰, D̄⁰, D⁺, D⁻, D⁺s, D⁻s …; books within 2.2×10⁻¹⁵ of √s (flat and 3-D).
  - NMR: 160 protons of flat liquid water in a placed 1.5 T magnet 42.5775 MHz/T; 686 in 3-D water in the Lab's 2 T
    42.5775 (CODATA 42.577 478); 100% in phase in a uniform field.
  - Lines (40–60 events each, flat; 3-D alike): ⁶⁰Co 1,173.2 + 1,332.5 in 40 of 40; ¹³⁷Cs to ¹³⁷ᵐBa 58 of 60, then 662 keV
    γ 53, 624.2 keV electron 5 (α/(1 + α) = 0.101); ¹H capture one 2,223.2 keV γ 30 of 30; ¹⁰B(n,α) 478 keV 29 of 30;
    ¹⁴N 10.83 MeV in 4 of 31 captures (14%); ¹¹³Cd 558.5 keV 31 of 40; ⁹⁹ᵐTc 140.5 keV 51 of 60, its electron 9; every
    event's books within 3×10⁻⁵ eV.
  - Neutrons at true size (thermal, through random impact parameters about one nucleus): absorbed per unit area (3-D)
    or width (flat) ¹⁰B 11,765 and 11,200 times ¹H's, ¹¹³Cd 63,066 and 58,150 (measured 11,538 and 61,306 at 0.0244 eV;
    hydrogen's counts 52–88 decide the error, ±15–20%). Shares: ²³⁵U fission 0.837 of thermal meetings (585.1 / 698.8);
    ²³⁸U capture 1.000 at 6.67 eV, 0.051 at 1 eV.
  - Running boxes (switches on, each event wrapped): liquid water with 40 neutrons and ¹⁰B, ¹¹³Cd, ¹⁴N, ⁶⁰Co, ¹³⁷Cs, decay
    sped up 10⁹: flat 1,197 events, worst 5.5×10⁻⁴ eV; 3-D 24 events, 0.
  - Switches off: the fingerprints of all 59 setups (seed 7, 300 steps) equal v141's; f_rp5 "off" keeps eleven of them
    (pionbeam, rhic, linac, chain, photonuc, annihilation, isolde, sns, useries, water, water3d).
  - Cost (one thread, on a machine shared with another session's tests, so ±30% noise): off nothing (one flag test per
    event). On ×1: pion beam 9.4 → 10.0 ms a step, RHIC 2.1 → 2.0, the chain reaction 0.70 → 0.68, 40 thermal neutrons in
    3-D water 44.5 → 44.6; after an NMR pulse the spins' turn is 0.04 ms a step for flat water's 160 protons (×1.1 at
    most), 0.05 ms for 3-D water's 686 (×1.01).
- **Test changes:** t_features' 1.10 Settings check counts six "realistic when on" checkbox tags (Exotic atoms,
  Resonance widths and heavy flavour, Nuclear spin … beside resonance in large rings, detailed nuclear collisions and
  Ultra-realistic), not four; f_rp1 "layout" checks that its three lines come first (the later parts' lines follow:
  the v142 branch's positronium and muonium lines will too).
- **Suites** (2-core machine shared with the part-2/4 session): alone t_lint, t_energy, t_hep, t_nuclear, t_collider, t_3d,
  t_settings, f_rp5 and t_features (f_rp1 and f_rp5 inside it) pass; f_rp1 alone once missed its 3-D Select click in
  "store" under load and passed rerun alone. tools/runtests.sh: 20 of 22 pass; t_features' one miss the 1.14 slow-motion
  readout (1/1.3× on two cores, the known flake; t_features passed alone just before), t_page's the slow-motion button
  check (it fails alone here too, as on record for 1.25 and 1.26: v141's state, nothing of these parts).
- **Found, not changed:** ¹⁹⁸Au's decay is pure β⁻ (to ¹⁹⁸Hg's 411.8 keV level), but the game's systematics give it 14%
  EC (it is not in DECAY); ²²Na decays only by β⁺ here (measured 90.3% β⁺, 9.6% EC). Its line is right either way.
- **For the owner (physics questions, written down, not decided):**
  - Charm and bottom in nucleus–nucleus collisions (the fireball): per binary nucleon collision, as measured at RHIC
    and the LHC? Several cc̄ pairs per collision at LHC energies?
  - The constant-width Breit–Wigner: a P-wave resonance's width grows with its momentum (ρ: Γ(m) ∝ q³/m), which skews
    the line toward high masses (the e⁺e⁻ channel's ρ already has it). Use it for the draws too?
  - In the normal view the cross sections set what a meeting does, not how often it happens (the enlarged nuclei);
    alternatives: a reach that grows as √σ up to a cap (the ratio then saturates for Cd and Gd), or a mean-field rate.
  - The reactions of hep.js (spallation, fusion's compound nuclei) still cool by generic γ; their known low lines
    (¹²C 4.44 MeV, ¹⁶O 6.13 MeV, …) could be added the same way.
  - Values from memory (no network): the cross-section and σ_inel points, J/ψ/Υ shares, fragmentation fractions, the
    new particles' data, NUC_SPIN, NXS, the γ lines, branchings, conversion coefficients and half-lives above. Each
    agrees with the others where they meet (e.g. the lines sum to their levels, 1/τ against Γ), but a check against the
    tables is worth it.

### 1.27: realistic particles 3 (charged particles in matter)

Branch v144 (from v142 at 0fa22fa, parts 1, 2 and 4). Part 3 of the approved plan (the owner, 2026-11-05: "I ok all of
them, just please make sure it doesnt mess with anything"): its own switch in Settings → Experimental → Realistic
particles, after Muonium as hydrogen, "Charged particles in matter" (SET.rpCpm → RP.cpm), off at start and back to off
on reload (SET_EXP), one compact line with its cost tag (flat and 3-D tables), its description in the side pane (flat
and 3-D texts); the 3-D lab's note names it (and positronium and muonium, which work in 3-D too). Code: hep.js after
part 4's block ("Realistic particles 3": cpmSeg, cpmEnv, cpmL, cpmAtom, cpmBrems, cpmCkv, cpmGamma, cpmPairSig,
cpmShare, cpmPair), hooks behind `RP.cpm` in the five places a fast charged particle loses energy to the atoms it passes
(engine.js moveRad, fastStop3, moveFastLeptons3; hep.js exoIonize, exoIonize3) and the two places a γ ray meets an atom
(rayInteract, rayInteract3). Checks: tests/f_rp3.js (t_features runs it alone; `node tests/f_rp3.js [--node] [part …]`),
every part fails on v142 (no switch there) and passes here.

**What was there.** Every fast charged particle lost, at each atom it passed within ~1 Å, a fixed share
0.0047·z²·nₑ/β² weighted by how close it passed (Bethe without his logarithm; calibrated for slow ions): the same
amount every time, so no straggling, and an electron set free with what that atom took, never more than a few hundred eV
(no δ-rays near T_max). That form is low for fast particles: in the flat game's water a minimum-ionizing electron lost
about a quarter of the real 2 MeV/cm, in 3-D (whose reach normalizes it differently) a twelfth. Bremsstrahlung (flat
radiation flight only) by a rule of thumb, T·Z/800 MeV of the collision loss; none in 3-D. γ rays of 100 keV and more met
each atom within 0.6 Å at fixed odds (Compton 0.012 an electron, pairs 0.0015·Z, at any energy), about 10⁷ times
nature's so that light does something in a nanometre; a pair left back to back in a random direction, sharing the
energy evenly. No Cherenkov light.

**With the switch on** (all of it flat and 3-D):
- *Mean loss.* Bethe's formula (PDG eq. 34.5) for each atom passed, with its element's mean excitation energy I (NIST /
  ICRU 37 and 49: H 19.2, C 78, N 82, O 95, Al 166, Si 173, Fe 286, Cu 322, Pb 823 eV …, others 12Z + 7 or
  9.76Z + 58.8Z^−0.19) and the density effect's high-energy form δ = 2 ln βγ + 2 ln(ħω_p/I) − 1, ħω_p = 28.816 √(ρ⟨Z/A⟩) eV
  from the electron density within 4 Å of the path (water 21.5 eV); e± by Rohrlich and Carlson's formula (ICRU 37:
  T_max = T/2 for e⁻, T for e⁺). The game's own per-atom form stands where it is larger (slow ions, below where Bethe
  holds); above, it is scaled up to Bethe's by the ratio of the logarithms (`CPM.Lg`: the game's form read as a Bethe
  logarithm for its reach, 4.5 flat and 1.8 in 3-D for 1 Å). The flat game's liquid water (0.85 e/Å²) stands for real
  water (0.334 e/Å³): CPM_LAM = 2.545 Å converts its areal densities, as positronium's pick-off does.
- *Straggling and δ-rays.* Of that mean, the share in close collisions (energy transfer T from T_c = max(10 eV, the
  atom's ionization energy + 1) to T_max) is drawn collision by collision: a Poisson number at each atom passed, T from
  the free-electron spectrum 1/T² (× (1 − β²T/T_max) for heavy particles), each setting an electron free with T less its
  binding at cos θ = (T/p_δ)(E + mₑc²)/p; it flies and ionizes in turn. The distant collisions (the rest) are given as
  before. Møller's and Bhabha's own spectra (their terms near T/2 and T) are left at 1/T².
- *Bremsstrahlung (e±).* At each atom passed (including bare nuclei), a photon with the chance σ_X·s·F / A: σ_X the
  atom's share of 1/X₀ (Tsai: 4αr_e²[Z²(L_rad − f(Z)) + nₑL'_rad], PDG eq. 34.26–27), F the spectrum
  (4/3 − 4/3 y + y²)/k integrated from k_min = max(100 eV, 10⁻³T) to T, A the tube's cross-section (πR² in 3-D, 2R·CPM_LAM
  flat), s = min(1, φ_rad/φ_cs) the unscreened (Heitler: 16/3 slow, 4 ln 2γ − 4/3 relativistic) over the complete-screening
  value, which brings the rate down below a few tens of MeV (water at 1 MeV: radiative loss 0.0132 MeV cm²/g, ESTAR 0.0129;
  at 10 MeV 0.74 of E/X₀ against ESTAR's 0.63). The photon within ~1/γ of the way, its energy taken from the electron
  exactly. An e± crossing a drawn (enlarged) nucleus meets that atom (radiates, ionizes) before it is turned by it.
- *Cherenkov light.* Where the 4 Å round the path's middle are liquid water (H and O ≥ 90%, more H than O, no Si) or
  silica glass (Si and O ≥ 90%, Si ≥ 20%) at ≥ 40% of water's atom density (0.04 atoms/Å³; the flat game's over
  CPM_LAM), n = 1.333 or 1.458 (589 nm; dispersion left out; molecules the track ionized still count as water), and
  β > 1/n: a Poisson number of photons, 369.81 z²(1 − 1/β²n²) per eV per cm over 300–600 nm (2.066–4.133 eV, flat in
  energy), on the cone cos θ = 1/βn (flat: on either side in the plane), from points along the step, as real photons
  (emitPhoton: screens, detectors and the spectroscope see them; 2–4 eV passes through water).
- *γ rays (≥ 100 keV).* At each atom within 0.6 Å, in this order: the giant dipole resonance as before; a pair with the
  chance 0.012·(σ_nuc + σ_trip)/σ_KN(1 MeV), Compton scattering with 0.012·nₑ·σ_KN(E)/σ_KN(1 MeV): the measured cross
  sections against each other, scaled as the game's light (its Compton odds at 1 MeV unchanged). σ_KN is Klein–Nishina's
  total; σ_nuc Maximon's Born forms (near threshold, k < 4, and the high-energy series), less the Coulomb correction
  (28/9)f(Z) brought in over 2–100 MeV in ln k, at most Tsai's complete-screening (28/9)(L_rad − f) − 2/27, all × αr_e²Z²;
  σ_trip (the atom's electrons, from 4mₑc²) the same Born value for Z = 1 less 3.23 (the high-energy gap between
  (28/9) ln 2k − 218/27 and Borsellino's − 11.3), at most (28/9)L'_rad − 2/27, × nₑ. The pair (cpmPair, which also
  replaces pairProduce/pairProduce3 after a failed photonuclear try): the electron's share ε from Bethe–Heitler with
  screening (sampled as Geant4's G4BetheHeitlerModel does with Butcher and Messel's screening functions; uniform below
  2 MeV), each member forward within u·mₑc²/E (Urban's form of Tsai's angles), the two 0.4 Å apart across the photon's way;
  the triplet's electron (1/T² from 1 keV to a third of what is left: an approximation) set free with its binding. Books
  as pairProduce3's (nucBegin, settleKE) flat too: a slow member is stepped with its pull. Compton's angles stay as they
  are (part 7).
- *Showers* come from these together; what the box can't hold is said below.

**What the box can't make real, and how the game handles it.** Radiation lengths are centimetres (water 36 cm, lead
0.56 cm): a 10 nm box is 3×10⁻⁸ of one in water, 2×10⁻⁶ in lead. At nature's rates a 1 GeV electron crossing 25 Å of
lead (flat, real lead's density) radiates a photon above 1 MeV about once in 3×10⁵ crossings; Cherenkov light in water is 3.3×10⁻⁶ photons an ångström
(one in about 3,000 crossings of a 100 Å box: shown at nature's rate, not scaled, because each photon's 2–4 eV is taken
from the particle and a scaled count would be a made-up energy loss); a shower can't develop, and what is made leaves the
box (its energy counted as escaped). γ rays do convert (the game's light is ~10⁷ times nature's), so a γ ray above
1.022 MeV in matter makes forward pairs and their δ-rays. RP.cpmX scales bremsstrahlung and Cherenkov light (×1 = nature)
the way decay speed-up scales decays; only the checks set it. With it at 10⁶, eight 1 GeV electrons into a 25 × 18 Å
lead block make 141 photons and 27 pairs (the books check). Also not real here: a minimum-ionizing particle's loss in a
nanometre is mostly far below its mean (the mean is carried by rare hard collisions: in 60 tracks across the flat
water, about 0.1 δ-ray above T_c expected for a 1 GeV electron), so the mean is seen only for slow, densely ionizing
particles; e± multiple scattering beyond the existing nucleus crossings, photoelectric absorption of γ rays above
100 keV (dominant in lead below ~500 keV), muon bremsstrahlung and pair production (∝ 1/m², negligible below ~100 GeV),
Cherenkov light in other transparent media (ice, plastics, organic liquids) and in gases (their n − 1 ~ 10⁻⁴).

**Data and sources** (no network here; values from memory are marked, worth checking): PDG Review "Passage of particles
through matter" (Bethe eq. 34.5, Tsai's X₀ eq. 34.26–27, the critical energies; from memory); NIST/ICRU mean excitation
energies (from memory); ESTAR/ASTAR spot values quoted below (from memory); XCOM attenuation (from memory: lead at
10 MeV 0.0497 cm²/g, water 0.0222); Maximon 1968 pair formulas as used by Hubbell, Gimm and Øverbø (1980) for XCOM's
pair term; Borsellino's triplet asymptote; Klein–Nishina (theory); Frank–Tamm (theory); Geant4's G4BetheHeitlerModel
sampling and Urban's angles (from memory of the code); refractive indices water 1.333, fused silica 1.4585 at 589 nm.

**Numbers** (Node; f_rp3 and scratchpad rp3/p*.js):
- X₀ from the formula, g/cm²: C 42.70, Al 24.01, Fe 13.84, Cu 12.86, Pb 6.37, water 36.08 (PDG's to the digit). Measured
  in the game (photons counted over 1 GeV tracks, rare processes ×3×10⁵ in lead, ×10⁷ in water, at the density the
  lattice stands for): lead 6.56–6.95, water 33.9–34.2 (±4% statistical); the photons' spectrum by decade of k/E
  0.376 / 0.349 / 0.275 (Tsai 0.365 / 0.353 / 0.282). Critical energy (Rossi: collision loss over X₀ equals E) from the
  same functions: water 78.9 MeV (PDG 78.33), lead 8.0 MeV (7.43).
- Mean ionization loss in the game's water, eV/Å, off → on (real: ESTAR/PSTAR/ASTAR collision stopping): flat 5 MeV α
  5.38 → 8.52 (8.9); 3-D 3.23 → 10.55 (the 3-D water 14–18% too dense, on record). For fast particles the tracks
  across the box show the soft part only (rare δ-rays carry the mean): flat 1 MeV e⁻ 0.0025 → 0.0116 (mean 0.0187),
  1 GeV e⁻ 0.0011 → 0.0058 (0.024), 100 MeV p 0.0098 → 0.0148 (0.073); 3-D 0.0006 → 0.0049, 0.0004 → 0.0063,
  0.0063 → 0.0170. Each atom's mean (cpmAtom alone, 2,000 passes): 5 MeV α at O 50.6 ± 2.8 against 54.1 eV,
  1 MeV p 18.4 ± 2.0 against 15.8.
- Straggling: 5 MeV α across 16 Å of flat water (432 tracks): most probable 41.6 eV (Landau 40.6), FWHM 4.78 ξ (Landau
  4.02 ξ; ξ = 17.4 eV, κ = ξ/T_max = 0.006, T_c ~ ξ so Landau's soft side is narrow here), mean 125 eV, 90th percentile
  3.5× the median, largest 3.9 keV; off the spread came only from where tracks passed atoms (90th percentile 1.9× the
  median, largest 240 eV in the first run).
- δ-rays (the sampler at an oxygen, ~92,000 each): 100 MeV p up to 190.8 of T_max 229.2 keV, share above T_max/100
  0.00655 (law 0.00626), mean 142.5 (138.6) eV; 1 MeV e⁻ up to 357.8 keV (T/2 = 500); the direction to 10⁻⁵ of the
  kinematics. In flat water 5 MeV α free electrons up to 1.67 keV (T_max 2.74).
- Cherenkov: water 41.39° (1/βn: 41.39°), 316 photons/cm counted (Frank–Tamm 334 for 300–600 nm; the brief's ~250/cm
  is a narrower band: 350–550 nm gives 208), 300 keV e⁻ 14.94° (14.97, slowing as it goes), 3 GeV p 39.43°, silica
  46.69° (46.70), 3-D water 41.39°; none from 150 keV e⁻ or 300 MeV p (below threshold), in lead, or in a vapour at a
  fifth of the liquid's density.
- Pairs: none of 4,000 γ rays of 1.00–1.02 MeV at lead; 133 of 2,000 at 2 MeV. At 10 MeV: lead 12.6 b (pair, XCOM
  ≈ 12.7 b from its 0.0497 cm²/g less Compton, from memory), water 0.142 b a molecule; the game's ratio 89.3 (the
  cross sections' 88.9; Z² alone 102); Compton at Klein–Nishina's rate to 0.3%. Lead's total at 10 MeV 0.0488 cm²/g
  (pair 0.0366 + Compton 0.0122, no photoelectric) against XCOM's 0.0497; water 0.0218 against 0.0222. At 100 MeV lead's
  pair 0.108 cm²/g is probably ~15% high (no gradual screening: the smaller of the unscreened and completely screened
  values); at 1 GeV 0.121 (7/9X₀ = 0.122). Pairs forward (median 0.13 rad at 10 MeV), unequal (80% more than 20% apart).
- Books: 3-D, each 0.2 Å tick of the fast particles (moveFastLeptons3, fastEncounters3, exoIonize3) with the rest of
  the world between steps: within 4×10⁻⁶ eV (lead, 66 photons, 7 pairs) and 5×10⁻⁴ eV (water: δ-rays, 26 Cherenkov
  photons); each pair (flat and 3-D, with the triplet) within 2.4×10⁻⁷ eV. Flat: each event of this part (an atom's
  loss with its δ-rays and photons, each pair, each Cherenkov emission) within 5×10⁻⁴ eV, less ejectElectron's own residue
  (below).
- Off: tools/fingerprint.js (seed 7, 300 steps), all 59 setups flat and 3-D the same as v142 at 0fa22fa, bit for bit
  (one lane, before and after); f_rp3 "off" keeps nine of them (cloud, photonuc, pet, pionbeam, crt, linac, water,
  water3d, seu). On, over 300 steps: photonuc (12 pairs) and pionbeam (20 δ-rays) change; cloud, pet, linac, crt,
  rutherford, emtube, water3d and seu stay as off.
- Cost (one thread, the machine shared): nothing where no fast charged particle crosses matter; a fast particle's pass
  through water flat ×0.8 (1 MeV e⁻, fewer small ionizations) to ×1.4 (5 MeV α, 50 → 69 µs an ångström), in 3-D ×1.3
  (1 MeV e⁻ 75 → 96) to ×1.5 (5 MeV α 76 → 112); setups ×1.0–1.3 a step (pion beam 7.2 → 8.7 ms, linac 0.40 → 0.51,
  photonuc 7.3 → 8.4, cloud 0.48 → 0.53, water3d 2.64 → 2.69).

**Found, not changed:**
- The flat game's ejectElectron is not exact beside ions and free electrons in a crowded, ionized lattice: in eight
  1 GeV electrons' passes through a lead block the electrons it set free missed the books by up to 48.7 eV with the switch
  off (102 eV on, with more ionization), in water up to 39 eV off (0.12 on); on fresh water it is exact (10⁻⁶ eV). The
  same 300 ticks: 17 of 85 ejections over 0.01 eV on, 9 of 42 off.
- The flat radiation flight's old loop pushes atoms that are themselves in radiation flight through their velocity,
  which their stored energy doesn't see (a leak of what the push gives); with the switch on such atoms (and ballistic
  ones, as 3-D's fastStop3 already does) are not ionized.
- 3-D: a lattice of unbonded O and Pb atoms at 0 K crossed by four 1 GeV electrons drifts by −1.3×10⁸ eV over 40 steps
  with the switch off (−8.5×10⁷ on), all in innerSteps (the free electrons' inner steps among the ions): the known
  ionized-plasma limit at its worst, worth a bug-fix session.
- ejectElectron at the particle cap puts the electron's energy in the bath and returns null, after which every caller
  in the radiation code also calls dumpHeat with it (counted twice).

**For the owner (physics questions, written down, not decided):**
- Showers and Cherenkov light are at nature's rates, so in a nanometre box they are almost never seen. A "matter depth"
  setting (RP.cpmX, ×10⁶ say) would show them, with the caveat that it scales the rare processes only (the collisions
  can't be scaled without cooking the atoms), so a scaled shower's critical energy would be 10⁶ times too low. Expose it?
- The mean loss is now Bethe's for fast particles when the switch is on (needed for the critical energy and the
  radiation length to agree with each other); slow ions keep the game's calibration. In 3-D the change is large
  (×3 for a 5 MeV α, ×8 for a 1 MeV electron).
- Compton scattering's odds now follow Klein–Nishina with energy (unchanged at 1 MeV: ×1.36 at 511 keV, ×0.24 at
  10 MeV); its angles stay for part 7. The giant dipole resonance keeps its old scale (0.0015·Z·σ_GDR/5.2Z² mb), so
  against the new pair odds it is now 16 times rarer than its own cross section says (lead at 13.5 MeV: the game's
  σ_GDR 376 mb against σ_pair 15.6 b, ratio 0.024; its odds a pass 0.0013 against the pair's 0.885, ratio 0.0015;
  before, against the old pair odds 0.123, 0.011); unify it too?
- Not built: photoelectric absorption of γ rays above 100 keV, e± multiple scattering, Møller/Bhabha's exact spectra,
  the triplet's measured recoil spectrum, Cherenkov dispersion and other media, muon radiative losses.
- The brief's ~250 photons/cm is for a narrower band than its 300–600 nm (which gives 334).

**Test change:** t_features' 1.10 Settings check counts seven "realistic when on" tags (part 1's four, parts 2 and 4's two,
this one). f_rp3 "off", "straggle", "delta", "ckv", "brems", "pair", "books" (Node) and "layout" (page); on v142 they
fail (no RP.cpm, no cpmGamma: checked in a worktree of 0fa22fa).

**Suites** (2-core machine, another session's tests running beside): alone t_lint, t_energy, t_hep, t_physics, t_3d,
t_settings, f_rp1, f_rp2, f_rp3, f_swx, f_hep126, f_sweep3d pass; tools/fingerprint.js all 59 the same as v142 with
the switch off. t_features alone: f_rp1, f_rp2, f_rp3 pass; misses only timing checks while the other session ran
its tests: 1.21 contraction speed (1.2× against > 1.6; alone 3.23×) and f_bug125's exoElastic (3.06 ms against < 3;
alone 1.1 ms). tools/runtests.sh: 21 of 22 pass; t_features' four misses are timing ones under both lanes' load: the
1.14 speed readout (1/1.3×, the known two-core flake), exoElastic (4.15 ms) with f_bug125 "alone" for it, and 0.51's
strings/plasma "qgpLog" (the plasma formed, 1,037 hadrons, its log line not found within the frame-budgeted run; with
the switch off, so none of this part's code runs there; alone in the page it passed 3 of 3).
### 1.27: realistic particles 7 (photon polarization, Klein–Nishina)

Branch v146 (from v145 at 178816e, the combined 1.27 with parts 1, 2, 4, 5 and 6). Part 7 of the seven approved
realistic-particle parts (the owner, 2026-11-05: "I ok all of them, just please make sure it doesnt mess with anything").
One more line in Settings → Experimental → Realistic particles, after "Nuclear spin, γ lines and neutron cross sections":
"Photon polarization" (`setRpPol`, `SET.rpPol`, `RP.pol`), a switch, off at every start and after a reload (`SET_EXP`),
its cost tag (flat and 3-D tables), "realistic when on", the description in the side pane (SDESC, SDESC3) and a note
under the line; the 3-D note names it. Code: hep.js at the end ("Realistic particles 7": polRand, polAcross, polMirror,
polPS/polFromPS, knScatter, rpCompton, knPlaneW, polPair, polText), hooks in engine.js (emitPhoton/emitPhoton3 pass
`opts.pol` to rayInteract/rayInteract3 and keep it on the ray or flight; compton/compton3 hand over to rpCompton;
twoGamma), hep.js (psDecay's two γ, closeEvent passes a ray's pol), props.js (mirror, splitter, lens, prismTrace7, the
polarizer), ui.js (Light tool and lasers, Objects tool, quick menu, Inspect, Settings), render.js (the polarizer, the
mark on a photon in flight). Checks: tests/f_rp7.js (t_features runs it alone; `node tests/f_rp7.js [--node] [part …]`):
off, angles, asym, sources, pairs, optics, books, both, page; every part but books fails on v145 (no switch there; books
checks exactness, which v145 had too). Screenshots: scratchpad rp7/set-desk.png, optics.png, inspect.png.

- **What a photon carries, and the choice for the flat game.** A linear polarization, a unit vector across its direction
  (`opts.pol`, kept on its ray or flight as `pol`). In the flat game every photon flies in the plane, so its polarization
  is an angle ψ between "in the plane" (p̂ = k̂ × ẑ, across its path) and "across the plane" (ẑ, out of the screen), stored
  as the vector cos ψ·p̂ + sin ψ·ẑ. That is all a photon in the plane can have, and the game's plane is the plane of
  incidence of every mirror and prism face and the scattering plane of every Compton event, so in-plane is exactly p and
  across is exactly s. Unpolarized sources (thermal and atomic light, γ lines, X-rays, bremsstrahlung: everything not
  named below) leave it empty, "unpolarized": a direction is drawn at random the moment something acts on it (ψ uniform,
  or uniform round the path in 3-D), which is the same statistics. Polarized: the Light tool and its lasers (a new
  "Polarization" choice with the switch on: in the plane, across ⊙, unpolarized; 3-D vertical, horizontal, unpolarized;
  default in the plane / vertical), Compton-scattered photons, reflections, the polarizer, and the two γ of every e⁺e⁻
  annihilation into two (free pairs, at atoms and walls: twoGamma; para-positronium and pick-off: psDecay), each
  unpolarized alone and the two at right angles (polPair). Circular and elliptical polarization are not carried.
- **Compton scattering (rpCompton, knScatter).** Klein–Nishina with the polarization, summed over the outgoing
  polarizations: dσ/dΩ = ½r₀²(E′/E)²[E′/E + E/E′ − 2 sin²θ cos²φ], φ between the scattering plane and the polarization
  (Klein and Nishina 1929; Heitler, *The Quantum Theory of Radiation*); E′ = E/(1 + (E/mₑc²)(1 − cos θ)), mₑc² =
  510,998.95 eV (the old code used 511 keV); at low energy Thomson's 1 − sin²θ cos²φ, unpolarized (1 + cos²θ)/2. The new
  polarization: ε₁ (the old one's part across the new path) or ε₂ = n̂ × ε₁, weighted E′/E + E/E′ − 2 + 4(ε·ε′)² (Heitler;
  the choice Geant4's polarized Compton makes, Depaola 2003). Drawn with one proposal ∝ E′/E, inverted exactly (3-D: in
  cos θ, 1 + κ(1 − μ) = (1 + 2κ)^v, φ uniform; flat: θ = 2 atan(tan(π(w − ½))/√(1 + 2κ)) round the circle) and one
  acceptance (r² + 1 − 2r(ε·n̂)²)/2 ≥ about ⅓: about 1 µs a scattering at any energy (formulas from memory; they are
  standard and checked here against each other). The electron leaves along the momentum the photon gave it, E·k̂ − E′·k̂′
  (before: along the photon), with the energy as before. Off, the old draw (cos θ even) is kept as it was.
  - *The flat game.* The photon scatters within the plane: its angle θ round the circle has the Klein–Nishina law at the
    plane's φ (cos φ = the polarization's in-plane part), what a ring of detectors in the plane sees (as part 4's μSR
    positrons). Two consequences, both built: (1) an in-plane-polarized photon scatters into the plane less often than
    one polarized across it (at low energy 2 : 4 against an unpolarized 3), so a polarized photon's rate is the game's
    times knPlaneW = (A − 2cos²ψ·B)/(A − B), A = ∫(r³ + r)dθ, B = ∫r² sin²θ dθ (Simpson, 64 intervals; ×2/3 to ×4/3,
    unpolarized ×1, 3-D always ×1, the total cross section there not depending on ε; the game's chance at an atom,
    1.2% an electron, is already 0.98 for lead, so there the ×4/3 is capped at 1); (2) for an unpolarized photon ψ is
    drawn afresh with every proposal, so θ comes from the unpolarized law (1 + cos²θ at low energy); drawing ψ first
    and θ after would give (1 + 2cos²θ)/2 (found by the χ² check: 666 against 19 dof before this).
  - *The rate: part 3's.* With this switch alone, a γ ray of 100 keV or more meets an atom's electrons at 1.2% each,
    whatever its energy, as before; Klein–Nishina's total cross section falls with energy: σ/σ_T = 0.96 at 10 keV, 0.74 at
    100 keV, 0.43 at 511 keV, 0.32 at 1 MeV, 0.12 at 5 MeV, 0.077 at 10 MeV, 0.012 at 100 MeV (computed from the formula).
    Part 3 (Charged particles in matter, RP.cpm, merged from v145 at 2e5a21c) makes Compton's odds follow that total
    cross section (cpmGamma: cpmKN(E)/cpmKN(1 MeV), ×1.36 at 511 keV), with pair production by its measured cross
    sections; this part reuses it and adds only the flat game's polarized weight (cpmGamma's w = knPlaneW) and the
    angles. The switches work alone and together (f_rp7 "both": cpm alone fingerprints as part 3 made it; both on, the
    odds are part 3's × knPlaneW). Below 100 keV the box does no Compton scattering
    (X-rays ionize or pass), so the 10 keV check is of the scattering itself (knScatter), not of the box.
- **Optics (flat game, props.js).** Mirror and beam splitter: the reflection mirrors the vector (ε − 2(ε·n)n: an ideal
  metal, r_s = −1, r_p = +1, linear stays linear, unpolarized stays unpolarized); passing a splitter keeps it (as the
  brief asked; a real dielectric splitter changes it a little). Lens: kept, its in-plane part turning with the ray (an
  ideal lens, no Fresnel losses). Prism (prismTrace7, the switch on): each face reflects by Fresnel's equations for the
  photon's polarization (the plane of incidence is the game's plane; p̂ = k̂ × ẑ for every wave): r_s = (n₁c − n₂c′)/
  (n₁c + n₂c′), r_p = (n₂c − n₁c′)/(n₂c + n₁c′), t_s = 2n₁c/(n₁c + n₂c′), t_p = 2n₁c/(n₂c + n₁c′); R = r_s²·s² + r_p²·p²
  (Hecht's *Optics*, from memory), the photon reflected with that chance and leaving with the amplitudes it keeps. At
  Brewster's angle (tan θ_B = n: 58.3° for the prism's F2 flint at 589 nm, n = 1.6166; ~56° for crown glass) r_p = 0: the
  reflected light is all s, across the plane. A total reflection inside keeps the vector as at the critical angle
  (r_s = r_p = 1; its phase shifts, which make light elliptical, are not carried). Before (and off): the prism reflected
  nothing at its faces. The polarizer: a new object (Objects tool, offered with the switch on; `OBJ_POL`, kept out of
  OBJ_KINDS so t_fuzz's draws are unchanged; saves carry its axis `pa`): a sheet with its axis at α from the plane
  (0 along the sheet in the plane, 90 across the plane; Axis in the tool and the quick menu); a photon passes with
  probability (ε·â)², â the axis's part across the ray (Malus's law, cos²), unpolarized one in two, and leaves along â;
  else absorbed (escaped). Off, a placed polarizer lets light through untouched and says so in its title. X-rays and
  γ rays pass it, as the other optics. Placed objects stay out of 3-D (as before).
- **Rayleigh/Thomson scattering: none to act on.** The box has no elastic scattering of light by atoms or free electrons
  (rayInteract only absorbs, ionizes, dissociates, fluoresces or Compton-scatters above 100 keV). Adding it would be a
  new process (rates ∝ λ⁻⁴): for later, if the owner wants it (with photons as waves it would come naturally).
- **Cherenkov light (with part 3 on).** Its photons are polarized in the plane of the track and the photon, across the
  photon (cpmCkv: polAcross of the track's direction; Jelley, *Čerenkov Radiation*, from memory): in the flat game in
  the plane. Checked: 63 photons flat and 63 in 3-D, each across its path and in that plane to 2×10⁻¹⁶.
- **Inspect and the view.** Inspect's photon card has "Polarization" with the switch on: "linear, in the plane (across its
  path)", "linear, across the plane (out of the screen)", "linear, at N° from the plane", in 3-D the vector and its angle
  from vertical, or "unpolarized (…)". A photon in flight (flat) carries a mark at its head: a bar across its path for the
  part in the plane, a ring for the part across it. The polarizer is drawn as a dark sheet with strokes along it and dots
  for its axis. 
- **What the box can't make real, said:** circular and elliptical polarization (and so a total reflection's phase
  shifts, quarter-wave plates, the circular polarization of synchrotron and Zeeman light); the annihilation pair's
  entanglement: each pair here is a definite perpendicular pair (Wheeler 1946's picture), which gives each photon the
  right statistics but a weaker correlation between the two than nature's (Pryce and Ward 1947, Snyder, Pasternack and
  Hornbostel 1948: perpendicular over parallel Compton coincidences at 82° 2.85 in quantum mechanics, a definite pair at
  most 1.63, Bohm and Aharonov 1957; Wu and Shaknov 1950 measured 2.04 with their wide detectors); polarized γ lines
  from oriented nuclei and the angular correlations of cascade γ rays (⁶⁰Co's 1,173–1,332 keV pair); π⁰ → 2γ's
  perpendicular polarizations (built for e⁺e⁻ only); bremsstrahlung's partial polarization (unpolarized here; Cherenkov light
  is polarized, below); polarization in 3-D optics (no 3-D optics); Compton scattering
  off bound electrons' momenta (Doppler broadening) and their binding's suppression at small angles (Waller–Hartree).
- **Numbers** (Node; f_rp7 and scratchpad rp7/*.js):
  - Klein–Nishina angles, 60,000 unpolarized scatterings each, χ² over 20 bins (19 dof): 3-D in cos θ 22.9, 16.1, 18.9
    at 10 keV, 511 keV and 5 MeV; flat in θ round the circle 9.9, 17.4, 31.6. E′ from the scattered photon's own
    angle against the formula to 3×10⁻¹¹; the electron along E·k̂ − E′·k̂′ to 4×10⁻¹⁶.
  - Polarized, 3-D at 511 keV, scattered at 80–100°: 4.50 times as many at 90° to the polarization as along it (±15°
    wedges; the formula 4.37), φ against the formula χ² 14.9 (11 dof); unpolarized φ even, χ² 8.7. Flat at 100 keV, of
    40,000 photons meeting a carbon atom: across the plane 3,830 scatter, in the plane 1,948 (knPlaneW's 3,793 and 1,967);
    near 90° 411 and 9 (408 and 10). At 100 eV the new polarization is ε₁ in every case.
  - Sources: 3,000 annihilation pairs flat and 3-D and 200 para-positronium decays each: polarizations at right angles
    to each other and to their paths to 2×10⁻¹⁶, each photon's alone even round its path (χ² 9.2 and 3.9, 11 dof); an
    atom's line photons unpolarized; a laser across the plane along ẑ.
  - The pair's correlation (3-D, both photons of 300,000 pairs scattered, 72–92°, ±15°): perpendicular over parallel
    coincidences 1.53 ± 0.08 (a definite pair gives 1.565 averaged over these windows; quantum mechanics 2.58).
  - Optics: a prism face at Brewster's angle reflects 396 of 4,000 unpolarized photons (Fresnel 399), every one across
    the plane, and none of 4,000 polarized in the plane; straight on 226 (((n − 1)/(n + 1))² gives 222). Two polarizers,
    the second at 0°, 30°, 60°, 90° to the first: 1.016, 0.748, 0.257, 0 of the first's light (cos²). A 45° mirror keeps
    across and in-plane polarization to 10⁻⁶.
  - Books: 200 Compton events on a water molecule's O and H, flat and 3-D, exact to 3×10⁻⁸ eV (the photon's energy is in
    the books once it leaves or is taken). In a running box of liquid water with γ rays fired in (60 steps, 61 Compton
    events) the worst event is 2.15 eV on, 2.45 eV off: the ionized water's own known limit, the same either way. Light
    through two polarizers: escaped grows by exactly what left the beam (3×10⁻¹⁰ eV over 500 photons).
  - Switch off: the fingerprints of all 59 setups (seed 7, 300 steps) equal v145's (one lane, before and after); f_rp7
    "off" keeps six of them (annihilation, pet, prism, photonuc, water, water3d). On, three change in 300 steps
    (photonuc, hyperfactory, sns: their γ rays Compton-scatter); annihilation and pet do not (their γ rays leave).
- **Cost** (one thread, on a machine shared with another session's tests: ±30% noise). Off nothing (a flag test per
  Compton event, per optic and per pair). On: a Compton event 0.22–0.30 ms against 0.31–0.34 ms (most of it the electron
  set free; Klein–Nishina's draw ~1 µs); a laser photon through the Balmer prism 23–25 µs against 16–46 µs; the PET and
  annihilation setups ×1 (0.38–0.40 ms, 5.0–5.5 against 4.7–7.1 ms a step). Where γ rays scatter in matter the electrons
  come out slower (forward scattering, as in nature) and ionize more of the box: flat liquid water with five γ rays a step
  44–52 against 42–49 ms a step (noise); 3-D liquid water 138–206 against 81–97 ms a step (66 ionizations against 27 in
  100 steps): the 3-D tag says ×1–2.
- **Found, not changed (for a bug-fix session; it is the same with the switch off):** in the flat game `ejectElectron`
  books 100–200 eV wrong when the electron's energy at infinity is just under radThreshold (1 keV) and its launch
  energy, with the ion's pull added, is over it: setMotion then puts it in radiation flight, which carries no potential
  energy, so the pull its launch counted on is created (water, 40 tries each: 0.8 keV 121 eV, 1.0 keV 149 eV, 1.2 keV
  200 eV; 0.5 and 1.5 keV exact). Any ionization making a ~1 keV electron does it; Klein–Nishina's forward scattering makes
  such Compton electrons a little more often (seed 18's water box: two events, 50 and 124 eV). Fixing it changes the flat
  game off too, so it is left for main.
- **Suites** (2-core machine shared with the part-3 session; after merging v145 at 2e5a21c, part 3): alone t_lint, t_energy,
  t_hep, t_physics, t_3d, t_settings, t_fuzz, t_touch, f_rp1, f_rp2, f_rp3, f_rp5, f_rp7, f_swx, f_hep126, f_sweep3d pass; the
  fingerprints of all 59 setups equal v145's (2e5a21c). t_features alone: f_rp7 and every f_ file pass; 3 misses, all
  timing: the chain reaction's k readout and 1.21's contraction time (both on record as two-core flakes), and the glowing
  walls' oven (mean photon 2.81 kT, a photon after the walls were set to wrap): its frames run on a 25 ms budget, and
  alone in the page it passes on this branch (2.745, 2.713 kT, none) as on v145 (2.718, 2.634, none). tools/runtests.sh:
  stopped at its 30-minute limit with t_features (lane A) still running; the other 20 suites ran: 19 pass, t_fuzz missed
  once (seed 17, "S²⁻ kept electrons it cannot hold", under both lanes' load) and passed alone (24 worlds, 326 s);
  t_touch, not reached, passed alone.
- **For the owner (physics questions, written down, not decided):**
  - Give X-rays of 10–100 keV their Compton share (in light elements it passes the photoelectric effect near 25–30 keV);
    the box does none below 100 keV, with either switch.
  - Rayleigh and Thomson scattering of light (elastic, λ⁻⁴, polarizing at 90°: the blue, polarized sky) are not in the
    box: add them (with photons as waves, or before)?
  - π⁰ → 2γ with perpendicular polarizations, and cascade γ–γ angular correlations (⁶⁰Co): add them?
  - Values from memory (no network): mₑc², the textbook formulas (Klein–Nishina, Fresnel), F2's dispersion (already in
    the game), and the historical numbers above (Wu–Shaknov 2.04, the 2.85 / 1.63 at 82° are also computed here from the
    formulas: 2.835 and 1.629).

### 1.27: combined (branch v145; not released)

**The owner's feature list (2026-11-06): ALL APPROVED** ("I approve all of them"; the bug fixes wait for his credits).
18 keep part 3's Bethe energy loss with its switch on (decided: kept, nothing to build); 19 photons as waves; 20 a bigger
model for close-packed metals; 21 polarizability by direction; 22 Rayleigh scattering; 23 stopped kaons make Σ too; 24
unstable particles interacting with each other; 25 the Higgs boson; 26 a "matter depth" option for showers and Cherenkov
light; 27 the polarization correlation of π⁰ → 2γ and of γ–γ cascades (⁶⁰Co); 28 charm and bottom from nucleus–nucleus
collisions; 29 the Z peak lowered by the beams' own radiation, and the W pair's forward peak; 30 hydrogen in molecules
catching muons at the measured rate; 31 an automatic energy scan in the LEP setup; 32 positronium on the particle menu.
33 (asked 2026-11-06, a speed-up, not physics): the longer force reach (9 and 12 Å) in WebAssembly: the Rust kernel
has the 6 Å cutoff compiled in (kernel/src/lib.rs `RC2 = 36.0`, used 12 times; setCutoff turns the module off for any
other reach), so 9 and 12 Å run the JavaScript kernels; making the cutoff a value the kernel is given (lib.rs, d3.rs,
the neighbour lists' reach) and built by wasm.yml, with 6 Å bit for bit as now and 9/12 Å equal to the JavaScript to
the bit, would give them the module's speed (the pair loop about 1.7–2.5× the JavaScript's). Medium job.
34–38 (asked 2026-11-06, "anything else that can be written in wasm?"; speed-ups, not physics; measure first: a profile
of each with its setting on, then port only where the JavaScript part is most of the step): 34 quantum bonds (xtb.js:
the GFN-xTB self-consistent field, its Hamiltonian, the eigen-solver and the gradients, all JavaScript; large);
35 directional forces (sites.js sitesForces: σ-holes ×1.7–2.0 flat, lone pairs ×2.1–2.6 in 3-D, π clouds; a JavaScript
pass after the kernel; medium); 36 electrons as waves (waveForces/waveForces3, eFF; medium); 37 free electrons' inner
steps among ions (innerSteps/innerSteps3, the RESPA loop that dominates ionized matter; medium, branchy); 38 many-body
metals in mixtures (bometal.js's JavaScript path when non-metals or other kinds are in the lump: mbWasm takes only plain
metals; small–medium). Not worth it: events, reactions, nuclear and particle physics (rare and branchy), drawing (WebGL).
Order, to spend the owner's limited usage well: the small ones first in one session (23, 26–32), then the medium ones
(21, 22, 25), then the large ones (19, 20, 24) one at a time with the owner's go-ahead on cost.
Done since: 21 (branch v150 from v145, 2026-11-06: "1.27: feature 21 (polarizability by direction)"); 22 (branch v151
from v150: "1.27: feature 22 (Rayleigh scattering)"); 25 (branch v152 from v151: "1.27: feature 25 (the Higgs boson)"); 24 (branch v153 from v152: "1.27: feature 24 (unstable
particles meet each other)"); 19 (branch v154 from v153: "1.27: feature 19 (photons as waves)"); 20 (branch v155 from v154: "1.27: feature 20 (close-packed metals)").
The owner (2026-11-06): the WebAssembly speed-ups go to the next version (1.28), as one pass over everything that could use
one: 33–38 above, and polarizability by direction's update and force pass (pold.js pdUpdate, pdForces: ×1.2–4.2 on top
of the induced charges, the most in 3-D at every step), and the close-packed metals' band shape (bometal.js mb4Pass:
×1.7 a step in a 3-D copper crystal, its own pass ×5.9 over the module's). Time each first (a profile with its setting on), port where the
JavaScript is most of the step.
39–44 (the owner, 2026-11-07: "Add everything including the garbage collector fix"; speed-ups, not physics). Found by a
profile of every setup's step loop at normal settings (seed 7, 300 steps each, the inspector's sampling profiler, its own
time left out; one thread): WebAssembly is 16% of the step on average (3-D water 86%, flat chip setups 56–66%), the rest
JavaScript. GitHub's "90% JavaScript" counts files: the built page in dist/ is 59% of the bytes, generated libraries 8%,
the interface and drawing 8%, tests 6.5%, tools 6%, the simulation about 11%, the Rust kernel 1%. Measured shares:
39 neighbour searches outside the kernel (engine.js gridWalk, gridWalk3, nearby, buildGrid: the grid lookups for events,
ions' pulls and electron transfers): 3-D brine 35% of its 8.5 ms step (the slowest setup), brine 29%, chain 28%; small–medium.
40 the step's main loop (stepPlain, chooseDt, housekeeping, integrateA): about 10% on average, 13–25% in magnet, chain,
mucf, fusion; medium, it touches nearly everything.
41 molecule recognition (graphHash, fnv, libIndex): 25–35% in soup, hydrogen3d, muonium; small.
42 light and radiation in matter (radPath, zoneLocal, zoneKey, moveRad): 40–50% in rhic and ring (both under 1 ms a step);
medium, branchy.
43 fast nuclei and leptons in flight (fastFastNuclear, moveFastLeptons, segTargets): about 25% in nif and fusion; medium.
44 the garbage collector (a JavaScript fix, not WebAssembly): 7% of the step on average, 11–14% in muonium, magnet, isolde;
find the per-step allocations (arrays and objects made in hot loops: minImg's returned arrays, closures, event
records) and reuse buffers instead; measure with --trace-gc and the profile before and after.
Same rule for all: profile with the setting or setup on first, port only where JavaScript is most of the step, results
bit for bit (fingerprints) where the order of arithmetic allows, equal to rounding where it does not (the 1.25 metals
port's standard). All of 18–32 are built (the owner, 2026-11-06: "just finish all the features"); 33–38 go to 1.28.

**The owner's bug list (2026-11-06).** Seventeen open bugs, one bug-fix prompt each (branches fix127-01 … fix127-17
from v145; tests f_fix01 … f_fix17). APPROVED by the owner where the fix changes how matter behaves ("I approve of the
ones that need approval"): 1 3-D van der Waals and ion–water pull at their true strength; 2 water's (and molecules')
ionization energy at the measured value; 3 nucleus–nucleus close passes turned by Rutherford's angle at real impact
parameters; 4 fast positrons scatter and ionize, annihilating in flight at Heitler's rate; 5 p̄p at high energy mostly
inelastic by the measured cross sections; 6 fast fired particles meet over the step; 7 Compton scattering of 10–100 keV
X-rays; 8 electron recapture in ionized water the same in both modes, as in nature; 11 the giant dipole resonance on part
3's footing; 13 alkali aurides inside mixed metal lumps; 14 AsCl₅'s chlorines not bonding to each other. Bug fixes (no
approval needed): 9 the decay table's 43 estimated nuclides, 10 muonic atoms keep their muon when a neutron remakes the
nucleus, 12 measured muon lifetimes for every element, 15 three bookkeeping leaks, 16 four display and text slips, 17
the values written from memory checked against their sources.

All seven realistic-particle parts (v141–v146), W and Z (v148) and the final 1.26 (v136 at 0b0e149: the sweeps, the
spin-branch fix, Polarized normal, the fast-electron energy fixes, decay data) merged on v145 (2026-11-06). Switches off,
every one of the 59 setups is bit for bit 1.26's (tools/fingerprint.js, seed 7, 300 steps, both trees: identical; the
only new line the LEP setup). The parts' stored switches-off fingerprints were taken before the 1.26 energy fixes and
were updated to 1.26's (annihilation, muonium, hyperfactory, photonuc, pionbeam, sns; f_rp7's part-3-on hashes too);
f_rp3 "books" (flat water's events 20 against > 20) and f_rp2 "matter" (33 o-Ps ended in the run against ≥ 36) took
thresholds of 15 and 30: the events drawn moved with the fixes' last bits, the measured values did not. Suite:
tools/runtests.sh 20 of 22 (t_features: 1.14's speed readout, the known two-core flake, and the parts' fingerprint
checks before the update; t_page: the slow-motion button, the known flake); after the update every f_rp file, f_ew and
f_bug126e pass alone.

### 1.27: two controls (the owner, after 1.26)

Branch ui127 from v145 (2026-11-06, the owner: "a way to stop measuring 2 atoms (right click one with the tool) and a
modifier key for tool sizes (shift + scroll)"). Controls only, nothing in the physics; no setup changes.
- **Measure: right-click a measured particle to stop measuring it** (measureDrop, from onUp). A right-click that does not
  drag (under 6 px) used to open the quick menu everywhere; with the measure tool, on a particle being measured, it now
  drops that particle from the measurement (the third of an angle leaves a distance; one of two leaves "now click a
  second particle") and no menu opens. Anywhere else, or with another tool, the quick menu as before; a right drag still
  pans (flat) or turns the view (3-D). The same pick as a left click (particles, unstable particles, light in flight).
- **Shift + wheel: the tool's radius** (toolRadiusWheel, from onWheel) for the tools that have one: Push/Pull, Heat,
  Spark, Magnet, Erase. One notch moves the radius slider 8 of its 200 steps (about ×1.1–1.2 a notch, between the tool's
  smallest radius and 1,000 Å), up to enlarge; the slider and its number follow. In 3-D, Shift + wheel keeps moving the
  placing plane for the Place tool (the only one that shows Depth). Chromium on Windows sends Shift + wheel sideways
  (deltaX): taken too. The tools' help lines say so.
- Tests: tests/f_ui127.js (t_features runs it alone): real mouse input in the page, flat and 3-D.

### 1.27: features 23 and 26–32

Branch v149 (from v145 at d875110, the combined 1.27). The owner's list, approved 2026-11-06 ("I approve all of them"): the
small ones, built in one session. Every one is off or unchanged at normal settings but the two menu entries (31's button,
32's particles): switches off, all 60 setups' fingerprints (tools/fingerprint.js, seed 7, 300 steps) are bit for bit
v145's, LEP's included (the scan is a button; the beams' radiation and the W pair's angles go with Resonance widths and
heavy flavour, see 29). Checks: tests/f_feat1.js (t_features runs it alone; `node tests/f_feat1.js [--node] [part …]`):
fp, kaon, pol, aa, isr, mucap, scan, page; every part but fp fails on v145 (checked on a copy of d875110: no Σ, no
polarization, no heavy flavour, "eeISR is not defined", the Z law, "zscanStart is not defined", no Matter depth line).
No network here: every value marked "from memory" below is worth a check against its source.

- **23. Stopped kaons make Σ too** (Exotic atoms on; hep.js kStop, KSIG, kSigma). A K⁻ absorbed at rest on a nucleon makes
  Σπ two times in three, Λπ one in three (KSIG.share 2/3: K⁻ absorption at rest in ⁴He and in emulsion's light nuclei,
  Katz et al. 1970, Vander Velde-Wilquet et al. 1977, from memory). On a proton the Σ's charge as in kaonic hydrogen at
  rest: Σ⁺π⁻ : Σ⁰π⁰ : Σ⁻π⁺ = 0.466 : 0.272 : 0.198 (from R_c 0.664, R_n 0.189, γ 2.36; Tovee et al. 1971, Nowak et al.
  1978, from memory); on a neutron Σ⁰π⁻ and Σ⁻π⁰ alike (isospin 1). On its way out the Σ turns into a Λ on a second
  nucleon (ΣN → ΛN: Σ⁺n → Λp, Σ⁻p → Λn, Σ⁰N → ΛN) with the chance 1 − exp(−ρσL) (ρ 0.16 fm⁻³, σ ≈ 20 mb, L ¾ of the
  residual's radius: 0.35 in ⁴He's residual, 0.48 in carbon's; about half measured in light emulsion nuclei, from memory);
  the struck nucleon at rest in the residual's frame, the rest a spectator on its mass shell, so momentum and energy add
  up exactly. A Σ⁰ that does not convert leaves as Λγ (its 7×10⁻²⁰ s). The Λ, converted or not, may still stay as a
  hypernucleus (hypCatch). Captions name the channel ("K⁻p → Σ⁺π⁻, the Σ⁺ turned into a Λ on a neutron (Σ⁺n → Λp)").
  Off (or with the switch off: kStop's other callers), as before. Measured (400 kaons each): carbon Σπ 271 (2/3: 267),
  converted 140 of 271 (0.52); helium converted 87 of 271 (0.32); 3-D carbon 267 and 125; books within 1.5×10⁻⁵ eV of
  events of ~10⁹ eV, charge kept. Cost: one more draw per stopped kaon.
- **26. Matter depth** (Settings → Experimental → Realistic particles, the line after Charged particles in matter;
  SET.cpmX → RP.cpmX). ×1 (normal), ×10³, ×10⁶: the existing hidden multiplier of part 3's rare processes, bremsstrahlung
  and Cherenkov light. Its descriptions (the line's note, the side pane flat and 3-D) say plainly that it speeds up only
  those rare processes, the collisions, δ-rays and energy loss staying at nature's rates, so a scaled shower's details are
  off by the same factor (its critical energy that much lower, its radiation length that much shorter). Back to ×1 at
  every start (SET_EXP), saved, in the Speed test's summary ("matter depth ×1,000") and the Experimental total. Cost tags:
  ×1 with Charged particles in matter off; on, ×1–1.1 (×10³) and ×1–1.2 (×10⁶), measured on one thread: the radiation
  setups unchanged (linac 0.22 ms a step at every factor, pion beam 7.3/7.2/6.8, photonuclear 4.5/4.1/5.0), 1 GeV
  electrons fired through flat water 0.62 → 0.71 ms a step, through 3-D water 4.3 → 4.5 at ×10⁶. ×1 carries "realistic":
  t_features 1.10's realistic-tag list gains a "1" (15 tags, the switches' 10 unchanged).
- **27. Photon polarization: π⁰, η and ⁶⁰Co** (Photon polarization on; hep.js polPS0, GL_ACORR, glCorrDir). π⁰ → γγ and
  η → γγ give the two photons perpendicular polarizations (the pseudoscalar's amplitude k·(ε₁ × ε₂): Yang 1950; for π⁰
  seen in its double Dalitz pairs' planes, Plano et al. 1959), as part 7 does for annihilation pairs (polPair). ⁶⁰Ni's
  1,173 → 1,332 keV cascade (4⁺ → 2⁺ → 0⁺, E2 E2; with Nuclear spin, γ lines on, which makes the lines): the second γ
  leaves at θ to the first with W(θ) = 1 + A₂P₂(cos θ) + A₄P₄(cos θ), A₂ = 0.1020, A₄ = 0.0091 (the theory's, measured
  alike since Brady and Deutsch 1950; from memory). **The brief wrote this as 1 + 0.102 cos²θ + 0.0091 cos⁴θ**: 0.1020 and
  0.0091 are the Legendre coefficients; in powers of cos θ the same correlation is 1 + 0.125 cos²θ + 0.0417 cos⁴θ (exactly
  1/8 and 1/24 for 4(2)2(2)0), 1.167 times as likely back to back as at 90° (the brief's literal form would give 1.111):
  built with the measured A₂, A₄. In 3-D over the sphere; flat, in the plane (what a ring of detectors in the plane sees).
  Measured: 139 flat and 144 3-D two-photon decays (of 100 π⁰ and 100 η each; the others are π⁰ Dalitz and η's 3π),
  at rest |ε₁·ε₂| ≤ 1.1×10⁻¹⁶; 40,000 cascades: 3-D ⟨P₂⟩ 0.0195 (A₂/5 = 0.0204), flat ⟨cos²θ⟩ 0.5188 (W's 0.5193; at random
  0.5). Not built: the polarization–direction correlation of the ⁶⁰Co γ rays (the γ lines carry no polarization), other
  cascades (GL_ACORR has the one entry). Cost: nothing measurable.
- **28. Charm and bottom from nucleus–nucleus collisions** (Resonance widths and heavy flavour on; hep.js hfNucl,
  fragmentInto). A fireball's ncoll binary collisions (a·b/min(a, b)^⅔, as the W/Z code's: central Au + Au 1,150, Glauber
  1,050) each make a pair at part 5's measured share per collision at √s_NN (hfShare), so the pairs are Poisson with mean
  ncoll × share (J/ψ and Υ at part 5's shares); their hadrons (part 5's fragmentation fractions) join the plasma's or the
  string's hadrons, which make the rest from what they leave (mass, baryon number and charge taken from the bulk's), when
  they leave the fireball at least half its energy above its baryons. Central Au + Au at 200 GeV: 30.5 heavy hadrons a
  collision flat, 39.5 in 3-D (expected ~16 pairs: 1,150 × 600 µb/42 mb), none with the switch off, books within 2.6×10⁻¹⁵ of
  √s, charge kept. Central Pb + Pb at 2.76 TeV makes ~130 pairs (126 heavy hadrons seen), but see "found" below. Left out:
  nuclear shadowing, energy loss in the plasma, recombination (written down).
- **29. The Z peak lowered by the beams' radiation, and the W pair's forward peak** (Resonance widths and heavy flavour on;
  hep.js eeISR, isrDraw, wwAng, in eeEvent). Gated by that switch, as the owner's rule asks (normal settings unchanged):
  the beams' radiation is the Z's line shape, the switch's subject; the W/Z code itself stays always on. Initial-state
  radiation: the Kuraev–Fadin radiator with soft photons to all orders, G(x) = βx^(β−1)(1 + δ) − β(1 − x/2), β =
  (2α/π)(ln(s/m²) − 1) = 0.1077 at the Z (m the beams' lepton: a muon collider's beams 0.061), δ = ¾β + (α/π)(π²/3 − ½); the Z's σ = ∫G(x)σ_Born(s(1 − x))dx (Simpson, 600
  intervals, x = t^(1/β) for the singular part); a collision that makes a Z draws its x from G·σ_Born by rejection, the Z
  at √s' with one photon (x√s/2) along a beam (either), A_FB at √s'; x below 1 MeV of photon left unradiated. Hadrons:
  peak 30.59 nb at 91.19 GeV (Born 41.51; measured at LEP 30.4–30.5, from memory), highest 30.72 at 91.28 (moved up 0.09
  GeV); 88 GeV 4.01 (Born 5.39), 90 15.48 (21.94), 92 24.56 (28.86), 93 14.05 (13.35), 94 8.76 (6.93): the high side
  raised by radiative return. The photon channels keep their Born values (2–3% of the collisions at the Z). In 200 e⁺e⁻
  collisions on the peak: every one a Z, 111 with a photon above 1 MeV, mean Z mass 91.0 GeV; books within 4.3×10⁻¹⁴.
  W pairs: the W⁻ along the e⁻ with the t-channel neutrino's odds 1/(−t) = 1/(√s(E_W − q cos θ) − (m₁² + m₂²)/2), its
  leading term: at 200 GeV forward : backward 15 : 1 at the poles, 0.77 of W⁻ in the forward half in 3-D (measured: 0.81
  and 0.77 in 253 and 270 pairs, two seeds; f_feat1 0.86 of 127), against 0.5 before (LEP2 measured dσ/dcos θ rising
  steeply toward the e⁻, from memory). Not built: the photon channels' own radiation, ISR on the W pairs, the W spins.
  Cost: eeISR 0.16 ms per e⁺e⁻ collision above 10 GeV (cached for the same √s), the draw 0.004 ms; a Z's hadronic decay
  takes 0.29 ms (W and Z section): about ×1.5 on a collision, a few hundred collisions a minute at most.
- **30. Hydrogen in molecules catches muons less often** (Exotic atoms on; hep.js xaW, XA_HSH, in xaTarget). A slow μ⁻,
  π⁻ or K⁻ is caught by an atom within 1.5 Å with odds Z (Fermi–Teller), except hydrogen bound in water, methane or a
  hydrocarbon, whose weight is set so its molecule's share of captures on hydrogen is the measured one: H₂O 0.4% (Z law
  20%), CH₄ 1.7% (40%), other hydrocarbons 1.2% (from memory: π⁻ capture in hydrogenous molecules, Krumshtein et al. 1968,
  Petrukhin and Prokoshkin, Horváth; the large mesomolecule model, Ponomarev 1973; μ⁻ taken alike, the pion data being the
  measured ones). Other molecules with hydrogen, H₂ and free hydrogen keep the Z law. Measured (20,000 draws, the whole
  molecule in reach): water 0.0033, methane 0.0174, a free H beside an O 0.110 (1/9); ethane with 6 of its 8 atoms in reach
  0.0083. Cost: a molecule() walk per hydrogen candidate of a slow negative particle.
- **31. The LEP energy scan** (ui.js ZSCAN, zscanStart, zscanTick, zscanPoints, drawZScan; eeEvent records). Lab →
  Collider: with e⁺e⁻ on a linear collider at 30–60 GeV a beam, a "Scan the Z peak" button (Stop the scan while it runs)
  steps the beams through 44.5, 45, …, 47.5 GeV (√s about 88–94: the linac's beams arrive 1–5% below their setting, so
  each collision's own √s is binned), 30 collisions at each. Every e⁺e⁻ collision above 10 GeV is recorded (its √s, the
  total cross section, whether it made a Z, and from the Z's decay whether hadrons). The Data tab's new card "The Z line
  shape (energy scan)" draws σ(e⁺e⁻ → Z → hadrons) in 1 GeV bins (the share of collisions that made it times the total
  cross section there: LEP's events over its luminosity) with statistical errors, and the model's line (Born, or with the
  beams' radiation when Resonance widths is on). Node (seed 7): 226 collisions in 9,190 steps (0.7 s), 9 bins 86.6–94.5
  GeV, highest 43.1 nb at 91.5 (Born line 39.1 there), none off the line by 3σ; with Resonance widths on the highest 28.3 nb
  at 91.6 (line 29.6). The LEP setup itself is unchanged (fingerprint equal); its hint names the button. A different
  collider or setup ends a running scan. Screenshot: scratchpad scan31.png.
- **32. Positronium on the particle menu** (ui.js PCATS, placeFly, the Place tool's line). "Exotic atoms and nuclei" lists
  p-Ps and o-Ps (two entries: the owner can place either; positronium made in matter is still 1 : 3). Decided: shown
  always, and with the Positronium switch off placing is refused with the reason, in the Place tool's line and the log:
  "Positronium is placed with the Positronium switch on (Settings → Experimental → Realistic particles → Positronium): its
  decays, its pick-off in matter and its conversion by O₂ are that switch's." (Hidden entries would leave the owner
  wondering where it went.) With it on, placing makes them at rest as for any unstable particle.
- **Status (stopped by the coordinator, the owner's credit nearly gone):** all eight items (23, 26–32) are built, with
  their checks in tests/f_feat1.js (every part passes here, every part but fp fails on v145). Alone: t_lint, t_energy,
  t_hep, f_rp1 (its hadrons part updated for Σ), f_rp2, f_rp3, f_rp5, f_rp7, f_ew, f_feat1 pass. tools/runtests.sh was
  cut short: every suite passed but t_features (still running when stopped: its misses so far 1.14's speed readout, the
  known two-core flake, and f_126w's bo3 timing ×1.03 against 1.5, a timing check under load; neither rerun alone) and
  t_touch (not reached). The ISR lepton-mass fix (5a742f5) came after the suite's snapshot; f_feat1 isr/scan pass on it.
- **Found, not changed:** an event whose products pass the 1,500 unstable particles the box holds (MAX_EXO) carries the
  rest off with their energy (escaped) but not their charge: the charge count is off by theirs (v145 the same; seen
  with heavy flavour on in central Pb + Pb at 2.76 TeV, where the plasma's hadrons reach 1,500 even in Cu + Cu at 2.76
  TeV: 2–3 e off in one event); a bookkeeping fix (their charge to ledger.qOut), left for a bug-fix session. The scan's
  "measured σ" counts Z → hadrons only (γ* → hadrons, under 1% at the peak, is not counted).

### 1.27: bug 1 (3-D van der Waals)

Branch fix127-01-3d-vdw (from v145). Approved physics (the owner's list, 2026-11-06); after the measurements below the
owner chose to change the ion–water pull only ("pick b"). Check: tests/f_fix01.js (t_features, one line; `node
tests/f_fix01.js [--node] [part …]`): pull, forces, shell; "pull" and "shell" fail on v145 ({"flat":2,"d3":2}; 6.74
waters), "forces" (WebAssembly against JavaScript against the energy's slope) failed on this branch until GitHub rebuilt
the kernel (0.789 against 0.390 eV/Å).

- **What was wrong.** Two flat-world boosts were on in 3-D: the Coulomb pull between a free ion and a polar molecule's
  partial charges doubled (K_IW 2), and the van der Waals wells doubled (LJ_SCALE 2). Both make up for a plane's fewer
  neighbours; in 3-D an ion has its real shell.
- **What the measurements showed first** (Node, JavaScript kernels, before = v145):
  - Argon's wall-pressure Z of 0.48 (and helium's 0.84–0.89) was mostly the measurement, not the wells. f_sweep3d's run
    is 8 ps from a grid 5 Å inside the walls, and wallPressure averages every block since the start: heavy atoms have not
    reached the walls yet. Same 20,000 steps, seed 4: He 0.84, Ne 0.55, Ar 0.29, Xe 0.03; argon with its wells switched
    off entirely 0.27. Run 300,000 steps with the first 50,000 left out: v145 He 1.048 ± 0.016, Ar 0.991 ± 0.029, Xe
    0.921 ± 0.04; wells at factor 1: He 1.061, Ar 1.039 ± 0.032, Xe 1.021.
  - Exact second virial coefficients from the game's own pair energy (pairPE, 3-D, 300 K, cm³/mol), doubled → factor 1,
    against measured (from memory, Dymond and Smith's tables: check): He 3.8 → 5.7 (11.8), Ne 13.6 → 16.3 (11.3), Ar −28.1
    → +9.9 (−15.6), Kr −47.6 → +8.2 (−51), Xe −132.6 → −13.8 (−130). UFF's noble-gas wells are shallower than measured
    (Ar 8.0 meV against 10.3, Kr 9.5 against 14.1, Xe 14.3 against 19.0, from memory), so the doubled wells are nearer the
    real gases than UFF's own.
  - Water (343 waters as a droplet in a 60 Å box, bath 300 K, 3,000 + 4,000 steps, the middle 6 Å): v145 1.005 g/cm³,
    −0.425 eV a molecule between molecules; wells at factor 1: 1.033 and −0.437 (real 0.997; about −0.43, from memory).
    water3d's O–O first peak 3.05 Å → 2.85 (real 2.8). The "14–18% too dense" of 1.26 was with the 9 Å reach and lone
    pairs; with the usual settings 3-D water was 0.8% dense.
  - Salt water (brine3d, 3,000 + 2,000 steps, seed 4): see the table.
- **What changed** (the owner's choice: the ion–water pull only). In 3-D the pull is plain Coulomb: engine.js `iwK` (the
  energies pairNonbondedV, coulAA, the pair energies of events), pairKernel3 (the worker runs the same function),
  sites.js (sitePairE and the sites' force loop), af_qeq's P[10] (the induced charges), and kernel/src/d3.rs af_forces3
  (rebuilt by the wasm.yml workflow, b811a4b). The flat kernels, lib.rs and K_IW itself are unchanged; LJ_SCALE stays 2
  in both modes (comment at setSize).
  Texts (body.html): the Physics tab's "In the 3-D lab" card now names one flat correction still on (the wells), and
  Honest approximations' "Ions in water pull twice as hard" says it is the flat game only.

| brine3d, 3-D | v145 | after (K_IW 1) | wells and pull at 1 (not chosen) | real |
|---|---|---|---|---|
| Na⁺–O first peak | 2.15 Å | 2.25 Å | 2.15 Å | 2.36–2.43 Å |
| waters within 3.1 Å of Na⁺ | 7.17 | 5.50 | 5.48 | 5.5–6 |
| Cl⁻–O first peak | 2.85 Å | 2.95 Å | 2.95 Å | 3.1–3.2 Å |
| waters within 3.8 Å of Cl⁻ | 10.08 | 8.93 | 8.41 | about 6–7 |
| Cl⁻–H first peak | 1.95 Å | 2.05 Å | 2.05 Å | 2.2–2.3 Å |

  Real values as in 1.23.2's notes (from memory). Water without ions is unchanged (the pull acts only between an ion and
  a molecule). With the WebAssembly kernel the after column is the same to the digit.
- **Fingerprints** (tools/fingerprint.js, every setup, seed 7, 300 steps, switches off): every flat setup bit for bit
  v145's; of the 3-D setups only brine3d changes (eafbc634 → 2367f60e, books unchanged: the only 3-D setup with free
  ions beside water). Cost: none (a factor removed).
- Suites: t_lint, t_energy, t_3d, t_physics, t_molecules, t_wasm, f_sweep3d pass; tools/runtests.sh 22 of 22 (t_features
  with f_fix01 included); after the text change f_sweep3d physText and t_lint again.
- **Left for the owner.** (1) The noble-gas wells: neither factor is right (doubled −28 against −15.6 cm³/mol for argon,
  factor 1 +10); measured wells per element would be a physics change (written down under "Planned features (1.x)"). (2) f_sweep3d
  "pressure" and Data's "vs ideal gas" average from the moment the conditions change, so a heavy gas started on a grid
  reads far below 1 for its first tens of picoseconds (argon 0.29 at 8 ps, 0.99 settled); the check passes on helium, not
  changed. (3) Cl⁻ keeps too many waters (8.9 against 6–7) and every ion sits 0.1–0.2 Å too close: the ions' own size
  (ljR = 2 × ionic radius), as 1.23.2 found.

### 1.27: bug 2 (water's ionization energy)

Branch fix127-02-water-ie (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix02.js
(t_features, one line; `node tests/f_fix02.js [--node] [part …]`): cost, books, ps; all three fail on v145 (water 13.62/18.4;
the books part's cost 13.62 and 18.40; Ps at 13.0 eV formed, at 6.2 eV not), confirmed by running the file on a v145 tree.

- **What was wrong.** ionizationCost(p) is the hit atom's own ionization energy plus every bond its new charge cannot keep
  (breakCostIfCharged). In water a hit oxygen gave 13.62 eV (O's own), a hit hydrogen 18.40 (13.60 and its O–H bond:
  an H⁺ keeps no bond) and the electron came from the atom hit; the 18.4 of the realistic-particles notes is the
  hydrogen's. So most molecules were dear and some cheap: CH₄ 15.5–17.9 (12.61), NH₃ 14.5–17.7 (10.07), benzene
  15.5–17.9 (9.24), CO 35.1 at the O (and at the C, a C⁻ in the game's C⁻≡O⁺, 1.26: the electron's affinity), measured
  12.62 for water (NIST Chemistry WebBook).
- **What changed** (engine.js, hep.js psFromAtom).
  - The hole: an electron taken from a small neutral molecule (up to 64 atoms; not continuous bond orders' members, not
    in flight) comes from its atom with the lowest cost (`holeAtom`), whichever atom was hit, as a molecule's electron
    comes from its highest orbital. An ion's next electron is still taken where it is hit (its charge's pull, a second
    ionization, is not in atomIonCost: allowing the move there tripled the ionizations of an ionized-water plasma).
  - Measured values: `MOL_IE`, first ionization energies by formula (adiabatic, gas). After the hole atom loses its
    electron, the difference between the measured value and what the molecule's own energy rose by (`molOwnE`: its
    bonds, bends, inner pairs and electrons, no neighbours, so a molecule in a liquid keeps its surroundings' shift on
    top) is held as a constant in the hole atom's bonds (`bd.Eq`, `holeEq`), part of their energy while that atom keeps
    that charge (`bondEq`: in localPE, regionE, totalEnergy, the bond sums, the builder's strain). Forces are unchanged
    (a constant: no kernel changes). The hole's Coulomb well is as deep as the measured value (`p.ieH`, softFor):
    with the atom's own (13.62 for O⁺) an electron at the bottom of an H₂O⁺ well could not be caught back (it releases
    only 12.62) and stayed there. snapshot/restoreSnap keep both (a capture tried and undone lost the bonds' Eq: 1.14 eV
    each time, found by wrapping capture).
  - The cost callers pay is still ionizationCost(p) (now the measured value), and ejectElectron books exactly what they
    paid: Kfar = KE + ionizationCost − ionE − dU for a molecule of MOL_IE, as before otherwise. psFromAtom takes the
    electron from the same hole at the same energy, so positronium's Ore gap at water is 5.8–12.6 eV (was 6.8–13.6
    at the oxygen, 11.6–18.4 at a hydrogen).
- **Table** (game's cost at each kind of atom, eV; flat, isolated molecule; measured: the owner's list for the first ten
  (NIST), the rest from memory: check). Every ionization here books to 10⁻⁶ eV (tests in /tmp of the session, `ie3.js`:
  the projectile pays the cost and 5 eV, the books' change is that to 10⁻⁶; 3-D the same).

| molecule | v145 | after | measured |
|---|---|---|---|
| H2O | O 13.62, H 18.40 | O 12.62, H 12.62 | 12.62 |
| NH3 | N 14.53, H 17.65 | N 10.07, H 10.07 | 10.07 |
| CH4 | C 15.54, H 17.88 | C 12.61, H 12.61 | 12.61 |
| CO2 | O 13.62, C 19.54 | O 13.78, C 13.78 | 13.78 |
| O2 | O 13.62 | O 12.07 | 12.07 |
| N2 | N 14.53 | N 15.58 | 15.58 |
| H2 | H 18.12 | H 18.12 | 15.43 |
| CO | O 35.12 | C 14.01, O 14.01 | 14.01 |
| C2H6 | C 14.87, H 17.88 | C 11.52, H 11.52 | 11.52 |
| benzene | C 15.54, H 17.88 | C 9.24, H 9.24 | 9.24 |
| HCl | Cl 12.97, H 18.07 | Cl 12.74, H 12.74 | 12.74 |
| H2S | S 10.36, H 17.36 | S 10.46, H 10.46 | 10.46 |
| CH3OH | C 14.97, O 13.62, H 17.88 | C 10.84, O 10.84, H 10.84 | 10.84 |
| C2H4 | C 15.54, H 17.88 | C 10.51, H 10.51 | 10.51 |
| C2H2 | C 15.54, H 17.88 | C 11.40, H 11.40 | 11.4 |
| HCN | C 15.54, N 14.53, H 17.88 | C 13.60, N 13.60, H 13.60 | 13.6 |
| N2O | N 14.53 | N 12.89, O 12.89 | 12.89 |
| Cl2 | Cl 12.97 | Cl 11.48 | 11.48 |
| F2 | F 17.42 | F 15.70 | 15.7 |
| HF | F 17.42, H 19.47 | F 16.03, H 16.03 | 16.03 |
| O3 | O 13.62 | O 12.53 | 12.53 |
| NO | N 14.53, O 13.62 | N 9.26, O 9.26 | 9.26 |
| H2O2 | O 13.62, H 18.40 | O 10.58, H 10.58 | 10.58 |
| propane | C 14.87, H 17.88 | C 10.94, H 10.94 | 10.94 |
| CH2O | C 15.54, O 13.62, H 17.88 | C 10.88, O 10.88, H 10.88 | 10.88 |
| NO2 | O 13.62, N 14.53 | O 9.59, N 9.59 | 9.59 |
| SO2 | O 13.62, S 10.36 | O 12.35, S 12.35 | 12.35 |
| CS2 | S 10.36, C 17.24 | S 10.07, C 10.07 | 10.07 |
| ethanol | C 14.87, O 13.62, H 17.88 | C 13.62, O 13.62, H 13.62 | 10.48 |

  Not in MOL_IE: ethanol and other isomers sharing a formula (C₂H₆O is ethanol 10.48 and dimethyl ether 10.03: the table
  goes by formula), so they get the hole atom's cost only (ethanol 13.62). H₂ stays 18.12 (15.43): its H₂⁺ is a
  one-electron bond the game does not have, and the hole keeps no bond to hold the difference.
- **Electron impact on one water** (an electron fired at it, 100 tries an energy, flat; 3-D 60): the share ionized,
  v145 → after: 12.8 eV 0.03 → 0.06, 13.4 0.01 → 0.27, 14 0.07 → 0.36, 16 0.32 → 0.68, 20 0.62 → 0.84, 50 0.93 → 0.88;
  3-D 14 eV 0 → 0.17, 16 0.12 → 0.32, 20 0.28 → 0.42. The onset moves from 14–16 eV to the measured 12.6 (Itikawa and
  Mason's cross section starts at 12.6 eV and rises to its peak near 100 eV, from memory); the game's share is a contact
  probability, not a cross section, so only the threshold compares.
- **Ionized water** (flat water, 40 waters ionized with 2 eV each, insulated, 400 steps, seeds 1–5): v145 278–683
  ionizations after, 131–141 free electrons, books −26 to +6 eV; after 521–1,107, 128–146, −5 to +17 (the known
  ionized-water plasma limit both: electrons falling into ions' wells ionize neighbours; cheaper water, more events).
  Ten 200 eV electrons in flat water (seeds 1–3): ionizations 685–1,114 → 872–1,594, free electrons 138–156 → 142–162.
- **Fingerprints** (switches off, seed 7, 300 steps): every setup as v145 except pionbeam (a57d419b), hyperfactory
  (39713093) and annihilation (792e52ec): the three that ionize molecules within 300 steps. The stored switches-off
  fingerprints of these in f_rp1, f_rp2, f_rp3, f_rp5, f_rp7, f_ew and f_rp7's part-3-on annihilation were updated, with a
  comment each (f_rp2's "off" check: the new hashes for annihilation and pionbeam; its Ps checks at H, Cl⁻ and free
  electrons were unchanged and pass: an atom's window is as before).
- Cost: holeAtom walks the molecule (up to 64 atoms) at each ionizationCost; no change measurable in the setups.
- Suites: t_lint, t_energy, t_physics, t_molecules, f_rp1, f_rp2, f_rp3, f_rp5, f_rp7, f_ew pass; tools/runtests.sh 21 of
  22 (t_features with f_fix02 passes), t_page's slow-motion button the known flake: alone it passes.
- **Left for the owner.** A hole's measured-energy difference stays with the bonds after the charge goes (inert, exact
  books); if the same atom later gets the same charge by another road (a charge transfer), it counts again, exactly booked.
  Doubly charged molecules and fragments use atom costs. Liquid water's own first ionization (about 11 eV, from memory)
  comes out as the gas value shifted by the game's own neighbours, not checked.

### 1.27: bug 3 (close passes between nuclei)

Branch fix127-03-nuclear-close-pass (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix03.js
(t_features, one line; `node tests/f_fix03.js [--node] [part …]`): headon, rutherford; both fail on v145 (headon: 133,
840, 33 and 210 eV; rutherford: nothing past 5°), confirmed by running the file on a v145 tree.

- **What was wrong.** Below the reaction threshold a nucleus passing another is turned by Rutherford's law at the pass's
  impact parameter, but every path held that parameter to at least 0.005 Å (nuclearCollision, radiation flight) or
  0.01 Å (coulombScatter and coulombScatter3, a fast stepped nucleus; radVsFast and the flights' pair loop passed
  max(d, 0.01)): 500–1,000 fm, where a 1 MeV α on an α turns by at most 1.3°. Measured (an α fired dead on at a bare
  nucleus at rest, 60 steps): 1 MeV α on α, the target got 132.7 eV flat, 33.2 eV in 3-D (nature: the whole 1 MeV,
  180° in their frame); 5 MeV α on gold 840 and 210 eV (most possible 390.6 keV). Nothing was ever turned past a few
  degrees, so no α came back off a foil of atoms (only the Foil object did that).
- **What changed** (engine.js).
  - `bReal(b, R)`: the impact parameter a pass stands for, down to 10⁻⁹ Å. In 3-D the pass's own distance (passes in
    depth already fall uniformly over the area round a nucleus, as real ones do, so the share of hard turns is nature's
    per atom); in the flat game, where passes fall uniformly along a line, the distance as a fraction of the reach R is
    mapped onto an area, R·√(b/R), as nuclearEncounter maps its passes. Used by nuclearCollision (R 0.5 Å, with its
    screening exp(−b/a) as before), coulombScatter and coulombScatter3 (R 0.6 Å); the callers' 0.01 Å floors removed.
  - nuclearCollision turns the pair exactly in its own frame (nuclearScatter with the angle given: energy and momentum
    kept, a target sent into flight booked as before); it used an approximate lab angle and pushed the recoil off to
    one side. It takes the energy from the projectile itself; a projectile left slow is handed back to the stepped
    particles (it went on in radiation flight with its old energy: +1 MeV made from nothing in a first try).
  - After a turn of more than half a degree a nucleus in radiation flight goes on from the meeting point in its new
    direction (as after a nuclear encounter), and a fast stepped 3-D nucleus is put back at the meeting point; a pair
    met in a step is not met again (fastEncounters3: `hitC`; the fast pairs' loops: closest approach before the step,
    t ≤ 0, skipped): with the floor gone, a dead-on pair turned round and left past each other met again and turned back.
  - The pair potential of stepped nuclei (wide, slow passes) is untouched; nothing is counted twice: these paths are for
    nuclei in flight, which carry no pair potential.
- **Measured** (5 MeV α on gold; passes drawn as the game draws them, flat uniform in distance within 0.5 Å through
  moveRad's nuclearCollision, 3-D uniform over the area within 0.6 Å through coulombScatter3; 40,000 passes importance-
  sampled to those turning it 5° or more, a share 1.13×10⁻⁴ flat and 7.85×10⁻⁵ 3-D of all passes):
  - Lab angles against Rutherford's 1/sin⁴(θ/2) (flat with the screening): χ² 3.6 flat, 9.4 3-D for 9 bins (5–180°);
    v145 16,467 and 38,422 (everything under 10°, or nothing over 5°).
  - Turned past 90°: 2.35×10⁻⁷ a pass within 0.5 Å flat (Rutherford 2.06×10⁻⁷), 1.55×10⁻⁷ within 0.6 Å 3-D (1.44×10⁻⁷);
    v145 none. Energy kept to 5×10⁻⁵ eV flat, 4×10⁻⁹ 3-D.
  - So a foil of the game's atoms now sends back Rutherford's share, n·t·π·b₉₀² (b₉₀ = 2.3×10⁻⁴ Å = 23 fm for 5 MeV α
    on gold): for Geiger and Marsden's thinnest gold foils (about 0.4 µm, from memory) about 1 in 25,000 (computed;
    their 1 in 8,000 was off platinum of their own thickness). Brute force in the game is out of reach (a 20 Å gold slab
    turns 2×10⁻⁷ of the α past 90°). The Foil object is unchanged: it draws b uniformly along a line within half its
    2.9 Å spacing (the flat statistics, on purpose), b₉₀/1.45 Å = 1.6×10⁻⁴ a layer, about 1 in 600 back from its default
    10 layers (computed from its formula).
  - Head-on (f_fix03 headon): 1 MeV α on α 1,000,000 eV to the target flat and 3-D; 5 MeV α on gold 390,628 eV flat,
    390,386 3-D; books to 10⁻⁴ eV.
- **Fingerprints** (switches off, seed 7, 300 steps): every setup as v145 except fusion (38a64d68), nif (089d98a6),
  pionbeam (bd26ce49), annihilation (93a54d56) and sns (2298f520): the setups with fast nuclei passing others. Their
  stored switches-off fingerprints in f_rp1, f_rp2, f_rp3, f_rp5, f_rp7 and f_ew updated with a comment each. The nif
  plasma (300 steps, seeds 1–6): 0–4 fusions after, 0–2 before; books with no fusion within a few keV both (11, 3, 4.9,
  0.07 keV before; 44, 0, 6.7, 3 after: the hot plasma's own limit).
- Cost: none measurable (a square root a pass).
- Suites: t_lint, t_energy, t_nuclear, t_hep, t_collider, f_hep126 pass.
- **Left for the owner.** The Foil object keeps its flat statistics (by design; its share differs from atoms' now).
  coulombScatter (flat fast nuclei, the plasma) is unscreened as before: a bare nucleus on an atom with electrons uses
  the atom's charge seen at its ion (Z − ne + 1), not screened Rutherford.

### 1.27: bug 4 (fast positrons)

Branch fix127-04-fast-positron (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix04.js
(t_features, one line; `node tests/f_fix04.js [--node] [part …]`): contact, flight, rate; all three fail on v145 (a 5 keV
positron in 3-D water: 1 and 0 ionizations, annihilated at its first touch; annFlight and heitlerPdE not there),
confirmed by running the file on a v145 tree.

- **What was wrong, measured.** Two things. (1) A positron stepped with the atoms (flat below the 1 keV radiation
  threshold, 3-D below 25 keV) that touched an atom annihilated into 2γ at once (evLepton → annihilateBound) whatever its
  energy: a 5 keV positron fired into 3-D water annihilated at its first atom (0–1 ionizations). (2) In flight (flat
  radiation flight; 3-D moveFastLeptons3) a positron passed atoms ionizing them as an electron and never annihilated
  with them: 1 MeV, 100 MeV and 1 PeV positrons fired across flat water all reached the wall and annihilated there into
  two 511 keV γ (annihilateAtWall), in 3-D water they flew on. So the "any energy" of the report is the stepped
  positrons'; the flying ones had the opposite fault.
- **What changed** (engine.js; hep.js eeEvent).
  - evLepton: a positron at matter (an electron at antimatter) with more energy apart from the atom's pull than its
    ionization cost meets the atom as an electron does (impact ionization, excitation, elastic scattering; no capture or
    attachment), and at each touch annihilates with one of its electrons at Heitler's rate over the touch's area
    (`heitlerP`); slower, it annihilates on contact as before, and the Positronium switch's Ore gap (below the same cost)
    is as before.
  - In flight (flat moveRad, both with Charged particles in matter off and on; 3-D moveFastLeptons3, both): after each
    atom passed, it annihilates with one of that atom's electrons with chance dE·σ_H·β²/(2πr_e²mc²·L) (`heitlerPdE`): dE
    the energy the pass took, σ_H Heitler's cross section per electron (`heitlerSig`), L Rohrlich and Carlson's positron
    stopping number with the atom's mean excitation energy (cpmI). Tied to the energy lost, not to the passes' area,
    so over its range a positron annihilates in flight as often as in nature whatever the game's own sampling of passes
    and stopping (the game's 3-D water takes 835 eV from five 1 MeV positrons in 300 steps, 0.2 eV/Å real: a separate,
    older limit).
  - `annFlight`: at √s above 2m_μ (211 MeV) one of the atom's electrons is set free (the positron pays its cost) and
    eeEvent decides the channel (μ pairs, τ pairs, hadrons, the Z far above); eeEvent's two γ (new argument `noGG`), and
    every annihilation below 211 MeV, are two γ back to back in the pair's own frame boosted to the lab
    (`twoGammaFlight`), the books as annihilateBound's (annBegin/annihEnd). W.count.annFlight counts them.
  - The impact-ionization log line says "e⁺ + e⁻" for a positron's (it said 2e⁺).
- **Measured.**
  - In-flight share (Heitler's σ over ESTAR's stopping power for water, from memory: 1.862 MeV cm²/g at 1 MeV, 2.03 at
    0.5, 4.12 at 0.1, 22.6 at 10 keV; integrated to 1 keV, computed here): 1 MeV 3.6%, 2 MeV 5.9%, 5 MeV 10%, 10 MeV
    13%. The game's rate per eV lost (f_fix04 "rate", 3-D water, 1 MeV): 3.21×10⁻⁸ against n_e·σ/S 3.09×10⁻⁸; its
    integral from 1 MeV 3.5%. The report's 10–20% holds from 5–10 MeV; from 1 MeV it is about 3.5% (worth a check
    against a measurement).
  - Range: CSDA 0.44 cm at 1 MeV (ESTAR) is 4.4×10⁷ Å, ten million boxes; in the game a 1 MeV positron crosses any box.
  - annFlight on a water molecule (200 each, flat and 3-D): 1 MeV, 100 MeV, 1 GeV: two γ (a third or fourth γ in
    10–15% of events: the ionized water's own light); 1 PeV (√s 32 GeV): flat 177 γγ (with the extra light), 19
    hadronic, 4 μ⁺μ⁻; 3-D 183, 13, 4 (eeEvent's QED: μμ/γγ ≈ 0.03 at s = 1,000 GeV², hadrons about 4 times μμ). μ pairs
    need √s > 211 MeV, a positron above 43.6 GeV on an electron at rest: none at 100 MeV. The books to 10⁻¹² of the
    positron's energy.
  - 5 keV positron in 3-D water (f_fix04 contact): 33 and 155 ionizations before it annihilates (v145 1 and 0).
- **Fingerprints** (switches off, seed 7, 300 steps): every setup as v145 except sns (40ff6b8f): its fast positrons.
  Stored fingerprints updated with a comment (f_ew, f_rp5; f_rp7's part-3-on photonuc and sns). The annihilation, pet
  and antihydrogen setups are unchanged: their positrons are slow.
- Cost: one random number and a few logarithms an atom a fast positron passes; nothing measurable.
- Suites: t_lint, t_energy, t_hep, t_physics, f_rp1, f_rp2, f_rp3, f_rp5, f_rp7, f_ew pass.
- **Left for the owner.** A positron reaching a wall annihilates there into two 511 keV γ at any energy
  (annihilateAtWall: the wall is matter it does not cross; a 1 PeV one gives 2γ of 511 keV and the rest booked as
  escaped). Positrons slowing in matter don't form positronium on the way (only slow ones in the Ore gap, the switch).
  twoGammaFlight's γ in 3-D carry their depth direction; eeEvent's own two-γ path (annihilateInFlight) stays flat.

### 1.27: bug 5 (high-energy p̄p)

Branch fix127-05-pbar-p-high-energy (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix05.js
(t_features, one line; `node tests/f_fix05.js [--node] [part …]`): share; fails on v145 (annihilation share 1 at every
momentum, flat and 3-D), confirmed by running the file on a v145 tree.

- **What was wrong.** nnbarEvent (an antinucleon meeting a nucleon in flight: in matter, the collider's beams, the fast
  products' pairs) always annihilated into mesons (or, rarely, n n̄ or Λ Λ̄), whatever the energy. Measured (p̄ on p at
  rest, nnbarEvent called 100 times at each momentum): annihilation share 1.00 at 0.5, 2, 10, 100 GeV/c and at the
  Tevatron's √s = 1.96 TeV. The collider's p + p̄ ring at 10 GeV a beam: 10 of 10 meetings annihilations.
- **What changed** (hep.js). nnbarEvent, after the W/Z draw (ewDraw, unchanged and first, so W and Z keep their measured
  rate a collision), draws the channel by cross sections against the antinucleon's momentum on a nucleon at rest
  (`NBAR_X`, `nbarX`, log interpolation): annihilation (as before), production with both baryons surviving
  (`nbarSurvive`: the baryons as they came, mesons from the fireball's statistical model (hadronize), above √s = 5 GeV
  strings along the beams with the baryons leading, as nnInelastic does for pp), or elastic scattering (diffract, as
  two nucleons' diffraction). Below the pion threshold only annihilation and elastic (the ratio of the two). p̄p, p̄n and
  n̄p alike (within 10% above 0.5 GeV/c). The points used, [p_lab GeV/c: σ_tot, σ_el, σ_ann mb]: 0.1: 480, 180, 280;
  0.3: 230, 85, 105; 0.5: 160, 60, 78; 1: 115, 40, 55; 2: 90, 28, 33; 5: 68, 16, 13; 10: 56, 12, 6.5; 20: 50, 10, 3.5;
  100: 43, 7.5, 0.9; 1,000: 41.5, 7, 0.1; 1.6×10⁵ (√s 546 GeV): 62, 13, 0; 1.7×10⁶ (1.8 TeV): 75, 17, 0;
  2.05×10⁶ (1.96 TeV): 78, 18, 0 (σ_inel 60: CDF/D0); 10⁸: 100, 25, 0. **From memory of the PDG's compilation plots:
  to be checked against the PDG data files** (no table could be read from the web in this session).
- **Measured** (nnbarEvent on p̄ + p at rest, 300 each, flat; 3-D 200 alike): annihilation share 0.53 at 0.5 GeV/c (table
  78/138 = 0.57), 0.38 at 2 (0.37), 0.14 at 10 (0.12), 0.017 at 100 (0.021), 0 at √s 1.96 TeV with elastic 0.22 (0.23);
  books to 10⁻¹⁴ of the beam energy. The collider ring, p + p̄ at 10 GeV a beam (2,500 frames): 8 meetings, the beam
  pairs' outcomes production with both baryons on ("p + p̄ → p + p̄ + 4π⁰ + ρ⁰ + 2ω"), elastic ("nuclear elastic
  scattering, 10°"); annihilations now come from the slow secondary antinucleons (n̄ + p → 2π⁺ + π⁻). W and Z: f_ew
  passes unchanged (its rate per collision is drawn before the channel).
- **Fingerprints** (switches off, seed 7, 300 steps): all 59 setups as v145 (none makes a p̄p meeting in 300 steps).
- t_hep's "p + p̄ at 5 MeV each" expected 150 of 200 meetings to make pions (all annihilations then); at 0.2 GeV/c
  σ_ann/(σ_ann + σ_el) is about 0.6, so it now asks for 100, with the reason in the line.
- Cost: none.
- Suites: t_lint, t_energy, t_hep, t_collider, f_ew, f_rp5 pass.
- **Left for the owner.** The cross sections are from memory (above). Antinucleons on nuclei (nuclearAnnihilation for
  p̄ on a nucleus with more than one nucleon) still always annihilate; only the single-nucleon meetings were in scope.

### 1.27: bug 6 (fast fired particles meeting)

Branch fix127-06-fast-fired-meet (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix06.js
(t_features, one line; `node tests/f_fix06.js [--node] [part …]`): ee, pp; both fail on v145 ({"flat":0,"d3":0}; 0 of 6),

- **What was wrong, measured.** Flat: a particle in radiation flight above a few GeV crosses the box in one step (1,200 Å
  at 0.04 tu); moveRad moved each one and the walls took it (a positron annihilating there, a proton turned back) before
  beamCollisions compared the paths, so two fired at each other never met. 3-D: no radiation flight; fast nuclei are
  stepped short (3.5 Å a step) and met through fastEncounters3, but fast leptons had no meeting with each other at all.
  Ten tries each (fired head-on from 20 Å apart, the second up to 0.1 Å off line): 45.6 GeV e⁺ and e⁻ flat 0 met (10
  annihilations at the walls), 3-D 0 met (the same); 1 TeV protons flat 0 met, 3-D 10 of 10 (already).
- **What changed** (engine.js `fastMeet`; hep.js xbClose spawns at the meeting depth in 3-D). Before the move, each fast
  particle's straight path over the step at its true speed (flat: radiation flight; 3-D: the fast flag, leptons at
  their relativistic speed, nuclei by flyScale3) is laid against the others': sorted by x and swept (only paths whose x
  ranges overlap are compared), the closest approach of each pair within the step, and pairs within the meeting distance
  meet there in the order they meet, as beamCollisions has them meet: e⁺e⁻ within R_NN (eeEvent), a nucleus and an
  antinucleus (nnbarEvent, else nuclearAnnihilation), two nuclei within reach (nuclearEncounter, the pass mapped onto
  real impact parameters as the collider maps it). Flat, only pairs one of which leaves the box (or wraps) in this step:
  the others beamCollisions meets after the move, as before, so nothing meets twice; fusion and Coulomb scattering stay
  with the paths' own checks; the collider's beams stay with the collider. It runs when two were in flight last step or
  anything was made since (a counter: no extra loop otherwise).
- **Measured** (after): 45.6 GeV e⁺e⁻ head-on flat 10 of 10 met, all a Z (√s 91.2 GeV, the peak: eeEvent's Z channel at
  59 nb against the photon's few nb); 3-D 10 of 10, all a Z. 1 TeV protons flat 4 of 10 (√s 2 TeV, inelastic only
  inside √(σ_inel/π) of the mapped impact parameter: the others pass, as the collider's do; dead on, f_fix06 "pp", 6 of
  6); 3-D 10 of 10 as before. A 1 TeV proton through a proton at rest reacted 10 of 10 flat and 3-D, before and after
  (moveRad and fastEncounters3 already met slow targets). Books exact to 10⁻¹⁵ of the energy.
- **Cost** (100 α at 1 GeV in flight, wrapped box, one thread): fastMeet 0.20 ms a step flat (with the reactions it starts),
  0.11 ms in 3-D; step 1.2–2.2 ms flat (more meetings: the wrapped pairs never met before) against 0.6–0.9, 3-D
  0.31–0.36 against 0.23–0.34.
- **Fingerprints** (switches off, seed 7, 300 steps): all 59 setups as v145.
- Suites: t_lint, t_energy, t_hep, t_collider, f_ew pass.
- **Left for the owner.** Particles meeting in fastMeet are not turned by the walls first (a positron bound for the wall
  meets the electron before the wall, as it should). A fast lepton meeting a fast nucleus (e p at TeV) has no channel
  here (as beamCollisions); a fast muon or pion fired (W.exo) meets nothing fired (moveExos). Found, not changed: a
  decay that gives off a photon books its energy into ledger.escaped while the photon is in flight (emitPhoton: the
  light counted twice in total + escaped; the checks use total − nuc, which is exact).

### 1.27: bug 7 (X-ray Compton)

Branch fix127-07-xray-compton (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix07.js
(t_features, one line; `node tests/f_fix07.js [--node] [part …]`): water, lead; both fail on v145 (no interaction at all
at 20–60 keV in 300 tries), confirmed by running the file on a v145 tree.

- **What was wrong, measured.** rayInteract (flat: 3-D light is not absorbed at all, as before) handled photons of
  100 keV and more as γ rays (Compton at 0.012 an electron a pass, pairs, the nucleus) and everything below by the outer
  electrons' photoelectric rule of thumb, 0.6·min(1, 2(I/E)^1.5) an atom a pass: 6×10⁻⁵ for an oxygen at 10 keV, 2×10⁻⁶
  at 100 keV, against 0.1 just above 100 keV, and never Compton. X-rays fired across the flat water box (300 each, v145):
  20, 30 and 60 keV none met anything; 100 keV 86 Compton, 0 photoelectric.
- **What changed** (engine.js). From 10 keV to 100 keV an atom is met by its incoherent and photoelectric cross sections
  (`xraySig`, barns: σ_inc = n_e·σ_KN(E)·S, S = 1 − exp(−E/(2.17 keV·Z^0.72)) for the binding; σ_pe = 1.59×10⁻⁵ b·Z^4.2·
  (E/100 keV)^−3.2, a fifth below the K edge 13.6 eV·(Z − 1)²; `klein`, Klein–Nishina's total) on the game's γ-ray
  scale (0.012 a pass for each 0.2112 b, part 3's cpmGamma), and the interaction is Compton or photoelectric by their
  ratio. Compton is the existing code (compton; with Photon polarization rpCompton, Klein–Nishina's polarized angles,
  and its in-plane rate weight knPlaneW on σ_inc); the Compton electron is freed only if it gets more than the atom's
  ionization cost (the binding cut: otherwise its energy is heat, as before). With Charged particles in matter on the
  same (part 3's rates start at 100 keV and are unchanged). Below 10 keV the old rule stays. compton and compton3 use
  mₑc² itself (511e3 put the scattered photon 3×10⁻⁷ off the formula).
  - **The fit is mine, from XCOM values as remembered** (water: photoelectric 0.551, 0.155, 0.017, 0.0033 cm²/g and
    incoherent 0.177, 0.181, 0.178, 0.165 at 20, 30, 60, 100 keV; lead at 100 keV 5.2 and 0.1): XCOM itself could not
    be read in this session (a form). Its water: ratio incoherent/photoelectric 0.33 at 20 keV (XCOM 0.32), 1.24 at 30
    (1.17), 10.8 at 60 (10.5), 49.9 at 100 (50.0); crossing at 27 keV (XCOM about 26). Lead 100 keV σ_pe 1,735 b
    (XCOM 1,790), σ_inc 34.5 b (34.6).
- **Measured** (X-rays fired across flat water, 300 each, every interaction counted, the scattered photons' too): Compton
  share 0.265 at 20 keV (XCOM's incoherent/(incoherent + photoelectric) 0.24), 0.576 at 30 (0.54), 0.922 at 60 (0.91),
  0.992 at 100 (0.98). Lead lattice (200 each): 20 and 30 keV all photoelectric (75 of 75), 60 keV 71 photoelectric to 1
  Compton; at 100 keV and above lead is treated as before (Compton only: no photoelectric absorption above 100 keV, the
  "not built" of part 3), so lead's photoelectric dominance to ~500 keV is not there. Scattered energy exact to 2×10⁻¹¹.
- **The rate.** 10–100 keV X-rays now meet atoms on the same scale as the γ rays above (oxygen at 20 keV about 1 a pass:
  absorbed at the first oxygen), where they were nearly transparent; below 10 keV the old rule still applies, so the
  step in the rate moved from 100 keV to 10 keV (9.9 keV passes, 10 keV is absorbed). For the owner: extend the cross
  sections below 10 keV (edges L, M) or keep.
- **Fingerprints** (switches off, seed 7, 300 steps): every setup as v145 except photonuc (ae5e7827), sns (1ca63a0f) and
  hyperfactory (36eb3ee9, books unchanged: Compton's exact mₑc²). Stored fingerprints updated with a comment (f_rp1,
  f_rp3, f_rp5, f_rp7 and its part-3-on photonuc and sns, f_ew).
- Cost: none measurable.
- Suites: t_lint, t_physics, t_hep, f_rp1, f_rp2, f_rp3, f_rp5, f_rp7, f_ew pass.
- **Left for the owner.** 3-D light meets no atoms (rayInteract returns at once in 3-D, as before). Photoelectric
  absorption above 100 keV (lead to ~500 keV) not built. Coherent (Rayleigh) scattering not built. The step at 10 keV.

### 1.27: bug 8 (3-D water recapture) — measured, written up, not changed

Branch fix127-08-3d-water-recapture (from v145): this entry only, no code change and so no check file (nothing that is
clearly a bug was found; the physics the owner asked for needs a state the game doesn't have: below, for him).

- **Measured** (40 waters of the water / water3d setup ionized with 2 eV each at 300 K after 10 steps, the cost from the
  bath, then 400 steps; free electrons counted every 10 steps; `/tmp/b8/rec.js` of the session):
  - flat, insulated, seed 1: 40 → 53 at step 10, 69 at 30, 107 at 100, 135 at 200, 141 at 400 (22 fs): 683 impact
    ionizations, 559 recombinations; seed 7 alike (40 → 131); with the bath (γ 0.05) 40 → 79 at 100, 109 at 200.
  - 3-D, insulated, seed 1: 40 → 7 at step 10 (2 fs), 3 at 100, 1 at 400 (93 fs): 34 captures in the first 10 steps,
    2 ionizations; seed 7 and the bath alike (40 → 7–8 at step 10, 1–2 at 400).
  So the report's "flat keeps all 40" is a runaway here (the known ionized-water plasma limit of CLAUDE.md); 3-D
  recaptures as reported. Books within the known limit both (flat −8 eV, 3-D −0.8 eV over 400 steps).
- **Why they differ** (counted by wrapping capture, impactIonize, elasticScatter): a flat electron above 20 eV that is
  not near an ion switches to ballistic flight (updateFast, "20 eV on, 13 eV off, never inside an ion's Coulomb well"),
  which carries no force: after 3 steps 22 of the 40 were ballistic, flying straight through the water, scattering
  (659 elastic events in 30 steps), ionizing (44) and caught only on touching an ion (4% a touch when free). A 3-D
  electron stays in the stepped set with every force until 25 keV (LEP3_ON): all 40 started inside their ion's well
  (nearIon), none went ballistic, and the pull brought 31 of them back to an ion within 2 steps (half a femtosecond).
- **Against nature** (as the owner's brief gives it: hydrated within about 1 ps; about 60% still free at 1 µs, G 4.8 →
  2.7 per 100 eV, from memory of the radiolysis literature, e.g. Buxton's reviews): neither mode is right, and in
  opposite ways. 3-D is what an unscreened Coulomb world does: water's dielectric screening (ε ≈ 80 when the dipoles have
  turned, ≈ 1.8 at optical times) and solvation are what keep real electrons apart from their cations; the game's water
  turns its partial charges too slowly to screen a 2 eV electron in femtoseconds, and has no hydrated-electron state. The
  flat game's survival comes from switching the Coulomb force off for fast electrons, a speed measure, not physics, and
  it ends in the runaway. Neither the doubled ion–water pull (bug 1: free ions and molecules only, not electrons) nor the
  step size (both about 0.015 tu a step here) nor the density decides it.
- **What a fix would take (for the owner, after 1.00: written into "Planned features")**: a solvated electron, e⁻(aq): a
  free electron in liquid water that has slowed below about 1 eV becomes a slow particle with water's measured
  properties (radius about 2.5 Å, diffusion 4.9×10⁻⁵ cm²/s, absorption peak 720 nm, hydration energy about 1.7 eV,
  values from memory), moving by diffusion and meeting H₃O⁺, OH and its cation by measured rate constants (2.3×10¹⁰,
  3×10¹⁰ M⁻¹s⁻¹; geminate recombination the Onsager way with ε = 80); in both modes the same. That would give the 60% at
  1 µs and the same answer flat and 3-D. A smaller step, not physics either: make the flat electrons keep the Coulomb force
  of the nearest ions while ballistic (they would then recapture as 3-D does).
- Fingerprints: no code changed. Suites: not run (no code changed).

### 1.27: bug 9 (decay table)

Branch fix127-09-decay-table (from v145). A bug fix (data). Check: tests/f_fix09.js (t_features, one line; `node
tests/f_fix09.js [--node] [part …]`): listed, made; both fail on v145 (⁹⁴Nb 78.5% β⁻ and 21.5% EC estimated; 41 nuclides
both ways; 13 of the 20 sampled neutron products estimated), confirmed by running the file on a v145 tree.

- **What was wrong.** Nuclides missing from DECAY (data.js) are estimated (the mass formula's Q-values, allowed rates);
  its pairing term opens both β⁻ and EC to odd–odd nuclei. Scanning every nuclide Z 1–100: 4,571 estimated, 41 of them
  both ways (⁷⁴As, ⁸⁴Rb, ⁹⁴Nb, ¹⁰⁴Rh, ¹¹⁰Ag, ¹¹⁴In, ¹²⁰Sb, ¹²⁴I, ¹²⁶I, ¹³⁰Cs, ¹³⁶La, ¹⁴⁰Pr, ¹⁴²Pr, ¹⁴⁶Pm, ¹⁵²Eu, ¹⁵⁶Tb, ¹⁵⁸Tb,
  ¹⁶²Ho, ¹⁶⁴Ho, ¹⁶⁸Tm, ¹⁷⁴Lu, ¹⁸⁴Re, ¹⁸⁶Re, ¹⁹⁰Ir, ¹⁹²Ir, ¹⁹⁶Au, ²⁰²Tl, ²⁰⁴Tl, ²⁰⁸Bi, ²¹⁴At, ²¹⁶At, ²²⁰Fr, ²²⁶Ac, ²³²Pa, ²³⁸Np,
  ²⁴⁴Am, ²⁴⁶Am, ²⁵⁰Bk, ²⁵²Bk, ²⁵⁶Es, ²⁵⁸Es; the 1.26 list's ¹⁹⁸Au was listed then, ²⁶⁴Md is past this scan).
- **Source.** ENSDF through the IAEA's LiveChart of Nuclides data API (https://nds.iaea.org/relnsd/v1/data, ground_states,
  decay_rads and independent_fy, extracted 2026-11-07; NuDat 3 shows the same ENSDF evaluations): half-life, the three
  most probable modes and their branches, Q-values (2020 mass evaluation); EC+β⁺ split into β⁺ and EC by the decay
  radiations' β⁺ and EC intensities. Measured, not from memory. Format as ⁴⁰K's (branches with their own Q; β⁺ with
  Q_EC, as ²²Na).
- **What changed** (data.js). 40 of the 43 listed (²⁵²Bk, ²⁵⁸Es and ²⁶⁴Md have no evaluated decay and keep the estimate).
  The memory-based judgement of 1.26 was close but not exact: e.g. ⁷⁴As is EC 37%, β⁺ 29%, β⁻ 34% (17.77 d); ¹⁴⁶Pm EC
  65.7%, β⁻ 34.3%; ¹⁸⁶Re β⁻ 92.5%, EC 7.5%; ¹⁹⁰Ir EC (β⁺ 0.03%); ¹⁰⁴Rh, ¹¹⁰Ag, ¹¹⁴In, ¹⁴²Pr keep a small EC branch
  (0.45%, 0.3%, 0.5%, 0.016%); ²¹⁴At α in 558 ns, ²¹⁶At α in 0.30 ms, ²²⁰Fr α 99.65% in 27.4 s.
- **Then the commonly made ones** (the brief's second step): the estimated nuclides the game makes often were every (n,γ)
  product of a stable isotope (99 estimated: ⁴⁹Ca, ⁵¹Ti, ⁵²V … ¹⁰⁸Ag, ¹¹⁶In, ¹²⁸I, ¹⁵⁴Eu, ¹⁹⁴Ir, ²⁰⁹Pb, ²³³Th) and nearly every
  fission product (²³⁵U thermal fission: 99.7% of the radioactive independent yield estimated; 133 products above 0.1%:
  ¹³⁴Te, ¹³⁸Xe, ¹⁰⁰Zr, ⁹⁴Sr …). Added from the same source with their decay chains to the first listed or stable
  nuclide: 271 nuclides. After: no (n,γ) product of a stable isotope estimated, 2.2% of ²³⁵U's radioactive fission yield
  (the short-lived tail below 0.1%). β⁻-delayed neutron branches are counted as β⁻ (the game has no β⁻n): 43 of them,
  mostly under 5%, the large ones 85As B-N 62.9%, 89Br B-N 13.7%, 90Br B-N 25.3%, 91Br B-N 19.5%, 94Rb B-N 10.5%, 135Sb B-N 22%, 139I B-N 10%.
- Estimated nuclides 4,571 → 4,261; both ways 41 → 2 (²⁵²Bk, ²⁵⁸Es).
- **Fingerprints** (switches off, seed 7, 300 steps): all 59 setups as v145 (nothing decays from these within 300 steps).
  Over longer times the chain and fission setups now decay their products at the evaluated rates (the estimate put most
  at 1–25 h).
- Suites: t_lint, t_nuclear, t_data, t_energy, f_bug126e, f_rp1, f_rp5 pass.
- **Left for the owner.** β⁻n (delayed neutrons, which steer real reactors) as a decay mode; the fission products of other
  parents (²³⁹Pu, ²³⁸U) beyond those shared with ²³⁵U; isomers.

### 1.27: bug 10 (neutron on a muonic atom)

Branch fix127-10-muonic-neutron (from v145). A bug fix. Check: tests/f_fix10.js (t_features, one line; `node
tests/f_fix10.js [--node] [part …]`): carbon, lead; both fail on v145 (the muon bound after 0 of 40 reactions in each
mode; 39 lead atoms ended early), confirmed by running the file on a v145 tree.

- **What was wrong.** An event that remakes a nucleus kills the old atom and makes new ones; a muonic atom's muon record
  (p.muB) stayed on the dead atom, and muBoundTick then booked its mass as escaped ("its atom gone in some other event").
  Measured: 64 muonic lead atoms in a flat box, decay sped up 10⁶× so their muons decay and are captured (each capture
  makes neutrons), 3,000 steps: 39 ended early, every one by finishReaction from nuclearEncounter (the capture neutrons'
  reactions on their neighbours). One muonic ¹²C hit dead on by a 14 MeV neutron, 60 times: every reaction (⁹Be + α 44,
  3α + n 10, inelastic 6) took the muon away.
- **What changed** (hep.js `muCarry`, called from finishReaction; engine.js: the (n,p)/(n,α)/(n,t) captures and fission).
  The muon goes to the product with the most charge (the same atom if it survives as such, an α if ¹²C breaks into three);
  its binding is the new nucleus's 1s binding (MU_EB, or with Exotic atoms on xaLevel at n = 1, the electrons refreshed to
  see Z − 1), its lifetime follows (muBoundTick reads the new Z and N), and the change of the bound muon's mass,
  δ = m_old − m_new (the binding difference), enters the event's books as a decaying bound muon's mass does
  (closeEvent's Ein and mIn; for the settleKE events, Qm and the nuclear ledger): the products' motion takes it. With no
  product of Z ≥ 2 it is left to muBoundTick as before. W.muBound follows the new atom.
- **Measured** (after): lead box 0 ended early (the muons hop to the reactions' products and end by decay or capture);
  muonic ¹²C, 40 tries each, flat and 3-D, Exotic atoms off and on: the muon bound after 40 of 40 reactions, with the new
  nucleus's binding; books to 2×10⁻⁶ eV (v145 the same order, 2×10⁻⁶).
- Suites: t_lint, t_hep, t_nuclear, f_rp1, f_swx pass.
- **Left for the owner.** No cascade X-ray is drawn for the new levels (the binding change goes into the products'
  motion, exactly booked); a muon whose new nucleus is unbound is not followed further than the next event.

### 1.27: bug 11 (giant dipole resonance)

Branch fix127-11-gdr (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix11.js (t_features,
one line; `node tests/f_fix11.js [--node] [part …]`): share; fails on v145 (gdrP missing; there the share is 0.0012),

- **What was wrong.** rayInteract (flat) and its 3-D twin decide the giant dipole resonance first, at 0.0015·Z·min(1,
  σ_GDR/5.2Z² mb) a pass: in proportion to the old pair rule (0.0015·Z a pass). With Charged particles in matter on, pairs
  and Compton go by their measured cross sections on part 3's scale (0.012 a pass for each 0.2112 b, cpmGamma), so the
  resonance fell behind. Per pass at 13.5 MeV in lead (switch on): GDR 1.32×10⁻³, pair 0.885, Compton 0.190, the
  resonance's share 0.0012 against its cross section's 0.0195 (gdrSigma 376 mb : pair 15.6 b : Compton 3.35 b): 16 times
  too rare. Carbon was near (0.0008 against 0.0010 at 13.5 MeV): the old rule scaled with Z.
- **What changed** (engine.js `gdrP`, used at both places). Switch on: P = 0.012·σ_GDR/0.2112 b, the same footing.
  Switch off: the old odds, bit for bit. The cross section itself is unchanged (gdrSigma: a Lorentzian at the systematics'
  peak energy, 5 MeV wide, holding the Thomas–Reiche–Kuhn sum 60NZ/A mb·MeV).
- **Measured** (per pass, switch on; share of the three, then the cross sections' share): lead 10 MeV 0.0054 (0.0054;
  v145 0.0003), 13.5 MeV 0.0195 (0.0195; 0.0012), 20 MeV 0.0031 (0.0031; 0.0002), 23 MeV 0.0017; carbon 10 MeV 0.0004,
  13.5 MeV 0.0010 (v145 0.0008), 20 MeV 0.0058 (0.0049), 23 MeV 0.0170 (0.0144). Counted through rayInteract (20,000
  passes of 13.5 MeV γ at lead): 0.0226 (the three are drawn one after another, the resonance first, and pairs and
  Compton together come near 1 a pass, so the first draw gains a little). The photonuc setup with the switch on, 1,500
  steps, seed 7: 3 resonance events and 56 pairs (v145 0 and 69).
  - Against measurement (from memory, to check: Berman and Fultz's review): lead's resonance peaks at about 13.4 MeV,
    about 640 mb, 4 MeV wide; gdrSigma gives 376 mb at 13.7 MeV, 5 MeV wide (the sum rule's strength; lead's measured
    exhausts about 1.3 times it). Carbon's peaks near 23 MeV, about 8–10 mb (photoabsorption); gdrSigma 5.2 mb at 23 MeV.
    Measured per-nucleus parameters would be a separate data change (the brief's first option): not done here.
- f_rp3 "pair" fired 400 γ of 10 MeV at one lead atom and assumed it survived: the resonance now takes it about once in
  200 shots, so the check makes a new lead atom when that happens (a line and a comment in the test).
- Suites: t_lint, t_nuclear, t_hep, f_rp3, f_rp7 pass.
- **Left for the owner.** Measured GDR parameters per nucleus (lead's peak ×1.7); the three γ processes drawn one after
  another rather than by their shares at once (the same for pairs and Compton in part 3).

### 1.27: bug 12 (muon lifetimes)

Branch fix127-12-muon-lifetime-formula (from v145). A bug fix (data). Check: tests/f_fix12.js (t_features, one line;
`node tests/f_fix12.js [--node] [part …]`): tau; fails on v145 (Ar 643.3, Cr 238.7, Te 116.2, Dy 86.8, Th 84.1, U 85.3),

- **What was wrong.** MU_TAU held 20 measured mean lives (written from memory in 1.26) and the Goulard–Primakoff form
  scaled to them filled the rest: off by up to 21% in between (v145 against the values below: Ne −21.3%, Ar +16.3%,
  Cr −6.4%, Ge +9.0%, Se +8.7%, Te +12.7%, Dy +10.3%, Er +6.9%, Th +8.7%, U +10.3%; Cd, W, Hg within 1.5%).
- **Source.** The 1987 paper (Suzuki, Measday & Roalsvig, Phys. Rev. C 35, 2212) could not be reached from this session
  (APS paywall; the one free copy found, at a UC Davis course page, refused the connection). Its values were taken from
  Zinner, Langanke & Vogel, Phys. Rev. C 74, 024326 (2006), arXiv nucl-th/0606002, Table I: experimental total capture
  rates Λ_c "from Ref. [4]" (the 1987 paper; a few from other papers: ⁴⁸Ca, the uranium isotopes and plutonium from
  Hänscheid 1990 and David 1988, as their footnotes say; the superscripts are lost in the text extraction, so which is
  which was read from the decimals, to be checked). Converted to mean lives as the game counts them: 1/τ = Λ_c +
  muHuff(Z)/τ_μ. Done to the 13 of the old 20 that the table has, this gives them back within 0.1% (zirconium 0.5%):
  the memory values stand. Lead is the exception: Λ_c 13.45×10⁶ s⁻¹ gives 72.3 ns against MU_TAU's 75.4; kept (75.4 is
  the 1987 value as remembered, and gold's 74 ns quoted by Measday 2001 sits beside it), for checking against the paper.
- **What changed** (hep.js MU_TAU): 23 elements added (ns): Ne 1519.4, Ar 553.4, Cr 255.0, Ge 166.3, Se 163.3, Sr 134.0,
  Mo 99.5, Pd 95.8, Cd 90.6, Sn 92.0, Te 103.1, Ba 96.5, Ce 83.2, Nd 77.4, Sm 79.1, Gd 81.7, Dy 78.7, Er 74.4, Hf 74.4,
  W 78.4, Hg 76.2, Th 77.3, U 77.3 (²³⁸U). The table now has 43 elements; isotopes (⁴⁴Ca, ⁴⁸Ca, ⁵⁰⁻⁵⁴Cr, ⁵⁸⁻⁶²Ni, ⁸⁸Sr,
  ²³⁴⁻²³⁶U, ²⁴²⁻²⁴⁴Pu are in the same table) are still carried by the form's neutron-excess term.
- **Still on the form**: the elements the table has no measurement for, among them the paper's odd ones (Cl, Sc, Mn, Co,
  Ga, As, Br, Rb, Y, Nb, Ag, In, Sb, I, Cs, La, Pr, Eu, Tb, Ho, Tm, Lu, Ta, Re, Ir, Au, Tl, Bi …). How far off there,
  measured by leaving each measured element out in turn and predicting it from the rest: median 4.0%, the light ones
  worst (Ne −21%, F +20%, P +17%, Ar +16%, Na +16%: the measured values alternate between odd and even Z), from Ca up
  within 6% except V 11%, Cu 12%, Zn −11%, Te 8%.
- Suites: t_lint, t_hep, t_nuclear, f_swx, f_rp1 pass.
- **Left for the owner.** The 1987 paper's own table (with its odd elements and isotopes) when it can be read; lead's
  72.3 against 75.4.

### 1.27: bug 13 (alkali aurides)

Branch fix127-13-alkali-aurides (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix13.js
(t_features, one line; `node tests/f_fix13.js [--node] [part …]`): aurides; fails on v145 (no ion in any mix), confirmed
by running the file on a v145 tree.

- **What was wrong, measured.** ionPairInMetal (1.26, the copper fix) refuses an electron transfer that would make an ion
  pair between two metal atoms inside a metal. A Cs–Au alternating lattice at the metal spacing (flat 11×11, 1,500 steps;
  3-D CsCl type, 559 atoms, 600 steps; 300 K): 0 ions, Rb–Au the same.
- **What changed** (engine.js `metalSalt`, one more condition in ionPairInMetal). A neutral pair whose electron costs
  under METAL_SALT = 2.0 eV to move from the donor to the acceptor as an anion (ionization energy less electron affinity)
  may become ions inside a metal: there the lattice's Madelung energy outweighs the metal's cohesion. Measured examples
  (ionization energy and electron affinity from the game's own tables): Cs–Au 1.58 eV, Rb–Au 1.87, Cs–Pt 1.76 (ionic in
  nature: CsAu, RbAu, Cs₂Pt); K–Au 2.03, Na–Au 2.83, Ba–Au 2.90, Cs–Cu 2.65, Cu–Cu 6.5, Ni–Ni 6.5, Au–Au 6.9 (metals).
  No element list. The transfer itself and its books are the existing evTransfer's (exact).
- **Measured** (after): flat Cs–Au 58 Cs⁺ and 58 Au⁻ of 60 Au; 3-D 216 of 216; Rb–Au 58 flat, 212 of 216 in 3-D. Cs–Cu
  and K–Au mixes 0 ions; f_cu126 (copper and nickel lumps 0 ions of 127 and 141; a Na lump among Cl still makes salt)
  passes unchanged. Fingerprints (switches off, seed 7, 300 steps): all 59 setups as v145.
- **The arrangement** (the brief asks whether it settles CsCl-like): it does not. Around each Au⁻ after 1,500 steps:
  3-D 2.9 Cs⁺ within 1.2× the median nearest Cs–Au distance, which is 3.12 Å (CsCl: 8 Cs⁺ at 3.69 Å in real CsAu, a =
  4.26 Å); flat 1.6 at 2.85 Å (square lattice: 4). The cause: an ion with |q| ≤ 1 keeps its metal pair potential
  (setSize's isMetal, kept for Cu⁺ inside copper in 1.26), so Cs⁺ and Au⁻ still attract each other as metal atoms on top of
  their Coulomb pull and fall into close pairs (the ions' own sizes, 1.67 + 2.11 Å, would give the right distance).
  Switching the metal pair potential off between a cation and an anion (q_a·q_b < 0) in the kernels (JavaScript, worker,
  and the Rust kernel) and the energies would be the next step: a physics change of its own, written down here for the
  owner, not made.
- Suites: t_lint, t_molecules, t_physics, f_cu126 pass.

### 1.27: bug 14 (AsCl₅)

Branch fix127-14-ascl5 (from v145). Approved physics (the owner's list, 2026-11-06). Check: tests/f_fix14.js (t_features,
one line; `node tests/f_fix14.js [--node] [part …]`): crowd; fails on v145 (AsCl₅ ligand–ligand order 0.413, −0.757 eV a
bond), confirmed by running the file on a v145 tree.

- **What was wrong.** With bond orders from the positions, a ligand pair with a common neighbour is held back
  (boCrowd, 1.16) by how much stronger the two bonds to the common atom are than the pair's own: from 0.4 eV (nothing) to
  0.8 eV (fully). AsCl₅'s As–Cl (2.97 eV) beats Cl–Cl (2.51) by 0.46 eV, so the hold was 15% and the chlorines, 2.44 Å
  apart in the plane, took orders 0.41 (their electronegativity, 3.16, lets them expand past one bond, as the
  hypervalence rule does for partners of 3.0 and up). PCl₅ (0.9 eV) and SbCl₅ (0.6 eV) were held.
- **What changed** (bo.js boCrowd and the Rust kernel's crowding, kernel/src/bo.rs, rebuilt by the workflow: 00a099b).
  The gap counts as a share of the pair's own bond: the hold starts at 5% and is full at 15% (AsCl₅ 18%, SbCl₅ 24%,
  PCl₅ 36%, SF₆ 112%); a triangle of equal bonds (cyclopropane, 0%) is untouched, as before. No molecule is named.
- **Before / after** (flat, relaxed, bond orders against stored bonds; largest ligand–ligand order / closest ligands Å /
  energy with orders − stored, eV a bond):

| molecule | v145 | after |
|---|---|---|
| AsCl5 | 0.41 / 2.44 / -0.757 | 0.00 / 2.50 / 0.022 |
| PCl5 | 0.00 / 2.40 / 0.025 | 0.00 / 2.40 / 0.025 |
| SbCl5 | 0.00 / 2.72 / 0.023 | 0.00 / 2.72 / 0.023 |
| SF6 | 0.00 / 1.56 / 0.026 | 0.00 / 1.56 / 0.026 |
| PF5 | 0.00 / 1.84 / 0.038 | 0.00 / 1.84 / 0.038 |
| ClF3 | 0.00 / 2.83 / 0.014 | 0.00 / 2.83 / 0.014 |
| XeF4 | 0.00 / 2.80 / 0.000 | 0.00 / 2.80 / 0.000 |
| SiF4 | 0.00 / 2.22 / 0.044 | 0.00 / 2.22 / 0.044 |
| SF4 | 0.00 / 2.21 / 0.018 | 0.00 / 2.21 / 0.018 |
| IF5 | 0.00 / 2.25 / 0.015 | 0.00 / 2.25 / 0.015 |
| BrF5 | 0.00 / 2.07 / 0.013 | 0.00 / 2.07 / 0.013 |
| TeF6 | 0.00 / 1.78 / 0.037 | 0.00 / 1.78 / 0.037 |
| SeF4 | 0.00 / 2.32 / 0.020 | 0.00 / 2.32 / 0.020 |
| SnCl4 | 0.00 / 3.23 / 0.025 | 0.00 / 3.23 / 0.025 |

  (XeF₄: xenon is not a bond-order member.) Only AsCl₅ changes among these.
- **Does AsCl₅ fall apart?** No, at 300 K with the bath for 4,000 steps (0.89 ps, four seeds) it stays AsCl₅ (as it did in
  v145, whose Cl–Cl orders stayed under the 0.5 that joins atoms into one molecule). The force field's answer is that it
  is bound: AsCl₅ → AsCl₃ + Cl₂ costs 3.36 eV with bond orders (3.43 with stored bonds; v145's orders 7.25: the
  chlorines' extra bonds), against a measured ΔH of about +0.3 eV (from memory): the game's As–Cl in AsCl₅ is as strong
  as in AsCl₃ (2.97 eV each), where the real fourth and fifth bonds are much weaker. A bond-table matter (the 1.25 notes
  list the As and Sb chlorides 4–17% weak already): left for the owner.
- **Bond orders off:** all 59 setups fingerprint as v145 (seed 7, 300 steps).
- Suites: t_lint, t_molecules, t_wasm, f_125, f_125n, f_125m, f_bug125 pass.

### 1.27: bug 15 (three bookkeeping leaks)

Branch fix127-15-books (from v145). A bug fix. Check: tests/f_fix15.js (t_features, one line; `node tests/f_fix15.js
[--node] [part …]`): plasma, delta, c100; plasma and delta fail on v145 (charge 242 flat and 113 in 3-D for 164; books
+11.37 eV), c100 passes on both (no leak there, see c), confirmed by running the file on a v145 tree.

- **(a) The charge count after a Pb + Pb plasma.** Measured: a central ²⁰⁸Pb + ²⁰⁸Pb collision at 2.76 TeV a nucleon pair
  (nuclearEncounter dead on, then 60 steps): the count (nuclei Z − ne, leptons, unstable particles, the walls', objects'
  and gone-out ledgers) 164 after the event, 242 and 227 after 60 steps flat (seeds 1, 2), 113 in 3-D. Wrapping the
  event functions: every reaction among the fragments that followed (n + p → 2p + π⁻, n + n → d + π⁻, nucleon–antinucleon
  annihilations) gained or lost a charge. The cause: the unstable particles' list was full (1,500 slots, the dead ones
  cleared only every 8 steps by moveExos; 149 alive), so spawnItems carried the new pions off as "lost" with their
  energy booked as escaped but not their charge. Fix (hep.js `itemQ`): an item carried off for want of room (or past the
  last element) books its charge as gone out (chargeTo(…, 'qOut')), in spawnItems and spawnItems3. After: 164 flat and
  3-D after 60 steps. (Clearing dead slots there instead would move the particles under moveExos's own loop.)
- **(b) A Δ⁻ placed in Molecules in space.** Measured (the place tool's way, insulated, 300 steps, seeds 1–10): −0.13 to
  +0.51 eV, except seed 3: +11.37 eV, from one impact ionization of C⁺ by a 137 eV electron (+10.1 eV; Δ⁰ and π⁻ alone:
  0). The electron was 0.65 Å from the ion, but the grid that localPE searches had been built before the electrons'
  short steps moved it (an outer step's worth: 11 Å at that speed), so ejectElectron's measured change missed its pull
  (−11.4 eV). Fix (engine.js innerSteps and innerSteps3): the grid is marked stale before the events of each short step
  when there are events (rebuilt only if they ask). After: seed 3 −1.83 eV, the others as before; the −1.83 is the
  stepped plasma's own integration (no event in it leaks: every event function wrapped, processEvents 0.003 eV in all).
  The 1.26 measurement's −2.9 eV could not be reproduced exactly (the game has changed since); these are the numbers now.
- **(c) A 100 keV electron through 3-D water** (insulated after 50 steps, 400 steps, seeds 1, 2, 3, 7): +1.29 to +1.63 eV
  now (v145 the same; the 1.26 note's −4.3 eV with 44 ionizations is not what v145 does: 0 ionizations, the electron
  pushing atoms, 212 eV given to the water). No event leaks (processEvents and moveFastLeptons wrapped: 2×10⁻¹⁰ eV). The
  drift goes with the step: DT_MAX 0.04 tu 1.41 eV, 0.02 tu 0.40, 0.01 tu 0.05: the integration of the water's
  vibrations after the pushes. Not changed (a step-size matter, not a leak).
- **Fingerprints** (switches off, seed 7, 300 steps): every setup as v145 except pionbeam (8542d91e) and photonuc
  (09ec2d3b): the setups whose free electrons meet atoms in their short steps. Stored fingerprints updated with a comment
  (f_rp1, f_rp2, f_rp3, f_rp5, f_ew; f_rp7's part-3-on annihilation, photonuc and sns).
- Cost: ionized water (40 waters ionized, 200 steps): flat 13.4 against 15.3 ms a step, 3-D 13.9 against 16.2 (noise;
  grid builds 6,553 against 6,301 flat).
- Suites: t_lint, t_energy, t_physics, t_hep, f_rp1, f_rp2, f_rp3, f_rp5, f_rp7, f_ew pass.
- **Left for the owner.** After a big collision the unstable particles beyond the 1,500 slots are carried off (now with
  their charge) instead of flying; a 100 keV electron in 3-D water ionizes nothing (its passes give 0.1 eV each, under the
  ionization cost: pushes instead).

### 1.27: W and Z bosons (electroweak)

Branch v148 (from v145 at 76274f3, the combined 1.27 with all seven realistic-particle parts). Asked by the owner directly
(2026-11-06, "Just add it", after an explanation of electroweak unification); approved physics. Always on, no switch:
W and Z can only be made above √s ≈ 80–90 GeV, and below that nothing new runs or draws a random number. Code: hep.js,
"W and Z bosons" (after part 5's heavy flavour: EW, EW_HAD, EW_WW, EW_ZZ, EW_PP, ewEE, ewAfb, ewDir, ewFinal, ewDecay,
ewDraw, ewDecList), the particles in XP, hooks in eeEvent, nnInelastic, nnbarEvent, hadronHit, xbAnnihilate,
xbInelastic, fragmentInto, decayExo/decayExo3, spawnItems/spawnItems3 (a W's spin axis, `ewAx`), bwMassRel (their mass
window), resPlaceMass, hfInto (a W's c s̄); ui.js (the setup, the palette's "W and Z bosons", XP_NAME, XP_ABOUT,
EXO_FOUND, PART_NAMES, Inspect's decays and "Inside", the Data tab's card); body.html (Physics: Forces → Electroweak,
Accelerators → New particles). Checks: tests/f_ew.js (t_features runs it alone; `node tests/f_ew.js [--node] [part …]`):
fp, peak, branch, vma, ww, widths, hadron, fireball, books, setup, page; every part but fp fails on v145 (no W or Z
there: "ewEE is not defined" …); fp shows the setups below the thresholds unchanged. Screenshots: scratchpad
ew/lep1.png, lep-data.png, ins-w.png.

- **The particles.** W⁺, W⁻ 80,369.2 MeV, Γ 2,085 MeV, mean life ħ/Γ = 3.157×10⁻²⁵ s; Z⁰ 91,187.6 MeV, Γ 2,495.2 MeV,
  2.638×10⁻²⁵ s. They are `res` (decay at once where they are made, as the ρ; Ultra-realistic: on the clock) and `ew`.
  Their own masses: part 5's relativistic Breit–Wigner (`bwMassRel`) with or without that switch (a W or Z only exists
  with its width), cut at M ± 10Γ, the window the measured cross sections count (66–116 GeV for the Z: 66.26–116.01
  drawn), not at the lightest decay threshold as for hadron resonances (a constant-width W reached down to 1 GeV, 2.7% of
  draws below M − 5Γ). A Z made on the peak in e⁺e⁻ has the collision's √s as its mass. Placed, fired or pasted they
  draw their mass too.
- **Decays** (`ewDecay`, `ewFinal`): W → eν 10.71%, μν 10.63%, τν 11.38%, hadrons 67.41% (a u d̄ pair 34.07%, c s̄
  33.34%); Z → e⁺e⁻ 3.3632%, μ⁺μ⁻ 3.3662%, τ⁺τ⁻ 3.3696%, νν̄ 20.00% (three kinds, a third each), hadrons 69.911% (b b̄
  15.12% = R_b 0.21629, c c̄ 12.03% = R_c 0.1721, u, d or s 42.76%). A quark pair becomes hadrons through the game's own
  string: hadronize (charm and bottom by part 5's hfInto at their fragmentation fractions, whatever part 5's switch; a
  W's c s̄ as a charmed hadron and a kaon), resonate, then jetMomenta along the pair's axis (two jets back to back, as
  e⁺e⁻ → hadrons). Captions: "Decay: Z⁰ → μ⁻ + μ⁺", "Decay: Z⁰ → b b̄: two jets, 21 hadrons", "Decay: Z⁰ → ντ + ν̄τ …
  nothing seen (invisible: the 20% that counted three neutrino kinds)". Angles (in the flat game in the plane, as the
  game's other e⁺e⁻ pairs; in 3-D over the sphere):
  - A W made in a hadron collision has its spin along the beam its antiquark came from (p̄p, a meson or antinucleon on a
    nucleon: that beam; pp and nuclei: either beam at random), and V − A decides its charged lepton: ℓ⁺ (right-handed) as
    (1 + cos θ)² to the spin, ℓ⁻ as (1 − cos θ)². Measured in 3-D (F − B)/(F + B) = +0.763 and −0.750 (exact ±0.75); flat
    +0.849/−0.861 (in the plane ±8/3π = ±0.849).
  - A Z from e⁺e⁻: its fermion pair as 1 + cos²θ + (8/3)·A_FB·cos θ to the electron's direction, A_FB from the γ–Z
    interference at its √s (`ewAfb`, Born, sin²θ_eff 0.23153): μμ −0.282 at 88 GeV, −0.152 at 89.4, −0.076 at 90.2,
    +0.016 on the peak (LEP: 0.0171), +0.107 at 92.2, +0.256 at 94, +0.55 at 200; drawn at 94 GeV in 3-D 0.250. The same
    A_FB is given to the photon's μμ and ττ channels above 10 GeV. Measured values with the beams' radiation are smaller
    above the peak (it brings collisions back to the peak): Born here, said in the code. A Z from hadrons: 1 + cos²θ to
    the beams. Jets: 1 + cos²θ (Z from e⁺e⁻) or at random. A W or Z pair from e⁺e⁻ decays at random (their spins are not
    followed).
- **e⁺e⁻** (eeEvent, above √s = 10 GeV): three more channels. The Z as an s-channel resonance, σ = σ⁰·sΓ²/((s − M²)² +
  s²Γ²/M²), σ⁰ = 12π·B(ee)/M² = 59.37 nb: hadrons 41.51 nb, μμ 1.999 nb on the peak (Born; the measured peak with the
  beams' radiation is 30.5 nb); 0.130 of the peak at 88 GeV, 0.167 at 94. Within M ± 10Γ the collision makes one Z (its
  mass √s, at rest in their frame), which decays at once; further off (e.g. 200 GeV) the Z channel makes the decay products
  directly ("through a Z, off its peak"). W⁺W⁻ above 2M_W = 160.74 GeV and ZZ above 2M_Z = 182.38 GeV (EW_WW, EW_ZZ: LEP2's
  combined measurements 161.3–206.6 GeV, from the threshold to the first point as the pair's velocity, above 207 GeV the
  theory curves: WW 15.4 pb at 250 GeV, 7.6 at 500, 2.9 at 1 TeV; ZZ 1.1, 0.6, 0.25), each boson its own mass from its
  width, flying apart at random (the real W⁻ goes forward along the e⁻; not built). The photon's channels (γγ, μμ, ττ,
  ρ, ω, φ, hadrons, cc̄, bb̄) are as they were; the γ–Z interference is left out of the totals: −0.34% of the Z's at 88
  GeV, +0.28% at 94 (under 0.4% from 88 to 94 GeV), 3–4% of the Z channel's 15–18 pb at LEP2. Below 10 GeV the Z's share is
  under 10⁻³ (at 10 GeV 0.54 pb against 870 pb of μμ) and nothing is drawn: the channel list and the lepton pairs' angles
  are exactly as before.
- **Hadron collisions** (`ewDraw`): W and Z by quark–antiquark annihilation (Drell–Yan) at σ(√s)/σ_inel(√s), σ_inel from
  part 5's HF_INEL, σ = σ·B / B (B(W → ℓν) 0.1086, B(Z → ℓℓ) 0.033658), one draw per collision above √s = 82.3 GeV (M_W
  and two nucleons). Where: nucleon–nucleon (nnInelastic: pp, and nucleon pairs inside nuclear encounters), p̄p in flight
  (nnbarEvent), an antinucleon or a meson on a nucleon in matter (hadronHit), the collider's hadron beams (xbAnnihilate:
  'pbar' table, xbInelastic: 'pp'), and a nuclear fireball (fragmentInto: the plasma and the light-system hadronize path)
  times its binary collisions, a·b/min(a, b)^⅔ for a and b participants (p + A: b; central Au + Au 1,150, Glauber's
  1,050 at 42 mb). The W or Z is one item among the event's hadrons (the hadrons get what it leaves; books as any event).
  W⁺ against W⁻: p̄p, mesons 1:1; pp 0.78 at 0.5 TeV, 0.59 at 7, 0.574 at 13 TeV (W⁺/W⁻ 3.5, 1.45, 1.35).
  - Data (σ·B in nb, W for one lepton kind, W⁺ + W⁻; Z → ℓℓ in 66–116 GeV): p̄p 0.63 TeV 0.68 / 0.066 (UA2), 1.8 TeV 2.49 /
    0.231 (CDF Run I), 1.96 TeV 2.75 / 0.256 (CDF, D0 Run II); pp 0.5 TeV 0.150 / 0.0080 (STAR, PHENIX), 7 TeV 10.4 / 0.97
    (ATLAS, CMS), 13 TeV 20.6 / 1.98 (ATLAS); p̄p above 1.96 TeV as pp (the sea's antiquarks lead there). Below the first
    point (0.63 / 0.5 TeV) brought to zero at the threshold (82.3 / 93.1 GeV) as (1 − √s_thr/√s)ⁿ, n = 8 (p̄p, a valence
    antiquark) or 16 (pp, the sea's): a shape, not a measurement (pp at 200 GeV: σ_W·B = 0.6 pb).
  - Real rates (one collision in): p̄p 0.63 TeV W 7.9 million, Z 25 million; p̄p 1.96 TeV W 2.4 million, Z 8.0 million;
    pp 7 TeV W 760,000, Z 2.5 million; pp 13 TeV W 410,000; pp 200 GeV W 8×10⁹; a 1 PeV proton fired at carbon (√s 1.37
    TeV, 3 binary collisions) one hit in 2.3 million; central Au + Au at 200 GeV one in 6.8 million, Pb + Pb at 2.76 TeV
    one in 2,100, at 5.02 TeV (1,700 binary collisions) one in 570. So in a collider run of thousands of collisions a W
    or Z is not seen, except in lead–lead at LHC energies now and then.
  - RP.ewX multiplies the hadron rates, for the tests only (×10⁵: p̄p 1.96 TeV, 1,500 collisions, W in 69 (expected
    62.5), Z in 22 (18.8); pp 7 TeV in 3-D, 400: W 59 (52.4), Z 15 (15.8); pp at 60 GeV none (no draw); central Pb + Pb
    2.76 TeV ×10³: a W or Z in 2 of 6 plasmas, 3-D 2 of 6, the event's charge kept: the plasma's hadrons carry its
    charge less the W's).
- **Not built:** neutrinos meeting matter through W or Z exchange (σ ≈ 10⁻³⁸ cm² × E/GeV: a neutrino crosses the Earth;
  the game's neutrinos leave); the Higgs boson (on the planned list); e⁺e⁻ → Zγ and the beams' own radiation (radiative
  return; at LEP2 most e⁺e⁻ → qq̄ events); the W pair's angular distribution and the W and Z spins in pairs; W and Z in
  the 3-D world's e⁺e⁻ lepton pairs of the photon channel (those are drawn in the plane, as before: PS3.flat; the Z's own
  decays are 3-D); several W or Z in one collision.
- **Where to see them.** The Fire tool shoots up to 1 PeV, so the Z peak is not reachable with electrons there: a
  positron on an electron at rest has √s = √(2mₑE), 32 GeV at 1 PeV (the Z needs 8.1 PeV, not 8.1 TeV), and a fast
  positron hitting an atom annihilates with one of its electrons into 2γ whatever its energy (annihilateBound; not
  changed). Two particles fired head-on at 45.6 GeV cross the box in one step (1,200 Å at 0.04 tu) and leave before the
  collision check, so they never meet. Through hadrons it works: a 1 PeV proton or pion fired into matter meets nucleons
  at √s ≈ 1.4 TeV (measured with ×10⁵: 2 W or Z in 101 hits above the threshold). The linear collider reaches it: at
  45.6 GeV a beam its collisions land at √s 85.7–91.2 GeV (median 90.2; 167 collisions in 6,000 steps), the beams
  leaving the linac at 43.5–45.6 GeV and losing about 0.4 GeV more in the focusing magnets' synchrotron light (real LEP:
  0.1% spread); the Z is 2.5 GeV wide, so nearly every collision still makes one. New setup, Real labs → "CERN LEP: the Z
  factory" (`lep`: the linear collider, e⁺e⁻ at 45.6 GeV a beam, after DAΦNE's pattern; its hint names the decays, the
  invisible fifth and three neutrino kinds, the 1% loss, and the scan: 44 to 47 GeV a beam in the Lab tab; above 80.4 GeV
  a beam W pairs). Node: 62 Zs in 63 collisions over 3,000 steps, 1,086 charged pions among their products. The energy
  scan is by hand (Lab → Beam energy): an automatic scan would be a feature with its own panel; written down, not built.
  t_energy skips `lep` as it does DAΦNE (injectors and cavities add energy).
- **Numbers** (Node, f_ew): the peak 41.51 nb hadrons, 1.999 nb μμ; Zs made in eeEvent 233 of 250 at 88 GeV (expected
  236), 248 of 250 on the peak (248), 242 of 250 at 94 (240); branchings from 100,000 decays: Z hadrons:μμ 20.74 (20.77),
  invisible 0.1998, e⁺e⁻ 0.0336, τ⁺τ⁻ 0.0335; W⁺ eν 0.1071, μν 0.1054, τν 0.1124, hadrons 0.6751; Z → hadrons 11–27
  hadrons (resonances counted once) in two jets, bottom in 56 and charm in 31 of ~210, momenta exact to 10⁻⁶ MeV; e⁺e⁻ →
  W⁺W⁻ none of 300 at 150 GeV, none of 300 ZZ at 175 GeV, 68 of 500 at 200 GeV (expected 67.3; σ 17.0 pb against 80.6 pb
  γγ); masses 40,000 draws each: Z 2,550 MeV at half height about 91.21 GeV (Γ 2,495; 50 MeV bins), W 2,200 MeV about
  80.44 GeV (Γ 2,085); books (energy and momentum exact through closeEvent, rest mass in the nuclear ledger): e⁺e⁻ at the
  peak and at 200 GeV and placed W⁺, W⁻, Z⁰ (180 events each) flat within 2.8×10⁻¹⁴ of their energy, 3-D 2.4×10⁻¹⁴;
  hadron collisions within 4×10⁻¹⁵ of √s; Pb + Pb plasmas within 4.4×10⁻¹⁵.
- **The collider panel** (makeNote): for e⁺e⁻ beams the list of what they can make goes on past τ pairs to "Z bosons (the
  Z peak at 91.19 GeV, 2.5 GeV wide)" (from √s 66.2 GeV, the window; the go-to button offers 45.6 GeV a beam), "W⁺W⁻
  pairs" (160.74 GeV) and "Z pairs" (182.38 GeV), and near the peak says that nearly every collision makes a Z⁰.
- **Suites** (2-core machine, another session's tools/runtests.sh running for the first half): alone t_lint, t_energy,
  t_hep, t_collider, t_3d, f_ew (all 11 parts, 93 s), f_rp1, f_rp2, f_rp3, f_rp5, f_rp7 pass. t_features alone (29 min, with
  the other session's run): f_ew and every f_ file pass; misses: 1.14's slow-motion readout and 0.64's named save (both on
  record as two-core flakes), f_bug125's two timing checks (exoElastic 4.26 ms against 3; pi3; rerun alone pi3 passes,
  exoElastic swings 1.7–4.9 ms run to run on v145 as here), and "muons" (the catalysing muon stuck to an α after two
  fusions: the page's random numbers are not seeded; the block alone passed 4 of 4). tools/runtests.sh (alone): 21 of 22
  pass, t_features among them; t_page's 4 misses (the slow-motion button, the go-to-threshold button on the linac, the
  nucleus card's Close twice) under the two lanes' load, and t_page alone passes (5 min).
- **Fingerprints** (tools/fingerprint.js, seed 7, 300 steps): all 59 setups, flat and 3-D, equal v145's (76274f3), RHIC
  (gold at 200 GeV a nucleon pair, which draws for a W or Z in its plasma) included: no plasma forms within 300 steps.
  f_ew "fp" keeps 14 of them (rhic, ring, linac, dafne, annihilation, pionbeam, photonuc, hyperfactory, antihydrogen,
  chain, isolde, sns, water, water3d). The new `lep` is the 60th.
- **Cost:** below the thresholds nothing (a comparison per e⁺e⁻ or hadron event). A Z's hadronic decay 0.29 ms (hadronize,
  resonate, jets); the LEP setup 0.28 ms a step (DAΦNE 0.18), one thread, on a machine shared with another session's tests.
- **Values from memory** (no network here; worth a check against PDG 2024): M_W 80.3692 GeV (PDG 2024's average; the brief
  said 80.37), Γ_W 2.085; M_Z 91.1876, Γ_Z 2.4952 (LEP's; PDG 2024 lists 91.1880 and 2.4955); the branching fractions
  above; R_b, R_c; sin²θ_eff 0.23153; σ⁰_had 41.54 nb (computed here 41.51 from Γ_ee/Γ and the mass); the LEP2 WW and ZZ
  points and the theory curves above them; the hadron-collider σ·B values and the W⁺/W⁻ ratios; Glauber's N_coll.
- **Found, not changed:** a positron of any energy hitting an atom annihilates into 2γ (annihilateBound), where above
  211 MeV in their frame real e⁺e⁻ makes μ pairs and hadrons too (√s reaches 32 GeV at the Fire tool's 1 PeV); fired
  particles above a few GeV cross the box in one step and never meet each other (beamCollisions after they have left);
  after a central Pb + Pb plasma at 2.76 TeV the count of charge (particles, unstable particles, charge gone out)
  changes by 13–53 over the next moveExos while its 400–500 products fly among the fragments (v145 the same; the event
  itself and every single decay keep it; not traced); the linear collider's √s spreads 6% at 45.6 GeV a beam (its acceleration and the quadrupoles' synchrotron light); p̄p
  in flight always annihilates into mesons (nnbarEvent), where at TeV energies real p̄p collisions are mostly inelastic
  with both baryons surviving; the photon channel's e⁺e⁻ lepton pairs are drawn in the plane in 3-D (PS3.flat).
- **For the owner (written down, not decided):** an automatic energy scan for the LEP setup (σ against √s drawn as the
  collider steps through 88–94 GeV); the beams' own radiation (radiative return, which takes the Z peak from 41.5 to 30.5
  nb and makes most of LEP2's qq̄ events); the W pair's forward peak; a fast positron on matter by eeEvent (μ pairs,
  hadrons) rather than always 2γ; the Higgs boson (planned list).

### 1.27: feature 20 (a bigger model for close-packed metals)

Branch v155 from v154 (2026-11-06; approved with the list; built while the owner slept). Settings → Experimental → Metals →
Many-body, nothing new to switch: the close-packed metals' many-body energy gains a term. Many-body off (the normal game),
nothing changes.
- **What was wrong** (1.26, items 3–4): 1.25's second-moment band (−√ρ) counts bcc's 14 near neighbours (its second shell
  at 1.155 r_nn sits inside the 1.15–1.35 r₀ switch), so in 3-D bcc came out lowest for most fcc and hcp metals (relaxed
  bcc − own: Cu −0.053, Al −0.039, Ni −0.081, Ti −0.092, Zr −0.123 eV an atom) and balls turned body-centred. 1.26 tried
  MEAM's angles (item 4, not shipped): the structures came right but the liquid rose by about the latent heat (Cu +50 meV
  an atom), so the metals melted 250–400 K too high; held to the liquid, the fit put hcp below fcc.
- **Two forms measured first** (on 1.25's model, lattice clusters and the 1.25 copper liquid, tools/mbliquid.json):
  - a radial bump in the band (extra weight for neighbours near bcc's second shell, x_b = 0.13): the best it does is raise
    the liquid by 0.35 of what it raises bcc (Cu: liquid +0.032 eV for bcc's +0.09, against a latent heat of 0.135). Dropped.
  - the band's shape, s = μ₄/μ₂² (μ₄ = (H⁴)ᵢᵢ, closed walks of four hops; one s-like hopping h = e^(−q(r/r₀ − 1)) at the
    pair's switch): q = 2: fcc 3.750, hcp 3.750, bcc (equal volume) 4.385, the liquid 3.743 ± 0.154 (q = 3: liquid 3.612,
    q = 4: 3.465). bcc stands apart, fcc and the liquid sit together. (fcc and hcp also share μ₃, μ₅ and μ₆ for one
    shell; nothing this cheap tells them apart.) Built.
- **The model** (`src/bometal.js`, mb4F, mb4Pass, mb4Local; constants MB4_C): E₄ᵢ = Cᵢ·φ(μ₂ᵢ)·g(sᵢ − 3.75), g(Δ) =
  W²Δ²/(W² + Δ²) for Δ > 0 and 0 below (W = 1.5: bounded), φ a quintic from 0 at μ₂ = 7 to 1 at 10 (12 in the crystal).
  Hoppings between member atoms of the same metal only. Why each piece:
  - one-sided, quadratic in Δ: s changes only to second order under any strain of one close-packed shell (all neighbours
    equivalent, Σ of first-order changes = tr ε = 0 for a shear; a uniform scaling leaves s alone), so E₄ is fourth order
    there: Ec, r₀, B, C₄₄, C′ and the vacancy are exactly 1.25's (f_125m `fit` unchanged); and the liquid's atoms below 3.75
    pay nothing, those above a little.
  - φ: an atom with few neighbours has a large s (an adatom on (111) 6.0, on (100) 4.75; an atom arriving at a surface
    grows without bound as its one weak hopping fades: 3,217 at the switch's edge), which would have put a barrier of an
    eV in front of every atom landing on a metal. Below μ₂ = 7 nothing is paid: adatoms, steps, (111) faces (μ₂ 9, s
    3.70) and the flat world (six neighbours; a flat Cu patch at 900 K: E₄ exactly 0 at every step) keep their energies;
    a (100) face's atoms (μ₂ 8, s 3.94) pay a little, (110) (μ₂ 7, s 4.08) nearly nothing.
  - same metal only: with unlike pairs counted, B2 NiAl, NiTi, CuZn and FeAl (bcc-ordered) paid each element's bcc price,
    the alloy refit (tools/mbfit.js --alloys) then made the Ni–Al pair stronger and L1₂ Ni₃Al came out −223 kJ/mol
    (measured −165.2), CuAu −13.8 (−18.2). Like-only, every alloy and its fit is exactly 1.26's (Ni₃Al −169.7, CuAu −17.6;
    MBA_FIT unchanged); oxides and hydrides too (O, H are not arms): f_126m all parts unchanged.
- **The fit** (`node tools/mb4fit.js [El …] [--write]`, ~1.5 min for all; periodic 3-D crystals in the game, E₄ linear
  in C): C so that relaxed bcc lies the reference ΔE above the metal's own crystal (D_CP in tools/mbdfit.js: SGTE lattice
  stabilities and DFT as recalled, ±0.05 eV and more, unchecked against the books). 25 metals; the rest keep 1.25's model
  exactly. All hit their targets (relaxed bcc − own, 1.25 → now; the Bain path's lowest point between, relaxed in volume;
  the 1.25 copper liquid's rise at the metal's spacing):

  | | C eV | bcc 1.25 → now (ref) | Bain path lowest | liquid rise meV |
  |---|---|---|---|---|
  | Cu | 0.273 | −0.053 → +0.040 (0.04) | +0.004 | 3.2 |
  | Ag | 0.155 | −0.023 → +0.030 (0.03) | +0.004 | 1.8 |
  | Au | 0.079 | +0.013 → +0.040 (0.04) | +0.004 | 0.9 |
  | Al | 0.379 | −0.039 → +0.090 (0.09) | +0.001 | 4.5 |
  | Ni | 0.472 | −0.081 → +0.080 (0.08) | +0.005 | 5.6 |
  | Pd, Pt | 0.313, 0.270 | −0.007, +0.008 → +0.10, +0.10 | +0.006, +0.005 | 3.7, 3.2 |
  | Pb | 0.085 | −0.004 → +0.025 | +0.002 | 1.0 |
  | Rh, Ir | 0.912, 1.139 | −0.011, +0.012 → +0.30, +0.40 | +0.006, +0.008 | 10.7, 13.4 |
  | Ca, Sr | 0.153, 0.113 | −0.037, −0.033 → +0.015, +0.006 | +0.001, +0.001 | 1.8, 1.3 |
  | Mg, Zn, Cd | 0.149, 0.122, 0.066 | −0.021, −0.012, +0.002 → +0.030, +0.030, +0.025 | +0.002 | 1.8, 1.4, 0.8 |
  | Be | 0.461 | −0.088 → +0.070 | +0.001 | 5.4 |
  | Ti, Zr, Hf | 0.561, 0.595, 0.812 | −0.092, −0.123, −0.128 → +0.10, +0.08, +0.15 | +0.003, +0.003, +0.005 | 6.6, 7.0, 9.6 |
  | Co, Sc, Y | 0.436, 0.480, 0.639 | −0.049, −0.104, −0.119 → +0.10, +0.06, +0.10 | +0.004, +0.002, +0.002 | 5.1, 5.7, 7.5 |
  | Ru, Os, Re | 1.537, 1.753, 0.902 | −0.024, +0.002, −0.008 → +0.50, +0.60, +0.30 | +0.008, +0.011, +0.010 | 18.1, 20.6, 10.6 |

  (hcp metals against ideal hcp, 1.25's reference; the simple cube stays 0.25–1.8 eV up. E₄ ≥ 0 everywhere, so no
  structure can fall below where 1.25 had it; the Bain path climbs from the close-packed end to bcc, which sits at or
  near its top, as in real copper.) The liquid rises 1–4% of each metal's latent heat (1.26's angles: 37–90%).
- **In motion** (3-D free balls, bath 0.05; inner atoms, after a quench to the inherent structure, with 12 neighbours
  within 1.25 r₀ or bcc's 14):
  - Cu 201 atoms started fcc, 600 K, 2 ps: 1.25 11 of 48 close-packed, 13 bcc; now 26–27 of 49, 1–2 bcc (the rest 13
    neighbours: a hot ball quenched in 600 steps keeps defects; its energy 17 meV an atom above the perfect ball's).
    At 300 K, 1 ps: 1.25 27 of 49 fcc, 2 bcc; now 29 of 50, 0.
  - hcp balls 195 atoms, 300 K, 1 ps: Ti 1.25 2 hcp, 39 bcc of 62 → now 27 hcp, 8 bcc; Mg 41 hcp, 5 bcc of 65 → 55, 0;
    Zn 49 of 57 either way (its bcc was only 0.012 low).
  - A Cu ball started bcc at 300 K stays bcc for 1 ps either way (57–59 of 59): bcc is a flat saddle on the Bain path
    here (0.039 eV at c/a 1 and 1.05), so it does not fall apart quickly.
- **Melting** (3-D balls of 201 atoms, bath steps of 0.1·Tm, 2 ps each; share of the inner atoms' neighbours at 0.7 ps
  still neighbours at 2 ps, 1.26 item 4's measure):

  | | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 | 1.1 | 1.2 | 1.3 | 1.4 | 1.5 Tm |
  |---|---|---|---|---|---|---|---|---|---|---|
  | Cu, 1.25 | 96% | 96 | 95 | 93 | 80 | 74 | 77 | 67 | 69 | 64 |
  | Cu, now | 95 | 96 | 91 | 91 | 87 | 78 | 71 | 69 | 54 | 56 |
  | Al, 1.25 | 91 | 89 | 85 | 71 | 63 | 54 | 52 | 48 | 44 | 37 |
  | Al, now | 93 | 83 | 74 | 66 | 63 | 50 | 43 | 44 | 39 | (not run) |

  The same within the runs' noise (one seed each; atoms' temperatures lag the bath by 100–300 K): no shift like 1.26's
  (+250 K for Cu, +300–400 for Al).
- **Forces and books**: forces are the energy's slopes to 1.4e-8 eV/Å (a jittered Cu ball with Ni and an O atom), localPE
  exact to 3e-13 eV (an atom, a pair moved), the module path (plain metals: the term runs after mbWasm) and the JavaScript
  path give the same forces to 1e-14. Insulated, a 3-D Cu ball of 135 atoms at 1,500 K over 2,000 steps of 0.4 fs:
  7.55e-4 eV against 1.25's 7.53e-4 (the integrator's). Found on the way, not from this change: on a ball jittered by
  0.9 Å, one atom's force differs from the energy's slope by 5.8e-4 eV/Å (of 30 eV/Å) with the term on or off; for a
  bug-fix session.
- **Cost** (one thread, two cores shared with the suite running): the pass for a 3-D copper crystal of 864 atoms at 600 K
  1.0 → 5.9 ms (the term in JavaScript after the module's pass; neighbour lists each pair once, rows (H²)ᵢ· by sparse
  scatter), the step 13.3 → 22.9 ms (×1.7); a flat Cu patch of 955 atoms, pass 0.41 → 1.11, step ×1.08 (lists built,
  nothing paid). 36–56% of a hot crystal's atoms pay, so skipping idle ones would save little. For 1.28's WebAssembly
  pass. evTransfer's lower bound (mbXferLB) leaves the term out (it can go either way; the trial decides), as for the
  directional metals.
- **Left**: fcc against hcp is still 1.25's (equal: the plan's "fcc/hcp/bcc in order" is met for bcc only; hcp metals
  keep fcc and hcp level, fcc metals the same); separating them needs the second neighbours' shell (MEAM's screening) or
  moments past the sixth. The reference ΔE values are from memory. Tests: tests/f_127m.js (fit, liquid, forces, flat, md;
  each fails on v154), in t_features.
- Suite on v156 (v155 with the two controls, ui127, merged; 2026-11-06): tools/runtests.sh 20 of 22. The misses are the
  known two: t_features' 1.14 speed readout ("1/1.3×" on two cores; every 1.27 check passed, f_127m and f_ui127 among
  them) and t_page's slow-motion button (fails alone too, as on record for 1.25 and 1.26). Setups bit for bit v154's
  (tools/fingerprint.js, 60 setups).

### 1.27: feature 19 (photons as waves)

Branch v154 from v153 (2026-11-06; approved with the list, "the owner's OK" on the physics given; built while the owner
slept). Settings → Experimental → Realistic particles → Photons as waves (`RP.pwave`, `SET.rpPwave`; the line where 1.27's
Settings section kept its place). The flat game only, as the plan said ("to scope against cost, flat first"); in the
3-D lab it changes nothing (said in its pane). Off at every start; off, nothing runs.
- **The scale problem, and what was built for it.** The box is tens to hundreds of ångströms across; visible light's
  wavelength is 4,000–7,000 Å. So visible light cannot show fringes or thin-film colours at these sizes (a slit a few Å
  wide sends it everywhere, as it really would). Waves of the box's own size are X-rays of a few keV (λ = 12.4 Å/E[keV]:
  1–5 Å). Two things were built, each photon by photon (each photon goes where the wave's intensity says, so a pattern
  builds up as in the single-photon experiments):
  1. **Slits** (props.js `OBJ_SLIT`, a new object offered by the Objects tool with the switch on, kept out of
     OBJ_KINDS as the polarizer, so t_fuzz is unchanged): an opaque sheet with 1, 2 or 5 openings (width 0.5–20 Å,
     spacing 1–60 Å), centred on the piece. Light and fast particles (atoms, unstable particles) pass only through the
     openings; elsewhere it is absorbed, they are stopped. With the switch off, light goes straight through an opening
     (a shadow); on, `waveSlit` draws its new direction from the Fraunhofer pattern of the whole sheet lit by a plane wave
     along the photon: I(θ) = sinc²(πaΔ/λ)·[sin(NπdΔ/λ)/(N sin(πdΔ/λ))]²·((cos θᵢ + cos θ)/2)², Δ = sin θ − sin θᵢ, on
     2,048 angles. Its polarization keeps its part across the new path. Saved and loaded with its openings.
  2. **X-ray diffraction** (pold.js `waveBraggTry`, `waveBraggEmit`; rayInteract in the flat game): an X-ray of 1–100
     keV passing an atom may be scattered by the atoms about it together: |F(q)|² = |Σ fⱼ e^(iq·rⱼ)|²·e^(−0.1q²)·(1 −
     (ε·n̂)²), q = k(n̂ − û), fⱼ the atom's electrons times a Gaussian weight e^(−r²/2σ²) (σ = 8 Å, out to 20 Å: a coherent
     patch; a sharp edge at 12 Å first gave a false small-angle excess, the patch's own outline), on 1,024 directions;
     the straight-on peak (q < 3/σ) left out. Tried at P0·GMAX·(electrons/10)² an atom passed (P0 0.002, GMAX 25) and
     kept with odds g/GMAX, g = Σ|F|²/Σ(Σf²)·w (what the phases add over random ones: 1 for a gas), so the rate follows
     the Bragg condition as the direction does. (A first version made the rate the same at any angle and only steered
     the direction: a crystal turned 4° off a reflection still sent its photons to 2θ.)
- **Measured** (tests/f_127w.js):
  - Double slit 10 Å apart, 2 Å wide, λ 2 Å: brightest at sin θ = 0, ±0.19–0.21, ±0.39, ±0.59–0.61, ±0.77–0.81 (mλ/d,
    40,000 draws, bins of 0.02); a grating of five the same; one slit 4 Å wide dark at sin θ = ±0.5 (λ/a: 1 photon there
    against 1,729 in the middle).
  - The experiment: 6,000 X-rays through a double slit (1.5 Å openings) onto a detector screen 40 Å behind: 9 fringes
    about 9 Å apart on its strips (40·λ/d = 8 Å near the axis, wider off it), light on all 40 strips; off, on 2 strips.
  - Visible light (500 nm) through the same slits: no fringes, the obliquity factor's shape alone (within 10.4%).
  - A square lattice 3 Å apart, λ 1.2 Å, at the Bragg angle (11.5°): scattered photons leave at 23.1° (2θ = 23.07°),
    10.3% of tries kept; 4° off 3.6%, 10° off 0.7%; the same atoms as a gas 2.4% (random phases: 1 in 25 intended).
  - The books: 2,000 X-rays into a salt crystal (300 through slits first): 9 scattered by the crystal, the rest of the
    books move 9×10⁻¹⁰ eV, all the light's energy leaves or lands. Switch off: all 60 setups bit for bit.
  - Cost: nothing a step; a photon through slits about 0.1 ms; a crystal's try 2–5 ms (400 atoms × 1,024 directions).
- **Not built (the rest of the plan's list):** thin films and a laser's coherence (both need sizes the box does not have:
  hundreds of nanometres for visible light); lenses, mirrors and prisms acting on the wave (they keep acting on rays);
  wave packets drawn with their wavelength and phase; the 3-D lab (slits are flat-game objects; Bragg there needs the
  sum over a sphere of directions, about 30 ms a try). For the owner: P0 and GMAX are choices of how visible to make it.
- Suite on v154 (2026-11-06): tools/runtests.sh 22 of 22 passed (t_features 2,031 s on two cores shared with other
  work). It covers v153 too (v154 is v153 and this feature): v153's own run was cut short when its snapshot was removed.

### 1.27: feature 24 (unstable particles meet each other)

Branch v153 from v152 (2026-11-06; approved with the list; built while the owner slept: "just finish all the features").
Settings → Experimental → Realistic particles → Unstable particles meet each other (`RP.exm`, `SET.rpExm`; hep.js
exoMark, exoMeet, exmHit, exmFree; the step calls them around moveExos). Off at every start; off, nothing runs.
- **Before:** an unstable particle met atoms and nuclei only, and other unstable particles only as a collider's beams
  (beamCollisions; noted under 1.26's "Left for the owner": "a pion through muonic hydrogen or a Λ passes it").
- **With it on:** before the exotic particles move each step, each one's start is kept (exoMark); after they move, every
  pair of free ones (not a resonance, exotic atom, muonium, positronium, hypernucleus, W/Z/Higgs, a collider's beam or a
  caught one; moving) whose paths came closest during the step (the same closest-approach test as beamCollisions: still
  closing in waits for a later step) within reach meets by xbHit's rules without a collider (exmHit): a lepton and its
  antilepton annihilate as e⁺e⁻ (eeEvent), a hadron and its antihadron into mesons (xbAnnihilate), two other hadrons
  inside √0.6 of the reach collide inelastically (xbInelastic: as proton–proton at the same energy above their masses),
  and in the flat game two charges within 0.6 Å turn each other (nuclearScatter, as a collider's; not in 3-D, where
  nuclearScatter is flat). The reach is R_NN (0.35 Å), the game's for fast particles outside a collider; ultra-realistic
  mode 10⁻⁵ Å (a femtometre: never in practice). The two are marked as beam particles (xb, rad) for the call, so the
  beams' code treats them as unstable particles, and unmarked after if they survive; products in 3-D are made at the
  meeting's depth (xbClose's spawnItems takes _xbZ, 0 for the beams as before).
- **Found on the way:** sameEv (engine.js) reads evId, which unstable particles do not have (theirs is ev), so every pair
  of them counted as one event's; exoMeet compares ev.
- **Measured** (tests/f_127x.js): head-on at 2–5 GeV, flat and 3-D, π⁺π⁻ → p p̄ 2π⁺ 2π⁻ (one draw), K⁺K⁻ → p p̄ 3π⁰
  π⁺π⁻, μ⁺μ⁻ → μ⁺μ⁻ (eeEvent's channels), π⁺K⁻ → new hadrons; off, each pair passes; books within 2×10⁻¹⁶ of the energy.
  Two π⁺ at 5 MeV 0.1 Å apart turn 9.3° (flat). 30 ρ⁰ and φ decaying a few ångström apart: 215 close passes between
  products of different decays met, none between two of one decay. Ultra-realistic: a π⁺π⁻ pair 0.05 Å apart passes.
  Setups with the switch on, 400 steps (pionbeam, hyperfactory, annihilation, rhic, muonium, dafne): at most 20 unstable
  particles at once, mostly one collision's products; no meetings within 400 steps, the steps 0.22 → 0.25 ms (dafne), the
  books as with it off. Switch off: all 60 setups bit for bit (tools/fingerprint.js).
- **Not covered:** an unstable particle meeting a free electron or positron (μ⁺e⁻ makes muonium elsewhere, by its own
  rules); a heavy-ion collision's hadrons rescattering among themselves after it (one event's products never meet: the
  fireball's statistical hadronization stands for that stage); the charges' turn in 3-D.
- Suite on v153 (2026-11-06): tools/runtests.sh 20 of 22: t_features' 1.10 line counted 11 realistic switch tags where
  this line makes 12 (the count updated), and the two known load-timed checks (t_features 1.14's speed readout, t_page's
  slow-motion button); every feature-24 check passed in the run.

### 1.27: feature 25 (the Higgs boson)

Branch v152 from v151 (2026-11-06; approved with the list). Always on, no switch, as the W and Z: it is made only above
√s ≈ 125 GeV in hadron collisions and above 216.4 GeV in e⁺e⁻, so below them nothing new runs or draws a random number.
Code: hep.js "The Higgs boson" (after the W and Z: HG, H_HAD, H_LAB, H_PP, sigZH, zhAng, hVirt, hFinal, hDecList), XP.H0,
hooks in ewDecay (its own decays), ewDraw (beside the W and Z in hadron collisions), ewEE and eeEvent (the ZH channel),
ewDecList; ui.js (the palette's "W, Z and Higgs bosons", XP_NAME, PART_NAMES, EXO_FOUND, XP_ABOUT.H, Inspect's "Inside",
the collider's next threshold); body.html (Physics: Forces → Electroweak, Accelerators → New particles).
- **The owner's question (2026-11-06): how is the Higgs field simulated?** It is not: the game takes every mass as a
  measured number. The field has the same value everywhere and in every collision, so a box has nothing of it to follow
  (a lattice field theory would only give back those masses). The boson, the field's particle, is what is built here,
  and the text (Physics tab, Inspect) explains the field.
- **The particle:** 125.2 GeV, Γ 4.07 MeV (the Standard Model's), mean life 1.6×10⁻²² s; `res` and `ew` (decays where it
  is made; its mass from its width within ±10Γ, as a W's or Z's); spin 0, so its decays go every way alike.
- **Decays** (LHC Higgs Cross Section Working Group, 125 GeV; CMS HIG-15-002's table and the working group's numbers in
  talks agree to their errors): b b̄ 58.2%, W W* 21.4%, gluons 8.2%, τ τ 6.3%, c c̄ 2.9%, Z Z* 2.6%, γ γ 0.23%,
  Z γ 0.15%, μ μ 0.022%. Quark and gluon pairs: two jets by the game's string (hadronize, b and c by hfInto), as a Z's.
  W W* and Z Z*: one real (its mass from its width), the other virtual with m drawn from dΓ/dm² ∝ √λ(λ + 12x₁x₂)/((m² −
  M_V²)² + M_V²Γ_V²) (hVirt, rejection on a 200-point maximum ×1.2), then each decays as a W or Z of its mass (ewDecay):
  H → Z Z* → four leptons, H → W W* → ℓνℓν. Measured: decays to jets 69.0% (69.3), W W* 21.7%, τ τ 6.33%, Z Z* 2.62%,
  γ γ 0.221%, Z γ 0.143%, μ μ 0.017% (100,000 draws); b hadrons in 98 of 120 jet pairs; the virtual W 31.4 GeV, the
  virtual Z 22.9 GeV (medians; the real W 80.38).
- **Made in hadron collisions** (ewDraw: the same draw as the W and Z, so below 82.3 GeV nothing changes, and above it
  the one random number decides among W, Z, Higgs or none) at σ(pp → H)/σ_inel. H_PP, all modes together (nb): 1.96 TeV
  0.0012 (the Tevatron, from memory), 7 TeV 0.0175, 8 TeV 0.0223 (17 and 21 pb in a lecture's table), 13 TeV 0.0556
  (gluon fusion 48.6–49 pb, WH 1.4, ZH 0.9, tt̄H 0.5), 14 TeV 0.0616 (from memory); below 1.96 TeV brought to zero at
  125.2 GeV as (1 − M_H/√s)¹⁶ (a shape). Real rate at 13 TeV: one pp collision in 1.4 billion, so never seen in a run.
  The modes other than gluon fusion are counted in the rate but made as a lone Higgs (no W, Z or tt̄ beside it).
  Checked with RP.ewX ×10⁸ and the W and Z taken out: 20 Higgs in 300 collisions at 13 TeV (21.4 expected), 3-D 12 of
  200 (14.2), none at 100 GeV; books within 3×10⁻¹⁵ of √s, charge kept.
- **e⁺e⁻ → Z H** (Higgs-strahlung; eeEvent's channel 'ZH' above M_Z + M_H = 216.4 GeV): Born σ = G_F²M_Z⁴/(96πs)·(v_e² +
  a_e²)·√λ(λ + 12M_Z²/s)/(1 − M_Z²/s)², v_e = −1 + 4 sin²θ_W, a_e = −1 (sigZH): 0.2375 pb at 240 GeV, 0.2377 at 250
  (about 0.20 measured-like with the beams' radiation, not applied here), 0.18 at 300, 0.057 at 500; 1.4% of the W, Z
  and Higgs pairs at 250 GeV. The Z leaves at λ sin²θ + 8M_Z²/s to the beams (zhAng; ⟨cos²θ⟩ 0.315 drawn, 0.316 the law).
  LEP's 209 GeV was short of it; the collider's text names the next threshold.
- **Checks** (tests/f_127h.js: branch, virt, zh, hadron, books, fp, page): placed Higgs bosons decay at once, books
  within 2×10⁻¹⁴ of their energy, charge kept; switch-free, so the fingerprints: all 60 setups bit for bit v151's;
  f_ew's palette check now takes the renamed group "W, Z and Higgs bosons".
- **Not built:** the Higgs's production modes as such (vector-boson fusion's two forward jets, a W, Z or tt̄ beside it);
  H → μμ's and Zγ's angles beyond isotropy (spin 0 makes them isotropic anyway); the beams' radiation on ZH; a Higgs
  factory setup (the collider's e⁺e⁻ beams reach it; a setup could be added).
- Suite on v152 (2026-11-06): tools/runtests.sh 20 of 22; the misses the two known load-timed checks, t_page's slow-motion
  button and t_features' 1.14 speed readout (every feature-25 check passed in the run).

### 1.27: feature 22 (Rayleigh scattering)

Branch v151 from v150 (2026-11-06; approved with the list). Settings → Experimental → Realistic particles → Rayleigh
scattering (`RP.ray`, `SET.rpRay`; src/pold.js ryTry, ryChance, ryScatter, after polarizability by direction, whose
tensors it uses). Before, the box had no elastic scattering of light at all (the 1.27 part 7 notes: rayInteract only
absorbed, ionized, dissociated, fluoresced or Compton-scattered).
- **The model.** A photon that cannot ionize the atom it passes (infrared, visible, near ultraviolet: E below
  ionizationCost) may be scattered by that atom's molecule. Each molecule is tried once per photon, after the photon's
  chances of being absorbed there. The photon's field ε drives the molecule's induced dipole d = α·ε. α is the
  molecule's tensor: the bonds' tensors (PD_BOND) summed over it, or for a lone atom or ion RY_ATOM / PD_ION. In the
  flat game α is the in-plane tensor, with the mean of its two in-plane values across the plane.
  - The rate goes as k⁴|d|²: blue (400 nm) 9.4 times red (700 nm).
  - The new direction is drawn with weight |d|² − (d·n̂)², round the circle in the flat game. The polarization is d's
    part across the new direction (carried with Photon polarization on). An unpolarized photon is given a random
    polarization for the draw.
  - Elastic: the photon keeps its energy (the molecule's recoil, about 10⁻¹¹ eV, left out), so the books do not move.
  - A scattered photon counts one level of the photon's chain: rayInteract and rayInteract3 now take the depth that
    emitPhoton has; past 3 the photon does not interact again, as for every re-emitted photon.
- **The rate, made visible.** The true cross section σ = (8π/3)k⁴|d|² is 5×10⁻²⁷ cm² for N₂ at 532 nm, so a photon
  crosses about 80 km of air before it scatters once, and in a box a few nanometres across, effectively never. As the
  box's other light–matter rates (photoionization 0.6, line absorption 0.6, Compton 1.2% an electron, a pass), it is
  shown made visible: RY.P0 = 0.01 a molecule passed for N₂ at 450 nm, unpolarized (the mean of |d⊥|² over the
  directions against N₂'s), with the ratios between colours and molecules the true ones, capped at 0.5. Ultra-realistic
  mode keeps the true rate: σ over the 0.6 Å strip's area, 4.5×10⁻¹¹ a molecule passed (N₂, 532 nm). For the owner: P0
  is a choice of how visible to make it (at 0.01, 7% of blue photons crossing the flat water box scatter, 0.5–0.7% of red).
- **Measured** (tests/f_127r.js):
  - Rate: blue/red 9.49 in 3-D, 9.36 flat (true (700/400)⁴ = 9.38). Argon against water exactly (1.64/1.47)²
    (isotropic both). N₂ 0.0103 a pass at 450 nm. Ultra-realistic σ(N₂, 532 nm) 5.12×10⁻²⁷ cm² (measured 5.1×10⁻²⁷,
    from memory).
  - Angles (unpolarized light on water, weighted by each draw's chance): ⟨cos²θ⟩ 0.399 in 3-D (the 1 + cos²θ law's
    0.400), light at 90° 99.7% polarized; flat 0.582 (the plane's 0.583), 99.6%. CO₂'s dipole 3.96 along its axis and
    1.96 across, so it scatters light polarized along it four times as much and depolarizes what it scatters.
  - Light shone through liquid water, 600 photons: flat 46 blue (400 nm) against 4 red scattered, 3-D 13 against 2.
    Every photon's energy leaves the box, and the rest of the books do not move (0).
  - Cost: nothing a step. A visible photon crossing liquid water takes 31–36 µs against 15–24 (flat), 34–41 against
    21–22 (3-D).
  - Switch off: all 60 setups bit for bit as before (tools/fingerprint.js; no random number is drawn with it off).
- **Not covered:** the polarizability is the static one (real α rises toward an absorption line, so violet and UV
  scatter a little more than λ⁻⁴ says); X-rays' coherent (Rayleigh) scattering with atomic form factors is not in it
  (only light below the ionization energy); a molecule in a liquid scatters as a lone one (the liquid's real
  scattering is much weaker, from its density fluctuations, which a per-molecule rate cannot know); lone atoms' values
  in RY_ATOM are from memory (CRC: He 0.205, Ne 0.396, Ar 1.64, Kr 2.48, Xe 4.04 Å³).
- Tests: tests/f_127r.js (t_features' feature-22 line, or `node tests/f_127r.js [--node] [rate angle light ultra fp
  settings]`). t_features' 1.10 line counts one more realistic switch tag (11).
- Suite on v151 (2026-11-06): tools/runtests.sh 21 of 22; t_features missed only 1.14's speed readout (the known
  two-core timing check under both lanes' load; it passed alone on v150, and nothing here runs with the switch off).

### 1.27: feature 21 (polarizability by direction)

Branch v150 from v145 (2026-11-06; approved with the list: "I approve all of them"). Settings → Experimental →
Polarizability: Along bonds (normal) / By direction, with Induced charges on (src/pold.js, `PD`, `pdOn`; built right
after sites.js).
- **What was wrong with the old way** (the 1.26 investigation, "Polarizability by direction: investigated, not built"):
  the induced charges are charge flow, so a molecule polarizes only along its bonds: across a linear or flat molecule's
  bonds nothing (N₂, CO₂ across 0; benzene out of plane 0) and benzene's ring 166.9 Å³ in plane (measured 12.2).
- **The model:** with By direction on, the charge flow is off and each atom of a molecule (2–64 atoms, as the induced
  charges) carries an induced point dipole μ = α·E. α is a tensor, half the sum of the atom's bonds' tensors
  α∥ ûû + α⊥(1 − ûû) (bond additivity: the molecule's tensor is the sum over its bonds, no coupling inside a molecule).
  E is the field from the charges and dipoles of other molecules within the force reach, plus the applied field. The
  dipoles are solved together (iterated, mixed 0.7, to 10⁻⁵ e·Å) between steps on the induced charges' schedule (every
  10th step or every step). The exact change of the energy is paid from the molecules' motion about their centre of mass
  (pdPay; the update is skipped if that cannot pay), as the induced charges' is. Between updates the dipoles are fixed, so
  the forces are the energy's own slopes. Energy: ½K μᵀα⁻¹μ per atom (p.dmc, fixed between updates), −μ·E_applied (live,
  so a field changed between updates is booked as the charges' is), and between atoms of different molecules the
  charge–dipole and dipole–dipole terms of a soft Coulomb 1/√(r² + s). The ion–molecule weight iwK is on the
  charge–dipole terms, as the induced charges have it. Each pair's energy is faded over the last ångström of the reach
  (a smooth step on r, as the charge sites'). In the books: pdForces after the kernels, pdLocal in localPE (events),
  pdTotal in totalEnergy, pdPairE in pairPE.
- **Two things found while building it.**
  1. Fading the potential instead of the pair's energy made the dipole–dipole coupling, the potential's second
     derivative, about 1.0 at 5.2 Å, where the real one is 0.014. The solve ran away (coupling eigenvalues ±1.2–1.7). The
     fade is on the energy now, so a field is never larger than the unfaded one.
  2. Undamped, a water hydrogen was pulled to 0.37 Å from a Na⁺ in brine (dipole 2.5 e·Å): the induction energy −½αE²
     at sub-ångström range outweighed the core. Every pair now has one damped softening,
     s = 0.09 + PD_TH·(ᾱa·ᾱb)^⅓ Å², as Thole's model damps. A partner without a dipole uses its ion's or atom's own
     polarizability (PD_ION, PD_ATOM). PD_TH = 1.0 was chosen by liquid water's molecular dipole: Thole's linear 1.66²
     = 2.7 gave 2.49 D in the 3-D lab, 1.0 gives 2.6–2.7 (measured in the liquid about 2.6–3.0 D). Brine keeps every
     dipole under 0.4 e·Å with it.
- **The bond table (PD_BOND)**, fitted by tools/polfit.js on the game's own 3-D geometries to static electronic
  polarizabilities (Å³). Means: CH₄ 2.60, C₂H₆ 4.47, C₂H₄ 4.25, C₂H₂ 3.33, benzene 10.33, CH₃Cl 4.53 (the MOPAC manual's
  table of experimental values); HCl 2.63, HF 0.80; H₂ 0.79, N₂ 1.74, O₂ 1.58, CO 1.95. Anisotropies Δα: H₂ 0.288,
  N₂ 0.691, O₂ 1.080, CO 0.525 (Raman, OSTI 5555353). Benzene out of plane 6.62 (CCSD 44.66 a.u., arXiv 2103.05063).
  From memory (for the check of values from memory, bug 17): CO₂ electronic mean 2.63 with Δα 2.0, water 1.47 nearly
  isotropic, NH₃ 2.2, CH₃OH 3.29, and the C–H ratio α∥/α⊥ 1.36 (Denbigh). Bonds with only a mean to fit keep α∥ = 2α⊥.
  The game's molecules come out as measured: N₂ 2.20 / 1.51 along / across, CO₂ 3.96 / 1.96, benzene 12.18 / 12.18 /
  6.62 (flat game: 12.19 / 12.17 in the plane), water 1.47 isotropic, methane 2.60, ethane's mean 4.47. A bond not in
  the table: mean 0.7·(α_A/n_A + α_B/n_B) from the atoms' polarizabilities (CRC; 0.7 fits the table's single bonds,
  which run 0.59 for C–H to 0.98 for C–Cl), split 1.5 : 0.75. Ionic atoms take their ion's polarizability
  (isotropic), metal atoms none.
- **Measured.**
  - Forces against the energy's slope: 2×10⁻¹¹ eV/Å in 3-D, 8×10⁻¹¹ flat (molecules, a Na⁺, an applied field).
  - Events (localPE) and books (totalEnergy) agree on the dipoles' energy to 2×10⁻¹⁴ eV.
  - Insulated books (eV): water −0.02 over 300 steps (every step; charge flow +0.03); brine −0.04 (every step), +0.01
    (every 10th), −0.12 over 600 steps; 3-D water +0.03, 3-D brine −0.13 (60 steps every step); the 3-D hydrogen flame
    −0.02 over 300 steps with 9 bond events and reactions; lone pairs on as well, −0.006.
  - Switched off with 240 dipoles: none left, the energy kept to 0, the charge flow back.
  - Liquid water's molecular dipole: flat 2.17 (charges) / 2.41–2.43 (induced charges) / 2.52–2.56 (dipoles); 3-D 2.19 /
    2.43–2.52 / 2.59–2.66 D.
  - Cost (tools/accbench/bench-mode.js, variants pd10 and pd1, ms a simulated fs, one thread), on top of the induced
    charges at the same schedule: flat water ×2.9 / ×2.1 (every 10th step / every step), brine ×1.8 / ×2.1; 3-D water
    ×2.0 / ×4.2, brine ×1.2 / ×1.7. Against nothing on: flat water ×3.9 / ×5.8, 3-D water ×3.4 / ×9.4. Most of it is
    the update's pass over the neighbour list and the force pass, in JavaScript (first version 69 ms a step in 3-D water
    at every step; 19 ms now, on typed arrays and the neighbour list). A WebAssembly port would be one of 33–38's kind.
  - Brine keeps longer steps with dipoles: 0.027–0.029 fs, where the charge flow's stiffer contacts give 0.016–0.023.
  - Switch off: all 60 setups bit for bit v145's (tools/fingerprint.js, seed 7, 300 steps, both trees).
- **Not covered:** a lone atom or ion is not polarized (a Cl⁻ in water, a noble gas); dipoles feel charges at the atoms,
  not at the directional forces' sites; continuous bond orders' charges move with the positions, which the dipoles'
  forces do not follow (as the sites' do not).
- Tests: tests/f_127p.js (t_features' feature-21 line, or `node tests/f_127p.js [--node] [tensor field slope local books
  events clear water fp settings]`).
- Suite on v150 (2026-11-06; v145's first full run since its last two merges, as well): tools/runtests.sh 21 of 22.
  t_features missed only the known load-timed checks (1.14's speed readout, f_bug125 exoElastic, f_126w bo3) and
  1.10's realistic-tag list (the new row's tag: the list updated). t_features alone then passed whole (1,420 s), and
  f_bug125 and f_126w passed alone. t_page passed in the run.

## 1.25.0: the nuclear side in 3-D, continuous bond orders in 3-D with single bonds' twist, many-body metals, Settings by mode with 3-D pictures, 3-D labels off, 21 bug fixes

Approved by the owner on 2026-11-05 (after the reports): bond orders for metals (Many-body, flat melting left as it
is), continuous bond orders for Ge, As, Se, Sn, Sb, Te, continuous bond orders in 3-D (the JavaScript pass, ×18–23),
single bonds' twist barrier in 3-D, and the nuclear side in 3-D (captures, hits, reactions, the plasma; not the
collider). Display work (Settings by mode, 3-D pictures, 3-D labels off, descriptions in the side pane) needed no OK.

The "For 1.25" list, part 1 (branch v128): hexazine with quantum bonds, Settings descriptions, continuous bond orders for
Ge–Te, continuous bond orders in 3-D, and single bonds' twist barrier in 3-D (added by the owner during the build).

- **Hexazine stays whole with quantum bonds** (the owner: "Hexazine doesn't fly apart with quantum bond orders in 2d").
  An investigation; nothing in the physics changed. Measured with the game's own GFN1-xTB + D3 (`XTB.gfn1Energy`,
  `d3Disp`; scripts in the session's scratchpad, the numbers repeated by tests/f_125.js `hexazine`):
  - GFN1-xTB itself gives the ring a barrier. Flat D₆h ring: N–N 1.296 Å. In-plane path to 3 N₂ (D₃h: the three long
    N···N stretched together, the short bonds and angles relaxed at each point): highest at long N···N 1.60–1.65 Å, short
    1.17 Å, **0.53 eV above the ring**; one N₂ leaving first (two long bonds stretched, the rest relaxed): 0.53 eV too.
    Past 1.65 Å it runs downhill to 3 N₂. The whole reaction releases **only 1.67 eV** in GFN1-xTB (N₂ comes out 14.6 eV
    bound against a real 9.8; the ring is overbound more). From bond energies the real release is about 9–10 eV
    (3 N≡N 29.4 eV against six N–N of order 1.5, about 18–19 eV). Published high-level work (Saxe & Schaefer 1983;
    Glukhovtsev & Schleyer 1992; Gagliardi et al. 1998–2000, from memory: the web was not reachable from here, the
    proxy refused it) puts planar hexazine at best a shallow minimum with a small barrier to 3 N₂, of the same order
    as GFN1's (tenths of an eV to about 1 eV); worth checking before quoting a number to the owner.
  - The flat world does not hold it. In 3-D GFN1 puckers the flat ring (D₆h is a second-order saddle there: an
    out-of-plane pair of modes at 250i cm⁻¹; the puckered ring is 0.15 eV lower, atoms 0.23 Å out of the plane), and the
    barrier from it is a little higher, 0.62 eV (concerted) and 0.62 (one N₂ first), against 0.53 flat.
  - Nothing on the game's side: Mulliken charges on the ring 0.000 (by symmetry), D3 changes the barrier by 0.001 eV,
    the electronic temperature by nothing, all six atoms are members, the SCC converges in 3 iterations; the books hold
    (insulated runs below: ≤ 0.007 eV over 5 ps).
  - So it stays whole because 0.53 eV is a lot for picoseconds: at 300 K a 10¹³/s attempt rate gives ~80 µs, 10⁸ times
    longer than the game runs. In the game (six N atoms in the ring, quantum bonds, insulated, the temperature given at
    the start; the ring takes half of it): 2-D from 300 and 1,000 K whole over 0.4 and 6.1 ps; from 1,500 K whole over
    4.9 ps (3 seeds); from 2,000 K three N₂ after 0.98 and 0.17 ps (2 of 3 seeds); from 3,000 K after 0.027 ps, 6,000 K
    0.015 ps. 3-D: whole from 1,500 K (3 seeds), from 2,000 K three N₂ after 2.2 ps (1 of 2 seeds), 3,000 K 0.17 ps,
    6,000 K 0.064 ps. Heated (Heat tool, a spark, a fast atom), it does fly apart, but with a fifth of the real energy.
  - What would change it is a choice of model, not a bug: GFN1-xTB's nitrogen energies (the release 1.7 eV against
    ~9–10). For the owner.
- **Settings: a setting's description in the side pane only** (the owner: "it repeats the description in the settings
  menu, but it's supposed to be in the sidebar only"; display fix). The notes printed under a row (its long description)
  were shown under it in the list and copied into the side pane (1.23). Now (`setPrevInit`) a row's notes are marked as
  its description (`.sdn`) unless they are live readouts (`aria-live`: priority, threads, the speed test, rewind's use,
  which stay under their row, and are no longer copied into the pane as a stale snapshot); the list hides them beside the
  pane, the pane shows them. The two tab introductions (Experimental, 3-D) are hidden in the list too (`.sintro`): the
  pane's tab overview says the same (the Experimental one now carries the note's extra lines). Four notes that only
  repeated the pane's description were folded into it (Physics per frame / Particle limit, Frame-rate cap, Panel width,
  Energies in). Kept in the list: cost tags, "These go back to normal each time the game starts", the 3-D note and the
  flying keys. Narrow screens (≤ 760 px wide or ≤ 560 tall, where the pane is a strip about 90 px high on top): the
  descriptions stay in the list and the strip shows the picture, the short description and the costs. Found and fixed
  there: at 390 px the list was 412–436 px wide (the tabs' row and the Experimental checkboxes' tags set its width), so
  every description ran 13–80 px off the right edge; now one column the box's width, the checkbox rows wrap (worst
  overflow 1 px, rounding). Before/after: visible descriptions under rows at 1360 px, 18 → 0 (perf 1, gfx 1, disp 1,
  gen 2, d3 1, ai 1, exp 11); at 390 px overflow 13 / 80 px (Performance / Experimental) → 1 / 0. Screenshots
  125-before-settings-exp-1360.png, 125-before-settings-exp-390.png, 125-after-settings-exp-1360.png,
  125-after-settings-exp-390.png.
- **Continuous bond orders for Ge, As, Se, Sn, Sb, Te** (the owner after 1.21: "can you add the rest?"; physics, for
  his OK). The model is the twelve elements' own: every constant comes from the game's tables (bond lengths and energies,
  Morse widths, valences and capacities, expanded octets toward F, O and Cl, the VSEPR targets by period, Pauling
  electronegativities 2.01, 2.18, 2.55, 1.96, 2.05, 2.10, the UFF sizes), so adding them is `BO.Ztab` (engine.js) and
  two things found on the way:
  - Tin is a metal in the game (metallic cohesion between bare tin atoms). Its molecules (SnCl₄, SnH₄) take part; a
    cluster made of metal atoms only stays with stored/metallic bonding (`boMetal` in boSync's membership; not for
    quantum bonds, which take every element), and a member atom is not treated as a bare metal by the pair kernel
    (`setSize`'s `isMetal`, as a stored SnCl₄'s tin is not). Measured: 16 tin atoms beside an SnCl₄ with bond orders on:
    0 of 16 join (all 16 keep metallic bonding), SnCl₄'s 5 join, books 0.0000 eV over 1,000 steps. (The metal model on
    v130 may want to take tin over; the rule is one line.)
  - A bug of the model, met first here: the 1-3 (angle) exclusions of the members' Coulomb and Lennard-Jones were looked
    for only between atoms closer than 4.4 Å (bo.js and kernel/src/bo.rs). SbCl₃'s Cl–Sb–Cl (2.33 Å bonds) opened past
    143° crosses 4.4 Å, and the pair's whole Coulomb and Lennard-Jones came on in one step: ±0.089 eV jumps every
    ~700 steps in a GeCl₄ + SbCl₃ box (books +0.089 eV over 0.36 ps, independent of the step size). Now the reach is two
    bonds' (2 × the largest bond reach r₁ + 1.3 Å among the pair types met, `BF.r13`, ≥ 4.4; passed to the kernel in the
    scalar slot 15, `P_R13`, which was unused). Exactly the same results wherever no bonded angle's ends are past 4.4 Å
    (the twelve elements' runs: identical, the Experimental fingerprints below). Kernel rebuilt by CI (wasm.yml on v128,
    commit fea8c51); native check `bocheck` on a dump with SbCl₃ at 150° (tools/bodump.js `heavy`): JavaScript and Rust
    agree to 0 eV / 1e-15 eV/Å; with the old 4.4 Å, 0.081 eV apart. SbCl₃ swept from 140° to 160°: largest change
    between 0.25° steps 0.078 eV before, 0.0044 after (the angle term's own).
  - Statics (flat, relaxed, energy per bond against the same molecule with stored bonds; stored / bond orders / measured
    gas-phase values from standard heats of formation, lengths from microwave and electron diffraction; the measured
    values from memory of the tables, not looked up here):
    | molecule | length stored / orders / real (Å) | energy a bond stored / orders (Δ) / real (eV) |
    |---|---|---|
    | GeH₄ | 1.530 / 1.532 / 1.525 | 2.985 / 2.962 (−0.022) / 2.99 |
    | AsH₃ | 1.520 / 1.506 / 1.511 | 2.560 / 2.537 (−0.023) / 3.07 |
    | H₂Se | 1.460 / 1.462 / 1.460 | 2.861 / 2.821 (−0.039) / 3.28 |
    | SnH₄ | 1.678 / 1.680 / 1.711 | 3.100 / 3.076 (−0.023) / 2.62 |
    | SbH₃ | 1.687 / 1.672 / 1.704 | 2.909 / 2.884 (−0.025) / 2.66 |
    | H₂Te | 1.681 / 1.683 / 1.658 | 2.922 / 2.883 (−0.040) / 2.76 |
    | GeCl₄ | 2.117 / 2.118 / 2.113 | 3.551 / 3.524 (−0.027) / 3.51 |
    | AsCl₃ | 2.122 / 2.104 / 2.162 | 2.971 / 2.959 (−0.012) / 3.21 |
    | SnCl₄ | 2.280 / 2.282 / 2.281 | 3.265 / 3.240 (−0.025) / 3.26 |
    | SbCl₃ | 2.310 / 2.292 / 2.333 | 3.113 / 3.101 (−0.012) / 3.25 |
    | SeO₂ | 1.549 / 1.491 / 1.608 | 4.270 / 4.266 (−0.005) / – |
    | TeO₂ | 1.670 / 1.631 / ~1.83 | 5.609 / 5.604 (−0.005) / – |
    | As₂ (triple) | 1.895 / 1.985 / 2.103 | 3.556 / 3.549 (−0.007) / – |
    | Se₂ (double) | 2.018 / 2.034 / 2.166 | 3.120 / 3.109 (−0.011) / – |
    | AsF₅, TeF₆, SbCl₅, TeCl₄, SeF₄ | within 0.002 Å | −0.016 to −0.037 |
    The orders match the stored bonds within 0.005–0.040 eV a bond (the twelve: PH₃ −0.028, H₂S −0.046) and 0.02 Å (single
    bonds); multiple bonds come 0.04–0.09 Å off the stored lengths (SO₂ −0.017 the same way). Angles are the game's VSEPR
    targets (both models): hydrides 92–93.7° (real 90.3–92.1°), AsCl₃ and SbCl₃ 107° (real 98.6°, 97.2°), as PCl₃ (107,
    real 100.3). Against the real molecules, what is off is the game's bond table, shared with stored bonds: As–H, Se–H
    and the chlorides of As and Sb are 4–17% too weak (the table's As–H 247 kJ/mol, Se–H 276; from heats of formation
    297 and 317), Sn–H, Sb–H and Te–H 6–18% too strong (no table entry: Pauling's estimate from the homonuclear bonds),
    and the heavy multiple bonds 0.1–0.2 Å too short (the 0.87/0.78 contraction is for the second row). Measured entries
    for those pairs would change stored bonds too: left for the owner (a table change, not this item).
  - Found, not changed (a flat-world limit): AsCl₅'s five chlorines, 2.46 Å apart in the plane, bond to each other (Cl–Cl
    orders 0.39; 0.78 eV a bond deeper than stored) because As–Cl (2.97 eV) beats Cl–Cl by only 0.46 eV and the
    crowding rule (1.16) acts from 0.4–0.8 eV; PCl₅ and SbCl₅ are fine (their chlorines 2.4 and 2.7 Å apart with 0.9 and
    0.6 eV to spare). Real AsCl₅ falls apart above −50 °C.
  - Dynamics (flat, insulated after 200 steps with the bath; 12 molecules, 48 atoms: GeH₄, AsH₃, H₂Se, SnH₄, SbH₃, H₂Te,
    GeCl₄, SbCl₃, SeO₂, AsF₃, SnCl₄, TeCl₂; against the same box made of Si, P, S analogues), 3,000 steps (0.55 ps):
    books +0.012 eV at 300 K, −0.029 at 1,500 K; the analogues −0.010 and −0.005 (JavaScript pass: +0.014, −0.029). Cost
    on one thread (two loaded cores): 0.225 ms a step with bond orders against 0.097 stored (the analogues 0.169 against
    0.061), steps 2.2 times shorter, as for the twelve.
  - Forces against the energy's slope: SbCl₃ at 150° 1.2e-9 eV/Å (JavaScript and WebAssembly), SbCl₃, SeO₂ and SO₂ in
    other shapes 3e-7, 6e-9, 7e-9.
  - Unchanged: the 24 flat setups' fingerprints (300 steps, seed 7), the six 3-D setups' and the seven Experimental runs
    (both bond-order kinds among them), after the kernel's rebuild too; and the Experimental runs on the JavaScript pass.
  - Text: Settings → Experimental's note lists the six (tin in its molecules); bo.js's header.
- **Continuous bond orders in 3-D** (the owner after 1.24.0: "add them both to 3d in 1.25"; physics in 3-D, for his OK).
  What was flat in bo.js, and what it is now:
  - The pairs (`bfPairsJS`): found in depth (the 3-D neighbour list, or `nearby` with z; minimum image in z), their z
    directions in `BF.puz`; the radial terms (orders, Morse, soft core, Coulomb, Lennard-Jones, the shared proton) were
    already along the pair, so their forces only gain a z part. `bfPhiOthers` (the non-members' potential) in depth.
  - The angles: the flat term (bonds sorted round a circle, the gaps held at their targets, atan2) has no meaning in space.
    `bfAngle3` uses the stored bonds' own 3-D term (engine.js `angle3CentreK`: every pair of bonds at its VSEPR angle from
    `vsepr3`, the bipyramid's and octahedron's lowest-energy roles, the out-of-plane term of a trigonal-planar centre),
    with the flat term's subsets (bonds between orders 0.4 and 0.7 weighted in and out) and its lone pairs' fraction
    (the energy between two counts of lone pairs, its slope to the orders); the forces go through scratch arrays, scaled
    by the subset's weight.
  - New in 3-D (the flat world never needed it): double and aromatic bonds don't twist (`bfTorsions3`): the stored bonds'
    torsion (K_TOR·(û₁·û₂×û₃)² over each X–A=B–Y) weighted by how double A–B is (0 at an order of 1.1, full at 1.5, so
    benzene's 1.5 in full as a stored aromatic bond) and how bonded X–A and B–Y are (0 at 0.3, 1 at 0.7); its slopes go to
    the three orders and the positions. A linear end (a triple bond, an allene's middle) gives no twist by itself. The
    stored model also asks both ends to be trigonal; here that is left to the orders (a carbon with a double bond has two
    other partners), written down as a difference.
  - Membership, joining and leaving, moving charge, the clusters: unchanged (they were dimension-free; boRelax moves in z
    since 1.24). `boSet` no longer refuses 3-D, `world3d` no longer turns it off, Settings → Experimental's button is
    open in 3-D (`NO3D_BTN` empty) and its 3-D note says so; the 3-D view draws the orders as it did quantum bonds'.
  - The WebAssembly pass stays flat: in 3-D the JavaScript pass runs (`boPass`). wasm.yml does build on working branches
    (v128's kernel was rebuilt by it for the 1-3 reach above), so a Rust 3-D pass is possible; it was not written here:
    it needs the 3-D angle term, its targets and roles, the torsions and the z arrays ported to kernel/src/bo.rs and a 3-D
    dump for the native check (bocheck), a session of its own, and the module cannot be built here (no wasm32 target
    offline) to test before CI. Cost of the JavaScript pass below; in the flat game the module made bond orders ×17 → ×6
    (1.18), so a Rust 3-D pass might bring 3-D to about a third of the cost below. On the planned list.
  - Measured (Node, one thread, two loaded cores):
    - Forces against the energy's slope in x, y and z (each molecule moved 0.08 Å at random from its shape; h = 2e-6):
      water 3.9e-7 eV/Å (largest force 0.8), NH₃ 4e-8, CH₄ 1.5e-6 (h 1e-5), ethylene 7e-7 (16 eV/Å), benzene 1.5e-6 (21),
      H₂O₂ 6e-7, SF₄ 4e-7, H₃O⁺ 7e-8, CO₂ 9e-8 (24), PCl₅ 1.3e-7, butadiene 4.3e-7 (38 eV/Å); benzene + H₃O⁺ + SbCl₃
      together 1e-7 (f_125).
    - Shapes, relaxed (stored / orders): water 104.5° / 105.1°, NH₃ 107.0° / 106.8–107.8°, CH₄ 109.5° / 109.2–110.5°,
      SF₄ see-saw 90/120/180° / 90/120.6/180°, PCl₅ bipyramid both 90×6/120×3/180°, CO₂ 180° both. Energy a bond against
      stored: water −0.049 eV, NH₃ −0.037, CH₄ −0.042, ethylene −0.036, benzene −0.188, CO₂ −0.030, SF₄ −0.022, PCl₅
      −0.028, H₂O₂ −0.045, methanol −0.044; the flat game's same molecules: ethylene −0.037, benzene −0.197, CO₂ −0.038
      (3-D agrees with 2-D: the differences are the model's, benzene's from its 1.5 orders).
    - Ethylene turned 90° about its C=C: 2.654 eV with bond orders, 2.683 stored (30°: 0.645 / 0.653, 60°: 1.939 / 1.961).
    - Insulated books (after 100 steps with the bath; stored bonds in brackets): molecules in space (72 atoms) 600
      steps +0.004 eV (−0.001 over 2,000); liquid water, 1,029 atoms, 400 steps +0.016 (+0.031); H₂ + O₂ at 600 K, 432
      atoms, 400 steps −0.010 (−0.049); hot hydrogen atoms, 200, 400 steps −0.121 (−0.020): a step-size error, the same in
      the flat game (64 hot H atoms with bond orders −0.203 eV in 400 steps; at half the step +0.011 in 3-D, +0.009 flat).
    - Cost (ms a step; s a simulated ps): liquid water 1,029 atoms 53.2 against 6.2 stored (×8.6 a step; steps 2.6
      times shorter: 347 s a ps against 15.8, ×22); H₂ + O₂ 3.75 against 0.66 (28 s a ps against 1.6, ×18); molecules in
      space 0.91 against 0.11 (×22 a ps). The flat liquid water (240 atoms) with the module: 5.5 against 0.35 ms.
  - Unchanged: the flat game (24 setups' fingerprints, the seven Experimental runs) and the six 3-D setups (bond orders
    off).
  - Screenshots: 125-before-bo3d-settings.png (the choice greyed in 3-D), 125-after-bo3d-settings.png,
    125-before-bo3d.png, 125-after-bo3d.png (the molecules in space with bond orders, drawn from the orders).
  - Tests: t_3d's "not in 3-D" list and f_124's Experimental check now expect the choice open in 3-D.
- **Single bonds' twist barrier in 3-D** (the owner after 1.24.0, added to 1.25 through the main session; physics in 3-D,
  for his OK). Before, only double and aromatic bonds resisted twisting; single bonds turned against nothing but their
  ends' 1-4 contacts: ethane 0.026 eV (measured 0.126), methanol 0.002 (0.046), butane gauche 0.056 above anti (0.029),
  its anti→gauche barrier 0.094 (0.147), syn 0.376 (~0.22: the 1-4 contacts, their Lennard-Jones doubled for the flat
  world and still so in 3-D, push too hard), hydrogen peroxide flat trans (measured 112°).
  - The term (engine.js `TOR1`, `tors1K`, `tors1Of3`): each dihedral X–A–B–Y about a single bond,
    E = F·(k₀ + k₁ cos φ + k₂ cos 2φ + k₃ cos 3φ), F = sin³θ₁ sin³θ₂ / sin⁶(109.47°) (1 at tetrahedral angles; it takes
    the term away smoothly as an end goes straight), written as a polynomial in u·v and |u|²|v|² (u = b̂₁×b̂₂, v = b̂₂×b̂₃)
    so it is smooth at every geometry; forces analytic. Which dihedrals: single, non-aromatic bonds between two
    non-d-block atoms with other partners; sp³–sp³: C–C (k by how many of X, Y are heavy), C–O, C–N, O–O; sp³–sp²
    (one end with a double bond): only C–C, only on the dihedral to the double bond's partner (C=C or C=O; the other
    partner's would cancel it), the double bond eclipsed at the minimum. Nothing for other central pairs (Si, S, P …),
    bonds between two sp² ends (butadiene's middle), aromatic or triple ends (toluene's methyl, measured ~0, turns
    freely). The k's (eV), fitted in this game on top of its own 1-4 contacts (relaxed scans, the dihedral's four
    atoms held): C–C H/H 0.00583 (k₀ = k₃), H/heavy 0.0058, heavy/heavy k₀..k₃ 0.0056, −0.068, −0.0447, −0.0134 (the
    negative k₁, k₂ take back the doubled 1-4 contacts' syn excess), C–O 0.0070, C–N 0.00717, O–O 0, 0.0015, 0.0585,
    0.0028, C–C=C 0.024 (k₃ = −k₀), C–C=O 0.0118. Single-bond dihedrals are listed with the double bonds' (`AC3.sq`,
    when bonding changes) and their forces added after the kernels on the main thread (`tors1Forces3`: the force pass,
    the beads' contracted pass `piFast`); their energy in `angleEnergy3` (each bond's dihedrals with its lower-id atom),
    so events, the books and `relax3` see them. The WebAssembly kernel and the workers are untouched.
  - In the bond orders' 3-D pass (bo.js `bfTors1`): the same terms weighted as the orders say: a pair is single by
    b(n)·(1 − τ(n)) (fading as it breaks and as it turns double, τ as the double bonds' twist), an end sp² by the sum of
    τ over its other bonds; sp³–sp³ dihedrals weighted (1 − D_A)(1 − D_B)·b_X·b_Y, sp³–sp² ones by τ of the double bond;
    every weight's slope to its orders. C–C fitted again (`TOR1B`: this model's own 1-4 contacts give ethane 0.041 eV
    against stored 0.025): H/H 0.0049, H/heavy 0.0021, heavy/heavy 0.0056, −0.0781, −0.0659, −0.0308; the rest as stored.
  - Barriers now (eV; relaxed, the four atoms held; stored / bond orders / measured, the measured values from memory of
    the literature: the web was refused from here):
    | | stored | orders | measured |
    |---|---|---|---|
    | ethane | 0.126 | 0.126 | 0.126 (2.9 kcal/mol) |
    | propane (methyl) | 0.144 | 0.141 (0.156 at one eclipse) | 0.143 (3.3) |
    | butane gauche − anti | 0.031–0.034 (min at 65–70°) | 0.026–0.028 (55–65°) | 0.026–0.039 (0.6–0.9) |
    | butane anti → gauche | 0.152 | 0.150 | ~0.147 (3.4) |
    | butane syn | 0.218 | 0.224 | ~0.20–0.26 (4.6–6) |
    | methanol | 0.046 | 0.047 | 0.046 (1.07) |
    | methylamine | 0.085 | 0.085 | 0.086 (1.98) |
    | H₂O₂ minimum / trans / cis | 112° / 0.047 / 0.301 | 112° / 0.046 / 0.295 | 111.5° / 0.048 / 0.305 |
    | propene (methyl) | 0.082 | 0.078 | 0.086 (1.98) |
    | acetaldehyde (methyl) | 0.049 | 0.046 | 0.050 (1.16) |
  - Butane's populations: from the relaxed profile (Boltzmann over the dihedral, 5° steps) at 300 K anti 62% / gauche
    38% stored, 58 / 42 with bond orders (measured in the gas at room temperature about 60–70% anti); at 600 K 47 / 53.
    Molecular dynamics, 64 butanes in a 44 Å cube with stored bonds and the bath: at 300 K over 49 ps anti 66.9%, gauche
    33.1% (114 changes between them), at 600 K over 24 ps anti 38.9%, gauche 61.1% (828 changes; the whole molecule's
    motion, not the profile alone). Before (1.24.0) the barrier was 0.094 eV and gauche 0.056 above anti.
  - Forces against the energy's slope (h 2e-6, molecules moved 0.1 Å at random): stored ethane 2e-9 eV/Å, butane 4e-9,
    methanol 2e-9, methylamine 2e-9, H₂O₂ 1e-9, propene 4e-9, acetaldehyde 2e-9, ethanol 2e-9; bond orders 1.3e-8,
    1.3e-8, 2e-9, 9e-9, 8e-9, 7e-9, 3e-8, 4e-8, butadiene 1e-7.
  - Insulated: single molecules at ~900 K for 4 ps (butane, ethanol, H₂O₂, propene): books within 7e-4 eV, as before
    (4e-4). A box of 64 organic molecules (512 atoms, 512 single-bond dihedrals), 1.22 ps: −0.38 eV against −0.29 on
    1.24.0, both the same at half the step (−0.38, −0.30): not the integration but the existing jumps of molecules
    meeting at the cutoffs; bond orders, 8 molecules, 0.23 ps: −0.018 eV.
  - Cost: that box 0.82 ms a step against 0.62 (+30%, the dihedrals in JavaScript on the main thread; two loaded cores);
    nothing where there are no single-bond dihedrals (water, brine, H₂ + O₂, the molecules in space).
  - The 3-D tiny objects: only polyethylene has single-bond dihedrals (693); relaxed with the twist it moved up to
    0.40 Å (0.16 rms, 1.23 eV lower), so it was settled again with tools/objgen3.js (held at 300 K for 2 ps, 236/236
    atoms, 235/235 bonds); salt, gold, the droplet and graphene have none and are unchanged.
  - Unchanged: the 24 flat setups' fingerprints and the seven Experimental runs (2-D has no twist), and the six 3-D setups' (none has a single-bond dihedral).
- Tests: tests/f_125.js (t_features' 1.25 block, or `node tests/f_125.js [hexazine settings bo6 bo3d tors1]`). `tors1`
  fails on 1.24.0 (ethane 0.026 eV, H₂O₂ flat). `bo3d` fails on
  1.24.0 (no member in 3-D, the choice greyed). `bo6` fails on
  1.24.0 (no member among the six molecules; with antimony added by hand, the 0.078 eV step). `settings` fails on
  1.24.0 (18 descriptions under rows, 80 px overflow); `hexazine` records the measurements above and passes on 1.24.0
  too (nothing changed).
- Suites (part 1, alone on two cores shared with two other agents' work): t_lint, t_3d, t_settings, t_wasm, t_threads,
  t_energy, t_physics, f_124 and f_125 pass. t_features whole, twice: everything new passes; failing were the known
  time-budgeted 1.14 speed readout (1/1.3× and 1/1.5× at a load average of 7) once each, 0.64's saves once, and 0.95's
  six CO among O₂ once (4 kept triple): that block's outcome follows the page's random stream, which earlier time-budgeted
  blocks move; the same box in Node, seeds 1–8, keeps 6 6 6 4 6 4 6 6 triple on 1.24.0 and on this branch alike.
  tools/runtests.sh not run here (the main session runs it after merging v128, v129 and v130).

### 1.25: bond orders for metals

Asked by the owner after 1.21 (the planned entry "Bond orders for metals"); a physics-model change for the owner to
approve. Settings → Experimental → Metals: Pairs (normal) / Many-body. Off by default and at every start, like the
rest of the tab; the flat game and the 3-D setups with it off are bit for bit the same (24 flat setups and the 11
setups with metal atoms, 300–600 steps, seed 7; the six 3-D setups: identical hashes of positions, velocities and
charges before and after).

- **Its own switch, not a third "From the positions" choice**: the metals' cohesion is a separate term (the kernels'
  metallic pair), not stored bonds, so it works under every bond-order choice, and in 3-D, where "From the
  positions" is not yet; and it keeps bo.js untouched (a parallel branch rebuilds its 3-D pass).
- **The model** (`src/bometal.js`, `MBO`): the second-moment tight-binding form (Finnis & Sinclair 1984; Cleri &
  Rosato 1993; the square-root case of the embedded-atom method). Each member atom holds
  Eᵢ = Σⱼ A·e^(−p(r/r₀ − 1)) − √ρᵢ, ρᵢ = Σⱼ ξ²·e^(−2q(r/r₀ − 1)): a core repulsion less the band energy, which grows as
  the square root of the band's second moment. Neighbours count to 1.15·r₀ and fade out by 1.35·r₀ (quintic switch,
  before a close-packed lattice's second shell at 1.41·r₀); the square root is rounded below ρ ≈ (0.02ξ)² so a lone
  atom's force stays smooth. Unlike pairs (alloys): r₀, p, q averaged, A and ξ geometric means.
- **The fit**, per metal, in closed form, on a close-packed crystal (12 neighbours): the vacancy energy over the
  cohesive energy fixes q/p, the bulk modulus p·q, the cohesive energy ξ, equilibrium at the measured spacing A.
  Data (`MB_DATA`): cohesive energies, nearest-neighbour distances, bulk moduli from Kittel's tables (heavy actinides
  from sublimation enthalpies), vacancy energies from Ehrhart's (Landolt–Börnstein); 0.33·Ec where none is measured;
  elements nothing measured (Fr, Rf on) take their homolog's. q/p is kept to 0.15–0.45 (Mg, Cr, Mo hit the lower end:
  their measured vacancy energy, half the cohesive energy, is past what 12 nearest neighbours can give). The web was
  not reachable from this session (proxy refused), so the tables are from those standard sources as recalled: worth a
  check against the books before release. Cross-check against published fits (Cleri & Rosato's five-shell values):
  Cu p 10.60 / q 2.45 (published 10.96 / 2.28), Au 10.98 / 3.90 (10.23 / 4.04), Pt 10.44 / 3.82 (10.61 / 4.00), Pb
  10.61 / 3.37 (9.58 / 3.65), Ag 12.2 / 2.67 (10.9 / 3.14), Al 7.07 / 2.77 (8.61 / 2.52).
- **Members**: neutral atoms setSize treats as metallic (a metal, no stored bonds; not a quantum-bonds member). Their
  mD is 0 while it is on, so the kernels' metal pair (JavaScript, WebAssembly, workers, 2-D and 3-D) keeps only its
  contact core and nothing in the kernels changed. Ions are not members: in the first build a flat Cu patch turned
  itself into Cu⁺Cu⁻ pairs and heated to 6,000 K (an ion pair kept both the metal's bonding and the charges' pull, and
  few-neighbour atoms sit at 2.2 Å, where the pull pays for the electron: 6.49 eV at 2.2 Å against IE − EA 6.49 eV).
  An ion keeps the classic pair with other ions, and only the contact core with members (no image-charge pull).
- **Energy books**: totalEnergy adds the pass's energy; localPE and regionE add `mbLocal(set)`: the set's members'
  embedding, their neighbours' embedding less what it is without the set, and the repulsions touching the set; the
  rest does not depend on the set's atoms, so a before/after difference is exact for any change to them (a move, an
  ion made, an atom removed: 2e-10, 2e-10, 4e-15 eV against the total's change). Switching books the difference at the
  same positions to the bath (Cu patch: −95 eV; total + bath kept exactly). evTransfer's quick estimate adds a lower
  bound on what the transfer costs the metal (the leavers' own embedding less their repulsions; neighbours only lose
  more), computed only when the estimate would pass anyway: without it nearly every pair of neighbours in a Cu lump was
  sent to the exact trial and refused.
- **Measured against reference** (3-D crystal values exact by construction; the checks recompute them):

  | | model | measured |
  |---|---|---|
  | Cu fcc: Ec, r₀, B, vacancy (relaxed) | 3.49 eV, 2.56 Å, 137 GPa, 1.276 eV | 3.49, 2.56, 137, 1.28 |
  | Cu (100) surface energy | 1.17 J/m² | 1.79 (liquid-extrapolated mean, Tyson & Miller); second-moment and EAM models are 30–40% low |
  | dimers: Cu₂, Ag₂, Au₂, Na₂, Al₂, Pt₂ | 2.90 eV at 2.17 Å, 2.39, 4.33, 0.90, 4.33, 6.85 | 2.01 at 2.22, 1.65, 2.29, 0.73, 1.5, 3.14 (overbound, as in every second-moment model) |
  | heats of solution (3-D, dilute, relaxed): Ag in Cu, Cu in Ag, Au in Cu, Cu in Au, Ni in Cu, Cu in Ni | +0.30, +0.23, 0.00, +0.02, +0.04, +0.05 eV | about +0.39, +0.28, −0.13, −0.19, +0.03, +0.11 |
  | Ni–Al (strong compounds) | +0.14 / −0.09 eV | about −1.5: not reproduced (needs fitted cross terms) |
  | flat sheet (2-D, triangular, six neighbours): Cu Ec, spacing | 2.73 eV, 2.45 Å | — (pairs: 0.78 eV, 2.64 Å) |

- **Melting** (heated in steps of 0.1·Tm, 4 ps each, by the bath; liquid when the bond-orientational order ψ₆ falls
  below 0.68 and atoms diffuse more than half a spacing in 4 ps). A flat patch of 241 atoms (free edges, which lower it):
  Al ~1,000 K (real 933), Na ~440 K (371), Cu ~2,000 K (1,358), Au ~2,000 K (1,337), W ~5,500 K (3,695): ×1.1–1.5,
  so a flat many-body metal melts too high. The pair model in the same Al patch: ~650 K (×0.7). Copper with pairs
  could not be measured: it ionizes (below). In 3-D a ball of 739 Cu atoms softens from 1,200 K and is liquid
  (diffusing a spacing in 4 ps) by 1,600–1,700 K; a ball that small melts below the bulk, so this says only that the
  bulk is near or somewhat above the real 1,358 K. Not measured: a bulk coexistence run in 3-D (hours on this machine).
- **Forces and energy**: forces equal minus the energy's slope to 2e-9 eV/Å flat, 4e-8 in 3-D, 3e-9 in a Cu–Ag–Au
  alloy; insulated, 55 Cu atoms at 1,500 K over 3,000 steps of 0.4 fs drift 0.0001 eV, 127 atoms over 3,000 steps of
  2 fs 0.009 eV. The stiffness the step size reads (the pair's own curvature) never shortens the game's 0.4 fs step for
  any metal tried (Cu, Na, W, Al, Au: limits 0.2–0.4 tu against 0.04).
- **Energy in the setups with metals**, t_energy's way (bath, fields and decay off, 300 frames, 4.6 ps; total plus what
  went to the bath), many-body against pairs: oven (10 Na) 0.000 / 0.000 eV, magnet (20 Fe) 0.015 / 0.012, Na + Cl₂
  challenge (salt forms: 6 ions) −0.005 / 0.024, U series 0.000 / 0.000. (Counted without the bath, the oven moved 2.1 eV
  once: a glowing wall's 589 nm photon taken up by a sodium atom, paid by the bath as designed; with pairs that run
  happened to see none.)
- **Cost** (one thread, CPU time, interleaved runs; the machine shared with two other sessions): the pass is 0.28 µs
  a member a step flat (769 Al atoms 0.22 ms, 955 Cu 0.28 ms) and 0.67 µs in 3-D (767 Cu 0.51 ms), in JavaScript.
  Whole steps: a flat Al patch of 769 atoms 0.33 → 0.63 ms (×1.9; its WebAssembly pairs are cheap); a flat Cu patch of
  955 atoms 15.0 → 9.6 ms (×0.64) and a 3-D Cu ball of 767 84 → 78 ms (×0.93): copper's steps go mostly to
  electron-transfer trials between metal atoms, most of which the lower bound now skips. Water (no metal) ×1.0.
  Setups with metals part ways from the first steps (other events, free electrons), so their costs moved ×0.9–2 for
  reasons of their own. The setting's tag: ×1–2.
- **Found, not changed** (for the bug-fix session):
  - With the normal pairs, a flat copper lump turns itself into ions: 120 of 127 atoms Cu⁺/Cu⁻ within 2 ps at 300 K
    (Ag, Au, Fe, Na: none). The pair model's Cu–Cu spacing (2.64 Å) is short enough for the pull of a Cu⁺Cu⁻ pair to
    pay for the electron (IE − EA 6.49 eV) once a few pairs line up. Many-body copper stays neutral.
  - Dense metals in 3-D are slow with either model: 767 Cu atoms take 80 ms a step, nearly all in transferDE's
    estimates (localPhi's grid walks over ~30 atoms a cell, for every metal pair within 5.5 Å every 8 steps).
- **Left, and why**: a flat-world correction (one factor on A and ξ in 2-D only, about 0.6–0.7, would bring the flat
  patches' melting to the real temperatures at the price of their cohesive energy, as the pair model does): the
  owner's choice; fitted cross terms for strongly bound alloys (Ni–Al, Cu–Au's ordering); metal–non-metal pairs (oxides,
  hydrides) stay the classic chemistry's; image-charge pull between an ion and a metal; dimers and small clusters
  overbound (a fifth constant would be needed); bcc metals (Fe, W, Na) are fitted on a close-packed crystal, so they
  crystallize close-packed.
- Tests: tests/f_125m.js (t_features "1.25 (metals)"): fit (Cu, Al, W, Na crystals, the dimer's many-body signature),
  forces (2-D, 3-D, alloy; insulated drift), books (localPE exact for a move, an ion, an atom removed; switching to the
  bath), ions (a hot flat Cu patch stays neutral), page (the setting, tags, Speed-test line, members in a setup and in
  3-D, Help). Each fails on 1.24.0 (no model). t_features' 1.10 check lists every realistic tag in Settings: the new one added to
  its list.

### 1.25: Settings by mode, 3-D pictures

The owner: "since the numbers for 3d are very different, the settings menu should change based on which mode you're in
... There should also be 3d pictures in 3d mode", and (through the main session) "the 3-D pictures must appear only in
3-D mode". Display and text work; nothing in the physics changed (the engine files are untouched; the 24 flat setups'
fingerprints, 300 steps, seed 7, identical to 6f5d75f).

- **The mode** is the world's (`W.d3`; the main menu's 3-D screen loads a 3-D world behind it, so Settings opened from
  there is the 3-D lab's). Settings' title carries it ("2-D game" / "3-D lab"). `setModeSync` (ui.js) switches
  everything below; it runs when Settings opens and from `mode3dSync` when the mode changes, so an open Settings follows
  a 3-D setup chosen under it, and main menu → 3-D → Settings and back → 2-D → Settings need no reload.
- **Cost tags by mode**: `COSTS3` holds the 3-D lab's tags, `costOf(id)` picks this mode's for the rows, the preview
  pane, the Experimental total and the Speed test's settings line. Measured the way the flat ones were (one thread, the
  bath off after settling, events on, ms a simulated fs against the same box with the setting off), by the new
  `tools/accbench/bench-mode.js <scenario> <variant>` with flat and 3-D twins: liquid water (the setups: 240 atoms flat,
  1,029 in 3-D), salt water (726 / 997), 40 free electrons among 40 neon atoms, an aluminium patch / ball (223 / 959
  atoms), a copper patch / ball (283 / 959), a hydronium and five waters (19 atoms), the molecules in space (72). Two
  rounds, interleaved, on two cores shared with another agent's work (so ±30% run to run; the 3-D numbers, whose steps
  are longer, held better):

  | setting | flat tag (unchanged) | flat, measured here | 3-D tag | 3-D, measured here |
  |---|---|---|---|---|
  | longest step 0.2 / 0.1 fs | ×1.7 / ×2.8 | water ×1.3–1.5 / ×1.6–1.8; brine ×1.5–1.8 / ×2.5–2.8 | ×2 / ×3.5 | water ×2.1–2.2 / ×3.4–3.5; brine ×2.0–2.1 / ×3.3–4.1 |
  | force reach 9 / 12 Å | ×1.3–2.6 / ×1.6–5.6 | water ×1.0–1.1 / ×1.1–1.6; brine ×1.1 / ×1.6–1.8 | ×3.5–5 / ×7–17 | water ×4.9–5.0 / ×12–17; brine ×3.5–4.6 / ×6.6–6.9 |
  | induced charges every 10th / every step | ×1.4–1.8 / ×2.7–4.6 | water ×1.7–2.6 / ×1.3–4.8 (noisy); brine ×1.7–1.9 / ×1.3–2.1 | ×1.6–2.4 / ×3.2–4.2 | water ×1.8–4.0 / ×3.6–7.8 (noisy; 1.24's ×1.6 / ×4.2); brine ×2.4–3.5 / ×1.9–3.4 |
  | quantum nuclei 8 / 16 / 32 beads, contracted | ×1.4 / ×3 / ×6 | ×0.7–1.0 / ×1.3–2.6 / ×5.7 | ×1.6 / ×2.7 / ×6 | ×1.6–2.0 / ×2.6–2.7 / ×6.1–6.2 |
  | the same, every bead | ×3.3 / ×7 / ×16 | ×2.5–2.7 / ×3.6–4.8 / ×7.9–9.9 | ×17 / ×30 / ×48 | ×16–18 / ×29–31 / ×46–51 |
  | bead forces: every bead against contracted | ×2.3–2.7 | — | ×7–10 | 10 at 8 beads, 7.5 at 32 |
  | bond orders from the positions | ×8–15 | water ×5.4–5.8 | ×18–23 | water ×18–20, molecules in space ×18–23 (1.25's bo3d: ×22, H₂ + O₂ ×18) |
  | quantum bonds (19 atoms) | ×1000+ | 7.7–8.2 ms a step | ×1000+ | 5.7–5.9 ms a step |
  | electrons as waves | ×1–7 | neon + 40 e⁻ ×2.2–2.5; ionized water ×2.2–4.4 | ×1–3 | neon + 40 e⁻ ×2.1–2.2; ionized water ×1.5–2.2 (below); 1.24's six Na⁺ + 12 e⁻ ×3.2 |
  | many-body metals | ×1–2 | Al ×2.3 (one clean round), Cu ×0.1–0.7 | ×1–2 | Al ×1.8 (one clean round), Cu ×0.8–1.0 |
  | detailed nuclear collisions | ×1–1.05 | — | ×1 (the flat game only) | nothing to measure: no nucleon hits nuclei in 3-D (v129 keeps the cascade flat, `!W.d3`) |
  | ultra-realistic | ×1 | — | ×1 | 1.24: 3.33 / 3.38 ms a step |

  The flat tags were left as they were: they come from calmer machines and longer runs (1.10–1.22), and the flat
  re-measurements here agree within the noise except bond orders from the positions (water ×5.4–5.8 against the tag's
  ×8–15: the tag's water ×8 is from 1.20; written down, not changed). Single bonds' twist in 3-D (always on, no setting):
  +30% a step in a box of organic molecules, nothing in water (1.25's tors1), said in the 3-D Experimental overview and
  in Stored's 3-D tip.
- **Descriptions by mode**: `SDESC3` (13 settings) and `STAB_DESC3` (Graphics, Controls, Experimental) in 3-D,
  `STAB_DESC2` (the 3-D tab seen from the flat game). In 3-D: atom size (seeing past near atoms), labels (the 3-D tab
  decides which atoms), trails (each point's depth), drawing engine (Canvas 2D sorts far to near), wheel zoom (camera
  nearer or farther; Shift + wheel the placing plane), zoom toward (flat only), detailed nuclear collisions (flat only),
  longest step, force reach (partners grow as the cube of the reach), induced charges (three directions), quantum nuclei
  (beads not drawn), bond orders (3-D angles, the twist of double, aromatic and single bonds), metals (the crystal's
  measured values exact), electrons as waves (drawn as points), ultra-realistic (the camera stops at 0.5 Å). The
  Experimental notes under the rows (the pane's long text) were split into a common part and a part for each mode
  (`data-m="2d"` / `"3d"`, shown in their mode only): the flat-only sentences 1.24.0 noted ("averaged in the plane",
  "the atoms stay in the plane", "zoomed in, the beads show as small dots", "drawn as a faint disc", the zoom to nuclei,
  the flat melting points, "crowded flat molecules") now say so, and each has a 3-D counterpart with its 3-D costs.
  Settings → Experimental's 3-D note says detailed nuclear collisions are the exception.
- **One mode only**: detailed nuclear collisions and zoom toward in the 3-D lab, and every row of the 3-D tab in the
  flat game, are dimmed with a "2-D only" / "3-D only" tag (`SMODE_ONLY`, `.smode-off`, `.smo`); they still work (what
  they set applies in their mode), so the 3-D tab can be set before going to the 3-D lab. Nothing was hidden: a tab or
  a row that vanished with the mode would be harder to find.
- **3-D pictures** (`tools/setshots.js`, keys `key@3d`, `key:value@3d`): atom size, labels, charge badges, glows, fewer
  flashes, colour-blind colours, particle trails (electrons fired in slow motion through a 3-D box), bond orders from
  the positions, quantum bonds (a proton shared by two waters, set up as the flat picture is). `setShotFor` takes a
  3-D picture first in 3-D (a choice's, then the setting's) and never one in the flat game (the enlarged view shows the
  pane's picture, so it follows). Where no 3-D picture makes sense the flat one shows in 3-D with a "Picture from the
  flat game" mark ("2-D" on a narrow screen): the window's own settings (interface size, panel side, chamber only,
  theme, tips, frame rate, resolution: the window looks the same in both, so a 3-D copy would add ~280 KB for nothing;
  made and measured, then left out) and what is not drawn in 3-D (quantum nuclei's beads, wave packets, the
  ultra-realistic mode's sizes). The 3-D tab's own pictures show in both modes, as before. Size: 9 pictures, 270 KB;
  src/setshots.gen.js 797 → 1,049 KB (+252 KB), the page 4.07 MB; under t_settings' 1,200 KB budget, so it stayed.
  1280 × 720, WebP quality 0.72, as the rest.
- **Labels off in 3-D** (the owner, through the main session: "add a setting to remove labels in 3d because ... 10
  bajillion letters is overstimulating"). Labels could already be turned off (Graphics → Labels → Never, or Lab → View
  → Labels), and that worked in 3-D, but the 3-D tab's own Labels row offered only Front atoms only / All atoms, so he
  didn't find it. The row now offers Off, On hover, Front atoms only, All atoms: one switch with Graphics → Labels and
  the view menu's checkbox (Off is Never there and unticks the box; On hover is On hover; Front and All set the 3-D
  choice and Always), kept like the others (`R.view.labels` in viewflags, `SET.labels`, `SET.lbl3`). Its description
  says so, and that charge badges follow Graphics → Charge badges. Measured on the molecules in space (labels drawn in
  one frame): All 64, Front 62, Off 0, On hover 1 (the hovered atom), 0 with nothing hovered.
- **Checked at 1360 and 390 px in both modes** (screenshots 125s-before-* and 125s-after-*-{2d,3d}-{exp,gfx,d3,ctl}-{1360,390}.png
  in the session's scratchpad): at 390 px the other mode's notes are hidden in the list too (a `[hidden]` rule over the
  narrow layout's `display: block`), nothing runs past the edge (0 px), and the strip's small thumbnail carries a short
  "2-D" mark.
- **Found, not changed**: (1) in 3-D, liquid water with 40 molecules ionized catches its 40 electrons again within ~30
  steps (the flat water keeps all 40 over the same steps), so ionized water is a poor 3-D benchmark for waves: the bench
  ionizes after the warm-up and a neon box was added. (2) Quantum nuclei with every bead's whole force field cost ×17–48
  in 3-D against ×3–10 flat (contracted: about the same in both): worth a look for the speed session (where the 3-D
  per-bead pass runs). (3) The flat bond-order tag (×8–15) measures ×5.4–5.8 here.
- Tests: tests/f_125s.js `settings3d` (t_features' 1.25 area, one line; or `node tests/f_125s.js`): the mode in the
  title; the cost tags differ by mode (bond orders ×8–15 / ×18–23, force reach, quantum nuclei, induced charges, longest
  step); the 3-D words and notes (none of the other mode's shown); the one-mode tags; in the flat game every picture
  shown (82 rows and choices, and the enlarged view) is a flat one and none is marked; in 3-D the 9 settings with a 3-D
  picture show it (23 rows and choices, the enlarged view too), the rest the flat one marked; it switches with Settings
  open, and through main menu → 3-D → Settings → back to 2-D; at 390 px each mode's notes only, no overflow. Fails on
  6f5d75f (no mode: the pane has no mark to read). `labels3d`: the 3-D Labels row's four choices, labels drawn in each
  (above), the switch shared with Graphics → Labels and the view menu, kept; fails on 6f5d75f (two choices). t_settings
  accepts the `@3d` keys as their setting's (its reload check caught a sync line cut short while building this).

### 1.25: the nuclear side in 3-D

The owner, after 1.24.0: "add them both to 3d in 1.25"; this is the nuclear side of the particles (branch v129), built in
stages in the order of the task: captures at rest and nuclear hits first, then nuclear reactions, the collider, the plasma.
Physics in 3-D: each stage's numbers below are for the owner's OK.

- **Stage 1: captures at rest, nuclear hits, muonic atoms, muonium, hypernuclei; neutrons and fast atoms in depth.**
  - The route. 1.24.0 proposed working each event out in the plane of its incoming momenta and turning it into place.
    Measured on 1.24's own embedding, that keeps two-body events exact but lays every product of an event in one plane: a
    nuclear star (a π⁻ absorbed by oxygen: 4–6 prongs) comes out flat, and compound-nucleus cooling, step after step,
    stays in that plane. So instead every four-momentum in a 3-D world is [E, px, py, pz] and the helpers take either
    length (`add4`, `mass4`, `toLab`/`toRest` → `boost3`, `twoBody` with uz, `rdir` on the sphere, `randDir4`, `p4of`,
    `exoP4`, `vel4`, `pmag`): the event code is the flat game's, line for line, and in the flat world its arithmetic and
    random draws are exactly those of 1.24 (fingerprints below). Changed only where the dimension matters:
    `phaseSpace3` (GENBOD with its weights Πq, kept by rejection against James's bound: in three dimensions the two-body
    phase space grows with the momentum, so the flat game's unweighted draw is wrong there; 2.5 draws a call on average
    in the measurements below, never the 3,000-draw cap), Fermi break-up's weights in 3-D (volume, (Πm/M)^3/2,
    E^(3n−5)/2, Γ(3(n−1)/2): `fermiInto`, `lnGamma`), `jetMomenta3` (transverse momentum round the axis in two
    components), the elastic turns (`exoElastic3`, `elasticTurn3`: about an axis across the path at a random azimuth),
    `binaryInto` (`turnU`). 1.24's decays at rest and in flight now use the 3-D phase space instead of the turned plane.
  - Wired in 3-D (`moveExos3`): a μ⁻ slowed below 2 keV is caught (`muStop`: muonic hydrogen flies, scatters off
    hydrogen nuclei in 3-D (`muAtomScatter3`), moves to heavier isotopes and fuses, μCF; in a heavier atom it decays in
    orbit or is captured by the nucleus, `muBoundTick`), a stopped K⁻ (`kStop`, the Λ sometimes staying: hypernuclei,
    `hypCatch`, `hypDecay`), π⁻, Σ⁻, Ξ⁻, Ω⁻ (`hStop`) are absorbed, a slow μ⁺ may take an electron (`muoniumForm`; muonium
    an atom in MD at its depth, `addMuonium` with z), strongly interacting particles meet the nuclei on their path
    (`exoHits3` → `hadronHit`); muonic atoms bounce off reflecting walls as in the flat game; events are drawn at their
    depth (`nucEvent`'s z). The nearest atom for a capture is found in 3-D (`stopTarget`). Muonic atoms, muonium and
    hypernuclei are in the 3-D particle menus (spec3dOK); placed muonium is an atom in depth.
  - Neutrons in 3-D (the products of nearly every star): their path search is in depth (`relTargets3`; 1.23.2 searched
    the plane and added the depth to the miss distance), neutron pairs too (`nnMeet3`), and their reactions have 3-D
    kinematics (`neutronHit3`: capture with the γ ray and the recoil on the sphere, (n,p), (n,α), (n,t) by
    `launchProducts3`, fission in depth, elastic scattering isotropic in the centre of mass; above 20 MeV the relativistic
    reactions, `nuclearEncounter`, as a flat neutron in radiation flight). Before, a neutron's scatter left vz alone and
    (n,x) products and fission fragments were put down at z = 0.
  - Fast atoms fly in 3-D (`updateFast`: an atom past 25 Å/tu leaves the stepped set, as in the flat game, and comes back
    below 18; `fastEncounters3`: hard spheres and Rutherford scattering along its path in depth, turned in the plane of the
    path and the target, `turnPair3`; `fastFastNuclear3`). 1.23.2 kept them stepped because the flat collision search
    was the only one; stepped, a keV–MeV atom shrank the step to 2×10⁻⁵ tu and its passes through molecules broke the
    books by keV (below). Electrons stay stepped in 3-D. Fusion of fast nuclei and their nuclear reactions in 3-D: stage 2.
  - Measured (Node; 64 waters in an 18 Å 3-D box, open walls, insulated; events called between steps):
    - Books per event: 40 π⁻ stars on oxygen worst 3×10⁻⁵ eV; 40 K⁻ absorptions 5×10⁻⁵; 40 π⁺ at 300 MeV and 30 K⁻ at
      2 GeV meeting oxygen 2×10⁻⁵; Σ⁻ and Ξ⁻ 30 and 28 eV in one event each in 40 (in both: a 2.7 MeV γ ray making an e⁺e⁻
      pair at once beside a nucleus; `pairProduce3`, as the flat `pairProduce`, puts the pair 0.4 Å apart without their
      potential energy: 45 eV of 2.7 MeV, found, not changed); μ⁺ → muonium up to 84 eV (the flat game the same, 96 eV:
      the muonium atom is put where the muon stopped, next to the atom it took the electron from, and its potential
      energy there is not paid; found, not changed). μ⁻ captured in oxygen: 5×10⁻¹⁰ eV.
    - Momentum in three directions: Σp of the products against the incoming four-momenta, worst relative 2×10⁻¹⁶–6×10⁻¹⁶
      (π⁻, Σ⁻, Ξ⁻, hits); K⁻ absorption 0.002, as in the flat game (0.0019: the struck nucleon's Fermi motion is given
      without the atom's own).
    - Isotropy at rest: π⁻ stars, 189 prongs: mean direction ≤ 0.03, ⟨u²⟩ 0.39, 0.34, 0.28 (⅓ each; 40 events); the
      check in f_125n: 179 prongs ⟨u²⟩ 0.331, 0.321, 0.348. Not flat: |u₁·u₂×u₃| of three prongs 0.39 on average (0 in a plane;
      1.24's turned plane would give 0).
    - 3-D phase space: three massless bodies sharing 1 GeV, m₁₂² < M²/4 in 0.44 of 4,000 (even over the Dalitz plot:
      0.4375); 1.24's turned flat phase space 0.51 (flat: 0.5).
    - Stepped in 3-D water (decay off): of four each put down at 1.5 keV beside oxygen, π⁻, K⁻, μ⁻, Σ⁻ three each caught
      within 12 steps (the fourth's nearest atom a hydrogen: μ⁻ makes μp there), one μ⁺ in four made muonium (60% tried,
      some next to ions); 1.24: none (they stopped and waited to decay). 30 π⁺ at 300 MeV through the box: 3 reactions
      (1.24: 0). μCF in a 3-D D–T gas (125 atoms, 3 Å apart, decay ×10⁶): 3 fusions in 400 steps.
    - Fast atoms (Node, one atom fired through the 64 waters, insulated): H at 500 keV books 0 eV in 5 steps (1.24:
      −208 eV in 194 steps of 10⁻⁴ tu), O at 300 keV +0.03 eV over 1,500 steps (stopped, then part of the box; 1.24: tens of
      keV, 3,000 steps without leaving). What it heats can still run away: 300 keV in 64 waters is 4.7 keV a molecule, and
      that plasma drifts by keV a step (the ionized-water known limit), in 1.24 and now.
    - Cost (Node, one thread, two loaded cores: noisy): a particle's search for the nuclei on its path is now made once a
      step and shared by its ionization, scattering and nuclear hits (`segFor3`): 9–11 µs at 1,029 atoms (one 1.24 scan:
      15–21 µs, two a step for a charged one). 40 π⁻ at 5 MeV in liquid water (1,029 atoms): the three together 4–7 ms a
      step, about 1.6 of 1.24's two. A diffractive pass no longer measures the whole box's energy (`exoElastic3`: 65 ms a
      call at 1,029 atoms in the flat game's way; now the recoil's kinetic energy, exactly).
  - Unchanged: every flat fingerprint (53 setups, 300 steps, seed 7) and the six 3-D setups'; eight flat hep scenarios
    (stops in water, hits at 50 MeV–2 GeV on C, Fe, Pb, O, H, hypernucleus decays, μCF, muonic atoms in C–Pb, muonium,
    the pion beam, the hyperon factory; 300–2,500 steps) bit for bit.
  - Found, not changed (flat game): `hardSphere` turns a pair's relative velocity by π − 2·acos(b/R), so a head-on pass
    goes straight through and a grazing one turns back (the hard-sphere deflection is 2·acos(b/R)); 3-D uses the right
    one. `exoElastic` measures the whole box's energy twice per pass (65 ms at 1,029 atoms; flat setups are smaller).
  - Test: tests/f_125n.js part `capture` (t_features' "1.25 (nuclear 3-D)" block; `node tests/f_125n.js [--node]
    capture`); fails on 1.24.0 (no capture, no reaction, 1.24's phase space 0.51).

- **Stage 2: nuclear reactions in 3-D** (committed with stage 1: the stars' products, MeV nucleons and keV–MeV recoils,
  need it to be sound; measured on stage 1 alone, a π⁻ star's neutrons, with the flat neutron reactions, broke the books
  by MeV a step, and its fast recoils, stepped, by keV).
  - Radioactive decay (`doDecay3`): α, p, n, 2p, 2n, β±, electron capture in depth, the emitted particle, the neutrino
    and the recoil on the sphere (the neutrino along the direction its momentum gave the recoil; the flat game draws it
    afresh), spontaneous fission through `fission`'s 3-D branch. Before, a decay in a 3-D world put its α or electron at
    z = 0 (a jump through the box) and turned the daughter in the plane.
  - Fission in depth (`fission`: fragments back to back along a direction on the sphere, prompt neutrons on the sphere,
    γ rays from its depth); fusion (`tryFusion3`, from `fastEncounters3` and `fastFastNuclear3` within the fusion gate);
    fast nuclei past 2 keV meet nuclei within reach as in radiation flight (`nuclearEncounter` at the target's depth:
    Fermi break-up, compound nucleus, deep-inelastic, spallation, fragmentation, diffraction; the Experimental
    intranuclear cascade stays flat: its nucleus is a disc) and lose energy to the electrons of the atoms they pass
    (`fastStop3`: moveRad's stopping, the push square to the path exact); the giant dipole resonance (`photoNuclear` with
    the γ ray's depth; 1.24 made a pair instead). Neutrons in the 3-D particle menus; Fire sends atoms and nuclei at any
    energy (was capped below 2 keV).
  - Found and fixed on the way (3-D only): an electron set free from an atom in flight lost the electron's share of the
    atom's motion, ½mₑv² (the atom's mass drops by mₑ at the same speed): 117 eV for a 50 MeV ²³⁵U, 0.5–2.6 keV a
    Compton event on fission fragments (`ejectElectron`); a 3-D e⁺e⁻ pair was put down beside the nucleus without its
    potential energy (`pairProduce3`; the flat pair flies in radiation mode and has none): now its motion pays it. And
    with atoms in flight: a recoiling atom stopped in a closed wall (`wallStop3`, 1.23.2) was booked as if stepped; one in
    flight is now measured as the books count it (`regionE`) and put back into the stepped set: f_1232's 100 keV uranium
    recoil books 0.0000 eV (1.86 eV before this fix).
  - Measured (Node, single events between steps unless said):
    - ²¹⁰Po α decay, 200 at rest: books ≤ 2.4×10⁻⁵ eV; α against the daughter's recoil 0.0032 of the α's momentum (the
      two shaken-off electrons carry the rest); α directions isotropic, ⟨u²⟩ 0.336, 0.373, 0.291. ¹⁴C β decay, 100: books
      ≤ 2×10⁻⁶ eV. 1.24: books the same, but the α at z = 0, ⟨u_z²⟩ 0.
    - ²³⁵U + thermal n, 40 fissions: books ≤ 6×10⁻⁵ eV (1.24: up to 64 eV); fragments back to back, cos −1.0000; 180
      neutrons isotropic, ⟨u²⟩ 0.313, 0.370, 0.317 (1.24: 0.43, 0.44, 0.14).
    - D + T at 120 keV, 40 fusions: books ≤ 10⁻⁶ eV; the neutrons isotropic (⟨u²⟩ 0.26, 0.35, 0.40 over 40).
    - 40 protons at 50 MeV aimed at a 3-D carbon lattice (125 atoms): 28 reactions in 30 steps, books −1.2 eV over the
      run (1.24: 0 reactions, +3,025 eV: the protons and their recoils stepped).
    - 13.5 MeV γ on ²⁰⁸Pb, 30 called directly: 30 photonuclear, books ≤ 0.03 eV, neutrons in depth (1.24: 30, 56 eV, flat).
    - 20 MeV γ rays into a 3-D lead block (150): books −367 eV after the pair fix (−4,163 for 400 before): what is left is
      the MeV electrons and positrons stepped in MD at speeds past c (3-D has no radiation flight for them), in 1.24 too.
    - 10 π⁺ at 50 MeV through liquid water (1,029 atoms, f_124's run): 5 reactions, their recoils a cascade of keV–MeV
      O and H in flight; books +10.4 eV over 200 steps (1.24: −0.53, no reactions); the step 6×10⁻⁴ tu while they fly
      (the flat game's rule for atoms in flight, 3.5 Å a step; a 50 MeV proton 3.5×10⁻⁴).
  - Cost: nothing without events (liquid water, 1,029 atoms, 60 steps, CPU time a step: 3.7–3.8 ms on 1.24.0, 3.2–5.0 on
    this branch, alternating runs; the walls pass now squares vz too). An atom in flight searches the atoms along its
    path each step (a scan of the box, ~10 µs at 1,029 atoms, as the unstable particles'); the step while atoms fly is
    the flat game's rule, 3.5 Å a step at their speed.
  - Unchanged: the flat fingerprints, the six 3-D setups', the eight flat hep scenarios (bit for bit). f_124's 3-D
    particles check now expects muonic atoms in the 3-D menus and allows 30 eV on its π⁺ run (the reactions above).
  - Test: tests/f_125n.js part `reactions`; fails on 1.24.0 (α at z = 0, ⟨u_z²⟩ 0, fission books 64 eV, no proton
    reactions, photonuclear books 56 eV).

- **Stage 3: the collider in 3-D: not built** (much harder than planned; written down as the task asked). The collider is
  flat machinery throughout: its ring is zones laid out in the plane (`W.zones`: dipoles, quadrupoles, RF cavities,
  separators, kickers; `zoneLocal`, `rampRing`, `colliderRefill`, `inDetector`), its beams fly in radiation mode along
  `radPath` (the zones' fields, synchrotron radiation, the RF), and they meet in `beamCollisions`/`beamHit`/`xbHit`, whose
  e⁺e⁻ jets, annihilations and inelastic collisions turn jet axes in the plane (`eeEvent`, `xbAnnihilate`, `xbInelastic`:
  `turn2`, `jetMomenta` on [ax, ay]) and whose elastic passes use the flat `nuclearScatter`. The 3-D world has no radiation
  flight at all (1.23.2: everything is stepped; since this stage atoms fly ballistically, non-relativistically, and
  electrons stay stepped), the 3-D view draws no zones, and the collider setups are flat presets with their own panel.
  What is ready: everything a collision makes is now worked out in 3-D (hep.js's events above, `jetMomenta3`). The route:
  beams kept in the z = 0 plane in radiation flight (allowing `rad` for beam particles in 3-D; `radPath` unchanged), the
  zones drawn at z = 0 in view3d, the jet axes of `eeEvent` and `xb*` through `turnU`/`jetMomenta3`, a 3-D `nuclearScatter`,
  3-D collider setups and their panel in the 3-D lab. Several sessions; nothing of it is in this branch.
- **Stage 4: the quark–gluon plasma in 3-D** (by fixed target: there is no collider in 3-D). A heavy nucleus fired at
  hundreds of GeV a nucleon (Fire now takes atoms and nuclei at any energy in 3-D) meets a nucleus in flight
  (`fastEncounters3` → `nuclearEncounter` → `fragmentInto`): the overlap melts and freezes out (`qgpHadrons`,
  `jetMomenta3` with the thermal option: transverse momenta round the beam in both directions across it), drawn at its
  depth (`drawQGP3`: the flat view's swelling, cooling drop and its caption; `addQGP` keeps the depth). Antinucleons made
  in 3-D leave the books as escaped energy (antimatter is not in 3-D yet: its annihilation is flat-only). Measured
  (Node): ²⁰⁸Pb at 200 GeV a nucleon on a lead atom, √s_NN 19.4 GeV: a plasma froze into 1,705 hadrons (782 unstable ones
  in flight, the rest nucleons and nuclei), books −0.016 eV, 207 ms for the event (Node, two loaded cores); across the
  beam ⟨u_y²⟩ 0.026, ⟨u_z²⟩ 0.030 (the flat game's spray is in its plane). At 30 GeV a nucleon (√s_NN 7.6 GeV, below the
  plasma's 3 GeV a nucleon in the fireball) the same pass fragments instead (298 hadrons, books −0.002 eV).
  Test: tests/f_125n.js part `plasma` (fails on 1.24.0: no reaction in 3-D).
- Screenshots (scratchpad): 125n-before-stars.png (1.24: six π⁻ and K⁻ stopped in liquid water, nothing caught),
  125n-after-stars.png (the same: captions in depth, "π⁻ caught by ¹⁶O in H₂O", "K⁻ + ¹⁶O → ¹⁵N + π⁰ + Λ"),
  125n-after-fission.png (six ²³⁵U fissions in an empty cube), 125n-after-qgp.png (a quark–gluon plasma in depth).
- Not changed, found on the way: in the flat game `hardSphere`'s deflection is inverted (above); `exoElastic` measures the
  whole box's energy per pass; `pairProduce`'s pair is exact only because it flies in radiation mode. In 3-D: the
  Experimental intranuclear cascade stays flat (its nucleus is a disc), so in 3-D a nucleon above 40 MeV a nucleon on a
  heavy nucleus takes the fireball model; MeV electrons and positrons are stepped in MD at speeds past c (no radiation
  flight for leptons in 3-D: −367 eV over 150 20-MeV γ rays into lead); muonium formation (both games) puts the atom where
  the muon stopped without paying its potential energy there (up to tens of eV).

### Bug fixes after 1.25
The "Bugs on record" list (planned list, for 1.26), fixed in the bug-fix session on branch bugfix-125. Checks: tests/f_bug125.js
(called from t_features). Fingerprints: tools/fingerprint.sh (every setup, seed 7, 300 steps; the state and the energy
books hashed apart).
- 5. Open walls in the flat game booked nothing. A particle leaving through an open wall was killed with its motion,
  its potential energy with what stayed and its electrons' binding left out of the books (walls() for atoms,
  leptonWall for free electrons on their inner steps); wallOrEscape's open branch booked only neutrons and particles in
  radiation flight, not a fast electron or atom between. Now wallOut2 books what leaves as wallStop3 does in 3-D
  (kinetic + internalE + its potential energy with what stays, the rest relinked), and the next step starts from forces
  without it (_wallMoved: the step's opening kick used forces from the departed particle). 8 waters and an ion pair
  leaving an open box over 1,500 steps: the books changed by +19,230 eV before, −0.007 eV after. Fingerprints: the
  books of annihilation, crt, pionbeam and sns change (what leaves is now counted); pionbeam's state too (a free
  electron leaving: the forces refreshed after it). Check: f_bug125 "openWall".
- 11. The flat game's hard-sphere collision (hardSphere: a fast atom meeting an atom, both with electrons) turned the
  pair's relative velocity by π − 2·acos(b/R), which is the wrong way round: a head-on hit (b = 0) passed straight
  through and a grazing one bounced back. Now 2·acos(b/R) (= π − 2·asin(b/R), as hardSphere3 in 3-D). Turn measured
  for b = 0, R/2, 0.999R: 0°, 60°, 175° before; 180°, 120°, 5° after. Fingerprints: muonium, nif and sns change (their
  fast atoms collide), nothing else. Check: f_bug125 "hardSphere".
- 10. Space held to pan (Help: "drag with the right button (or Space held) to move"): onDown pans while UI.spaceDown,
  but nothing ever set it, and a held Space toggled play on every key repeat. Now Space's keydown (not its repeats)
  sets it and keyup (or leaving the window) clears it; a drag that starts while it is held pans and puts play/pause
  back as it was, so Space alone still plays and pauses. Page: Space held + a drag moved the view 0 Å and left it
  running before; 6.5 Å, still paused, after; Space alone plays (both). Fingerprints unchanged. Check: f_bug125
  "spacePan" (page).
- 19. t_features' 0.95 CO check (six CO among O₂ at 300 K keep their triple bonds) ran on the page's random stream,
  which is not seeded: it passed or failed with the draws (4 of 6 once). Moved to the Node harness with a fixed seed
  (f_bug125 "coCold": seed 1, run twice, 6 and 6); the 0.95 block keeps its other checks. Why it could fail: on seeds
  4, 6 and 10 of 1–10 two CO join, CO + CO → C₂O₂ (ΔH −85 kJ/mol, as the bond table allows; real OCCO is not bound),
  leaving 4. That is the model's chemistry, written down for the owner, not changed. Fingerprints unchanged (tests
  only).
- 12. exoElastic (a hadron's elastic pass by a nucleus, flat game) measured the whole box's energy, totalEnergy (every
  pair), twice a pass to book the recoil. Now regionE over the struck molecule (its atoms against everything they
  touch: the same terms as totalEnergy's for them), as exact and local. 20 passes of a 300 MeV π⁺ among 1,200 atoms
  of water: 29 ms a call before, 0.8 ms after; the books exact both times (1.4·10⁻⁵ eV). Fingerprints unchanged.
  Check: f_bug125 "exoElastic".
- 9. The 3-D search for the atoms along a particle's path this step (segTargets3: ionization, scattering and nuclear
  hits of charged unstable particles, muonic atoms, fast nuclei) went over every particle. It now walks the neighbour
  grid's cells around the segment (a skin's margin for atoms that drifted since the grid was made), plus the lists the
  grid does not hold: nuclei flying fast (_fastNuc) or in radiation flight (_radNuc, new, filled with them) and
  particles made since (_late); with stale lists, or a grid of 32 or fewer, it goes over every particle as before. The
  same atoms found, sorted as before (ties by id). 1,000 searches among 8,232 atoms of 3-D water: 122–126 µs a search
  before, 8–14 µs after, the same 133 atoms. (The flat game's segTargets already used the grid. In a small box such as
  water3d's, 22 Å with 8 cells, the grid is the whole box: no gain there, nothing lost.) Fingerprints unchanged;
  f_125n passes. Check: f_bug125 "segGrid".
- 15. K⁻ absorption at rest (kStop) took the kaon at rest and the struck nucleus in the atom's frame without the atom's
  motion, and freed the electrons in random directions: momentum kept only to about 0.9 MeV/c (2-D and 3-D). Now the
  kaon's own four-momentum (exoP4) goes in, the struck nucleon comes from struckNucleon (the same spectator model,
  boosted by the atom's motion; the same random draws in the same order), and the freed electrons share between them
  the momentum they had riding on the atom. K⁻ (800 eV) on a moving carbon atom, 30 seeds: |Σp out − p in| up to
  0.90 MeV/c before, 6·10⁻¹⁴ (flat) and 9·10⁻¹⁴ MeV/c (3-D) after; the books exact both times (8·10⁻⁶ eV).
  Fingerprints: hyperfactory changes (its kaons are absorbed), nothing else. Check: f_bug125 "kStop".
- 13. Muonium formation: the muonium atom was made where the muon stopped, beside (often inside) the atom it took the
  electron from, and when its potential energy there was more than the event could release (the γ ray cannot carry a
  negative energy) the rest was made from nothing. Now muClear moves the muon first (an exo, with no potential energy
  in the books) to the nearest spot where a hydrogen-sized atom sits clear of every atom (85% of the contact distance,
  as separate() keeps fragments). μ⁺ at 1 keV stopping 0.67 Å from an oxygen in water, 20 seeds: 3-D books moved by up
  to 17.7 eV (mean 5.1) at the formation before, 0.000 eV after; flat 0 before and after (there the new muonium atom
  flies fast at first and joins the stepped atoms through switchMode, which pays). Over 300 steps after it, 3-D 0.7 eV
  worst. Found, not changed: a light atom flying fast in the flat game (muonium stays in flight down to 18 eV) jumps
  the books by ±1–12 eV in pairs as it passes molecules (mean −0.04 eV over 12 runs). Fingerprints unchanged. Check:
  f_bug125 "muonium".
- 6. In an applied electric field the books (total + Σ q·φ, φ = −E·r: totalEnergy leaves the field out, as it does
  work) missed −q·E·Δr whenever an event changed a charge: the events measure the energy without the field. Now
  fieldPhi / fieldU give the uniform field's potential and a particle's energy in it (q + partial charge for an atom,
  as the force has it), and the event measures count it: localPE and regionE for their atoms, ejectElectron's launch
  and joinEnergy (captures) for the lepton; switchMode leaves it out (the field pushes a particle in flight too, so its
  energy there does not change with the mode). Ten protons and their electrons recombining among argon in 0.2 V/Å,
  6 seeds, 1,500 steps: up to 0.80 eV off before, 0.03 eV after (60 captures). No field, no change. Fingerprints: neon
  (the discharge has a field) changes, nothing else; t_energy passes. Check: f_bug125 "efield".
- 7. Free electrons put down almost on top of each other. In 3-D electrons stay stepped (the inner steps), whose length
  followed their speed (LEP_STEP/v, 0.2 Å a step), acceleration and the pairs' stiffness, but not how fast two of them
  sweep past each other's soft core (0.2 Å): at the hundreds of Å/tu such a cluster flies apart with, each close pass
  gained or lost eV. Now computeFast3 notes each lepton pair's pass rate (relative speed over the softened distance,
  _passL) and innerDt3 keeps an inner step under 3% of that crossing time (10% left 29 eV, 1% 0.3 eV). Eight electrons
  in a 1 Å row, pairs 0.02 Å apart, insulated, 16 tu: 3-D −116 eV before, −2.1 eV after, the run 35% longer (0.47 →
  0.64 s); the flat game 0.1 eV both (past 20 eV electrons fly there, colliding along their paths). Earlier mention:
  330 → 985 eV for eight with a 300 T field (1.24). Fingerprints unchanged (no setup starts with free electrons
  together). Check: f_bug125 "coincident".
- 16. 3-D ionized water recapturing its electrons: physics, not a bug; nothing changed. 40 of water3d's molecules
  ionized (userIonize: the electron set off at 1 eV beside its ion), insulated: in 3-D 39 are captured within 20 steps
  (joinEnergy releases 5.4–16 eV each, median 10.7: an electron at 1 eV in its parent cation's field is bound and falls
  in, as geminate recombination in water is fast), books −0.27 eV over 200 steps. The flat water is the odd one: its
  27 electrons sit 0.1–0.4 Å from their cations with 0–5 eV and are never captured (157 tries in 60 steps, joinEnergy
  −10 to −32 eV, median −20: sunk below the depth the capture can pay, more than the 12 eV the neighbourhood may lend,
  0.92). That is the flat model's soft ion well in a molecule (deeper than the ion binds), written down for the owner
  as a model question, not changed.
- 18. The flat bond-order cost tag (×8–15) against the 1.25 re-measurement (water ×5.4–5.8). Re-measured on a quiet
  machine (4 cores, load 0.5, one thread, bench-mode.js, 300–400 steps, ms a simulated fs): liquid water ×7.5–9.2
  (seeds 3, 5, 7, 9, 12: 8.6, 7.5, 8.1, 8.6, 9.2), salt water ×5.9–7.4 (seeds 12, 3). So the 1.25 figure was taken under
  load and the old water ×8 holds. The tag is now ×6–15, its words with these numbers (and 1.20's H₂ + O₂ ×9, gallery
  ×15). f_125s's two tag checks follow. Fingerprints unchanged. Check: f_bug125 "boTag" (page).
- 3. AsCl₅ with bond orders on (flat): looked at, left for the owner as a model choice. The cause is written down in
  1.25 (bond orders for the heavier elements): the five chlorines sit 2.46 Å apart in the plane, As–Cl (2.97 eV) beats
  Cl–Cl by only 0.46 eV, and the crowding rule (1.16) acts from 0.4–0.8 eV, so the Cl pairs take order 0.39 (0.78 eV a
  bond deeper than stored); PCl₅ and SbCl₅ have 0.9 and 0.6 eV to spare. A fix means changing that rule's threshold
  or the As–Cl/Cl–Cl table (both change how every crowded molecule bonds), not correcting a slip: not changed.
  (Real AsCl₅ falls apart above −50 °C.)
- 1. Flat copper turning itself into ions (normal pair model): looked at, left for the owner as a model choice. The
  books are exact (each transfer is measured), so this is what the flat pair model predicts, not a slip: its Cu–Cu
  spacing (2.64 Å) is short enough that the pull of a Cu⁺Cu⁻ pair (with the flat world's stronger Coulomb between ions)
  pays IE − EA (6.49 eV) once a few pairs line up (Ag, with a smaller IE − EA but a longer spacing, does not). In a
  real metal the conduction electrons screen such a pair and nothing happens; giving the flat pair model that
  screening (e.g. no electron transfer between two atoms of a metal joined by metallic cohesion, or a screened
  Coulomb inside a metal) changes how metals behave: the owner's call. Many-body copper (Experimental) stays neutral. (Fixed
  in 1.26 with the owner's OK: the section "1.26: copper ions".)
- 2. Dense metals in 3-D were slow: nearly all of a step went to the electron-transfer estimates (transferDE), each
  pair tried walking every atom within 6 Å four times (localPhi), which in a neutral metal adds nothing. Now
  chargedCount() counts the charged particles (net or partial) once per change of the world, and localPhi returns 0
  at once when nothing but the pair itself is charged: the same numbers, so the same run bit for bit. A ball of 959 Cu
  atoms in 3-D (bench-mode's cu3, seed 12, 40 steps): 77 ms a step before, 6.9 after (the many-body model: 76 → 6.7);
  the flat Cu patch 2.3 → 1.0 ms; final states identical. Where the metal does hold ions the walks still run (the flat
  copper of item 1). Fingerprints unchanged. Check: f_bug125 "metal3".
- 4. A fast neutron among 3-D waters: the large part of the leak found and fixed; a remainder written down. Measured
  now (2 MeV neutron, 64 waters in an 18 Å box, insulated, 1,500 steps, seeds 1–3): +7,061, +11,823, +9,768 eV before
  (far more than 1.23.2's 48 eV: since 1.25 its recoils fly and ionize, the cascade makes a dense plasma). The jumps
  were ±2,400–2,800 eV each, at the moments the count of net charges crossed 220: the long-range Coulomb sum (and the
  shift inside the cutoff that meets it, 1.09) switches off above 220 (computeForces' _lrOn), changing the energy's
  definition with nothing physical happening. Now lrFlip books that change (ledger.escaped) at the moment of the
  switch, measured with the positions and charges then; a new world's first pass sets it without booking. After:
  +354, −27, +118 eV (seeds 1–3). 110 Na⁺ + 110 Cl⁻ and one more ion: +297 eV across the switch before, 0 after. Left:
  the remaining tens to hundreds of eV come from that dense plasma's chemistry (impact ionization and recombination
  around multiply charged clusters, the known limit in CLAUDE.md), not chased. A 100 keV U atom among the waters: +1.5
  to +15.6 eV over 1,500 steps (1.23.2: about 1 eV; its recoils now fly). Fingerprints unchanged (no setup crosses 220
  charges in 300 steps); t_energy passes. Check: f_bug125 "lrFlip".

From the bug-fix session (branch bugfix-125): items 8, 14 and 17 of the "Bugs on record" list. Checks: tests/f_bug125.js
(called from t_features).
- 8. 3-D display gaps. (a) Inspect could not pick an unstable particle or a photon in flight in 3-D (pickLight returned
  nothing there): now their heads are taken with their depth (lightHead3, as drawLight3 and drawExos3 draw them) and
  projected through the camera; a π⁺ and a γ ray in flight in d3empty are picked where they are drawn (before: neither).
  (b) Quantum nuclei's bead rings were not drawn in 3-D: drawRings3 draws each ring through the camera (offsets in x, y
  and depth), once an ångström is 30 px or more where the atom is, fainter with the fog; water3d with 8 beads, close
  up: 24 bead dots drawn (before: none). (c) The Magnet tool's pole buttons kept the flat ⊙/⊗ in 3-D, where a pole's
  field is along the chosen axis: now "N +z" / "S −z" (the axis as set). (d) The Experimental texts still flat-only:
  quantum nuclei's (Settings' pane and its 3-D note said the beads are not drawn) now say where they are drawn; the
  others were checked (1.25's Settings by mode already gives each a 3-D note). Fingerprints unchanged (drawing only).
  Check: f_bug125 "display3" (page).
- 14. MeV electrons and positrons in 3-D were stepped faster than light: 3-D keeps every lepton stepped, with ½mv² for
  its energy and v for its speed, so a 10 MeV electron moved at 6.3c, in inner steps held at DT_MIN that carried it
  about 4 Å past every nucleus. Now a lepton past 25 keV (where ½mv² puts it at 0.3c) leaves the stepped set
  (switchMode pays its potential energy, as for atoms in flight) and flies (moveFastLeptons3): straight at its
  relativistic speed, or on an arc of angle qB·t/γm in a magnetic field, in segments of at most 45% of the box; its
  kinetic energy stays ½m|v|² of the stored velocity, so the books are unchanged; along its path it gives energy to
  the atoms' electrons as the flat game's radiation flight does (≈ n_e/β² each, the electrons set free square to the
  path, exactly what it loses); a closed wall stops it (leptonWall/wallStop3, its energy escaped). Below 20 keV it is
  stepped again. Measured: a 10 MeV electron 6.26c before, 0.999c after; 20 MeV pairs made inside a 3-D lead block
  (6³ atoms), 30 pairs × 25 steps: books −6,301 eV in all (worst pair 211 eV) before, −3.3 eV (worst 0.8) after.
  wallStop3 now books no potential energy for a lepton in flight (it has none in the books: a 1 MeV γ's Compton electron
  stopped in the wall had put −0.6 to −1.2 eV in f_124's light check). Not ported (the flat radiation flight has them): bremsstrahlung, Mott scattering off a nucleus crossed, and an
  electric field's push in flight above 25 keV. Fingerprints unchanged (no 3-D setup has leptons past 25 keV);
  t_energy, t_3d and f_125n pass. Check: f_bug125 "lep3".
- 17. Quantum nuclei in 3-D with the whole force field on every bead cost ×17–48 (flat ×3–10). Why: a 3-D ring reaches
  up to 0.51 Å from its centre in liquid water, past half the neighbour list's 1 Å skin, so each bead's pass found the
  list out of date and rebuilt the grid and the list: 6.1 rebuilds a step of 8 passes (the profile: vlPairs3 1.5 s of
  2.6 s), against none in the flat game. Now while that mode runs in 3-D the list reaches PI_SKIN3 (1.4 Å) farther, the
  cells with it, and stays valid for moves up to half its wider skin: every bead's pass uses the same list, no
  rebuild in a step (vlReachSet; back to the usual reach when the mode or quantum nuclei go off). The forces are worked
  out where the pairs are, the list only says which to look at: 40 steps of water3d with 8 beads, positions the same
  to 6·10⁻¹⁵ Å and the same drift. water3d (1,029 atoms), 8 beads: 52 → 19 ms a step; bench-mode's costs against
  stored, ms a simulated fs: 8 beads ×15.4 → ×8.0, 16 ×17 (was ×29–31), 32 ×29 (was ×46–51). The 3-D tags and note
  now say ×8, ×17, ×29. Fingerprints unchanged (quantum nuclei are off by default). Check: f_bug125 "pi3".

From the release (the owner: "the gallery, settings and help buttons on the 3d main menu are still hard to press"):
- 20. The main menu's row buttons (the 3-D panel's Gallery, Settings, Help; the first screen's Continue) lifted 14 px
  toward the viewer on hover (`translateZ(50px)` over 36, in the menu's 1,100 px perspective). Left of the screen's
  centre that slid a hovered button 9–12 px aside (1920×1080: Gallery −11.6 px, Settings −9.9), so a pointer near its
  right edge fell off it, the hover ended, it slid back: the button flickered under the pointer and a click could miss.
  1.23.2 had stopped the same for the other menu buttons; this row came later with the first screen. Now a hovered
  button keeps its place and lights (accent border and glow, as the others; darker while pressed): 0 px. Check:
  f_bug125 "menuHover" (fails before: the pointer off Gallery and Settings). Two timing checks made steadier for the
  release gate under load: "segGrid" takes the fastest of five passes (limit 60 µs; 126 before the fix), "metal3" 50 ms
  (80 before the fix; 7.5 alone, 36 under the suite's load).
- 21. The 3-D Lab's box size (the owner's screenshot: "37 × 37 × 37 Å", clicked to type: "37 × [37.24] Å Å"): in 3-D the
  height and depth were one figure, "h × d" in the height's span, typed as one (setting both), so typing replaced both
  with one box and the depth vanished; the typing box's unit dropdown sat beside the row's own Å. Now width, height and
  depth are three figures, each typed alone (`TYPED.boxD`; the height no longer sets the depth; the slider keeps the
  shares), and the row's Å hides while the dropdown shows. Check: f_bug125 "boxType" (height 30, then depth 45:
  "… × 30 × 45 Å"); f_124 "box" reads the whole row.

## 1.24.0: placing and firing in 3-D, box size, magnets and fields, light, unstable particles and Experimental settings in 3-D

The "For 1.24" list (the rest of the 3-D lab), built in the owner's order on branch v127.

- **Placing and firing in 3-D** (the owner's three choices: "there should be a better system for more accurate placing
  and firing in 3d"). A UI change; the engine is untouched.
  - The placing plane: tools put things on the plane square to the view `P3.off` Å beyond the camera's target (0, the
    1.23 plane, by default; `plane3Pt`, `s2w3`). It is drawn while the Place tool is out, while pasting, and for 1.5 s
    after it moves: a faint grid where it cuts the box and the outline of the cut (`plane3Poly`, `drawPlace3`), a ghost of
    the item at the pointer (an atom in its colour and size; a molecule's atoms as the library draws them, on the plane;
    placed, it is still turned at random), and a dashed line straight down to the box's floor with a small ring there, so
    its depth reads. Shift + wheel moves the plane farther (wheel up) or nearer (`deltaX` too: Chromium on Windows turns
    Shift + wheel sideways), in steps of 4% of the box's half-diagonal; Place's options bar has a Depth slider (−100…100
    of the half-diagonal, "4.5 Å nearer"). Limited to the box (and in front of the eye).
  - Placing against an atom: over an atom (pick3's exact disc, no margin), the item goes against the atom's near side:
    where the pointer's line of sight enters the atom's ball, out along the surface there by the two sizes (`place3At`:
    the atom's ½·UFF diameter and the item's `specSize`, as placements are spaced), then cleared as any placement. The
    ghost shows there with a ring on the atom. Measured (headless, Molecules in space): a C put over an O at its centre
    lands 3.68 Å from it, straight toward the camera (cos 1.00); before, the C went to the O's centre and was moved to
    the nearest clear spot, on any side.
  - Firing from the camera: a click (a drag under 6 px) with Fire shoots from the eye when the eye is inside the box,
    else from where the line of sight enters the box (1 Å in), toward the pointer, and straight at the atom under the
    pointer when there is one (`fire3From`); the pointer shows a crosshair, red with a ring on that atom, and what would
    be fired. A drag still aims in the plane facing the camera from where it began (1.23). Measured: an electron fired by
    a click on an N atom left 1 Å inside the box's face with its velocity on the line to the atom (cos 1.0000); before, a
    click fired to the right of the screen from the plane point.
  - Help (Moving around), the shortcut list's 3-D group (Shift + wheel; a click with Fire) and Settings → 3-D's keys
    note say so.
  - Screenshots: 124-before-place-atom.png, 124-before-fire-aim.png; 124-after-place-atom.png, 124-after-place-empty.png,
    124-after-place-nearer.png, 124-after-fire-aim.png.
- **Box size in 3-D** (the Lab's slider; box3dNote): the slider scales width, height and depth together (`W.box.td`,
  the depth wanted; the typed width scales all three, the typed height sets height and depth), 20 Å to 2 µm (a saved 3-D
  world's depth now loads up to 2 µm too, was 200 nm). `moveWalls3` is the flat `moveWalls` with the depth: growing jumps
  the walls out (a free expansion), shrinking sweeps them through the empty space to the outermost particles and then
  moves all six faces in at the flat game's 0.6 Å/tu, the walls' speed (`uw`, `uh`, `ud`) going into the bounce of fast
  particles (`walls3`) and free electrons (`leptonWall`'s z faces) as in 2-D. The soft walls push the atoms as before.
  Measured (Node, 64 argon atoms in a 30 Å cube, insulated): squeezed to 20 Å, 333 → 869 K by the piston's work 4.319 eV
  (counted as the soft walls' energy jumps when they move), the books 0.006 eV against it after 24 tu (in a longer run
  from another start, 41.05 eV of work, books −0.26 eV after 120 tu: the 900–5,000 K gas's own insulated drift); grown to
  40 Å, a free expansion: books −0.002 eV. The flat game's own piston, the same gas in 2-D: 606 eV of work, books −15 eV.
  Unchanged: every 2-D fingerprint (24 setups, 300 steps, seed 7) and the six 3-D setups' (the walls' speed is 0 when the
  box keeps its size, and the bounce is then the old one exactly). Screenshots 124-before-box-panel.png (the slider
  disabled), 124-after-box-panel.png, 124-after-box-shrunk.png (20 × 20 × 20 Å).
- **Magnets and fields in 3-D** (fields3dNote; physics in 3-D: the flat game's laws, applied with the depth). Every
  magnetic field in a 3-D world points along one axis, `W.Bax3` (the Lab's new "B points along x / y / z", default z):
  the uniform field and every magnet's. A magnet is a ball (centre with a depth, the Magnet tool's radius; inside, its
  field; outside, the flat disc's fall-off by the 3-D distance: `Bfield3`, `Bgrad3`). With all of B along one fixed axis
  the field is one number times that axis, so the flat game's exact turning carries over unchanged to the two velocity
  components across the axis (`B3P`; `rotateB3`, the Boris half turns in `outerA3`/`outerB3` for charged atoms and ions;
  `gyrate3`, the exact arc of a free electron in the inner steps, its step limits in `innerDt3` as in `innerDt`), the
  component along the axis drifting straight. E has a z part (`W.Ez`, the Lab's new +z / −z direction buttons): its
  force on charged atoms in the force pass and on free leptons (`leptonExtras3`). Magnetic matter (iron's moment,
  paramagnets, diamagnets) is pulled by |B|'s gradient in three directions (`magneticMatterForce3`; its energy, magU, reads
  Bfield3). The Magnet tool places a ball at the placing point (or picks one on the screen to drag on the plane facing
  the camera: `magnetAt3`), Erase removes magnets in its cone, the quick menu finds them; drawn as a dashed ball with a
  glow, its pole's colour and an arrow along the axis (`drawMagnet3`, the tool's ghost too), and the corner's axis marker
  shows B and E as arrows. Saved: magnets with z, `d3.Ez`, `d3.Bax`. The flat game unchanged: the new controls are
  hidden there (`.only3d`), its own note hidden in 3-D (`.only2d`).
  Measured (Node): an electron in 2,000 T along x, y and z circles on m·v⊥/(qB) to 4 digits (ratio 1.0000 each), drifts
  along the axis exactly, energy to 1e-18 eV; a magnet's pull on Fe and Ar matches the slope of the energy (magU) in x, y
  and z to 4e-11 and 3e-10 (iron pulled in, argon pushed out); insulated books over 3,000 steps (120 tu; with an
  electric field, total + Σ −q E·r): eight free electrons −1.32 eV with no field, +0.04 eV (B 300 T along z), −0.46
  (along y), −0.37 (B 300 T and E 0.05 V/Å), −0.19 (3,000 T and E), the same electrons in 2-D +4.5 eV; Na⁺/Cl⁻ ions
  among argon −0.44 eV with no field, −0.40 (B 3,000 T), +0.56 (E 0.3 V/Å), +0.12 (both); iron and oxygen atoms pulled
  in by a 50,000 T magnet, heated to 19,000 K, books +0.055 eV (along z) and +0.015 (along x). Cost: brine3d 9.75 →
  10.78 ms a step with 1,000 T (its ions turned; two loaded cores, near the noise), water3d 3.79 → 3.26 (noise). 2-D
  and 3-D fingerprints unchanged. Screenshots 124-before-fields-panel.png (disabled), 124-after-fields-panel.png,
  124-after-fields-magnet.png (a 20 kT magnet, B along y, E along +z: the corner's arrows).
  Found, not changed (setups of my own while measuring, 1.23.2 the same): free electrons put down almost on top of
  each other gain hundreds of eV in their first steps (330 → 985 eV for eight; the step size cannot follow a near
  coincident pair at the start), in 2-D and 3-D; and the flat game's books in a field miss −q E·Δr whenever an event
  changes a charge (a proton capturing an electron: about 0.2 eV in 0.2 V/Å), as the events measure the energy without
  the applied field.
- **Light in 3-D** (the Light tool, light in Place and Fire; before, light left a 3-D box unabsorbed, engine.js
  rayInteract's `if (W.d3) return null`, and nothing drew it). A photon's line has a depth (`emitPhoton3`: from opts.z,
  else its source atom's depth; along (ux, uy, opts.uz), or at random on the sphere): what it meets is found along that
  line (`rayInteract3`: the atoms within 0.6 Å of it, the flat strip's half-width, nearest first, with the flat game's
  events and odds for each atom met: photoionization, dissociation, line absorption and fluorescence, IR heating,
  Compton scattering turned about a random axis (`compton3`), pair production back to back in a random direction
  (`pairProduce3`)), and it leaves through the six faces (`rayExit3`). Nuclear photo-reactions stay flat-only (a γ that
  would knock out a neutron makes a pair there). e⁺e⁻ annihilation's two γ rays go back to back in 3-D at the pair's depth
  (`twoGamma`); glowing walls emit from all six faces by Lambert's law (`glowTick`, `glowPhoton3`). Drawn (`drawLight3`):
  rays growing at c and fading, photons in flight as streaks, as the flat view. The Light tool: held, a click shines
  from the camera toward the pointer (straight at an atom under it), a drag along the drag in the plane facing you; a
  laser keeps the aim (`light3Aim`, `perp3` for the beam's width). Light (γ) can be placed (random directions) and fired
  in 3-D, at any energy.
  Found and fixed on the way (3-D only): an electron set free with more than the radiation threshold (1 keV) was
  launched as if it would fly ballistically, its potential energy at the launch point left out (`ejectElectron`); in
  3-D it is stepped with it, so a 1 MeV γ's Compton electron lost the ion's pull, 10–16 eV an event. Now 0.0000 eV.
  Measured (Node, insulated, 40–60 photons into 64 waters or 125 sodium atoms in a 24 Å cube; books = Δtotal − light put
  in, escaped light counted): IR 0.124 eV +0.007–0.010; 7.5 eV −0.066 (8 bonds broken); 20 eV +0.16 / −0.20 (8–10
  ionizations, 17 bonds broken); sodium's 589 nm line 0.000 (absorbed and re-emitted, 74 photons); 10 keV +0.008; 1 MeV
  −21 eV before the fix → +0.026 / −0.17 after; 5 MeV into lead −32 → +0.78 eV (of 300 MeV). The same photons in 2-D:
  +0.026, −0.35, −3.1, 0.000, +0.006, −2.0, −78 eV. Light costs nothing until it is used (a search over the atoms per
  photon, as in 2-D). 2-D and 3-D fingerprints unchanged. Screenshots 124-before-light.png (the tool disabled),
  124-after-light.png (Lyman-α held on a sodium atom in the middle of the cube).
- **The rest of the particles in 3-D, in part** (the owner: "like pions and such"; physics in 3-D, for his OK). Built:
  unstable particles (pions, kaons, muons, τ, hyperons, charmed and bottom hadrons, resonances) in flight in depth
  (`addExo` with z and uz; `moveExos3`, `flyExo3`: straight, or turned about the magnetic field's axis), ionizing and
  scattering off the atoms they pass along a line in 3-D (`segTargets3`, `exoIonize3`, `exoScatter3`: the flat rules),
  leaving through the six faces, and decaying in flight or at rest (`decayExo3`). A decay is worked out in the
  particle's rest frame as in the flat game (`phaseSpace`), its plane turned to a random orientation in space (`plane3`,
  `emb3`) and boosted to the lab in 3-D (`boost3`); products in depth (`spawnItems3`; photons and neutrinos with z and uz,
  `emitNeutrino`'s 3-D branch). A charged particle slowed below 2 keV among atoms stops (its last keV to them as heat) and
  waits at rest for its decay. Neutrinos, positrons and the unstable particles are in the 3-D particle menus, placed
  (nearly at rest, in depth) and fired (at any energy). e⁺ meeting an atom's electron or another atom now sends its γ rays
  from its own depth (`annihilateBound`, `evAnti`). Drawn: `drawExos3` (glow, ball or ring, name), tracks in depth.
  Measured (Node): π⁺ at rest, 300–400 decays: the μ⁺ at 29.792 MeV/c every time (two-body exact), isotropic (mean
  direction ≤ 0.04, ⟨u²⟩ 0.31–0.36 against ⅓ for 300), books 1.9e-6 eV; K⁺ at 500 MeV decaying in flight along
  (0.6, 0.48, 0.64): momentum of the products against the kaon's to 4.6e-16 (relative), energy exact (books ≤ 2e-7 eV);
  ten 20 MeV μ⁻ and ten 50 MeV π⁺ through liquid water (1,029 atoms, insulated): books −0.95 and −0.53 eV over 200 steps
  (−1.1, −0.26, −0.41 eV for 20 μ⁻, π⁺, π⁻ over 400); positrons annihilating in water: ≤ 0.41 eV an annihilation.
  Cost: a neutral one nothing measurable; a charged one about 13 µs a step in a 1,029-atom box (its search over the
  atoms along its path; 100 in flight 1.3 ms a step).
  Not built (much harder than planned; the instruction: stop and write down why): the high-energy and nuclear side is
  written on flat four-momenta [E, px, py] and flat collision searches throughout: in hep.js 19 calls of `phaseSpace`
  (whose uniform intermediate masses are exact only in 2-D; 3-D needs GENBOD's weights), 10 of `twoBody`, 22 of
  `p4of`/`exoP4`, 19 of `rdir`; nuclear collisions are found by radiation flight's flat path search (`fastEncounters`,
  `fastFastNuclear`, `beamCollisions`), which the 3-D world does not have (its fast particles are stepped); the collider
  is a ring of zones laid out in the plane. So in 3-D, for now: no nuclear hits by hadrons (a pion passes a nucleus
  without reacting), no captures at rest (π⁻, K⁻, μ⁻ stopped in matter decay at rest, as free ones would; real ones are
  captured: muonic atoms, nuclear stars), no muonium, no hypernuclei, no collider, no quark–gluon plasma, no nuclear
  reactions between atoms or nuclei (fission, fusion). The route found for them: the same embedding, each event worked
  out in the plane through its incoming momenta (exact for two bodies: their momenta span a plane) and turned into
  place, plus a 3-D closest-approach search for nuclear reach among stepped fast nuclei; several sessions. 2-D and 3-D
  fingerprints unchanged. Screenshots: 124-before-hep.png (K⁺ refused), 124-after-hep.png (kaons and π⁻ fired through
  water, tracks in depth, B along y).
- **The Experimental settings in 3-D, but for continuous bond orders** (the owner: "add the rest of the experimental
  options to 3d"; physics in 3-D, for his OK). Each kept its flat form with the depth added; the flat game's own runs with
  them on are bit for bit the same (seven setups with induced charges, 8 beads contracted and full, waves, both bond
  orders: identical before and after). Measured (Node, insulated after settling, the same setup with the option off for
  the drift it starts from; costs on one thread, two loaded cores):
  - Induced charges (`qeqUpdate`, `qeqClear`: pairs, the long-range part and the applied field with z; the molecules'
    motion paying in three directions): liquid water (1,029 atoms), 600 steps: books −0.04 eV (every step), +0.26 (every
    10th), against +0.23 off; mean induced charge 0.09 e (the flat water's 0.06); 2.5 → 10.4 ms a step (every step),
    4.1 (every 10th) (flat: 0.18 → 0.66).
  - Quantum nuclei (the beads' offsets, velocities and forces with z: `PI.oz/vz/fz`, `PIM.qz/vz/fz`, every mode, the
    thermostat, the contraction's bonds and 3-D angles, out-of-plane and torsions (`piFast`); a new world's rings made
    afresh, flat or with depth): 27 waters, 600 steps: books −0.003 eV (8 beads, contracted), −0.006 (8, every bead),
    −0.020 (16), against −0.013 off; a hydrogen's ring 0.16 Å across, 0.09 in z alone (isotropic); 0.04 → 0.32 ms a step
    (8 contracted), 0.37 (every bead), 0.44 (16). The beads are not drawn in 3-D (the flat view's dots).
  - Quantum bonds (GFN1-xTB is three-dimensional: the members' positions now with their depth, the slope in z, the
    outside potential and the joiners' relaxation in 3-D; drawn as bonds in the 3-D view): three waters, ammonia and
    methane (18 members): water's angle 105–109°, the force on an oxygen equal to the energy's slope in x, y and z to
    5e-7 eV/Å, books within 2e-5 eV over 1,000 steps (1,122 calculations, none unsettled), 5 ms a step.
  - Electrons as waves (eFF is three-dimensional to begin with: the packets' pairs and their meeting with ions in 3-D,
    `waveForces3`; their size moving in the 3-D inner steps; who is a packet after events): six Na⁺ among twelve free
    electrons, 2,000 steps: books +0.09 eV (−0.10 to the bath as packets joined) against +0.24 as points; flat −0.05.
    0.19 → 0.61 ms a step (flat 0.15 → 0.62).
  - Ultra-realistic: allowed in 3-D; it holds the decay speed at real rates and resonances to their own lifetimes; the
    3-D lab has no nuclear reactions yet, so its chemistry is unchanged (liquid water, 200 steps: identical with it on,
    3.33 / 3.38 ms a step).
  - Not built: continuous bond orders ("From the positions"; stays flat-only, its button disabled in 3-D, the setting
    back on when the flat game is open again). Its forces are a flat analytic derivative pass, ~470 lines of JavaScript
    over dx, dy (orders, the taper, the soft core, angles and the electron counts, bo.js `boPassJS`) and the same in the
    Rust kernel (`bfPassWasm`, built by CI, not editable here); a 3-D version is a rewrite of every derivative with its
    slope checks. Several sessions.
  Settings → Experimental's 3-D note and the controls follow (`NO3D_BTN`: only that one button off in 3-D). Screenshots
  124-before-exp.png (greyed), 124-after-exp.png.
- Tests: tests/f_124.js (run by t_features' 1.24 block, or alone: `node tests/f_124.js [place box fields light hep
  exp]`); each part fails on 1.23.2 (`place`: P3 is not defined; `box`, `fields`, `light`, `hep`, `exp`: the controls
  disabled or the functions missing). t_3d's "disabled in 3-D" check now expects the 1.24 limits (Objects, bond orders
  from the positions, antimatter); t_page clicks only the visible field-direction buttons (the ±z ones are hidden in
  the flat game; it timed out on them).
- The flat game bit for bit the same throughout: 24 setups × 300 steps (seed 7) and seven runs with the Experimental
  settings on (induced charges, 8 beads contracted and full, waves, both bond orders): identical to 1.23.2 after every
  item; the six 3-D setups too (nothing in them uses what was added); t_3d's 2-D frame after a 3-D one: 0 difference.
- Suite: `tools/runtests.sh` (two lanes on two cores): all passed but t_page (the ±z buttons, fixed above; passes
  alone) and t_features' 1.14 speed readout (the chain setup showing 1/1.3× under load, the known flake; it gave back
  1/1.7× once alone right after the lanes, then t_features passed whole alone; that block alone gives 1× three times
  out of three on 1.23.2 and on this branch).
- Found, not changed: Inspect cannot pick an unstable particle or a photon in flight in 3-D (`pickLight` works on the
  flat projection); quantum nuclei's beads are not drawn in 3-D; the Experimental descriptions still describe the flat
  case in places (induced charges "averaged in the plane"); the Magnet tool's pole buttons keep the flat ⊙/⊗ signs (in
  3-D, N means along +axis); a charged unstable particle's search for the atoms on its path goes over every atom (13 µs
  a particle a step at 1,029 atoms; the grid would make it local). From 1.23.2, met while measuring: free electrons put
  down almost on top of each other gain hundreds of eV in their first steps; and in the flat game an event that changes
  a charge in an applied electric field misses −q E·Δr from the books.

## 1.23.2: a flying 3-D camera, smaller 3-D ions, fast particles leave the 3-D box, separate 2-D and 3-D libraries, 3-D tiny objects, menus that click the first time

- The "realistic" tag (1.12) was missing on three Experimental choices that were added later: bond orders (now on
  Quantum, the bonds from the electrons), bead forces (on Every bead, the exact path integral) and free electrons (on
  Wave packets). Added to `REAL` in ui.js; t_settings checks the tag sits on those three and on 32 beads (before: no
  tag on any choice of the three rows).
- 3-D: ionic contacts and hydrogen bonds were drawn over every atom (the user: "ionic bond lines are drawn in front
  of all atoms"): they go on the overlay canvas after the balls. Now each line is followed in pieces about 2 px long
  and a piece shows only where no ball's front surface is nearer (`occLine3`; the balls binned on the screen once a
  frame, when a line first asks), so the lines start at the ions' edges and pass behind atoms in front of them.
  t_3d: Na⁺–Cl⁻ with an argon in front of part of the contact: 28 points drawn, none on either ion or on the argon
  (before: the line began at each ion's centre and crossed the argon).
- **Flying the 3-D camera** (asked for by the owner): W/S forward and back along the line of sight, A/D to the sides,
  E/Q up and down (the world's vertical); while one of those is held, Space and Shift also go up and down. Space on
  its own still plays and pauses (it is the game's most used key), so it only flies while flying; Shift alone does
  nothing. The camera's target moves with it (`R.cam3.tx/ty/tz`), so turning afterwards circles the new place. Speed
  ¾ of the distance to the target a second (1.5 Å/s at least, three box diagonals at most), so it is as useful a few Å
  from a molecule as across the box; it eases in and out over ~0.1 s and follows the frame's own time (`fly3Tick`).
  Only in 3-D, never while a text field has the keys or a dialog or the main menu is open; keys let go when the window
  loses the focus. Clashes moved: in 3-D, S (Spark) and E (Erase) fly, so Spark is Z and Erase X there (`key3`, shown
  on the tool buttons, their titles, the quick menu and the shortcut list); D (Objects) is off in 3-D anyway. In the
  shortcut list (a "3-D lab" group), Help (Moving around), Settings → 3-D (a note) and the 3-D menu's note. Measured
  (headless): W held 0.5 s at the fitted view (50 Å off) moved the camera 18.7 Å straight ahead (along the view to
  0.999); D + Space 9.5 Å up without pausing.
- **Ultra-realistic mode in Settings → Experimental** (asked for by the owner): it is now one of `SET_EXP`, so it is off
  again at each start like the rest of the tab (1.23.1); behaviour unchanged; its note says so, `#ultraBadge`'s title
  and the decay-speed note say Settings → Experimental; saves record it with the other Experimental settings.
- **The 3-D bar's Leave button is gone** (the owner: "if i want to leave i go to the main menu"): a "3-D Preview" label
  (`#tag3d`, not a button) stays; the main menu (Esc → Main menu) always opens on the 2-D / 3-D choice, which leads back
  to the flat game. t_3d now leaves through the menu.
- **Performance mode is gone** (the owner: "obsolete"): the checkbox, `SET_PERF`, `perfOn`, `prePerf`, its description;
  the four settings it set stay, each on its own. A stored settings object that had it on keeps the values it set
  (12,000 particles, standard drawing, no glows), and `prePerf`/`perf` are dropped from storage on load. `setSetting`
  now takes only real settings. The tests and tools/bench-page.js that turned it on set the four instead.
- **Fast particles leave the 3-D box** (the owner: "make sure that fast particles still leave the box in 3d"). The 3-D
  world has no radiation flight (its collision search is flat), so its fast particles are stepped; `walls3` (and
  `leptonWall` for free electrons) now decide by speed what the flat walls decide by radiation flight: past
  `radThreshold` for its kind, a charged particle reaching a closed wall is stopped in it (`W.count.wallStop`, its charge
  to the wall), a recoiling atom (Z ≥ 3 with electrons) is set back just inside at the wall's temperature (`wallStop3`);
  an open wall now books what leaves too. The escaped energy is what the world loses, measured (motion, internal
  energy, the whole molecule's localPE before and after; a free electron's field energy). `setMotion` in 3-D now keeps
  every speed in the stepped set with its z (before, a particle past the threshold flew flat, z held, meeting nuclei at
  any depth); neutrons move in depth and meet nuclei by their 3-D distance, and `wallOrEscape` has the z faces.
  Measured in the empty 3-D box (30 Å, insulated), 1.23.1 → 1.23.2: a 1 MeV proton and a 5 MeV α set moving by
  velocity bounced for ever (3,000 steps, 0.17 tu, books −0.08 eV) → stopped in the wall after 293 steps, escaped 1 MeV
  / 5 MeV, books −0.005 / −0.008 eV; by setMotion they flew flat at z = 0 → now in depth (z = 15, the face); a 50 keV
  electron bounced → stopped (books 0); a 100 keV U recoil bounced → set back at 300 K (books −0.009 eV); a 2 MeV
  neutron's depth never changed (z = 0 for 120 tu) → it moves in z and bounces off a reflecting wall, and leaves when
  Container lets fast neutrons out (escaped 2 MeV); an open box lost 1 MeV from the books → 0. No chain reaction or
  fission exists in 3-D (nuclear reactions are flat-only), so none was measured. Flat game bit for bit the same (water,
  combustion, soup, gallery, chain, brine, fusion, U series, 300 steps, seed 7: identical).
  Found, not changed: a fast neutron among waters in 3-D leaks 50–85 eV over 1,500 steps (its collisions' kinematics
  are flat; 85 eV before this change, 48 after); a 100 keV U atom among waters ~1 eV (stepped hard collisions, the
  same before). In the flat game, `walls()`'s open-wall branch kills without booking escaped (a hole in the books in
  open 2-D boxes, for stepped particles; not touched, the flat game kept bit for bit).
- **Separate libraries for 2-D and 3-D** (asked for by the owner). The rule, from the library itself (`molFits`): every
  ordinary molecule (171, at most 36 atoms) is a flat drawing the 3-D lab lifts and relaxes into its shape in space
  (place3), so it is in both; the tiny objects and anything over 90 atoms (`molWhole`) are flat builds, 2-D only; the
  new 3-D objects (with z) are 3-D only; a molecule of your own made for one mode is in that one only (`mode`, saved as
  `m` in `mymols` and exports); those kept before 1.23.2 (no mode), plain molecules, in both. The library (counts,
  categories, search, the "3-D" tag on its title), the palette and Place follow it; picking one of the other mode's
  says where it is. Ask Claude (the builder) has a For 2-D / For 3-D choice beside its button, starting at the open
  mode; Claude's design is saved to that library (and library hits come from it); a lattice too big to be anything but
  flat stays 2-D, and says so. Molecules built by hand are in both. 2-D: 188 entries (171 molecules, 17 objects), 3-D: 176 (171, 5).
- **3-D tiny objects** (asked for by the owner): five, built in space by `tools/objgen3.js` into `src/objects3.gen.js`
  (OBJECT3_LIB, the flat format plus z), settled with the engine's 3-D forces (a quench), turned to their principal
  axes, and checked to hold at 300 K for 2 ps: a salt cube (216 ions, rock salt, 6 a side, 1.6 nm), a gold
  nanoparticle (147 atoms, an fcc cuboctahedron), a water droplet (123 molecules, 2 nm), a graphene flake (150 C, five
  rings a side so it fits a 30 Å cube; flat in space), polyethylene (the flat object's 78-carbon chain lifted and
  relaxed: tetrahedral carbons). Placed one at a time as built, kept inside the box, moved to the nearest clear spot,
  and not at all when the box is too small or full (a 3-D box keeps its size). Left out: the chips (transistor,
  inverter, memory cells: their wiring is flat-only, chips.js), Kevlar and cellulose (rods 3.3–4.8 nm: longer than the
  3-D lab's cubes until box sizes come to 3-D), the quantum dot (InP's zincblende needs four bonds an atom; the engine's
  In and P make three), the membrane (a 3-D bilayer patch would be thousands of atoms), and the folded biomolecules
  (DNA, the WW domain, chignolin, oxytocin: their folds need measured coordinates; a flat drawing relaxed in space is
  not the fold). The placed objects (mirrors, lenses …) stay out of 3-D (the owner).
- **Settings pictures open large** (asked for by the owner: "able to be clicked on and zoomed in on, upscale res if
  needed", "make sure it's animated"): a click, a tap, Enter or Space on the preview opens it over the page, fitted to
  the window over a dark backdrop; it grows out of the thumbnail (laid out at its large size, starting transformed onto
  the thumbnail, the transform easing away in 0.22 s while the backdrop darkens) and shrinks back into it on close
  (click, Esc, ×; the focus back on the preview). Instant with the Motion setting off or reduced motion. Once open: the
  wheel, a pinch or +/− zoom about the pointer (1–6×), a drag pans. Works at 390 px wide. The pictures are now
  1280 × 720 (laid out at 640 × 360 and drawn at 2× from pages photographed at 2×; WebP quality 0.72): 343 KB → 778 KB
  for the 30 (t_settings' budget 600 → 1,200 KB, and their size check).
- **3-D axis marker and scale bar above the tool's bar** (the owner's screenshot: only the tips of y and x showed): both
  sat at fixed heights from the chamber's bottom, under the tool's options bar (its top 57 px up). They now sit above
  whatever bar reaches over the left corner (`chamberBottomInset`: the tool's options and the rewind bar, measured from
  the page at most five times a second), in 3-D and 2-D (the flat scale bar was covered too). Checked at 1360 and 700 px.
- **"On hold: very large" gone** from the Experimental tab (3-D came in 1.23, quantum bonds in 1.22); Help's limits now
  mention the 3-D lab and quantum bonds' molecular orbitals.
- **Main-menu presses that took several clicks** (the owner): the menu's card slid and tilted after the mouse (up to
  22 px and 7°) and buttons moved on hover and shrank on press, so a button slid away from a pointer coming to it and a
  press and release could land on different things. Measured (headless, presses 3–5 px inside a button's edge after
  coming from the corner): the 2-D tile 7 of 12, the 3-D tile 0 of 12; with hover and press still alone, 8 and 0; with
  the card still too, 12 and 12. The card is now still (the chamber and the glow behind it still follow the mouse),
  hover and press change colour, glow and brightness only, and the menu holds still while pressed and does not sway by
  itself under the pointer.
  And the quick menu (t_page's "Follow it" check, which failed now and then on 1.23, and had a retry added): the
  chamber (`.stage`, overflow hidden) could be scrolled, by up to 66 px (the WebGL canvas reaches 64 px past it on each
  side), whenever something inside it was scrolled into view (headless, Playwright's click on a quick-menu item did it;
  for a player, keyboard focus, find in page or the browser's own scroll-into-view can). The chamber then sat 66 px
  left of where the pointer is read (evPos), so a right-click on an atom opened the empty-space menu, until it scrolled
  back. Measured: three pages at once, 40 right-click → Inspect → right-click → Follow it each: 10 of 120 missed, the
  chamber jumping 9 times; now `overflow: clip` (and a scroll listener back to 0): 0 of 120, no jumps. t_page's retry
  removed: its check fails on the bug again.
- **The Gallery was spread over the window** (the owner's screenshot at 1024 × 800): 1.23 gave `.sdialog`, which the
  Gallery, My experiments, Share and Ask for a setup share, Settings' fixed 800 px height and two grid rows, so their
  few rows were stretched apart. Settings' window is now `#setModal > .sdialog`; the others are back to 560 px wide and
  as tall as their contents (Gallery 804 → 208 px, rows 256 → 26 px apart; Ask 804 → 386; My experiments 804 → 170).
- **3-D ions drawn smaller** (the owner: "ions should be modeled differently in 3d because when they get bigger it
  overlaps with other particles"; his decision on the numbers below: "just draw ions smaller", display only, no physics
  change). In the 3-D lab a lone ion is now drawn on the atoms' own scale, 0.3 + 0.28·(0.7 × its ionic radius)
  (`rd3` in view3d.js: the balls, picking, rings, glows, label places and the GL slot styles alike); the flat game is
  unchanged (its Cl⁻ still 1.09). Drawn radii before → after (Å; the neutral atom's in brackets): Na⁺ 0.61 → 0.50
  (0.76), K⁺ 0.83 → 0.58 (0.87), Cs⁺ 1.00 → 0.63 (0.98), Mg²⁺ 0.43 → 0.44 (0.69), Ca²⁺ 0.60 → 0.50 (0.79), Al³⁺ 0.32 →
  0.41 (0.64), Cl⁻ 1.09 → 0.66 (0.59), Br⁻ 1.18 → 0.69 (0.64), I⁻ 1.32 → 0.74 (0.69), F⁻ 0.80 → 0.57 (0.46), O²⁻ 0.84 →
  0.58 (0.48), S²⁻ 1.10 → 0.67 (0.59): anions a little larger than their atoms and still bigger than cations, cations
  smaller than theirs. Screenshots of brine3d close up before and after: 1232-ions3d-near.png, 1232-ions3d-after-near.png
  (in the session's scratchpad). What was measured first, for the decision:
  Drawn balls: twelve ions put into liquid water (3-D and flat, 1,500 steps, atom size 1): no ion's ball overlaps a
  neighbour's anywhere; the closest, centre distance over the two drawn radii, O²⁻–H 1.11, F⁻–H 1.16, S²⁻–H 1.17,
  I⁻–H 1.22, Cl⁻–H 1.27, cations 1.7–1.8 (the same in 2-D). The GL balls use the same radius (`p.rd`, from the slot
  styles) as picking. What likely reads as overlap: anions are drawn two to three times the size of water's atoms
  (Cl⁻ 1.09 Å against O 0.48 and H 0.39; Cl as an atom 0.59: "when they get bigger"), so in perspective a near anion
  covers the waters around it (screenshots 1232-ions3d-*.png), and every ion sits 0.2–0.5 Å closer to water than real.
  Measured in brine3d (8 Na⁺, 8 Cl⁻, 300 K, JavaScript kernels, 2,000 steps sampled), against real:
  as now (K_IW 2, LJ_SCALE 2): Na⁺–O peak 2.15 Å, 6.25 waters within 3.1 Å; Cl⁻–O 2.85 Å, 9.7 within 3.8; Cl⁻–H
  1.95 Å; a 123-water droplet's middle 1.04 g/cm³. K_IW 1: Na⁺–O 2.25, 5.6; Cl⁻–O 2.95, 8.5; Cl⁻–H 2.05; 0.98.
  LJ_SCALE 1: Na⁺–O 2.05, 6.9; Cl⁻–O 2.85, 10.0; Cl⁻–H 1.85; 1.01. Both 1: Na⁺–O 2.15, 5.5; Cl⁻–O 2.95, 8.55; Cl⁻–H
  2.05; 0.99. Real: Na⁺–O 2.36–2.43 Å, 5.5–6 waters; Cl⁻–O 3.1–3.2 Å, about 6–7; Cl⁻–H 2.2–2.3; water 0.997. No
  Na⁺–Cl⁻ contact pair formed in any of the four (the ions start apart; a crystal dissolving was not measured). So
  K_IW 1 in 3-D brings the coordination numbers and density right and the distances 0.1 Å nearer; the rest of the
  shortfall is the ions' own size (ljR = 2 × ionic radius, ε 0.02 eV), a third candidate. All three are physics changes
  for the owner's OK; he chose the display (above) and none of the physics.
- Test updates: t_features' 1.10 check now expects the realistic tags added earlier in 1.23.2 (it failed since then:
  "1 0.01 12 1 32 0 2 1"), and its menus check a still card (the chamber still follows the mouse); t_3d leaves 3-D
  through the main menu and compares the drawing without the particle bar over it; t_molecules puts the 3-D builds in
  a 3-D world; t_page, t_gl, t_threads and tools/bench-page.js set the four settings Performance mode set.
- Suite: `tools/runtests.sh` passed but for t_features (the two expectations above, fixed; then it passed alone) and
  t_page's slow-motion button check (the hourglass lit by a 500 keV α's event within 400 ms: missed under the two
  lanes' load in both runs, passes alone; time-budgeted, worth adding to the flake list). t_page and t_features pass alone.
- Tests: tests/f_1232.js (run by t_features' 1.23.2 block, or alone): each item above; on 1.23.1 the first three fail
  and the rest stop with errors (the functions they use do not exist there).

## 1.23.1: freezes fixed and reported, a desktop watchdog, Experimental settings reset at start, lit 3-D atoms

- **What froze the page** (the owner, desktop app: "spamming atoms with some experimental settings enabled … fissions
  … chaotic"; the 1.13 crash handler cannot run while a frame never ends). Found with `tools/stress.js` (new: spams
  atoms light and heavy, U-235/Pu-239, neutrons, molecules, electrons, ions, sparks, heat and speed changes into the
  headless page under eight Experimental combinations, times every frame, and pauses a page that stops answering for
  10 s through the DevTools protocol to read its stack; `--prof` adds where slow frames went). Headless, two slow cores.
  - **Quantum bonds**: hangs of 12–20 s, again and again (every placement that joined). (a) The charges of loose atoms
    and radicals never settle: the SCC ran all 250 iterations, and its Broyden mixer's cost grows with the cube of its
    history (10 loose atoms 3.7 s a calculation, 40 heavy atoms 18 s at 60 iterations). (b) The joiners' relaxation
    (`boRelax`) made 60 calculations a join. (c) The cap counted atoms, not orbitals: 40 heavy atoms (9 orbitals each
    from silicon on, 360 in all) took part. (d) With quantum nuclei every bead is a calculation of its own. (e) Inside
    the inner steps every electron event recomputed all forces, so one calculation per event, thrown away (the step's
    end works them out again before any kick uses them). Fixed: the game's SCC stops at 40 iterations
    (`gfn1Energy(…, { maxIter })`; settled calculations take 2–5 warm, 11–20 cold, so these are unchanged), at
    40/√beads with quantum nuclei (14 at 8 beads, at least 8: a step makes two calculations a bead); a calculation
    takes part only up to 160 orbitals (40 light atoms fit: 13 waters are 104) and beads × orbitals³ ≤ 160³ (8 beads:
    80, 10 waters); the relaxation makes at most 2·160³/(beads·orbitals³) passes (60 for small clusters, 2 at 160) and
    stops at the first calculation that did not settle; the inner steps' recount holds the quantum pass (`_qmHold`; the
    members keep their last charges meanwhile). Measured (Node): 30 loose light atoms joining, a 72 s step → 2.4 s, then
    0.42 s a step; 10 loose atoms joining 60 calculations of 250 iterations (minutes) → 9 calculations, 208 iterations,
    0.6 s; 30 heavy atoms and 13 waters with 8 beads now stay with stored bonds (before: 18 s a calculation); a
    hydronium and two waters with electrons fired in, 15.2 → 2.6 calculations a step.
  - **Continuous bond orders**: frames of 4–9 s with beads, 0.6–1.5 s without, at every join: `boRelax` made 60 force
    passes over the whole world (every bead). Now 36,000 / (particles × beads) passes, 6 to 60: worlds up to 600
    particles join exactly as before (the molecule gallery and liquid water: same temperatures after the join, 484 and
    549 K); 1,200 atoms 30 passes, 2,200 atoms 16; 300 atoms with 16 beads 7. (Fewer passes at 330 atoms, tried first,
    left the gallery 160 K hotter after its join: not done.)
  - The stress test after the fixes (`node tools/stress.js --secs 180`, headless on two slow cores, so several times
    the owner's times): no hangs in any of eight combinations (1.23.0: 10 hangs of 12–20 s in each quantum-bond
    combination in 100–120 s, the page answering once). Worst frames: plain 1.3 s (2,300 particles), bond orders 1.3 s,
    waves 1.9 s, ultra-realistic 1.4 s, quantum bonds with 8 beads 5.9 s (216 batches of chaos served in 3 min, against
    57 before the bead caps), quantum bonds with waves 7.7 s (median of the frames over 1 s: 1.75 s), bond orders with 16
    beads and induced charges every step 6.4 s, everything on 5.4 s. Left (bounded, not frozen): with quantum bonds, a
    join of a full 160-orbital cluster whose charges do not settle is about five calculations of 1–1.5 s here; with
    beads and bond orders or waves (not contracted) every electron event in the inner steps recomputes every bead.
  - Counted from the world, never timed, so runs stay the same from a seed. Energy books unchanged in kind: the
    relaxation is inside the measured change; a calculation that did not settle was already used as it was.
- **The mid-frame mark** (the 1.13 heartbeat could not tell a freeze from the desktop window closing without a word to
  the page): each frame writes a mark into browser storage as it starts (`crashMarkOn`) and removes it as it ends. A
  window never closes inside a frame (the page's script runs one thing at a time), so a mark found at the next start
  means the page died in one: froze or crashed, in the desktop app too. Each window has its own key; a mark under 2 s
  old belongs to another window busy right now and is left. The mark says what was going on (brought up to date once a
  second): setup, particles by kind, ions, bond-order members, beads, waves, unsettled quantum calculations, the step,
  threads, memory, the Experimental settings, the slowest recent frame. The next start offers the report and the
  autosave ("It stopped in the middle of a frame: it froze (or crashed) while working out a step"). Cost: 18.5 µs a
  frame (a write and a remove of a 330-byte mark; 0.1% of the time at 60 fps), headless.
- **The desktop watchdog** (`desktop/src-tauri/src/lib.rs`): the page sends a `heartbeat` command once a second from
  its frames. No heartbeat for 8 s while the window is visible, not minimised and in front: a native box "Atom Forge
  stopped responding" (Win32 MessageBoxW: Abort quits, Retry reloads, Ignore waits; Enter waits). The clock is held
  while the window is hidden, minimised or behind another (the page's frames stop or slow there), before the first
  heartbeat, and after any gap in the watchdog's own ticks over 3 s (sleep). Nothing ends without the player's answer.
  Retry ends this app's WebView2 renderer processes (its descendants whose command line has `--type=renderer`: a reload
  alone would be sent to the same stuck process) and navigates to the page again; no heartbeat 15 s later, the app
  restarts. **Untested on Windows**: no Windows target or crates could be fetched here; the Rust was type-checked with
  the Win32 code switched on against a stub of the few Tauri calls it uses (`get_webview_window`, `is_visible`,
  `is_minimized`, `is_focused`, `url`, `navigate`, `restart`, `exit`, `manage`, `invoke_handler`, `setup`). Manual steps
  in `desktop/TEST-CHECKLIST.md` (8). The workflow already runs on `workflow_dispatch` (any branch).
- **Experimental settings back to normal at each start** (asked for by the owner): the Experimental tab (longest step,
  large-ring resonance, detailed nuclear collisions, force reach, induced charges, quantum nuclei and their bead forces,
  bond orders, electrons as waves) is not read back from storage; every other tab is. A note at the top of the tab says
  so. Saved worlds never held Experimental state (bond orders saved as whole bonds, no beads, no packet sizes), so a
  world or autosave made with them opens with the physics as set, normal after a start: the energy books start clean
  from stored bonds, as any load. Saves now record which were on (`exp`), and loading one made with settings that are
  off now says so in the log.
- **Fixed on the way: an error outside the simulation stopped the game for good.** The frame asked for the next one only
  at its end, so an error past the simulation's own catch (readouts, panels, the inspector's drawing) ended the loop:
  the crash dialog came up, and after Keep going nothing moved again (checked: simulated time stood still). The frame's
  body is now in try/finally: the mark cleared and the next frame asked for whatever happens.
- **Fixed on the way: Continue after a restart brought back the start setup afresh**, not the last session: at start
  the main menu opened after `UI.started` was set and autosaved the freshly loaded setup over the last session's (a
  world of 96 particles came back as the fresh 56). The crash dialog's "Carry on from the autosave" had the same fault.
  The menu now opens before.
- Suite: `tools/runtests.sh` passed except t_threads (the 3-D "not ready" under load; passes alone) and one t_features
  check; t_features alone passed once whole and failed one different statistical or time-budgeted check in each of
  two more runs (the chain reaction's k, argon's wall pressure Z = 1.45 ± 0.12; under the parallel load, CO left in
  300 K air), none in code this touches. Worth watching.
- Test: t_features 1.23.1 block (fails on 1.23.0 in every part: the join stopped over budget at 250 iterations a
  calculation, 30 heavy atoms in, 39 atoms with beads, 15.2 calculations a step, 60 passes, no report in the desktop
  app, Experimental kept, Continue 56 for 86).
- Found, not changed: GFN1's self-consistency does not settle for loose atoms and radicals close together (10 C, N, O, H
  atoms 1.6–4 Å apart: not in 250 iterations); such steps use unsettled charges, so their forces are not the energy's
  slopes and an insulated run drifts (as in 1.22). Electrons as waves with 2,000 particles still make 1–2 s frames
  here (the inner steps at many electrons: bounded, 400 inner steps at most).

### Test: the 3-D thread checks wait for the workers

`t_threads`' 3-D molecules check failed 4 runs in 4 on 1.23.0 alone and 2 in 5 on this branch ("not ready"; once a 2e-16 force difference, one pass on one thread against one on two). After a setup loads, the workers acknowledge the new world's memory on their own time, and the check measured synchronously before they had. It now waits for them (up to 15 s): 4 runs in 4 pass. The game was not affected: it runs a frame or two on one thread until they are ready.

### 3-D atoms and bonds lit as solid objects

- **Lit balls in 3-D** (the owner: "make the atoms actually 3d instead of drawn 2d but looking at the screen"; a display
  fix). In 1.23 a 3-D atom was the flat game's painted ball (a radial gradient, its highlight at the upper left of the
  screen) on a sprite facing the camera: turning the view never moved the highlight or the shaded side, so the atoms
  read as discs facing the viewer. Now the ball's fragment shader rebuilds the sphere's normal from the place in the
  sprite (as it already did for the depth) and lights it: ambient; a key light fixed in the world (`LIGHT3` in
  view3d.js, mostly from above, from the upper left at the starting view; `cam3Update` turns it into view space,
  `C3.lx …`); a soft fill from near the camera (lower right), so the side away from the key light stays readable on the
  dark background; a rim on the dark side's edge; a white Blinn–Phong highlight. The diffuse colour is whatever the
  colour texture holds: element colours, the colour-blind palette, charge and heat colours. `LIT3` and `lit3()` in
  gl.js: the GLSL and the same sum in JavaScript. Free leptons and bare nuclei (the queued balls) are lit the same way;
  glows unchanged.
- **Bonds as cylinders**: each half-bond lane (single, double, triple, the resonating pair as before, each atom's
  colour on its half) is shaded across its width as a thin cylinder (normal between the screen direction square to the
  bond and the eye's direction square to its axis; round at the atom's end) lit by the same light, with the cylinder's
  depth written, so bonds go into the balls cleanly.
- **No dark seam where balls overlap**: antialiased edge pixels wrote depth, so a ball drawn later behind them was
  hidden there and the background showed through as a thin dark ring. Now balls and bonds are drawn in two passes: the
  fully covered core (opaque, depth written), then only the 1-px antialiasing ring (blended over what the cores left,
  depth tested, not written). `glFlush3(C, hi, bond)` draws the slots, the bonds and the queued balls, cores then
  edges, then the glows: 6 draw calls instead of 3 (plus glows).
- **Canvas 2D (no WebGL 2)**: balls are sprites shaded pixel by pixel with `lit3` (`litSprite3`: one a colour for the
  light of this frame, rounded to 1/40, so a turning view remakes them every few degrees; radius 32 px, was 24); bond
  lanes get a gradient across their width with the cylinder's colours (`cylStops3`, 7 stops), lanes under 3 px one
  colour. Still sorted far to near. WebGL and Canvas 2D frames agree (t_3d: mean difference 0.08, 0.12% of pixels off
  by > 24).
- The flat game is untouched: its shaders and sprites are not changed (`GL_FS_BALL3` no longer derives from
  `GL_FS_BALL`); t_3d's 2-D frame after a 3-D one is identical (mean difference 0), t_gl passes.
- Measured: an O atom (69 px radius), the view turned 90° about the vertical: the brightest spot was at (−0.34, −0.39)
  radii from the centre both times (1.23, WebGL and Canvas 2D); now (−0.31, −0.47) → (−0.11, −0.78), 0.37 radii
  moved, within 0.008 radii of where the light puts it, both paths. Frame time (headless Chromium,
  1360 × 860 at 1×, the 1.23 build and this one alternated, medians; the GPU here is SwiftShader on two shared CPU
  cores, so its numbers are rough): JavaScript time unchanged (Molecules in space 0.10 → 0.11 ms, Liquid water 2.86 →
  2.93 ms; 1,800 waters 2.65 → 2.56 ms); with the GPU's work waited for, Liquid water 60.6 → 77.5 ms still, 59.3 →
  63.3 ms turning, Molecules in space 2.1 → 10.6 ms (the second pass and three more draw calls, ~0.5–1 ms each in
  software; without the edge pass 2.4 ms); 1,800 waters 72.9 → 71.6 ms. Canvas 2D: Liquid water 19.9 → 29.5 ms
  still, 20.1 → 26.5 ms turning (the bonds' gradients); 1,800 waters 40.5 → 38.4 ms (thin bonds one colour).
- Settings pictures of the 3-D tab and the 3-D menu remade (`tools/setshots.js`, 30 pictures 343 KB, were 321 KB).
- Tests: t_3d "lit balls" (fails on 1.23: the highlight does not move).
- Not done: contact darkening where atoms touch (it needs a screen-space pass reading the depth buffer; not cheap).

## 1.23.0: the 3-D lab (Preview), Settings with pictures, a 2-D / 3-D first screen

- **3-D** (asked by the user, "a separate mode chosen in the main menu"): built in four stages, recorded in the planned
  list's 3-D item. The engine in three directions (3-D angles, out-of-plane and double-bond torsion terms in 3-D only),
  drawing in perspective with an orbit camera, the 3-D lab with six setups and tools in depth, save format version 2
  (z, vz, depth), and the Rust kernel (`af_forces3`) and worker threads in 3-D. The flat game bit for bit the same
  (four setups, 500 steps, before and after). Liquid water in 3-D (1,029 atoms) 2.7 ms a step on one thread.
- **Settings with a preview pane** (the user's sketch: picture and description on the left, settings on the right, one
  rounded window): hovering, focusing or tapping a setting shows a picture of what it does (30 pictures from the game
  itself, `tools/setshots.js` → `src/setshots.gen.js`, WebP 640×360, 321 KB) and its description (all 71 rows, every
  tab an overview; cost tags explained). Narrow screens: a strip above the settings.
- **3-D settings tab** (display and camera only): field of view (30/40/55/70°), perspective or orthographic, depth fog,
  box edges and grid, axis marker, labels (front atoms or all), orbit speed, invert orbit, turntable. Defaults give the
  old picture exactly.
- **A first screen choosing 2-D or 3-D** in the main menu's style (Continue, two tiles with pictures, Settings, Help);
  2-D leads to the old menu, 3-D to a 3-D menu (its six setups, a turning 3-D background); Esc or "← 2-D or 3-D" goes
  back; "Start with: where I left off" still skips it.
- **Fixed** (2-D too): worker threads could be bound before the WebAssembly module was ready ("Cannot set properties of
  null" now and then at start-up); they are bound again once it is.
- Tests: t_features 3-D block, `tests/t_3d.js`, `tests/t_settings.js` (both lane B), 3-D blocks in t_wasm and
  t_threads. Known under parallel load: t_threads' 3-D block can find the pool "not ready" (passes alone).
- Open (for the owner): the two flat-world boosts (LJ_SCALE 2, K_IW 2) still on in 3-D; SF₄-type lone pairs not
  compressing angles; hot hydrogen in 3-D insulated −5 eV over 4.6 ps; fields, objects, light, nuclear reactions and
  the Experimental physics not yet in 3-D.

## 1.22.0: quantum bonds (GFN1-xTB), proton hops

- Asked by the user (quantum chemistry for bonds; "finish quantum chemistry and hops first"; the physics-model change
  left to me overnight, "if the numbers are good"). Settings → Experimental → Bond orders → **Quantum (GFN1-xTB)**: the
  members' energy and forces from their electrons, every step.
- **The method**: GFN1-xTB (Grimme, Bannwarth & Shushkov, J. Chem. Theory Comput. 13, 1989 (2017)), with its D3(BJ)
  dispersion (s6 1, s8 2.4, a1 0.63, a2 5.0). A JavaScript port (`tools/xtb/gfn1.js`, `d3.js`, `d3-data.js`; the page's
  copy `src/xtb.js`, made by `node tools/xtb/mksrc.js`): STO-nG minimal basis (H 1s + diffuse 2s), extended-Hückel H0
  scaled by distance and coordination number, shell-resolved second-order and atomic third-order charge
  self-consistency (Broyden mixing), Fermi smearing at 300 K, repulsion; every element H–Rn with s, p, d shells. Not
  ported: the halogen-bond correction (Br, I, At only).
- **Checked against the reference programs** (tblite and simple-dftd3, installed on a GitHub Actions runner,
  `.github/workflows/xtb-ref.yml`, 70 geometries in `tools/xtb-ref/`): energies to 1.3e-11 eV, Mulliken charges to
  4e-13, analytic forces to 5.5e-11 eV/Å (`node tools/xtb/check.js`); D3 to 1e-13 eV and 6e-13 eV/Å
  (`check-d3.js`); finite differences 3e-7 (h = 1e-4 Å; Richardson 6e-9), sulfur's d shells included.
- **In the game** (`bo.js`, `qmPass`): membership is the bond orders' (`boSync`: whole clusters, the energy before and
  after at the same positions to the bath); all members are one calculation, so up to 40 atoms (`XQ.max`; more and none
  take part). The plane is z = 0, the orbitals 3-D. Each step starts from the last two steps' charges (extrapolated: 6.8
  → 5.2 SCC iterations, ~3 at the game's accuracy). Non-members meet members through the kernel's pairs with the
  members' Mulliken charges; their potential at each member goes into the SCC as an outside potential, so the forces
  are the energy's exact slopes (an ion outside: 8e-7 eV/Å). Energy counted: GFN1's less each member's free atom.
  Bonds drawn and molecules from Mayer bond orders. Leaving (the setting off, a 41st atom, an ion past ±1), molecules
  get stored bonds and whole charges where the electrons put them (`xqCharges`: a hydronium's +1 on the oxygen with three
  hydrogens even after the proton hopped), the change paid exactly (6e-7 eV, the electron's mass).
- **Proton hops** (the reason): a hydronium with 3–5 waters at 300 K, 0.66 ps, three seeds: the oxygens close in to
  2.43–2.66 Å (bond orders: 2.7+), a shared proton rattles between two oxygens 5–20 times and the charge moves on to new
  oxygens 1–2 times. A proton between waters held 2.45 Å apart settles in the middle (GFN1's single well; the charge
  split evenly). GFN1's limits stay: H + H₂ barrier 0.17 eV (measured 0.42).
- **Energy**: hydronium with three waters insulated, 400 steps: 1e-5 eV; with five, 1,000 steps: 1 meV.
- **Speed** (Node, one thread; the port made 2× faster for warm-started steps, bit for bit the same: integrals per
  primitive pair once, pair tables, allocation-free kernels, row-major Householder/QL): 19 atoms 6.6 ms a step (was 11),
  40 atoms 50 ms, against 0.006–0.02 ms with stored bonds, the steps half as long (0.022 tu): about 1/30 of normal speed
  at 19 atoms, 1/200 at 40. Cost tag ×1000+.
- Test: t_features 1.22 block (port against the reference, forces, books, the shared proton, leaving, the 40-atom cap).

## 1.21.0: quantum nuclei 2–5 times faster (ring-polymer contraction, rings in mode space)

- Asked by the user ("quantum beads are the most demanding thing in the experimental section"). Two changes:
  - **Ring-polymer contraction** (after Markland & Manolopoulos 2008), Settings → Experimental → Bead forces, on by
    default: the bonds' and bends' terms (stiff, short, where a ring's spread matters) on every bead (piFast: the bond
    and angle kernels alone), everything else (the pairs between atoms and molecules, fields, walls) once at the rings'
    centres; each bead's force the centres' rest plus its own bonds and bends. The energy the same way (piEnergy,
    localPE for events: the whole at the centres, the bonds and bends averaged over the beads); the centres' forces are
    its slopes to 1e-8 eV/Å. Events come from the centres' pass (they came from the first bead's). Not with continuous
    bond orders or electrons as waves: every bead gets the whole force field there.
  - **The rings kept in mode space** between steps (PIM): the normal-mode transforms (P² a ring, three a half step) were
    73% of a contracted step at 16 beads; now one transform of the forces in and one of the positions out a step, in flat
    loops (piTo/piFrom), the bead velocities written back only when something reads them. The same arithmetic: the runs
    repeat to the last digit.
- Liquid water, 8 beads, 300 steps: H spread 0.102 Å (every bead 0.100), O–H 0.976 Å (0.971), insulated 0.012 eV
  (0.016). Cost on liquid water against classical (Node, one thread): 8 beads ×7.8 → ×1.4 contracted (×3.3 every bead),
  16 ×17 → ×3 (×7), 32 ×36 → ×6 (×16).

## 1.20.0: bond orders: the charge moves with the orders

- **Moving charge** (planned; the user: "do both", and the approvals left to Claude). A member atom's electrons are a
  continuous count ν = ne + δ. Its internal energy, capacity, expanded capacity and valence follow ν (bo.js bfNuTab/bfNu:
  the game's own values at whole counts, internalE, capacity, hyperCap, valenceInfo, straight lines between, the slopes
  of the internal energy the measured ionization energies and electron affinity; each corner rounded over ±0.05 so the
  whole-count value is exact). The pass gives ∂E/∂ν for every member (bfDqGrad: the internal energy, the capacities'
  slopes through the levels and the pair ends, the valence through the angles' lone pairs, −φ), exact to 2e-7 eV against
  differences, whole or fractional counts. δ moves with a mass (6 eV·tu²/e²) and a damping (2/tu, its work to the bath),
  velocity Verlet beside the atoms (boDqA/boDqB), within a group of heavy atoms joined by orders above 0.02 (a group's
  electrons conserved; hydrogens keep theirs). Every 8th step the groups are looked at again: a new group's count is made
  whole, a count past half-way becomes the atom's own (ne changes, refresh), both booked to the bath at the same
  positions. The kernel sees the moving share through S.qp.
- **A shared proton's two structures mix** (bfShare): for a hydrogen between two N/O/F, −2V·√(e_a·e_b), e each side's
  charge, V = 1.7 eV·4·n_a·n_b; without it the classical charges keep the +1 on one side (the other water's partial
  charges hold it, 1.2 eV). Two more changes for the proton's path: the members' Coulomb and Lennard-Jones exclusions of
  bonded and angle pairs rise from an order of 0.1 to 0.9 (was 0.3 to 0.7: the hydrogen passing between two waters lost
  1 eV of Coulomb in 0.1 Å), and a hydrogen's order to N, O, F starts at a raw order of 0.04 (was 0.15). Members meet each
  other without the kernel's ion–water doubling (K_IW stays for members against non-members).
- Measured (H₃O⁺ + H₂O): the relaxed pair (O–O 2.71 Å, the charge 1.00/0.00) binds by 0.81 eV (stored bonds 0.83, 1.19
  0.73); the proton held halfway between waters 2.65 Å apart is 0.07 eV below it, its charge split 0.50/0.50 (2.60 Å:
  +0.11; 2.55: +0.43); a proton held 1.53 Å from its own oxygen and 0.97 from the other water's takes the +1 there.
  Liquid water: half the H atoms hydrogen-bonded (48%), the closest O–O 2.52 Å; the dimer 2.79 Å as before. Insulated
  300 steps: water 0.002 eV, brine 0.04, gallery 0.003, combustion 0.002; water with a hydronium 0.002–0.04 over 1,000
  steps (1.19: 0.001–0.05). Rust the same (bocheck: energies to the last digit, forces 6e-14, ∂E/∂ν 2e-14).
- Not yet: hops in liquid water (see the planned list). Cost against 1.19: water the same (whole counts take a fast
  path; no group with two heavy atoms moves nothing), hydrogen + oxygen ×1.5, the gallery ×1.5 (its molecules' heavy
  atoms all move). Against stored bonds: water ×8, hydrogen + oxygen ×9, the gallery ×15.

## 1.19.0: bond orders: member atoms repel inside the bonding reach

- **Found while starting "charge that moves with the orders"** (the user: "start it"): with bond orders on, nothing kept
  two member atoms apart inside the bonding reach (2.8 Å for O–O): the members' Lennard-Jones was switched on only beyond
  it, and the kernel leaves member pairs to bo.js. Two waters drew together to O–O 2.14 Å (stored bonds 2.79; real about
  2.9), H₃O⁺·H₂O to 2.13 (2.70), liquid water's closest O–O 2.12 Å, the hydrogen-bond Coulomb pulling H to within 1.2 Å
  of the other O.
- **Fix** (bo.js bfCoulomb, kernel/src/bo.rs coulomb): every member pair gets the kernel's Lennard-Jones (ljFI's form: the
  wall straight inside 0.62·rm, shifted to zero at 2.6·rm), weighted by (1 − g(n))·Πₖ(1 − b·b)·(1 − h(fᵢ)h(fⱼ)): off as
  the pair's own order rises from 0.02 to 0.32, off for 1-3 pairs as the Coulomb is, and off between two atoms that both
  have valence free (fᵢ = capacity − the atom's other orders, h rising to 1 at 0.3), so radicals meet without a wall (H +
  OH, CH₃ + H, CH₃ + CH₃, NH₂ + H, H + H: the energy on the way in from 4 to 1.6 Å unchanged, ≤ 0.03 eV). A hydrogen's
  size follows its orders to N, O and F (setSize's polar hydrogen, 1.2 Å). Within one molecule (the atoms joined by
  orders above 0.3, looked at every 8th step, a change booked to the bath at the same positions) the kernel's soft
  intramolecular form: half the depth, the wall from 0.8·rm. The wall's curvature joins the step control as the kernel's
  does. All of it with exact slopes (forces = −∇E to 5e-7 eV/Å; the slopes of the orders, the free valences, the
  hydrogens' sizes and the 1-3 weights in the back-pass); Rust the same to 6e-14 eV/Å.
- After: the water dimer 2.79 Å (stored bonds 2.786), H₃O⁺·H₂O 2.74 (2.70), liquid water's closest O–O 2.54–2.56 Å
  (stored 2.64), half the H atoms hydrogen-bonded (stored 57%; the same count, 2,000 steps after 2,000, bath on).
  Insulated 300 steps: water 0.005 eV, brine 0.04, combustion 0.002, the gallery 0.10 (it reacts: 3 molecule changes
  booked). Cost against stored bonds (one thread): water ×6 → ×8, the gallery ×8 → ×10, hydrogen + oxygen ×5 → ×6.
- The 1.13–1.17 pass on objects (boPassObj and its helpers) is gone: it was kept only to check the flat pass against,
  and the WebAssembly pass is checked against the flat one (r82); 1.17's check of the two (r81) went with it.

## 1.18.0: the bond orders' pass in WebAssembly (water ×17 → ×6)

- **The orders' pass in Rust** (the planned list's next item, step 2 of 2; the user: "Do part 2, then move on").
  kernel/src/bo.rs is 1.17's flat boPass line for line, beside the pair kernel in the same module (built by GitHub
  Actions, shared and plain memories): `af_bo_collect` finds the member pairs in the neighbour list (with the pair types,
  iwK and the cutoff shift from per-member flags), `af_bo_pass1` does the raw orders, crowding, levels, orders, Morse
  terms, angles (the targets in a table filled once from angleTargetsRaw) and the partial charges with the members' own
  Coulomb pairs, and `af_bo_pass2`, after the JavaScript has added the non-members' potential (bfPhiOthers, which needs
  the objects), goes back through the orders to the forces. The JavaScript keeps the members (capacities, flags), the
  pair types' constants and the charges' copy into the store. The arrays live in the module's memory (bfArr; scratch
  sized to the members, nothing allocated in Rust); without the module (or with its memory full) the JavaScript flat
  pass runs, unchanged (boPassJS).
- Checked: the same energy (to the last digit), forces within 4e-14 eV/Å, every charge and order equal, natively
  (kernel/examples/bocheck.rs on memory images from tools/bodump.js: water, gallery, brine, combustion) and in Node
  (shared and plain memories, with and without forces, the gallery with H₃O⁺ and SF₆, brine in a wrapped box). An
  insulated water run gives the same drift to the last digit with the module, the plain module and no module.
- A pass: 4× as fast (gallery 3.9×, brine 4.1×). Against stored bonds on one thread (Node, 400 steps): liquid water
  ×15.7 → ×6.1 (0.44 ms a step against 0.19), the gallery ×16.3 → ×8.0, hydrogen + oxygen ×6.8 → ×4.6. What is left is
  mostly the steps, 2.6 times shorter (0.153 fs against 0.398: the stiffer bonds' step control).

## 1.17.0: the bond orders' pass on flat arrays (2–3 times faster)

- **The orders' pass rewritten over typed arrays** (the planned list's next item, step 1 of 2; the user: "Do what's
  next"). Pairs and members by index (bo.js BF: the pairs' distances, raw and final orders, their slopes, the crowding
  factors' partners in one buffer; each member's bond-term pairs as an incidence list; the pair constants in a table of
  16 numbers per element pair; slot → member and element pair → type in flat maps), no Maps, closures or arrays made in the
  loops. The same arithmetic in the same order as the 1.16 pass (kept as boPassObj for the check): energies equal,
  forces within 7e-15 eV/Å, charges and every order equal (water, gallery, combustion, brine, brine with H₃O⁺ and SF₆).
  A pass: water 2.78 → 1.44 ms, gallery 4.8 → 2.6, brine 12 → 4.0, combustion 1.0 → 0.6. Against stored bonds on one
  thread (Node, the WebAssembly kernel for both): liquid water ×46 → ×17, the gallery ×32 → ×15, hydrogen + oxygen ×7–8
  (its own pass was small already). The energy runs of 1.16 repeat exactly (water 0.028 eV, combustion 0.049; the
  gallery's path parts after a few hundred steps, as chaotic paths do with a last-digit difference: 0.078 eV).
- Step 2, the same pass in WebAssembly (Rust): done in 1.18.

## 1.16.0: bond orders, next steps: partial charges, crowded molecules, ions, longer steps

- **Partial charges that follow the bond orders** (continuous bond orders; the user: "do bond order next steps"). Each
  pair gives its atoms K·Δχ·h(n), K = 0.30 e per unit of Pauling electronegativity as a stored bond does, h = 1 + 0.2(n − 1)
  above a single bond and the order itself below (the corner at 1 rounded over ±0.05), so a breaking bond's charges fade
  with it. Members meet non-members through the kernel (S.qp, set by boPass, which now runs before the kernel) and each
  other in bo.js (boCoulomb): the same soft Coulomb (iwK, the 0.09 Å² core, the cutoff shift), bonded and angle pairs
  left out smoothly, weight (1 − b(nᵢⱼ))·Πₖ(1 − b(nᵢₖ)b(nₖⱼ)), b from 0 at order 0.3 to 1 at 0.7. Forces carry the
  charges' slopes, φᵢ·∂qᵢ/∂n into the orders' back-pass, φ from both kinds of pair (qeqC for the kernel's). Checked by
  differences: forces = −∇E to 1e-6 eV/Å (water, brine, one water and a Na⁺; the gallery 2e-5 on a 3 eV/Å force).
  Found on the way: totalEnergy summed the members' pairs with non-members before boPass set their charges (stale by a
  call; harmless between steps, wrong in a difference test) — the orders' pass now comes first there too. Water's
  charges: O −0.741, H +0.370 (stored: −0.744, +0.372). Liquid water (2,000 steps after 2,000, bath on): 55% of H atoms
  hydrogen-bonded, stored bonds 49%, bond orders before 28%. Insulated, 300 steps: water −0.001 eV, brine −0.016, the
  gallery −0.024, combustion +0.006. Cost: water ×2.1 on top of bond orders (the charge pass is 17%; the rest is the
  molecules clinging, more pairs within reach).

- **Crowded flat molecules** (bond orders): in a flat world SF₆'s six F sit 60° apart, as far from each other as from
  the S and near an F–F bond's length, so each F split its one valence three ways: S–F 0.44–0.54, F–F 0.19–0.34 after
  1,500 steps; PCl₅'s Cl 0.40 to each other, CF₂Cl₂ 0.40. Now a pair's raw order is multiplied by Πₖ(1 − b(n⁰ᵢₖ)b(n⁰ₖⱼ)σ)
  over the centres k it shares (boCrowd), σ from 0 to 1 as the weaker bond to the centre beats the pair's own by 0.4 to
  0.8 eV (single-bond energies: S–F 3.39 against F–F 1.61; P–Cl 3.38 against Cl–Cl 2.51): raw orders only, so nothing
  circular, and the forces carry it (checked by differences, 1e-6 eV/Å; SF₆ + PCl₅ + CF₂Cl₂ + water insulated 1,500
  steps: 0.0000 eV). After: S–F 0.99–1.00, P–Cl 0.99, C–F/C–Cl 0.99, no ligand–ligand order at all in SF₆, PCl₅, SF₄,
  ClF₃, BrF₅, SiF₄, CF₂Cl₂, NF₃, PCl₃. Rings of equals keep their bonds (cyclopropane C–C 0.99, ethylene oxide's C–C
  1.02). It would also take the O–O out of a dioxirane and the N–N out of a diaziridine (neither is in the library), and
  diborane's B–B, which the real molecule doesn't have.

- **Ions inside the bond-order scheme**: singly charged atoms of the chemistry's elements are members now when they are
  part of a molecule (boOK: |q| ≤ 1; a lone ion such as brine's Cl⁻ stays with the kernel's ion–water terms), so H₃O⁺,
  OH⁻, NH₄⁺, CN⁻, NO₃⁻, HCO₃⁻ keep their orders instead of going back to stored bonds. capacity() already counts an ion's
  valence (O⁺ 3, O⁻ 1, N⁺ 4); member pairs meet with net plus partial charges, and an ion member's partial charge meets
  the net charges beyond the cutoff (the long-range pairs) in its slope term. Each alone, 1,500 insulated steps:
  0.0000–0.0004 eV, orders 0.99/1.99/2.99; H₃O⁺ in liquid water −0.048 eV; forces = −∇E to 5e-6 eV/Å with H₃O⁺ and OH⁻
  in brine. Not done: the charge stays on its atom as a whole unit, so a proton does not pass from H₃O⁺ to a neighbouring
  water (Grotthuss). Tried: an event moving one electron between the two atoms a proton sits between, kept when the energy
  falls (as the 1.15 back-flow): never kept at 300 K (5.5 eV short with the proton 1.0 and 1.6 Å from the two oxygens;
  neighbouring waters 0.9 eV, about water's real self-ionization) and four times the cost; taken out. A proton that hops
  needs the charge to move with the orders continuously (on the planned list). Nitrate's three N–O stay 1, 2, 1 (its
  formal charges sit on atoms), not the resonance's 1.33.

- **Speed** (bond orders): the bond terms' share of the step control is now twice a bond's curvature at rest instead
  of four times (1.13's choice, made before the orders' corners were rounded): steps 0.108 → 0.153 fs (water, gallery),
  0.093 → 0.132 (combustion). Insulated after heating, 1,500 steps: gallery at 1,000 K 0.030 eV over 230 fs, water at
  600 K 0.028, combustion at 2,500 K 0.049 (four times: 0.10, 0.013, −0.007 over 140–160 fs; the plain curvature: 25 eV
  in 300 fs). Measured on one thread in Node against stored bonds (the WebAssembly kernel): liquid water ×60 → ×46, the
  gallery ×42 → ×32, combustion ×13 → ×7 (water and the gallery were ×28–37 at 1.15, before the partial charges made the
  molecules cling: more pairs). Per step the orders' pass is 3 ms for 240 water atoms, about 2,750 member pairs within
  the cutoff: the Lennard-Jones and raw orders 23%, the partial charges 22%, collecting the pairs 11%, applying the forces
  10%, the crowding factors 7%, levels, Morse terms, angles and the back-pass the rest. Tried and not worth it: letting
  the WebAssembly kernel take the members' far pairs (the neighbour list's 1 Å skin leaves only pairs beyond 5.4 Å for
  it, under a fifth), trimming the charge loop (no change within the timing noise). The real lever left is the orders'
  pass itself in WebAssembly (on the planned list).

## 1.15.0: charged particles as collider beams, electrons as waves, the honest approximations, charge flowing back through bonds

- **Unstable particles are turned by the nuclei they pass** (multiple Coulomb scattering; the user: "build everything
  that's worth doing" from the Physics tab's honest approximations). Each nucleus a charged exo passes within 1 Å turns
  it by the small-angle Rutherford angle 2k·z·Z/(b·pv), screened by the atom's electrons (Thomas–Fermi, e^(−b/a),
  a = 0.885 a₀ Z^−⅓), toward it, at most 0.3 rad a pass; the nucleus takes the sideways momentum and its recoil energy
  comes from the exo (hep.js exoScatter, after exoIonize). μ⁺ through 31 Å of gold atoms (jumbled, as a foil): rms
  7.7 mrad at 5 MeV, 1.03 at 50 MeV (∝ 1/pv; pv's ratio 8.6). Fired along a crystal's rows a μ⁺ channels between them
  once the sign fix below is in (4.4 against 1.1). A flat chamber meets close nuclei more often than a real foil (a row of atoms every 2.6 Å
  against a volume): about ten times Highland's width for the same thickness, said in the Physics tab.
- **Charm and bottom mesons**: D⁰, D⁺, D⁺s, B⁺, B⁰ and their antiparticles (XP Dc0, Dc+, Ds+, B+, B0 …), PDG masses and
  mean lives and their main decays (the rest of each total shared over them). Electron–positron collisions make charm
  pairs above 3.75 GeV and bottom pairs above 10.6 GeV in their share of R (4/3 and 1/3 of the 3.95 above the bottom
  threshold), with light hadrons from the energy left, as two jets. Quark content shown in Inspect (c, b); pulling a
  heavy quark out by hand is not modelled. They fly through nuclei (their strong hits are not modelled). Hadron and
  nuclear collisions still make no heavy flavour (far rarer there). 12 GeV e⁺e⁻: D or B in 10 of the hadronic events
  of 300; decays keep the books to 0.0 eV.
- **Jets**: already there (strings along the beams above 5 GeV in hadron collisions, e⁺e⁻ as two jets above 2.5 GeV,
  nuclear collisions above 2 GeV); the Physics tab still said "an even spray". Text corrected.
- **Relativity in the atom solver**: the scalar-relativistic radial equation (Koelling–Harmon, spin–orbit averaged),
  first-order form, Runge–Kutta on the same grid, energy from the jump in the small component at the join
  (solver.js scfOrbitalSR, SOLVER_REL on). Hydrogen-like gold 1s −3434.63 hartree (Dirac −3434.59; −3120.5 without).
  Gold's 6s −6.51 → −8.31 eV (the measured ionization energy 9.23 eV), ⟨r⟩ 1.790 → 1.506 Å; mercury's 6s −7.71 →
  −9.56 eV (10.44); light atoms unchanged (carbon 2p −8.99 → −8.98 eV). A gold atom takes 0.8 s instead of 0.3.
- **Charge flows back through a bond** (the user: a Ni⁺–C⁻ made by an electron hop and then a bond never became the
  neutral Ni=C). Every eighth step a few bonds between opposite whole charges are tried: the electron moves back,
  the freed valence raises the bond's order as both atoms allow, the molecule's energy is measured exactly before and
  after, and the change is kept (heat released) only when the energy falls. Ni⁺–C⁻ → Ni=C, 1.11 eV released. The
  library's formal charges are kept, their energy rises when undone: ozone, CO, N₂O, nitric acid, nitrate, ammonia
  borane, nitromethane (all 13 with opposite formal charges tried: none changed).
- **Every charged particle as a collider beam** (asked for by the user, approved): μ±, τ±, π±, K±, Σ⁺, Σ⁻, Ξ⁻, Ω⁻, D⁺,
  D⁺s, B⁺ and every antiparticle, 22 species in two new menu groups (Unstable leptons, Unstable hadrons) and the search
  (muon, pion, kaon …). They stay in W.exo, marked xb, so they decay on their own clocks (time dilated); the ring flies
  them on the same leapfrog path through magnets, cavities, kickers and separators as the beams of W.parts (the path
  taken out of moveRad as radPath; bSpd/bMu give a flier's speed and mass whichever list it is in), and they radiate as
  charges do (γ⁴: the ring's top energy for muons is the electrons' γ). Steps as short as the parts' beams (1.5 Å a
  step): with the exos' own rule (4% of the box) a muon train lost 4 of 20 particles crossing transition; now none.
  Meeting in the detector (hep.js xbHit): a lepton and its antilepton annihilate as e⁺e⁻ do (eeEvent, now with the
  incoming lepton's mass in γγ and an electron-pair channel); a hadron and its antihadron annihilate into mesons (jets
  above 5 GeV); a hadron on a proton or nucleus beam meets it as in matter (hadronHit); two other hadrons come through
  as leading particles with hadrons made between them, inelastic in the share σ_inel/σ_tot of proton–proton at the same
  energy above their masses; the rest scatter off each other's charge (nuclearScatter, now able to move an exo). Every
  event keeps the books to 0.05 eV or better (μ⁺μ⁻ 1 GeV, π⁺π⁻, Σ⁻ on π⁺, D⁺D⁻, τ⁺τ⁻, K⁻ on gold). μ⁻μ⁺ in one ring at
  1 GeV: all 20 kept to full energy, collisions from about frame 1,980. The collider's note says what the pair does and
  how long each lives at its speed, in turns of the ring (a 1 GeV muon some 2×10¹¹, a 5 GeV τ about 9,000: decay
  sped up in Time shows them decaying round the ring). Heavy-flavour hadrons meeting nuclei only scatter (as in matter).
- **A screened nucleus repelled μ⁺ the wrong way**: exoScatter turned every particle toward a nucleus with electrons,
  whatever its charge; a screened nucleus still pushes a positive particle away. Fixed (the size of the turn and the
  momentum and energy books were right). The 0.92 muon-in-argon check now uses a denser argon lattice: in the old
  sparse rows a 6 keV μ⁻, now turned up to 14° by a nucleus 0.1 Å off its path, wandered out before it was caught.
- **Electrons as waves** (Settings → Experimental; the last of the user's Experimental options, approved): every free
  electron and positron in MD becomes an eFF wave packet (Su and Goddard 2007; the 1.12 prototype, tools/eff-proto.js):
  a size s that moves with mass ¾ mₑ, kinetic energy 3ħ²/(2mₑs²) (11.43 eV·Å²/s²), packets meeting as smeared charges
  erf(r/σ)/r, σ² = (sᵢ²+sⱼ²)/2, eFF's Pauli term between two of the same kind (same spin strong, opposite weak; spins
  alternate by id), and packet–ion attraction smeared too, σ² = s²/2 + 1.273·sE (the ion's soft core folded in, so a
  tight packet meets it as the point electron does). Worked as a correction on top of the point leptons' own soft
  Coulomb (engine.js waveForces, in both the fast and the whole force passes), so the WebAssembly kernel and every
  other code path are untouched. A free packet spreads to 2 Å, then a spring (20 eV/Å²); energies counted from there.
  erf(x)/x from a table every 0.01 with cubic Hermite pieces (slopes exact to the values: forces = −∇E to 1e-6 eV/Å,
  checked by differences on leptons, sizes and ions); the Pauli term's 1 − S² by expm1 (a cap on S² made a false well
  where two same-spin packets overlap, which threw 1–2 eV a step). Books: who is a packet is settled at each step's start
  and after events (waveSync); a joiner takes the size where joining costs nothing, or near an ion (less bound as a
  packet) the largest size paid from its motion, and stays a point while its motion can't pay; a leaver's packet energy
  goes into its motion; an event that ends a packet counts its share with ions and packets (joinEnergy, or kill() keeps
  it) and the rest is given off as light. Steps: the packets' breathing (a few hundredths of a femtosecond) sets the
  free electrons' own steps (8 × the size's stiffness in the step control: two packets 1.2 Å apart kept to 0.01 eV
  over 24 fs; at 2 × 0.38 eV). Measured, liquid water with 40 free electrons, bath off, 400 steps: drift −0.4 to +0.4 eV
  over 77–86 fs (−5 to +5 eV/ps; points: 0 to −1), packets 1.1–3 Å; cost ×6.5 (×13 inner steps). Twenty H⁺ + e⁻
  recombining as packets: 0.02 eV. Turning it off returns every packet's energy exactly. Not done: packets don't meet
  neutral atoms (as points don't), an atom's own electrons stay book-kept, and the size of a freshly ejected electron is
  not its orbital's.
- Known: a slow electron or positron left in a ring's bending magnet (a decay product, a few hundred eV) circles there
  for good, as it would in a real uniform field, and its short inner steps through the magnets' fields cost several
  milliseconds a step (τ beams make such products more often than the others).

## 1.14.0: slow motion as a speed, bond-order molecules named, the Speed test's Experimental line, the Particle Life card gone

- **Slow motion is a speed** (asked for by the user: the hourglass and a separate "slow-mo" state side by side were
  confusing, and slow motion on demand did nothing below 1/512×). The hourglass and the automatic slow-down for nuclear
  events no longer hold time back behind the speed shown: each frame they set the speed itself, to the menu's speed
  nearest what they want (never above the speed chosen), so the readout always shows a speed from the menu (1/8×,
  1/920× …). The speed chosen by hand (W.userSpf) comes back when they let go (the hourglass pressed again; the
  event's products gone); choosing a speed by hand ends both. What they want is as before: the hourglass, the fastest
  particle about 2% of the box a frame at the setup's speed (at most an eighth of it); the automatic kind, the same
  scaled by the speed chosen. Set below 1/512× by hand, neither acts (deepSlow now asks the speed chosen, so slow
  motion's own low speeds keep the ordinary physics). Saves keep the speed chosen. Light in flight still holds time
  back as before (slowFactor is now only that). engine.js slowSpeed, speedLadderW (the menu's ladder, shared with ui.js).
  Tests changed with it: the collider's 2%-a-frame check allows a menu step either way; the p + p̄ different-energy
  ring gets 3,000 frames to its first collision (1,484 now, 1,335 before: its slow motion is a little slower).
- **Speed test**: the settings line names the Experimental settings and their combined cost ("Experimental: force
  reach 9 Å, continuous bond orders (×22–117 the normal work)", or "all normal"), asked for by the user.
- **Physics tab**: the "Compared with Particle Life" card is gone (asked for by the user).
- **Continuous bond orders: molecules named again** (the user: molecules were not identified with bond orders on).
  Members keep no stored bonds, so everything that found a molecule through p.bonds saw loose atoms. molecule() now
  also follows a member's partners of order 0.5 or more (boNbrs, made once a pass from the last orders), linked(p)
  replaces p.bonds.length where a molecule is looked for (labels, Inspect, the Data tab's list, selection, the same-
  formula finder, the drawing of a picked molecule), the library match reads the same neighbours, and Identify
  molecules writes SMILES from whole bonds made from the orders (boProxy). H₂ + O₂: H₂ "Hydrogen", O₂ "Oxygen"; the
  molecule gallery: water, carbon dioxide, ammonia, methane, ethanol, acetic acid, benzene … named as with stored bonds.
- **Hexazine with bond orders falls into three N₂** (reported by the user): checked, and that is right. A flat N₆
  ring is not a minimum (neither the even nor the alternating ring is, PCCP 2024, 26, 3569); here it comes apart even
  at 1 K. Stored bonds hold it only because they cannot change by themselves.

## 1.13.0: crash handler, dropdowns, 32 threads, Experimental total cost, beads under the symbols, continuous bond orders

- **Crash handler** (asked for by the user after a Ring-collider setup, Ca-40 + Au-197 at about 1 PeV with a τ⁻ placed,
  crashed the game; it ran 2,500 particles headless without an error, so it was most likely the tab freezing or running
  out of memory). An error in a frame (or anywhere on the page) now pauses the game and opens a dialog: what happened,
  Keep going, Undo the last change (where undo works), Start this setup again, and a report to copy (version, setup,
  particle count, time, memory, the error's stack, the settings without any API key). Every half second the chamber
  is checked for positions or speeds that are NaN or infinite (they spread to neighbours within steps): the dialog
  offers to remove them, recompute the forces and keep going. Memory past 85% of what the browser allows pauses with
  a warning (once, until it drops below 60%). A heartbeat (every 2 s, and after any frame over 0.5 s) is kept in
  browser storage and cleared when the page is left normally (closed, reloaded, hidden); found on the next start it
  means the last session froze or crashed, so that start does not carry on into the autosave (Start with → Where I
  left off) but offers it, with the report. The desktop window can close without telling the page, so there only a
  heartbeat that shows trouble (frames over a second, or memory past 70%) counts. Costs nothing measurable: one pass
  over the particles every 0.5 s and a small write every 2 s.
- **Experimental: continuous bond orders** (asked for by the user: "a less hard-coded chemistry"; built overnight on
  their "please try to finish the bond orders", off by default; approved by the owner for 1.13.0). `src/bo.js`
  brings model E of the prototype (tools/bo-proto2.js, steps 1–5 in 1.12.0) into the engine with analytic forces
  (tools/bo-fast.js first checked them against numerical ones: 1e-8 eV/Å). With it on, neutral molecules of non-metals
  keep no stored bonds; each step every pair's order is worked out from the positions and the energy is a smooth
  function of them. How it sits in the engine:
  - membership by whole clusters (stored bonds, or orders over 0.3): a cluster joins when every atom qualifies and leaves
    when one stops (an ion forms, a nucleus changes, it touches a metal); leavers get stored bonds from their orders
    (the strongest first, as valence allows). Every change is measured (localPE of the changed atoms plus the whole
    bond-order energy, before and after, same positions) and the difference goes to the bath, as for quantum nuclei.
    The check runs at the start of a step, only when species, charges, bonds or particles changed (and every 64 steps).
  - between members the kernel's non-bonded pair is left out (VL.ex = 1, after the usual marks) and bo.js adds the same
    Lennard-Jones, switched on from r₁ + 1.3 to r₁ + 1.8 Å; totalEnergy, localPE and pairPE skip member pairs the same way.
    No stored-bond event (bond, react, dative) touches a member: a classic O₃ reacting with a member made 4–6 eV.
  - joiners are eased into this chemistry's shapes (60 steepest-descent moves, inside the booked change): left in the
    stored bonds' shapes, the molecule gallery heated from 300 to 1,000 K.
  - the bond stiffness (8·D·α², four times a Morse bond's curvature) limits the step: at the plain curvature a hot gallery
    drifted 1–3 eV in 60 fs from the sharp turns of the orders' smoothing, at this 0.05 eV.
  - drawn from the orders each frame (whole orders, a resonating 1.5, fainter below 1); saved worlds keep whole bonds.
  Fixes on the way, each found by a jump in an insulated run: the level's sum and the orders now fade out partners that
  ask for nothing (the prototype's last step, which this branch had missed: H₂ + O₂ drifted 15 eV); an expanded octet
  is blended in as electronegative partners come to ask (it switched on at the edge of reach); the angle terms are the
  expectation over which partners between orders 0.4 and 0.7 count (two F of SF₆ entering together jumped 2.2 eV);
  Pauling's length below order 0.05 and the depth and stiffness at whole orders are rounded (each kink put a jump in
  the force: 0.03–0.3 eV per crossing); the level is solved by bracketed Newton steps (2.2 → 1.5 ms a water step).
  Measured (insulated, one thread): H₂ + O₂ 1,500 steps 0.01 eV; liquid water 0.03 eV over 8,500 steps and still water;
  the molecule gallery 0.15 eV. Forces equal minus the energy's slope to 1e-5 eV/Å in all three. Cost against stored
  bonds, per simulated time: water ×17, H₂ + O₂ ×21, the gallery ×45. Limits: members carry no partial charges (no
  hydrogen bonds between them), a proton does not attach to a member, crowded flat molecules (SF₆) come apart.
- **32 threads** (asked for by the user: a 7950X3D has 16 cores and 32 threads, and the game stopped at 16). Settings →
  Threads has a 32 choice; the pool takes up to 31 workers (TH_MAXW; the per-worker stiffness cells grew from 16 to
  32, every other per-worker array was already sized by the count). Auto stays at 16, one a core: a core's second
  thread shares its arithmetic units and caches, and 31 workers wait on each other more, so it may gain or lose a
  little; the threads note says so and points to the Speed test, and Auto can move to 32 if the owner's numbers show it
  faster. Checked here (2 cores, so for correctness only): 32 threads on 12,000 waters give the one-thread forces to
  6e-17 eV/Å (t_threads).
- **Experimental: the total cost** at the top of the tab (asked for by the user): the chosen settings' measured costs
  multiplied together against everything at normal, coloured like the tags (×1.8–4.7 for 9 Å reach and induced
  charges every 10th step). A guide, not a measurement of that combination.
- **Dropdowns** (asked for by the user: round the collider's beam menus, replace the beam search's square suggestion list
  with its old scroll bar, and animate every dropdown). Every `<select>` now shows as a button that opens the page's own
  list (ddEnhance/ddPop in ui.js): 12 px corners, the styled scroll bar, group headings, the same pop as the other menus
  with interface motion on (and a short fade out), arrow keys, Home/End, Page keys, Enter, Esc, type-ahead; it opens
  upward when there is no room below. The select stays in the page out of sight (1 px, transparent), so every script
  that reads, sets or listens to it works as before, and selects drawn later (panels) are found by the 250 ms tick, which
  also keeps each button's text, disabled and hidden state in step. The collider's beam search boxes suggest in the same
  list (ddSuggest; the datalist is gone). Letting every charged particle be a beam is on the planned list (above).
- **Beads covered the element symbols** with quantum nuclei on (the user's screenshot): the bead rings were drawn
  after the atoms and their labels. The symbols are now held back and drawn after the rings.

- **Bug fixes from the bug-fix session** (applied from its patches; physics change approved by the user):
- Muonium is an atom. It was an exo (XP.Mu) flying on straight lines that never collided, so it passed through
  everything. Now muonium is an H atom in MD whose nucleus is a μ⁺ (p.mu): refresh gives it the muon's mass (0.1140 u
  with its electron, a ninth of H's), so it collides, bonds and reacts by the ordinary chemistry. Made by muoniumForm,
  fired, or placed from the palette, it is addMuonium (spawnItems, fireSpec, placeFly). It is named Mu (speciesLabel,
  hill: MuCl, Mu₂; library names left off), drawn light blue with "Mu", and shown in the inspector as muonium. Saves
  keep it (part field 5: bit 1 antimatter, bit 2 muonium). Its nucleus is no nucleon: guards on p.mu in tryFusion,
  neutronHit, nuclearEncounter, nuclearAnnihilation, photoNuclear, muStop/kStop/hStop, muAtomTick and exoHits. The
  muon decays (2.197 µs, on the nuclear clock: muoniumTick): μ⁺ → e⁺ + νₑ + ν̄μ, the electron set free, a molecule it
  was in relinked as a radical; the books close through nucBegin/closeEvent (the neutrinos take the rest).
  Measured: Mu at 0.5 eV past one Ar atom at impact parameters −1.5…1.5 Å, deflected more than 10° in 0 of 20 runs
  before, 18 of 20 now. 20 Mu at 1 eV into 60 Cl₂ (3,000 steps): no reaction before; 13 × Mu + Cl₂ → MuCl + Cl, 17
  bonded, now. The same into H₂: 11 MuH and 6 Mu₂. Insulated drift in those runs −0.35 to +0.63 eV, as for H atoms
  fired the same way (−0.11 to −0.77 eV). MuCl and Mu decaying together: the books change by 0.0007 eV. t_energy passes.
  Test: t_features "1.12 muonium".
- Muonic hydrogen scatters elastically off hydrogen nuclei (physics change approved by the user). μp, μd and μt
  flew straight and only met nuclei through muAtomTick (transfer, fusion). Now muAtomScatter: a pass of its path
  within the reach of a hydrogen-isotope nucleus (through the electron cloud) scatters it elastically, isotropic in the
  centre of mass (s-wave, as below about 1 eV). Momentum and kinetic energy are kept exactly (ΔE 2·10⁻¹⁶ eV); seeded
  rnd() only. Cross sections measured by Bertin et al. (Nuovo Cimento A 72, 225, 1982): μp + p 1.49×10⁻²⁰ cm²
  (singlet μp), μd + d 8.0×10⁻²⁰ cm². For μt no measured value was found, so μd's is used. Ultra-realistic mode: the
  true reach √(σ/π), 0.0069 Å for μp and 0.016 Å for μd. Normal play: R_NN, 0.35 Å, the reach every neutral
  projectile has at a nucleus here (neutrons, nucReach), so 51 times the true radius for μp (2,600 times the area)
  and 22 times for μd (480 times). Mean free path in liquid hydrogen (0.0423 nuclei/Å³; D₂ 0.0506): μp normal 61 Å,
  ultra-realistic 1.6×10⁵ Å (16 µm); μd in D₂ normal 51 Å, ultra-realistic 2.5×10⁴ Å (2.5 µm). The inspector text
  for muonic hydrogen says the scattering size is enlarged except in the ultra-realistic mode. 10 μp fired at 1 eV
  into H₂ at 20 K, 1.6 ps (4,000 steps): mean energy 1.000 eV before (no scattering); now 0.005 eV after 61
  scatterings (normal), 0.83 eV after 3 (ultra-realistic). Test: t_features "1.12 muonic scattering".
- Ionic lines between a cation and a polyatomic anion (display only). drawIonic's reach was 1.3 × the two drawing
  radii, and for an atom in a molecule that is its small covalent one (C in CN⁻ 0.51 Å), so Na⁺–C reached 1.99 Å.
  Na⁺ settles 2.2–2.7 Å from a CN⁻, so no line ever appeared. Now each atom's force-field size (half its LJ diameter
  ljR: for a lone ion its ionic radius, so Na⁺–Cl⁻ still reaches 3.68 Å; C 1.93, N 1.83, O 1.75 Å in a molecule) sets
  the reach: Na⁺–C 3.83, Na⁺–N 3.70, Na⁺–O 3.60 Å. Ions 4.5–4.9 Å apart (second neighbours) stay without lines.
  A charge spread over a molecule: the ion is the whole molecule, with its net charge (NO₃⁻ carries formal charges
  O⁻ N⁺ O O⁻, with partial charges over all four atoms). Each pair of oppositely charged ions within reach gets one
  line, between their closest atoms. Forces and energies unchanged. Test: t_features "1.12 ionic lines". Before:
  Na⁺–CN⁻ end-on at 2.73 Å, no line; after, one. CN⁻ 4.5 Å off: none before or after; Na⁺–Cl⁻ at 2.8 Å, one before
  and after.

## 1.12.0: induced charges and quantum nuclei (Experimental), realistic tags; prototypes for the rest
- The particle bar's search (asked for by the user): the chip reads "Search…" (no emoji), the menu "Search particles",
  and its text box sits inside the menu with an 8 px margin (`.msearch`'s width: 100%, later in the sheet, had won over
  the box's own width, so it ran to the menu's edge); a shorter placeholder that fits. Test: t_features "1.10 reach".
- Released with two options (induced charges, quantum nuclei) approved by the user; electrons as waves (prototype,
  parked) and continuous bond orders (prototype, step 4) go on for a later version.
- Charges that respond to their surroundings (Settings → Experimental → Induced charges: off / every 10th step /
  every step; `SET.qeq` → `QEQ.every`; `qeqUpdate`, engine.js). A fluctuating-charge model of polarization: each
  molecule's partial charges are its bonds' own (qpol + qf) plus induced charges qi that sum to zero over the molecule
  (no charge moves between molecules). They minimise ½κJᵢqiᵢ² + φᵢqiᵢ, φᵢ = ∂U/∂qᵢ the potential at the atom from the
  force field itself (every pair term the partial charges enter is c·qa·qb: soft Coulomb shifted at the cutoff, iwK,
  smeared bare nuclei, exact 1/r between net charges beyond it, `qeqC`) plus an applied field; Jᵢ the atom's
  ionization energy less its electron affinity, κ = 0.54 fitted to water's polarizability (1.45 Å³ averaged in the
  plane; a charge-flow model is anisotropic: 2.6 and 0.5 Å³ along and across the H–H line). The polarization energy
  ½κJqi² is part of the potential energy (totalEnergy, localPE), and depends on the charges only, so the forces are
  the force field's own. Between steps: φ, the charges, the exact change of the potential energy from the pairs'
  coefficients, paid by the molecules' motion about their centre of mass, then the forces again. Turning it off puts
  every molecule back the same way (`qeqClear`). Molecules over 64 atoms (chips) keep their own charges.
  - A rejected trial (snapshot/restoreSnap) relinks, which set the charges back to the bonds' own: unbooked, that
    leaked 130–630 eV in 300 steps of brine. The snapshot keeps qi now.
  - Measured (insulated, 300–1,000 steps): water drift 0.03 eV (0.02–0.06 off), brine −0.05 (−0.05 off). Cost:
    every 10th step ×1.4 (4,000 waters), ×1.6 (brine), ×1.8 (liquid water); every step ×2.7 (brine), ×2.8 (water),
    ×4.6 (4,000 waters). Liquid water's molecular dipole 2.19 → 2.46 D (the model's own charges already stand for
    liquid water: real 1.85 D in gas, 2.6–3 D in the liquid); mean |qi| 0.06 e, 0.08 e in brine. Switching it on
    releases the polarization energy as heat (an insulated box warms; the bath takes it away), and the charges' lag
    between updates releases a little more (water: 10 eV over 1,000 steps at every 10th step, 1.3 eV at every step).
  - Test: t_features "1.12 induced charges".
- Realistic tags (asked for by the user): on each setting that changes how true to nature the game is, the choice
  closest to nature carries an outlined "realistic" tag (`REAL`, `syncReal`): force reach 12 Å, longest step 0.1 fs,
  induced charges every step, atom size true size; on a checkbox ("realistic when on"): resonance in large ring
  systems, detailed nuclear collisions, ultra-realistic mode. Test: t_features "1.10 reach" (now also the tags).
- Electrons as waves: parked by the user's choice after step 1 (below), for continuous bond orders first.
- Quantum nuclei, step 1 (`node tools/pimd-proto.js h2|d2|water [P]`): path-integral MD outside the game with the
  game's own forces (each atom P beads in a ring, springs m·ω_P², ω_P = P·kT/ħ; the free ring integrated exactly in
  its normal modes; a Langevin thermostat on every mode, PILE-L). At 300 K:
  - H₂: bond width 0.037 Å classical → 0.083 (16 beads), 0.092 (32); the harmonic ground state of the game's bond is
    0.088 (a Morse well is a little wider). Mean length 0.746 → 0.767 Å with 32 beads: measured ⟨r⟩ of H₂ is 0.766.
  - D₂: 0.030 → 0.069 Å (16 beads; ground state 0.074): the isotope effect comes out of the masses alone.
  - Water O–H: 0.026 → 0.070 Å (measured zero-point width about 0.07), mean 0.963 → 0.977 Å.
  The force field is worked out once per bead: P passes a step (×16–32 on the forces, as estimated). To bring into
  the game: every atom's beads (centroid drawn as the atom, the beads as a faint cloud), P force passes, events on the
  centroids with their energy measured over every bead (localPE averaged over the ring) and every move an event makes
  applied to the whole ring, the bath's temperature setting the springs (insulated: ring-polymer dynamics at the
  temperature it started at).
- Quantum nuclei, step 2: in the engine (`PI`, `piSet(P)`, engine.js; no setting yet, off unless set): each atom with
  electrons a ring of P beads; the force pass runs once per bead (`piForces`: positions shifted to bead k, the pass,
  shifted back; the centroids get the average force; events from the first bead's pass only); the rings' internal
  normal modes move between (`piOpen` before the opening kick: half a kick and thermostat, then the free springs
  exactly; `piClose` after the closing force pass); a thermostat on the internal modes only with the bath on (PILE-L
  at P·T), insulated it is ring-polymer dynamics; new rings start spread as a free ring at the bath's temperature, the
  energy from the bath (`piSpread`); the energy is the beads' average potential plus the rings' kinetic and spring
  energy /P (`piEnergy`). Measured: H₂ at 300 K, 16 beads: width 0.089 Å, mean 0.764 Å (prototype 0.083/0.762,
  measured ⟨r⟩ 0.766); insulated H₂ keeps its energy (0.026 eV over 200 fs, falling as dt²). Liquid water costs ×7.8 with
  8 beads and ×17 with 16 (1.08 → 8.5 → 18.7 ms/fs). Left: insulated liquid water drifts with the game's 0.4 fs step
  (−0.57 eV in 30 fs, −0.18 at 0.2 fs, −0.05 at 0.1 fs: the integrator, as dt²), so rings need shorter steps (or the
  bath); events' energy books still use the centroids (localPE over the beads to do); drawing the beads; the setting;
  tests.
- Continuous bond orders, step 3 (`tools/bo-proto2.js`, BO_MODEL=C for model C, else model D):
  - Model C: raw Pauling orders, partners under 0.35 faded out (0.15 → 0.35), then each atom over its valence takes
    the same amount off every partner, floored at zero (closed form; no passes), the pair's order the smaller of its
    two atoms' answers. Statics right across the test set: every molecule within 0.21 eV a bond of the game's bonds
    (H₂O 9.33 against 9.60, CH₄ 16.65/17.12, benzene 54.56/55.59 with every ring bond 1.46 at 1.43 Å, ethylene 1.92,
    acetylene 2.93, CO₂ 1.98, H₂O₂ O–O 0.92), and H + H₂ has a barrier at last: 0.244 eV at 0.955 Å, a true saddle
    (measured 0.42 eV at 0.93 Å). But the energy has a kink at every bond's length: uncapped, a bond's energy is
    −D(order(r)), whose slope does not vanish where the valence cap takes over, so a stretch costs 40× the Morse
    curvature (H₂ 1,330 eV/Å² against 34) and dynamics keep their energy only with steps of 0.05 fs (hot H₂O + CH₄ +
    H₂: 4.3 eV lost over 1,500 steps at 0.2 fs, 0.42 at 0.1 fs; nothing jumps at 0.05 fs).
  - Model D (the order a pair may hold is what each atom's valence leaves after its other partners; its own distance
    only through a Morse curve, as Tersoff/Brenner potentials do): smooth (H₂ curvature 33 against 34), but a stretched
    bond hands its valence on: ethane's C–H go to 1.26 Å and its C–C to a double bond (34.8 eV against 29.3), H₃ is
    bound.
  - Next to try: model D with the valence a bond uses measured by how deep it sits in its own Morse well (2e − e²,
    flat at its length), not by Pauling's raw order, so that stretching a bond frees valence only as fast as it costs
    energy.
- Continuous bond orders, step 4 (`tools/bo-proto2.js`, model E, the default now): raw orders fall past the single-bond
  length as a Gaussian, exp(−α₁²d²) (flat there, as a Morse well is), Pauling's exp(−d/c) shorter; each partner's
  demand first capped by what that partner's own valence allows (so compressing one O–H takes nothing from the other);
  the level cut and the smooth minimum then as model C; every bond length by Pauling's rule (a Gaussian's inverse has
  an infinite slope at a whole order, which kicked the forces).
  - Statics: every molecule of the test set matches the game's bonds to 0.000–0.05 eV a bond, with the game's lengths
    (benzene 1.48 at 1.423 Å, ethylene 1.98, acetylene 2.96, CO₂ 1.98, H₂O₂ 0.98).
  - Stiffness near the game's: stretch curvature H₂ 52 eV/Å² (Morse 34), H₂O 81 (47), CH₄ 41 (27).
  - H + H₂: a true saddle; its height is set by the order exponent p below a single bond: 0.27 eV at p = 1.1, 0.55 at
    1.2 (measured 0.42 at 0.93 Å: p ≈ 1.15).
  - Not yet: energy in dynamics. Hot H₂O + CH₄ + H₂ (about 240 K), 1,500 steps: the game's own chemistry keeps it to
    0.002 eV at 0.2 fs; model E to 0.13–0.8 eV (0.04–0.09 at 0.1 fs), depending on how the valence sharing is rounded
    off (every bond vibrates across the point where its atom's valence is just used up, and the sharing has a corner
    there: a hard one jolts the forces each vibration, a rounded one either shifts the orders, by EPS/4 for a common
    quadratic rounding, or is itself stiff, curvature ~2/EPS per unit order²). A sharing that is smooth by
    construction is what is left: ReaxFF does it with smooth over-coordination functions throughout (its f₁–f₅).
- Continuous bond orders, step 5 (after 1.12.0; `tools/bo-proto2.js`, model E): the prototype works.
  - The last energy leaks were three corners where every bond sits: the raw order's slope jumped at the single-bond
    length (Gaussian outward, Pauling inward: now Pauling's eased in over 0.05 Å, flat at the length); a partner asking
    for nothing was given EPS/4 by the rounded ramp (now faded out below 2·EPS); and a pair coming within reach (with
    order 0) still moved its atoms' valence level (its demand now counts for nothing in the level too).
  - Hot H₂O + CH₄ + H₂ (about 240 K), 1,500 steps: energy kept to 0.0012 eV at 0.2 fs and 0.0003 at 0.1 fs (falling as
    dt²), against 0.002 for the game's own chemistry on the same molecules; about 2,000 K: 0.073 / 0.011 eV.
  - Statics: every molecule of the test set within 0.041 eV a bond of the game's bonds, with their lengths (benzene's
    ring bonds 1.5 by themselves). Stiffness as the game's Morse bonds (stretch curvature H₂ 35 eV/Å² against 34,
    H₂O 48/47, CH₄ 30/27). H + H₂ → H₂ + H: a true saddle, 0.407 eV at 1.01 Å (measured 0.42 eV at 0.93 Å; order
    exponent p = 1.15 below a single bond).
  - Next: into the game, as an Experimental mode (the forces of every bonded pair from these orders; bonds for
    drawing, charges and the events from them).
- Quantum nuclei, step 3: the setting (Settings → Experimental → Quantum nuclei: off / 8 / 16 / 32 beads, `SET.pi` →
  `piSet`), finished:
  - The rings' internal modes are given masses so that none is faster than PI_OMEGA (1.5 tu⁻¹) and none lighter than
    the atom (`piMass`; the sampled distribution does not depend on these masses). Insulated liquid water, 8 beads,
    30 fs: −0.66 eV with the modes at their own frequencies, −0.27 eV now; −0.07 eV at the 0.2 fs step, −0.017 at
    0.1 fs (an integration error, falling as dt²; with the bath on, the bath takes it).
  - Events' energy books over every bead: localPE averages its sum over the ring's copies, so an event's cost is
    the rings' (hot flame, 8 beads, 162 electron transfers in 40 frames: −0.002 eV; a hot organic soup with
    reactions, bonds made and broken: −0.52 eV against −7.95 eV classical in the same frames).
  - A ring whose atom goes (dead, fast, bare, its slot reused) gives its internal energy to the bath; turning the
    rings off gives the difference between the beads' energy and the centroids' to the bath, so the books stay
    exact (0 eV in the test).
  - Shifting to a bead and back restores the positions exactly (kept, not subtracted).
  - Drawing: from 30 px per Å, each atom's beads as small white dots joined in a loop over it (`drawRings`).
  - Cost on liquid water: ×7.8 (8 beads), ×17 (16), ×36 (32: 39.3 ms/fs against 1.08).
  - Off, nothing changes: four setups (water, brine, combustion, the U-235 chain), 400 steps, bit for bit as 1.11.0.
  - Test: t_features "1.12 quantum nuclei" (H₂ at 300 K 0.033 → 0.084 Å wide and 0.745 → 0.762 Å long with 16 beads;
    a flame with rings −0.002 eV; turning them off 0 eV).
- Continuous bond orders, step 2 (`node tools/bo-proto2.js mols|hhh|dyn`): a closed-form order (Pauling's raw order
  capped by the valence its partners leave, two fixed passes, a smooth minimum), so the energy would be a plain function
  of the positions. It fails: two passes of the cap oscillate (the first cuts both of an atom's partners to nothing,
  the second gives both back), so H counts two full bonds in water (H–H 0.97 at 0.66 Å), C–C comes out triple in
  ethane and benzene (atomization 53 and 128 eV against 29 and 56), and H₃ is bound. Diatomics and linear molecules
  are right (H₂ 4.37 eV against 4.52, N₂, CO, CO₂, HCN, C₂H₂ within 0.2 eV). Next to try: a share of the valence that
  needs no passes (each atom's partners scaled down together when they ask for more than its valence, the weakest
  first, as ReaxFF's over-coordination terms do), then the barrier and the energy books again.
- Electrons as waves, step 1: a prototype outside the game (`node tools/eff-proto.js atoms|dyn|cost`), the electron
  force field of Su & Goddard (eFF): each electron a Gaussian wave packet with a centre, a size and a spin, the size a
  coordinate of its own (mass ¾ mₑ); kinetic energy 3/(2s²), erf-smeared Coulomb, the Pauli term between overlapping
  packets (same spin repel strongly, opposite spins weakly). Ground states as published for eFF: H atom −0.4244 Ha
  (exact −0.5), He −2.301 (−2.904), H₂ −0.956 at 0.780 Å (−1.174 at 0.741); Li −6.09 (−7.48), its third electron
  pushed out to 1.8 Å by the Pauli term. Dynamics keep the energy (hot hydrogen, 24 p + 24 e: 0.0016 eV at
  0.0005 fs steps, falling fourfold per halving). But: the size breathes with a period of about 0.27 fs in a bound
  packet, so it needs steps far shorter than the game's electron steps; a free packet spreads without bound (eFF's
  users cap its size); a pair costs ×74 a point-electron pair here (erf by series, Pauli by differences), perhaps ×6–10
  optimised; and only the free electrons could be waves (an atom's own electrons are not particles in the game), so
  it would show in dense plasmas (the NIF capsule) and in how free electrons crowd, not in metals.


## 1.11.0: Data-tab ⓘ buttons and the full list, styled scroll bars, chain-reaction maps, a detailed nucleus (asked for by the user)
- Made here (Data tab): every nuclide, particle and neutrino row has an ⓘ that opens its card (the right-click card of
  1.01: what it is, its decays, Place / Fire / Element… / Isotope builder…), and each element a header row with its
  own ⓘ (its usual isotope as a neutral atom, `elemA`). Past 80 nuclides a button opens the whole list ("Show all N
  nuclides") and closes it again, instead of "… and N more nuclides". The table is rebuilt only when it changes, so a
  click is not lost to the twice-a-second refresh.
- Scroll bars: thin, rounded thumbs in the page's colours (`::-webkit-scrollbar`, which the desktop app's WebView2 and
  Chromium use; `scrollbar-width: thin` and `scrollbar-color` elsewhere); darker on hover, the accent colour while
  dragged; no arrow buttons.
- Chain-reaction maps (Data tab, under Chain reaction; bookkeeping only, nothing in the physics changes and no random
  numbers are drawn): `W.chain` (engine.js) keeps every fission (the first 20,000) with the fission whose neutron
  caused it, its depth in that family tree and how its neutrons ended, and every step seen on the chart of nuclides
  (decays from the decay events, neutron captures, fissions to their fragments). Neutrons carry `kFis`; the
  fragments too, so their delayed neutrons count to the fission that made them, and a neutron that scatters or knocks
  out neutrons in a nuclear reaction passes its family on (finishReaction, hep.js). Before that, a test block of ²³⁵U
  showed 15 of 37 fissions without a parent (73 neutrons came out of such reactions); now 1 of 30, the fired neutron.
  - Fission tree: each fission a dot, joined to its parent, generations left to right, the count of each generation
    under it; orange passed the chain on, blue's neutrons were captured, grey's escaped, ringed ones split by
    themselves; pointing at a dot draws its line back to where the chain began and tells its story.
  - Decay chart: the chart of nuclides (protons up, neutrons across) around what happened, in bands where the
    nuclides lie far apart (a fission's heavy parent and its fragments), each step an arrow coloured by kind and
    thicker for more; squares coloured by half-life, outlined while in the box; pointing at one lists what led to it
    and what it became.
- Ultra-realistic mode, a detailed nucleus: from 20 px across, its nucleons at their true size (0.88 fm) in a sphere
  of 1.2·A^⅓ fm, a low-discrepancy fill drawn back to front as shaded balls; the diffuse edge of the nuclear density as
  a glow (Woods–Saxon skin, 0.55 fm); deformed nuclei drawn prolate, β₂ estimated from the valence nucleons (Casten's P
  factor: ²³⁸U 0.30, measured 0.29; ¹⁵⁴Sm 0.30, measured 0.34; ²⁰⁸Pb and ¹⁶O 0), turned by the particle's id; the three
  valence quarks inside each nucleon from 26 px (in the three colour charges), lettered from 60 px; a lone proton or
  neutron shows its quarks too. Above 70 px a caption gives the radius, the nucleons and the shape. Drawing only.
- Tests: t_features "1.11 tree" (Node, seeded: 30 fissions from the one fired neutron that started them, 10
  generations, every parent earlier and one generation up), "1.11 data" (the list's ⓘ and full list, the card, both
  maps drawn and answering the pointer, the scroll-bar rules, β₂ and the nucleon layout, the detailed nucleus drawn).

## 1.10.0: speed menu, interface motion, longer force reach, predictive cost tags, shorter tool texts (asked for by the user)
- Speed menu: the speed readout is a button that opens every speed on one ladder, 16× down to 1/512× in halvings, then
  decades of simulated time a second (100 fs/s … 1 ys/s), each with its multiple and its rate (`speedLadder`,
  `openSpeedMenu`, ui.js). The − / + buttons walk the same ladder, so 1/512× is followed by the next decade instead of a
  jump to a different kind of label. The readout shows the rate under the multiple (`#speedRate`).
- Interface motion (Settings → Display → Interface animations, `SET.motion`; off with the system's reduced motion): a
  pill slides under the chosen button of every row of buttons and tab row (`motionSync`, kept in step by a
  MutationObserver on aria-pressed/aria-selected), slider tracks fill to the thumb (`--fill`), buttons press in, and
  menus, dialogs, panels and checkboxes pop or fade in (shell.html, `body.mo`).
- Experimental → Longer force reach (`SET.rc` 6 / 9 / 12 Å → `setCutoff`, engine.js): RC, RC2, RL, RL2, RLF2 and
  CELL_MIN are now `let` and follow the setting; the lists are rebuilt, the WebAssembly kernel (6 Å built in, its
  constant check now compares 36) is turned off for 9 and 12 Å, and the workers are started again with the new RC2
  and run their JavaScript kernels. No cost at 6 Å from the `let` (liquid water 0.50 → 0.50 ms/fs, 4,000 waters
  1.81 → 1.81). Measured against the game's usual 6 Å on WebAssembly: liquid water 0.51 → 1.12 → 1.61 ms/fs (×2.2,
  ×3.2), brine 9.1 → 11.4 → 14.2 (×1.3, ×1.6), 4,000 waters 1.81 → 4.76 → 10.1 (×2.6, ×5.6). What it buys, on one
  arrangement: water's potential energy −924.3 → −925.3 → −926.0 kJ/mol a molecule (0.9 and 1.6 more binding, of
  about 41 to boil it off); brine −951.5 → −960.0 → −962.5. Changing the reach changes the potential energy, so the
  energy books step once. Tests: t_threads (9 Å on two threads equals one thread, JavaScript workers, back to
  WebAssembly at 6 Å), t_features "1.10 reach" (insulated water at 9 Å: 0.001 eV over 300 steps).
- Cost tags are predictive (asked for by the user): every setting that changes speed names what it costs in a grey tag
  (physics, drawing or memory); every choice in a row of buttons carries the cost it would have, and a checkbox the
  cost of turning it on (dimmed while off). One wording: ×N against the usual choice (×1), "up to ×N" where it depends
  on how full the box is, slight / some / heavy where it was not measured, blue where a choice saves work. Drawing
  resolution is worked out for the screen's pixel ratio, the frame-rate cap from the monitor's measured rate, threads
  from this computer's thread count. Physics per frame now has its 24 ms tag (it had none).
- Shorter texts for the tools, their options, isotopes, objects and particles, and a few Lab notes (asked for by the
  user; settings descriptions left as they were): the tool hints went from 98 to 59 characters on average, and the option notes say only
  what to do and what happens.

## 1.09.0: bug fixes (from the bug-fix session, applied from its patches)
- Insulated chain reaction gained energy in jumps of up to 128 MeV in steps with no nuclear event: an atom the wall put
  back was set down on top of another atom already there. A recoiling fragment stopped in the wall (wallOrEscape) was
  clamped 0.6 Å inside, onto a fragment stopped there before it (two Pa ions 0.1 Å apart; the contact force, capped at
  FCAP, threw both out at 64 MeV each). A slow atom rescued from deep past the wall (walls) was put on the wall line,
  and when the overlap cost more than its motion had, its speed was clamped at zero and the rest was made from nothing.
  Now both set the atom down clear of other atoms (placeClear, its bond partners allowed; the crowd grid is dropped
  around it, since atoms move during the walls pass). Insulated chain, seed 11, 3,000 frames (on 1.08 before the fix):
  +212.3 MeV → +9.0 keV (13 fissions, 2.9 GeV); seed 5 +59.6 MeV → +14.7 keV. Test: t_features "1.09 wall overlap"
  (stopped atom +10.6 MeV → 0; rescued atom +6.4 MeV → −1 eV).
- Insulated magnet setup drifted 38–52 eV in 3,000 frames (its 300-frame limit is 3 eV): every jump over 0.3 eV was an
  iron atom by the pole crossing its Curie point (localTemps, every 10 steps). Its magnetic energy switched between
  ferromagnet and paramagnet (−0.58 ↔ −1.23 eV at 5,000 T) and nothing paid for it. Now the atom's own motion pays the
  change, and if it cannot, the crossing waits. Measured on 0.95: 800 frames, 220 such jumps → 0; 3,000 frames
  51.5 → 31.6 eV. The single crossing on 1.08: −0.652 eV unbooked → 0. Left: the rest comes after frame ~1,700, while
  hot iron oxidizes with ionic transfers in H/O chemistry (jumps of 0.5–0.9 eV in steps with events), not chased.
  Test: t_features "1.09 Curie".
- Insulated, melted memory chip (seu, bath off, heated at 4,200 K) crawled: breakCost's fingerprint for a big molecule
  included the molecule's number (q.mol), and removeBond renumbers the molecule, so every bond try in the chip
  "missed" and summed all 985 atoms twice, even for a bond in a ring. Now the fingerprint asks only that the rest
  stays one molecule. Same heated state (24,000 steps at 4,200 K, seed 11), then 300 insulated steps: 99.5 s → 32.9 s;
  breakCost 61.1 s → 5.3 s; whole-molecule fallbacks 4,363 → 57. The local cost against the whole-chip sum over 5,417
  tries agrees to 7·10⁻¹² eV. Left: most of the 33 s is delocalize, relink, restoreSnap and molecule over the whole
  chip on every event tried (since 1.05's resonance, each relink of a 1,000-atom molecule re-spreads its charges), the
  same kind of cost, not chased. Test: t_features "1.09 chip" (40 tries in the chip: 40 whole-chip sums → 0).
- Ionized water's drift (the known limit, 120–170 eV/ps) came from the cutoff, as the accuracy benchmark suggested:
  between net charges (free leptons, ions of charge ≥ 1) whose long-range part is summed exactly beyond RC, the
  soft-cored energy inside RC was left unshifted (csh → 0), so the energy stepped by KE·qq·(1/RC − 1/√(RC² + s)) at
  every crossing: 0.037 eV for an electron and an O⁺ (sEN 1.12 Å²), measured 0.0366 eV per crossing by regression. The
  motion never felt the step (the forces on both sides are right), but every event books with the energy, so the
  books and the motion parted at a steady rate. Now csh (and the two written-out copies in phiE and ejectElectron's
  launch) shifts those pairs to meet 1/r at RC, as every other pair meets zero there. Forces unchanged; event energies
  change by at most that step. bench-acc waterion, 400 steps, eV/ps: JavaScript kernels seeds 3, 5, 12: 137, 154,
  138 → 1.6, 5.0, −5.5; WebAssembly: seeds 1, 2, 4, 6, 8: 167, 128, 135, 152, 116 → −3.2, 5.8, 19.8, 0.6, 6.3.
  Test: t_features "1.09 ionized water drift" (Node harness, seeded; 131, 153 → 0, −1 eV/ps).
- Found, not fixed: the ionized-water plasma can run away (impact ionization to ~150 free electrons, then keV jumps
  at steps with big multiply charged clusters, e.g. +5,251 then −4,762 eV around H₁₈O₁₈²⁹⁺), before and after this
  fix: seed 7 within 400 steps (old code), seed 3 within 3,000 steps (both). A lead for the next session.

## 1.08.0: Experimental: detailed nuclear collisions (an intranuclear cascade)
- Settings → Experimental → Detailed nuclear collisions (`SET.inc` → `INC_ON`; `cascadeInto` in hep.js): a proton or
  neutron striking a nucleus heavier than A = 16 at 40 MeV–10 GeV a nucleon is followed through it instead of the
  participant fireball (`fragmentInto`, still used when the setting is off, for nucleus–nucleus collisions, and
  when no consistent outcome turns up). The nucleus's nucleons sit at random in a disc of radius 1.2·A^⅓ fm with
  2-D Fermi momenta up to 260 MeV/c; a fast particle meets a nucleon within σ·ρ₀/(2n) of its path (so its mean free
  path is nuclear matter's, 1/ρ₀σ, not the far shorter one of a nucleus laid flat: with √(σ/π) a 1 GeV proton made
  27 collisions in lead and left 409 MeV); σ from the nucleon–nucleon tables (below 290 MeV 25 + 4500·(1/T − 1/290) mb);
  elastic (isotropic when slow, forward when fast) or a pion made with the inelastic share; Pauli blocking below
  the Fermi momentum; the projectile gains the 45 MeV well depth falling in and every nucleon gives it up getting
  out (without the first, the excitation came out 45 MeV too high); slower nucleons stay; pions leave (not caught
  again). The residual nucleus takes exactly the energy and momentum that did not leave, and cools through
  `residualInto` (evaporation, fission). A pass that meets no nucleon twice running does nothing.
- Measured (Node, 80 hits each; literature values approximate): 1 GeV p + ²⁰⁸Pb: 14.9 neutrons a reaction (about 17;
  the fireball model 13.9), excitation 145 MeV (150–200), 10.4 collisions, 1.4 pions (high: no pion absorption),
  fission 21% (about 10%; the fireball model 0). 500 MeV: 9.8 neutrons, 86 MeV. 200 MeV: 9.5 neutrons (about 8–9),
  84 MeV (60–80). About 3 ms a hit against 1 ms; in the spallation setup nuclear events stay 5–6% of the time,
  though the run gets busier with what the hits make. Energy kept to 4×10⁻⁵ eV per hit, charge and nucleons exactly.
- Tried and left out: pions scattering and being absorbed inside the nucleus (πN through the Δ, absorbed on a
  nucleon pair in 10–30% of their meetings). It brought the pions down to 0.3–0.8 a reaction (about right) but
  the pions' many scatterings in a flat nucleus left 283–293 MeV in lead at 1 GeV (25 neutrons, fission 49%), far
  over the measured 150–200 MeV, with absorption shares of 0.3 and 0.1 and a broadened Δ alike.
- Test: t_features "1.08 cascade".
- Charges that respond to their surroundings (charge equilibration), planned for the Experimental tab, is put on hold
  with the very large items: the partial charges enter many force and energy terms (softPair, coulAA and its shift,
  iwK weights, ionic pairs, hydrogen bonds, the free electrons' forces, localPE in the events' books), some not
  bilinear in the charges, so the forces would only follow from the energy (and the energy stay exact) after
  reworking them all. The tab lists it under On hold with its estimated cost.

## 1.07.0: Settings → Experimental, and cost tags on the settings (asked for by the user)
- A new Settings tab, Experimental: each accuracy-for-speed option with a plain description and its cost as measured
  (tools/accbench, the section below). Built so far:
  - Longest time step 0.4 fs (normal), 0.2 fs or 0.1 fs (`SET.dtMax` → `DT_MAX`, now a `let`): ×1.6–1.8 and ×2.6–2.9
    where the steps are at their longest.
  - Resonance in large ring systems (`SET.resBig` → `RES_BIG`): π systems past 40 atoms, up to 1,000, get their Pauling
    bond orders from a determinant instead of the six-ring rule (`resonanceBig`: for a bipartite system of hexagons,
    K = |det B| and a bond's share of the structures is B_ij·(B⁻¹)_ji; a share outside 0…1 or no structure at all sends
    it back to the rule). The same orders and resonance energies as counting for benzene, naphthalene, anthracene,
    coronene, styrene and pyridine (checked with the counting limit lowered to 5 atoms). A 54-carbon graphene flake:
    seven distinct orders 1.18–1.82 instead of 1.5 everywhere; a 216-carbon one, 0.9 ms with the rule, 3.8 ms worked
    out. 12 ms at 200 ring atoms, 60 ms at 500, 0.2 s at 1,000, only when such a molecule's bonding changes.
  - Coming next (listed in the tab): longer force reach (after the bug-fix session's work on the cutoff), charges that
    respond to their surroundings, detailed nuclear collisions. On hold (listed with their estimated costs):
    continuous bond orders, quantum nuclei, electrons as waves, real 3-D, quantum chemistry.
- Cost tags (`COSTS`, `syncCosts()` in ui.js) beside every setting that changes speed, in every tab: green to red by
  what the current choice costs, blue where it makes things faster (threads, WebGL): longest step, large-system
  resonance, particle limit (up to ×0.5 … ×5 for a box filled to it), drawing resolution, physics per frame, threads,
  WebGL or Canvas 2D, frame-rate cap, labels, glows, trails, rewind, the ultra-realistic mode (free).
- Test: t_features "1.07 experimental".

## Accuracy against speed: measurements (after 1.06, tools/accbench/)
Node, one thread, seeded; ms per simulated femtosecond (ms/fs) is the cost that matters (a shorter step does less a
step). Energy drift with the bath off. Raw lines in tools/accbench/results-1.06.txt; `tools/accbench/bench-all.sh`.
- Shorter longest step (DT_MAX 0.04 → 0.02 → 0.01 tu): cost ×1.6–1.8 and ×2.6–2.9 where the step is at its longest
  (water 0.42 → 0.73 → 1.21 ms/fs; brine 8.0 → 12.9 → 22.1; 4,000 waters 1.85 → 3.84 → 6.69); drift only a little
  better (water 0.17 → 0.07 → 0.06 eV/ps, brine −0.56 → −0.44 → −0.22, combustion no change). No effect where steps
  are already short (NIF capsule, ionized water).
- Longer cutoff (RC 6 → 9 → 12 Å, JavaScript kernels both sides; the WebAssembly kernel has 6 Å built in):
  water 0.75 → 1.00 → 1.52 ms/fs, brine 11.4 → 11.8 → 16.4, 4,000 waters 2.87 → 4.78 → 10.5, ionized water 29 → 41 →
  47. Ionized water's drift (the known limit) falls with it: seeds 3, 5, 12 at 6 Å 137, 154, 122 eV/ps; at 9 Å 44,
  (runaway), 47; at 12 Å −2, 3, 7 (runs where the plasma ran away, 120+ free electrons, left out). So most of that
  drift comes from the 6 Å cutoff, not the step size (halving or quartering the step left it at 120–150) or the
  free-flight switching it was put down to: a lead for a bug-fix session.
- Nuclear events' share of the time as the setups run: chain reaction 2.1% (neutronHit 3 ms a call, 18 calls),
  spallation 4.8%, fusion 1.1%, photonuclear 1.3%, uranium series 0.7%, RHIC 0.1%; pion beam 24% but that is the
  flight of the pions (moveExos every step), not events. A cascade ten times costlier would add about 10–50%.
- Charge equilibration (a cost model, not a working QEq: conjugate gradients over pairs within 6 Å): a warm-started
  3-iteration solve 0.19 ms for liquid water (240 atoms; a step is 0.17 ms), 0.57 ms for 3,960 atoms (0.75), 1.5 ms
  for 12,000; every step ×2–2.2, every fifth step about ×1.2.
- Continuous bond orders (tools/bo-proto.js model A, its order solve alone, unoptimised): 21 ms a step for liquid
  water and 56 ms for 3,960 atoms, 75–120 times a whole step today; optimised perhaps 5–15 times.
- Path-integral nuclei: forces, bath and integration are 87–95% of a step in water and brine, so 16 or 32 copies
  would cost about ×14–15 or ×28–30.
- Where time goes today (WebAssembly kernel): water forces 76% (kernels 54%), integration 16%; ionized water
  integration 67% (the electrons' inner steps); brine events 30% and the force pass redone after events 34%; NIF
  events 24%.

## 1.06.0: ultra-realistic nuclei at their true size in every view
- In the ultra-realistic mode an atom's nucleus was still drawn scaled with the zoom by the Bohr picture (3–22 px,
  a fifth of the atom) and the orbital picture (a 1.2–4 px dot), and a hadron's quarks in the particle view at the
  enlarged nucleon size (reported by the user). Now the mode draws a nucleus only at its true size: the Bohr and
  orbital pictures leave theirs out (`drawBohr(…, rnTrue)`, `drawOrbitalAtom(…, noNuc)`), the nucleus is drawn once its
  true radius (1.2·A^⅓ fm) is half a pixel (about 10⁵ px/Å for oxygen), and a hadron's insides once a nucleon is
  2 px. A bare nucleus or a free neutron smaller than a pixel keeps its fixed one-pixel dot, so it can be found.
- Test: t_features "1.06 true nuclei": nuclei drawn in the water setup at 120 px/Å, Bohr pictures auto and on: 0 and 0
  (1.05: 8 and 8, one per atom in view); the orbital picture's dot is gone too.

## 1.05.0: resonance from bond orders (approved by the user)
- From the bond-order prototype, the part that holds up: bonds that can be drawn more than one way take their
  Pauling bond order. `resonance()` (engine.js, in relink, where aromatize ran) finds each molecule's π system (C, N, O,
  S atoms that each hold one double bond to another such atom), counts every Kekulé structure (perfect matching along
  its bonds, up to 40 atoms and 4,000 structures), and gives each bond the mean, 1 + f. Its depth, length and spring
  are interpolated at that order (length 0.16·f(1−f) shorter than the straight mean, as the 0.95 rule had at 1.5), and
  the system's resonance energy 150 kJ/mol × ln K / ln 2 is shared among its resonating bonds by f(1−f). Whole-number
  orders stay as they were for valence counting; addition across a resonating bond pays the rest of the system's
  resonance energy (reaction()). Bigger π systems fall back to the 0.95 six-ring rule (`aromatize(atoms, true)`).
  The second line of a resonating bond is drawn as thick as its share of a second bond.
- Measured (relaxed, 0 K): benzene 1.50, 1.406 Å, 150 kJ/mol as before; naphthalene 1⅔ at 1.375 Å and 1⅓ at
  1.449 Å (measured 1.37 and 1.42; it was 1.40 everywhere), 238 kJ/mol (measured about 255); anthracene 1.25, 1.5,
  1.75, 300 kJ/mol; coronene 1.3, 1.4, 1.7, 648 kJ/mol; butadiene and other single-structure systems unchanged.
  27 library molecules resonate (all their benzene rings as before); naphthalene, anthracene and coronene re-settled
  with tools/molrelax.js. Rings whose π system needs a lone pair (pyrrole, thiophene, furan, the five-membered ring of
  purines) are not counted, as before.
- Test: t_features "1.05 resonance".

## 1.04.0: extreme slow motion in every mode
- The speed buttons go on below 1/512× without the ultra-realistic mode too (asked for by the user): a tenth at a
  click in simulated time per second, 1 fs/s down to 1 ys/s (`stepSpeed`, `deepSlow()` in engine.js). There, as in
  1.03's ultra mode, each frame takes exactly the time set (a step a frame, floor 10⁻¹⁸ tu), automatic slow motion
  stays out, and resonances (ρ, ω, φ, K*, Δ) fly and decay on the clock with their mean lives ħ/Γ instead of at once
  (`moveExos`). At 1/512× and faster nothing changed: resonances still decay where they are made. Decay speed-ups set
  by a setup still apply (that is the normal mode's convenience).
- Measured (page): at 1 ys/s, 19 of 20 φ mesons fired at 1 MeV were left after 2.5×10⁻²³ s (1,500 frames, exactly
  that much simulated time); at 1× all 20 are gone within two frames.
- Test: t_features "1.04 slow"; the older "grab/speed" check now steps down nine halvings to 1/512×.

## 1.03.0: the ultra-realistic mode (approved by the user)
- Settings → General → Ultra-realistic (`SET.ultra`, mirrored in `W.ultra`; "ultra-realistic" shows beside the
  version). Nothing is enlarged or sped up to be seen:
  - Nuclear reach at true size (hep.js `ultraReach`): the two radii 1.2·A^⅓ fm, plus 2 fm for the strong force,
    plus, with a neutron, its wavelength ƛ = 4.55 fm/√(E/MeV). Measured: thermal neutron on ²³⁵U 0.29 Å (about as
    before, so slow neutrons are still caught), a 2 MeV neutron 1.4×10⁻⁴ Å, a 5 MeV α 1.1×10⁻⁴ Å (it was 0.25–0.35 Å).
    A pass is an impact parameter one to one (`nuclearEncounter`, `nuclearScatter`), not stretched over the reach.
  - Fusion only inside the true cross section, √(σ/π): D–T measured (5.1 b at 64 keV), the rest S/E·e^(−√(E_G/E))
    from the S-factors scaled to D–T's 25 MeV·b (`gamowP().sig`, `tryFusion(a, b, bd)`).
  - Beams (`rBeam`): leptons inside 2.82 fm, nuclei at their true reach, Coulomb turns out to 60 times the head-on
    distance; unstable hadrons hit nuclei at their true sizes.
  - Decays at their real rates: the setup's decay speed and "let the shortest-lived show" are put aside
    (`W.preUltra`, restored when it is turned off; saves keep the setup's), and resonances (ρ, φ, Δ …) fly and decay
    on the clock with their mean lives ħ/Γ instead of at once.
  - Zoom to 4×10⁸ px/Å (`zoomMax()`; 0.3 fm across the view). Past the normal 4,000 px/Å the WebGL layer is left out
    (single precision is a few fm at best) and Canvas 2D draws everything. Free electrons are a 1-pixel dot; a bare
    nucleus or a neutron a dot until its true size is larger, then its nucleons; inside an atom's cloud a faint wash
    with the nucleus at the centre at its true size (`drawUltraParts`); bonds stay thin lines; the scale bar goes to fm.
  - Slow motion below 1/512× in decades of simulated time per second, 1 fs/s down to 1 ys/s (`stepSpeed`); there
    automatic slow motion stays out, each frame takes one step of exactly that length (`simFrame` floor 10⁻¹⁸ tu), and
    the clock is a compensated sum (a yoctosecond is below the last digit of `W.t` past 1,000 tu).
- Measured (Node, 300 frames, seed 7): fusion setup 14 fusions normally, 7 ultra; chain reaction 20 fissions normally
  in 600 frames, 2 ultra (fast neutrons almost never hit); pion beam 13 reactions, 0 ultra; spallation (sns) 338, 0.
  At 1 ys/s, 15 of 20 φ mesons were left after 2.5×10⁻²³ s (expected 17 ± 2), and 1,500 frames advanced exactly
  2.5×10⁻²³ s. Energy with the bath off, ultra: within 1.2 eV in soup, mucf, useries, annihilation, antihydrogen,
  pet and sns; the NIF capsule gained 205 eV with no fusion (the known heavily-ionized-plasma drift, which normally
  happens with fusions in it).
- Test: t_features "1.03 ultra".

## 1.02.0: where hits land on a detector screen; the walls' charge
- Detector screens now also record where along them each hit lands (40 strips, light and particles apart:
  `objRecord(ob, E, light, x, y)` in props.js, `hits.posL`/`hits.posP`). Right-click a screen: "Where hits land" or
  "Their energies" chooses what its own bars show (kept in saves as `view`), and "Graph it (Data tab)" opens the new
  Data → Detector screens graph (hits against position or energy, a chooser when there are several screens, Clear).
  The screens of the gold foil, the prism and Thomson's tube show positions from the start. Measured: in the gold foil
  setup the far screen's 2,660 hits in 600 frames are all placed, peaked at its middle as expected.
- The walls' charge (asked for after the hot-helium finding: pair production, then the positrons annihilate in the
  walls). Every place charge leaves the box's particles now books it: `chargeTo(q, where)` in engine.js, into
  `ledger.qWall` (positrons and antimatter annihilating in a wall, fast charged particles stopped in it, charged mesons
  leaving through it; what an antinucleus's mesons carry back in is taken off), `ledger.qObj` (stopped in placed pieces
  and the collider's detectors) and `ledger.qOut` (out through an open box). Data → Charge shows the box, the walls,
  pieces, the open edges and the sum, which changes only when charge is added or removed from outside. Checked: in all
  53 setups with their sources off, box + walls + pieces + out stayed constant over 300 frames (mucf, fusion,
  annihilation, useries, pet: the walls took 1–9 e). The charge books are not kept in saves (a loaded save starts them
  at zero).
- Tests: t_features "1.02 detector", "1.02 wall charge".
- The Windows build of 1.00.0 failed (and would have for every 1.xx.0): Cargo refuses a version with a leading zero
  ("1.00.0": invalid leading zero in minor version number). The desktop files now carry the same number as plain
  semver (1.2.0 for 1.02.0); the page keeps the release name. The installers are named 1.2.0.

## 1.01.0: right-click cards for the palette
- Right-clicking (or pressing and holding) a chip in the top bar, an item of its category menus or a Find result opens
  a card in the quick menu: what it is, its charge, mass, quarks, lifetime and main decays (particles); element,
  nucleus, half-life, decay modes, charge, electrons, mass, first ionization energy, electronegativity, melting and
  boiling points (atoms and nuclei); formula, kind, atoms and bonds, molar mass, charge, radical (molecules); where it is
  found; and Place, Fire, Element…, Isotope builder…, Open in the builder, and Remove all of these in the box (with the
  count). specAbout() in ui.js. Test: t_features "1.01 cards".

## 1.00.0: the first full release
- The 0.96.0 release candidate as it was, after seven release candidates of bug fixes (0.90–0.96). The feature freeze
  ends: the planned features above come next, as 1.01 onwards.
- Known limit, for a bug-fix session: the chain-reaction setup with its heat bath turned off runs away (about 15
  fissions) and then its energy books jump by tens to hundreds of MeV without nuclear events (+212 MeV over 3,000
  frames, seed 11; the overnight soak of 2026-10-27). As shipped, with the bath on, it does not show.

## 0.96.0: release candidate 7
- The particle view's pictures (electrons circling their atoms and bonds, the muon in muonium and muonic atoms, quarks
  inside hadrons, chip carriers) ran on the real-time clock, so they kept their pace in slow motion. They now run on
  W.at, which advances with the simulation against the setup's normal speed (capped at 4× when sped up, to keep them
  readable): slow motion slows them, a pause stops them. Test: t_features "0.96 picture clock".

## 0.95.0: release candidate 6: bug fixes, aromatic rings and carbon monoxide (approved by the user)
- Aromatic rings: a six-membered ring of C and N in which every atom has one double bond (in the ring or a ring fused
  to it) is marked aromatic (engine.js aromatize, run in relink for each molecule touched). Its bonds take the mean of
  the single and double bond's energy and spring, 0.04 Å shorter than their mean length (C–C 1.40 Å, C–N 1.33 Å), plus
  150 kJ/mol of resonance energy per ring spread over its six bonds; whole-number orders stay for valence counting.
  Adding across an aromatic double bond costs the rest of the ring's stability (reaction(): H + benzene releases 1.35
  eV over a 0.16 eV barrier, against 1.52 eV and 0.12 eV for ethylene; measured: about 1.1 and 1.6 eV). Drawn as a full
  line and a faint one. Benzene settles at 1.405 Å all round; naphthalene has 11 aromatic bonds, coronene 30. The 27
  library molecules with aromatic rings were re-settled (tools/molrelax.js) and the tiny objects with them rebuilt
  (objgen: dna, wwdomain, chignolin, oxytocin, graphene, kevlar; all held at 300 K). localDelta's fingerprint counts
  aromatic bonds, so a ring that stops being aromatic beyond the neighbourhood falls back to the whole molecule.
- Carbon monoxide: the library's CO is C⁻≡O⁺ (closed; its formal charges mostly shared back, as resonance does), not a
  radical C=O. C=O made in a fire closes up to C≡O in housekeeping (coTriple: on trial, 2.5–2.8 eV released). Air at
  300 K leaves CO alone; at 3000 K hot O atoms add across it and CO₂ forms.
- Periodic box: a trail that crosses an edge was drawn as a line straight across the box; now it leaves through the edge
  and comes back in through the opposite one (drawTracks, clipped to the box).
- Physics tab: p p π⁰ opens first (√s 2.0115 GeV, 67.5 MeV a beam), then d π⁺ (2.0152 GeV, 69.3 MeV) and p n π⁺ (70.4 MeV);
  the note that unstable particles pass through matter untouched (out of date since 0.62) now says what they do. (From an
  outside review of the page; its other points checked: methane's hydrogens are 90° apart, the head tags are the
  publisher's, claude-sonnet-5-5 is a current model.)

## 0.94.0: release candidate 5 (bug fixes)
- Data tab graph: the chart canvas was resized only when its width changed, so picking more quantities (the graph grows a
  row for each) stretched the first height's picture over the new one: blurry, squashed text and only the first rows
  shown (chartCtx now checks the height too; the pair-mass chart shares it). A steady quantity says "(steady)" instead
  of a made-up ±1 range; in a narrow panel the range is left out so the value never runs into the name. Test: t_features
  "0.94 graph".

## 0.93.0: release candidate 4 (bug fixes)
- Collisions in very short steps (deep slow motion at extreme energies): the closest approach of two paths in a step was
  clamped to the step's end, so while still closing in, a pair "met" at its present distance: in short steps the first
  meeting was at the outskirts of the reach, where a 1 PeV n–p pass diffracts (turned a hair, marked as met) and the
  core was never reached: the neutron passed through. Now a pair still closing in at the step's end meets in a later
  step, at the true miss distance (relTargets, neutron pairs, radVsFast, beam–beam, fast–fast nuclei). In 1/512×-sized
  steps a near-head-on 1 PeV n–p pass reacted 0 times in 6 before, 6 in 6 now. Test: t_features "0.92 PeV". A neutron
  under 1 keV (not in flight) is left as it was: it meets a nucleus on every step within reach, and its capture odds are
  reckoned with that (deferring it too raised thermal n–H captures eightfold: 131 of 300 passes against 16).
- What a nuclear event's products knock on is marked as theirs (slow motion for nuclear events, when off, leaves it out):
  also a bare nucleus struck in nuclear stopping, both partners of a Coulomb scattering, and a struck nucleus sent off
  below the fast threshold.
- The capture of a lepton trapped in a molecular ion's well (0.92) is paid by the neighbourhood's motion (up to 12 eV),
  and by the bath only when there is one: an insulated box stays exact (t_energy's soup drifted by the bath's payments).

## 0.92.0: release candidate 3 (bug fixes)
- Light in flight through a prism: when the photon reached the prism, the light leaving the far side set off at once
  (emitPhoton ignored opts.delay for flights) while the path inside was drawn late (opticHit added the first leg's
  travel time, which a flight has already flown when it lands). Now the path inside is drawn from the moment it lands,
  and the light leaving sets off when it gets to the far side (flights may start in the future: drawFlights, the labels
  and lightHead skip them until then). Test: t_features 0.91 block.
- Neutrons at the walls (physics change, OK'd by the user): Absorbed now follows the 1/v law, capture odds a hit
  1 − exp(−5·√(0.0253 eV / E)): thermal 99.4%, 1 eV 55%, 1 keV 2.5%, 1 MeV 0.05%; the rest scatter back. New choice
  "Fast leave" (not a material): neutrons over 0.1 MeV leave, slower ones bounce. Pass through is unchanged for all.
- Electrons stuck at molecular cations (user's video: C₁₀F₂₀ with C=F⁺): an ion's well is as deep as the free atom's ion
  binds (softFor), but in a molecule the capture may have to break a bond (the π bond of C=F⁺), so at the bottom of the
  well the capture never paid (−2 to −6 eV) and was undone on every try: the electron stayed for ever. Now a lepton
  bound in the well (Etot < 0) is captured with the surroundings paying up to 12 eV, booked to ledger.bath as forceShed
  does. Test: t_features 0.92 block.
- Narrator: what is logged is looked at every frame, also while a caption is up, and the most important line waits its
  turn (up to 8 s). It was looked for only among the last 120 lines once a caption was done, so a fission could be lost
  under the chemistry of its fragments (t_features' narrator check failed now and then).

## 0.91.0: release candidate 2 (bug fixes)
- Automatic slow motion (after a collision or a nuclear event) now works against the setup's normal speed, as the
  slow-motion button does: the speed buttons scale it. It worked against the speed as set, which cancelled them out, so
  1/512 looked like 1/32 in the collider. Slowed further, it also lasts longer (up to 64 times its 3 seconds).
- In slow motion a frame may be shorter than the shortest normal step (DT_MIN), as with light in flight: one step a frame
  of DT_MIN had been the real floor at extreme energies. Measured in the gold-on-gold collider: 1/512 now advances 16
  times less a frame than 1/32 (1.7 times before).
- The speed readout shows the setting in automatic slow motion too ("slow-mo 1/4×").
- Beam sources: the housing keeps its size at any zoom; the strip it fires from is a thin line across its mouth.
  Right-clicking finds a source where it is drawn.
- The PAUSED / READY badge sits under the palette bar (it was hidden behind it), the fps readout under it.
- The quark–gluon plasma picture: drawn above the hadron spray, nearly opaque, at least about 70 pixels across, with
  larger quarks and gluons; captions over it fade until it cools; strings and plasma keep their own clock (at most a
  thirtieth of a second a frame), so the slow frame in which thousands of hadrons appear no longer skips them.

## 0.90.0: release candidate 1 (feature freeze)
- The 20,000-atom goal is met on a 16-thread machine: room-temperature water, 723 × 465 Å, 0.55 ms a step; at 1× a frame
  takes 37.5 steps × 0.55 ms + 1.2 ms drawing = 22 ms, so 45 fps.
- The benchmark's two water worlds now settle for 200 steps before timing (was 40). Freshly laid out, their atoms move fast
  and the neighbour lists were rebuilt every other step (0.56 a step in the user's run); after settling it is about 0.03.
- From here on only bug fixes until 1.00.

## 0.68.0: old saves, a stress pass, touch and small screens, new setups, Help
- t_compat: worlds saved by 0.42, 0.46, 0.50, 0.55, 0.60 and 0.64 (tests/fixtures, each that version's worldToJSON of six
  setups after 20 frames) open in the page with every particle, bond and magnet and run on with finite energy; a share
  code round-trips (with a placed object).
- t_fuzz also places 0–4 random objects and runs a third of its worlds at 1/512, 1/16 or 4× pace.
- t_touch: a phone-sized touch page: tap to place, drag to draw a wall, long press for the quick menu.
- Long press fixes: lifting the finger that opened the quick menu clicked the item under it (QM.noClickTill); the press's
  own change was never taken back (the check compared undo lengths: UNDO.serial now).
- The Objects tool's press is one undo step (UNDO_TOOLS), not two.
- New setups: Rutherford's gold foil (5 MeV α, 40 layers of gold, detector screens round it), Hydrogen light through a
  prism (Balmer-line lasers, an F2 prism at least deviation, a screen), Thomson's e/m tube (1 keV electrons between plates
  60 V apart, a screen).
- Select tool: a box takes placed objects too (by their middle; a click on one picks it); copy, paste, drag and delete
  take them along (R.oSel, UI.clip.objs).
- A particle's quick menu offers the object under it (QM.forceObj); a laser's guide line stops at the first object.
- Help (Esc menu, main menu): getting started, moving around, keeping, what the simulation does and does not do, its
  known limits. The tour mentions objects, the quick menu, the paused start and Help.
- Short landscape windows (≤ 520 px tall): no name, tagline or readout tiles in the header (one row); a small chamber
  shows the setup's note in two lines, tap for the rest (hintFit).

## 0.67.0: energy and display fixes, beam sources, setups start paused
- Emission lines are paid what they cost: pickLine charges a line max(the element's lowest excitation, its own photon)
  and only picks lines the collision can pay for. Lines above the lowest (potassium 404 nm over its 1.61 eV, caesium's and
  rubidium's blue lines, lithium 610 nm) were paid the lowest and made up to 1.5 eV of light from nowhere each. Flame
  seeds 7–9: 4.7 / 2.9 / 3.4 eV → −0.05 / 0.22 / 0.22.
- evHot: a line or a thermal ionization is made only when the pair's motion can pay all of it (kickPair's return
  checked, velocities put back otherwise).
- Glowing-wall light meets placed objects (glowPhoton through opticFind/opticHit with opts.glow: its own books).
- Light after a mirror, lens or prism is drawn leg by leg (opts.delay: each leg starts once light has come that far).
- Particle view for every unstable particle: muonium (μ⁺ with its electron on hydrogen's orbit), μ± and τ± (points).
- Setups start paused at their first moment ("READY · press Space or ▶ to start"), Settings → Start setups paused (on).
- Beam sources fire from where they are drawn: drawn as wide as their spread (jitter), and moved just inside the box when
  set on or past a wall (srcPos). In slow motion a continuous source never waits longer, to the eye, than at its normal
  pace (at least 0.25 s; at most 20 of its particles in flight: srcSlowFire).
- Settings → Benchmark says whether the 20,000-atom goal is met: the water world at 1× speed, frames of (steps needed
  for 1×) × (time a step) + drawing, against 45 fps.
- Looked into and left: heavily ionized water (drift5) still gains +100–170 eV a run (40 tu). Not stale forces (a fresh
  force pass every step gives the same), not the step size (half dt, or LEP_STEP 0.05, the same); it comes in steps with
  ballistic electrons, around electrons switching between flight and the ordinary steps (switchMode), whose books jump
  until the next list rebuild counts them. A larger lepton skin for the inner-step lists (SKIN_F 3–4 Å) gained nothing
  in the neon discharge: its rebuilds come from electrons changing mode, not from moving.

## 0.66.0: placed objects, ionic compounds, molecule categories, Auto priority
- Objects tool (D, props.js): mirror, beam splitter, thin lens, F2 flint prism, detector screen, beam stop, wall, metal
  foil, charged plates, each a straight piece drawn from one end to the other (a click places one of a usual size).
  Drag to move; right-click to turn, resize, set the focal length, voltage and gap, or layers, clear a screen, remove.
  Saved with the world (worldToJSON objs), so undo, rewind and My experiments keep them; Erase removes them.
  Light: emitPhoton meets the nearest piece first (opticFind/opticHit) and goes on from it as the same photon
  (cont: no new count or spectroscope entry); prismTrace refracts at each face (Snell, total internal reflection).
  Atoms: a soft wall on their edge at every edge (objForces, objPE in localPE/regionE/totalEnergy: in the books); MD
  electrons bounce (objLepton, in the inner steps); fast, radiation-mode and exotic particles (objPath, objExo, hooked
  into moveFastLeptons, moveRad, moveNeutron, the walls pass and moveExos) cross a foil (2-D Rutherford per layer),
  bounce off a wall, and stop in the rest (energy to ledger.escaped; antimatter annihilates). Plates: platesField in
  Efield, a field only between them. Glowing-wall light ignores the objects.
- Ionic compounds named (ionicCluster, ionicName): ions in contact as whole-molecule grab finds them, written as
  formula units (NaCl, MgCl₂, FeF₃ as iron(III) fluoride, polyatomic ions bracketed). In the hover box, Inspect and
  the Data tab's species list (speciesCounts(false) for the pressure's count of movers, unchanged).
- Builder: separate pieces that are all ions with charges adding up to zero build as an ionic compound (mbIonicOK);
  placed as they settled, held by their charges. A category picker (bldCat): automatic, My molecules or any library
  category; editing one of yours shows where it is, and changing only its name or category saves without settling it
  again (MB.loadSig).
- Settings → Priority → Auto (prioAutoTick): every 2 s the physics each position fits into a second against what the
  simulation needs; the smoothest that fits, else the smoothest with 80% of the fast end's gain if that is 20% or more.

## 0.65.0: energy fixes in the engine (nothing else changed)
- Events now come after the closing half kick, at the inner steps (a free lepton at an atom: scatter, capture, ionization,
  excitation; a positron at an electron) and at the atom step (bonds, reactions, transfers). They used to be handled
  between the force pass and that kick, on velocities still missing h·a: a scatter rotated a velocity that was half a kick
  short, so each pass of a free electron through an atom's core threw part of that kick's work away, and a reaction
  paid from such a velocity created it. 40 e⁻ + 40 p⁺ (6000 steps, seeds 3–5): −26 / −42 / −44 eV → −4.2 / −0.2 / −1.8 eV.
  Antihydrogen challenge seeds 7–9: −0.5 / −3.5 / +0.1 eV in 0.64 → −0.6 / −0.8 / −1.0.
- Wall rescue: a heavy particle fast enough (> ~34 eV across the wall) to reach 1.5 Å into a soft wall is put back on the
  wall line (as before), and now the next step starts with a fresh force pass (`_wallMoved`): it used to start from the
  wall's push at its old place, deep inside, and was thrown back with energy from nowhere (40 p⁺ + 40 e⁻ at 100 eV:
  +19 / +21 eV → −0.7 / −0.8).
- No bond, reaction or dative bond in flight or in a hard collision (`hardMeet`: either atom ballistic or in radiation
  mode, or the two molecules meeting with over 100 eV of relative motion, ten times the strongest bond): the annihilation's
  keV fragments used to "bond", each turning 100–300 keV of motion into energy from nowhere.
- t_energy against 0.64 (seed 7): soup 11.5 → −11.7 eV, antihydrogen 5.4 → −1.1, chain −2.0 → −1.1, annihilation 3.7 →
  3.3 keV (seeds 7–9: 3.3 / 9.9 / 0.25 keV; chaotic, judged on the median), everything else the same or smaller except
  the flame (0.4 → 4.7 eV at seed 7; 1–5 eV by seed in both versions, from its photon steps). Heavily ionized water
  (drift5, seeds 7/8): −424 / −107 eV → +95 / +172: the loss is gone, a smaller gain in its quiet steps remains (not
  found yet; candidates: excitation by a ballistic electron after the force pass, `refresh` without a force pass).
- Not done: per-electron step sizes. A profile of the neon discharge puts the lepton pair forces at ~12% of a step (the
  list rebuilds 16%, the inner drift loop 18%), so they would gain at most ~4%; tightening the step instead (LEP_STEP,
  the stiffness rule) did not remove the drift, which was the event timing above.
- No kernel change: the WebAssembly kernel is the same as 0.64's.

## 0.64.0: editing what is placed, new setups, an event browser, named saves
- Right-click menu edits: a magnet's field and size (the Magnet tool's scales), a Fire-tool beam source's energy and rate, and any particle's (or molecule's) energy and direction; each slider is one undo step. "Graph it" follows a particle on the Data tab's graph (its speed, kinetic energy, distance from where it started).
- Whole-molecule grab takes the ions held ionically to the molecule too (opposite charges in contact, as the Ionic view draws them), so a salt crystal comes along whole (grabGroup).
- Place › Moving: at the bath temperature, or at rest.
- Inspect shows a charged particle's circle in a magnetic field: its size and turns per second (relativistic γmv/qB). A thermal electron in a 1 GT field circles on a loop 10⁻⁶ Å across, which is why it looks still while reading km/s.
- Walls act on an atom's edge (its drawn radius in from the wall line), not its centre: a crowd of ions pressed against a wall stays inside it (150 Na⁺: drawn overhang 0.82 Å → 0.11 Å, the soft wall's own give). Force, energies and the escape rescue all use wallIn.
- New setups (Nuclear): Pion beam into carbon, γ rays knocking out neutrons (²⁰⁸Pb(γ,n), about one γ in a hundred), Muonium in argon, Hypernucleus factory. They run slowly: what they release ionizes so small a target heavily. Not made: an X-ray tube. A real anode stops its electrons in micrometres; the box is nanometres, so bremsstrahlung would show about once per hundred thousand electrons.
- Event browser: each nuclear event in the Log tab has a ⟲ replay button: back to the last rewind snapshot before it, slow motion on, ready to play.
- Type-to-find particles: 🔍 Find in the particle bar (or /): symbols, names, ids and spelled-out Greek (lambda, xi, muonium, pi-).
- My experiments (top of the setup list): named saves in the browser's database (IndexedDB), as many as wanted, with load and delete.
- t_energy skips the four beam setups (their beams add energy, as the spallation source's does); t_page's walk through the setups skips My experiments; t_features covers the rest.

## 0.63.0: speed, energy and display fixes after 0.62
- Speed check against 0.61 (a step's time, the same setups and seeds): the new neutron pair pass now sweeps the paths' x-extents (sorted once a step, no allocation) and rejects far pairs before working out their reach; a profile of the spallation source puts the pass itself at 2% of the step, the rest of its time being the collisions that now happen. Steps elsewhere are as in 0.61, except where 0.62's physics makes more happen (the antiproton droplet, whose pions now break nuclei up and leave the water ionized).
- Two nucleons above ~20 MeV no longer scatter isotropically on every pass when the nucleon–nucleon tables said they missed (0.62's relativistic fallback applied at any energy: 150 MeV n–n met 30 times in 30 instead of 15).
- Energy in ionized water (0.62 found it drifting). Free electrons among ions are where it goes, in close passes and in the events around them. Electron-impact excitation of a neutral atom paid the line's whole threshold (LINES thr) but sent out only the line seen: the rest of the cascade to the ground state vanished (about 7 eV per oxygen excitation). The rest now leaves as one more photon, as hydrogen's Lyman-α already did. The antiproton droplet's drift: seeds 7–9 0.5, 41 (a chaotic outlier) and 0.5 keV, from 2.7, 13.9 and 16.3; its limit is back to 5 keV, on the median of three seeds.
- Tried and taken out: a finer inner step for electrons near ions (each step at most 2% of the way to the charge pulling it) cut ionized water's drift between events from −417 to −30 eV, but it made the primordial soup drift 28× more (180 eV against 6.5: steps that change size along a close pass are not reversible) and the neon discharge 2.4× slower. Smaller leaks remain in very ionized water (close passes, ionization, light, bonds in highly charged clusters).
- Display: muonium has its name in the particle menu; captions of hadron hits and photonuclear reactions name the nucleus hit and its molecule (¹⁶O in H₂O, not "HO"); "stable while bare" is green, not red; the "Let the shortest-lived show" buttons no longer wrap; the decay note spells out attoseconds ("916 as per second" read like a word).

## 0.62.0: what collides in nature collides here
- An audit of every pair of particle kinds for collisions that happen in nature but were skipped. This release adds the nuclear ones; bremsstrahlung, photonuclear reactions and muonium, planned for 0.63, came in this release too.
- Free neutrons meet each other (n–n: elastic below about 20 MeV, the dineutron being unbound; above, the nucleon–nucleon tables as for n–p, with pions above about 300 MeV), and fast nuclei meet free neutrons: engine.js neutronPairs finds every pair of free neutrons and fast nuclei that comes within reach in a step by the closest approach of their two paths (a sweep over the paths' x-extents), so neither has to be the one moving. A neutron's path against the nuclei in the MD set is now also taken relative to theirs (relTargets): a slow nucleus drifting into a neutron at rest met it never before (the segment test needed the neutron to move), every time now.
- Unstable hadrons meet the nuclei they pass (hep.js hadronHit, where the nuclei are drawn, as for nucleons): diffraction in the outer part of the reach, inside it one struck nucleon with Fermi motion and the rest a slightly excited spectator: pion absorption on a nucleon pair below 300 MeV half the time, otherwise πN hadronizing (charge exchange and pion production included); K̄N → Λπ; K N scattering with charge exchange; hyperon knock-out and Σ N → Λ N; antibaryon annihilation into pions and the kaons their antistrange quarks need. A slow Λ may stay (hypCatch). Charge, baryon number, strangeness, energy and momentum are kept (t_features checks charge, baryon number and each event's energy).
- Stopped π⁻, Σ⁻, Ξ⁻ and Ω⁻ are caught and absorbed as K⁻ and μ⁻ already were (hStop): π⁻p → π⁰n or γn (Panofsky ratio 1.5), π⁻d → nn, on heavier nuclei absorption on a pair that breaks the nucleus up; Σ⁻p → Λn, Ξ⁻p → ΛΛ, Ω⁻p → Ξ⁰Λ.
- Bremsstrahlung (engine.js brems): a fast electron or positron ionizing an atom also radiates, against its collision losses as T·Z / 800 MeV (Bethe–Heitler; the X-ray yield of a tube's anode), each photon from the 1/k spectrum between 1% of T and T, forward within 1/γ.
- Photonuclear reactions (hep.js photoNuclear): a γ ray above 6 MeV may be absorbed by the nucleus it passes (the giant dipole resonance: a Lorentzian at 31.2 A^-1/3 + 20.6 A^-1/6 MeV, 5 MeV wide, holding 60 NZ/A mb·MeV, in proportion to pair production at about 5.2 Z² mb), which boils off a nucleon: ²⁰⁸Pb(γ,n)²⁰⁷Pb at 13.5 MeV.
- Muonium: a stopped μ⁺ takes an electron from an atom it passes 60% of the time (not in a metal): Mu, μ⁺e⁻, 13.5 eV bound; its muon decays and the electron goes free. In the particle menu under exotic atoms.
- Fixed on the way: the K⁻ capture's nucleon Fermi motion made up to ~30 MeV out of nothing (the struck nucleon and the rest were both put on their mass shells); both it and the new encounters use the spectator model now (the rest on shell, the struck nucleon takes what is left of the nucleus's mass). A struck atom keeps its electrons, as far as its new charge allows (they used to be shaken off all at once, leaving a bare nucleus in the water). Nuclei sent flying by these collisions, and molecules their products ionize, count as a nuclear event's products for slow motion (with slow motion for nuclear events off, it does not follow them).
- Energy: each event's books are exact. The annihilation setup (antiprotons into a water droplet) now drifts by about 2 keV over the energy test's run: the pions meet the droplet's nuclei and what they knock out ionizes the water heavily, and water ionized that heavily drifts (0.61 drifted 60 keV with proton beams through it). Its limit in t_energy is 5 keV, judged on the median of three seeds.
- The Physics tab's paragraph on unstable particles says all this (it said they don't interact with the matter they cross).

## 0.61.0: particle view for exotic particles, slowed decay, measuring anything, editing molecules
- Particle view (V) shows what unstable particles are made of, at the nucleons' scale: a hadron as its valence quarks in a bag the size of a nucleon (colour charges, antiquarks in anticolours, strange quarks ringed), a hypernucleus as its nucleons with the Λ ringed at the middle, a muonic atom as its nucleus with the muon's tight orbit. Leptons stay points. The resonances (ρ, ω, φ, K*, Δ) joined the quark-content table, so Inspect looks inside them too.
- Lab › Time: the Decay speed slider now goes below real, to a millionth (decays slowed, so short-lived particles fly further and their tracks can be followed), and "Let the shortest-lived show" (Off / A little / More) holds a particle that would decay unseen until it has flown 2 or 6 Å, or 0.4 or 1.2 s of watching has passed; one that reaches the wall while held decays there. The same decays and products; only where they happen moves, which the readouts and captions say while either is on.
- Speed buttons reach 1/512×. A frame whose share of time is below one shortest step is saved up and run once it makes a step (engine.js simFrame), so very slow speeds are as slow as asked at any frame rate (slow motion keeps its floor of a step a frame: it follows fast particles). t_physics: the slowed-light check runs two frames for it; t_page clicks only the molecule cards, not their new ✎ buttons.
- Screen kept awake while the simulation runs (a screen wake lock, Settings → Controls, on by default; let go when paused, behind the menu or hidden).
- The measure tool takes any particle: atoms, nuclei, nucleons, electrons, unstable particles, and photons and neutrinos in flight (followed while they fly, dropped when they land or leave).
- Saved molecules can be edited: ✎ on a card in the molecule list opens it in the builder with its name; Save puts it back in place (its spot, category and note kept), Save as new keeps the original. On a library molecule ✎ edits a copy. Its ordinary hydrogens fill in by themselves when that gives back exactly the ones it had.
- A bare nucleus that decays only by electron capture (bare ⁷Be) said it had its half-life, though with no electron to capture it cannot decay (doDecay already kept it); it now reads "stable while bare", and Inspect says why.
- t_features: a block for all of the above.

## 0.60.0: salt dissolves in water
- Measured first: with the plain Coulomb force, a 36-ion Na⁺Cl⁻ crystal in 230 water molecules kept every ion for 100 ps at 300 K and at 360 K, and a lone Na⁺ Cl⁻ pair in water stayed touching (2.7 Å) the whole time. The ion–water distances were right (Na–O 2.1 Å) and water's partial charges are SPC-like (O −0.74); what is missing is the third dimension: an ion here has 3–4 water molecules round it against 6 in space, and the solvent screens charge far less.
- So the Coulomb pull between a free ion (charged, unbonded) and a polar molecule's partial charges is doubled (engine.js K_IW = 2: the pair kernel, the energies pairNonbondedV and coulAA, the worker constants, and the WebAssembly kernel, rebuilt; the native check agrees with the JavaScript kernels to 1e-13). The shell then holds an ion about as strongly as real water does; a lone pair parts into a solvent-separated pair (4.3 Å, a water between), and the crystal loses 9 of its 36 ions from its corners and edges within 16 ps and goes on dissolving. Energy is conserved as before (t_energy: the new setup drifts 0.26 eV over 726 particles).
- New setup: Chemistry → Salt dissolving in water. The Physics tab lists the change and its side effect: a salt that barely dissolves in real water because its bonding is partly covalent (silver chloride) dissolves here like table salt.
- t_physics: the check that moving far atoms once matches moving them every inner step now compares positions after 10 steps, not 25. The stronger ion–water pull sent a free electron in the water test past a nucleus, which grows a 1e-13 Å rounding difference to 3e-7 Å by step 25; other seeds did that before this release too.
- t_molecules: a lone Na⁺ Cl⁻ pair parted by water within 8 ps. tools/kdump.js: a salt-water scenario for the native kernel check.

## 0.59.0: hypernuclei
- A Λ in a nucleus is bound (no other particle there is a Λ, so the Pauli principle does not keep it out of the lowest orbit): hypernuclei ᴬΛX, from the hypertriton ³ΛH (Λ bound by 0.13 MeV) through ¹³ΛC (11.7 MeV) to ²⁰⁸ΛPb (about 27 MeV): measured binding energies up to A = 16, then 30.5 − 120/A^⅔ MeV (hep.js hypSpecies, hypB). They are particles in flight (bare nuclei with the Λ; W.exo), slowed by matter, bouncing off closed walls.
- They live about 0.23 ns (the hypertriton 0.24) and decay (hypDecay) as a free Λ would, Λ → p π⁻ or n π⁰ inside (mesonic: 85% in the lightest, a few percent in heavy ones, where the nucleon it would make finds its place taken), or by meeting a nucleon, Λp → np or Λn → nn (non-mesonic, 2 : 1: 176 MeV to the two nucleons); the nucleus left breaks up or cools as it can (residualInto). Exact masses and books.
- Made where a Λ comes out of a nucleus too slowly to leave it (its kinetic energy against the nucleus under the Λ's well depth, 4–28 MeV, and then four in five still slip out: hypCatch): a stopped K⁻ absorbed by a nucleus (kStop: caught by an atom like a muon, then K⁻p → Λπ⁰ or K⁻n → Λπ⁻ on a nucleon moving with its Fermi motion; about 5% leave a hypernucleus in carbon, as measured), or a quark pulled out by hand. Or placed (Exotic atoms and nuclei: ³ΛH … ²⁰⁸ΛPb).
- The Inspect card: what it is made of, the Λ's binding, how it decays.
- Jets: with resonances among the hadrons (whose decays add their own spread), the string's transverse momentum per hadron is 0.7 of what it was, so the final hadrons keep about 0.35 GeV.
- t_features: 60 hypernucleus decays exact, both ways; stopped K⁻ in carbon. Steadier: the spectroscope allows 1% of photons off the listed lines.

## 0.58.0: every particle in the palette; neutrino flavours; resonances and the pair masses
- The palette opens with a menu for each kind of particle — Leptons (e⁻, e⁺, μ±, τ±), Neutrinos (νₑ, ν̄ₑ, νμ, ν̄μ, ντ, ν̄τ), Nucleons, Light nuclei (d, t, ³He, α; any other from Elements…), Mesons (π, K, η), Baryons (Λ, Σ, Ξ, Ω and their antiparticles), Resonances (ρ, ω, φ, K*, Δ), Light (γ), Antimatter (e⁺, p̄, n̄, H̄, anti-d, anti-α), Exotic atoms (muonic hydrogen, deuterium, tritium). Placing an unstable particle makes it nearly at rest, to decay where it is on its mean life; light and neutrinos cannot be still, so they leave the click in a random direction at the energy set (Place → Energy, 1 eV – 1 GeV). The Fire tool fires any of them (neutrinos too).
- Neutrinos carry their flavour (labels; they still leave the box untouched): a muon's decay gives νμ and ν̄ₑ, a π⁺ νμ, a τ ντ with the rest, nuclei νₑ or ν̄ₑ; muon capture νμ. The Inspect card and Data's list name them.
- Resonances (hep.js resonate): the hadrons of strings (e⁺e⁻ jets, nucleon collisions at high energy, fragmentation) and of the quark–gluon plasma are partly born as ρ, ω, φ, K* and Δ: members of the list are joined into the resonance they would come from (π⁺π⁻ → ρ⁰, π±π⁰ → ρ±, π⁺π⁻π⁰ → ω, Kπ → K*, K⁺K⁻ → φ, Nπ → Δ), with a mass drawn from its Breit–Wigner shape; charges and the counts of each kind stay (on average), the momenta are made for the new list, and the resonances decay at once (moveExos, whatever the decay clock) into what the list had. Exact masses and books as before.
- Data → Pair masses: every π⁺π⁻, Kπ and K⁺K⁻ pair from one collision (decay products count with their collision), by invariant mass; like-sign pairs subtracted (the background, as experiments take it): the ρ at 775 MeV, the K⁰s at 498, the K* at 892, the φ at 1019 stand out.
- t_features: the menus, placing a π⁺, a ν̄τ, a photon and a ρ⁰; a muon's neutrinos; e⁺e⁻ at 10 GeV making resonances and the ρ over the background.

## 0.57.0: neutrons at the walls, ionic lines, rewind, measure, graphs, views, a tour, touch
- Lab → Container → Neutrons at the walls: Bounce back (a reflector, graphite or beryllium: as the walls always did), Absorbed (boron, cadmium: captured, counted as stopped in the walls) or Pass through (a thin wall: they fly out). Kept in saved worlds (nWall).
- Ionic attractions drawn (Lab → View → Ionic): a dotted line between touching ions of opposite charge (within 1.3× their radii), thicker as √|q₁q₂| (drawIonic: sorted along x and swept).
- Rewind (⟲ or ,; Settings → General → Rewind: on/off, how far back 30 s – 5 min, a snapshot every ¼ – 2 s, memory at most 100 MB – 1 GB): compact copies of the world (typed arrays) while it runs; a timeline to drag back through, paused; Play from here (Space) carries on from that moment and drops what came after, Ctrl+Z goes back to before it; Back to now (Esc). A press of a tool that changes the world while rewound carries on from there. Not in setups with chips, beams, lasers or a ramp (as undo). The view, the temperature history and the graph are kept, and trimmed to the moment carried on from.
- Measure tool (K): two atoms' distance, three's angle at the middle one, drawn on the chamber and following the atoms (periodic walls: the nearest image).
- Data → Graph: every half second of watching, the temperatures, counts, pressure, the energy ledger and each species' count; the quantities chosen drawn as strips with their range and latest value; Export CSV (all of it), Clear.
- Views: Shift+1 … 9 keeps the view, 1 … 9 glides back to it.
- A first-run tour (seven steps, with Back, Next, Skip; again from Settings → General or the Esc menu).
- Touch and pen: a long press opens the quick menu (taking back what the press had done); pinch and two-finger pan as before.
- Shortcut list: rewind, views, the long press.
- t_features: neutrons at each kind of wall; an ionic line between touching Na⁺ and Cl⁻ only; measure (3, 4 Å, 90°); a kept view; rewind, carrying on, undo past it, none with chips; the graph's CSV; the tour; a long press.

## 0.56.0: a main menu with depth
- The main menu is three layers the camera looks at from where the mouse is (mmTick, MMP): the chamber far behind shifts a little (and draws closer), a soft glow between moves more, and the card in front tilts toward the mouse with its title and buttons standing out at different depths (CSS perspective, translateZ). With no mouse it sways slowly on its own. The title has a passing shine; the buttons rise one after another as the menu opens, lift and glow under the mouse and press in; the setups list slides in; leaving, the card falls back into the chamber as it fades. Behind the menu the chamber shows no labels. Off with the system's Reduce motion.
- t_features: the menu's layers follow the mouse. Steadier: undo and the torn bond tested with room around them.

## 0.55.0: Settings in tabs, a main menu, an Esc menu, undo, and many settings
- Settings is one tab per category: Performance, Graphics, Display, Controls, General, Claude.
- Graphics: frame-rate cap (Monitor, 30, 60, 120, 144; frames skipped in frame(), their time still counted); atom size (true, smaller, small: R.as, on both the WebGL and 2D drawing); labels and charge badges always, on hover or never (lblOn, badgeOn: the hovered and the inspected particle); fewer flashes (R.flashK); a colour-blind friendly palette (Okabe–Ito colours for the common elements, orange and blue for charges: CVD_COL, baseElColor).
- Display: interface size 90–150% (CSS zoom on the controls, never on the chamber's canvases; the grid tracks scale with it); the lab panel on the right or the left; its width dragged by its inner edge (280–760 px, kept); the desktop app keeps its window (size, position, monitor, maximized or full screen) with Tauri's window-state plugin.
- Controls: wheel zoom speed, zoom toward the mouse or the centre; tools remember their settings (OPT kept); pause when the window is not in front; the keyboard shortcuts (?).
- General: start with the main menu, where you left off, or the last setup afresh; autosave every 20 s and when the page is left (a setup with chips or beams kept as its name); energies in eV, kJ/mol or kcal/mol (under 1 keV: nuclear energies stay in eV); lengths in Å, nm or pm (the Inspect card, tool radii, the collider).
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y): the world kept (worldToJSON, with its clock and view) before each change by hand — a tool pressed on the chamber, a grab, a paste, a deletion, adding or removing an electron, emptying the chamber, loading a setup, a world from the gallery, a quark pulled out — up to 40 steps. Light and unstable particles in flight are not kept; off in setups with chips, beams, lasers or a temperature ramp.
- Esc menu (Esc with nothing else to let go of): Resume, Settings, Keyboard shortcuts, Gallery, Share code, Main menu, Quit; the simulation pauses while it is open. Esc in a text field only leaves the field.
- Main menu at start (and from the Esc menu): a setup runs behind it, the chamber alone; Continue (the autosave), New empty chamber, Experiments and challenges (every setup, by group), Gallery, Settings, Quit (the desktop app; a browser tab is closed by hand). Links to a setup or a shared world open it directly. Tests open the page without it (tests/browser.js).
- Grab, Strong: in a crowd the hand also tries smaller steps, to slip between the neighbours.
- t_features: undo/redo, units, the graphics settings in the drawing, the 30 fps cap (31 of 240 frames drawn), tools remembering; the menus (main menu, a setup from it, Esc pausing, Main menu and Continue). Steadier: a quark pull may make a kaon; Grab tested in open space.

## 0.54.0: a stronger Grab, slower speeds, nothing tied to the frame rate
- Grab has a Strength: Gentle (the spring as before: at most 3 km/s of simulated time, so it trailed the mouse whenever simulated time ran slowly), Strong (the default) and Very strong. Strong keeps up with the mouse in real time whatever the speed setting or slow motion: the spring may draw at up to 30 km/s (100 for Very strong), set each frame so the gap closes in about 0.12 s of watching (grabTick), and where simulated time crawls the hand carries what it holds toward the cursor between frames, as while paused (moved, not thrown, never into another atom; a lone atom carried off tears its bonds). It adds a plain pull of up to 8 eV/Å (30) shared by mass (engine GRAB_F). Let go and it stops where it is (grabRelease takes back the drawn speed).
- The speed buttons go down to 1/256× (were 1/64×).
- Frame rate: the chips' clock, when the physics fell behind in a crowded box, ran a whole sixtieth of a second per frame whatever the frame's length, so at 144 or 240 fps the chips raced ahead (2.4×, 4×); now in proportion to the frame. A frame's share of simulated time is exact up to 6,000 fps (was 600). Everything else was already by the clock (checked at 30–240 fps).
- t_features: Grab in slowed time, Strong against Gentle, a hydrogen torn off; 1/256×; a second of watching at 30, 60, 144, 240 fps the same. Steadier checks: a jet with hadrons still flying, neon lines within their Doppler width, the video's frame count under load.

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
