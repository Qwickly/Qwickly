import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, 'dist/public');

const normalizeApiUrl = (value) => {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
};

const resolveApiUrl = () => {
  const value = process.env.VITE_API_URL || '';
  if (value) return normalizeApiUrl(value);

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return normalizeApiUrl(process.env.RAILWAY_PUBLIC_DOMAIN);
  }

  return 'https://qwickly-production.up.railway.app';
};

const writeRuntimeEnvConfig = () => {
  const apiUrl = resolveApiUrl();
  const envConfigPath = path.join(distPath, 'env-config.js');
  const content = `// Auto-generated at container startup\nwindow.__ENV__ = { "VITE_API_URL": "${apiUrl}" };\n`;
  fs.mkdirSync(distPath, { recursive: true });
  fs.writeFileSync(envConfigPath, content, 'utf8');
  console.log('Wrote runtime env-config.js with API URL:', apiUrl);
};

console.log('Server starting...');
console.log('Dist path:', distPath);
console.log('PORT:', PORT);
writeRuntimeEnvConfig();

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

app.use(express.static(distPath, { index: false }));

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.get('*', (req, res) => {
  const pathname = req.path;
  console.log('Request:', pathname);

  const filePath = path.join(distPath, pathname.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.setHeader('Content-Type', getMimeType(filePath));
    return res.sendFile(filePath);
  }

  const htmlFilePath = filePath + '.html';
  if (fs.existsSync(htmlFilePath) && fs.statSync(htmlFilePath).isFile()) {
    res.setHeader('Content-Type', 'text/html');
    return res.sendFile(htmlFilePath);
  }

  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    const appRoutes = ['/login', '/signup', '/register', '/dashboard', '/calendar', '/bookings', '/clients', '/services', '/staff', '/payments', '/analytics', '/whatsapp', '/marketing', '/booking-page', '/ai-assistant', '/settings', '/billing'];
    const shouldUseReactApp = appRoutes.includes(pathname) || pathname.startsWith('/clients/') || pathname.startsWith('/staff/') || pathname.startsWith('/book/') || pathname.startsWith('/booking/manage/');

    if (shouldUseReactApp) {
      const html = fs.readFileSync(indexPath, 'utf8');
      const mountedHtml = html.replace('<body>', '<body><div id="root"></div>');
      return res.type('html').send(mountedHtml.replace(/<script type="module">[\s\S]*?<\/script>\s*<script src="\/assets\/qwickly-auth-nav\.js" defer><\/script>\s*<script src="\/assets\/qwickly-accordion\.js" defer><\/script>/, '<script type="module" src="/assets/index-CSUI-GI9.js"></script><script src="/assets/qwickly-auth-nav.js" defer></script><script src="/assets/qwickly-accordion.js" defer></script>'));
    }

    console.log('File not found, serving index.html');
    return res.sendFile(indexPath);
  }

  console.log('index.html missing from dist/public');
  return res.status(404).send('Frontend build not found');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
