import express from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);
const distPath = path.join(__dirname, 'dist/public');

const normalizeApiUrl = (value) => {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
};

const resolveApiUrl = () => {
  const value = process.env.VITE_API_PROXY_UPSTREAM_URL || process.env.VITE_API_URL || '';
  if (value) return normalizeApiUrl(value);

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return normalizeApiUrl(process.env.RAILWAY_PUBLIC_DOMAIN);
  }

  return 'https://qwickly-production.up.railway.app';
};

const FALLBACK_SUPABASE_URL = 'https://kzfixfcatknkkqttnvvi.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6Zml4ZmNhdGtua2txdHRudnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODQ5MDYsImV4cCI6MjA5Njc2MDkwNn0.NFJOSWvOstCMEgQw0BBD1IV4kZLrfdoKO2RY3Qi6g8w';

const writeRuntimeEnvConfig = () => {
  const apiProxyTarget = resolveApiUrl();
  const envConfigPath = path.join(distPath, 'env-config.js');
  const runtimeEnv = {
    VITE_API_URL: apiProxyTarget,
    VITE_API_PROXY_UPSTREAM_URL: apiProxyTarget,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY,
  };
  const content = `// Auto-generated at container startup\nwindow.__ENV__ = ${JSON.stringify(runtimeEnv, null, 2)};\n`;
  fs.mkdirSync(distPath, { recursive: true });
  fs.writeFileSync(envConfigPath, content, 'utf8');
  console.log('Wrote runtime env-config.js with API proxy upstream:', apiProxyTarget);
};

console.log('Server starting...');
console.log('Dist path:', distPath);
console.log('PORT:', PORT);
console.log('Dist exists:', fs.existsSync(distPath));
writeRuntimeEnvConfig();

// SPA routes that should render the React app (index.html with #root mount point)
const SPA_ROUTES = [
  '/login',
  '/signup',
  '/register',
  '/dashboard',
  '/calendar',
  '/bookings',
  '/clients',
  '/services',
  '/staff',
  '/payments',
  '/analytics',
  '/whatsapp',
  '/marketing',
  '/booking-page',
  '/ai-assistant',
  '/settings',
  '/billing',
];

const isSpaRoute = (pathname) => {
  if (SPA_ROUTES.includes(pathname)) return true;
  if (pathname.startsWith('/clients/')) return true;
  if (pathname.startsWith('/staff/')) return true;
  if (pathname.startsWith('/book/')) return true;
  if (pathname.startsWith('/booking/manage/')) return true;
  return false;
};

// Serve the built React SPA index.html for SPA routes.
// The built index.html from Vite already contains the correct hashed script references.
// We just need to ensure a #root element is present for React to mount into.
const serveSpaPage = (res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('index.html missing from dist/public');
    return res.status(503).send('Frontend build not found. The app may still be deploying.');
  }

  let html = fs.readFileSync(indexPath, 'utf8');

  // Inject <div id="root"> if not already present (the marketing homepage HTML
  // does not have a #root div; the React app needs one to mount into).
  if (!html.includes('id="root"')) {
    html = html.replace('<body>', '<body><div id="root"></div>');
  }

  return res.type('html').send(html);
};

// Add security and SEO headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Set X-Robots-Tag: noindex for SPA routes
  if (isSpaRoute(req.path)) {
    res.setHeader('X-Robots-Tag', 'noindex');
  }
  
  next();
});

app.use(express.static(distPath, { index: false }));

app.use('/api', (req, res) => {
  const upstreamBase = resolveApiUrl();
  if (!upstreamBase) {
    console.error('API proxy misconfiguration: no upstream backend URL provided');
    return res.status(502).send('Bad gateway');
  }

  const targetUrl = new URL(req.originalUrl, upstreamBase);
  const transport = targetUrl.protocol === 'https:' ? https : http;

  const proxyReq = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (error) => {
    console.error('API proxy error:', error);
    res.status(502).send('Bad gateway');
  });

  req.pipe(proxyReq);
});

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.get('*', (req, res) => {
  const pathname = req.path;
  console.log('Request:', pathname);

  // For known SPA routes, serve the React app shell immediately
  if (isSpaRoute(pathname)) {
    return serveSpaPage(res);
  }

  // For everything else, try to find a matching static file in dist/public
  const filePath = path.join(distPath, pathname.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }

  // Try with .html extension (e.g. /pricing -> /pricing.html)
  const htmlFilePath = filePath + '.html';
  if (fs.existsSync(htmlFilePath) && fs.statSync(htmlFilePath).isFile()) {
    return res.sendFile(htmlFilePath);
  }

  // If we reach here, it's an unknown route. Serve 404 page.
  console.log('No match for', pathname, '— serving 404');
  const notFoundPath = path.join(distPath, '404.html');
  
  if (fs.existsSync(notFoundPath)) {
    return res.status(404).sendFile(notFoundPath);
  }

  // Ultimate fallback if 404.html is missing
  return res.status(404).send('404 - Page not found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Serving static files from: ${distPath}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  process.exit(0);
});
