# SEO Playbook — copy this pattern to a new marketing site (e.g. K53 app)

This documents everything the Qwickly marketing site (`artifacts/bookza/*.html`) does for SEO, so
the same setup can be rebuilt for another static/Vite-based marketing site from scratch. Every
numbered section says **what it is**, **why it matters**, and **what to copy**.

Source files referenced below all live under `artifacts/bookza/` in this repo.

---

## 1. Per-page `<head>` meta tags

Every marketing HTML page (`index.html`, `salons.html`, `pricing.html`, etc.) carries the same
block of tags, with only the title/description/url swapped per page. Reference: the top of
[index.html](../artifacts/bookza/index.html) and [salons.html](../artifacts/bookza/salons.html).

```html
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Salon Booking Software | Qwickly</title>
<meta name="description" content="One or two plain-English sentences describing this specific page — not the whole site." />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="https://qwickly.co.za/salons.html" />

<!-- Open Graph (controls the preview card on WhatsApp/Facebook/LinkedIn/Slack) -->
<meta property="og:site_name" content="Qwickly" />
<meta property="og:locale" content="en_ZA" />
<meta property="og:type" content="article" /> <!-- "website" for the homepage, "article" for inner pages -->
<meta property="og:title" content="Salon Booking Software | Qwickly" />
<meta property="og:description" content="Same copy as the meta description above." />
<meta property="og:url" content="https://qwickly.co.za/salons.html" />
<meta property="og:image" content="https://qwickly.co.za/opengraph.jpg" />
<meta property="og:image:alt" content="One-line alt text for the share image" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/jpeg" />

<!-- Twitter/X card (X ignores Open Graph, needs its own tags) -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Salon Booking Software | Qwickly" />
<meta name="twitter:description" content="Same copy again." />
<meta name="twitter:image" content="https://qwickly.co.za/opengraph.jpg" />

<!-- Local SEO signal (drop these two if the new site isn't country-specific) -->
<meta name="geo.region" content="ZA" />
<meta name="geo.placename" content="South Africa" />

<!-- Language targeting -->
<link rel="alternate" hreflang="en-za" href="https://qwickly.co.za/salons.html" />
<link rel="alternate" hreflang="x-default" href="https://qwickly.co.za/salons.html" />
```

**What each piece is actually for:**
- `<title>` / `description` — the blue link text and grey snippet on a Google results page. This is the single highest-leverage SEO element per page; write it per-page, never reuse the homepage one.
- `robots` — `index, follow` tells crawlers "list this page, and follow its links." (The app's authenticated routes are kept out of the crawl differently — see §4, robots.txt.)
- `canonical` — tells Google "this exact URL is the authoritative version," which matters once you have `?utm_source=` query params, `www` vs bare domain, or trailing slashes floating around — without it, Google may treat near-duplicate URLs as separate pages and split ranking signal between them.
- Open Graph / Twitter tags — control the preview card when a link is pasted into WhatsApp, Slack, iMessage, X, LinkedIn, etc. Without these, sharing a link gives an ugly bare-URL preview with no image or title.
- `geo.region`/`geo.placename` — a minor, mostly legacy local-SEO signal. Keep only if the new site is targeting one country; drop if it's global.
- `hreflang` — tells Google which language/region a page targets. With only one language, this mainly guards against Google assuming it should serve this page to non-English searchers.

---

## 2. Structured data (JSON-LD) — three layers, stacked per page

This is the part most people skip, and it's what unlocks rich results (star ratings, FAQ
accordions, breadcrumbs) directly in Google search results instead of a plain blue link.

