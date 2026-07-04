import express from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(process.cwd(), 'dist/public');

// Serve static files (CSS, JS, images, etc.)
app.use(express.static(distPath));

// List of static HTML files that should be served directly
const staticHtmlFiles = new Set([
  'index.html',
  'pre-signup.html',
  'features.html',
  'online-booking.html',
  'campaigns.html',
  'whatsapp-ai.html',
  'pricing.html',
  'custom.html',
  'salons.html',
  'barbers.html',
  'beauty-studios.html',
  'wellness.html',
  'consultants.html',
  'tutors.html',
  'about.html',
  'contact.html',
  'status.html',
  'terms.html',
  'privacy.html',
]);

// Hybrid routing: serve static HTML files directly, fallback to index.html for React routes
app.get('*', (req, res) => {
  const pathname = req.path;
  
  // Remove query parameters and trailing slash
  const cleanPath = pathname.split('?')[0].replace(/\/$/, '') || '/';
  
  // Check if this is a request for a static HTML file
  if (cleanPath === '/') {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  
  const fileName = cleanPath.replace(/^\//, '');
  
  // If it's a known static HTML file, serve it
  if (staticHtmlFiles.has(fileName)) {
    const filePath = path.join(distPath, fileName);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  
  // For all other routes (React app routes), serve index.html
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
