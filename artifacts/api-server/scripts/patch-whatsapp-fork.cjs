const fs = require('node:fs');
const path = require('node:path');

function findPackageDirs(startDir) {
  const results = [];
  if (!fs.existsSync(startDir)) return results;

  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('whatsapp-web.js@')) {
        results.push(fullPath);
      }
      results.push(...findPackageDirs(fullPath));
    }
  }
  return results;
}

const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
const packageRoots = findPackageDirs(path.join(workspaceRoot, 'node_modules'));

if (packageRoots.length === 0) {
  console.log('No whatsapp-web.js package found to patch');
  process.exit(0);
}

for (const packageRoot of packageRoots) {
  const pkgRoot = path.join(packageRoot, 'node_modules', 'whatsapp-web.js');
  if (!fs.existsSync(pkgRoot)) continue;

  const targetDir = path.join(pkgRoot, 'src', 'util', 'Injected', 'AuthStore');
  const targetFile = path.join(targetDir, 'AuthStore.js');

  fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(targetFile)) {
    fs.writeFileSync(targetFile, "'use strict';\n\nmodule.exports = require('../AuthStore');\n");
    console.log(`Patched ${targetFile}`);
  } else {
    console.log(`Already patched ${targetFile}`);
  }
}
