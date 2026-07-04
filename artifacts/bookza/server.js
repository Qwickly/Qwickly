import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, 'dist/public');

console.log('Server starting...');
console.log('Dist path:', distPath);
console.log('PORT:', PORT);

const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

app.get('*', (req, res) => {
  const pathname = req.path;
  console.log('Request:', pathname);
  
  if (pathname === '/') {
    console.log('Serving index.html');
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  
  const filePath = path.join(distPath, pathname.replace(/^\//, ''));
  console.log('Checking file:', filePath);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    console.log('File exists, serving:', filePath);
    res.setHeader('Content-Type', getMimeType(filePath));
    return res.sendFile(filePath);
  }
  
  console.log('File not found, serving index.html');
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
