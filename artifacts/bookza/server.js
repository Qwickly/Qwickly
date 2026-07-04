import express from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(process.cwd(), 'dist/public');

// Serve static files (assets, CSS, JS, images)
app.use(express.static(distPath));

// Hybrid routing: if file exists on disk, serve it; otherwise serve index.html for React
app.get('*', (req, res) => {
  const pathname = req.path;
  const fileName = pathname.replace(/^\//, '') || 'index.html';
  const filePath = path.join(distPath, fileName);

  // If the file exists on disk, serve it directly
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }

  // Otherwise, serve index.html for React client-side routing
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
