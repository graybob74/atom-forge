'use strict';
/* Pictures for Settings' preview pane: each one a small scene in the built page (headless Chromium), the setting applied,
   and the chamber photographed; comparisons put two or three photographs side by side, each labelled with its choice.
   Written as WebP data URLs (1280 × 720 since 1.23.2, for the enlarged view: laid out as 640 × 360 and drawn at 2×,
   from a page photographed at 2×; 640 × 360 before) into src/setshots.gen.js, one global map SETSHOTS from the
   setting's key (its control's id in Settings; "id:value" for one choice's own picture; "id@3d" and "id:value@3d" for
   the 3-D lab's own version, shown in 3-D mode only (1.25); menu2d and menu3d for the main menu's first screen) to its
   picture. Run from the repository root:
     node tools/setshots.js [key …] [--png DIR] [--q 0.72]
   With keys, only those are made again (the others are kept from the file). --png also writes each picture as a PNG
   into DIR, to look at. Builds the page first. */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'setshots.gen.js');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const PNG_DIR = opt('--png', null), Q = +opt('--q', '0.72'), ONLY = args.filter(a => !a.startsWith('--'));
const W = 640, H = 360, S = 2; // (the picture's layout, in pixels, and its scale: 1280 × 720 written, 1.23.2)
/* (a shot's fit: true shows each panel's whole window, letterboxed, instead of a crop; labelTop puts the labels at the
   top, clear of marks drawn at the bottom) */
const VW = 960, VH = 540; // (the page's window: the chamber fills it, so a picture is the chamber at two thirds)

/* ---- the scenes. Each: key, panels [{ label, run }], and optional scene (run once first), crop {x, y, z} (the centre as
   a fraction of the chamber, and a zoom: 1 shows a panel's share of the whole height), full (the whole window, with its
   controls, instead of the chamber alone), draw (marks drawn over a panel: arrows), dpr. run and scene are page code. */
