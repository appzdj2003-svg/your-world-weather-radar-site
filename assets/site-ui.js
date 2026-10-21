/* Mobile site chrome: compact menu toggle and the dismissible sticky "Get it on Google Play" bar. Desktop is untouched (CSS hides both). */
(function () {
  if (typeof document === "undefined" || !document.querySelector) return;
  function init() {
    var btn = document.querySelector(".menu-btn"), nav = document.getElementById("main-nav");
    if (btn && nav) {
      var set = function (open) {
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        nav.classList.toggle("open", open);
      };
      btn.addEventListener("click", function () { set(btn.getAttribute("aria-expanded") !== "true"); });
      nav.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("a")) set(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { set(false); btn.focus(); } });
      document.addEventListener("click", function (e) { if (nav.classList.contains("open") && !nav.contains(e.target) && !btn.contains(e.target)) set(false); });
    }
    var bar = document.getElementById("playbar");
    if (bar) {
      var KEY = "yw-playbar-hidden-until", now = Date.now(), until = 0;
      try { until = +localStorage.getItem(KEY) || 0; } catch (e) {}
      if (until > now) bar.hidden = true;
      var x = bar.querySelector(".pb-x");
      if (x) x.addEventListener("click", function () {
        bar.hidden = true;
        try { localStorage.setItem(KEY, String(now + 7 * 864e5)); } catch (e) {} // stay dismissed for 7 days
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
