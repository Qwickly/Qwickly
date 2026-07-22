const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const faqFiles = ['pricing.html', 'salons.html', 'barbers.html', 'beauty-studios.html', 'wellness.html', 'consultants.html', 'tutors.html'];

for (const file of faqFiles) {
  let content = fs.readFileSync(path.join(dir, file), 'utf8');
  
  // Extract FAQs - using [\s\S]*? to handle newlines
  const faqRegex = /<summary>\s*([^<]+)\s*<\/summary>\s*<div class="faq-a">\s*([^<]+)\s*<\/div>/g;
  let match;
  const mainEntity = [];
  
  while ((match = faqRegex.exec(content)) !== null) {
    mainEntity.push({
      "@type": "Question",
      "name": match[1].trim(),
      "acceptedAnswer": {
        "@type": "Answer",
        "text": match[2].trim()
      }
    });
  }
  
  if (mainEntity.length > 0) {
    const scriptStart = content.indexOf('<script type="application/ld+json">');
    const scriptEnd = content.indexOf('</script>', scriptStart);
    
    if (scriptStart !== -1 && scriptEnd !== -1) {
      let jsonStr = content.substring(scriptStart + 35, scriptEnd).trim();
      try {
        let json = JSON.parse(jsonStr);
        
        // Find if FAQPage is already there
        let hasFaq = false;
        if (Array.isArray(json)) {
           for (let item of json) {
             if (item['@type'] === 'FAQPage') hasFaq = true;
           }
           if (!hasFaq) {
              json.push({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": mainEntity
              });
           }
        }
        
        if (!hasFaq) {
          content = content.substring(0, scriptStart + 35) + '\n' + JSON.stringify(json, null, 2) + '\n    ' + content.substring(scriptEnd);
          fs.writeFileSync(path.join(dir, file), content);
          console.log('Added FAQPage schema to', file, `(${mainEntity.length} questions)`);
        } else {
          console.log('FAQPage schema already exists in', file);
        }
      } catch (e) {
        console.error('Error parsing JSON for', file, e.message);
      }
    }
  } else {
    console.log('No FAQs found in', file);
  }
}