const P2 = (key, s, cx = 0, cy = 0, steps = 0) => `loadPreset('${key}'); setRunning(false); for (let i = 0; i < ${steps}; i++) { W.dt = chooseDt(); step(W.dt); } R.s = ${s}; R.cx = ${cx}; R.cy = ${cy}; R.follow = null;`;
const SET = (k, v) => `setSetting('${k}', ${JSON.stringify(v)});`;
const CAM = (yaw, pitch, dist, fit) => `${fit ? 'cam3Fit(); ' : ''}Object.assign(R.cam3, { yaw: ${yaw}, pitch: ${pitch}${dist ? ', dist: ' + dist : ''}, tx: 0, ty: 0, tz: 0 }); cam3Update();`;
const CENTRE = `{ const c = W.parts.filter(p => !p.dead); R.cx = c.reduce((t, p) => t + p.x, 0) / c.length; R.cy = c.reduce((t, p) => t + p.y, 0) / c.length; }`;
const MOL3 = `baseWorld(16, 16, 300, 0.05); world3d(16); setRunning(false); [['benzene', -3.5, 2, 2], ['CH4', 3.5, 3.5, -3], ['NH3', 3, -3, 3], ['H2O', -3.5, -3.5, -3], ['CO2', 0, 0, 0], ['H2O', 4, 0.5, 4.5], ['CH4', -4, 4.5, -4.5]].forEach(([k, x, y, z], n) => addMolecule(k, x, y, n * 1.1, 0, z));`;
const SHOTS = [
  // ---- Graphics
  { key: 'segAtom', scene: P2('water', 34, 0, 0, 30), panels: [{ label: 'True size', run: SET('atomScale', 1) }, { label: 'Small', run: SET('atomScale', 0.45) }] },
  { key: 'segLabels', scene: `baseWorld(40, 28, 300, 0.05); addMolecule('CH3OH', 0, 0, 0.4, 0); setRunning(false); { const c = W.parts.filter(p => !p.dead); R.cx = c.reduce((t, p) => t + p.x, 0) / c.length; R.cy = c.reduce((t, p) => t + p.y, 0) / c.length; } R.s = 50;`,
    panels: [{ label: 'Always', run: `R.view.labels = true; ${SET('labels', 'always')} R.hover = null;` }, { label: 'On hover', run: `${SET('labels', 'hover')} R.hover = W.parts.find(p => p.Z === 8);` }, { label: 'Never', run: `R.view.labels = false; R.hover = null;` }],
    after: `R.view.labels = true; ${SET('labels', 'always')} R.hover = null;` },
  { key: 'segBadges', scene: P2('brine', 44, 0, 0, 0) + ` { const na = W.parts.find(p => p.Z === 11 && p.q > 0); if (na) { R.cx = na.x; R.cy = na.y; } }`,
    panels: [{ label: 'Always', run: SET('badges', 'always') }, { label: 'Never', run: SET('badges', 'never') }], after: SET('badges', 'always') },
  { key: 'setFx', scene: `baseWorld(40, 28, 3000, 0); for (const [x, y] of [[-3.2, 1.5], [1.5, 2.8], [3.6, -1.2]]) spawnSpec(SPEC_P, x, y, 0); for (const [x, y] of [[-1.2, -1.8], [-4, -2.6], [2.2, 0.6], [0, 3.6]]) spawnSpec({ kind: 'e' }, x, y, 0); addAtom('H', 4.4, 2.6); addAtom('H', -4.6, 3.6); setRunning(false); R.s = 40; R.cx = 0; R.cy = 0.5;`,
    panels: [{ label: 'On', run: SET('effects', true) }, { label: 'Off', run: SET('effects', false) }], after: SET('effects', true) },
  { key: 'setFlash', scene: P2('combustion', 22, 0, 0, 0) + ` setRunning(false); for (let k = 0; k < 7; k++) flash(-9 + 3 * k, (k % 2 ? 4 : -4), [255, 200, 120], 3 + k % 3, 3); W.rt += 0.15;`,
    panels: [{ label: 'Normal', run: SET('flashLow', false) }, { label: 'Fewer flashes', run: SET('flashLow', true) }], after: SET('flashLow', false) },
  { key: 'setCvd', scene: `baseWorld(40, 28, 300, 0.05); addMolecule('glycine', -1.5, 2.2, 0.2, 0); addMolecule('NH3', 3.2, -1.6, 0.5, 0); addAtom('Na', -3.4, -3, { charge: 1 }); addAtom('Cl', 0, -3.6, { charge: -1 }); setRunning(false); R.s = 40; R.cx = 0; R.cy = 0;`,
    panels: [{ label: 'Standard', run: SET('cvd', false) }, { label: 'Colour-blind friendly', run: SET('cvd', true) }], after: SET('cvd', false) },
  { key: 'segTrail', scene: `loadPreset('cloud'); fitView(); R.s *= 1.15; ${SET('trail', 4)} setRunning(true);`, wait: 4500, panels: [{ label: 'Long (4 s)', run: `setRunning(false); W.cloud = false;` }, { label: 'Short (½ s)', run: SET('trail', 0.5) }], after: SET('trail', 0.5) },
  { key: 'segRes', scene: P2('water', 30, 0, 0, 20), crop: { z: 3.2 },
    panels: [{ label: 'Sharp', run: SET('res', 'sharp') }, { label: 'Fast', run: SET('res', 'fast') }], after: SET('res', 'sharp'), dpr: 2 },
  { key: 'setFps', full: true, scene: P2('empty', 20, 0, 0, 0) + ` ${SET('fps', true)} setRunning(true);`, wait: 1500, keepBadge: true, crop: { x: 0.43, y: 0.33, z: 3.2 }, after: SET('fps', false),
    panels: [{ label: '', run: '' }] },
  // ---- Display (the whole window)
  { key: 'segUi', full: true, crop: { x: 0.2, y: 0.22, z: 2.2 }, scene: P2('water', 16, 0, 0, 0), dpr: 2,
    panels: [{ label: '90%', run: SET('ui', 0.9) }, { label: '150%', run: SET('ui', 1.5) }], after: SET('ui', 1) },
  { key: 'segSide', full: true, fit: true, scene: P2('combustion', 9, 0, 0, 0),
    panels: [{ label: 'On the right', run: SET('side', 'right') }, { label: 'On the left', run: SET('side', 'left') }], after: SET('side', 'right') },
  { key: 'setChamber', full: true, fit: true, scene: P2('combustion', 9, 0, 0, 0),
    panels: [{ label: 'Normal', run: `setChamberOnly(false); fitView();` }, { label: 'Chamber only', run: `setChamberOnly(true); fitView();` }], after: `setChamberOnly(false);` },
  { key: 'segTheme', full: true, scene: P2('water', 12, 0, 0, 0), crop: { x: 0.75, y: 0.5, z: 1.15 },
    panels: [{ label: 'Light', run: SET('theme', 'light') }, { label: 'Dark', run: SET('theme', 'dark') }], after: SET('theme', 'dark') },
  { key: 'setTips', full: true, crop: { x: 0.32, y: 0.3, z: 1.9 }, scene: `${SET('tips', true)} loadPreset('combustion'); setRunning(false);`, keepHint: true, panels: [{ label: '', run: '' }] },
  // ---- Experimental (the ultra-realistic mode moved here from General, 1.23.2)
  { key: 'setUltra', scene: `baseWorld(40, 28, 300, 0); for (const [x, y] of [[-3, 2], [2.5, 3], [0, -2.5]]) spawnSpec(SPEC_P, x, y, 0); for (const [x, y] of [[-4, -3], [4, -1]]) spawnSpec({ kind: 'e' }, x, y, 0); addAtom('H', 4.5, 3.6); addAtom('He', -4.6, 3.8); setRunning(false); R.s = 42; R.cx = 0; R.cy = 0;`,
    panels: [{ label: 'Normal', run: SET('ultra', false) }, { label: 'Ultra-realistic', run: SET('ultra', true) }], after: SET('ultra', false) },
  { key: 'segPi', scene: `baseWorld(30, 20, 300, 0.05); addMolecule('H2O', 0, 0, 0.3, 0); setRunning(false); R.s = 58;`, crop: { z: 2.6 },
    panels: [{ label: 'Off', run: CENTRE }, { label: '16 beads', run: `${SET('pi', 16)} for (let i = 0; i < 300; i++) { W.dt = chooseDt(); step(W.dt); } ${CENTRE}` }], after: SET('pi', 0) },
  { key: 'segWave', scene: `baseWorld(30, 20, 300, 0); for (const [x, y] of [[-4, 2], [-1, -2.5], [2.5, 2.2], [4.2, -1.8], [0.5, 0.4]]) spawnSpec({ kind: 'e' }, x, y, 0); addAtom('Ne', -4.5, -3); addAtom('Ne', 4.6, 3.4); setRunning(false); R.s = 36; R.cx = 0; R.cy = 0;`,
    panels: [{ label: 'Points', run: '' }, { label: 'Wave packets', run: `${SET('wave', 1)} W.dt = 1e-4; step(W.dt);` }], after: SET('wave', 0) },
  { key: 'segBo', scene: `baseWorld(30, 20, 300, 0); addAtom('H', -1.05, 0.9); addAtom('H', -0.1, 0.9); addAtom('H', 1.05, 0.9); addAtom('O', -0.9, -1.2); addAtom('H', 0.15, -1.2); addAtom('O', 1.35, -1.2); setRunning(false); R.s = 72; R.cx = 0; R.cy = 0;`,
    panels: [{ label: 'Stored', run: '' }, { label: 'From the positions', run: `${SET('bo', 1)} W.dt = 1e-4; step(W.dt);` }], after: SET('bo', 0) },
  { key: 'segBo:2', scene: `${SET('bo', 0)} baseWorld(24, 18, 300, 0.05); addMolecule('H3Op', -1.2, 0, 0, 0); { const O = W.parts.find(p => p.Z === 8), Hs = W.parts.filter(p => p.Z === 1), h = Hs.reduce((a, b) => (b.x > a.x ? b : a)), L = Math.hypot(h.x - O.x, h.y - O.y), dx = (h.x - O.x) / L, dy = (h.y - O.y) / L, ox = O.x + 2.45 * dx, oy = O.y + 2.45 * dy;
      let best = 0, bd = -1; for (let k = 0; k < 24; k++) { const n0 = W.parts.length; addMolecule('H2O', ox, oy, k * Math.PI / 12, 0); const nw = W.parts.slice(n0), w = nw.find(p => p.Z === 8), m = Math.min(...nw.filter(p => p.Z === 1).map(p => Math.hypot(p.x - h.x, p.y - h.y))); const d = m; if (d > bd) { bd = d; best = k; } for (const p of nw) kill(p); W.parts = W.parts.filter(p => !p.dead); }
      addMolecule('H2O', ox, oy, best * Math.PI / 12, 0); } ${SET('bo', 2)} setRunning(false); for (let i = 0; i < 30; i++) { W.dt = chooseDt(); step(W.dt); } R.s = 70; R.cx = 0; R.cy = 0;`,
    panels: [{ label: 'Quantum: a proton shared by two waters', run: '' }], after: SET('bo', 0) },
  // ---- 3-D
  { key: 'segFov3', scene: `${MOL3}`,
    panels: [{ label: '30°', run: `${SET('fov3', 30)} ${CAM(0.6, 0.4, 0, true)}` }, { label: '70°', run: `${SET('fov3', 70)} ${CAM(0.6, 0.4, 0, true)}` }], after: `${SET('fov3', 40)}` },
  { key: 'segProj3', scene: `${MOL3}`,
    panels: [{ label: 'Perspective', run: `${SET('proj3', 'persp')} ${CAM(0.6, 0.4, 0, true)}` }, { label: 'Orthographic', run: `${SET('proj3', 'ortho')} ${CAM(0.6, 0.4, 0, true)}` }], after: SET('proj3', 'persp') },
  { key: 'segFog3', scene: `baseWorld(34, 34, 300, 0.05); world3d(34); setRunning(false); lattice3(34, 5, (x, y, z, i, j, l) => addMolecule((i + j + l) % 2 ? 'H2O' : 'CH4', x, y, i + 2 * j + 3 * l, 0, z)); ${CAM(0.5, 0.22, 0, true)} R.cam3.dist *= 0.8;`,
    panels: [{ label: 'Off', run: SET('fog3', 'off') }, { label: 'High', run: SET('fog3', 'high') }], after: SET('fog3', 'normal') },
  { key: 'segBox3', scene: `${MOL3} R.view.grid = true; ${CAM(0.6, 0.4, 0, true)}`,
    panels: [{ label: 'Edges', run: SET('box3', 'grid') }, { label: 'Hidden', run: SET('box3', 'off') }], after: SET('box3', 'grid') },
  { key: 'setAxes3', scene: `${MOL3} ${CAM(0.9, 0.35, 0, true)}`, crop: { x: 0.1, y: 0.8, z: 2.6 }, labelTop: true,
    panels: [{ label: 'On', run: SET('axes3', true) }, { label: 'Off', run: SET('axes3', false) }], after: SET('axes3', true) },
  { key: 'segLbl3', scene: `baseWorld(16, 16, 300, 0.05); world3d(16); setRunning(false); addMolecule('H2O', -0.2, 0.3, 0.2, 0, 4); addMolecule('NH3', 0.5, -0.1, 2.2, 0, 0.5); addMolecule('CH4', -0.4, -0.3, 1, 0, -3); R.view.labels = true; ${SET('labels', 'always')} ${CAM(0.12, 0.08, 9, false)}`,
    panels: [{ label: 'Front atoms only', run: SET('lbl3', 'front') }, { label: 'All atoms', run: SET('lbl3', 'all') }], after: SET('lbl3', 'front') },
  { key: 'segOrbit3', scene: `${MOL3}`,
    panels: [{ label: 'Slow: the same drag', run: `${CAM(0.6, 0.4, 0, true)} R.cam3.yaw -= 0.4;`, draw: { drag: 1, arc: 0.4 } }, { label: 'Fast: the same drag', run: `${CAM(0.6, 0.4, 0, true)} R.cam3.yaw -= 1.6;`, draw: { drag: 1, arc: 1.6 } }], labelTop: true },
  { key: 'setOrbitInv', scene: `${MOL3}`,
    panels: [{ label: 'Normal', run: `${CAM(0.6, 0.4, 0, true)} R.cam3.yaw -= 0.8;`, draw: { drag: 1, arc: 0.8 } }, { label: 'Inverted', run: `${CAM(0.6, 0.4, 0, true)} R.cam3.yaw += 0.8;`, draw: { drag: 1, arc: -0.8 } }], labelTop: true },
  { key: 'segSpin3', scene: `${MOL3}`,
    panels: [{ label: '0 s', run: `${CAM(0.6, 0.4, 0, true)}` }, { label: '5 s', run: `${CAM(0.6, 0.4, 0, true)} R.cam3.yaw += 0.52;` }, { label: '10 s', run: `${CAM(0.6, 0.4, 0, true)} R.cam3.yaw += 1.05;`, draw: { arc: -1.05 } }], labelTop: true },
  // ---- 3-D versions of the flat game's pictures (1.25, asked for by the owner: "There should also be 3d pictures in 3d mode"):
  // key@3d (or key:value@3d), shown in the 3-D lab only, where what the setting changes is drawn in the chamber. None for
  // the window's own settings (interface size, panel side, chamber only, theme, tips, frame rate, resolution: the same
  // in both) and for what is not drawn in 3-D (quantum nuclei's beads, electrons as waves, the ultra-realistic mode's
  // sizes): those show the flat picture, marked as such
  { key: 'segAtom@3d', scene: `baseWorld(14, 14, 300, 0.05); world3d(14); setRunning(false); lattice3(12, 3, (x, y, z, i, j, l) => addMolecule('H2O', x, y, i + 2 * j + 3 * l, 0, z)); settleOverlaps(); ${SET('axes3', false)} ${CAM(0.6, 0.4, 0, true)} R.cam3.dist *= 0.75;`,
    panels: [{ label: 'True size', run: SET('atomScale', 1) }, { label: 'Small', run: SET('atomScale', 0.45) }], after: `${SET('atomScale', 1)} ${SET('axes3', true)}` },
  { key: 'segLabels@3d', scene: `baseWorld(14, 14, 300, 0.05); world3d(14); setRunning(false); addMolecule('CH3OH', 0, 2.4, 0.4, 0, 0); addMolecule('H2O', 0.4, -0.3, 2, 0, 1.5); addMolecule('NH3', -0.3, -2.8, 1.2, 0, -1); R.view.labels = true; ${SET('axes3', false)} ${CAM(0.35, 0.3, 12, false)}`,
    panels: [{ label: 'Always', run: `R.view.labels = true; ${SET('labels', 'always')} R.hover = null;` }, { label: 'On hover', run: `${SET('labels', 'hover')} R.hover = W.parts.find(p => p.Z === 8);` }, { label: 'Never', run: `R.view.labels = false; R.hover = null;` }],
    after: `R.view.labels = true; ${SET('labels', 'always')} R.hover = null; ${SET('axes3', true)}` },
  { key: 'segBadges@3d', scene: `baseWorld(14, 14, 300, 0.05); world3d(14); setRunning(false); addAtom('Na', -2.6, 0.4, { charge: 1, z: 0.5 }); addAtom('Cl', 2.8, -0.3, { charge: -1, z: -0.5 }); addAtom('Na', 1.5, 3.6, { charge: 1, z: -3 }); addAtom('Cl', -1.8, -3.8, { charge: -1, z: 3 }); lattice3(12, 3, (x, y, z, i, j, l) => { if ((i + j + l) % 2) addMolecule('H2O', x, y, i + 2 * j + 3 * l, 0, z); }); settleOverlaps(); ${SET('axes3', false)} ${CAM(0.6, 0.35, 0, true)} R.cam3.dist *= 0.8;`,
    panels: [{ label: 'Always', run: SET('badges', 'always') }, { label: 'Never', run: SET('badges', 'never') }], after: `${SET('badges', 'always')} ${SET('axes3', true)}` },
  { key: 'setFx@3d', scene: `baseWorld(16, 16, 3000, 0); world3d(16); for (const [x, y, z] of [[-3.2, 1.5, 2], [1.5, 2.8, -3], [3.6, -1.2, 1]]) spawnSpec(SPEC_P, x, y, 0, z); for (const [x, y, z] of [[-1.2, -1.8, -2], [-4, -2.6, 3], [2.2, 0.6, 3.5], [0, 3.6, -1]]) spawnSpec({ kind: 'e' }, x, y, 0, z); addAtom('H', 4.4, 2.6, { z: -2 }); addAtom('H', -4.6, 3.6, { z: 1 }); setRunning(false); ${SET('axes3', false)} ${CAM(0.5, 0.3, 0, true)} R.cam3.dist *= 0.7;`,
    panels: [{ label: 'On', run: SET('effects', true) }, { label: 'Off', run: SET('effects', false) }], after: `${SET('effects', true)} ${SET('axes3', true)}` },
  { key: 'setFlash@3d', scene: `baseWorld(24, 24, 600, 0.05); world3d(24); [['H2', -7, 4, 3], ['O2', -2, -5, -4], ['H2O', 5, 3, 5], ['H2', 7, -4, -2], ['O2', 1, 6, -6], ['H2O', -6, -3, 6]].forEach(([k, x, y, z], n) => addMolecule(k, x, y, n, 0, z)); setRunning(false); ${SET('axes3', false)} ${CAM(0.6, 0.4, 0, true)} R.cam3.dist *= 0.85; for (let k = 0; k < 7; k++) flash(-9 + 3 * k, (k % 2 ? 4 : -4), [255, 200, 120], 3 + k % 3, 3, (k % 3 - 1) * 6); W.rt += 0.15;`,
    panels: [{ label: 'Normal', run: SET('flashLow', false) }, { label: 'Fewer flashes', run: SET('flashLow', true) }], after: `${SET('flashLow', false)} ${SET('axes3', true)}` },
  { key: 'setCvd@3d', scene: `baseWorld(14, 14, 300, 0.05); world3d(14); addMolecule('glycine', -1.5, 1.8, 0.2, 0, 1); addMolecule('NH3', 3.2, -1.6, 0.5, 0, -1); addAtom('Na', -3.4, -2.6, { charge: 1, z: -2 }); addAtom('Cl', 0.4, -3.4, { charge: -1, z: 2 }); setRunning(false); ${SET('axes3', false)} ${CAM(0.3, 0.25, 13, false)}`,
    panels: [{ label: 'Standard', run: SET('cvd', false) }, { label: 'Colour-blind friendly', run: SET('cvd', true) }], after: `${SET('cvd', false)} ${SET('axes3', true)}` },
  { key: 'segTrail@3d', scene: `baseWorld(30, 30, 300, 0.05); world3d(30); addAtom('Ar', 0, 0, { z: 0 }); ${SET('axes3', false)} ${SET('trail', 4)} ${CAM(0.6, 0.4, 0, true)} R.view.tracks = true;
      for (let k = 0; k < 14; k++) { const u = rndDir(); fireSpec({ kind: 'e' }, 2 * u[0], 2 * u[1], u[0], u[1], 300 + 30 * k, false, 2 * u[2], u[2]); } W.simPerFrame = W.baseSpf = 1e-4; setRunning(true);`, wait: 4500,
    panels: [{ label: 'Long (4 s)', run: `setRunning(false);` }, { label: 'Short (½ s)', run: SET('trail', 0.5) }], after: `${SET('trail', 0.5)} ${SET('axes3', true)}` },
  { key: 'segBo@3d', scene: `baseWorld(12, 12, 300, 0); world3d(12); addAtom('H', -1.05, 0.9, { z: 0.3 }); addAtom('H', -0.1, 0.9, { z: 0 }); addAtom('H', 1.05, 0.9, { z: -0.3 }); addAtom('O', -0.9, -1.2, { z: -0.2 }); addAtom('H', 0.15, -1.2, { z: 0 }); addAtom('O', 1.35, -1.2, { z: 0.25 }); setRunning(false); ${SET('axes3', false)} ${CAM(0.35, 0.3, 7.5, false)}`,
    panels: [{ label: 'Stored', run: '' }, { label: 'From the positions', run: `${SET('bo', 1)} W.dt = 1e-4; step(W.dt);` }], after: `${SET('bo', 0)} ${SET('axes3', true)}` },
  { key: 'segBo:2@3d', scene: `${SET('bo', 0)} baseWorld(12, 12, 300, 0.05); world3d(12); addMolecule('H3Op', -1.2, 0, 0, 0, 0); { const O = W.parts.find(p => p.Z === 8), h = W.parts.filter(p => p.Z === 1).reduce((a, b) => (b.x > a.x ? b : a)), L = Math.hypot(h.x - O.x, h.y - O.y, h.z - O.z), ox = O.x + 2.45 * (h.x - O.x) / L, oy = O.y + 2.45 * (h.y - O.y) / L, oz = O.z + 2.45 * (h.z - O.z) / L;
      let best = 0, bd = -1; for (let k = 0; k < 24; k++) { const n0 = W.parts.length; addMolecule('H2O', ox, oy, k * Math.PI / 12, 0, oz); const nw = W.parts.slice(n0), d = Math.min(...nw.filter(p => p.Z === 1).map(p => Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z))); if (d > bd) { bd = d; best = k; } for (const p of nw) kill(p); W.parts = W.parts.filter(p => !p.dead); }
      addMolecule('H2O', ox, oy, best * Math.PI / 12, 0, oz); } ${SET('bo', 2)} setRunning(false); for (let i = 0; i < 30; i++) { W.dt = chooseDt(); step(W.dt); } ${SET('axes3', false)} ${CAM(0.25, 0.3, 7, false)}`,
    panels: [{ label: 'Quantum: a proton shared by two waters', run: '' }], after: `${SET('bo', 0)} ${SET('axes3', true)}` },
  // ---- the main menu's first screen
  { key: 'menu2d', scene: `loadPreset('gallery'); setRunning(false); fitView(); R.s *= 2.3; R.cy += 2;`, panels: [{ label: '', run: '' }] },
  { key: 'menu3d', scene: `loadPreset('water3d'); setRunning(false); ${SET('axes3', false)} ${CAM(0.55, 0.38, 0, true)} R.cam3.dist *= 0.86;`, panels: [{ label: '', run: '' }], after: SET('axes3', true) },
];

