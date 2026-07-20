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

  updateAuthLinks();
  setupHeaderScrollState();
})();
