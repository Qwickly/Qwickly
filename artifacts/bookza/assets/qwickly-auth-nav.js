(function () {
  "use strict";

  var SESSION_KEY = "sb-kzfixfcatknkkqttnvvi-auth-token";

  function hasActiveSession() {
    try {
      var raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return false;

      var session = JSON.parse(raw);
      if (!session || !session.access_token) return false;

      if (session.expires_at && session.expires_at * 1000 < Date.now()) {
        return false;
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  function updateAuthLinks() {
    if (!hasActiveSession()) return;

    document.querySelectorAll('a[href="/login"]').forEach(function (link) {
      link.textContent = "Dashboard";
      link.setAttribute("href", "/dashboard");
    });
  }

  function setupHeaderScrollState() {
    var nav = document.querySelector(".qnav");
    if (!nav) return;

    var hero = document.querySelector(
      ".hero, .page-hero, .ai-hero, .booking-hero, .solution-hero, .contact-hero, .campaign-hero",
    );

    var ticking = false;

    function getThreshold() {
      if (!hero) return 96;
      return Math.max(96, hero.offsetTop + hero.offsetHeight - nav.offsetHeight - 28);
    }

    function update() {
      ticking = false;
      nav.classList.toggle("scrolled", window.scrollY > getThreshold());
    }

    function requestUpdate() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    update();
  }

  function setupSiteAnimations() {
    var path = window.location.pathname;
    if (path === "/" || path === "/index.html") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var root = document.querySelector("main") || document.body;
    if (!root || !("IntersectionObserver" in window)) return;

    var selectors = [
      ".page-hero .page-eyebrow",
      ".page-hero .page-h1",
      ".page-hero .page-sub",
      ".page-hero .page-actions",
      ".ai-hero-copy > *",
      ".solution-hero-copy > .page-eyebrow",
      ".solution-hero-copy > .page-h1",
      ".solution-hero-copy > .page-sub",
      ".solution-hero-copy > .page-actions",
      ".solution-hero-visual",
      ".section-head > .section-eyebrow",
      ".section-head > .section-title",
      ".section-head > .section-sub",
      ".solution-suite-copy > .section-eyebrow",
      ".solution-suite-copy > .section-title",
      ".solution-suite-copy > .section-sub",
      ".solution-suite-visual",
      ".solution-benefits-head > *",
      ".solution-client-photo",
      ".solution-client-copy > *",
      ".site-cta-copy > *",
      ".site-cta-visual",
      ".pricing-builder",
      ".plan-calc-left > *",
      ".plan-calc-summary",
      ".contact-form-card",
      ".module-card",
      ".content-card",
      ".feature-step-card",
      ".feature-stat-card",
      ".value-card",
      ".booking-step-card",
      ".control-card",
      ".solution-stat-card",
      ".solution-benefits-grid > article",
      ".solution-benefits-grid > a",
      ".solution-journey-item",
      ".about-story-card",
      ".about-team-card",
      ".contact-info-card",
      ".pricing-card",
      ".token-price-card",
      ".faq-item",
      ".callout",
      ".wf-card",
      ".ai-brain-card",
      ".ai-scenario-copy",
      ".ai-scenario-phone",
      ".ai-scenario-shot",
    ];

    var seen = [];
    selectors.forEach(function (selector) {
      root.querySelectorAll(selector).forEach(function (el) {
        if (el.closest(".qnav, .site-footer")) return;
        if (el.getAttribute("aria-hidden") === "true") return;
        if (seen.indexOf(el) !== -1) return;
        seen.push(el);
      });
    });

    if (!seen.length) return;

    seen.forEach(function (el, index) {
      var isVisual = el.matches(
        ".solution-hero-visual, .solution-suite-visual, .solution-client-photo, .site-cta-visual, .ai-scenario-phone, .ai-scenario-shot",
      );
      var isCard = el.matches(
        ".module-card, .content-card, .feature-step-card, .feature-stat-card, .value-card, .booking-step-card, .control-card, .solution-stat-card, .solution-benefits-grid > article, .solution-benefits-grid > a, .solution-journey-item, .about-story-card, .about-team-card, .contact-info-card, .pricing-card, .token-price-card, .faq-item, .callout, .wf-card, .ai-brain-card",
      );

      el.classList.add("site-reveal-ready");
      el.style.setProperty("--reveal-delay", Math.min((index % 6) * 45, 180) + "ms");

      if (isVisual) {
        el.setAttribute("data-reveal", index % 2 ? "left" : "right");
      } else if (isCard) {
        el.setAttribute("data-reveal", "scale");
      }
    });

    root
      .querySelectorAll(".card-icon, .control-icon, .solution-check-list svg, .feature-step-card svg, .feature-stat-card svg")
      .forEach(function (icon, index) {
        if (icon.closest(".qnav, .site-footer")) return;
        icon.classList.add("site-icon-ambient");
        icon.style.setProperty("--icon-delay", "-" + ((index % 5) * 0.7).toFixed(1) + "s");
      });

    var observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
    );

    seen.forEach(function (el) {
      observer.observe(el);
    });
  }

  function setupLegalTocScrollSpy() {
    var toc = document.querySelector(".legal-toc");
    if (!toc) return;

    var links = Array.prototype.slice.call(toc.querySelectorAll('.legal-toc-list a[href^="#"]'));
    if (!links.length) return;

    var sectionMap = new Map();
    links.forEach(function (link) {
      var href = link.getAttribute("href") || "";
      var id = href.slice(1);
      if (!id) return;
      var section = document.getElementById(id);
      if (section) sectionMap.set(section, link);
    });

    if (!sectionMap.size) return;

    var activeLink = null;

    function setActive(link) {
      if (!link || link === activeLink) return;
      if (activeLink) activeLink.classList.remove("is-active");
      link.classList.add("is-active");
      activeLink = link;

      if (typeof link.scrollIntoView === "function") {
        link.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }

    if (!("IntersectionObserver" in window)) {
      setActive(links[0]);
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        var visible = entries
          .filter(function (entry) {
            return entry.isIntersecting;
          })
          .sort(function (a, b) {
            return a.boundingClientRect.top - b.boundingClientRect.top;
          });

        if (visible.length) setActive(sectionMap.get(visible[0].target));
      },
      { rootMargin: "-104px 0px -58% 0px", threshold: 0 },
    );

    sectionMap.forEach(function (_, section) {
      observer.observe(section);
    });

    setActive(links[0]);
  }

  updateAuthLinks();
  setupHeaderScrollState();
  setupSiteAnimations();
  setupLegalTocScrollSpy();
})();