(async () => {
  execSync('node build.js', { cwd: ROOT, stdio: 'ignore' });
  const { openPage } = require(path.join(ROOT, 'tests', 'browser.js'));
  const todo = ONLY.length ? SHOTS.filter(s => ONLY.includes(s.key)) : SHOTS;
  if (ONLY.length && todo.length !== ONLY.length) throw new Error('unknown key: ' + ONLY.filter(k => !SHOTS.some(s => s.key === k)).join(', '));
  let old = {};
  try { const m = {}; new Function('module', fs.readFileSync(OUT, 'utf8').replace(/^'use strict';/, '') + '\nmodule.SETSHOTS = SETSHOTS;')(m); old = m.SETSHOTS || {}; } catch (e) { old = {}; }
  const out = ONLY.length ? Object.assign({}, old) : {};
  if (PNG_DIR) fs.mkdirSync(PNG_DIR, { recursive: true });
  const pages = {};
  const pageFor = async (dpr) => {
    if (pages[dpr]) return pages[dpr];
    const p = await openPage({ viewport: { width: VW, height: VH }, dpr, scheme: 'dark', settle: 900 });
    await p.page.evaluate(() => { setSetting('theme', 'dark'); setSetting('fps', false); setSetting('tips', false); setSetting('startPaused', false); setSetting('motion', false); UI.tour = null; store('toured', '1'); });
    return (pages[dpr] = p);
  };
  for (const sh of todo) {
    const { page, errors } = await pageFor(sh.dpr || 2); // (2×: sharp at 1280 × 720, 1.23.2)
    const style = await page.addStyleTag({ content: `${sh.keepBadge ? '' : '#fpsBadge,'} ${sh.keepHint ? '' : '#hint,'} #narr, .tip, #tour, .toast, #toasts { visibility: hidden !important; }` });
    await page.evaluate((full) => { setChamberOnly(!full); R.hover = null; R.sel = null; }, !!sh.full);
    await page.waitForTimeout(150);
    if (sh.scene) await page.evaluate(sh.scene);
    if (sh.wait) await page.waitForTimeout(sh.wait);
    const caps = [];
    for (const pn of sh.panels) {
      if (pn.run) await page.evaluate(pn.run);
      await page.evaluate(() => render(W.rt));
      await page.waitForTimeout(sh.full ? 350 : 120);
      await page.evaluate(() => render(W.rt));
      const png = await page.screenshot({ type: 'png' });
      caps.push({ src: 'data:image/png;base64,' + png.toString('base64'), label: pn.label, draw: pn.draw || null });
    }
    if (sh.after) await page.evaluate(sh.after);
    await style.evaluate((n) => n.remove());
    const url = await page.evaluate(async ([caps, crop, W, H, Q, fit, top, S]) => {
      const load = (s) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = s; });
      const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S; const g = cv.getContext('2d'); g.scale(S, S); // (laid out at 640 × 360, drawn at S×)
      g.fillStyle = '#05090e'; g.fillRect(0, 0, W, H);
      const n = caps.length, pw = W / n;
      for (let k = 0; k < n; k++) {
        const im = await load(caps[k].src), c = crop || {}, z = c.z || 1;
        if (fit) { g.save(); g.beginPath(); g.rect(k * pw, 0, pw, H); g.clip(); const sc = Math.min(pw / im.width, H / im.height) * 0.94, dw = im.width * sc, dh = im.height * sc;
          g.imageSmoothingQuality = 'high'; g.drawImage(im, k * pw + (pw - dw) / 2, (H - dh) / 2 - 12, dw, dh); g.strokeStyle = 'rgba(150,182,214,0.35)'; g.strokeRect(k * pw + (pw - dw) / 2 + 0.5, (H - dh) / 2 - 11.5, dw - 1, dh - 1); g.restore(); }
        else {
        const sh = im.height / z, sw = sh * (pw / H), cx = (c.x === undefined ? 0.5 : c.x) * im.width, cy = (c.y === undefined ? 0.5 : c.y) * im.height;
        const sx = Math.max(0, Math.min(im.width - sw, cx - sw / 2)), sy = Math.max(0, Math.min(im.height - sh, cy - sh / 2));
        g.save(); g.beginPath(); g.rect(k * pw, 0, pw, H); g.clip();
        g.imageSmoothingQuality = 'high'; g.drawImage(im, sx, sy, sw, sh, k * pw, 0, pw, H);
        const d = caps[k].draw;
        if (d) { // marks: the drag (a straight arrow under the box) and the turn it makes (an arc round the vertical)
          const x0 = k * pw + pw / 2, y0 = H * 0.5;
          const arrow = (x, y, ang, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(x + 9 * Math.cos(ang), y + 9 * Math.sin(ang)); g.lineTo(x + 7 * Math.cos(ang + 2.4), y + 7 * Math.sin(ang + 2.4)); g.lineTo(x + 7 * Math.cos(ang - 2.4), y + 7 * Math.sin(ang - 2.4)); g.closePath(); g.fill(); };
          g.lineWidth = 3; g.lineCap = 'round';
          if (d.arc) { // an arc in perspective: an ellipse round the box's vertical axis, as far as the view turned
            const rx = pw * 0.36, ry = H * 0.08, yc = H * 0.8, a0 = Math.PI / 2, a1 = a0 - d.arc, sg = Math.sign(d.arc); // (positive: the box's front moves right)
            g.strokeStyle = 'rgba(111,156,255,0.95)'; g.beginPath(); g.ellipse(x0, yc, rx, ry, 0, Math.min(a0, a1), Math.max(a0, a1)); g.stroke();
            const ex = x0 + rx * Math.cos(a1), ey = yc + ry * Math.sin(a1), tang = Math.atan2(-ry * Math.cos(a1) * sg, rx * Math.sin(a1) * sg);
            arrow(ex, ey, tang, 'rgba(111,156,255,0.95)');
          }
          if (d.drag) { // the drag itself, the same in both: left to right along the top
            const y = H * 0.955, xa = x0 - pw * 0.12, xb = x0 + pw * 0.2;
            g.strokeStyle = 'rgba(238,243,248,0.9)'; g.setLineDash([2, 6]); g.beginPath(); g.moveTo(xa, y); g.lineTo(xb, y); g.stroke(); g.setLineDash([]);
            arrow(xb, y, 0, 'rgba(238,243,248,0.9)');
            g.fillStyle = 'rgba(238,243,248,0.9)'; g.font = '600 13px "Hanken Grotesk", system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText('drag', xa - 8, y); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
          }
        }
        g.restore();
        }
        if (k > 0) { g.fillStyle = 'rgba(150,182,214,0.45)'; g.fillRect(k * pw - 1, 0, 2, H); }
        if (caps[k].label) {
          g.font = '600 17px "Hanken Grotesk", system-ui, sans-serif'; const tw = g.measureText(caps[k].label).width, bx = k * pw + 10, by = top ? 10 : H - 38;
          g.fillStyle = 'rgba(8,13,20,0.82)'; g.strokeStyle = 'rgba(150,182,214,0.35)'; g.lineWidth = 1;
          g.beginPath(); g.roundRect(bx, by, tw + 20, 28, 8); g.fill(); g.stroke();
          g.fillStyle = '#e8eef5'; g.textBaseline = 'middle'; g.fillText(caps[k].label, bx + 10, by + 14.5); g.textBaseline = 'alphabetic';
        }
      }
      return cv.toDataURL('image/webp', Q);
    }, [caps, sh.crop || null, W, H, Q, !!sh.fit, !!sh.labelTop, S]);
    if (!/^data:image\/webp;base64,/.test(url)) throw new Error(sh.key + ': this Chromium did not encode WebP');
    out[sh.key] = url;
    const kb = (url.length / 1024).toFixed(1);
    if (PNG_DIR) { // (a PNG of the picture as it will show, to look at)
      const png = await page.evaluate(async (u) => { const im = new Image(); await new Promise(r => { im.onload = r; im.src = u; }); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c.toDataURL('image/png'); }, url);
      fs.writeFileSync(path.join(PNG_DIR, sh.key.replace(':', '_') + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    }
    console.log(`${sh.key.padEnd(12)} ${kb.padStart(6)} KB${errors.length ? '  page errors: ' + errors.splice(0).join(' | ').slice(0, 300) : ''}`);
  }
  for (const p of Object.values(pages)) await p.browser.close();
  const keys = Object.keys(out).sort();
  const body = `'use strict';\n/* Generated by tools/setshots.js: pictures for Settings' preview pane and the main menu's first screen (key → WebP\n   data URL, 1280 × 720). Do not edit; run node tools/setshots.js [key …] again. */\nconst SETSHOTS = {\n${keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(out[k])},`).join('\n')}\n};\nif (typeof module !== 'undefined') module.exports = { SETSHOTS };\n`;
  fs.writeFileSync(OUT, body);
  console.log(`${keys.length} pictures, ${(body.length / 1024).toFixed(0)} KB in src/setshots.gen.js`);
})().catch((e) => { console.error(e); process.exit(1); });
