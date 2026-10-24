'use strict';
/* Touch (0.69): a phone-sized page with a touchscreen. A tap places a particle; a drag with the Objects tool draws a
   wall; a long press opens the quick menu, takes back what the press itself made, and lifting the finger does not
   click the item under it. node tests/t_touch.js */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { pageFile } = require('./browser');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.addInitScript(() => { window.AF_NO_MENU = true; window.AF_NO_PAUSE = true; });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + pageFile()); await page.waitForTimeout(800);
  await page.evaluate(() => { loadPreset('empty'); setRunning(false); setTool('place'); });
  const box = await (await page.$('#cv') || await page.$('canvas')).boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const n0 = await page.evaluate(() => W.parts.length);
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.waitForTimeout(200);
  const placed = await page.evaluate(() => W.parts.length) - n0;
  await page.evaluate(() => { setTool('objects'); OPT.objects.kind = 'wall'; buildToolOpts(); });
  const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.4;
  await tp('touchStart', x0, y0); for (let i = 1; i <= 5; i++) await tp('touchMove', x0 + i * 20, y0 + i * 5); await tp('touchEnd'); await page.waitForTimeout(200);
  const drawn = await page.evaluate(() => W.objs.map(o => o.kind + ' ' + objLen(o).toFixed(1)).join());
  await tp('touchStart', box.x + box.width * 0.6, box.y + box.height * 0.65); await page.waitForTimeout(800); await tp('touchEnd'); await page.waitForTimeout(300);
  const lp = await page.evaluate(() => ({ menu: !$('qmenu').hidden, objs: W.objs.length }));
  const ok = placed === 1 && /^wall \d/.test(drawn) && lp.menu && lp.objs === 1 && !errors.length;
  console.log(`  tap placed ${placed}; drag drew ${drawn} Å; long press: menu ${lp.menu ? 'open' : 'closed'}, ${lp.objs} object(s) kept${errors.length ? '; errors ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(ok ? 'touch checks passed' : '1 touch failure(s)');
  process.exitCode = ok ? 0 : 1;
})();