**Layer 1 — Organization + WebSite + SoftwareApplication (homepage only)**
See [index.html:40-106](../artifacts/bookza/index.html#L40-L106). This is a `@graph` array
describing the business as an entity (name, logo, URL), the website itself (with a `SearchAction`
so Google can offer a sitelinks searchbox), and — since this is a SaaS product — a
`SoftwareApplication` schema with pricing and rating, which is what makes Google eligible to show
a price and star rating under the homepage result.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": ".../#organization", "name": "...", "url": "...", "logo": {...} },
    { "@type": "WebSite", "@id": ".../#website", "url": "...", "publisher": {"@id": ".../#organization"},
      "potentialAction": { "@type": "SearchAction", "target": {...}, "query-input": "..." } },
    { "@type": "SoftwareApplication", "name": "...", "applicationCategory": "BusinessApplication",
      "offers": { "@type": "Offer", "priceCurrency": "ZAR", "price": "129" },
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.8", "ratingCount": "124" } }
  ]
}
```
⚠️ `aggregateRating` must reflect real review counts you can substantiate if asked — don't copy
fabricated numbers into a new site's schema; Google can penalize sites for fake review markup.

**Layer 2 — WebPage + BreadcrumbList (every inner page)**
See [salons.html:22-57](../artifacts/bookza/salons.html#L22-L57). Every non-home page gets a
`WebPage` entry (name/description/url/publisher) plus a `BreadcrumbList` showing the click path
from Home. This is what makes Google show `qwickly.co.za › Salons` breadcrumb-style under the
result instead of a raw URL.

**Layer 3 — FAQPage (only on pages with a visible FAQ accordion)**
See [salons.html:58-...](../artifacts/bookza/salons.html#L58). This is what makes Google show
expandable Q&A directly under the search result. It's generated automatically from the visible
FAQ markup on the page (see §5) — **the JSON-LD must mirror text that's actually visible on the
page**, Google's guidelines require that (no hidden/answer-only-in-schema content).

---

## 3. `sitemap.xml`

[public/sitemap.xml](../artifacts/bookza/public/sitemap.xml) — one `<url>` entry per real page,
excluding anything behind login. Priority is relative (1.0 = homepage, descending for less
important pages) and `changefreq` is an honesty-based hint to crawlers about how often to re-check
the page — neither is a hard guarantee, but a rough, truthful signal helps crawl budget.

```xml
<url>
  <loc>https://qwickly.co.za/salons.html</loc>
  <lastmod>2026-07-22</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.8</priority>
</url>
```

Rule of thumb used here: homepage `1.0` → core product pages `0.85-0.9` → industry/solution pages
`0.75-0.8` → about/contact `0.6-0.65` → legal (terms/privacy) `0.35`. Once submitted to Google
Search Console, `sitemap.xml` doesn't need re-submission on every edit — Google re-crawls it
periodically — but keep `lastmod` honest when you actually change a page.

---

## 4. `robots.txt`

[public/robots.txt](../artifacts/bookza/public/robots.txt):

```
User-agent: *
Allow: /

Disallow: /login
Disallow: /dashboard
Disallow: /calendar
... (every authenticated app route)

Sitemap: https://qwickly.co.za/sitemap.xml
```

Purpose: keep the crawl budget on marketing pages that can actually rank, not on pages that
require login and would 404/redirect for an anonymous crawler anyway (which wastes crawl budget
and can look like broken/low-quality content). The `Sitemap:` line at the bottom is what lets
Google auto-discover the sitemap without manual submission.

---

## 5. FAQ markup convention (what the automation script parses)

FAQ sections use plain `<details>`/`<summary>` accordions (native HTML, no JS needed for the
expand/collapse), with a very specific structure so the script in §6 can extract them:

```html
<details class="faq-item">
  <summary>Can clients book through WhatsApp?</summary>
  <div class="faq-a">Yes. Qwickly helps clients request appointments through WhatsApp...</div>
