'use strict';
/* ============================================================================
   Atom Forge — user interface: tools, palette, panels, presets, main loop
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function store(k, v) { try { if (v === undefined) return localStorage.getItem('atomforge.' + k); localStorage.setItem('atomforge.' + k, v); } catch (e) { return null; } return null; }

const UI = {
  running: true, stepOnce: false, tool: 'place', spec: null, preset: 'soup', tab: 'lab',
  pointers: new Map(), drag: null, hoverP: null, mouse: null, spaceDown: false, clip: null, // clip: the Select tool's copied particles
  lastUI: 0, lastPanel: 0, lastHist: 0, lastLogSeq: -1, logFilter: { chem: true, em: true, nuc: true, tool: true },
  customSpec: null, ptSel: { Z: 26, A: 56, q: 0, bare: false, anti: false }, ptBound: false, fitted: false, vis: 0,
};

/* ------------------------------------------------------------------ particle specs */
const SPEC_P = { kind: 'atom', Z: 1, A: 1, bare: true };
const SPEC_ALPHA = { kind: 'atom', Z: 2, A: 4, bare: true };
const SPEC_PBAR = { kind: 'pbar' };
const SPEC_NBAR = { kind: 'nbar' };
const SPEC_HBAR = { kind: 'atom', Z: 1, A: 1, anti: true };
const QUICK = [
  { spec: SPEC_P, label: 'p⁺', color: '#ff5a4e', title: 'Proton: a bare hydrogen-1 nucleus, charge +1' },
  { spec: { kind: 'n' }, label: 'n', color: '#a9b4c2', title: 'Neutron: no charge; free neutrons decay (t½ 10 min)' },
  { spec: { kind: 'e' }, label: 'e⁻', color: '#4da8ff', title: 'Electron, charge −1' },
  { spec: SPEC_ALPHA, label: 'α', color: '#ffc85a', title: 'Alpha particle: a helium-4 nucleus, charge +2' },
  'sep',
  { spec: { kind: 'pos' }, label: 'e⁺', color: '#ff6fc8', title: 'Positron: the electron’s antiparticle, charge +1' },
  { spec: SPEC_PBAR, label: 'p̄', color: '#b56dff', title: 'Antiproton: the proton’s antiparticle, charge −1. Annihilates with ordinary matter' },
  { spec: SPEC_NBAR, label: 'n̄', color: '#66738a', title: 'Antineutron: the neutron’s antiparticle, no charge. Annihilates when it meets a nucleus; on its own it decays to an antiproton, a positron and a neutrino (t½ 10 min)' },
  { spec: SPEC_HBAR, label: 'H̄', color: '#d6a3ff', title: 'Antihydrogen: an antiproton orbited by a positron' },
  'sep',
  ...['H', 'He', 'C', 'N', 'O', 'Na', 'Cl', 'Fe', 'Cu', 'U'].map(sym => ({ spec: { kind: 'atom', Z: SYM2Z[sym], A: COMMON_A[SYM2Z[sym]] } })),
  'sep',
  ...['H2O', 'O2', 'H2', 'CH4'].map(m => ({ spec: { kind: 'mol', mol: m } })),
];
function sameSpec(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'mol') return a.mol === b.mol;
  if (a.kind === 'atom') return a.Z === b.Z && a.A === b.A && !!a.bare === !!b.bare && !!a.anti === !!b.anti && (a.charge || 0) === (b.charge || 0);
  return true;
}
function specLabel(s) {
  switch (s.kind) {
    case 'e': return 'e⁻';
    case 'pos': return 'e⁺';
    case 'pbar': return 'p̄';
    case 'nbar': return 'n̄';
    case 'n': return 'n';
    case 'gamma': return 'γ';
    case 'mol': return isoFormula(MOLECULES[s.mol].atoms.map(a => ({ el: ELEMENTS[SYM2Z[a[0]]], q: a[3] || 0, A: a[4] || 0 })));
    case 'atom': {
      if (s.bare) {
        if (s.Z === 1 && s.A === 1) return s.anti ? 'p̄' : 'p⁺';
        if (s.Z === 2 && s.A === 4 && !s.anti) return 'α';
        return nucSymA(s.Z, s.A - s.Z, s.anti) + sup((s.Z > 1 ? s.Z : '') + (s.anti ? '-' : '+'));
      }
      const iso = s.A !== COMMON_A[s.Z] ? sup(s.A) : '';
      const q = s.charge || 0;
      return iso + (s.anti ? barSym(ELEMENTS[s.Z].sym) : ELEMENTS[s.Z].sym) + (q ? sup((Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '-')) : '');
    }
  }
  return '?';
}
function specName(s) {
  switch (s.kind) {
    case 'e': return 'Electron';
    case 'pos': return 'Positron';
    case 'pbar': return 'Antiproton';
    case 'nbar': return 'Antineutron';
    case 'n': return 'Neutron';
    case 'gamma': return 'Gamma ray';
    case 'mol': return MOLECULES[s.mol].name;
    case 'atom': {
      const el = ELEMENTS[s.Z];
      if (s.anti) {
        if (s.bare) return s.Z === 1 && s.A === 1 ? 'Antiproton' : `Anti-${el.name.toLowerCase()}-${s.A} nucleus`;
        return s.Z === 1 ? (s.A === 1 ? 'Antihydrogen' : `Antihydrogen-${s.A}`) : `Anti-${el.name.toLowerCase()}-${s.A}`;
      }
      if (s.bare) return s.Z === 1 && s.A === 1 ? 'Proton' : s.Z === 2 && s.A === 4 ? 'Alpha particle' : `${el.name}-${s.A} nucleus`;
      const q = s.charge || 0;
      return `${el.name}-${s.A}${q ? (q > 0 ? ' cation' : ' anion') : ''}`;
    }
  }
  return '';
}
function specColor(s) {
  switch (s.kind) {
    case 'e': return E_COL; case 'pos': return POS_COL; case 'n': return N_COL; case 'gamma': return '#c9a7ff';
    case 'pbar': return PBAR_COL;
    case 'nbar': return NBAR_COL;
    case 'mol': return ELEMENTS[SYM2Z[MOLECULES[s.mol].atoms[0][0]]].color;
    case 'atom': return s.anti ? (s.bare ? PBAR_COL : mixHex(ELEMENTS[s.Z].color, ANTI_TINT, 0.5)) : s.bare ? P_COL : ELEMENTS[s.Z].color;
  }
  return '#ccc';
}
const _molR = new Map();
function molRadius(k) { // centroid to outermost atom, Å
  let r = _molR.get(k);
  if (r === undefined) {
    const A = MOLECULES[k].atoms; let cx = 0, cy = 0;
    for (const a of A) { cx += a[1]; cy += a[2]; } cx /= A.length; cy /= A.length;
    r = 0; for (const a of A) r = Math.max(r, Math.hypot(a[1] - cx, a[2] - cy));
    _molR.set(k, r);
  }
  return r;
}
function specSize(s) { // rough radius (Å) for spacing placements
  if (s.kind === 'mol') return molRadius(s.mol) + 1.2;
  if (s.kind === 'atom' && !s.bare) return Math.max(0.8, 0.5 * (ELEMENTS[s.Z].uffR || 3));
  return 0.6;
}

/* ------------------------------------------------------------------ tools */
const ICONS = {
  place: '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/>',
  grab: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6.5 7S5 17.5 4.3 15.4L3.6 13a1.5 1.5 0 0 1 2.8-1l1.6 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  pull: '<circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10.4 5.9 12 7.5l1.6-1.6M10.4 18.1 12 16.5l1.6 1.6M5.9 10.4 7.5 12l-1.6 1.6M18.1 10.4 16.5 12l1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  fire: '<path d="M4 19 14.5 8.5M10 6h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="18" r="2.2" fill="currentColor"/>',
  heat: '<path d="M12 3c.5 3.2 4.5 5.2 4.5 10a4.5 4.5 0 0 1-9 0c0-2.2 1.2-3.6 2.2-4.6.2 1.6.9 2.6 2 3.1C11 9.2 11 6 12 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  spark: '<path d="M13.5 2.8 5.5 13.2h6l-1.2 8 8.2-10.6h-6.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 7.5h4M14 7.5h4" stroke="currentColor" stroke-width="1.7"/>',
  light: '<circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  erase: '<path d="m4.5 15.5 9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7.2z M9 11l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 20h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  inspect: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  measure: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m7 13 1.6 1.6M9.5 10.5l2.3 2.3M12 8l1.6 1.6M14.5 5.5l2.3 2.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  select: '<rect x="4" y="4" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="3 2.2"/><path d="m13.5 13.5 2.2 6.5 1.6-2.7 2.7-1.6z" fill="currentColor"/>',
};
const TOOLS = [
  { id: 'place', name: 'Place', key: 'P', help: 'Click to place the selected particle, drag to spray.' },
  { id: 'grab', name: 'Grab', key: 'G', help: 'Press on or near a particle and drag it on a spring (or move it directly while paused).' },
  { id: 'select', name: 'Select', key: 'T', help: 'Drag a box round particles to select them (Shift adds); drag the selection to move it. Ctrl+C copies; Ctrl+V picks the copy up, then click where it goes (Shift-click to put down several; Escape cancels). Delete removes, Ctrl+A selects everything.' },
  { id: 'pull', name: 'Push/Pull', key: 'U', help: 'Hold to gather or push away everything nearby; low strengths let atoms settle together gently.' },
  { id: 'fire', name: 'Fire', key: 'F', help: 'Drag to aim, release to fire a particle at a set energy.' },
  { id: 'heat', name: 'Heat', key: 'H', help: 'Hold to heat (or cool) a region with a local heat bath.' },
  { id: 'spark', name: 'Spark', key: 'S', help: 'Click to dump energy into the atoms under the cursor.' },
  { id: 'magnet', name: 'Magnet', key: 'M', help: 'Click to place a magnet pole; drag one to move it.' },
  { id: 'light', name: 'Light', key: 'L', help: 'Drag to aim a beam of photons of one wavelength.' },
  { id: 'erase', name: 'Erase', key: 'E', help: 'Drag to remove particles, magnets and beam sources.' },
  { id: 'measure', name: 'Measure', key: 'K', help: 'Click two atoms for their distance, a third for the angle at the middle one; the numbers follow the atoms as they move.' },
  { id: 'inspect', name: 'Inspect', key: 'I', help: 'Click a particle to see its physics in the Inspect tab. Right-click anything in the chamber for a quick menu.' },
];
const OPT = {
  place: { count: 1 },
  grab: { mol: true, s: 'strong' },
  select: { whole: true },
  pull: { mode: 'pull', R: 10, s: 100 },
  fire: { proj: 'sel', s: 300, source: false, rate: 3 },
  heat: { mode: 'heat', s: 348, R: 8 },
  spark: { s: 218, R: 8 },
  magnet: { s: 430, pol: 1, R: 9 },
  light: { s: 132.33, rate: 80, follow: true, mount: false }, // (s: 589 nm, sodium's line, exactly)
  erase: { R: 3 },
};
const fireKE = () => Math.pow(10, OPT.fire.s / 100 - 2);
const heatT = () => OPT.heat.mode === 'cool' ? 15 : Math.pow(10, OPT.heat.s / 100);
const sparkE = () => Math.pow(10, OPT.spark.s / 100);
const pullU = () => Math.pow(10, OPT.pull.s / 100 - 2); // well depth, 0.01 eV … 10 keV
const PULL_PRESETS = [[30, 'Very gentle'], [100, 'Gentle'], [170, 'Medium'], [250, 'Strong'], [330, 'Very strong'], [500, 'Extreme']];
/* Tool radii: a logarithmic slider (0 … 200) from each tool's smallest radius up to 1,000 Å. */
const RAD_MIN = { pull: 3, heat: 3, spark: 2, magnet: 3, erase: 1 }, RAD_MAX = 1000;
const radS = (t, R) => Math.round(200 * Math.log(clamp(R, RAD_MIN[t], RAD_MAX) / RAD_MIN[t]) / Math.log(RAD_MAX / RAD_MIN[t]));
function radR(t, s) { const r = RAD_MIN[t] * Math.pow(RAD_MAX / RAD_MIN[t], s / 200); return r < 20 ? Math.round(r) : r < 100 ? 2 * Math.round(r / 2) : r < 400 ? 5 * Math.round(r / 5) : 10 * Math.round(r / 10); }
const radCtl = (t, R) => rangeCtl('oR', 'Radius', 0, 200, radS(t, R), fmtA(R));
function pullWord(U) { const r = U / (PHYS.KB * Math.max(W.T, 1)); return r < 3 ? 'barely holds' : r < 15 ? 'gentle' : r < 60 ? 'firm' : r < 400 ? 'strong' : 'violent'; }
const magB = () => OPT.magnet.pol * Math.pow(10, OPT.magnet.s / 100);
const lightE = () => Math.pow(10, OPT.light.s / 100 - 1);
const FIRE_PROJ = [
  { id: 'sel', label: 'Selected' }, { id: 'e', label: 'e⁻', spec: { kind: 'e' } }, { id: 'p', label: 'p⁺', spec: SPEC_P },
  { id: 'n', label: 'n', spec: { kind: 'n' } }, { id: 'a', label: 'α', spec: SPEC_ALPHA }, { id: 'pbar', label: 'p̄', spec: SPEC_PBAR }, { id: 'nbar', label: 'n̄', spec: SPEC_NBAR },
  { id: 'g', label: 'γ', spec: { kind: 'gamma' } }, { id: 'mu', label: 'μ⁻', spec: { kind: 'exo', sp: 'mu-' } },
];
function fireSpecNow() { const f = FIRE_PROJ.find(f => f.id === OPT.fire.proj); return f && f.spec ? f.spec : UI.spec; }
function wavelengthText(E) {
  const nm = PHYS.HC / E;
  let band = '';
  if (E >= 1.24e5) band = 'gamma ray'; else if (E >= 124) band = 'X-ray'; else if (nm < 380) band = 'ultraviolet';
  else if (nm <= 780) band = 'visible'; else band = 'infrared';
  const lam = nm >= 1e4 ? fmtNum(nm / 1000, 3) + ' µm' : nm >= 1 ? nm.toPrecision(3) + ' nm' : nm >= 1e-3 ? (nm * 1000).toPrecision(3) + ' pm' : (nm * 1e6).toPrecision(3) + ' fm';
  return { lam, band, E: fmtE(E) };
}

function buildTools() {
  const nav = $('tools');
  nav.innerHTML = TOOLS.map(t => `<button class="tool" data-tool="${t.id}" aria-pressed="false" title="${esc(t.name)} (${t.key}) — ${esc(t.help)}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.id]}</svg>${t.name}<kbd>${t.key}</kbd></button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('.tool'); if (b) setTool(b.dataset.tool); });
}
function setTool(id) {
  UI.tool = id; UI.pasting = false; R.ghost = null;
  for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', b.dataset.tool === id ? 'true' : 'false');
  if (W.tool) W.tool.active = false;
  W.grab = null; R.overlay = null;
  buildToolOpts();
  store('tool', id);
}

/* ------------------------------------------------------------------ palette */
function buildPalette() {
  const pal = $('palette');
  const items = QUICK.slice();
  if (UI.customSpec && !QUICK.some(q => q !== 'sep' && sameSpec(q.spec, UI.customSpec))) items.push('sep', { spec: UI.customSpec });
  let html = '';
  items.forEach((q, i) => {
    if (q === 'sep') { html += '<span class="sep" aria-hidden="true"></span>'; return; }
    const s = q.spec, col = q.color || specColor(s), lab = q.label || specLabel(s);
    html += `<button class="chip" data-i="${i}" aria-pressed="${sameSpec(s, UI.spec)}" title="${esc(q.title || specName(s))}"><span class="sw" style="background:${col}"></span>${esc(lab)}</button>`;
  });
  pal.innerHTML = html;
  placeHint();
  pal.onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const q = items[+b.dataset.i]; if (q && q !== 'sep') selectSpec(q.spec);
  };
  const sel = pal.querySelector('.chip[aria-pressed="true"]'); // keep the chosen particle in view
  if (sel && (sel.offsetLeft < pal.scrollLeft || sel.offsetLeft + sel.offsetWidth > pal.scrollLeft + pal.clientWidth)) pal.scrollLeft = sel.offsetLeft - 40;
}
/* keep the hint card clear of the palette, whose chips wrap onto more rows on narrow stages */
function placeHint() {
  const h = $('hint'), pal = $('paletteBar');
  if (window.matchMedia('(max-width: 820px)').matches) { h.style.top = ''; return; }
  h.style.top = (pal.offsetTop + pal.offsetHeight + 8) + 'px';
}
function selectSpec(s) {
  UI.spec = s;
  if (!QUICK.some(q => q !== 'sep' && sameSpec(q.spec, s))) UI.customSpec = s;
  buildPalette();
  if (UI.tool !== 'place' && UI.tool !== 'fire') setTool('place'); else buildToolOpts();
}

/* ------------------------------------------------------------------ side-scrolling strips */
/* host is a .hs wrapper whose first child scrolls sideways. Arrows show only toward hidden content;
   the mouse wheel and a mouse or pen drag scroll it too (a drag never triggers the button under it). */
function makeHScroll(host, opts = {}) {
  const strip = host.firstElementChild;
  const arrow = (side, label, glyph, dir) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'hs-arrow ' + side + (opts.lite ? ' lite' : ''); b.textContent = glyph;
    b.setAttribute('aria-label', label); b.title = label; b.hidden = true;
    b.onclick = () => strip.scrollBy({ left: dir * Math.max(90, strip.clientWidth * 0.7), behavior: 'smooth' });
    host.appendChild(b); return b;
  };
  const L = arrow('l', 'Scroll left', '‹', -1), Rr = arrow('r', 'Scroll right', '›', 1);
  const update = () => {
    const max = strip.scrollWidth - strip.clientWidth, l = strip.scrollLeft > 2, r = strip.scrollLeft < max - 2;
    L.hidden = !l; Rr.hidden = !r;
    host.classList.toggle('fade-l', l); host.classList.toggle('fade-r', r);
  };
  strip.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(strip);
  new MutationObserver(() => requestAnimationFrame(update)).observe(strip, { childList: true, subtree: true });
  if (opts.wheel !== false) strip.addEventListener('wheel', (e) => {
    if (strip.scrollWidth <= strip.clientWidth + 1) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    strip.scrollLeft += d * (e.deltaMode === 1 ? 18 : 1);
    e.preventDefault();
  }, { passive: false });
  let drag = null;
  strip.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('input, select, textarea')) return;
    drag = { x: e.clientX, s: strip.scrollLeft, id: e.pointerId, moved: false };
  });
  strip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 6 && strip.scrollWidth > strip.clientWidth + 1) {
      drag.moved = true; host.classList.add('dragging');
      try { strip.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    }
    if (drag.moved) strip.scrollLeft = drag.s - dx;
  });
  const end = () => {
    if (!drag) return;
    if (drag.moved) {
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      strip.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => strip.removeEventListener('click', swallow, { capture: true }), 0);
    }
    drag = null; host.classList.remove('dragging');
  };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);
  update();
  return update;
}

/* ------------------------------------------------------------------ isotope picker */
/* [class, short label, long label] for a nuclide's lifetime: st stable · lg ≥ 1 year · md ≥ 1 minute · sh shorter */
function isoLife(Z, A) {
  const nuc = nuclideInfo(Z, A - Z);
  if (nuc.stable) return ['st', 'stable', 'stable'];
  if (nuc.unbound) return ['sh', 'unbound', 'unbound: it falls apart at once'];
  const t = nuc.t12, txt = 't½ ' + fmtTime(t);
  return [t >= PHYS.YEAR ? 'lg' : t >= 60 ? 'md' : 'sh', txt, txt + (nuc.estimated ? ' (estimated)' : '')];
}
function isoOptions(Z, A) {
  const list = isotopeList(Z).slice();
  if (!list.includes(A)) { list.push(A); list.sort((a, b) => a - b); }
  return list;
}
/* ---- My isotopes: atoms, ions and bare nuclei saved from the isotope builder, the periodic table or the inspector.
   They stay in the Place tool's bar under the chamber, and are kept in this browser (as My molecules are). */
const MYISO = [], MYISO_MAX = 40;
function isoSpec(Z, A, charge, bare, anti) { const s = { kind: 'atom', Z, A, charge: bare ? 0 : charge || 0, bare: !!bare }; if (anti) s.anti = true; return s; }
function isoSaved(s) { return !!s && s.kind === 'atom' && MYISO.some(m => sameSpec(m, s)); }
function myIsoStore() { store('myisos', JSON.stringify(MYISO.map(s => [s.Z, s.A, s.charge || 0, s.bare ? 1 : 0, s.anti ? 1 : 0]))); }
/* Save it, or forget it if it is saved already; returns whether it is saved now. */
function myIsoToggle(s) {
  if (!s || s.kind !== 'atom') return false;
  const i = MYISO.findIndex(m => sameSpec(m, s));
  if (i >= 0) MYISO.splice(i, 1);
  else { MYISO.push(isoSpec(s.Z, s.A, s.charge, s.bare, s.anti)); if (MYISO.length > MYISO_MAX) MYISO.shift(); }
  myIsoStore(); buildToolOpts();
  log('tool', i >= 0 ? `${specName(s)} taken off your saved isotopes` : `Saved ${specName(s)}: it stays in the Place tool's bar, in this browser`);
  return i < 0;
}
function myIsoLoad() {
  let list;
  try { list = JSON.parse(store('myisos') || 'null'); } catch (e) { list = null; }
  if (!Array.isArray(list)) return;
  for (const r of list) {
    if (!Array.isArray(r) || MYISO.length >= MYISO_MAX) break;
    const [Z, A, q, bare, anti] = r;
    if (!Number.isInteger(Z) || Z < 1 || Z > 118 || !ELEMENTS[Z] || !Number.isInteger(A) || A < Z || A - Z > Math.max(4, 2 * Z + 10)) continue;
    const ex = maxExtraElectrons(Z);
    if (!Number.isInteger(q) || q < (anti ? -Z : -ex) || q > (anti ? ex : Z)) continue;
    const s = isoSpec(Z, A, q, bare === 1, anti === 1);
    if (!isoSaved(s)) MYISO.push(s);
  }
}
/* The Save button's face for a spec (the builder, the periodic table and the inspector share it). */
function saveBtnFace(s) { const on = isoSaved(s); return { on, text: on ? '★ Saved' : '☆ Save', title: on ? 'Saved in the Place tool’s bar: press to take it off' : 'Keep it in the Place tool’s bar under the chamber (saved in this browser)' }; }
/* The saved ones as buttons for the Place (and Fire) tool's bar. */
function savedIsoHTML() { // (only those of the element being placed)
  const sp = UI.spec, mine = sp && sp.kind === 'atom' ? MYISO.map((m, i) => [m, i]).filter(([m]) => m.Z === sp.Z && !!m.anti === !!sp.anti) : [];
  if (!mine.length) return '';
  return `<span class="lbl">Saved</span>` + mine.map(([m, i]) => {
    const [cls, , long] = isoLife(m.Z, m.A);
    return `<button class="opt iso" data-my="${i}" aria-pressed="${sameSpec(m, UI.spec)}" title="${esc(`${specName(m)}, ${long}. Take it off in Elements…`)}"><i class="life ${cls}" aria-hidden="true"></i>${esc(specLabel(m))}</button>`;
  }).join('');
}
/* Decay time covered by one second of watching (one clock: the motion's pace times the decay speed-up). */
function decayPerSecond() { return W.warp * W.simPerFrame * PHYS.TU_S * 60; }
/* What the chosen isotope will do once placed, at the current decay speed. */
function isoNote(Z, A) {
  const [cls, , long] = isoLife(Z, A);
  if (cls === 'st') return 'stable: it will never decay';
  const nuc = nuclideInfo(Z, A - Z);
  if (nuc.unbound) return long;
  if (!W.decayOn) return long + ', but decay is paused';
  const watch = nuc.t12 / decayPerSecond(), real = W.warp <= 1.0001;
  if (watch < 0.2) return long + `: ${real ? 'even at its real rate it' : 'at this decay speed it'} decays almost as soon as it is placed`;
  if (watch < 30) return long + `: at this decay speed it decays within seconds (pause decay under Lab › Time)`;
  if (watch < 3600) return long + `: about ${fmtTime(watch)} of watching per half-life at this decay speed`;
  return long + (real ? ': far too slow to see at its real rate (speed decay up under Lab › Time)' : '');
}
function isoPickerHTML(sp) {
  if (!sp || sp.kind !== 'atom') return '';
  const el = ELEMENTS[sp.Z];
  const btns = isoOptions(sp.Z, sp.A).map(A => {
    const [cls, short] = isoLife(sp.Z, A);
    return `<button class="opt iso" data-iso="${A}" aria-pressed="${A === sp.A}" title="${esc(nucName(sp.Z, A - sp.Z) + ': ' + short)}"><i class="life ${cls}" aria-hidden="true"></i>${sup(A)}${symHTML(el.sym, sp.anti)}</button>`;
  }).join('');
  return `<span class="lbl">Isotope</span>${btns}<span class="help">${esc(isoNote(sp.Z, sp.A))}</span>`;
}

/* ------------------------------------------------------------------ tool options bar */
function seg(name, opts, cur) {
  return `<span class="lbl">${name}</span>` + opts.map(([v, l]) => `<button class="opt" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('');
}
function rangeCtl(id, label, min, max, val, text, step = 1) {
  return `<label><span class="lbl">${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="num" id="${id}V">${text}</span></label>`;
}
function buildToolOpts() {
  if (UI.started) optSave();
  const el = $('toolopts'), t = UI.tool, o = OPT[t];
  const sp = UI.spec || SPEC_P;
  let h = '';
  switch (t) {
    case 'place':
      h = `<span class="lbl">Placing</span><span><span class="swatch" style="background:${specColor(sp)}"></span> <b>${esc(specLabel(sp))}</b> <span class="help">${esc(specName(sp))}</span></span>
        ${savedIsoHTML()}${isoPickerHTML(sp)}${isObject(sp) ? `<span class="help">${MOLECULES[sp.mol].atoms.length} atoms, one per click; the box opens up if it is too small. It warms to the bath temperature, so keep that near room temperature (Lab tab) or it falls apart, as it would in a flame.</span>`
          : `<span data-g="count">${seg('Count', [[1, '1'], [5, '5'], [20, '20']].concat(MAX_PARTS >= 8000 ? [[100, '100']] : []), o.count)}</span><span class="help">at the bath temperature</span>`}`;
      break;
    case 'grab':
      h = `<span data-g="mol">${seg('Grab', [['true', 'Whole molecule'], ['false', 'Single atom']], String(o.mol))}</span><span data-g="s">${seg('Strength', [['gentle', 'Gentle'], ['strong', 'Strong'], ['max', 'Very strong']], o.s)}</span><span class="help">${o.s === 'gentle' ? 'Draws it along at most 3 km/s of simulated time, so at high speed settings it trails the mouse.' : o.s === 'strong' ? 'Keeps up with the mouse (up to 30 km/s), pulling with up to 8 eV/Å; let go and it stops there.' : 'Keeps up even when dragged fast (up to 100 km/s), pulling with up to 30 eV/Å to haul through a crowd; let go and it stops there.'}</span><span class="help">Press on or near a particle and drag. It follows on a spring; while paused it moves directly.</span>`;
      break;
    case 'pull':
      h = `<span data-g="mode">${seg('Force', [['pull', 'Attract'], ['push', 'Repel']], o.mode)}</span>` +
        `<span data-g="s">${seg('Strength', PULL_PRESETS, PULL_PRESETS.some(p => p[0] === o.s) ? o.s : '')}</span>` +
        rangeCtl('oS', 'Depth', 0, 600, o.s, fmtE(pullU())) + `<span class="help" id="oSword">${pullWord(pullU())} at ${fmtT(W.T)}</span>` +
        radCtl(t, o.R) + '<span class="help">A wider well pulls more gently at the same depth: deepen it to haul from far off.</span>';
      break;
    case 'fire': {
      const fs = fireSpecNow() || SPEC_P;
      h = `<span data-g="proj">${seg('Projectile', FIRE_PROJ.map(f => [f.id, f.id === 'sel' ? esc(specLabel(UI.spec || SPEC_P)) : f.label]), o.proj)}</span>` +
        (o.proj === 'sel' ? savedIsoHTML() + isoPickerHTML(UI.spec) : '') +
        rangeCtl('oKE', 'Energy', 0, 1700, o.s, fmtE(fireKE())) +
        `<span data-g="source">${seg('Mode', [['false', 'Single shot'], ['true', 'Beam source']], String(o.source))}</span>` +
        (o.source ? `<span data-g="rate">${seg('Rate', [[1, '1'], [3, '3'], [10, '10']], o.rate)}</span><span class="help">per 100 fs</span>` : '') +
        `<span class="help" id="oFireNote">${esc(fireNote(fs, fireKE()))}</span>`;
      break;
    }
    case 'heat':
      h = `<span data-g="mode">${seg('Mode', [['heat', 'Heat'], ['cool', 'Cool to 15 K']], o.mode)}</span>` +
        (o.mode === 'heat' ? rangeCtl('oT', 'To', 200, 900, o.s, fmtT(heatT())) : '') + radCtl(t, o.R);
      break;
    case 'spark':
      h = rangeCtl('oE', 'Energy', 0, 900, o.s, fmtE(sparkE())) + radCtl(t, o.R) +
        '<span class="help">Shared among the atoms within the radius. From a few keV an atom they fly apart as fast particles; MeV and up sets off nuclear reactions.</span>';
      break;
    case 'magnet':
      h = `<span data-g="pol">${seg('Pole', [[1, 'N ⊙'], [-1, 'S ⊗']], o.pol)}</span>` + rangeCtl('oB', 'Field', 100, 900, o.s, fmtTesla(Math.abs(magB()))) +
        radCtl(t, o.R) + `<button class="opt" id="oMagClear">Remove all</button>`;
      break;
    case 'light': {
      const w = wavelengthText(lightE());
      h = rangeCtl('oL', 'Photon', 0, 730, o.s, w.lam) + `<span><span class="swatch" id="oLsw" style="background:${lightSwatch(lightE())}"></span> <span class="help" id="oLtxt">${w.band}, ${w.E}</span></span>` +
        `<span data-g="lpre">${seg('Presets', [[9.34, 'IR 10 µm'], [132.33, 'Na 589 nm'], [200.86, 'Lyman-α'], [500, 'X-ray 10 keV'], [700, 'γ 1 MeV']], o.s)}</span>` +
        rangeCtl('oRate', 'Intensity', 5, 400, o.rate, o.rate + '/s') +
        `<span data-g="mount">${seg('Mode', [['false', 'While held'], ['true', 'Leave on (laser)']], String(!!o.mount))}</span>` +
        (W.lasers.length ? `<button class="opt" id="oLaserClear">Turn off ${W.lasers.length > 1 ? `all ${W.lasers.length} lasers` : 'the laser'}</button>` : '') +
        `<span class="help">${o.mount ? 'Drag to aim; on release it stays, shining one wavelength (Erase it, or Remove beam sources). ' : ''}Light crosses the box in hundredths of a femtosecond: time slows while it is in flight, so you see it go at c, in about a second at 1× (the speed buttons and slow motion scale that too).</span>`;
      break;
    }
    case 'erase':
      h = radCtl(t, o.R);
      break;
    case 'inspect':
      h = '<span class="help">Click any particle. Hovering shows a quick summary with every tool.</span>';
      break;
    case 'measure': {
      const m = R.measure || [];
      h = `<span class="num">${m.length >= 2 ? measureText() : m.length ? 'now click a second atom' : 'click an atom'}</span><button class="btn small" id="oMeasClr"${m.length ? '' : ' disabled'}>Clear</button><span class="help">Two atoms: their distance. Three: the angle at the middle one, as for a bond angle. Click empty space to start again.</span>`;
      break;
    }
    case 'select': {
      const n = selCount(), clip = UI.clip ? UI.clip.parts.length : 0;
      h = `<span data-g="whole">${seg('Box picks', [['true', 'Whole molecules'], ['false', 'Atoms only']], String(o.whole))}</span>` +
        `<span class="num" id="oSelN">${UI.pasting ? 'click where the copy goes (Shift-click: several; Esc cancels)' : n ? n.toLocaleString('en-US') + ' selected' : 'nothing selected'}</span>` +
        `<button class="opt" id="oSelCopy" ${n ? '' : 'disabled'} title="Ctrl+C">Copy</button><button class="opt" id="oSelPaste" ${clip ? '' : 'disabled'} ${UI.pasting ? 'aria-pressed="true"' : ''} title="Ctrl+V: pick the copy up, then click where it goes">${UI.pasting ? 'Placing' : 'Paste'}${clip ? ' ' + clip.toLocaleString('en-US') : ''}</button>` +
        `<button class="opt" id="oSelDel" ${n ? '' : 'disabled'} title="Delete">Delete</button><button class="opt" id="oSelAll" title="Ctrl+A">Select all</button><button class="opt" id="oSelNone" ${n ? '' : 'disabled'} title="Escape">Clear</button>`;
      break;
    }
  }
  el.innerHTML = h;
  toolTyped(t, o);
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'oMagClear') { W.magnets.length = 0; log('tool', 'Magnets removed'); return; }
    if (b.id === 'oSelCopy') { copySelection(); return; }
    if (b.id === 'oSelPaste') { if (UI.pasting) cancelPaste(); else armPaste(); return; }
    if (b.id === 'oSelDel') { deleteSelection(); return; }
    if (b.id === 'oSelAll') { selectAll(); return; }
    if (b.id === 'oLaserClear') { W.lasers.length = 0; buildToolOpts(); return; }
    if (b.id === 'oSelNone') { clearSelection(); return; }
    if (b.id === 'oMeasClr') { if (R.measure) R.measure.length = 0; buildToolOpts(); return; }
    if (b.dataset.iso) { selectSpec(Object.assign({}, UI.spec, { A: +b.dataset.iso })); return; }
    if (b.dataset.my !== undefined) { const m = MYISO[+b.dataset.my]; if (m) selectSpec(isoSpec(m.Z, m.A, m.charge, m.bare, m.anti)); return; }
    const g = b.closest('[data-g]'); if (!g) return;
    const key = g.dataset.g, v = b.dataset.v;
    if (key === 'lpre') { OPT.light.s = +v; buildToolOpts(); return; }
    o[key] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v;
    buildToolOpts();
  };
  el.oninput = (e) => {
    const inp = e.target; if (inp.type !== 'range') return;
    const v = +inp.value, out = $(inp.id + 'V');
    switch (inp.id) {
      case 'oR': o.R = radR(t, v); out.textContent = fmtA(o.R); break;
      case 'oS': { o.s = v; out.textContent = fmtE(pullU()); $('oSword').textContent = `${pullWord(pullU())} at ${fmtT(W.T)}`;
        for (const b of el.querySelectorAll('[data-g="s"] .opt')) b.setAttribute('aria-pressed', String(+b.dataset.v === v)); break; }
      case 'oKE': o.s = v; out.textContent = fmtE(fireKE()); { const n = $('oFireNote'); if (n) n.textContent = fireNote(fireSpecNow() || SPEC_P, fireKE()); } break;
      case 'oT': o.s = v; out.textContent = fmtT(heatT()); break;
      case 'oE': o.s = v; out.textContent = fmtE(sparkE()); break;
      case 'oB': o.s = v; out.textContent = fmtTesla(Math.abs(magB())); break;
      case 'oL': { o.s = v; const w = wavelengthText(lightE()); out.textContent = w.lam; $('oLtxt').textContent = `${w.band}, ${w.E}`; $('oLsw').style.background = lightSwatch(lightE()); break; }
      case 'oRate': o.rate = v; out.textContent = v + '/s'; break;
    }
  };
}
function lightSwatch(E) { const c = photonColor(E); return `rgb(${c[0]},${c[1]},${c[2]})`; }
function fireNote(spec, KE) {
  if (spec.kind === 'gamma') return KE > 1.022e6 ? 'Can create e⁻e⁺ pairs.' : KE >= 1e5 ? 'Compton-scatters off electrons.' : 'Photon: ionizes what it can.';
  if (spec.kind === 'n') return KE < 1 ? 'Slow (thermal) neutron: best for capture and ²³⁵U fission.' : KE > 1e6 ? 'Fast neutron: knocks nuclei, can be captured once slowed.' : 'Neutrons ignore charge; they only hit nuclei.';
  if (spec.kind === 'nbar') return 'No charge, so it never ionizes: it flies straight on until it meets a nucleus, then annihilates (pions + γ rays, about 1.9 GeV). Free, it decays like a neutron (t½ 10 min).';
  if (spec.kind === 'pbar' || (spec.kind === 'atom' && spec.anti)) return KE > 2e3 ? 'Fast antimatter mostly ionizes its way through; it annihilates once slowed or at the wall (pions + γ, 1.9 GeV per nucleon pair).' : 'Annihilates on touching ordinary matter: pions + γ rays, about 1.9 GeV.';
  const isLep = spec.kind === 'e' || spec.kind === 'pos';
  if (isLep) return KE > 1e3 ? 'Ionizing track through matter (Bethe stopping).' : KE > 10 ? 'Enough to ionize or excite atoms it hits.' : 'Slow: easily captured by ions.';
  if (spec.kind === 'atom' && spec.bare) return KE > 1e5 ? 'Can tunnel through Coulomb barriers (fusion).' : 'Fast ions ionize and knock atoms aside.';
  return KE > 5 ? 'Energetic enough to break bonds on impact.' : 'Chemistry-scale collision energy.';
}

/* ------------------------------------------------------------------ periodic table & molecules */
const CAT_COL = { nm: '#4fb06d', ng: '#a07ce0', am: '#e0614f', ae: '#e39b3d', tm: '#d2b44a', pt: '#7aa6c8', ml: '#44b5a6', hl: '#58b9e0', ln: '#d97fb0', an: '#e07f98' };
/* The anti-elements tab is the same table for antimatter: antiprotons and antineutrons in the nucleus, positrons
   around it. Chemistry and nuclear physics are the mirror image (CPT symmetry), so every value carries over. */
function antiName(Z) { return Z === 1 ? 'Antihydrogen' : 'Anti-' + ELEMENTS[Z].name.toLowerCase(); }
function symHTML(sym, anti) { return anti ? `<span class="ov">${esc(sym)}</span>` : esc(sym); }
function ptQRange(s) { // charges on offer: up to +8 and a few extra electrons for matter; the mirror for antimatter
  const ex = maxExtraElectrons(s.Z), pos = Math.min(s.Z, 8);
  return s.anti ? [-pos, ex] : [-ex, pos];
}
function buildPTGrid(anti) {
  const g = $('pgrid');
  let cells = '';
  for (let Z = 1; Z <= 118; Z++) {
    const el = ELEMENTS[Z]; if (!el) continue;
    let [r, c] = ptablePos(Z); if (r >= 8) r += 1;
    cells += `<button class="pcell" data-z="${Z}" style="grid-row:${r + 1};grid-column:${c + 1}" title="${esc(anti ? antiName(Z) : el.name)}"><span class="z">${Z}</span><span class="s">${el.sym}</span><span class="stripe" style="background:${CAT_COL[el.cat] || '#999'}"></span></button>`;
  }
  cells += '<div class="pgap" style="grid-row:9"></div>';
  g.innerHTML = cells;
  g.classList.toggle('anti', anti);
  g.dataset.anti = anti ? '1' : '0';
  $('ptLegend').innerHTML = Object.entries(CAT_NAMES).map(([k, n]) => `<span><i style="background:${CAT_COL[k]}"></i>${n}</span>`).join('') +
    (anti ? '<span class="antilg">Antimatter: antiprotons and antineutrons in the nucleus, positrons around it. It annihilates on touching ordinary matter.</span>' : '');
  for (const b of $('ptTabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.dataset.anti === '1') === anti));
  $('ptTitle').textContent = anti ? 'Periodic table of anti-elements' : 'Periodic table';
}
function setPTAnti(anti) {
  const s = UI.ptSel;
  if (!!s.anti === anti) return;
  s.anti = anti;
  const [lo, hi] = ptQRange(s);
  s.q = clamp(-s.q, lo, hi); // the mirror ion: an extra electron becomes an extra positron
  buildPTGrid(anti); renderPTDetail();
}
function openPT(sel) {
  if (sel) UI.ptSel = sel;
  else if (UI.spec && UI.spec.kind === 'atom') UI.ptSel = { Z: UI.spec.Z, A: UI.spec.A, q: UI.spec.charge || 0, bare: !!UI.spec.bare, anti: !!UI.spec.anti };
  const g = $('pgrid');
  if (!g.childElementCount || g.dataset.anti !== (UI.ptSel.anti ? '1' : '0')) buildPTGrid(!!UI.ptSel.anti);
  if (!UI.ptBound) {
    UI.ptBound = true;
    g.onclick = (e) => { const b = e.target.closest('.pcell'); if (!b) return; const Z = +b.dataset.z; UI.ptSel = { Z, A: COMMON_A[Z], q: 0, bare: false, anti: !!UI.ptSel.anti }; renderPTDetail(); };
    $('ptTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setPTAnti(b.dataset.anti === '1'); };
  }
  renderPTDetail();
  showModal('ptModal');
}
function renderPTDetail() {
  const s = UI.ptSel, el = ELEMENTS[s.Z], anti = !!s.anti, lep = anti ? 'positron' : 'electron';
  for (const b of document.querySelectorAll('.pcell')) b.setAttribute('aria-pressed', +b.dataset.z === s.Z ? 'true' : 'false');
  const isos = isotopeList(s.Z); if (!isos.includes(s.A)) isos.push(s.A), isos.sort((a, b) => a - b);
  const nuc = nuclideInfo(s.Z, s.A - s.Z);
  const life = nuc.stable ? 'stable' : nuc.unbound ? 'unbound' : 't½ ' + fmtTime(nuc.t12) + (nuc.estimated ? ' (est.)' : '');
  const modes = nuc.modes.map(m => modeLabel(m.mode) + (m.br < 0.999 ? ` ${(m.br * 100).toPrecision(2)}%` : '')).join(', ');
  const [minQ, maxQ] = ptQRange(s);
  const ne = s.bare ? 0 : anti ? s.Z + s.q : s.Z - s.q;
  const spec = { kind: 'atom', Z: s.Z, A: s.A, charge: s.bare ? 0 : s.q, bare: s.bare };
  if (anti) spec.anti = true;
  $('pdetail').innerHTML = `
    <div class="facts">
      <span><b>${esc(anti ? antiName(s.Z) : el.name)}</b> (${CAT_NAMES[el.cat] || ''}${anti ? ', antimatter' : ''})</span>
      <span>${anti ? 'antiprotons' : 'Z'} <b>${s.Z}</b></span><span>mass <b>${el.mass}</b> u</span>
      <span>electronegativity <b>${el.en ? el.en.toFixed(2) : '—'}</b></span>
      <span>1st ionization <b>${el.ie1 ? el.ie1.toFixed(2) + ' eV' : '—'}</b></span>
      <span>melts <b>${el.tm ? fmtT(el.tm) : '—'}</b></span>
      <span>${lep}s <b>${ne ? esc(configString(s.Z, ne)) : 'none (bare ' + (anti ? 'antinucleus' : 'nucleus') + ')'}</b></span>
      <span>${sup(s.A)}${symHTML(el.sym, anti)}: <b>${esc(life)}</b>${modes ? ' · ' + esc(modes) : ''}</span>
      ${(() => { // where it ends up
        if (nuc.stable || nuc.unbound) return '';
        const ch = decayChain(s.Z, s.A - s.Z, 40), end = ch[ch.length - 1], sy = (c) => nucSymA(c.Z, c.N, anti);
        const path = ch.map((c, i) => sy(c) + (i + 1 < ch.length ? ` →${MODE_SHORT[c.mode] || ''}` : '')).join(' ');
        return `<span title="${esc(path)}">decays to <b>${esc(end.stable ? sy(end) : end.mode === 'sf' ? 'fission fragments' : sy(end))}</b> in ${ch.length - 1} step${ch.length > 2 ? 's' : ''}</span>`;
      })()}
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <span class="stepper" aria-label="Charge"><button data-q="-1" aria-label="${anti ? 'Remove a positron' : 'Add an electron'}" ${s.bare || s.q <= minQ ? 'disabled' : ''}>−</button><span>${s.bare ? 'bare' : 'charge ' + (s.q > 0 ? '+' : '') + s.q}</span><button data-q="1" aria-label="${anti ? 'Add a positron' : 'Remove an electron'}" ${s.bare || s.q >= maxQ ? 'disabled' : ''}>+</button></span>
      <label class="check"><input type="checkbox" id="ptBare" ${s.bare ? 'checked' : ''}> Bare ${anti ? 'antinucleus' : 'nucleus'}</label>
      <button class="btn" id="ptBuild" title="Drag ${anti ? 'antiprotons, antineutrons and positrons' : 'protons, neutrons and electrons'} in and out of this atom">Isotope builder…</button>
      ${(() => { const f = saveBtnFace(spec); return `<button class="btn savebtn" id="ptSave" aria-pressed="${f.on}" title="${esc(f.title)}">${f.text}</button>`; })()}
      <button class="btn" id="ptUse" style="background:var(--accent);color:var(--accent-fg);border-color:var(--accent)">Use ${esc(specLabel(spec))}</button>
    </div>
    <div class="isorow"><span class="lbl">Isotope</span><div class="isochips" role="group" aria-label="Isotope">${isos.map(A => { const [cls, short] = isoLife(s.Z, A); return `<button class="isochip" data-a2="${A}" aria-pressed="${A === s.A}"><i class="life ${cls}" aria-hidden="true"></i><b>${sup(A)}${symHTML(el.sym, anti)}</b><span>${esc(short)}</span></button>`; }).join('')}</div></div>
    ${MYISO.length ? `<div class="isorow"><span class="lbl">Saved</span><div class="isochips" role="group" aria-label="Saved isotopes">${MYISO.map((m, i) => { const [cls, short] = isoLife(m.Z, m.A); return `<span class="isosaved"><button class="isochip" data-my="${i}" aria-pressed="${sameSpec(m, spec)}" title="${esc(specName(m))}"><i class="life ${cls}" aria-hidden="true"></i><b>${esc(specLabel(m))}</b><span>${esc(short)}</span></button><button class="isox" data-myx="${i}" aria-label="Take ${esc(specName(m))} off your saved isotopes" title="Take it off your saved isotopes">×</button></span>`; }).join('')}</div></div>` : ''}`;
  $('pdetail').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.my !== undefined) { // a saved one: show it here
      const m = MYISO[+b.dataset.my]; if (!m) return;
      UI.ptSel = { Z: m.Z, A: m.A, q: m.bare ? 0 : m.charge || 0, bare: !!m.bare, anti: !!m.anti };
      if (!!m.anti !== anti) buildPTGrid(!!m.anti);
      renderPTDetail(); return;
    }
    if (b.dataset.myx !== undefined) { // first press arms it, the second takes it off
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Remove'; return; }
      const m = MYISO[+b.dataset.myx]; if (m) myIsoToggle(m);
      renderPTDetail(); return;
    }
    if (b.id === 'ptSave') { myIsoToggle(spec); renderPTDetail(); return; }
    if (b.dataset.a2) { s.A = +b.dataset.a2; renderPTDetail(); }
    else if (b.dataset.q) { s.q = clamp(s.q + +b.dataset.q, minQ, maxQ); renderPTDetail(); }
    else if (b.id === 'ptUse') { hideModal('ptModal'); selectSpec(spec); }
    else if (b.id === 'ptBuild') { hideModal('ptModal'); openNucBuilder({ Z: s.Z, N: s.A - s.Z, ne, anti }); }
  };
  $('ptBare').onchange = (e) => { s.bare = e.target.checked; renderPTDetail(); };
}
/* ------------------------------------------------------------------ molecule library picker */
const MOL_UI = { cat: '', q: '', bound: false };
const _molThumb = new Map(), _molPlain = new Map();
function molPlainFormula(k) {
  let f = _molPlain.get(k);
  if (!f) { f = hill(MOLECULES[k].atoms.map(a => ({ el: ELEMENTS[SYM2Z[a[0]]], q: a[3] || 0 })), true); _molPlain.set(k, f); }
  return f;
}
/* Structure drawing for a library card: the molecule as it will appear in the chamber. */
function molThumb(k) {
  let svg = _molThumb.get(k);
  if (svg) return svg;
  const m = MOLECULES[k], A = m.atoms, VW = 120, VH = 76, pad = 5;
  const rad = A.map(a => 0.3 + 0.28 * ELEMENTS[SYM2Z[a[0]]].rc);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  A.forEach((a, i) => { x0 = Math.min(x0, a[1] - rad[i]); x1 = Math.max(x1, a[1] + rad[i]); y0 = Math.min(y0, a[2] - rad[i]); y1 = Math.max(y1, a[2] + rad[i]); });
  const s = Math.min((VW - 2 * pad) / (x1 - x0), (VH - 2 * pad) / (y1 - y0), 20);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, X = (x) => +(VW / 2 + (x - cx) * s).toFixed(1), Y = (y) => +(VH / 2 - (y - cy) * s).toFixed(1);
  const lw = clamp(0.12 * s, 0.9, 2.2);
  let out = `<g stroke="#8a9db1" stroke-width="${lw.toFixed(2)}" stroke-linecap="round">`;
  for (const [i, j, o] of m.bonds) {
    const ax = X(A[i][1]), ay = Y(A[i][2]), bx = X(A[j][1]), by = Y(A[j][2]);
    const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L, off = Math.max(1.6, 0.13 * s);
    for (let t = 0; t < o; t++) {
      const d = (t - (o - 1) / 2) * off;
      out += `<line x1="${(ax + nx * d).toFixed(1)}" y1="${(ay + ny * d).toFixed(1)}" x2="${(bx + nx * d).toFixed(1)}" y2="${(by + ny * d).toFixed(1)}"/>`;
    }
  }
  out += '</g>';
  A.forEach((a, i) => { out += `<circle cx="${X(a[1])}" cy="${Y(a[2])}" r="${Math.max(1.4, rad[i] * s * 0.82).toFixed(1)}" fill="${ELEMENTS[SYM2Z[a[0]]].color}" stroke="rgba(0,0,0,.45)" stroke-width=".6"/>`; });
  svg = `<svg viewBox="0 0 ${VW} ${VH}" aria-hidden="true" focusable="false">${out}</svg>`;
  _molThumb.set(k, svg);
  return svg;
}
function molCard(k) {
  const m = MOLECULES[k];
  const card = `<button class="mcard" data-m="${k}" title="${esc(m.name + ' — ' + m.note)}"><span class="mth">${molThumb(k)}</span><span class="mtx"><span class="mn">${esc(m.name)}</span><span class="mf">${esc(specLabel({ kind: 'mol', mol: k }))}</span></span></button>`;
  if (!m.mine) return card;
  const from = m.cat === 'custom' ? 'My molecules' : 'the library (added by Claude or you)';
  return `<div class="mcwrap">${card}<button class="mdel" data-del="${k}" aria-label="Remove ${esc(m.name)} from ${from}" title="Remove from ${from}">×</button></div>`;
}
function molCatName(c) { const r = MOLECULE_CATS.find(x => x[0] === c); return r ? r[1] : c; }
/* Search: names first, then formulas (typed plainly: c2h6o), then the notes and categories. */
function molSearch(q) {
  const t = q.trim().toLowerCase(), tf = t.replace(/\s+/g, '');
  const out = [];
  for (const k in MOLECULES) {
    const m = MOLECULES[k], n = m.name.toLowerCase(), f = molPlainFormula(k).toLowerCase();
    let sc = 0;
    if (n.startsWith(t) || n.split(/[\s(,-]+/).some(w => w.startsWith(t))) sc = 4;
    else if (n.includes(t)) sc = 3;
    else if (f === tf) sc = 3.5;
    else if (tf.length >= 2 && f.startsWith(tf)) sc = 2;
    else if (m.note.toLowerCase().includes(t) || molCatName(m.cat).toLowerCase().includes(t)) sc = 1;
    if (sc && (!MOL_UI.cat || m.cat === MOL_UI.cat)) out.push([sc, k]);
  }
  return out.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}
function renderMolList() {
  const box = $('mgrid'), q = MOL_UI.q.trim();
  let html = '';
  if (q) {
    const ks = molSearch(q);
    html = ks.length ? `<div class="mgrid">${ks.map(molCard).join('')}</div>`
      : `<p class="mempty">No molecule matches “${esc(q)}”${MOL_UI.cat ? ' in ' + esc(molCatName(MOL_UI.cat)) : ''}. Try a formula such as C2H6O, or a word such as acid.</p>`;
    if (AI.sample) html += `<p class="mask"><button class="btn small" data-ai="1">Ask Claude to build “${esc(q.slice(0, 60))}”</button> <span class="help">Claude answers with a recipe and the builder makes it, checking every bond. It uses your own Claude usage.</span></p>`;
  } else {
    for (const [c, name] of MOLECULE_CATS) {
      if (MOL_UI.cat && c !== MOL_UI.cat) continue;
      const ks = Object.keys(MOLECULES).filter(k => MOLECULES[k].cat === c);
      if (!ks.length) continue;
      html += `<section class="msec">${MOL_UI.cat ? '' : `<h3>${esc(name)}</h3>`}<div class="mgrid">${ks.map(molCard).join('')}</div></section>`;
    }
  }
  box.innerHTML = html;
  box.scrollTop = 0;
  for (const b of $('molCats').querySelectorAll('.mcat')) b.setAttribute('aria-pressed', String(b.dataset.c === MOL_UI.cat));
}
function renderMolCats() {
  const n = Object.keys(MOLECULES).length, count = (c) => Object.values(MOLECULES).filter(m => m.cat === c).length;
  if (MOL_UI.cat && !count(MOL_UI.cat)) MOL_UI.cat = '';
  $('molCount').textContent = String(n);
  $('molSearch').placeholder = `Search ${n} molecules by name, formula or use`;
  $('molCats').innerHTML = `<button class="mcat" data-c="" aria-pressed="true">All<span>${n}</span></button>` +
    MOLECULE_CATS.filter(([c]) => count(c)).map(([c, name]) => `<button class="mcat" data-c="${c}" aria-pressed="false">${esc(name)}<span>${count(c)}</span></button>`).join('');
}
function openMol() {
  renderMolCats(); // again each time: My molecules can change
  if (!MOL_UI.bound) {
    MOL_UI.bound = true;
    $('molCats').onclick = (e) => { const b = e.target.closest('.mcat'); if (!b) return; MOL_UI.cat = b.dataset.c; renderMolList(); };
    $('molSearch').addEventListener('input', (e) => { MOL_UI.q = e.target.value; renderMolList(); });
    $('molSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; MOL_UI.q = ''; renderMolList(); }
      else if (e.key === 'Enter') { const b = $('mgrid').querySelector('.mcard'); if (b) b.click(); }
    });
    $('mgrid').onclick = (e) => {
      if (e.target.closest('[data-ai]')) { const q = MOL_UI.q.trim(); openMolBuilder(); $('aiAsk').value = q; aiAsk(q); return; }
      const del = e.target.closest('.mdel');
      if (del) { // first press arms it, the second removes
        if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Remove'; return; }
        myMolRemove(del.dataset.del); renderMolCats(); renderMolList(); return;
      }
      const b = e.target.closest('.mcard'); if (!b) return; hideModal('molModal'); selectSpec({ kind: 'mol', mol: b.dataset.m });
    };
  }
  renderMolList();
  showModal('molModal');
  if (window.matchMedia('(pointer: fine)').matches) { const s = $('molSearch'); s.focus(); s.select(); }
}
let _lastFocus = null;
function showModal(id) { _lastFocus = document.activeElement; const m = $(id); m.hidden = false; const f = m.querySelector('button'); if (f) f.focus(); }
function hideModal(id) { $(id).hidden = true; if (_lastFocus && _lastFocus.focus) _lastFocus.focus(); }

/* ------------------------------------------------------------------ stage input */
function evPos(e) { const r = R.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
const isObject = (s) => !!s && s.kind === 'mol' && molWhole(MOLECULES[s.mol]);
/* A tiny object (hundreds of atoms) goes down one at a time, as drawn (not turned), with room made for it: the box
   grows if it is too small (a free expansion), and the object takes the clear spot nearest the click. */
function placeObject(spec, x, y) {
  const M = MOLECULES[spec.mol], m = 3;
  let cx = 0, cy = 0; for (const a of M.atoms) { cx += a[1]; cy += a[2]; } cx /= M.atoms.length; cy /= M.atoms.length;
  let hx = 0, hy = 0; for (const a of M.atoms) { hx = Math.max(hx, Math.abs(a[1] - cx)); hy = Math.max(hy, Math.abs(a[2] - cy)); }
  const needW = 2 * (hx + m), needH = 2 * (hy + m);
  if (W.box.w < needW || W.box.h < needH) {
    const asp = W.box.h / W.box.w, w = Math.max(W.box.w, needW, needH / asp);
    W.box.w = W.box.tw = w; W.box.h = W.box.th = Math.max(w * asp, needH);
    W.dirty++; fitView(); syncLab();
    log('tool', `The box opened to ${fmtNum(W.box.w / 10, 3)} × ${fmtNum(W.box.h / 10, 3)} nm to fit ${M.name}`);
  }
  const lx = W.box.w / 2 - hx - m, ly = W.box.h / 2 - hy - m;
  const ps = spawnSpec(spec, clamp(x, -lx, lx), clamp(y, -ly, ly));
  if (!ps.length) return [];
  const skip = new Set(ps), x0 = ps.reduce((s, p) => s + p.x, 0) / ps.length, y0 = ps.reduce((s, p) => s + p.y, 0) / ps.length;
  const cand = [[0, 0]], st = Math.max(2, Math.min(hx, hy));
  for (let gx = -lx; gx <= lx + 1e-9; gx += st) for (let gy = -ly; gy <= ly + 1e-9; gy += st) cand.push([gx - x0, gy - y0]);
  cand.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  for (const [dx, dy] of cand) {
    if (Math.abs(x0 + dx) > lx + 1e-6 || Math.abs(y0 + dy) > ly + 1e-6 || crowdedAt(ps, dx, dy, skip)) continue;
    for (const p of ps) { p.x += dx; p.y += dy; }
    W.dirty++;
    return ps;
  }
  // nowhere clear: the box opens up sideways (a free expansion), and the object goes into the new, empty space
  const w0 = W.box.w;
  W.box.w = W.box.tw = w0 + 2 * needW; W.box.h = W.box.th = Math.max(W.box.h, needH);
  const dx = w0 / 2 + needW / 2 - x0, dy = clamp(y0, -(W.box.h / 2 - hy - m), W.box.h / 2 - hy - m) - y0;
  for (const p of ps) { p.x += dx; p.y += dy; }
  W.dirty++; fitView(); syncLab();
  log('tool', `The box opened to ${fmtNum(W.box.w / 10, 3)} nm wide to make room for ${M.name}`);
  return ps;
}
function placeSpec(spec, x, y, count) {
  if (isObject(spec)) return placeObject(spec, x, y);
  const out = [];
  const sz = specSize(spec);
  for (let i = 0; i < count; i++) {
    let px = x, py = y;
    if (count > 1) { const a = i * 2.39996, rr = sz * 1.9 * Math.sqrt(i + 0.5); px += rr * Math.cos(a); py += rr * Math.sin(a); }
    const ps = spawnClear(spec, px, py);
    for (const p of ps) out.push(p);
  }
  return out;
}
function brushFor(tool) {
  switch (tool) {
    case 'pull': return { r: OPT.pull.R, c: OPT.pull.mode === 'pull' ? 'rgba(122,180,255,0.6)' : 'rgba(255,150,120,0.6)' };
    case 'heat': return { r: OPT.heat.R, c: OPT.heat.mode === 'cool' ? 'rgba(90,200,255,0.7)' : 'rgba(255,140,80,0.7)' };
    case 'spark': return { r: OPT.spark.R, c: 'rgba(255,220,120,0.7)' };
    case 'erase': return { r: OPT.erase.R, c: 'rgba(255,255,255,0.55)' };
  }
  return null;
}
function magnetAt(x, y) { for (let i = W.magnets.length - 1; i >= 0; i--) { const m = W.magnets[i]; if (Math.hypot(m.x - x, m.y - y) < m.R) return m; } return null; }

const UNDO_TOOLS = new Set(['place', 'erase', 'fire', 'spark', 'heat', 'pull', 'magnet', 'light']); // (tools that change the world when pressed: undo can take them back)
function onDown(e) {
  R.cv.setPointerCapture(e.pointerId);
  const [px, py] = evPos(e);
  UI.pointers.set(e.pointerId, { x: px, y: py });
  hideTip();
  if (UI.pointers.size === 2) { // pinch: cancel any tool action
    endToolAction();
    const [a, b] = [...UI.pointers.values()];
    UI.drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: R.s, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], c0: [R.cx, R.cy] };
    return;
  }
  const rc = e.button === 2 || (e.button === 0 && e.ctrlKey && e.pointerType === 'mouse'); // (Ctrl-click: a Mac's right-click)
  if (!rc) lpStart(e, px, py);
  if (QM.open) { closeQuickMenu(); if (!rc) { UI.drag = { kind: 'none' }; return; } } // a click outside the menu only closes it
  if (e.button === 1 || rc || UI.spaceDown) { UI.drag = { kind: 'pan', x: px, y: py, cx: R.cx, cy: R.cy, rc }; return; }
  const [wx, wy] = s2w(px, py);
  const t = UI.tool;
  if (UI.pasting) { // a paste picked up with Ctrl+V: this click puts it down (Shift: and keeps it for another)
    const n = W.parts.length;
    undoMark('Paste'); pasteClip(wx, wy);
    if (!e.shiftKey || W.parts.length === n) cancelPaste(); else { R.ghost = { clip: UI.clip, x: wx, y: wy }; }
    UI.drag = { kind: 'none' };
    return;
  }
  if (REW.open && (UNDO_TOOLS.has(t) || t === 'grab' || t === 'select')) rewCommit(false); // (changing the world shown: carry on from it)
  if (UNDO_TOOLS.has(t)) undoMark((TOOLS.find(x => x.id === t) || { name: t }).name);
  switch (t) {
    case 'place': {
      const sp = UI.spec || SPEC_P;
      placeSpec(sp, wx, wy, OPT.place.count);
      UI.drag = isObject(sp) ? null : { kind: 'spray', lx: wx, ly: wy }; // (objects: one per click)
      break;
    }
    case 'grab': {
      const p = pickNear(px, py, 40);
      if (p) {
        undoMark('Grab');
        W.grab = { p, x: wx, y: wy, s: OPT.grab.s, mol: OPT.grab.mol && p.k === NUC && p.bonds.length ? molecule(p) : null };
        if (p.rad || p.fast) { p.rad = false; p.fast = false; p.KE = 0; p.vx = 0; p.vy = 0; }
        UI.drag = { kind: 'grab' };
      } else UI.drag = { kind: 'pan', x: px, y: py, cx: R.cx, cy: R.cy };
      break;
    }
    case 'pull':
      W.tool = { type: 'pull', active: true, x: wx, y: wy, R: OPT.pull.R, s: OPT.pull.mode === 'pull' ? pullU() : -pullU() };
      UI.drag = { kind: 'tool' };
      break;
    case 'heat':
      W.tool = { type: 'heat', active: true, x: wx, y: wy, R: OPT.heat.R, T: heatT() };
      UI.drag = { kind: 'tool' };
      break;
    case 'spark':
      spark(wx, wy, OPT.spark.R, sparkE());
      UI.drag = { kind: 'none' };
      break;
    case 'magnet': {
      const m = magnetAt(wx, wy);
      if (m) UI.drag = { kind: 'magnet', m, ox: m.x - wx, oy: m.y - wy };
      else {
        const nm = { x: wx, y: wy, R: OPT.magnet.R, B: magB() };
        W.magnets.push(nm);
        log('tool', `Magnet placed: ${magB() >= 0 ? 'N' : 'S'} pole, ${fmtTesla(Math.abs(nm.B))}`);
        UI.drag = { kind: 'magnet', m: nm, ox: 0, oy: 0 };
      }
      break;
    }
    case 'fire': case 'light':
      UI.drag = { kind: t, x0: wx, y0: wy, x1: wx, y1: wy, acc: 0 };
      break;
    case 'erase':
      eraseHere(wx, wy);
      UI.drag = { kind: 'erase' };
      break;
    case 'measure': {
      const p = pickNear(px, py, 24), m = R.measure || (R.measure = []);
      if (!p) m.length = 0; else { if (m.length >= 3) m.length = 0; if (!m.includes(p)) m.push(p); }
      UI.drag = { kind: 'none' }; buildToolOpts();
      break;
    }
    case 'inspect': {
      const p = pickAt(px, py, 10), x = p ? null : pickLight(px, py, 12);
      R.sel = p || null; R.selX = x ? { kind: x.kind, o: x.o, t0: W.rt } : null;
      if (p || x) showTab('inspect', true);
      renderInspect();
      UI.drag = { kind: 'none' };
      break;
    }
    case 'select': {
      const p = pickAt(px, py, 8);
      if (p && R.msel.has(p) && !e.shiftKey) UI.drag = { kind: 'selmove', lx: wx, ly: wy, moved: false }; // on the selection: drag moves it
      else UI.drag = { kind: 'selbox', x0: wx, y0: wy, x1: wx, y1: wy, px, py, add: e.shiftKey, hit: p };
      break;
    }
  }
}
/* ------------------------------------------------------------------ selection, copy and paste (the Select tool) */
function selCount() { let n = 0; for (const p of R.msel) if (!p.dead) n++; return n; }
function selChanged() { if (UI.tool === 'select') buildToolOpts(); }
function clearSelection() { R.msel.clear(); selChanged(); }
function selectAll() { R.msel.clear(); for (const p of W.parts) if (!p.dead && selectable(p)) R.msel.add(p); if (UI.tool !== 'select') setTool('select'); selChanged(); }
const selectable = (p) => (p.k === NUC || p.k === ELEC || p.k === POS) && !p.beam; // (photons, flying exotics and a collider's beams are not picked up)
/* The box, done: everything inside it (and, if asked, the rest of each molecule touched). */
function finishSelBox(d) {
  const tiny = Math.hypot(w2sx(d.x1) - d.px, w2sy(d.y1) - d.py) < 4; // (a click, not a box)
  if (!d.add) R.msel.clear();
  let picked = [];
  if (tiny) { if (d.hit && selectable(d.hit)) picked = [d.hit]; }
  else {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    for (const p of W.parts) if (!p.dead && selectable(p) && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) picked.push(p);
  }
  for (const p of picked) {
    if (d.add && tiny && R.msel.has(p)) { // Shift-click on a selected particle: out it goes (its molecule with it, when molecules are picked whole)
      const g = OPT.select.whole && p.k === NUC && p.bonds.length ? molecule(p) : [p];
      for (const a of g) R.msel.delete(a);
      continue;
    }
    R.msel.add(p);
    if (OPT.select.whole && p.k === NUC && p.bonds.length) for (const a of molecule(p)) if (!a.dead) R.msel.add(a);
  }
  selChanged();
}
function moveSelection(ddx, ddy) {
  const g = [...R.msel].filter(a => !a.dead); if (!g.length) return;
  const skip = R.msel, stuck = crowdedAt(g, 0, 0, skip);
  for (const f of [1, 0.5, 0.25]) {
    if (!stuck && crowdedAt(g, ddx * f, ddy * f, skip)) continue;
    for (const a of g) { a.x += ddx * f; a.y += ddy * f; if (a.rad) { a.rad = false; a.KE = 0; } a.vx = 0; a.vy = 0; if (a.fast) { a.fast = false; updateFast(a); } }
    keepInside(g); W.dirty++; W.spawned++; break;
  }
}
function deleteSelection() {
  let n = 0; for (const p of R.msel) if (!p.dead) { kill(p); n++; }
  R.msel.clear(); if (R.sel && R.sel.dead) { R.sel = null; renderInspect(); }
  if (n) log('tool', `Deleted ${n.toLocaleString('en-US')} selected particle${n === 1 ? '' : 's'}`);
  selChanged();
}
/* The clipboard: the selected nuclei, atoms, ions and free leptons, relative to their centre, with the bonds among them. */
function copySelection() {
  const ps = [...R.msel].filter(p => !p.dead && selectable(p));
  if (!ps.length && R.sel && !R.sel.dead && selectable(R.sel)) ps.push(R.sel);
  if (!ps.length) return;
  let cx = 0, cy = 0; for (const p of ps) { cx += p.x; cy += p.y; } cx /= ps.length; cy /= ps.length;
  const idx = new Map(ps.map((p, i) => [p, i]));
  const parts = ps.map(p => ({ k: p.k, Z: p.Z, N: p.N, ne: p.ne, anti: !!p.anti, dx: p.x - cx, dy: p.y - cy, rd: p.k === NUC ? p.rd : 0.15, el: p.el }));
  const bonds = [];
  for (const p of ps) for (const bd of p.bonds) { const i = idx.get(bd.a), j = idx.get(bd.b); if (i !== undefined && j !== undefined && bd.a === p) bonds.push([i, j, bd.order]); }
  // working parts (transistors, gates, memory cells) whose atoms are all in the selection go with it, wired and in the
  // state they are in; a gate fed by another copied gate stays fed by its copy
  const whole = W.chips.filter(ch => ch.ps.every(p => idx.has(p)));
  const chips = whole.map(ch => ({ key: ch.key, at: ch.ps.map(p => idx.get(p)), v: { ...ch.v }, nfg: ch.nfg, drive: ch.drive ? { ...ch.drive } : null,
    label: ch.label, broken: ch.broken, nb0: ch.nb0, q0: ch.q0 ? ch.q0.slice() : null, inFrom: ch.inFrom ? whole.indexOf(ch.inFrom) : -1 }));
  const partial = W.chips.filter(ch => !whole.includes(ch) && ch.ps.some(p => idx.has(p))).length;
  UI.clip = { parts, bonds, chips, at: W.rt };
  log('tool', `Copied ${parts.length.toLocaleString('en-US')} particle${parts.length === 1 ? '' : 's'}${bonds.length ? ` and ${bonds.length.toLocaleString('en-US')} bond${bonds.length === 1 ? '' : 's'}` : ''}${chips.length ? `, with ${chips.length} working part${chips.length === 1 ? '' : 's'}` : ''}${partial ? ` (${partial} part${partial === 1 ? ' is' : 's are'} only partly selected: those atoms paste as plain atoms)` : ''}`);
  selChanged();
}
/* Ctrl+V picks the copy up: it follows the pointer as a ghost until a click puts it down (onDown), so it lands exactly
   where it is wanted; Escape or another tool puts it away. */
function armPaste() {
  if (!UI.clip || !UI.clip.parts.length) return;
  if (UI.tool !== 'select') setTool('select');
  UI.pasting = true;
  const m = UI.mouse, inside = m && m[0] >= 0 && m[1] >= 0 && m[0] <= R.w && m[1] <= R.h, [wx, wy] = inside ? s2w(m[0], m[1]) : [R.cx, R.cy];
  R.ghost = { clip: UI.clip, x: wx, y: wy };
  buildToolOpts();
}
function cancelPaste() { UI.pasting = false; R.ghost = null; if (UI.tool === 'select') buildToolOpts(); }
/* Paste at a point (the pointer, or the middle of the view): the copies are nudged to a clear spot nearby if they would land
   on something, given one thermal velocity as a group, and become the selection (so they can be moved or pasted again). */
function pasteClip(wx, wy) {
  const c = UI.clip; if (!c || !c.parts.length) return;
  if (wx === undefined) { const m = UI.mouse, inside = m && m[0] >= 0 && m[1] >= 0 && m[0] <= R.w && m[1] <= R.h; [wx, wy] = inside ? s2w(m[0], m[1]) : [R.cx, R.cy]; }
  if (W.parts.length + c.parts.length > MAX_PARTS) { log('tool', `Paste: no room for ${c.parts.length.toLocaleString('en-US')} more particles (the limit is ${MAX_PARTS.toLocaleString('en-US')}; Settings → Max particles)`); return; }
  const made = c.parts.map(q => q.k === NUC ? addNuc(q.Z, q.N, q.ne, wx + q.dx, wy + q.dy, 0, 0, q.anti) : addLepton(q.k, wx + q.dx, wy + q.dy, 0, 0));
  for (const [i, j, o] of c.bonds) if (made[i] && made[j]) addBond(made[i], made[j], o);
  // a clear spot near the pointer (as the Place tool finds one); none within a few radii of the group: nothing is pasted,
  // rather than copies landing on top of what is there (which would fly apart hot)
  keepInside(made);
  let r = 0; for (const q of c.parts) r = Math.max(r, Math.hypot(q.dx, q.dy));
  if (!placeClear(made, Math.max(8, 2 * r + 4))) {
    for (const p of made) kill(p);
    log('tool', `Paste: no clear spot for ${made.length.toLocaleString('en-US')} particle${made.length === 1 ? '' : 's'} near the pointer; try an emptier place, or the Erase tool first`);
    return;
  }
  let mt = 0; for (const p of made) mt += p.m;
  const [vx, vy] = thermalV(mt, W.T);
  for (const p of made) { p.vx = vx; p.vy = vy; p.ox = p.x; p.oy = p.y; updateFast(p); }
  W.dirty++;
  const nch = c.chips ? c.chips.length : 0;
  if (nch) { // the copied working parts, wired up on the new atoms and set as they were
    const mk = c.chips.map(q => { const ch = chipAdd(q.key, q.at.map(i => made[i])); if (!ch) return null;
      ch.v = { ...q.v }; if (q.nfg !== undefined) ch.nfg = q.nfg; if (q.drive) ch.drive = { ...q.drive };
      ch.label = q.label ? q.label + ' (copy)' : ''; ch.broken = q.broken; if (q.nb0 !== undefined) ch.nb0 = q.nb0; if (q.q0) ch.q0 = q.q0.slice(); return ch; });
    c.chips.forEach((q, k) => { if (mk[k] && q.inFrom >= 0) mk[k].inFrom = mk[q.inFrom]; });
  }
  R.msel.clear(); for (const p of made) R.msel.add(p);
  if (UI.tool !== 'select') setTool('select');
  log('tool', `Pasted ${made.length.toLocaleString('en-US')} particle${made.length === 1 ? '' : 's'}${nch ? `, with ${nch} working part${nch === 1 ? '' : 's'}` : ''}`);
  selChanged();
}
/* The particle under the pointer, or failing that the nearest one within maxPx: hot atoms move several
   pixels per frame, so an exact hit is hard. */
function pickNear(px, py, maxPx) {
  const hit = pickAt(px, py, 10);
  if (hit) return hit;
  let best = null, bd = maxPx * maxPx;
  for (const p of W.parts) {
    if (p.dead) continue;
    const dx = w2sx(p.x) - px, dy = w2sy(p.y) - py, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = p; }
  }
  return best;
}
function eraseHere(wx, wy) {
  const r = OPT.erase.R;
  const n = eraseAt(wx, wy, r);
  for (let i = W.magnets.length - 1; i >= 0; i--) if (Math.hypot(W.magnets[i].x - wx, W.magnets[i].y - wy) < W.magnets[i].R) W.magnets.splice(i, 1);
  for (let i = W.sources.length - 1; i >= 0; i--) if (Math.hypot(W.sources[i].x - wx, W.sources[i].y - wy) < r + 1.5) W.sources.splice(i, 1);
  for (let i = W.lasers.length - 1; i >= 0; i--) if (Math.hypot(W.lasers[i].x0 - wx, W.lasers[i].y0 - wy) < r + 1.5) W.lasers.splice(i, 1);
  if (R.sel && R.sel.dead) R.sel = null;
  return n;
}
function onMove(e) {
  const [px, py] = evPos(e);
  if (UI.pointers.has(e.pointerId)) UI.pointers.set(e.pointerId, { x: px, y: py });
  UI.mouse = [px, py];
  const [wx, wy] = s2w(px, py);
  if (UI.pasting && R.ghost) { R.ghost.x = wx; R.ghost.y = wy; }
  lpMove(e, px, py);
  const d = UI.drag;
  if (d && d.kind === 'pinch' && UI.pointers.size >= 2) {
    const [a, b] = [...UI.pointers.values()];
    const dd = Math.hypot(a.x - b.x, a.y - b.y);
    const s = clamp(d.s0 * dd / Math.max(10, d.d0), 0.01, ZOOM_MAX);
    const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    // keep the world point under the initial midpoint under the current midpoint
    const wmx = (d.mid[0] - R.w / 2) / d.s0 + d.c0[0], wmy = d.c0[1] - (d.mid[1] - R.h / 2) / d.s0;
    R.s = s; R.cx = wmx - (mid[0] - R.w / 2) / s; R.cy = wmy + (mid[1] - R.h / 2) / s;
    return;
  }
  if (d) {
    switch (d.kind) {
      case 'pan': R.cx = d.cx - (px - d.x) / R.s; R.cy = d.cy + (py - d.y) / R.s; if (Math.hypot(px - d.x, py - d.y) >= 6) R.follow = null; break;
      case 'spray': {
        const sp = UI.spec || SPEC_P, gap = Math.max(1.4, specSize(sp) * 2.2);
        if (Math.hypot(wx - d.lx, wy - d.ly) >= gap) { placeSpec(sp, wx, wy, 1); d.lx = wx; d.ly = wy; }
        break;
      }
      case 'grab':
        if (W.grab) {
          if (!UI.running && W.grab.p && !W.grab.p.dead) {
            // paused: move the atoms directly, but never into another atom (that would go off on resume)
            const ddx = wx - W.grab.x, ddy = wy - W.grab.y, g = (W.grab.mol || [W.grab.p]).filter(a => !a.dead), skip = new Set(g);
            const stuck = crowdedAt(g, 0, 0, skip); // already touching something: let it be pulled clear
            for (const f of [1, 0.5, 0.25]) {
              if (!stuck && crowdedAt(g, ddx * f, ddy * f, skip)) continue;
              for (const a of g) { a.x += ddx * f; a.y += ddy * f; a.vx = 0; a.vy = 0; }
              keepInside(g); W.dirty++; break;
            }
          }
          W.grab.x = wx; W.grab.y = wy;
        }
        break;
      case 'tool': if (W.tool) { W.tool.x = wx; W.tool.y = wy; } break;
      case 'magnet': d.m.x = wx + d.ox; d.m.y = wy + d.oy; break;
      case 'fire': case 'light': d.x1 = wx; d.y1 = wy; break;
      case 'erase': eraseHere(wx, wy); break;
      case 'selbox': d.x1 = wx; d.y1 = wy; break;
      case 'selmove': moveSelection(wx - d.lx, wy - d.ly); d.lx = wx; d.ly = wy; d.moved = true; break;
    }
  } else if (!QM.open) updateHover(px, py, wx, wy);
  const b = brushFor(UI.tool);
  R.overlay = b ? { x: wx, y: wy, brush: b.r, color: b.c } : null;
  if (UI.tool === 'magnet' && !d) R.overlay = { x: wx, y: wy, ghostMagnet: { R: OPT.magnet.R, B: magB() } };
  if (d && (d.kind === 'fire' || d.kind === 'light')) R.overlay = { aim: aimOverlay(d) };
  if (d && d.kind === 'selbox') R.overlay = { box: [d.x0, d.y0, d.x1, d.y1] };
}
function aimOverlay(d) {
  const L = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
  if (d.kind === 'fire') {
    const sp = fireSpecNow() || SPEC_P;
    return { x0: d.x0, y0: d.y0, x1: L > 0.3 ? d.x1 : d.x0 + 3, y1: L > 0.3 ? d.y1 : d.y0, text: `${specLabel(sp)}  ${fmtE(fireKE())}${OPT.fire.source ? '  (beam source)' : ''}` };
  }
  const w = wavelengthText(lightE());
  return { x0: d.x0, y0: d.y0, x1: L > 0.3 ? d.x1 : d.x0 + 3, y1: L > 0.3 ? d.y1 : d.y0, text: `${w.lam}  ${w.band}`, color: lightSwatch(lightE()) };
}
function endToolAction() {
  const d = UI.drag;
  if (d && d.kind === 'selbox') { finishSelBox(d); R.overlay = null; }
  if (d && d.kind === 'light' && OPT.light.mount) {
    let ux = d.x1 - d.x0, uy = d.y1 - d.y0; const L = Math.hypot(ux, uy);
    if (L < 0.3) { ux = 1; uy = 0; } else { ux /= L; uy /= L; }
    if (W.lasers.length >= 12) W.lasers.shift();
    W.lasers.push({ x0: d.x0, y0: d.y0, ux, uy, E: lightE(), rate: OPT.light.rate, acc: 0 });
    log('tool', `Laser on: ${wavelengthText(lightE()).lam}, ${OPT.light.rate} photons/s`); buildToolOpts();
  }
  if (d && d.kind === 'fire') {
    let ux = d.x1 - d.x0, uy = d.y1 - d.y0; const L = Math.hypot(ux, uy);
    if (L < 0.3) { ux = 1; uy = 0; } else { ux /= L; uy /= L; }
    const sp = fireSpecNow() || SPEC_P, KE = fireKE();
    if (OPT.fire.source) {
      W.sources.push({ x: d.x0, y: d.y0, ux, uy, spec: sp, KE, rate: OPT.fire.rate / 10, acc: 0 });
      log('tool', `Beam source: ${specLabel(sp)} at ${fmtE(KE)}, ${OPT.fire.rate} per 100 fs`);
    } else {
      fireSpec(sp, d.x0, d.y0, ux, uy, KE);
      log('tool', `Fired ${specLabel(sp)} at ${fmtE(KE)}`);
    }
  }
  if (W.tool) W.tool.active = false;
  W.grab = null;
  UI.drag = null;
  if (R.overlay && R.overlay.aim) R.overlay = null;
}
/* Grab, Strong and Very strong: it keeps up with the mouse in real time, whatever the speed setting or slow motion.
   The spring may draw the atoms along faster (vcap: the gap closed in about 0.12 s of watching, up to the strength's
   limit), and where simulated time crawls (slow motion, a heavy world) the hand itself carries what it holds toward
   the cursor between frames, as it does while paused: moved, not thrown (their own velocities are kept), and never
   into another atom. A single atom carried off its molecule tears its bonds, as a hand would. Gentle is the spring
   alone, as before. */
function grabTick(realDt) {
  const g = W.grab; if (!g || !g.p || g.p.dead) return;
  const rate = Math.max(1e-12, UI.adv || W.simPerFrame) * 60, gx = g.x - g.p.x, gy = g.y - g.p.y, dist = Math.hypot(gx, gy); // (rate: simulated time per second of watching)
  g.vcap = clamp(dist / (0.12 * rate), GRAB_V, GRAB_VMAX[g.s] || GRAB_V);
  if (g.s === 'gentle' || dist < 0.5) return;
  const f = 1 - Math.exp(-Math.min(0.1, realDt) / 0.05), ddx = gx * f, ddy = gy * f;
  const grp = (g.mol || [g.p]).filter(a => !a.dead), skip = new Set(grp), stuck = crowdedAt(grp, 0, 0, skip);
  const L = Math.hypot(ddx, ddy);
  for (const k of [1, 0.5, 0.25, 0.6 / L, 0.25 / L]) { // (in a crowd, a smaller step slips between the neighbours)
    if (!(k > 0 && k <= 1) || (!stuck && crowdedAt(grp, ddx * k, ddy * k, skip))) continue;
    for (const a of grp) { a.x += ddx * k; a.y += ddy * k; }
    keepInside(grp); W.dirty++; break;
  }
}
/* Let go: with Strong or Very strong, what was held keeps its own jiggle but not the speed it was being drawn at (no
   flinging it across the box at tens of km/s). */
function grabRelease(g) {
  if (!g || !g.p || g.s === 'gentle' || !UI.running) return;
  const as = (g.mol || [g.p]).filter(a => !a.dead && !a.rad); let m = 0, px = 0, py = 0;
  for (const a of as) { m += a.m; px += a.m * a.vx; py += a.m * a.vy; }
  if (!(m > 0)) return;
  const vx = px / m, vy = py / m;
  if (Math.hypot(vx, vy) <= GRAB_V) return;
  for (const a of as) { a.vx -= vx; a.vy -= vy; updateFast(a); }
}
function onUp(e) {
  lpEnd();
  UI.pointers.delete(e.pointerId);
  if (UI.drag && UI.drag.kind === 'pinch') { if (UI.pointers.size < 2) UI.drag = null; return; }
  const d = UI.drag;
  if (d && d.kind === 'grab') grabRelease(W.grab);
  endToolAction();
  if (d && d.rc && e.type === 'pointerup') { const [px, py] = evPos(e); if (Math.hypot(px - d.x, py - d.y) < 6) openQuickMenu(px, py); } // a right-click that did not pan
}
function onWheel(e) {
  e.preventDefault();
  closeQuickMenu();
  const [px, py] = evPos(e);
  const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015) * (SET.wheel || 1)); // (Settings → Controls: speed, and toward the mouse or the centre)
  if (SET.zoomTo === 'centre') zoomAt(R.w / 2, R.h / 2, f); else zoomAt(px, py, f);
}
function zoomAt(px, py, f) {
  const [wx, wy] = s2w(px, py);
  R.s = clamp(R.s * f, 0.01, ZOOM_MAX);
  R.cx = wx - (px - R.w / 2) / R.s; R.cy = wy + (py - R.h / 2) / R.s;
}
/* continuous tool effects, once per frame */
function toolTick(realDt) {
  const d = UI.drag;
  if (!UI.running) return;
  grabTick(realDt);
  if (W.ramp) rampTick(realDt);
  for (const L of W.lasers) { // lasers left on: the same light, all the time
    L.acc += L.rate * realDt;
    while (L.acc >= 1) { L.acc -= 1; const off = (rnd() - 0.5) * 0.8; emitPhoton(L.x0 - L.uy * off, L.y0 + L.ux * off, L.E, L.ux, L.uy, { travel: true }); }
  }
  if (!d) return;
  if (d.kind === 'light' && OPT.light.mount) return; // (aiming a laser: it shines once it is set down)
  if (d.kind === 'light') {
    let ux = d.x1 - d.x0, uy = d.y1 - d.y0; const L = Math.hypot(ux, uy);
    if (L < 0.3) { ux = 1; uy = 0; } else { ux /= L; uy /= L; }
    d.acc += OPT.light.rate * realDt;
    const E = lightE();
    while (d.acc >= 1) {
      d.acc -= 1;
      const off = (rnd() - 0.5) * 1.6;
      emitPhoton(d.x0 - uy * off, d.y0 + ux * off, E, ux, uy, { travel: true }); // (always watched at c: time slows while it flies)
    }
  }
}

/* ------------------------------------------------------------------ hover tooltip */
function updateHover(px, py) {
  const p = pickAt(px, py, 6);
  R.hover = p;
  const tip = $('tip');
  if (!p) { tip.hidden = true; return; }
  const ke = p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
  let t1 = '', t2 = '';
  if (p.k === ELEC || p.k === POS) { t1 = p.k === ELEC ? 'Free electron' : 'Positron (antimatter)'; t2 = `KE ${fmtE(ke)}`; }
  else if (p.Z === 0) { t1 = p.anti ? 'Antineutron' : 'Neutron'; t2 = `KE ${fmtE(ke)} · t½ ≈ 10 min`; }
  else if (p.ne === 0) { t1 = `${speciesLabel(p)} — ${p.anti && p.Z === 1 && p.N === 0 ? 'antiproton' : (p.anti ? 'anti-' : '') + nucName(p.Z, p.N) + ' nucleus'}`; t2 = `${lifeText(p.nuc)} · KE ${fmtE(ke)}`; }
  else {
    const mol = p.bonds.length ? molecule(p) : null;
    const nm = mol ? moleculeName(mol) : null, en = elemName(p);
    t1 = mol ? `${en} in ${isoFormula(mol)}${nm ? ' (' + nm + ')' : ''}` : `${en}${p.q ? ((p.anti ? -p.q : p.q) > 0 ? ' cation ' : ' anion ') + speciesLabel(p) : ' atom'}`;
    t2 = `${nucSymA(p.Z, p.N, p.anti)} · ${p.ne} ${p.anti ? 'e⁺' : 'e⁻'} · bonds ${p.used}/${p.cap}${p.tLocal ? ' · ' + fmtT(p.tLocal) : ''}`;
  }
  tip.innerHTML = `<div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div>`;
  tip.hidden = false;
  const sw = R.w, x = Math.min(px + 14, sw - tip.offsetWidth - 6), y = py + 16 + tip.offsetHeight > R.h ? py - tip.offsetHeight - 10 : py + 16;
  tip.style.left = Math.max(4, x) + 'px'; tip.style.top = y + 'px';
}
function hideTip() { $('tip').hidden = true; R.hover = null; }
/* Element name, with the anti- prefix for antimatter (antihydrogen, anti-carbon …). */
function elemName(p) { return !p.anti ? p.el.name : p.Z === 1 ? 'Antihydrogen' : 'Anti-' + p.el.name.toLowerCase(); }
function lifeText(nuc) {
  if (!nuc) return '';
  if (nuc.stable) return 'stable';
  if (nuc.unbound) return 'unbound';
  return 't½ ' + fmtTime(nuc.t12) + (nuc.estimated ? ' (est.)' : '');
}

/* ------------------------------------------------------------------ panel tabs */
function showTab(id, fromSelect) {
  UI.tab = id;
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
  for (const p of document.querySelectorAll('.tabpanel')) p.hidden = p.id !== 'tp-' + id;
  if (!fromSelect) store('tab', id);
  if (fromSelect && window.matchMedia('(max-width: 820px)').matches) $('panel').classList.add('open');
  UI.lastPanel = 0;
  if (id === 'log') UI.lastLogSeq = -1;
}

/* Panels redrawn on a timer keep the reader's place. Their content is replaced on each refresh, which made
   Chrome's scroll anchoring nudge the view up a few pixels every time (it is off in the style sheet), and a refresh
   that comes out shorter clamps the view: the reader's own position is put back once there is room again. */
const _scrollWant = {}, _scrollSet = {};
function trackScroll(id) {
  const b = $(id);
  b.addEventListener('scroll', () => { if (Math.abs(b.scrollTop - (_scrollSet[id] === undefined ? -9 : _scrollSet[id])) > 1) _scrollWant[id] = b.scrollTop; }, { passive: true });
}
function restoreScroll(id) {
  const b = $(id), want = _scrollWant[id];
  if (want !== undefined && Math.abs(b.scrollTop - want) > 1) b.scrollTop = want;
  _scrollSet[id] = b.scrollTop;
  if (want !== undefined && Math.abs(b.scrollTop - want) > 1) requestAnimationFrame(() => { // (clamped: content still filling in, such as a canvas's note; try again once it has)
    if (_scrollWant[id] === want && _scrollSet[id] === b.scrollTop) { b.scrollTop = want; _scrollSet[id] = b.scrollTop; }
  });
}

/* ------------------------------------------------------------------ inspector */
let _insCv = null;
/* ---- Inside a hadron (Inspect tab): its quarks, a sketch — the simulation does not follow quarks one by one, but pulling
   one out happens in the chamber too (quarkRip, hep.js). Valence quarks
   jiggle in a bag about 1.7 fm across, their colour charges (red, green, blue; antiquarks anticolours) swapped by
   gluons so the whole stays colourless; flux tubes join them (a Y for three quarks, a line for a quark and an
   antiquark); virtual quark–antiquark pairs flicker in the sea. Drag a quark out: the tube stretches at about 1 GeV per
   fm until it snaps and its energy makes a new pair, so a meson leaves and no quark ever comes out alone. */
const Q_COL = ['#ff5a5a', '#52d873', '#5a8cff'], Q_ACOL = ['#4fe3e3', '#e65ae6', '#ffd24d'], Q_CNAME = ['red', 'green', 'blue'];
const Q_CHG = { u: 2 / 3, d: -1 / 3, s: -1 / 3 };
const Q_SYM = { u: 'u', d: 'd', s: 's' }, Q_BAR = { u: 'ū', d: 'd̄', s: 's̄' };
const Q_CONTENT = { p: 'uud', n: 'udd', pbar: 'UUD', nbar: 'UDD', 'pi+': 'uD', 'pi-': 'dU', pi0: 'uU', 'K+': 'uS', 'K-': 'sU', K0S: 'dS', K0L: 'dS', eta: 'sS', Lam: 'uds', Lamb: 'UDS', 'Sig+': 'uus', 'Sig-': 'dds', Xi0: 'uss', 'Xi-': 'dss', 'Omg-': 'sss', 'Sigb-': 'UUS', 'Sigb+': 'DDS', Xib0: 'USS', 'Xib+': 'DSS', 'Omgb+': 'SSS' }; // (capitals: antiquarks)
const QV = { subj: null, key: '', qs: [], g: null, sea: [], drag: null, out: null, t: 0, msg: '', orig: '', pick: 'p', last: 0 };
function qSubject(p, X) { // what to look inside: { key, content, name, note }
  if (X && X.kind === 'exo' && (XP[X.o.sp].atom || XP[X.o.sp].stuck)) return null; // (a muonic atom: its nucleus is inside, too small to show here)
  if (X && X.kind === 'exo') { const c = Q_CONTENT[X.o.sp]; return c ? { key: 'x' + X.o.id, content: c, o: X.o } : { key: 'x' + X.o.id, lepton: true }; }
  if (!p || p.k !== NUC || p.Z + p.N < 1) return null;
  const one = p.Z + p.N === 1, which = one ? (p.Z ? 'p' : 'n') : (p.Z === 0 ? 'n' : p.N === 0 ? 'p' : QV.pick);
  const nm = (p.anti ? 'anti' : '') + (which === 'p' ? 'proton' : 'neutron');
  return { key: p.id + which, content: Q_CONTENT[(which) + (p.anti ? 'bar' : '')], p, one, both: !one && p.Z > 0 && p.N > 0, which, head: !one ? 'Inside one of its nucleons' : p.ne > 0 ? `Inside its nucleus, ${/^[aeiou]/.test(nm) ? 'an' : 'a'} ${nm}` : 'Inside' };
}
function qName(content) {
  const qs = [...content], anti = qs.filter(c => c === c.toUpperCase()).length, f = qs.map(c => c.toLowerCase()).sort().join('');
  const chg = Math.round(qs.reduce((s, c) => s + (c === c.toUpperCase() ? -1 : 1) * Q_CHG[c.toLowerCase()], 0));
  const cs = chg > 0 ? '⁺'.repeat(chg) : chg < 0 ? '⁻'.repeat(-chg) : '⁰';
  if (qs.length === 3) {
    const B = { duu: ['proton', 'p'], ddu: ['neutron', 'n'], uuu: ['Delta', 'Δ'], ddd: ['Delta', 'Δ'], dsu: ['Lambda', 'Λ'], suu: ['Sigma', 'Σ'], dds: ['Sigma', 'Σ'], dss: ['Xi', 'Ξ'], ssu: ['Xi', 'Ξ'], sss: ['Omega', 'Ω'] }; // (keys: the flavours sorted)
    const k = B[f] || ['baryon', 'B']; const isAnti = anti === 3;
    const sym = k[1] === 'p' ? (isAnti ? 'p̄' : 'p') : k[1] === 'n' ? (isAnti ? 'n̄' : 'n') : k[1] + (k[1] === 'Λ' ? '' : cs) + (isAnti ? ' (anti)' : '');
    return { name: (isAnti ? 'anti' : '') + k[0], sym, chg };
  }
  const has = (x) => f.includes(x), M = has('s') ? (f === 'ss' ? ['eta or phi', 'η/φ'] : ['kaon', 'K']) : ['pion', 'π'];
  return { name: M[0], sym: M[1] === 'η/φ' ? M[1] : M[1] + cs, chg };
}
function qReset(sub) {
  QV.key = sub.key; QV.orig = sub.content; QV.out = null; QV.drag = null; QV.msg = ''; QV.sea = []; QV.g = null; QV.t = 0;
  QV.qs = [...sub.content].map((c, i, a) => {
    const anti = c === c.toUpperCase(), n = a.length, ang = 2 * Math.PI * i / n + 0.3;
    return { f: c.toLowerCase(), anti, col: n === 3 ? i : 0, hx: 0.42 * Math.cos(ang), hy: 0.42 * Math.sin(ang), x: 0.42 * Math.cos(ang), y: 0.42 * Math.sin(ang), vx: 0, vy: 0, ph: rnd() * 6 };
  });
  if (QV.qs.length === 2) QV.qs[1].col = QV.qs[0].col;
}
function quarkSecHTML(sub) {
  if (!sub) return '';
  if (sub.lepton) return `<section class="group"><h3>Inside</h3><p class="note">Nothing: it is a lepton, like the electron. As far as any experiment has found, leptons are not made of anything smaller; they feel no strong force and have no quarks.</p></section>`;
  if (QV.key !== sub.key) qReset(sub);
  QV.subj = sub;
  const pick = sub.both ? `<div class="seg" data-q="pick" role="group" aria-label="Which nucleon"><button data-v="p" aria-pressed="${sub.which === 'p'}">A proton</button><button data-v="n" aria-pressed="${sub.which === 'n'}">A neutron</button></div>` : '';
  return `<section class="group" id="insQSec"><h3>${esc(sub.head || 'Inside')}: quarks and gluons</h3>${pick}
    <canvas class="quarkcv" id="insQuarks" aria-label="The quarks inside, held together by gluons. Drag a quark out to see confinement."></canvas>
    <div class="row" style="justify-content:flex-start;gap:8px"><button class="btn small" data-q="reset">Put it back</button><span class="note">Drag a quark out of it.</span></div>
    <p class="note" id="insQNote">${esc(qNote())}</p></section>`;
}
function qNote() {
  const qs = QV.qs, nm = qName(qs.map(q => q.anti ? q.f.toUpperCase() : q.f).join(''));
  const list = qs.map(q => { const c = (q.anti ? -1 : 1) * Q_CHG[q.f]; return `${q.anti ? Q_BAR[q.f] : Q_SYM[q.f]} (${c > 0 ? '+' : '−'}${Math.abs(c) > 0.5 ? '2/3' : '1/3'})`; }).join(', ');
  const chgTxt = qs.map(q => (q.anti ? -1 : 1) * Q_CHG[q.f]).reduce((a, b) => a + b, 0);
  const base = qs.length === 3
    ? `${nm.name[0].toUpperCase() + nm.name.slice(1)} (${nm.sym}): three quarks, ${list}; charges add to ${Math.round(chgTxt) > 0 ? '+' : ''}${Math.round(chgTxt)}. One of each colour charge, so the whole is colourless ("white"); gluons keep swapping the colours between them. The quarks themselves weigh only about 1% of it: the rest of its mass is the energy of the gluon field and of the quarks' motion (E = mc²).`
    : `A ${nm.name} (${nm.sym}): a quark and an antiquark, ${list}. A colour and its anticolour make it colourless; it lives only until the weak or electromagnetic force lets it decay.`;
  return (QV.msg ? QV.msg + ' ' : '') + base + ' (The picture is a sketch: the simulation does not follow quarks one by one. Pulling one out does happen in the chamber, though: what it makes appears there.)';
}
function qStep(dt) {
  QV.t += dt;
  const qs = QV.qs, n = qs.length, rot = 0.25 * dt;
  for (const q of qs) {
    const c = Math.cos(rot), s = Math.sin(rot), hx = q.hx * c - q.hy * s, hy = q.hx * s + q.hy * c; q.hx = hx; q.hy = hy;
    if (QV.drag && QV.drag.q === q) continue;
    q.ph += dt * (2 + rnd());
    const tx = q.hx + 0.18 * Math.sin(q.ph * 1.7), ty = q.hy + 0.18 * Math.cos(q.ph * 2.3);
    q.vx += (tx - q.x) * 40 * dt - q.vx * 6 * dt + (rnd() - 0.5) * 4 * dt; q.vy += (ty - q.y) * 40 * dt - q.vy * 6 * dt + (rnd() - 0.5) * 4 * dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
  }
  // a gluon carries colour from one quark to another (three quarks: two swap colours; quark–antiquark: both change)
  if (!QV.g && !QV.drag && rnd() < dt * 2.2) { const a = Math.floor(rnd() * n); let b = (a + 1 + Math.floor(rnd() * (n - 1))) % n; QV.g = { a, b, t: 0 }; }
  if (QV.g) { QV.g.t += dt / 0.35; if (QV.g.t >= 1) { const A = qs[QV.g.a], B = qs[QV.g.b];
    if (n === 3) { const t = A.col; A.col = B.col; B.col = t; } else { const c = (A.col + 1 + Math.floor(rnd() * 2)) % 3; A.col = c; B.col = c; }
    QV.g = null; } }
  // the sea: virtual quark–antiquark pairs, there and gone
  if (rnd() < dt * 1.5 && QV.sea.length < 3) { const a = rnd() * 6.28, r = 0.6 * Math.sqrt(rnd()); QV.sea.push({ x: r * Math.cos(a), y: r * Math.sin(a), f: rnd() < 0.8 ? (rnd() < 0.5 ? 'u' : 'd') : 's', t: 0, a: rnd() * 6.28 }); }
  for (const v of QV.sea) v.t += dt / 0.6;
  QV.sea = QV.sea.filter(v => v.t < 1);
  // a meson pulled out flies off
  if (QV.out) { QV.out.t += dt; QV.out.x += QV.out.vx * dt; QV.out.y += QV.out.vy * dt; if (QV.out.t > 2.2) QV.out = null; }
}
function qAnchor(q) { const os = QV.qs.filter(o => o !== q); let x = 0, y = 0; for (const o of os) { x += o.x; y += o.y; } return [x / os.length, y / os.length]; } // (what a pulled quark is pulled away from)
function qJunction() { const qs = QV.qs; if (qs.length === 2) return null; let x = 0, y = 0; for (const q of qs) { x += q.x; y += q.y; } return [x / 3, y / 3]; }
function qDraw(dt) {
  const cv = $('insQuarks'); if (!cv) return;
  if (dt > 0) qStep(Math.min(0.05, dt));
  const r = chartCtx(cv); if (!r) return; const [ctx, w, h] = r;
  const S = Math.min(w, h) / 3.4, cx = w / 2, cy = h / 2, X = (x) => cx + x * S, Y = (y) => cy - y * S;
  ctx.fillStyle = '#070b12'; ctx.fillRect(0, 0, w, h);
  // the bag
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.95 * S); bg.addColorStop(0, 'rgba(120,140,200,0.18)'); bg.addColorStop(1, 'rgba(120,140,200,0)');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, 0.95 * S, 0, 6.29); ctx.fill();
  ctx.strokeStyle = 'rgba(160,175,210,0.25)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(cx, cy, 0.85 * S, 0, 6.29); ctx.stroke(); ctx.setLineDash([]);
  const qs = QV.qs, col = (q) => q.anti ? Q_ACOL[q.col] : Q_COL[q.col];
  // flux tubes
  const tube = (x0, y0, q) => { const L = Math.hypot(q.x - x0, q.y - y0); ctx.strokeStyle = col(q); ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(2, 7 - 2.5 * L); ctx.shadowColor = col(q); ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; };
  const J = qJunction();
  if (J) for (const q of qs) tube(J[0], J[1], q);
  else { const [a, b] = qs, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; tube(mx, my, a); tube(mx, my, b); }
  // a gluon on its way: a wiggle from one quark to another
  if (QV.g) { const A = qs[QV.g.a], B = qs[QV.g.b], t = QV.g.t, gx = A.x + (B.x - A.x) * t, gy = A.y + (B.y - A.y) * t, L = Math.hypot(B.x - A.x, B.y - A.y) || 1, nx = -(B.y - A.y) / L, ny = (B.x - A.x) / L;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let k = 0; k <= 16; k++) { const u = Math.max(0, t - 0.25) + (Math.min(1, t) - Math.max(0, t - 0.25)) * k / 16, wv = 0.05 * Math.sin(k * 1.6); const px = A.x + (B.x - A.x) * u + nx * wv, py = A.y + (B.y - A.y) * u + ny * wv; if (k) ctx.lineTo(X(px), Y(py)); else ctx.moveTo(X(px), Y(py)); }
    ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(gx), Y(gy), 3, 0, 6.29); ctx.fill(); }
  // the sea
  ctx.font = '10px ' + cssVar('--font-data'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const v of QV.sea) { const a = Math.sin(Math.PI * v.t) * 0.5, d = 0.12 * Math.sin(Math.PI * v.t), ox = d * Math.cos(v.a), oy = d * Math.sin(v.a);
    ctx.globalAlpha = a; ctx.fillStyle = '#c8d2e6'; ctx.beginPath(); ctx.arc(X(v.x + ox), Y(v.y + oy), 4, 0, 6.29); ctx.arc(X(v.x - ox), Y(v.y - oy), 4, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#c8d2e6'; ctx.fillText(Q_SYM[v.f] + Q_BAR[v.f], X(v.x), Y(v.y) - 11); ctx.globalAlpha = 1; }
  // the quarks
  ctx.font = 'bold 13px ' + cssVar('--font-data');
  for (const q of qs) { const x = X(q.x), y = Y(q.y), c = col(q), gr = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 11);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, c); gr.addColorStop(1, c); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 10, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#0b0f16'; ctx.fillText(q.anti ? Q_BAR[q.f] : Q_SYM[q.f], x, y + 1); }
  // the string being pulled: its energy
  if (QV.drag) { const q = QV.drag.q, ref = qAnchor(q), L = Math.hypot(q.x - ref[0], q.y - ref[1]);
    ctx.fillStyle = '#ffd166'; ctx.font = '11px ' + cssVar('--font-data'); ctx.textAlign = 'left'; ctx.fillText(`string: ${(0.9 * Math.max(0, L - 0.4)).toFixed(2)} GeV (≈ 0.9 GeV per fm)`, 8, 12); }
  // a meson that left
  if (QV.out) { const o = QV.out, a = Math.max(0, 1 - o.t / 2.2); ctx.globalAlpha = a; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(X(o.x - 0.12), Y(o.y)); ctx.lineTo(X(o.x + 0.12), Y(o.y)); ctx.stroke();
    for (const [i, q] of o.qs.entries()) { const x = X(o.x + (i ? 0.14 : -0.14)), y = Y(o.y); ctx.fillStyle = q.anti ? Q_ACOL[q.col] : Q_COL[q.col]; ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.29); ctx.fill(); ctx.fillStyle = '#0b0f16'; ctx.font = 'bold 11px ' + cssVar('--font-data'); ctx.textAlign = 'center'; ctx.fillText(q.anti ? Q_BAR[q.f] : Q_SYM[q.f], x, y + 1); }
    ctx.fillStyle = '#fff'; ctx.font = '11px ' + cssVar('--font-data'); ctx.fillText(o.name, X(o.x), Y(o.y) - 16); ctx.globalAlpha = 1; }
  ctx.font = '10px ' + cssVar('--font-data'); ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(200,210,230,0.6)'; ctx.fillText('≈ 1.7 fm across (10⁻¹⁵ m)', w - 6, h - 8); ctx.textAlign = 'left';
  const nt = $('insQNote'); if (nt && (QV.t - QV.last > 0.5 || !nt.textContent)) { QV.last = QV.t; nt.textContent = qNote(); }
}
function qPointer(e, kind) {
  const cv = $('insQuarks'); if (!cv) return;
  const rc = cv.getBoundingClientRect(), S = Math.min(rc.width, rc.height) / 3.4, x = (e.clientX - rc.left - rc.width / 2) / S, y = -(e.clientY - rc.top - rc.height / 2) / S;
  if (kind === 'down') {
    let best = null, bd = 0.3; for (const q of QV.qs) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
    if (best) { QV.drag = { q: best, at: performance.now() }; e.preventDefault(); }
    return;
  }
  if (!QV.drag) return;
  const q = QV.drag.q;
  if (kind === 'move') {
    q.x = clamp(x, -1.6, 1.6); q.y = clamp(y, -1.6, 1.6); q.vx = 0; q.vy = 0; QV.drag.at = performance.now();
    const ref = qAnchor(q);
    if (Math.hypot(q.x - ref[0], q.y - ref[1]) > 1.35) qSnap(q);
  } else { QV.drag = null; renderInspect(); }
}
/* The string snaps: its energy makes a quark–antiquark pair (u ū or d d̄ mostly, s s̄ now and then). The pulled quark
   leaves with the new antiquark (or the pulled antiquark with the new quark) as a meson; the new one of the pair
   takes its place inside. */
function qSnap(q) {
  const f = rnd() < 0.12 ? 's' : rnd() < 0.5 ? 'u' : 'd';
  const partner = { f, anti: !q.anti, col: q.col };
  const mesonContent = [q, partner].map(o => o.anti ? o.f.toUpperCase() : o.f).join(''), mn = qName(mesonContent);
  const before = qName(QV.qs.map(o => o.anti ? o.f.toUpperCase() : o.f).join(''));
  const L = Math.hypot(q.x, q.y) || 1;
  QV.out = { qs: [{ ...q }, partner], name: mn.sym, x: q.x, y: q.y, vx: q.x / L * 1.2, vy: q.y / L * 1.2, t: 0 };
  q.f = f; q.anti = !partner.anti; q.x *= 0.5; q.y *= 0.5; q.vx = 0; q.vy = 0; // (the new quark of the pair stays, with the colour the string carried)
  const restC = QV.qs.map(o => o.anti ? o.f.toUpperCase() : o.f).join(''), after = qName(restC);
  QV.drag = null;
  if (QV.subj && (QV.subj.o || QV.subj.p)) undoMark('Pull a quark out');
  const sub = QV.subj, r = sub && (sub.o || sub.p) ? quarkRip(sub.o ? { o: sub.o } : { p: sub.p, which: sub.which }, restC, mesonContent) : null;
  if (r) { // the view follows what is left (the hyperon that flew off, or the nucleus): the picture stays as it is
    if (R.follow && (R.follow === sub.p || R.follow === sub.o)) R.follow = r.sel || null;
    R.sel = r.sel; R.selX = r.selX;
    if (r.sel && r.sel.Z + r.sel.N > 1) { const k = [...restC.toLowerCase()].sort().join(''); QV.pick = k === 'ddu' || k === 'ddd' ? 'n' : 'p'; }
    const ns = r.selX ? qSubject(null, r.selX) : r.sel ? qSubject(r.sel) : null;
    if (ns) QV.key = ns.key;
  }
  QV.msg = `The string snapped at about ${(0.9 * 1.0).toFixed(1)} GeV: its energy made a ${Q_SYM[f]} ${Q_BAR[f]} pair. The quark you pulled left with the new ${partner.anti ? 'antiquark' : 'quark'} as a ${mn.name} (${mn.sym})${after.name !== before.name ? `, and what stayed is now a ${after.name} (${after.sym})` : ''}. A quark never comes out alone: that is confinement.${r ? ` In the chamber: ${r.txt}.` : sub && (sub.o || sub.p) ? ' (It is gone from the chamber, so nothing changed there.)' : ''}`;
  renderInspect();
}
/* A photon, neutrino or unstable particle picked with the Inspect tool (R.selX: { kind: exo | flight | ray, o }). */
const XP_NAME = { muP: 'Muonic hydrogen (a muon orbiting a proton)', muD: 'Muonic deuterium', muT: 'Muonic tritium', muHe: 'Muonic helium ion: the muon stuck to an α', 'mu-': 'Muon', 'mu+': 'Antimuon', 'pi+': 'Positive pion', 'pi-': 'Negative pion', pi0: 'Neutral pion', 'K+': 'Positive kaon', 'K-': 'Negative kaon',
  K0S: 'Neutral kaon, short-lived (K-short)', K0L: 'Neutral kaon, long-lived (K-long)', eta: 'Eta meson', Lam: 'Lambda baryon', Lamb: 'Antilambda', 'tau-': 'Tau lepton', 'tau+': 'Antitau',
  'Sig+': 'Positive sigma baryon', 'Sig-': 'Negative sigma baryon', Xi0: 'Neutral xi baryon', 'Xi-': 'Negative xi baryon', 'Omg-': 'Omega baryon',
  'Sigb-': 'Antisigma, negative', 'Sigb+': 'Antisigma, positive', Xib0: 'Neutral antixi', 'Xib+': 'Positive antixi', 'Omgb+': 'Antiomega' };
const XP_QUARKS = { 'pi+': 'u d̄', 'pi-': 'd ū', pi0: 'a mix of u ū and d d̄', 'K+': 'u s̄', 'K-': 's ū', K0S: 'a mix of d s̄ and s d̄', K0L: 'a mix of d s̄ and s d̄', eta: 'a mix of u ū, d d̄ and s s̄', Lam: 'u d s', Lamb: 'ū d̄ s̄', 'Sig+': 'u u s', 'Sig-': 'd d s', Xi0: 'u s s', 'Xi-': 'd s s', 'Omg-': 's s s',
  'Sigb-': 'ū ū s̄', 'Sigb+': 'd̄ d̄ s̄', Xib0: 'ū s̄ s̄', 'Xib+': 'd̄ s̄ s̄', 'Omgb+': 's̄ s̄ s̄' };
const XP_ABOUT = {
  mu: 'A muon is a heavy cousin of the electron, 207 times its mass. It is a lepton, made of no smaller parts. Cosmic rays make them high in the air; they reach the ground only because time dilation stretches their 2.2 µs life.',
  pi: 'A pion is the lightest meson: a quark bound to an antiquark by the strong force. Pions carry the force that holds protons and neutrons together in a nucleus.',
  K: 'A kaon is a meson with a strange quark. Strangeness can only change through the weak force, which is why kaons live so long for such heavy particles.',
  eta: 'The eta is a neutral meson; it decays almost at once, mostly to photons or pions.',
  Lam: 'The Lambda is a baryon like a proton or neutron, but with a strange quark in place of one of the down quarks.',
  Sig: 'A sigma is a baryon with one strange quark, like the Lambda but with its two light quarks the same way round; the charged ones live about 0.1 ns and decay to a nucleon and a pion.',
  Xi: 'A xi (cascade) baryon has two strange quarks. It decays to a Lambda and a pion, which decays in turn: a cascade.',
  Omg: 'The omega baryon is three strange quarks. Its prediction and discovery in 1964 confirmed the quark model.',
  tau: 'The tau is the heaviest lepton, 3,477 times the electron’s mass, heavy enough to decay into pions.' };
function selXHead() {
  const X = R.selX; if (!X) return null;
  if (X.kind === 'exo') return X.o.dead ? null : [X.o.x, X.o.y];
  if (X.kind === 'flight') return W.flights.includes(X.o) ? lightHead(X.o, 'flight') : null;
  return W.rays.includes(X.o) && rayFrac(X.o) < 1 ? lightHead(X.o, 'ray') : null;
}
function selXHTML() {
  const X = R.selX, o = X.o, kv = [], live = !!selXHead();
  let title, sym, col, about, status;
  const hz = (E) => { const f = E / 4.135667696e-15; return f >= 1e18 ? fmtNum(f / 1e18, 3) + ' EHz' : f >= 1e15 ? fmtNum(f / 1e15, 3) + ' PHz' : f >= 1e12 ? fmtNum(f / 1e12, 3) + ' THz' : fmtNum(f / 1e9, 3) + ' GHz'; };
  if (X.kind === 'exo') {
    const d = XP[o.sp], m = d.m;
    title = XP_NAME[o.sp] || o.lab; sym = o.lab; col = `rgb(${d.col.join(',')})`;
    const beta = o.v / PHYS.C, life = d.tau * o.gam, path = beta * o.gam * 299792458 * d.tau;
    kv.push(['Charge', d.q > 0 ? '+' + d.q : d.q < 0 ? '−' + -d.q : '0'], ['Rest mass', `${fmtNum(m, 4)} MeV/c² (${fmtNum(m / 0.51099895, 4)} electron masses)`]);
    if (XP_QUARKS[o.sp]) kv.push(['Made of', XP_QUARKS[o.sp]]);
    kv.push(['Kinetic energy', fmtE(o.KE)], ['Total energy', fmtE(o.KE + m * 1e6)], ['Speed', fmtSpeed(o.v)], ['Lorentz factor γ', fmtNum(o.gam, 4)],
      ['Mean life at rest', fmtTime(d.tau)], ['Mean life moving (γτ)', fmtTime(life)], ['Mean distance before decaying', fmtLen(path)],
      ['Decays to', d.dec.map(([b, ps]) => `${ps.map(t => (XP[t] ? XP[t].lab : ({ 'e-': 'e⁻', 'e+': 'e⁺', nu: 'ν', nub: 'ν̄', g: 'γ', p: 'p', n: 'n', pbar: 'p̄', nbar: 'n̄' })[t] || t)).join(' ')} (${b >= 0.9995 ? '100' : b >= 0.01 ? (100 * b).toFixed(b > 0.995 ? 2 : 1) : (100 * b).toPrecision(2)}%)`).join('; ')]);
    about = d.atom ? `An atom with a muon in place of its electron. The muon is 207 times heavier, so its orbit is 207 times smaller (about 0.03 nm → 0.00025 nm): the atom is neutral and tiny, and slips between molecules. Its muon moves to a heavier hydrogen isotope it meets; a muonic tritium atom catches a deuteron into the molecule dμt, where the two nuclei sit so close that they fuse within a picosecond. Bound by ${fmtE(d.Eb * 1e6)}.`
      : d.stuck ? 'The muon has stuck to the helium nucleus made in a catalysed fusion: bound to a charge of +2, it can no longer catalyse; it will decay where it is.'
      : XP_ABOUT[['mu', 'pi', 'K', 'tau', 'Lam', 'Sig', 'Xi', 'Omg'].find(k => o.sp.startsWith(k)) || 'eta'] || '';
    if (d.tau < 1e-15) about += ' This one lives so briefly that it decays a few nanometres from where it was made.';
    else if (path > 1e-6) about += ` Moving this fast it would cross ${fmtLen(path)} on average before decaying, far more than this chamber, so it leaves it — unless decay is sped up (Lab → Decay speed).`;
    status = live ? 'In flight' : o.fate ? o.fate[0].toUpperCase() + o.fate.slice(1) : 'Gone';
  } else {
    const E = o.E, nu = X.kind === 'ray' && o.nu;
    if (nu) {
      const el = /β|neutron|beta|capture|fusion/i.test(o.how || ''); /* (from nuclei: electron flavour; from a pion, kaon or muon decay it may be another, so just “neutrino”) */ title = (el ? 'Electron ' : '') + (o.anti ? 'antineutrino' : 'neutrino'); title = title[0].toUpperCase() + title.slice(1); sym = o.anti ? 'ν̄' : 'ν'; col = 'rgb(120,255,170)';
      const lag = 0.8 * 0.8 / (2 * E * E); // (1 − v/c for a mass under 0.8 eV)
      kv.push(['Energy', fmtE(E)], ['Charge', '0'], ['Mass', 'under 0.8 eV/c² (not yet measured; a millionth of an electron’s)'], ['Speed', lag < 1e-6 ? `c, to within ${lag.toExponential(0)}` : fmtSpeed(PHYS.C * (1 - lag))]);
      if (o.how) kv.push(['Made by', o.how]);
      about = 'A neutrino feels only the weak force and gravity, so it passes through the chamber, and through the whole Earth, almost never touching anything. It carries its energy away with it (Data → Ledger counts it as escaped). Pauli predicted it in 1930 to explain the energy missing in β decay.';
    } else {
      const nm = PHYS.HC / E, w = wavelengthText(E);
      title = 'Photon: ' + (E >= 1.24e5 ? 'a γ ray' : E >= 124 ? 'an X-ray' : nm < 380 ? 'ultraviolet light' : nm <= 780 ? 'visible light' : 'infrared light'); sym = 'γ';
      const c = photonColor(E); col = `rgb(${c.join(',')})`;
      kv.push(['Energy', fmtE(E)], ['Wavelength', w.lam], ['Frequency', hz(E)], ['Momentum', fmtE(E) + '/c'], ['Speed', 'c, 299,792,458 m/s'], ['Mass, charge', '0, 0']);
      if (o.lab && !/^(γ|X-ray|UV|IR|\d)/.test(o.lab)) kv.push(['Given off by', o.lab.split(' ')[0] + ' (one of its own lines)']);
      const tgt = X.kind === 'flight' ? (o.hit && o.hit.p ? speciesLabel(o.hit.p) : '') : o.hitP;
      kv.push(['Heading for', tgt ? `${tgt}, which it will meet` : 'the wall: nothing is in its way']);
      about = E >= 1.24e5 ? 'A γ ray comes from a nucleus or from matter and antimatter annihilating. It is the same thing as light, a photon, a million times more energetic: it can knock electrons out of atoms, scatter off them (Compton) or, above 1.022 MeV, turn into an electron and a positron near a nucleus.'
        : 'A photon is one packet of light: its energy is fixed by its colour (E = hc/λ), and it always moves at c. An atom can only absorb or give off photons whose energy matches a jump between its own levels, which is why each element has its own colours.';
    }
    status = live ? 'In flight' : X.kind === 'flight' || o.hitP || o.landed ? 'Arrived' : nu ? 'Gone: it left the chamber' : 'Gone: it left the chamber, or was absorbed';
  }
  return `<div class="ins-head"><div class="tilebox" style="border-color:${col}"><span class="s">${esc(sym)}</span></div><div><b>${esc(title)}</b><div class="note">${esc(status)}</div></div></div>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${about ? `<p class="note">${esc(about)}</p>` : ''}${X.kind === 'exo' ? quarkSecHTML(qSubject(null, X)) : ''}`;
}
function renderInspect() {
  const box = $('tp-inspect');
  if (QV.drag && performance.now() - QV.drag.at < 3000) return; // (pulling a quark: the card stays as it is until it is let go)
  QV.drag = null;
  if (R.selX && !R.sel) { box.innerHTML = selXHTML(); _insCv = null; restoreScroll('tp-inspect'); return; }
  const p = R.sel && !R.sel.dead ? R.sel : null;
  if (!p) {
    box.innerHTML = `<div class="empty"><b>Nothing selected.</b> Pick the Inspect tool (I) and click any particle to see its electron configuration, bonds, nucleus and energies. Photons, neutrinos, and pions, kaons and muons in flight can be clicked too.</div>`;
    _insCv = null; restoreScroll('tp-inspect'); return;
  }
  const ke = p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
  const speed = p.rad ? p.sp : Math.hypot(p.vx, p.vy);
  const kv = [];
  let head = '', pills = '', extra = '';
  if (p.k === ELEC || p.k === POS) {
    head = `<div class="ins-head"><div class="tilebox" style="border-color:${p.k === ELEC ? E_COL : POS_COL}"><span class="s">${p.k === ELEC ? 'e⁻' : 'e⁺'}</span><span class="q">${p.k === ELEC ? '−1' : '+1'}</span></div>
      <div><div class="ins-title">${p.k === ELEC ? 'Free electron' : 'Positron'}</div><div class="ins-sub">Lepton · spin ½ · ${p.k === ELEC ? 'matter' : 'antimatter'}</div></div></div>`;
    pills = `<span class="pill em">${p.rad ? 'ionizing track' : p.fast ? 'fast' : 'thermal'}</span>`;
    kv.push(['Mass', '9.109×10⁻³¹ kg (1/1836 of a proton)'], ['Kinetic energy', fmtE(ke)], ['Speed', fmtSpeed(speed)]);
    if (p.k === POS) extra = `<p class="note">Meeting an electron, it annihilates into two 511 keV gamma rays. An antiproton captures it to make antihydrogen.</p>`;
  } else if (p.Z === 0) {
    head = `<div class="ins-head"><div class="tilebox"><span class="z">0</span><span class="a">1</span><span class="s">n</span><span class="q">neutral</span></div>
      <div><div class="ins-title">Neutron</div><div class="ins-sub">Baryon · udd quarks · 939.6 MeV/c²</div></div></div>`;
    pills = `<span class="pill hot">t½ 10.2 min (β⁻ → p + e⁻ + ν̄)</span>`;
    kv.push(['Kinetic energy', fmtE(ke)], ['Speed', fmtSpeed(speed)], ['Kind', ke < 1 ? 'thermal (slow)' : ke < 1e5 ? 'epithermal' : 'fast']);
    extra = `<p class="note">With no charge, neutrons pass through electron clouds and only interact when they hit a nucleus: scattering, capture or fission.</p>`;
  } else {
    const el = p.el, nuc = p.nuc || nuclideInfo(p.Z, p.N), A = p.Z + p.N;
    const qs = p.q ? (Math.abs(p.q) > 1 ? Math.abs(p.q) : '') + (p.q > 0 ? '+' : '−') : '';
    const mol = p.bonds.length ? molecule(p) : null, mname = mol ? moleculeName(mol) : null;
    const lep = p.anti ? 'positron' : 'electron', aq = p.anti ? -p.q : p.q; // aq > 0: short of leptons (a cation)
    const iso = elemName(p) + '-' + A;
    const title = p.ne === 0 ? (p.anti ? (p.Z === 1 && p.N === 0 ? 'Antiproton' : `Anti-${nucName(p.Z, p.N).toLowerCase()} nucleus`)
      : p.Z === 1 && p.N === 0 ? 'Proton' : p.Z === 2 && p.N === 2 ? 'Alpha particle' : nucName(p.Z, p.N) + ' nucleus')
      : iso + (aq ? (aq > 0 ? ' cation' : ' anion') : '');
    const sub = (p.ne === 0 ? `Bare ${p.anti ? 'antinucleus' : 'nucleus'}: no ${lep}s` : (p.anti ? 'Antimatter · ' : '') + (CAT_NAMES[el.cat] || '') + (mol ? ` · in ${hill(mol)}${mname ? ' (' + mname + ')' : ''}` : ''))
      + (p.Z > Z_TABLE ? ' · never made in any lab: its properties are predictions' : '');
    head = `<div class="ins-head"><div class="tilebox" style="border-color:${atomColor(p)}"><span class="z">${p.anti ? '−' : ''}${p.Z}</span><span class="a">${A}</span><span class="s">${symHTML(el.sym, p.anti)}</span><span class="q">${qs || 'neutral'}</span></div>
      <div><div class="ins-title">${esc(title)}</div><div class="ins-sub">${esc(sub)}</div></div></div>`;
    pills = `<span class="pill ${nuc.stable ? 'good' : 'hot'}">${esc(nuc.stable ? 'stable nucleus' : lifeText(nuc))}</span>`;
    if (!nuc.stable && nuc.modes.length) pills += `<span class="pill hot">${esc(nuc.modes.map(m => modeLabel(m.mode)).join(' / '))}</span>`;
    if (p.ne > 0 && p.cap - p.used > 0 && !el.dblock) pills += `<span class="pill em">radical: ${p.cap - p.used} free valence</span>`;
    if (p.ne > 0 && unpairedOf(p) > 0) pills += `<span class="pill em">paramagnetic</span>`;
    if (FERRO[p.Z] && (p.tLocal || 0) < FERRO[p.Z][0]) pills += `<span class="pill em">ferromagnetic (Curie ${FERRO[p.Z][0]} K)</span>`;
    if (p.anti) pills += `<span class="pill" style="color:${PBAR_COL};border-color:${PBAR_COL}">antimatter: annihilates on contact with matter</span>`;
    if (p.ne > 0) {
      kv.push([p.anti ? 'Positrons' : 'Electrons', `${p.ne} (${configString(p.Z, p.ne)})`]);
      kv.push([p.anti ? 'Valence positrons' : 'Valence electrons', String(p.val)]);
      if (!el.dblock || p.bonds.length) kv.push(['Bonds used / capacity', `${p.used} / ${p.cap}`]);
      if (p.lp) kv.push(['Lone pairs', String(p.lp)]);
      kv.push(['Charge', (p.q > 0 ? '+' : '') + p.q + (Math.abs(p.qp) > 0.005 ? ` (partial ${p.qp > 0 ? '+' : ''}${p.qp.toFixed(2)})` : '')]);
      kv.push(['Next ionization energy', fmtE(ionE(p.Z, p.ne))]);
      if (el.en) kv.push(['Electronegativity', el.en.toFixed(2)]);
      if (el.ea) kv.push([p.anti ? 'Positron affinity' : 'Electron affinity', fmtE(el.ea)]);
    } else kv.push(['Charge', (p.anti ? '−' : '+') + p.Z]);
    kv.push(['Mass', fmtNum(p.m, 6) + ' u'], ['Kinetic energy', fmtE(ke)], ['Speed', fmtSpeed(speed)]);
    if (p.tLocal && p.ne > 0) kv.push(['Local temperature', fmtT(p.tLocal)]);
    kv.push(['Nucleus', p.anti ? `${p.Z} p̄ + ${p.N} n̄` : `${p.Z} p + ${p.N} n`], ['Binding energy', A > 1 ? `${fmtE(bindingE(p.Z, p.N) * 1e6, 5)} (${fmtE(bindingE(p.Z, p.N) / A * 1e6, 4)} per nucleon)` : '—']);
    if (p.anti) extra = `<p class="note">Antimatter mirrors matter: the same masses, energy levels, spectra and bonds, with every charge reversed (CPT symmetry). Touching ordinary matter, its positrons annihilate with electrons (two 511 keV γ rays) and each antinucleon with a nucleon (pions and γ rays, about 1.9 GeV).</p>`;
    if (!nuc.stable && nuc.modes.length) kv.push(['Decay energy', nuc.modes.map(m => `${modeLabel(m.mode)}: Q ${fmtE(m.Q * 1e6)}`).join('; ')]);
    if (mol) {
      const bonds = [];
      for (const bd of p.bonds) { const o = other(bd, p); bonds.push(`${el.sym}${['', '–', '=', '≡'][bd.order]}${o.el.sym} ${fmtE(bd.D)}, ${fmtA(dist(p, o))}`); }
      const lm = libMatch(mol) || libMatch(mol, true); // (heavy water: water's entry)
      const about = lm ? `<section class="group"><h3>Molecule</h3><p class="note"><b>${esc(mname || lm.name)}</b> (${esc(isoFormula(mol))}, ${mol.length} atoms). ${esc(p.anti ? 'The antimatter twin of ' + lm.name.toLowerCase() + '.' : lm.note)}</p></section>` : '';
      extra = about + `<section class="group"><h3>Bonds</h3><p class="note">${bonds.map(esc).join('<br>')}</p></section>`;
    }
  }
  const lepW = p.anti ? 'a positron' : 'an electron';
  const pspec = p.k === NUC && p.Z > 0 ? isoSpec(p.Z, p.Z + p.N, p.ne ? p.q : 0, p.ne === 0, p.anti) : null, sf = pspec ? saveBtnFace(pspec) : null;
  const actions = p.k === NUC && p.Z > 0 ? `<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">
      <button class="btn small" data-act="ion" ${p.ne > 0 ? '' : 'disabled'}>Remove ${lepW}</button>
      <button class="btn small" data-act="add" ${p.ne < p.Z + maxExtraElectrons(p.Z) ? '' : 'disabled'}>Add ${lepW}</button>
      <button class="btn small savebtn" data-act="save" aria-pressed="${sf.on}" title="${esc(sf.title)}">${sf.text}</button>
      <button class="btn small" data-act="del">Delete</button></div>` : `<div class="row" style="justify-content:flex-start"><button class="btn small" data-act="del">Delete</button></div>`;
  const od = box.querySelector('#insOrbs'); if (od) UI.orbOpen = od.open;
  const sd = box.querySelector('#insSolver'); if (sd) UI.solverOpen = sd.open;
  const orbs = (p.k === NUC && p.Z > 0 && p.ne > 0 ? solverSectionHTML(p) + orbSectionHTML(p) : '') +
    (p.k === NUC && p.Z + p.N > 0 && p.nuc && !p.nuc.stable && !p.nuc.unbound ? chainSectionHTML(p.Z, p.N, p.anti) : '');
  box.innerHTML = `${head}<div>${pills}</div>
    ${p.k === NUC && p.Z > 0 ? `<canvas class="bohr" id="insBohr" aria-label="${R.view.bohr === 'orb' && p.ne > 0 ? 'Electron density' : 'Shell diagram'}"></canvas>` : ''}
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${orbs}${extra}${quarkSecHTML(qSubject(p))}${actions}`;
  for (const cv of box.querySelectorAll('canvas.orbcv')) drawOrbThumb(cv, p, +cv.dataset.i);
  const nd = box.querySelector('#insOrbs'); if (nd) nd.addEventListener('toggle', () => { UI.orbOpen = nd.open; });
  const cd = box.querySelector('#insChain'); if (cd) cd.addEventListener('toggle', () => { UI.chainOpen = cd.open; });
  const sv = box.querySelector('#insSolver'); if (sv) sv.addEventListener('toggle', () => { UI.solverOpen = sv.open; });
  const pc = box.querySelector('#solverPlot'); if (pc) drawSolverPlot(pc, _solved.get(p.Z * 512 + p.ne));
  box.onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'ion' || a === 'add' || a === 'del') undoMark({ ion: 'Remove an electron', add: 'Add an electron', del: 'Delete' }[a]);
    if (a === 'ion') userIonize(p); else if (a === 'add') userAddElectron(p);
    else if (a === 'save') myIsoToggle(pspec);
    else if (a === 'del') { kill(p); R.sel = null; }
    else if (a === 'solve') runSolver(p.Z, p.ne);
    renderInspect();
  };
  _insCv = $('insBohr');
  drawInspectBohr();
  restoreScroll('tp-inspect');
}
function fmtSpeed(v) { // v in Å/tu
  const ms = v * PHYS.V_MS, b = ms / 299792458;
  if (b >= 0.5) { // near light: enough digits to stay below c, and the share of c (299,792 km/s rounded to three figures read "300,000")
    const dec = clamp(Math.ceil(-Math.log10(Math.max(1e-15, 1 - b))), 1, 12);
    return `${(ms / 1e3).toLocaleString('en-US', { maximumFractionDigits: clamp(dec - 3, 0, 9) })} km/s (${(100 * b).toFixed(dec)}% of c)`;
  }
  return ms >= 1e3 ? fmtNum(ms / 1e3, 3) + ' km/s' : ms.toPrecision(3) + ' m/s'; // (12,300 km/s, never 1.23e+4)
}
function drawInspectBohr() {
  const cv = _insCv, p = R.sel;
  if (!cv || !p || p.dead) return;
  const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
  const dpr = R.dpr;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CHAMBER.bg0; ctx.fillRect(0, 0, w, h);
  const saved = R.ctx; R.ctx = ctx;
  const r = Math.min(w, h) * 0.36;
  if (p.ne > 0 && R.view.bohr === 'orb') drawInspectOrbitals(ctx, p, w, h);
  else if (p.ne > 0) drawBohr(ctx, p, w / 2, h / 2 - 8, r, UI.vis, atomColor(p));
  else { nucleusBeads(ctx, w / 2, h / 2, Math.min(40, 8 + 3 * Math.cbrt(p.Z + p.N)), p.Z, p.N, 1, p.anti); }
  R.ctx = saved;
}

/* The selected atom's electron density, with a scale bar. */
function drawInspectOrbitals(ctx, p, w, h) {
  const O = orbitalSet(p.Z, p.ne), D = Math.min(w, h - 20), cx = w / 2, cy = (h - 20) / 2 + 2;
  const sp = orbSprite(p.Z, p.ne, D * R.dpr, true);
  ctx.globalCompositeOperation = 'lighter';
  if (sp) ctx.drawImage(sp, cx - D / 2, cy - D / 2, D, D);
  ctx.globalCompositeOperation = 'source-over';
  drawSprite(ballSprite(p.anti ? PBAR_COL : P_COL, 2.4), cx, cy);
  const pxA = D / (2 * O.rmax); // pixels per ångström
  let L = 0.1;
  for (const v of [0.1, 0.2, 0.5, 1, 2, 5]) if (v * pxA <= w * 0.3) L = v;
  ctx.strokeStyle = CHAMBER.text; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(10, h - 10); ctx.lineTo(10 + L * pxA, h - 10); ctx.stroke();
  ctx.font = '500 10.5px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = CHAMBER.text; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText(`${L} Å`, 14 + L * pxA, h - 6.5);
  ctx.textAlign = 'right'; ctx.fillStyle = CHAMBER.dim; ctx.fillText('slice through the nucleus', w - 9, h - 6.5);
}
/* The atom solver (solver.js) in the inspector: on request, a self-consistent quantum calculation of this
   atom's or ion's electrons, with the orbital energies and sizes it finds and its radial charge density. The
   result also takes over this species' pictures in the Orbitals view. */
const _solved = new Map(); // Z·512 + ne → result
function runSolver(Z, ne) {
  const key = Z * 512 + ne;
  if (_solved.has(key)) return;
  const res = solveAtom(Z, ne);
  res.unbound = !res.ok && ne > Z; // an extra electron with no bound state
  _solved.set(key, res);
  if (res.ok && useSolverOrbitals(res)) { _orbThumbs.clear(); for (const k of [..._orbSpr.keys()]) if (k.startsWith(key + ':')) _orbSpr.delete(k); }
  UI.solverOpen = true; { const sd = $('insSolver'); if (sd) sd.open = true; } // (the card reads its open state back as it redraws)
  log('tool', `Solver: ${ELEMENTS[Z].sym}${ne !== Z ? sup((Math.abs(Z - ne) > 1 ? Math.abs(Z - ne) : '') + (ne < Z ? '+' : '-')) : ''} ${res.ok ? `converged in ${res.iters} rounds (${res.ms} ms)` : res.unbound ? ': the extra electron is not bound' : 'did not converge'}`);
}
function solverSectionHTML(p) {
  const key = p.Z * 512 + p.ne, res = _solved.get(key), sp = (p.anti ? barSym(p.el.sym) : p.el.sym) + (p.q ? sup((Math.abs(p.q) > 1 ? Math.abs(p.q) : '') + (p.q > 0 ? '+' : '-')) : '');
  const open = UI.solverOpen ? ' open' : '';
  if (!res) return `<details class="solver" id="insSolver"${open}><summary>Quantum solver <span>not run yet</span></summary>
    <p class="note">Solves the Schrödinger equation for ${esc(sp)}'s ${p.ne} electron${p.ne > 1 ? 's' : ''}: each one moving in the field of the nucleus and the average charge of all the others, over and over until that field stops changing (a self-consistent field). It finds every orbital's energy and size, and the Orbitals view then draws ${esc(sp)} from them.</p>
    <button class="btn small" data-act="solve">Solve ${esc(sp)}</button></details>`;
  if (!res.ok) return `<details class="solver" id="insSolver"${open}><summary>Quantum solver <span>${res.unbound ? 'not bound' : 'no answer'}</span></summary>
    <p class="note">${res.unbound ? `No orbital holds the last electron: ${esc(sp)} is not bound. Its extra electrons are pushed away by the others more strongly than the nucleus can hold them, so in empty space it sheds them at once.` : 'The calculation did not settle for this ion.'}</p></details>`;
  const top = res.orbitals.reduce((a, o) => (o.e > a.e ? o : a), res.orbitals[0]);
  const book = ionE(p.Z, p.ne), fr = (r) => fmtA(r);
  const O = orbitalSet(p.Z, p.ne);
  const rows = res.orbitals.map(o => `<tr><td><b>${o.n}${LLET[o.l]}${sup(o.c)}</b></td><td>${fmtE(-o.e).replace(/^/, '−')}</td><td>${fr(o.rMean)}</td></tr>`).join('');
  return `<details class="solver" id="insSolver"${open}><summary>Quantum solver <span>${esc(sp)}, ${res.iters} rounds, ${res.ms} ms</span></summary>
    <canvas class="solverplot" id="solverPlot" aria-label="Radial charge density of each subshell"></canvas>
    <table class="soltab"><thead><tr><th>Subshell</th><th>Energy</th><th>Mean radius</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note"><b>Ionization energy</b>: ${fmtE(-top.e)} from the solver (the energy of the outermost electron, ${top.n}${LLET[top.l]}), ${book > 0 && isFinite(book) ? `measured ${fmtE(book)}` : 'not measured'}.
    Hartree–Fock–Slater: the electrons' exchange in Slater's local form (Xα), Latter's correction far out. It leaves out relativity, which pulls heavy atoms' inner and s electrons in (gold's 6s comes out 2.7 eV too shallow), and the electrons' spins (half-filled p shells come out 1–3 eV too shallow). The plot shows where the electrons are: the charge in each thin shell around the nucleus, r on a log scale; each peak is a shell.</p></details>`;
}
/* The radial charge density 4πr²ρ(r) of each subshell, stacked (colours as in the Orbitals view), r on a log axis. */
function drawSolverPlot(cv, res) {
  if (!cv || !res || !res.ok) return;
  const w = cv.clientWidth || 300, h = cv.clientHeight || 150, dpr = R.dpr;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CHAMBER.bg0; ctx.fillRect(0, 0, w, h);
  const r = res.r, n = r.length, x0 = Math.log10(Math.max(1e-3, 0.3 * res.orbitals.reduce((m, o) => Math.min(m, o.rMean), 1e9)));
  const x1 = Math.log10(Math.min(r[n - 1], 4 * res.orbitals.reduce((m, o) => Math.max(m, o.rMean), 0)));
  const px = (rr) => 6 + (Math.log10(rr) - x0) / (x1 - x0) * (w - 12), pad = 16;
  // the density per log r (so equal areas mean equal charge): u(r)·r
  const tot = new Float64Array(n);
  for (const o of res.orbitals) for (let i = 0; i < n; i++) tot[i] += o.c * o.P[i] * o.P[i] * r[i];
  let ymax = 0; for (let i = 0; i < n; i++) if (r[i] >= Math.pow(10, x0) && r[i] <= Math.pow(10, x1)) ymax = Math.max(ymax, tot[i]);
  const py = (v) => h - pad - v / ymax * (h - pad - 8);
  const acc = new Float64Array(n);
  const subs = res.orbitals.slice().sort((a, b) => a.rMean - b.rMean);
  for (const o of subs) {
    const col = hexc(ORB_COL[o.l] || '#ffffff');
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < n; i++) { if (r[i] < Math.pow(10, x0) || r[i] > Math.pow(10, x1)) continue; const v = acc[i] + o.c * o.P[i] * o.P[i] * r[i]; if (first) { ctx.moveTo(px(r[i]), py(acc[i])); first = false; } ctx.lineTo(px(r[i]), py(v)); }
    for (let i = n - 1; i >= 0; i--) { if (r[i] < Math.pow(10, x0) || r[i] > Math.pow(10, x1)) continue; ctx.lineTo(px(r[i]), py(acc[i])); }
    ctx.closePath(); ctx.fillStyle = rgba(col, 0.55); ctx.fill();
    for (let i = 0; i < n; i++) acc[i] += o.c * o.P[i] * o.P[i] * r[i];
  }
  ctx.strokeStyle = 'rgba(235,242,250,0.9)'; ctx.lineWidth = 1.3; ctx.beginPath();
  let first = true;
  for (let i = 0; i < n; i++) { if (r[i] < Math.pow(10, x0) || r[i] > Math.pow(10, x1)) continue; if (first) { ctx.moveTo(px(r[i]), py(tot[i])); first = false; } else ctx.lineTo(px(r[i]), py(tot[i])); }
  ctx.stroke();
  ctx.font = '500 10px "Azeret Mono", ui-monospace, monospace'; ctx.fillStyle = CHAMBER.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (let d = Math.ceil(x0); d <= Math.floor(x1); d++) {
    const x = px(Math.pow(10, d));
    ctx.fillRect(x, h - pad, 1, 4);
    ctx.fillText(d === 0 ? '1 Å' : d < 0 ? (d === -1 ? '0.1 Å' : d === -2 ? '0.01 Å' : '10' + sup(d) + ' Å') : fmtNum(Math.pow(10, d), 3) + ' Å', clamp(x, 18, w - 18), h - 3);
  }
}
/* Decay chain: where this nucleus goes, step by step, on a chart of the nuclides (neutrons across, protons up),
   with each step's half-life; α steps run diagonally down, β⁻ up-left, β⁺ and electron capture down-right. */
const CHAIN_COL = { a: '#f0b44c', 'b-': '#4da8ff', 'b+': '#ff6fc8', ec: '#45c7b0', p: '#ff5a4e', n: '#a9b4c2', '2p': '#ff5a4e', '2n': '#a9b4c2', sf: '#ff8a3d' };
function chainSectionHTML(Z, N, anti) {
  const ch = decayChain(Z, N, 40);
  if (ch.length < 2 && !ch[0].mode) return '';
  const Ns = ch.map(c => c.N), Zs = ch.map(c => c.Z), n0 = Math.min(...Ns), n1 = Math.max(...Ns), z0 = Math.min(...Zs), z1 = Math.max(...Zs);
  const cols = n1 - n0 + 1, rows = z1 - z0 + 1, cell = clamp(Math.floor(Math.min(300 / cols, 150 / rows)), 6, 26);
  const W2 = cols * cell + 6, H2 = rows * cell + 6, cx = (c) => 3 + (c.N - n0 + 0.5) * cell, cy = (c) => 3 + (z1 - c.Z + 0.5) * cell;
  const sym = (c) => c.Z > 0 ? nucSymA(c.Z, c.N, anti) : nucSym(c.Z, c.N);
  let g = '';
  for (let i = 0; i + 1 < ch.length; i++) { // arrows first, under the squares
    const a = ch[i], b = ch[i + 1], col = CHAIN_COL[a.mode] || '#999';
    g += `<line x1="${cx(a)}" y1="${cy(a)}" x2="${cx(b)}" y2="${cy(b)}" stroke="${col}" stroke-width="${Math.max(1.2, cell / 9)}" stroke-linecap="round"/>`;
  }
  ch.forEach((c, i) => {
    const s = cell - 2, x = cx(c) - s / 2, y = cy(c) - s / 2, col = c.stable ? '#2b8a3e' : CHAIN_COL[c.mode] || '#999';
    if (i === 0) g += `<rect x="${x - 2.5}" y="${y - 2.5}" width="${s + 5}" height="${s + 5}" rx="${Math.min(5, s / 3)}" fill="none" stroke="#ffffff" stroke-width="1.6"/>`; // this nucleus
    g += `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${Math.min(4, s / 4)}" fill="${c.stable ? 'var(--ch-bg)' : col}" stroke="${col}" stroke-width="1.2"><title>${esc(sym(c))}: ${c.stable ? 'stable' : 't½ ' + fmtTime(c.t12) + (c.est ? ' (est.)' : '') + ', ' + modeLabel(c.mode)}</title></rect>`;
  });
  const end = ch[ch.length - 1];
  const list = ch.map((c, i) => `<li${i === 0 ? ' class="now"' : ''}><b>${esc(sym(c))}</b>${c.stable ? '<span class="st">stable</span>' :
    `<span>${esc(fmtTime(c.t12))}${c.est ? ' (est.)' : ''}</span><i style="color:${CHAIN_COL[c.mode] || '#999'}">${esc(MODE_SHORT[c.mode] || c.mode)}${c.br < 0.995 ? ` ${(c.br * 100).toPrecision(2)}%` : ''} →</i>`}</li>`).join('');
  const total = ch.reduce((s, c) => s + (c.stable || !isFinite(c.t12) ? 0 : c.t12), 0);
  return `<details class="chain" id="insChain"${UI.chainOpen === false ? '' : ' open'}><summary>Decay chain <span>${ch.length - 1} step${ch.length > 2 ? 's' : ''} to ${esc(end.stable ? sym(end) : end.mode === 'sf' ? 'fission' : sym(end))}</span></summary>
    <svg class="chainsvg" viewBox="0 0 ${W2} ${H2}" width="${W2}" height="${H2}" role="img" aria-label="Decay chain on a chart of the nuclides">${g}</svg>
    <ol class="chainlist">${list}</ol>
    <p class="note">Each step follows the likeliest decay (the less likely branches are left out). Neutrons across, protons up: α decay takes two of each, β⁻ turns a neutron into a proton, β⁺ and electron capture the reverse. The half-lives add to about ${esc(fmtTime(total))} for the whole chain, dominated by the slowest step.</p></details>`;
}
/* Inspector list of an atom's occupied subshells, each drawn on its own with its radial nodes. */
function orbSectionHTML(p) {
  const O = orbitalSet(p.Z, p.ne), open = UI.orbOpen === undefined ? R.view.bohr === 'orb' : UI.orbOpen;
  const fr = (r) => fmtA(r);
  return `<details class="orbs" id="insOrbs"${open ? ' open' : ''}><summary>Orbitals <span>${O.subs.length} subshell${O.subs.length > 1 ? 's' : ''}</span></summary>
    <div class="orb-grid">${O.subs.map((s, i) => `<figure><canvas class="orbcv" data-i="${i}" aria-label="${s.n}${LLET[s.l]} subshell"></canvas>
      <figcaption><b>${s.n}${LLET[s.l]}${sup(s.c)}</b><span>Z<sub>eff</sub> ${s.zeff.toFixed(2)}</span><span>r̄ ${fr(s.rMean)}</span></figcaption></figure>`).join('')}</div>
    <p class="note">Hydrogen-like orbitals with Slater's screened charge Z<sub>eff</sub>, sized by Slater's rules and filled by Hund's rule. Each is a slice through the nucleus in the chamber's plane; dark rings are radial nodes. r̄ is the mean distance from the nucleus. They are drawn from the atom's configuration and do not steer its motion.</p></details>`;
}
const _orbThumbs = new Map();
function drawOrbThumb(cv, p, i) {
  const N = Math.max(32, Math.round((cv.clientWidth || 72) * R.dpr)), key = `${p.Z}:${p.ne}:${i}:${N}`;
  let c = _orbThumbs.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    if (img && img.data) { img.data.set(orbitalPixels(orbitalSet(p.Z, p.ne), N, i)); g.putImageData(img, 0, 0); }
    if (_orbThumbs.size > 240) _orbThumbs.clear();
    _orbThumbs.set(key, c);
  }
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = CHAMBER.bg0; ctx.fillRect(0, 0, N, N);
  ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(c, 0, 0); ctx.globalCompositeOperation = 'source-over';
}

/* ------------------------------------------------------------------ data tab */
function speciesCounts() {
  const seen = new Set(), c = new Map();
  for (const p of W.parts) {
    if (p.dead || seen.has(p)) continue;
    let key, name = '', col = '#999';
    if (p.k === ELEC) { key = 'e⁻'; name = 'free electrons'; col = E_COL; }
    else if (p.k === POS) { key = 'e⁺'; name = 'positrons'; col = POS_COL; }
    else if (p.Z === 0) { key = p.anti ? 'n̄' : 'n'; name = p.anti ? 'antineutrons' : 'neutrons'; col = p.anti ? NBAR_COL : N_COL; }
    else if (p.bonds.length) { const m = molecule(p); for (const a of m) seen.add(a); key = isoFormula(m); name = moleculeName(m) || (p.anti ? 'antimatter molecule' : ''); col = atomColor(p); }
    else if (p.ne === 0) { key = speciesLabel(p); name = p.anti ? (p.Z === 1 && p.N === 0 ? 'antiprotons' : 'anti-' + nucName(p.Z, p.N).toLowerCase() + ' nuclei') : nucName(p.Z, p.N) + ' nuclei'; col = p.anti ? PBAR_COL : P_COL; }
    else { const aq = p.anti ? -p.q : p.q; key = speciesLabel(p) + (p.N + p.Z !== COMMON_A[p.Z] ? ` (${p.Z + p.N})` : ''); name = elemName(p) + (aq ? (aq > 0 ? ' cations' : ' anions') : ' atoms'); col = atomColor(p); }
    seen.add(p);
    const e = c.get(key) || { n: 0, name, col }; e.n++; c.set(key, e);
  }
  return [...c.entries()].sort((a, b) => b[1].n - a[1].n);
}
/* Pressure on the walls (2-D: force per length of wall, N/m), from the walls' push averaged over about a picosecond
   (engine.js W.pWall), and Z, the ratio to an ideal gas of the same free movers (molecules and unbonded atoms) at the
   measured temperature: 1 for an ideal gas, below 1 where attractions pull the particles together (a dense gas, a
   liquid), above 1 where they are squeezed against each other. Free electrons bounce off the walls on their own and are
   not counted. */
const PRS = { sig: '', Ts: 0, Tn: 0 };
function wallPressure(mols, T) {
  let free = 0; for (const p of W.parts) if (!p.dead && p.k === NUC && !p.bonds.length && !p.rad && !p.beam) free++;
  const N = mols + free, L = 2 * (W.box.w + W.box.h), A = W.box.w * W.box.h, PB = W.pB;
  // averaged since the conditions last changed (box, walls, bath, what is free to move): a dilute gas hits the walls seldom
  const sig = [W.box.w, W.box.h, W.wall, Math.round(Math.log(Math.max(1, W.T)) * 30), N].join();
  if (sig !== PRS.sig) { PRS.sig = sig; PRS.Ts = 0; PRS.Tn = 0; if (PB) { PB.blocks.length = 0; PB.s = 0; PB.t = 0; } }
  if (T > 0) { PRS.Ts += T; PRS.Tn++; }
  if (!N || !PB || PB.blocks.length < 4 || !PRS.Tn) return null;
  const b = PB.blocks, n = b.length; let s = 0, s2 = 0; for (const v of b) { s += v; s2 += v * v; }
  const F = s / n, se = Math.sqrt(Math.max(0, s2 / n - F * F) / n), Tm = PRS.Ts / PRS.Tn;
  const P = F / L, ideal = N * PHYS.KB * Tm / A, Z = P / ideal, zErr = se / L / ideal; // (eV/Å²)
  const ok = zErr < 0.15, ps = n * 0.5;
  return { P: P * 16.0218, Z, ok, zErr, title: `The walls are pushed with ${fmtSI(P * 16.0218, 'N/m', 3)} on average over ${fmtNum(ps, 3)} ps (in 2-D, pressure is force per length of wall). An ideal gas of these ${N} free movers at ${fmtT(Tm)} would push ${fmtSI(ideal * 16.0218, 'N/m', 3)}: Z = ${Z.toFixed(2)} ± ${zErr.toFixed(2)}. ` +
    (!ok ? 'Still averaging: in a thin gas the particles hit the walls seldom.' : Z > 0.85 && Z < 1.15 ? 'It behaves like an ideal gas.' : Z <= 0.85 ? 'Below 1: the attractions between the particles pull them together, as in a dense gas or a liquid.' : 'Above 1: the particles are squeezed against each other.') };
}
function renderData() {
  const m = measure();
  let mols = 0; const seen = new Set();
  for (const p of W.parts) if (!p.dead && p.bonds.length && !seen.has(p)) { mols++; for (const a of molecule(p)) seen.add(a); }
  const tiles = [
    ['Measured T', fmtT(m.T)], ['Bath', W.gamma ? fmtT(W.T) : 'insulated'],
    ['Simulated time', fmtTime(W.t * PHYS.TU_S)], ['Decay speed', !W.decayOn ? 'paused' : W.warp > 1.0001 ? fmtFactor(W.warp) : 'real'],
    ['Atoms & ions', String(m.atoms)], ['Molecules', String(mols)],
    ['Free electrons', String(W.nE)], ['Ionized', (m.ionFrac * 100).toFixed(0) + '%'],
  ];
  const pr = W.wall === 'reflect' ? wallPressure(mols, m.T) : null;
  if (pr) tiles.push(['Wall pressure', `${fmtSI(pr.P, 'N/m', 2)}`, pr.title], ['vs ideal gas', pr.ok ? `Z = ${pr.Z.toFixed(2)}` : 'averaging …', pr.title]);
  $('dTiles').innerHTML = tiles.map(([k, v, t]) => `<div class="tile"${t ? ` title="${esc(t)}"` : ''}><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('');
  const sp = speciesCounts();
  $('dSpecies').innerHTML = sp.length ? sp.slice(0, 40).map(([k, e]) => `<tr><td class="f"><span class="sw" style="background:${e.col}"></span>${esc(k)}</td><td class="nm">${esc(e.name)}</td><td class="n">${e.n}</td></tr>`).join('')
    : '<tr><td class="nm">The chamber is empty.</td></tr>';
  const C = W.count;
  const counts = [['Bonds formed', C.bonds], ['Bonds broken', C.broken], ['Reactions', C.react], ['Electron transfers', C.xfer], ['Ionizations', C.ionize],
    ['Recombinations', C.recomb], ['Photons', C.photons], ['Fusions', C.fusion], ['Fissions', C.fission], ['Decays', C.decay], ['Neutron captures', C.ncap], ['Annihilations', C.annih], ['Stopped in the walls', C.wallStop]];
  $('dCounts').innerHTML = counts.map(([k, v]) => `<dt>${k}</dt><dd>${v.toLocaleString('en-US')}</dd>`).join('');
  const L = W.ledger;
  $('dLedger').innerHTML = [['Chemical heat released', fmtE(L.chem)], ['Nuclear energy released', fmtE(L.nuc)], ['Escaped as radiation & fast particles', fmtE(L.escaped)]]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  renderMade();
  drawSpec(); explainSync(); drawChain();
  drawTChart(); drawEChart(m.T); drawGraph();
  restoreScroll('tp-data');
}
/* What collisions, fusions, fissions, captures and decays have made so far (W.made), heaviest first: each nuclide with
   its name, half-life and decay, how many, and the event that first made it; then the unstable particles. */
const PART_NAMES = { 'pi+': 'charged pion', 'pi-': 'charged pion', pi0: 'neutral pion', 'mu-': 'muon', 'mu+': 'antimuon', 'K+': 'charged kaon', 'K-': 'charged kaon',
  K0S: 'neutral kaon (short-lived)', K0L: 'neutral kaon (long-lived)', eta: 'eta meson', Lam: 'lambda baryon', Lamb: 'antilambda', 'tau-': 'tau lepton', 'tau+': 'antitau',
  'Sig+': 'sigma baryon', 'Sig-': 'sigma baryon', Xi0: 'xi baryon', 'Xi-': 'xi baryon', 'Omg-': 'omega baryon', 'Sigb-': 'antisigma', 'Sigb+': 'antisigma', Xib0: 'antixi', 'Xib+': 'antixi', 'Omgb+': 'antiomega' };
function renderMade() {
  const M = W.made, sec = $('dMadeSec');
  const nuc = M ? [...M.nuc.values()] : [], part = M ? [...M.part.values()] : [], nus = M && M.nu ? [...M.nu.values()] : [];
  sec.hidden = !nuc.length && !part.length && !nus.length;
  if (sec.hidden) return;
  nuc.sort((a, b) => b.Z - a.Z || b.N - a.N || a.anti - b.anti);
  part.sort((a, b) => b.n - a.n);
  const els = new Set(nuc.filter(r => r.Z > 0).map(r => r.Z + (r.anti ? 'a' : ''))), top = nuc.find(r => r.Z > 0 && !r.anti);
  const synth = new Set(nuc.filter(r => r.Z > 92 && !r.anti).map(r => r.Z));
  const kinds = nuc.filter(r => r.Z > 0).length;
  let sum = kinds ? `${kinds} nuclide${kinds === 1 ? '' : 's'} of ${els.size} element${els.size === 1 ? '' : 's'}` : 'No new nuclides yet';
  if (top) sum += `; the heaviest element, ${ELEMENTS[top.Z].name.toLowerCase()} (Z = ${top.Z})${top.Z > Z_TABLE ? ', which no lab has made yet' : ''}`;
  if (synth.size) sum += `. ${synth.size === 1 ? 'One element is' : synth.size + ' elements are'} synthetic, beyond uranium: found nowhere in nature, made only in accelerators and reactors`;
  if (part.length || nus.length) sum += `. Particles: ${part.concat(nus).map(r => `${esc(r.lab)}&#8202;×${r.n}`).join(' · ')}`;
  $('dMadeSum').innerHTML = sum + '.';
  const row = (sw, lab, nm, sub, n) => `<tr><td class="f"><span class="sw" style="background:${sw}"></span>${esc(lab)}</td><td class="nm"><b>${nm}</b><br><span class="sub">${esc(sub)}</span></td><td class="n">${n}</td></tr>`;
  const html = nuc.slice(0, 80).map(r => {
    if (r.Z === 0) return row(r.anti ? NBAR_COL : N_COL, r.lab, r.anti ? 'Antineutrons' : 'Neutrons', `free, t½ 10 min · first: ${r.how}`, r.n);
    const info = nuclideInfo(r.Z, r.N), key = `${r.Z}_${r.N}`, alias = ISO_NAMES[key] && key !== '2_2' ? ISO_NAMES[key] : r.Z === 2 && r.N === 2 ? 'α particle' : '';
    const nm = esc((r.anti ? 'Anti-' + nucName(r.Z, r.N).toLowerCase() : nucName(r.Z, r.N)) + (alias ? ` (${r.anti ? 'anti-' : ''}${alias})` : '')) +
      (r.Z > 103 && !r.anti ? ' <span class="tag">superheavy</span>' : r.Z > 92 && !r.anti ? ' <span class="tag">synthetic</span>' : '');
    const life = info.stable ? 'stable' : info.unbound ? 'unbound: falls apart at once' : `${lifeText(info)}${info.modes && info.modes.length ? ', ' + modeLabel(info.modes[0].mode).replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()) : ''}`;
    return row(ELEMENTS[r.Z].color, r.lab, nm, `${life} · first: ${r.how} (at ${fmtTime(r.t * PHYS.TU_S)})`, r.n);
  }).join('') + part.map(r => { const d = XP[r.sp]; return row(rgba(d.col, 1), r.lab, esc(PART_NAMES[r.sp] || r.sp), `mean life ${fmtTime(d.tau)} · first: ${r.how}`, r.n); }).join('') +
    nus.map(r => row('rgb(120,255,170)', r.lab, r.anti ? 'Antineutrinos' : 'Neutrinos', `left the box at about c, ${fmtE(r.E)} carried off in all · first: ${r.how} (at ${fmtTime(r.t * PHYS.TU_S)})`, r.n)).join('');
  $('dMade').innerHTML = html + (nuc.length > 80 ? `<tr><td class="nm" colspan="3">… and ${nuc.length - 80} more nuclides</td></tr>` : '');
}
function chartCtx(cv) {
  const w = cv.clientWidth, h = cv.clientHeight; if (!w) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return [ctx, w, h];
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }
/* A slow change of the bath (Lab → Heat bath): from where it was to the chosen temperature, evenly on a log scale, over
   the chosen seconds of running (paused, it waits). Annealing, crystal growth, a slow quench. */
function rampTick(dt) {
  const r = W.ramp; r.t = Math.min(r.dur, r.t + dt);
  W.T = Math.exp(Math.log(r.from) + (Math.log(r.to) - Math.log(r.from)) * r.t / r.dur);
  if (r.t >= r.dur) { W.T = r.to; W.ramp = null; log('tool', `Bath at ${fmtT(r.to)}`); }
  if (!r.shown || r.t - r.shown > 0.25 || !W.ramp) { r.shown = r.t; $('tSlider').value = Math.round(100 * Math.log10(Math.max(1, W.T))); syncLabText(); rampSync(); }
}
function rampSync() {
  const r = W.ramp, n = $('rampNote');
  $('bRamp').textContent = r ? 'Stop' : 'Start'; $('bRamp').classList.toggle('go', !!r);
  n.hidden = !r; if (r) n.textContent = `Going to ${fmtT(r.to)}: ${Math.round(100 * r.t / r.dur)} % (${fmtNum(r.dur - r.t, 2)} s of running left).`;
}
/* The chain-reaction readout: k (neutrons born per neutron ended, over the last 300 ends, engine.js kEnd), whether the
   chain grows, holds or dies, where the neutrons went, and what would help. */
const KC_COL = ['#ff9f43', '#7aa2ff', '#a0a0a0', '#5c6370'];
function drawChain() {
  const K = W.kc, sec = $('dChainSec');
  sec.hidden = !K || K.ends < 5; if (sec.hidden) return;
  const n = Math.min(K.n, KC_N), c = [0, 0, 0, 0]; let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const v = K.v[i]; s += v; s2 += v * v; c[K.c[i]]++; }
  const k = s / n, se = Math.sqrt(Math.max(0, s2 / n - k * k) / n);
  $('dChainK').textContent = `k ≈ ${k.toFixed(2)}${n >= 20 ? ` ± ${se.toFixed(2)}` : ''}`;
  $('dChainState').textContent = n < 20 ? 'too few neutrons yet' : k - 2 * se > 1 ? 'supercritical: it grows' : k + 2 * se < 1 ? 'subcritical: it dies out' : 'about critical: it holds';
  const pc = c.map(x => (100 * x / n));
  $('dChainBar').innerHTML = pc.map((p, i) => p > 0 ? `<span style="width:${p}%;background:${KC_COL[i]}"></span>` : '').join('');
  const fuel = W.parts.filter(p => !p.dead && p.k === NUC && !p.anti && ((p.Z === 92 && p.N === 143) || (p.Z === 94 && p.N === 145) || (p.Z === 92 && p.N === 141))).length;
  const tip = c[2] / n > 0.3 ? ' Many escape: a bigger or denser lump of fuel, or reflecting walls, keeps more of them.' : c[1] / n > 0.35 ? ' Many are captured without fission: fewer absorbers in the way; for U-235, slower neutrons are likelier to cause fission.' : c[3] / n > 0.4 ? ' Many end otherwise (decay, other reactions): a denser fuel catches them sooner.' : '';
  $('dChainNote').textContent = `Of the last ${n} neutrons that ended: ${pc[0].toFixed(0)} % caused a fission (orange), ${pc[1].toFixed(0)} % were captured without one (blue), ${pc[2].toFixed(0)} % escaped (grey), ${pc[3].toFixed(0)} % ended otherwise. ` +
    `${K.gen ? `Generation ${K.gen} reached; ` : ''}${fuel ? `${fuel} fissile nuclei left.` : 'the fuel is used up.'} k is the neutrons each one passes on: above 1 the chain grows, below 1 it dies.` + tip;
}
/* The spectroscope: the light made in the box in the last SPEC_WIN seconds of watching (or since Clear), as counts per
   wavelength — the visible band over its colours with the known lines of the elements that gave it off marked, or
   everything from γ rays to the far infrared on a log scale. */
const SPEC_WIN = 10, SPEC_BANDS = [[1e-3, 'γ'], [0.01, 'X-ray'], [10, 'UV'], [380, 'vis'], [780, 'infrared'], [1e6, '']];
const BALMER = [[656.3, 'Hα'], [486.1, 'Hβ'], [434.0, 'Hγ'], [410.2, 'Hδ']];
let _specView = 'vis', _specFrom = -Infinity;
function specPhotons() {
  const S2 = W.spec; if (!S2) return [];
  const out = [], from = _specFrom > -Infinity ? _specFrom : W.rt - SPEC_WIN; // (since Clear, all that is kept; otherwise the last 10 s)
  for (let i = 0; i < S2.n; i++) { const k = (S2.total - 1 - i) % SPEC_N; if (S2.t[k] < from) break; out.push([S2.nm[k], S2.z[k]]); }
  return out;
}
function drawSpec() {
  const sec = $('dSpecSec'), ph = specPhotons();
  sec.hidden = !W.spec;
  if (sec.hidden) { if (_specFrom > -Infinity) { _specFrom = -Infinity; $('bSpecClear').textContent = 'Clear'; } return; }
  const r = chartCtx($('chSpec')); if (!r) return; const [ctx, w, h] = r;
  const vis = _specView === 'vis', pad = 6, base = h - 18;
  let lo, hi, fx, nb;
  let nWall0 = 0; for (const q of ph) if (q[1] === -1) nWall0++;
  if (vis) { lo = 380; hi = 780; nb = nWall0 > ph.length / 2 ? 80 : 200; /* (thermal light is a smooth curve: wider bins) */ fx = (nm) => pad + (nm - lo) / (hi - lo) * (w - 2 * pad); }
  else { lo = 1e-6; hi = 1e6; nb = 96; fx = (nm) => pad + (Math.log10(nm) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * (w - 2 * pad); }
  const bins = new Float64Array(nb), zs = new Map();
  let inRange = 0, nWall = 0;
  for (const [nm, z] of ph) {
    if (z === -1) nWall++;
    if (nm < lo || nm >= hi) continue;
    const b = vis ? Math.floor((nm - lo) / (hi - lo) * nb) : Math.floor((Math.log10(nm) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * nb);
    bins[clamp(b, 0, nb - 1)]++; inRange++;
    if (z > 0) zs.set(z, (zs.get(z) || 0) + 1);
  }
  const binNm = (i) => vis ? lo + i / nb * (hi - lo) : Math.pow(10, Math.log10(lo) + i / nb * (Math.log10(hi) - Math.log10(lo)));
  // glowing walls: Planck's law for the photons they gave off, per bin, as a dashed curve over the bars
  let planck = null;
  if (nWall > 20 && W.glow) {
    const kT = PHYS.KB * Math.max(1, W.T), Z3 = 1.2020569;
    planck = new Float64Array(nb);
    for (let i = 0; i < nb; i++) {
      const xa = PHYS.HC / (binNm(i + 1) * kT), xb = PHYS.HC / (binNm(i) * kT); let s = 0;
      for (let j = 0; j < 6; j++) { const x = xa + (j + 0.5) / 6 * (xb - xa); s += x * x / Math.expm1(x); }
      planck[i] = nWall * s * (xb - xa) / 6 / (2 * Z3);
    }
  }
  // the colours (visible) or the bands (everything) along the bottom
  if (vis) { for (let x = pad; x < w - pad; x++) { const nm = lo + (x - pad) / (w - 2 * pad) * (hi - lo), c = wavelengthRGB(nm); ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(x, base + 2, 1, 5); } }
  else {
    ctx.font = '10px ' + cssVar('--font-ui'); ctx.fillStyle = cssVar('--muted');
    for (let i = 0; i < SPEC_BANDS.length - 1; i++) {
      const a = fx(SPEC_BANDS[i][0]), b = fx(SPEC_BANDS[i + 1][0]), lab = SPEC_BANDS[i][1], tw = ctx.measureText(lab).width;
      ctx.fillRect(a, base + 2, 1, 5); if (lab && tw < b - a - 2) ctx.fillText(lab, (a + b - tw) / 2, base + 15);
    }
    const v0 = fx(380), v1 = fx(780); for (let x = Math.floor(v0); x < v1; x++) { const c = wavelengthRGB(380 + (x - v0) / (v1 - v0) * 400); ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(x, base + 2, 1, 5); }
  }
  let top = 0; for (const b of bins) top = Math.max(top, b); if (planck) for (const b of planck) top = Math.max(top, b);
  const bw = (w - 2 * pad) / nb;
  for (let i = 0; i < nb; i++) {
    if (!bins[i]) continue;
    const bh = Math.max(1.5, bins[i] / top * (base - 14)), nm = vis ? lo + (i + 0.5) / nb * (hi - lo) : Math.pow(10, Math.log10(lo) + (i + 0.5) / nb * (Math.log10(hi) - Math.log10(lo)));
    const c = nm >= 380 && nm <= 780 ? wavelengthRGB(nm) : photonColor(PHYS.HC / nm);
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(pad + i * bw, base - bh, Math.max(1, bw - (vis ? 0 : 1)), bh);
  }
  if (planck) {
    ctx.strokeStyle = cssVar('--fg'); ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.beginPath();
    for (let i = 0; i < nb; i++) { const x = pad + (i + 0.5) * bw, y = base - planck[i] / top * (base - 14); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // the known lines of the elements that made light here (and hydrogen's Balmer series), marked
  if (vis) {
    const marks = [];
    for (const [z] of [...zs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      const sym = ELEMENTS[z].sym;
      if (z === 1) for (const [nm, lab] of BALMER) marks.push([nm, lab]);
      else if (LINES[sym]) for (const [nm, wgt] of LINES[sym].l) if (wgt >= 2 && nm >= lo && nm < hi) marks.push([nm, `${sym} ${Math.round(nm)}`]);
    }
    ctx.font = '10px ' + cssVar('--font-data'); ctx.strokeStyle = cssVar('--muted'); ctx.fillStyle = cssVar('--fg'); ctx.setLineDash([2, 3]);
    let lastX = -1e9, row = 0;
    for (const [nm, lab] of marks.sort((a, b) => a[0] - b[0])) {
      const x = fx(nm); ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, 12); ctx.stroke();
      row = x - lastX < 34 ? (row + 1) % 2 : 0; lastX = x; ctx.fillText(lab, x + 2, 10 + row * 10);
    }
    ctx.setLineDash([]);
  }
  if (!inRange) { ctx.fillStyle = cssVar('--muted'); ctx.font = '12px ' + cssVar('--font-ui'); ctx.fillText(vis ? 'No visible light in the last 10 s (try Everything)' : 'No light in the last 10 s', 10, 20); }
  // the note: how many, the strongest line and who made it
  let best = -1, bi = 0; for (let i = 0; i < nb; i++) if (bins[i] > best) { best = bins[i]; bi = i; }
  const peak = vis ? lo + (bi + 0.5) / nb * (hi - lo) : Math.pow(10, Math.log10(lo) + (bi + 0.5) / nb * (Math.log10(hi) - Math.log10(lo)));
  const who = [...zs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([z, n]) => `${ELEMENTS[z].sym} ${n}`).concat(nWall ? [`the glowing walls ${nWall}`] : []).join(', ');
  const wien = W.glow && nWall ? ` The walls at ${fmtT(W.T)} follow Planck's law (dashed); Wien's law puts their brightest light at ${wavelengthText(PHYS.HC / (2.8977719e6 / Math.max(1, W.T))).lam}.` : '';
  $('dSpecNote').textContent = `${ph.length.toLocaleString('en-US')} photon${ph.length === 1 ? '' : 's'} ${_specFrom > -Infinity ? `since Clear (${fmtNum(W.rt - _specFrom, 2)} s)` : `in the last ${SPEC_WIN} s`}` +
    (inRange ? `; strongest at ${vis ? peak.toFixed(0) + ' nm' : wavelengthText(PHYS.HC / peak).lam}` : '') + (who ? `; given off by ${who}` : '') + '.' + (wien || ' Each element gives off its own lines.');
}
function drawTChart() {
  const r = chartCtx($('chT')); if (!r) return; const [ctx, w, h] = r;
  const H = W.hist; const n = H.T.length;
  if (n < 2) { ctx.fillStyle = cssVar('--muted'); ctx.font = '12px ' + cssVar('--font-ui'); ctx.fillText('Collecting…', 10, 20); return; }
  let lo = Infinity, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, H.T[i], H.bath[i] || Infinity); hi = Math.max(hi, H.T[i], H.bath[i] || 0); }
  lo = Math.max(1, lo); hi = Math.max(hi, lo * 1.2);
  const logy = hi / lo > 20;
  const fy = (T) => { const t = logy ? (Math.log(Math.max(T, 1)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (T - lo * 0.9) / (hi * 1.05 - lo * 0.9); return h - 8 - clamp(t, 0, 1) * (h - 16); };
  const fx = (i) => 6 + i / (n - 1) * (w - 12);
  ctx.lineWidth = 1.2; ctx.strokeStyle = cssVar('--muted'); ctx.setLineDash([4, 3]); ctx.beginPath();
  for (let i = 0; i < n; i++) { if (!H.bath[i]) continue; const x = fx(i), y = fy(H.bath[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.lineWidth = 1.8; ctx.strokeStyle = cssVar('--hot'); ctx.beginPath();
  for (let i = 0; i < n; i++) { const x = fx(i), y = fy(H.T[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  $('chTrange').textContent = `${fmtT(lo)} – ${fmtT(hi)}${logy ? ' (log)' : ''}`;
}
function drawEChart(T) {
  const r = chartCtx($('chE')); if (!r) return; const [ctx, w, h] = r;
  const kT = PHYS.KB * Math.max(T, 1e-3);
  const bins = new Array(24).fill(0), xmax = 6; let n = 0;
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.Z === 0 || p.fast || p.rad) continue;
    const x = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy) / kT;
    n++; if (x < xmax) bins[Math.floor(x / xmax * bins.length)]++;
  }
  if (n < 4) { ctx.fillStyle = cssVar('--muted'); ctx.font = '12px ' + cssVar('--font-ui'); ctx.fillText('Needs a few atoms', 10, 20); return; }
  const bw = (w - 12) / bins.length, dx = xmax / bins.length;
  const dens = bins.map(b => b / (n * dx));
  const top = 1.15;
  ctx.fillStyle = cssVar('--accent-soft'); ctx.strokeStyle = cssVar('--accent');
  for (let i = 0; i < bins.length; i++) { const bh = clamp(dens[i] / top, 0, 1) * (h - 16); ctx.fillRect(6 + i * bw + 1, h - 8 - bh, bw - 2, bh); }
  ctx.strokeStyle = cssVar('--hot'); ctx.lineWidth = 1.8; ctx.beginPath();
  for (let i = 0; i <= 60; i++) { const x = i / 60 * xmax, y = Math.exp(-x); const px = 6 + x / xmax * (w - 12), py = h - 8 - y / top * (h - 16); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
  ctx.fillStyle = cssVar('--muted'); ctx.font = '11px ' + cssVar('--font-data');
  ctx.fillText('0', 6, h - 1); ctx.fillText(`${xmax} kT`, w - 34, h - 1);
}

/* ------------------------------------------------------------------ log tab */
const LOG_CLS = { chem: ['Chemistry', '--chem'], em: ['Electrons & light', '--em'], nuc: ['Nuclear', '--nuc'], tool: ['You', '--tool'] };
function buildLogFilters() {
  $('logFilters').innerHTML = Object.entries(LOG_CLS).map(([k, [n, c]]) => `<label class="check"><input type="checkbox" data-f="${k}" ${UI.logFilter[k] ? 'checked' : ''}><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(${c})"></i>${n}</label>`).join('');
  $('logFilters').onchange = (e) => { const f = e.target.dataset.f; if (f) { UI.logFilter[f] = e.target.checked; UI.lastLogSeq = -1; renderLog(); } };
}
function renderLog() {
  if (UI.lastLogSeq === W.logSeq) return;
  UI.lastLogSeq = W.logSeq;
  const items = W.log.filter(l => UI.logFilter[l.cls] !== false).slice(-120).reverse();
  $('logList').innerHTML = items.length ? items.map(l => `<div class="e"><i style="background:var(${(LOG_CLS[l.cls] || LOG_CLS.tool)[1]})"></i><span>${esc(l.text)}${l.n > 1 ? ` <b>×${l.n}</b>` : ''}</span><span class="c">${esc(fmtTime(l.t * PHYS.TU_S))}</span></div>`).join('')
    : '<div class="empty">No events yet. Bonds, reactions, ionizations, captures and decays are listed here as they happen.</div>';
  restoreScroll('tp-log');
}

/* ------------------------------------------------------------------ lab panel */
const T_MARKS = [[4.2, 'liquid He'], [77, 'liquid N₂'], [300, 'room'], [1000, '1,000 K'], [1900, 'candle flame'], [5800, 'Sun’s surface'], [3e4, 'plasma'], [1.5e7, 'Sun’s core'], [1.5e8, 'fusion']];
const bFromS = (s) => Math.abs(s) < 3 ? 0 : Math.sign(s) * Math.pow(10, 1 + (Math.abs(s) - 3) / 97 * 4);
const sFromB = (B) => B === 0 ? 0 : Math.sign(B) * Math.round(3 + (clamp(Math.log10(Math.abs(B)), 1, 5) - 1) / 4 * 97);
const spdFromS = (s) => 0.01 * Math.pow(3000, s / 100);
const sFromSpd = (v) => Math.round(100 * Math.log(v / 0.01) / Math.log(3000));
const boxFromS = (s) => 20 * Math.pow(1000, s / 100); // 20 Å … 20,000 Å (2 µm)
const sFromBox = (w) => clamp(Math.round(100 * Math.log(w / 20) / Math.log(1000)), 0, 100);
/* Atom drawing: auto, shells, spheres, orbitals (O toggles), or the particle view (nuclei and electrons only, V). */
function setAtomView(v) {
  if (!['auto', 'on', 'off', 'orb', 'nuc'].includes(v)) v = 'auto';
  if (v !== 'nuc' && v !== 'orb') UI.lastView = v;
  R.view.bohr = v; store('bohr', v);
  setSegValue('segBohr', v);
  $('zNuc').setAttribute('aria-pressed', String(v === 'nuc'));
  $('zOrb').setAttribute('aria-pressed', String(v === 'orb'));
  if (UI.tab === 'inspect') renderInspect();
}
function toggleParticleView() { setAtomView(R.view.bohr === 'nuc' ? (UI.lastView || 'auto') : 'nuc'); }
function toggleOrbitalView() { setAtomView(R.view.bohr === 'orb' ? (UI.lastView || 'auto') : 'orb'); }
function setSegValue(id, v) { for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); }
function bindSeg(id, fn) { $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setSegValue(id, b.dataset.v); fn(b.dataset.v); }); }
/* ---- files: a world saved and loaded, My molecules and saved isotopes exported and imported, as JSON. Saving goes
   through the artifact page's `downloads` capability where the page has one (claude.ai asks the viewer to confirm), and
   through an ordinary download link elsewhere (the desktop app, a saved copy). Loading is a file picker everywhere, so a
   world or a library made on one can be dropped into the other. */
const FILES = { downloads: undefined }; // (undefined: not asked yet; null: none)
async function fileSave(name, text, type) {
  if (FILES.downloads === undefined) {
    FILES.downloads = null;
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (c && typeof c.use === 'function') { try { FILES.downloads = (await c.use('downloads')) || null; } catch (e) { FILES.downloads = null; } }
  }
  if (FILES.downloads) {
    try { await FILES.downloads.save({ filename: name, data: text }); return true; }
    catch (e) { if (e && e.code === 'declined') return false; log('tool', `Could not save ${name} here (${(e && e.code) || e}); trying the browser's own download`); }
  }
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: type || 'application/json' })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return true;
  } catch (e) { log('tool', `Could not save ${name}: ${e.message || e}`); return false; }
}
function filePick(accept, cb) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.style.display = 'none'; document.body.appendChild(inp);
  inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return; const r = new FileReader(); r.onload = () => cb(String(r.result || ''), f.name); r.onerror = () => log('tool', `Could not read ${f.name}`); r.readAsText(f); };
  inp.click();
}
const SAVE_KINDS = new Set([NUC, ELEC, POS]);
/* The world as data: the box, bath, fields and pace, every nucleus, atom, ion and free lepton with its velocity (one in
   radiation flight with its energy and direction: a tenth entry), the bonds among them and the magnets. Not kept:
   light, beams, a collider's rings, and chips' circuits (their atoms are saved as atoms). */
function worldToJSON() {
  const ps = W.parts.filter(p => !p.dead && SAVE_KINDS.has(p.k) && !p.beam && !p.caught);
  const ix = new Map(ps.map((p, i) => [p, i])), r6 = (v) => Math.round(v * 1e6) / 1e6;
  const parts = ps.map(p => { const a = [p.k, p.Z, p.N, p.ne, p.anti ? 1 : 0, r6(p.x), r6(p.y), r6(p.vx), r6(p.vy)]; if (p.rad) a.push(p.KE); return a; });
  const bonds = [];
  for (const p of ps) for (const bd of p.bonds) { if (bd.a !== p) continue; const j = ix.get(bd.b); if (j !== undefined) bonds.push([ix.get(p), j, bd.order]); }
  return { app: 'Atom Forge', v: 1, title: document.title, saved: new Date().toISOString(), preset: UI.preset, box: { w: W.box.tw, h: W.box.th }, wall: W.wall, nWall: W.nWall, T: W.T, gamma: W.gamma, Bz: W.Bz, Ex: W.Ex, Ey: W.Ey,
    spf: W.simPerFrame, warp: W.warp, decayOn: W.decayOn, slowmo: W.slowmo, glow: !!W.glow, parts, bonds, magnets: W.magnets.map(m => ({ x: m.x, y: m.y, R: m.R, B: m.B })), chips: W.chips.length, left: W.parts.filter(p => !p.dead).length - ps.length };
}
function worldFromJSON(d) {
  if (!d || d.app !== 'Atom Forge' || !Array.isArray(d.parts) || !Array.isArray(d.bonds) || !d.box) return 'not an Atom Forge world file';
  if (d.parts.length > MAX_PARTS) return `${d.parts.length.toLocaleString('en-US')} particles: over the limit of ${MAX_PARTS.toLocaleString('en-US')} (Settings → Particle limit)`;
  const num = (v, lo, hi, dflt) => (Number.isFinite(v) ? clamp(v, lo, hi) : dflt);
  if (!REW.restoring) { rewClear(); grClear(); }
  setRunning(false); clearWorld(); UI.preset = typeof d.preset === 'string' ? d.preset : 'empty';
  W.box.w = W.box.tw = num(d.box.w, 20, 20000, 200); W.box.h = W.box.th = num(d.box.h, 20, 20000, 140); UI.aspect = W.box.th / W.box.tw;
  W.wall = ['reflect', 'wrap', 'open'].includes(d.wall) ? d.wall : 'reflect'; W.nWall = ['reflect', 'absorb', 'pass'].includes(d.nWall) ? d.nWall : 'reflect'; W.T = num(d.T, 1, 1e9, 300); W.gamma = num(d.gamma, 0, 1, 0.05); W.Bz = num(d.Bz, -1e5, 1e5, 0); W.Ex = num(d.Ex, -50, 50, 0); W.Ey = num(d.Ey, -50, 50, 0);
  UI.E = Math.hypot(W.Ex, W.Ey); UI.Eang = UI.E ? Math.round(Math.atan2(W.Ey, W.Ex) * 180 / Math.PI) : (UI.Eang || 0); // (the Lab's field figure and direction, from the field)
  W.simPerFrame = num(d.spf, DT_MIN, 1000, W.simPerFrame); W.baseSpf = W.simPerFrame; UI.baseSpf = W.simPerFrame; W.warp = num(d.warp, 1, 1e30, 1); W.decayOn = d.decayOn !== false; if (typeof d.slowmo === 'boolean') W.slowmo = d.slowmo; W.glow = d.glow === true;
  const made = [], hw = W.box.w / 2, hh = W.box.h / 2;
  for (const q of d.parts) {
    if (!Array.isArray(q) || q.length < 9) { made.push(null); continue; }
    const [k, Z, N, ne, anti, x, y, vx, vy] = q;
    if (![x, y, vx, vy].every(Number.isFinite)) { made.push(null); continue; }
    const px = clamp(x, -hw, hw), py = clamp(y, -hh, hh);
    let p = null;
    if (k === NUC) { if (!Number.isInteger(Z) || Z < 0 || Z > Z_MAX || !Number.isInteger(N) || N < 0 || N > 400 || !Number.isInteger(ne) || ne < 0 || ne > Z + 3) { made.push(null); continue; } p = addNuc(Z, N, ne, px, py, vx, vy, anti === 1); }
    else if (k === ELEC || k === POS) p = addLepton(k, px, py, vx, vy);
    const KE = q[9], v = Math.hypot(vx, vy);
    if (p && Number.isFinite(KE) && KE > 0 && v > 0) setMotion(p, KE, vx / v, vy / v); // (in radiation flight: its energy, as saved)
    made.push(p);
  }
  let nb = 0;
  for (const b of d.bonds) { if (!Array.isArray(b)) continue; const [i, j, o] = b; const a = made[i], c = made[j]; if (a && c && a !== c && [1, 2, 3].includes(o)) { addBond(a, c, o); nb++; } }
  if (Array.isArray(d.magnets)) for (const m of d.magnets.slice(0, 50)) if (m && Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.B)) W.magnets.push({ x: m.x, y: m.y, R: num(m.R, 1, 1000, 10), B: clamp(m.B, -1e9, 1e9) });
  W.dirty++; W.spawned++; W.topo++; W.hist = { t: [], T: [], bath: [] }; R.sel = null; R.msel.clear();
  syncLab(); fitView(); renderInspect(); buildToolOpts();
  const n = made.filter(Boolean).length;
  return { n, nb, skipped: d.parts.length - n };
}
function saveWorld() {
  const d = worldToJSON(), name = `atom-forge-world-${(UI.preset || 'world').replace(/[^a-z0-9-]/gi, '')}.json`;
  fileSave(name, JSON.stringify(d)).then((ok) => { if (ok) log('tool', `World saved: ${d.parts.length.toLocaleString('en-US')} particles, ${d.bonds.length.toLocaleString('en-US')} bonds${d.chips ? `; ${d.chips} chip${d.chips === 1 ? '' : 's'} saved as plain atoms` : ''}${d.left ? `; ${d.left} particle${d.left === 1 ? '' : 's'} in flight left out` : ''}`); });
}
function loadWorld() {
  filePick('.json,application/json', (text, name) => {
    let d; try { d = JSON.parse(text); } catch (e) { log('tool', `${name}: not a JSON file`); return; }
    const r = worldFromJSON(d);
    if (typeof r === 'string') { log('tool', `${name}: ${r}`); return; }
    log('tool', `World loaded from ${name}: ${r.n.toLocaleString('en-US')} particles, ${r.nb.toLocaleString('en-US')} bonds${r.skipped ? ` (${r.skipped} entries could not be read)` : ''}`);
  });
}
/* Share codes: the saved world (worldToJSON) squeezed (deflate) into one line of text, "AF1:" and base64url, to paste
   into a message; whoever gets it pastes it into Share code… → Open. A page opened with #AF1:… after its address loads
   that world. */
const SHARE_PREFIX = 'AF1:', SHARE_MAX = 30e6;
const b64u = { to: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  from: (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } };
async function shareEncode(d) {
  const o = Object.assign({}, d); delete o.title; delete o.saved;
  const z = await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return SHARE_PREFIX + b64u.to(new Uint8Array(z));
}
async function shareDecode(code) {
  const s = String(code || '').replace(/\s+/g, '').replace(/^#/, '');
  if (!s.startsWith(SHARE_PREFIX)) return 'not a share code (they start with AF1:)';
  if (s.length > SHARE_MAX) return 'too long to be a share code';
  let text;
  try {
    const st = new Blob([b64u.from(s.slice(SHARE_PREFIX.length))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const rd = st.getReader(), parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > 200e6) { rd.cancel(); return 'too large'; } parts.push(value); }
    text = new TextDecoder().decode(await new Blob(parts).arrayBuffer());
  } catch (e) { return 'the code is damaged or cut short (copy all of it)'; }
  let d; try { d = JSON.parse(text); } catch (e) { return 'the code is damaged'; }
  return d;
}
async function shareOpen(code) {
  const d = await shareDecode(code);
  if (typeof d === 'string') return d;
  const r = worldFromJSON(d);
  if (typeof r === 'string') return r;
  log('tool', `World opened from a share code: ${r.n.toLocaleString('en-US')} particles, ${r.nb.toLocaleString('en-US')} bonds${r.skipped ? ` (${r.skipped} entries could not be read)` : ''}`);
  return null;
}
function shareInit() {
  const ok = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  $('bShare').hidden = !ok; if (!ok) return;
  $('bShare').onclick = async () => {
    $('shareOut').value = ''; $('shareCopy').disabled = true; $('shareCopied').textContent = ''; $('shareErr').textContent = ''; $('shareIn').value = '';
    $('shareInfo').textContent = 'Making the code …'; showModal('shareModal');
    const d = worldToJSON(), code = await shareEncode(d), kb = code.length / 1024;
    $('shareOut').value = code; $('shareCopy').disabled = false;
    $('shareInfo').textContent = `${d.parts.length.toLocaleString('en-US')} particles and ${d.bonds.length.toLocaleString('en-US')} bonds in ${kb < 1000 ? Math.ceil(kb) + ' KB' : (kb / 1024).toFixed(1) + ' MB'} of text.` +
      (kb > 900 ? ' That is a lot to paste into a message: Save world… makes a file instead.' : ' Send it to someone with Atom Forge; they paste it below.') + (W.chips.length ? ' Chips go as plain atoms (as in a saved file).' : '');
    $('shareOut').focus(); $('shareOut').select();
  };
  $('shareClose').onclick = () => hideModal('shareModal');
  $('shareCopy').onclick = async () => {
    const t = $('shareOut'); t.focus(); t.select(); let ok2;
    try { await navigator.clipboard.writeText(t.value); ok2 = true; } catch (e) { try { ok2 = document.execCommand('copy'); } catch (e2) { ok2 = false; } }
    $('shareCopied').textContent = ok2 ? 'Copied.' : 'Select the text and copy it (Ctrl+C / ⌘C).';
  };
  $('shareOpen').onclick = async () => {
    $('shareErr').textContent = '';
    const err = await shareOpen($('shareIn').value);
    if (err) { $('shareErr').textContent = err[0].toUpperCase() + err.slice(1) + '.'; return; }
    hideModal('shareModal');
  };
  let h = ''; try { h = decodeURIComponent(location.hash || ''); } catch (e) { h = ''; }
  if (h.startsWith('#' + SHARE_PREFIX)) setTimeout(() => shareOpen(h).then((e) => { if (e) log('tool', `The link's world could not be opened: ${e}`); }), 0);
}
/* Video: the chamber as the viewer sees it (background, GL and overlay canvases), a frame every 1/30 s of watching ×
   the speed-up while the simulation runs, kept as JPEGs (at most REC.MAX: two minutes of video); on Stop they are
   played into a MediaRecorder at 30 frames a second (WebM, or MP4 where that is what the browser makes) and saved. */
const REC = { on: false, speed: 1, frames: [], last: 0, pend: 0, cv: null, t0: 0, MAX: 3600, busy: false };
function recMime() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return '';
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
function recSize() { const c = $('cv'), k = Math.min(1, 1280 / Math.max(1, c.width)); return [Math.max(2, Math.round(c.width * k / 2) * 2), Math.max(2, Math.round(c.height * k / 2) * 2)]; }
function recCapture() {
  if (!UI.running) return;
  if (UI.vis - REC.last < REC.speed / 30 - 1e-4) return;
  REC.last = UI.vis;
  if (REC.pend > 6) return; // (the JPEG encoder is behind: skip a frame rather than pile up)
  const [w, h] = recSize(), cv = REC.cv || (REC.cv = document.createElement('canvas'));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.fillStyle = getComputedStyle($('cv').parentNode).backgroundColor || '#000'; ctx.fillRect(0, 0, w, h);
  for (const id of ['cvbg', 'cvgl', 'cv']) { const c = $(id); if (c && c.width && !c.hidden && c.style.display !== 'none') try { ctx.drawImage(c, 0, 0, w, h); } catch (e) { /* (a canvas that cannot be read) */ } }
  const i = REC.frames.length; REC.frames.push(null); REC.pend++;
  cv.toBlob((b) => { REC.pend--; REC.frames[i] = b; }, 'image/jpeg', 0.85);
  recShow();
  if (REC.frames.length >= REC.MAX) recStop();
}
function recShow() {
  const n = REC.frames.length, s = n / 30, t = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  $('recBadge').hidden = !REC.on && !REC.busy;
  $('recBadge').textContent = REC.busy ? 'SAVING VIDEO' : `● REC ${t}${REC.speed > 1 ? ` (${REC.speed}×)` : ''}`;
  $('bRec').textContent = REC.on ? `Stop and save (${t})` : 'Record video';
  $('bRec').classList.toggle('go', REC.on);
}
function recStart() {
  const mime = recMime();
  if (!mime) { recNote('This browser cannot make videos (no MediaRecorder for canvases).'); return; }
  REC.on = true; REC.frames = []; REC.last = -1; REC.pend = 0; REC.mime = mime; REC.preset = UI.preset;
  recNote(`Recording${REC.speed > 1 ? ` a ${REC.speed}× time-lapse` : ''}: press Stop and save when done (at most ${REC.MAX / 30 / 60} minutes of video).${UI.running ? '' : ' It records once the simulation runs.'}`);
  recShow();
}
function recNote(t) { const n = $('recNote'); n.hidden = !t; n.textContent = t || ''; }
async function recStop() {
  if (!REC.on) return; REC.on = false; REC.busy = true; recShow(); $('bRec').disabled = true;
  try {
    for (let i = 0; i < 100 && REC.pend > 0; i++) await new Promise((r) => { setTimeout(r, 30); });
    const frames = REC.frames.filter(Boolean); REC.frames = [];
    if (frames.length < 2) { recNote('Nothing was recorded: the simulation was paused.'); return; }
    const first = await createImageBitmap(frames[0]), cv = document.createElement('canvas'); cv.width = first.width; cv.height = first.height; first.close();
    const ctx = cv.getContext('2d'), stream = cv.captureStream(30), mr = new MediaRecorder(stream, { mimeType: REC.mime, videoBitsPerSecond: 6e6 }), chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise(r => { mr.onstop = r; });
    mr.start(1000);
    const t0 = performance.now();
    for (let i = 0; i < frames.length; i++) {
      const bm = await createImageBitmap(frames[i]); ctx.drawImage(bm, 0, 0); bm.close();
      const tr = stream.getVideoTracks()[0]; if (tr && tr.requestFrame) tr.requestFrame();
      if (i % 15 === 0) recNote(`Making the video … ${Math.round(100 * i / frames.length)} % (it plays the frames through once: ${Math.ceil((frames.length - i) / 30)} s left)`);
      const wait = t0 + (i + 1) * 1000 / 30 - performance.now(); if (wait > 0) await new Promise((r) => { setTimeout(r, wait); });
    }
    mr.stop(); await done; stream.getTracks().forEach(t => t.stop());
    const type = REC.mime.split(';')[0], ext = type === 'video/mp4' ? 'mp4' : 'webm', blob = new Blob(chunks, { type });
    const name = `atom-forge-${(REC.preset || 'world').replace(/[^a-z0-9-]/gi, '')}${REC.speed > 1 ? '-' + REC.speed + 'x' : ''}.${ext}`;
    const ok = await fileSave(name, blob, type);
    recNote(ok ? `Saved ${name}: ${(frames.length / 30).toFixed(1)} s of video, ${(blob.size / 1048576).toFixed(1)} MB.` : 'The video was not saved.');
    if (ok) log('tool', `Video saved: ${name}`);
  } catch (e) { recNote(`The video could not be made (${e && e.message || e}).`); }
  finally { REC.busy = false; $('bRec').disabled = false; recShow(); }
}
function recInit() {
  $('bRec').onclick = () => { if (REC.busy) return; if (REC.on) recStop(); else recStart(); };
  bindSeg('segRec', (v) => { REC.speed = +v; if (REC.on) recShow(); });
  if (!recMime()) { $('bRec').disabled = true; $('bRec').title = 'This browser cannot record the canvas as a video'; }
}
/* Gallery: worlds kept in this browser (localStorage: an index, and each world as its share code with a 240 px picture).
   A convenience for one viewer, so storage that may be missing or full is said so plainly. */
const GAL_MAX = 40;
function galIndex() { try { const a = JSON.parse(store('gallery') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function galPut(k, v) { try { localStorage.setItem('atomforge.' + k, v); return true; } catch (e) { return false; } }
function galGet(k) { try { return localStorage.getItem('atomforge.' + k); } catch (e) { return null; } }
function galDel(k) { try { localStorage.removeItem('atomforge.' + k); } catch (e) { /* (no storage) */ } }
function galThumb() {
  const c = $('cv'), w = 240, h = Math.max(1, Math.round(240 * c.height / Math.max(1, c.width))), t = document.createElement('canvas'); t.width = w; t.height = h;
  const ctx = t.getContext('2d'); ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, w, h);
  for (const id of ['cvbg', 'cvgl', 'cv']) { const e = $(id); if (e && e.width) try { ctx.drawImage(e, 0, 0, w, h); } catch (err) { /* (unreadable) */ } }
  try { return t.toDataURL('image/jpeg', 0.75); } catch (e) { return ''; }
}
function galRender() {
  const list = galIndex(), box = $('galList');
  box.innerHTML = list.length ? list.map(g => `<div class="gcard" data-g="${esc(g.id)}"><img alt="${esc(g.name)}" src="${g.img && /^data:image\/jpeg;base64,/.test(g.img) ? g.img : ''}" data-act="open" title="Open ${esc(g.name)}"><div class="gmeta"><b>${esc(g.name)}</b><span class="note">${esc(new Date(g.t).toLocaleDateString())} · ${Number(g.n || 0).toLocaleString('en-US')} particles</span></div><div class="grow"><button class="btn small" data-act="open">Open</button><button class="btn small" data-act="del">Delete</button></div></div>`).join('')
    : '<p class="note">Nothing kept yet.</p>';
}
async function galSave() {
  const say = (t) => { $('galMsg').textContent = t; };
  const list = galIndex();
  if (list.length >= GAL_MAX) { say(`The gallery holds ${GAL_MAX} worlds: delete one first.`); return; }
  const d = worldToJSON(), code = await shareEncode(d), id = 'g' + Date.now().toString(36);
  const P = PRESETS[UI.preset], name = ($('galName').value || '').trim().slice(0, 50) || (P ? P.name.replace(/^✓ /, '') : 'My world');
  if (!galPut('g.' + id, code)) { say('There is no room left in this browser\'s storage (or it is switched off): delete a world, or use Save world… for a file.'); return; }
  const entry = { id, name, t: Date.now(), n: d.parts.length, img: galThumb() };
  list.unshift(entry);
  if (!galPut('gallery', JSON.stringify(list))) { entry.img = ''; if (!galPut('gallery', JSON.stringify(list))) { galDel('g.' + id); say('There is no room left in this browser\'s storage.'); return; } }
  $('galName').value = ''; say(`Kept “${name}”.`); galRender();
}
function galInit() {
  $('bGallery').hidden = typeof CompressionStream !== 'function';
  $('bGallery').onclick = () => { $('galMsg').textContent = ''; galRender(); showModal('galModal'); };
  $('galClose').onclick = () => hideModal('galModal');
  $('galSave').onclick = () => galSave();
  $('galName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); galSave(); } e.stopPropagation(); });
  $('galList').onclick = async (e) => {
    const a = e.target.closest('[data-act]'), card = e.target.closest('[data-g]'); if (!a || !card) return;
    const id = card.dataset.g, list = galIndex(), g = list.find(x => x.id === id); if (!g) return;
    if (a.dataset.act === 'del') { galDel('g.' + id); galPut('gallery', JSON.stringify(list.filter(x => x.id !== id))); galRender(); return; }
    const code = galGet('g.' + id); if (!code) { $('galMsg').textContent = 'That world is missing from this browser\'s storage.'; return; }
    undoMark('Open from the gallery'); const err = await shareOpen(code); if (err) { $('galMsg').textContent = err; return; }
    hideModal('galModal'); hideMainMenu(); setRunning(true); log('tool', `Opened “${g.name}” from the gallery`);
  };
}
/* Explain: Claude (on claude.ai, or with an API key in Settings) explains what the chamber is doing, from a digest of what
   the panels show; without Claude, the setup's own description and the latest events. */
const EXPLAIN = { busy: false, ctl: null };
function tblText(el, max) {
  if (!el) return '';
  const rows = el.querySelectorAll('tr'); let s = '';
  if (rows.length) for (const r of rows) s += [...r.children].map(c => c.textContent.trim()).filter(Boolean).join(' | ') + '\n';
  else { const t = [...el.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()); if (el.classList.contains('kv')) { for (let i = 0; i + 1 < t.length; i += 2) if (t[i + 1] && t[i + 1] !== '0') s += `${t[i]}: ${t[i + 1]}\n`; } else s = t.filter(Boolean).join('\n'); }
  return s.slice(0, max);
}
function explainDigest() {
  const P = PRESETS[UI.preset], m = measure(), out = [];
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  out.push(`Setup: ${P ? P.name + ' — ' + strip(P.hint) : 'built by the viewer'}`);
  out.push(`Box ${fmtNum(W.box.w, 3)} × ${fmtNum(W.box.h, 3)} Å, walls ${W.wall}; heat bath ${fmtT(W.T)} (coupling ${W.gamma}); electric field ${fmtNum(Math.hypot(W.Ex, W.Ey), 3)} V/Å; magnetic field ${fmtNum(W.Bz, 3)} T; motion: ${motionText()}; ${UI.running ? 'running' : 'paused'}${W.slow ? ', in slow motion for an event' : ''}.`);
  out.push(`Measured: temperature ${fmtT(m.T)}${m.Te ? `, electrons ${fmtT(m.Te)}` : ''}; ${m.atoms} nuclei/atoms, ${Math.round(m.ionFrac * 100)} % ionized; ${W.nE} free electrons.`);
  const sp = tblText($('dSpecies'), 1500); if (sp) out.push('What is in the box:\n' + sp);
  const mk = !$('dMadeSec').hidden ? ($('dMadeSum').textContent + '\n' + tblText($('dMade'), 1000)) : ''; if (mk.trim()) out.push('Made here so far:\n' + mk);
  const ct = tblText($('dCounts'), 800); if (ct) out.push('Counts:\n' + ct);
  if (!$('dSpecSec').hidden) out.push('Spectrum: ' + $('dSpecNote').textContent);
  if (W.chips.length) out.push('Chips:\n' + $('chipPanel').textContent.replace(/\s+/g, ' ').slice(0, 800));
  const ev = W.log.slice(-15).map(e => `[${e.cls}] ${e.text}${e.n > 1 ? ` (×${e.n})` : ''}`).join('\n'); if (ev) out.push('Latest events, oldest first:\n' + ev);
  const p = R.sel && !R.sel.dead ? R.sel : null;
  if (p) out.push('The viewer has selected one particle; what the inspector shows about it:\n' + $('tp-inspect').textContent.replace(/\s+/g, ' ').slice(0, 1200));
  return out.join('\n\n');
}
function explainLocal() {
  const P = PRESETS[UI.preset], ev = W.log.slice(-5).map(e => '• ' + e.text + (e.n > 1 ? ` (×${e.n})` : ''));
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return (P ? strip(P.hint) : 'A world of your own making.') + (ev.length ? '\n\nLately:\n' + ev.join('\n') : '') +
    '\n\n(For an explanation written for what is on screen now, open this on claude.ai, or add a Claude API key in Settings.)';
}
function explainSync() {
  const b = $('bExplain'), sel = R.sel && !R.sel.dead;
  b.textContent = EXPLAIN.busy ? 'Stop' : sel ? 'Explain this (and what is selected)' : 'Explain what\'s happening';
  b.classList.toggle('go', !EXPLAIN.busy);
  $('dExplainWho').textContent = AI.sample ? '' : '(the setup\'s own notes: Claude is not connected here)';
}
async function explainRun() {
  const out = $('dExplain');
  if (EXPLAIN.busy) { if (EXPLAIN.ctl) EXPLAIN.ctl.abort(); return; }
  out.hidden = false; out.classList.remove('bad');
  if (!AI.sample || typeof AI.sample !== 'function') { out.textContent = explainLocal(); return; }
  EXPLAIN.busy = true; EXPLAIN.ctl = new AbortController(); explainSync();
  out.textContent = 'Claude is looking at the chamber …';
  const prompt = 'You are explaining a live, two-dimensional atom-and-particle simulator (Atom Forge) to a curious viewer who is looking at it right now. ' +
    'From the state below, explain in plain language what is happening and the real physics or chemistry behind it, in at most 160 words. ' +
    'If a particle is selected, start with it. Finish with one short suggestion of something to try next in the simulator (heat it, add an element, change a field …). ' +
    'Where the 2-D model simplifies reality, you may say so briefly. Write plain text in short paragraphs: no Markdown, no headings, no bullet symbols.\n\n--- State of the chamber ---\n' + explainDigest();
  try {
    const r = await AI.sample(prompt, { modelTier: 'default', signal: EXPLAIN.ctl.signal, cache: false, onText: (u) => { out.textContent = String(u && u.text != null ? u.text : u).replace(/\*\*/g, ''); } });
    out.textContent = r.text.replace(/\*\*/g, '') + (r.truncated ? ' …' : '');
  } catch (e) {
    const code = (e && e.code) || 'upstream_error';
    if (code === 'cancelled') out.textContent = (e.text || '') + (e.text ? ' …' : 'Stopped.');
    else if (AI_HIDE.includes(code) && !(AI.sample && AI.sample.api)) { AI.sample = null; aiSync(); out.textContent = explainLocal(); }
    else { out.textContent = (e.text ? e.text + '\n\n' : '') + aiErrorText(code); out.classList.add('bad'); }
  } finally { EXPLAIN.busy = false; EXPLAIN.ctl = null; explainSync(); }
}
function explainInit() {
  $('bExplain').onclick = () => explainRun(); explainSync();
  $('chkNarr').checked = !!SET.narr; $('chkNarr').onchange = (e) => { setSetting('narr', e.target.checked); NARR.seq = W.logSeq; if (!e.target.checked) $('narr').hidden = true; };
}
/* The narrator: notable events from the log, each with a caption saying what happened and why, one at a time (the most
   important first: nuclear, then light and charge, then chemistry), each shown at least 5 s; the same kind not again
   within 12 s. */
const NARR = { seq: 0, until: 0, last: new Map(), cur: '' };
const NARR_RULES = [
  [/^Muon-catalysed fusion: (\S+) → .*fusion no\. (\d+)/, 'mucf', 10, (m) => `<b>Muon-catalysed fusion</b> (this muon’s no. ${m[2]}). In the molecule ${m[1]} the heavy muon holds the two nuclei about 200 times closer than electrons could, close enough to fuse at room temperature or colder: ⁴He + n + 17.6 MeV. The muon usually comes free to do it again.`],
  [/^Muonic atom: μ⁻ caught by (\S+)/, 'muatom', 8, (m) => `<b>A muonic atom.</b> A slowed negative muon was caught by ${m[1]} and fell to an orbit 207 times closer than an electron’s (it is 207 times heavier), giving off X-rays.`],
  [/^Muon transfer/, 'mutr', 6, () => '<b>Muon transfer.</b> The muon hopped to a heavier hydrogen isotope, whose nucleus holds it a little deeper: the first step towards catalysed fusion.'],
  [/^Muon capture by the nucleus/, 'mucap', 8, () => '<b>Muon capture.</b> In a heavy atom the muon’s orbit overlaps the nucleus, and a proton there swallowed it: μ⁻ + p → n + ν. The nucleus, one charge down and hot, boils off neutrons.'],
  [/quark–gluon plasma: (\d+) nucleons melted at √s_NN = ([^,]+), froze out into ([\d,]+) hadrons/, 'qgp', 10, (m) => `<b>Quark–gluon plasma.</b> ${m[1]} protons and neutrons overlapped so hard (${m[2]} per nucleon pair) that they melted into free quarks and gluons: the state the whole universe was in for its first few microseconds. The drop expanded and cooled in about 10⁻²³ s, and at 1.8 trillion K froze back into ${m[3]} hadrons, mostly pions.`],
  [/strings along the beams/, 'strings', 9, () => '<b>Strings.</b> The protons’ quarks flew apart joined by strings of the strong force, which broke again and again into quark–antiquark pairs: each piece became a hadron, so they stream out along the beams.'],
  [/^Annihilation in flight: e⁻ \+ e⁺ → [^(]*[πK][^(]*\(√s = ([\d.]+) GeV/, 'jets', 9, (m) => +m[1] >= 2.5 ? `<b>Two jets.</b> The electron and positron became a quark and an antiquark flying apart; the colour string between them broke into ${'pions and kaons'}, two sprays back to back along the quarks’ paths.` : '<b>Hadrons from light.</b> The electron and positron annihilated into a quark–antiquark pair, which came out as mesons.'],
  [/^Fission: (\S+) \+ n → (\S+) \+ (\S+) \+ (\d)n/, 'fission', 9, (m) => `<b>Fission.</b> A neutron made ${m[1]} split into ${m[2]} and ${m[3]}, freeing ${m[4]} more neutrons that can split other nuclei: a chain reaction. The pieces weigh less than what went in; the missing mass became about 200 MeV of energy (E = mc²), millions of times what a chemical bond releases.`],
  [/^Spontaneous fission/, 'sfission', 8, () => '<b>Spontaneous fission.</b> A heavy nucleus split by itself, with no neutron to start it: quantum tunnelling through the barrier that usually holds it together.'],
  [/^Fusion: (.+?) → (.+?) \(/, 'fusion', 9, (m) => `<b>Fusion.</b> ${m[1]} → ${m[2]}. Two nuclei came close enough, despite their electric repulsion, for the strong force to join them; the product weighs less than the parts, and the difference is released as energy. This is what powers the Sun.`],
  [/^Neutron capture: (\S+) \+ n → (\S+)/, 'ncap', 6, (m) => `<b>Neutron capture.</b> ${m[1]} absorbed a neutron and became ${m[2]}, a heavier isotope of the same element (same protons, one more neutron), giving off the binding energy as a γ ray.`],
  [/^(α|Alpha)[^:]*decay|→ .*\+ (α|⁴He)/, 'alpha', 7, () => '<b>Alpha decay.</b> An unstable nucleus threw out an α particle (two protons and two neutrons), becoming a different element two places down the periodic table.'],
  [/^β⁻|^Beta-minus|β⁻ decay/, 'betam', 7, () => '<b>Beta decay.</b> Inside the nucleus a neutron turned into a proton, sending out an electron and an antineutrino: the weak force at work. The atom moves one place up the periodic table.'],
  [/^β⁺|^Beta-plus|β⁺ decay/, 'betap', 7, () => '<b>Positron emission.</b> A proton in the nucleus turned into a neutron, sending out a positron (antimatter) and a neutrino. The atom moves one place down the periodic table.'],
  [/Electron capture:/, 'ec', 6, () => '<b>Electron capture.</b> The nucleus swallowed one of its own inner electrons, turning a proton into a neutron.'],
  [/^Pair production/, 'pair', 8, () => '<b>Pair production.</b> A γ ray with more than 1.022 MeV turned into an electron and a positron near a nucleus: energy becoming matter and antimatter (E = mc² backwards).'],
  [/^Annihilation.*e[⁺⁻] .*→ 2γ|^Annihilation: e⁺|Annihilation in flight: e⁻ \+ e⁺/, 'annihe', 8, () => '<b>Annihilation.</b> An electron met its antiparticle, a positron: both vanished into two γ rays of 511 keV each, flying apart in opposite directions. This is what a PET scanner detects.'],
  [/^Antimatter annihilation|^Annihilation/, 'annih', 8, () => '<b>Annihilation.</b> Matter met antimatter and both turned into energy: pions and γ rays, carrying away their whole mass.'],
  [/^Decay in flight/, 'flight', 6, () => '<b>Decay in flight.</b> An unstable particle decayed while moving; moving near the speed of light, its clock ran slow (time dilation), so it lived longer than at rest.'],
  [/^Photoelectric effect/, 'photo', 5, () => '<b>Photoelectric effect.</b> A photon with enough energy knocked an electron clean out of an atom. Einstein’s Nobel prize: light comes in packets (photons), and only a big enough packet can free an electron, however bright the light.'],
  [/^Impact ionization/, 'impact', 4, () => '<b>Impact ionization.</b> A fast electron hit an atom hard enough to knock another electron out: now there are two, and in a field they both speed up and do it again. An avalanche, as in a neon sign or a lightning bolt.'],
  [/^Thermal ionization/, 'thermion', 4, () => '<b>Thermal ionization.</b> The atoms are so hot that collisions alone strip electrons off: matter turning into plasma.'],
  [/^Field ionization/, 'fieldion', 5, () => '<b>Field ionization.</b> The electric field is strong enough to pull an electron straight out of an atom.'],
  [/(Electron|Positron) captured:/, 'recomb', 3, () => '<b>Recombination.</b> A free electron was caught by an ion and fell into an orbital, giving off the energy as light, at wavelengths that fingerprint the element.'],
  [/^Ionic bond/, 'ionic', 5, () => '<b>Ionic bond.</b> One atom handed an electron to another: now a positive and a negative ion hold together by electric attraction. That is how salt (Na⁺Cl⁻) is held together.'],
  [/^Charge transfer/, 'xfer', 3, () => '<b>Charge transfer.</b> An electron moved from one atom or molecule to another, the one that holds it more tightly.'],
  [/^Reaction: (.+?) → (.+?)\s+\(ΔH ([+-]?[\d.]+)/, 'react', 4, (m) => `<b>Chemical reaction.</b> ${m[1]} → ${m[2]}: bonds broke and new ones formed. ${+m[3] < 0 ? 'The new bonds hold more tightly, so energy is released as heat (exothermic).' : 'The new bonds are weaker, so heat is taken in (endothermic).'}`],
  [/^Bond formed: .*→ (\S+)(?: \((.+)\))?/, 'bond', 2, (m) => `<b>A bond formed</b>${m[2] ? `: ${m[2]}` : ''}. Two atoms now share electrons, lowering their energy; the energy released heats their surroundings.`],
  [/^Bond broke/, 'break', 2, () => '<b>A bond broke.</b> A collision delivered more energy than the bond holds (its dissociation energy), and the atoms flew apart.'],
  [/^Photodissociation/, 'photodis', 5, () => '<b>Photodissociation.</b> A photon carried enough energy to break a bond on its own: light doing chemistry, as in the ozone layer.'],
  [/^Bit flipped/, 'seu', 8, () => '<b>A bit flipped.</b> A fast particle freed so many electrons in the transistor that the stored 1 or 0 changed: a single-event upset, the reason spacecraft use radiation-hardened memory.'],
];
function narrTick() {
  const now = UI.vis, box = $('narr');
  if (now < NARR.until) return;
  let best = null;
  for (let i = W.log.length - 1; i >= 0 && i >= W.log.length - 120; i--) {
    const e = W.log[i]; if (e.seq <= NARR.seq) break;
    for (const [re, kind, pri, fn] of NARR_RULES) {
      const m = re.exec(e.text); if (!m) continue;
      if (now - (NARR.last.get(kind) || -1e9) < 12) break;
      if (!best || pri > best.pri) best = { pri, kind, html: fn(m) };
      break;
    }
  }
  NARR.seq = W.logSeq;
  if (!best) { if (!box.hidden && now > NARR.until + 3) { box.classList.add('fade'); if (now > NARR.until + 4) box.hidden = true; } return; }
  NARR.last.set(best.kind, now); NARR.until = now + 5; NARR.cur = best.kind;
  box.innerHTML = best.html; box.hidden = false; box.classList.remove('fade');
}
/* My molecules and saved isotopes, out and in (merged: what is there stays; a molecule already known by key or name is
   not added twice). */
function libraryToJSON() {
  const mols = myMolsList();
  return { app: 'Atom Forge', v: 1, kind: 'library', saved: new Date().toISOString(), mymols: mols, myisos: MYISO.map(s => [s.Z, s.A, s.charge || 0, s.bare ? 1 : 0, s.anti ? 1 : 0]) };
}
function libraryFromJSON(d) {
  if (!d || d.app !== 'Atom Forge' || d.kind !== 'library') return 'not an Atom Forge library file';
  let nm = 0, ni = 0;
  if (Array.isArray(d.mymols)) for (const m of d.mymols) {
    if (!myMolValid(m) || Object.values(MOLECULES).some(x => x.name.toLowerCase() === String(m.n).toLowerCase())) continue;
    myMolAdd({ k: m.k, n: String(m.n).slice(0, 40), r: m.r, a: m.a, b: m.b, d: String(m.d || '').slice(0, 500), c: m.c }); nm++;
  }
  if (nm) myMolsSave();
  if (Array.isArray(d.myisos)) for (const r of d.myisos) {
    if (!Array.isArray(r) || MYISO.length >= MYISO_MAX) break;
    const [Z, A, q, bare, anti] = r;
    if (!Number.isInteger(Z) || Z < 1 || Z > 118 || !ELEMENTS[Z] || !Number.isInteger(A) || A < Z || A - Z > Math.max(4, 2 * Z + 10) || !Number.isInteger(q) || Math.abs(q) > 8) continue;
    const sp = isoSpec(Z, A, q, bare === 1, anti === 1);
    if (!isoSaved(sp)) { MYISO.push(sp); ni++; }
  }
  if (ni) myIsoStore();
  if (nm || ni) { buildToolOpts(); if (!$('molModal').hidden) renderMolList(); }
  return { nm, ni };
}
function exportLibrary() { const d = libraryToJSON(); fileSave('atom-forge-library.json', JSON.stringify(d)).then((ok) => { if (ok) log('tool', `Library exported: ${d.mymols.length} molecule${d.mymols.length === 1 ? '' : 's'}, ${d.myisos.length} isotope${d.myisos.length === 1 ? '' : 's'}`); }); }
function importLibrary() {
  filePick('.json,application/json', (text, name) => {
    let d; try { d = JSON.parse(text); } catch (e) { log('tool', `${name}: not a JSON file`); return; }
    const r = libraryFromJSON(d);
    if (typeof r === 'string') { log('tool', `${name}: ${r}`); return; }
    log('tool', `Library imported from ${name}: ${r.nm} new molecule${r.nm === 1 ? '' : 's'}, ${r.ni} new isotope${r.ni === 1 ? '' : 's'}`); syncSettings();
  });
}
/* ---- typed values: the figure beside a slider is clicked and typed over, with a unit chosen from a dropdown beside
   it (Enter sets it, Escape leaves it). Each entry: the units it can be typed in (to/from the base unit), the current
   value in the base unit, and what to do with a typed one (brought to the slider's range). */
const lin = (u, k) => ({ u, to: (v) => v * k, from: (v) => v / k });
// (each list runs smallest to largest: unitFor picks the first that puts a value between 1 and 1000)
const U_TEMP = [lin('µK', 1e-6), lin('mK', 1e-3), lin('K', 1), lin('kK', 1e3), lin('MK', 1e6), lin('GK', 1e9), { u: '°C', to: (v) => v + 273.15, from: (v) => v - 273.15 }, { u: '°F', to: (v) => (v - 32) / 1.8 + 273.15, from: (v) => (v - 273.15) * 1.8 + 32 }];
const U_B = [lin('µT', 1e-6), lin('mT', 1e-3), lin('T', 1), lin('kT', 1e3), lin('MT', 1e6), lin('G', 1e-4), lin('kG', 0.1)];
const U_E = [lin('V/m', 1e-10), lin('kV/m', 1e-7), lin('V/µm', 1e-4), lin('MV/m', 1e-4), lin('kV/cm', 1e-5), lin('V/nm', 0.1), lin('V/Å', 1), lin('GV/m', 0.1)];
const U_LEN = [lin('fm', 1e-5), lin('pm', 0.01), lin('Å', 1), lin('nm', 10), lin('µm', 1e4), lin('mm', 1e7)];
const U_TIME = [lin('ys', 1e-24 / PHYS.TU_S), lin('zs', 1e-21 / PHYS.TU_S), lin('as', 1e-18 / PHYS.TU_S), lin('fs', 1e-15 / PHYS.TU_S), lin('ps', 1e-12 / PHYS.TU_S), lin('ns', 1e-9 / PHYS.TU_S), lin('µs', 1e-6 / PHYS.TU_S), lin('ms', 1e-3 / PHYS.TU_S), lin('s', 1 / PHYS.TU_S)]; // (base: the engine's time unit)
const U_ENERGY = [lin('meV', 1e-3), lin('eV', 1), lin('keV', 1e3), lin('MeV', 1e6), lin('GeV', 1e9), lin('TeV', 1e12), lin('PeV', 1e15)];
const TYPED = {
  tVal: { units: U_TEMP, pick: tPick, get: () => W.T, apply: (T) => { setBathT(T); syncLab(); }, why: 'the bath runs from 1 K to a billion K' },
  bVal: { units: U_B, get: () => W.Bz, apply: (B) => { W.Bz = Math.abs(B) < 1e-9 ? 0 : clamp(B, -1e5, 1e5); syncLab(); }, why: 'fields up to 100,000 T (a magnetar’s)' },
  eVal: { units: U_E, get: () => UI.E, apply: (E) => { UI.E = clamp(Math.abs(E), 0, 50); applyE(); syncLab(); }, why: 'fields up to 50 V/Å: past that every atom is torn apart at once' },
  boxW: { units: U_LEN, get: () => W.box.tw, apply: (w) => { W.box.tw = clamp(w, 20, 20000); UI.aspect = W.box.th / W.box.tw; syncLab(); }, why: 'the box is 20 Å to 2 µm across' },
  boxH: { units: U_LEN, get: () => W.box.th, apply: (h) => { W.box.th = clamp(h, 20, 20000); UI.aspect = W.box.th / W.box.tw; syncLab(); }, why: 'the box is 20 Å to 2 µm across' },
  spdVal: { units: U_TIME, get: () => W.simPerFrame, apply: (tu) => { W.simPerFrame = clamp(tu, DT_MIN, 1000); syncLab(); syncSpeed(); }, why: `from one shortest time step (${fmtTime(DT_MIN * PHYS.TU_S)}) to ${fmtTime(1000 * PHYS.TU_S)} per 1/60 s` },
  cEVal: { units: U_ENERGY, get: () => (W.collider ? W.collider.E : cEFromS(+$('cESlider').value)), apply: (E) => { if (!W.collider) return; setColliderEnergy(clamp(E, cEFromS(0), cEFromS(1000))); syncCollider(); } },
  cE2Val: { units: U_ENERGY, get: () => (W.collider && W.collider.E2 !== null && W.collider.E2 !== undefined ? W.collider.E2 : cEFromS(+$('cE2Slider').value)), apply: (E) => { const C = W.collider; if (!C) return; setColliderEnergy(C.E, clamp(E, cEFromS(0), cEFromS(1000))); syncCollider(); } },
  cNVal: { units: null, int: true, get: () => (W.collider ? W.collider.bunch : +$('cNSlider').value), apply: (n) => { n = clamp(Math.round(n), 1, 30); $('cNSlider').value = n; $('cNVal').textContent = String(n); if (W.collider) W.collider.bunch = n; } },
};
/* Temperatures in the scale chosen in Settings; in kelvin, with the prefix that suits the value. */
function tPick(T) { if (T_UNIT === 'C') return '°C'; if (T_UNIT === 'F') return '°F'; for (const u of ['mK', 'K', 'kK', 'MK', 'GK']) { const a = Math.abs(U_TEMP.find(x => x.u === u).from(T)); if (a >= 1 && a < 1000) return u; } return 'K'; }
/* A typed value the setting cannot take is set to the nearest it can, and a note says so (and why) under the figure. */
function typedNote(el, text) {
  const n = document.createElement('div'); n.className = 'typedNote'; n.setAttribute('role', 'status'); n.textContent = text;
  document.body.appendChild(n);
  const r = el.getBoundingClientRect(); n.style.left = Math.max(8, Math.min(innerWidth - 280, r.left)) + 'px'; n.style.top = (r.bottom + 6) + 'px';
  setTimeout(() => n.remove(), 4000);
  log('tool', text);
}
/* The unit a value is best shown in: the one that puts it between 1 and 1000 (the first of the list otherwise), or the
   entry's own choice. */
function unitFor(T, base) {
  if (T.pick) return T.pick(base);
  if (!T.units) return null;
  for (const u of T.units) { const a = Math.abs(u.from(base)); if (a >= 1 && a < 1000) return u.u; }
  return T.units[0].u;
}
const fmtTyped = (v) => { if (!Number.isFinite(v)) return ''; const a = Math.abs(v); const s = a >= 1e6 || (a > 0 && a < 1e-3) ? v.toExponential(3) : a >= 100 ? v.toFixed(a >= 1e4 ? 0 : 1) : v.toPrecision(4); return String(+s); };
function parseTyped(str) { const m = /^\s*([-+]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*$/i.exec(str); if (!m) return null; const v = parseFloat(m[1].replace(/,/g, '')); return Number.isFinite(v) ? v : null; }
const typedOpen = (id) => { const el = $(id); return !!(el && el.querySelector('input')); }; // (a label being edited is left alone by the periodic refreshes)
function setTxt(id, text) { const el = $(id); if (el && !el.querySelector('input') && el.textContent !== text) el.textContent = text; }
function attachTyped(el, T) {
  if (!el || el.dataset.typed) return;
  el.dataset.typed = '1'; el.classList.add('typed'); el.title = 'Click to type a value'; el.tabIndex = 0; el.setAttribute('role', 'button');
  const open = () => {
    if (el.querySelector('input')) return;
    const was = el.textContent, base = T.get();
    // the unit the figure is shown in (the first number's unit: "16.4 as per 1/60 s" → as), else the best fit
    const shown = /[-+]?\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?\s*([^\s\d,.]+)/i.exec(was);
    let unit = T.units ? (shown && T.units.find(u => u.u === shown[1])) || T.units.find(u => u.u === unitFor(T, base)) || T.units[0] : null;
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'typedIn'; inp.setAttribute('aria-label', 'Type a value'); inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.value = fmtTyped(unit ? unit.from(base) : base);
    let sel = null;
    if (unit) { sel = document.createElement('select'); sel.className = 'typedU'; sel.setAttribute('aria-label', 'Unit'); for (const u of T.units) { const o = document.createElement('option'); o.value = u.u; o.textContent = u.u; sel.appendChild(o); } sel.value = unit.u; }
    el.textContent = ''; el.appendChild(inp); if (sel) el.appendChild(sel);
    inp.focus(); inp.select();
    let done = false;
    const close = (commit) => {
      if (done) return; done = true;
      const v = commit ? parseTyped(inp.value) : null;
      el.textContent = was;
      if (v !== null) {
        const want = unit ? unit.to(v) : v; T.apply(want);
        const got = T.get();
        if (!T.int && Number.isFinite(got) && Math.abs(got - want) > 1e-6 * Math.max(Math.abs(want), Math.abs(got), 1e-300)) {
          const gu = unit || null;
          typedNote(el, `Set to ${fmtTyped(gu ? gu.from(got) : got)}${gu ? ' ' + gu.u : ''}, not ${fmtTyped(v)}${gu ? ' ' + gu.u : ''}: ${T.why || 'the nearest this setting can take'}`);
        }
      }
    };
    const stop = (e) => e.stopPropagation();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(true); } else if (e.key === 'Escape') { e.preventDefault(); close(false); } e.stopPropagation(); });
    inp.addEventListener('keyup', stop); inp.addEventListener('keypress', stop);
    // leaving the box commits, unless the focus went to the unit dropdown beside it
    inp.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== sel) close(true); }, 0));
    if (sel) {
      sel.addEventListener('change', () => { // the number is converted into the new unit, so the value itself does not change
        const v = parseTyped(inp.value), nu = T.units.find(u => u.u === sel.value) || unit;
        if (v !== null) inp.value = fmtTyped(nu.from(unit.to(v)));
        unit = nu; inp.focus();
      });
      sel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(true); } else if (e.key === 'Escape') { e.preventDefault(); close(false); } e.stopPropagation(); });
      sel.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== inp) close(true); }, 0));
      sel.addEventListener('mousedown', stop); sel.addEventListener('click', stop);
    }
    inp.addEventListener('click', stop);
  };
  el.addEventListener('click', (e) => { if (e.target === el || !el.querySelector('input')) open(); });
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); open(); } });
}
function bindTyped() { for (const id of Object.keys(TYPED)) attachTyped($(id), TYPED[id]); }
/* The tool options' figures (radius, energy, temperature, field, wavelength, rate): the same editors, made each time the
   bar is built. A typed value sets the tool's slider position (clamped to its range) and the bar is drawn again. */
const U_LIGHT = [lin('fm', 1e-6), lin('pm', 1e-3), lin('Å', 0.1), lin('nm', 1), lin('µm', 1e3), lin('mm', 1e6)].map(u => ({ u: u.u, to: (v) => 1239.84198 / u.to(v), from: (E) => u.from(1239.84198 / E) })).concat(U_ENERGY); // (wavelength ↔ photon energy in eV)
const logS = (v, off, lo, hi) => clamp(100 * (Math.log10(Math.max(1e-12, v)) + off), lo, hi); // (not rounded to the slider's steps: the typed value is kept as typed)
function toolTyped(t, o) {
  const again = () => buildToolOpts();
  const M = {
    oRV: { units: U_LEN, get: () => o.R, apply: (R) => { o.R = clamp(R, RAD_MIN[t], RAD_MAX); again(); } },
    oSV: { units: U_ENERGY, get: () => pullU(), apply: (U) => { o.s = logS(U, 2, -100, 800); again(); }, why: 'the push and pull go from 1 meV to 1 MeV' },
    oKEV: { units: U_ENERGY, get: () => fireKE(), apply: (E) => { o.s = logS(E, 2, -100, 1700); again(); }, why: 'particles are fired with 1 meV to 1 PeV' },
    oTV: { units: U_TEMP, pick: tPick, get: () => heatT(), apply: (T) => { o.s = logS(T, 0, 0, 900); again(); }, why: 'the heat tool runs from 1 K to a billion K' },
    oEV: { units: U_ENERGY, get: () => sparkE(), apply: (E) => { o.s = logS(E, 0, -100, 1200); again(); }, why: 'sparks of 0.1 eV to 1 TeV' },
    oBV: { units: U_B, get: () => Math.abs(magB()), apply: (B) => { o.s = logS(Math.abs(B), 0, 0, 900); again(); }, why: 'magnets of 1 T to a billion T' },
    oLV: { units: U_LIGHT, pick: (E) => { const lam = 1239.84198 / E; return lam >= 1e4 ? 'µm' : lam >= 1 ? 'nm' : lam >= 1e-3 ? 'pm' : 'fm'; }, get: () => lightE(), apply: (E) => { o.s = logS(E, 1, -100, 1100); again(); }, why: 'light from 0.01 eV (124 µm) to 10 GeV' },
    oRateV: { units: null, int: true, get: () => o.rate, apply: (r) => { o.rate = clamp(Math.round(r), 5, 400); again(); } },
  };
  for (const id of Object.keys(M)) attachTyped($(id), M[id]);
}
function bindLab() {
  bindTyped();
  $('tMarks').innerHTML = T_MARKS.map(([T, n]) => `<button class="mark" data-t="${T}" title="${fmtT(T)}">${esc(n)}</button>`).join('');
  $('tMarks').onclick = (e) => { const b = e.target.closest('.mark'); if (b) { setBathT(+b.dataset.t); syncLab(); } };
  $('tSlider').oninput = (e) => { W.ramp = null; rampSync(); setBathT(Math.pow(10, +e.target.value / 100)); syncLabText(); };
  $('bRamp').onclick = () => {
    if (W.ramp) { W.ramp = null; rampSync(); return; }
    const to = +$('rampTo').value, dur = +$('rampDur').value;
    W.ramp = { from: Math.max(1, W.T), to, dur, t: 0 }; if (!W.gamma) setSegValue('segBath', W.gamma = 0.05); rampSync();
    log('tool', `Bath going from ${fmtT(W.ramp.from)} to ${fmtT(to)} over ${fmtNum(dur, 3)} s of running`);
  };
  bindSeg('segBath', (v) => { W.gamma = +v; syncLabText(); });
  $('bSlider').oninput = (e) => { W.Bz = bFromS(+e.target.value); syncLabText(); };
  $('eSlider').oninput = (e) => { UI.E = +e.target.value / 100; applyE(); syncLabText(); };
  bindSeg('segEdir', (v) => { UI.Eang = +v; applyE(); });
  $('bMagClear').onclick = () => { W.magnets.length = 0; syncLabText(); };
  bindSeg('segWall', (v) => { W.wall = v; syncNWall(); });
  bindSeg('segNWall', (v) => { W.nWall = v; syncNWall(); log('tool', `Neutrons at the walls: ${{ reflect: 'bounce back (a reflector)', absorb: 'absorbed', pass: 'pass through' }[v]}`); });
  $('chkGlow').onchange = (e) => { W.glow = e.target.checked; };
  $('boxSlider').oninput = (e) => { const w = boxFromS(+e.target.value); W.box.tw = w; W.box.th = w * UI.aspect; syncLabText(); };
  $('spdSlider').oninput = (e) => { W.simPerFrame = spdFromS(+e.target.value); syncLabText(); syncSpeed(); };
  $('warpSlider').oninput = (e) => { W.warp = Math.pow(10, +e.target.value); syncLabText(); if (UI.tool === 'place' || UI.tool === 'fire') buildToolOpts(); };
  $('chkDecay').onchange = (e) => { W.decayOn = e.target.checked; log('tool', W.decayOn ? 'Radioactive decay resumed' : 'Radioactive decay paused'); syncLabText(); if (UI.tool === 'place' || UI.tool === 'fire') buildToolOpts(); };
  $('chkSlowmo').onchange = (e) => { W.slowmo = e.target.checked; store('slowmo', e.target.checked ? '1' : '0'); };
  bindSeg('segBohr', (v) => { setAtomView(v); });
  bindSeg('segColor', (v) => { R.view.color = v; });
  try { const vf = JSON.parse(store('viewflags') || 'null'); if (vf && typeof vf === 'object') for (const k of ['labels', 'tracks', 'rays', 'hbonds', 'ionic', 'grid', 'decayCards']) if (typeof vf[k] === 'boolean') R.view[k] = vf[k]; } catch (e) { /* (defaults) */ }
  for (const c of document.querySelectorAll('[data-view]')) c.onchange = () => { R.view[c.dataset.view] = c.checked; store('viewflags', JSON.stringify(R.view)); };
  $('bIdentify').onclick = () => { identifyMolecules(); };
  $('bSaveWorld').onclick = () => saveWorld(); $('bLoadWorld').onclick = () => loadWorld();
  shareInit(); explainInit(); recInit(); askInit(); galInit();
  { const ib = $('tp-inspect'); // the quark view: drag a quark, pick a nucleon, put it back
    ib.addEventListener('pointerdown', (e) => { if (e.target.id === 'insQuarks') { qPointer(e, 'down'); if (QV.drag) e.target.setPointerCapture(e.pointerId); } });
    ib.addEventListener('pointermove', (e) => { if (QV.drag) qPointer(e, 'move'); });
    ib.addEventListener('pointerup', (e) => { if (QV.drag) qPointer(e, 'up'); });
    ib.addEventListener('pointercancel', (e) => { if (QV.drag) qPointer(e, 'up'); });
    ib.addEventListener('click', (e) => { const b = e.target.closest('[data-q]'), v = e.target.closest('button[data-v]');
      if (b && b.dataset.q === 'reset') { QV.key = ''; renderInspect(); }
      else if (b && b.dataset.q === 'pick' && v) { QV.pick = v.dataset.v; QV.key = ''; renderInspect(); } }); }
  $('bClear').onclick = () => { undoMark('Empty the chamber'); clearWorld(); W.hist = { t: [], T: [], bath: [] }; R.sel = null; log('tool', 'Chamber emptied'); renderInspect(); };
  $('bSrcClear').onclick = () => { W.sources.length = 0; W.lasers.length = 0; };
}
function setBathT(T) { W.T = clamp(T, 1, 1e9); }
function applyE() {
  const a = (UI.Eang || 0) * Math.PI / 180;
  W.Ex = UI.E * Math.cos(a); W.Ey = UI.E * Math.sin(a);
  if (Math.abs(W.Ex) < 1e-12) W.Ex = 0; if (Math.abs(W.Ey) < 1e-12) W.Ey = 0;
}
function syncLab() {
  $('tSlider').value = Math.round(100 * Math.log10(Math.max(1, W.T)));
  setSegValue('segBath', W.gamma);
  $('bSlider').value = sFromB(W.Bz);
  UI.E = Math.hypot(W.Ex, W.Ey);
  if (UI.E) UI.Eang = Math.round(((Math.atan2(W.Ey, W.Ex) * 180 / Math.PI) + 360) % 360);
  $('eSlider').value = Math.round(UI.E * 100); setSegValue('segEdir', UI.Eang || 0);
  setSegValue('segWall', W.wall); syncNWall(); $('chkGlow').checked = !!W.glow; rampSync();
  UI.aspect = W.box.th / W.box.tw;
  $('boxSlider').value = sFromBox(W.box.tw);
  $('spdSlider').value = sFromSpd(W.simPerFrame);
  $('warpSlider').value = Math.round(Math.log10(Math.max(1, W.warp)));
  $('chkDecay').checked = W.decayOn; $('chkSlowmo').checked = W.slowmo;
  setSegValue('segBohr', R.view.bohr); setSegValue('segColor', R.view.color);
  for (const c of document.querySelectorAll('[data-view]')) c.checked = !!R.view[c.dataset.view];
  syncLabText();
}
function syncLabText() {
  setTxt('tVal', fmtT(W.T));
  $('bathNote').textContent = W.gamma === 0 ? 'Insulated: total energy is conserved, so reactions heat or cool the sample by themselves.'
    : `Every particle trades energy with a ${fmtT(W.T)} bath (Langevin thermostat), relaxing over about ${fmtTime(PHYS.TU_S / W.gamma)}.`;
  setTxt('bVal', W.Bz ? (W.Bz > 0 ? '+' : '−') + fmtTesla(Math.abs(W.Bz)) : '0 T');
  setTxt('eVal', UI.E ? `${UI.E.toFixed(2)} V/Å` : '0 V/Å');
  $('magCount').textContent = W.magnets.length ? `${W.magnets.length} magnet${W.magnets.length > 1 ? 's' : ''} placed` : 'No magnets placed';
  setTxt('boxW', W.box.tw.toFixed(0)); setTxt('boxH', W.box.th.toFixed(0));
  setTxt('spdVal', motionText());
  $('warpVal').textContent = !W.decayOn ? 'paused' : W.warp <= 1.0001 ? 'real rate' : `sped up ${fmtFactor(W.warp)}`;
  $('warpNote').textContent = !W.decayOn ? 'Paused: no nucleus decays until it is switched back on.'
    : `Nuclei age ${fmtTime(decayPerSecond())} per second you watch${W.warp <= 1.0001 ? ', the same as everything else' : ''}.`;
  $('warpSlider').disabled = !W.decayOn;
}

/* The Motion readout: the set speed, and while slow motion holds time back, how far it has slowed it. */
function motionText() { // the motion the simulation actually gets through each frame (less than it is set to in slow motion, or at the computer's limit)
  const slow = (W.slowHold || UI.slow || autoSlowOn()) && UI.adv > 0 && UI.adv < 0.9 * W.simPerFrame;
  if (!(UI.adv > 0) || (!UI.running && !slow)) return `${fmtTime(W.simPerFrame * PHYS.TU_S)} per 1/60 s`; // (paused in slow motion: still shows the slow motion it was in)
  return `${slow ? 'slow motion: ' : ''}${fmtTime(Math.min(UI.adv, W.simPerFrame) * PHYS.TU_S)} per 1/60 s${!slow && UI.capped ? ' (as fast as this computer goes)' : ''}`; // (per sixtieth of a second, whatever the frame rate: simFrame keeps to real time)
}
/* ------------------------------------------------------------------ speed (simulated time per frame) */
const SPEED_MIN = -8, SPEED_MAX = 4; // 1/256× … 16× the setup's normal speed
function speedText(m) {
  if (m >= 0.95) return (m >= 9.5 ? Math.round(m) : Math.round(m * 10) / 10) + '×';
  const inv = 1 / m;
  return Math.abs(inv - Math.round(inv)) < 0.08 ? '1/' + Math.round(inv) + '×' : m.toFixed(2) + '×';
}
function stepSpeed(dir) {
  const k = clamp(Math.round(Math.log2(W.simPerFrame / UI.baseSpf)) + dir, SPEED_MIN, SPEED_MAX);
  W.simPerFrame = UI.baseSpf * Math.pow(2, k);
  UI.ach = 1; UI.capped = false;
  syncSpeed();
  $('spdSlider').value = sFromSpd(W.simPerFrame); syncLabText();
}
function syncSpeed() {
  const m = W.simPerFrame / UI.baseSpf, v = $('speedVal');
  // the speed actually reached: at the computer's limit (amber) less than asked, as each frame's physics time is used up
  v.textContent = UI.slow || W.slowHold ? 'slow-mo' + (W.slowHold && m !== 1 ? ' ' + speedText(m) : '') : speedText(UI.capped ? m * clamp(UI.ach || 1, 1e-4, 1) : m);
  v.classList.toggle('cap', !!UI.capped && !UI.slow);
  v.classList.toggle('slow', !!UI.slow || !!W.slowHold);
  const k = Math.round(Math.log2(m));
  $('bSlower').disabled = k <= SPEED_MIN; $('bFaster').disabled = k >= SPEED_MAX;
  const rate = W.simPerFrame * PHYS.TU_S * 60 * Math.min(1, UI.ach || 1);
  v.parentElement.title = `About ${fmtTime(rate)} of motion per second` + (UI.capped ? ' (as fast as this computer can go with this many particles: fewer of them, or more physics time per frame in Settings, make it faster)' : '') + (W.warp > 1.0001 ? `; radioactive decay sped up ${fmtFactor(W.warp)}` : '');
}

/* ------------------------------------------------------------------ particle accelerators */
/* What a beam can be: leptons, (anti)protons and bare nuclei (fully stripped ions), light to heavy, and the actinides
   that heavy-ion beams are fired at to make superheavy elements (oganesson was made from calcium-48 on californium-249). */
const BEAM_SPECIES = (() => {
  const supN = (n) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  const S = { pos: { lab: 'e⁺', name: 'positrons', g: 'Leptons' }, e: { lab: 'e⁻', name: 'electrons', g: 'Leptons' } };
  const ion = (k, Z, A, name, g, lab) => { S[k] = { lab: lab || supN(A) + ELEMENTS[Z].sym, name, g, Z, A }; };
  const LN = 'Nucleons and light nuclei', HI = 'Heavy ions', AC = 'Actinides (targets for superheavy elements)';
  ion('p', 1, 1, 'protons', LN, 'p'); ion('d', 1, 2, 'deuterons (²H)', LN, 'd'); ion('t', 1, 3, 'tritons (³H)', LN, 't');
  ion('he3', 2, 3, 'helium-3', LN); ion('a', 2, 4, 'α particles (⁴He)', LN, 'α'); ion('li6', 3, 6, 'lithium-6', LN); ion('li7', 3, 7, 'lithium-7', LN);
  ion('be9', 4, 9, 'beryllium-9', LN); ion('b11', 5, 11, 'boron-11', LN);
  for (const [k, Z, A, n] of [['c12', 6, 12, 'carbon-12'], ['n14', 7, 14, 'nitrogen-14'], ['o16', 8, 16, 'oxygen-16'], ['ne20', 10, 20, 'neon-20'],
    ['mg24', 12, 24, 'magnesium-24'], ['si28', 14, 28, 'silicon-28'], ['ar40', 18, 40, 'argon-40'], ['ca40', 20, 40, 'calcium-40'],
    ['ca48', 20, 48, 'calcium-48'], ['ti50', 22, 50, 'titanium-50'], ['cr54', 24, 54, 'chromium-54'], ['fe56', 26, 56, 'iron-56'],
    ['ni58', 28, 58, 'nickel-58'], ['cu63', 29, 63, 'copper-63'], ['ni64', 28, 64, 'nickel-64'], ['zn70', 30, 70, 'zinc-70'],
    ['kr84', 36, 84, 'krypton-84'], ['zr96', 40, 96, 'zirconium-96'], ['ru96', 44, 96, 'ruthenium-96'], ['xe129', 54, 129, 'xenon-129'],
    ['au197', 79, 197, 'gold-197'], ['pb208', 82, 208, 'lead-208'], ['bi209', 83, 209, 'bismuth-209'], ['u238', 92, 238, 'uranium-238']]) ion(k, Z, A, n, HI);
  for (const [k, Z, A, n] of [['th232', 90, 232, 'thorium-232'], ['pu244', 94, 244, 'plutonium-244'], ['am243', 95, 243, 'americium-243'],
    ['cm248', 96, 248, 'curium-248'], ['bk249', 97, 249, 'berkelium-249'], ['cf249', 98, 249, 'californium-249']]) ion(k, Z, A, n, AC);
  S.pbar = { lab: 'p̄', name: 'antiprotons', g: 'Antimatter', Z: 1, A: 1, anti: true };
  S.dbar = { lab: 'd̄', name: 'antideuterons', g: 'Antimatter', Z: 1, A: 2, anti: true };
  S.abar = { lab: 'ᾱ', name: 'anti-α particles', g: 'Antimatter', Z: 2, A: 4, anti: true };
  return S;
})();
const BEAM_PAIRS = { ee: ['pos', 'e'], pp: ['p', 'pbar'], dt: ['d', 't'], aa: ['au197', 'au197'] };
/* A species' mass (u), charge (e) and how to make one. */
function beamInfo(k) {
  const s = BEAM_SPECIES[k] ? BEAM_SPECIES[k] : BEAM_SPECIES.e;
  if (s.info) return s.info;
  let i;
  if (!s.Z) i = { m: PHYS.ME, q: k === 'pos' ? 1 : -1, lep: true, anti: k === 'pos', spec: { kind: k === 'pos' ? 'pos' : 'e' } };
  else {
    const N = s.A - s.Z;
    i = { m: s.Z * PHYS.MP + N * PHYS.MN - bindingE(s.Z, N) / PHYS.AMU_MEV, q: (s.anti ? -1 : 1) * s.Z, lep: false, anti: !!s.anti,
      spec: k === 'p' ? SPEC_P : k === 'pbar' ? SPEC_PBAR : { kind: 'atom', Z: s.Z, A: s.A, bare: true, anti: !!s.anti } };
  }
  i.key = k; i.lab = s.lab; i.name = s.name; i.Z = s.Z || 0; i.A = s.A || 0;
  return (s.info = i);
}
const isAntiPair = (A, B) => A.anti !== B.anti && A.q === -B.q && Math.abs(A.m / B.m - 1) < 1e-6; // a particle and its antiparticle
/* Injection energy for a ring of beam energy E: the injector supplies a twentieth of it (at least 200 keV, at most
   a quarter), so the ramp takes some ten turns at any energy. Electrons and positrons go in above transition
   (γ = 1/√αc ≈ 2.1, 0.57 MeV), as in real electron rings: at 1.5 MeV, or at full energy below that. */
function ringParams(E, lep) {
  return { inj: lep ? (E <= 1.5e6 ? E : Math.max(1.5e6, E / 20)) : Math.min(Math.max(2e5, E / 20), 0.25 * E) };
}
const speedOf = (m, KE) => { const g = 1 + KE / (m * AMU_EV); return PHYS.C * Math.sqrt(1 - 1 / (g * g)); }; // Å/tu
/* Electrons bent with radius ρ level off where synchrotron light carries off each turn what the cavities can give
   (ΔE = (4π/3)(ke²/ρ)γ⁴β³ against a gain of 12% of the energy at most 60° from the crest). Nuclei: no limit here. */
function ringTopE(I, E, rho) {
  if (!I.lep) return Infinity;
  let lo = 1e4, hi = E; // (the gain per turn is programmed as 12% of the energy, so solve 0.12E·sin60°/sin30° = U₀)
  for (let k = 0; k < 60; k++) { const m = Math.sqrt(lo * hi), g = 1 + m / (I.m * AMU_EV), b = Math.sqrt(1 - 1 / (g * g)); if (4 * Math.PI / 3 * PHYS.KE / rho * g ** 4 * b ** 3 > 0.12 * m * RF_SMAX / RF_S0) hi = m; else lo = m; }
  return lo;
}
/* Electrons and positrons are sped up only to 85% of that limit, where the RF still holds a bunch comfortably. */
const ringCap = (I, E) => (I.lep ? Math.min(E, 0.85 * ringTopE(I, 1e12, LAT.rho)) : E);
/* ---- accelerator lattices
   A ring is laid out element by element along its design orbit, bending clockwise: bending magnets (sectors of
   uniform field, 45° each) with focusing (QF) and defocusing (QD) quadrupoles between them, the alternating-
   gradient pattern of every modern ring, and straight sections for RF cavities, separators, kickers and detectors.
   (ALPHA_C, the momentum compaction, and the separators' kick were measured by tracking particles round these
   lattices: they set where transition comes and how far apart the separated orbits run.) */
const LAT = { rho: 24, lq: 4, d: 1.5, w: 8, kq: 0.0139, Ls: 12, h: 4, kick: 4 };
function marchLattice(x, y, h, elems, tag) {
  const w = LAT.w, zones = [], marks = {}, segs = [];
  let s = 0;
  for (const e of elems) {
    if (e.t === 'B') { // a bending magnet: centre of curvature to the right of the path
      const cx = x + e.rho * Math.sin(h), cy = y - e.rho * Math.cos(h), a0 = Math.atan2(y - cy, x - cx), a1 = a0 - e.ang;
      zones.push({ kind: 'dipole', ring: true, cx, cy, r0: e.rho - w, r1: e.rho + w, R0: e.rho, n: 0, amid: (a0 + a1) / 2, ahalf: e.ang / 2, B: 0, beam: tag });
      segs.push({ arc: true, cx, cy, r: e.rho, a0, a1 });
      s += e.rho * e.ang; h -= e.ang; x = cx + e.rho * Math.cos(a1); y = cy + e.rho * Math.sin(a1);
      continue;
    }
    const L = e.L || 0, ux = Math.cos(h), uy = Math.sin(h), mx = x + ux * L / 2, my = y + uy * L / 2;
    if (e.t === 'Q') zones.push({ kind: 'quad', cx: mx, cy: my, w: L, h: 2 * w, ang: h, G: 0, K: e.K, beam: tag });
    else if (e.t === 'RF') zones.push({ kind: 'cavity', cx: mx, cy: my, w: L, h: 2 * w, ang: h, E: 0, rfS: s + L / 2, beam: tag, label: 'RF cavity' });
    else if (e.t === 'SEP') zones.push({ kind: 'sep', cx: mx, cy: my, w: L, h: 2 * w, ang: h, Es: 0, sepSign: e.sign, label: 'separator' });
    if (e.mark) marks[e.mark] = { s: s + L / 2, s0: s, L, x: mx, y: my, h };
    if (L) segs.push({ arc: false, x0: x, y0: y, x1: x + ux * L, y1: y + uy * L });
    s += L; x += ux * L; y += uy * L;
  }
  return { zones, marks, segs, circ: s };
}
const latCell = () => [{ t: 'Q', L: LAT.lq, K: LAT.kq }, { t: 'D', L: LAT.d }, { t: 'B', ang: Math.PI / 4, rho: LAT.rho }, { t: 'D', L: LAT.d }, { t: 'Q', L: LAT.lq, K: -LAT.kq }, { t: 'D', L: LAT.d }];
/* The injector: a small linac that brings a train of particles up to the injection energy along a line coming in
   from inside the ring (where there is room for it clear of the magnets), and a kicker magnet, fired as the train
   passes, that turns it onto the ring's orbit.
   mk: the kicker's place on the orbit; sigma: +1 if this beam goes round the way the lattice was laid out; co: where
   the ring's closed orbit runs there while the beams are kept apart (offset outward, Å, and angle, for a clockwise
   beam), so the train goes in on it; Lt: the train's length, 20° of the RF wave, so the RF captures it whole. */
function addInjector(C, I, tag, mk, sigma, inj, co = [0, 0], Lt = 14) {
  const ox = -Math.sin(mk.h), oy = Math.cos(mk.h); // outside the ring (left of the clockwise orbit)
  let ux = sigma * Math.cos(mk.h) + co[1] * ox, uy = sigma * Math.sin(mk.h) + co[1] * oy; const un = Math.hypot(ux, uy); ux /= un; uy /= un;
  const ex = mk.x + sigma * Math.cos(mk.h) * mk.L / 2 + sigma * co[0] * ox, ey = mk.y + sigma * Math.sin(mk.h) * mk.L / 2 + sigma * co[0] * oy; // leaving the kicker
  const sRot = (ox * -uy + oy * ux) > 0 ? -1 : 1; // coming in from inside the ring, it turns outward onto the orbit (+1: anticlockwise)
  const al = 40 * Math.PI / 180, rk = mk.L / (2 * Math.sin(al / 2));
  const rot = (vx, vy, a) => [vx * Math.cos(a) - vy * Math.sin(a), vx * Math.sin(a) + vy * Math.cos(a)];
  const nx = sRot > 0 ? -uy : uy, ny = sRot > 0 ? ux : -ux, kx = ex + rk * nx, ky = ey + rk * ny; // centre of its turn
  const [rx, ry] = rot(ex - kx, ey - ky, -sRot * al), enx = kx + rx, eny = ky + ry; // entering the kicker
  const [ix, iy] = rot(ux, uy, -sRot * al); // its direction coming in
  const hx = (enx + ex) / 2 - kx, hy = (eny + ey) / 2 - ky; // (the middle of the chord)
  const pinj = pcOf(I.m, inj) / PHYS.C;
  const kick = { kind: 'kicker', cx: kx + hx, cy: ky + hy, w: 2 * rk * Math.sin(al / 2), h: 2 * (rk * (1 - Math.cos(al / 2)) + 0.6), ang: Math.atan2(uy, ux) - sRot * al / 2, B: -sRot * Math.sign(I.q) * pinj / (Math.abs(I.q) * PHYS.LOR * rk), beam: tag, label: 'kicker' };
  const D1 = 11, Ll = 28, E0 = Math.max(5e3, inj / 2); // (the linac ends well clear of the ring's orbit)
  W.zones.push(kick, { kind: 'cavity', cx: enx - ix * (D1 + Ll / 2), cy: eny - iy * (D1 + Ll / 2), w: Ll, h: 6, ang: Math.atan2(iy, ix), E: (inj - E0) / (I.q * Ll), dir: 1, beam: tag, label: 'injector' });
  const sx = enx - ix * (D1 + Ll + 3), sy = eny - iy * (D1 + Ll + 3);
  W.sources.push({ x: sx, y: sy, ux: ix, uy: iy, spec: I.spec, KE: E0, rate: speedOf(I.m, inj) * Math.max(1, C.bunch - 1) / Lt, acc: 0.99, count: C.bunch, jitter: 0.1, beam: tag, kick, trainL: Lt, vInj: speedOf(I.m, inj) });
  C.injLines.push([sx, sy, enx, eny, ex, ey]);
  return kick;
}
/* The ring descriptor the engine ramps: its magnets follow a synchronous particle that the RF speeds up. */
function ringDesc(C, I, tag, lat, kick, sExit, inj, E, alphaC, extra) {
  return Object.assign({ beam: tag, dip: lat.zones.filter(z => z.kind === 'dipole'), quads: lat.zones.filter(z => z.kind === 'quad'),
    cavs: lat.zones.filter(z => z.kind === 'cavity'), seps: lat.zones.filter(z => z.kind === 'sep'), kick, sExit, circ: lat.circ,
    sign: Math.sign(I.q), qs: I.q, aq: Math.abs(I.q), m: I.m, lep: I.lep, rho: LAT.rho, h: LAT.h, alphaC, inj, Emax: E,
    gainCap: (E - inj) / 10, sepB: 0, sepTheta: 0, sepL: 0, nCav: 0, running: false, ramping: false, Es: inj, ss: 0, qV: 0, sep: 1, cnt: 0, N: C.bunch }, extra);
}
function centreLayout(segs) { // the box around the beam pipes and injection lines, and the shift that centres it
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const g of segs) { if (g.arc) for (let k = 0; k <= 8; k++) { const a = g.a0 + (g.a1 - g.a0) * k / 8; add(g.cx + g.r * Math.cos(a), g.cy + g.r * Math.sin(a)); } else { add(g.x0, g.y0); add(g.x1, g.y1); } }
  return [x0, x1, y0, y1];
}
function shiftCollider(C, dx, dy) {
  for (const z of W.zones) { z.cx += dx; z.cy += dy; }
  for (const s of W.sources) { s.x += dx; s.y += dy; }
  for (const g of C.pipes) { if (g.arc) { g.cx += dx; g.cy += dy; } else { g.x0 += dx; g.y0 += dy; g.x1 += dx; g.y1 += dy; } }
  for (const l of C.injLines) for (let k = 0; k < l.length; k += 2) { l[k] += dx; l[k + 1] += dy; }
  for (const d of C.dets) { if (d.box) { d.box[0] += dx; d.box[1] += dx; d.box[2] += dy; d.box[3] += dy; } else { d.x += dx; d.y += dy; } }
}
function fitCollider(C) {
  const segs = C.pipes.slice();
  for (const l of C.injLines) segs.push({ arc: false, x0: l[0], y0: l[1], x1: l[2], y1: l[3] });
  const [x0, x1, y0, y1] = centreLayout(segs);
  shiftCollider(C, -(x0 + x1) / 2, -(y0 + y1) / 2);
  setBox(Math.ceil(x1 - x0 + 2 * LAT.w + 14), Math.ceil(y1 - y0 + 2 * LAT.w + 14));
}
/* A particle and its antiparticle share one ring, going round opposite ways in the same magnets (the positive one
   clockwise). Eight cells of QF, bending magnet, QD; eight straights: detectors at the top and bottom, where the
   bunches cross, RF cavities left and right and (beside the separators) at the upper corners, and the two injectors at the lower corners. Electrostatic separators
   at all four corners push the beams apart, outward at the upper corners and inward at the lower ones, so the
   beams pass each other apart at both detectors while each orbit keeps its length (which one RF system serving
   both beams needs: an even harmonic, so both meet it at the same phase). */
const ALPHA_C1 = 0.222, SEP_THETA1 = 0.06, SEP_L1 = 0.0008, CO1 = { P: [0.159, -0.0438], N: [-0.250, 0.0523] };
function ringLayout(C, A, B, E) {
  E = ringCap(A, E);
  const P = ringParams(E, A.lep), Ls = LAT.Ls, h2 = Ls / 2;
  const pos = A.q > 0 ? A : B, neg = A.q > 0 ? B : A, tp = A.q > 0 ? 'a' : 'b', tn = A.q > 0 ? 'b' : 'a';
  const st = {
    ip: (m) => [{ t: 'D', L: h2 }, { t: 'D', L: 0, mark: m }, { t: 'D', L: h2 }], rf: () => [{ t: 'D', L: 1 }, { t: 'RF', L: Ls - 2 }, { t: 'D', L: 1 }],
    sep: (sg) => [{ t: 'D', L: 1 }, { t: 'SEP', L: Ls - 2, sign: sg }, { t: 'D', L: 1 }],
    sepRf: (sg) => [{ t: 'D', L: 1 }, { t: 'SEP', L: 5, sign: sg }, { t: 'D', L: 1 }, { t: 'RF', L: Ls - 8 }, { t: 'D', L: 1 }], // (the upper corners: a separator and a cavity)
  };
  const cell = latCell, K = LAT.kick, ks = [{ t: 'D', L: 1 }, { t: 'SEP', L: Ls - K - 2, sign: -1 }, { t: 'D', L: 1 }]; // (the kicker straights' separators share them with the kickers)
  const elems = [{ t: 'D', L: 0, mark: 'ip2' }, { t: 'D', L: h2 }, ...cell(), { t: 'D', L: K, mark: 'kickN' }, ...ks, ...cell(), ...st.rf(), ...cell(), ...st.sepRf(1),
    ...cell(), ...st.ip('ip1'), ...cell(), ...st.sepRf(1).slice().reverse(), ...cell(), ...st.rf(), ...cell(), ...ks, { t: 'D', L: K, mark: 'kickP' }, ...cell(), { t: 'D', L: h2 }];
  const lat = marchLattice(0, 0, Math.PI, elems, undefined);
  W.zones.push(...lat.zones);
  C.layout = 'single'; C.pipes = lat.segs; C.injLines = []; C.dets = [];
  for (const m of ['ip1', 'ip2']) C.dets.push({ x: lat.marks[m].x, y: lat.marks[m].y, r: 6 });
  const Lt = lat.circ / LAT.h / 18, kp = addInjector(C, pos, tp, lat.marks.kickP, 1, P.inj, CO1.P, Lt), kn = addInjector(C, neg, tn, lat.marks.kickN, -1, P.inj, CO1.N, Lt);
  C.rings.push(ringDesc(C, pos, null, lat, kp, lat.marks.kickP.s0 + K, P.inj, E, ALPHA_C1, { nCav: 4, sepTheta: SEP_THETA1, sepL: SEP_L1, kickOther: kn, sepDist: 3.5 }));
  C.EA = C.EB = C.E;
  C.R = LAT.rho; C.circ = lat.circ;
  fitCollider(C);
}
/* Any other pair needs a ring for each beam (like the LHC): two rings of the same eight cells side by side, sharing
   one straight, where the detector sits; each has its own magnets (two-in-one magnets: only its beam goes through
   them), its RF cavities and its injector at a corner. Both beams go round clockwise, so they meet
   head-on in the shared straight; they fly at the same speed (the same γ: each one's energy in proportion to its
   mass, E being the lighter one's), so the bunches take the same time per turn and meet in the detector every
   turn. While they are sped up the bending magnets are set a little strong, which pulls both orbits in, away from
   the shared straight (and shortens them, which the RF follows). Each ring has four RF cavities, in opposite pairs. */
const SEP_B2 = 0.15, SEP_L2 = -0.0303, CO2 = [-2.358, -0.0515];
function twoRingLayout(C, A, B, E, E2) {
  let EA, EB, Ea, Eb, injA, injB; // set energies, and what each ring reaches (an electron's limit) and injects at
  if (E2 === null) { // the same speed for both: the lighter one's energy sets γ, and an electron's limit holds both back
    const k = Math.max(A.m, B.m) / Math.min(A.m, B.m); EA = A.m <= B.m ? E : E * k; EB = B.m < A.m ? E : E * k;
    const L = A.m <= B.m ? A : B, Ec = ringCap(L, E), f = Ec / E, P = ringParams(Ec, L.lep);
    Ea = EA * f; Eb = EB * f; injA = P.inj * EA / E; injB = P.inj * EB / E;
  } else { // each beam its own energy: different speeds unless both are near light speed
    EA = E; EB = E2; Ea = ringCap(A, EA); Eb = ringCap(B, EB); injA = ringParams(Ea, A.lep).inj; injB = ringParams(Eb, B.lep).inj;
  }
  const Ls = LAT.Ls, h2 = Ls / 2, S = () => [{ t: 'D', L: Ls }], cell = latCell;
  // (four RF cavities, in the straights after the second, third, sixth and seventh cell — opposite pairs: a quarter of the
  // kick each, which keeps the energy swings small; see RF_HOLD_BK in engine.js)
  const RF = () => [{ t: 'D', L: 1 }, { t: 'RF', L: Ls - 2 }, { t: 'D', L: 1 }];
  const elems = [{ t: 'D', L: 0, mark: 'ip' }, { t: 'D', L: h2 }, ...cell(), ...S(), ...cell(), ...RF(), ...cell(), ...RF(), ...cell(),
    ...S(), ...cell(), { t: 'D', L: Ls - LAT.kick }, { t: 'D', L: LAT.kick, mark: 'kick' }, ...cell(), ...RF(), ...cell(), ...RF(), ...cell(), { t: 'D', L: h2 }];
  C.layout = 'double'; C.pipes = []; C.injLines = []; C.dets = [{ box: [-LAT.w, LAT.w, -h2, h2] }]; C.EA = EA; C.EB = EB;
  for (const [I, tag, h0, Eb1, inj] of [[A, 'a', -Math.PI / 2, Ea, injA], [B, 'b', Math.PI / 2, Eb, injB]]) {
    const lat = marchLattice(0, 0, h0, elems, tag);
    W.zones.push(...lat.zones); C.pipes.push(...lat.segs);
    const kk = addInjector(C, I, tag, lat.marks.kick, 1, inj, CO2, lat.circ / LAT.h / 18);
    C.rings.push(ringDesc(C, I, tag, lat, kk, lat.marks.kick.s0 + LAT.kick, inj, Eb1, ALPHA_C1, { nCav: 4, sepB: SEP_B2, sepL: SEP_L2, sepDist: 3.96 }));
  }
  C.R = LAT.rho; C.circ = C.rings[0].circ;
  fitCollider(C);
}
/* Builds (or rebuilds) a collider: a ring (one shared ring for a particle and its antiparticle, otherwise a ring
   for each beam) or two linear accelerators; beam species a and b (keys of BEAM_SPECIES, or a pair key such as
   'ee' in place of both), each particle with kinetic energy E (eV) at collision, or beam 1 with E and beam 2 with E2
   (a particle and its antiparticle at different energies then need a ring each). */
function setupCollider(kind, a, b, E, E2) {
  if (typeof b === 'number' || b === undefined) { E2 = undefined; E = b; [a, b] = BEAM_PAIRS[a] || BEAM_PAIRS.ee; }
  if (!BEAM_SPECIES[a]) a = 'pos'; if (!BEAM_SPECIES[b]) b = 'e';
  E = clamp(E || 2e6, 2e4, 1e15);
  E2 = E2 === undefined || E2 === null ? null : clamp(E2, 2e4, 1e15); // beam 2's own energy (null: matched to beam 1)
  const A = beamInfo(a), B = beamInfo(b);
  for (const p of W.parts) if (!p.dead) kill(p);
  W.zones.length = 0; W.sources.length = 0;
  const old = W.collider;
  const C = W.collider = { kind, a, b, E, E2, auto: old ? old.auto : true, bunch: old ? old.bunch : 10, sepMode: old && old.sepMode || 'auto', hits: 0, last: '', rings: [], colliding: false, colTurns: 0, pipes: [], injLines: [], dets: [] };
  if (kind !== 'ring') linacLayout(C, A, B, E, E2 === null ? E : E2);
  else if (isAntiPair(A, B) && (E2 === null || Math.abs(E2 / E - 1) < 1e-9)) ringLayout(C, A, B, E);
  else twoRingLayout(C, A, B, E, E2);
  C.bbN = beamBeamN(A, C.EA || E, B, C.EB || E);
  const pvTop = (tag, I, E0) => { const g = C.rings.find(r => r.beam === tag) || C.rings[0], Et = g ? g.Emax : E0; return pcOf(I.m, Et) / PHYS.C * speedOf(I.m, Et); };
  C.pvF = { a: pvTop('a', A, C.EA || E), b: pvTop('b', B, C.EB || E) }; // (the beam–beam pull is held at its full-energy strength)
  W.slowHold = true; W.hold = null; W.holdFrac = 0.08; // follow the beams in slow motion
}
function setBox(w, h) { W.box.w = W.box.tw = w; W.box.h = W.box.th = h; }
/* Two linear accelerators facing each other: each pushes its beam through the set voltage, and a quadrupole just
   before the collision point focuses it. */
function linacLayout(C, A, B, EA, EB) {
  const L = 80, f = 13, wq = 8, injA = Math.min(2e5, 0.25 * EA), injB = Math.min(2e5, 0.25 * EB);
  C.layout = 'linear'; C.EA = EA; C.EB = EB; setBox(230, 60);
  // cavities push a to the right and b to the left; each focusing magnet faces its incoming beam
  W.zones.push({ kind: 'cavity', cx: -62, cy: 0, w: L, h: 10, ang: 0, E: Math.max(0, EA - injA) / L / A.q, dir: 1, label: 'linac' });
  W.zones.push({ kind: 'cavity', cx: 62, cy: 0, w: L, h: 10, ang: 0, E: -Math.max(0, EB - injB) / L / B.q, dir: -1, label: 'linac' });
  // a lens of focal length f; for electrons a weaker one, as the field that bends them radiates (synchrotron light,
  // (2/3)k·γ⁴·y²/(w·f²) for a particle y off the axis): kept under 0.2% of the energy 0.6 Å off the axis
  const fOf = (I, E) => { if (!I.lep) return f; const g = 1 + E / (I.m * AMU_EV); return Math.max(f, Math.sqrt(2 / 3 * PHYS.KE * g ** 4 * 0.36 / (wq * 0.002 * E))); };
  const G = (I, E) => pcOf(I.m, E) / PHYS.C / (Math.abs(I.q) * wq * fOf(I, E) * PHYS.LOR) * Math.sign(I.q);
  W.zones.push({ kind: 'quad', cx: -13, cy: 0, w: wq, h: 12, ang: 0, G: G(A, EA) });
  W.zones.push({ kind: 'quad', cx: 13, cy: 0, w: wq, h: 12, ang: 0, G: -G(B, EB) });
  // (a bunch goes in short, so that stretched out by the linac, where its leaders speed away from the rest, it is still only
  // about 1.5 Å long per particle at full energy, and the two bunches meet in the detector)
  // the faster beam goes in later, so the two bunches meet in the detector: time from the source to the collision point,
  // 10 Å at the injection energy, through the linac as it gains energy evenly, then 22 Å at full energy
  const tOf = (I, inj, E) => { let t = 10 / speedOf(I.m, inj) + 22 / speedOf(I.m, E); for (let k = 0; k < 200; k++) t += 0.4 / speedOf(I.m, inj + (E - inj) * (k + 0.5) / 200); return t; };
  const tA = tOf(A, injA, EA), tB = tOf(B, injB, EB);
  W.sources.push({ x: -112, y: 0, ux: 1, uy: 0, spec: A.spec, KE: injA, rate: speedOf(A.m, EA) / 1.5, acc: 0.99, count: C.bunch, jitter: 1.2, beam: 'a', delay: Math.max(0, tB - tA) });
  W.sources.push({ x: 112, y: 0, ux: -1, uy: 0, spec: B.spec, KE: injB, rate: speedOf(B.m, EB) / 1.5, acc: 0.99, count: C.bunch, jitter: 1.2, beam: 'b', delay: Math.max(0, tA - tB) });
  for (const s of W.sources.slice(-2)) s.acc = 0.99 - s.rate * s.delay;
  C.dets = [{ x: 0, y: 0, r: 8 }];
}
/* A new beam energy (or pair, or bunch size): the collider is rebuilt and starts a new cycle. */
function setColliderEnergy(E, E2) {
  const C = W.collider; if (!C) return;
  setupCollider(C.kind, C.a, C.b, E, E2 === undefined ? C.E2 : E2);
  fitView();
}
const cEFromS = (s) => Math.pow(10, 4.3 + 10.7 * s / 1000), sFromCE = (E) => Math.round(1000 * (Math.log10(E) - 4.3) / 10.7); // 20 keV … 1 PeV (a beam particle's whole kinetic energy: a lead ion at the LHC carries 574 TeV)
/* Any element and any isotope of it can be a beam (bare nuclei): each beam's first menu picks a lepton, an antiparticle,
   one of the popular nuclei or any element, and the second one of that element's isotopes, every one that holds
   together (the isotope builder's range; half-lives as measured, or estimated where they never have been). An
   isotope with no entry in BEAM_SPECIES gets one when picked. */
function beamKey(Z, A) {
  for (const k in BEAM_SPECIES) { const s = BEAM_SPECIES[k]; if (s.Z === Z && s.A === A && !s.anti) return k; }
  const k = `z${Z}a${A}`;
  BEAM_SPECIES[k] = { lab: sup(A) + ELEMENTS[Z].sym, name: `${ELEMENTS[Z].name.toLowerCase()}-${A}`, g: 'Any', Z, A };
  return k;
}
function beamIsotopes(Z) { // mass numbers of the isotopes that hold together
  const out = [];
  for (let N = 0; N <= nbMaxN(Z); N++) if (!nuclideInfo(Z, N).unbound) out.push(Z + N);
  return out;
}
function defaultBeamA(Z) { // a popular beam of that element, else its usual isotope, else its longest-lived one
  for (const k in BEAM_SPECIES) { const s = BEAM_SPECIES[k]; if (s.Z === Z && !s.anti && s.g !== 'Any') return s.A; }
  const As = beamIsotopes(Z);
  if (As.includes(COMMON_A[Z])) return COMMON_A[Z];
  let best = As[0], bt = -1;
  for (const A of As) { const n = nuclideInfo(Z, A - Z), t = n.stable ? Infinity : n.t12; if (t > bt) { bt = t; best = A; } }
  return best;
}
function buildBeamSelects() {
  const opt = (v, t) => `<option value="${v}">${t}</option>`, grp = (g, o) => `<optgroup label="${g}">${o}</optgroup>`;
  const sp = Object.entries(BEAM_SPECIES).filter(([, s]) => s.g !== 'Any');
  const html = grp('Leptons', sp.filter(([, s]) => !s.Z).map(([k, s]) => opt(k, `${s.lab} ${s.name}`)).join('')) +
    grp('Antimatter', sp.filter(([, s]) => s.anti).map(([k, s]) => opt(k, `${s.lab} ${s.name}`)).join('')) +
    grp('Popular nuclei', sp.filter(([, s]) => s.Z && !s.anti).map(([k, s]) => opt(k, `${s.lab} ${s.name}`)).join('')) +
    grp('Any element (then pick the isotope)', ELEMENTS.slice(1, Z_TABLE + 1).map(E => opt('Z' + E.Z, `${E.sym} ${E.name} (${E.Z})`)).join(''));
  $('cBeamA').innerHTML = html; $('cBeamB').innerHTML = html;
  // the search boxes suggest the same entries, by what the menus show
  BEAM_FIND.clear();
  const sugg = sp.map(([k, s]) => [`${s.lab} ${s.name}`, k]).concat(ELEMENTS.slice(1, Z_TABLE + 1).map(E => [`${E.sym} ${E.name} (${E.Z})`, 'Z' + E.Z]));
  for (const [t, v] of sugg) BEAM_FIND.set(t.toLowerCase(), v);
  $('cBeamList').innerHTML = sugg.map(([t]) => `<option value="${esc(t)}"></option>`).join('');
}
/* What a typed beam means: an entry of the menus, an element by name, symbol or atomic number, an isotope of one
   (calcium-48, Ca-48, 48Ca, ⁴⁸Ca, ca 48) or a particle by its everyday name. → { v, A } as the menus give them ('Z<n>'
   for an element, with a mass number if one was typed), { bad: why } when nothing fits, null for nothing typed. */
const BEAM_FIND = new Map();
const BEAM_WORDS = { electron: 'e', electrons: 'e', 'e-': 'e', 'e−': 'e', positron: 'pos', positrons: 'pos', 'e+': 'pos', antielectron: 'pos',
  proton: 'p', protons: 'p', p: 'p', 'p+': 'p', antiproton: 'pbar', antiprotons: 'pbar', pbar: 'pbar', 'p-': 'pbar', 'p̄': 'pbar',
  deuteron: 'd', deuterons: 'd', d: 'd', triton: 't', tritons: 't', t: 't', alpha: 'a', alphas: 'a', 'α': 'a', 'alpha particle': 'a', helion: 'he3',
  antideuteron: 'dbar', antialpha: 'abar', 'anti-alpha': 'abar' };
const EL_ALIASES = { aluminum: 13, sulphur: 16, cesium: 55 };
function elementZ(w) { // a symbol, a name, or the only name that starts so
  if (EL_ALIASES[w]) return EL_ALIASES[w];
  for (let Z = 1; Z <= Z_TABLE; Z++) { const E = ELEMENTS[Z]; if (E.sym.toLowerCase() === w || E.name.toLowerCase() === w) return Z; }
  if (w.length >= 3) { const c = []; for (let Z = 1; Z <= Z_TABLE; Z++) if (ELEMENTS[Z].name.toLowerCase().startsWith(w)) c.push(Z); if (c.length === 1) return c[0]; }
  return 0;
}
function beamFind(text) {
  const raw = String(text == null ? '' : text).trim().toLowerCase();
  if (!raw) return null;
  if (BEAM_FIND.has(raw)) return { v: BEAM_FIND.get(raw) };
  const t = raw.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c))).replace(/\s+/g, ' ');
  if (BEAM_WORDS[t]) return { v: BEAM_WORDS[t] };
  let m, el, A;
  if ((m = /^(\d{1,3}) ?-? ?([a-z]+)$/.exec(t))) { el = m[2]; A = +m[1]; }
  else if ((m = /^([a-z]+) ?-? ?(\d{1,3})$/.exec(t))) { el = m[1]; A = +m[2]; }
  else if (/^\d{1,3}$/.test(t)) { const Z = +t; return Z >= 1 && Z <= Z_TABLE ? { v: 'Z' + Z } : { bad: `There is no element number ${t}.` }; }
  else el = t;
  const Z = elementZ(el);
  if (!Z) {
    const some = el.length >= 2 ? ELEMENTS.slice(1, Z_TABLE + 1).filter(E => E.name.toLowerCase().startsWith(el)).map(E => E.name.toLowerCase()) : [];
    return { bad: some.length > 1 ? `“${String(text).trim()}” could be ${some.slice(0, 4).join(', ')}${some.length > 4 ? ' …' : ''}: type more, or pick from the list.` : `“${String(text).trim()}” is not an element or a beam particle.` };
  }
  if (A === undefined) return { v: 'Z' + Z };
  if (!beamIsotopes(Z).includes(A)) return { bad: `${sup(A)}${ELEMENTS[Z].sym} does not hold together: ${ELEMENTS[Z].name.toLowerCase()} has isotopes from ${sup(beamIsotopes(Z)[0])}${ELEMENTS[Z].sym} to ${sup(beamIsotopes(Z).slice(-1)[0])}${ELEMENTS[Z].sym}.` };
  return { v: 'Z' + Z, A };
}
/* A beam's two menus showing its species: element and isotope for a nucleus, the species itself otherwise. */
function showBeamPick(k, selId, isoId) {
  const s = BEAM_SPECIES[k], el = $(selId), iso = $(isoId);
  if (!s || !s.Z || s.anti) { el.value = k; iso.hidden = true; return; }
  el.value = 'Z' + s.Z; iso.hidden = false;
  if (iso.dataset.z !== String(s.Z)) {
    iso.innerHTML = beamIsotopes(s.Z).map(A => { const n = nuclideInfo(s.Z, A - s.Z); return `<option value="${A}">${sup(A)}${ELEMENTS[s.Z].sym} · ${n.stable ? 'stable' : `t½ ${fmtTime(n.t12)}${n.estimated ? ' (est.)' : ''}`}</option>`; }).join('');
    iso.dataset.z = String(s.Z);
  }
  iso.value = String(s.A);
}
function syncCollider() {
  const C = W.collider, g = $('gCollider');
  g.hidden = !C;
  if (!C) return;
  if (!$('cBeamA').options.length) buildBeamSelects();
  showBeamPick(C.a, 'cBeamA', 'cIsoA'); showBeamPick(C.b, 'cBeamB', 'cIsoB');
  const pk = Object.keys(BEAM_PAIRS).find(k => BEAM_PAIRS[k][0] === C.a && BEAM_PAIRS[k][1] === C.b) || '';
  setSegValue('segBeams', pk);
  const A = beamInfo(C.a), B = beamInfo(C.b), each = C.E2 !== null && C.E2 !== undefined;
  $('cESlider').value = sFromCE(C.E);
  $('chkEach').checked = each; $('cE2Wrap').hidden = !each;
  $('cELabel').textContent = each ? `Beam 1 energy (${A.lab})` : 'Beam energy';
  if (each) { setTxt('cEVal', fmtE(C.E)); $('cE2Slider').value = sFromCE(C.E2); setTxt('cE2Val', `${fmtE(C.E2)} (${B.lab})`); }
  else setTxt('cEVal', C.EA && Math.abs(C.EB / C.EA - 1) > 1e-6 ? `${A.lab} ${fmtE(C.EA)} · ${B.lab} ${fmtE(C.EB)}` : fmtE(C.E) + ' each');
  $('cNSlider').value = C.bunch; $('cNVal').textContent = String(C.bunch);
  $('chkRefill').checked = C.auto;
  $('cSepWrap').hidden = C.kind !== 'ring';
  setSegValue('segSep', C.sepMode || 'auto');
  $('cSepVal').textContent = { auto: 'apart until full energy', apart: 'kept apart', together: 'brought together' }[C.sepMode || 'auto'];
  $('cFieldK').textContent = C.kind === 'ring' ? 'Bending field' : 'Linac push';
  let note = '';
  if (C.kind === 'ring') {
    const anti = isAntiPair(A, B);
    if (C.layout === 'single') note = 'A particle and its antiparticle share one ring, going round opposite ways through the same magnets: bending magnets with focusing and defocusing quadrupoles between them. Injector linacs at the lower corners bring in a train of each, and kicker magnets turn it onto the orbit. The RF cavities’ oscillating field gathers each train into a bunch and speeds it up while the magnets ramp; particles that land outside the RF bucket fall behind and are lost. Electrostatic separators keep the two beams apart where they cross, and when they are brought together they collide at both detectors. ';
    else {
      const why = anti ? 'A particle and its antiparticle at different energies need different fields to bend them, so each' : A.name === B.name ? 'Beams of the same charge would go round the same way in a shared ring, so each beam' : 'Two different beams can’t share one ring’s magnets, so each';
      note = `${why} has a ring of its own, with its own injector, kicker and four RF cavities; the two rings share one straight, where the detector sits. The RF gathers each injected train into a bunch and speeds it up while the magnets ramp; particles outside the RF bucket are lost. To keep the beams apart the bending magnets are set a little strong, which pulls both beams in off the shared straight; let back, they collide head-on there. `;
      const va = speedOf(A.m, C.rings[0].Emax), vb = speedOf(B.m, C.rings[1].Emax);
      if (!each && A.m !== B.m) note += 'The two fly at the same speed (each one’s energy in proportion to its mass), so both take the same time per turn and their bunches meet in the detector every turn. ';
      else if (each && Math.abs(va / vb - 1) < 0.01) note += `Both fly at nearly the same speed (${fmtBeta(va / PHYS.C)} and ${fmtBeta(vb / PHYS.C)}), so their bunches take about the same time per turn and meet in the detector nearly every turn. `;
      else if (each) note += `At these energies they fly at different speeds (${fmtBeta(va / PHYS.C)} and ${fmtBeta(vb / PHYS.C)}), so their bunches take different times per turn and meet in the detector only when their timings line up. `;
    }
    for (const L of [A, B].filter(I => I.lep).slice(0, 1)) {
      const EL = L === A ? (C.EA || C.E) : (C.EB || C.E), cap = ringCap(L, EL);
      note += cap < EL ? `Electrons bent this tightly radiate synchrotron light (the γ rays leaving along the ring), more the faster they go: near ${fmtE(ringTopE(L, 1e12, LAT.rho))} they would radiate each turn all that the RF can give, so they are sped up only to ${fmtE(cap)}, short of the ${fmtE(EL)} asked for${A.lep && B.lep || each ? '' : ' (and the other beam to the same speed)'}.` : 'Electrons bent this tightly radiate synchrotron light (the γ rays leaving along the ring), which the RF makes up each turn.';
    }
  } else note = 'Each linac pushes its beam through the stated voltage, so a beam reaches the collision point with this energy. The beams are squeezed toward the axis by the focusing magnets just before they meet.';
  const mk = makeNote(C, A, B);
  note += ' ' + mk.text;
  $('cNote').innerHTML = esc(note) + (mk.go ? ` <button class="btn small" id="cGo" title="Set both beams to this energy">Go to ${esc(fmtE(mk.go))} each</button>` : '');
  if (mk.go) $('cGo').onclick = () => { const each = C.E2 !== null && C.E2 !== undefined; setColliderEnergy(mk.go, each ? mk.go : null); syncCollider(); log('tool', `Collider beams: ${fmtE(mk.go)} each`); };
  $('cScale').textContent = scaleNote(C);
  updateCollider();
}
/* What these beams can make at this energy: the collision energy in their own frame, √s, against the thresholds
   (the same physics as hep.js), and the next threshold up. */
function makeNote(C, A, B) {
  const R = C.kind === 'ring' && C.rings && C.rings.length ? C.rings : null;
  const EA = R ? (R.find(g => g.beam === 'a') || R[0]).Emax : C.EA || C.E, EB = R ? (R.find(g => g.beam === 'b') || R[0]).Emax : C.EB || C.E;
  const ma = A.m * PHYS.AMU_MEV, mb = B.m * PHYS.AMU_MEV;
  const rsOf = (ea, eb) => { const Ea = ea / 1e6 + ma, Eb = eb / 1e6 + mb; return Math.sqrt((Ea + Eb) ** 2 - (Math.sqrt(Ea * Ea - ma * ma) - Math.sqrt(Eb * Eb - mb * mb)) ** 2); }; // head-on (MeV)
  const rs = rsOf(EA, EB), sym = Math.abs(ma / mb - 1) < 1e-6;
  const at = `In their own frame they meet with √s = ${fmtE(rs * 1e6)}`;
  let go = 0; // (a beam energy to offer: the next threshold, or a resonance's peak)
  const next = (thr, what, target) => { if (!(sym && rs < thr)) return ''; go = target || (thr / 2 - ma) * 1.04e6; return ` Next: ${what} from ${fmtE((thr / 2 - ma) * 1e6)} each.`; };
  const out = (text) => ({ text, go: go >= 2e4 && go <= 1e15 ? go : 0 });
  const list = (xs) => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0];
  if (A.lep && B.lep) {
    if (A.anti === B.anti) return out(`${at}: like charges only scatter.`);
    const T = [[211.3, 'muon pairs'], [279.1, 'pion pairs (the ρ at 775 MeV)', 387.1e6], [987.4, 'kaon pairs (the φ at 1.02 GeV)', 509.22e6], [1876.5, 'proton–antiproton pairs'], [3553.7, 'τ pairs']];
    const can = ['two γ rays'].concat(T.filter(t => rs > t[0]).map(t => t[1])), nx = T.find(t => rs <= t[0]);
    const atPhi = Math.abs(rs - 1019.46) < 4 ? ' At the φ resonance, kaon pairs outnumber everything else.' : '';
    const belowPhi = sym && rs > 987.4 && rs < 1015.4; // (past the kaon threshold but short of the φ itself)
    if (belowPhi) go = 509.22e6;
    return out(`${at}: an electron and a positron can annihilate into ${list(can)}, in proportion to their cross sections.${rs > 2500 ? ' Hadrons come out as two jets, back to back: a quark and an antiquark fly apart and the colour string between them breaks into pions and kaons.' : ''}${atPhi}${belowPhi ? ' The φ resonance, where kaon pairs lead, is just above.' : nx ? next(nx[0], nx[1], nx[2]) : ''}`);
  }
  if (A.lep || B.lep) return out(`${at}: electrons only scatter off nuclei here (Mott scattering); exciting the nucleus takes a pass about ten thousand times closer, too rare to see.`);
  if (A.anti !== B.anti) return out(`${at}: matter and antimatter annihilate into mesons, about five pions (now and then kaons) for each nucleon pair${rs > 2 * 939.57 ? ', and a proton and an antiproton now and then trade charge (p p̄ → n n̄)' : ''}.`);
  if (A.A === 1 && B.A === 1) {
    const T = [[2011.5, 'pions (p p → d π⁺, p p π⁰, p n π⁺)', 70e6], [2547.6, 'kaons with a Λ (strangeness)', 345e6], [3752.0, 'antiprotons (p p → p p p p̄)', 1.2e9]];
    const can = T.filter(t => rs > t[0]).map(t => t[1]), nx = T.find(t => rs <= t[0]);
    return out(`${at}: ${can.length ? `close passes can make ${list(can)}` : 'below the pion threshold they only scatter (and, very rarely, fuse: p + p → d + e⁺ + ν)'}.${rs > 5000 ? ' At this energy the hadrons come out along the beams, as colour strings stretched between the protons break up (the string model).' : ''}${nx ? next(nx[0], nx[1], nx[2]) : ''}`);
  }
  const Ecm = rs - ma - mb, VB = 1.44 * A.Z * B.Z / (1.2 * (Math.cbrt(A.A) + Math.cbrt(B.A)) + 1.6), eps = Ecm * (A.A + B.A) / (A.A * B.A);
  if (Ecm <= VB) { if (sym) go = VB / 2 * 1.3e6; return out(`${at.replace('√s = ' + fmtE(rs * 1e6), fmtE(Ecm * 1e6) + ' of motion')}, below their ${fmtE(VB * 1e6)} Coulomb barrier: their charges keep them apart and they scatter${A.A + B.A <= 16 ? ', and now and then tunnel through and fuse' : ''}.${sym ? ` Over the barrier from ${fmtE(VB / 2 * 1e6)} each.` : ''}`); }
  const cn = nucSymA(A.Z + B.Z, A.A + B.A - A.Z - B.Z, A.anti);
  const rsN = () => { const m1 = ma / A.A, m2 = mb / B.A, E1 = EA / A.A / 1e6 + m1, E2 = EB / B.A / 1e6 + m2; return Math.sqrt((E1 + E2) ** 2 - (Math.sqrt(E1 * E1 - m1 * m1) - Math.sqrt(E2 * E2 - m2 * m2)) ** 2); }; // (per nucleon pair, MeV)
  const pion = rsN() - (ma / A.A + mb / B.A) > 140;
  const how = A.A + B.A <= 16 ? 'the touching nuclei break up into nucleons and light nuclei' : eps < 15 ? `touching nuclei fuse into ${cn}*, which cools by boiling off neutrons, protons and α particles (heavy ones fission instead)${A.Z * B.Z > 1200 ? '; a pair this heavy mostly parts again before it fuses (quasi-fission)' : ''}, and glancing ones trade nucleons` : eps < 40 ? `touching nuclei fuse (${cn}*) or break apart` : 'touching nuclei tear through each other: the overlap bursts into nucleons and light nuclei, and the rest of each flies on and boils off nucleons (fragmentation)';
  const sNN = rsN(), qgpAt = 2 * (QGP.eps + 938.9), big = Math.min(A.A, B.A) >= 16;
  let plasma = '';
  if (big && sNN >= qgpAt) plasma = ` At √s_NN = ${fmtE(sNN * 1e6)} per nucleon pair, a head-on overlap melts into a quark–gluon plasma (above about ${fmtE(qgpAt * 1e6)}), which freezes out into hundreds or thousands of hadrons.`;
  else if (big) { if (sym) go = A.A * (qgpAt / 2 - 938.9) * 1.06e6; plasma = ` A quark–gluon plasma needs √s_NN above about ${fmtE(qgpAt * 1e6)} per nucleon pair (now ${fmtE(sNN * 1e6)}): about ${fmtE(A.A * (qgpAt / 2 - 938.9) * 1e6)} a beam${A.A > 1 ? ` (${fmtE((qgpAt / 2 - 938.9) * 1e6)} per nucleon)` : ''}.`; }
  return out(`${at.replace('√s = ' + fmtE(rs * 1e6), fmtE(Ecm * 1e6) + ' of motion')} (${fmtE(eps * 1e6)} per nucleon), over their ${fmtE(VB * 1e6)} Coulomb barrier: ${how}${pion ? ', with pions' : ''}; the new nuclei then decay as usual.${plasma}`);
}
/* A speed as a fraction of light's: 0.065 c, 0.942 c, 0.99943 c (enough 9s to tell it from c). */
function fmtBeta(b) {
  if (!(b > 0)) return '0';
  if (b < 0.1) return b.toPrecision(2) + ' c';
  if (b < 0.995) return b.toFixed(3) + ' c';
  return Math.min(1 - 1e-9, b).toFixed(Math.min(7, Math.ceil(-Math.log10(1 - b)) + 1)) + ' c';
}
const fmtLen = (m) => (m >= 1000 ? fmtNum(m / 1000, 2) + ' km' : m >= 1 ? m.toPrecision(2) + ' m' : m >= 0.01 ? (m * 100).toPrecision(2) + ' cm' : m >= 1e-3 ? (m * 1e3).toPrecision(2) + ' mm' : m >= 1e-6 ? (m * 1e6).toPrecision(2) + ' µm' : (m * 1e9).toPrecision(2) + ' nm');
/* Real-world scale: the same beams in real magnets, and this machine's fields. */
function scaleNote(C) {
  const A = beamInfo(C.a), B = beamInfo(C.b), R = C.kind === 'ring' && C.rings && C.rings.length ? C.rings : null; // (a ring's own top energy: electrons are held back by radiation)
  const EA = R ? R[0].Emax : C.EA || C.E, EB = R ? (R[1] || R[0]).Emax : C.EB || C.E; // (one ring: both beams alike)
  const pq = Math.max(pcOf(A.m, EA) / Math.abs(A.q), pcOf(B.m, EB) / Math.abs(B.q)); // the stiffer beam: momentum per charge (eV)
  if (C.kind !== 'ring') {
    const inj = Math.min(2e5, 0.25 * C.E), grad = (C.E - inj) / 80e-10; // volts over the 8 nm linac
    return `Real-world scale: this linac gives ${fmtVolt(C.E - inj)} over 8 nm, ${fmtSI(grad, 'V/m', 2)}; real linacs manage 20–100 MV per metre, so a real one would be ${fmtLen((C.E - inj) / 5e7)} long for this energy.`;
  }
  const rho = LAT.rho * 1e-10, Bhere = pq / (2.998e8 * rho), Rlhc = pq / (2.998e8 * 8.33);
  const g = C.rings[0], gam = 1 + EA / (A.m * AMU_EV), v = 2.998e8 * Math.sqrt(1 - 1 / (gam * gam)), frf = LAT.h * v / (g.circ * 1e-10);
  return `Real-world scale: at the LHC\u2019s 8.3 T, bending these beams round would take a circle ${fmtLen(2 * Rlhc)} across. Here the magnets bend them on a circle ${fmtLen(2 * rho)} across, so they need ${fmtTesla(Bhere)}, and the RF runs at ${fmtSI(frf, 'Hz', 2)} (real rings: a few hundred megahertz).`;
}
/* The bunches' population for the beam–beam forces: what gives the harder-kicked beam a 0.04 rad kick passing 1.5 Å
   from the other bunch's centre, the order of a real collider's beam–beam strength (each beam particle here then
   stands for C.bbN / bunch real ones; real bunches hold ~10¹¹, spread far wider). */
function beamBeamN(A, EA, B, EB) {
  const va = speedOf(A.m, EA), vb = speedOf(B.m, EB), k = 2 * PHYS.KE * Math.abs(A.q * B.q) * (1 + va * vb / (PHYS.C * PHYS.C)) * bbG(1.5) / (va + vb);
  return 0.04 / Math.max(k / (pcOf(A.m, EA) / PHYS.C), k / (pcOf(B.m, EB) / PHYS.C));
}
function updateCollider() {
  const C = W.collider; if (!C || UI.tab !== 'lab') return;
  const st = { a: [0, 0, 0], b: [0, 0, 0] }; // per beam: count, kinetic energy, speed
  for (const p of W.parts) if (!p.dead && p.beam && st[p.beam]) { const t = st[p.beam]; t[0]++; t[1] += keOf(p); t[2] += p.rad ? p.sp : Math.hypot(p.vx, p.vy); }
  const two = (fa, fb, same) => (st.a[0] && st.b[0] ? (same ? fa : `${fa} · ${fb}`) : st.a[0] ? fa : st.b[0] ? fb : '—');
  const ea = st.a[1] / (st.a[0] || 1), eb = st.b[1] / (st.b[0] || 1), va = st.a[2] / (st.a[0] || 1) / PHYS.C, vb = st.b[2] / (st.b[0] || 1) / PHYS.C;
  const tile = (id, txt) => { const e = $(id); e.textContent = txt; e.classList.toggle('two', txt.includes('·')); };
  tile('cBeamE', two(fmtE(ea), fmtE(eb), Math.abs(ea / eb - 1) < 0.005));
  tile('cSpeed', two(fmtBeta(va), fmtBeta(vb), C.layout === 'single' || fmtBeta(va) === fmtBeta(vb))); // (one ring: one speed)
  $('cSpeed').parentElement.title = [['a', va], ['b', vb]].filter(([k]) => st[k][0]).map(([k, v]) => `${beamInfo(k === 'a' ? C.a : C.b).lab}: ${fmtSI(v * 2.998e8, 'm/s', 3)}, γ = ${fmtNum(1 / Math.sqrt(Math.max(1e-12, 1 - v * v)), 4)}`).join(' · ');
  $('cCount').textContent = String(st.a[0] + st.b[0]);
  $('cHits').textContent = String(C.hits || 0);
  if (C.kind === 'ring') tile('cField', (C.rings || []).map(g => fmtTesla(Math.abs(g.dip[0].B))).join(' · ') || '—');
  else tile('cField', W.zones.filter(z => z.kind === 'cavity').map(z => fmtVolt(Math.abs(z.E) * z.w)).filter((t, i, a) => a.indexOf(t) === i).join(' · ') || '—'); // (each linac's voltage)
  if (C.kind === 'ring' && C.rings && C.rings.length) { // how far apart the beams run where they cross
    const r = C.rings[0], d = r.sepDist * r.sep;
    $('cSep').textContent = r.sep >= 0.98 ? (r.running ? `apart ${fmtA(r.sepDist)}` : 'apart') : r.sep <= 0.02 ? 'together' : `${C.colliding ? 'merging' : 'parting'} ${d.toFixed(1)} Å`;
  } else $('cSep').textContent = 'head-on';
  const g = C.kind === 'ring' && C.rings && C.rings[0];
  let phase = ''; // where the ring is in its cycle
  if (g) {
    const ramp = g.ramping && g.phiS !== undefined ? `the RF holds each beam in a bunch, its synchronous phase ${Math.round(g.phiS * 180 / Math.PI)}°${g.eta > 0 ? ' (above transition)' : ''}; ${fmtE(g.Es)} of ${fmtE(g.Emax)}` : '';
    if (!g.running) phase = 'Injecting: each injector linac sends in a train, and a kicker magnet turns it onto the orbit.';
    else if (ramp && C.colliding) { // brought together early: close passes scatter more, ∝ 1/(p·v)
      const pv = (E) => pcOf(g.m, E) * speedOf(g.m, E), k = pv(g.Emax) / pv(g.Es);
      phase = `Colliding while still speeding up, at ${fmtE(g.Es)} of ${fmtE(g.Emax)}${k > 1.5 ? `: close passes turn the particles ${k < 10 ? k.toFixed(1) : Math.round(k)} times more sharply than at full energy (Rutherford's law, ∝ 1/(p·v)), so more are knocked out of the ring` : ''}.`;
    } else if (ramp) phase = `Speeding up: ${ramp}.`;
    else if (!C.colliding) phase = C.sepMode === 'apart' ? 'At full energy, kept apart: the beams go round without colliding.' : 'At full energy: bringing the beams together.';
  }
  $('cLast').innerHTML = (phase ? esc(phase) + (C.last ? '<br>' : '') : '') + (C.last ? `<b>Last collision:</b> ${esc(C.last)}` : phase ? '' : 'No collisions yet.');
  const made = C.made ? Object.entries(C.made).sort((p, q) => q[1] - p[1]) : []; // new particles and nuclei, so far
  $('cMade').innerHTML = made.length ? `<b>Made so far:</b> ${made.slice(0, 16).map(([l, n]) => `${esc(l)}&#8202;×${n}`).join(' · ')}${made.length > 16 ? ` and ${made.length - 16} more kinds` : ''}` : '';
}
/* New bunches. A ring can't take them while it holds a beam at full energy (its magnets are set for that beam):
   what is left is dumped first and the magnets go back to the injection field, as at the start of a cycle. */
function injectBeams() {
  const C = W.collider; if (!C) return;
  if (C.kind === 'ring') { for (const p of W.parts) if (!p.dead && p.beam) kill(p); resetRings(C); }
  refillSources(C);
}
/* The hourglass shows slow motion whichever way it came: on demand (W.slowHold) or started by a nuclear event (W.slow).
   Pressed while the automatic kind runs, it takes over (slow motion stays on, now held until pressed again); pressed while
   on, it turns both off. */
function autoSlowOn() { return !!(W.slow && W.slow.on); }
function syncSlowmo() {
  const b = $('bSlowmo'), auto = autoSlowOn() && !W.slowHold, on = !!W.slowHold || auto;
  UI.smShown = (W.slowHold ? 2 : 0) + (auto ? 1 : 0);
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('primary', on);
  b.classList.toggle('auto', auto);
  b.title = auto ? 'Slow motion (started by a nuclear event): press to keep it on, press again to turn it off (\\)' : 'Slow motion: time slows until the fastest particle takes about a second to cross the box (\\)';
}
function toggleSlowmo() {
  if (W.slowHold) { W.slowHold = false; W.slow = null; } // off: the automatic kind too
  else { W.slowHold = true; if (autoSlowOn()) W.slow = null; } // on (taking over from the automatic kind)
  W.hold = null; syncSlowmo(); syncSpeed();
}

/* ------------------------------------------------------------------ presets */
function rp(w, h, m) { return [(rnd() - 0.5) * (w - 2 * m), (rnd() - 0.5) * (h - 2 * m)]; }
function scatter(n, w, h, fn, minD = 2.2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, ok = false;
    for (let k = 0; k < 40 && !ok; k++) { [x, y] = rp(w, h, 3); ok = pts.every(([a, b]) => Math.hypot(a - x, b - y) > minD); }
    pts.push([x, y]); fn(x, y, i);
  }
}
function baseWorld(w, h, T, gamma) {
  clearWorld();
  W.box.w = W.box.tw = w; W.box.h = W.box.th = h;
  W.T = T; W.gamma = gamma; W.Bz = 0; W.Ex = 0; W.Ey = 0; W.wall = 'reflect'; W.nWall = 'reflect'; W.warp = 1; W.simPerFrame = 1.5; W.decayOn = true;
  W.magnets.length = 0; W.sources.length = 0; W.zones.length = 0; W.collider = null; W.slowHold = false; W.hold = null; W.holdFrac = 0;
  UI.E = 0; UI.Eang = 0;
}
const D_SPEC = { kind: 'atom', Z: 1, A: 2, bare: true }, T_SPEC = { kind: 'atom', Z: 1, A: 3, bare: true };
const PRESETS = {
  soup: { group: 'Building blocks', name: 'Primordial soup', tool: 'place', spec: SPEC_P,
    hint: '<b>Protons, neutrons and electrons at 3,000 K.</b> Electrons fall into protons (each red flash is a Balmer line), hydrogen atoms pair into H₂, and free neutrons β-decay (sped up ×6×10¹³, so their 10-minute half-life passes in about 11 s). Heat past 30,000 K to strip the electrons off again.',
    build() { baseWorld(60, 42, 3000, 0.05); W.warp = 6e13;
      scatter(24, 60, 42, (x, y) => spawnSpec(SPEC_P, x, y), 3);
      scatter(24, 60, 42, (x, y) => spawnSpec({ kind: 'e' }, x, y), 0);
      scatter(8, 60, 42, (x, y) => spawnSpec({ kind: 'n' }, x, y), 0); } },
  empty: { group: 'Building blocks', name: 'Empty chamber', tool: 'place', spec: SPEC_P,
    hint: '<b>An empty chamber at room temperature.</b> Pick a particle above and click to place it. Try a proton and an electron, two hydrogen atoms, or any element, isotope or ion from <b>Elements…</b>',
    build() { baseWorld(40, 28, 300, 0.05); } },
  combustion: { group: 'Chemistry', name: 'Hydrogen + oxygen', tool: 'spark', spec: { kind: 'mol', mol: 'H2' },
    hint: '<b>A 2:1 mix of H₂ and O₂ at 600 K.</b> Nothing happens until a bond breaks. Click with the Spark tool or heat a spot: radicals (H, O, OH) start chain reactions that make water and release heat.',
    build() { baseWorld(64, 44, 600, 0.005); let k = 0;
      for (let i = 0; i < 10; i++) for (let j = 0; j < 7; j++) addMolecule(k++ % 3 === 0 ? 'O2' : 'H2', -28.8 + i * 6.4 + (rnd() - 0.5), -19 + j * 6.3 + (rnd() - 0.5), rnd() * 6, 600); } },
  water: { group: 'Chemistry', name: 'Liquid water', tool: 'heat', spec: { kind: 'mol', mol: 'H2O' },
    hint: '<b>Eighty water molecules at 300 K.</b> Oxygen carries a partial negative charge and hydrogen a partial positive one, so molecules cling by hydrogen bonds (dotted lines). Heat a spot and watch molecules evaporate.',
    build() { baseWorld(40, 30, 300, 0.05); for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) addMolecule('H2O', -15.5 + i * 3.4, -12 + j * 3.4, rnd() * 6, 300); } },
  gallery: { group: 'Chemistry', name: 'Molecule gallery', tool: 'inspect', spec: { kind: 'mol', mol: 'caffeine' },
    hint: '<b>Two dozen molecules from the library at room temperature.</b> Click one with Inspect to read about it, or open <b>Molecules…</b> for the whole library, searchable by name or formula. Everything here is flat, so a tetrahedral carbon becomes a cross.',
    build() { baseWorld(86, 56, 300, 0.05);
      const rows = [['H2O', 'CO2', 'NH3', 'CH4', 'O3', 'SF6'], ['ethanol', 'acetic', 'benzene', 'caffeine', 'aspirin', 'glucose'],
        ['coronene', 'adenine', 'thymine', 'glycine', 'urea', 'vitaminC'], ['dopamine', 'serotonin', 'paracetamol', 'nicotine', 'XeF4', 'H2SO4']];
      rows.forEach((r, j) => r.forEach((k, i) => addMolecule(k, -35 + i * 14, 20.5 - j * 13.7, 0, 300))); } },
  salt: { group: 'Chemistry', name: 'Salt crystal', tool: 'heat', spec: { kind: 'atom', Z: 11, A: 23 },
    hint: '<b>Na⁺ and Cl⁻ ions in a square lattice.</b> Coulomb attraction holds them; Born repulsion stops them collapsing. Heat it to melt it, or drop in neutral Na and Cl atoms: an electron jumps from Na to Cl when that releases energy (ionic bonding).',
    build() { baseWorld(50, 36, 300, 0.05); const a = 2.76;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) addAtom((i + j) % 2 ? 'Cl' : 'Na', (i - 3.5) * a, (j - 2.5) * a, { charge: (i + j) % 2 ? -1 : 1 }); } },
  argon: { group: 'Chemistry', name: 'Argon crystal', tool: 'heat', spec: { kind: 'atom', Z: 18, A: 40 },
    hint: '<b>Argon at 40 K.</b> Noble-gas atoms only feel weak van der Waals forces, enough to freeze them into a close-packed crystal. Raise the temperature: real argon melts at 84 K and boils at 87 K.',
    build() { baseWorld(50, 40, 40, 0.05); for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) addAtom('Ar', -17 + i * 3.8 + (j % 2) * 1.9, -11.5 + j * 3.3); } },
  cloud: { group: 'Real labs', name: 'Cloud chamber', tool: 'fire', spec: { kind: 'e' },
    hint: '<b>A cloud chamber: tracks of droplets where charged particles ionized the vapour.</b> Alpha particles (thick, straight: 5.5 MeV, as from americium-241) come in from the left; electrons (thin, from the bottom) and positrons (from the top) at 60 keV curl in the magnetic field, opposite ways: their charges are opposite. The field is enormous (100,000 T) because this chamber is only 24 nm across; a real one uses about 1 T over centimetres, and its α tracks are a few cm long. Fire your own particles with the Fire tool.',
    build() { baseWorld(240, 160, 300, 0); W.wall = 'open'; W.Bz = 1e5; W.cloud = true; W.decayOn = false;
      W.simPerFrame = 4e-4; // (4 attoseconds a frame: an electron near half the speed of light crosses the chamber in about a second)
      W.sources.push({ x: -118, y: 0, ux: 1, uy: 0, spec: { kind: 'atom', Z: 2, A: 4, bare: true }, KE: 5.5e6, rate: 40, acc: 0.5, track: true, jitter: 120 });
      W.sources.push({ x: 0, y: -78, ux: 0, uy: 1, spec: { kind: 'e' }, KE: 6e4, rate: 60, acc: 0.2, track: true, jitter: 160 });
      W.sources.push({ x: 0, y: 78, ux: 0, uy: -1, spec: { kind: 'pos' }, KE: 6e4, rate: 40, acc: 0.7, track: true, jitter: 160 }); } },
  mucf: { group: 'Nuclear', name: 'Muon-catalysed fusion', tool: 'fire', spec: D_SPEC,
    hint: '<b>Cold deuterium and tritium (D₂ and T₂ at 30 K), and a slow negative muon.</b> It slows, is caught by an atom and makes muonic hydrogen, 200 times smaller than an atom; its muon moves to tritium (μt), which grabs a deuteron into the molecule dμt, where d and t sit so close that they fuse: ⁴He + n + 17.6 MeV, at 30 K, no hot plasma needed. The muon is usually set free to do it again (watch the count in the log); it stops when it decays (2.2 µs) or sticks to the α. Decay is sped up ×30,000 so the cycle can be seen. Fire more muons with the Fire tool (μ⁻ under 2 keV: in real matter a faster one travels micrometres before it stops, far beyond this chamber). Real muons cost more energy to make than they catalyse, which is why this is not a power source.',
    build() { baseWorld(56, 40, 30, 0.3); W.warp = 3e4;
      const pair = (A, x, y) => { const th = rnd() * Math.PI, a = addAtom('H', x - 0.37 * Math.cos(th), y - 0.37 * Math.sin(th), { A }), b = addAtom('H', x + 0.37 * Math.cos(th), y + 0.37 * Math.sin(th), { A }); addBond(a, b, 1); };
      scatter(70, 56, 40, (x, y, i) => pair(i % 2 ? 3 : 2, x, y), 3.1);
      OPT.fire.proj = 'mu'; OPT.fire.s = Math.round(100 * (Math.log10(1500) + 2));
      addExo('mu-', -20, 0.2, 1500, 1, 0.01); } },
  grow: { group: 'Chemistry', name: 'Growing a crystal', tool: 'heat', spec: { kind: 'atom', Z: 18, A: 40 },
    hint: '<b>Argon at 160 K, with the bath cooling slowly to 40 K over a minute</b> (Lab → Heat bath; the box wraps round, so no wall starts it). The loose lattice it starts as melts in the first seconds. As it cools, ordered patches appear in the jumble, merge and grow, row by row, until the box is one hexagonal crystal with a few defects. Heat it again to melt it.',
    build() { baseWorld(44, 38.1, 160, 0.05); W.wall = 'wrap'; W.simPerFrame = 6;
      for (let i = 0; i < 11; i++) for (let j = 0; j < 11; j++) if ((i * 11 + j) % 9) addAtom('Ar', -22 + (i + 0.5) * 4 + (j % 2) * 2 + (rnd() - 0.5) * 0.8, -19.05 + (j + 0.5) * 3.464 + (rnd() - 0.5) * 0.8); // (a loose lattice with gaps, already melting at 160 K: no atoms overlap)
      W.ramp = { from: 160, to: 40, dur: 60, t: 0 }; } },
  flame: { group: 'Electrons & light', name: 'Flame colours', tool: 'heat', spec: { kind: 'atom', Z: 11, A: 23 },
    hint: '<b>Lithium, sodium, potassium and copper vapour at 6,000 K.</b> Hot collisions lift outer electrons; falling back, each element emits its own lines: Li crimson 671 nm, Na yellow 589 nm, K lilac 766/404 nm, Cu green 510–522 nm.',
    build() { baseWorld(70, 50, 6000, 0.05); const pts = []; for (const s of ['Li', 'Na', 'K', 'Cu']) for (let i = 0; i < 12; i++) pts.push(s);
      scatter(pts.length, 70, 50, (x, y, i) => addAtom(pts[i], x, y), 4.5); } },
  neon: { group: 'Electrons & light', name: 'Neon discharge', tool: 'place', spec: { kind: 'e' },
    hint: '<b>Neon gas in a 0.15 V/Å electric field, with periodic walls.</b> Free electrons accelerate, then excite neon atoms (red-orange flashes) or knock out more electrons: an avalanche, as in a neon sign. The bath keeps the atoms cool while the electrons run hot. Add electrons to speed it up.',
    build() { baseWorld(120, 40, 300, 0.3); W.wall = 'wrap'; W.Ex = 0.15; UI.E = 0.15;
      scatter(40, 120, 40, (x, y) => addAtom('Ne', x, y), 3.4); scatter(12, 120, 40, (x, y) => spawnSpec({ kind: 'e' }, x, y), 0); } },
  oven: { group: 'Electrons & light', name: 'Glowing oven (black-body light)', tool: 'place', spec: { kind: 'atom', Z: 11, A: 23 },
    hint: '<b>Walls at the Sun’s surface temperature, 5,800 K, glowing.</b> Open Data → Spectrum: the light follows Planck’s curve (dashed). Turn the heat bath down to 3,000 K, a light bulb’s filament, and the walls go orange as the peak slides into the infrared; up to 20,000 K and they go blue-white, the peak in the ultraviolet (Wien’s law). The sodium atoms scatter their own yellow line, and hot enough light ionizes them.',
    build() { baseWorld(90, 56, 5800, 0.05); W.glow = true; scatter(10, 90, 56, (x, y) => addAtom('Na', x, y), 6); } },
  magnet: { group: 'Fields', name: 'Magnetic matter', tool: 'magnet', spec: { kind: 'atom', Z: 26, A: 56 },
    hint: '<b>Iron, oxygen and water beside a 5,000 T magnet pole.</b> Iron is ferromagnetic and pulled in hard until heated past its Curie point (1043 K). O₂ is paramagnetic (unpaired electrons) and drawn in too; water is diamagnetic and only feebly pushed away. Drag the magnet around.',
    build() { baseWorld(70, 46, 300, 0.05);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) addAtom('Fe', -1 + i * 2.6 + (j % 2) * 1.3, -12 + j * 2.25);
      scatter(10, 34, 40, (x, y) => addMolecule('O2', x - 14, y, rnd() * 6), 4);
      scatter(10, 34, 40, (x, y) => addMolecule('H2O', x - 14, y, rnd() * 6), 4);
      W.magnets.push({ x: 24, y: 2, R: 10, B: 5e3 }); } },
  massspec: { group: 'Fields', name: 'Mass spectrometer', tool: 'inspect', spec: SPEC_P,
    hint: '<b>Ions accelerated through 40 V into a 200,000 T field.</b> Each follows a circle of radius √(2mV/q)/B, so ions sort by mass-to-charge ratio: p⁺ (red) lands nearest, ³He²⁺ (violet) next, while d⁺ (green) and α (gold) share m/q = 2 and land together. Ions are sent one at a time: crowded beams push themselves apart (space charge).',
    build() { baseWorld(200, 150, 1, 0); W.Bz = 2e5; W.wall = 'open'; W.simPerFrame = 0.6;
      const src = (spec, KE, ph) => W.sources.push({ x: -85, y: -72, ux: 0, uy: 1, spec, KE, rate: 0.035, acc: ph, track: true });
      src(SPEC_P, 40, 0.9); src(D_SPEC, 40, 0.65); src(SPEC_ALPHA, 80, 0.4); src({ kind: 'atom', Z: 2, A: 3, bare: true }, 80, 0.15); } },
  rhic: { group: 'Accelerators', name: 'Gold on gold: quark–gluon plasma', tool: 'inspect', tab: 'lab', spec: { kind: 'atom', Z: 79, A: 197, bare: true },
    hint: '<b>Gold nuclei at 100 GeV per nucleon, head on, as at RHIC (Brookhaven).</b> Glancing passes knock a few nucleons off; when they overlap enough, the overlap melts into a quark–gluon plasma (a white-hot drop of free quarks and gluons, shown slowed down: it lasts 10⁻²³ s) that freezes out into hundreds or thousands of hadrons, mostly pions. Hadrons beyond the chamber’s limit (Settings → Particle limit) leave with their energy counted. Lower the beam energy in the Lab tab to see where the plasma stops forming (about 3 GeV per nucleon each); pick the Inspect tool and click a pion to look inside it.',
    build() { baseWorld(150, 130, 300, 0); W.wall = 'open'; setupCollider('ring', 'au197', 'au197', 197 * 100e9); } },
  ring: { group: 'Accelerators', name: 'Ring collider', tool: 'inspect', spec: { kind: 'pos' },
    hint: '<b>A collider ring: two beams go round and meet in the detector.</b> A particle and its antiparticle (here positrons and electrons) share one ring, going round opposite ways; any other pair (try D + T, or gold on gold) gets a ring each, the two sharing one straight. The bending magnets (red bands) curve the paths, RF cavities push the beams on every pass, and the field rises as they speed up so they stay on course (a synchrotron). The beams are kept on separate orbits while they speed up, then brought into collision. Pick the beams, their energy and the bunch size in the Lab tab.',
    build() { baseWorld(150, 130, 300, 0); W.wall = 'open'; setupCollider('ring', 'ee', 2e6); } },
  linac: { group: 'Accelerators', name: 'Linear collider', tool: 'inspect', spec: { kind: 'e' },
    hint: '<b>Two linear accelerators fire beams at each other.</b> Each cavity row (gold) pushes its beam along, the focusing magnets (violet) squeeze the beams onto the axis, and they meet head-on at the collision point: electrons and positrons annihilate (above 106 MeV each into new particles too: muon pairs, then pions and kaons), protons and antiprotons burst into pions, deuterium and tritium fuse. Time is slowed so the beams can be followed; change the beams and their energy in the Lab tab.',
    build() { baseWorld(230, 60, 300, 0); W.wall = 'open'; setupCollider('linear', 'ee', 1e6); } },
  fusion: { group: 'Nuclear', name: 'D–T fusion plasma', tool: 'inspect', spec: D_SPEC,
    hint: '<b>Deuterium and tritium nuclei at 150 million K.</b> They tunnel through their Coulomb repulsion (Gamow factor); each fusion makes a 3.5 MeV α particle and a 14.1 MeV neutron (dashed track), 17.6 MeV in all.',
    build() { baseWorld(60, 40, 1.5e8, 0.05);
      scatter(50, 60, 40, (x, y) => spawnSpec(D_SPEC, x, y), 0); scatter(50, 60, 40, (x, y) => spawnSpec(T_SPEC, x, y), 0);
      scatter(100, 60, 40, (x, y) => spawnSpec({ kind: 'e' }, x, y), 0); } },
  chain: { group: 'Nuclear', name: 'Uranium-235 fission', tool: 'fire', spec: { kind: 'n' },
    hint: '<b>A speck of uranium-235, with a slow neutron on its way.</b> ²³⁵U splits when it absorbs one, releasing about 200 MeV: two fragments that tear through the metal, plus 2–3 fast neutrons. In a speck this small nearly every neutron escapes, which is why a chain reaction needs kilograms and a moderator. Fire more neutrons with the Fire tool.',
    build() { baseWorld(90, 64, 300, 0.05);
      for (let i = 0; i < 9; i++) for (let j = 0; j < 8; j++) addAtom('U', -12.4 + i * 3.1 + (j % 2) * 1.55, -9.45 + j * 2.7, { A: 235 });
      const n = spawnSpec({ kind: 'n' }, -40, 1.35, 0)[0]; setMotion(n, 0.025, 1, 0);
      OPT.fire.proj = 'n'; OPT.fire.s = Math.round(100 * (Math.log10(0.025) + 2)); } },
  pet: { group: 'Nuclear', name: 'PET tracer (oxygen-15)', tool: 'inspect', spec: { kind: 'mol', mol: 'H2O' },
    hint: '<b>Water labelled with oxygen-15 (t½ 2 min) at body temperature.</b> Its nuclei decay by β⁺; the positron meets an electron and both vanish into two 511 keV gamma rays flying apart back-to-back, the pair a PET scanner detects. Decay is sped up ×2×10¹³, so the 2-minute half-life passes in about 7 s.',
    build() { baseWorld(60, 40, 310, 0.05); W.warp = 2e13; const ox = [];
      for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) { const m = addMolecule('H2O', -24 + i * 5.3, -14 + j * 5.6, rnd() * 6, 310); const o = m.find(a => a.Z === 8); if (o) ox.push(o); }
      for (let k = 0; k < 8 && ox.length; k++) { const o = ox.splice(Math.floor(rnd() * ox.length), 1)[0]; o.N = 7; refresh(o); } } },
  antihydrogen: { group: 'Antimatter', name: 'Antihydrogen trap', tool: 'place', spec: SPEC_PBAR,
    hint: '<b>Antiprotons (violet) and positrons (pink) at 300 K, in a periodic box so nothing touches a wall.</b> A positron caught by an antiproton makes antihydrogen and gives off the same Balmer light as hydrogen, which is how CERN’s ALPHA experiment compares the two. Antihydrogen atoms bond into H̄₂. Drop in ordinary matter (pick H or O above) and watch it annihilate.',
    build() { baseWorld(46, 32, 300, 0.05); W.wall = 'wrap';
      scatter(14, 46, 32, (x, y) => spawnSpec(SPEC_PBAR, x, y), 3.5);
      scatter(14, 46, 32, (x, y) => spawnSpec({ kind: 'pos' }, x, y), 0); } },
  annihilation: { group: 'Antimatter', name: 'Antiprotons meet water', tool: 'fire', spec: SPEC_PBAR,
    hint: '<b>A droplet of water with a slow antiproton on its way.</b> An atom captures it and it annihilates with a proton or neutron of the nucleus: about 1.9 GeV leaves as pions (orange, labelled π; the neutral ones turn into γ rays within nanometres) and γ rays, a few nucleons are knocked out and the molecule is torn apart. Fire more with the Fire tool. Fast antiprotons first ionize their way through matter, as real ones do.',
    build() { baseWorld(56, 40, 300, 0.05);
      for (let i = 0; i < 7; i++) for (let j = 0; j < 6; j++) addMolecule('H2O', -6 + i * 3.4, -8.5 + j * 3.4, rnd() * 6, 300);
      const pb = spawnSpec(SPEC_PBAR, -24, 0.4, 0)[0]; setMotion(pb, 4, 1, 0);
      OPT.fire.proj = 'pbar'; OPT.fire.s = 300; } },
  isolde: { group: 'Real labs', name: 'CERN ISOLDE: rare isotopes', tool: 'inspect', spec: SPEC_P,
    hint: '<b>CERN’s isotope factory: 1.4 GeV protons from the PS Booster strike a uranium target at 2,000 °C.</b> A proton that hits a uranium nucleus shatters it (spallation, fragmentation, fission) into nuclei far from stability, many found nowhere in nature; the Data tab lists each one made here. ISOLDE’s targets are uranium carbide, kept this hot so that the new atoms diffuse out to be ionized and sorted by mass: each experiment gets a beam of one rare isotope, from over 1,300 made so far. (A real proton crosses centimetres of uranium before it hits a nucleus; here hits are made far more frequent, so that you can watch them.)',
    build() { baseWorld(130, 64, 2273, 0.05);
      for (let i = 0; i < 7; i++) for (let j = 0; j < 9; j++) addAtom('U', 22 + (i - 3) * 2.9 + (j % 2) * 1.45, (j - 4) * 2.52, { A: 238 });
      W.sources.push({ x: -62, y: 0, ux: 1, uy: 0, spec: SPEC_P, KE: 1.4e9, rate: 0.04, acc: 0.8, track: true, jitter: 26 }); } },
  sns: { group: 'Real labs', name: 'Oak Ridge SNS: spallation neutrons', tool: 'inspect', spec: { kind: 'n' },
    hint: '<b>The Spallation Neutron Source in Tennessee: 1 GeV protons into liquid mercury.</b> A proton that hits a mercury nucleus knocks out a spray of neutrons (dashed tracks) and leaves a lighter, often radioactive, nucleus behind; the Data tab counts them. In the real target, a tank of mercury, each proton frees about 20 neutrons. Slowed in water and liquid hydrogen, they go to some twenty instruments that show where the atoms sit in batteries, proteins and magnets: neutrons see light atoms and magnetism that X-rays barely do. (Hits are made far more frequent here, so that you can watch them.)',
    build() { baseWorld(130, 64, 330, 0.05);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 9; j++) addAtom('Hg', 20 + (i - 3.5) * 3.0 + (j % 2) * 1.5, (j - 4) * 2.6, { A: 202 });
      W.sources.push({ x: -62, y: 0, ux: 1, uy: 0, spec: SPEC_P, KE: 1e9, rate: 0.04, acc: 0.8, track: true, jitter: 22 }); } },
  nif: { group: 'Real labs', name: 'Livermore NIF: fusion ignition', tool: 'inspect', spec: D_SPEC,
    hint: '<b>The National Ignition Facility’s fuel capsule as it implodes.</b> 192 lasers heat a gold can (the box); its X-rays blast the capsule’s diamond skin away (carbon, outermost) so fast that everything inside is driven inward at 400 km/s onto deuterium–tritium fuel whose centre is already at 100 million K. Each fusion makes a 3.5 MeV α particle and a 14.1 MeV neutron. In the real capsule, a fraction of a millimetre across, the α particles stop in the fuel and heat it further, and that self-heating is ignition: on 5 December 2022 a shot released 3.15 MJ from 2.05 MJ of laser light. This one is a few nanometres across, so most of them escape, and it is shown 75 times slower than the other setups so that you can follow the implosion: press + to speed it up.',
    build() { baseWorld(76, 60, 1e8, 0); W.simPerFrame = 0.02; // (slow motion: the implosion is over in a few femtoseconds)
      const ring = (n, r0, r1, fn) => { for (let k = 0; k < n; k++) { const r = r0 + (r1 - r0) * rnd(), t = 2 * Math.PI * (k + rnd() * 0.6) / n; fn(r * Math.cos(t), r * Math.sin(t), -Math.cos(t), -Math.sin(t)); } };
      const v = 4e5 / 2.998e8, inward = (p, ux, uy) => { if (p) setMotion(p, 0.5 * p.m * AMU_EV * v * v, ux, uy); }; // 400 km/s, as a fraction of c
      ring(22, 0.5, 5, (x, y) => spawnSpec(D_SPEC, x, y, 1e8)); ring(22, 0.5, 5, (x, y) => spawnSpec(T_SPEC, x, y, 1e8)); // the hot spot
      ring(44, 0.5, 5.5, (x, y) => spawnSpec({ kind: 'e' }, x, y, 1e8));
      ring(26, 7.5, 10.5, (x, y, ux, uy) => inward(spawnSpec(D_SPEC, x, y, 3e5)[0], ux, uy)); ring(26, 7.5, 10.5, (x, y, ux, uy) => inward(spawnSpec(T_SPEC, x, y, 3e5)[0], ux, uy)); // the dense fuel
      ring(52, 7, 11, (x, y) => spawnSpec({ kind: 'e' }, x, y, 3e5));
      ring(28, 12.5, 14.5, (x, y, ux, uy) => inward(addAtom('C', x, y, { T: 300 }), ux, uy)); } }, // what is left of the diamond skin
  dafne: { group: 'Real labs', name: 'Frascati DAΦNE: the φ factory', tool: 'inspect', spec: { kind: 'e' },
    hint: '<b>Italy’s electron–positron collider at Frascati, tuned to make φ mesons.</b> Electrons and positrons at 510 MeV each meet at 1.02 GeV, exactly the φ’s mass, so most collisions make one; it lives 1.5×10⁻²² s and falls apart into kaon pairs (K⁺K⁻ about 49% of the time, K⁰ʟK⁰s 34%) or three pions (15%). Count them in the Data tab. The KLOE experiment used millions of these neutral kaon pairs to study how matter and antimatter differ. DAΦNE’s two rings are 98 m around; here two linacs stand in, since a ring nanometres across cannot hold electrons at this energy (they would radiate it away as synchrotron light).',
    build() { baseWorld(230, 60, 300, 0); W.wall = 'open'; setupCollider('linear', 'ee', 5.1e8); } },
  useries: { group: 'Nuclear', name: 'Uranium-238 decay chain', tool: 'inspect', spec: { kind: 'atom', Z: 92, A: 238 },
    hint: '<b>Six uranium-238 atoms, with decay sped up ×3×10²⁸.</b> ²³⁸U lives 4.5 billion years, then runs through 14 α and β⁻ decays (thorium, radium, radon, polonium…) to stable lead-206. The Log tab lists every step; lower the speed-up under Lab › Time to catch the short-lived members.',
    build() { baseWorld(60, 40, 300, 0.05); W.warp = 3e28; scatter(6, 60, 40, (x, y) => addAtom('U', x, y, { A: 238 }), 8); } },
  flashbyte: { group: 'Electronics', name: 'Flash memory: one byte', tool: 'inspect', tab: 'lab', spec: { kind: 'mol', mol: 'flashcell' },
    hint: '<b>Eight flash cells: one byte of memory.</b> Type a character under Lab › Chips and press Write. Like a real flash chip, it first erases every cell to 1, then programs the cells whose bits are 0: 15 V pulls electrons one at a time through 7 nm of oxide onto each floating gate, where they stay with the power off (that is how a USB stick remembers). The bits read top row first, left to right; click one to flip it.',
    build() { baseWorld(250, 96, 300, 0.5); for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) addMolecule('flashcell', -90 + 60 * c, 21 - 42 * r, 0, 300); } },
  ringosc: { group: 'Electronics', name: 'Ring oscillator: a clock from 3 NOT gates', tool: 'inspect', tab: 'lab', spec: { kind: 'mol', mol: 'inverter' },
    hint: '<b>Three NOT gates wired in a loop.</b> Each inverts the one before it, and an odd loop can never settle: the 1 chases itself round and the gates tick on their own, a few picoseconds a gate. Chip clocks are built from loops like this. The Lab tab gives the frequency. Hold the Heat tool on it: hot transistors switch more weakly, so the clock slows and its swing fades.',
    build() { baseWorld(280, 110, 300, 0.5); const g = [-85, 0, 85].map(x => { addMolecule('inverter', x, -8, 0, 300); return W.chips[W.chips.length - 1]; }); g.forEach((c, i) => { c.label = `Gate ${i + 1}`; c.inFrom = g[(i + 2) % 3]; }); } },
  notchain: { group: 'Electronics', name: 'NOT-gate chain: a signal on its way', tool: 'inspect', tab: 'lab', spec: { kind: 'mol', mol: 'inverter' },
    hint: '<b>Four NOT gates in a row, each driving the next.</b> Flip Gate 1’s input in the Lab tab and watch the change ripple down the chain, a couple of picoseconds a gate. That propagation delay is what limits how fast a chip can run. Four inversions cancel out: the last output follows the first input.',
    build() { baseWorld(340, 100, 300, 0.5); const g = [-120, -40, 40, 120].map(x => { addMolecule('inverter', x, -8, 0, 300); return W.chips[W.chips.length - 1]; }); g.forEach((c, i) => { c.label = `Gate ${i + 1}`; if (i) c.inFrom = g[i - 1]; }); } },
  seu: { group: 'Electronics', name: 'Cosmic rays vs memory: bit flips', tool: 'fire', tab: 'lab', spec: { kind: 'atom', Z: 26, A: 56, bare: true },
    hint: '<b>An SRAM cell holding 1, under a rain of cosmic rays.</b> Fast nuclei cross it from above: protons often, an oxygen nucleus now and then. Each frees electron–hole pairs along its track (one for every 3.6 eV it loses), and the struck side of the cell soaks them up. A proton frees far too few to matter. An oxygen nucleus frees about as many as it takes to tip the cell over, so some of its hits flip the bit: a single-event upset, the soft error radiation causes in real chips, and the reason spacecraft memories correct their own errors. Write it back from the Lab tab, or fire your own: an iron nucleus is loaded.',
    build() { baseWorld(260, 140, 300, 2); W.wall = 'open'; // (open walls: what the rain knocks loose leaves)
      addMolecule('sramcell', 0, -12, 0, 300); const c = W.chips[W.chips.length - 1]; c.v.q = CHIP.VDD; c.v.qb = 0;
      W.sources.push({ x: 0, y: 66, ux: 0, uy: -1, spec: SPEC_P, KE: 2e6, rate: 0.006, acc: 0.5, track: true, jitter: 200 }); // (2 MeV: below silicon's Coulomb barrier, so no nuclear reactions)
      W.sources.push({ x: 0, y: 66, ux: 0, uy: -1, spec: { kind: 'atom', Z: 8, A: 16, bare: true }, KE: 3.2e7, rate: 0.002, acc: 0.6, track: true, jitter: 190 });
      OPT.fire.proj = 'sel'; OPT.fire.s = 1000; } },
  crt: { group: 'Electronics', name: 'Electron gun: an old TV screen', tool: 'magnet', spec: { kind: 'e' },
    hint: '<b>A cathode-ray tube, as in old TVs.</b> An electron gun fires 1 keV electrons across the vacuum at a screen of zinc, which glows blue where the beam lands (zinc’s lines at 468–481 nm; real screens used zinc sulfide). The magnet steers the beam: drag it, or flip its pole, and the spot moves, because the Lorentz force bends each electron into an arc. A real TV swept its spot across the screen 15,000 times a second.',
    build() { baseWorld(220, 110, 300, 0.2); W.wall = 'open';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 32; j++) addAtom('Zn', 90 + i * 2.3, (j - 15.5) * 2.65 + (i % 2) * 1.33);
      W.magnets.push({ x: -25, y: 0, R: 30, B: 2500 });
      W.sources.push({ x: -105, y: 0, ux: 1, uy: 0, spec: { kind: 'e' }, KE: 1000, rate: 0.3, acc: 0.5, track: true, jitter: 1 }); } },
  hotchip: { group: 'Electronics', name: 'Hot chip: leaks, fails, melts', tool: 'heat', tab: 'lab', spec: { kind: 'mol', mol: 'inverter' },
    hint: '<b>A NOT gate, and the Heat tool.</b> Hold the Heat tool on the gate and watch the Lab tab. As the transistors warm, their threshold drops and the one that should be off leaks: the current from the supply climbs a thousandfold by 600 K, and the output sags. Raise the heat past 1,687 K and the silicon melts, and the gate with it. Toggle its input as it heats. Real chips slow themselves down near 100 °C to avoid this.',
    build() { baseWorld(160, 80, 300, 0.3); addMolecule('inverter', 0, -4, 0, 300); OPT.heat.mode = 'heat'; OPT.heat.s = 300; OPT.heat.R = 50; } },
};
/* Challenges: a goal, a starting world and a hint at how; each is a setup in the "Challenges" group, checked as the panels
   refresh. Done ones are remembered in this browser (✓ in the list). */
function chNamed(name) { let n = 0; for (const [, e] of speciesCounts()) if (e.name === name) n += e.n; return n; }
const CHALLENGES = [
  { id: 'water', name: 'Make water', tool: 'spark', goal: 'Turn hydrogen and oxygen into at least 3 water molecules.', how: 'Nothing happens until a bond breaks: click with the Spark tool (or heat a spot). The radicals it makes (H, O, OH) start the chain reactions.',
    build() { PRESETS.combustion.build(); }, done: () => chNamed('Water') >= 3 },
  { id: 'salt', name: 'Make salt', tool: 'heat', goal: 'Get at least 4 sodium ions (Na⁺) and 4 chloride ions (Cl⁻).', how: 'Sodium gives its outer electron to chlorine readily, once the Cl₂ molecules are broken and the atoms meet. Warm them up.',
    build() { baseWorld(46, 34, 300, 0.05); scatter(8, 46, 34, (x, y) => addAtom('Na', x, y), 4); scatter(4, 46, 34, (x, y) => addMolecule('Cl2', x, y, rnd() * 6), 4); },
    done: () => { let a = 0, b = 0; for (const p of W.parts) if (!p.dead && p.k === NUC) { if (p.Z === 11 && p.q >= 0.5) a++; else if (p.Z === 17 && p.q <= -0.5) b++; } return a >= 4 && b >= 4; } },
  { id: 'plasma', name: 'Make a plasma', tool: 'light', goal: 'Ionize at least half of the neon atoms.', how: 'Neon holds its electrons tightly (21.6 eV for the first). Heat it to tens of thousands of kelvin, shine hard ultraviolet with the Light tool, or add a few electrons and an electric field.',
    build() { baseWorld(80, 40, 300, 0.05); scatter(30, 80, 40, (x, y) => addAtom('Ne', x, y), 3.5); }, done: () => measure().ionFrac >= 0.5 },
  { id: 'fuse', name: 'Fuse deuterium', tool: 'fire', goal: 'Make two deuterium nuclei fuse.', how: 'They repel each other until they nearly touch. Heat the gas to around 10⁸ K, or fire deuterons at it with the Fire tool at tens of keV.',
    build() { baseWorld(40, 30, 300, 0.05); scatter(16, 40, 30, (x, y) => addAtom('H', x, y, { A: 2 }), 3); OPT.fire.proj = 'sel'; OPT.fire.s = 650; }, spec: { kind: 'atom', Z: 1, A: 2, bare: true }, done: () => W.count.fusion >= 1 },
  { id: 'split', name: 'Split uranium', tool: 'fire', goal: 'Make a uranium-235 nucleus split in two.', how: 'Fire a neutron (Fire tool) at a uranium atom. A slow one — a fraction of an eV — is far likelier to be captured than a fast one.',
    build() { baseWorld(60, 40, 300, 0.05); scatter(6, 50, 30, (x, y) => addAtom('U', x, y, { A: 235 }), 8); OPT.fire.proj = 'n'; OPT.fire.s = Math.round(100 * (Math.log10(0.025) + 2)); }, done: () => W.count.fission >= 1 },
  { id: 'antiH', name: 'Make antihydrogen', tool: 'place', goal: 'Get a positron to bind to an antiproton: one atom of antihydrogen.', how: 'At 20,000 K they fly past each other. Cool them down with the heat bath, gently.',
    build() { baseWorld(40, 30, 20000, 0.005); W.wall = 'wrap'; scatter(6, 40, 30, (x, y) => spawnSpec(SPEC_PBAR, x, y), 4); scatter(6, 40, 30, (x, y) => spawnSpec({ kind: 'pos' }, x, y), 0); },
    done: () => W.parts.some(p => !p.dead && p.anti && p.k === NUC && p.Z === 1 && p.ne >= 1) },
  { id: 'uv', name: 'Ultraviolet glow', tool: 'place', goal: 'Make the glowing walls give off most of their light in the ultraviolet.', how: 'Wien’s law: the peak of a black body’s light is at 2.9 mm·K ÷ T. Turn the heat bath up until it passes 380 nm, and watch Data → Spectrum.',
    build() { baseWorld(80, 56, 1500, 0.05); W.glow = true; }, done: () => W.glow && W.wall === 'reflect' && 2.8977719e6 / W.T < 380 },
  { id: 'ring', name: 'Build a clock', tool: 'inspect', tab: 'lab', goal: 'Make the three NOT gates tick: an oscillator.', how: 'In the Lab tab, wire each gate’s input to the output of the one before it, round in a loop. An odd number of NOT gates in a loop can never settle.',
    build() { baseWorld(300, 110, 300, 0.5); [-90, 0, 90].forEach(x => addMolecule('inverter', x, -8, 0, 300)); }, done: () => W.chips.some(c => c.key === 'inverter' && c.per > 0) },
  { id: 'flip', name: 'Flip a bit', tool: 'fire', tab: 'lab', goal: 'Flip the bit an SRAM cell holds with a single particle.', how: 'Fire heavy, slow-ish nuclei through the cell (Fire tool: an α particle or heavier, a few MeV). The charge they free along their track must outweigh the node’s.',
    build() { baseWorld(200, 120, 300, 2); W.wall = 'open'; addMolecule('sramcell', 0, -12, 0, 300); const c = W.chips[W.chips.length - 1]; c.v.q = CHIP.VDD; c.v.qb = 0; OPT.fire.proj = 'a'; OPT.fire.s = 870; },
    done: () => W.chips.some(c => c.key === 'sramcell' && c.flips > 0) },
  { id: 'letter', name: 'Write a letter', tool: 'inspect', tab: 'lab', goal: 'Store the letter A in the flash byte.', how: 'In the Lab tab, type into the flash memory panel, or flip the bits one by one: A is 01000001.',
    build() { PRESETS.flashbyte.build(); }, done: () => { const M = flashMemory(); if (M.cells.length < 8 || memBusy()) return false; const d = memDecode(M.cells.map(c => (c.broken ? null : flashStored(c)))); return !!d[0] && d[0].ch === 'A'; } },
  { id: 'melt', name: 'Melt a chip', tool: 'heat', tab: 'lab', goal: 'Heat a NOT gate until it stops working because it melted.', how: 'Silicon melts at 1,687 K. Watch the gate leak first, then fail. Hold the Heat tool on it.',
    build() { PRESETS.hotchip.build(); }, done: () => W.chips.some(c => c.broken && /melted/.test(c.msg)) },
];
const CH = { done: new Set(String(store('challenges') || '').split(',').filter(Boolean)), cur: null, won: false };
for (const c of CHALLENGES) {
  PRESETS['ch_' + c.id] = { group: 'Challenges', get name() { return (CH.done.has(c.id) ? '✓ ' : '') + c.name; }, tool: c.tool, tab: c.tab, spec: c.spec || (c.id === 'antiH' ? SPEC_PBAR : SPEC_P),
    get hint() { return `<b>Challenge ${CHALLENGES.indexOf(c) + 1} of ${CHALLENGES.length}: ${esc(c.goal)}</b> ${esc(c.how)}${CH.done.has(c.id) ? ' <i>(done before)</i>' : ''}`; },
    build() { c.build(); CH.cur = c; CH.won = false; } };
}
function challengeTick() {
  const c = CH.cur;
  if (!c || UI.preset !== 'ch_' + c.id || CH.won) return;
  let ok; try { ok = !!c.done(); } catch (e) { ok = false; }
  if (!ok) return;
  CH.won = true; CH.done.add(c.id); store('challenges', [...CH.done].join(','));
  const n = CH.done.size;
  log('tool', `Challenge complete: ${c.name}! (${n} of ${CHALLENGES.length} done)`);
  $('hintText').innerHTML = `<b>✓ Challenge complete: ${esc(c.name)}!</b> ${n < CHALLENGES.length ? `${n} of ${CHALLENGES.length} done; the next ones are in the setup list under Challenges.` : 'That was the last one: all done.'}`;
  $('hint').hidden = false; $('hint').classList.add('won');
  const v = $('preset').value; buildPresetSelect(); $('preset').value = v;
}
function buildPresetSelect() {
  const groups = {};
  for (const [k, p] of Object.entries(PRESETS)) (groups[p.group] = groups[p.group] || []).push([k, p.name]);
  $('preset').innerHTML = Object.entries(groups).map(([g, items]) => `<optgroup label="${esc(g)}">${items.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</optgroup>`).join('');
  $('preset').onchange = (e) => { undoMark('Load a setup'); loadPreset(e.target.value); e.target.blur(); };
}
function loadPreset(key) {
  if (!REW.restoring) { rewClear(); grClear(); if (R.measure) R.measure.length = 0; } // (a new world: its own past)
  const P = PRESETS[key] || PRESETS.soup;
  UI.preset = key in PRESETS ? key : 'soup';
  $('preset').value = UI.preset;
  R.sel = null; R.selX = null; R.hover = null; R.follow = null; UI.drag = null; W.grab = null; R.msel.clear();
  P.build();
  settleOverlaps();
  UI.baseSpf = W.baseSpf = W.simPerFrame; UI.ach = 1; UI.capped = false;
  W.hist = { t: [], T: [], bath: [] };
  syncCollider(); syncSlowmo();
  UI.spec = P.spec;
  if (!QUICK.some(q => q !== 'sep' && sameSpec(q.spec, P.spec))) UI.customSpec = P.spec;
  buildPalette();
  setTool(P.tool);
  fitView();
  syncLab(); syncSpeed();
  if (P.tab) showTab(P.tab);
  $('hintText').innerHTML = P.hint; $('hint').classList.remove('won'); if (!key.startsWith('ch_')) CH.cur = null;
  $('hint').hidden = !SET.tips;
  store('preset', UI.preset);
  log('tool', `Setup loaded: ${P.name}`);
  renderInspect();
  UI.lastLogSeq = -1;
}

/* ------------------------------------------------------------------ readouts & periodic panel refresh */
/* ------------------------------------------------------------------ chips (chips.js): their controls, in the Lab tab */
const CHIP_UI = { sig: '', text: 'A', err: '' };
function chipName(c) { return c.label || `${CHIP_NAMES[c.key].split(' (')[0]} ${W.chips.filter(x => x.key === c.key).indexOf(c) + 1}`; }
function chipPanelHTML(ch) {
  let h = `<div class="chipbox" data-chip="${ch.id}"><div class="row"><b>${esc(ch.label ? `${ch.label}: ${CHIP_NAMES[ch.key]}` : CHIP_NAMES[ch.key])}</b><span class="val" data-r="T"></span></div>`;
  if (ch.broken) return h + `<p class="note bad">${esc(ch.msg)}</p></div>`;
  if (ch.key === 'transistor') {
    h += `<div class="row"><span>Gate voltage</span><span class="val" data-r="g"></span></div><input type="range" data-k="g" min="0" max="100" value="${Math.round(ch.v.g * 100)}" aria-label="Gate voltage">`;
    h += `<div class="row"><span>Drain voltage</span><span class="val" data-r="d"></span></div><input type="range" data-k="d" min="0" max="100" value="${Math.round(ch.v.d * 100)}" aria-label="Drain voltage">`;
  } else if (ch.key === 'inverter') {
    const others = W.chips.filter(c => c.key === 'inverter' && !c.broken);
    h += ch.inFrom ? `<p class="note">Its input is wired to ${esc(ch.inFrom.label || 'another gate')}’s output.</p>` : `<div class="seg" data-k="in" role="group" aria-label="Input"><button data-v="0">Input 0</button><button data-v="1">Input 1</button></div>`;
    if (others.length > 1 || ch.inFrom) h += `<div class="row"><span>Input wired to</span><select class="select" data-k="wire" aria-label="Wire this gate's input to a gate's output"><option value="">nothing (set by hand)</option>${others.map(c => `<option value="${c.id}"${ch.inFrom === c ? ' selected' : ''}>${esc(chipName(c))}’s output${c === ch ? ' (its own)' : ''}</option>`).join('')}</select></div>`;
  }
  else if (ch.key === 'sramcell') {
    h += `<div class="chipbtns"><button class="btn small" data-op="write" data-arg="0">Write 0</button><button class="btn small" data-op="write" data-arg="1">Write 1</button><button class="btn small" data-op="read">Read</button></div>`;
    h += `<div class="seg" data-k="power" role="group" aria-label="Power"><button data-v="1">Power on</button><button data-v="0">Power off</button></div>`;
  } else if (ch.key === 'flashcell') h += `<div class="chipbtns"><button class="btn small" data-op="program">Program (store 0)</button><button class="btn small" data-op="erase">Erase (store 1)</button><button class="btn small" data-op="read">Read</button></div>`;
  return h + '<p class="note" data-r="st"></p><p class="note" data-r="msg"></p></div>';
}
/* Two or more flash cells make one memory panel: the cells as a row of bits in reading order (click one to flip it),
   and, with eight or more, a character a byte written and read back (chips.js: flashMemory, memWrite, memRead). */
function memPanelHTML(M) {
  const n = M.cells.length;
  let h = `<div class="chipbox" data-mem="1"><div class="row"><b>Flash memory</b><span class="val" data-r="T"></span></div>`;
  h += `<p class="note">${n} flash cells${M.bytes ? ` = ${M.bytes} byte${M.bytes > 1 ? 's' : ''}` : ''}, read top row first, left to right. Click a bit to flip it.</p><div class="membits">`;
  M.cells.forEach((c, i) => { h += `${i && i % 8 === 0 ? '<span class="mgap"></span>' : ''}<button class="mbit" data-cell="${c.id}"><b></b><small></small></button>`; });
  h += '</div>';
  h += M.bytes ? `<div class="memtext"><input type="text" id="memText" maxlength="${M.bytes}" value="${esc(CHIP_UI.text.slice(0, M.bytes))}" aria-label="Character${M.bytes > 1 ? 's' : ''} to store" autocomplete="off" spellcheck="false"><button class="btn small" data-mem="write">Write</button><button class="btn small" data-mem="read">Read</button></div>`
    : `<p class="note">Eight cells make a byte: place ${8 - n} more to store a character.</p>`;
  return h + '<p class="note" data-r="st"></p><p class="note" data-r="msg"></p></div>';
}
function memByteText(b) {
  if (b.code === null) return `${b.bin} (a cell could not be read)`;
  return `${b.bin} = 0x${b.code.toString(16).toUpperCase().padStart(2, '0')} = ${b.ch !== null ? `“${b.ch}”` : b.code === 255 ? 'erased (no character)' : 'no printable character'}`;
}
function updateMem(box, M) {
  const r = (k, t) => { const e = box.querySelector(`[data-r="${k}"]`); if (e) e.textContent = t; };
  const busy = memBusy();
  let T = 0; for (const c of M.cells) T += c.T;
  r('T', fmtT(T / M.cells.length));
  M.cells.forEach((c, i) => {
    const b = box.querySelector(`[data-cell="${c.id}"]`); if (!b) return;
    const v = c.broken ? '×' : flashStored(c), pos = i < 8 * M.bytes ? `Bit ${7 - (i % 8)}${M.bytes > 1 ? ` of byte ${(i >> 3) + 1}` : ''}` : `Cell ${i + 1} (not in a byte)`;
    b.firstChild.textContent = v; b.lastChild.textContent = c.broken ? 'broken' : `${c.nfg} e⁻`;
    b.dataset.v = v; b.classList.toggle('busy', !!c.op); b.disabled = c.broken || busy || !!c.op;
    b.title = c.broken ? `${pos}: broken` : `${pos}: stores ${v} (${c.nfg} electron${c.nfg === 1 ? '' : 's'} on its floating gate). Click to ${v ? 'program it (store 0)' : 'erase it (store 1)'}.`;
  });
  for (const e of box.querySelectorAll('button[data-mem]')) e.disabled = busy;
  const bits = M.cells.map(c => (c.broken ? null : flashStored(c))), bytes = memDecode(bits);
  r('st', bytes.length ? `Stores ${bytes.map(memByteText).join('; ')}. The electrons stay put with the power off.` : `Stores ${bits.map(v => (v === null ? '×' : v)).join('')}.`);
  r('msg', CHIP_UI.err || (W.mem ? W.mem.msg : ''));
}
function updateChips() {
  const g = $('gChips'), M = flashMemory(), multi = M.cells.length > 1;
  const list = W.chips.filter(c => !(multi && c.key === 'flashcell')).slice(0, 12);
  g.hidden = !list.length && !multi;
  if (g.hidden) { CHIP_UI.sig = ''; return; }
  const sig = (multi ? 'm' + M.cells.map(c => c.id + (c.broken ? 'b' : '')).join('.') + '|' : '') + list.map(c => c.id + (c.broken ? 'b' : '') + (c.inFrom ? '<' + c.inFrom.id : '') + (c.label ? ':' + c.label : '')).join();
  if (sig !== CHIP_UI.sig) { CHIP_UI.sig = sig; $('chipPanel').innerHTML = (multi ? memPanelHTML(M) : '') + list.map(chipPanelHTML).join(''); }
  if (multi) { const box = $('chipPanel').querySelector('[data-mem]'); if (box) updateMem(box, M); }
  for (const ch of list) {
    const box = $('chipPanel').querySelector(`[data-chip="${ch.id}"]`); if (!box || ch.broken) continue;
    const r = (k, t) => { const e = box.querySelector(`[data-r="${k}"]`); if (e) e.textContent = t; };
    const v = ch.v, bit = (x) => (x > 0.6 * CHIP.VDD ? 1 : x < 0.4 * CHIP.VDD ? 0 : '½');
    r('T', fmtT(ch.T));
    if (ch.key === 'transistor') {
      const I = Math.abs(ch.devs[0].I);
      r('g', v.g.toFixed(2) + ' V'); r('d', v.d.toFixed(2) + ' V');
      r('st', `Current ${fmtCurrent(I)}: ${I < 1e-9 ? 'off, all but a leak' : I < 5e-6 ? 'partly on' : 'on'}, about ${fmtNum(I / 1.602e-19 * 1e-12, 2)} electrons a picosecond from source to drain.`);
    } else if (ch.key === 'inverter') {
      for (const b of box.querySelectorAll('[data-k="in"] button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(bit(v.in))));
      r('st', `Output ${bit(v.out)} (${v.out.toFixed(2)} V): NOT ${bit(v.in)}. From the supply: ${fmtCurrent(ch.devs[1].I)}, next to nothing once it has switched (that is CMOS).` + (ch.per ? ` It flips every ${(ch.per * 5e11).toFixed(1)} ps: a ${fmtNum(1e-9 / ch.per, 3)} GHz clock.` : ''));
      r('msg', ch.hitMsg || '');
    } else if (ch.key === 'sramcell') {
      for (const b of box.querySelectorAll('[data-k="power"] button')) b.setAttribute('aria-pressed', String(b.dataset.v === (v.vdd > 0.3 ? '1' : '0')));
      r('st', (v.vdd < 0.3 ? `Power off: Q ${v.q.toFixed(2)} V, ¬Q ${v.qb.toFixed(2)} V; the bit is draining away.` : `Holds ${Math.abs(v.q - v.qb) > 0.3 ? (v.q > v.qb ? 1 : 0) : '?'} (Q ${v.q.toFixed(2)} V, ¬Q ${v.qb.toFixed(2)} V)${ch.read !== null && ch.read !== undefined ? `; last read: ${ch.read}` : ''}.`) + (ch.flips ? ` Flipped by radiation ${ch.flips === 1 ? 'once' : ch.flips + ' times'}.` : ''));
      r('msg', ch.msg);
    } else if (ch.key === 'flashcell') {
      const vt = flashVth(ch, Math.max(0.02, CHIP.VTH - 8e-4 * (ch.T - 300)));
      r('st', `Floating gate: ${ch.nfg} electron${ch.nfg === 1 ? '' : 's'}, so the threshold is ${vt.toFixed(2)} V: it stores ${vt > CHIP.V_READ ? 0 : 1}${ch.read !== null && ch.read !== undefined ? `; last read: ${ch.read}` : ''}. The electrons stay with the power off. Place eight to store a character.`);
      r('msg', ch.msg);
    }
  }
}
/* The logic analyser: every chip's signals (chips.js: scopeSample) against chip time, one lane each, as voltages or as
   logic levels (1 above 60 % of the supply, 0 below 40 %, and in between drawn as undecided), with each ring's period. */
const SCOPE_UI = { win: 50e-12, view: 'a', hold: false, at: 0 };
function drawScope() {
  const g = $('gScope'), lanes = [];
  for (const ch of W.chips) {
    const sig = SCOPE_SIG[ch.key]; if (!sig || !ch.scope || ch.broken) continue;
    sig.forEach((s, i) => { if (!(s === 'IN' && ch.inFrom && W.chips.includes(ch.inFrom))) lanes.push({ ch, i, name: `${ch.label || CHIP_NAMES[ch.key].split(' ')[0]} ${s}` }); }); // (an input wired to another gate's output is that output's lane)
  }
  g.hidden = !lanes.length; if (g.hidden) return;
  const show = lanes.slice(0, 12), cv = $('chScope'), LH = 24, want = show.length * LH + 18 + 'px';
  if (cv.style.height !== want) cv.style.height = want;
  const r = chartCtx(cv); if (!r) return; const [ctx, w, h] = r;
  if (!SCOPE_UI.hold) SCOPE_UI.at = W.chipT;
  const t1 = SCOPE_UI.at, t0 = t1 - SCOPE_UI.win, x0 = 80, xs = (t) => x0 + (t - t0) / (t1 - t0) * (w - x0 - 6);
  const fg = cssVar('--fg'), mut = cssVar('--muted'), acc = cssVar('--accent'), warn = cssVar('--warn') || '#d9a400', line = cssVar('--line');
  ctx.font = '10px ' + cssVar('--font-data'); ctx.textBaseline = 'middle';
  // time grid: a line every 10 ps (every 50 ps on the 200 ps view)
  const step = SCOPE_UI.win > 1e-10 ? 5e-11 : SCOPE_UI.win > 3e-11 ? 1e-11 : 5e-12;
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = mut;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) { const x = Math.round(xs(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 14); ctx.stroke(); }
  ctx.fillText(`−${Math.round(SCOPE_UI.win * 1e12)} ps`, x0, h - 6); const nowT = SCOPE_UI.hold ? 'held' : 'now'; ctx.fillText(nowT, w - 6 - ctx.measureText(nowT).width, h - 6);
  show.forEach((L, li) => {
    const sc = L.ch.scope, top = li * LH + 3, bot = top + LH - 6, vdd = CHIP.VDD, y = (v) => bot - clamp(v / vdd, -0.05, 1.05) * (bot - top);
    ctx.fillStyle = fg; ctx.fillText(L.name, 4, (top + bot) / 2, x0 - 8);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, w - x0, h); ctx.clip();
    const n = Math.min(sc.n, SCOPE_N), a = SCOPE_UI.view === 'd';
    ctx.beginPath(); let started = false, prevLvl = null;
    for (let j = n - 1; j >= 0; j--) { // oldest to newest
      const k = (sc.n - 1 - j) % SCOPE_N, t = sc.t[k]; if (t < t0 - 2e-12 || t > t1) continue;
      const v = sc.v[L.i][k], x = xs(t);
      if (a) {
        const lvl = v > 0.6 * vdd ? 1 : v < 0.4 * vdd ? 0 : 0.5, yy = y(lvl * vdd * 0.9 + vdd * 0.05);
        if (!started) { ctx.moveTo(x, yy); started = true; } else { if (lvl !== prevLvl) ctx.lineTo(x, y(prevLvl * vdd * 0.9 + vdd * 0.05)); ctx.lineTo(x, yy); }
        if (lvl === 0.5) { ctx.save(); ctx.fillStyle = warn; ctx.globalAlpha = 0.35; ctx.fillRect(x - 1, top, 2, bot - top); ctx.restore(); }
        prevLvl = lvl;
      } else if (!started) { ctx.moveTo(x, y(v)); started = true; } else ctx.lineTo(x, y(v));
    }
    ctx.strokeStyle = acc; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, bot + 2.5); ctx.lineTo(w - 6, bot + 2.5); ctx.stroke();
  });
  ctx.textBaseline = 'alphabetic';
  const rings = W.chips.filter(c => c.key === 'inverter' && c.per > 0 && !c.broken);
  const hz = (p) => { const f = 1 / p; return f >= 1e12 ? fmtNum(f / 1e12, 2) + ' THz' : fmtNum(f / 1e9, 3) + ' GHz'; };
  $('dScopeNote').textContent = (lanes.length > show.length ? `Showing the first ${show.length} of ${lanes.length} signals. ` : '') +
    (rings.length ? `Clock: ${rings.slice(0, 3).map(c => `${c.label || 'gate'} repeats every ${fmtNum(c.per * 1e12, 3)} ps (${hz(c.per)})`).join('; ')}. ` : '') +
    'Time is chip time, which runs 20 times the atoms\' time.';
}
function chipsInit() {
  bindSeg('segScopeWin', (v) => { SCOPE_UI.win = +v * 1e-12; drawScope(); });
  bindSeg('segScopeView', (v) => { SCOPE_UI.view = v; drawScope(); });
  $('bScopeHold').onclick = (e) => { SCOPE_UI.hold = !SCOPE_UI.hold; e.currentTarget.setAttribute('aria-pressed', String(SCOPE_UI.hold)); e.currentTarget.textContent = SCOPE_UI.hold ? 'Resume' : 'Hold'; drawScope(); };
  for (const k in CHIP_LAYOUT) if (MOLECULES[k]) MOLECULES[k].note += ' Put it in the chamber and it works: its controls are in the Lab tab.';
  if (MOLECULES.flashcell) MOLECULES.flashcell.note += ' Eight of them make a byte: write a character into them there.';
  const panel = $('chipPanel'), byId = (id) => W.chips.find(c => c.id === +id);
  const chipOf = (e) => { const b = e.target.closest('[data-chip]'); return b ? byId(b.dataset.chip) : null; };
  const memGo = (what) => { CHIP_UI.err = (what === 'write' ? memWrite(CHIP_UI.text) : memRead()) || ''; updateChips(); };
  panel.addEventListener('change', (e) => { // wiring: a gate's input to a gate's output (an odd ring of them oscillates)
    if (e.target.dataset.k !== 'wire') return;
    const ch = chipOf(e); if (!ch) return;
    const src = e.target.value ? byId(e.target.value) : null;
    if (src) { let n = 0; for (const c of W.chips) if (c.key === 'inverter') { n++; if (!c.label) c.label = `Gate ${n}`; } }
    ch.inFrom = src || null; if (!src) ch.v.in = ch.v.in > CHIP.VDD / 2 ? CHIP.VDD : 0;
    ch.per = 0; ch.rise = 0;
    log('tool', src ? `${chipName(ch)}’s input wired to ${chipName(src)}’s output` : `${chipName(ch)}’s input unwired`);
    CHIP_UI.sig = ''; updateChips();
  });
  panel.addEventListener('input', (e) => {
    if (e.target.id === 'memText') { CHIP_UI.text = e.target.value; CHIP_UI.err = ''; return; }
    if (e.target.dataset.k === 'wire') return;
    const ch = chipOf(e), k = e.target.dataset.k; if (!ch || !k || ch.broken) return; ch.v[k] = +e.target.value / 100; updateChips();
  });
  panel.addEventListener('keydown', (e) => { if (e.target.id === 'memText' && e.key === 'Enter') { e.preventDefault(); memGo('write'); } });
  panel.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (cell) { CHIP_UI.err = ''; memFlip(byId(cell.dataset.cell)); updateChips(); return; }
    const mb = e.target.closest('button[data-mem]');
    if (mb) { memGo(mb.dataset.mem); return; }
    const ch = chipOf(e); if (!ch || ch.broken) return;
    const op = e.target.closest('[data-op]');
    if (op) { chipOp(ch, op.dataset.op, op.dataset.arg === undefined ? undefined : +op.dataset.arg); updateChips(); return; }
    const b = e.target.closest('.seg button'), k = b && b.closest('.seg').dataset.k;
    if (k === 'in') ch.v.in = b.dataset.v === '1' ? CHIP.VDD : 0;
    else if (k === 'power') chipOp(ch, 'power', +b.dataset.v);
    updateChips();
  });
}
function updateReadouts() {
  const m = measure();
  const n = W.parts.reduce((s, p) => s + (p.dead ? 0 : 1), 0);
  $('roT').innerHTML = `${esc(m.atoms || m.n ? fmtT(m.T) : '—')} <span class="set">${W.gamma ? '→ ' + esc(fmtT(W.T)) : 'insulated'}</span>`;
  $('roTime').textContent = fmtTime(W.t * PHYS.TU_S);
  $('roN').textContent = String(n);
  $('roNuc').textContent = !W.decayOn ? 'paused' : W.warp > 1.0001 ? fmtFactor(W.warp) : 'real';
  $('pausedBadge').hidden = UI.running;
  if (UI.tab === 'lab') { $('magCount').textContent = W.magnets.length ? `${W.magnets.length} magnet${W.magnets.length > 1 ? 's' : ''} placed` : 'No magnets placed'; setTxt('spdVal', motionText()); }
  updateCollider();
  if (W.chips.length || CHIP_UI.sig) updateChips();
  if (UI.tab === 'lab') drawScope();
  if (CH.cur) challengeTick();
  if (SET.narr) narrTick(); else if (!$('narr').hidden) $('narr').hidden = true;
  if (UI.capped) syncSpeed(); // (the speed reached at the computer's limit changes as it goes)
}
function updatePanel() {
  if (UI.tab === 'inspect') { if (R.sel && R.sel.dead) R.sel = null; renderInspect(); }
  else if (UI.tab === 'data') renderData();
  else if (UI.tab === 'log') renderLog();
}
function histTick(now) {
  if (now - UI.lastHist < 250) return;
  UI.lastHist = now;
  const H = W.hist.bath ? W.hist : (W.hist = { t: [], T: [], bath: [] });
  const m = measure();
  if (!m.atoms && !m.n) return;
  H.t.push(W.t); H.T.push(Math.max(m.T, 0.01)); H.bath.push(W.gamma ? W.T : 0);
  if (H.t.length > 300) { H.t.shift(); H.T.shift(); H.bath.shift(); }
}

/* ------------------------------------------------------------------ main loop */
const FRAME_AIM_MS = 1000 / 60 - 0.4; // a frame's worth at 60 fps: the simulation gets what the drawing and panels leave of it
/* Settings' priority, smooth ↔ fast: the frame rate the budget aims for. Above the smooth end, a frame may run longer —
   down to this rate — while the simulation is behind the speed it is set to; once it keeps up, frames stay short. */
const PRIO_FPS = [60, 50, 40, 30, 20], PRIO_NAME = ['smooth: aims for 60 fps', 'leaning smooth: frames down to 50 fps', 'balanced: frames down to 40 fps', 'leaning fast: frames down to 30 fps', 'fast: frames down to 20 fps to keep the set speed'];
/* Particle trails: how long they last (Settings), and by which clock (render.js drawTracks). */
function trailWindow() { const s = SET.trail || 0.5; return SET.trailClock === 'sim' ? s * 60 * (UI.baseSpf || W.simPerFrame) : s; }
function trailSim() { return SET.trailClock === 'sim'; }
function frameAim() { return 1000 / PRIO_FPS[SET.prio || 0] - 0.4; }
function frameCap(room) { return (SET.prio || 0) > 0 ? Math.max(UI.budget, room) : UI.budget; } // (past the smooth end the physics may take the room the aim leaves, beyond Physics per frame)
function frame(now) {
  if (SET.fpsCap > 0) { // Settings → Graphics: a frame-rate cap (frames skipped, the time between them still counted)
    const iv = 1000 / SET.fpsCap;
    if (now < (UI.nextDue || 0) - 0.75) { requestAnimationFrame(frame); return; }
    UI.nextDue = Math.max(now, (UI.nextDue || 0) + iv);
  }
  const realDt = Math.min(0.1, Math.max(0, (now - UI.last) / 1000));
  if (UI.menu) mmTick(realDt);
  viewTick(realDt);
  UI.last = now; UI.vis += realDt; UI.fps = UI.fps ? 0.95 * UI.fps + 0.05 / Math.max(1e-3, realDt) : 60;
  UI.fpsN = (UI.fpsN || 0) + 1; // (the frame-rate counter: frames counted over half a second)
  // the frame's phases are timed; the worst frame of each badge period is shown with where its time went (a stutter's trail)
  const FP = UI.fp || (UI.fp = { sim: 0, draw: 0, ui: 0, worst: 0, worstTxt: '', shown: '' });
  if (now - (UI.fpsT || 0) >= 500) {
    if (UI.fpsT) {
      UI.fpsNow = UI.fpsN * 1000 / (now - UI.fpsT);
      FP.shown = FP.worst > 40 ? ` · worst ${FP.worst.toFixed(0)} ms (${FP.worstTxt})` : '';
      if (SET.fps) $('fpsBadge').textContent = Math.round(UI.fpsNow) + ' fps' + (TH.used > 1 ? ` · ${TH.used} threads` : '') + (UI.running ? ` · sim ${(FP.simAvg || 0).toFixed(1)} draw ${(FP.drawAvg || 0).toFixed(1)} ms` : '') + FP.shown;
      FP.worst = 0;
    }
    UI.fpsT = now; UI.fpsN = 0;
  }
  const tf0 = performance.now(); let tf1 = tf0, tf2 = tf0;
  try {
    if (UI.running || UI.stepOnce) {
      // the simulation's budget for this frame: Settings' figure at most, less when the drawing and the panels of the last
      // frames would not leave a 60 fps frame otherwise (the step that overshoots the budget is allowed for too)
      const room = frameAim() - (FP.drawAvg || 0) - (FP.uiAvg || 0) - (FP.stepAvg || 0);
      const sped = W.simPerFrame > UI.baseSpf * 1.01, cap = sped ? Math.max(14, frameCap(room)) : frameCap(room); // (sped up: at least 14 ms, never less than Settings gives)
      const budget = Math.max(3, Math.min(cap, room));
      FP.budget = budget;
      const r = simFrame(UI.running ? realDt : 1 / 60, budget);
      if (r.steps > 0) FP.stepAvg = 0.8 * (FP.stepAvg || 0) + 0.2 * ((performance.now() - tf0) / r.steps);
      if (UI.running) {
        UI.ach = 0.92 * (UI.ach || 1) + 0.08 * Math.min(1, r.simAdv / Math.max(1e-12, r.target));
        const adv60 = r.simAdv / (r.fr || 1); // (per sixtieth of a second: what the Motion setting means, whatever the frame rate)
        UI.adv = UI.adv > 0 ? Math.exp(0.85 * Math.log(UI.adv) + 0.15 * Math.log(Math.max(1e-12, adv60))) : adv60; // (smoothed, for the Motion readout)
        const capped = UI.ach < 0.8, slow = r.slow < 0.6;
        if (capped !== !!UI.capped || slow !== !!UI.slow) { UI.capped = capped; UI.slow = slow; syncSpeed(); }
        if ((W.slowHold ? 2 : 0) + (autoSlowOn() && !W.slowHold ? 1 : 0) !== (UI.smShown || 0)) syncSlowmo(); // (the hourglass follows the automatic slow motion)
      }
      UI.stepOnce = false;
      toolTick(realDt);
      histTick(now);
      if (now - (UI.lastAuto || 0) > 20000) { UI.lastAuto = now; autosave(); }
      rewTick(now); grTick(now);
    }
    tf1 = performance.now();
    if (R.follow) { if (R.follow.dead) R.follow = null; else { R.cx = R.follow.x; R.cy = R.follow.y; } } // (Follow, from the quick menu)
    render(W.rt);
    if (REC.on) recCapture();
    tf2 = performance.now();
  } catch (err) { console.error(err); }
  if (now - UI.lastUI > 250) { UI.lastUI = now; updateReadouts(); if (!$('setModal').hidden) settingsStats(); }
  if (now - UI.lastPanel > 450) { UI.lastPanel = now; updatePanel(); }
  else if (UI.tab === 'inspect' && UI.running) drawInspectBohr();
  if (UI.tab === 'inspect') qDraw(realDt);
  const tf3 = performance.now(), total = tf3 - tf0, gap = tf0 - (UI.lastFrameEnd || tf0); // (gap: time between frames not spent here — the browser, or a stall elsewhere)
  UI.lastFrameEnd = tf3;
  FP.sim = tf1 - tf0; FP.draw = tf2 - tf1; FP.ui = tf3 - tf2;
  FP.drawAvg = 0.9 * (FP.drawAvg || FP.draw) + 0.1 * FP.draw; FP.uiAvg = 0.9 * (FP.uiAvg || FP.ui) + 0.1 * FP.ui; FP.simAvg = 0.9 * (FP.simAvg || FP.sim) + 0.1 * FP.sim; // (smoothed: what the next frame's budget allows for)
  const worstNow = Math.max(total, gap);
  const heap = performance.memory ? performance.memory.usedJSHeapSize : 0, freed = (FP.heap || 0) - heap; FP.heap = heap; // (Chromium: a heap that shrank by megabytes marks a garbage collection)
  if (worstNow > FP.worst) { FP.worst = worstNow; FP.worstTxt = (gap > total ? `${gap.toFixed(0)} ms between frames` : `sim ${FP.sim.toFixed(0)}, draw ${FP.draw.toFixed(0)}, panels ${FP.ui.toFixed(0)}`) + (freed > 2e6 ? `, memory cleanup freed ${(freed / 1e6).toFixed(0)} MB` : ''); }
  requestAnimationFrame(frame);
}
function setRunning(r) {
  UI.running = r;
  $('icoPause').style.display = r ? '' : 'none';
  $('icoPlay').style.display = r ? 'none' : '';
  $('bPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
  $('bPlay').title = r ? 'Pause (Space)' : 'Play (Space)';
  $('pausedBadge').hidden = r;
}

/* ------------------------------------------------------------------ display mode */
/* As in a game's display settings (Settings → Display), three things chosen apart:
   - the window: windowed, or borderless full screen (F11). The desktop app's window goes borderless over its monitor
     (Tauri setFullscreen, a borderless window as games make it, not exclusive: Alt+Tab, the Windows key and other
     monitors work as usual); a browser uses its full screen, which a frame may refuse;
   - chamber only (B; Esc leaves it): the chamber alone, edge to edge, no toolbar or panels;
   - the cursor hidden while the mouse rests over the chamber: never, in chamber only, or always.
   Every key and tool works as before. */
const DM = { on: false, timer: 0, fs: false, win: 'windowed' };
const tauriWin = () => { const tw = window.__TAURI__ && window.__TAURI__.window; return tw && tw.getCurrentWindow ? tw.getCurrentWindow() : null; };
function setChamberOnly(on) {
  on = !!on;
  if (DM.on === on) return;
  DM.on = on;
  document.body.classList.toggle('display', on);
  $('bDisplay').setAttribute('aria-pressed', String(on));
  if ($('setChamber')) $('setChamber').checked = on;
  if (on) closeQuickMenu();
  dmPoke();
  log('tool', on ? 'Chamber only: B or Esc to bring the panels back' : 'Panels back');
}
const setDisplayMode = setChamberOnly; // (the name the 0.52 tests know)
/* The window: 'windowed' or 'borderless'. Called from a click or a key (a browser grants full screen only then), and
   at start in the desktop app if it was left borderless. */
function setWindowMode(mode) {
  const full = mode === 'borderless';
  DM.win = full ? 'borderless' : 'windowed';
  const w = tauriWin();
  try {
    if (w) Promise.resolve(w.setFullscreen(full)).catch(() => {});
    else if (full) { const el = document.documentElement; if (!document.fullscreenElement && document.fullscreenEnabled && el.requestFullscreen) el.requestFullscreen().then(() => { DM.fs = true; }, () => { DM.win = 'windowed'; syncWinSeg(); }); else if (!document.fullscreenElement) DM.win = 'windowed'; }
    else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch (err) { DM.win = 'windowed'; }
  if (!full) DM.fs = false;
  if (w && SET.win !== DM.win) { SET.win = DM.win; store('settings', JSON.stringify(SET)); } // (kept for the next start in the desktop app; a browser cannot start in full screen)
  syncWinSeg();
}
function syncWinSeg() { if ($('segWin')) setSegValue('segWin', DM.win); }
const cursorHides = () => SET.cursor === 'always' || (SET.cursor === 'chamber' && DM.on);
function dmPoke() {
  document.body.classList.remove('idle'); clearTimeout(DM.timer);
  if (cursorHides()) DM.timer = setTimeout(() => { if (!cursorHides()) return; if (UI.drag) dmPoke(); else document.body.classList.add('idle'); }, 2000);
}
function bindDisplayMode() {
  $('bDisplay').onclick = () => setChamberOnly(!DM.on);
  $('bDisplayExit').onclick = () => setChamberOnly(false);
  for (const ev of ['pointermove', 'pointerdown', 'wheel']) window.addEventListener(ev, () => dmPoke(), { passive: true });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && DM.fs) { DM.fs = false; DM.win = 'windowed'; syncWinSeg(); } }); // (the browser's own Esc)
  if (tauriWin() && SET.win === 'borderless') setWindowMode('borderless');
  dmPoke();
}

/* ------------------------------------------------------------------ measure, views, long press */
/* Measure (K): the distance between two atoms, the angle at the middle of three (render.js drawMeasure draws them). */
function measureDist(a, b) { let dx = b.x - a.x, dy = b.y - a.y; if (W.wall === 'wrap') [dx, dy] = minImg(dx, dy); return Math.hypot(dx, dy); }
function measureAngle(a, b, c) { let ax = a.x - b.x, ay = a.y - b.y, cx = c.x - b.x, cy = c.y - b.y; if (W.wall === 'wrap') { [ax, ay] = minImg(ax, ay); [cx, cy] = minImg(cx, cy); } return Math.acos(clamp((ax * cx + ay * cy) / (Math.hypot(ax, ay) * Math.hypot(cx, cy) || 1), -1, 1)) * 180 / Math.PI; }
function measureText() {
  const m = (R.measure || []).filter(p => !p.dead); if (m.length < 2) return '';
  let t = `${fmtA(measureDist(m[0], m[1]))}`;
  if (m.length >= 3) t += ` and ${fmtA(measureDist(m[1], m[2]))}; angle ${measureAngle(m[0], m[1], m[2]).toFixed(1)}°`;
  return t;
}
/* Camera views: Shift+1 … 9 keeps where the view is, 1 … 9 goes back there (kept in this browser). */
function viewsGet() { try { const v = JSON.parse(store('views') || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
function viewSave(n) { const v = viewsGet(); v[n] = [R.s, R.cx, R.cy]; store('views', JSON.stringify(v)); log('tool', `View ${n} kept (press ${n} to come back to it)`); }
function viewGo(n) {
  const c = viewsGet()[n]; if (!Array.isArray(c) || !c.every(Number.isFinite)) { log('tool', `No view ${n} yet: Shift+${n} keeps the one you see`); return; }
  R.follow = null; VIEWGO.from = [R.s, R.cx, R.cy]; VIEWGO.to = c; VIEWGO.t = 0; // (a short glide there)
}
const VIEWGO = { from: null, to: null, t: 1 };
function viewTick(dt) {
  if (VIEWGO.t >= 1 || !VIEWGO.to) return;
  VIEWGO.t = Math.min(1, VIEWGO.t + dt / 0.35); const k = 1 - Math.pow(1 - VIEWGO.t, 3), [s0, x0, y0] = VIEWGO.from, [s1, x1, y1] = VIEWGO.to;
  R.s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * k); R.cx = x0 + (x1 - x0) * k; R.cy = y0 + (y1 - y0) * k;
}
/* Touch and pen: a long press (half a second, held still) opens the quick menu there, as a right-click does; if the
   press had already changed the world (placed an atom …), that is taken back first. */
const LP = { t: 0, id: -1, x: 0, y: 0, undo: -1 };
function lpStart(e, px, py) {
  clearTimeout(LP.t); if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  LP.id = e.pointerId; LP.x = px; LP.y = py; LP.undo = UNDO.back.length;
  LP.t = setTimeout(() => {
    if (UI.pointers.size !== 1) return;
    endToolAction();
    if (UNDO_TOOLS.has(UI.tool) && UNDO.back.length > 0 && UNDO.back.length === LP.undo) { const sn = UNDO.back.pop(); UNDO.size -= sn.n; undoRestore(sn); }
    UI.drag = { kind: 'none' }; openQuickMenu(LP.x, LP.y);
  }, 520);
}
function lpMove(e, px, py) { if (e.pointerId === LP.id && Math.hypot(px - LP.x, py - LP.y) > 10) clearTimeout(LP.t); }
function lpEnd() { clearTimeout(LP.t); }

/* ------------------------------------------------------------------ rewind */
/* Rewind (, or the ⟲ button; Settings → General): while it runs, the world is kept every so often (rewEvery seconds of
   watching) as a compact copy (typed arrays of what a saved world holds: the particles, their motion, the bonds, the
   conditions), as far back as set and within a memory limit. The timeline drags back through them, the simulation
   paused; Play from here carries on from that moment (what came after is dropped, and Ctrl+Z goes back to before the
   rewind); Back to now puts it as it was. Light and unstable particles in flight are not kept, and a setup with chips,
   beams, lasers or a ramp keeps none (undoOK). */
const REW = { snaps: [], bytes: 0, last: 0, open: false, i: 0, now: null, wasRun: false, restoring: false, pend: -1 };
function rewPack() {
  const d = worldToJSON(), n = d.parts.length, I = new Int16Array(n * 5), F = new Float64Array(n * 4), K = [];
  for (let j = 0; j < n; j++) { const q = d.parts[j]; I.set([q[0], q[1], q[2], q[3], q[4]], j * 5); F.set([q[5], q[6], q[7], q[8]], j * 4); if (q.length > 9) K.push(j, q[9]); }
  const B = new Int32Array(d.bonds.length * 3); d.bonds.forEach((b, j) => B.set(b, j * 3));
  const meta = Object.assign({}, d); delete meta.parts; delete meta.bonds;
  return { t: W.t, rt: performance.now(), meta, I, F, K: Float64Array.from(K), B, bytes: I.byteLength + F.byteLength + B.byteLength + K.length * 8 + 600 };
}
function rewUnpack(sn) {
  const d = Object.assign({}, sn.meta), n = sn.I.length / 5, parts = new Array(n), ke = new Map();
  for (let j = 0; j < sn.K.length; j += 2) ke.set(sn.K[j], sn.K[j + 1]);
  for (let j = 0; j < n; j++) { const a = [sn.I[j * 5], sn.I[j * 5 + 1], sn.I[j * 5 + 2], sn.I[j * 5 + 3], sn.I[j * 5 + 4], sn.F[j * 4], sn.F[j * 4 + 1], sn.F[j * 4 + 2], sn.F[j * 4 + 3]]; if (ke.has(j)) a.push(ke.get(j)); parts[j] = a; }
  const bonds = []; for (let j = 0; j < sn.B.length; j += 3) bonds.push([sn.B[j], sn.B[j + 1], sn.B[j + 2]]);
  d.parts = parts; d.bonds = bonds; return d;
}
function rewRestore(sn) {
  const cam = [R.s, R.cx, R.cy], sel = R.measure, hist = W.hist; REW.restoring = true;
  try { const r = worldFromJSON(rewUnpack(sn)); if (typeof r === 'string') log('tool', 'Rewind: ' + r); } finally { REW.restoring = false; }
  W.t = sn.t; [R.s, R.cx, R.cy] = cam; if (sel) sel.length = 0; W.hist = hist; updateReadouts(); // (the view, and the temperature history, stay)
}
function rewClear() { REW.snaps.length = 0; REW.bytes = 0; if (REW.open) rewClose(false); }
function rewTrim() {
  const keep = Math.max(2, Math.round(SET.rewSpan / SET.rewEvery)), cap = SET.rewMem * 1048576;
  while (REW.snaps.length > keep || (REW.bytes > cap && REW.snaps.length > 1)) REW.bytes -= REW.snaps.shift().bytes;
}
function rewTick(now) {
  if (!SET.rewOn || UI.menu || REW.open || !UI.running || now - REW.last < SET.rewEvery * 1000) return;
  REW.last = now;
  if (!undoOK()) { if (REW.snaps.length) rewClear(); return; }
  const sn = rewPack(); REW.snaps.push(sn); REW.bytes += sn.bytes; rewTrim();
}
function rewNote() {
  const n = REW.snaps.length, span = n > 1 ? (REW.snaps[n - 1].rt - REW.snaps[0].rt) / 1000 : 0;
  return !SET.rewOn ? 'Off: nothing is kept.' : !undoOK() ? 'This setup keeps none: its chips, beams, lasers or ramp cannot be put back.' : `Now: ${n} snapshots, ${span.toFixed(0)} s back, ${(REW.bytes / 1048576).toFixed(1)} MB.`;
}
function rewOpen() {
  if (REW.open) return;
  if (!SET.rewOn) { log('tool', 'Rewind is off (Settings → General)'); return; }
  if (!undoOK()) { log('tool', 'Rewind keeps nothing in this setup: its chips, beams, lasers or ramp cannot be put back'); return; }
  if (!REW.snaps.length) { log('tool', 'Nothing kept yet to rewind to: it keeps the world while it runs'); return; }
  REW.wasRun = UI.running; setRunning(false); REW.now = rewPack(); REW.open = true; REW.i = REW.snaps.length;
  const sl = $('rewSlider'); sl.max = String(REW.snaps.length); sl.value = String(REW.i);
  $('rewBar').hidden = false; $('stage').classList.add('rewinding'); rewLabel();
}
function rewGo(i) {
  if (!REW.open) return;
  i = clamp(Math.round(i), 0, REW.snaps.length); if (i === REW.i) return;
  REW.i = i; $('rewSlider').value = String(i); rewRestore(i === REW.snaps.length ? REW.now : REW.snaps[i]); rewLabel();
}
function rewStep(d) { if (REW.open) rewGo(REW.i + d); }
function rewLabel() {
  const i = REW.i, sn = i === REW.snaps.length ? REW.now : REW.snaps[i], ago = (REW.now.rt - sn.rt) / 1000;
  $('rewT').textContent = i === REW.snaps.length ? 'now' : `−${ago.toFixed(ago < 10 ? 1 : 0)} s · ${fmtTime(sn.t * PHYS.TU_S)}`;
  $('rewBack').disabled = i <= 0; $('rewFwd').disabled = i >= REW.snaps.length; $('rewPlay').disabled = i === REW.snaps.length;
}
function rewClose(restoreNow) {
  if (!REW.open) return;
  if (restoreNow && REW.i !== REW.snaps.length) rewRestore(REW.now);
  REW.open = false; $('rewBar').hidden = true; $('stage').classList.remove('rewinding');
}
function rewLive() { const run = REW.wasRun; rewClose(true); setRunning(run); }
function rewCommit(resume = true) { // carry on from the moment shown
  if (!REW.open) return;
  if (REW.i < REW.snaps.length) {
    const d = rewUnpack(REW.now), sn = { d, t: REW.now.t, cam: [R.s, R.cx, R.cy], label: 'Rewind', n: d.parts.length * 60 + 200 }; // (Ctrl+Z: back to before it)
    UNDO.back.push(sn); UNDO.size += sn.n; UNDO.fwd.length = 0;
    for (let j = REW.i + 1; j < REW.snaps.length; j++) REW.bytes -= REW.snaps[j].bytes;
    REW.snaps.length = REW.i + 1; log('tool', `Rewound ${$('rewT').textContent.split(' ·')[0].replace('−', '')} and carried on from there`);
  }
  REW.open = false; $('rewBar').hidden = true; $('stage').classList.remove('rewinding'); REW.last = performance.now();
  { let k = GR.t.length; while (k > 0 && GR.t[k - 1] > W.t) k--; const cut = GR.t.length - k; if (cut > 0) { GR.t.length = k; GR.rt.length = k; for (const c in GR.cols) GR.cols[c].length = k; for (const [, o] of GR.sp) o.v.length = k; } } // (the graph, from there too)
  if (W.hist && W.hist.t) { const H = W.hist; let k = H.t.length; while (k > 0 && H.t[k - 1] > W.t) k--; H.t.length = k; H.T.length = k; H.bath.length = k; }
  if (resume) setRunning(true);
}
function rewInit() {
  $('bRewind').onclick = () => (REW.open ? rewLive() : rewOpen());
  $('rewSlider').addEventListener('input', (e) => { REW.pend = +e.target.value; requestAnimationFrame(() => { if (REW.pend >= 0) { const v = REW.pend; REW.pend = -1; rewGo(v); } }); });
  $('rewBack').onclick = () => rewStep(-1); $('rewFwd').onclick = () => rewStep(1);
  $('rewPlay').onclick = () => rewCommit(); $('rewLive').onclick = () => rewLive();
}

/* ------------------------------------------------------------------ the Data tab's graph */
/* Every half second of watching while it runs: the temperatures, the counts, the pressure, the energy ledger and
   how many there are of each species; the quantities chosen are drawn as strips, and all of it exports as CSV. */
const GR = { t: [], rt: [], cols: {}, sp: new Map(), last: 0, max: 2400 };
const GR_FIX = [['T', 'Temperature', (v) => fmtT(v)], ['Te', 'Electron temperature', (v) => fmtT(v)], ['n', 'Particles', (v) => Math.round(v).toLocaleString('en-US')],
  ['freeE', 'Free electrons', (v) => Math.round(v).toLocaleString('en-US')], ['ion', 'Ionized atoms', (v) => (100 * v).toFixed(1) + '%'], ['P', 'Wall pressure', (v) => fmtSI(v, 'N/m', 2)],
  ['chem', 'Chemical heat released', (v) => fmtE(v)], ['nuc', 'Nuclear energy released', (v) => fmtE(v)], ['esc', 'Energy escaped', (v) => fmtE(v)]];
function grClear() { GR.t.length = 0; GR.rt.length = 0; GR.cols = {}; GR.sp = new Map(); }
function grSel() { try { const a = JSON.parse(store('graphSel') || 'null'); return Array.isArray(a) ? a : ['T', 'n']; } catch (e) { return ['T', 'n']; } }
function grTick(now) {
  if (!UI.running || UI.menu || now - GR.last < 500) return;
  GR.last = now;
  const m = measure(), sp = speciesCounts(), L = W.ledger; let mols = 0; for (const [, e] of sp) mols += e.n;
  let P = NaN; try { const pr = wallPressure(mols, m.T); if (pr && pr.ok) P = pr.P; } catch (e) { /* (no walls) */ }
  const row = { T: m.T, Te: m.Te, n: W.parts.reduce((a, p) => a + (p.dead ? 0 : 1), 0), freeE: m.freeE || 0, ion: m.ionFrac, P, chem: L.chem, nuc: L.nuc, esc: L.escaped };
  const k = GR.t.length; GR.t.push(W.t); GR.rt.push(now / 1000);
  for (const [c] of GR_FIX) (GR.cols[c] || (GR.cols[c] = new Array(k).fill(NaN))).push(row[c]);
  for (const [key, e] of sp.slice(0, 16)) if (!GR.sp.has(key)) GR.sp.set(key, { name: e.name, col: e.col, v: new Array(k).fill(0) });
  const now2 = new Map(sp.map(([key, e]) => [key, e.n]));
  for (const [key, o] of GR.sp) o.v.push(now2.get(key) || 0);
  if (GR.t.length > GR.max) { const cut = GR.t.length - GR.max; GR.t.splice(0, cut); GR.rt.splice(0, cut); for (const c in GR.cols) GR.cols[c].splice(0, cut); for (const [, o] of GR.sp) o.v.splice(0, cut); }
}
function grSeries() { // [id, label, values, fmt, colour]
  const out = GR_FIX.filter(([c]) => GR.cols[c] && GR.cols[c].some(Number.isFinite)).map(([c, l, f]) => [c, l, GR.cols[c], f, null]);
  for (const [key, o] of [...GR.sp].sort((a, b) => b[1].v[b[1].v.length - 1] - a[1].v[a[1].v.length - 1]).slice(0, 10)) out.push(['sp:' + key, key + (o.name ? ' (' + o.name + ')' : ''), o.v, (v) => Math.round(v).toLocaleString('en-US'), o.col]);
  return out;
}
function drawGraph() {
  const all = grSeries(), sel = grSel(), chosen = all.filter(s => sel.includes(s[0]));
  const box = $('gSel'), sig = all.map(s => s[0]).join('|') + '#' + sel.join('|');
  if (box.dataset.sig !== sig) { box.dataset.sig = sig; box.innerHTML = all.map(([id, l]) => `<button data-g="${esc(id)}" aria-pressed="${sel.includes(id)}">${esc(l)}</button>`).join(''); }
  const cv = $('chG'), rows = Math.max(1, chosen.length); cv.style.height = (rows * 64 + 6) + 'px';
  const r = chartCtx(cv); if (!r) return; const [ctx, w, h] = r, n = GR.t.length;
  $('gNote').textContent = n ? `${n.toLocaleString('en-US')} points over ${fmtTime((GR.t[n - 1] - GR.t[0]) * PHYS.TU_S)}` : '';
  if (n < 2 || !chosen.length) { ctx.fillStyle = cssVar('--muted'); ctx.font = '12px ' + cssVar('--font-ui'); ctx.fillText(n < 2 ? 'Collecting while it runs …' : 'Pick something to plot', 10, 20); return; }
  const rh = (h - 6) / rows, fx = (i) => 6 + i / (n - 1) * (w - 12), pal = ['--hot', '--accent', '--good', '--warn'];
  chosen.forEach(([id, label, v, fmt, col], k) => {
    const y0 = 3 + k * rh; let lo = Infinity, hi = -Infinity; for (const x of v) if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    if (!Number.isFinite(lo)) return; if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) { lo -= 1; hi += 1; }
    const fy = (x) => y0 + rh - 6 - (x - lo) / (hi - lo) * (rh - 22);
    ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1; if (k) { ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke(); }
    ctx.strokeStyle = col || cssVar(pal[k % pal.length]); ctx.lineWidth = 1.6; ctx.beginPath(); let on = false;
    for (let i = 0; i < n; i++) { if (!Number.isFinite(v[i])) { on = false; continue; } const x = fx(i), y = fy(v[i]); if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; } }
    ctx.stroke();
    ctx.fillStyle = cssVar('--fg'); ctx.font = '600 11px ' + cssVar('--font-ui'); ctx.textAlign = 'left'; ctx.fillText(label, 8, y0 + 13);
    ctx.fillStyle = cssVar('--muted'); ctx.font = '11px ' + cssVar('--font-data'); ctx.textAlign = 'right';
    const last = [...v].reverse().find(Number.isFinite); ctx.fillText(`${fmt(last)}   (${fmt(lo)} – ${fmt(hi)})`, w - 8, y0 + 13); ctx.textAlign = 'left';
  });
}
function grCsv() {
  const n = GR.t.length; if (!n) { log('tool', 'Nothing recorded yet for the graph'); return; }
  const fix = GR_FIX.filter(([c]) => GR.cols[c]), sp = [...GR.sp];
  const q = (x) => '"' + String(x).replace(/"/g, '""') + '"';
  const head = ['simulated time (s)', 'watching time (s)', ...fix.map(([, l]) => l + ({ T: ' (K)', Te: ' (K)', P: ' (N/m)', chem: ' (eV)', nuc: ' (eV)', esc: ' (eV)', ion: ' (fraction)' }[fix.find(f => f[1] === l)[0]] || '')), ...sp.map(([k, o]) => k + (o.name ? ' ' + o.name : ''))].map(q).join(',');
  const lines = [head];
  for (let i = 0; i < n; i++) lines.push([(GR.t[i] * PHYS.TU_S).toExponential(6), (GR.rt[i] - GR.rt[0]).toFixed(2), ...fix.map(([c]) => (Number.isFinite(GR.cols[c][i]) ? +GR.cols[c][i].toPrecision(7) : '')), ...sp.map(([, o]) => o.v[i])].join(','));
  fileSave(`atom-forge-${(UI.preset || 'world').replace(/[^a-z0-9-]/gi, '')}-graph.csv`, lines.join('\n') + '\n', 'text/csv').then((ok) => { if (ok) log('tool', `Graph exported: ${n} rows, ${lines[0].split(',').length} columns`); });
}
function grInit() {
  $('gSel').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; const id = b.dataset.g, sel = grSel(), i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id); store('graphSel', JSON.stringify(sel.slice(-6))); drawGraph(); };
  $('gCsv').onclick = () => grCsv(); $('gClr').onclick = () => { grClear(); drawGraph(); };
}

/* ------------------------------------------------------------------ the tour */
const TOUR = [
  ['#stage', 'The chamber', 'Everything here follows real physics: atoms, electrons, nuclei and light. Scroll to zoom, drag with the right button to move around.'],
  ['.tools-wrap', 'Tools', 'Place, grab, select, push and pull, fire, heat, spark, magnets, light, erase, measure, inspect. The letter under each is its key.'],
  ['#paletteBar', 'What to place', 'Pick a particle, an element or a molecule here; Elements… and Molecules… have the rest, every isotope included.'],
  ['.transport', 'Time', 'Play and pause (Space), one frame at a time (.), reload, slower and faster down to 1/256×, and slow motion. ⟲ rewinds (,): drag back through the last minute.'],
  ['#preset', 'Experiments', 'Ready-made setups, from water and salt to a chain reaction, a collider and challenges.'],
  ['.panel .tabs', 'The lab panel', 'Lab sets the conditions (temperature, fields, walls); Inspect shows anything you click; Data has graphs and counts; Log tells what happened; Physics explains how it works.'],
  ['#bSettings', 'Settings and keys', 'Settings has graphics, display, controls and more. Esc opens the menu, ? lists every key, Ctrl+Z undoes.'],
];
const TS = { i: 0 };
function tourStart() { if (UI.menu) return; TS.i = 0; $('tour').hidden = false; tourShow(); }
function tourEnd() { $('tour').hidden = true; store('toured', '1'); }
function tourShow() {
  const [sel, title, text] = TOUR[TS.i], el = document.querySelector(sel);
  if (!el || !el.getBoundingClientRect().width) { if (TS.i < TOUR.length - 1) { TS.i++; tourShow(); } else tourEnd(); return; }
  const r = el.getBoundingClientRect(), pad = 6, hole = $('tourHole').style;
  hole.left = (r.left - pad) + 'px'; hole.top = (r.top - pad) + 'px'; hole.width = (r.width + 2 * pad) + 'px'; hole.height = (r.height + 2 * pad) + 'px';
  $('tourStep').textContent = `${TS.i + 1} of ${TOUR.length}`; $('tourTitle').textContent = title; $('tourText').textContent = text;
  $('tourBack').disabled = TS.i === 0; $('tourNext').textContent = TS.i === TOUR.length - 1 ? 'Done' : 'Next';
  const c = $('tourCard'), ui = SET.ui || 1, cw = c.offsetWidth * ui, ch = c.offsetHeight * ui, W0 = innerWidth, H0 = innerHeight;
  let x = r.right + 16, y = r.top; // (beside it if there is room, else below, else above, else inside)
  if (x + cw > W0 - 8) { x = r.left - cw - 16; } if (x < 8) { x = clamp(r.left, 8, W0 - cw - 8); y = r.bottom + 14; if (y + ch > H0 - 8) y = r.top - ch - 14; if (y < 8) y = clamp(r.top + 20, 8, H0 - ch - 8); }
  y = clamp(y, 8, H0 - ch - 8);
  c.style.left = (x / ui) + 'px'; c.style.top = (y / ui) + 'px';
  $('tourNext').focus();
}
function tourInit() {
  $('tourNext').onclick = () => { if (TS.i >= TOUR.length - 1) tourEnd(); else { TS.i++; tourShow(); } };
  $('tourBack').onclick = () => { if (TS.i > 0) { TS.i--; tourShow(); } };
  $('tourSkip').onclick = () => tourEnd();
  window.addEventListener('resize', () => { if (!$('tour').hidden) tourShow(); });
}

/* ------------------------------------------------------------------ lengths, undo, autosave, menus */
let L_UNIT = 'A'; // Settings → General: lengths in Å, nm or pm (fmtA)
function fmtA(a, digits) { const [f, u] = L_UNIT === 'nm' ? [0.1, ' nm'] : L_UNIT === 'pm' ? [100, ' pm'] : [1, ' Å'], v = a * f; return (digits === undefined ? (Math.abs(v) >= 100 ? fmtNum(v, 4) : v.toPrecision(3)) : v.toFixed(digits)) + u; }
function syncNWall() {
  $('nWallRow').hidden = W.wall !== 'reflect'; setSegValue('segNWall', W.nWall || 'reflect');
  $('nWallNote').textContent = { reflect: 'They scatter back in, as off a reflector of graphite or beryllium: a chain reaction keeps its neutrons.', absorb: 'They are captured in the wall, as in boron or cadmium (the energy goes into the wall): a chain reaction loses them at the edges.', pass: 'They fly straight out, as through any thin wall (their energy leaves with them): only what they hit on the way in counts.' }[W.nWall || 'reflect'];
}
function viewFlagsSave() { store('viewflags', JSON.stringify(R.view)); }
/* Undo and redo (Ctrl+Z; Ctrl+Shift+Z or Ctrl+Y): before each change made by hand (a tool pressed on the chamber, a
   paste, a deletion, a setup loaded …) the world is kept as a saved world (worldToJSON) with its clock and view; undo
   puts it back as it was then. Light and unstable particles in flight are not kept. A setup with chips, beams, lasers
   or a temperature ramp cannot be saved that way, so there undo is off. */
const UNDO = { back: [], fwd: [], size: 0 };
const UNDO_MAX = 40, UNDO_CHARS = 60e6;
function undoOK() { return !W.chips.length && !W.collider && !(W.lasers && W.lasers.length) && !W.ramp && !UI.menu; }
function undoSnap(label) { const d = worldToJSON(); return { d, txt: null, t: W.t, cam: [R.s, R.cx, R.cy], label, n: d.parts.length * 60 + 200 }; }
function undoMark(label) {
  if (!undoOK()) { UNDO.back.length = 0; UNDO.fwd.length = 0; UNDO.size = 0; return; }
  const sn = undoSnap(label); UNDO.back.push(sn); UNDO.size += sn.n; UNDO.fwd.length = 0;
  while (UNDO.back.length > UNDO_MAX || (UNDO.size > UNDO_CHARS && UNDO.back.length > 1)) UNDO.size -= UNDO.back.shift().n;
}
function undoRestore(sn) {
  const run = UI.running, sel = null;
  const r = worldFromJSON(sn.d); if (typeof r === 'string') { log('tool', 'Undo: ' + r); return false; }
  W.t = sn.t; [R.s, R.cx, R.cy] = sn.cam; R.sel = sel; setRunning(run); updateReadouts();
  return true;
}
function undoStep(dir) {
  const from = dir < 0 ? UNDO.back : UNDO.fwd, to = dir < 0 ? UNDO.fwd : UNDO.back;
  if (!undoOK()) { log('tool', 'Undo is off in this setup: its chips, beams, lasers or ramp cannot be put back'); return; }
  const sn = from.pop(); if (!sn) { log('tool', dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); return; }
  UNDO.size -= sn.n;
  const cur = undoSnap(sn.label); to.push(cur); UNDO.size += cur.n;
  if (undoRestore(sn)) log('tool', `${dir < 0 ? 'Undone' : 'Redone'}: ${sn.label}`);
}
/* Autosave (Settings → General): the chamber kept as it is every 20 s while it runs and whenever the page is left, for
   Continue in the main menu or Start with → Where I left off. A setup with chips or beams is kept as its name, to start
   afresh. */
function autosave() {
  if (!SET.autosave || UI.menu || !UI.started) return;
  try {
    const d = undoOK() ? worldToJSON() : { app: 'Atom Forge', fresh: true, preset: UI.preset };
    d.t = W.t; d.cam = [R.s, R.cx, R.cy]; d.preset = UI.preset; d.savedAt = Date.now();
    const txt = JSON.stringify(d);
    if (txt.length > 4.5e6) return; // (over what browser storage holds: the last one that fitted stays)
    store('autosave', txt);
  } catch (e) { /* (storage full or off) */ }
  optSave();
}
function autosaved() { try { const d = JSON.parse(store('autosave') || 'null'); return d && d.app === 'Atom Forge' ? d : null; } catch (e) { return null; } }
function restoreAutosave() {
  const d = autosaved(); if (!d) return false;
  if (d.fresh) { if (PRESETS[d.preset]) loadPreset(d.preset); return true; }
  const r = worldFromJSON(d); if (typeof r === 'string') return false;
  if (Number.isFinite(d.t)) W.t = d.t;
  if (Array.isArray(d.cam) && d.cam.every(Number.isFinite)) [R.s, R.cx, R.cy] = d.cam;
  UI.preset = typeof d.preset === 'string' ? d.preset : UI.preset; syncPresetSelect();
  setRunning(true); log('tool', 'Carried on where you left off');
  return true;
}
function syncPresetSelect() { const sel = $('preset'); if (sel && [...sel.options].some(o => o.value === UI.preset)) sel.value = UI.preset; }
/* Tools remember their settings (Settings → Controls). */
function optSave() { if (SET.keepOpt) store('opt', JSON.stringify(OPT)); }
function optLoad() {
  if (!SET.keepOpt) return;
  let o = null; try { o = JSON.parse(store('opt') || 'null'); } catch (e) { o = null; }
  if (!o || typeof o !== 'object') return;
  for (const t in OPT) if (o[t] && typeof o[t] === 'object') for (const k in OPT[t]) if (typeof o[t][k] === typeof OPT[t][k] && (typeof o[t][k] !== 'number' || Number.isFinite(o[t][k]))) OPT[t][k] = o[t][k];
}
/* Pause when the window is not in front (Settings → Controls), and carry on when it is. */
function blurPause(away) {
  if (!SET.pauseBlur) return;
  if (away && UI.running && !UI.menu) { UI.blurPaused = true; setRunning(false); }
  else if (!away && UI.blurPaused) { UI.blurPaused = false; setRunning(true); }
}
/* Keyboard shortcuts (?) */
const KEYS = [['Simulation', [['Space', 'Play / pause'], ['.', 'One frame'], ['R', 'Reload the setup'], ['[ / ]', 'Slower / faster'], ['\\', 'Slow motion'], [',', 'Rewind: back a step'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z, Ctrl+Y', 'Redo']]],
  ['View', [['+ / −, wheel', 'Zoom'], ['0', 'Fit the box'], ['1 … 9', 'Go to a kept view'], ['Shift+1 … 9', 'Keep this view'], ['V', 'Particle view'], ['O', 'Orbitals'], ['B', 'Chamber only'], ['F11', 'Borderless full screen'], ['Esc', 'Menu (or leave chamber only, drop the selection)']]],
  ['Selection', [['Ctrl+C / Ctrl+V', 'Copy / paste'], ['Ctrl+A', 'Select all'], ['Delete', 'Delete the selected particle']]],
  ['Help', [['?', 'This list'], ['Shift+F10, menu key', 'Quick menu at the mouse'], ['Long press', 'Quick menu (touch, pen)']]]];
function openKeys() {
  const tools = TOOLS.filter(t => t.key && t.key.length === 1).map(t => [t.key, t.name]);
  $('keysList').innerHTML = [['Tools', tools], ...KEYS].map(([h, rows]) => `<h4>${esc(h)}</h4>` + rows.map(([k, d]) => `<div><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')).join('');
  showModal('keysModal');
}
/* Quit: the desktop app closes (the chamber is kept first, for Continue); a browser tab can only be closed by hand. */
function quitApp() {
  autosave();
  const w = tauriWin();
  if (w) { Promise.resolve(w.close()).catch(() => {}); return; }
  const n = UI.menu ? $('mmNote') : $('escNote'); if (n) n.textContent = 'In a browser, close the tab to quit: the chamber is kept for next time.';
}
/* The Esc menu: the game paused while it is open. */
function openEscMenu() {
  UI.escRun = UI.running; setRunning(false);
  $('escQuit').hidden = !tauriWin(); $('escNote').textContent = '';
  showModal('escModal');
}
function closeEscMenu(resume = true) { hideModal('escModal'); if (resume && UI.escRun) setRunning(true); UI.escRun = false; }
function escAction(a) {
  if (a === 'resume') closeEscMenu();
  else if (a === 'settings') { closeEscMenu(); openSettings(); }
  else if (a === 'keys') { closeEscMenu(); openKeys(); }
  else if (a === 'tour') { closeEscMenu(); tourStart(); }
  else if (a === 'gallery') { closeEscMenu(); $('bGallery').click(); }
  else if (a === 'share') { closeEscMenu(); $('bShare').click(); }
  else if (a === 'menu') { closeEscMenu(false); showMainMenu(); }
  else if (a === 'quit') quitApp();
}
/* The main menu: at start (Settings → General) and from the Esc menu. A setup runs behind it, the chamber alone. */
const MM_BG = ['neon', 'combustion', 'oven', 'water', 'soup'];
function showMainMenu() {
  if (!UI.menu) autosave();
  UI.menu = true; R.menu = true; document.body.classList.add('menu'); closeQuickMenu();
  for (const id of ['setModal', 'escModal', 'keysModal', 'galModal', 'shareModal']) if (!$(id).hidden) hideModal(id);
  const keep = store('preset'), bg = MM_BG.filter(k => PRESETS[k]);
  loadPreset(bg[Math.floor(Math.random() * bg.length)] || 'empty');
  if (keep) store('preset', keep); // (the setup behind the menu is not the one to start with next time)
  $('hint').hidden = true; $('narr').hidden = true; W.slowmo = false; setRunning(true); fitView();
  if (R.w > 700) { R.s *= 0.9; R.cx -= Math.min(0.2 * R.w, 260) / R.s; } // (the setup off to the right of the menu)
  MMP.base = [R.s, R.cx, R.cy]; MMP.t = 0; $('mainMenu').classList.remove('out'); $('mainMenu').classList.remove('in'); void $('mainMenu').offsetWidth; $('mainMenu').classList.add('in');
  $('mmContinue').hidden = !autosaved(); $('mmQuit').hidden = !tauriWin(); $('mmNote').textContent = '';
  $('mmSetups').hidden = true; $('mmBtns').hidden = false; $('mainMenu').hidden = false;
  W.slowmo = store('slowmo') !== '0';
  const f = $('mmBtns').querySelector('.btn:not([hidden])'); if (f) f.focus();
}
function hideMainMenu() {
  if (!UI.menu) return;
  UI.menu = false; R.menu = false; document.body.classList.remove('menu'); UNDO.back.length = 0; UNDO.fwd.length = 0; UNDO.size = 0;
  if (!store('toured') && !window.AF_NO_MENU) setTimeout(tourStart, 700); // (the first time: a short tour)
  const m = $('mainMenu'); // (it fades and falls back into the chamber; the panels are there at once)
  if (MMP.still) { m.hidden = true; return; }
  m.classList.remove('in'); m.classList.add('out'); clearTimeout(MMP.outT); MMP.outT = setTimeout(() => { if (!UI.menu) { m.hidden = true; m.classList.remove('out'); } }, 260);
}
/* The main menu's depth: three layers — the chamber far behind, a glow between, the title and buttons in front — that
   the camera looks at slightly from where the mouse is (the chamber shifts least, the buttons most, and the card tilts
   toward it); with no mouse it sways slowly on its own. Off with Reduce motion (the system setting). */
const MMP = { mx: 0, my: 0, x: 0, y: 0, t: 0, last: 0, base: null, still: false };
function mmTick(dt) {
  if (!UI.menu || !MMP.base) return;
  MMP.t += dt;
  const idle = performance.now() - MMP.last > 2500, tx = idle ? 0.35 * Math.sin(MMP.t * 0.37) : MMP.mx, ty = idle ? 0.25 * Math.sin(MMP.t * 0.29 + 1) : MMP.my;
  const k = 1 - Math.exp(-dt * (idle ? 1.2 : 5));
  MMP.x += (tx - MMP.x) * k; MMP.y += (ty - MMP.y) * k;
  if (MMP.still) return;
  const [s0, cx0, cy0] = MMP.base, z = 1 + 0.025 * (Math.abs(MMP.x) + Math.abs(MMP.y)) / 2;
  R.s = s0 * z; R.cx = cx0 + MMP.x * 0.035 * R.w / R.s; R.cy = cy0 - MMP.y * 0.035 * R.h / R.s; // (far away: it moves a little)
  const st = $('mainMenu').style;
  st.setProperty('--mx', MMP.x.toFixed(4)); st.setProperty('--my', MMP.y.toFixed(4));
}
function mmSetups() {
  const groups = new Map();
  for (const [k, p] of Object.entries(PRESETS)) { if (!p.name || k === 'ai') continue; const g = p.group || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([k, p.name]); }
  let i = 0; $('mmList').innerHTML = [...groups].map(([g, list]) => `<h4>${esc(g)}</h4>` + list.map(([k, n]) => `<button data-mmp="${esc(k)}" style="--i:${Math.min(i++, 14)}">${esc(n)}</button>`).join('')).join('');
  $('mmBtns').hidden = true; $('mmSetups').hidden = false; $('mmList').scrollTop = 0;
}
function mmAction(a) {
  if (a === 'continue') { hideMainMenu(); if (!restoreAutosave()) loadPreset('empty'); }
  else if (a === 'empty') { hideMainMenu(); loadPreset('empty'); syncPresetSelect(); setRunning(true); }
  else if (a === 'setups') mmSetups();
  else if (a === 'back') { $('mmSetups').hidden = true; $('mmBtns').hidden = false; }
  else if (a === 'gallery') $('bGallery').click();
  else if (a === 'settings') openSettings();
  else if (a === 'quit') quitApp();
}
function menusInit() {
  MMP.still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('mainMenu').addEventListener('pointermove', (e) => { MMP.mx = clamp(2 * e.clientX / innerWidth - 1, -1, 1); MMP.my = clamp(2 * e.clientY / innerHeight - 1, -1, 1); MMP.last = performance.now(); });
  $('mainMenu').addEventListener('pointerleave', () => { MMP.mx = 0; MMP.my = 0; });
  for (const [i, b] of [...document.querySelectorAll('#mmBtns .btn')].entries()) b.style.setProperty('--i', i);
  $('mmVer').textContent = (/\d+\.\d+\.\d+/.exec(document.title) || [''])[0];
  $('mainMenu').addEventListener('click', (e) => {
    const p = e.target.closest('[data-mmp]'); if (p) { hideMainMenu(); loadPreset(p.dataset.mmp); syncPresetSelect(); setRunning(true); return; }
    const b = e.target.closest('[data-mm]'); if (b) mmAction(b.dataset.mm);
  });
  $('escModal').addEventListener('click', (e) => { if (e.target.id === 'escModal') { closeEscMenu(); return; } const b = e.target.closest('[data-esc]'); if (b) escAction(b.dataset.esc); });
  $('keysClose').onclick = () => hideModal('keysModal');
  $('keysModal').addEventListener('click', (e) => { if (e.target.id === 'keysModal') hideModal('keysModal'); });
  window.addEventListener('blur', () => blurPause(true)); window.addEventListener('focus', () => blurPause(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { autosave(); blurPause(true); } else blurPause(false); });
  window.addEventListener('pagehide', () => autosave());
  $('toolopts').addEventListener('change', () => optSave());
  // the panel's inner edge: drag to make it wider or narrower (Settings → Display)
  const sp = document.createElement('div'); sp.className = 'psplit'; sp.title = 'Drag to resize the panel'; $('panel').appendChild(sp);
  sp.addEventListener('pointerdown', (e) => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('on');
    const main = document.querySelector('.main').getBoundingClientRect(), ui = SET.ui || 1, gap = 10;
    const move = (ev) => {
      const w = SET.side === 'left' ? (ev.clientX - main.left) / ui : (main.right - ev.clientX) / ui;
      SET.pw = clamp(Math.round(w - gap / 2), 280, 760); document.documentElement.style.setProperty('--pw', SET.pw + 'px');
    };
    const up = () => { sp.classList.remove('on'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); store('settings', JSON.stringify(SET)); syncSettings(); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
}

/* ------------------------------------------------------------------ keyboard */
function onKey(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (QM.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeQuickMenu(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); qmMove(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab' || e.key === 'Shift') return; // (the focused item's own keys)
    closeQuickMenu();
  }
  if (e.key === 'F11') { e.preventDefault(); setWindowMode(DM.win === 'borderless' ? 'windowed' : 'borderless'); return; }
  if (e.key === 'Escape') {
    if (!$('escModal').hidden) { e.preventDefault(); closeEscMenu(); return; }
    for (const id of ['ptModal', 'molModal', 'bldModal', 'nucModal', 'setModal', 'shareModal', 'askModal', 'galModal', 'keysModal']) if (!$(id).hidden) { hideModal(id); return; }
    if (UI.menu) { if (!$('mmSetups').hidden) mmAction('back'); return; }
    if (!$('tour').hidden) { tourEnd(); return; }
    if (REW.open) { rewLive(); return; }
    if (DM.on) { e.preventDefault(); setChamberOnly(false); return; }
    if (UI.pasting) { cancelPaste(); return; }
    if (UI.drag) { if (W.tool) W.tool.active = false; W.grab = null; UI.drag = null; R.overlay = null; return; }
    if (R.sel || R.selX || R.msel.size) { R.sel = null; R.selX = null; R.follow = null; renderInspect(); if (R.msel.size) clearSelection(); return; }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { e.target.blur(); return; } // (Esc in a field leaves the field)
    e.preventDefault(); openEscMenu(); return; // (nothing else to let go of: the Esc menu)
  }
  if (UI.menu || ['ptModal', 'molModal', 'bldModal', 'nucModal', 'setModal', 'shareModal', 'askModal', 'galModal', 'escModal', 'keysModal'].some(id => !$(id).hidden)) return;
  if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (tag === 'SELECT' || tag === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey) { // copy, paste, select all: the selection (or the inspected particle)
    const kk = e.key.toLowerCase();
    if (kk === 'c' && tag !== 'INPUT') { e.preventDefault(); copySelection(); return; }
    if (kk === 'v' && tag !== 'INPUT') { e.preventDefault(); armPaste(); return; }
    if (kk === 'a' && tag !== 'INPUT') { e.preventDefault(); selectAll(); return; }
    if (kk === 'z' && tag !== 'INPUT') { e.preventDefault(); undoStep(e.shiftKey ? 1 : -1); return; }
    if (kk === 'y' && tag !== 'INPUT') { e.preventDefault(); undoStep(1); return; }
    return;
  }
  if (e.altKey) return;
  const k = e.key;
  if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) { // the keyboard's menu key: the quick menu at the pointer
    e.preventDefault();
    const m = UI.mouse, inside = m && m[0] >= 0 && m[1] >= 0 && m[0] <= R.w && m[1] <= R.h;
    openQuickMenu(inside ? m[0] : R.w / 2, inside ? m[1] : R.h / 2); return;
  }
  if (k === ' ') { if (tag === 'BUTTON') return; e.preventDefault(); if (REW.open) { rewCommit(); return; } setRunning(!UI.running); return; }
  if (k === '.') { UI.stepOnce = true; return; }
  if (k === '[') { stepSpeed(-1); return; }
  if (k === ']') { stepSpeed(1); return; }
  if (k === '\\') { toggleSlowmo(); return; }
  if (k === '+' || k === '=') { zoomAt(R.w / 2, R.h / 2, 1.25); return; }
  if (k === '-' || k === '_') { zoomAt(R.w / 2, R.h / 2, 0.8); return; }
  if (k === '0') { fitView(); return; }
  if ((k === 'Delete' || k === 'Backspace') && R.msel.size) { deleteSelection(); return; }
  if ((k === 'Delete' || k === 'Backspace') && R.sel) { undoMark('Delete'); kill(R.sel); R.sel = null; renderInspect(); return; }
  if (tag === 'INPUT') return; // range sliders keep their arrow keys and letters stay safe
  if (k === 'v' || k === 'V') { toggleParticleView(); return; }
  if (k === 'b' || k === 'B') { setChamberOnly(!DM.on); return; }
  if (k === '?') { e.preventDefault(); openKeys(); return; }
  if (/^Digit[1-9]$/.test(e.code || '')) { const n = e.code.slice(5); e.preventDefault(); if (e.shiftKey) viewSave(n); else viewGo(n); return; }
  if (k === ',') { e.preventDefault(); rewOpen(); rewStep(-1); return; }
  if (k === 'o' || k === 'O') { toggleOrbitalView(); return; }
  const up = k.toUpperCase();
  if (up === 'R') { loadPreset(UI.preset); return; }
  const t = TOOLS.find(t => t.key === up);
  if (t) setTool(t.id);
}

/* ------------------------------------------------------------------ settings
   Kept in this browser. Performance mode sets the speed settings together: room for 12,000 particles, drawing at
   standard resolution, no glows; each can still be changed on its own. */
const SET_DEF = { maxParts: 4000, res: 'sharp', budget: 10, effects: true, theme: 'system', tunit: 'K', tips: true, fps: true, threads: 'auto', gl: 'gl', apiKey: '', apiModel: '', prio: 0, trail: 0.5, trailClock: 'real', narr: false, win: 'windowed', cursor: 'chamber',
  fpsCap: 0, atomScale: 1, labels: 'always', badges: 'always', flashLow: false, cvd: false, ui: 1, side: 'right', pw: 356, wheel: 1, zoomTo: 'cursor', keepOpt: true, pauseBlur: false, start: 'menu', autosave: true, eunit: 'eV', lunit: 'A', rewOn: true, rewSpan: 60, rewEvery: 0.5, rewMem: 250 };
const SET_PERF = { maxParts: 12000, res: 'standard', budget: 10, effects: false };
const SET_OK = { maxParts: [2000, 4000, 8000, 12000, 20000], res: ['sharp', 'standard', 'fast'], budget: [6, 10, 16, 24], theme: ['system', 'light', 'dark'], tunit: ['K', 'C', 'F'], threads: ['auto', '1', '2', '4', '8', '16'], gl: ['gl', '2d'], prio: [0, 1, 2, 3, 4], trail: [0.5, 1.5, 4], trailClock: ['real', 'sim'] , win: ['windowed', 'borderless'], cursor: ['never', 'chamber', 'always'] , fpsCap: [0, 30, 60, 120, 144], atomScale: [1, 0.7, 0.45], labels: ['always', 'hover', 'never'], badges: ['always', 'hover', 'never'], ui: [0.9, 1, 1.1, 1.25, 1.5], side: ['right', 'left'], wheel: [0.5, 1, 2], zoomTo: ['cursor', 'centre'], start: ['menu', 'last', 'setup'], eunit: ['eV', 'kJ', 'kcal'], lunit: ['A', 'nm', 'pm'] , rewSpan: [30, 60, 120, 300], rewEvery: [0.25, 0.5, 1, 2], rewMem: [100, 250, 500, 1000] };
const SET = Object.assign({}, SET_DEF);
const perfOn = () => Object.keys(SET_PERF).every(k => SET[k] === SET_PERF[k]);
const setOk = (k, v) => typeof v === typeof SET_DEF[k] && (!SET_OK[k] || SET_OK[k].includes(v));
function settingsLoad() {
  let o = null;
  try { o = JSON.parse(store('settings') || 'null'); } catch (e) { o = null; }
  if (o && typeof o === 'object') {
    for (const k in SET_DEF) if (setOk(k, o[k])) SET[k] = o[k];
    const pp = o.prePerf; // what performance mode replaced, to put back when it is turned off
    if (pp && typeof pp === 'object' && Object.keys(SET_PERF).every(k => setOk(k, pp[k]))) SET.prePerf = pp;
  }
}
function applySettings() {
  setMaxParts(SET.maxParts);
  if (MAX_PARTS < 8000 && OPT.place.count > 20) OPT.place.count = 20; // (100 at a click only with room for them)
  const dm = SET.res === 'sharp' ? 2 : SET.res === 'standard' ? 1 : 0.75;
  if (R.dprMax !== dm) { R.dprMax = dm; if (R.w) rResize(R.w, R.h); }
  R.lite = !SET.effects;
  GL.on = SET.gl !== '2d'; // (the WebGL layer for atoms and bonds; Canvas 2D for everything when off or unavailable)
  UI.budget = SET.budget;
  if (SET.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = SET.theme;
  T_UNIT = SET.tunit;
  if (!SET.tips) $('hint').hidden = true;
  $('fpsBadge').hidden = !SET.fps;
  threadsSet(SET.threads === 'auto' ? threadsDefault() : +SET.threads - 1); // (workers besides the main thread)
  R.as = SET.atomScale; R.lblMode = SET.labels === 'hover' ? 'hover' : 'always'; R.badges = SET.badges; R.flashK = SET.flashLow ? 0.3 : 1;
  if (R.cvd !== SET.cvd) { R.cvd = SET.cvd; elColorsReset(); }
  const rs = document.documentElement.style; rs.setProperty('--ui', String(SET.ui)); rs.setProperty('--pw', clamp(Math.round(SET.pw) || 356, 280, 760) + 'px');
  document.body.classList.toggle('panel-left', SET.side === 'left');
  E_UNIT = SET.eunit; L_UNIT = SET.lunit;
}
/* What the threads row says: whether this page can use workers at all, and how many are in use. */
function threadsNote() {
  const nwk = TH.wasmOn.filter(Boolean).length, workers = TH.n ? ` (${nwk === TH.n ? 'all' : nwk + ' of ' + TH.n} workers too)` : '';
  const kernel = (WK.ready ? (WK.use ? ` Force kernel: WebAssembly${workers}.` : ' Force kernel: JavaScript (WebAssembly off).') : WK.on ? ` Force kernel: JavaScript (WebAssembly ${WK.note}).` : ' Force kernel: JavaScript.') + ` Drawing: ${GL.ok && GL.on ? 'WebGL 2 for the atoms and bonds' : GL.note || 'Canvas 2D'}.`;
  if (!threadsAvailable()) return 'One thread: this page is not cross-origin isolated, so the browser allows no shared memory. The desktop app runs the pair forces on all your processor\u2019s threads.' + kernel;
  const c = navigator.hardwareConcurrency || '?';
  if (!TH.n) return `One thread (this computer has ${c}).` + kernel;
  return `${TH.n + 1} threads of ${c}${TH.state === 'starting' ? ', starting up' : TH.used ? ', in use: the forces, the heat bath, the integration and the neighbour list' : ' (used once a world is big enough: the small ones run on one thread)'}.` + kernel;
}
/* The benchmark: four reference worlds, each built and stepped here under the settings as they are (the water worlds
   hold as many atoms as Settings → Max particles allows, the drawing runs at the set resolution and effects, the physics
   on the set budget and threads), with the time of a step and where it goes, then a second of real frames (the adaptive
   budget, the drawing) and what that allows. Replaces the current setup (it is reloaded afterwards). */
const BENCH = { busy: false, rows: [] };
function benchStart() {
  if (BENCH.busy) return;
  BENCH.busy = true; BENCH.rows = [];
  const out = $('setBenchOut'), wasRunning = UI.running, preset = UI.preset;
  setRunning(false);
  const NW = Math.min(MAX_PARTS, 20000), asp = 560 / 360, bw = Math.round(Math.sqrt(16.8 * NW * asp)), bh = Math.round(bw / asp); // (the 12,000-atom world's density, 560 × 360 Å)
  const nk = (n) => n.toLocaleString('en-US');
  const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const scen = [
    [`${nk(NW)} atoms of water, ${bw} × ${bh} Å`, () => { baseWorld(bw, bh, 300, 0.05); const nx = Math.round(Math.sqrt(NW / 3 * asp)), ny = Math.ceil(NW / 3 / nx), dx = bw / nx, dy = bh / ny;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (W.parts.length + 3 > NW) break; addMolecule('H2O', -bw / 2 + (i + 0.5) * dx + (Math.random() - 0.5) * 0.4, -bh / 2 + (j + 0.5) * dy + (Math.random() - 0.5) * 0.4, Math.random() * 6, 300); } settleOverlaps(); }],
    [`${nk(NW)} atoms of water put down with the Place tool, ${bw} × ${bh} Å`, () => { // (100 molecules a click at random places, as the tool does it)
      baseWorld(bw, bh, 300, 0.05);
      const spec = { kind: 'mol', mol: 'H2O' };
      for (let k = 0; k < 600 && W.parts.length + 3 <= NW; k++) { placeSpec(spec, (Math.random() - 0.5) * (bw - 20), (Math.random() - 0.5) * (bh - 20), 100); if (k % 20 === 19) { W.dt = chooseDt(); step(W.dt); } } }],
    ['Liquid water, 40 molecules ionized', () => { PRESETS.water.build(); settleOverlaps(); const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40; i++) userIonize(Os[i]); }],
    ['Flash memory: one byte', () => { PRESETS.flashbyte.build(); settleOverlaps(); }],
  ];
  const realRandom = Math.random;
  const show = (busy) => { out.textContent = `Settings: up to ${nk(MAX_PARTS)} particles, ${SET.res} drawing${SET.effects ? ' with effects' : ''}, ${SET.budget} ms of physics a frame, priority ${PRIO_FPS[SET.prio || 0]} fps, ${GL.ok && GL.on ? 'WebGL' : 'Canvas 2D'}, threads ${SET.threads}${WK.ready && WK.use ? ', WebAssembly kernel' : ''}. ` + BENCH.rows.join(' · ') + (busy ? (BENCH.rows.length ? ' · ' : '') + busy : ''); };
  let k = 0;
  const next = () => {
    if (k >= scen.length) {
      Math.random = realRandom; loadPreset(preset); setRunning(wasRunning); BENCH.busy = false;
      show(''); $('setThreads').textContent = threadsNote();
      return;
    }
    const [name, build] = scen[k++];
    show(`building ${name}…`);
    setTimeout(() => {
      Math.random = seeded(12);
      R.sel = null; R.hover = null; W.grab = null; R.msel.clear();
      build(); W.decayOn = false; fitView();
      const steps = (n) => { let adv = 0; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } const tc = performance.now(); W.dt = chooseDt(); if (PROF.on) PROF.dt += performance.now() - tc; adv += step(W.dt); } return adv; };
      steps(40);
      let best = Infinity, adv = 0; const N = 60;
      PROF.on = true; profReset(); VL.builds = 0;
      for (let r = 0; r < 3; r++) { const t0 = performance.now(); adv += steps(N); best = Math.min(best, (performance.now() - t0) / N); }
      PROF.on = false;
      const dt = adv / (3 * N), spf = 10 / best, speed = Math.min(100, 100 * spf * dt / W.simPerFrame), ns = PROF.steps || 1;
      const f = (v) => (v / ns).toFixed(2);
      let fast = 0, alive = 0; for (const p of W.parts) if (!p.dead) { alive++; if (p.fast) fast++; }
      const m = measure();
      // real frames: the adaptive budget, the step and the drawing as the page does them, for about a second
      const FP = UI.fp || (UI.fp = {}); FP.drawAvg = 0; FP.uiAvg = 0; FP.stepAvg = best;
      let frames = 0, simMs = 0, drawMs = 0, stepsRun = 0, budgetSum = 0; const tStart = performance.now();
      while (performance.now() - tStart < 1200) {
        const room = frameAim() - FP.drawAvg - FP.stepAvg, budget = Math.max(3, Math.min(frameCap(room), room));
        const a = performance.now(); const r = simFrame(1 / 60, budget); const b = performance.now(); render(W.rt); const c = performance.now();
        simMs += b - a; drawMs += c - b; frames++; stepsRun += r.steps; budgetSum += budget;
        if (r.steps > 0) FP.stepAvg = 0.8 * FP.stepAvg + 0.2 * (b - a) / r.steps;
        FP.drawAvg = 0.9 * (FP.drawAvg || (c - b)) + 0.1 * (c - b);
      }
      const fSim = simMs / frames, fDraw = drawMs / frames, fAll = fSim + fDraw, fpsAllow = 1000 / Math.max(fAll, 1e-3);
      BENCH.rows.push(`${name}: ${best.toFixed(2)} ms a step on ${TH.used || 1} thread${(TH.used || 1) > 1 ? 's' : ''}, ${speed.toFixed(0)}% of full speed within 10 ms` +
        ` [forces ${f(PROF.forces)} of which kernels ${f(PROF.kernels)}${TH.used > 1 ? ', waiting for threads ' + f(PROF.wait) : ''}, bookkeeping ${f(PROF.cls)}, grid ${f(PROF.grid)}, lists ${f(PROF.lists)} (checks ${f(PROF.valid)}), after ${f(PROF.after)}; bath ${f(PROF.bath)}; integration ${f(PROF.integ)}; timestep ${f(PROF.dt)}; rest ${f(PROF.total - PROF.forces - PROF.bath - PROF.integ)} (${RP_NAMES.map((nm, i) => [nm, PROF.rp[i]]).filter(([, v]) => v / ns >= 0.005).sort((a, b) => b[1] - a[1]).map(([nm, v]) => nm + ' ' + f(v)).join(', ')}); ${(PROF.passes / ns).toFixed(2)} force passes and ${(VL.builds / (3 * N)).toFixed(2)} list rebuilds a step; ${alive.toLocaleString('en-US')} particles, ${fast} fast, ${m.T.toFixed(0)} K${TH.used > 1 ? '; threaded phases (main share / wait) ' + Object.entries(TH_PH).filter(([, a]) => a[2]).map(([k, a]) => `${k} ${f(a[0])}/${f(a[1])}`).join(', ') : ''}]` +
        ` frames: sim ${fSim.toFixed(1)} + draw ${fDraw.toFixed(1)} = ${fAll.toFixed(1)} ms (${(stepsRun / frames).toFixed(1)} steps a frame on a ${(budgetSum / frames).toFixed(0)} ms budget), room for ${fpsAllow.toFixed(0)} fps${GL.ok && GL.on ? '' : ' (Canvas 2D)'}`);
      show(''); setTimeout(next, 30);
    }, 30);
  };
  next();
}
/* Performance mode replaces four settings; turned off, it puts back what they were before (else the defaults). Changing
   one of them by hand while it is on ends it, and what it replaced is forgotten. */
function setSetting(k, v) {
  const keys = Object.keys(SET_PERF);
  if (k === 'perf') {
    if (v) { if (!perfOn()) { SET.prePerf = {}; for (const q of keys) SET.prePerf[q] = SET[q]; } Object.assign(SET, SET_PERF); }
    else { const pp = SET.prePerf; for (const q of keys) SET[q] = pp && setOk(q, pp[q]) ? pp[q] : SET_DEF[q]; delete SET.prePerf; }
  } else {
    SET[k] = v;
    if (keys.includes(k) && !perfOn()) delete SET.prePerf;
  }
  store('settings', JSON.stringify(SET));
  applySettings(); syncSettings();
  buildToolOpts(); syncLab(); updateReadouts();
}
function syncSettings() {
  if ($('setModal').hidden) return;
  $('setPerf').checked = perfOn();
  setSegValue('segMax', SET.maxParts); setSegValue('segRes', SET.res); setSegValue('segBudget', SET.budget); setSegValue('segThreads', String(SET.threads)); setSegValue('segGl', SET.gl); setSegValue('segTrail', String(SET.trail)); setSegValue('segTrailClock', SET.trailClock);
  $('setPrio').value = SET.prio || 0; $('setPrioV').textContent = PRIO_NAME[SET.prio || 0];
  if (document.activeElement !== $('setApiKey')) $('setApiKey').value = SET.apiKey || ''; if (document.activeElement !== $('setApiModel')) $('setApiModel').value = SET.apiModel || '';
  { const own = typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function'; const n = $('setApiNote');
    n.textContent = (AI.sample && !AI.sample.api ? 'This page has its own Claude access: Ask Claude and Identify molecules use your Claude account directly, and the key below is not needed here. ' : own ? '' : 'This page has no Claude access of its own. ') +
      'Paste an API key from console.anthropic.com to ask Claude from here: it stays in this browser\'s storage, is sent only to api.anthropic.com, and each request is billed to that account (a fraction of a cent). The model can be left blank for the default (' + AI_API.model + ').'; }
  try { $('setThreads').textContent = threadsNote(); } catch (e) { $('setThreads').textContent = 'Threads: ' + e.message; }
  setSegValue('segFpsCap', SET.fpsCap); setSegValue('segAtom', SET.atomScale); setSegValue('segLabels', R.view.labels ? (SET.labels === 'hover' ? 'hover' : 'always') : 'never'); setSegValue('segBadges', SET.badges);
  $('setFlash').checked = SET.flashLow; $('setCvd').checked = SET.cvd; setSegValue('segUi', SET.ui); setSegValue('segSide', SET.side); $('setPw').textContent = Math.round(clamp(SET.pw, 280, 760)) + ' px';
  $('setWinNote').hidden = !tauriWin(); setSegValue('segWheel', SET.wheel); setSegValue('segZoomTo', SET.zoomTo); $('setKeepOpt').checked = SET.keepOpt; $('setPauseBlur').checked = SET.pauseBlur;
  $('setRew').checked = SET.rewOn; setSegValue('segRewSpan', SET.rewSpan); setSegValue('segRewEvery', SET.rewEvery); setSegValue('segRewMem', SET.rewMem); $('setRewNote').textContent = rewNote();
  setSegValue('segStart', SET.start); $('setAutosave').checked = SET.autosave; setSegValue('segEUnit', SET.eunit); setSegValue('segLUnit', SET.lunit);
  setSegValue('segTheme', SET.theme); setSegValue('segTUnit', SET.tunit); syncWinSeg(); setSegValue('segCursor', SET.cursor); $('setChamber').checked = DM.on;
  $('setFx').checked = SET.effects; $('setTips').checked = SET.tips; $('setFps').checked = SET.fps; $('setSlow').checked = W.slowmo;
  const nm = Object.values(MOLECULES).filter(m => m.mine).length;
  $('setMols').textContent = `Your saved molecules: ${nm} (My molecules and those Claude added to the library)`; $('setIsos').textContent = `Saved isotopes: ${MYISO.length}`;
  $('setDelMols').disabled = !nm; $('setDelIsos').disabled = !MYISO.length;
  settingsStats();
}
function settingsStats() {
  const n = W.parts.filter(p => !p.dead).length;
  $('setStats').textContent = `Now: ${n.toLocaleString('en-US')} particles of ${MAX_PARTS.toLocaleString('en-US')}, about ${Math.round(UI.fpsNow || UI.fps || 60)} frames a second.` + (UI.lastError ? ` Last script error: ${UI.lastError}` : '');
  if (!BENCH.busy) $('setThreads').textContent = threadsNote();
}
window.addEventListener('error', (e) => { UI.lastError = `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`; });
function openSettings(tab) { $('setModal').hidden = false; if (tab) setTabS(tab); syncSettings(); showModal('setModal'); }
function setTabS(k) {
  UI.stab = k;
  for (const b of document.querySelectorAll('.stabs [data-stab]')) b.setAttribute('aria-selected', String(b.dataset.stab === k));
  for (const p of document.querySelectorAll('.spane')) p.hidden = p.dataset.stab !== k;
}
/* A button that does its work on a second press (within 3 s): for deleting what cannot be brought back. */
function twoPress(b, fn) {
  if (b.dataset.armed) { delete b.dataset.armed; b.textContent = b.dataset.label; fn(); return; }
  b.dataset.label = b.textContent; b.dataset.armed = '1'; b.textContent = 'Press again';
  setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = b.dataset.label; } }, 3000);
}
function settingsInit() {
  settingsLoad(); applySettings();
  $('bSettings').onclick = () => openSettings();
  $('setClose').onclick = () => hideModal('setModal');
  $('setPerf').onchange = (e) => setSetting('perf', e.target.checked);
  bindSeg('segMax', (v) => setSetting('maxParts', +v));
  bindSeg('segRes', (v) => setSetting('res', v));
  bindSeg('segBudget', (v) => setSetting('budget', +v));
  $('setPrio').addEventListener('input', (e) => { $('setPrioV').textContent = PRIO_NAME[+e.target.value]; });
  $('setPrio').addEventListener('change', (e) => setSetting('prio', +e.target.value));
  bindSeg('segThreads', (v) => setSetting('threads', v));
  bindSeg('segGl', (v) => setSetting('gl', v));
  bindSeg('segSpec', (v) => { _specView = v; drawSpec(); });
  $('bSpecClear').onclick = (e) => { const on = !(_specFrom > -Infinity); _specFrom = on ? W.rt : -Infinity; e.currentTarget.textContent = on ? 'Last 10 s' : 'Clear'; e.currentTarget.title = on ? 'Back to the light of the last 10 seconds' : 'Start counting again, and keep counting'; drawSpec(); };
  bindSeg('segTrail', (v) => setSetting('trail', +v)); bindSeg('segTrailClock', (v) => setSetting('trailClock', v));
  $('setBench').onclick = () => benchStart();
  bindSeg('segTheme', (v) => setSetting('theme', v));
  bindSeg('segWin', (v) => setWindowMode(v));
  for (const b of document.querySelectorAll('.stabs [data-stab]')) b.onclick = () => setTabS(b.dataset.stab);
  bindSeg('segFpsCap', (v) => setSetting('fpsCap', +v));
  bindSeg('segAtom', (v) => setSetting('atomScale', +v));
  bindSeg('segLabels', (v) => { R.view.labels = v !== 'never'; viewFlagsSave(); if (v !== 'never') SET.labels = v; setSetting('labels', SET.labels); const c = document.querySelector('[data-view="labels"]'); if (c) c.checked = R.view.labels; });
  bindSeg('segBadges', (v) => setSetting('badges', v));
  $('setFlash').onchange = (e) => setSetting('flashLow', e.target.checked);
  $('setCvd').onchange = (e) => setSetting('cvd', e.target.checked);
  bindSeg('segUi', (v) => setSetting('ui', +v));
  bindSeg('segSide', (v) => setSetting('side', v));
  $('setPwReset').onclick = () => setSetting('pw', 356);
  bindSeg('segWheel', (v) => setSetting('wheel', +v));
  bindSeg('segZoomTo', (v) => setSetting('zoomTo', v));
  $('setKeepOpt').onchange = (e) => { setSetting('keepOpt', e.target.checked); optSave(); };
  $('setPauseBlur').onchange = (e) => setSetting('pauseBlur', e.target.checked);
  $('setKeys').onclick = () => openKeys();
  bindSeg('segStart', (v) => setSetting('start', v));
  $('setRew').onchange = (e) => { setSetting('rewOn', e.target.checked); if (!e.target.checked) rewClear(); };
  bindSeg('segRewSpan', (v) => { setSetting('rewSpan', +v); rewTrim(); });
  bindSeg('segRewEvery', (v) => setSetting('rewEvery', +v));
  bindSeg('segRewMem', (v) => { setSetting('rewMem', +v); rewTrim(); });
  $('setTour').onclick = () => { hideModal('setModal'); tourStart(); };
  $('setAutosave').onchange = (e) => { setSetting('autosave', e.target.checked); if (!e.target.checked) store('autosave', ''); };
  bindSeg('segEUnit', (v) => { setSetting('eunit', v); updatePanel(); });
  bindSeg('segLUnit', (v) => { setSetting('lunit', v); updatePanel(); });
  bindSeg('segCursor', (v) => { setSetting('cursor', v); dmPoke(); });
  $('setChamber').onchange = (e) => setChamberOnly(e.target.checked);
  bindSeg('segTUnit', (v) => setSetting('tunit', v));
  $('setFx').onchange = (e) => setSetting('effects', e.target.checked);
  $('setTips').onchange = (e) => setSetting('tips', e.target.checked);
  $('setFps').onchange = (e) => setSetting('fps', e.target.checked);
  $('setSlow').onchange = (e) => { W.slowmo = e.target.checked; store('slowmo', W.slowmo ? '1' : '0'); syncLab(); };
  const keyIn = $('setApiKey'), modelIn = $('setApiModel');
  const apiChanged = () => { const k = keyIn.value.trim(), m = modelIn.value.trim(); if (k === (SET.apiKey || '') && m === (SET.apiModel || '')) return; SET.apiKey = k; SET.apiModel = m; store('settings', JSON.stringify(SET)); aiInit(); syncSettings(); log('tool', k ? 'Claude API key set: Ask Claude and Identify molecules can ask Claude here' : 'Claude API key removed'); };
  keyIn.addEventListener('change', apiChanged); modelIn.addEventListener('change', apiChanged);
  keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apiChanged(); } e.stopPropagation(); }); modelIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apiChanged(); } e.stopPropagation(); });
  $('setExport').onclick = () => exportLibrary(); $('setImport').onclick = () => importLibrary();
  $('setDelMols').onclick = (e) => twoPress(e.currentTarget, () => { for (const k of Object.keys(MOLECULES)) if (MOLECULES[k].mine) myMolRemove(k); log('tool', 'My molecules deleted'); syncSettings(); });
  $('setDelIsos').onclick = (e) => twoPress(e.currentTarget, () => { MYISO.length = 0; myIsoStore(); buildToolOpts(); log('tool', 'Saved isotopes deleted'); syncSettings(); });
  $('setReset').onclick = () => { Object.assign(SET, SET_DEF); delete SET.prePerf; store('settings', JSON.stringify(SET)); applySettings(); syncSettings(); buildToolOpts(); syncLab(); updateReadouts(); };
}

/* ------------------------------------------------------------------ quick menu
   A right-click in the chamber that does not drag (a right-drag still pans; Ctrl-click with a mouse, or the
   keyboard's menu key at the pointer, does the same) opens a menu of what can be done right there: to the particle
   under the pointer (inspect it, take or give an electron, save its isotope, place more like it, stop it, delete it
   or its molecule), to a magnet (flip it, remove it) or at an empty spot (place one of the picked, saved or palette
   particles there, a spark, a magnet), then the tools and the run and view controls. */
const QM = { open: false, acts: [] };
function qmBtn(label, fn, o = {}) {
  QM.acts.push(fn);
  return `<button type="button" role="menuitem" class="qmi${o.cls ? ' ' + o.cls : ''}" data-q="${QM.acts.length - 1}"${o.off ? ' disabled' : ''}` +
    `${o.title ? ` title="${esc(o.title)}"` : ''}${o.pressed !== undefined ? ` aria-pressed="${!!o.pressed}"` : ''}>` +
    `${o.html || `<span>${esc(label)}</span>`}${o.key ? `<kbd>${esc(o.key)}</kbd>` : ''}</button>`;
}
const qm2 = (a, b) => `<div class="qm2">${a}${b}</div>`;
function qmStop(list) { // what grabbing does to a particle: at rest where it is
  for (const a of list) { if (a.dead) continue; if (a.rad || a.fast) { a.rad = false; a.fast = false; a.KE = 0; } a.vx = 0; a.vy = 0; }
}
function qmParticle(p) {
  const atom = p.k === NUC && p.Z > 0, mol = atom && p.bonds.length ? molecule(p) : null;
  const ke = p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
  let t1, spec = null;
  if (p.k === ELEC || p.k === POS) { t1 = p.k === ELEC ? 'Free electron' : 'Positron'; spec = { kind: p.k === ELEC ? 'e' : 'pos' }; }
  else if (!atom) { t1 = p.anti ? 'Antineutron' : 'Neutron'; spec = p.anti ? SPEC_NBAR : { kind: 'n' }; }
  else {
    const nm = mol ? moleculeName(mol) : null, aq = p.anti ? -p.q : p.q;
    t1 = mol ? `${elemName(p)} in ${nm || isoFormula(mol)}` : p.ne === 0 ? `${speciesLabel(p)} nucleus` : `${elemName(p)} ${aq ? (aq > 0 ? 'cation' : 'anion') : 'atom'}`;
    spec = isoSpec(p.Z, p.Z + p.N, p.ne ? p.q : 0, p.ne === 0, p.anti);
  }
  const t2 = (atom ? `${mol ? isoFormula(mol) + ' · ' : ''}${nucSymA(p.Z, p.N, p.anti)} · ${lifeText(p.nuc)} · ` : '') + `KE ${fmtE(ke)}`;
  let h = `<div class="qmh"><div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div></div>`;
  h += qmBtn('Inspect', () => { if (p.dead) return; R.sel = p; showTab('inspect', true); renderInspect(); });
  if (atom) {
    const lep = p.anti ? 'positron' : 'electron', sf = saveBtnFace(spec);
    h += qm2(qmBtn(`Remove ${lep}`, () => { if (!p.dead) { undoMark('Remove an electron'); userIonize(p); }; renderInspect(); }, { off: p.ne <= 0 }),
      qmBtn(`Add ${lep}`, () => { if (!p.dead) { undoMark('Add an electron'); userAddElectron(p); }; renderInspect(); }, { off: p.ne >= p.Z + maxExtraElectrons(p.Z) }));
    h += qmBtn(sf.on ? '★ Saved: take it off' : '☆ Save this isotope', () => myIsoToggle(spec), { title: sf.title });
  }
  if (spec) h += qmBtn(`Place more: ${specLabel(spec)}`, () => selectSpec(spec), { title: `Pick ${specName(spec)} for the Place tool` });
  const lm = mol ? libMatch(mol) : null;
  if (lm) h += qmBtn(`Place more: ${lm.name}`, () => selectSpec({ kind: 'mol', mol: lm.key }), { title: `Pick ${lm.name} for the Place tool` });
  if (atom) h += qm2(qmBtn('Isotope builder…', () => openNucBuilder({ Z: p.Z, N: p.N, ne: p.ne, anti: p.anti })),
    qmBtn('Element…', () => openPT({ Z: p.Z, A: p.Z + p.N, q: p.ne ? p.q : 0, bare: p.ne === 0, anti: p.anti }), { title: 'This element and its isotopes in the periodic table' }));
  h += qm2(qmBtn(R.follow === p ? 'Following' : 'Follow it', () => { R.follow = R.follow === p ? null : p; }, { pressed: R.follow === p, cls: 'tick', title: 'Keep the view centred on it (pan, fit or Escape to stop)' }),
    qmBtn(mol ? 'Stop the molecule' : 'Stop it', () => qmStop(mol || [p]), { title: 'Bring it to rest where it is' }));
  const gone = () => { if (R.sel && R.sel.dead) { R.sel = null; renderInspect(); } };
  h += mol ? qm2(qmBtn('Delete atom', () => { if (!p.dead) { undoMark('Delete'); kill(p); } gone(); }, { cls: 'danger' }), qmBtn(`Delete all ${mol.length}`, () => { undoMark('Delete a molecule'); for (const a of mol) if (!a.dead) kill(a); gone(); }, { cls: 'danger', title: 'Delete the whole molecule' }))
    : qmBtn('Delete', () => { if (!p.dead) { undoMark('Delete'); kill(p); } gone(); }, { cls: 'danger' });
  // every one of its kind in the box: free leptons of its kind, (anti)neutrons, bare nuclei of its isotope, atoms and
  // ions of its element; and, in a molecule, every molecule with its formula
  const k = kindOf(p), all = W.parts.filter(q => !q.dead && k.match(q));
  const rmAll = qmBtn(`Remove all ${k.what} (${all.length.toLocaleString('en-US')})`, () => { const n = removeAll(k.match); log('tool', `Removed all ${k.what}: ${n.toLocaleString('en-US')}`); gone(); }, { cls: 'danger', title: `Every ${k.what} in the box` });
  if (mol) {
    const f = isoFormula(mol), nm = moleculeName(mol) || f, mols = molsLike(f);
    h += qm2(rmAll, qmBtn(`Remove all ${nm} (${mols.length.toLocaleString('en-US')})`, () => { let n = 0; for (const m of molsLike(f)) { for (const a of m) if (!a.dead) kill(a); n++; } log('tool', `Removed all ${nm}: ${n.toLocaleString('en-US')} molecules`); gone(); }, { cls: 'danger', title: `Every ${nm} molecule in the box` }));
  } else h += rmAll;
  return h;
}
function kindOf(p) {
  if (p.k !== NUC) return { what: p.k === ELEC ? 'free electrons' : 'positrons', match: (q) => q.k === p.k };
  if (p.Z === 0) return { what: p.anti ? 'antineutrons' : 'neutrons', match: (q) => q.k === NUC && q.Z === 0 && !!q.anti === !!p.anti };
  if (p.ne === 0) return { what: speciesLabel(p), match: (q) => q.k === NUC && q.ne === 0 && q.Z === p.Z && q.N === p.N && !!q.anti === !!p.anti };
  return { what: p.anti ? barSym(p.el.sym) : p.el.sym, match: (q) => q.k === NUC && q.ne > 0 && q.Z === p.Z && !!q.anti === !!p.anti };
}
function removeAll(match) { let n = 0; for (const q of W.parts) if (!q.dead && match(q)) { kill(q); n++; } return n; }
function molsLike(f) { // every molecule in the box with this formula
  const seen = new Set(), out = [];
  for (const q of W.parts) {
    if (q.dead || q.k !== NUC || !q.bonds.length || seen.has(q)) continue;
    const m = molecule(q); for (const a of m) seen.add(a);
    if (isoFormula(m) === f) out.push(m);
  }
  return out;
}
function qmMagnet(m) {
  return `<div class="qmh"><div class="t1">Magnet pole</div><div class="t2">${m.B >= 0 ? 'N' : 'S'} · ${esc(fmtTesla(Math.abs(m.B)))}</div></div>` +
    qm2(qmBtn('Flip its pole', () => { m.B = -m.B; }), qmBtn('Remove it', () => { const i = W.magnets.indexOf(m); if (i >= 0) W.magnets.splice(i, 1); }, { cls: 'danger' }));
}
function qmSource(s) { // a beam source made with the Fire tool (a collider's injectors are left alone)
  return `<div class="qmh"><div class="t1">Beam source</div><div class="t2">${esc(specLabel(s.spec))} · ${esc(fmtE(s.KE))}</div></div>` +
    qmBtn('Remove it', () => { const i = W.sources.indexOf(s); if (i >= 0) W.sources.splice(i, 1); }, { cls: 'danger' });
}
function qmHere(wx, wy) {
  const sp = UI.spec || SPEC_P, list = [];
  const add = (s) => { if (s && !list.some(o => sameSpec(o, s))) list.push(s); };
  add(sp); for (const m of MYISO) add(m); for (const q of QUICK) if (q !== 'sep') add(q.spec);
  return `<div class="qlbl">Place one here</div><div class="qchips">` + list.slice(0, 16).map(s => qmBtn(specLabel(s), () => placeSpec(s, wx, wy, 1),
    { cls: 'qchip' + (sameSpec(s, sp) ? ' on' : ''), title: specName(s), html: `<span class="sw" style="background:${specColor(s)}"></span>${esc(specLabel(s))}` })).join('') + '</div>' +
    qm2(qmBtn('Spark here', () => spark(wx, wy, OPT.spark.R, sparkE()), { title: `Dump ${fmtE(sparkE())} into the atoms here` }),
      qmBtn('Magnet here', () => { const nm = { x: wx, y: wy, R: OPT.magnet.R, B: magB() }; W.magnets.push(nm); log('tool', `Magnet placed: ${nm.B >= 0 ? 'N' : 'S'} pole, ${fmtTesla(Math.abs(nm.B))}`); }));
}
function qmGlobal(px, py, wx, wy) {
  return '<div class="qsep"></div><div class="qtools" role="group" aria-label="Tools">' +
    TOOLS.map(t => qmBtn(t.name, () => setTool(t.id), { html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.id]}</svg><span>${esc(t.name)}</span>`, pressed: UI.tool === t.id, title: `${t.name} (${t.key}): ${t.help}` })).join('') +
    '</div><div class="qsep"></div>' +
    qm2(qmBtn(UI.running ? 'Pause' : 'Play', () => setRunning(!UI.running), { key: 'Space' }), qmBtn('Step', () => { if (UI.running) setRunning(false); UI.stepOnce = true; }, { key: '.' })) +
    qmBtn('Slow motion on demand', () => toggleSlowmo(), { key: '\\', pressed: !!W.slowHold, cls: 'tick' }) +
    (R.follow ? qmBtn('Stop following', () => { R.follow = null; }) : '') +
    qm2(qmBtn('Centre here', () => { R.follow = null; R.cx = wx; R.cy = wy; }), qmBtn('Zoom in here', () => zoomAt(px, py, 2))) +
    qm2(qmBtn('Fit the box', () => fitView(), { key: '0' }), qmBtn('Clear trails', () => { W.tracks.length = 0; }, { off: !W.tracks.length })) +
    qm2(qmBtn('Identify molecules', () => identifyMolecules(), { title: 'Name every molecule in the chamber (also in the Lab tab, Sample section)', off: !W.bonds.length }), qmBtn('Save world…', () => saveWorld(), { title: 'Save the chamber as a JSON file' })) +
    qm2(qmBtn(R.msel.size ? `Copy ${selCount().toLocaleString('en-US')} selected` : 'Copy', () => copySelection(), { key: 'Ctrl+C', off: !R.msel.size && !R.sel, title: 'Copy the selection (Select tool), or the inspected particle' }),
      qmBtn('Paste here', () => pasteClip(wx, wy), { key: 'Ctrl+V', off: !UI.clip, title: UI.clip ? `${UI.clip.parts.length.toLocaleString('en-US')} particles` : 'Nothing copied yet' })) +
    qm2(qmBtn('Particle view', () => toggleParticleView(), { key: 'V', pressed: R.view.bohr === 'nuc', cls: 'tick' }), qmBtn('Orbitals', () => toggleOrbitalView(), { key: 'O', pressed: R.view.bohr === 'orb', cls: 'tick' })) +
    qm2(qmBtn('Settings…', () => openSettings()), qmBtn('Restart', () => loadPreset(UI.preset), { key: 'R', cls: 'danger', title: 'Restart this preset' }));
}
function openQuickMenu(px, py) {
  const m = $('qmenu'); if (!m) return;
  hideTip(); QM.acts = [];
  const [wx, wy] = s2w(px, py), p = pickNear(px, py, 14), mag = p ? null : magnetAt(wx, wy);
  const src = p || mag ? null : W.sources.find(s => !s.beam && Math.hypot(s.x - wx, s.y - wy) < Math.max(1.5, 12 / R.s));
  m.innerHTML = (p ? qmParticle(p) : mag ? qmMagnet(mag) : src ? qmSource(src) : qmHere(wx, wy)) + qmGlobal(px, py, wx, wy);
  m.hidden = false; QM.open = true; m.scrollTop = 0;
  m.style.left = Math.max(4, Math.min(px + 2, R.w - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(py + 2, R.h - m.offsetHeight - 4)) + 'px';
  const f = m.querySelector('.qmi:not([disabled])'); if (f) f.focus({ preventScroll: true });
}
function closeQuickMenu(refocus) {
  const m = $('qmenu'); if (!m || !QM.open) return;
  m.hidden = true; QM.open = false; QM.acts = [];
  if (refocus) try { R.cv.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ }
}
function qmMove(d) {
  const items = [...$('qmenu').querySelectorAll('.qmi:not([disabled])')]; if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  items[i < 0 ? (d > 0 ? 0 : items.length - 1) : (i + d + items.length) % items.length].focus();
}
function qmInit() {
  const m = $('qmenu');
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b || b.disabled) return;
    const fn = QM.acts[+b.dataset.q];
    closeQuickMenu(true);
    if (fn) fn();
  });
  m.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerdown', (e) => { if (QM.open && !m.contains(e.target) && e.target !== R.cv) closeQuickMenu(); }, true);
  window.addEventListener('resize', () => closeQuickMenu());
  window.addEventListener('blur', () => closeQuickMenu());
}

/* ------------------------------------------------------------------ init */
function init() {
  rInit($('cv'), $('cvbg'));
  UI.budget = 10;
  const sv = store('bohr'); if (sv) setAtomView(sv);
  W.slowmo = store('slowmo') !== '0';
  buildTools(); buildLogFilters(); bindLab(); buildPresetSelect(); bindDisplayMode();
  for (const id of ['tp-inspect', 'tp-data', 'tp-log']) trackScroll(id);
  makeHScroll($('paletteHS')); makeHScroll($('tooloptsHS')); makeHScroll($('toolsHS'), { lite: true }); makeHScroll($('ptHS'), { lite: true, wheel: false });
  $('bPT').onclick = () => openPT();
  $('bMol').onclick = () => openMol();
  const st = $('stage');
  const resize = () => { const r = st.getBoundingClientRect(); rResize(Math.max(50, r.width), Math.max(50, r.height)); if (!UI.fitted) { fitView(); UI.fitted = true; } placeHint(); };
  new ResizeObserver(resize).observe(st); resize();
  const cv = $('cv');
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', () => { if (!UI.drag) { hideTip(); if (!UI.drag) R.overlay = null; } });
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  { const v = /\d+\.\d+\.\d+|V\d+/.exec(document.title || ''); const tag = $('verTag'); if (tag) tag.textContent = v ? v[0] : ''; } // (the version, from the page's title: 0.40.0)
  qmInit(); settingsInit(); optLoad(); menusInit(); rewInit(); grInit(); tourInit(); aiInit(); chipsInit();
  window.addEventListener('keydown', onKey);
  $('zIn').onclick = () => zoomAt(R.w / 2, R.h / 2, 1.25);
  $('zOut').onclick = () => zoomAt(R.w / 2, R.h / 2, 0.8);
  $('zFit').onclick = () => fitView();
  $('zNuc').onclick = () => toggleParticleView();
  $('zOrb').onclick = () => toggleOrbitalView();
  $('bPlay').onclick = () => (REW.open ? rewCommit() : setRunning(!UI.running));
  $('bStep').onclick = () => { if (UI.running) setRunning(false); UI.stepOnce = true; };
  $('bReset').onclick = () => loadPreset(UI.preset);
  $('bSlower').onclick = () => stepSpeed(-1);
  $('bFaster').onclick = () => stepSpeed(1);
  $('bSlowmo').onclick = () => toggleSlowmo();
  const newBeams = (a, b, E, E2) => {
    const C = W.collider; if (!C) return;
    setupCollider(C.kind, a, b, E || C.E, E2 === undefined ? C.E2 : E2); fitView(); syncCollider();
    const N = W.collider;
    log('tool', `Collider beams: ${beamInfo(a).lab} + ${beamInfo(b).lab} at ${N.E2 !== null ? fmtE(N.E) + ' and ' + fmtE(N.E2) : fmtE(N.E) + ' each'}`);
  };
  $('segBeams').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); const C = W.collider; if (!b || b.disabled || !C) return;
    const [pa, pb] = BEAM_PAIRS[b.dataset.v];
    newBeams(pa, pb, b.dataset.v === 'dt' ? 6e4 : b.dataset.v === 'aa' ? 1e10 : C.E, null); // (D–T fuses most readily at ~100 keV in their own frame; a pair starts with matched beams)
  });
  const pickBeam = (which, v, A) => { // a menu's choice: a species key, or 'Z<n>' for an element (its isotope A, or a default)
    const C = W.collider; if (!C) return;
    let k = v;
    if (/^Z\d+$/.test(v)) {
      const Z = +v.slice(1), cur = BEAM_SPECIES[which === 'a' ? C.a : C.b];
      k = beamKey(Z, A || (cur && cur.Z === Z && !cur.anti ? cur.A : defaultBeamA(Z)));
    }
    if (which === 'a') newBeams(k, C.b); else newBeams(C.a, k);
  };
  $('cBeamA').onchange = (e) => pickBeam('a', e.target.value);
  $('cBeamB').onchange = (e) => pickBeam('b', e.target.value);
  $('cIsoA').onchange = (e) => pickBeam('a', $('cBeamA').value, +e.target.value);
  $('cIsoB').onchange = (e) => pickBeam('b', $('cBeamB').value, +e.target.value);
  for (const [id, which] of [['cFindA', 'a'], ['cFindB', 'b']]) { // a suggestion picked takes at once; typed text on Enter
    const box = $(id);
    const go = (strict) => {
      const r = beamFind(box.value);
      if (!r || (strict && !BEAM_FIND.has(box.value.trim().toLowerCase()))) return;
      if (r.bad) { box.setCustomValidity(r.bad); box.reportValidity(); return; }
      box.setCustomValidity(''); pickBeam(which, r.v, r.A); box.value = ''; box.blur();
    };
    box.addEventListener('input', () => { box.setCustomValidity(''); go(true); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(false); } });
    box.addEventListener('change', () => go(false));
  }
  $('cNSlider').oninput = (e) => { $('cNVal').textContent = e.target.value; if (W.collider) W.collider.bunch = +e.target.value; };
  $('cESlider').oninput = (e) => { const C = W.collider; $('cEVal').textContent = fmtE(cEFromS(+e.target.value)) + (C && C.E2 !== null ? '' : ' each'); };
  $('cESlider').onchange = (e) => { setColliderEnergy(cEFromS(+e.target.value)); syncCollider(); };
  $('cE2Slider').oninput = (e) => { $('cE2Val').textContent = fmtE(cEFromS(+e.target.value)); };
  $('cE2Slider').onchange = (e) => { const C = W.collider; if (!C) return; setColliderEnergy(C.E, cEFromS(+e.target.value)); syncCollider(); log('tool', `Beam 2 energy: ${fmtE(W.collider.E2)}`); };
  $('chkEach').onchange = (e) => { // each beam its own energy, starting from what beam 2 has now; or back to matched beams
    const C = W.collider; if (!C) return;
    setColliderEnergy(C.E, e.target.checked ? clamp(C.EB || C.E, 2e4, 1e15) : null); syncCollider();
  };
  bindSeg('segSep', (v) => { const C = W.collider; if (!C) return; C.sepMode = v; syncCollider(); log('tool', `Collider beams: ${{ auto: 'brought together at full energy', apart: 'kept apart', together: 'brought together now' }[v]}`); });
  $('bInject').onclick = () => injectBeams();
  $('chkRefill').onchange = (e) => { if (W.collider) W.collider.auto = e.target.checked; };
  $('hintX').onclick = () => { $('hint').hidden = true; };
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => showTab(b.dataset.tab);
  $('bPanel').onclick = () => $('panel').classList.toggle('open');
  $('bSheetClose').onclick = () => $('panel').classList.remove('open');
  $('ptClose').onclick = () => hideModal('ptModal');
  $('molClose').onclick = () => hideModal('molModal');
  for (const id of ['ptModal', 'molModal', 'bldModal', 'nucModal']) $(id).addEventListener('click', (e) => { if (e.target.id === id) hideModal(id); });
  $('molBuild').onclick = () => openMolBuilder();
  builderInit();
  myMolsLoad();
  myIsoLoad();
  let startPreset = 'soup';
  const hash = (location.hash || '').slice(1);
  if (hash && PRESETS[hash]) startPreset = hash;
  else { const sp = store('preset'); if (sp && PRESETS[sp]) startPreset = sp; }
  const tab = store('tab'); showTab(tab && ['lab', 'inspect', 'data', 'log', 'physics'].includes(tab) ? tab : 'lab');
  // the start (Settings → General): the main menu, where you left off, or the last setup afresh; a link to a setup or
  // a shared world opens that at once
  const direct = !!hash || window.AF_NO_MENU;
  loadPreset(startPreset); buildToolOpts();
  setRunning(true);
  UI.started = true;
  if (!direct && SET.start === 'menu') showMainMenu();
  else if (!direct && SET.start === 'last') restoreAutosave();
  if (!direct && SET.start !== 'menu' && !store('toured')) setTimeout(tourStart, 600);
  UI.last = performance.now();
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
