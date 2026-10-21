'use strict';
/* Headless Chromium (the one preinstalled for Playwright) with the page wrapped exactly as publishing wraps it. */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
function pageFile() {
  const head = fs.readFileSync(path.join(__dirname, 'skeleton-head.html'), 'utf8').replace(/\n$/, '');
  const body = fs.readFileSync(path.join(ROOT, 'dist', 'atom-forge.html'), 'utf8');
  const out = path.join(__dirname, '.tmp', 'page.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, head + '\n' + body + '\n</body></html>');
  return out;
}
async function openPage(opts = {}) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1360, height: 860 }, deviceScaleFactor: opts.dpr || 1, colorScheme: opts.scheme || 'light' });
  // the page asks Google for fonts; there is no network here, so answer at once
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (!opts.menu) await ctx.addInitScript(() => { window.AF_NO_MENU = true; }); // (the main menu would cover the chamber the tests work in)
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/software WebGL|GL Driver Message/.test(m.text())) errors.push(m.type() + ': ' + m.text()); }); // (headless Chromium's software-GL notices are not the page's)
  await page.goto('file://' + pageFile() + (opts.hash ? '#' + opts.hash : ''));
  await page.waitForTimeout(opts.settle === undefined ? 600 : opts.settle);
  return { browser, ctx, page, errors };
}
module.exports = { openPage, pageFile };
