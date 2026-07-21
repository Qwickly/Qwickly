const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..', 'node_modules', '.pnpm');
const packageDirs = fs.readdirSync(packageRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith('whatsapp-web.js@'));

if (packageDirs.length === 0) {
  console.log('No whatsapp-web.js package found to patch');
  process.exit(0);
}

for (const dir of packageDirs) {
  const pkgRoot = path.join(packageRoot, dir.name, 'node_modules', 'whatsapp-web.js');
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
