'use strict';
/* Puts the built page where the desktop shell serves it from: desktop/dist-app/index.html (Tauri's frontendDist). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'desktop', 'dist-app');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'dist', 'atom-forge.html'), path.join(out, 'index.html'));
console.log('staged', path.join(out, 'index.html'));
