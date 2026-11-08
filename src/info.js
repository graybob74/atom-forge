'use strict';
/* Info (1.28.1, the owner: "a little info button at the bottom when you click on an element, with info from the web"
   and "the same for most particles", "pretty short, and a Read more button that is a wiki link"). A sentence or two
   for each element and each kind of particle, written for the game from well-established facts (the kind any
   encyclopedia gives: where it is found, what it is used for, how it was found), and the English Wikipedia article
   for more. EL_INFO by atomic number; P_INFO by a particle key (infoKeyX for the unstable particles of W.exo).
   infoHTML(text, wiki) makes the box; infoLink opens a Read more link (the desktop app: the shell's open_wiki, in the
   player's browser; the page: a new tab). */
const EL_INFO = [null,
  'The lightest and most common element, three quarters of the ordinary matter in the universe. Stars shine by fusing it into helium; on Earth most of it is bound in water.',
  'Made in the Big Bang and in stars, yet rare on Earth because it escapes into space. Found first in the Sun’s spectrum (1868); liquid helium cools MRI magnets.',
  'The lightest metal, soft enough to cut with a knife. It powers rechargeable lithium-ion batteries, and its salts treat bipolar disorder.',
  'A light, stiff metal that is toxic as dust. Transparent to X-rays, it makes X-ray tube windows, and with copper it makes spark-free tools.',
  'A metalloid found in borax. Borosilicate glass resists heat shock, boron carbide is among the hardest materials, and boron-10 soaks up neutrons in reactors.',
  'The basis of all known life, with more compounds than any other element. Pure carbon is graphite, diamond, graphene or fullerenes, depending on how its atoms bond.',
  'Four fifths of the air, as unreactive N₂. Fixed into ammonia by the Haber–Bosch process, it fertilizes the crops that feed half the world.',
  'A fifth of the air, made by photosynthesis, and the most common element in Earth’s crust. Animals burn food with it; ozone (O₃) high up shields us from ultraviolet light.',
  'The most reactive element and the most electronegative. Fluoride in toothpaste hardens teeth; it is also in Teflon and in uranium hexafluoride for enrichment.',
  'A noble gas that glows red-orange in a discharge, the light of neon signs. Inert: it forms no stable compounds.',
  'A soft metal that reacts violently with water. Common salt is sodium chloride; sodium ions carry nerve signals, and sodium vapour lamps light streets yellow.',
  'A light metal that burns with a dazzling white flame. At the centre of chlorophyll, it is used in light alloys for cars and aircraft.',
  'The most common metal in Earth’s crust. Light and protected by a thin oxide skin, it is used for cans, foil, window frames and aircraft.',
  'The second most common element in the crust, in sand and rock as silica. Purified, it is the semiconductor of computer chips and solar cells.',
  'Found as white and red phosphorus. Essential to life in DNA, ATP and bones; used in fertilizers and matches. White phosphorus glows in air.',
  'A yellow solid known since antiquity as brimstone. It is in proteins, and most of it goes to make sulfuric acid, the most-produced industrial chemical.',
  'A yellow-green toxic gas. In table salt as chloride; it disinfects drinking water and pools and goes into PVC plastic.',
  'The third most common gas in the air (about 1%), an inert noble gas. It shields welding and fills incandescent bulbs.',
  'A soft metal that reacts vigorously with water. Essential for nerves and plants (potash fertilizer); bananas are rich in it, and a trace of it is radioactive potassium-40.',
  'A metal essential to bones, teeth and shells. Limestone, marble and chalk are calcium carbonate; cement and plaster are calcium compounds.',
  'A light, rare transition metal. A little of it strengthens aluminium alloys for bicycle frames and aircraft parts.',
  'Strong, light and corrosion-resistant. Used in aircraft, implants and jewellery; its dioxide is the white pigment in paint, paper and sunscreen.',
  'A hard transition metal that toughens steel for tools and springs. Its ions take many colours, and vanadium flow batteries store grid energy.',
  'A hard, shiny metal: chrome plating, and the ingredient that makes steel stainless. Its compounds give rubies and emeralds their colours.',
  'Essential in steelmaking, where it removes sulfur and oxygen. Its dioxide is in ordinary batteries; enzymes use it, including the one that splits water in photosynthesis.',
  'The most used metal and the main part of Earth’s core. Made into steel with a little carbon; in haemoglobin it carries oxygen in blood.',
  'A hard magnetic metal. Its blue compounds have coloured glass for millennia; it is in battery cathodes and superalloys, and at the heart of vitamin B12.',
  'A corrosion-resistant magnetic metal used in stainless steel, coins and plating. Earth’s core is iron with a good share of nickel.',
  'A reddish metal, one of the first used by humans. An excellent conductor, it carries most electricity in wires; with tin it makes bronze, with zinc brass.',
  'A bluish-grey metal that protects steel from rust by galvanizing. Essential for many enzymes; with copper it makes brass.',
  'A soft metal that melts in the hand (30 °C). Its compounds GaAs and GaN make LEDs, laser diodes and fast electronics.',
  'A metalloid semiconductor, the material of the first transistors (1947). Today it is in fibre optics and infrared lenses.',
  'A metalloid famous as a poison. Used in semiconductors (gallium arsenide), and long used to preserve wood.',
  'A nonmetal whose conductivity rises in light, once used in photocopiers. A trace element needed by the body; used in glass and solar cells.',
  'One of only two elements liquid at room temperature, a red-brown fuming liquid. Used in flame retardants; its name means stench.',
  'A noble gas, rare in the air. Used in some lighting and lasers; krypton-86 once defined the metre.',
  'A very reactive soft metal that ignites in air. Its atoms are cooled to make Bose–Einstein condensates and run atomic clocks.',
  'A soft metal whose salts colour fireworks bright red. Strontium-90, a fission product, settles in bones; strontium aluminate glows in the dark.',
  'A transition metal in red phosphors of old TV screens, in YAG lasers and in high-temperature superconductors (YBCO).',
  'Corrosion-resistant and nearly transparent to neutrons, so it clads nuclear fuel rods. Cubic zirconia is a diamond substitute.',
  'A metal that strengthens steel for pipelines and jet engines. Niobium–titanium wire makes superconducting magnets, as at the LHC and in MRI scanners.',
  'A metal with a very high melting point that strengthens steel. Essential to enzymes that fix nitrogen in bacteria.',
  'The lightest element with no stable isotope: every atom is radioactive. Technetium-99m is the most used medical imaging isotope.',
  'A rare platinum-group metal that hardens platinum and palladium. Used in hard-disk platters and as a catalyst.',
  'A rare, costly platinum-group metal. Most goes into catalytic converters; it plates mirrors and jewellery for shine.',
  'A platinum-group metal used in catalytic converters and electronics. It soaks up hydrogen, up to 900 times its volume.',
  'The best conductor of electricity and heat of all metals. Used in jewellery, coins, mirrors and electronics; silver halides made photography possible.',
  'A soft toxic metal used in nickel–cadmium batteries and pigments. Cadmium rods absorb neutrons to control reactors.',
  'A soft metal; indium tin oxide is the transparent conductor in touchscreens and flat displays.',
  'A soft, silvery metal that resists corrosion. With copper it made bronze; it coats tin cans (tinplate) and solder.',
  'A metalloid known since ancient times (kohl eyeliner). Used in flame retardants and to harden lead in batteries.',
  'A rare metalloid. Cadmium telluride makes thin-film solar cells; tellurium compounds give breath a garlic smell.',
  'A violet-black solid that sublimes to a purple vapour. The thyroid needs it, so salt is iodized; it disinfects wounds.',
  'A heavy noble gas that does form compounds. Used in bright car headlamps, ion thrusters on spacecraft and as an anaesthetic.',
  'The most reactive metal, liquid just above room temperature (28 °C). Caesium atomic clocks define the second.',
  'A soft metal whose salts colour fireworks green. Barium sulfate, swallowed, shows the gut on X-rays.',
  'The first of the lanthanides. Used in camera lenses and in hydrogen-storage alloys of hybrid-car batteries.',
  'The most common rare-earth element. Its oxide polishes glass, and it is in catalytic converters and lighter flints.',
  'A rare-earth metal used with neodymium in strong magnets and to colour glass yellow-green.',
  'A rare-earth metal whose magnets (NdFeB) are the strongest permanent magnets, in electric motors, wind turbines and headphones.',
  'A rare earth with no stable isotope; it is radioactive. Once used in luminous paint and in nuclear batteries.',
  'A rare-earth metal; samarium–cobalt magnets keep their strength at high temperature.',
  'A rare-earth metal whose compounds glow red and blue in screens, LED lights and the anti-forgery marks on euro banknotes.',
  'A rare-earth metal that absorbs neutrons strongly. Its compounds brighten MRI scans as contrast agents.',
  'A rare-earth metal used in green phosphors and in Terfenol-D, an alloy that changes shape in a magnetic field.',
  'A rare-earth metal added to neodymium magnets to keep them working hot, as in electric car motors.',
  'A rare-earth metal with the highest magnetic strength of any element; used in magnet pole pieces and lasers.',
  'A rare-earth metal that colours glass pink and amplifies signals in fibre-optic cables.',
  'One of the rarest rare earths. Used in portable X-ray sources and some lasers.',
  'A rare-earth metal; ytterbium atomic clocks are among the most precise ever built.',
  'The last of the lanthanides. Used in catalysts for oil refining and in PET scan detectors.',
  'A metal that absorbs neutrons, used in reactor control rods, and in the chips of modern processors as hafnium oxide.',
  'Very corrosion-resistant; tantalum capacitors are in almost every phone, and it is used in surgical implants.',
  'The metal with the highest melting point (3,422 °C). Incandescent bulb filaments; tungsten carbide makes cutting tools.',
  'One of the rarest elements in Earth’s crust, with a very high melting point. Used in jet engine superalloys.',
  'The densest element, about twice as dense as lead. Very hard; its tetroxide is toxic. Used in fountain pen tips.',
  'The most corrosion-resistant metal, and very dense. An iridium-rich clay layer marks the asteroid impact that ended the dinosaurs.',
  'A precious metal, unreactive and catalytic. In catalytic converters, lab ware, jewellery and anticancer drugs.',
  'A soft, unreactive yellow metal prized since prehistory. Used in jewellery, money and electronics; it does not tarnish.',
  'The only metal liquid at room temperature. Once used in thermometers and barometers; it and its compounds are toxic.',
  'A soft, very toxic metal, once a rat poison. Thallium-201 is used in heart scans.',
  'A soft, dense metal, easy to shape, used since antiquity. In car batteries and radiation shielding; toxic, so out of paint and petrol.',
  'The heaviest element with a nearly stable isotope (its half-life is far longer than the universe’s age). Used in low-melting alloys and stomach medicine.',
  'A rare, intensely radioactive element found by Marie and Pierre Curie (1898). Polonium-210 is a deadly poison.',
  'The rarest natural element: less than a gram exists in Earth’s crust at any moment. Astatine-211 is studied for cancer therapy.',
  'A radioactive noble gas seeping from uranium in rocks; in basements it is a leading cause of lung cancer after smoking.',
  'A radioactive alkali metal whose longest-lived isotope lasts only 22 minutes, so just a few tens of grams exist in Earth’s crust at any moment.',
  'A radioactive metal found by the Curies. It glows faintly; once in luminous watch dials, until its dangers became clear.',
  'An intensely radioactive metal that glows blue in the dark. Actinium-225 is used to target cancers.',
  'A weakly radioactive metal, about three times as common as uranium. Proposed as fuel for future reactors.',
  'A rare radioactive metal, one of the scarcest natural elements, formed in the decay of uranium-235.',
  'A dense, weakly radioactive metal. Uranium-235 splits in a chain reaction, the fuel of nuclear reactors and the first atomic bomb.',
  'The first element beyond uranium, made in 1940. Neptunium-237 is a long-lived part of spent nuclear fuel.',
  'Made in reactors from uranium. Plutonium-239 fuels reactors and weapons; plutonium-238 powers spacecraft such as Voyager.',
  'A synthetic element; americium-241 is the tiny radioactive source in household smoke detectors.',
  'A synthetic element named after Marie and Pierre Curie; curium-244 powers instruments on Mars rovers.',
  'A synthetic element first made in Berkeley in 1949, used mainly to make heavier elements.',
  'A synthetic element; californium-252 is a strong neutron source, used to start reactors and to find gold and oil.',
  'First found in the debris of the first hydrogen bomb test (1952), named after Albert Einstein.',
  'Also found in hydrogen-bomb debris, named after Enrico Fermi. The heaviest element that can be made by neutron capture.',
  'Named after Dmitri Mendeleev, who devised the periodic table; first made one atom at a time.',
  'A synthetic element named after Alfred Nobel; its half-lives are minutes or less.',
  'The last of the actinides, named after Ernest Lawrence, inventor of the cyclotron.',
  'The first superheavy element, named after Ernest Rutherford; made only atom by atom in accelerators.',
  'A superheavy element named after Dubna, the Russian town of the Joint Institute for Nuclear Research.',
  'Named after Glenn Seaborg, who found ten elements; he was alive when it was named.',
  'A superheavy element named after Niels Bohr; only a handful of atoms have ever been made.',
  'Named after the German state of Hesse, where it was first made in 1984; it may be chemically like osmium.',
  'Named after Lise Meitner, who explained nuclear fission; its atoms last seconds or less.',
  'Named after Darmstadt, Germany, where it was first made in 1994; its atoms last seconds.',
  'Named after Wilhelm Röntgen, discoverer of X-rays; predicted to be a heavy cousin of gold.',
  'Named after Nicolaus Copernicus. Relativistic effects may make it a volatile metal, perhaps even a gas or liquid.',
  'The first element found in Asia (Japan, 2004), named after Nihon, the Japanese name for Japan.',
  'Named after the Flerov laboratory in Dubna; its chemistry may be surprisingly inert for a metal.',
  'Named after the Moscow region; first made in 2003 by bombarding americium with calcium.',
  'Named after the Lawrence Livermore National Laboratory, a partner in its discovery.',
  'The second-heaviest element, named after Tennessee, home of Oak Ridge, which made the berkelium target.',
  'The heaviest element known (118), named after Yuri Oganessian. A noble gas on paper, but predicted to be a solid.',
];
const EL_WIKI = { 80: 'Mercury_(element)' };
function elWiki(Z) { return EL_WIKI[Z] || (ELEMENTS[Z] ? ELEMENTS[Z].name : ''); }
const P_INFO = {
  'e-': ['The lightest charged particle, carrying the negative charge of every atom. Discovered by J. J. Thomson in 1897; its flow is electric current.', 'Electron'],
  'e+': ['The electron’s antiparticle, with the same mass and the opposite charge. Predicted by Dirac and found in cosmic rays in 1932; PET scans image its annihilation.', 'Positron'],
  p: ['The positive particle in every nucleus, made of two up quarks and a down quark. Its number in a nucleus, the atomic number, fixes the element.', 'Proton'],
  n: ['The neutral partner of the proton in nuclei, found by Chadwick in 1932. A free neutron decays in about 15 minutes; neutrons start chain reactions in reactors.', 'Neutron'],
  pbar: ['The proton’s antiparticle, with negative charge, first made at Berkeley in 1955. With a positron it makes antihydrogen, studied at CERN.', 'Antiproton'],
  nbar: ['The neutron’s antiparticle, also neutral, found in 1956. Made of antiquarks, it annihilates with ordinary nucleons into pions.', 'Antineutron'],
  alpha: ['A helium-4 nucleus: two protons and two neutrons, very tightly bound. Emitted in alpha decay; Rutherford used them to find the atomic nucleus.', 'Alpha_particle'],
  d: ['The nucleus of deuterium (heavy hydrogen), a proton and a neutron. About 1 in 6,400 hydrogen atoms; it fuses with tritium in fusion reactors.', 'Deuterium'],
  t: ['The nucleus of tritium, a proton and two neutrons, radioactive (half-life 12.3 years). Fuel for fusion, and the glow in some watch dials.', 'Tritium'],
  h: ['The nucleus of helium-3, two protons and a neutron. Rare on Earth; it is used to detect neutrons and to cool to near absolute zero.', 'Helium-3'],
  gamma: ['Light at its most energetic, photons from nuclei, annihilation and the hottest places in the universe. They pass through matter, so thick lead shields them.', 'Gamma_ray'],
  photon: ['A particle of light, with no mass and no charge, always moving at the speed of light. Einstein’s explanation of the photoelectric effect (1905) made it a particle.', 'Photon'],
  nu: ['A ghostly lepton with almost no mass that feels only the weak force. Trillions from the Sun pass through you every second; they change flavour as they travel.', 'Neutrino'],
  mu: ['A heavy electron, 207 times its mass, living 2.2 microseconds. Made by cosmic rays high in the air, many reach the ground only thanks to time dilation.', 'Muon'],
  tau: ['The heaviest lepton, almost twice a proton’s mass, found in 1975. It lives a third of a picosecond and is heavy enough to decay into hadrons.', 'Tau_(particle)'],
  pi: ['The lightest mesons, a quark and an antiquark. Predicted by Yukawa as the carriers of the force between nucleons, found in cosmic rays in 1947.', 'Pion'],
  K: ['Mesons with a strange quark, found in 1947. Their decays showed that nature is not quite the same in a mirror (CP violation, 1964).', 'Kaon'],
  eta: ['A neutral meson about four times a pion’s mass, a mix of light quark–antiquark pairs; it decays almost at once to photons or pions.', 'Eta_meson'],
  rho: ['A short-lived meson, a quark–antiquark pair in a spinning state; it decays to two pions within about 10⁻²³ s.', 'Rho_meson'],
  omega: ['A neutral meson like the ρ, decaying mostly to three pions; it lives about 10⁻²² s.', 'Omega_meson'],
  phi: ['A meson made of a strange quark and its antiquark; it decays mostly to two kaons.', 'Phi_meson'],
  Ks: ['An excited kaon, a strange meson with its quark spins aligned; it decays at once to a kaon and a pion.', 'Kaon'],
  Delta: ['The first excited state of the nucleon, found by Fermi’s group in 1951 in pion–proton collisions. It lives about 10⁻²³ s; Δ⁺⁺ (uuu) helped reveal colour charge.', 'Delta_baryon'],
  Dmes: ['Mesons with a charm quark, found in 1976. Their decays, a fraction of a picosecond after they are made, test how quarks change flavour.', 'D_meson'],
  Bmes: ['Mesons with a bottom quark. Their slight matter–antimatter differences, studied at B factories and the LHC, are a clue to why matter won.', 'B_meson'],
  Lam: ['A baryon like a neutron with a strange quark in place of a down quark, found in 1947. It lives about a quarter of a nanosecond.', 'Lambda_baryon'],
  LamC: ['A Λ with a charm quark in place of the strange one (u d c), found in 1975. It lives about 0.2 picoseconds, decaying through the weak force.', 'Lambda_baryon'],
  LamB: ['A Λ with a bottom quark (u d b), first seen at CERN in 1991. It lives about 1.5 picoseconds; its decays are studied for differences between matter and antimatter.', 'Lambda_baryon'],
  Sig: ['Baryons with one strange quark, in three charges; the charged ones live about a tenth of a nanosecond, the neutral one decays at once to a Λ and a photon.', 'Sigma_baryon'],
  Xi: ['Baryons with two strange quarks, called cascade particles because they decay through a Λ in two steps.', 'Xi_baryon'],
  Omg: ['A baryon of three strange quarks, predicted by Gell-Mann and found in 1964, confirming the quark model.', 'Omega_baryon'],
  Jpsi: ['A charm quark and its antiquark, found at once by two labs in 1974 (the November Revolution); it proved charm quarks exist.', 'J%2Fpsi_meson'],
  Ups: ['A bottom quark and its antiquark, found at Fermilab in 1977: the discovery of the bottom quark.', 'Upsilon_meson'],
  W: ['A carrier of the weak force, about 80 times a proton’s mass, found at CERN in 1983. It turns neutrons into protons in beta decay.', 'W_and_Z_bosons'],
  Z: ['The neutral carrier of the weak force (91 GeV), found at CERN in 1983. It decays into any light enough pair of fermions, neutrinos included.', 'W_and_Z_bosons'],
  H: ['The particle of the Higgs field, which gives the W, Z and the fermions their masses. Found at CERN’s LHC in 2012, at 125 GeV.', 'Higgs_boson'],
  muP: ['An atom with a muon in place of the electron, 207 times smaller than hydrogen. It slips close to other nuclei, so it can catalyse fusion; it measured the proton’s size.', 'Exotic_atom'],
  muHe: ['A helium nucleus that caught the muon in a muon-catalysed fusion. Stuck to it, the muon can catalyse no more: this sticking limits the process.', 'Muon-catalyzed_fusion'],
  Ps: ['An electron and a positron orbiting each other, an atom with no nucleus, first made in 1951. It annihilates into gamma rays in 0.1 ns or 142 ns, depending on its spins.', 'Positronium'],
  Mu: ['An antimuon with an electron around it, a light isotope of hydrogen, first made in 1960. It lives 2.2 µs and is used to probe magnetism in materials.', 'Muonium'],
  hy: ['A nucleus holding a Λ hyperon as well as protons and neutrons. Free of the Pauli principle’s crowding, the Λ sinks to the centre; the first was seen in a cosmic-ray emulsion in 1952.', 'Hypernucleus'],
  anti: ['Matter made of antiparticles, with every charge reversed. Antihydrogen was first held in a trap at CERN in 2010; why the universe has so little antimatter is still an open question.', 'Antimatter'],
};
/* The info key of an unstable particle (W.exo species): its family's. */
function infoKeyX(sp) {
  const d = XP[sp]; if (!d) return null;
  if (d.hyp) return 'hy'; if (d.ps) return 'Ps'; if (d.atom) return 'muP'; if (d.stuck) return 'muHe';
  if (sp === 'Mu') return 'Mu';
  const F = [['mu', 'mu'], ['tau', 'tau'], ['pi', 'pi'], ['Ks', 'Ks'], ['K', 'K'], ['eta', 'eta'], ['rho', 'rho'], ['omega', 'omega'], ['phi', 'phi'], ['Dpp', 'Delta'], ['Dp', 'Delta'], ['D0', 'Delta'], ['Dm', 'Delta'], ['Dbmm', 'Delta'], ['Dbm', 'Delta'], ['Db0', 'Delta'], ['Dbp', 'Delta'],
    ['Dc', 'Dmes'], ['Ds', 'Dmes'], ['Bs', 'Bmes'], ['Bb', 'Bmes'], ['B', 'Bmes'], ['Lc', 'LamC'], ['Lb', 'LamB'], ['Lam', 'Lam'], ['Sig', 'Sig'], ['Xi', 'Xi'], ['Omg', 'Omg'], ['Jpsi', 'Jpsi'], ['Ups', 'Ups'], ['W', 'W'], ['Z', 'Z'], ['H', 'H']];
  for (const [p, k] of F) if (sp.startsWith(p)) return k;
  return null;
}
/* The info key of an ordinary particle (W.parts), or null for an atom (its element's). */
function infoKeyP(p) {
  if (p.k === ELEC) return 'e-'; if (p.k === POS) return 'e+';
  if (p.mu) return p.ne > 0 ? 'Mu' : 'mu'; // (muonium, or its bare μ⁺)
  if (p.Z === 0) return p.anti ? 'nbar' : 'n';
  if (p.ne > 0) return null;
  if (p.anti) return p.Z === 1 && p.N === 0 ? 'pbar' : 'anti';
  if (p.Z === 1) return p.N === 0 ? 'p' : p.N === 1 ? 'd' : p.N === 2 ? 't' : null;
  if (p.Z === 2) return p.N === 2 ? 'alpha' : p.N === 1 ? 'h' : null;
  return null;
}
function wikiURL(t) { return 'https://en.wikipedia.org/wiki/' + t; }
/* The info box: the text, and Read more (the Wikipedia article). */
function infoHTML(text, wiki, title) {
  if (!text) return '';
  return `<div class="infobox"><p>${esc(text)}</p>${wiki ? `<a class="btn small readmore" href="${esc(wikiURL(wiki))}" target="_blank" rel="noopener noreferrer" data-wiki="1" title="Wikipedia: ${esc(title || wiki.replace(/_/g, ' '))}">Read more ↗</a>` : ''}</div>`;
}
function infoElHTML(Z, anti) {
  const t = EL_INFO[Z]; if (!t) return '';
  return infoHTML(anti ? `${t} (This is its antimatter twin: the same, with every charge reversed.)` : t, elWiki(Z), ELEMENTS[Z].name);
}
function infoPHTML(key) { const e = key && P_INFO[key]; return e ? infoHTML(e[0], e[1]) : ''; }
/* Read more: the desktop app opens the article in the player's browser (the shell's open_wiki command); the page
   follows the link into a new tab. */
function infoLink(e) {
  const a = e.target && e.target.closest && e.target.closest('a[data-wiki]'); if (!a) return;
  const T = typeof window !== 'undefined' && window.__TAURI__;
  if (T && T.core && T.core.invoke) { e.preventDefault(); T.core.invoke('open_wiki', { url: a.href }).catch(() => {}); }
}
if (typeof document !== 'undefined') document.addEventListener('click', infoLink);
