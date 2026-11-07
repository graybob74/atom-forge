'use strict';
/* Where the test tools (Playwright, ESLint) come from: the repository's own node_modules (`npm install` at its root, as on
   a PC), else AF_NODE_MODULES, else the folder preinstalled in Claude's workspace (/opt/node-tools/node_modules). */
const fs = require('fs'), path = require('path');
const DIRS = [path.join(__dirname, '..', 'node_modules'), process.env.AF_NODE_MODULES, '/opt/node-tools/node_modules'].filter(Boolean);
function dep(rel) {
  for (const d of DIRS) { const p = path.join(d, rel); if (fs.existsSync(p) || fs.existsSync(p + '.js') || fs.existsSync(path.join(p, 'package.json'))) return require(p); }
  throw new Error(`test tool not found: ${rel} (run "npm install" in the repository, then "npx playwright install chromium")`);
}
module.exports = { dep };
