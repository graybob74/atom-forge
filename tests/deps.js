'use strict';
/* Where the test tools (Playwright, ESLint) come from: the repository's own node_modules (`npm install` at its root, as on
   a PC), else AF_NODE_MODULES, else the folder preinstalled in Claude's workspace (/opt/node-tools/node_modules). */
const fs = require('fs'), path = require('path');
const DIRS = [path.join(__dirname, '..', 'node_modules'), process.env.AF_NODE_MODULES, '/opt/node-tools/node_modules'].filter(Boolean);
function dep(rel) {
  for (const d of DIRS) { const p = path.join(d, rel); if (fs.existsSync(p) || fs.existsSync(p + '.js') || fs.existsSync(path.join(p, 'package.json'))) return require(p); }
  throw new Error(`test tool not found: ${rel} (run "npm install" in the repository, then "npx playwright install chromium")`);
}
/* Chromium's launch options. AF_SOFTWARE_GL=1 forces WebGL onto SwiftShader (the CPU renderer the cloud workspace's
   headless Chromium uses anyway), for a PC whose GPU path draws a frame not quite bit for bit the same each time. */
function launchOpts(o) { return process.env.AF_SOFTWARE_GL ? { ...o, args: [...(o.args || []), '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : o; }
module.exports = { dep, launchOpts };
