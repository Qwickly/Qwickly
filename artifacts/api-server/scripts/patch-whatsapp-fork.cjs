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

  // QWICKLY PATCH: Resolve RegistrationUtils and Base64Tools fallbacks in the main AuthStore.js file for fork compatibility
  const authStoreFile = path.join(pkgRoot, 'src', 'util', 'Injected', 'AuthStore.js');
  if (fs.existsSync(authStoreFile)) {
    const source = fs.readFileSync(authStoreFile, 'utf8');
    if (!source.includes('WAWebCompanionRegClientUtils')) {
      const patched = source
        .replace(
          "window.AuthStore.Base64Tools = window.require('WAWebBase64');",
          "try { window.AuthStore.Base64Tools = window.require('WAWebBase64'); } catch { window.AuthStore.Base64Tools = window.require('WABase64'); }"
        )
        .replace(
          "window.AuthStore.RegistrationUtils = window.require('WAWebRegistrationUtils');",
          `try {
        window.AuthStore.RegistrationUtils = window.require('WAWebRegistrationUtils');
    } catch {
        window.AuthStore.RegistrationUtils = {
            ...window.require('WAWebCompanionRegClientUtils'),
            ...window.require('WAWebAdvSignatureApi'),
            ...window.require('WAWebUserPrefsInfoStore'),
            ...window.require('WAWebSignalStoreApi'),
        };
    }`
        );
      fs.writeFileSync(authStoreFile, patched, 'utf8');
      console.log(`Patched RegistrationUtils and Base64Tools fallback in ${authStoreFile}`);
    } else {
      console.log(`AuthStore.js already patched in ${authStoreFile}`);
    }
  }

  const clientFile = path.join(pkgRoot, 'src', 'Client.js');
  if (fs.existsSync(clientFile)) {
    const clientSource = fs.readFileSync(clientFile, 'utf8');
    const marker = "await this.pupPage.evaluate(ExposeAuthStore);";
    const oldPatchMarker = "// QWICKLY PATCH:";
    
    // Clean old patch if present to start fresh
    let cleanSource = clientSource;
    if (clientSource.includes(oldPatchMarker)) {
      const startIndex = clientSource.indexOf(oldPatchMarker);
      const endIndex = clientSource.indexOf(marker, startIndex) + marker.length;
      if (startIndex !== -1 && endIndex !== -1) {
        cleanSource = clientSource.slice(0, startIndex) + marker + clientSource.slice(endIndex);
        console.log(`Reverted old patch in ${clientFile}`);
      }
    }

    const alreadyPatched = cleanSource.includes(
      "window.require('WAWebCmd') !== undefined",
    );

    if (!alreadyPatched) {
      const patchedSource = cleanSource.replace(
        marker,
        `        // QWICKLY PATCH: wait for WhatsApp Web registration modules before injecting AuthStore\n        await this.pupPage.waitForFunction(\n          () => {\n            try {\n              return (\n                typeof window.require === 'function' &&\n                window.require('WAWebSocketModel') !== undefined &&\n                window.require('WAWebCmd') !== undefined &&\n                window.require('WAWebConnModel') !== undefined &&\n                window.require('WAWebUserPrefsMultiDevice') !== undefined\n              );\n            } catch {\n              return false;\n            }\n          },\n          { timeout: 60000 },\n        );\n        ${marker}`,
      );
      fs.writeFileSync(clientFile, patchedSource, 'utf8');
      console.log(`Patched ${clientFile} with updated WAWeb modules wait`);
    } else {
      console.log(`Client.js already patched: ${clientFile}`);
    }
  }
}
