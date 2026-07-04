const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'dist/public');

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// SPA routes that should serve index.html
const spaRoutes = [
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

const server = http.createServer((req, res) => {
  const urlPath = req.url;
  
  // Check if it's an SPA route
  const isSpaRoute = spaRoutes.some(route => 
    urlPath === route || urlPath.startsWith(route + '/') || urlPath.startsWith('/clients/') || urlPath.startsWith('/staff/') || urlPath.startsWith('/book/')
  );

  if (isSpaRoute) {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    fs.readFile(indexPath, (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end('Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);

  // If the path doesn't have an extension, try adding .html
  if (!path.extname(filePath)) {
    const htmlPath = filePath + '.html';
    if (fs.existsSync(htmlPath)) {
      filePath = htmlPath;
    }
  }

  // If file doesn't exist, return 404
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Server Error');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
