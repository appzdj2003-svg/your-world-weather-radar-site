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
  // YouTube click-to-load: nothing is requested from YouTube until the visitor taps; then a youtube-nocookie iframe replaces the thumbnail.
  function initYT() {
    var list = document.querySelectorAll ? document.querySelectorAll("[data-yt]") : [];
    Array.prototype.forEach.call(list, function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("data-yt");
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
        e.preventDefault();
        var f = document.createElement("iframe");
        f.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&playsinline=1&rel=0";
        f.title = a.getAttribute("data-yt-title") || "YouTube video";
        f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        f.setAttribute("allowfullscreen", ""); f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        f.className = "yt-frame";
        a.parentNode.replaceChild(f, a);
      });
    });
  }
  // Analytics consent banner (Google Analytics, see the YW_GA snippet in <head>). Shown only to visitors whose device time zone
  // looks European and who haven't chosen yet; "Cookie settings" in the footer reopens it for anyone. No network call is made to decide.
  function initConsent() {
    var G = window.YW_GA; if (!G) return;
    var box = null;
    function place() {
      if (!box || box.hidden) return;
      var bar = document.getElementById("playbar"), h = 0;
      if (bar && !bar.hidden) h = bar.getBoundingClientRect().height; // stack above the sticky Play bar on mobile
      box.style.bottom = (h ? h + 8 : 12) + "px";
    }
    function show(focus) {
      if (!box) {
        box = document.createElement("div");
        box.className = "ckb"; box.setAttribute("role", "region"); box.setAttribute("aria-label", "Analytics cookies");
        box.innerHTML = '<p id="ckb-t">We use Google Analytics cookies to count visits. Allow? <a href="/privacy.html#website">Privacy policy</a></p>' +
          '<div class="ckb-b"><button type="button" class="btn primary" data-v="granted">Allow</button><button type="button" class="btn ghost" data-v="denied">No thanks</button></div>';
        box.addEventListener("click", function (e) {
          var b = e.target.closest && e.target.closest("button[data-v]"); if (!b) return;
          G.set(b.getAttribute("data-v")); box.hidden = true;
        });
        document.body.appendChild(box);
        var bar = document.getElementById("playbar"), x = bar && bar.querySelector(".pb-x");
        if (x) x.addEventListener("click", function () { setTimeout(place, 0); });
        window.addEventListener("resize", place);
      }
      box.hidden = false; place();
      if (focus) { var f = box.querySelector("button"); if (f) f.focus(); }
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-cookie-settings]"), function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); show(true); });
    });
    if (G.eu && !G.choice) show(false);
  }

  // Track-my-flight home card: store section so /flight can fire flight_page_click on arrival (GA4 can drop same-tab hits)
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest('a[data-ev="flight_page"]');
    if (!t) return;
    var sec = t.getAttribute("data-sec") || "home";
    var plain = !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button);
    if (plain) { try { sessionStorage.setItem("yw-flight-from", sec); } catch (x) {} }
    else if (window.gtag) gtag("event", "flight_page_click", { section: sec });
  });

  var _init = init; init = function () { _init(); initYT(); initConsent(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
