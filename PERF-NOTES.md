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
- Next (the user: "start 3D once you've completed the quantum thing"): a 3-D mode, as a separate mode chosen in the main menu rather than a setting: the
  ordinary game stays flat (a 2-D "locker"), and the 3-D mode gives full 3-D. Kept apart because 3-D would slow the
  game (a cube as wide as today's box holds about 50 times the atoms, each with 2–3 times the neighbours) and touch
  everything: the engine, walls, drawing, every tool, picking in depth, the flattened molecule library, the chips.
- Continuous bond orders for more elements (asked by the user after 1.21, "can you add the rest?"): today H, B, C, N,
  O, F, Si, P, S, Cl, Br, I. The covalent p-block left (Ge, As, Se, Sn, Sb, Te) fits the same model: the game's bond
  table already has measured energies for them; each needs its valence, angle targets (periods 4–5), electronegativity
  and size checked, and the molecules relaxed and compared with stored bonds as for the first twelve. Not metals
  (their electrons are shared through the whole metal, not bond by bond with a fixed valence: the game keeps its
  metallic cohesion for them; a metal bond-order model, embedded-atom style, would be a separate project), not ionic
  pairs (charges already), not the noble gases. A physics-model change for the owner to approve. Every element up to
  Rn is in quantum bonds (1.22) for small systems.
- Bond orders for metals (asked by the user after 1.21, to come after 3-D): a many-body metal model in which a metal
  atom's bonding comes from its surroundings rather than from whole bonds with a fixed valence: the embedded-atom form
  (Daw & Baskes 1984; each atom's energy a function of the electron density its neighbours give it), or the
  second-moment tight-binding form (Finnis–Sinclair, Cleri–Rosato), fitted per metal to measured cohesive energy,
  lattice constant, elastic constants and vacancy energy; metal–non-metal pairs (oxides, hydrides, complexes) the hard
  part. Would replace the game's metallic cohesion for member metals, so surfaces, clusters, melting and alloys come out
  of one model. Several sessions; a physics-model change for the owner to approve.
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
