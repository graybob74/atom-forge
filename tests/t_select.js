'use strict';
/* The Select tool in the real page (headless Chromium): a box picks particles (whole molecules), Copy/Paste reproduce
   them with their bonds, a paste with no room is refused rather than landing on top of what is there, a paste into an
   empty box works and the pasted group can be dragged, Delete and Select all work, and nothing explodes afterwards. */
const path = require('path');
const { openPage } = require(path.join(__dirname, 'browser.js'));
let fails = 0;
const check = (ok, what, detail) => { if (ok) console.log('  ' + what); else { fails++; console.log('FAIL ' + what + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); } };
(async () => {
  const { browser, page, errors } = await openPage({ settle: 800 });
  const r = await page.evaluate(async () => {
    const out = {};
    const cv = R.cv, rect = cv.getBoundingClientRect();
    const ev = (type, x, y, extra = {}) => cv.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: rect.left + x, clientY: rect.top + y, isPrimary: true }, extra)));
    const alive = () => W.parts.filter(p => !p.dead).length;
    loadPreset('water'); setRunning(false); setTool('select'); fitView();
    out.n0 = alive();
    const cx = R.w / 2, cy = R.h / 2;
    ev('pointerdown', cx - 60, cy - 60); ev('pointermove', cx - 30, cy - 30); ev('pointermove', cx + 60, cy + 60); ev('pointerup', cx + 60, cy + 60);
    out.nsel = R.msel.size; out.wholeMolecules = [...R.msel].every(p => molecule(p).every(a => R.msel.has(a)));
    out.opts = document.getElementById('toolopts').textContent;
    copySelection(); out.clip = UI.clip ? UI.clip.parts.length : 0; out.clipBonds = UI.clip ? UI.clip.bonds.length : 0;
    UI.mouse = [cx + 150, cy + 150]; pasteClip(); out.nAfterFullPaste = alive(); // (liquid: no room)
    out.fullPasteLog = W.log.length ? W.log[W.log.length - 1].text : '';
    // Shift-click toggles one; Delete removes the selection
    const p0 = [...R.msel][0]; ev('pointerdown', w2sx(p0.x), w2sy(p0.y), { shiftKey: true }); ev('pointerup', w2sx(p0.x), w2sy(p0.y), { shiftKey: true });
    out.toggledOff = !R.msel.has(p0) && molecule(p0).every(a => !R.msel.has(a)); out.nselAfterToggle = R.msel.size;
    deleteSelection(); out.nAfterDelete = alive();
    selectAll(); out.all = R.msel.size; clearSelection(); out.cleared = R.msel.size;
    // the clipboard survives a change of setup: paste into an empty box, twice, then drag the pasted group
    loadPreset('empty'); setRunning(false); fitView();
    UI.mouse = [R.w / 2, R.h / 2]; pasteClip(); out.n1 = alive(); out.bonds1 = W.bonds.length; out.selAfterPaste = R.msel.size; out.toolAfterPaste = UI.tool;
    UI.mouse = [R.w / 2 + 120, R.h / 2]; pasteClip(); out.n2 = alive();
    // Ctrl+V picks the copy up (a ghost follows the pointer), a click puts it down exactly there; Escape puts it away
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    out.armed = UI.pasting && !!R.ghost && /click where/.test(document.getElementById('toolopts').textContent);
    ev('pointermove', R.w / 2 - 150, R.h / 2 + 80); out.ghostFollows = !!R.ghost && Math.abs(R.ghost.x - s2w(R.w / 2 - 150, R.h / 2 + 80)[0]) < 1e-9;
    const nBefore = alive(); ev('pointerdown', R.w / 2 - 150, R.h / 2 + 80); ev('pointerup', R.w / 2 - 150, R.h / 2 + 80);
    let gx = 0, gy = 0; for (const p of R.msel) { gx += p.x; gy += p.y; } gx /= R.msel.size; gy /= R.msel.size;
    const [tx, ty] = s2w(R.w / 2 - 150, R.h / 2 + 80);
    out.clickPasted = alive() === nBefore + UI.clip.parts.length; out.clickOff = Math.hypot(gx - tx, gy - ty); out.disarmed = !UI.pasting && !R.ghost;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })); const armed2 = UI.pasting;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.escCancels = armed2 && !UI.pasting && !R.ghost && alive() === nBefore + UI.clip.parts.length;
    const q = [...R.msel][0], sx = w2sx(q.x), sy = w2sy(q.y), before = [q.x, q.y];
    ev('pointerdown', sx, sy); ev('pointermove', sx + 40, sy + 10); ev('pointerup', sx + 40, sy + 10);
    out.moved = Math.hypot(q.x - before[0], q.y - before[1]);
    setRunning(true); for (let i = 0; i < 60; i++) { W.dt = chooseDt(); step(W.dt); }
    out.T = measure().T; out.n3 = alive();
    return out;
  });
  console.log('select:', JSON.stringify(r));
  check(r.nsel > 0 && r.nsel % 3 === 0 && r.wholeMolecules, 'a box round liquid water picks whole molecules', r.nsel);
  check(/selected/.test(r.opts) && /Copy/.test(r.opts) && /Paste/.test(r.opts), 'the tool options show the selection and the actions');
  check(r.clip === r.nsel && r.clipBonds === 2 * (r.nsel / 3), 'Copy takes the particles and their bonds', [r.clip, r.clipBonds]);
  check(r.nAfterFullPaste === r.n0 && /no clear spot/.test(r.fullPasteLog), 'a paste with no room is refused with a note', r.fullPasteLog);
  check(r.toggledOff && r.nselAfterToggle === r.nsel - 3, 'Shift-click takes a molecule out of the selection', [r.toggledOff, r.nselAfterToggle]);
  check(r.nAfterDelete === r.n0 - r.nselAfterToggle, 'Delete removes the selection', [r.n0, r.nselAfterToggle, r.nAfterDelete]);
  check(r.all === r.nAfterDelete && r.cleared === 0, 'Select all and Clear', [r.all, r.cleared]);
  check(r.n1 === r.clip && r.bonds1 === r.clipBonds && r.selAfterPaste === r.clip && r.toolAfterPaste === 'select', 'a paste into an empty box makes the copies, bonded, as the new selection', [r.n1, r.bonds1, r.selAfterPaste]);
  check(r.n2 === 2 * r.clip, 'a second paste adds another copy', r.n2);
  check(r.armed && r.ghostFollows, 'Ctrl+V picks the copy up and its ghost follows the pointer', [r.armed, r.ghostFollows]);
  check(r.clickPasted && r.clickOff < 0.01 && r.disarmed, 'a click puts the copy down exactly there, once', [r.clickPasted, r.clickOff, r.disarmed]);
  check(r.escCancels, 'Escape puts a picked-up copy away without pasting');
  check(r.moved > 1, 'dragging the selection moves it (Å)', r.moved);
  check(r.T < 1500 && r.n3 === r.n2 + r.clip, 'the pasted molecules run on without flying apart', [r.T, r.n3]);
  check(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await browser.close();
  console.log(fails ? `${fails} select failure(s)` : 'select checks passed');
  process.exitCode = fails ? 1 : 0;
})();
