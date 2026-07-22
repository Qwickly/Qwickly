const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const targetPages = [
  'salons.html', 'barbers.html', 'beauty-studios.html', 'wellness.html', 'consultants.html', 'tutors.html',
  'online-booking.html', 'whatsapp-ai.html', 'campaigns.html', 'features.html', 'smart-calendar.html', 'client-crm.html', 'payments-deposits.html', 'whatsapp-reminders.html'
];

const crossLinkHtml = `
    <section class="section" style="padding-top: 2rem;">
      <div class="section-inner">
        <div class="section-eyebrow">Explore More</div>
        <h2>Discover how Qwickly connects your entire workflow</h2>
        <div class="faq-grid" style="margin-top: 2rem;">
          <div class="faq-list">
            <a href="/online-booking.html" style="display: block; padding: 1.5rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; text-decoration: none; margin-bottom: 1rem; transition: border-color 0.2s;">
              <h3 style="color: var(--text-1); font-size: 1.125rem; margin: 0 0 0.5rem 0; line-height: 1.2;">Online Booking</h3>
              <p style="color: var(--text-2); margin: 0; font-size: 0.9375rem; line-height: 1.5;">Create a public booking page where clients can select services and staff.</p>
            </a>
            <a href="/client-crm.html" style="display: block; padding: 1.5rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; text-decoration: none; margin-bottom: 1rem; transition: border-color 0.2s;">
              <h3 style="color: var(--text-1); font-size: 1.125rem; margin: 0 0 0.5rem 0; line-height: 1.2;">Client CRM</h3>
              <p style="color: var(--text-2); margin: 0; font-size: 0.9375rem; line-height: 1.5;">Keep rich client profiles, booking histories, and notes connected.</p>
            </a>
          </div>
          <div class="faq-list">
            <a href="/payments-deposits.html" style="display: block; padding: 1.5rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; text-decoration: none; margin-bottom: 1rem; transition: border-color 0.2s;">
              <h3 style="color: var(--text-1); font-size: 1.125rem; margin: 0 0 0.5rem 0; line-height: 1.2;">Payments &amp; Deposits</h3>
              <p style="color: var(--text-2); margin: 0; font-size: 0.9375rem; line-height: 1.5;">Track deposits and protect your calendar from no-shows.</p>
            </a>
            <a href="/whatsapp-reminders.html" style="display: block; padding: 1.5rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; text-decoration: none; margin-bottom: 1rem; transition: border-color 0.2s;">
              <h3 style="color: var(--text-1); font-size: 1.125rem; margin: 0 0 0.5rem 0; line-height: 1.2;">WhatsApp Reminders</h3>
              <p style="color: var(--text-2); margin: 0; font-size: 0.9375rem; line-height: 1.5;">Send automated booking confirmations and reminders via WhatsApp.</p>
            </a>
          </div>
        </div>
      </div>
    </section>
`;

for (const file of targetPages) {
  let content = fs.readFileSync(path.join(dir, file), 'utf8');
  
  // Avoid double injection
  if (!content.includes('Discover how Qwickly connects your entire workflow')) {
    content = content.replace('</main>', crossLinkHtml + '    </main>');
    fs.writeFileSync(path.join(dir, file), content);
    console.log('Injected internal links into', file);
  } else {
    console.log('Internal links already present in', file);
  }
}
