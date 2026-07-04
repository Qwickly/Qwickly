const express = require('express');
const path = require('path');
const fs = require('fs');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, 'dist/public');

// Proxy API requests to backend
app.use('/api', createProxyMiddleware({
  target: process.env.VITE_API_URL || 'http://localhost:8080',
  changeOrigin: true,
}));

// Serve static files
app.use(express.static(distPath));

// Handle React SPA routes - fallback to index.html for non-file routes
app.get('*', (req, res) => {
  const filePath = path.join(distPath, req.path);
  
  // Check if the requested file exists (for static HTML pages)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  
  // Otherwise, serve index.html for React SPA routing
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
