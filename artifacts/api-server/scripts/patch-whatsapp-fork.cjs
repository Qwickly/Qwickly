const fs = require('node:fs');
const path = require('node:path');

function findPackageDirs(startDir) {
  const results = [];
  if (!fs.existsSync(startDir)) return results;

  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'whatsapp-web.js' ||
        entry.name.startsWith('whatsapp-web.js@')
      ) {
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
  let pkgRoot = path.join(packageRoot, 'node_modules', 'whatsapp-web.js');
  const directPackageRoot = packageRoot;

  if (!fs.existsSync(path.join(pkgRoot, 'src', 'Client.js'))) {
    if (fs.existsSync(path.join(directPackageRoot, 'src', 'Client.js'))) {
      pkgRoot = directPackageRoot;
    } else {
      continue;
    }
  }

  const targetDir = path.join(pkgRoot, 'src', 'util', 'Injected', 'AuthStore');
  const targetFile = path.join(targetDir, 'AuthStore.js');

  fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(targetFile)) {
    fs.writeFileSync(targetFile, "'use strict';\n\nmodule.exports = require('../AuthStore');\n");
    console.log(`Patched ${targetFile}`);
  } else {
    console.log(`Already patched ${targetFile}`);
  }

  const clientFile = path.join(pkgRoot, 'src', 'Client.js');
  if (fs.existsSync(clientFile)) {
    const clientSource = fs.readFileSync(clientFile, 'utf8');
    const marker = "await this.pupPage.evaluate(ExposeAuthStore);";
    if (!clientSource.includes("waitForFunction(\"typeof window.require === 'function' && window.require('WAWebRegistrationUtils') !== undefined\"")) {
      const patchedSource = clientSource.replace(
        marker,
        `        await this.pupPage.waitForFunction(\n          () => {\n            try {\n              return (\n                typeof window.require === 'function' &&\n                window.require('WAWebSocketModel') !== undefined &&\n                window.require('WAWebRegistrationUtils') !== undefined\n              );\n            } catch {\n              return false;\n            }\n          },\n          { timeout: 60000 },\n        );\n        ${marker}`,
      );
      fs.writeFileSync(clientFile, patchedSource, 'utf8');
      console.log(`Patched ${clientFile} to wait for WAWebRegistrationUtils`);
    } else {
      console.log(`Client.js already patched: ${clientFile}`);
    }
  }
}