</details>
```

If you write a new FAQ section for the K53 site, **keep this exact shape** (`<summary>` for the
question, a sibling `<div class="faq-a">` for the answer) — the extraction script in §6 is a
regex against this exact structure, not a general HTML parser.

---

## 6. The two automation scripts

These are one-off Node scripts, not part of the build — you run them manually with `node
scripts/seo.cjs` after adding/editing pages, then review the diff.

**[scripts/seo.cjs](../artifacts/bookza/scripts/seo.cjs)** — bulk-applies boilerplate across every
`*.html` file in the site root:
- Adds the `geo.region`/`geo.placename`/`hreflang`/OG-image-dimension tags (§1) to any page missing them.
- Wraps the page body in `<main>...</main>` between `</nav>` and `<footer` if not already present (helps assistive tech + is a mild semantic-HTML signal).
- Injects the `BreadcrumbList` JSON-LD (§2, layer 2) using a hardcoded `getBreadcrumb()` filename→label map at the top of the file — **this map is the one thing you must edit by hand** when adding a new page (add an entry with its display name and nav parent).

**[scripts/seo-faq.cjs](../artifacts/bookza/scripts/seo-faq.cjs)** — scans a hardcoded list of
filenames for `<details class="faq-item">` blocks (§5), extracts every question/answer pair via
regex, and appends a `FAQPage` JSON-LD block (§2, layer 3) into that page's existing `<script
type="application/ld+json">` array — but only if one doesn't already exist (safe to re-run).

To reuse for K53: copy both scripts, update the `getBreadcrumb()` map and the `faqFiles` array to
the new site's actual page list and nav structure, then run them once per new page you add.

---

## 7. Wiring new HTML pages into the Vite build

This site is a **multi-page Vite app** — each marketing HTML file must be explicitly registered as
a build entry point in [vite.config.ts](../artifacts/bookza/vite.config.ts), or Vite won't bundle
it into `dist/`:

```ts
rollupOptions: {
  input: {
    index: path.resolve(import.meta.dirname, "index.html"),
    salons: path.resolve(import.meta.dirname, "salons.html"),
    // ...one entry per .html file at the project root
  },
}
```
Forgetting this step is the most common way a new marketing page "works locally" (opened directly
as a file) but is missing from the production build.

---

## 8. Server-side plumbing that supports all of the above

[server.js](../artifacts/bookza/server.js) does two SEO-relevant things beyond serving static files:
- **Canonical host redirect** (lines ~110-124): 301-redirects `www.qwickly.co.za` → `qwickly.co.za`. Without this, Google can index both hostnames as separate, duplicate-content sites and split ranking signal between them. Pick one canonical host for K53 and redirect the other to it the same way.
- **`.html`-less URL fallback** (lines ~150-154): `/pricing` resolves to `/pricing.html` if no exact file match exists — lets you link to and rank clean URLs without the `.html` extension showing.

---

## 9. Supporting assets

Referenced by the tags in §1 — make equivalents for K53 before copying the HTML head boilerplate:
- `opengraph.jpg` — 1200×630px share-preview image (public/opengraph.jpg)
- `Favicon-light.svg` / `Favicon-dark.svg` — theme-aware favicons via `media="(prefers-color-scheme)"`
- `apple-touch-icon.png` — 180×180px, for iOS home-screen bookmarks
- A square logo SVG for the JSON-LD `Organization.logo` field

---

## Checklist for setting this up on the K53 app

1. Write the real per-page title/description copy first — everything else is boilerplate around it.
2. Copy the `<head>` block from §1 into each page, swapping title/description/canonical/og:url per page.
3. Add the Organization/WebSite/SoftwareApplication JSON-LD (§2, layer 1) to the K53 homepage only — drop the `SoftwareApplication`/pricing/rating fields if K53 isn't sold the same way, or drop the whole block if there's nothing honest to put in `aggregateRating`.
4. Add WebPage + BreadcrumbList JSON-LD (§2, layer 2) to every inner page.
5. If pages have FAQs, use the exact `<details class="faq-item"><summary>...</summary><div class="faq-a">...</div></details>` markup (§5).
6. Copy `scripts/seo.cjs` and `scripts/seo-faq.cjs`, update their hardcoded page/breadcrumb maps for K53, run them once.
7. Write `sitemap.xml` (§3) and `robots.txt` (§4) for K53's real page list and app routes.
8. Register every new `.html` file in `vite.config.ts`'s `rollupOptions.input` (§7) or it won't ship.
9. Add the canonical-host redirect to K53's server (§8) once the domain is decided.
10. Make the supporting image assets (§9).
11. Once live: submit `sitemap.xml` in Google Search Console, and spot-check a couple of pages with Google's [Rich Results Test](https://search.google.com/test/rich-results) to confirm the JSON-LD validates.
