const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from dist/public
app.use(express.static(path.join(__dirname, 'dist/public'),));

// SPA fallback - for React routes, serve index.html
// But NOT for static HTML files (.html)
app.get('*', (req, res) => {
  // If the request is for a static HTML file that exists, serve it
  if (req.path.endsWith('.html')) {
    const filePath = path.join(__dirname, 'dist/public', req.path);
    const fs = require('fs');
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  // Otherwise, serve index.html for SPA routing
  res.sendFile(path.join(__dirname, 'dist/public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
