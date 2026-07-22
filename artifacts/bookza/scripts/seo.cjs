const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const publicDir = path.join(dir, 'public');

// 1. Update sitemap.xml
const sitemapPath = path.join(publicDir, 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapPath, 'utf8');
sitemap = sitemap.replace(/2026-07-21/g, '2026-07-22');
if (!sitemap.includes('pre-signup.html')) {
  sitemap = sitemap.replace('</urlset>', `  <url>\n    <loc>https://qwickly.co.za/pre-signup.html</loc>\n    <lastmod>2026-07-22</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>\n</urlset>`);
}
fs.writeFileSync(sitemapPath, sitemap);
console.log('Updated sitemap.xml');

// Helper to get breadcrumb name from filename
function getBreadcrumb(file) {
  const map = {
    'index.html': { name: 'Home', path: '' },
    'pricing.html': { name: 'Pricing', path: 'pricing.html', parent: 'Home' },
    'salons.html': { name: 'Salons', path: 'salons.html', parent: 'Solutions' },
    'barbers.html': { name: 'Barbers', path: 'barbers.html', parent: 'Solutions' },
    'beauty-studios.html': { name: 'Beauty Studios', path: 'beauty-studios.html', parent: 'Solutions' },
    'wellness.html': { name: 'Wellness', path: 'wellness.html', parent: 'Solutions' },
    'consultants.html': { name: 'Consultants', path: 'consultants.html', parent: 'Solutions' },
    'tutors.html': { name: 'Tutors', path: 'tutors.html', parent: 'Solutions' },
    'online-booking.html': { name: 'Online Booking', path: 'online-booking.html', parent: 'Product' },
    'whatsapp-ai.html': { name: 'AI Assistant', path: 'whatsapp-ai.html', parent: 'Product' },
    'campaigns.html': { name: 'Campaigns', path: 'campaigns.html', parent: 'Product' },
    'features.html': { name: 'Features', path: 'features.html', parent: 'Home' },
    'smart-calendar.html': { name: 'Smart Calendar', path: 'smart-calendar.html', parent: 'Product' },
    'client-crm.html': { name: 'Client CRM', path: 'client-crm.html', parent: 'Product' },
    'payments-deposits.html': { name: 'Payments & Deposits', path: 'payments-deposits.html', parent: 'Product' },
    'whatsapp-reminders.html': { name: 'WhatsApp Reminders', path: 'whatsapp-reminders.html', parent: 'Product' },
    'about.html': { name: 'About', path: 'about.html', parent: 'Company' },
    'contact.html': { name: 'Contact', path: 'contact.html', parent: 'Company' },
    'privacy.html': { name: 'Privacy Policy', path: 'privacy.html', parent: 'Legal' },
    'terms.html': { name: 'Terms of Service', path: 'terms.html', parent: 'Legal' },
    'status.html': { name: 'System Status', path: 'status.html', parent: 'Legal' }
  };
  return map[file];
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== '404.html');

for (const file of files) {
  if (file === 'pre-signup.html') continue; // Skip pre-signup page structure changes
  
  let content = fs.readFileSync(path.join(dir, file), 'utf8');
  let changed = false;

  // Add Meta Tags
  if (!content.includes('name="geo.region"')) {
    const metaTags = `
    <!-- Geo-targeting for South African local SEO -->
    <meta name="geo.region" content="ZA" />
    <meta name="geo.placename" content="South Africa" />
    
    <!-- Open Graph image dimensions -->
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/jpeg" />
    
    <!-- Language targeting -->
    <link rel="alternate" hreflang="en-za" href="https://qwickly.co.za/${file === 'index.html' ? '' : file}" />
    <link rel="alternate" hreflang="x-default" href="https://qwickly.co.za/${file === 'index.html' ? '' : file}" />
`;
    content = content.replace('</head>', metaTags + '</head>');
    changed = true;
  }

  // Wrap in <main> if not present (only for pages that have nav and footer, excluding index.html which already has it)
  if (file !== 'index.html' && !content.includes('<main>')) {
    const navEndIndex = content.indexOf('</nav>');
    const footerStartIndex = content.indexOf('<footer');
    
    if (navEndIndex !== -1 && footerStartIndex !== -1) {
      const before = content.substring(0, navEndIndex + 6);
      const middle = content.substring(navEndIndex + 6, footerStartIndex);
      const after = content.substring(footerStartIndex);
      content = before + '\n    <main>' + middle + '\n    </main>\n    ' + after;
      changed = true;
    }
  }

  // Add Structured Data
  const bcInfo = getBreadcrumb(file);
  if (bcInfo && content.includes('type="application/ld+json"')) {
    const scriptStart = content.indexOf('<script type="application/ld+json">');
    const scriptEnd = content.indexOf('</script>', scriptStart);
    
    if (scriptStart !== -1 && scriptEnd !== -1) {
      let jsonStr = content.substring(scriptStart + 35, scriptEnd).trim();
      try {
        let json = JSON.parse(jsonStr);
        let breadcrumbAdded = false;
        
        // Ensure json is an array or object
        if (!Array.isArray(json) && !json['@graph']) {
            if (json['@type'] === 'WebPage') {
                // Keep the WebPage schema, but we'll add BreadcrumbList via an array
                const newJson = [json];
                
                // Construct breadcrumb
                const itemListElement = [{
                    "@type": "ListItem",
                    "position": 1,
                    "name": "Home",
                    "item": "https://qwickly.co.za/"
                }];
                
                if (bcInfo.parent && bcInfo.name !== 'Home') {
                    itemListElement.push({
                        "@type": "ListItem",
                        "position": 2,
                        "name": bcInfo.parent
                    });
                    itemListElement.push({
                        "@type": "ListItem",
                        "position": 3,
                        "name": bcInfo.name,
                        "item": "https://qwickly.co.za/" + bcInfo.path
                    });
                } else if (bcInfo.name !== 'Home') {
                    itemListElement.push({
                        "@type": "ListItem",
                        "position": 2,
                        "name": bcInfo.name,
                        "item": "https://qwickly.co.za/" + bcInfo.path
                    });
                }

                if (itemListElement.length > 1) {
                  newJson.push({
                      "@context": "https://schema.org",
                      "@type": "BreadcrumbList",
                      "itemListElement": itemListElement
                  });
                }
                
                // Basic FAQ detection for solution pages and pricing
                if (['pricing.html', 'salons.html', 'barbers.html', 'beauty-studios.html', 'wellness.html', 'consultants.html', 'tutors.html'].includes(file)) {
                   // We will let a manual tool process the exact FAQ questions since parsing HTML with regex is brittle
                   // but we can add a placeholder to be replaced or handled separately.
                }

                content = content.substring(0, scriptStart + 35) + '\n' + JSON.stringify(newJson, null, 2) + '\n    ' + content.substring(scriptEnd);
                changed = true;
            }
        }
      } catch(e) {
        console.error('Error parsing JSON-LD in ' + file, e.message);
      }
    }
  }

  if (changed) {
    fs.writeFileSync(path.join(dir, file), content);
    console.log('Updated SEO tags in', file);
  }
}
