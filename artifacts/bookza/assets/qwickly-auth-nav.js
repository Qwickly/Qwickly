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

  if (!hasActiveSession()) return;

  document.querySelectorAll('a[href="/login"]').forEach(function (link) {
    link.textContent = "Dashboard";
    link.setAttribute("href", "/dashboard");
  });
})();
