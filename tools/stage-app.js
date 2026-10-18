'use strict';
/* Puts the built page where the desktop shell serves it from: desktop/dist-app/index.html (Tauri's frontendDist).
   The built page is a document body (the artifact host wraps it); here it gets its own head, as the host gives it:
   without the doctype and charset the page would render in quirks mode and read as Windows-1252. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'desktop', 'dist-app');
const head = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), head + fs.readFileSync(path.join(root, 'dist', 'atom-forge.html'), 'utf8') + '\n</body></html>\n');
console.log('staged', path.join(out, 'index.html'));
